'use strict';
// NJ COMMERCIAL — livraison B : demandes d'achat et circuit d'autorisation (migration 051).
//
//   brouillon ──soumettre──▶ examen_achats ──approuver──▶ [examen_direction] ──approuver──▶ approuvee
//        ▲                       │  │                          │  │
//        └── a_corriger ◀─renvoyer┘  └─rejeter─▶ rejetee ◀──────┘  └─renvoyer─▶ a_corriger
//   annulee : par l'auteur tant que rien n'est approuvé, par un valideur ensuite (avant bon de commande).
//
// Règles (serveur seul juge) :
//   • personne n'approuve, ne renvoie ni ne rejette SA propre demande ;
//   • la direction n'intervient qu'au-delà du seuil du client (seuil copié à la soumission) ;
//     si le valideur achats a aussi le droit direction, sa décision vaut pour les deux étapes ;
//   • rejet et renvoi exigent un motif ; une demande rejetée est close ;
//   • la demande ne modifie jamais le stock ; le stock constaté est figé à la soumission ;
//   • chaque décision va dans com_decisions (ajout seul), chaque modification dans audit_log.
const { sequelize } = require('../../models');
const { getEffectivePermissions, usersAvecPermission } = require('../permission.service');
const { creerNotification } = require('../notification.service');
const { sendDemandeAchat } = require('../email.service');
const { stockArticle } = require('./referentiel.service');
const docs = require('./documents.service');

const T = sequelize.QueryTypes;
const Q = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: T.SELECT, transaction });
const X = (sql, replacements, transaction) => sequelize.query(sql, { replacements, transaction });

class ErreurDemande extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const STATUTS = {
  brouillon: 'Brouillon', examen_achats: 'En attente d\'autorisation (achats)', examen_direction: 'En attente d\'autorisation (direction)',
  approuvee: 'Approuvée', a_corriger: 'À corriger', rejetee: 'Rejetée', annulee: 'Annulée',
};
const PRIORITES = ['basse', 'normale', 'haute', 'urgente'];
const MODIFIABLES = ['brouillon', 'a_corriger'];
const EN_EXAMEN = ['examen_achats', 'examen_direction'];

const txt = (v) => String(v ?? '').trim();
const entier = (v, nom) => {
  const n = Number.parseInt(v, 10);
  if (!Number.isInteger(n) || n <= 0) throw new ErreurDemande(400, `${nom} invalide.`);
  return n;
};
const quantite = (v) => {
  const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0 || n > 1e12) throw new ErreurDemande(400, 'Chaque quantité doit être un nombre positif.');
  return Math.round(n * 1000) / 1000;
};

// ── Contexte de l'appelant : identité + permissions effectives ───────────
const contexte = async (req) => {
  if (!req.tenantId) throw new ErreurDemande(400, 'Choisissez d\'abord un client.');
  const p = await getEffectivePermissions({ tenantId: req.tenantId, userId: req.user.id, role: req.user.role });
  return { tenantId: req.tenantId, userId: req.user.id, username: req.user.username, peut: (c) => p === null || p.includes(c) };
};

const auditer = (tr, ctx, action, id, avant, apres) => X(
  `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, ancienne_valeur, nouvelle_valeur)
   VALUES (:t, :u, :a, 'commercial', :id, CAST(:av AS jsonb), CAST(:ap AS jsonb))`,
  { t: ctx.tenantId, u: ctx.userId, a: action, id: `DA:${id}`, av: avant ? JSON.stringify(avant) : null, ap: apres ? JSON.stringify(apres) : null }, tr);

// Numéro DA-2026-0001 : compteur par client, type et année, sous verrou de ligne.
const numeroter = async (tr, tenantId, type, prefixe) => {
  const annee = new Date().getFullYear();
  const [r] = await Q(
    `INSERT INTO com_compteurs (tenant_id, type, annee, dernier) VALUES (:t, :type, :a, 1)
     ON CONFLICT (tenant_id, type, annee) DO UPDATE SET dernier = com_compteurs.dernier + 1
     RETURNING dernier`, { t: tenantId, type, a: annee }, tr);
  return `${prefixe}-${annee}-${String(r.dernier).padStart(4, '0')}`;
};

const parametres = async (tenantId, tr) => {
  const [p] = await Q('SELECT * FROM com_parametres WHERE tenant_id = :t', { t: tenantId }, tr);
  return {
    prefixe_da: p?.prefixe_da || 'DA',
    seuil_direction: p ? (p.seuil_direction === null ? null : Number(p.seuil_direction)) : 500000,
    bloquer_si_stock_suffisant: Boolean(p?.bloquer_si_stock_suffisant),
    services: p?.services || [],
  };
};

// Stock d'une ligne pour le magasin de la demande (aucune réservation gérée).
const evaluerStock = async (tenantId, articleId, magasinId, qte) => {
  const s = (await stockArticle(tenantId, articleId, magasinId))[0];
  if (!s || !s.suivi) return { suivi: false, disponible: null, demande: qte, a_approvisionner: null, couvert: false };
  const dispo = Number(s.quantite);
  return { suivi: true, disponible: dispo, demande: qte, a_approvisionner: Math.max(0, Math.round((qte - dispo) * 1000) / 1000), couvert: dispo >= qte, au: s.dernier_mouvement };
};

// ── Lecture ──────────────────────────────────────────────────────────────
const SQL_DEMANDE = `
  SELECT d.*, u.username AS demandeur_nom, m.code AS magasin_code, m.nom AS magasin_nom, m.actif AS magasin_actif,
         f.nom AS fournisseur_nom,
         (SELECT COUNT(*)::int FROM com_demande_lignes l WHERE l.demande_id = d.id) AS nb_lignes,
         (SELECT COUNT(*)::int FROM com_documents x WHERE x.objet_type = 'demande' AND x.objet_id = d.id AND NOT x.retire) AS nb_documents,
         -- Livraison C : avancement de la commande (bons émis) d'une demande approuvée.
         CASE WHEN d.statut <> 'approuvee' THEN NULL
              WHEN NOT EXISTS (SELECT 1 FROM com_demande_lignes l WHERE l.demande_id = d.id AND l.quantite > COALESCE((
                     SELECT SUM(bl.quantite) FROM com_bc_lignes bl JOIN com_bons_commande b ON b.id = bl.bc_id
                      WHERE bl.demande_ligne_id = l.id AND b.statut = 'emis'), 0)) THEN 'commandee'
              WHEN EXISTS (SELECT 1 FROM com_bons_commande b WHERE b.demande_id = d.id AND b.statut = 'emis') THEN 'partielle'
              ELSE 'a_commander' END AS etat_commande
    FROM com_demandes d
    JOIN users u ON u.id = d.demandeur_id
    JOIN com_magasins m ON m.id = d.magasin_id
    LEFT JOIN registre_tiers f ON f.id = d.fournisseur_propose_id`;

const formater = (d) => ({
  ...d, id: Number(d.id), magasin_id: Number(d.magasin_id),
  fournisseur_propose_id: d.fournisseur_propose_id ? Number(d.fournisseur_propose_id) : null,
  montant_estime: Number(d.montant_estime), seuil_applique: d.seuil_applique === null ? null : Number(d.seuil_applique),
  statut_libelle: STATUTS[d.statut], date_demande: String(d.date_demande instanceof Date ? d.date_demande.toISOString() : d.date_demande).slice(0, 10),
});

// Qui voit quoi : ses demandes ; tout avec voir_tout ; sinon celles de sa file d'examen.
const filtreVisibilite = (ctx) => {
  if (ctx.peut('com.da.voir_tout')) return { sql: 'true', r: {} };
  const etapes = [];
  if (ctx.peut('com.da.approuver')) etapes.push('examen_achats');
  if (ctx.peut('com.da.approuver_direction')) etapes.push('examen_direction');
  return {
    // + celles sur lesquelles on a déjà décidé (pour en suivre la suite).
    sql: `(d.demandeur_id = :moi OR EXISTS (SELECT 1 FROM com_decisions cd WHERE cd.demande_id = d.id AND cd.par = :moi)${etapes.length ? ' OR d.statut IN (:etapes)' : ''})`,
    r: { moi: ctx.userId, ...(etapes.length ? { etapes } : {}) },
  };
};

const etapesDe = (ctx) => [
  ...(ctx.peut('com.da.approuver') ? ['examen_achats'] : []),
  ...(ctx.peut('com.da.approuver_direction') ? ['examen_direction'] : []),
];

const lister = async (ctx, { vue = 'toutes', statut = '', q = '', du = '', au = '' } = {}) => {
  const v = filtreVisibilite(ctx);
  const conds = [`d.tenant_id = :t`, v.sql];
  const r = { t: ctx.tenantId, ...v.r };
  if (vue === 'mes') { conds.push('d.demandeur_id = :moi2'); r.moi2 = ctx.userId; }
  if (vue === 'a_examiner') {
    const e = etapesDe(ctx);
    if (!e.length) return [];
    conds.push('d.statut IN (:ex) AND d.demandeur_id <> :moi3'); r.ex = e; r.moi3 = ctx.userId;
  }
  if (statut) {
    if (!STATUTS[statut]) throw new ErreurDemande(400, 'Statut inconnu.');
    conds.push('d.statut = :statut'); r.statut = statut;
  }
  if (txt(q)) {
    conds.push(`(lower(d.numero) LIKE :like OR lower(d.motif) LIKE :like OR lower(d.service) LIKE :like OR lower(u.username) LIKE :like
                 OR EXISTS (SELECT 1 FROM com_demande_lignes l JOIN com_articles a ON a.id = l.article_id
                             WHERE l.demande_id = d.id AND (lower(a.designation) LIKE :like OR lower(a.reference) LIKE :like)))`);
    r.like = `%${txt(q).toLowerCase()}%`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(du)) { conds.push('d.date_demande >= :du'); r.du = du; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(au)) { conds.push('d.date_demande <= :au'); r.au = au; }
  const rows = await Q(`${SQL_DEMANDE} WHERE ${conds.join(' AND ')} ORDER BY d.cree_le DESC LIMIT 500`, r);
  return rows.map(formater);
};

const compteurs = async (ctx) => {
  const e = etapesDe(ctx);
  const [a] = e.length ? await Q(
    'SELECT COUNT(*)::int AS n FROM com_demandes WHERE tenant_id = :t AND statut IN (:e) AND demandeur_id <> :moi',
    { t: ctx.tenantId, e, moi: ctx.userId }) : [{ n: 0 }];
  const [c] = await Q(
    "SELECT COUNT(*)::int AS n FROM com_demandes WHERE tenant_id = :t AND demandeur_id = :moi AND statut = 'a_corriger'",
    { t: ctx.tenantId, moi: ctx.userId });
  // Préparateur des bons : demandes approuvées dont une quantité n'est sur aucun bon actif.
  const [k] = ctx.peut('com.bc.preparer') ? await Q(
    `SELECT COUNT(*)::int AS n FROM com_demandes d WHERE d.tenant_id = :t AND d.statut = 'approuvee'
        AND EXISTS (SELECT 1 FROM com_demande_lignes l WHERE l.demande_id = d.id AND l.quantite > COALESCE((
              SELECT SUM(bl.quantite) FROM com_bc_lignes bl JOIN com_bons_commande b ON b.id = bl.bc_id
               WHERE bl.demande_ligne_id = l.id AND b.statut IN ('brouillon', 'emis')), 0))`, { t: ctx.tenantId }) : [{ n: 0 }];
  return { a_examiner: a.n, a_corriger: c.n, a_commander: k.n };
};

const charger = async (ctx, id, tr, verrou = false) => {
  const v = filtreVisibilite(ctx);
  const [d] = await Q(`${SQL_DEMANDE} WHERE d.tenant_id = :t AND d.id = :id AND ${v.sql}${verrou ? ' FOR UPDATE OF d' : ''}`,
    { t: ctx.tenantId, id: entier(id, 'Demande'), ...v.r }, tr);
  if (!d) throw new ErreurDemande(404, 'Demande introuvable.');
  return formater(d);
};

// Ce que l'appelant peut faire sur cette demande (affiché ET vérifié côté serveur).
const droits = (ctx, d) => {
  const auteur = d.demandeur_id === ctx.userId;
  const etape = d.statut === 'examen_achats' ? 'com.da.approuver' : d.statut === 'examen_direction' ? 'com.da.approuver_direction' : null;
  return {
    modifier: auteur && MODIFIABLES.includes(d.statut),
    soumettre: auteur && MODIFIABLES.includes(d.statut),
    supprimer: auteur && d.statut === 'brouillon' && d.nb_soumissions === 0,
    decider: Boolean(etape) && !auteur && ctx.peut(etape),
    annuler: (auteur && [...MODIFIABLES, ...EN_EXAMEN].includes(d.statut))
      || (!auteur && d.statut === 'approuvee' && ctx.peut('com.da.approuver')),
    joindre: ctx.peut('com.documents.ajouter') && (auteur || ctx.peut('com.da.voir_tout')) && ![ 'rejetee', 'annulee'].includes(d.statut),
    auto_validation_interdite: Boolean(etape) && auteur && ctx.peut(etape),
  };
};

const lire = async (ctx, id) => {
  const d = await charger(ctx, id);
  const lignes = await Q(
    `SELECT l.*, a.reference, a.designation, a.actif AS article_actif, a.famille_id, fa.nom AS famille_nom, r.nom AS fournisseur_nom,
            COALESCE((SELECT json_agg(json_build_object('id', t.id, 'nom', t.nom) ORDER BY lower(t.nom)) FROM (
               SELECT rt.id, rt.nom FROM com_article_fournisseurs af JOIN registre_tiers rt ON rt.id = af.tiers_id WHERE af.article_id = a.id AND rt.actif
               UNION
               SELECT rt.id, rt.nom FROM com_famille_fournisseurs ff JOIN registre_tiers rt ON rt.id = ff.tiers_id WHERE ff.famille_id = a.famille_id AND rt.actif
             ) t), '[]') AS fournisseurs_proposes
       FROM com_demande_lignes l
       JOIN com_articles a ON a.id = l.article_id
       JOIN com_familles fa ON fa.id = a.famille_id
       LEFT JOIN registre_tiers r ON r.id = l.fournisseur_id
      WHERE l.demande_id = :id ORDER BY l.ordre, l.id`, { id: d.id });
  const out = [];
  for (const l of lignes) {
    const qte = Number(l.quantite);
    out.push({
      ...l, id: Number(l.id), article_id: Number(l.article_id), quantite: qte,
      fournisseur_id: l.fournisseur_id ? Number(l.fournisseur_id) : null,
      prix_estime: l.prix_estime === null ? null : Number(l.prix_estime),
      fournisseurs_proposes: l.fournisseurs_proposes.map((f) => ({ ...f, id: Number(f.id) })),
      stock_actuel: await evaluerStock(ctx.tenantId, l.article_id, d.magasin_id, qte),
    });
  }
  const decisions = await Q(
    `SELECT id, etape, decision, par_nom, le, commentaire, statut_avant, statut_apres, montant FROM com_decisions WHERE demande_id = :id ORDER BY le, id`,
    { id: d.id });
  const historique = await Q(
    `SELECT a.created_at AS le, a.action, u.username AS par_nom, a.nouvelle_valeur
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.tenant_id = :t AND a.entite = 'commercial' AND a.entite_id = :e ORDER BY a.created_at, a.id`,
    { t: ctx.tenantId, e: `DA:${d.id}` });
  const documents = await Q(
    `SELECT x.id, x.categorie, x.nom, x.mime, x.taille, x.sha256, x.ajoute_le, u.username AS ajoute_par_nom, x.retire, x.retire_le, x.motif_retrait
       FROM com_documents x LEFT JOIN users u ON u.id = x.ajoute_par
      WHERE x.tenant_id = :t AND x.objet_type = 'demande' AND x.objet_id = :id ORDER BY x.ajoute_le`,
    { t: ctx.tenantId, id: d.id });
  const bons = await require('./bons.service').bonsDeDemande(ctx.tenantId, d.id);
  const resteACommander = d.statut === 'approuvee' && out.some((l) => l.quantite > 0)
    && (await require('./bons.service').restes(ctx.tenantId, d.id)).some((l) => l.reste > 0);
  return {
    ...d, lignes: out, bons,
    decisions: decisions.map((x) => ({ ...x, id: Number(x.id), montant: x.montant === null ? null : Number(x.montant) })),
    historique,
    documents: documents.map((x) => ({ ...x, id: Number(x.id), taille: Number(x.taille) })),
    droits: { ...droits(ctx, d), preparer_bc: resteACommander && ctx.peut('com.bc.preparer') },
  };
};

// ── Saisie (brouillon / à corriger) ──────────────────────────────────────
const valeursEntete = async (ctx, b, tr) => {
  const magasinId = entier(b.magasin_id, 'Magasin');
  const [m] = await Q('SELECT id, actif FROM com_magasins WHERE id = :m AND tenant_id = :t', { m: magasinId, t: ctx.tenantId }, tr);
  if (!m) throw new ErreurDemande(400, 'Magasin inconnu.');
  if (!m.actif) throw new ErreurDemande(400, 'Ce magasin est désactivé.');
  const priorite = txt(b.priorite) || 'normale';
  if (!PRIORITES.includes(priorite)) throw new ErreurDemande(400, 'Priorité inconnue.');
  let fournisseur = null;
  if (b.fournisseur_propose_id) {
    fournisseur = entier(b.fournisseur_propose_id, 'Fournisseur');
    await verifierFournisseur(ctx, fournisseur, tr);
  }
  const champ = (v, max, nom) => { const s = txt(v); if (s.length > max) throw new ErreurDemande(400, `${nom} : ${max} caractères au plus.`); return s; };
  return {
    magasin_id: magasinId, priorite, fournisseur_propose_id: fournisseur,
    service: champ(b.service, 120, 'Service'), motif: champ(b.motif, 2000, 'Motif'),
    commentaire: champ(b.commentaire, 2000, 'Commentaire'), justification_stock: champ(b.justification_stock, 1000, 'Justification'),
  };
};

const verifierFournisseur = async (ctx, id, tr) => {
  const [f] = await Q(`SELECT id FROM registre_tiers WHERE id = :f AND tenant_id = :t AND actif AND type IN ('fournisseur', 'mixte')`,
    { f: id, t: ctx.tenantId }, tr);
  if (!f) throw new ErreurDemande(400, 'Fournisseur inconnu, inactif ou qui n\'est pas un fournisseur.');
};

const ecrireLignes = async (ctx, tr, demandeId, lignes) => {
  if (!Array.isArray(lignes)) throw new ErreurDemande(400, 'Liste d\'articles invalide.');
  if (lignes.length > 200) throw new ErreurDemande(400, '200 articles au plus par demande.');
  await X('DELETE FROM com_demande_lignes WHERE demande_id = :d', { d: demandeId }, tr);
  const vus = new Set();
  for (const [i, l] of lignes.entries()) {
    const aid = entier(l.article_id, 'Article');
    if (vus.has(aid)) throw new ErreurDemande(400, 'Un même article figure deux fois : regroupez les quantités sur une seule ligne.');
    vus.add(aid);
    const [a] = await Q('SELECT id, actif, unite, prix_achat_indicatif, designation FROM com_articles WHERE id = :a AND tenant_id = :t', { a: aid, t: ctx.tenantId }, tr);
    if (!a) throw new ErreurDemande(400, 'Article inconnu.');
    if (!a.actif) throw new ErreurDemande(400, `L'article « ${a.designation} » est désactivé.`);
    let fid = null;
    if (l.fournisseur_id) { fid = entier(l.fournisseur_id, 'Fournisseur'); await verifierFournisseur(ctx, fid, tr); }
    const commentaire = txt(l.commentaire);
    if (commentaire.length > 500) throw new ErreurDemande(400, 'Commentaire de ligne : 500 caractères au plus.');
    await X(`INSERT INTO com_demande_lignes (demande_id, tenant_id, ordre, article_id, quantite, unite, fournisseur_id, prix_estime, commentaire)
             VALUES (:d, :t, :o, :a, :q, :u, :f, :p, :c)`,
    { d: demandeId, t: ctx.tenantId, o: i, a: aid, q: quantite(l.quantite), u: a.unite, f: fid, p: a.prix_achat_indicatif, c: commentaire }, tr);
  }
  return lignes.length;
};

const creer = async (ctx, body) => {
  if (!ctx.peut('com.da.creer')) throw new ErreurDemande(403, 'Permission requise : créer des demandes d\'achat.');
  const id = await sequelize.transaction(async (tr) => {
    const v = await valeursEntete(ctx, body, tr);
    const p = await parametres(ctx.tenantId, tr);
    const numero = await numeroter(tr, ctx.tenantId, 'DA', p.prefixe_da);
    const [r] = await Q(
      `INSERT INTO com_demandes (tenant_id, numero, demandeur_id, service, magasin_id, motif, priorite, fournisseur_propose_id, commentaire, justification_stock)
       VALUES (:t, :numero, :u, :service, :magasin_id, :motif, :priorite, :fournisseur_propose_id, :commentaire, :justification_stock) RETURNING id`,
      { ...v, t: ctx.tenantId, numero, u: ctx.userId }, tr);
    const nb = await ecrireLignes(ctx, tr, r.id, body.lignes || []);
    await auditer(tr, ctx, 'COM_DA_CREATION', r.id, null, { numero, ...v, nb_lignes: nb });
    return Number(r.id);
  });
  return lire(ctx, id);
};

const modifier = async (ctx, id, body) => {
  await sequelize.transaction(async (tr) => {
    const d = await charger(ctx, id, tr, true);
    if (!droits(ctx, d).modifier) throw new ErreurDemande(409, d.demandeur_id === ctx.userId
      ? `Demande ${STATUTS[d.statut].toLowerCase()} : elle n'est plus modifiable.` : 'Seul le demandeur peut modifier sa demande.');
    const v = await valeursEntete(ctx, { ...d, ...body }, tr);
    await X(`UPDATE com_demandes SET service = :service, magasin_id = :magasin_id, motif = :motif, priorite = :priorite,
               fournisseur_propose_id = :fournisseur_propose_id, commentaire = :commentaire, justification_stock = :justification_stock,
               modifie_le = NOW() WHERE id = :id`, { ...v, id: d.id }, tr);
    let nb = null;
    if (body.lignes !== undefined) nb = await ecrireLignes(ctx, tr, d.id, body.lignes);
    const avant = {}; const apres = {};
    for (const k of Object.keys(v)) if (String(d[k] ?? '') !== String(v[k] ?? '')) { avant[k] = d[k]; apres[k] = v[k]; }
    if (nb !== null) apres.nb_lignes = nb;
    await auditer(tr, ctx, 'COM_DA_MODIFICATION', d.id, avant, apres);
  });
  return lire(ctx, id);
};

const supprimer = async (ctx, id) => sequelize.transaction(async (tr) => {
  const d = await charger(ctx, id, tr, true);
  if (!droits(ctx, d).supprimer) throw new ErreurDemande(409, 'Seul un brouillon jamais soumis peut être supprimé par son auteur ; sinon, annulez la demande.');
  await X('DELETE FROM com_demandes WHERE id = :id', { id: d.id }, tr);
  await auditer(tr, ctx, 'COM_DA_SUPPRESSION', d.id, { numero: d.numero }, null);
  return { ok: true };
});

// ── Circuit ──────────────────────────────────────────────────────────────
const decision = (tr, ctx, d, etape, dec, apres, commentaire = '', montant = null) => X(
  `INSERT INTO com_decisions (tenant_id, demande_id, etape, decision, par, par_nom, commentaire, statut_avant, statut_apres, montant)
   VALUES (:t, :d, :e, :dec, :u, :n, :c, :av, :ap, :m)`,
  { t: ctx.tenantId, d: d.id, e: etape, dec, u: ctx.userId, n: ctx.username, c: commentaire, av: d.statut, ap: apres, m: montant }, tr);

const soumettre = async (ctx, id, body = {}) => {
  const res = await sequelize.transaction(async (tr) => {
    const d = await charger(ctx, id, tr, true);
    if (!droits(ctx, d).soumettre) throw new ErreurDemande(409, d.demandeur_id === ctx.userId
      ? `Demande ${STATUTS[d.statut].toLowerCase()} : elle ne peut pas être soumise.` : 'Seul le demandeur peut soumettre sa demande.');
    if (body.justification_stock !== undefined) {
      const j = txt(body.justification_stock);
      if (j.length > 1000) throw new ErreurDemande(400, 'Justification : 1000 caractères au plus.');
      await X('UPDATE com_demandes SET justification_stock = :j WHERE id = :id', { j, id: d.id }, tr);
      d.justification_stock = j;
    }
    const manque = [];
    if (txt(d.motif).length < 3) manque.push('le motif de la demande');
    if (!d.magasin_actif) manque.push('un magasin actif');
    const lignes = await Q(
      `SELECT l.id, l.article_id, l.quantite, l.prix_estime, a.actif, a.designation FROM com_demande_lignes l
         JOIN com_articles a ON a.id = l.article_id WHERE l.demande_id = :id ORDER BY l.ordre`, { id: d.id }, tr);
    if (!lignes.length) manque.push('au moins un article');
    if (manque.length) throw new ErreurDemande(400, `Pour soumettre, indiquez ${manque.join(', ')}.`);
    const inactif = lignes.find((l) => !l.actif);
    if (inactif) throw new ErreurDemande(400, `L'article « ${inactif.designation} » a été désactivé : retirez-le de la demande.`);

    const p = await parametres(ctx.tenantId, tr);
    let montant = 0; let incomplet = false; const couverts = [];
    for (const l of lignes) {
      const qte = Number(l.quantite);
      const s = await evaluerStock(ctx.tenantId, l.article_id, d.magasin_id, qte);
      await X('UPDATE com_demande_lignes SET stock_constate = CAST(:s AS jsonb) WHERE id = :id',
        { s: JSON.stringify({ ...s, au: new Date().toISOString() }), id: l.id }, tr);
      if (s.couvert) couverts.push(l.designation);
      if (l.prix_estime === null) incomplet = true; else montant += qte * Number(l.prix_estime);
    }
    montant = Math.round(montant * 100) / 100;
    if (couverts.length && p.bloquer_si_stock_suffisant && txt(d.justification_stock).length < 5) {
      throw new ErreurDemande(409, `Le stock du magasin couvre déjà le besoin pour : ${couverts.join(', ')}. `
        + 'Justifiez le réapprovisionnement (champ « Justification ») ou retirez ces articles.');
    }
    const direction = p.seuil_direction !== null && montant >= p.seuil_direction;
    await X(`UPDATE com_demandes SET statut = 'examen_achats', montant_estime = :m, montant_incomplet = :inc, direction_requise = :dir,
               seuil_applique = :seuil, nb_soumissions = nb_soumissions + 1, soumise_le = NOW(), decidee_le = NULL, modifie_le = NOW()
             WHERE id = :id`, { m: montant, inc: incomplet, dir: direction, seuil: p.seuil_direction, id: d.id }, tr);
    await decision(tr, ctx, d, 'demandeur', 'soumise', 'examen_achats', d.nb_soumissions > 0 ? 'Nouvelle soumission après correction' : '', montant);
    return { id: d.id, couverts, montant, direction };
  });
  const lu = await lire(ctx, res.id);
  await notifier(ctx, lu, 'com.da.approuver', `Demande d'achat à examiner — ${lu.numero}`,
    `${lu.demandeur_nom} a soumis la demande ${lu.numero} (${lu.lignes.length} article${lu.lignes.length > 1 ? 's' : ''}).`);
  return { ...lu, stock_couvert: res.couverts };
};

const ETAPE = { examen_achats: ['achats', 'com.da.approuver'], examen_direction: ['direction', 'com.da.approuver_direction'] };

const decider = async (ctx, id, body = {}) => {
  const choix = txt(body.decision);
  if (!['approuver', 'renvoyer', 'rejeter'].includes(choix)) throw new ErreurDemande(400, 'Décision inconnue (approuver, renvoyer ou rejeter).');
  const commentaire = txt(body.commentaire);
  if (commentaire.length > 2000) throw new ErreurDemande(400, 'Commentaire : 2000 caractères au plus.');
  if (choix !== 'approuver' && commentaire.length < 3) throw new ErreurDemande(400, choix === 'rejeter' ? 'Indiquez le motif du rejet.' : 'Indiquez ce qu\'il faut corriger.');
  const res = await sequelize.transaction(async (tr) => {
    const d = await charger(ctx, id, tr, true);
    const etape = ETAPE[d.statut];
    if (!etape) throw new ErreurDemande(409, `Demande ${STATUTS[d.statut].toLowerCase()} : aucune décision attendue.`);
    if (d.demandeur_id === ctx.userId) throw new ErreurDemande(403, 'Vous ne pouvez pas décider sur votre propre demande.');
    if (!ctx.peut(etape[1])) throw new ErreurDemande(403, d.statut === 'examen_achats'
      ? 'Permission requise : approuver les demandes (étape achats).' : 'Permission requise : approuver les demandes (étape direction).');
    let apres; let nomEtape = etape[0];
    if (choix === 'rejeter') apres = 'rejetee';
    else if (choix === 'renvoyer') apres = 'a_corriger';
    else if (d.statut === 'examen_achats' && d.direction_requise) {
      // Un valideur qui a aussi le droit direction règle les deux étapes d'un coup.
      if (ctx.peut('com.da.approuver_direction')) { apres = 'approuvee'; nomEtape = 'achats_direction'; } else apres = 'examen_direction';
    } else apres = 'approuvee';
    await X(`UPDATE com_demandes SET statut = :s, decidee_le = CASE WHEN :s IN ('approuvee', 'rejetee') THEN NOW() ELSE decidee_le END,
               modifie_le = NOW() WHERE id = :id`, { s: apres, id: d.id }, tr);
    await decision(tr, ctx, d, nomEtape, { approuver: 'approuvee', renvoyer: 'renvoyee', rejeter: 'rejetee' }[choix], apres, commentaire, d.montant_estime);
    return { id: d.id, apres };
  });
  const lu = await lire(ctx, res.id);
  if (res.apres === 'examen_direction') {
    await notifier(ctx, lu, 'com.da.approuver_direction', `Demande d'achat à autoriser (direction) — ${lu.numero}`,
      `La demande ${lu.numero} de ${lu.demandeur_nom} a été approuvée par les achats ; son montant estimé dépasse le seuil de la direction.`);
  } else if (res.apres === 'approuvee') {
    await notifier(ctx, lu, 'com.bc.preparer', `Demande d'achat approuvée — ${lu.numero}`,
      `La demande ${lu.numero} est approuvée : le bon de commande peut être préparé.`);
  }
  const msg = { approuvee: 'a été approuvée', examen_direction: 'a été approuvée par les achats et passe à la direction',
    a_corriger: `vous est renvoyée pour correction : ${commentaire}`, rejetee: `a été rejetée : ${commentaire}` }[res.apres];
  await notifierAuteur(ctx, lu, `Votre demande ${lu.numero} ${msg}`);
  return lu;
};

const annuler = async (ctx, id, body = {}) => {
  const motif = txt(body.motif);
  const res = await sequelize.transaction(async (tr) => {
    const d = await charger(ctx, id, tr, true);
    if (!droits(ctx, d).annuler) throw new ErreurDemande(409, `Demande ${STATUTS[d.statut].toLowerCase()} : vous ne pouvez pas l'annuler.`);
    const [bc] = await Q("SELECT numero_complet, statut FROM com_bons_commande WHERE demande_id = :d AND statut IN ('brouillon', 'emis') LIMIT 1", { d: d.id }, tr);
    if (bc) throw new ErreurDemande(409, bc.statut === 'emis'
      ? `Le bon de commande ${bc.numero_complet} a été émis : annulez d'abord le bon.` : 'Un bon de commande est en préparation pour cette demande : supprimez-le d\'abord.');
    if (motif.length < 3) throw new ErreurDemande(400, 'Indiquez le motif de l\'annulation.');
    if (motif.length > 2000) throw new ErreurDemande(400, 'Motif : 2000 caractères au plus.');
    await X(`UPDATE com_demandes SET statut = 'annulee', decidee_le = NOW(), modifie_le = NOW() WHERE id = :id`, { id: d.id }, tr);
    await decision(tr, ctx, d, d.demandeur_id === ctx.userId ? 'demandeur' : 'valideur', 'annulee', 'annulee', motif);
    return d;
  });
  const lu = await lire(ctx, res.id);
  if (res.demandeur_id !== ctx.userId) await notifierAuteur(ctx, lu, `Votre demande ${lu.numero} a été annulée : ${motif}`);
  return lu;
};

// ── Pièces justificatives ────────────────────────────────────────────────
const joindre = async (ctx, id, body = {}) => {
  const d = await charger(ctx, id);
  if (!droits(ctx, d).joindre) throw new ErreurDemande(403, 'Vous ne pouvez pas joindre de pièce à cette demande.');
  const f = docs.preparer(body);
  const chemin = await docs.ecrire(ctx.tenantId, 'demande', d.id, f);
  await sequelize.transaction(async (tr) => {
    await X(`INSERT INTO com_documents (tenant_id, objet_type, objet_id, categorie, nom, mime, taille, sha256, chemin, ajoute_par)
             VALUES (:t, 'demande', :id, 'justificatif', :nom, :mime, :taille, :sha, :chemin, :u)`,
    { t: ctx.tenantId, id: d.id, nom: f.nom, mime: f.mime, taille: f.taille, sha: f.sha256, chemin, u: ctx.userId }, tr);
    await auditer(tr, ctx, 'COM_DA_PIECE_AJOUT', d.id, null, { nom: f.nom, taille: f.taille, sha256: f.sha256 });
  });
  return lire(ctx, d.id);
};

const retirerPiece = async (ctx, id, docId, body = {}) => {
  const d = await charger(ctx, id);
  const motif = txt(body.motif);
  await sequelize.transaction(async (tr) => {
    const [x] = await Q(`SELECT * FROM com_documents WHERE id = :x AND tenant_id = :t AND objet_type = 'demande' AND objet_id = :d FOR UPDATE`,
      { x: entier(docId, 'Pièce'), t: ctx.tenantId, d: d.id }, tr);
    if (!x) throw new ErreurDemande(404, 'Pièce introuvable.');
    if (x.retire) throw new ErreurDemande(409, 'Cette pièce est déjà retirée.');
    const auteurPiece = x.ajoute_par === ctx.userId;
    if (!(auteurPiece && MODIFIABLES.includes(d.statut))) {
      throw new ErreurDemande(403, 'Une pièce ne peut être retirée que par la personne qui l\'a jointe, tant que la demande est modifiable.');
    }
    if (motif.length < 3) throw new ErreurDemande(400, 'Indiquez le motif du retrait.');
    await X('UPDATE com_documents SET retire = true, retire_par = :u, retire_le = NOW(), motif_retrait = :m WHERE id = :x',
      { u: ctx.userId, m: motif, x: x.id }, tr);
    await auditer(tr, ctx, 'COM_DA_PIECE_RETRAIT', d.id, { nom: x.nom }, { motif });
  });
  return lire(ctx, d.id);
};

const lirePiece = async (ctx, id, docId) => {
  const d = await charger(ctx, id);
  const [x] = await Q(`SELECT * FROM com_documents WHERE id = :x AND tenant_id = :t AND objet_type = 'demande' AND objet_id = :d`,
    { x: entier(docId, 'Pièce'), t: ctx.tenantId, d: d.id });
  if (!x) throw new ErreurDemande(404, 'Pièce introuvable.');
  return { chemin: docs.resoudre(x.chemin), nom: x.nom, mime: x.mime, sha256: x.sha256 };
};

// ── Notifications (cloche + e-mail selon le canal de chacun) ─────────────
const lienDemande = (id) => {
  const base = String(process.env.APP_URL || '').split(',')[0].trim().replace(/\/$/, '');
  return base ? `${base}/commercial/demandes/${id}` : '';
};
const resumeEmail = (d) => ({
  numero: d.numero, date: new Date(d.date_demande).toLocaleDateString('fr-FR'), demandeur: d.demandeur_nom, service: d.service,
  magasin: `${d.magasin_code} — ${d.magasin_nom}`, fournisseur: d.fournisseur_nom || (d.lignes.find((l) => l.fournisseur_nom)?.fournisseur_nom) || '',
  motif: d.motif, statut: d.statut_libelle, montant: d.montant_incomplet ? null : d.montant_estime,
});

const envoyerA = async (ctx, users, d, titre, message) => {
  const [t] = await Q('SELECT nom FROM tenants WHERE id = :t', { t: ctx.tenantId });
  for (const u of users) {
    await creerNotification({ tenantId: ctx.tenantId, destinataireId: u.id, type: 'com_demande', titre, message, refType: 'com_demande', refId: d.id });
    const canal = u.canal_notif || 'email';
    if (u.email && !['aucun', 'plateforme'].includes(canal)) {
      const r = await sendDemandeAchat({
        to: u.email, nom: u.username, tenantNom: t?.nom || '', titre, intro: message, demande: resumeEmail(d),
        lignes: d.lignes.map((l) => ({ article: `${l.reference} — ${l.designation}`, quantite: l.quantite, unite: l.unite })), lien: lienDemande(d.id),
      }).catch((e) => ({ statut: 'non_envoye', erreur: e.message }));
      if (r.statut !== 'envoye') console.warn(`[Commercial] e-mail ${d.numero} → ${u.email} : ${r.erreur || r.statut}`);
    }
  }
};

// Best-effort : une notification qui échoue n'annule jamais la décision.
const notifier = async (ctx, d, permission, titre, message) => {
  try {
    const users = (await usersAvecPermission(ctx.tenantId, permission)).filter((u) => u.id !== d.demandeur_id && u.id !== ctx.userId);
    await envoyerA(ctx, users, d, titre, message);
  } catch (e) { console.warn('[Commercial] notification :', e.message); }
};
const notifierAuteur = async (ctx, d, message) => {
  try {
    if (d.demandeur_id === ctx.userId) return;
    const [u] = await Q('SELECT id, username, email, canal_notif FROM users WHERE id = :u AND actif', { u: d.demandeur_id });
    if (u) await envoyerA(ctx, [u], d, message, message);
  } catch (e) { console.warn('[Commercial] notification demandeur :', e.message); }
};

module.exports = {
  ErreurDemande, STATUTS, contexte, lister, compteurs, lire, creer, modifier, supprimer, soumettre, decider, annuler,
  joindre, retirerPiece, lirePiece, evaluerStock,
};
