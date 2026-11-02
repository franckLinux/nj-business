'use strict';
// NJ COMMERCIAL — documents de stock (lot 4) : entrées diverses, sorties diverses,
// transferts entre magasins, inventaires.
//
// Circuit : brouillon → à valider → validé → (annulé, motivé).
//   • saisie et soumission : une permission par type (com.stock.entree, .sortie,
//     .transfert, .inventaire — migration 057) ;
//   • validation et renvoi : com.stock.valider, jamais par l'auteur du document
//     (sauf paramètre « auto-validation » activé par le directeur) ;
//   • annulation d'un document validé : com.stock.annuler ;
//   • coûts et valeurs affichés seulement avec com.stock.valorisation ;
//   • SEULE la validation écrit des mouvements ; l'annulation les marque annulés
//     et la valorisation de l'article est rejouée (rien n'est effacé) ;
//   • un document validé est intangible (déclencheurs en base) ;
//   • périmètre par agence : magasins de la personne seulement.
const { sequelize } = require('../../models');
const moteur = require('./stock.service');
const docs = require('./documents.service');

const T = sequelize.QueryTypes;
const Q = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: T.SELECT, transaction });
const X = (sql, replacements, transaction) => sequelize.query(sql, { replacements, transaction });

class ErreurStock extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const TYPES = { entree: 'Entrée en stock', sortie: 'Sortie diverse', transfert: 'Transfert entre magasins', inventaire: 'Inventaire' };
const PREFIXES = { entree: 'ENT', sortie: 'SOR', transfert: 'TRF', inventaire: 'INV' };
const STATUTS = { brouillon: 'Brouillon', a_valider: 'À valider', valide: 'Validé', annule: 'Annulé' };
const txt = (v) => String(v ?? '').trim();
const entier = (v, nom) => {
  const n = Number.parseInt(v, 10);
  if (!Number.isInteger(n) || n <= 0) throw new ErreurStock(400, `${nom} invalide.`);
  return n;
};
const nombre = (v, nom, { min = 0, vide = null } = {}) => {
  if (v === undefined || v === null || txt(v) === '') return vide;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > 1e12) throw new ErreurStock(400, `${nom} invalide.`);
  return n;
};
const q3 = (n) => Math.round(n * 1000) / 1000;
const perim = () => require('./demandes.service');

const SAISIES = { entree: 'com.stock.entree', sortie: 'com.stock.sortie', transfert: 'com.stock.transfert', inventaire: 'com.stock.inventaire' };
const LIB_SAISIES = { entree: 'saisir les entrées en stock', sortie: 'saisir les sorties diverses', transfert: 'saisir les transferts', inventaire: 'saisir les inventaires' };
const VOIR = ['com.stock.voir', ...Object.values(SAISIES), 'com.stock.valider', 'com.stock.annuler', 'com.stock.journal', 'com.stock.valorisation'];
// Documents d'un type visibles par : qui le saisit, qui valide ou annule, qui consulte le journal.
const voitType = (ctx, type) => ctx.peut(SAISIES[type]) || ['com.stock.valider', 'com.stock.annuler', 'com.stock.journal'].some((c) => ctx.peut(c));
const exigerVue = (ctx) => { if (!VOIR.some((c) => ctx.peut(c))) throw new ErreurStock(403, 'Permission requise : consulter le stock.'); };
const exiger = (ctx, code, libelle) => { if (!ctx.peut(code)) throw new ErreurStock(403, `Permission requise : ${libelle}.`); };
const exigerSaisie = (ctx, type) => exiger(ctx, SAISIES[type], LIB_SAISIES[type]);

const auditer = (tr, ctx, action, id, apres, avant = null) => X(
  `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, ancienne_valeur, nouvelle_valeur)
   VALUES (:t, :u, :a, 'commercial', :id, CAST(:av AS jsonb), CAST(:ap AS jsonb))`,
  { t: ctx.tenantId, u: ctx.userId, a: action, id: `ST:${id}`, av: avant ? JSON.stringify(avant) : null, ap: apres ? JSON.stringify(apres) : null }, tr);

const numeroter = async (tr, tenantId, type) => {
  const annee = new Date().getFullYear();
  const [r] = await Q(
    `INSERT INTO com_compteurs (tenant_id, type, annee, dernier) VALUES (:t, :type, :a, 1)
     ON CONFLICT (tenant_id, type, annee) DO UPDATE SET dernier = com_compteurs.dernier + 1 RETURNING dernier`,
    { t: tenantId, type: PREFIXES[type], a: annee }, tr);
  return `${PREFIXES[type]}-${annee}-${String(r.dernier).padStart(4, '0')}`;
};

const parametres = async (tenantId, tr) => {
  const [p] = await Q('SELECT stock_negatif_autorise, autovalidation_stock FROM com_parametres WHERE tenant_id = :t', { t: tenantId }, tr);
  return { negatif: Boolean(p?.stock_negatif_autorise), autovalidation: Boolean(p?.autovalidation_stock) };
};

// ── Lecture ──────────────────────────────────────────────────────────────
const SQL_DOC = `
  SELECT d.*, m.code AS magasin_code, m.nom AS magasin_nom, md.code AS magasin_dest_code, md.nom AS magasin_dest_nom,
         uc.username AS cree_par_nom, uv.username AS valide_par_nom, ua.username AS annule_par_nom,
         (SELECT COUNT(*)::int FROM com_stock_doc_lignes l WHERE l.document_id = d.id) AS nb_lignes
    FROM com_stock_documents d
    JOIN com_magasins m ON m.id = d.magasin_id
    LEFT JOIN com_magasins md ON md.id = d.magasin_dest_id
    LEFT JOIN users uc ON uc.id = d.cree_par
    LEFT JOIN users uv ON uv.id = d.valide_par
    LEFT JOIN users ua ON ua.id = d.annule_par`;

const dansPerimetre = (ctx, d) => perim().dansPerimetre(ctx, d.magasin_id) && (!d.magasin_dest_id || perim().dansPerimetre(ctx, d.magasin_dest_id));
const formater = (d) => ({
  ...d, id: Number(d.id), magasin_id: Number(d.magasin_id), magasin_dest_id: d.magasin_dest_id ? Number(d.magasin_dest_id) : null,
  type_libelle: TYPES[d.type], statut_libelle: STATUTS[d.statut],
});

const charger = async (ctx, id, tr, verrou = false) => {
  const [d] = await Q(`${SQL_DOC} WHERE d.tenant_id = :t AND d.id = :id${verrou ? ' FOR UPDATE OF d' : ''}`, { t: ctx.tenantId, id: entier(id, 'Document') }, tr);
  if (!d || !dansPerimetre(ctx, d)) throw new ErreurStock(404, 'Document de stock introuvable.');
  return d;
};

const lister = async (ctx, { type = '', statut = '', q = '', du = '', au = '' } = {}) => {
  exigerVue(ctx);
  const p = perim().sqlPerimetre(ctx, 'd.magasin_id');
  const conds = ['d.tenant_id = :t', p.sql]; const r = { t: ctx.tenantId, ...p.r };
  if (type) { if (!TYPES[type]) throw new ErreurStock(400, 'Type de document inconnu.'); conds.push('d.type = :type'); r.type = type; }
  if (statut) { if (!STATUTS[statut]) throw new ErreurStock(400, 'Statut inconnu.'); conds.push('d.statut = :statut'); r.statut = statut; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(du)) { conds.push('d.date_document >= :du'); r.du = du; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(au)) { conds.push('d.date_document <= :au'); r.au = au; }
  if (txt(q)) {
    conds.push(`(lower(d.numero) LIKE :like OR lower(d.motif) LIKE :like OR EXISTS (SELECT 1 FROM com_stock_doc_lignes l JOIN com_articles a ON a.id = l.article_id
                 WHERE l.document_id = d.id AND (lower(a.reference) LIKE :like OR lower(a.designation) LIKE :like)))`);
    r.like = `%${txt(q).toLowerCase()}%`;
  }
  return (await Q(`${SQL_DOC} WHERE ${conds.join(' AND ')} ORDER BY d.cree_le DESC LIMIT 500`, r))
    .filter((d) => dansPerimetre(ctx, d) && voitType(ctx, d.type)).map(formater);
};

const compteurs = async (ctx) => {
  if (!VOIR.some((c) => ctx.peut(c))) return { a_valider: 0, sous_seuil: 0 };
  const p = perim().sqlPerimetre(ctx, 'd.magasin_id');
  const [a] = ctx.peut('com.stock.valider') ? await Q(
    `SELECT COUNT(*)::int AS n FROM com_stock_documents d WHERE d.tenant_id = :t AND d.statut = 'a_valider' AND d.cree_par <> :moi AND ${p.sql}`,
    { t: ctx.tenantId, moi: ctx.userId, ...p.r }) : [{ n: 0 }];
  const ps = perim().sqlPerimetre(ctx, 's.magasin_id');
  const [s] = await Q(`SELECT COUNT(*)::int AS n FROM com_stock_soldes s JOIN com_articles a ON a.id = s.article_id
                        WHERE s.tenant_id = :t AND a.seuil_alerte IS NOT NULL AND s.quantite <= a.seuil_alerte AND ${ps.sql}`, { t: ctx.tenantId, ...ps.r });
  return { a_valider: a.n, sous_seuil: s.n };
};

const lire = async (ctx, id) => {
  exigerVue(ctx);
  const d = await charger(ctx, id);
  if (!voitType(ctx, d.type)) throw new ErreurStock(403, `Permission requise : ${LIB_SAISIES[d.type]} ou valider les documents de stock.`);
  const couts = ctx.peut('com.stock.valorisation');
  const lignes = await Q(
    `SELECT l.*, a.reference, a.designation, a.unite AS unite_stock, a.actif AS article_actif, a.methode_valorisation,
            COALESCE((SELECT SUM(s.sens * s.quantite) FROM com_stock_mouvements s WHERE s.article_id = l.article_id AND s.magasin_id = :m AND NOT s.annule), 0) AS stock_actuel
       FROM com_stock_doc_lignes l JOIN com_articles a ON a.id = l.article_id WHERE l.document_id = :id ORDER BY l.ordre, l.id`,
    { id: d.id, m: d.magasin_id });
  const mouvements = await Q(
    `SELECT s.id, s.type, s.sens, s.quantite, s.cout_unitaire, s.valeur, s.annule, s.magasin_id, m.code AS magasin_code, a.reference, a.unite
       FROM com_stock_mouvements s JOIN com_magasins m ON m.id = s.magasin_id JOIN com_articles a ON a.id = s.article_id
      WHERE s.document_type = :type AND s.document_id = :id ORDER BY s.id`, { type: d.type, id: d.id });
  const pieces = await Q(
    `SELECT x.id, x.nom, x.mime, x.taille, x.sha256, x.ajoute_le, u.username AS ajoute_par_nom, x.retire, x.retire_le, x.motif_retrait
       FROM com_documents x LEFT JOIN users u ON u.id = x.ajoute_par
      WHERE x.tenant_id = :t AND x.objet_type = 'stock_doc' AND x.objet_id = :id ORDER BY x.ajoute_le`, { t: ctx.tenantId, id: d.id });
  const historique = await Q(
    `SELECT a.created_at AS le, a.action, u.username AS par_nom, a.nouvelle_valeur FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.tenant_id = :t AND a.entite = 'commercial' AND a.entite_id = :e ORDER BY a.created_at, a.id`, { t: ctx.tenantId, e: `ST:${d.id}` });
  const p = await parametres(ctx.tenantId);
  const auteur = d.cree_par === ctx.userId;
  return {
    ...formater(d),
    lignes: lignes.map((l) => ({
      ...l, id: Number(l.id), article_id: Number(l.article_id), unite_id: l.unite_id ? Number(l.unite_id) : null, coefficient: Number(l.coefficient),
      quantite: Number(l.quantite), quantite_stock: q3(Number(l.quantite) * Number(l.coefficient)),
      // Coût saisi sur une entrée : visible par qui la saisit ou par qui voit la valorisation.
      cout_unitaire: l.cout_unitaire === null || !(couts || ctx.peut('com.stock.entree')) ? null : Number(l.cout_unitaire),
      quantite_theorique: l.quantite_theorique === null ? null : Number(l.quantite_theorique),
      quantite_comptee: l.quantite_comptee === null ? null : Number(l.quantite_comptee), stock_actuel: Number(l.stock_actuel),
    })),
    mouvements: mouvements.map((m) => ({ ...m, id: Number(m.id), quantite: Number(m.quantite), sens: Number(m.sens),
      cout_unitaire: m.cout_unitaire === null || !couts ? null : Number(m.cout_unitaire), valeur: m.valeur === null || !couts ? null : Number(m.valeur) })),
    valeurs_visibles: couts,
    pieces: pieces.map((x) => ({ ...x, id: Number(x.id), taille: Number(x.taille) })), historique,
    droits: {
      modifier: d.statut === 'brouillon' && ctx.peut(SAISIES[d.type]),
      soumettre: d.statut === 'brouillon' && ctx.peut(SAISIES[d.type]),
      valider: d.statut === 'a_valider' && ctx.peut('com.stock.valider') && (!auteur || p.autovalidation),
      renvoyer: d.statut === 'a_valider' && ctx.peut('com.stock.valider') && (!auteur || p.autovalidation),
      annuler: d.statut === 'valide' && ctx.peut('com.stock.annuler'),
      joindre: ['brouillon', 'a_valider'].includes(d.statut) && (ctx.peut(SAISIES[d.type]) || ctx.peut('com.stock.valider')),
      auto_validation_interdite: d.statut === 'a_valider' && ctx.peut('com.stock.valider') && auteur && !p.autovalidation,
    },
  };
};

// ── Saisie ───────────────────────────────────────────────────────────────
const magasinActif = async (ctx, id, nom, tr) => {
  const mid = entier(id, nom);
  const [m] = await Q('SELECT id, code, actif FROM com_magasins WHERE id = :m AND tenant_id = :t', { m: mid, t: ctx.tenantId }, tr);
  if (!m) throw new ErreurStock(400, `${nom} inconnu.`);
  if (!m.actif) throw new ErreurStock(400, `Le magasin ${m.code} est désactivé.`);
  if (!perim().dansPerimetre(ctx, mid)) throw new ErreurStock(403, `Le magasin ${m.code} n'appartient pas à vos agences.`);
  return mid;
};

const valeursEntete = async (ctx, type, b, tr) => {
  const magasin = await magasinActif(ctx, b.magasin_id, type === 'transfert' ? 'Magasin de départ' : 'Magasin', tr);
  let dest = null;
  if (type === 'transfert') {
    dest = await magasinActif(ctx, b.magasin_dest_id, 'Magasin de destination', tr);
    if (dest === magasin) throw new ErreurStock(400, 'Le magasin de destination doit être différent du magasin de départ.');
  }
  const date = txt(b.date_document) || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new ErreurStock(400, 'Date invalide (AAAA-MM-JJ).');
  if (date > new Date().toISOString().slice(0, 10)) throw new ErreurStock(400, 'La date ne peut pas être dans le futur.');
  const motif = txt(b.motif);
  if (motif.length > 500) throw new ErreurStock(400, 'Motif : 500 caractères au plus.');
  const observations = txt(b.observations);
  if (observations.length > 2000) throw new ErreurStock(400, 'Observations : 2000 caractères au plus.');
  return { magasin_id: magasin, magasin_dest_id: dest, date_document: date, motif, observations };
};

const ecrireLignes = async (ctx, tr, d, lignes) => {
  if (!Array.isArray(lignes)) throw new ErreurStock(400, 'Liste d\'articles invalide.');
  if (lignes.length > 1000) throw new ErreurStock(400, '1000 lignes au plus par document.');
  await X('DELETE FROM com_stock_doc_lignes WHERE document_id = :d', { d: d.id }, tr);
  const vus = new Set();
  for (const [i, l] of lignes.entries()) {
    const aid = entier(l.article_id, 'Article');
    if (vus.has(aid)) throw new ErreurStock(400, 'Un même article figure deux fois : regroupez les quantités.');
    vus.add(aid);
    const [a] = await Q('SELECT id, designation, actif, suivi_stock, unite_stock_id FROM com_articles WHERE id = :a AND tenant_id = :t', { a: aid, t: ctx.tenantId }, tr);
    if (!a) throw new ErreurStock(400, 'Article inconnu.');
    if (!a.suivi_stock) throw new ErreurStock(400, `« ${a.designation} » n'est pas suivi en stock.`);
    if (!a.actif && d.type !== 'inventaire') throw new ErreurStock(400, `« ${a.designation} » est désactivé.`);
    // Unité : celle de stock par défaut ; l'inventaire se compte toujours en unité de stock.
    const uid = d.type === 'inventaire' || !l.unite_id ? Number(a.unite_stock_id) : entier(l.unite_id, 'Unité');
    const [u] = await Q(`SELECT u.id, u.code, u.decimales, au.coefficient FROM com_article_unites au JOIN com_unites u ON u.id = au.unite_id
                          WHERE au.article_id = :a AND au.unite_id = :u`, { a: aid, u: uid }, tr);
    if (!u) throw new ErreurStock(400, `« ${a.designation} » ne se compte pas dans cette unité.`);
    const dec = 10 ** Number(u.decimales);
    const verifier = (q, nom) => {
      if (q !== null && Math.round(q * dec) !== q * dec) {
        throw new ErreurStock(400, `« ${a.designation} » : ${nom} en ${u.code}, ${Number(u.decimales) ? `${u.decimales} décimale(s) au plus` : 'nombre entier'}.`);
      }
      return q;
    };
    let quantite = 0; let cout = null; let comptee = null;
    if (d.type === 'inventaire') {
      comptee = verifier(nombre(l.quantite_comptee, 'Quantité comptée', { vide: null }), 'quantité comptée');
    } else {
      quantite = verifier(nombre(l.quantite, 'Quantité', { vide: null }), 'quantité');
      if (!(quantite > 0)) throw new ErreurStock(400, `« ${a.designation} » : indiquez une quantité.`);
      if (d.type === 'entree') {
        cout = nombre(l.cout_unitaire, 'Coût unitaire', { vide: null });
        if (cout === null) throw new ErreurStock(400, `« ${a.designation} » : le coût unitaire d'une entrée est obligatoire (il valorise le stock).`);
      }
    }
    const obs = txt(l.observation);
    if (obs.length > 500) throw new ErreurStock(400, 'Observation de ligne : 500 caractères au plus.');
    await X(`INSERT INTO com_stock_doc_lignes (document_id, tenant_id, ordre, article_id, unite_id, unite, coefficient, quantite, cout_unitaire, quantite_comptee, observation)
             VALUES (:d, :t, :o, :a, :u, :uc, :k, :q, :c, :qc, :obs)`,
    { d: d.id, t: ctx.tenantId, o: i, a: aid, u: u.id, uc: u.code, k: Number(u.coefficient), q: q3(quantite), c: cout, qc: comptee === null ? null : q3(comptee), obs }, tr);
  }
  return lignes.length;
};

const creer = async (ctx, body = {}) => {
  const type = txt(body.type);
  if (!TYPES[type]) throw new ErreurStock(400, 'Type de document inconnu (entrée, sortie, transfert ou inventaire).');
  exigerSaisie(ctx, type);
  const id = await sequelize.transaction(async (tr) => {
    const v = await valeursEntete(ctx, type, body, tr);
    const numero = await numeroter(tr, ctx.tenantId, type);
    const [r] = await Q(
      `INSERT INTO com_stock_documents (tenant_id, type, numero, date_document, magasin_id, magasin_dest_id, motif, observations, cree_par)
       VALUES (:t, :type, :numero, :date_document, :magasin_id, :magasin_dest_id, :motif, :observations, :u) RETURNING id`,
      { ...v, t: ctx.tenantId, type, numero, u: ctx.userId }, tr);
    const nb = await ecrireLignes(ctx, tr, { id: r.id, type }, body.lignes || []);
    await auditer(tr, ctx, 'COM_STOCK_CREATION', r.id, { numero, type, ...v, nb_lignes: nb });
    return r.id;
  });
  return lire(ctx, id);
};

const modifier = async (ctx, id, body = {}) => {
  await sequelize.transaction(async (tr) => {
    const d = await charger(ctx, id, tr, true);
    exigerSaisie(ctx, d.type);
    if (d.statut !== 'brouillon') throw new ErreurStock(409, 'Seul un brouillon se modifie.');
    const v = await valeursEntete(ctx, d.type, { ...d, ...body }, tr);
    await X(`UPDATE com_stock_documents SET date_document = :date_document, magasin_id = :magasin_id, magasin_dest_id = :magasin_dest_id,
               motif = :motif, observations = :observations, modifie_le = NOW() WHERE id = :id`, { ...v, id: d.id }, tr);
    const apres = { ...v };
    if (body.lignes !== undefined) apres.nb_lignes = await ecrireLignes(ctx, tr, d, body.lignes);
    await auditer(tr, ctx, 'COM_STOCK_MODIFICATION', d.id, apres);
  });
  return lire(ctx, id);
};

const supprimer = async (ctx, id) => {
  return sequelize.transaction(async (tr) => {
    const d = await charger(ctx, id, tr, true);
    exigerSaisie(ctx, d.type);
    if (d.statut !== 'brouillon') throw new ErreurStock(409, 'Seul un brouillon se supprime ; un document validé s\'annule.');
    await X("UPDATE com_documents SET retire = true, retire_par = :u, retire_le = NOW(), motif_retrait = 'Brouillon supprimé' WHERE objet_type = 'stock_doc' AND objet_id = :d AND NOT retire",
      { u: ctx.userId, d: d.id }, tr);
    await X('DELETE FROM com_stock_documents WHERE id = :d', { d: d.id }, tr);
    await auditer(tr, ctx, 'COM_STOCK_SUPPRESSION', d.id, null, { numero: d.numero, type: d.type });
    return { ok: true };
  });
};

const soumettre = async (ctx, id) => {
  await sequelize.transaction(async (tr) => {
    const d = await charger(ctx, id, tr, true);
    exigerSaisie(ctx, d.type);
    if (d.statut !== 'brouillon') throw new ErreurStock(409, 'Ce document a déjà été soumis.');
    const lignes = await Q('SELECT l.quantite_comptee, a.designation FROM com_stock_doc_lignes l JOIN com_articles a ON a.id = l.article_id WHERE l.document_id = :d', { d: d.id }, tr);
    if (!lignes.length) throw new ErreurStock(400, 'Ajoutez au moins un article.');
    if (['entree', 'sortie'].includes(d.type) && txt(d.motif).length < 3) throw new ErreurStock(400, 'Indiquez le motif : aucun stock ne bouge sans justification.');
    if (d.type === 'inventaire') {
      const manque = lignes.filter((l) => l.quantite_comptee === null);
      if (manque.length) throw new ErreurStock(400, `Quantité comptée manquante : ${manque.slice(0, 5).map((l) => l.designation).join(', ')}${manque.length > 5 ? '…' : ''}.`);
    }
    await X("UPDATE com_stock_documents SET statut = 'a_valider', soumis_le = NOW(), motif_renvoi = '' WHERE id = :d", { d: d.id }, tr);
    await auditer(tr, ctx, 'COM_STOCK_SOUMISSION', d.id, { numero: d.numero });
  });
  return lire(ctx, id);
};

const renvoyer = async (ctx, id, body = {}) => {
  exiger(ctx, 'com.stock.valider', 'valider les documents de stock');
  const motif = txt(body.motif);
  if (motif.length < 3) throw new ErreurStock(400, 'Indiquez ce qu\'il faut corriger.');
  await sequelize.transaction(async (tr) => {
    const d = await charger(ctx, id, tr, true);
    if (d.statut !== 'a_valider') throw new ErreurStock(409, 'Seul un document à valider peut être renvoyé.');
    await X("UPDATE com_stock_documents SET statut = 'brouillon', motif_renvoi = :m WHERE id = :d", { m: motif.slice(0, 500), d: d.id }, tr);
    await auditer(tr, ctx, 'COM_STOCK_RENVOI', d.id, { numero: d.numero, motif });
  });
  return lire(ctx, id);
};

// ── Validation : seule étape qui fait bouger le stock ─────────────────────
const valider = async (ctx, id) => {
  exiger(ctx, 'com.stock.valider', 'valider les documents de stock');
  await sequelize.transaction(async (tr) => {
    const d = await charger(ctx, id, tr, true);
    if (d.statut !== 'a_valider') throw new ErreurStock(409, d.statut === 'brouillon' ? 'Le document doit d\'abord être soumis.' : 'Ce document est déjà traité.');
    const p = await parametres(ctx.tenantId, tr);
    if (d.cree_par === ctx.userId && !p.autovalidation) {
      throw new ErreurStock(403, 'Vous ne pouvez pas valider un document que vous avez saisi : un autre valideur doit le faire.');
    }
    const lignes = await Q('SELECT l.*, a.designation, a.unite AS unite_stock, a.suivi_stock FROM com_stock_doc_lignes l JOIN com_articles a ON a.id = l.article_id WHERE l.document_id = :d ORDER BY l.ordre, l.id',
      { d: d.id }, tr);
    const articles = [...new Set(lignes.map((l) => Number(l.article_id)))].sort((a, b) => a - b);
    for (const a of articles) await moteur.verrouiller(tr, a);    // ordre fixe : pas d'interblocage
    const date = String(d.date_document).slice(0, 10);
    const base = { tenantId: ctx.tenantId, date, documentType: d.type, documentId: Number(d.id), userId: ctx.userId, piece: d.numero, observation: d.motif };
    for (const l of lignes) {
      if (!l.suivi_stock) throw new ErreurStock(409, `« ${l.designation} » n'est plus suivi en stock : retirez-le du document.`);
      const qs = q3(Number(l.quantite) * Number(l.coefficient));
      const m = { ...base, articleId: Number(l.article_id), ligneId: Number(l.id) };
      const disponible = async (mag) => {
        if (p.negatif) return;
        const q = await moteur.quantite(tr, m.articleId, mag);
        if (q + 1e-9 < qs) throw new ErreurStock(409, `Stock insuffisant pour « ${l.designation} » : ${q} ${l.unite_stock} disponible(s), ${qs} demandé(s).`);
      };
      if (d.type === 'entree') {
        await moteur.ecrire(tr, { ...m, magasinId: Number(d.magasin_id), type: 'entree', quantite: qs, cout: Number(l.cout_unitaire) / Number(l.coefficient) });
      } else if (d.type === 'sortie') {
        await disponible(Number(d.magasin_id));
        await moteur.ecrire(tr, { ...m, magasinId: Number(d.magasin_id), type: 'sortie', quantite: qs });
      } else if (d.type === 'transfert') {
        await disponible(Number(d.magasin_id));
        const sortie = await moteur.ecrire(tr, { ...m, magasinId: Number(d.magasin_id), type: 'transfert_sortie', quantite: qs });
        await moteur.ecrire(tr, { ...m, magasinId: Number(d.magasin_dest_id), type: 'transfert_entree', quantite: qs, lieId: sortie });
      } else {
        // Inventaire : le théorique est relevé maintenant ; seul l'écart devient un mouvement.
        const theorique = await moteur.quantite(tr, m.articleId, Number(d.magasin_id));
        await X('UPDATE com_stock_doc_lignes SET quantite_theorique = :q WHERE id = :id', { q: theorique, id: l.id }, tr);
        const ecart = q3(Number(l.quantite_comptee) - theorique);
        if (ecart !== 0) {
          await moteur.ecrire(tr, { ...m, magasinId: Number(d.magasin_id), type: ecart > 0 ? 'inventaire_plus' : 'inventaire_moins', quantite: Math.abs(ecart),
            observation: `${d.motif ? `${d.motif} — ` : ''}théorique ${theorique}, compté ${Number(l.quantite_comptee)}` });
        }
      }
    }
    for (const a of articles) await moteur.rejouer(tr, ctx.tenantId, a);
    await X("UPDATE com_stock_documents SET statut = 'valide', valide_par = :u, valide_le = NOW() WHERE id = :d", { u: ctx.userId, d: d.id }, tr);
    await auditer(tr, ctx, 'COM_STOCK_VALIDATION', d.id, { numero: d.numero, nb_lignes: lignes.length });
  });
  return lire(ctx, id);
};

// ── Annulation : les mouvements restent, marqués annulés ; la valorisation est rejouée ──
const annuler = async (ctx, id, body = {}) => {
  exiger(ctx, 'com.stock.annuler', 'annuler les documents de stock validés');
  const motif = txt(body.motif);
  if (motif.length < 3) throw new ErreurStock(400, 'Indiquez le motif de l\'annulation.');
  await sequelize.transaction(async (tr) => {
    const d = await charger(ctx, id, tr, true);
    if (d.statut !== 'valide') throw new ErreurStock(409, 'Seul un document validé s\'annule.');
    const mvts = await Q('SELECT id, article_id, magasin_id, sens, quantite FROM com_stock_mouvements WHERE document_type = :type AND document_id = :d AND NOT annule',
      { type: d.type, d: d.id }, tr);
    const articles = [...new Set(mvts.map((m) => Number(m.article_id)))].sort((a, b) => a - b);
    for (const a of articles) await moteur.verrouiller(tr, a);
    await X('UPDATE com_stock_mouvements SET annule = true, annule_le = NOW() WHERE document_type = :type AND document_id = :d AND NOT annule', { type: d.type, d: d.id }, tr);
    const p = await parametres(ctx.tenantId, tr);
    if (!p.negatif) {
      for (const m of mvts) {
        const q = await moteur.quantite(tr, Number(m.article_id), Number(m.magasin_id));
        if (q < -1e-9) {
          const [a] = await Q('SELECT designation FROM com_articles WHERE id = :a', { a: m.article_id }, tr);
          throw new ErreurStock(409, `Annulation impossible : le stock de « ${a.designation} » deviendrait négatif (la marchandise a déjà été utilisée).`);
        }
      }
    }
    for (const a of articles) await moteur.rejouer(tr, ctx.tenantId, a);
    await X("UPDATE com_stock_documents SET statut = 'annule', annule_par = :u, annule_le = NOW(), motif_annulation = :m WHERE id = :d",
      { u: ctx.userId, m: motif.slice(0, 500), d: d.id }, tr);
    await auditer(tr, ctx, 'COM_STOCK_ANNULATION', d.id, { numero: d.numero, motif });
  });
  return lire(ctx, id);
};

// Articles à compter pour un inventaire : suivis en stock, avec leur stock théorique actuel.
const articlesInventaire = async (ctx, magasinId, { famille_id = '' } = {}) => {
  exigerSaisie(ctx, 'inventaire');
  const mid = entier(magasinId, 'Magasin');
  if (!perim().dansPerimetre(ctx, mid)) throw new ErreurStock(403, 'Ce magasin n\'appartient pas à vos agences.');
  const rows = await Q(
    `SELECT a.id, a.reference, a.designation, a.unite, f.nom AS famille_nom,
            COALESCE((SELECT SUM(s.sens * s.quantite) FROM com_stock_mouvements s WHERE s.article_id = a.id AND s.magasin_id = :m AND NOT s.annule), 0) AS theorique
       FROM com_articles a JOIN com_familles f ON f.id = a.famille_id
      WHERE a.tenant_id = :t AND a.suivi_stock AND (a.actif OR EXISTS (SELECT 1 FROM com_stock_soldes s WHERE s.article_id = a.id AND s.magasin_id = :m AND s.quantite <> 0))
        AND (:fa = 0 OR a.famille_id = :fa)
      ORDER BY upper(f.nom), upper(a.reference)`, { t: ctx.tenantId, m: mid, fa: Number.parseInt(famille_id, 10) || 0 });
  return rows.map((r) => ({ ...r, id: Number(r.id), theorique: Number(r.theorique) }));
};

// Pièces justificatives (même stockage privé que les demandes).
const joindre = async (ctx, id, body = {}) => {
  const d = await charger(ctx, id);
  if (!['brouillon', 'a_valider'].includes(d.statut)) throw new ErreurStock(409, 'Les pièces d\'un document validé sont figées.');
  if (!ctx.peut(SAISIES[d.type]) && !ctx.peut('com.stock.valider')) throw new ErreurStock(403, 'Permission requise : documents de stock.');
  const f = docs.preparer(body);
  const chemin = await docs.ecrire(ctx.tenantId, 'stock_doc', d.id, f);
  await sequelize.transaction(async (tr) => {
    await X(`INSERT INTO com_documents (tenant_id, objet_type, objet_id, categorie, nom, mime, taille, sha256, chemin, ajoute_par)
             VALUES (:t, 'stock_doc', :d, 'justificatif', :nom, :mime, :taille, :sha, :chemin, :u)`,
    { t: ctx.tenantId, d: d.id, nom: f.nom, mime: f.mime, taille: f.taille, sha: f.sha256, chemin, u: ctx.userId }, tr);
    await auditer(tr, ctx, 'COM_STOCK_PIECE_AJOUT', d.id, { nom: f.nom, sha256: f.sha256 });
  });
  return lire(ctx, d.id);
};
const lirePiece = async (ctx, id, docId) => {
  exigerVue(ctx);
  const d = await charger(ctx, id);
  const [x] = await Q(`SELECT * FROM com_documents WHERE id = :x AND tenant_id = :t AND objet_type = 'stock_doc' AND objet_id = :d AND NOT retire`,
    { x: entier(docId, 'Pièce'), t: ctx.tenantId, d: d.id });
  if (!x) throw new ErreurStock(404, 'Pièce introuvable.');
  return { chemin: docs.resoudre(x.chemin), nom: x.nom, mime: x.mime, sha256: x.sha256 };
};

module.exports = {
  ErreurStock, TYPES, STATUTS, SAISIES, VOIR, lister, compteurs, lire, creer, modifier, supprimer, soumettre, renvoyer, valider, annuler,
  articlesInventaire, joindre, lirePiece,
};
