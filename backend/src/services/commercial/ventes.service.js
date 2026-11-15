'use strict';
// NJ COMMERCIAL — lot 6 : ventes (migration 059).
//
//   Devis        : saisi par le commercial (com.ventes.devis) ; soumis, validé par le
//                  responsable commercial (com.ventes.valider), puis par la direction
//                  (com.ventes.valider_direction) si le total TTC dépasse le seuil des
//                  ventes ou si une remise dépasse le plafond. Jamais validé par son
//                  auteur (sauf auto-validation activée). Une fois validé : PDF « bon
//                  pour accord », accepté ou refusé par le client avant sa date de validité.
//   Commande     : née de l'acceptation (com.ventes.commandes) ; copie figée des lignes
//                  du devis, référence et pièce du bon de commande du client.
//   Livraison    : préparée au magasin (com.ventes.preparer), validée par une autre
//                  personne (com.ventes.livrer) ; la validation fait sortir le stock au
//                  coût du moteur (CMUP ou lots FIFO) ; partielle possible, jamais au-delà
//                  du reste à livrer ; stock négatif refusé (sauf paramètre).
//   Annulation   : motivée (com.ventes.annuler) ; une livraison annulée rentre en stock.
// Aucune écriture comptable ; la facture client viendra au lot 7 et son règlement
// se saisira dans NJ CAISSE PRO.
const { sequelize } = require('../../models');
const moteur = require('./stock.service');
const docs = require('./documents.service');
const pdf = require('./ventes_pdf.service');

const T = sequelize.QueryTypes;
const Q = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: T.SELECT, transaction });
const X = (sql, replacements, transaction) => sequelize.query(sql, { replacements, transaction });
const perim = () => require('./demandes.service');

class ErreurVente extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const STATUTS_DEVIS = { brouillon: 'Brouillon', a_valider: 'À valider', a_valider_direction: 'À valider (direction)', valide: 'Validé',
  accepte: 'Accepté', refuse: 'Refusé', annule: 'Annulé' };
const STATUTS_COMMANDE = { ouverte: 'Ouverte', annulee: 'Annulée' };
const STATUTS_LIVRAISON = { brouillon: 'En préparation', preparee: 'Préparée', livree: 'Livrée', annule: 'Annulée' };
const VOIR = ['com.ventes.voir', 'com.ventes.devis', 'com.ventes.valider', 'com.ventes.valider_direction', 'com.ventes.commandes',
  'com.ventes.preparer', 'com.ventes.livrer', 'com.ventes.annuler'];
const PRIX = ['com.ventes.devis', 'com.ventes.valider', 'com.ventes.valider_direction', 'com.ventes.commandes', 'com.ventes.annuler'];
const OBJETS = { devis: { objet: 'devis', audit: 'DV' }, commande: { objet: 'commande_client', audit: 'CC' }, livraison: { objet: 'livraison', audit: 'LV' } };

const txt = (v) => String(v ?? '').trim();
const q3 = (n) => Math.round(n * 1000) / 1000;
const entier = (v, nom) => {
  const n = Number.parseInt(v, 10);
  if (!Number.isInteger(n) || n <= 0) throw new ErreurVente(400, `${nom} invalide.`);
  return n;
};
const nombre = (v, nom, { vide = null, max = 1e12 } = {}) => {
  if (v === undefined || v === null || txt(v) === '') return vide;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > max) throw new ErreurVente(400, `${nom} invalide.`);
  return n;
};
const dateOk = (v, nom, { requise = true } = {}) => {
  const d = txt(v);
  if (!d) { if (requise) throw new ErreurVente(400, `${nom} obligatoire.`); return null; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) throw new ErreurVente(400, `${nom} invalide (AAAA-MM-JJ).`);
  return d;
};
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const jour = (d) => (d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)) : null);
const plusJours = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const pasFutur = (d, nom) => { if (d && d > aujourdhui()) throw new ErreurVente(400, `${nom} ne peut pas être dans le futur.`); return d; };
const longueur = (v, max, nom) => { const s = txt(v); if (s.length > max) throw new ErreurVente(400, `${nom} : ${max} caractères au plus.`); return s; };
const arrondi = (n, dec) => { const f = 10 ** dec; return Math.round(n * f) / f; };

const exiger = (ctx, code, libelle) => { if (!ctx.peut(code)) throw new ErreurVente(403, `Permission requise : ${libelle}.`); };
const exigerUn = (ctx, codes, libelle) => { if (!codes.some((c) => ctx.peut(c))) throw new ErreurVente(403, `Permission requise : ${libelle}.`); };
const voitPrix = (ctx) => PRIX.some((c) => ctx.peut(c));
const motifOk = (v, quoi) => { const m = txt(v); if (m.length < 3) throw new ErreurVente(400, `Indiquez ${quoi}.`); return m.slice(0, 500); };

const auditer = (tr, ctx, sorte, action, id, apres) => X(
  `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, nouvelle_valeur)
   VALUES (:t, :u, :a, 'commercial', :id, CAST(:ap AS jsonb))`,
  { t: ctx.tenantId, u: ctx.userId, a: action, id: `${OBJETS[sorte].audit}:${id}`, ap: apres ? JSON.stringify(apres) : null }, tr);

const numeroter = async (tr, tenantId, prefixe) => {
  const annee = new Date().getFullYear();
  const [r] = await Q(
    `INSERT INTO com_compteurs (tenant_id, type, annee, dernier) VALUES (:t, :type, :a, 1)
     ON CONFLICT (tenant_id, type, annee) DO UPDATE SET dernier = com_compteurs.dernier + 1 RETURNING dernier`,
    { t: tenantId, type: prefixe, a: annee }, tr);
  return `${prefixe}-${annee}-${String(r.dernier).padStart(4, '0')}`;
};

const parametres = async (tenantId, tr) => {
  const [p] = await Q(`SELECT stock_negatif_autorise, autovalidation_stock, ventes_seuil_direction, ventes_remise_max_pct, devis_validite_jours
                         FROM com_parametres WHERE tenant_id = :t`, { t: tenantId }, tr);
  const [t] = await Q('SELECT devise FROM tenants WHERE id = :t', { t: tenantId }, tr);
  const devise = t?.devise || 'FCFA';
  return {
    negatif: Boolean(p?.stock_negatif_autorise), autovalidation: Boolean(p?.autovalidation_stock), devise, dec: pdf.decimales(devise),
    seuil: p ? (p.ventes_seuil_direction === null ? null : Number(p.ventes_seuil_direction)) : 1000000,
    remiseMax: p?.ventes_remise_max_pct === null || p?.ventes_remise_max_pct === undefined ? 10 : Number(p.ventes_remise_max_pct),
    validite: Number(p?.devis_validite_jours) > 0 ? Number(p.devis_validite_jours) : 30,
  };
};

const verifierDecimales = async (tr, uniteId, q, libelle, unite) => {
  if (!uniteId) return;
  const [u] = await Q('SELECT decimales FROM com_unites WHERE id = :u', { u: uniteId }, tr);
  const dec = 10 ** Number(u?.decimales ?? 3);
  if (Math.round(q * dec) !== q * dec) {
    throw new ErreurVente(400, `« ${libelle} » : quantité en ${unite}, ${Number(u?.decimales) ? `${u.decimales} décimale(s) au plus` : 'nombre entier'}.`);
  }
};

// Pièces jointes et historique d'un document.
const annexes = async (ctx, sorte, id) => {
  const pieces = await Q(
    `SELECT x.id, x.nom, x.mime, x.taille, x.sha256, x.ajoute_le, u.username AS ajoute_par_nom
       FROM com_documents x LEFT JOIN users u ON u.id = x.ajoute_par
      WHERE x.tenant_id = :t AND x.objet_type = :o AND x.objet_id = :id AND NOT x.retire ORDER BY x.ajoute_le`,
    { t: ctx.tenantId, o: OBJETS[sorte].objet, id });
  const historique = await Q(
    `SELECT a.created_at AS le, a.action, u.username AS par_nom, a.nouvelle_valeur FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.tenant_id = :t AND a.entite = 'commercial' AND a.entite_id = :e ORDER BY a.created_at, a.id`, { t: ctx.tenantId, e: `${OBJETS[sorte].audit}:${id}` });
  return { pieces: pieces.map((x) => ({ ...x, id: Number(x.id), taille: Number(x.taille) })), historique };
};

// Client : un tiers « client » ou « mixte », actif, du même client SaaS.
const chargerClient = async (ctx, clientId, tr, { actif = true } = {}) => {
  const [c] = await Q(
    `SELECT r.id, r.nom, r.nui, r.telephone, r.email, r.adresse, r.type, r.actif, COALESCE(c.nom_commercial, '') AS nom_commercial,
            COALESCE(c.ville, '') AS ville, COALESCE(c.pays, '') AS pays, COALESCE(c.contact_nom, '') AS contact_nom,
            COALESCE(c.contact_telephone, '') AS contact_telephone, COALESCE(c.conditions_paiement, '') AS conditions_paiement
       FROM registre_tiers r LEFT JOIN com_tiers c ON c.tiers_id = r.id WHERE r.tenant_id = :t AND r.id = :c`,
    { t: ctx.tenantId, c: entier(clientId, 'Client') }, tr);
  if (!c || !['client', 'mixte'].includes(c.type)) throw new ErreurVente(400, 'Choisissez un client (tiers de type client).');
  if (actif && !c.actif) throw new ErreurVente(400, `Le client « ${c.nom} » est désactivé.`);
  return c;
};

const societe = async (tenantId, tr) => {
  const [s] = await Q(`SELECT t.nom AS raison_sociale, t.sigle, t.forme_juridique, t.logo_url, t.adresse, t.boite_postale, t.ville, t.pays,
                              t.telephone, t.email, t.nui, t.registre_commerce, COALESCE(p.nom_commercial, '') AS nom_commercial,
                              COALESCE(p.mentions_documents, '') AS mentions_documents
                         FROM tenants t LEFT JOIN com_parametres p ON p.tenant_id = t.id WHERE t.id = :t`, { t: tenantId }, tr);
  return { ...s, nom_affiche: s.nom_commercial || s.raison_sociale };
};

// ══ DEVIS ═══════════════════════════════════════════════════════════════
const SQL_DEVIS = `
  SELECT d.*, c.nom AS client_nom, uc.username AS cree_par_nom, ur.username AS valide_resp_nom, ud.username AS valide_dir_nom,
         ux.username AS decision_nom, ua.username AS annule_par_nom,
         (SELECT COUNT(*)::int FROM com_devis_lignes l WHERE l.devis_id = d.id) AS nb_lignes,
         (SELECT MAX(l.remise_pct) FROM com_devis_lignes l WHERE l.devis_id = d.id) AS remise_max,
         cc.id AS commande_id, cc.numero AS commande_numero
    FROM com_devis d JOIN registre_tiers c ON c.id = d.client_id
    LEFT JOIN users uc ON uc.id = d.cree_par LEFT JOIN users ur ON ur.id = d.valide_resp_par LEFT JOIN users ud ON ud.id = d.valide_dir_par
    LEFT JOIN users ux ON ux.id = d.decision_par LEFT JOIN users ua ON ua.id = d.annule_par
    LEFT JOIN com_commandes_clients cc ON cc.devis_id = d.id AND cc.statut <> 'annulee'`;

const formaterDevis = (d, prix = true) => {
  const expire = d.statut === 'valide' && jour(d.date_validite) < aujourdhui();
  const out = { ...d, id: Number(d.id), client_id: Number(d.client_id), date_devis: jour(d.date_devis), date_validite: jour(d.date_validite),
    statut_libelle: expire ? 'Expiré' : STATUTS_DEVIS[d.statut], expire,
    commande_id: d.commande_id ? Number(d.commande_id) : null, remise_max: d.remise_max === null || d.remise_max === undefined ? 0 : Number(d.remise_max) };
  for (const k of ['total_brut', 'total_ht', 'total_taxes', 'total_ttc']) out[k] = prix ? Number(d[k]) : null;
  return out;
};

const chargerDevis = async (ctx, id, tr, verrou = false) => {
  const [d] = await Q(`${SQL_DEVIS} WHERE d.tenant_id = :t AND d.id = :id${verrou ? ' FOR UPDATE OF d' : ''}`, { t: ctx.tenantId, id: entier(id, 'Devis') }, tr);
  if (!d) throw new ErreurVente(404, 'Devis introuvable.');
  return d;
};

const listerDevis = async (ctx, { statut = '', q = '', du = '', au = '', client_id = '' } = {}) => {
  exigerUn(ctx, VOIR, 'consulter les ventes');
  const conds = ['d.tenant_id = :t']; const r = { t: ctx.tenantId };
  if (statut === 'expire') { conds.push("d.statut = 'valide' AND d.date_validite < CURRENT_DATE"); }
  else if (statut === 'en_validation') conds.push("d.statut IN ('a_valider', 'a_valider_direction')");
  else if (statut) { if (!STATUTS_DEVIS[statut]) throw new ErreurVente(400, 'Statut inconnu.'); conds.push('d.statut = :statut'); r.statut = statut; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(du)) { conds.push('d.date_devis >= :du'); r.du = du; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(au)) { conds.push('d.date_devis <= :au'); r.au = au; }
  if (Number.parseInt(client_id, 10)) { conds.push('d.client_id = :c'); r.c = Number.parseInt(client_id, 10); }
  if (txt(q)) { r.like = `%${txt(q).toLowerCase()}%`; conds.push('(lower(d.numero) LIKE :like OR lower(c.nom) LIKE :like OR lower(d.objet) LIKE :like)'); }
  const prix = voitPrix(ctx);
  return (await Q(`${SQL_DEVIS} WHERE ${conds.join(' AND ')} ORDER BY d.cree_le DESC LIMIT 500`, r)).map((d) => formaterDevis(d, prix));
};

// Calcul d'une ligne : unité de l'article, prix par défaut converti, remise, taxe de vente.
const preparerLigneDevis = async (ctx, tr, x, p) => {
  const articleId = entier(x.article_id, 'Article');
  const [a] = await Q(`SELECT a.id, a.reference, a.designation, a.actif, a.unite_vente_id, a.prix_vente_indicatif
                         FROM com_articles a WHERE a.id = :a AND a.tenant_id = :t`, { a: articleId, t: ctx.tenantId }, tr);
  if (!a) throw new ErreurVente(400, 'Article introuvable.');
  if (!a.actif) throw new ErreurVente(400, `L'article « ${a.designation} » est désactivé.`);
  const unites = await Q(`SELECT au.unite_id, au.coefficient, u.code FROM com_article_unites au JOIN com_unites u ON u.id = au.unite_id
                           WHERE au.article_id = :a`, { a: a.id }, tr);
  const uniteId = x.unite_id ? entier(x.unite_id, 'Unité') : Number(a.unite_vente_id);
  const u = unites.find((y) => Number(y.unite_id) === uniteId);
  if (!u) throw new ErreurVente(400, `« ${a.designation} » ne se vend pas dans cette unité.`);
  const uv = unites.find((y) => Number(y.unite_id) === Number(a.unite_vente_id));
  const q = nombre(x.quantite, `Quantité de « ${a.designation} »`);
  if (!q) throw new ErreurVente(400, `Indiquez la quantité de « ${a.designation} ».`);
  await verifierDecimales(tr, uniteId, q, a.designation, u.code);
  let pu = nombre(x.prix_unitaire, `Prix de « ${a.designation} »`);
  if (pu === null) {
    if (a.prix_vente_indicatif === null) throw new ErreurVente(400, `Indiquez le prix de « ${a.designation} » (pas de prix de vente indicatif).`);
    pu = arrondi(Number(a.prix_vente_indicatif) / Number(uv?.coefficient || 1) * Number(u.coefficient), p.dec);
  }
  if (arrondi(pu, p.dec) !== pu) throw new ErreurVente(400, `Prix de « ${a.designation} » : ${p.dec ? `${p.dec} décimales au plus` : 'sans décimales'} en ${p.devise}.`);
  const remise = nombre(x.remise_pct, `Remise de « ${a.designation} »`, { vide: 0, max: 100 });
  // 062 : la taxe est celle choisie sur la ligne du devis (aucune si rien n'est choisi), jamais reprise de l'article.
  let taxeId = txt(x.taxe_id) ? entier(x.taxe_id, 'Taxe') : null;
  let taxe = { code: '', taux: 0 };
  if (taxeId) {
    const [t] = await Q("SELECT id, code, taux, actif, usage FROM com_taxes WHERE id = :x AND tenant_id = :t", { x: taxeId, t: ctx.tenantId }, tr);
    if (!t || !t.actif || t.usage === 'achat') throw new ErreurVente(400, `Taxe de vente invalide pour « ${a.designation} ».`);
    taxe = { code: t.code, taux: Number(t.taux) };
  } else taxeId = null;
  const ht = arrondi(q * pu * (1 - remise / 100), p.dec);
  return { article_id: Number(a.id), reference: a.reference, designation: a.designation, unite_id: uniteId, unite: u.code, coefficient: Number(u.coefficient),
    quantite: q3(q), prix_unitaire: pu, remise_pct: remise, taxe_id: taxeId, taxe_code: taxe.code, taxe_taux: taxe.taux,
    montant_ht: ht, montant_taxe: arrondi(ht * taxe.taux / 100, p.dec), brut: arrondi(q * pu, p.dec) };
};

const ecrireLignesDevis = async (ctx, tr, devisId, lignes) => {
  if (!Array.isArray(lignes) || !lignes.length) throw new ErreurVente(400, 'Un devis comporte au moins une ligne.');
  if (lignes.length > 200) throw new ErreurVente(400, '200 lignes au plus.');
  const p = await parametres(ctx.tenantId, tr);
  await X('DELETE FROM com_devis_lignes WHERE devis_id = :d', { d: devisId }, tr);
  const tot = { brut: 0, ht: 0, tx: 0 };
  for (const [i, x] of lignes.entries()) {
    const l = await preparerLigneDevis(ctx, tr, x, p);
    await X(`INSERT INTO com_devis_lignes (devis_id, tenant_id, ordre, article_id, reference, designation, unite_id, unite, coefficient, quantite,
               prix_unitaire, remise_pct, taxe_id, taxe_code, taxe_taux, montant_ht, montant_taxe)
             VALUES (:d, :t, :o, :article_id, :reference, :designation, :unite_id, :unite, :coefficient, :quantite,
               :prix_unitaire, :remise_pct, :taxe_id, :taxe_code, :taxe_taux, :montant_ht, :montant_taxe)`,
    { ...l, d: devisId, t: ctx.tenantId, o: i }, tr);
    tot.brut += l.brut; tot.ht += l.montant_ht; tot.tx += l.montant_taxe;
  }
  const t = { brut: arrondi(tot.brut, p.dec), ht: arrondi(tot.ht, p.dec), tx: arrondi(tot.tx, p.dec) };
  await X('UPDATE com_devis SET total_brut = :b, total_ht = :h, total_taxes = :x, total_ttc = :ttc, modifie_le = NOW() WHERE id = :d',
    { b: t.brut, h: t.ht, x: t.tx, ttc: arrondi(t.ht + t.tx, p.dec), d: devisId }, tr);
  return lignes.length;
};

const valeursDevis = (b, p) => {
  const date = pasFutur(dateOk(b.date_devis || aujourdhui(), 'Date du devis'), 'La date du devis');
  const validite = dateOk(b.date_validite || plusJours(date, p.validite), 'Date de validité');
  if (validite < date) throw new ErreurVente(400, 'La date de validité ne peut pas précéder la date du devis.');
  return { date_devis: date, date_validite: validite, objet: longueur(b.objet, 300, 'Objet'),
    conditions_paiement: longueur(b.conditions_paiement, 300, 'Conditions de paiement'), delai_livraison: longueur(b.delai_livraison, 200, 'Délai de livraison'),
    observations: longueur(b.observations, 2000, 'Observations') };
};

// Niveau de validation exigé et sa raison (seuil des ventes, plafond de remise).
const niveauRequis = (d, p) => {
  const raisons = [];
  if (p.seuil !== null && Number(d.total_ttc) > p.seuil) raisons.push(`montant TTC supérieur au seuil des ventes (${p.seuil.toLocaleString('fr-FR')} ${p.devise})`);
  if (Number(d.remise_max || 0) > p.remiseMax) raisons.push(`remise de ${Number(d.remise_max)} % supérieure au plafond de ${p.remiseMax} %`);
  return { niveau: raisons.length ? 'direction' : 'responsable', motif: raisons.join(' ; ') };
};

const droitsDevis = (ctx, d, p) => {
  const auteur = d.cree_par === ctx.userId;
  const autre = !auteur || p.autovalidation;
  const expire = d.statut === 'valide' && jour(d.date_validite) < aujourdhui();
  return {
    modifier: d.statut === 'brouillon' && ctx.peut('com.ventes.devis'),
    soumettre: d.statut === 'brouillon' && ctx.peut('com.ventes.devis'),
    valider: autre && ((d.statut === 'a_valider' && ctx.peut('com.ventes.valider')) || (d.statut === 'a_valider_direction' && ctx.peut('com.ventes.valider_direction'))),
    renvoyer: autre && ((d.statut === 'a_valider' && ctx.peut('com.ventes.valider')) || (d.statut === 'a_valider_direction' && ctx.peut('com.ventes.valider_direction'))),
    auto_validation_interdite: auteur && !p.autovalidation && ((d.statut === 'a_valider' && ctx.peut('com.ventes.valider'))
      || (d.statut === 'a_valider_direction' && ctx.peut('com.ventes.valider_direction'))),
    accepter: d.statut === 'valide' && !expire && ctx.peut('com.ventes.commandes'),
    refuser: d.statut === 'valide' && ctx.peut('com.ventes.commandes'),
    annuler: ['a_valider', 'a_valider_direction', 'valide'].includes(d.statut) && ctx.peut('com.ventes.annuler'),
    dupliquer: d.statut !== 'brouillon' && ctx.peut('com.ventes.devis'),
    pdf: true,
    joindre: !['annule'].includes(d.statut) && (ctx.peut('com.ventes.devis') || ctx.peut('com.ventes.commandes')),
  };
};

const lireDevis = async (ctx, id) => {
  exigerUn(ctx, VOIR, 'consulter les ventes');
  const d = await chargerDevis(ctx, id);
  const p = await parametres(ctx.tenantId);
  const prix = voitPrix(ctx);
  const lignes = await Q(`SELECT l.*, a.suivi_stock FROM com_devis_lignes l JOIN com_articles a ON a.id = l.article_id
                           WHERE l.devis_id = :d ORDER BY l.ordre, l.id`, { d: d.id });
  const client = await chargerClient(ctx, d.client_id, null, { actif: false });
  const f = formaterDevis(d, prix);
  return {
    ...f, client,
    niveau_calcule: d.statut === 'brouillon' ? niveauRequis(f, p) : { niveau: d.niveau, motif: d.motif_direction },
    regles: { seuil_direction: p.seuil, remise_max_pct: p.remiseMax, validite_jours: p.validite, devise: p.devise },
    lignes: lignes.map((l) => ({ ...l, id: Number(l.id), article_id: Number(l.article_id), unite_id: l.unite_id ? Number(l.unite_id) : null,
      taxe_id: l.taxe_id ? Number(l.taxe_id) : null, coefficient: Number(l.coefficient), quantite: Number(l.quantite), remise_pct: Number(l.remise_pct),
      taxe_taux: Number(l.taxe_taux), prix_unitaire: prix ? Number(l.prix_unitaire) : null, montant_ht: prix ? Number(l.montant_ht) : null,
      montant_taxe: prix ? Number(l.montant_taxe) : null })),
    ...(await annexes(ctx, 'devis', d.id)),
    droits: droitsDevis(ctx, d, p),
  };
};

const creerDevis = async (ctx, body = {}) => {
  exiger(ctx, 'com.ventes.devis', 'saisir les devis');
  const id = await sequelize.transaction(async (tr) => {
    const p = await parametres(ctx.tenantId, tr);
    const c = await chargerClient(ctx, body.client_id, tr);
    const v = valeursDevis({ conditions_paiement: c.conditions_paiement, ...body }, p);
    const numero = await numeroter(tr, ctx.tenantId, 'DEV');
    const [r] = await Q(`INSERT INTO com_devis (tenant_id, numero, client_id, date_devis, date_validite, objet, conditions_paiement, delai_livraison, observations, devise, cree_par)
                         VALUES (:t, :numero, :c, :date_devis, :date_validite, :objet, :conditions_paiement, :delai_livraison, :observations, :devise, :u) RETURNING id`,
    { ...v, t: ctx.tenantId, numero, c: c.id, devise: p.devise, u: ctx.userId }, tr);
    const n = await ecrireLignesDevis(ctx, tr, r.id, body.lignes);
    await auditer(tr, ctx, 'devis', 'COM_DEVIS_CREATION', r.id, { numero, client: c.nom, nb_lignes: n });
    return r.id;
  });
  return lireDevis(ctx, id);
};

const modifierDevis = async (ctx, id, body = {}) => {
  exiger(ctx, 'com.ventes.devis', 'saisir les devis');
  await sequelize.transaction(async (tr) => {
    const d = await chargerDevis(ctx, id, tr, true);
    if (d.statut !== 'brouillon') throw new ErreurVente(409, 'Seul un devis en brouillon se modifie.');
    const p = await parametres(ctx.tenantId, tr);
    const c = body.client_id !== undefined ? await chargerClient(ctx, body.client_id, tr) : { id: d.client_id };
    const v = valeursDevis({ ...d, date_devis: jour(d.date_devis), date_validite: jour(d.date_validite), ...body }, p);
    await X(`UPDATE com_devis SET client_id = :c, date_devis = :date_devis, date_validite = :date_validite, objet = :objet, conditions_paiement = :conditions_paiement,
               delai_livraison = :delai_livraison, observations = :observations, modifie_le = NOW() WHERE id = :id`, { ...v, c: c.id, id: d.id }, tr);
    const apres = { ...v };
    if (body.lignes !== undefined) apres.nb_lignes = await ecrireLignesDevis(ctx, tr, d.id, body.lignes);
    await auditer(tr, ctx, 'devis', 'COM_DEVIS_MODIFICATION', d.id, apres);
  });
  return lireDevis(ctx, id);
};

const supprimerDevis = async (ctx, id) => {
  exiger(ctx, 'com.ventes.devis', 'saisir les devis');
  return sequelize.transaction(async (tr) => {
    const d = await chargerDevis(ctx, id, tr, true);
    if (d.statut !== 'brouillon') throw new ErreurVente(409, 'Seul un brouillon se supprime ; un devis soumis s\'annule.');
    await X("UPDATE com_documents SET retire = true, retire_par = :u, retire_le = NOW(), motif_retrait = 'Brouillon supprimé' WHERE objet_type = 'devis' AND objet_id = :d AND NOT retire",
      { u: ctx.userId, d: d.id }, tr);
    await X('DELETE FROM com_devis WHERE id = :id', { id: d.id }, tr);
    await auditer(tr, ctx, 'devis', 'COM_DEVIS_SUPPRESSION', d.id, { numero: d.numero });
    return { ok: true };
  });
};

const soumettreDevis = async (ctx, id) => {
  exiger(ctx, 'com.ventes.devis', 'saisir les devis');
  await sequelize.transaction(async (tr) => {
    const d = await chargerDevis(ctx, id, tr, true);
    if (d.statut !== 'brouillon') throw new ErreurVente(409, 'Ce devis a déjà été soumis.');
    if (!d.nb_lignes) throw new ErreurVente(400, 'Un devis comporte au moins une ligne.');
    if (jour(d.date_validite) < aujourdhui()) throw new ErreurVente(400, 'La date de validité est dépassée : prolongez-la avant de soumettre.');
    await chargerClient(ctx, d.client_id, tr);
    const n = niveauRequis(d, await parametres(ctx.tenantId, tr));
    await X(`UPDATE com_devis SET statut = 'a_valider', soumis_le = NOW(), motif_renvoi = '', niveau = :n, motif_direction = :m,
               valide_resp_par = NULL, valide_resp_le = NULL, valide_dir_par = NULL, valide_dir_le = NULL WHERE id = :id`,
    { n: n.niveau, m: n.motif, id: d.id }, tr);
    await auditer(tr, ctx, 'devis', 'COM_DEVIS_SOUMISSION', d.id, { numero: d.numero, total_ttc: Number(d.total_ttc), niveau: n.niveau, motif: n.motif });
  });
  return lireDevis(ctx, id);
};

// Validation : responsable puis, si exigé, direction. Une personne qui a les deux droits
// valide les deux niveaux d'un coup ; l'auteur ne valide jamais (sauf auto-validation).
const validerDevis = async (ctx, id) => {
  exigerUn(ctx, ['com.ventes.valider', 'com.ventes.valider_direction'], 'valider les devis');
  await sequelize.transaction(async (tr) => {
    const d = await chargerDevis(ctx, id, tr, true);
    const p = await parametres(ctx.tenantId, tr);
    if (!['a_valider', 'a_valider_direction'].includes(d.statut)) {
      throw new ErreurVente(409, d.statut === 'brouillon' ? 'Le devis doit d\'abord être soumis.' : 'Ce devis est déjà traité.');
    }
    if (d.cree_par === ctx.userId && !p.autovalidation) {
      throw new ErreurVente(403, 'Vous ne pouvez pas valider un devis que vous avez saisi : un autre valideur doit le faire.');
    }
    const direction = ctx.peut('com.ventes.valider_direction');
    if (d.statut === 'a_valider') {
      exiger(ctx, 'com.ventes.valider', 'valider les devis (responsable commercial)');
      if (d.niveau === 'direction' && !direction) {
        await X("UPDATE com_devis SET statut = 'a_valider_direction', valide_resp_par = :u, valide_resp_le = NOW() WHERE id = :id", { u: ctx.userId, id: d.id }, tr);
        await auditer(tr, ctx, 'devis', 'COM_DEVIS_VALIDATION_RESPONSABLE', d.id, { numero: d.numero, suite: 'direction', motif: d.motif_direction });
        return;
      }
      await X(`UPDATE com_devis SET statut = 'valide', valide_resp_par = :u, valide_resp_le = NOW(),
                 valide_dir_par = CASE WHEN niveau = 'direction' THEN CAST(:u AS uuid) END, valide_dir_le = CASE WHEN niveau = 'direction' THEN NOW() END WHERE id = :id`,
      { u: ctx.userId, id: d.id }, tr);
      await auditer(tr, ctx, 'devis', 'COM_DEVIS_VALIDATION', d.id, { numero: d.numero, niveaux: d.niveau === 'direction' ? 'responsable et direction' : 'responsable' });
      return;
    }
    exiger(ctx, 'com.ventes.valider_direction', 'valider les devis (direction)');
    await X("UPDATE com_devis SET statut = 'valide', valide_dir_par = :u, valide_dir_le = NOW() WHERE id = :id", { u: ctx.userId, id: d.id }, tr);
    await auditer(tr, ctx, 'devis', 'COM_DEVIS_VALIDATION_DIRECTION', d.id, { numero: d.numero, motif: d.motif_direction });
  });
  return lireDevis(ctx, id);
};

const renvoyerDevis = async (ctx, id, body = {}) => {
  exigerUn(ctx, ['com.ventes.valider', 'com.ventes.valider_direction'], 'valider les devis');
  const motif = motifOk(body.motif, 'ce qu\'il faut corriger');
  await sequelize.transaction(async (tr) => {
    const d = await chargerDevis(ctx, id, tr, true);
    if (!['a_valider', 'a_valider_direction'].includes(d.statut)) throw new ErreurVente(409, 'Seul un devis à valider peut être renvoyé.');
    exiger(ctx, d.statut === 'a_valider' ? 'com.ventes.valider' : 'com.ventes.valider_direction', 'valider ce devis');
    const p = await parametres(ctx.tenantId, tr);
    if (d.cree_par === ctx.userId && !p.autovalidation) throw new ErreurVente(403, 'Le renvoi revient à un autre valideur que l\'auteur.');
    await X("UPDATE com_devis SET statut = 'brouillon', motif_renvoi = :m WHERE id = :id", { m: motif, id: d.id }, tr);
    await auditer(tr, ctx, 'devis', 'COM_DEVIS_RENVOI', d.id, { numero: d.numero, motif });
  });
  return lireDevis(ctx, id);
};

const annulerDevis = async (ctx, id, body = {}) => {
  exiger(ctx, 'com.ventes.annuler', 'annuler les ventes');
  const motif = motifOk(body.motif, 'le motif de l\'annulation');
  await sequelize.transaction(async (tr) => {
    const d = await chargerDevis(ctx, id, tr, true);
    if (d.statut === 'accepte') throw new ErreurVente(409, 'Ce devis a donné une commande : annulez la commande.');
    if (!['a_valider', 'a_valider_direction', 'valide'].includes(d.statut)) throw new ErreurVente(409, d.statut === 'brouillon' ? 'Un brouillon se supprime.' : 'Ce devis est clos.');
    await X("UPDATE com_devis SET statut = 'annule', annule_par = :u, annule_le = NOW(), motif_annulation = :m WHERE id = :id", { u: ctx.userId, m: motif, id: d.id }, tr);
    await auditer(tr, ctx, 'devis', 'COM_DEVIS_ANNULATION', d.id, { numero: d.numero, motif });
  });
  return lireDevis(ctx, id);
};

const refuserDevis = async (ctx, id, body = {}) => {
  exiger(ctx, 'com.ventes.commandes', 'enregistrer les décisions des clients');
  const motif = motifOk(body.motif, 'la raison du refus du client');
  await sequelize.transaction(async (tr) => {
    const d = await chargerDevis(ctx, id, tr, true);
    if (d.statut !== 'valide') throw new ErreurVente(409, 'Seul un devis validé reçoit la réponse du client.');
    await X("UPDATE com_devis SET statut = 'refuse', decision_par = :u, decision_le = NOW(), motif_refus = :m WHERE id = :id", { u: ctx.userId, m: motif, id: d.id }, tr);
    await auditer(tr, ctx, 'devis', 'COM_DEVIS_REFUS_CLIENT', d.id, { numero: d.numero, motif });
  });
  return lireDevis(ctx, id);
};

// Nouveau brouillon à partir d'un devis (expiré, refusé, ou pour une variante).
const dupliquerDevis = async (ctx, id) => {
  exiger(ctx, 'com.ventes.devis', 'saisir les devis');
  const d = await chargerDevis(ctx, id);
  const lignes = await Q('SELECT * FROM com_devis_lignes WHERE devis_id = :d ORDER BY ordre, id', { d: d.id });
  const copie = await creerDevis(ctx, {
    client_id: d.client_id, objet: d.objet, conditions_paiement: d.conditions_paiement, delai_livraison: d.delai_livraison, observations: d.observations,
    lignes: lignes.map((l) => ({ article_id: l.article_id, unite_id: l.unite_id, quantite: Number(l.quantite), prix_unitaire: Number(l.prix_unitaire),
      remise_pct: Number(l.remise_pct), taxe_id: l.taxe_id ? Number(l.taxe_id) : '' })),
  });
  await sequelize.transaction((tr) => auditer(tr, ctx, 'devis', 'COM_DEVIS_DUPLICATION', copie.id, { origine: d.numero }));
  return lireDevis(ctx, copie.id);
};

const pdfDevis = async (ctx, id) => {
  exigerUn(ctx, PRIX, 'consulter les prix des ventes');
  const d = formaterDevis(await chargerDevis(ctx, id));
  const lignes = await Q('SELECT * FROM com_devis_lignes WHERE devis_id = :d ORDER BY ordre, id', { d: d.id });
  const valable = ['valide', 'accepte'].includes(d.statut);
  const contenu = await pdf.rendreDevis({ societe: await societe(ctx.tenantId), client: await chargerClient(ctx, d.client_id, null, { actif: false }),
    devis: { ...d, valide_nom: d.valide_dir_nom || d.valide_resp_nom }, lignes, valable });
  return { contenu, nom: `${d.numero}${valable ? '' : '-projet'}.pdf` };
};

// ══ COMMANDES CLIENTS ════════════════════════════════════════════════════
const SQL_COMMANDE = `
  SELECT cc.*, c.nom AS client_nom, d.numero AS devis_numero, uc.username AS cree_par_nom, ua.username AS annule_par_nom,
         (SELECT COUNT(*)::int FROM com_commande_client_lignes l WHERE l.commande_id = cc.id) AS nb_lignes,
         (SELECT COALESCE(SUM(l.quantite * l.coefficient), 0) FROM com_commande_client_lignes l WHERE l.commande_id = cc.id) AS q_commande,
         (SELECT COALESCE(SUM(ll.quantite * ll.coefficient), 0) FROM com_livraison_lignes ll JOIN com_livraisons lv ON lv.id = ll.livraison_id
           WHERE lv.commande_id = cc.id AND lv.statut = 'livree') AS q_livre,
         (SELECT COUNT(*)::int FROM com_livraisons lv WHERE lv.commande_id = cc.id AND lv.statut IN ('brouillon', 'preparee')) AS livraisons_en_cours
    FROM com_commandes_clients cc JOIN registre_tiers c ON c.id = cc.client_id JOIN com_devis d ON d.id = cc.devis_id
    LEFT JOIN users uc ON uc.id = cc.cree_par LEFT JOIN users ua ON ua.id = cc.annule_par`;

const etatLivraison = (c) => {
  const cmd = Number(c.q_commande); const liv = Number(c.q_livre);
  if (c.statut === 'annulee') return { code: 'annulee', libelle: 'Annulée' };
  if (liv <= 1e-9) return { code: 'a_livrer', libelle: 'À livrer' };
  if (liv + 1e-9 < cmd) return { code: 'partielle', libelle: 'Livrée en partie' };
  return { code: 'livree', libelle: 'Livrée' };
};
const formaterCommande = (c, prix = true) => {
  const e = etatLivraison(c);
  const out = { ...c, id: Number(c.id), devis_id: Number(c.devis_id), client_id: Number(c.client_id), date_commande: jour(c.date_commande),
    date_livraison_souhaitee: jour(c.date_livraison_souhaitee), statut_libelle: STATUTS_COMMANDE[c.statut], etat_livraison: e.code, etat_livraison_libelle: e.libelle };
  for (const k of ['total_ht', 'total_taxes', 'total_ttc']) out[k] = prix ? Number(c[k]) : null;
  delete out.q_commande; delete out.q_livre;
  return out;
};

const chargerCommande = async (ctx, id, tr, verrou = false) => {
  const [c] = await Q(`${SQL_COMMANDE} WHERE cc.tenant_id = :t AND cc.id = :id${verrou ? ' FOR UPDATE OF cc' : ''}`, { t: ctx.tenantId, id: entier(id, 'Commande') }, tr);
  if (!c) throw new ErreurVente(404, 'Commande client introuvable.');
  return c;
};

const listerCommandes = async (ctx, { statut = '', etat = '', q = '', du = '', au = '', client_id = '' } = {}) => {
  exigerUn(ctx, VOIR, 'consulter les ventes');
  const conds = ['cc.tenant_id = :t']; const r = { t: ctx.tenantId };
  if (statut) { if (!STATUTS_COMMANDE[statut]) throw new ErreurVente(400, 'Statut inconnu.'); conds.push('cc.statut = :statut'); r.statut = statut; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(du)) { conds.push('cc.date_commande >= :du'); r.du = du; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(au)) { conds.push('cc.date_commande <= :au'); r.au = au; }
  if (Number.parseInt(client_id, 10)) { conds.push('cc.client_id = :c'); r.c = Number.parseInt(client_id, 10); }
  if (txt(q)) { r.like = `%${txt(q).toLowerCase()}%`; conds.push('(lower(cc.numero) LIKE :like OR lower(c.nom) LIKE :like OR lower(cc.reference_client) LIKE :like OR lower(d.numero) LIKE :like)'); }
  const prix = voitPrix(ctx);
  const rows = (await Q(`${SQL_COMMANDE} WHERE ${conds.join(' AND ')} ORDER BY cc.cree_le DESC LIMIT 500`, r)).map((c) => formaterCommande(c, prix));
  return etat ? rows.filter((c) => c.etat_livraison === etat) : rows;
};

// Reste à livrer par ligne de commande (livrées + en préparation, sauf la livraison `sauf`).
const restesCommande = async (tr, commandeId, sauf = 0) => Q(
  `SELECT l.id, l.article_id, l.reference, l.designation, l.unite, l.unite_id, l.coefficient, l.quantite, a.suivi_stock, a.unite AS unite_stock,
          COALESCE(SUM(ll.quantite) FILTER (WHERE lv.statut = 'livree'), 0) AS livre,
          COALESCE(SUM(ll.quantite) FILTER (WHERE lv.statut IN ('brouillon', 'preparee') AND lv.id <> :sauf), 0) AS en_cours
     FROM com_commande_client_lignes l JOIN com_articles a ON a.id = l.article_id
     LEFT JOIN com_livraison_lignes ll ON ll.commande_ligne_id = l.id LEFT JOIN com_livraisons lv ON lv.id = ll.livraison_id
    WHERE l.commande_id = :c GROUP BY l.id, a.suivi_stock, a.unite ORDER BY l.ordre, l.id`, { c: commandeId, sauf }, tr)
  .then((rows) => rows.map((l) => {
    const quantite = Number(l.quantite); const livre = Number(l.livre); const enCours = Number(l.en_cours);
    return { ...l, id: Number(l.id), article_id: Number(l.article_id), unite_id: l.unite_id ? Number(l.unite_id) : null, coefficient: Number(l.coefficient),
      quantite, livre, en_cours: enCours, reste: Math.max(0, q3(quantite - livre - enCours)), reste_a_livrer: Math.max(0, q3(quantite - livre)) };
  }));

const lireCommande = async (ctx, id) => {
  exigerUn(ctx, VOIR, 'consulter les ventes');
  const c = await chargerCommande(ctx, id);
  const prix = voitPrix(ctx);
  const restes = new Map((await restesCommande(null, c.id)).map((l) => [l.id, l]));
  const lignes = await Q('SELECT * FROM com_commande_client_lignes WHERE commande_id = :c ORDER BY ordre, id', { c: c.id });
  const livraisons = await Q(`SELECT lv.id, lv.numero, lv.statut, lv.date_livraison, lv.magasin_id, m.code AS magasin_code
                                FROM com_livraisons lv JOIN com_magasins m ON m.id = lv.magasin_id WHERE lv.commande_id = :c ORDER BY lv.id`, { c: c.id });
  return {
    ...formaterCommande(c, prix), client: await chargerClient(ctx, c.client_id, null, { actif: false }),
    lignes: lignes.map((l) => {
      const r = restes.get(Number(l.id)) || {};
      return { ...l, id: Number(l.id), article_id: Number(l.article_id), devis_ligne_id: Number(l.devis_ligne_id), coefficient: Number(l.coefficient),
        quantite: Number(l.quantite), remise_pct: Number(l.remise_pct), taxe_taux: Number(l.taxe_taux), livre: r.livre || 0, en_cours: r.en_cours || 0,
        reste: r.reste_a_livrer ?? Number(l.quantite), prix_unitaire: prix ? Number(l.prix_unitaire) : null, montant_ht: prix ? Number(l.montant_ht) : null,
        montant_taxe: prix ? Number(l.montant_taxe) : null };
    }),
    livraisons: livraisons.map((x) => ({ ...x, id: Number(x.id), date_livraison: jour(x.date_livraison), statut_libelle: STATUTS_LIVRAISON[x.statut],
      visible: perim().dansPerimetre(ctx, Number(x.magasin_id)) })),
    ...(await annexes(ctx, 'commande', c.id)),
    droits: {
      livrer: c.statut === 'ouverte' && ctx.peut('com.ventes.preparer') && [...restes.values()].some((l) => l.reste > 1e-9),
      annuler: c.statut === 'ouverte' && ctx.peut('com.ventes.annuler'),
      joindre: c.statut === 'ouverte' && ctx.peut('com.ventes.commandes'),
    },
  };
};

// Acceptation du devis par le client : crée la commande (copie figée des lignes).
const accepterDevis = async (ctx, id, body = {}) => {
  exiger(ctx, 'com.ventes.commandes', 'enregistrer les commandes clients');
  const commandeId = await sequelize.transaction(async (tr) => {
    const d = await chargerDevis(ctx, id, tr, true);
    if (d.statut !== 'valide') throw new ErreurVente(409, d.statut === 'accepte' ? 'Ce devis a déjà donné une commande.' : 'Seul un devis validé peut être accepté.');
    if (jour(d.date_validite) < aujourdhui()) throw new ErreurVente(409, `Ce devis a expiré le ${jour(d.date_validite)} : établissez un nouveau devis (« Dupliquer »).`);
    await chargerClient(ctx, d.client_id, tr);
    const dateCommande = pasFutur(dateOk(body.date_commande || aujourdhui(), 'Date de la commande'), 'La date de la commande');
    if (dateCommande < jour(d.date_devis)) throw new ErreurVente(400, 'La commande ne peut pas précéder le devis.');
    const souhaitee = dateOk(body.date_livraison_souhaitee, 'Date de livraison souhaitée', { requise: false });
    if (souhaitee && souhaitee < dateCommande) throw new ErreurVente(400, 'La livraison souhaitée ne peut pas précéder la commande.');
    const numero = await numeroter(tr, ctx.tenantId, 'CDC');
    const [c] = await Q(`INSERT INTO com_commandes_clients (tenant_id, numero, devis_id, client_id, reference_client, date_commande, date_livraison_souhaitee,
                           adresse_livraison, observations, devise, total_ht, total_taxes, total_ttc, cree_par)
                         VALUES (:t, :numero, :d, :c, :ref, :dc, :ds, :adr, :obs, :devise, :ht, :tx, :ttc, :u) RETURNING id`,
    { t: ctx.tenantId, numero, d: d.id, c: d.client_id, ref: longueur(body.reference_client, 60, 'Référence du client'), dc: dateCommande, ds: souhaitee,
      adr: longueur(body.adresse_livraison, 300, 'Adresse de livraison'), obs: longueur(body.observations, 2000, 'Observations'), devise: d.devise,
      ht: d.total_ht, tx: d.total_taxes, ttc: d.total_ttc, u: ctx.userId }, tr);
    await X(`INSERT INTO com_commande_client_lignes (commande_id, tenant_id, ordre, devis_ligne_id, article_id, reference, designation, unite_id, unite, coefficient,
               quantite, prix_unitaire, remise_pct, taxe_id, taxe_code, taxe_taux, montant_ht, montant_taxe)
             SELECT :c, tenant_id, ordre, id, article_id, reference, designation, unite_id, unite, coefficient, quantite, prix_unitaire, remise_pct,
                    taxe_id, taxe_code, taxe_taux, montant_ht, montant_taxe FROM com_devis_lignes WHERE devis_id = :d ORDER BY ordre, id`, { c: c.id, d: d.id }, tr);
    await X("UPDATE com_devis SET statut = 'accepte', decision_par = :u, decision_le = NOW() WHERE id = :id", { u: ctx.userId, id: d.id }, tr);
    await auditer(tr, ctx, 'devis', 'COM_DEVIS_ACCEPTATION', d.id, { numero: d.numero, commande: numero });
    await auditer(tr, ctx, 'commande', 'COM_COMMANDE_CLIENT_CREATION', c.id, { numero, devis: d.numero, reference_client: txt(body.reference_client) });
    return c.id;
  });
  if (body.piece && body.piece.data_base64) await joindre(ctx, 'commande', commandeId, body.piece);
  return lireCommande(ctx, commandeId);
};

const annulerCommande = async (ctx, id, body = {}) => {
  exiger(ctx, 'com.ventes.annuler', 'annuler les ventes');
  const motif = motifOk(body.motif, 'le motif de l\'annulation');
  await sequelize.transaction(async (tr) => {
    const c = await chargerCommande(ctx, id, tr, true);
    if (c.statut !== 'ouverte') throw new ErreurVente(409, 'Cette commande est déjà annulée.');
    const [lv] = await Q("SELECT numero FROM com_livraisons WHERE commande_id = :c AND statut <> 'annule' LIMIT 1", { c: c.id }, tr);
    if (lv) throw new ErreurVente(409, `La livraison ${lv.numero} porte sur cette commande : annulez-la (ou supprimez-la) d'abord.`);
    await X("UPDATE com_commandes_clients SET statut = 'annulee', annule_par = :u, annule_le = NOW(), motif_annulation = :m WHERE id = :id",
      { u: ctx.userId, m: motif, id: c.id }, tr);
    await auditer(tr, ctx, 'commande', 'COM_COMMANDE_CLIENT_ANNULATION', c.id, { numero: c.numero, motif });
  });
  return lireCommande(ctx, id);
};

// ══ PRÉPARATIONS ET LIVRAISONS ═══════════════════════════════════════════
const SQL_LIVRAISON = `
  SELECT lv.*, c.nom AS client_nom, cc.numero AS commande_numero, cc.reference_client, cc.statut AS commande_statut, d.numero AS devis_numero,
         m.code AS magasin_code, m.nom AS magasin_nom,
         uc.username AS cree_par_nom, up.username AS prepare_par_nom, ul.username AS livre_par_nom, ua.username AS annule_par_nom,
         (SELECT COUNT(*)::int FROM com_livraison_lignes l WHERE l.livraison_id = lv.id) AS nb_lignes
    FROM com_livraisons lv JOIN registre_tiers c ON c.id = lv.client_id JOIN com_commandes_clients cc ON cc.id = lv.commande_id
    JOIN com_devis d ON d.id = cc.devis_id JOIN com_magasins m ON m.id = lv.magasin_id
    LEFT JOIN users uc ON uc.id = lv.cree_par LEFT JOIN users up ON up.id = lv.prepare_par
    LEFT JOIN users ul ON ul.id = lv.livre_par LEFT JOIN users ua ON ua.id = lv.annule_par`;

const formaterLivraison = (x) => ({ ...x, id: Number(x.id), commande_id: Number(x.commande_id), client_id: Number(x.client_id), magasin_id: Number(x.magasin_id),
  date_livraison: jour(x.date_livraison), statut_libelle: STATUTS_LIVRAISON[x.statut] });

const chargerLivraison = async (ctx, id, tr, verrou = false) => {
  const [x] = await Q(`${SQL_LIVRAISON} WHERE lv.tenant_id = :t AND lv.id = :id${verrou ? ' FOR UPDATE OF lv' : ''}`, { t: ctx.tenantId, id: entier(id, 'Livraison') }, tr);
  if (!x || !perim().dansPerimetre(ctx, Number(x.magasin_id))) throw new ErreurVente(404, 'Livraison introuvable.');
  return x;
};

const listerLivraisons = async (ctx, { statut = '', q = '', du = '', au = '', commande_id = '' } = {}) => {
  exigerUn(ctx, VOIR, 'consulter les ventes');
  const p = perim().sqlPerimetre(ctx, 'lv.magasin_id');
  const conds = ['lv.tenant_id = :t', p.sql]; const r = { t: ctx.tenantId, ...p.r };
  if (statut === 'en_cours') conds.push("lv.statut IN ('brouillon', 'preparee')");
  else if (statut) { if (!STATUTS_LIVRAISON[statut]) throw new ErreurVente(400, 'Statut inconnu.'); conds.push('lv.statut = :statut'); r.statut = statut; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(du)) { conds.push('lv.date_livraison >= :du'); r.du = du; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(au)) { conds.push('lv.date_livraison <= :au'); r.au = au; }
  if (Number.parseInt(commande_id, 10)) { conds.push('lv.commande_id = :cmd'); r.cmd = Number.parseInt(commande_id, 10); }
  if (txt(q)) { r.like = `%${txt(q).toLowerCase()}%`; conds.push('(lower(lv.numero) LIKE :like OR lower(c.nom) LIKE :like OR lower(cc.numero) LIKE :like OR lower(cc.reference_client) LIKE :like)'); }
  return (await Q(`${SQL_LIVRAISON} WHERE ${conds.join(' AND ')} ORDER BY lv.cree_le DESC LIMIT 500`, r)).map(formaterLivraison);
};

// Commandes ouvertes qui restent à livrer.
const aLivrer = async (ctx) => {
  exigerUn(ctx, ['com.ventes.preparer', 'com.ventes.livrer'], 'préparer les livraisons');
  const rows = await Q(`${SQL_COMMANDE} WHERE cc.tenant_id = :t AND cc.statut = 'ouverte' ORDER BY COALESCE(cc.date_livraison_souhaitee, cc.date_commande), cc.id`,
    { t: ctx.tenantId });
  return rows.map((c) => formaterCommande(c, false)).filter((c) => c.etat_livraison !== 'livree');
};

// Stock disponible de chaque article dans un magasin (unité de stock).
const disponibles = async (tr, articleIds, magasinId) => {
  const out = new Map();
  for (const a of articleIds) out.set(a, await moteur.quantite(tr, a, magasinId));
  return out;
};

const propositionLivraison = async (ctx, commandeId, magasinId) => {
  exiger(ctx, 'com.ventes.preparer', 'préparer les livraisons');
  const c = await chargerCommande(ctx, commandeId);
  if (c.statut !== 'ouverte') throw new ErreurVente(409, 'Cette commande est annulée.');
  const lignes = await restesCommande(null, c.id);
  const mag = Number.parseInt(magasinId, 10) || null;
  if (mag && !perim().dansPerimetre(ctx, mag)) throw new ErreurVente(403, 'Magasin hors de votre périmètre.');
  const dispo = mag ? await disponibles(null, [...new Set(lignes.filter((l) => l.suivi_stock).map((l) => l.article_id))], mag) : new Map();
  return { commande_id: Number(c.id), commande_numero: c.numero, client_nom: c.client_nom, reference_client: c.reference_client,
    adresse_livraison: c.adresse_livraison, magasin_id: mag,
    lignes: lignes.map((l) => ({ ...l, disponible_stock: l.suivi_stock && mag ? dispo.get(l.article_id) : null,
      disponible: l.suivi_stock && mag ? q3(dispo.get(l.article_id) / l.coefficient) : null })) };
};

const valeursLivraison = (b) => ({
  date_livraison: pasFutur(dateOk(b.date_livraison || aujourdhui(), 'Date de livraison'), 'La date de livraison'),
  adresse_livraison: longueur(b.adresse_livraison, 300, 'Adresse de livraison'), transporteur: longueur(b.transporteur, 150, 'Transporteur'),
  observations: longueur(b.observations, 2000, 'Observations'),
});

const ecrireLignesLivraison = async (ctx, tr, lv, lignes) => {
  if (!Array.isArray(lignes)) throw new ErreurVente(400, 'Liste de lignes invalide.');
  await X('DELETE FROM com_livraison_lignes WHERE livraison_id = :l', { l: lv.id }, tr);
  const restes = new Map((await restesCommande(tr, lv.commande_id, lv.id)).map((l) => [l.id, l]));
  let n = 0; const vus = new Set();
  for (const [i, x] of lignes.entries()) {
    const q = nombre(x.quantite, 'Quantité', { vide: 0 });
    if (!q) continue;
    const lid = entier(x.commande_ligne_id, 'Ligne de commande');
    const l = restes.get(lid);
    if (!l) throw new ErreurVente(400, 'Cette ligne n\'appartient pas à la commande.');
    if (vus.has(lid)) throw new ErreurVente(400, 'Une même ligne figure deux fois.');
    vus.add(lid);
    await verifierDecimales(tr, l.unite_id, q, l.designation, l.unite);
    await X(`INSERT INTO com_livraison_lignes (livraison_id, tenant_id, ordre, commande_ligne_id, article_id, unite, coefficient, quantite, observation)
             VALUES (:lv, :t, :o, :l, :a, :u, :k, :q, :obs)`,
    { lv: lv.id, t: ctx.tenantId, o: i, l: lid, a: l.article_id, u: l.unite, k: l.coefficient, q: q3(q), obs: longueur(x.observation, 500, 'Observation de ligne') }, tr);
    n += 1;
  }
  return n;
};

// Contrôles d'une livraison : au moins une ligne, jamais au-delà du reste, stock suffisant.
const controlerLivraison = async (tr, lv, p) => {
  const restes = new Map((await restesCommande(tr, lv.commande_id, lv.id)).map((l) => [l.id, l]));
  const lignes = await Q('SELECT commande_ligne_id, article_id, quantite, coefficient FROM com_livraison_lignes WHERE livraison_id = :l', { l: lv.id }, tr);
  if (!lignes.length) throw new ErreurVente(400, 'Indiquez au moins une quantité à livrer.');
  const besoin = new Map();
  for (const x of lignes) {
    const l = restes.get(Number(x.commande_ligne_id));
    if (Number(x.quantite) > l.reste + 1e-9) {
      throw new ErreurVente(400, `« ${l.designation} » : ${Number(x.quantite)} ${l.unite} à livrer, il n'en reste que ${l.reste} sur la commande.`);
    }
    if (l.suivi_stock) besoin.set(l.article_id, (besoin.get(l.article_id) || 0) + Number(x.quantite) * Number(x.coefficient));
  }
  if (!p.negatif) {
    for (const [a, q] of besoin) {
      const dispo = await moteur.quantite(tr, a, Number(lv.magasin_id));
      if (dispo + 1e-9 < q3(q)) {
        const [art] = await Q('SELECT designation, unite FROM com_articles WHERE id = :a', { a }, tr);
        throw new ErreurVente(409, `Stock insuffisant pour « ${art.designation} » : ${dispo} ${art.unite} disponible(s) au magasin, ${q3(q)} à livrer.`);
      }
    }
  }
  return lignes.length;
};

const droitsLivraison = (ctx, x, p) => {
  const preparateur = x.prepare_par === ctx.userId || (!x.prepare_par && x.cree_par === ctx.userId);
  return {
    modifier: x.statut === 'brouillon' && ctx.peut('com.ventes.preparer'),
    preparer: x.statut === 'brouillon' && ctx.peut('com.ventes.preparer'),
    valider: x.statut === 'preparee' && ctx.peut('com.ventes.livrer') && (!preparateur || p.autovalidation),
    renvoyer: x.statut === 'preparee' && ctx.peut('com.ventes.livrer') && (!preparateur || p.autovalidation),
    auto_validation_interdite: x.statut === 'preparee' && ctx.peut('com.ventes.livrer') && preparateur && !p.autovalidation,
    annuler: x.statut === 'livree' && ctx.peut('com.ventes.annuler'),
    joindre: x.statut !== 'annule' && (ctx.peut('com.ventes.preparer') || ctx.peut('com.ventes.livrer')),
  };
};

const lireLivraison = async (ctx, id) => {
  exigerUn(ctx, VOIR, 'consulter les ventes');
  const x = await chargerLivraison(ctx, id);
  const p = await parametres(ctx.tenantId);
  const restes = new Map((await restesCommande(null, x.commande_id, x.id)).map((l) => [l.id, l]));
  const lignes = await Q(`SELECT l.*, a.reference, a.designation, a.unite AS unite_stock, a.suivi_stock
                            FROM com_livraison_lignes l JOIN com_articles a ON a.id = l.article_id WHERE l.livraison_id = :l ORDER BY l.ordre, l.id`, { l: x.id });
  const enCours = ['brouillon', 'preparee'].includes(x.statut);
  const dispo = enCours ? await disponibles(null, [...new Set(lignes.filter((l) => l.suivi_stock).map((l) => Number(l.article_id)))], Number(x.magasin_id)) : new Map();
  const couts = ctx.peut('com.stock.valorisation');
  const mvts = await Q(`SELECT s.id, s.type, s.sens, s.quantite, s.cout_unitaire, s.valeur, s.annule, m.code AS magasin_code, a.reference, a.unite
                          FROM com_stock_mouvements s JOIN com_magasins m ON m.id = s.magasin_id JOIN com_articles a ON a.id = s.article_id
                         WHERE s.document_type = 'livraison' AND s.document_id = :id ORDER BY s.id`, { id: x.id });
  return {
    ...formaterLivraison(x), client: await chargerClient(ctx, x.client_id, null, { actif: false }),
    lignes: lignes.map((l) => {
      const r = restes.get(Number(l.commande_ligne_id)) || {};
      const qs = q3(Number(l.quantite) * Number(l.coefficient));
      return { ...l, id: Number(l.id), commande_ligne_id: Number(l.commande_ligne_id), article_id: Number(l.article_id), quantite: Number(l.quantite),
        coefficient: Number(l.coefficient), quantite_stock: qs, commande: r.quantite, livre_avant: x.statut === 'livree' ? q3((r.livre || 0) - Number(l.quantite)) : r.livre,
        reste: x.statut === 'livree' ? r.reste_a_livrer : r.reste, disponible_stock: enCours && l.suivi_stock ? dispo.get(Number(l.article_id)) : null };
    }),
    mouvements: mvts.map((m) => ({ ...m, id: Number(m.id), quantite: Number(m.quantite), sens: Number(m.sens),
      cout_unitaire: m.cout_unitaire === null || !couts ? null : Number(m.cout_unitaire), valeur: m.valeur === null || !couts ? null : Number(m.valeur) })),
    ...(await annexes(ctx, 'livraison', x.id)),
    droits: droitsLivraison(ctx, x, p),
  };
};

const creerLivraison = async (ctx, body = {}) => {
  exiger(ctx, 'com.ventes.preparer', 'préparer les livraisons');
  const id = await sequelize.transaction(async (tr) => {
    const c = await chargerCommande(ctx, body.commande_id, tr, true);
    if (c.statut !== 'ouverte') throw new ErreurVente(409, 'Cette commande est annulée.');
    const magasinId = entier(body.magasin_id, 'Magasin');
    const [m] = await Q('SELECT id, actif FROM com_magasins WHERE id = :m AND tenant_id = :t', { m: magasinId, t: ctx.tenantId }, tr);
    if (!m || !m.actif) throw new ErreurVente(400, 'Magasin introuvable ou désactivé.');
    if (!perim().dansPerimetre(ctx, magasinId)) throw new ErreurVente(403, 'Magasin hors de votre périmètre.');
    const v = valeursLivraison({ adresse_livraison: c.adresse_livraison, ...body });
    if (v.date_livraison < jour(c.date_commande)) throw new ErreurVente(400, 'La livraison ne peut pas précéder la commande.');
    const numero = await numeroter(tr, ctx.tenantId, 'BLC');
    const [r] = await Q(`INSERT INTO com_livraisons (tenant_id, numero, commande_id, client_id, magasin_id, date_livraison, adresse_livraison, transporteur, observations, cree_par)
                         VALUES (:t, :numero, :c, :cl, :m, :date_livraison, :adresse_livraison, :transporteur, :observations, :u) RETURNING id`,
    { ...v, t: ctx.tenantId, numero, c: c.id, cl: c.client_id, m: magasinId, u: ctx.userId }, tr);
    const n = await ecrireLignesLivraison(ctx, tr, { id: r.id, commande_id: c.id }, body.lignes || []);
    await auditer(tr, ctx, 'livraison', 'COM_LIVRAISON_CREATION', r.id, { numero, commande: c.numero, nb_lignes: n });
    return r.id;
  });
  return lireLivraison(ctx, id);
};

const modifierLivraison = async (ctx, id, body = {}) => {
  exiger(ctx, 'com.ventes.preparer', 'préparer les livraisons');
  await sequelize.transaction(async (tr) => {
    const x = await chargerLivraison(ctx, id, tr, true);
    if (x.statut !== 'brouillon') throw new ErreurVente(409, 'Seule une livraison en préparation se modifie.');
    const v = valeursLivraison({ ...x, date_livraison: jour(x.date_livraison), ...body });
    await X(`UPDATE com_livraisons SET date_livraison = :date_livraison, adresse_livraison = :adresse_livraison, transporteur = :transporteur,
               observations = :observations, modifie_le = NOW() WHERE id = :id`, { ...v, id: x.id }, tr);
    const apres = { ...v };
    if (body.lignes !== undefined) apres.nb_lignes = await ecrireLignesLivraison(ctx, tr, x, body.lignes);
    await auditer(tr, ctx, 'livraison', 'COM_LIVRAISON_MODIFICATION', x.id, apres);
  });
  return lireLivraison(ctx, id);
};

const supprimerLivraison = async (ctx, id) => {
  exiger(ctx, 'com.ventes.preparer', 'préparer les livraisons');
  return sequelize.transaction(async (tr) => {
    const x = await chargerLivraison(ctx, id, tr, true);
    if (x.statut !== 'brouillon') throw new ErreurVente(409, 'Seule une livraison en préparation se supprime ; une livraison validée s\'annule.');
    await X("UPDATE com_documents SET retire = true, retire_par = :u, retire_le = NOW(), motif_retrait = 'Brouillon supprimé' WHERE objet_type = 'livraison' AND objet_id = :d AND NOT retire",
      { u: ctx.userId, d: x.id }, tr);
    await X('DELETE FROM com_livraisons WHERE id = :id', { id: x.id }, tr);
    await auditer(tr, ctx, 'livraison', 'COM_LIVRAISON_SUPPRESSION', x.id, { numero: x.numero });
    return { ok: true };
  });
};

// Préparation terminée : la marchandise est prélevée, en attente de validation.
const preparerLivraison = async (ctx, id) => {
  exiger(ctx, 'com.ventes.preparer', 'préparer les livraisons');
  await sequelize.transaction(async (tr) => {
    const x = await chargerLivraison(ctx, id, tr, true);
    if (x.statut !== 'brouillon') throw new ErreurVente(409, 'Cette livraison a déjà été préparée.');
    if (x.commande_statut !== 'ouverte') throw new ErreurVente(409, 'La commande a été annulée.');
    const n = await controlerLivraison(tr, x, await parametres(ctx.tenantId, tr));
    await X("UPDATE com_livraisons SET statut = 'preparee', prepare_par = :u, prepare_le = NOW(), motif_renvoi = '' WHERE id = :id", { u: ctx.userId, id: x.id }, tr);
    await auditer(tr, ctx, 'livraison', 'COM_LIVRAISON_PREPARATION', x.id, { numero: x.numero, nb_lignes: n });
  });
  return lireLivraison(ctx, id);
};

const renvoyerLivraison = async (ctx, id, body = {}) => {
  exiger(ctx, 'com.ventes.livrer', 'valider les livraisons');
  const motif = motifOk(body.motif, 'ce qu\'il faut corriger');
  await sequelize.transaction(async (tr) => {
    const x = await chargerLivraison(ctx, id, tr, true);
    if (x.statut !== 'preparee') throw new ErreurVente(409, 'Seule une livraison préparée peut être renvoyée.');
    await X("UPDATE com_livraisons SET statut = 'brouillon', motif_renvoi = :m WHERE id = :id", { m: motif, id: x.id }, tr);
    await auditer(tr, ctx, 'livraison', 'COM_LIVRAISON_RENVOI', x.id, { numero: x.numero, motif });
  });
  return lireLivraison(ctx, id);
};

// Validation : le stock sort (mouvement « livraison », coût CMUP ou FIFO calculé par le moteur).
const validerLivraison = async (ctx, id) => {
  exiger(ctx, 'com.ventes.livrer', 'valider les livraisons');
  await sequelize.transaction(async (tr) => {
    const x = await chargerLivraison(ctx, id, tr, true);
    if (x.statut !== 'preparee') throw new ErreurVente(409, x.statut === 'brouillon' ? 'La livraison doit d\'abord être préparée.' : 'Cette livraison est déjà traitée.');
    const p = await parametres(ctx.tenantId, tr);
    const preparateur = x.prepare_par || x.cree_par;
    if (preparateur === ctx.userId && !p.autovalidation) {
      throw new ErreurVente(403, 'Vous avez préparé cette livraison : une autre personne doit la valider.');
    }
    const [cmd] = await Q('SELECT statut FROM com_commandes_clients WHERE id = :c FOR SHARE', { c: x.commande_id }, tr);
    if (cmd.statut !== 'ouverte') throw new ErreurVente(409, 'La commande a été annulée : cette livraison ne peut pas être validée.');
    const lignes = await Q(`SELECT l.*, a.suivi_stock FROM com_livraison_lignes l JOIN com_articles a ON a.id = l.article_id
                             WHERE l.livraison_id = :l ORDER BY l.ordre, l.id`, { l: x.id }, tr);
    const articles = [...new Set(lignes.filter((l) => l.suivi_stock).map((l) => Number(l.article_id)))].sort((a, b) => a - b);
    for (const a of articles) await moteur.verrouiller(tr, a);
    await controlerLivraison(tr, x, p);
    for (const l of lignes) {
      if (!l.suivi_stock) continue;                          // prestation : livrée, sans stock
      await moteur.ecrire(tr, { tenantId: ctx.tenantId, articleId: Number(l.article_id), magasinId: Number(x.magasin_id), type: 'livraison',
        quantite: q3(Number(l.quantite) * Number(l.coefficient)), date: jour(x.date_livraison), piece: x.numero,
        observation: `${x.client_nom} — ${x.commande_numero}`, documentType: 'livraison', documentId: Number(x.id), ligneId: Number(l.id), userId: ctx.userId });
    }
    for (const a of articles) await moteur.rejouer(tr, ctx.tenantId, a);
    await X("UPDATE com_livraisons SET statut = 'livree', livre_par = :u, livre_le = NOW() WHERE id = :id", { u: ctx.userId, id: x.id }, tr);
    await auditer(tr, ctx, 'livraison', 'COM_LIVRAISON_VALIDATION', x.id, { numero: x.numero, nb_lignes: lignes.length });
  });
  return lireLivraison(ctx, id);
};

// Annulation d'une livraison validée : les mouvements sont neutralisés (la marchandise rentre).
const annulerLivraison = async (ctx, id, body = {}) => {
  exiger(ctx, 'com.ventes.annuler', 'annuler les ventes');
  const motif = motifOk(body.motif, 'le motif de l\'annulation');
  await sequelize.transaction(async (tr) => {
    const x = await chargerLivraison(ctx, id, tr, true);
    if (x.statut !== 'livree') throw new ErreurVente(409, x.statut === 'annule' ? 'Livraison déjà annulée.' : 'Une livraison non validée se supprime (après renvoi en préparation).');
    const mvts = await Q("SELECT DISTINCT article_id FROM com_stock_mouvements WHERE document_type = 'livraison' AND document_id = :id AND NOT annule ORDER BY article_id", { id: x.id }, tr);
    for (const m of mvts) await moteur.verrouiller(tr, Number(m.article_id));
    await X("UPDATE com_stock_mouvements SET annule = true, annule_le = NOW() WHERE document_type = 'livraison' AND document_id = :id AND NOT annule", { id: x.id }, tr);
    for (const m of mvts) await moteur.rejouer(tr, ctx.tenantId, Number(m.article_id));
    await X("UPDATE com_livraisons SET statut = 'annule', annule_par = :u, annule_le = NOW(), motif_annulation = :m WHERE id = :id", { u: ctx.userId, m: motif, id: x.id }, tr);
    await auditer(tr, ctx, 'livraison', 'COM_LIVRAISON_ANNULATION', x.id, { numero: x.numero, motif });
  });
  return lireLivraison(ctx, id);
};

const pdfLivraison = async (ctx, id) => {
  exigerUn(ctx, VOIR, 'consulter les ventes');
  const x = formaterLivraison(await chargerLivraison(ctx, id));
  const restes = new Map((await restesCommande(null, x.commande_id, x.id)).map((l) => [l.id, l]));
  const lignes = await Q(`SELECT l.*, cl.reference, cl.designation, cl.quantite AS commande FROM com_livraison_lignes l
                            JOIN com_commande_client_lignes cl ON cl.id = l.commande_ligne_id WHERE l.livraison_id = :l ORDER BY l.ordre, l.id`, { l: x.id });
  const [m] = await Q('SELECT code, nom FROM com_magasins WHERE id = :m', { m: x.magasin_id });
  const valable = x.statut === 'livree';
  const contenu = await pdf.rendreLivraison({ societe: await societe(ctx.tenantId), client: await chargerClient(ctx, x.client_id, null, { actif: false }),
    livraison: { ...x, livre_nom: x.livre_par_nom }, commande: { numero: x.commande_numero, reference_client: x.reference_client, devis_numero: x.devis_numero }, magasin: m,
    lignes: lignes.map((l) => {
      const r = restes.get(Number(l.commande_ligne_id)) || {};
      return { ...l, reste: valable ? r.reste_a_livrer : Math.max(0, q3((r.reste_a_livrer ?? 0) - Number(l.quantite))) };
    }), valable });
  return { contenu, nom: `${x.numero}${valable ? '' : '-preparation'}.pdf` };
};

// ══ Compteurs, pièces ═══════════════════════════════════════════════════
const compteurs = async (ctx) => {
  const out = { devis_a_valider: 0, devis_a_valider_direction: 0, livraisons_a_valider: 0, commandes_a_livrer: 0 };
  if (!VOIR.some((c) => ctx.peut(c))) return out;
  const [d] = await Q(`SELECT COUNT(*) FILTER (WHERE statut = 'a_valider')::int AS r, COUNT(*) FILTER (WHERE statut = 'a_valider_direction')::int AS dir
                         FROM com_devis WHERE tenant_id = :t AND (cree_par IS DISTINCT FROM :moi)`, { t: ctx.tenantId, moi: ctx.userId });
  if (ctx.peut('com.ventes.valider')) out.devis_a_valider = d.r;
  if (ctx.peut('com.ventes.valider_direction')) out.devis_a_valider_direction = d.dir;
  if (ctx.peut('com.ventes.livrer')) {
    const p = perim().sqlPerimetre(ctx, 'magasin_id');
    const [l] = await Q(`SELECT COUNT(*)::int AS n FROM com_livraisons WHERE tenant_id = :t AND statut = 'preparee'
                           AND COALESCE(prepare_par, cree_par) IS DISTINCT FROM :moi AND ${p.sql}`, { t: ctx.tenantId, moi: ctx.userId, ...p.r });
    out.livraisons_a_valider = l.n;
  }
  if (ctx.peut('com.ventes.preparer')) out.commandes_a_livrer = (await aLivrer(ctx)).length;
  return out;
};

const CHARGEURS = { devis: chargerDevis, commande: chargerCommande, livraison: chargerLivraison };
const LECTEURS = { devis: lireDevis, commande: lireCommande, livraison: lireLivraison };
const DROIT_JOINDRE = {
  devis: (d) => d.statut !== 'annule' && ['com.ventes.devis', 'com.ventes.commandes'],
  commande: (c) => c.statut === 'ouverte' && ['com.ventes.commandes'],
  livraison: (x) => x.statut !== 'annule' && ['com.ventes.preparer', 'com.ventes.livrer'],
};

async function joindre(ctx, sorte, id, body = {}) {
  if (!CHARGEURS[sorte]) throw new ErreurVente(404, 'Document inconnu.');
  const d = await CHARGEURS[sorte](ctx, id);
  const codes = DROIT_JOINDRE[sorte](d);
  if (!codes) throw new ErreurVente(409, 'Ce document est clos : ses pièces sont figées.');
  exigerUn(ctx, codes, 'joindre une pièce');
  const f = docs.preparer(body);
  const chemin = await docs.ecrire(ctx.tenantId, OBJETS[sorte].objet, d.id, f);
  await sequelize.transaction(async (tr) => {
    await X(`INSERT INTO com_documents (tenant_id, objet_type, objet_id, categorie, nom, mime, taille, sha256, chemin, ajoute_par)
             VALUES (:t, :o, :d, 'justificatif', :nom, :mime, :taille, :sha, :chemin, :u)`,
    { t: ctx.tenantId, o: OBJETS[sorte].objet, d: d.id, nom: f.nom, mime: f.mime, taille: f.taille, sha: f.sha256, chemin, u: ctx.userId }, tr);
    await auditer(tr, ctx, sorte, 'COM_VENTE_PIECE_AJOUT', d.id, { nom: f.nom, sha256: f.sha256 });
  });
  return LECTEURS[sorte](ctx, d.id);
}

const lirePiece = async (ctx, sorte, id, docId) => {
  exigerUn(ctx, VOIR, 'consulter les ventes');
  if (!CHARGEURS[sorte]) throw new ErreurVente(404, 'Document inconnu.');
  const d = await CHARGEURS[sorte](ctx, id);
  const [x] = await Q('SELECT * FROM com_documents WHERE id = :x AND tenant_id = :t AND objet_type = :o AND objet_id = :d AND NOT retire',
    { x: entier(docId, 'Pièce'), t: ctx.tenantId, o: OBJETS[sorte].objet, d: d.id });
  if (!x) throw new ErreurVente(404, 'Pièce introuvable.');
  return { chemin: docs.resoudre(x.chemin), nom: x.nom, mime: x.mime, sha256: x.sha256 };
};

module.exports = {
  ErreurVente, STATUTS_DEVIS, STATUTS_COMMANDE, STATUTS_LIVRAISON, VOIR, compteurs,
  listerDevis, lireDevis, creerDevis, modifierDevis, supprimerDevis, soumettreDevis, validerDevis, renvoyerDevis, annulerDevis,
  refuserDevis, accepterDevis, dupliquerDevis, pdfDevis,
  listerCommandes, lireCommande, annulerCommande,
  aLivrer, propositionLivraison, listerLivraisons, lireLivraison, creerLivraison, modifierLivraison, supprimerLivraison,
  preparerLivraison, renvoyerLivraison, validerLivraison, annulerLivraison, pdfLivraison,
  joindre, lirePiece,
};
