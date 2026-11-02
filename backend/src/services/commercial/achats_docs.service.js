'use strict';
// NJ COMMERCIAL — lot 5 : documents d'achat (migration 058).
//
//   Réception   : sur un bon de commande émis ; partielle, plusieurs par bon ;
//                 jamais au-delà du reste à recevoir sans motif ; à la validation,
//                 mouvements « réception » au prix net du bon, hors taxes, par
//                 unité de stock.
//   Retour      : depuis une réception validée ; au plus le reçu non encore
//                 retourné ; sortie au coût de la réception d'origine.
//   Facture     : depuis les réceptions validées d'un fournisseur ; rapprochement
//                 commande / réception / facture (quantités et prix) ; un écart
//                 au-delà de la tolérance exige un motif. Validée = bon à payer.
//   Avoir       : sur une facture validée ; jamais plus que la facture d'origine.
//
//   Circuit commun : brouillon → à valider → validé → annulé (motivé). L'auteur ne
//   valide pas (sauf auto-validation des stocks activée). Seule la validation d'une
//   réception ou d'un retour fait bouger le stock. Aucune écriture comptable ; les
//   règlements se saisissent dans NJ CAISSE PRO.
const { sequelize } = require('../../models');
const moteur = require('./stock.service');
const docs = require('./documents.service');

const T = sequelize.QueryTypes;
const Q = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: T.SELECT, transaction });
const X = (sql, replacements, transaction) => sequelize.query(sql, { replacements, transaction });
const perim = () => require('./demandes.service');

class ErreurAchat extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const STATUTS = { brouillon: 'Brouillon', a_valider: 'À valider', valide: 'Validé', annule: 'Annulé' };
const SORTES = {
  reception: { table: 'com_receptions', lignes: 'com_reception_lignes', fk: 'reception_id', objet: 'reception', audit: 'RC',
    saisir: 'com.receptions.saisir', valider: 'com.receptions.valider', annuler: 'com.receptions.annuler', nom: 'réception' },
  retour: { table: 'com_retours_fournisseurs', lignes: 'com_retour_fourn_lignes', fk: 'retour_id', objet: 'retour_fourn', audit: 'RF',
    saisir: 'com.retours_fourn.saisir', valider: 'com.retours_fourn.valider', annuler: 'com.receptions.annuler', nom: 'retour fournisseur' },
  facture: { table: 'com_factures_fournisseurs', lignes: 'com_facture_fourn_lignes', fk: 'facture_id', objet: 'facture_fourn', audit: 'FF',
    saisir: 'com.factures_fourn.saisir', valider: 'com.factures_fourn.valider', annuler: 'com.factures_fourn.annuler', nom: 'facture fournisseur' },
};
// Qui voit les réceptions et les retours : qui les traite, qui commande, qui facture, qui suit le stock.
const VOIR_RECEPTIONS = ['com.receptions.saisir', 'com.receptions.valider', 'com.receptions.annuler', 'com.retours_fourn.saisir',
  'com.retours_fourn.valider', 'com.bc.preparer', 'com.bc.emettre', 'com.da.voir_tout', 'com.factures_fourn.voir',
  'com.factures_fourn.saisir', 'com.factures_fourn.valider', 'com.stock.journal'];
const VOIR_FACTURES = ['com.factures_fourn.voir', 'com.factures_fourn.saisir', 'com.factures_fourn.valider', 'com.factures_fourn.annuler'];

const txt = (v) => String(v ?? '').trim();
const q3 = (n) => Math.round(n * 1000) / 1000;
const m2 = (n) => Math.round(n * 100) / 100;
const c6 = (n) => Math.round(n * 1e6) / 1e6;
const entier = (v, nom) => {
  const n = Number.parseInt(v, 10);
  if (!Number.isInteger(n) || n <= 0) throw new ErreurAchat(400, `${nom} invalide.`);
  return n;
};
const nombre = (v, nom, { vide = null, max = 1e12 } = {}) => {
  if (v === undefined || v === null || txt(v) === '') return vide;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > max) throw new ErreurAchat(400, `${nom} invalide.`);
  return n;
};
const dateOk = (v, nom, { requise = true } = {}) => {
  const d = txt(v);
  if (!d) { if (requise) throw new ErreurAchat(400, `${nom} obligatoire.`); return null; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) throw new ErreurAchat(400, `${nom} invalide (AAAA-MM-JJ).`);
  return d;
};
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const pasFutur = (d, nom) => { if (d && d > aujourdhui()) throw new ErreurAchat(400, `${nom} ne peut pas être dans le futur.`); return d; };
const longueur = (v, max, nom) => { const s = txt(v); if (s.length > max) throw new ErreurAchat(400, `${nom} : ${max} caractères au plus.`); return s; };

const exiger = (ctx, code, libelle) => { if (!ctx.peut(code)) throw new ErreurAchat(403, `Permission requise : ${libelle}.`); };
const exigerUn = (ctx, codes, libelle) => { if (!codes.some((c) => ctx.peut(c))) throw new ErreurAchat(403, `Permission requise : ${libelle}.`); };

const auditer = (tr, ctx, sorte, action, id, apres) => X(
  `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, nouvelle_valeur)
   VALUES (:t, :u, :a, 'commercial', :id, CAST(:ap AS jsonb))`,
  { t: ctx.tenantId, u: ctx.userId, a: action, id: `${SORTES[sorte].audit}:${id}`, ap: apres ? JSON.stringify(apres) : null }, tr);

const numeroter = async (tr, tenantId, prefixe) => {
  const annee = new Date().getFullYear();
  const [r] = await Q(
    `INSERT INTO com_compteurs (tenant_id, type, annee, dernier) VALUES (:t, :type, :a, 1)
     ON CONFLICT (tenant_id, type, annee) DO UPDATE SET dernier = com_compteurs.dernier + 1 RETURNING dernier`,
    { t: tenantId, type: prefixe, a: annee }, tr);
  return `${prefixe}-${annee}-${String(r.dernier).padStart(4, '0')}`;
};

const parametres = async (tenantId, tr) => {
  const [p] = await Q('SELECT stock_negatif_autorise, autovalidation_stock, tolerance_ecart_pct FROM com_parametres WHERE tenant_id = :t', { t: tenantId }, tr);
  const [t] = await Q('SELECT devise FROM tenants WHERE id = :t', { t: tenantId }, tr);
  return { negatif: Boolean(p?.stock_negatif_autorise), autovalidation: Boolean(p?.autovalidation_stock),
    tolerance: p?.tolerance_ecart_pct === null || p?.tolerance_ecart_pct === undefined ? 10 : Number(p.tolerance_ecart_pct), devise: t?.devise || 'FCFA' };
};

// Décimales autorisées par l'unité d'une ligne.
const verifierDecimales = async (tr, uniteId, q, libelle, unite) => {
  if (!uniteId) return;
  const [u] = await Q('SELECT decimales FROM com_unites WHERE id = :u', { u: uniteId }, tr);
  const dec = 10 ** Number(u?.decimales ?? 3);
  if (Math.round(q * dec) !== q * dec) {
    throw new ErreurAchat(400, `« ${libelle} » : quantité en ${unite}, ${Number(u?.decimales) ? `${u.decimales} décimale(s) au plus` : 'nombre entier'}.`);
  }
};

// ── Chargement commun ────────────────────────────────────────────────────
const SQL = {
  reception: `SELECT d.*, f.nom AS fournisseur_nom, m.code AS magasin_code, m.nom AS magasin_nom, b.numero_complet AS bc_numero, b.statut AS bc_statut,
                     uc.username AS cree_par_nom, uv.username AS valide_par_nom, ua.username AS annule_par_nom,
                     (SELECT COUNT(*)::int FROM com_reception_lignes l WHERE l.reception_id = d.id) AS nb_lignes
                FROM com_receptions d JOIN registre_tiers f ON f.id = d.fournisseur_id JOIN com_magasins m ON m.id = d.magasin_id
                JOIN com_bons_commande b ON b.id = d.bc_id
                LEFT JOIN users uc ON uc.id = d.cree_par LEFT JOIN users uv ON uv.id = d.valide_par LEFT JOIN users ua ON ua.id = d.annule_par`,
  retour: `SELECT d.*, f.nom AS fournisseur_nom, m.code AS magasin_code, m.nom AS magasin_nom, r.numero AS reception_numero,
                  uc.username AS cree_par_nom, uv.username AS valide_par_nom, ua.username AS annule_par_nom,
                  (SELECT COUNT(*)::int FROM com_retour_fourn_lignes l WHERE l.retour_id = d.id) AS nb_lignes
             FROM com_retours_fournisseurs d JOIN registre_tiers f ON f.id = d.fournisseur_id JOIN com_magasins m ON m.id = d.magasin_id
             JOIN com_receptions r ON r.id = d.reception_id
             LEFT JOIN users uc ON uc.id = d.cree_par LEFT JOIN users uv ON uv.id = d.valide_par LEFT JOIN users ua ON ua.id = d.annule_par`,
  facture: `SELECT d.*, f.nom AS fournisseur_nom, o.numero AS origine_numero, o.reference_fournisseur AS origine_reference, rt.numero AS retour_numero,
                   uc.username AS cree_par_nom, uv.username AS valide_par_nom, ua.username AS annule_par_nom,
                   (SELECT COUNT(*)::int FROM com_facture_fourn_lignes l WHERE l.facture_id = d.id) AS nb_lignes,
                   -- Magasins concernés (périmètre) : ceux des réceptions facturées.
                   (SELECT COALESCE(array_agg(DISTINCT r.magasin_id), '{}') FROM com_facture_fourn_lignes l
                      LEFT JOIN com_facture_fourn_lignes lo ON lo.id = l.facture_ligne_origine_id
                      JOIN com_reception_lignes rl ON rl.id = COALESCE(l.reception_ligne_id, lo.reception_ligne_id)
                      JOIN com_receptions r ON r.id = rl.reception_id WHERE l.facture_id = d.id) AS magasins
              FROM com_factures_fournisseurs d JOIN registre_tiers f ON f.id = d.fournisseur_id
              LEFT JOIN com_factures_fournisseurs o ON o.id = d.facture_origine_id
              LEFT JOIN com_retours_fournisseurs rt ON rt.id = d.retour_id
              LEFT JOIN users uc ON uc.id = d.cree_par LEFT JOIN users uv ON uv.id = d.valide_par LEFT JOIN users ua ON ua.id = d.annule_par`,
};
const dansPerimetre = (ctx, sorte, d) => (sorte === 'facture'
  ? (d.magasins || []).every((m) => perim().dansPerimetre(ctx, Number(m)))
  : perim().dansPerimetre(ctx, Number(d.magasin_id)));
const peutVoir = (ctx, sorte) => (sorte === 'facture' ? VOIR_FACTURES : VOIR_RECEPTIONS).some((c) => ctx.peut(c));

const charger = async (ctx, sorte, id, tr, verrou = false) => {
  const [d] = await Q(`${SQL[sorte]} WHERE d.tenant_id = :t AND d.id = :id${verrou ? ' FOR UPDATE OF d' : ''}`, { t: ctx.tenantId, id: entier(id, 'Document') }, tr);
  if (!d || !dansPerimetre(ctx, sorte, d)) throw new ErreurAchat(404, `${SORTES[sorte].nom[0].toUpperCase()}${SORTES[sorte].nom.slice(1)} introuvable.`);
  return d;
};
const formater = (d) => {
  const out = { ...d, id: Number(d.id), statut_libelle: STATUTS[d.statut] };
  for (const k of ['bc_id', 'fournisseur_id', 'magasin_id', 'reception_id', 'facture_origine_id', 'retour_id']) if (d[k] !== undefined) out[k] = d[k] === null ? null : Number(d[k]);
  for (const k of ['total_ht', 'total_taxes', 'total_ttc']) if (d[k] !== undefined) out[k] = Number(d[k]);
  delete out.magasins;
  return out;
};

const lister = async (ctx, sorte, { statut = '', q = '', du = '', au = '', type = '', fournisseur_id = '', bc_id = '' } = {}) => {
  if (!peutVoir(ctx, sorte)) throw new ErreurAchat(403, `Permission requise : consulter les ${sorte === 'facture' ? 'factures fournisseurs' : 'réceptions'}.`);
  const conds = ['d.tenant_id = :t']; const r = { t: ctx.tenantId };
  if (statut) { if (!STATUTS[statut]) throw new ErreurAchat(400, 'Statut inconnu.'); conds.push('d.statut = :statut'); r.statut = statut; }
  const champDate = { reception: 'd.date_reception', retour: 'd.date_retour', facture: 'd.date_facture' }[sorte];
  if (/^\d{4}-\d{2}-\d{2}$/.test(du)) { conds.push(`${champDate} >= :du`); r.du = du; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(au)) { conds.push(`${champDate} <= :au`); r.au = au; }
  if (sorte === 'facture' && ['facture', 'avoir'].includes(type)) { conds.push('d.type = :type'); r.type = type; }
  if (Number.parseInt(fournisseur_id, 10)) { conds.push('d.fournisseur_id = :f'); r.f = Number.parseInt(fournisseur_id, 10); }
  if (sorte === 'reception' && Number.parseInt(bc_id, 10)) { conds.push('d.bc_id = :bc'); r.bc = Number.parseInt(bc_id, 10); }
  if (txt(q)) {
    r.like = `%${txt(q).toLowerCase()}%`;
    conds.push(sorte === 'facture'
      ? '(lower(d.numero) LIKE :like OR lower(d.reference_fournisseur) LIKE :like OR lower(f.nom) LIKE :like)'
      : sorte === 'reception'
        ? '(lower(d.numero) LIKE :like OR lower(d.bl_numero) LIKE :like OR lower(f.nom) LIKE :like OR lower(b.numero_complet) LIKE :like)'
        : '(lower(d.numero) LIKE :like OR lower(d.motif) LIKE :like OR lower(f.nom) LIKE :like OR lower(r.numero) LIKE :like)');
  }
  return (await Q(`${SQL[sorte]} WHERE ${conds.join(' AND ')} ORDER BY d.cree_le DESC LIMIT 500`, r))
    .filter((d) => dansPerimetre(ctx, sorte, d)).map(formater);
};

const compteurs = async (ctx) => {
  const out = { receptions_a_valider: 0, retours_a_valider: 0, factures_a_valider: 0, bons_a_recevoir: 0 };
  const compter = async (sorte, code) => {
    if (!ctx.peut(code)) return 0;
    return (await Q(`${SQL[sorte]} WHERE d.tenant_id = :t AND d.statut = 'a_valider' AND d.cree_par <> :moi`, { t: ctx.tenantId, moi: ctx.userId }))
      .filter((d) => dansPerimetre(ctx, sorte, d)).length;
  };
  out.receptions_a_valider = await compter('reception', 'com.receptions.valider');
  out.retours_a_valider = await compter('retour', 'com.retours_fourn.valider');
  out.factures_a_valider = await compter('facture', 'com.factures_fourn.valider');
  if (ctx.peut('com.receptions.saisir')) out.bons_a_recevoir = (await aRecevoir(ctx)).length;
  return out;
};

// Historique, pièces, mouvements : communs aux fiches.
const annexes = async (ctx, sorte, d) => {
  const pieces = await Q(
    `SELECT x.id, x.nom, x.mime, x.taille, x.sha256, x.ajoute_le, u.username AS ajoute_par_nom
       FROM com_documents x LEFT JOIN users u ON u.id = x.ajoute_par
      WHERE x.tenant_id = :t AND x.objet_type = :o AND x.objet_id = :id AND NOT x.retire ORDER BY x.ajoute_le`,
    { t: ctx.tenantId, o: SORTES[sorte].objet, id: d.id });
  const historique = await Q(
    `SELECT a.created_at AS le, a.action, u.username AS par_nom, a.nouvelle_valeur FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.tenant_id = :t AND a.entite = 'commercial' AND a.entite_id = :e ORDER BY a.created_at, a.id`, { t: ctx.tenantId, e: `${SORTES[sorte].audit}:${d.id}` });
  return { pieces: pieces.map((x) => ({ ...x, id: Number(x.id), taille: Number(x.taille) })), historique };
};
const mouvementsDe = async (ctx, documentType, id) => {
  const couts = ctx.peut('com.stock.valorisation');
  const rows = await Q(
    `SELECT s.id, s.type, s.sens, s.quantite, s.cout_unitaire, s.valeur, s.annule, m.code AS magasin_code, a.reference, a.unite
       FROM com_stock_mouvements s JOIN com_magasins m ON m.id = s.magasin_id JOIN com_articles a ON a.id = s.article_id
      WHERE s.document_type = :dt AND s.document_id = :id ORDER BY s.id`, { dt: documentType, id });
  return rows.map((m) => ({ ...m, id: Number(m.id), quantite: Number(m.quantite), sens: Number(m.sens),
    cout_unitaire: m.cout_unitaire === null || !couts ? null : Number(m.cout_unitaire), valeur: m.valeur === null || !couts ? null : Number(m.valeur) }));
};
const droitsCircuit = async (ctx, sorte, d) => {
  const s = SORTES[sorte]; const p = await parametres(ctx.tenantId);
  const auteur = d.cree_par === ctx.userId;
  return {
    modifier: d.statut === 'brouillon' && ctx.peut(s.saisir),
    soumettre: d.statut === 'brouillon' && ctx.peut(s.saisir),
    valider: d.statut === 'a_valider' && ctx.peut(s.valider) && (!auteur || p.autovalidation),
    renvoyer: d.statut === 'a_valider' && ctx.peut(s.valider) && (!auteur || p.autovalidation),
    annuler: d.statut === 'valide' && ctx.peut(s.annuler),
    joindre: ['brouillon', 'a_valider'].includes(d.statut) && (ctx.peut(s.saisir) || ctx.peut(s.valider)),
    auto_validation_interdite: d.statut === 'a_valider' && ctx.peut(s.valider) && auteur && !p.autovalidation,
  };
};

// ══ RÉCEPTIONS ══════════════════════════════════════════════════════════
// Reste à recevoir de chaque ligne d'un bon (réceptions validées + en cours, sauf `sauf`).
const restesBon = async (tr, bcId, sauf = 0) => Q(
  `SELECT l.id, l.article_id, l.reference, l.designation, l.unite, l.unite_id, l.coefficient, l.quantite, l.prix_unitaire, l.remise_pct,
          l.taxe_id, l.taxe_code, l.taxe_taux, a.unite AS unite_stock, a.suivi_stock,
          COALESCE(SUM(rl.quantite) FILTER (WHERE r.statut = 'valide'), 0) AS recu,
          COALESCE(SUM(rl.quantite) FILTER (WHERE r.statut IN ('brouillon', 'a_valider') AND r.id <> :sauf), 0) AS en_cours
     FROM com_bc_lignes l JOIN com_articles a ON a.id = l.article_id
     LEFT JOIN com_reception_lignes rl ON rl.bc_ligne_id = l.id LEFT JOIN com_receptions r ON r.id = rl.reception_id
    WHERE l.bc_id = :b GROUP BY l.id, a.unite, a.suivi_stock ORDER BY l.ordre, l.id`, { b: bcId, sauf }, tr)
  .then((rows) => rows.map((l) => {
    const quantite = Number(l.quantite); const recu = Number(l.recu); const enCours = Number(l.en_cours);
    return { ...l, id: Number(l.id), article_id: Number(l.article_id), unite_id: l.unite_id ? Number(l.unite_id) : null, coefficient: Number(l.coefficient),
      quantite, prix_unitaire: Number(l.prix_unitaire), remise_pct: Number(l.remise_pct), taxe_taux: Number(l.taxe_taux), taxe_id: l.taxe_id ? Number(l.taxe_id) : null,
      prix_net: c6(Number(l.prix_unitaire) * (1 - Number(l.remise_pct) / 100)), recu, en_cours: enCours, reste: Math.max(0, q3(quantite - recu - enCours)) };
  }));

// Bons émis qui restent à recevoir (au moins une ligne non soldée).
const aRecevoir = async (ctx) => {
  exigerUn(ctx, ['com.receptions.saisir', 'com.receptions.valider'], 'saisir les réceptions');
  const p = perim().sqlPerimetre(ctx, 'b.magasin_id');
  const bons = await Q(
    `SELECT b.id, b.numero_complet, b.emis_le, b.total_ttc, b.devise, b.delai_livraison, f.nom AS fournisseur_nom, m.code AS magasin_code,
            SUM(l.quantite) AS commande,
            COALESCE((SELECT SUM(rl.quantite) FROM com_reception_lignes rl JOIN com_receptions r ON r.id = rl.reception_id
                       JOIN com_bc_lignes x ON x.id = rl.bc_ligne_id WHERE x.bc_id = b.id AND r.statut = 'valide'), 0) AS recu,
            BOOL_OR(l.quantite > COALESCE((SELECT SUM(rl.quantite) FROM com_reception_lignes rl JOIN com_receptions r ON r.id = rl.reception_id
                                            WHERE rl.bc_ligne_id = l.id AND r.statut = 'valide'), 0)) AS ouvert,
            (SELECT COUNT(*)::int FROM com_receptions r WHERE r.bc_id = b.id AND r.statut IN ('brouillon', 'a_valider')) AS en_cours
       FROM com_bons_commande b JOIN com_bc_lignes l ON l.bc_id = b.id JOIN registre_tiers f ON f.id = b.fournisseur_id JOIN com_magasins m ON m.id = b.magasin_id
      WHERE b.tenant_id = :t AND b.statut = 'emis' AND ${p.sql}
      GROUP BY b.id, f.nom, m.code ORDER BY b.emis_le`, { t: ctx.tenantId, ...p.r });
  return bons.filter((b) => b.ouvert).map((b) => ({ ...b, id: Number(b.id), commande: Number(b.commande), recu: Number(b.recu), total_ttc: Number(b.total_ttc),
    etat: Number(b.recu) > 0 ? 'partiel' : 'a_recevoir' }));
};

const chargerBon = async (ctx, bcId, tr) => {
  const [b] = await Q(`SELECT b.*, f.nom AS fournisseur_nom, m.code AS magasin_code, m.nom AS magasin_nom FROM com_bons_commande b
                         JOIN registre_tiers f ON f.id = b.fournisseur_id JOIN com_magasins m ON m.id = b.magasin_id
                        WHERE b.tenant_id = :t AND b.id = :b`, { t: ctx.tenantId, b: entier(bcId, 'Bon de commande') }, tr);
  if (!b || !perim().dansPerimetre(ctx, Number(b.magasin_id))) throw new ErreurAchat(404, 'Bon de commande introuvable.');
  return b;
};

// Proposition de réception : les lignes du bon avec leur reste.
const propositionReception = async (ctx, bcId) => {
  exiger(ctx, 'com.receptions.saisir', 'saisir les réceptions');
  const b = await chargerBon(ctx, bcId);
  if (b.statut !== 'emis') throw new ErreurAchat(409, 'Seul un bon de commande émis se réceptionne.');
  return { bc_id: Number(b.id), bc_numero: b.numero_complet, fournisseur_nom: b.fournisseur_nom, magasin_code: b.magasin_code, magasin_nom: b.magasin_nom,
    lignes: await restesBon(null, b.id) };
};

const valeursReception = (b) => ({
  date_reception: pasFutur(dateOk(b.date_reception || aujourdhui(), 'Date de réception'), 'La date de réception'),
  bl_numero: longueur(b.bl_numero, 60, 'N° du bon de livraison'),
  bl_date: pasFutur(dateOk(b.bl_date, 'Date du bon de livraison', { requise: false }), 'La date du bon de livraison'),
  observations: longueur(b.observations, 2000, 'Observations'),
  motif_ecart: longueur(b.motif_ecart, 500, 'Motif de l\'écart'),
});

const ecrireLignesReception = async (ctx, tr, rec, lignes) => {
  if (!Array.isArray(lignes)) throw new ErreurAchat(400, 'Liste de lignes invalide.');
  await X('DELETE FROM com_reception_lignes WHERE reception_id = :r', { r: rec.id }, tr);
  const restes = new Map((await restesBon(tr, rec.bc_id, rec.id)).map((l) => [l.id, l]));
  const vus = new Set(); let n = 0;
  for (const [i, x] of lignes.entries()) {
    const q = nombre(x.quantite, 'Quantité', { vide: 0 });
    if (!q) continue;                                        // ligne non reçue cette fois
    const lid = entier(x.bc_ligne_id, 'Ligne du bon');
    const l = restes.get(lid);
    if (!l) throw new ErreurAchat(400, 'Cette ligne n\'appartient pas au bon de commande.');
    if (vus.has(lid)) throw new ErreurAchat(400, 'Une même ligne figure deux fois.');
    vus.add(lid);
    await verifierDecimales(tr, l.unite_id, q, l.designation, l.unite);
    await X(`INSERT INTO com_reception_lignes (reception_id, tenant_id, ordre, bc_ligne_id, article_id, unite_id, unite, coefficient, quantite, prix_net, observation)
             VALUES (:r, :t, :o, :l, :a, :u, :uc, :k, :q, :p, :obs)`,
    { r: rec.id, t: ctx.tenantId, o: i, l: lid, a: l.article_id, u: l.unite_id, uc: l.unite, k: l.coefficient, q: q3(q), p: l.prix_net,
      obs: longueur(x.observation, 500, 'Observation de ligne') }, tr);
    n += 1;
  }
  return n;
};

// Contrôle du reste à recevoir : un excédent exige un motif.
const controlerReste = async (tr, rec) => {
  const restes = new Map((await restesBon(tr, rec.bc_id, rec.id)).map((l) => [l.id, l]));
  const lignes = await Q('SELECT bc_ligne_id, quantite FROM com_reception_lignes WHERE reception_id = :r', { r: rec.id }, tr);
  if (!lignes.length) throw new ErreurAchat(400, 'Indiquez au moins une quantité reçue.');
  const exces = lignes.map((x) => ({ l: restes.get(Number(x.bc_ligne_id)), q: Number(x.quantite) })).filter(({ l, q }) => q > l.reste + 1e-9);
  if (exces.length && txt(rec.motif_ecart).length < 3) {
    throw new ErreurAchat(400, `Quantité reçue supérieure au reste à recevoir pour ${exces.map(({ l, q }) => `« ${l.designation} » (${q} reçu(s), ${l.reste} attendu(s))`).join(', ')} : indiquez le motif de l'excédent.`);
  }
  return exces.length > 0;
};

const lireReception = async (ctx, id) => {
  if (!peutVoir(ctx, 'reception')) throw new ErreurAchat(403, 'Permission requise : consulter les réceptions.');
  const d = await charger(ctx, 'reception', id);
  const restes = new Map((await restesBon(null, d.bc_id, d.id)).map((l) => [l.id, l]));
  const lignes = await Q(
    `SELECT l.*, a.reference, a.designation, a.unite AS unite_stock,
            COALESCE((SELECT SUM(x.quantite) FROM com_retour_fourn_lignes x JOIN com_retours_fournisseurs r ON r.id = x.retour_id
                       WHERE x.reception_ligne_id = l.id AND r.statut = 'valide'), 0) AS retourne
       FROM com_reception_lignes l JOIN com_articles a ON a.id = l.article_id WHERE l.reception_id = :r ORDER BY l.ordre, l.id`, { r: d.id });
  const couts = ctx.peut('com.stock.valorisation') || ctx.peut('com.bc.preparer') || ctx.peut('com.factures_fourn.voir');
  const retours = await Q(`SELECT id, numero, statut, date_retour FROM com_retours_fournisseurs WHERE reception_id = :r ORDER BY id`, { r: d.id });
  return {
    ...formater(d),
    lignes: lignes.map((l) => {
      const r = restes.get(Number(l.bc_ligne_id)) || {};
      return { ...l, id: Number(l.id), bc_ligne_id: Number(l.bc_ligne_id), article_id: Number(l.article_id), quantite: Number(l.quantite),
        coefficient: Number(l.coefficient), quantite_stock: q3(Number(l.quantite) * Number(l.coefficient)), retourne: Number(l.retourne),
        prix_net: couts ? Number(l.prix_net) : null, commande: r.quantite, recu_avant: d.statut === 'valide' ? q3((r.recu || 0) - Number(l.quantite)) : r.recu,
        reste: r.reste, exces: d.statut !== 'valide' && d.statut !== 'annule' && Number(l.quantite) > (r.reste ?? 0) + 1e-9 };
    }),
    retours: retours.map((x) => ({ ...x, id: Number(x.id) })),
    mouvements: await mouvementsDe(ctx, 'reception', d.id),
    ...(await annexes(ctx, 'reception', d)),
    droits: { ...(await droitsCircuit(ctx, 'reception', d)), retourner: d.statut === 'valide' && ctx.peut('com.retours_fourn.saisir') },
  };
};

const creerReception = async (ctx, body = {}) => {
  exiger(ctx, 'com.receptions.saisir', 'saisir les réceptions');
  const id = await sequelize.transaction(async (tr) => {
    const b = await chargerBon(ctx, body.bc_id, tr);
    if (b.statut !== 'emis') throw new ErreurAchat(409, 'Seul un bon de commande émis se réceptionne.');
    if (b.emis_le && body.date_reception && String(body.date_reception) < new Date(b.emis_le).toISOString().slice(0, 10)) {
      throw new ErreurAchat(400, 'La réception ne peut pas précéder l\'émission du bon de commande.');
    }
    const v = valeursReception(body);
    const numero = await numeroter(tr, ctx.tenantId, 'REC');
    const [r] = await Q(`INSERT INTO com_receptions (tenant_id, numero, bc_id, fournisseur_id, magasin_id, date_reception, bl_numero, bl_date, motif_ecart, observations, cree_par)
                         VALUES (:t, :numero, :bc, :f, :m, :date_reception, :bl_numero, :bl_date, :motif_ecart, :observations, :u) RETURNING id`,
    { ...v, t: ctx.tenantId, numero, bc: b.id, f: b.fournisseur_id, m: b.magasin_id, u: ctx.userId }, tr);
    const n = await ecrireLignesReception(ctx, tr, { id: r.id, bc_id: b.id }, body.lignes || []);
    await auditer(tr, ctx, 'reception', 'COM_RECEPTION_CREATION', r.id, { numero, bc: b.numero_complet, nb_lignes: n });
    return r.id;
  });
  return lireReception(ctx, id);
};

const modifierReception = async (ctx, id, body = {}) => {
  exiger(ctx, 'com.receptions.saisir', 'saisir les réceptions');
  await sequelize.transaction(async (tr) => {
    const d = await charger(ctx, 'reception', id, tr, true);
    if (d.statut !== 'brouillon') throw new ErreurAchat(409, 'Seul un brouillon se modifie.');
    const v = valeursReception({ ...d, date_reception: String(d.date_reception).slice(0, 10), bl_date: d.bl_date ? String(d.bl_date).slice(0, 10) : '', ...body });
    await X(`UPDATE com_receptions SET date_reception = :date_reception, bl_numero = :bl_numero, bl_date = :bl_date, motif_ecart = :motif_ecart,
               observations = :observations, modifie_le = NOW() WHERE id = :id`, { ...v, id: d.id }, tr);
    const apres = { ...v };
    if (body.lignes !== undefined) apres.nb_lignes = await ecrireLignesReception(ctx, tr, d, body.lignes);
    await auditer(tr, ctx, 'reception', 'COM_RECEPTION_MODIFICATION', d.id, apres);
  });
  return lireReception(ctx, id);
};

// ── Circuit commun (soumettre, renvoyer, supprimer) ────────────────────────
const lecteurs = { reception: (ctx, id) => lireReception(ctx, id), retour: (ctx, id) => lireRetour(ctx, id), facture: (ctx, id) => lireFacture(ctx, id) };
const ACTIONS = { reception: 'COM_RECEPTION', retour: 'COM_RETOUR_FOURN', facture: 'COM_FACTURE_FOURN' };

const soumettre = async (ctx, sorte, id, body = {}) => {
  const s = SORTES[sorte];
  exiger(ctx, s.saisir, `saisir les ${s.nom}s`);
  await sequelize.transaction(async (tr) => {
    const d = await charger(ctx, sorte, id, tr, true);
    if (d.statut !== 'brouillon') throw new ErreurAchat(409, 'Ce document a déjà été soumis.');
    if (body.motif_ecart !== undefined) {
      d.motif_ecart = longueur(body.motif_ecart, 500, 'Motif de l\'écart');
      await X(`UPDATE ${s.table} SET motif_ecart = :m WHERE id = :id`, { m: d.motif_ecart, id: d.id }, tr);
    }
    if (sorte === 'reception') await controlerReste(tr, d);
    if (sorte === 'retour') await controlerRetour(tr, d);
    if (sorte === 'facture') await controlerFacture(ctx, tr, d);
    await X(`UPDATE ${s.table} SET statut = 'a_valider', soumis_le = NOW(), motif_renvoi = '' WHERE id = :id`, { id: d.id }, tr);
    await auditer(tr, ctx, sorte, `${ACTIONS[sorte]}_SOUMISSION`, d.id, { numero: d.numero });
  });
  return lecteurs[sorte](ctx, id);
};

const renvoyer = async (ctx, sorte, id, body = {}) => {
  const s = SORTES[sorte];
  exiger(ctx, s.valider, `valider les ${s.nom}s`);
  const motif = txt(body.motif);
  if (motif.length < 3) throw new ErreurAchat(400, 'Indiquez ce qu\'il faut corriger.');
  await sequelize.transaction(async (tr) => {
    const d = await charger(ctx, sorte, id, tr, true);
    if (d.statut !== 'a_valider') throw new ErreurAchat(409, 'Seul un document à valider peut être renvoyé.');
    await X(`UPDATE ${s.table} SET statut = 'brouillon', motif_renvoi = :m WHERE id = :id`, { m: motif.slice(0, 500), id: d.id }, tr);
    await auditer(tr, ctx, sorte, `${ACTIONS[sorte]}_RENVOI`, d.id, { numero: d.numero, motif });
  });
  return lecteurs[sorte](ctx, id);
};

const supprimer = async (ctx, sorte, id) => {
  const s = SORTES[sorte];
  exiger(ctx, s.saisir, `saisir les ${s.nom}s`);
  return sequelize.transaction(async (tr) => {
    const d = await charger(ctx, sorte, id, tr, true);
    if (d.statut !== 'brouillon') throw new ErreurAchat(409, 'Seul un brouillon se supprime ; un document validé s\'annule.');
    await X("UPDATE com_documents SET retire = true, retire_par = :u, retire_le = NOW(), motif_retrait = 'Brouillon supprimé' WHERE objet_type = :o AND objet_id = :d AND NOT retire",
      { u: ctx.userId, o: s.objet, d: d.id }, tr);
    await X(`DELETE FROM ${s.table} WHERE id = :id`, { id: d.id }, tr);
    await auditer(tr, ctx, sorte, `${ACTIONS[sorte]}_SUPPRESSION`, d.id, { numero: d.numero });
    return { ok: true };
  });
};

const verifierValideur = async (ctx, sorte, d, tr) => {
  const s = SORTES[sorte];
  exiger(ctx, s.valider, `valider les ${s.nom}s`);
  if (d.statut !== 'a_valider') throw new ErreurAchat(409, d.statut === 'brouillon' ? 'Le document doit d\'abord être soumis.' : 'Ce document est déjà traité.');
  const p = await parametres(ctx.tenantId, tr);
  if (d.cree_par === ctx.userId && !p.autovalidation) {
    throw new ErreurAchat(403, 'Vous ne pouvez pas valider un document que vous avez saisi : un autre valideur doit le faire.');
  }
  return p;
};

// Annule les mouvements d'un document puis rejoue ; refuse si un stock deviendrait négatif.
const neutraliserMouvements = async (tr, ctx, documentType, id, p) => {
  const mvts = await Q('SELECT article_id, magasin_id FROM com_stock_mouvements WHERE document_type = :dt AND document_id = :id AND NOT annule', { dt: documentType, id }, tr);
  const articles = [...new Set(mvts.map((m) => Number(m.article_id)))].sort((a, b) => a - b);
  for (const a of articles) await moteur.verrouiller(tr, a);
  await X('UPDATE com_stock_mouvements SET annule = true, annule_le = NOW() WHERE document_type = :dt AND document_id = :id AND NOT annule', { dt: documentType, id }, tr);
  if (!p.negatif) {
    for (const m of mvts) {
      if (await moteur.quantite(tr, Number(m.article_id), Number(m.magasin_id)) < -1e-9) {
        const [a] = await Q('SELECT designation FROM com_articles WHERE id = :a', { a: m.article_id }, tr);
        throw new ErreurAchat(409, `Annulation impossible : le stock de « ${a.designation} » deviendrait négatif (la marchandise a déjà été utilisée).`);
      }
    }
  }
  for (const a of articles) await moteur.rejouer(tr, ctx.tenantId, a);
};

const validerReception = async (ctx, id) => {
  await sequelize.transaction(async (tr) => {
    const d = await charger(ctx, 'reception', id, tr, true);
    await verifierValideur(ctx, 'reception', d, tr);
    const [b] = await Q('SELECT statut FROM com_bons_commande WHERE id = :b FOR SHARE', { b: d.bc_id }, tr);
    if (b.statut !== 'emis') throw new ErreurAchat(409, 'Le bon de commande n\'est plus émis (annulé ou remplacé) : cette réception ne peut pas être validée.');
    await controlerReste(tr, d);
    const lignes = await Q(`SELECT l.*, a.suivi_stock, a.designation FROM com_reception_lignes l JOIN com_articles a ON a.id = l.article_id
                             WHERE l.reception_id = :r ORDER BY l.ordre, l.id`, { r: d.id }, tr);
    const articles = [...new Set(lignes.filter((l) => l.suivi_stock).map((l) => Number(l.article_id)))].sort((a, b) => a - b);
    for (const a of articles) await moteur.verrouiller(tr, a);
    for (const l of lignes) {
      if (!l.suivi_stock) continue;                          // prestation : reçue, sans stock
      await moteur.ecrire(tr, { tenantId: ctx.tenantId, articleId: Number(l.article_id), magasinId: Number(d.magasin_id), type: 'reception',
        quantite: q3(Number(l.quantite) * Number(l.coefficient)), date: String(d.date_reception).slice(0, 10), piece: d.numero,
        observation: d.bl_numero ? `BL ${d.bl_numero}` : '', cout: Number(l.prix_net) / Number(l.coefficient),
        documentType: 'reception', documentId: Number(d.id), ligneId: Number(l.id), userId: ctx.userId });
    }
    for (const a of articles) await moteur.rejouer(tr, ctx.tenantId, a);
    await X("UPDATE com_receptions SET statut = 'valide', valide_par = :u, valide_le = NOW() WHERE id = :id", { u: ctx.userId, id: d.id }, tr);
    await auditer(tr, ctx, 'reception', 'COM_RECEPTION_VALIDATION', d.id, { numero: d.numero, nb_lignes: lignes.length });
  });
  return lireReception(ctx, id);
};

const annulerReception = async (ctx, id, body = {}) => {
  exiger(ctx, 'com.receptions.annuler', 'annuler les réceptions');
  const motif = txt(body.motif);
  if (motif.length < 3) throw new ErreurAchat(400, 'Indiquez le motif de l\'annulation.');
  await sequelize.transaction(async (tr) => {
    const d = await charger(ctx, 'reception', id, tr, true);
    if (d.statut !== 'valide') throw new ErreurAchat(409, 'Seule une réception validée s\'annule.');
    const [rt] = await Q("SELECT numero FROM com_retours_fournisseurs WHERE reception_id = :r AND statut <> 'annule' LIMIT 1", { r: d.id }, tr);
    if (rt) throw new ErreurAchat(409, `Le retour ${rt.numero} porte sur cette réception : annulez-le d'abord.`);
    const [ff] = await Q(`SELECT f.numero FROM com_facture_fourn_lignes l JOIN com_factures_fournisseurs f ON f.id = l.facture_id
                           JOIN com_reception_lignes rl ON rl.id = l.reception_ligne_id WHERE rl.reception_id = :r AND f.statut <> 'annule' LIMIT 1`, { r: d.id }, tr);
    if (ff) throw new ErreurAchat(409, `La facture ${ff.numero} porte sur cette réception : annulez-la d'abord.`);
    await neutraliserMouvements(tr, ctx, 'reception', d.id, await parametres(ctx.tenantId, tr));
    await X("UPDATE com_receptions SET statut = 'annule', annule_par = :u, annule_le = NOW(), motif_annulation = :m WHERE id = :id",
      { u: ctx.userId, m: motif.slice(0, 500), id: d.id }, tr);
    await auditer(tr, ctx, 'reception', 'COM_RECEPTION_ANNULATION', d.id, { numero: d.numero, motif });
  });
  return lireReception(ctx, id);
};

// ══ RETOURS FOURNISSEURS ═════════════════════════════════════════════════
// Disponible au retour de chaque ligne d'une réception : reçu − retours validés ou en cours (sauf `sauf`).
const disponiblesRetour = async (tr, receptionId, sauf = 0) => Q(
  `SELECT l.id, l.article_id, l.unite, l.unite_id, l.coefficient, l.quantite, a.reference, a.designation, a.unite AS unite_stock,
          COALESCE(SUM(x.quantite) FILTER (WHERE r.statut IN ('valide', 'a_valider', 'brouillon') AND r.id <> :sauf), 0) AS retourne
     FROM com_reception_lignes l JOIN com_articles a ON a.id = l.article_id
     LEFT JOIN com_retour_fourn_lignes x ON x.reception_ligne_id = l.id LEFT JOIN com_retours_fournisseurs r ON r.id = x.retour_id
    WHERE l.reception_id = :rec GROUP BY l.id, a.reference, a.designation, a.unite ORDER BY l.ordre, l.id`, { rec: receptionId, sauf }, tr)
  .then((rows) => rows.map((l) => ({ ...l, id: Number(l.id), article_id: Number(l.article_id), coefficient: Number(l.coefficient),
    quantite: Number(l.quantite), retourne: Number(l.retourne), disponible: Math.max(0, q3(Number(l.quantite) - Number(l.retourne))) })));

const ecrireLignesRetour = async (ctx, tr, rt, lignes) => {
  if (!Array.isArray(lignes)) throw new ErreurAchat(400, 'Liste de lignes invalide.');
  await X('DELETE FROM com_retour_fourn_lignes WHERE retour_id = :r', { r: rt.id }, tr);
  const dispo = new Map((await disponiblesRetour(tr, rt.reception_id, rt.id)).map((l) => [l.id, l]));
  let n = 0;
  for (const [i, x] of lignes.entries()) {
    const q = nombre(x.quantite, 'Quantité', { vide: 0 });
    if (!q) continue;
    const l = dispo.get(entier(x.reception_ligne_id, 'Ligne de réception'));
    if (!l) throw new ErreurAchat(400, 'Cette ligne n\'appartient pas à la réception.');
    await verifierDecimales(tr, l.unite_id, q, l.designation, l.unite);
    await X(`INSERT INTO com_retour_fourn_lignes (retour_id, tenant_id, ordre, reception_ligne_id, article_id, unite, coefficient, quantite, observation)
             VALUES (:r, :t, :o, :l, :a, :u, :k, :q, :obs)`,
    { r: rt.id, t: ctx.tenantId, o: i, l: l.id, a: l.article_id, u: l.unite, k: l.coefficient, q: q3(q), obs: longueur(x.observation, 500, 'Observation de ligne') }, tr);
    n += 1;
  }
  return n;
};

const controlerRetour = async (tr, rt) => {
  if (txt(rt.motif).length < 3) throw new ErreurAchat(400, 'Indiquez le motif du retour (non conforme, abîmé, erreur de livraison…).');
  const dispo = new Map((await disponiblesRetour(tr, rt.reception_id, rt.id)).map((l) => [l.id, l]));
  const lignes = await Q('SELECT reception_ligne_id, quantite FROM com_retour_fourn_lignes WHERE retour_id = :r', { r: rt.id }, tr);
  if (!lignes.length) throw new ErreurAchat(400, 'Indiquez au moins une quantité retournée.');
  for (const x of lignes) {
    const l = dispo.get(Number(x.reception_ligne_id));
    if (Number(x.quantite) > l.disponible + 1e-9) {
      throw new ErreurAchat(400, `« ${l.designation} » : ${Number(x.quantite)} ${l.unite} retourné(s) pour ${l.disponible} encore retournable(s).`);
    }
  }
};

const lireRetour = async (ctx, id) => {
  if (!peutVoir(ctx, 'retour')) throw new ErreurAchat(403, 'Permission requise : consulter les retours fournisseurs.');
  const d = await charger(ctx, 'retour', id);
  const dispo = new Map((await disponiblesRetour(null, d.reception_id, d.id)).map((l) => [l.id, l]));
  const lignes = await Q(`SELECT l.*, a.reference, a.designation, a.unite AS unite_stock FROM com_retour_fourn_lignes l JOIN com_articles a ON a.id = l.article_id
                           WHERE l.retour_id = :r ORDER BY l.ordre, l.id`, { r: d.id });
  const avoirs = await Q("SELECT id, numero, statut, total_ttc FROM com_factures_fournisseurs WHERE retour_id = :r ORDER BY id", { r: d.id });
  return {
    ...formater(d),
    lignes: lignes.map((l) => ({ ...l, id: Number(l.id), reception_ligne_id: Number(l.reception_ligne_id), article_id: Number(l.article_id),
      quantite: Number(l.quantite), coefficient: Number(l.coefficient), quantite_stock: q3(Number(l.quantite) * Number(l.coefficient)),
      recu: dispo.get(Number(l.reception_ligne_id))?.quantite, disponible: dispo.get(Number(l.reception_ligne_id))?.disponible })),
    avoirs: avoirs.map((x) => ({ ...x, id: Number(x.id), total_ttc: Number(x.total_ttc) })),
    mouvements: await mouvementsDe(ctx, 'retour_fournisseur', d.id),
    ...(await annexes(ctx, 'retour', d)),
    droits: await droitsCircuit(ctx, 'retour', d),
  };
};

const propositionRetour = async (ctx, receptionId) => {
  exiger(ctx, 'com.retours_fourn.saisir', 'saisir les retours fournisseurs');
  const r = await charger(ctx, 'reception', receptionId);
  if (r.statut !== 'valide') throw new ErreurAchat(409, 'Seule une réception validée peut faire l\'objet d\'un retour.');
  return { reception_id: Number(r.id), reception_numero: r.numero, fournisseur_nom: r.fournisseur_nom, magasin_code: r.magasin_code,
    lignes: (await disponiblesRetour(null, r.id)).filter((l) => l.disponible > 0) };
};

const creerRetour = async (ctx, body = {}) => {
  exiger(ctx, 'com.retours_fourn.saisir', 'saisir les retours fournisseurs');
  const id = await sequelize.transaction(async (tr) => {
    const r = await charger(ctx, 'reception', body.reception_id, tr);
    if (r.statut !== 'valide') throw new ErreurAchat(409, 'Seule une réception validée peut faire l\'objet d\'un retour.');
    const date = pasFutur(dateOk(body.date_retour || aujourdhui(), 'Date du retour'), 'La date du retour');
    if (date < String(r.date_reception).slice(0, 10)) throw new ErreurAchat(400, 'Le retour ne peut pas précéder la réception.');
    const numero = await numeroter(tr, ctx.tenantId, 'RFO');
    const [x] = await Q(`INSERT INTO com_retours_fournisseurs (tenant_id, numero, reception_id, fournisseur_id, magasin_id, date_retour, motif, observations, cree_par)
                         VALUES (:t, :n, :r, :f, :m, :d, :motif, :obs, :u) RETURNING id`,
    { t: ctx.tenantId, n: numero, r: r.id, f: r.fournisseur_id, m: r.magasin_id, d: date, motif: longueur(body.motif, 500, 'Motif'),
      obs: longueur(body.observations, 2000, 'Observations'), u: ctx.userId }, tr);
    const n = await ecrireLignesRetour(ctx, tr, { id: x.id, reception_id: r.id }, body.lignes || []);
    await auditer(tr, ctx, 'retour', 'COM_RETOUR_FOURN_CREATION', x.id, { numero, reception: r.numero, nb_lignes: n });
    return x.id;
  });
  return lireRetour(ctx, id);
};

const modifierRetour = async (ctx, id, body = {}) => {
  exiger(ctx, 'com.retours_fourn.saisir', 'saisir les retours fournisseurs');
  await sequelize.transaction(async (tr) => {
    const d = await charger(ctx, 'retour', id, tr, true);
    if (d.statut !== 'brouillon') throw new ErreurAchat(409, 'Seul un brouillon se modifie.');
    const date = pasFutur(dateOk(body.date_retour ?? String(d.date_retour).slice(0, 10), 'Date du retour'), 'La date du retour');
    await X(`UPDATE com_retours_fournisseurs SET date_retour = :d, motif = :m, observations = :o, modifie_le = NOW() WHERE id = :id`,
      { d: date, m: longueur(body.motif ?? d.motif, 500, 'Motif'), o: longueur(body.observations ?? d.observations, 2000, 'Observations'), id: d.id }, tr);
    if (body.lignes !== undefined) await ecrireLignesRetour(ctx, tr, d, body.lignes);
    await auditer(tr, ctx, 'retour', 'COM_RETOUR_FOURN_MODIFICATION', d.id, { motif: body.motif });
  });
  return lireRetour(ctx, id);
};

const validerRetour = async (ctx, id) => {
  await sequelize.transaction(async (tr) => {
    const d = await charger(ctx, 'retour', id, tr, true);
    const p = await verifierValideur(ctx, 'retour', d, tr);
    await controlerRetour(tr, d);
    const lignes = await Q(`SELECT l.*, a.suivi_stock, a.designation, a.unite AS unite_stock FROM com_retour_fourn_lignes l JOIN com_articles a ON a.id = l.article_id
                             WHERE l.retour_id = :r ORDER BY l.ordre, l.id`, { r: d.id }, tr);
    const articles = [...new Set(lignes.filter((l) => l.suivi_stock).map((l) => Number(l.article_id)))].sort((a, b) => a - b);
    for (const a of articles) await moteur.verrouiller(tr, a);
    for (const l of lignes) {
      if (!l.suivi_stock) continue;
      const qs = q3(Number(l.quantite) * Number(l.coefficient));
      if (!p.negatif) {
        const q = await moteur.quantite(tr, Number(l.article_id), Number(d.magasin_id));
        if (q + 1e-9 < qs) throw new ErreurAchat(409, `Stock insuffisant pour retourner « ${l.designation} » : ${q} ${l.unite_stock} en stock, ${qs} à retourner.`);
      }
      const [orig] = await Q(`SELECT id FROM com_stock_mouvements WHERE document_type = 'reception' AND document_id = :r AND ligne_id = :l AND NOT annule`,
        { r: d.reception_id, l: l.reception_ligne_id }, tr);
      await moteur.ecrire(tr, { tenantId: ctx.tenantId, articleId: Number(l.article_id), magasinId: Number(d.magasin_id), type: 'retour_fournisseur',
        quantite: qs, date: String(d.date_retour).slice(0, 10), piece: d.numero, observation: d.motif, documentType: 'retour_fournisseur',
        documentId: Number(d.id), ligneId: Number(l.id), lieId: orig ? Number(orig.id) : null, userId: ctx.userId });
    }
    for (const a of articles) await moteur.rejouer(tr, ctx.tenantId, a);
    await X("UPDATE com_retours_fournisseurs SET statut = 'valide', valide_par = :u, valide_le = NOW() WHERE id = :id", { u: ctx.userId, id: d.id }, tr);
    await auditer(tr, ctx, 'retour', 'COM_RETOUR_FOURN_VALIDATION', d.id, { numero: d.numero, nb_lignes: lignes.length });
  });
  return lireRetour(ctx, id);
};

const annulerRetour = async (ctx, id, body = {}) => {
  exiger(ctx, 'com.receptions.annuler', 'annuler les réceptions et retours');
  const motif = txt(body.motif);
  if (motif.length < 3) throw new ErreurAchat(400, 'Indiquez le motif de l\'annulation.');
  await sequelize.transaction(async (tr) => {
    const d = await charger(ctx, 'retour', id, tr, true);
    if (d.statut !== 'valide') throw new ErreurAchat(409, 'Seul un retour validé s\'annule.');
    const [av] = await Q("SELECT numero FROM com_factures_fournisseurs WHERE retour_id = :r AND statut <> 'annule' LIMIT 1", { r: d.id }, tr);
    if (av) throw new ErreurAchat(409, `L'avoir ${av.numero} porte sur ce retour : annulez-le d'abord.`);
    // Réintégrer la marchandise ne rend jamais un stock négatif : pas de contrôle de négatif ici.
    await neutraliserMouvements(tr, ctx, 'retour_fournisseur', d.id, { negatif: true });
    await X("UPDATE com_retours_fournisseurs SET statut = 'annule', annule_par = :u, annule_le = NOW(), motif_annulation = :m WHERE id = :id",
      { u: ctx.userId, m: motif.slice(0, 500), id: d.id }, tr);
    await auditer(tr, ctx, 'retour', 'COM_RETOUR_FOURN_ANNULATION', d.id, { numero: d.numero, motif });
  });
  return lireRetour(ctx, id);
};

// ══ FACTURES ET AVOIRS FOURNISSEURS ══════════════════════════════════════
// Lignes de réception d'un fournisseur restant à facturer : reçu − retourné − déjà facturé.
const aFacturer = async (ctx, fournisseurId, sauf = 0, tr = null) => {
  const fid = entier(fournisseurId, 'Fournisseur');
  const rows = await Q(
    `SELECT rl.id, rl.quantite, rl.unite, rl.prix_net, rl.article_id, r.id AS reception_id, r.numero AS reception_numero, r.date_reception, r.bl_numero,
            r.magasin_id, b.numero_complet AS bc_numero, bl.designation, bl.reference, bl.prix_unitaire, bl.remise_pct, bl.taxe_id, bl.taxe_code, bl.taxe_taux,
            COALESCE((SELECT SUM(x.quantite) FROM com_retour_fourn_lignes x JOIN com_retours_fournisseurs t ON t.id = x.retour_id
                       WHERE x.reception_ligne_id = rl.id AND t.statut = 'valide'), 0) AS retourne,
            COALESCE((SELECT SUM(fl.quantite) FROM com_facture_fourn_lignes fl JOIN com_factures_fournisseurs f ON f.id = fl.facture_id
                       WHERE fl.reception_ligne_id = rl.id AND f.statut <> 'annule' AND f.id <> :sauf), 0) AS facture
       FROM com_reception_lignes rl JOIN com_receptions r ON r.id = rl.reception_id
       JOIN com_bc_lignes bl ON bl.id = rl.bc_ligne_id JOIN com_bons_commande b ON b.id = r.bc_id
      WHERE r.tenant_id = :t AND r.fournisseur_id = :f AND r.statut = 'valide'
      ORDER BY r.date_reception, r.id, rl.ordre`, { t: ctx.tenantId, f: fid, sauf }, tr);
  return rows.filter((l) => perim().dansPerimetre(ctx, Number(l.magasin_id))).map((l) => {
    const recuNet = q3(Number(l.quantite) - Number(l.retourne));
    return { ...l, id: Number(l.id), reception_id: Number(l.reception_id), article_id: Number(l.article_id), magasin_id: Number(l.magasin_id),
      quantite: Number(l.quantite), retourne: Number(l.retourne), recu_net: recuNet, facture: Number(l.facture),
      reste: Math.max(0, q3(recuNet - Number(l.facture))), prix_net: Number(l.prix_net), prix_unitaire: Number(l.prix_unitaire),
      remise_pct: Number(l.remise_pct), taxe_id: l.taxe_id ? Number(l.taxe_id) : null, taxe_taux: Number(l.taxe_taux) };
  });
};
const listeAFacturer = async (ctx, fournisseurId) => {
  exiger(ctx, 'com.factures_fourn.saisir', 'saisir les factures fournisseurs');
  return (await aFacturer(ctx, fournisseurId)).filter((l) => l.reste > 0);
};
// Fournisseurs qui ont des réceptions validées non entièrement facturées.
const fournisseursAFacturer = async (ctx) => {
  exiger(ctx, 'com.factures_fourn.saisir', 'saisir les factures fournisseurs');
  const fs = await Q(`SELECT DISTINCT f.id, f.nom FROM com_receptions r JOIN registre_tiers f ON f.id = r.fournisseur_id
                       WHERE r.tenant_id = :t AND r.statut = 'valide' ORDER BY f.nom`, { t: ctx.tenantId });
  const out = [];
  for (const f of fs) {
    const l = (await aFacturer(ctx, f.id)).filter((x) => x.reste > 0);
    if (l.length) out.push({ id: Number(f.id), nom: f.nom, lignes: l.length, receptions: [...new Set(l.map((x) => x.reception_numero))] });
  }
  return out;
};

const montants = (q, pu, remise, taux) => {
  const ht = m2(q * pu * (1 - remise / 100));
  return { ht, taxe: m2(ht * taux / 100) };
};

const valeursFacture = (b, type) => {
  const date = pasFutur(dateOk(b.date_facture, `Date ${type === 'avoir' ? 'de l\'avoir' : 'de la facture'}`), type === 'avoir' ? 'La date de l\'avoir' : 'La date de la facture');
  const echeance = dateOk(b.date_echeance, 'Échéance', { requise: false });
  if (echeance && echeance < date) throw new ErreurAchat(400, 'L\'échéance ne peut pas précéder la date de la facture.');
  const ref = txt(b.reference_fournisseur);
  if (!ref) throw new ErreurAchat(400, `Indiquez le numéro ${type === 'avoir' ? 'de l\'avoir' : 'de la facture'} du fournisseur.`);
  return { date_facture: date, date_echeance: echeance, reference_fournisseur: longueur(ref, 60, 'Numéro du fournisseur'),
    observations: longueur(b.observations, 2000, 'Observations'), motif_ecart: longueur(b.motif_ecart, 500, 'Motif de l\'écart') };
};

const ecrireLignesFacture = async (ctx, tr, f, lignes) => {
  if (!Array.isArray(lignes)) throw new ErreurAchat(400, 'Liste de lignes invalide.');
  await X('DELETE FROM com_facture_fourn_lignes WHERE facture_id = :f', { f: f.id }, tr);
  let tht = 0; let ttx = 0; let n = 0;
  const taxes = new Map((await Q('SELECT id, code, taux, actif FROM com_taxes WHERE tenant_id = :t', { t: ctx.tenantId }, tr)).map((x) => [Number(x.id), x]));
  if (f.type === 'facture') {
    const dispo = new Map((await aFacturer(ctx, f.fournisseur_id, f.id, tr)).map((l) => [l.id, l]));
    const vus = new Set();
    for (const [i, x] of lignes.entries()) {
      const q = nombre(x.quantite, 'Quantité', { vide: 0 });
      if (!q) continue;
      const lid = entier(x.reception_ligne_id, 'Ligne de réception');
      const l = dispo.get(lid);
      if (!l) throw new ErreurAchat(400, 'Ligne de réception inconnue, non validée ou d\'un autre fournisseur.');
      if (vus.has(lid)) throw new ErreurAchat(400, 'Une même ligne de réception figure deux fois.');
      vus.add(lid);
      const pu = nombre(x.prix_unitaire, 'Prix unitaire', { vide: l.prix_unitaire });
      const remise = nombre(x.remise_pct, 'Remise', { vide: l.remise_pct, max: 100 });
      const taxeId = x.taxe_id === undefined ? l.taxe_id : (x.taxe_id ? entier(x.taxe_id, 'Taxe') : null);
      const tx = taxeId ? taxes.get(taxeId) : null;
      if (taxeId && !tx) throw new ErreurAchat(400, 'Taxe inconnue.');
      const mt = montants(q, pu, remise, tx ? Number(tx.taux) : 0);
      await X(`INSERT INTO com_facture_fourn_lignes (facture_id, tenant_id, ordre, reception_ligne_id, article_id, designation, unite, quantite, prix_unitaire,
                 remise_pct, taxe_id, taxe_code, taxe_taux, montant_ht, montant_taxe)
               VALUES (:f, :t, :o, :l, :a, :d, :u, :q, :pu, :r, :tx, :tc, :tt, :ht, :mt)`,
      { f: f.id, t: ctx.tenantId, o: i, l: lid, a: l.article_id, d: l.designation, u: l.unite, q: q3(q), pu, r: remise,
        tx: taxeId, tc: tx?.code || '', tt: tx ? Number(tx.taux) : 0, ht: mt.ht, mt: mt.taxe }, tr);
      tht += mt.ht; ttx += mt.taxe; n += 1;
    }
  } else {
    // Avoir : lignes de la facture d'origine ; quantité et prix plafonnés par l'origine (moins les avoirs déjà faits).
    const orig = await Q(
      `SELECT l.*, COALESCE((SELECT SUM(a.quantite) FROM com_facture_fourn_lignes a JOIN com_factures_fournisseurs f ON f.id = a.facture_id
                              WHERE a.facture_ligne_origine_id = l.id AND f.statut <> 'annule' AND f.id <> :moi), 0) AS deja
         FROM com_facture_fourn_lignes l WHERE l.facture_id = :o`, { o: f.facture_origine_id, moi: f.id }, tr);
    const parId = new Map(orig.map((l) => [Number(l.id), l]));
    for (const [i, x] of lignes.entries()) {
      const q = nombre(x.quantite, 'Quantité', { vide: 0 });
      if (!q) continue;
      const l = parId.get(entier(x.facture_ligne_origine_id, 'Ligne de facture'));
      if (!l) throw new ErreurAchat(400, 'Cette ligne n\'appartient pas à la facture d\'origine.');
      const reste = q3(Number(l.quantite) - Number(l.deja));
      if (q > reste + 1e-9) throw new ErreurAchat(400, `« ${l.designation} » : avoir de ${q} ${l.unite} pour ${reste} encore créditable(s) sur la facture d'origine.`);
      const pu = nombre(x.prix_unitaire, 'Prix unitaire', { vide: Number(l.prix_unitaire) });
      if (pu > Number(l.prix_unitaire) + 1e-9) throw new ErreurAchat(400, `« ${l.designation} » : le prix de l'avoir ne peut dépasser celui de la facture (${Number(l.prix_unitaire)}).`);
      const mt = montants(q, pu, Number(l.remise_pct), Number(l.taxe_taux));
      await X(`INSERT INTO com_facture_fourn_lignes (facture_id, tenant_id, ordre, facture_ligne_origine_id, article_id, designation, unite, quantite, prix_unitaire,
                 remise_pct, taxe_id, taxe_code, taxe_taux, montant_ht, montant_taxe)
               VALUES (:f, :t, :o, :l, :a, :d, :u, :q, :pu, :r, :tx, :tc, :tt, :ht, :mt)`,
      { f: f.id, t: ctx.tenantId, o: i, l: l.id, a: l.article_id, d: l.designation, u: l.unite, q: q3(q), pu, r: Number(l.remise_pct),
        tx: l.taxe_id, tc: l.taxe_code, tt: Number(l.taxe_taux), ht: mt.ht, mt: mt.taxe }, tr);
      tht += mt.ht; ttx += mt.taxe; n += 1;
    }
  }
  await X('UPDATE com_factures_fournisseurs SET total_ht = :ht, total_taxes = :tx, total_ttc = :ttc WHERE id = :f',
    { ht: m2(tht), tx: m2(ttx), ttc: m2(tht + ttx), f: f.id }, tr);
  return n;
};

// Rapprochement commande / réception / facture, ligne par ligne.
const rapprocher = async (ctx, tr, f, tolerance) => {
  if (f.type !== 'facture') return [];
  const lignes = await Q(
    `SELECT l.id, l.reception_ligne_id, l.designation, l.unite, l.quantite, l.prix_unitaire, l.remise_pct, l.quantite_recue, l.prix_commande,
            rl.quantite AS recu, rl.prix_net AS prix_cmd, r.numero AS reception_numero, b.numero_complet AS bc_numero,
            COALESCE((SELECT SUM(x.quantite) FROM com_retour_fourn_lignes x JOIN com_retours_fournisseurs t ON t.id = x.retour_id
                       WHERE x.reception_ligne_id = rl.id AND t.statut = 'valide'), 0) AS retourne,
            COALESCE((SELECT SUM(o.quantite) FROM com_facture_fourn_lignes o JOIN com_factures_fournisseurs ff ON ff.id = o.facture_id
                       WHERE o.reception_ligne_id = rl.id AND ff.statut <> 'annule' AND ff.id <> :f), 0) AS autres
       FROM com_facture_fourn_lignes l JOIN com_reception_lignes rl ON rl.id = l.reception_ligne_id
       JOIN com_receptions r ON r.id = rl.reception_id JOIN com_bons_commande b ON b.id = r.bc_id
      WHERE l.facture_id = :f ORDER BY l.ordre, l.id`, { f: f.id }, tr);
  const fige = f.statut === 'valide' || f.statut === 'annule';
  return lignes.map((l) => {
    const recuNet = fige && l.quantite_recue !== null ? Number(l.quantite_recue) : q3(Number(l.recu) - Number(l.retourne));
    const prixCmd = fige && l.prix_commande !== null ? Number(l.prix_commande) : Number(l.prix_cmd);
    const prixFact = c6(Number(l.prix_unitaire) * (1 - Number(l.remise_pct) / 100));
    const factureTotal = q3(Number(l.autres) + Number(l.quantite));
    const ecartQte = q3(factureTotal - recuNet);
    const ecartPrixPct = prixCmd > 0 ? Math.round(((prixFact - prixCmd) / prixCmd) * 10000) / 100 : (prixFact > 0 ? 100 : 0);
    return { ligne_id: Number(l.id), reception_ligne_id: Number(l.reception_ligne_id), designation: l.designation, unite: l.unite,
      bc_numero: l.bc_numero, reception_numero: l.reception_numero, recu_net: recuNet, deja_facture: Number(l.autres), facture: Number(l.quantite),
      ecart_quantite: ecartQte, prix_commande: c6(prixCmd), prix_facture: prixFact, ecart_prix_pct: ecartPrixPct,
      alerte_quantite: ecartQte > 0.0005, alerte_prix: Math.abs(ecartPrixPct) > tolerance + 1e-9 };
  });
};

const controlerFacture = async (ctx, tr, f) => {
  const n = await Q('SELECT COUNT(*)::int AS n FROM com_facture_fourn_lignes WHERE facture_id = :f', { f: f.id }, tr);
  if (!n[0].n) throw new ErreurAchat(400, 'Ajoutez au moins une ligne.');
  if (f.type === 'avoir') {
    const [o] = await Q('SELECT statut, total_ttc FROM com_factures_fournisseurs WHERE id = :o', { o: f.facture_origine_id }, tr);
    if (o.statut !== 'valide') throw new ErreurAchat(409, 'La facture d\'origine n\'est plus validée.');
    const [s] = await Q(`SELECT COALESCE(SUM(total_ttc), 0) AS t FROM com_factures_fournisseurs WHERE facture_origine_id = :o AND statut <> 'annule'`, { o: f.facture_origine_id }, tr);
    if (Number(s.t) > Number(o.total_ttc) + 0.005) throw new ErreurAchat(400, `Les avoirs (${Number(s.t)}) dépasseraient le montant de la facture d'origine (${Number(o.total_ttc)}).`);
    return [];
  }
  const p = await parametres(ctx.tenantId, tr);
  const r = await rapprocher(ctx, tr, f, p.tolerance);
  const ecarts = r.filter((x) => x.alerte_quantite || x.alerte_prix);
  if (ecarts.length && txt(f.motif_ecart).length < 3) {
    throw new ErreurAchat(400, `Écarts avec la commande ou la réception (${ecarts.map((x) => `« ${x.designation} »`).join(', ')}) : indiquez le motif avant de soumettre.`);
  }
  return r;
};

const lireFacture = async (ctx, id) => {
  if (!peutVoir(ctx, 'facture')) throw new ErreurAchat(403, 'Permission requise : consulter les factures fournisseurs.');
  const d = await charger(ctx, 'facture', id);
  const p = await parametres(ctx.tenantId);
  const lignes = await Q(`SELECT l.*, a.reference FROM com_facture_fourn_lignes l JOIN com_articles a ON a.id = l.article_id WHERE l.facture_id = :f ORDER BY l.ordre, l.id`, { f: d.id });
  const avoirs = d.type === 'facture'
    ? await Q("SELECT id, numero, reference_fournisseur, statut, total_ttc, date_facture FROM com_factures_fournisseurs WHERE facture_origine_id = :f ORDER BY id", { f: d.id }) : [];
  const credite = avoirs.filter((a) => a.statut === 'valide').reduce((t, a) => t + Number(a.total_ttc), 0);
  return {
    ...formater(d),
    lignes: lignes.map((l) => ({ ...l, id: Number(l.id), reception_ligne_id: l.reception_ligne_id ? Number(l.reception_ligne_id) : null,
      facture_ligne_origine_id: l.facture_ligne_origine_id ? Number(l.facture_ligne_origine_id) : null, article_id: Number(l.article_id),
      taxe_id: l.taxe_id ? Number(l.taxe_id) : null, quantite: Number(l.quantite), prix_unitaire: Number(l.prix_unitaire), remise_pct: Number(l.remise_pct),
      taxe_taux: Number(l.taxe_taux), montant_ht: Number(l.montant_ht), montant_taxe: Number(l.montant_taxe) })),
    rapprochement: await rapprocher(ctx, null, d, p.tolerance),
    tolerance: p.tolerance,
    avoirs: avoirs.map((a) => ({ ...a, id: Number(a.id), total_ttc: Number(a.total_ttc) })),
    net_a_payer: d.type === 'facture' ? m2(Number(d.total_ttc) - credite) : null,
    reglement: 'Les règlements se saisissent dans NJ CAISSE PRO (dépense portant ce numéro de facture). Aucune écriture comptable n\'est générée ici.',
    ...(await annexes(ctx, 'facture', d)),
    droits: { ...(await droitsCircuit(ctx, 'facture', d)), avoir: d.type === 'facture' && d.statut === 'valide' && ctx.peut('com.factures_fourn.saisir') },
  };
};

const creerFacture = async (ctx, body = {}) => {
  exiger(ctx, 'com.factures_fourn.saisir', 'saisir les factures fournisseurs');
  const type = body.type === 'avoir' ? 'avoir' : 'facture';
  const id = await sequelize.transaction(async (tr) => {
    let fournisseur; let origine = null; let retour = null;
    if (type === 'avoir') {
      origine = await charger(ctx, 'facture', body.facture_origine_id, tr, true);
      if (origine.type !== 'facture' || origine.statut !== 'valide') throw new ErreurAchat(409, 'Un avoir se fait sur une facture validée.');
      fournisseur = Number(origine.fournisseur_id);
      if (body.retour_id) {
        retour = await charger(ctx, 'retour', body.retour_id, tr);
        if (retour.statut !== 'valide' || Number(retour.fournisseur_id) !== fournisseur) throw new ErreurAchat(400, 'Le retour doit être validé et du même fournisseur.');
      }
    } else {
      const fid = entier(body.fournisseur_id, 'Fournisseur');
      const [f] = await Q('SELECT id FROM registre_tiers WHERE id = :f AND tenant_id = :t', { f: fid, t: ctx.tenantId }, tr);
      if (!f) throw new ErreurAchat(400, 'Fournisseur inconnu.');
      fournisseur = fid;
    }
    const v = valeursFacture(body, type);
    if (origine && v.date_facture < String(origine.date_facture).slice(0, 10)) throw new ErreurAchat(400, 'L\'avoir ne peut pas précéder la facture d\'origine.');
    const p = await parametres(ctx.tenantId, tr);
    const numero = await numeroter(tr, ctx.tenantId, type === 'avoir' ? 'AVF' : 'FFO');
    const [x] = await Q(`INSERT INTO com_factures_fournisseurs (tenant_id, type, numero, fournisseur_id, reference_fournisseur, date_facture, date_echeance,
                           facture_origine_id, retour_id, devise, motif_ecart, observations, cree_par)
                         VALUES (:t, :type, :numero, :f, :reference_fournisseur, :date_facture, :date_echeance, :o, :rt, :dev, :motif_ecart, :observations, :u) RETURNING id`,
    { ...v, t: ctx.tenantId, type, numero, f: fournisseur, o: origine ? origine.id : null, rt: retour ? retour.id : null, dev: p.devise, u: ctx.userId }, tr);
    const n = await ecrireLignesFacture(ctx, tr, { id: x.id, type, fournisseur_id: fournisseur, facture_origine_id: origine?.id }, body.lignes || []);
    await auditer(tr, ctx, 'facture', 'COM_FACTURE_FOURN_CREATION', x.id, { numero, type, reference: v.reference_fournisseur, nb_lignes: n });
    return x.id;
  });
  return lireFacture(ctx, id);
};

const modifierFacture = async (ctx, id, body = {}) => {
  exiger(ctx, 'com.factures_fourn.saisir', 'saisir les factures fournisseurs');
  await sequelize.transaction(async (tr) => {
    const d = await charger(ctx, 'facture', id, tr, true);
    if (d.statut !== 'brouillon') throw new ErreurAchat(409, 'Seul un brouillon se modifie.');
    const v = valeursFacture({ ...d, date_facture: String(d.date_facture).slice(0, 10), date_echeance: d.date_echeance ? String(d.date_echeance).slice(0, 10) : '', ...body }, d.type);
    await X(`UPDATE com_factures_fournisseurs SET reference_fournisseur = :reference_fournisseur, date_facture = :date_facture, date_echeance = :date_echeance,
               observations = :observations, motif_ecart = :motif_ecart, modifie_le = NOW() WHERE id = :id`, { ...v, id: d.id }, tr);
    if (body.lignes !== undefined) await ecrireLignesFacture(ctx, tr, { ...d, id: Number(d.id), fournisseur_id: Number(d.fournisseur_id) }, body.lignes);
    await auditer(tr, ctx, 'facture', 'COM_FACTURE_FOURN_MODIFICATION', d.id, { reference: v.reference_fournisseur });
  });
  return lireFacture(ctx, id);
};

const validerFacture = async (ctx, id) => {
  await sequelize.transaction(async (tr) => {
    const d = await charger(ctx, 'facture', id, tr, true);
    await verifierValideur(ctx, 'facture', d, tr);
    const r = await controlerFacture(ctx, tr, d);
    // Rapprochement figé : ce qui était reçu et commandé au jour de la validation.
    for (const x of r) {
      await X('UPDATE com_facture_fourn_lignes SET quantite_recue = :q, prix_commande = :p WHERE id = :id', { q: x.recu_net, p: x.prix_commande, id: x.ligne_id }, tr);
    }
    await X("UPDATE com_factures_fournisseurs SET statut = 'valide', valide_par = :u, valide_le = NOW() WHERE id = :id", { u: ctx.userId, id: d.id }, tr);
    await auditer(tr, ctx, 'facture', 'COM_FACTURE_FOURN_VALIDATION', d.id, { numero: d.numero, total_ttc: Number(d.total_ttc),
      ecarts: r.filter((x) => x.alerte_quantite || x.alerte_prix).length });
  });
  return lireFacture(ctx, id);
};

const annulerFacture = async (ctx, id, body = {}) => {
  exiger(ctx, 'com.factures_fourn.annuler', 'annuler les factures fournisseurs');
  const motif = txt(body.motif);
  if (motif.length < 3) throw new ErreurAchat(400, 'Indiquez le motif de l\'annulation.');
  await sequelize.transaction(async (tr) => {
    const d = await charger(ctx, 'facture', id, tr, true);
    if (d.statut !== 'valide') throw new ErreurAchat(409, 'Seule une pièce validée s\'annule.');
    const [av] = await Q("SELECT numero FROM com_factures_fournisseurs WHERE facture_origine_id = :f AND statut <> 'annule' LIMIT 1", { f: d.id }, tr);
    if (av) throw new ErreurAchat(409, `L'avoir ${av.numero} porte sur cette facture : annulez-le d'abord.`);
    await X("UPDATE com_factures_fournisseurs SET statut = 'annule', annule_par = :u, annule_le = NOW(), motif_annulation = :m WHERE id = :id",
      { u: ctx.userId, m: motif.slice(0, 500), id: d.id }, tr);
    await auditer(tr, ctx, 'facture', 'COM_FACTURE_FOURN_ANNULATION', d.id, { numero: d.numero, motif });
  });
  return lireFacture(ctx, id);
};

// ── Pièces jointes ────────────────────────────────────────────────────────
const joindre = async (ctx, sorte, id, body = {}) => {
  const s = SORTES[sorte];
  const d = await charger(ctx, sorte, id);
  if (!['brouillon', 'a_valider'].includes(d.statut)) throw new ErreurAchat(409, 'Les pièces d\'un document validé sont figées.');
  exigerUn(ctx, [s.saisir, s.valider], `traiter les ${s.nom}s`);
  const f = docs.preparer(body);
  const chemin = await docs.ecrire(ctx.tenantId, s.objet, d.id, f);
  await sequelize.transaction(async (tr) => {
    await X(`INSERT INTO com_documents (tenant_id, objet_type, objet_id, categorie, nom, mime, taille, sha256, chemin, ajoute_par)
             VALUES (:t, :o, :d, 'justificatif', :nom, :mime, :taille, :sha, :chemin, :u)`,
    { t: ctx.tenantId, o: s.objet, d: d.id, nom: f.nom, mime: f.mime, taille: f.taille, sha: f.sha256, chemin, u: ctx.userId }, tr);
    await auditer(tr, ctx, sorte, `${ACTIONS[sorte]}_PIECE_AJOUT`, d.id, { nom: f.nom, sha256: f.sha256 });
  });
  return lecteurs[sorte](ctx, d.id);
};
const lirePiece = async (ctx, sorte, id, docId) => {
  if (!peutVoir(ctx, sorte)) throw new ErreurAchat(403, 'Permission requise.');
  const d = await charger(ctx, sorte, id);
  const [x] = await Q('SELECT * FROM com_documents WHERE id = :x AND tenant_id = :t AND objet_type = :o AND objet_id = :d AND NOT retire',
    { x: entier(docId, 'Pièce'), t: ctx.tenantId, o: SORTES[sorte].objet, d: d.id });
  if (!x) throw new ErreurAchat(404, 'Pièce introuvable.');
  return { chemin: docs.resoudre(x.chemin), nom: x.nom, mime: x.mime, sha256: x.sha256 };
};

module.exports = {
  ErreurAchat, STATUTS, SORTES, VOIR_RECEPTIONS, VOIR_FACTURES, lister, compteurs,
  aRecevoir, propositionReception, lireReception, creerReception, modifierReception, validerReception, annulerReception,
  propositionRetour, lireRetour, creerRetour, modifierRetour, validerRetour, annulerRetour,
  listeAFacturer, fournisseursAFacturer, lireFacture, creerFacture, modifierFacture, validerFacture, annulerFacture,
  soumettre, renvoyer, supprimer, joindre, lirePiece,
};
