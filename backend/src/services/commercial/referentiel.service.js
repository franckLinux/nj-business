'use strict';
// NJ COMMERCIAL — livraison A : paramétrage des achats (migration 050).
// Société, magasins, familles, taxes, articles, fournisseurs / clients, stock initial.
//
// Règles communes :
//   • tout est filtré par le client du contexte (req.tenantId) ; la base refuse
//     en plus tout lien entre deux clients (déclencheurs com_meme_client) ;
//   • rien ne se supprime dès qu'un objet est utilisé : on le désactive ;
//   • chaque création / modification sensible est tracée dans audit_log
//     (entité « commercial ») ;
//   • les quantités de stock viennent UNIQUEMENT des mouvements enregistrés :
//     sans mouvement, le stock est « non suivi », jamais 0.
const { sequelize } = require('../../models');
const registre = require('../registre_tiers.service');

const T = sequelize.QueryTypes;
const Q = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: T.SELECT, transaction });
const X = (sql, replacements, transaction) => sequelize.query(sql, { replacements, transaction });

class ErreurCom extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const txt = (v) => String(v ?? '').trim();
const CODE_RE = /^[A-Za-z0-9_.-]{1,20}$/;
const REF_RE = /^[A-Za-z0-9_./-]{1,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const exigerClient = (tenantId) => {
  if (!tenantId) throw new ErreurCom(400, 'Choisissez d\'abord un client.');
};
const entier = (v, nom) => {
  const n = Number.parseInt(v, 10);
  if (!Number.isInteger(n) || n <= 0) throw new ErreurCom(400, `${nom} invalide.`);
  return n;
};
const longueur = (v, max, nom) => {
  const s = txt(v);
  if (s.length > max) throw new ErreurCom(400, `${nom} : ${max} caractères au plus.`);
  return s;
};
const nombre = (v, nom, { min = 0, max = Number.MAX_SAFE_INTEGER, vide = null } = {}) => {
  if (v === undefined || v === null || txt(v) === '') return vide;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) throw new ErreurCom(400, `${nom} invalide.`);
  return n;
};
// Taxes (062) : plus aucune taxe sur les familles ni sur les articles. La taxe se
// choisit sur chaque ligne d'opération (bon de commande, facture fournisseur,
// devis…), où son taux est copié ; une taxe réservée aux ventes n'y est jamais
// une taxe d'achat, et inversement (contrôle dans chaque service de document).
const METHODES = { cmup: 'CMUP (coût moyen unitaire pondéré)', fifo: 'FIFO (premier entré, premier sorti)' };
const methode = (v) => {
  const m = txt(v || 'cmup').toLowerCase();
  if (!METHODES[m]) throw new ErreurCom(400, 'Méthode de valorisation inconnue (CMUP ou FIFO).');
  return m;
};
const booleen = (v, defaut) => (v === undefined || v === null || v === '' ? defaut : v === true || v === 'true' || v === 1 || v === '1');

const ids = (liste, nom) => [...new Set((Array.isArray(liste) ? liste : []).map((v) => entier(v, nom)))];

const auditer = (transaction, { tenantId, userId, action, id, avant, apres }) => X(
  `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, ancienne_valeur, nouvelle_valeur)
   VALUES (:t, :u, :a, 'commercial', :id, CAST(:av AS jsonb), CAST(:ap AS jsonb))`,
  { t: tenantId, u: userId, a: action, id: String(id ?? ''), av: avant ? JSON.stringify(avant) : null, ap: apres ? JSON.stringify(apres) : null },
  transaction);

const differences = (avant, apres) => {
  const a = {}; const b = {};
  for (const k of Object.keys(apres)) {
    if (JSON.stringify(avant?.[k] ?? null) !== JSON.stringify(apres[k] ?? null)) { a[k] = avant?.[k] ?? null; b[k] = apres[k]; }
  }
  return Object.keys(b).length ? { avant: a, apres: b } : null;
};

// Traduit une violation d'unicité Postgres en message lisible.
const unicite = (err, message) => {
  if (err?.original?.code === '23505' || err?.parent?.code === '23505') throw new ErreurCom(409, message);
  throw err;
};

// ── Société ───────────────────────────────────────────────────────────────
const PARAMS = {
  mentions_documents: (v) => longueur(v, 1000, 'Mentions des documents'),
  prefixe_da: (v) => { const s = txt(v).toUpperCase(); if (!/^[A-Z0-9]{1,6}$/.test(s)) throw new ErreurCom(400, 'Préfixe des demandes : 1 à 6 lettres ou chiffres.'); return s; },
  prefixe_bc: (v) => { const s = txt(v).toUpperCase(); if (!/^[A-Z0-9]{1,6}$/.test(s)) throw new ErreurCom(400, 'Préfixe des bons de commande : 1 à 6 lettres ou chiffres.'); return s; },
  bloquer_si_stock_suffisant: (v) => Boolean(v),
  proforma_obligatoire: (v) => Boolean(v),
  seuil_direction: (v) => nombre(v, 'Seuil de validation par la direction', { vide: null }),
  tolerance_ecart_pct: (v) => nombre(v, 'Tolérance d\'écart', { max: 100, vide: 10 }),
  // Lot 4 : stock négatif refusé et validation par une autre personne, par défaut.
  stock_negatif_autorise: (v) => Boolean(v),
  autovalidation_stock: (v) => Boolean(v),
};

// Identité : celle de la configuration centrale de l'entreprise (064), en
// lecture seule ici. Elle se modifie dans « Configuration de l'entreprise »,
// accessible que la caisse soit activée ou non. Le module ne garde que ses
// propres paramètres (com_parametres).
const MSG_IDENTITE = 'L\'identité de l\'entreprise (nom commercial compris) se modifie dans « Configuration de l\'entreprise », accessible depuis l\'accueil NJ BUSINESS.';

const lireSociete = async (tenantId) => {
  exigerClient(tenantId);
  const [t] = await Q('SELECT 1 AS ok FROM tenants WHERE id = :t', { t: tenantId });
  if (!t) throw new ErreurCom(404, 'Client introuvable.');
  const identite = await require('../entreprise.service').identiteDocuments(tenantId);
  const [p] = await Q('SELECT * FROM com_parametres WHERE tenant_id = :t', { t: tenantId });
  const defaut = { mentions_documents: '', prefixe_da: 'DA', prefixe_bc: 'BC',
    bloquer_si_stock_suffisant: false, proforma_obligatoire: false, seuil_direction: 500000, tolerance_ecart_pct: 10,
    stock_negatif_autorise: false, autovalidation_stock: false };
  const parametres = { ...defaut, ...(p || {}) };
  for (const k of ['seuil_direction', 'tolerance_ecart_pct']) {
    parametres[k] = parametres[k] === null ? null : Number(parametres[k]);
  }
  delete parametres.tenant_id;
  delete parametres.nom_commercial;   // 064 : il appartient à l'identité centrale
  const { FORMES_JURIDIQUES } = require('../../controllers/config.controller');
  return { identite, mode_identite: 'centrale', formes_juridiques: FORMES_JURIDIQUES, parametres, parametres_enregistres: Boolean(p) };
};

const modifierSociete = async ({ tenantId, userId, body }) => {
  exigerClient(tenantId);
  if (body.identite !== undefined || body.nom_commercial !== undefined) throw new ErreurCom(409, MSG_IDENTITE);
  await sequelize.transaction(async (tr) => {
    const [avant] = await Q('SELECT * FROM com_parametres WHERE tenant_id = :t FOR UPDATE', { t: tenantId }, tr);
    const actuel = (await lireSociete(tenantId)).parametres;
    const n = {};
    for (const [k, f] of Object.entries(PARAMS)) n[k] = body[k] === undefined ? actuel[k] : f(body[k]);
    if (avant) {
      await X(`UPDATE com_parametres SET ${Object.keys(PARAMS).map((k) => `${k} = :${k}`).join(', ')},
                 modifie_par = :u, modifie_le = NOW() WHERE tenant_id = :t`, { ...n, u: userId, t: tenantId }, tr);
    } else {
      await X(`INSERT INTO com_parametres (tenant_id, ${Object.keys(PARAMS).join(', ')}, modifie_par)
               VALUES (:t, ${Object.keys(PARAMS).map((k) => `:${k}`).join(', ')}, :u)`, { ...n, u: userId, t: tenantId }, tr);
    }
    const d = differences(actuel, n);
    if (d) await auditer(tr, { tenantId, userId, action: 'COM_PARAMETRES', id: tenantId, ...d });
  });
  return lireSociete(tenantId);
};

// ── Agences (054) : Société → Agences → Magasins ─────────────────────────
const listerAgences = async (tenantId, { actifs = '' } = {}) => {
  exigerClient(tenantId);
  const rows = await Q(
    `SELECT a.*, u.username AS responsable_nom,
            COALESCE((SELECT json_agg(json_build_object('id', m.id, 'code', m.code, 'nom', m.nom, 'actif', m.actif) ORDER BY upper(m.code))
                        FROM com_magasins m WHERE m.agence_id = a.id), '[]') AS magasins
       FROM com_agences a LEFT JOIN users u ON u.id = a.responsable_id
      WHERE a.tenant_id = :t AND (:actifs <> '1' OR a.actif)
      ORDER BY a.actif DESC, upper(a.code)`, { t: tenantId, actifs: String(actifs) });
  return rows.map((r) => ({ ...r, id: Number(r.id), magasins: r.magasins.map((m) => ({ ...m, id: Number(m.id) })) }));
};

// Agence par défaut d'un client qui n'en a encore aucune : « SIEGE ».
const agenceParDefaut = async (tenantId, userId, tr) => {
  const ag = await Q('SELECT id, actif FROM com_agences WHERE tenant_id = :t ORDER BY id', { t: tenantId }, tr);
  if (ag.length) return ag.length === 1 ? Number(ag[0].id) : null;
  const [r] = await Q(`INSERT INTO com_agences (tenant_id, code, nom, cree_par) VALUES (:t, 'SIEGE', 'Siège', :u) RETURNING id`, { t: tenantId, u: userId }, tr);
  await auditer(tr, { tenantId, userId, action: 'COM_AGENCE_CREATION', id: r.id, apres: { code: 'SIEGE', nom: 'Siège', automatique: true } });
  return Number(r.id);
};

const enregistrerAgence = async ({ tenantId, userId, id, body }) => {
  exigerClient(tenantId);
  try {
    const aid = await sequelize.transaction(async (tr) => {
      let avant = null;
      if (id) {
        [avant] = await Q('SELECT * FROM com_agences WHERE id = :id AND tenant_id = :t FOR UPDATE', { id: entier(id, 'Agence'), t: tenantId }, tr);
        if (!avant) throw new ErreurCom(404, 'Agence introuvable.');
      }
      const b = { ...(avant || {}), ...body };
      const code = txt(b.code).toUpperCase();
      if (!CODE_RE.test(code)) throw new ErreurCom(400, 'Code de l\'agence : 1 à 20 lettres, chiffres, point, tiret ou souligné.');
      const nom = longueur(b.nom, 120, 'Nom de l\'agence');
      if (!nom) throw new ErreurCom(400, 'Le nom de l\'agence est obligatoire.');
      let responsable = txt(b.responsable_id) || null;
      if (responsable) {
        const [u] = await Q('SELECT id FROM users WHERE id::text = :u AND tenant_id = :t', { u: responsable, t: tenantId }, tr);
        if (!u) throw new ErreurCom(400, 'Responsable inconnu pour ce client.');
        responsable = u.id;
      }
      const v = { code, nom, adresse: longueur(b.adresse, 300, 'Adresse'), responsable_id: responsable, actif: b.actif === undefined ? true : Boolean(b.actif) };
      if (avant && avant.actif && !v.actif) {
        const [m] = await Q('SELECT code FROM com_magasins WHERE agence_id = :a AND actif LIMIT 1', { a: avant.id }, tr);
        if (m) throw new ErreurCom(409, `Le magasin ${m.code} de cette agence est encore actif : désactivez d'abord ses magasins.`);
      }
      if (avant) {
        await X(`UPDATE com_agences SET code = :code, nom = :nom, adresse = :adresse, responsable_id = :responsable_id, actif = :actif,
                   modifie_le = NOW() WHERE id = :id`, { ...v, id: avant.id }, tr);
        const d = differences(avant, v);
        if (d) await auditer(tr, { tenantId, userId, action: 'COM_AGENCE_MODIFICATION', id: avant.id, ...d });
        return Number(avant.id);
      }
      const [r] = await Q(`INSERT INTO com_agences (tenant_id, code, nom, adresse, responsable_id, actif, cree_par)
                           VALUES (:t, :code, :nom, :adresse, :responsable_id, :actif, :u) RETURNING id`, { ...v, t: tenantId, u: userId }, tr);
      await auditer(tr, { tenantId, userId, action: 'COM_AGENCE_CREATION', id: r.id, apres: v });
      return Number(r.id);
    });
    return (await listerAgences(tenantId)).find((a) => a.id === aid);
  } catch (err) { return unicite(err, 'Ce code d\'agence existe déjà.'); }
};

// ── Magasins ─────────────────────────────────────────────────────────────
const listerMagasins = async (tenantId, { q = '', actifs = '', agence_id = '', magasins = null } = {}) => {
  exigerClient(tenantId);
  const rows = await Q(
    `SELECT m.*, u.username AS responsable_nom, ag.code AS agence_code, ag.nom AS agence_nom,
            (SELECT COUNT(DISTINCT s.article_id)::int FROM com_stock_mouvements s WHERE s.magasin_id = m.id) AS nb_articles_stock
       FROM com_magasins m LEFT JOIN users u ON u.id = m.responsable_id JOIN com_agences ag ON ag.id = m.agence_id
      WHERE m.tenant_id = :t AND (:actifs <> '1' OR m.actif)
        AND (:ag = 0 OR m.agence_id = :ag)
        AND (CAST(:mags AS BIGINT[]) IS NULL OR m.id = ANY(CAST(:mags AS BIGINT[])))
        AND (:q = '' OR lower(m.code) LIKE :like OR lower(m.nom) LIKE :like OR lower(m.localisation) LIKE :like)
      ORDER BY m.actif DESC, upper(m.code)`,
    { t: tenantId, actifs: String(actifs), ag: Number.parseInt(agence_id, 10) || 0, mags: magasins ? `{${magasins.join(',')}}` : null,
      q: txt(q), like: `%${txt(q).toLowerCase()}%` });
  return rows.map((r) => ({ ...r, id: Number(r.id), agence_id: Number(r.agence_id) }));
};

const valeursMagasin = async (tenantId, b, tr) => {
  const code = txt(b.code).toUpperCase();
  if (!CODE_RE.test(code)) throw new ErreurCom(400, 'Code du magasin : 1 à 20 lettres, chiffres, point, tiret ou souligné.');
  const nom = longueur(b.nom, 120, 'Nom du magasin');
  if (!nom) throw new ErreurCom(400, 'Le nom du magasin est obligatoire.');
  let responsable = txt(b.responsable_id) || null;
  if (responsable) {
    const [u] = await Q('SELECT id FROM users WHERE id::text = :u AND tenant_id = :t', { u: responsable, t: tenantId }, tr);
    if (!u) throw new ErreurCom(400, 'Responsable inconnu pour ce client.');
    responsable = u.id;
  }
  let agence = b.agence_id === undefined || b.agence_id === null || b.agence_id === '' ? null : entier(b.agence_id, 'Agence');
  if (!agence) agence = await agenceParDefaut(tenantId, b.__userId, tr);
  if (!agence) throw new ErreurCom(400, 'Choisissez l\'agence de rattachement du magasin.');
  const [ag] = await Q('SELECT id, actif FROM com_agences WHERE id = :a AND tenant_id = :t', { a: agence, t: tenantId }, tr);
  if (!ag) throw new ErreurCom(400, 'Agence inconnue.');
  if (!ag.actif && Number(b.__agenceAvant) !== agence) throw new ErreurCom(400, 'Cette agence est désactivée.');
  return {
    code, nom, description: longueur(b.description, 1000, 'Description'),
    localisation: longueur(b.localisation, 300, 'Localisation'), responsable_id: responsable,
    agence_id: agence, actif: b.actif === undefined ? true : Boolean(b.actif),
  };
};

// Un magasin qui a déjà servi (stock, demandes, bons) ne change pas d'agence :
// ses documents resteraient sinon rattachés à la mauvaise agence dans les états.
const magasinUtilise = async (magasinId, tr) => {
  for (const [table, col] of [['com_stock_mouvements', 'magasin_id'], ['com_demandes', 'magasin_id'], ['com_bons_commande', 'magasin_id']]) {
    const [t] = await Q(`SELECT to_regclass('public.${table}') IS NOT NULL AS ok`, {}, tr);
    if (t.ok) {
      const [u] = await Q(`SELECT 1 FROM ${table} WHERE ${col} = :m LIMIT 1`, { m: magasinId }, tr);
      if (u) return true;
    }
  }
  return false;
};

const enregistrerMagasin = async ({ tenantId, userId, id, body }) => {
  exigerClient(tenantId);
  try {
    const mid = await sequelize.transaction(async (tr) => {
      if (id) {
        const mi = entier(id, 'Magasin');
        const [avant] = await Q('SELECT * FROM com_magasins WHERE id = :id AND tenant_id = :t FOR UPDATE', { id: mi, t: tenantId }, tr);
        if (!avant) throw new ErreurCom(404, 'Magasin introuvable.');
        const v = await valeursMagasin(tenantId, { ...avant, ...body, __userId: userId, __agenceAvant: avant.agence_id }, tr);
        if (Number(avant.agence_id) !== v.agence_id && await magasinUtilise(mi, tr)) {
          throw new ErreurCom(409, 'Ce magasin a déjà des mouvements ou des documents : il ne change pas d\'agence. Créez un nouveau magasin dans l\'autre agence.');
        }
        await X(`UPDATE com_magasins SET code = :code, nom = :nom, description = :description, localisation = :localisation,
                   responsable_id = :responsable_id, agence_id = :agence_id, actif = :actif, modifie_le = NOW() WHERE id = :id`, { ...v, id: mi }, tr);
        avant.agence_id = Number(avant.agence_id);
        const d = differences(avant, v);
        if (d) await auditer(tr, { tenantId, userId, action: 'COM_MAGASIN_MODIFICATION', id: mi, ...d });
        return mi;
      }
      const v = await valeursMagasin(tenantId, { ...body, __userId: userId }, tr);
      const [r] = await Q(`INSERT INTO com_magasins (tenant_id, code, nom, description, localisation, responsable_id, agence_id, actif, cree_par)
                           VALUES (:t, :code, :nom, :description, :localisation, :responsable_id, :agence_id, :actif, :u) RETURNING id`,
      { ...v, t: tenantId, u: userId }, tr);
      await auditer(tr, { tenantId, userId, action: 'COM_MAGASIN_CREATION', id: r.id, apres: v });
      return Number(r.id);
    });
    return (await listerMagasins(tenantId)).find((m) => m.id === mid);
  } catch (err) { return unicite(err, 'Ce code de magasin existe déjà.'); }
};

// ── Unités de mesure (055) ──────────────────────────────────────────────
// Une unité a un nombre de décimales (0 pour la pièce, 3 pour le kg). Les
// conversions sont portées par l'article (1 carton = 12 pièces pour CET article).
const listerUnites = async (tenantId, { actifs = '' } = {}) => {
  exigerClient(tenantId);
  const rows = await Q(
    `SELECT u.*, (SELECT COUNT(DISTINCT au.article_id)::int FROM com_article_unites au WHERE au.unite_id = u.id) AS nb_articles
       FROM com_unites u WHERE u.tenant_id = :t AND (:actifs <> '1' OR u.actif) ORDER BY u.actif DESC, lower(u.code)`,
    { t: tenantId, actifs: String(actifs) });
  return rows.map((r) => ({ ...r, id: Number(r.id), decimales: Number(r.decimales) }));
};

// Une unité « utilisée » figure sur un document ou porte un stock : ses décimales ne baissent plus.
const uniteUtilisee = async (uniteId, tr) => {
  const [u] = await Q(
    `SELECT 1 FROM com_demande_lignes WHERE unite_id = :u
     UNION ALL SELECT 1 FROM com_bc_lignes WHERE unite_id = :u
     UNION ALL SELECT 1 FROM com_stock_mouvements s JOIN com_articles a ON a.id = s.article_id WHERE a.unite_stock_id = :u LIMIT 1`, { u: uniteId }, tr);
  return Boolean(u);
};

const enregistrerUnite = async ({ tenantId, userId, id, body }) => {
  exigerClient(tenantId);
  try {
    const uid = await sequelize.transaction(async (tr) => {
      let avant = null;
      if (id) {
        [avant] = await Q('SELECT * FROM com_unites WHERE id = :id AND tenant_id = :t FOR UPDATE', { id: entier(id, 'Unité'), t: tenantId }, tr);
        if (!avant) throw new ErreurCom(404, 'Unité introuvable.');
        avant.decimales = Number(avant.decimales);
      }
      const b = { ...(avant || {}), ...body };
      const code = txt(b.code).replace(/\s+/g, ' ');
      if (!/^[\p{L}\p{N}_.\-/ ]{1,20}$/u.test(code)) throw new ErreurCom(400, 'Code de l\'unité : 1 à 20 lettres, chiffres, espace, point, tiret ou barre.');
      const libelle = longueur(txt(b.libelle).replace(/\s+/g, ' ') || code, 60, 'Libellé');
      // Pas de doublon (062) : ni le code ni le libellé ne reprennent, sans tenir compte
      // des majuscules, le code ou le libellé d'une autre unité (« CARTON » / « carton »).
      if (!avant || avant.code.toLowerCase() !== code.toLowerCase() || avant.libelle.toLowerCase() !== libelle.toLowerCase()) {
        const [dbl] = await Q(
          `SELECT code FROM com_unites WHERE tenant_id = :t AND id <> :id
              AND (lower(code) IN (lower(:c), lower(:l)) OR lower(libelle) IN (lower(:c), lower(:l))) LIMIT 1`,
          { t: tenantId, id: avant ? avant.id : 0, c: code, l: libelle }, tr);
        if (dbl) throw new ErreurCom(409, `L'unité « ${dbl.code} » existe déjà (même code ou même libellé).`);
      }
      const decimales = Number.parseInt(b.decimales ?? 0, 10);
      if (!Number.isInteger(decimales) || decimales < 0 || decimales > 3) throw new ErreurCom(400, 'Décimales : de 0 à 3.');
      const v = { code, libelle, decimales, actif: b.actif === undefined ? true : Boolean(b.actif) };
      if (avant) {
        if (decimales < avant.decimales && await uniteUtilisee(avant.id, tr)) {
          throw new ErreurCom(409, 'Cette unité figure déjà dans des documents ou un stock : son nombre de décimales ne peut que rester ou augmenter.');
        }
        await X('UPDATE com_unites SET code = :code, libelle = :libelle, decimales = :decimales, actif = :actif, modifie_le = NOW() WHERE id = :id',
          { ...v, id: avant.id }, tr);
        // Le mot affiché sur les articles suit le code de leur unité de stock.
        if (avant.code !== code) await X('UPDATE com_articles SET unite = :c WHERE unite_stock_id = :id', { c: code, id: avant.id }, tr);
        const d = differences(avant, v);
        if (d) await auditer(tr, { tenantId, userId, action: 'COM_UNITE_MODIFICATION', id: avant.id, ...d });
        return Number(avant.id);
      }
      const [r] = await Q('INSERT INTO com_unites (tenant_id, code, libelle, decimales, actif, cree_par) VALUES (:t, :code, :libelle, :decimales, :actif, :u) RETURNING id',
        { ...v, t: tenantId, u: userId }, tr);
      await auditer(tr, { tenantId, userId, action: 'COM_UNITE_CREATION', id: r.id, apres: v });
      return Number(r.id);
    });
    return (await listerUnites(tenantId)).find((u) => u.id === uid);
  } catch (err) { return unicite(err, 'Ce code d\'unité existe déjà.'); }
};

// Unité par son id (contrôlée) ou par son code (anciens écrans : `unite: 'rame'`), créée au besoin.
const uniteDe = async (tenantId, userId, { id, code }, tr) => {
  if (id !== undefined && id !== null && id !== '') {
    const [u] = await Q('SELECT id, code, decimales, actif FROM com_unites WHERE id = :id AND tenant_id = :t', { id: entier(id, 'Unité'), t: tenantId }, tr);
    if (!u) throw new ErreurCom(400, 'Unité inconnue.');
    return { ...u, id: Number(u.id), decimales: Number(u.decimales) };
  }
  const c = longueur(code || 'unité', 20, 'Unité') || 'unité';
  let [u] = await Q('SELECT id, code, decimales, actif FROM com_unites WHERE tenant_id = :t AND lower(code) = lower(:c)', { t: tenantId, c }, tr);
  if (!u) {
    [u] = await Q('INSERT INTO com_unites (tenant_id, code, libelle, cree_par) VALUES (:t, :c, :c, :u) RETURNING id, code, decimales, actif', { t: tenantId, c, u: userId }, tr);
    await auditer(tr, { tenantId, userId, action: 'COM_UNITE_CREATION', id: u.id, apres: { code: c, automatique: true } });
  }
  return { ...u, id: Number(u.id), decimales: Number(u.decimales) };
};
const coefficient = (v, nom) => {
  const n = nombre(v, nom, { vide: null });
  if (n === null || !(n > 0) || n > 1e9) throw new ErreurCom(400, `${nom} : un nombre positif (combien d'unités de stock vaut une unité).`);
  return Math.round(n * 1e6) / 1e6;
};

// Unités proposées par une famille : stock, puis achat et vente avec leur coefficient
// vers l'unité de stock (1 quand c'est la même unité). Tout est facultatif.
const unitesFamille = async (tenantId, b, tr) => {
  const vide = (x) => x === undefined || x === null || x === '';
  const id = async (x) => (vide(x) ? null : (await uniteDe(tenantId, null, { id: x }, tr)).id);
  const stock = await id(b.unite_stock_id);
  const achat = await id(b.unite_achat_id);
  const vente = await id(b.unite_vente_id);
  if ((achat || vente) && !stock) throw new ErreurCom(400, 'Choisissez d\'abord l\'unité de stock de la famille.');
  const coef = (u, c, nom) => (!u ? null : u === stock ? 1 : coefficient(c, nom));
  return { unite_stock_id: stock, unite_achat_id: achat, coef_achat: coef(achat, b.coef_achat, 'Conversion de l\'unité d\'achat'),
    unite_vente_id: vente, coef_vente: coef(vente, b.coef_vente, 'Conversion de l\'unité de vente') };
};

// ── Familles d'articles (+ fournisseurs associés) ────────────────────────
const listerFamilles = async (tenantId, { q = '', actifs = '' } = {}) => {
  exigerClient(tenantId);
  const rows = await Q(
    `SELECT f.*, ta.code AS taxe_achat_code, ta.taux AS taxe_achat_taux, tv.code AS taxe_vente_code, tv.taux AS taxe_vente_taux,
            us.code AS unite_stock_code, ua.code AS unite_achat_code, uv.code AS unite_vente_code,
            COALESCE((SELECT json_agg(json_build_object('id', r.id, 'nom', r.nom, 'actif', r.actif) ORDER BY lower(r.nom))
                        FROM com_famille_fournisseurs ff JOIN registre_tiers r ON r.id = ff.tiers_id
                       WHERE ff.famille_id = f.id), '[]') AS fournisseurs,
            (SELECT COUNT(*)::int FROM com_articles a WHERE a.famille_id = f.id) AS nb_articles
       FROM com_familles f
       LEFT JOIN com_taxes ta ON ta.id = f.taxe_achat_id LEFT JOIN com_taxes tv ON tv.id = f.taxe_vente_id
       LEFT JOIN com_unites us ON us.id = f.unite_stock_id LEFT JOIN com_unites ua ON ua.id = f.unite_achat_id LEFT JOIN com_unites uv ON uv.id = f.unite_vente_id
      WHERE f.tenant_id = :t AND (:actifs <> '1' OR f.actif)
        AND (:q = '' OR lower(f.code) LIKE :like OR lower(f.nom) LIKE :like)
      ORDER BY f.actif DESC, upper(f.code)`,
    { t: tenantId, actifs: String(actifs), q: txt(q), like: `%${txt(q).toLowerCase()}%` });
  return rows.map((r) => ({
    ...r, id: Number(r.id), taxe_achat_id: r.taxe_achat_id ? Number(r.taxe_achat_id) : null, taxe_vente_id: r.taxe_vente_id ? Number(r.taxe_vente_id) : null,
    taxe_achat_taux: r.taxe_achat_taux === null ? null : Number(r.taxe_achat_taux), taxe_vente_taux: r.taxe_vente_taux === null ? null : Number(r.taxe_vente_taux),
    unite_stock_id: r.unite_stock_id ? Number(r.unite_stock_id) : null, unite_achat_id: r.unite_achat_id ? Number(r.unite_achat_id) : null,
    unite_vente_id: r.unite_vente_id ? Number(r.unite_vente_id) : null,
    coef_achat: r.coef_achat === null ? null : Number(r.coef_achat), coef_vente: r.coef_vente === null ? null : Number(r.coef_vente),
    fournisseurs: r.fournisseurs.map((f) => ({ ...f, id: Number(f.id) })),
  }));
};

// Vérifie que des tiers existent pour ce client et peuvent fournir (fournisseur ou mixte).
const verifierFournisseurs = async (tenantId, liste, tr) => {
  if (!liste.length) return;
  const rows = await Q(
    `SELECT id FROM registre_tiers WHERE tenant_id = :t AND id IN (:ids) AND type IN ('fournisseur', 'mixte')`,
    { t: tenantId, ids: liste }, tr);
  if (rows.length !== liste.length) throw new ErreurCom(400, 'Un des fournisseurs choisis est inconnu ou n\'est pas un fournisseur.');
};

const enregistrerFamille = async ({ tenantId, userId, id, body }) => {
  exigerClient(tenantId);
  try {
    const fid = await sequelize.transaction(async (tr) => {
      let avant = null;
      if (id) {
        [avant] = await Q('SELECT * FROM com_familles WHERE id = :id AND tenant_id = :t FOR UPDATE', { id: entier(id, 'Famille'), t: tenantId }, tr);
        if (!avant) throw new ErreurCom(404, 'Famille introuvable.');
      }
      const b = { ...(avant || {}), ...body };
      const code = txt(b.code).toUpperCase();
      if (!CODE_RE.test(code)) throw new ErreurCom(400, 'Code de la famille : 1 à 20 lettres, chiffres, point, tiret ou souligné.');
      const nom = longueur(b.nom, 120, 'Nom de la famille');
      if (!nom) throw new ErreurCom(400, 'Le nom de la famille est obligatoire.');
      const suivi = booleen(b.suivi_stock, true);
      // 062 : l'unité de stock est l'unité de référence de la famille (obligatoire) ;
      // achat et vente valent l'unité de stock tant qu'on n'en choisit pas une autre.
      const unitesF = await unitesFamille(tenantId, b, tr);
      if (!unitesF.unite_stock_id) throw new ErreurCom(400, 'L\'unité de stock de la famille est obligatoire.');
      if (!unitesF.unite_achat_id) { unitesF.unite_achat_id = unitesF.unite_stock_id; unitesF.coef_achat = 1; }
      if (!unitesF.unite_vente_id) { unitesF.unite_vente_id = unitesF.unite_stock_id; unitesF.coef_vente = 1; }
      const v = {
        code, nom, description: longueur(b.description, 1000, 'Description'), actif: b.actif === undefined ? true : Boolean(b.actif),
        // 062 : plus de taxe sur la famille ; elle se choisit à la saisie de chaque opération.
        taxe_achat_id: null, taxe_vente_id: null,
        suivi_stock: suivi, methode_valorisation: methode(b.methode_valorisation),
        ...unitesF,
      };
      let famId;
      if (avant) {
        famId = Number(avant.id);
        // Les articles existants gardent leurs paramètres : la famille ne fait que proposer.
        await X(`UPDATE com_familles SET code = :code, nom = :nom, description = :description, actif = :actif, taxe_achat_id = :taxe_achat_id,
                   taxe_vente_id = :taxe_vente_id, suivi_stock = :suivi_stock, methode_valorisation = :methode_valorisation,
                   unite_stock_id = :unite_stock_id, unite_achat_id = :unite_achat_id, coef_achat = :coef_achat,
                   unite_vente_id = :unite_vente_id, coef_vente = :coef_vente, modifie_le = NOW() WHERE id = :id`,
        { ...v, id: famId }, tr);
        for (const k of ['taxe_achat_id', 'taxe_vente_id', 'unite_stock_id', 'unite_achat_id', 'unite_vente_id']) avant[k] = avant[k] ? Number(avant[k]) : null;
        for (const k of ['coef_achat', 'coef_vente']) avant[k] = avant[k] === null ? null : Number(avant[k]);
      } else {
        const [r] = await Q(`INSERT INTO com_familles (tenant_id, code, nom, description, actif, taxe_achat_id, taxe_vente_id, suivi_stock, methode_valorisation,
                               unite_stock_id, unite_achat_id, coef_achat, unite_vente_id, coef_vente, cree_par)
                             VALUES (:t, :code, :nom, :description, :actif, :taxe_achat_id, :taxe_vente_id, :suivi_stock, :methode_valorisation,
                               :unite_stock_id, :unite_achat_id, :coef_achat, :unite_vente_id, :coef_vente, :u) RETURNING id`,
        { ...v, t: tenantId, u: userId }, tr);
        famId = Number(r.id);
      }
      let fournisseurs = null;
      if (body.fournisseur_ids !== undefined) {
        fournisseurs = ids(body.fournisseur_ids, 'Fournisseur');
        await verifierFournisseurs(tenantId, fournisseurs, tr);
        await X('DELETE FROM com_famille_fournisseurs WHERE famille_id = :f', { f: famId }, tr);
        for (const tid of fournisseurs) {
          await X('INSERT INTO com_famille_fournisseurs (famille_id, tiers_id, tenant_id) VALUES (:f, :tid, :t)', { f: famId, tid, t: tenantId }, tr);
        }
      }
      const d = avant ? differences(avant, v) : { avant: null, apres: v };
      if (d || fournisseurs) {
        await auditer(tr, { tenantId, userId, action: avant ? 'COM_FAMILLE_MODIFICATION' : 'COM_FAMILLE_CREATION', id: famId,
          avant: d?.avant, apres: { ...(d?.apres || {}), ...(fournisseurs ? { fournisseurs } : {}) } });
      }
      return famId;
    });
    return (await listerFamilles(tenantId)).find((f) => f.id === fid);
  } catch (err) { return unicite(err, 'Ce code de famille existe déjà.'); }
};

// ── Taxes ────────────────────────────────────────────────────────────────
const TYPES_TAXE = { tva: 'TVA', precompte: 'Précompte / retenue', autre: 'Autre' };
const USAGES_TAXE = { achat: 'Achats', vente: 'Ventes', les_deux: 'Achats et ventes' };
const listerTaxes = async (tenantId, { actifs = '' } = {}) => {
  exigerClient(tenantId);
  // 062 : une taxe ne s'attache plus aux articles ; on compte les lignes de documents qui l'appliquent.
  const tables = (await Q(`SELECT t FROM unnest(ARRAY['com_bc_lignes', 'com_facture_fourn_lignes', 'com_devis_lignes', 'com_commande_client_lignes']) t
                             WHERE to_regclass('public.' || t) IS NOT NULL`, {})).map((r) => r.t);
  const compte = tables.length ? tables.map((t) => `(SELECT COUNT(*) FROM ${t} l WHERE l.taxe_id = x.id)`).join(' + ') : '0';
  const rows = await Q(
    `SELECT x.*, (${compte})::int AS nb_utilisations
       FROM com_taxes x WHERE x.tenant_id = :t AND (:actifs <> '1' OR x.actif) ORDER BY x.actif DESC, upper(x.code)`,
    { t: tenantId, actifs: String(actifs) });
  return rows.map((r) => ({ ...r, id: Number(r.id), taux: Number(r.taux), type_libelle: TYPES_TAXE[r.type], usage_libelle: USAGES_TAXE[r.usage] }));
};

const dateOuNull = (v, nom) => {
  const s = txt(v);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new ErreurCom(400, `${nom} invalide (AAAA-MM-JJ).`);
  return s;
};

const enregistrerTaxe = async ({ tenantId, userId, id, body }) => {
  exigerClient(tenantId);
  try {
    const xid = await sequelize.transaction(async (tr) => {
      let avant = null;
      if (id) {
        [avant] = await Q('SELECT * FROM com_taxes WHERE id = :id AND tenant_id = :t FOR UPDATE', { id: entier(id, 'Taxe'), t: tenantId }, tr);
        if (!avant) throw new ErreurCom(404, 'Taxe introuvable.');
        avant = { ...avant, taux: Number(avant.taux) };
      }
      const b = { ...(avant || {}), ...body };
      const code = txt(b.code).toUpperCase();
      if (!CODE_RE.test(code)) throw new ErreurCom(400, 'Code de la taxe : 1 à 20 lettres, chiffres, point, tiret ou souligné.');
      const intitule = longueur(b.intitule, 120, 'Intitulé');
      if (!intitule) throw new ErreurCom(400, 'L\'intitulé de la taxe est obligatoire.');
      const taux = nombre(b.taux, 'Taux', { max: 100 });
      if (taux === null) throw new ErreurCom(400, 'Le taux est obligatoire (0 à 100 %).');
      if (!TYPES_TAXE[b.type || 'tva']) throw new ErreurCom(400, 'Type de taxe inconnu.');
      const v = {
        code, intitule, taux, type: b.type || 'tva', description: longueur(b.description, 1000, 'Description'),
        debut: dateOuNull(b.debut, 'Date de début'), fin: dateOuNull(b.fin, 'Date de fin'), actif: b.actif === undefined ? true : Boolean(b.actif),
        usage: b.usage || 'les_deux',
      };
      if (!USAGES_TAXE[v.usage]) throw new ErreurCom(400, 'Usage de la taxe inconnu (achats, ventes ou les deux).');
      // 062 : la taxe n'est plus portée par les fiches ; changer son usage ne vaut que pour
      // les saisies à venir (les documents enregistrés gardent la taxe copiée).
      if (v.debut && v.fin && v.fin < v.debut) throw new ErreurCom(400, 'La fin de validité précède le début.');
      // Un taux déjà repris dans un document ne change jamais : on crée une nouvelle taxe datée.
      if (avant && Number(avant.taux) !== taux && await tauxUtilise(Number(avant.id), tr)) {
        throw new ErreurCom(409, 'Ce taux figure déjà dans des documents d\'achat ou de vente : désactivez cette taxe et créez-en une nouvelle avec sa date de début.');
      }
      if (avant) {
        await X(`UPDATE com_taxes SET code = :code, intitule = :intitule, taux = :taux, type = :type, description = :description,
                   debut = :debut, fin = :fin, actif = :actif, usage = :usage, modifie_le = NOW() WHERE id = :id`, { ...v, id: Number(avant.id) }, tr);
        const d = differences({ ...avant, debut: avant.debut ? String(avant.debut).slice(0, 10) : null, fin: avant.fin ? String(avant.fin).slice(0, 10) : null }, v);
        if (d) await auditer(tr, { tenantId, userId, action: 'COM_TAXE_MODIFICATION', id: avant.id, ...d });
        return Number(avant.id);
      }
      const [r] = await Q(`INSERT INTO com_taxes (tenant_id, code, intitule, taux, type, description, debut, fin, actif, usage, cree_par)
                           VALUES (:t, :code, :intitule, :taux, :type, :description, :debut, :fin, :actif, :usage, :u) RETURNING id`,
      { ...v, t: tenantId, u: userId }, tr);
      await auditer(tr, { tenantId, userId, action: 'COM_TAXE_CREATION', id: r.id, apres: v });
      return Number(r.id);
    });
    return (await listerTaxes(tenantId)).find((x) => x.id === xid);
  } catch (err) { return unicite(err, 'Ce code de taxe existe déjà.'); }
};

// Les documents d'achat et de vente copient le taux ; tant qu'aucun ne l'applique, rien n'est figé.
const tauxUtilise = async (taxeId, tr) => {
  const tables = (await Q(`SELECT t FROM unnest(ARRAY['com_bc_lignes', 'com_facture_fourn_lignes', 'com_devis_lignes', 'com_commande_client_lignes']) t
                             WHERE to_regclass('public.' || t) IS NOT NULL`, {}, tr)).map((r) => r.t);
  if (!tables.length) return false;
  const [u] = await Q(tables.map((t) => `SELECT 1 FROM ${t} WHERE taxe_id = :id`).join(' UNION ALL ') + ' LIMIT 1', { id: taxeId }, tr);
  return Boolean(u);
};

// ── Fournisseurs et clients (registre des tiers + extension achats) ──────
const CHAMPS_TIERS = {
  code: (v) => { const s = txt(v).toUpperCase(); if (s && !CODE_RE.test(s)) throw new ErreurCom(400, 'Code du tiers : 1 à 20 lettres, chiffres, point, tiret ou souligné.'); return s; },
  nom_commercial: (v) => longueur(v, 150, 'Nom commercial'),
  ville: (v) => longueur(v, 80, 'Ville'),
  pays: (v) => longueur(v, 80, 'Pays'),
  contact_nom: (v) => longueur(v, 120, 'Contact'),
  contact_telephone: (v) => longueur(v, 40, 'Téléphone du contact'),
  contact_email: (v) => { const s = longueur(v, 150, 'E-mail du contact'); if (s && !EMAIL_RE.test(s)) throw new ErreurCom(400, 'E-mail du contact invalide.'); return s; },
  conditions_paiement: (v) => longueur(v, 300, 'Conditions de paiement'),
  // 063 : délai habituel de livraison (évaluation des offres, suivi des commandes).
  delai_livraison_jours: (v) => {
    if (v === undefined || v === null || txt(v) === '') return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 365) throw new ErreurCom(400, 'Délai de livraison : un nombre entier de jours, de 0 à 365.');
    return n;
  },
  delai_type: (v) => { const s = txt(v) || 'calendaires'; if (!['calendaires', 'ouvres'].includes(s)) throw new ErreurCom(400, 'Délai : jours calendaires ou jours ouvrés.'); return s; },
};

const listerTiers = async (tenantId, { type = '', q = '', actifs = '', avecBanque = false } = {}) => {
  exigerClient(tenantId);
  if (type && !['fournisseur', 'client'].includes(type)) throw new ErreurCom(400, 'Type de tiers inconnu.');
  const rows = await Q(
    `SELECT r.id, r.type, r.nom, r.nui, r.rccm, r.telephone, r.email, r.adresse, r.notes, r.actif, r.compte_tiers,
            COALESCE(c.code, '') AS code, COALESCE(c.nom_commercial, '') AS nom_commercial, COALESCE(c.ville, '') AS ville,
            COALESCE(c.pays, '') AS pays, COALESCE(c.contact_nom, '') AS contact_nom,
            COALESCE(c.contact_telephone, '') AS contact_telephone, COALESCE(c.contact_email, '') AS contact_email,
            COALESCE(c.conditions_paiement, '') AS conditions_paiement,
            c.delai_livraison_jours, COALESCE(c.delai_type, 'calendaires') AS delai_type,
            COALESCE((SELECT json_agg(json_build_object('id', f.id, 'code', f.code, 'nom', f.nom) ORDER BY upper(f.code))
                        FROM com_famille_fournisseurs ff JOIN com_familles f ON f.id = ff.famille_id
                       WHERE ff.tiers_id = r.id), '[]') AS familles,
            (b.tiers_id IS NOT NULL AND b.rib_iban <> '') AS a_banque
            ${avecBanque ? ', b.banque, b.titulaire, b.rib_iban, b.swift' : ''}
       FROM registre_tiers r
       LEFT JOIN com_tiers c ON c.tiers_id = r.id
       LEFT JOIN com_tiers_banque b ON b.tiers_id = r.id
      WHERE r.tenant_id = :t
        AND (:type = '' OR r.type = :type OR r.type = 'mixte')
        AND (:actifs <> '1' OR r.actif)
        AND (:q = '' OR lower(r.nom) LIKE :like OR lower(r.nui) LIKE :like OR lower(COALESCE(c.code, '')) LIKE :like
             OR lower(COALESCE(c.nom_commercial, '')) LIKE :like)
      ORDER BY r.actif DESC, lower(r.nom)`,
    { t: tenantId, type, actifs: String(actifs), q: txt(q), like: `%${txt(q).toLowerCase()}%` });
  return rows.map((r) => ({ ...r, id: Number(r.id), familles: r.familles.map((f) => ({ ...f, id: Number(f.id) })) }));
};

const enregistrerTiers = async ({ tenantId, userId, id, body, peutBanque }) => {
  exigerClient(tenantId);
  if (body.banque !== undefined && !peutBanque) throw new ErreurCom(403, 'Les coordonnées bancaires demandent une permission dédiée.');
  let tid = id ? entier(id, 'Tiers') : null;
  // Validation des champs achats AVANT de toucher à l'identité du registre.
  for (const [k, f] of Object.entries(CHAMPS_TIERS)) if (body[k] !== undefined) f(body[k]);
  try {
    // Identité : règles du registre existant (NUI, doublons, compte tiers).
    if (tid) {
      const [r] = await Q('SELECT id FROM registre_tiers WHERE id = :id AND tenant_id = :t', { id: tid, t: tenantId });
      if (!r) throw new ErreurCom(404, 'Tiers introuvable.');
      const identite = {};
      for (const k of ['type', 'nom', 'nui', 'rccm', 'telephone', 'email', 'adresse', 'notes', 'actif']) if (body[k] !== undefined) identite[k] = body[k];
      if (Object.keys(identite).length) await registre.modifier({ tenantId, userId, id: tid, body: identite });
    }
    await sequelize.transaction(async (tr) => {
      if (!tid) {
        tid = await registre.creerDans(tr, { tenantId, userId, body: { ...body, type: body.type || 'fournisseur', compte_tiers: body.compte_tiers || '' } });
      }
      const [avant] = await Q('SELECT * FROM com_tiers WHERE tiers_id = :id FOR UPDATE', { id: tid }, tr);
      const v = {};
      for (const [k, f] of Object.entries(CHAMPS_TIERS)) v[k] = f(body[k] === undefined ? (avant?.[k] ?? '') : body[k]);
      if (avant) {
        await X(`UPDATE com_tiers SET ${Object.keys(CHAMPS_TIERS).map((k) => `${k} = :${k}`).join(', ')}, modifie_par = :u, modifie_le = NOW()
                  WHERE tiers_id = :id`, { ...v, u: userId, id: tid }, tr);
      } else {
        await X(`INSERT INTO com_tiers (tiers_id, tenant_id, ${Object.keys(CHAMPS_TIERS).join(', ')}, modifie_par)
                 VALUES (:id, :t, ${Object.keys(CHAMPS_TIERS).map((k) => `:${k}`).join(', ')}, :u)`, { ...v, id: tid, t: tenantId, u: userId }, tr);
      }
      const d = differences(avant || {}, v);
      if (d) await auditer(tr, { tenantId, userId, action: 'COM_TIERS_FICHE', id: tid, ...d });
      if (body.famille_ids !== undefined) {
        const fam = ids(body.famille_ids, 'Famille');
        if (fam.length) {
          const ok = await Q('SELECT id FROM com_familles WHERE tenant_id = :t AND id IN (:ids)', { t: tenantId, ids: fam }, tr);
          if (ok.length !== fam.length) throw new ErreurCom(400, 'Une des familles choisies est inconnue.');
          const [r] = await Q('SELECT type FROM registre_tiers WHERE id = :id', { id: tid }, tr);
          if (r.type === 'client') throw new ErreurCom(400, 'Un client ne peut pas être associé à une famille d\'articles : passez-le en « fournisseur » ou « client et fournisseur ».');
        }
        await X('DELETE FROM com_famille_fournisseurs WHERE tiers_id = :id', { id: tid }, tr);
        for (const f of fam) await X('INSERT INTO com_famille_fournisseurs (famille_id, tiers_id, tenant_id) VALUES (:f, :id, :t)', { f, id: tid, t: tenantId }, tr);
        await auditer(tr, { tenantId, userId, action: 'COM_TIERS_FAMILLES', id: tid, apres: { familles: fam } });
      }
      if (body.banque !== undefined) await enregistrerBanque(tr, { tenantId, userId, tid, b: body.banque || {} });
    });
  } catch (err) {
    if (err instanceof registre.ErreurRegistre) throw new ErreurCom(err.status, err.message);
    return unicite(err, 'Ce code de tiers existe déjà.');
  }
  return (await listerTiers(tenantId, { avecBanque: peutBanque })).find((t) => t.id === tid);
};

const enregistrerBanque = async (tr, { tenantId, userId, tid, b }) => {
  const v = {
    banque: longueur(b.banque, 120, 'Banque'), titulaire: longueur(b.titulaire, 150, 'Titulaire du compte'),
    rib_iban: longueur(String(b.rib_iban ?? '').replace(/\s+/g, ' '), 60, 'RIB / IBAN'), swift: longueur(String(b.swift ?? '').toUpperCase(), 20, 'Code SWIFT'),
  };
  await X(`INSERT INTO com_tiers_banque (tiers_id, tenant_id, banque, titulaire, rib_iban, swift, modifie_par)
           VALUES (:id, :t, :banque, :titulaire, :rib_iban, :swift, :u)
           ON CONFLICT (tiers_id) DO UPDATE SET banque = EXCLUDED.banque, titulaire = EXCLUDED.titulaire, rib_iban = EXCLUDED.rib_iban,
                                               swift = EXCLUDED.swift, modifie_par = EXCLUDED.modifie_par, modifie_le = NOW()`,
  { ...v, id: tid, t: tenantId, u: userId }, tr);
  // Trace sans recopier le numéro de compte : seuls ses 4 derniers caractères.
  await auditer(tr, { tenantId, userId, action: 'COM_TIERS_BANQUE', id: tid,
    apres: { banque: v.banque, titulaire: v.titulaire, rib_fin: v.rib_iban ? `…${v.rib_iban.slice(-4)}` : '' } });
};

// ── Articles ─────────────────────────────────────────────────────────────
const SQL_ARTICLES = `
  SELECT a.*, f.code AS famille_code, f.nom AS famille_nom, x.code AS taxe_code, x.taux AS taxe_taux,
         xv.code AS taxe_vente_code, xv.taux AS taxe_vente_taux,
         us.code AS unite_stock_code, us.decimales AS unite_stock_decimales, ua.code AS unite_achat_code, uv.code AS unite_vente_code,
         COALESCE((SELECT json_agg(json_build_object('id', u.id, 'code', u.code, 'libelle', u.libelle, 'decimales', u.decimales, 'coefficient', au.coefficient)
                                   ORDER BY au.coefficient, lower(u.code))
                     FROM com_article_unites au JOIN com_unites u ON u.id = au.unite_id WHERE au.article_id = a.id), '[]') AS unites,
         COALESCE((SELECT json_agg(json_build_object('id', r.id, 'nom', r.nom) ORDER BY lower(r.nom))
                     FROM com_article_fournisseurs af JOIN registre_tiers r ON r.id = af.tiers_id
                    WHERE af.article_id = a.id), '[]') AS fournisseurs_directs,
         COALESCE((SELECT json_agg(json_build_object('id', r.id, 'nom', r.nom) ORDER BY lower(r.nom))
                     FROM com_famille_fournisseurs ff JOIN registre_tiers r ON r.id = ff.tiers_id
                    WHERE ff.famille_id = a.famille_id AND r.actif), '[]') AS fournisseurs_famille,
         COALESCE((SELECT json_agg(json_build_object('id', m.id, 'code', m.code, 'nom', m.nom) ORDER BY upper(m.code))
                     FROM com_article_magasins am JOIN com_magasins m ON m.id = am.magasin_id
                    WHERE am.article_id = a.id), '[]') AS magasins
    FROM com_articles a
    JOIN com_familles f ON f.id = a.famille_id
    LEFT JOIN com_taxes x ON x.id = a.taxe_id
    LEFT JOIN com_taxes xv ON xv.id = a.taxe_vente_id
    JOIN com_unites us ON us.id = a.unite_stock_id
    JOIN com_unites ua ON ua.id = a.unite_achat_id
    JOIN com_unites uv ON uv.id = a.unite_vente_id`;

const formaterArticle = (r) => ({
  ...r, id: Number(r.id), famille_id: Number(r.famille_id), taxe_id: r.taxe_id ? Number(r.taxe_id) : null,
  prix_achat_indicatif: r.prix_achat_indicatif === null ? null : Number(r.prix_achat_indicatif),
  seuil_alerte: r.seuil_alerte === null ? null : Number(r.seuil_alerte),
  poids_kg: r.poids_kg === null || r.poids_kg === undefined ? null : Number(r.poids_kg),
  taxe_taux: r.taxe_taux === null || r.taxe_taux === undefined ? null : Number(r.taxe_taux),
  taxe_vente_id: r.taxe_vente_id ? Number(r.taxe_vente_id) : null,
  unite_stock_id: Number(r.unite_stock_id), unite_achat_id: Number(r.unite_achat_id), unite_vente_id: Number(r.unite_vente_id),
  unite_stock_decimales: Number(r.unite_stock_decimales),
  unites: r.unites.map((u) => ({ ...u, id: Number(u.id), decimales: Number(u.decimales), coefficient: Number(u.coefficient) })),
  coef_achat: Number(r.unites.find((u) => Number(u.id) === Number(r.unite_achat_id))?.coefficient ?? 1),
  coef_vente: Number(r.unites.find((u) => Number(u.id) === Number(r.unite_vente_id))?.coefficient ?? 1),
  prix_vente_indicatif: r.prix_vente_indicatif === null || r.prix_vente_indicatif === undefined ? null : Number(r.prix_vente_indicatif),
  taxe_vente_taux: r.taxe_vente_taux === null || r.taxe_vente_taux === undefined ? null : Number(r.taxe_vente_taux),
  fournisseurs_directs: r.fournisseurs_directs.map((x) => ({ ...x, id: Number(x.id) })),
  fournisseurs_famille: r.fournisseurs_famille.map((x) => ({ ...x, id: Number(x.id) })),
  magasins: r.magasins.map((x) => ({ ...x, id: Number(x.id) })),
});

const listerArticles = async (tenantId, { q = '', famille_id = '', fournisseur_id = '', actifs = '', suivi = '' } = {}) => {
  exigerClient(tenantId);
  const rows = await Q(
    `${SQL_ARTICLES}
      WHERE a.tenant_id = :t AND (:actifs <> '1' OR a.actif)
        AND (:fam = 0 OR a.famille_id = :fam)
        AND (:suivi = '' OR a.suivi_comptable = (:suivi = '1'))
        AND (:fou = 0 OR EXISTS (SELECT 1 FROM com_article_fournisseurs af WHERE af.article_id = a.id AND af.tiers_id = :fou)
                      OR EXISTS (SELECT 1 FROM com_famille_fournisseurs ff WHERE ff.famille_id = a.famille_id AND ff.tiers_id = :fou))
        AND (:q = '' OR lower(a.reference) LIKE :like OR lower(a.designation) LIKE :like OR lower(f.nom) LIKE :like OR lower(f.code) LIKE :like)
      ORDER BY a.actif DESC, upper(a.reference)`,
    { t: tenantId, actifs: String(actifs), fam: Number.parseInt(famille_id, 10) || 0, fou: Number.parseInt(fournisseur_id, 10) || 0,
      suivi: ['0', '1'].includes(String(suivi)) ? String(suivi) : '', q: txt(q), like: `%${txt(q).toLowerCase()}%` });
  return rows.map(formaterArticle);
};

const lireArticle = async (tenantId, id) => {
  exigerClient(tenantId);
  const [r] = await Q(`${SQL_ARTICLES} WHERE a.tenant_id = :t AND a.id = :id`, { t: tenantId, id: entier(id, 'Article') });
  if (!r) throw new ErreurCom(404, 'Article introuvable.');
  const a = formaterArticle(r);
  a.stock = await stockArticle(tenantId, a.id);
  a.utilise = await articleUtilise(a.id);
  return a;
};

// Un article est « utilisé » dès qu'un mouvement ou un document le référence.
const articleUtilise = async (articleId, tr) => {
  const [s] = await Q('SELECT 1 FROM com_stock_mouvements WHERE article_id = :id LIMIT 1', { id: articleId }, tr);
  if (s) return true;
  for (const table of ['com_demande_lignes', 'com_bc_lignes']) {
    const [t] = await Q(`SELECT to_regclass('public.${table}') IS NOT NULL AS ok`, {}, tr);
    if (t.ok) {
      const [u] = await Q(`SELECT 1 FROM ${table} WHERE article_id = :id LIMIT 1`, { id: articleId }, tr);
      if (u) return true;
    }
  }
  return false;
};

const enregistrerArticle = async ({ tenantId, userId, id, body }) => {
  exigerClient(tenantId);
  try {
    const aid = await sequelize.transaction(async (tr) => {
      let avant = null;
      if (id) {
        [avant] = await Q('SELECT * FROM com_articles WHERE id = :id AND tenant_id = :t FOR UPDATE', { id: entier(id, 'Article'), t: tenantId }, tr);
        if (!avant) throw new ErreurCom(404, 'Article introuvable.');
      }
      const b = { ...(avant || {}), ...body };
      const reference = txt(b.reference).toUpperCase();
      if (!REF_RE.test(reference)) throw new ErreurCom(400, 'Référence : 1 à 30 lettres, chiffres, point, tiret, barre ou souligné.');
      const designation = longueur(b.designation, 200, 'Désignation');
      if (!designation) throw new ErreurCom(400, 'La désignation est obligatoire.');
      if (b.famille_id === undefined || b.famille_id === null || b.famille_id === '') throw new ErreurCom(400, 'La famille d\'articles est obligatoire.');
      const familleId = entier(b.famille_id, 'Famille');
      const [fam] = await Q('SELECT * FROM com_familles WHERE id = :id AND tenant_id = :t', { id: familleId, t: tenantId }, tr);
      if (!fam) throw new ErreurCom(400, 'Famille inconnue.');
      if (!fam.actif && Number(avant?.famille_id) !== familleId) throw new ErreurCom(400, 'Cette famille est désactivée.');
      if (b.suivi_comptable === undefined || b.suivi_comptable === null || b.suivi_comptable === '') {
        throw new ErreurCom(400, 'Indiquez si l\'article est suivi en comptabilité (oui / non).');
      }
      // Création : ce que l'écran n'envoie pas est repris de la famille (054) ; ensuite,
      // chaque article garde ses propres paramètres (modifier la famille ne le touche plus).
      if (!avant) {
        if (body.unite_stock_id === undefined && body.unite === undefined && fam.unite_stock_id) {
          b.unite_stock_id = fam.unite_stock_id;
          if (body.unite_achat_id === undefined && fam.unite_achat_id) { b.unite_achat_id = fam.unite_achat_id; b.coef_achat = fam.coef_achat; }
          if (body.unite_vente_id === undefined && fam.unite_vente_id) { b.unite_vente_id = fam.unite_vente_id; b.coef_vente = fam.coef_vente; }
        }
        if (body.suivi_stock === undefined) b.suivi_stock = fam.suivi_stock;
        if (body.methode_valorisation === undefined) b.methode_valorisation = fam.methode_valorisation;
      }
      const suiviStock = booleen(b.suivi_stock, true);
      const methodeV = methode(b.methode_valorisation);
      if (avant) {
        const [mv] = await Q('SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE type <> \'stock_initial\')::int AS autres FROM com_stock_mouvements WHERE article_id = :a', { a: avant.id }, tr);
        if (avant.suivi_stock && !suiviStock && mv.n) throw new ErreurCom(409, 'Cet article a déjà du stock enregistré : il reste suivi en stock.');
        // Jusqu'au moteur de stock (lot 4), seul le stock d'ouverture existe, sans coût :
        // la méthode peut encore changer. Après, elle ne changera que par inventaire de bascule.
        if (avant.methode_valorisation !== methodeV && mv.autres) throw new ErreurCom(409, 'Des mouvements valorisés existent : la méthode ne se change que par un inventaire de bascule.');
      }
      // Unités (055) : stock, achat et vente, avec leur coefficient vers l'unité de stock.
      const coefsAvant = avant ? Object.fromEntries((await Q('SELECT unite_id, coefficient FROM com_article_unites WHERE article_id = :a', { a: avant.id }, tr))
        .map((r) => [Number(r.unite_id), Number(r.coefficient)])) : {};
      const parCode = body.unite_stock_id === undefined && body.unite !== undefined;
      const uStock = await uniteDe(tenantId, userId, parCode ? { code: body.unite } : { id: b.unite_stock_id, code: b.unite }, tr);
      if (avant && Number(avant.unite_stock_id) !== uStock.id && await articleUtilise(Number(avant.id), tr)) {
        throw new ErreurCom(409, 'Cet article a déjà un stock ou figure dans des documents : son unité de stock ne change plus.');
      }
      const uniteEtCoef = async (champ, champCoef, nom) => {
        const vid = b[champ] === undefined || b[champ] === null || b[champ] === '' || parCode ? uStock.id : (await uniteDe(tenantId, userId, { id: b[champ] }, tr)).id;
        if (vid === uStock.id) return [vid, 1];
        const brut = body[champCoef] !== undefined ? body[champCoef] : (b[champCoef] ?? coefsAvant[vid]);
        return [vid, coefficient(brut, nom)];
      };
      const [uAchat, cAchat] = await uniteEtCoef('unite_achat_id', 'coef_achat', 'Conversion de l\'unité d\'achat');
      const [uVente, cVente] = await uniteEtCoef('unite_vente_id', 'coef_vente', 'Conversion de l\'unité de vente');
      if (uAchat === uVente && cAchat !== cVente) throw new ErreurCom(400, 'Même unité à l\'achat et à la vente : un seul coefficient possible.');
      const v = {
        reference, designation, description: longueur(b.description, 2000, 'Description'), famille_id: familleId,
        unite: uStock.code, unite_stock_id: uStock.id, unite_achat_id: uAchat, unite_vente_id: uVente,
        prix_vente_indicatif: nombre(b.prix_vente_indicatif, 'Prix de vente indicatif', { vide: null }),
        prix_achat_indicatif: nombre(b.prix_achat_indicatif, 'Prix d\'achat indicatif', { vide: null }),
        // 062 : plus de taxe sur l'article ; elle se choisit à la saisie de chaque opération.
        taxe_id: null, taxe_vente_id: null, suivi_stock: suiviStock, methode_valorisation: methodeV,
        seuil_alerte: nombre(b.seuil_alerte, 'Seuil d\'alerte', { vide: null }),
        poids_kg: (() => { const p = nombre(b.poids_kg, 'Poids unitaire', { vide: null }); if (p !== null && !(p > 0)) throw new ErreurCom(400, 'Poids unitaire : un nombre positif (kg).'); return p; })(),
        suivi_comptable: b.suivi_comptable === true || b.suivi_comptable === 'true' || b.suivi_comptable === 1 || b.suivi_comptable === '1',
        actif: b.actif === undefined ? true : Boolean(b.actif),
      };
      let artId;
      if (avant) {
        artId = Number(avant.id);
        await X(`UPDATE com_articles SET reference = :reference, designation = :designation, description = :description, famille_id = :famille_id,
                   unite = :unite, prix_achat_indicatif = :prix_achat_indicatif, taxe_id = :taxe_id, taxe_vente_id = :taxe_vente_id,
                   suivi_stock = :suivi_stock, methode_valorisation = :methode_valorisation, seuil_alerte = :seuil_alerte, poids_kg = :poids_kg,
                   unite_stock_id = :unite_stock_id, unite_achat_id = :unite_achat_id, unite_vente_id = :unite_vente_id, prix_vente_indicatif = :prix_vente_indicatif,
                   suivi_comptable = :suivi_comptable, actif = :actif, modifie_par = :u, modifie_le = NOW() WHERE id = :id`,
        { ...v, u: userId, id: artId }, tr);
        const norm = { ...avant, famille_id: Number(avant.famille_id), taxe_id: avant.taxe_id ? Number(avant.taxe_id) : null,
          taxe_vente_id: avant.taxe_vente_id ? Number(avant.taxe_vente_id) : null,
          unite_stock_id: Number(avant.unite_stock_id), unite_achat_id: Number(avant.unite_achat_id), unite_vente_id: Number(avant.unite_vente_id),
          prix_vente_indicatif: avant.prix_vente_indicatif === null ? null : Number(avant.prix_vente_indicatif),
          prix_achat_indicatif: avant.prix_achat_indicatif === null ? null : Number(avant.prix_achat_indicatif),
          seuil_alerte: avant.seuil_alerte === null ? null : Number(avant.seuil_alerte), poids_kg: avant.poids_kg === null ? null : Number(avant.poids_kg) };
        const d = differences(norm, v);
        if (d) await auditer(tr, { tenantId, userId, action: 'COM_ARTICLE_MODIFICATION', id: artId, ...d });
      } else {
        const [r] = await Q(`INSERT INTO com_articles (tenant_id, reference, designation, description, famille_id, unite, prix_achat_indicatif,
                               taxe_id, taxe_vente_id, suivi_stock, methode_valorisation, seuil_alerte, poids_kg, suivi_comptable, actif, cree_par, modifie_par,
                               unite_stock_id, unite_achat_id, unite_vente_id, prix_vente_indicatif)
                             VALUES (:t, :reference, :designation, :description, :famille_id, :unite, :prix_achat_indicatif,
                               :taxe_id, :taxe_vente_id, :suivi_stock, :methode_valorisation, :seuil_alerte, :poids_kg, :suivi_comptable, :actif, :u, :u,
                               :unite_stock_id, :unite_achat_id, :unite_vente_id, :prix_vente_indicatif) RETURNING id`, { ...v, t: tenantId, u: userId }, tr);
        artId = Number(r.id);
        await auditer(tr, { tenantId, userId, action: 'COM_ARTICLE_CREATION', id: artId, apres: v });
      }
      // Conversions de l'article : l'unité de stock vaut 1 ; achat et vente leur coefficient.
      const conv = new Map([[uStock.id, 1], [uAchat, cAchat], [uVente, cVente]]);
      const avantConv = JSON.stringify(Object.entries(coefsAvant).sort());
      await X('DELETE FROM com_article_unites WHERE article_id = :a', { a: artId }, tr);
      for (const [uid, c] of conv) await X('INSERT INTO com_article_unites (article_id, unite_id, tenant_id, coefficient) VALUES (:a, :u, :t, :c)', { a: artId, u: uid, t: tenantId, c }, tr);
      if (avant && avantConv !== JSON.stringify([...conv].map(([k, c]) => [String(k), c]).sort())) {
        await auditer(tr, { tenantId, userId, action: 'COM_ARTICLE_CONVERSIONS', id: artId, avant: { conversions: coefsAvant }, apres: { conversions: Object.fromEntries(conv) } });
      }
      if (body.fournisseur_ids !== undefined) {
        const f = ids(body.fournisseur_ids, 'Fournisseur');
        await verifierFournisseurs(tenantId, f, tr);
        await X('DELETE FROM com_article_fournisseurs WHERE article_id = :a', { a: artId }, tr);
        for (const tid of f) await X('INSERT INTO com_article_fournisseurs (article_id, tiers_id, tenant_id) VALUES (:a, :tid, :t)', { a: artId, tid, t: tenantId }, tr);
      }
      if (body.magasin_ids !== undefined) {
        const m = ids(body.magasin_ids, 'Magasin');
        if (m.length) {
          const ok = await Q('SELECT id FROM com_magasins WHERE tenant_id = :t AND id IN (:ids)', { t: tenantId, ids: m }, tr);
          if (ok.length !== m.length) throw new ErreurCom(400, 'Un des magasins choisis est inconnu.');
        }
        await X('DELETE FROM com_article_magasins WHERE article_id = :a', { a: artId }, tr);
        for (const mid of m) await X('INSERT INTO com_article_magasins (article_id, magasin_id, tenant_id) VALUES (:a, :m, :t)', { a: artId, m: mid, t: tenantId }, tr);
      }
      return artId;
    });
    return lireArticle(tenantId, aid);
  } catch (err) { return unicite(err, 'Cette référence d\'article existe déjà.'); }
};

const supprimerArticle = async ({ tenantId, userId, id }) => {
  exigerClient(tenantId);
  const aid = entier(id, 'Article');
  return sequelize.transaction(async (tr) => {
    const [a] = await Q('SELECT * FROM com_articles WHERE id = :id AND tenant_id = :t FOR UPDATE', { id: aid, t: tenantId }, tr);
    if (!a) throw new ErreurCom(404, 'Article introuvable.');
    if (await articleUtilise(aid, tr)) {
      throw new ErreurCom(409, 'Cet article a déjà un stock ou figure dans des documents : il ne peut pas être supprimé. Désactivez-le.');
    }
    await X('DELETE FROM com_articles WHERE id = :id', { id: aid }, tr);
    await auditer(tr, { tenantId, userId, action: 'COM_ARTICLE_SUPPRESSION', id: aid,
      avant: { reference: a.reference, designation: a.designation } });
    return { ok: true };
  });
};

// ── Stock ───────────────────────────────────────────────────────────────
// Stock d'un article par magasin, calculé UNIQUEMENT à partir des mouvements.
// suivi = false → aucun mouvement pour ce magasin : l'écran affiche « non suivi ».
const stockArticle = async (tenantId, articleId, magasinId = null) => {
  const rows = await Q(
    `SELECT m.id AS magasin_id, m.code, m.nom, m.actif,
            COUNT(s.id)::int AS nb_mouvements, COALESCE(SUM(s.sens * s.quantite) FILTER (WHERE NOT s.annule), 0) AS quantite,
            MAX(s.date_mouvement)::text AS dernier_mouvement,
            (SELECT json_build_object('quantite', i.quantite, 'date', i.date_mouvement::text, 'cout', i.cout_unitaire)
               FROM com_stock_mouvements i WHERE i.article_id = :a AND i.magasin_id = m.id AND i.type = 'stock_initial' AND NOT i.annule
              ORDER BY i.id LIMIT 1) AS initial
       FROM com_magasins m
       LEFT JOIN com_stock_mouvements s ON s.magasin_id = m.id AND s.article_id = :a
      WHERE m.tenant_id = :t AND (CAST(:m AS BIGINT) IS NULL OR m.id = CAST(:m AS BIGINT))
        AND (m.actif OR s.id IS NOT NULL)
      GROUP BY m.id ORDER BY upper(m.code)`,
    { t: tenantId, a: articleId, m: magasinId });
  return rows.map((r) => ({
    magasin_id: Number(r.magasin_id), code: r.code, nom: r.nom, actif: r.actif,
    suivi: r.nb_mouvements > 0, quantite: r.nb_mouvements > 0 ? Number(r.quantite) : null, dernier_mouvement: r.dernier_mouvement,
    initial: r.initial ? { quantite: Number(r.initial.quantite), date: r.initial.date, cout: r.initial.cout === null ? null : Number(r.initial.cout) } : null,
  }));
};

const consulterStock = async (tenantId, { article_id, magasin_id } = {}) => {
  exigerClient(tenantId);
  const aid = entier(article_id, 'Article');
  const [a] = await Q('SELECT id, reference, designation, unite, seuil_alerte FROM com_articles WHERE id = :id AND tenant_id = :t', { id: aid, t: tenantId });
  if (!a) throw new ErreurCom(404, 'Article introuvable.');
  const magasin = magasin_id ? entier(magasin_id, 'Magasin') : null;
  return { article: { ...a, id: Number(a.id), seuil_alerte: a.seuil_alerte === null ? null : Number(a.seuil_alerte) },
    reservations_gerees: false, magasins: await stockArticle(tenantId, aid, magasin) };
};

// Inventaire d'ouverture : une seule ligne « stock initial » par article et magasin,
// corrigeable tant qu'aucun autre mouvement n'existe (seul type ouvert en phase 1).
const enregistrerStockInitial = async ({ tenantId, userId, body }) => {
  exigerClient(tenantId);
  const aid = entier(body.article_id, 'Article');
  const mid = entier(body.magasin_id, 'Magasin');
  const quantite = nombre(body.quantite, 'Quantité', { vide: null });
  if (quantite === null) throw new ErreurCom(400, 'La quantité est obligatoire.');
  const date = dateOuNull(body.date_mouvement, 'Date de l\'inventaire');
  if (!date) throw new ErreurCom(400, 'La date de l\'inventaire d\'ouverture est obligatoire.');
  if (date > new Date().toISOString().slice(0, 10)) throw new ErreurCom(400, 'La date de l\'inventaire ne peut pas être dans le futur.');
  await sequelize.transaction(async (tr) => {
    const [a] = await Q('SELECT id, reference, suivi_stock FROM com_articles WHERE id = :a AND tenant_id = :t', { a: aid, t: tenantId }, tr);
    if (!a) throw new ErreurCom(404, 'Article introuvable.');
    if (!a.suivi_stock) throw new ErreurCom(400, 'Cet article n\'est pas suivi en stock : aucun stock ne peut lui être saisi.');
    const [m] = await Q('SELECT id, code, actif FROM com_magasins WHERE id = :m AND tenant_id = :t', { m: mid, t: tenantId }, tr);
    if (!m) throw new ErreurCom(404, 'Magasin introuvable.');
    if (!m.actif) throw new ErreurCom(400, 'Ce magasin est désactivé.');
    const moteur = require('./stock.service');
    await moteur.verrouiller(tr, aid);
    // Coût par unité de stock (056) : facultatif ; sans coût, le stock est « à valoriser ».
    const cout = nombre(body.cout_unitaire, 'Coût unitaire', { vide: null });
    const [autre] = await Q(`SELECT 1 FROM com_stock_mouvements WHERE article_id = :a AND magasin_id = :m AND type <> 'stock_initial' LIMIT 1`, { a: aid, m: mid }, tr);
    const [avant] = await Q(`SELECT * FROM com_stock_mouvements WHERE article_id = :a AND magasin_id = :m AND type = 'stock_initial' FOR UPDATE`, { a: aid, m: mid }, tr);
    const v = { quantite, date_mouvement: date, piece: longueur(body.piece, 60, 'Pièce'), observation: longueur(body.observation, 500, 'Observation'), cout };
    if (autre) {
      // D'autres mouvements existent : seule la valorisation d'un stock d'ouverture sans coût est encore possible.
      const memes = avant && Number(avant.quantite) === quantite && String(avant.date_mouvement).slice(0, 10) === date;
      if (!memes || avant.cout_unitaire !== null || cout === null) {
        throw new ErreurCom(409, 'Des mouvements existent déjà pour cet article dans ce magasin : le stock d\'ouverture n\'est plus modifiable (seul son coût, s\'il manque, peut être complété).');
      }
    }
    if (avant) {
      await X(`UPDATE com_stock_mouvements SET quantite = :quantite, date_mouvement = :date_mouvement, piece = :piece, observation = :observation,
                 cout_unitaire = :cout, modifie_par = :u, modifie_le = NOW() WHERE id = :id`, { ...v, u: userId, id: avant.id }, tr);
    } else {
      await moteur.ecrire(tr, { tenantId, articleId: aid, magasinId: mid, type: 'stock_initial', quantite, date, piece: v.piece, observation: v.observation,
        cout, documentType: 'stock_initial', userId });
    }
    await moteur.rejouer(tr, tenantId, aid);
    await auditer(tr, { tenantId, userId, action: avant ? (autre ? 'COM_STOCK_INITIAL_VALORISATION' : 'COM_STOCK_INITIAL_CORRECTION') : 'COM_STOCK_INITIAL', id: `${aid}/${mid}`,
      avant: avant ? { quantite: Number(avant.quantite), date: String(avant.date_mouvement).slice(0, 10), cout: avant.cout_unitaire === null ? null : Number(avant.cout_unitaire) } : null,
      apres: { article: a.reference, magasin: m.code, quantite, date, cout } });
  });
  return { ok: true, stock: (await stockArticle(tenantId, aid, mid))[0] };
};

// ── Utilisateurs du module ────────────────────────────────────────────────
// Lecture seule : la gestion des comptes et des profils reste dans Configuration.
const utilisateurs = async (tenantId) => {
  exigerClient(tenantId);
  const perm = require('../permission.service');
  const avecTypes = await typesGestionPresents();
  const users = await Q(`SELECT u.id, u.username, u.email, u.role, u.actif, r.nom AS profil,
                                COALESCE((SELECT json_agg(ua.agence_id ORDER BY ua.agence_id) FROM com_utilisateur_agences ua WHERE ua.user_id = u.id), '[]') AS agences,
                                ${avecTypes ? `COALESCE((SELECT json_agg(ut.type_code ORDER BY tg.ordre) FROM com_utilisateur_types_gestion ut
                                            JOIN com_types_gestion tg ON tg.code = ut.type_code WHERE ut.user_id = u.id), '[]')` : `'[]'::json`} AS types_gestion
                           FROM users u LEFT JOIN roles r ON r.id = u.custom_role_id
                          WHERE u.tenant_id = :t ORDER BY u.actif DESC, lower(u.username)`, { t: tenantId });
  const out = [];
  for (const u of users) {
    const p = await perm.getEffectivePermissions({ tenantId, userId: u.id, role: u.role });
    const parTypes = new Set(await perm.getPermissionsTypes(u.id));
    const com = (p || []).filter((c) => c.startsWith('com.'));
    out.push({ ...u, agences: u.agences.map(Number), permissions: com, permissions_types: com.filter((c) => parTypes.has(c)) });
  }
  const catalogue = await Q("SELECT code, nom, description FROM permissions WHERE module = 'commercial' ORDER BY code", {});
  return { utilisateurs: out, catalogue, agences: await listerAgences(tenantId), types_gestion: avecTypes ? await listerTypesGestion(tenantId) : [] };
};

// ── Types de gestion (062) : achats, ventes, stock ────────────────────────
// Le type dit le DOMAINE où la personne travaille ; le rôle ou le profil métier
// garde le NIVEAU. Les droits de niveau (approuver, émettre, valider, annuler,
// paramétrer) ne s'obtiennent jamais par un type de gestion, même personnalisé.
const DROITS_DE_NIVEAU = /\.(approuver|approuver_direction|emettre|valider|valider_direction|annuler|livrer)$/;
const estDroitDeNiveau = (code) => DROITS_DE_NIVEAU.test(code) || code === 'com.parametrage.modifier';

const typesGestionPresents = async (tr) => {
  const [r] = await Q("SELECT to_regclass('public.com_utilisateur_types_gestion') IS NOT NULL AS ok", {}, tr);
  return Boolean(r?.ok);
};

const listerTypesGestion = async (tenantId, tr) => {
  exigerClient(tenantId);
  if (!(await typesGestionPresents(tr))) throw new ErreurCom(503, 'Types de gestion indisponibles : la migration 062 n\'est pas encore appliquée.');
  const rows = await Q(
    `SELECT tg.code, tg.libelle, tg.description, tg.ordre, (c.tenant_id IS NOT NULL) AS personnalise, c.personnalise_le,
            COALESCE((SELECT json_agg(d.permission_code ORDER BY d.permission_code) FROM com_type_gestion_permissions_defaut d WHERE d.type_code = tg.code), '[]') AS defaut,
            COALESCE((SELECT json_agg(pc.permission_code ORDER BY pc.permission_code) FROM com_type_gestion_permissions_client pc
                       WHERE pc.tenant_id = :t AND pc.type_code = tg.code), '[]') AS client,
            (SELECT COUNT(*)::int FROM com_utilisateur_types_gestion ut WHERE ut.tenant_id = :t AND ut.type_code = tg.code) AS nb_utilisateurs
       FROM com_types_gestion tg
       LEFT JOIN com_types_gestion_client c ON c.tenant_id = :t AND c.type_code = tg.code
      WHERE tg.actif ORDER BY tg.ordre, tg.code`, { t: tenantId }, tr);
  return rows.map((r) => ({ code: r.code, libelle: r.libelle, description: r.description, personnalise: r.personnalise,
    personnalise_le: r.personnalise_le, nb_utilisateurs: r.nb_utilisateurs,
    permissions: r.personnalise ? r.client : r.defaut, permissions_defaut: r.defaut }));
};

// Types de gestion d'une personne : liste complète (remplace l'ancienne). Vide = aucun.
const definirTypesUtilisateur = async ({ tenantId, userId, id, body }) => {
  exigerClient(tenantId);
  if (!Array.isArray(body.types)) throw new ErreurCom(400, 'Liste des types de gestion attendue (achats, ventes, stock).');
  const types = [...new Set(body.types.map((t) => txt(t).toLowerCase()))];
  await sequelize.transaction(async (tr) => {
    if (!(await typesGestionPresents(tr))) throw new ErreurCom(503, 'Types de gestion indisponibles : la migration 062 n\'est pas encore appliquée.');
    const [u] = await Q('SELECT id, username FROM users WHERE id::text = :u AND tenant_id = :t FOR UPDATE', { u: txt(id), t: tenantId }, tr);
    if (!u) throw new ErreurCom(404, 'Utilisateur introuvable pour ce client.');
    if (types.length) {
      const ok = await Q('SELECT code FROM com_types_gestion WHERE actif AND code IN (:c)', { c: types }, tr);
      if (ok.length !== types.length) throw new ErreurCom(400, 'Type de gestion inconnu (achats, ventes ou stock).');
    }
    const avant = (await Q('SELECT type_code FROM com_utilisateur_types_gestion WHERE user_id = :u ORDER BY type_code', { u: u.id }, tr)).map((r) => r.type_code);
    await X('DELETE FROM com_utilisateur_types_gestion WHERE user_id = :u AND NOT (type_code = ANY (CAST(:c AS TEXT[])))',
      { u: u.id, c: `{${types.join(',')}}` }, tr);
    for (const c of types) {
      await X(`INSERT INTO com_utilisateur_types_gestion (user_id, type_code, tenant_id, attribue_par) VALUES (:u, :c, :t, :p)
               ON CONFLICT (user_id, type_code) DO NOTHING`, { u: u.id, c, t: tenantId, p: userId }, tr);
    }
    const apres = [...types].sort();
    if (JSON.stringify(avant) !== JSON.stringify(apres)) {
      await auditer(tr, { tenantId, userId, action: 'COM_TYPES_GESTION_UTILISATEUR', id: u.id,
        avant: { username: u.username, types: avant }, apres: { username: u.username, types: apres } });
    }
  });
  return utilisateurs(tenantId);
};

// Lot de permissions d'un type pour CE client : liste choisie, ou retour au lot par défaut.
const personnaliserTypeGestion = async ({ tenantId, userId, code, body }) => {
  exigerClient(tenantId);
  const type = txt(code).toLowerCase();
  await sequelize.transaction(async (tr) => {
    if (!(await typesGestionPresents(tr))) throw new ErreurCom(503, 'Types de gestion indisponibles : la migration 062 n\'est pas encore appliquée.');
    const [tg] = await Q('SELECT code, libelle FROM com_types_gestion WHERE code = :c AND actif', { c: type }, tr);
    if (!tg) throw new ErreurCom(404, 'Type de gestion inconnu.');
    const avant = (await listerTypesGestion(tenantId, tr)).find((x) => x.code === tg.code);
    if (body.defaut === true) {
      await X('DELETE FROM com_types_gestion_client WHERE tenant_id = :t AND type_code = :c', { t: tenantId, c: tg.code }, tr);
      if (avant.personnalise) {
        await auditer(tr, { tenantId, userId, action: 'COM_TYPE_GESTION_DEFAUT', id: tg.code, avant: { permissions: avant.permissions }, apres: { permissions: avant.permissions_defaut } });
      }
      return;
    }
    if (!Array.isArray(body.permissions)) throw new ErreurCom(400, 'Liste des permissions attendue.');
    const codes = [...new Set(body.permissions.map(txt))];
    const niveau = codes.filter(estDroitDeNiveau);
    if (niveau.length) {
      throw new ErreurCom(400, `Droits de validation ou de paramétrage, attribués par le rôle ou le profil et jamais par un type de gestion : ${niveau.join(', ')}.`);
    }
    if (codes.some((c) => !c.startsWith('com.'))) throw new ErreurCom(400, 'Un type de gestion ne porte que des permissions de NJ COMMERCIAL.');
    if (codes.length) {
      const connus = await Q("SELECT code FROM permissions WHERE module = 'commercial' AND code IN (:c)", { c: codes }, tr);
      if (connus.length !== codes.length) throw new ErreurCom(400, 'Permission inconnue dans la liste.');
    }
    const { verifierCodesAccordables } = require('../permission.service');
    const { erreur } = await verifierCodesAccordables(codes, tenantId);
    if (erreur) throw new ErreurCom(400, erreur);
    await X(`INSERT INTO com_types_gestion_client (tenant_id, type_code, personnalise_par) VALUES (:t, :c, :u)
             ON CONFLICT (tenant_id, type_code) DO UPDATE SET personnalise_par = :u, personnalise_le = NOW()`, { t: tenantId, c: tg.code, u: userId }, tr);
    await X('DELETE FROM com_type_gestion_permissions_client WHERE tenant_id = :t AND type_code = :c', { t: tenantId, c: tg.code }, tr);
    for (const p of codes) {
      await X('INSERT INTO com_type_gestion_permissions_client (tenant_id, type_code, permission_code) VALUES (:t, :c, :p)', { t: tenantId, c: tg.code, p }, tr);
    }
    await auditer(tr, { tenantId, userId, action: 'COM_TYPE_GESTION_PERSONNALISATION', id: tg.code, avant: { permissions: avant.permissions }, apres: { permissions: [...codes].sort() } });
  });
  return listerTypesGestion(tenantId);
};

// Périmètre d'une personne : aucune agence = tout le client ; sinon ces agences seulement.
const definirAgencesUtilisateur = async ({ tenantId, userId, id, body }) => {
  exigerClient(tenantId);
  const agences = ids(body.agence_ids, 'Agence');
  await sequelize.transaction(async (tr) => {
    const [u] = await Q('SELECT id, username FROM users WHERE id::text = :u AND tenant_id = :t', { u: txt(id), t: tenantId }, tr);
    if (!u) throw new ErreurCom(404, 'Utilisateur introuvable pour ce client.');
    if (agences.length) {
      const ok = await Q('SELECT id FROM com_agences WHERE tenant_id = :t AND id IN (:a)', { t: tenantId, a: agences }, tr);
      if (ok.length !== agences.length) throw new ErreurCom(400, 'Une des agences choisies est inconnue.');
    }
    const avant = (await Q('SELECT agence_id FROM com_utilisateur_agences WHERE user_id = :u', { u: u.id }, tr)).map((r) => Number(r.agence_id));
    await X('DELETE FROM com_utilisateur_agences WHERE user_id = :u', { u: u.id }, tr);
    for (const a of agences) await X('INSERT INTO com_utilisateur_agences (user_id, agence_id, tenant_id) VALUES (:u, :a, :t)', { u: u.id, a, t: tenantId }, tr);
    await auditer(tr, { tenantId, userId, action: 'COM_PERIMETRE_AGENCES', id: u.id, avant: { username: u.username, agences: avant }, apres: { username: u.username, agences } });
  });
  return utilisateurs(tenantId);
};

module.exports = {
  ErreurCom,
  lireSociete, modifierSociete,
  listerAgences, enregistrerAgence, definirAgencesUtilisateur,
  listerUnites, enregistrerUnite,
  listerMagasins, enregistrerMagasin,
  listerFamilles, enregistrerFamille,
  listerTaxes, enregistrerTaxe,
  listerTiers, enregistrerTiers,
  listerArticles, lireArticle, enregistrerArticle, supprimerArticle,
  consulterStock, enregistrerStockInitial, stockArticle,
  utilisateurs,
  listerTypesGestion, definirTypesUtilisateur, personnaliserTypeGestion,
};
