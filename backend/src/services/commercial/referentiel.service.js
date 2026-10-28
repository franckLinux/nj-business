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
  nom_commercial: (v) => longueur(v, 150, 'Nom commercial'),
  mentions_documents: (v) => longueur(v, 1000, 'Mentions des documents'),
  prefixe_da: (v) => { const s = txt(v).toUpperCase(); if (!/^[A-Z0-9]{1,6}$/.test(s)) throw new ErreurCom(400, 'Préfixe des demandes : 1 à 6 lettres ou chiffres.'); return s; },
  prefixe_bc: (v) => { const s = txt(v).toUpperCase(); if (!/^[A-Z0-9]{1,6}$/.test(s)) throw new ErreurCom(400, 'Préfixe des bons de commande : 1 à 6 lettres ou chiffres.'); return s; },
  bloquer_si_stock_suffisant: (v) => Boolean(v),
  proforma_obligatoire: (v) => Boolean(v),
  seuil_direction: (v) => nombre(v, 'Seuil de validation par la direction', { vide: null }),
  tolerance_ecart_pct: (v) => nombre(v, 'Tolérance d\'écart', { max: 100, vide: 10 }),
};

const lireSociete = async (tenantId) => {
  exigerClient(tenantId);
  const [t] = await Q(
    `SELECT nom AS raison_sociale, sigle, forme_juridique, logo_url, adresse, boite_postale, ville, pays,
            telephone, email, site_web, nui, registre_commerce, devise
       FROM tenants WHERE id = :t`, { t: tenantId });
  if (!t) throw new ErreurCom(404, 'Client introuvable.');
  const [p] = await Q('SELECT * FROM com_parametres WHERE tenant_id = :t', { t: tenantId });
  const defaut = { nom_commercial: '', mentions_documents: '', prefixe_da: 'DA', prefixe_bc: 'BC',
    bloquer_si_stock_suffisant: false, proforma_obligatoire: false, seuil_direction: 500000, tolerance_ecart_pct: 10 };
  const parametres = { ...defaut, ...(p || {}) };
  for (const k of ['seuil_direction', 'tolerance_ecart_pct']) {
    parametres[k] = parametres[k] === null ? null : Number(parametres[k]);
  }
  delete parametres.tenant_id;
  return { identite: t, parametres, parametres_enregistres: Boolean(p) };
};

const modifierSociete = async ({ tenantId, userId, body }) => {
  exigerClient(tenantId);
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

// ── Magasins ─────────────────────────────────────────────────────────────
const listerMagasins = async (tenantId, { q = '', actifs = '' } = {}) => {
  exigerClient(tenantId);
  const rows = await Q(
    `SELECT m.*, u.username AS responsable_nom,
            (SELECT COUNT(DISTINCT s.article_id)::int FROM com_stock_mouvements s WHERE s.magasin_id = m.id) AS nb_articles_stock
       FROM com_magasins m LEFT JOIN users u ON u.id = m.responsable_id
      WHERE m.tenant_id = :t AND (:actifs <> '1' OR m.actif)
        AND (:q = '' OR lower(m.code) LIKE :like OR lower(m.nom) LIKE :like OR lower(m.localisation) LIKE :like)
      ORDER BY m.actif DESC, upper(m.code)`,
    { t: tenantId, actifs: String(actifs), q: txt(q), like: `%${txt(q).toLowerCase()}%` });
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
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
  return {
    code, nom, description: longueur(b.description, 1000, 'Description'),
    localisation: longueur(b.localisation, 300, 'Localisation'), responsable_id: responsable,
    actif: b.actif === undefined ? true : Boolean(b.actif),
  };
};

const enregistrerMagasin = async ({ tenantId, userId, id, body }) => {
  exigerClient(tenantId);
  try {
    const mid = await sequelize.transaction(async (tr) => {
      if (id) {
        const mi = entier(id, 'Magasin');
        const [avant] = await Q('SELECT * FROM com_magasins WHERE id = :id AND tenant_id = :t FOR UPDATE', { id: mi, t: tenantId }, tr);
        if (!avant) throw new ErreurCom(404, 'Magasin introuvable.');
        const v = await valeursMagasin(tenantId, { ...avant, ...body }, tr);
        await X(`UPDATE com_magasins SET code = :code, nom = :nom, description = :description, localisation = :localisation,
                   responsable_id = :responsable_id, actif = :actif, modifie_le = NOW() WHERE id = :id`, { ...v, id: mi }, tr);
        const d = differences(avant, v);
        if (d) await auditer(tr, { tenantId, userId, action: 'COM_MAGASIN_MODIFICATION', id: mi, ...d });
        return mi;
      }
      const v = await valeursMagasin(tenantId, body, tr);
      const [r] = await Q(`INSERT INTO com_magasins (tenant_id, code, nom, description, localisation, responsable_id, actif, cree_par)
                           VALUES (:t, :code, :nom, :description, :localisation, :responsable_id, :actif, :u) RETURNING id`,
      { ...v, t: tenantId, u: userId }, tr);
      await auditer(tr, { tenantId, userId, action: 'COM_MAGASIN_CREATION', id: r.id, apres: v });
      return Number(r.id);
    });
    return (await listerMagasins(tenantId)).find((m) => m.id === mid);
  } catch (err) { return unicite(err, 'Ce code de magasin existe déjà.'); }
};

// ── Familles d'articles (+ fournisseurs associés) ────────────────────────
const listerFamilles = async (tenantId, { q = '', actifs = '' } = {}) => {
  exigerClient(tenantId);
  const rows = await Q(
    `SELECT f.*,
            COALESCE((SELECT json_agg(json_build_object('id', r.id, 'nom', r.nom, 'actif', r.actif) ORDER BY lower(r.nom))
                        FROM com_famille_fournisseurs ff JOIN registre_tiers r ON r.id = ff.tiers_id
                       WHERE ff.famille_id = f.id), '[]') AS fournisseurs,
            (SELECT COUNT(*)::int FROM com_articles a WHERE a.famille_id = f.id) AS nb_articles
       FROM com_familles f
      WHERE f.tenant_id = :t AND (:actifs <> '1' OR f.actif)
        AND (:q = '' OR lower(f.code) LIKE :like OR lower(f.nom) LIKE :like)
      ORDER BY f.actif DESC, upper(f.code)`,
    { t: tenantId, actifs: String(actifs), q: txt(q), like: `%${txt(q).toLowerCase()}%` });
  return rows.map((r) => ({ ...r, id: Number(r.id), fournisseurs: r.fournisseurs.map((f) => ({ ...f, id: Number(f.id) })) }));
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
      const v = { code, nom, description: longueur(b.description, 1000, 'Description'), actif: b.actif === undefined ? true : Boolean(b.actif) };
      let famId;
      if (avant) {
        famId = Number(avant.id);
        await X('UPDATE com_familles SET code = :code, nom = :nom, description = :description, actif = :actif, modifie_le = NOW() WHERE id = :id',
          { ...v, id: famId }, tr);
      } else {
        const [r] = await Q(`INSERT INTO com_familles (tenant_id, code, nom, description, actif, cree_par)
                             VALUES (:t, :code, :nom, :description, :actif, :u) RETURNING id`, { ...v, t: tenantId, u: userId }, tr);
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
const listerTaxes = async (tenantId, { actifs = '' } = {}) => {
  exigerClient(tenantId);
  const rows = await Q(
    `SELECT x.*, (SELECT COUNT(*)::int FROM com_articles a WHERE a.taxe_id = x.id) AS nb_articles
       FROM com_taxes x WHERE x.tenant_id = :t AND (:actifs <> '1' OR x.actif) ORDER BY x.actif DESC, upper(x.code)`,
    { t: tenantId, actifs: String(actifs) });
  return rows.map((r) => ({ ...r, id: Number(r.id), taux: Number(r.taux), type_libelle: TYPES_TAXE[r.type] }));
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
      };
      if (v.debut && v.fin && v.fin < v.debut) throw new ErreurCom(400, 'La fin de validité précède le début.');
      // Un taux déjà repris dans un document ne change jamais : on crée une nouvelle taxe datée.
      if (avant && Number(avant.taux) !== taux && await tauxUtilise(Number(avant.id), tr)) {
        throw new ErreurCom(409, 'Ce taux figure déjà dans des documents d\'achat : désactivez cette taxe et créez-en une nouvelle avec sa date de début.');
      }
      if (avant) {
        await X(`UPDATE com_taxes SET code = :code, intitule = :intitule, taux = :taux, type = :type, description = :description,
                   debut = :debut, fin = :fin, actif = :actif, modifie_le = NOW() WHERE id = :id`, { ...v, id: Number(avant.id) }, tr);
        const d = differences({ ...avant, debut: avant.debut ? String(avant.debut).slice(0, 10) : null, fin: avant.fin ? String(avant.fin).slice(0, 10) : null }, v);
        if (d) await auditer(tr, { tenantId, userId, action: 'COM_TAXE_MODIFICATION', id: avant.id, ...d });
        return Number(avant.id);
      }
      const [r] = await Q(`INSERT INTO com_taxes (tenant_id, code, intitule, taux, type, description, debut, fin, actif, cree_par)
                           VALUES (:t, :code, :intitule, :taux, :type, :description, :debut, :fin, :actif, :u) RETURNING id`,
      { ...v, t: tenantId, u: userId }, tr);
      await auditer(tr, { tenantId, userId, action: 'COM_TAXE_CREATION', id: r.id, apres: v });
      return Number(r.id);
    });
    return (await listerTaxes(tenantId)).find((x) => x.id === xid);
  } catch (err) { return unicite(err, 'Ce code de taxe existe déjà.'); }
};

// Les documents d'achat (livraison C) copient le taux ; tant qu'ils n'existent pas, rien n'est figé.
const tauxUtilise = async (taxeId, tr) => {
  const [t] = await Q("SELECT to_regclass('public.com_bc_lignes') IS NOT NULL AS ok", {}, tr);
  if (!t.ok) return false;
  const [u] = await Q('SELECT 1 FROM com_bc_lignes WHERE taxe_id = :id LIMIT 1', { id: taxeId }, tr);
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
    LEFT JOIN com_taxes x ON x.id = a.taxe_id`;

const formaterArticle = (r) => ({
  ...r, id: Number(r.id), famille_id: Number(r.famille_id), taxe_id: r.taxe_id ? Number(r.taxe_id) : null,
  prix_achat_indicatif: r.prix_achat_indicatif === null ? null : Number(r.prix_achat_indicatif),
  seuil_alerte: r.seuil_alerte === null ? null : Number(r.seuil_alerte),
  taxe_taux: r.taxe_taux === null || r.taxe_taux === undefined ? null : Number(r.taxe_taux),
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
      const [fam] = await Q('SELECT id, actif FROM com_familles WHERE id = :id AND tenant_id = :t', { id: familleId, t: tenantId }, tr);
      if (!fam) throw new ErreurCom(400, 'Famille inconnue.');
      if (!fam.actif && Number(avant?.famille_id) !== familleId) throw new ErreurCom(400, 'Cette famille est désactivée.');
      if (b.suivi_comptable === undefined || b.suivi_comptable === null || b.suivi_comptable === '') {
        throw new ErreurCom(400, 'Indiquez si l\'article est suivi en comptabilité (oui / non).');
      }
      let taxeId = b.taxe_id === undefined || b.taxe_id === null || b.taxe_id === '' ? null : entier(b.taxe_id, 'Taxe');
      if (taxeId) {
        const [x] = await Q('SELECT id FROM com_taxes WHERE id = :id AND tenant_id = :t', { id: taxeId, t: tenantId }, tr);
        if (!x) throw new ErreurCom(400, 'Taxe inconnue.');
      }
      const v = {
        reference, designation, description: longueur(b.description, 2000, 'Description'), famille_id: familleId,
        unite: longueur(b.unite || 'unité', 20, 'Unité'),
        prix_achat_indicatif: nombre(b.prix_achat_indicatif, 'Prix d\'achat indicatif', { vide: null }),
        taxe_id: taxeId, seuil_alerte: nombre(b.seuil_alerte, 'Seuil d\'alerte', { vide: null }),
        suivi_comptable: b.suivi_comptable === true || b.suivi_comptable === 'true' || b.suivi_comptable === 1 || b.suivi_comptable === '1',
        actif: b.actif === undefined ? true : Boolean(b.actif),
      };
      let artId;
      if (avant) {
        artId = Number(avant.id);
        await X(`UPDATE com_articles SET reference = :reference, designation = :designation, description = :description, famille_id = :famille_id,
                   unite = :unite, prix_achat_indicatif = :prix_achat_indicatif, taxe_id = :taxe_id, seuil_alerte = :seuil_alerte,
                   suivi_comptable = :suivi_comptable, actif = :actif, modifie_par = :u, modifie_le = NOW() WHERE id = :id`,
        { ...v, u: userId, id: artId }, tr);
        const norm = { ...avant, famille_id: Number(avant.famille_id), taxe_id: avant.taxe_id ? Number(avant.taxe_id) : null,
          prix_achat_indicatif: avant.prix_achat_indicatif === null ? null : Number(avant.prix_achat_indicatif),
          seuil_alerte: avant.seuil_alerte === null ? null : Number(avant.seuil_alerte) };
        const d = differences(norm, v);
        if (d) await auditer(tr, { tenantId, userId, action: 'COM_ARTICLE_MODIFICATION', id: artId, ...d });
      } else {
        const [r] = await Q(`INSERT INTO com_articles (tenant_id, reference, designation, description, famille_id, unite, prix_achat_indicatif,
                               taxe_id, seuil_alerte, suivi_comptable, actif, cree_par, modifie_par)
                             VALUES (:t, :reference, :designation, :description, :famille_id, :unite, :prix_achat_indicatif,
                               :taxe_id, :seuil_alerte, :suivi_comptable, :actif, :u, :u) RETURNING id`, { ...v, t: tenantId, u: userId }, tr);
        artId = Number(r.id);
        await auditer(tr, { tenantId, userId, action: 'COM_ARTICLE_CREATION', id: artId, apres: v });
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
            COUNT(s.id)::int AS nb_mouvements, COALESCE(SUM(s.quantite), 0) AS quantite,
            MAX(s.date_mouvement)::text AS dernier_mouvement
       FROM com_magasins m
       LEFT JOIN com_stock_mouvements s ON s.magasin_id = m.id AND s.article_id = :a
      WHERE m.tenant_id = :t AND (CAST(:m AS BIGINT) IS NULL OR m.id = CAST(:m AS BIGINT))
        AND (m.actif OR s.id IS NOT NULL)
      GROUP BY m.id ORDER BY upper(m.code)`,
    { t: tenantId, a: articleId, m: magasinId });
  return rows.map((r) => ({
    magasin_id: Number(r.magasin_id), code: r.code, nom: r.nom, actif: r.actif,
    suivi: r.nb_mouvements > 0, quantite: r.nb_mouvements > 0 ? Number(r.quantite) : null, dernier_mouvement: r.dernier_mouvement,
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
    const [a] = await Q('SELECT id, reference FROM com_articles WHERE id = :a AND tenant_id = :t', { a: aid, t: tenantId }, tr);
    if (!a) throw new ErreurCom(404, 'Article introuvable.');
    const [m] = await Q('SELECT id, code, actif FROM com_magasins WHERE id = :m AND tenant_id = :t', { m: mid, t: tenantId }, tr);
    if (!m) throw new ErreurCom(404, 'Magasin introuvable.');
    if (!m.actif) throw new ErreurCom(400, 'Ce magasin est désactivé.');
    const [autre] = await Q(`SELECT 1 FROM com_stock_mouvements WHERE article_id = :a AND magasin_id = :m AND type <> 'stock_initial' LIMIT 1`, { a: aid, m: mid }, tr);
    if (autre) throw new ErreurCom(409, 'Des mouvements existent déjà pour cet article dans ce magasin : le stock initial n\'est plus modifiable.');
    const [avant] = await Q(`SELECT * FROM com_stock_mouvements WHERE article_id = :a AND magasin_id = :m AND type = 'stock_initial' FOR UPDATE`, { a: aid, m: mid }, tr);
    const v = { quantite, date_mouvement: date, piece: longueur(body.piece, 60, 'Pièce'), observation: longueur(body.observation, 500, 'Observation') };
    if (avant) {
      await X(`UPDATE com_stock_mouvements SET quantite = :quantite, date_mouvement = :date_mouvement, piece = :piece, observation = :observation,
                 modifie_par = :u, modifie_le = NOW() WHERE id = :id`, { ...v, u: userId, id: avant.id }, tr);
    } else {
      await X(`INSERT INTO com_stock_mouvements (tenant_id, article_id, magasin_id, type, quantite, date_mouvement, piece, observation, cree_par, modifie_par)
               VALUES (:t, :a, :m, 'stock_initial', :quantite, :date_mouvement, :piece, :observation, :u, :u)`, { ...v, t: tenantId, a: aid, m: mid, u: userId }, tr);
    }
    await auditer(tr, { tenantId, userId, action: avant ? 'COM_STOCK_INITIAL_CORRECTION' : 'COM_STOCK_INITIAL', id: `${aid}/${mid}`,
      avant: avant ? { quantite: Number(avant.quantite), date: String(avant.date_mouvement).slice(0, 10) } : null,
      apres: { article: a.reference, magasin: m.code, quantite, date } });
  });
  return { ok: true, stock: (await stockArticle(tenantId, aid, mid))[0] };
};

// ── Utilisateurs du module ────────────────────────────────────────────────
// Lecture seule : la gestion des comptes et des profils reste dans Configuration.
const utilisateurs = async (tenantId) => {
  exigerClient(tenantId);
  const perm = require('../permission.service');
  const users = await Q(`SELECT u.id, u.username, u.email, u.role, u.actif, r.nom AS profil
                           FROM users u LEFT JOIN roles r ON r.id = u.custom_role_id
                          WHERE u.tenant_id = :t ORDER BY u.actif DESC, lower(u.username)`, { t: tenantId });
  const out = [];
  for (const u of users) {
    const p = await perm.getEffectivePermissions({ tenantId, userId: u.id, role: u.role });
    out.push({ ...u, permissions: (p || []).filter((c) => c.startsWith('com.')) });
  }
  const catalogue = await Q("SELECT code, nom, description FROM permissions WHERE module = 'commercial' ORDER BY code", {});
  return { utilisateurs: out, catalogue };
};

module.exports = {
  ErreurCom,
  lireSociete, modifierSociete,
  listerMagasins, enregistrerMagasin,
  listerFamilles, enregistrerFamille,
  listerTaxes, enregistrerTaxe,
  listerTiers, enregistrerTiers,
  listerArticles, lireArticle, enregistrerArticle, supprimerArticle,
  consulterStock, enregistrerStockInitial, stockArticle,
  utilisateurs,
};
