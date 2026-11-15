'use strict';
// NJ COMMERCIAL — lot 8 (migration 063) : frais accessoires d'achat et coût réel d'acquisition.
//
//   brouillon ──valider──▶ valide ──annuler (motif)──▶ annule      (brouillon : modifiable, supprimable)
//
// Un frais (transport, douane, transit, manutention, livraison, assurance, autre) est
// rattaché à UN bon de commande émis et réparti sur ses lignes :
//   • au prorata des quantités (en unité de stock),
//   • au prorata de la valeur (montant HT net de la ligne),
//   • au prorata du poids (quantité × poids unitaire de l'article ; tous les poids requis),
//   • ou manuellement (montants par ligne dont la somme = montant HT du frais).
// Seul le montant HT est incorporé : la taxe de la pièce de frais (récupérable) ne l'est jamais.
//
// Coût réel : pour chaque ligne du bon, frais par unité de stock = frais validés de la ligne
// / (quantité commandée × coefficient). Chaque mouvement de réception de la ligne porte ce
// montant (cout_frais) ; le moteur de stock rejoue alors CMUP / FIFO (frais saisis avant ou
// après la réception, et même après des sorties : leur coût est recalculé).
const { sequelize } = require('../../models');
const moteur = require('./stock.service');
const docs = require('./documents.service');

const T = sequelize.QueryTypes;
const Q = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: T.SELECT, transaction });
const X = (sql, replacements, transaction) => sequelize.query(sql, { replacements, transaction });

class ErreurFrais extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const RUBRIQUES = { transport: 'Transport', douane: 'Douane', transit: 'Transit', manutention: 'Manutention', livraison: 'Livraison', assurance: 'Assurance', autre: 'Autre' };
const METHODES = { quantite: 'Au prorata des quantités', valeur: 'Au prorata de la valeur', poids: 'Au prorata du poids', manuel: 'Affectation manuelle' };
const STATUTS = { brouillon: 'Brouillon', valide: 'Validé', annule: 'Annulé' };
const txt = (v) => String(v ?? '').trim();
const m2 = (n) => Math.round(n * 100) / 100;
const c6 = (n) => Math.round(n * 1e6) / 1e6;
const entier = (v, nom) => {
  const n = Number.parseInt(v, 10);
  if (!Number.isInteger(n) || n <= 0) throw new ErreurFrais(400, `${nom} invalide.`);
  return n;
};
const nombre = (v, nom, { min = 0, vide = null } = {}) => {
  if (v === undefined || v === null || txt(v) === '') return vide;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > 1e13) throw new ErreurFrais(400, `${nom} invalide.`);
  return n;
};
const VOIR = ['com.frais.saisir', 'com.frais.valider', 'com.factures_fourn.voir', 'com.bc.emettre', 'com.consultations.gerer'];
const exigerVue = (ctx) => { if (!VOIR.some((c) => ctx.peut(c))) throw new ErreurFrais(403, 'Permission requise : consulter les frais d\'achat.'); };
const exiger = (ctx, code, l) => { if (!ctx.peut(code)) throw new ErreurFrais(403, `Permission requise : ${l}.`); };
const auditer = (tr, ctx, action, id, apres) => X(
  `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, nouvelle_valeur)
   VALUES (:t, :u, :a, 'commercial', :id, CAST(:ap AS jsonb))`,
  { t: ctx.tenantId, u: ctx.userId, a: action, id: `FRA:${id}`, ap: JSON.stringify(apres || {}) }, tr);

// ── Lignes du bon et répartition ─────────────────────────────────────────
const lignesBon = (bcId, tr) => Q(
  `SELECT bl.id, bl.article_id, bl.reference, bl.designation, bl.unite, bl.quantite, bl.coefficient, bl.prix_unitaire, bl.remise_pct,
          bl.montant_ht, a.poids_kg, a.suivi_stock, a.unite AS unite_stock
     FROM com_bc_lignes bl JOIN com_articles a ON a.id = bl.article_id WHERE bl.bc_id = :b ORDER BY bl.ordre, bl.id`, { b: bcId }, tr);

// Répartit `total` selon `bases` (au centime) ; l'écart d'arrondi va à la plus grande base.
const repartir = (total, bases) => {
  const somme = bases.reduce((t, b) => t + b, 0);
  if (!(somme > 0)) throw new ErreurFrais(400, 'Base de répartition nulle : impossible de répartir ce frais.');
  const parts = bases.map((b) => m2(total * b / somme));
  const ecart = m2(total - parts.reduce((t, p) => t + p, 0));
  if (ecart) { const i = bases.indexOf(Math.max(...bases)); parts[i] = m2(parts[i] + ecart); }
  return parts;
};

const calculerRepartition = (lignes, methode, montant, manuel) => {
  if (!lignes.length) throw new ErreurFrais(400, 'Le bon de commande n\'a aucune ligne.');
  let bases;
  if (methode === 'quantite') bases = lignes.map((l) => Number(l.quantite) * Number(l.coefficient));
  else if (methode === 'valeur') bases = lignes.map((l) => Number(l.montant_ht));
  else if (methode === 'poids') {
    const sans = lignes.filter((l) => !(Number(l.poids_kg) > 0));
    if (sans.length) throw new ErreurFrais(400, `Poids unitaire manquant sur la fiche article : ${sans.map((l) => l.designation).join(', ')}. Renseignez-le ou choisissez une autre méthode.`);
    bases = lignes.map((l) => Number(l.quantite) * Number(l.coefficient) * Number(l.poids_kg));
  } else {
    const parLigne = new Map((Array.isArray(manuel) ? manuel : []).map((x) => [Number(x.bc_ligne_id), nombre(x.montant, 'Montant affecté', { vide: 0 })]));
    const parts = lignes.map((l) => m2(parLigne.get(Number(l.id)) || 0));
    const somme = m2(parts.reduce((t, p) => t + p, 0));
    if (somme !== m2(montant)) throw new ErreurFrais(400, `Affectation manuelle : la somme des lignes (${somme.toLocaleString('fr-FR')}) doit égaler le montant HT du frais (${m2(montant).toLocaleString('fr-FR')}).`);
    return lignes.map((l, i) => ({ bc_ligne_id: Number(l.id), article_id: Number(l.article_id), base: parts[i], montant: parts[i] }));
  }
  const parts = repartir(montant, bases);
  return lignes.map((l, i) => ({ bc_ligne_id: Number(l.id), article_id: Number(l.article_id), base: c6(bases[i]), montant: parts[i] }));
};

// ── Incorporation au stock ────────────────────────────────────────────────
// Met à jour cout_frais des mouvements de réception du bon ; renvoie les articles touchés.
const appliquerMouvements = async (tr, bcId) => {
  const lignes = await Q(
    `SELECT bl.id, bl.article_id, bl.quantite, bl.coefficient,
            COALESCE((SELECT SUM(r.montant) FROM com_frais_repartition r JOIN com_frais_achat f ON f.id = r.frais_id
                       WHERE r.bc_ligne_id = bl.id AND f.statut = 'valide'), 0) AS frais
       FROM com_bc_lignes bl WHERE bl.bc_id = :b`, { b: bcId }, tr);
  const touches = new Set();
  for (const l of lignes) {
    const unites = Number(l.quantite) * Number(l.coefficient);
    const parUnite = unites > 0 ? c6(Number(l.frais) / unites) : 0;
    const [r] = await Q(
      `WITH m AS (
         UPDATE com_stock_mouvements mv SET cout_frais = :u
           FROM com_reception_lignes rl
          WHERE mv.type = 'reception' AND mv.document_type = 'reception' AND mv.ligne_id = rl.id AND rl.bc_ligne_id = :bl
            AND mv.cout_frais IS DISTINCT FROM CAST(:u AS NUMERIC)
         RETURNING mv.id)
       SELECT COUNT(*)::int AS n FROM m`, { u: parUnite, bl: l.id }, tr);
    if (r.n) touches.add(Number(l.article_id));
  }
  return [...touches].sort((a, b) => a - b);
};
const appliquer = async (tr, tenantId, bcId) => {
  const articles = await appliquerMouvements(tr, bcId);
  for (const a of articles) await moteur.verrouiller(tr, a);
  for (const a of articles) await moteur.rejouer(tr, tenantId, a);
  return articles;
};

// ── Lecture ──────────────────────────────────────────────────────────────
const SQL = `
  SELECT f.*, b.numero_complet AS bc_numero, b.statut AS bc_statut, b.magasin_id, b.devise, rt.nom AS bc_fournisseur_nom,
         uc.username AS cree_par_nom, uv.username AS valide_par_nom, ua.username AS annule_par_nom
    FROM com_frais_achat f
    JOIN com_bons_commande b ON b.id = f.bc_id
    JOIN registre_tiers rt ON rt.id = b.fournisseur_id
    LEFT JOIN users uc ON uc.id = f.cree_par LEFT JOIN users uv ON uv.id = f.valide_par LEFT JOIN users ua ON ua.id = f.annule_par`;
const formater = (f) => ({
  ...f, id: Number(f.id), bc_id: Number(f.bc_id), fournisseur_id: f.fournisseur_id ? Number(f.fournisseur_id) : null,
  montant_ht: Number(f.montant_ht), montant_taxe: Number(f.montant_taxe), date_frais: String(f.date_frais instanceof Date ? f.date_frais.toISOString() : f.date_frais).slice(0, 10),
  rubrique_libelle: RUBRIQUES[f.rubrique], methode_libelle: METHODES[f.methode], statut_libelle: STATUTS[f.statut],
});
const perim = () => require('./demandes.service');
const charger = async (ctx, id, tr, verrou = false) => {
  const [f] = await Q(`${SQL} WHERE f.tenant_id = :t AND f.id = :id${verrou ? ' FOR UPDATE OF f' : ''}`, { t: ctx.tenantId, id: entier(id, 'Frais') }, tr);
  if (!f || !perim().dansPerimetre(ctx, f.magasin_id)) throw new ErreurFrais(404, 'Frais introuvable.');
  return f;
};

const lister = async (ctx, { bc_id = '', statut = '', q = '' } = {}) => {
  exigerVue(ctx);
  const p = perim().sqlPerimetre(ctx, 'b.magasin_id');
  const conds = ['f.tenant_id = :t', p.sql];
  const r = { t: ctx.tenantId, ...p.r };
  if (bc_id) { conds.push('f.bc_id = :bc'); r.bc = entier(bc_id, 'Bon'); }
  if (statut) { conds.push('f.statut = :s'); r.s = txt(statut); }
  if (txt(q)) { conds.push('(lower(f.numero) LIKE :q OR lower(f.fournisseur_nom) LIKE :q OR lower(b.numero_complet) LIKE :q OR lower(f.libelle) LIKE :q)'); r.q = `%${txt(q).toLowerCase()}%`; }
  return (await Q(`${SQL} WHERE ${conds.join(' AND ')} ORDER BY f.cree_le DESC LIMIT 500`, r)).map(formater);
};

const lire = async (ctx, id) => {
  exigerVue(ctx);
  const f = formater(await charger(ctx, id));
  const repartition = (await Q(
    `SELECT r.*, bl.designation, bl.reference, bl.quantite, bl.unite, bl.montant_ht AS ligne_ht
       FROM com_frais_repartition r JOIN com_bc_lignes bl ON bl.id = r.bc_ligne_id WHERE r.frais_id = :f ORDER BY bl.ordre, bl.id`, { f: f.id }))
    .map((x) => ({ ...x, bc_ligne_id: Number(x.bc_ligne_id), article_id: Number(x.article_id), base: Number(x.base), montant: Number(x.montant),
      quantite: Number(x.quantite), ligne_ht: Number(x.ligne_ht) }));
  const documents = (await Q(`SELECT id, nom, mime, taille, ajoute_le FROM com_documents WHERE tenant_id = :t AND objet_type = 'frais_achat' AND objet_id = :f AND NOT retire ORDER BY id`,
    { t: ctx.tenantId, f: f.id })).map((d) => ({ ...d, id: Number(d.id), taille: Number(d.taille) }));
  return { ...f, repartition, documents,
    droits: { modifier: f.statut === 'brouillon' && ctx.peut('com.frais.saisir'), valider: f.statut === 'brouillon' && ctx.peut('com.frais.valider'),
      annuler: f.statut === 'valide' && ctx.peut('com.frais.valider') } };
};

// ── Saisie ───────────────────────────────────────────────────────────────
const valeurs = async (ctx, b, tr) => {
  const bcId = entier(b.bc_id, 'Bon de commande');
  const [bc] = await Q('SELECT id, statut, magasin_id FROM com_bons_commande WHERE id = :b AND tenant_id = :t', { b: bcId, t: ctx.tenantId }, tr);
  if (!bc || !perim().dansPerimetre(ctx, bc.magasin_id)) throw new ErreurFrais(400, 'Bon de commande inconnu.');
  if (bc.statut !== 'emis') throw new ErreurFrais(409, 'Les frais se rattachent à un bon de commande émis (ni brouillon, ni annulé, ni remplacé).');
  const rubrique = txt(b.rubrique);
  if (!RUBRIQUES[rubrique]) throw new ErreurFrais(400, 'Rubrique inconnue (transport, douane, transit, manutention, livraison, assurance, autre).');
  const methode = txt(b.methode) || 'valeur';
  if (!METHODES[methode]) throw new ErreurFrais(400, 'Méthode de répartition inconnue.');
  let fournisseurId = null; let fournisseurNom = txt(b.fournisseur_nom);
  if (b.fournisseur_id) {
    fournisseurId = entier(b.fournisseur_id, 'Fournisseur');
    const [t] = await Q('SELECT nom FROM registre_tiers WHERE id = :f AND tenant_id = :t', { f: fournisseurId, t: ctx.tenantId }, tr);
    if (!t) throw new ErreurFrais(400, 'Prestataire inconnu.');
    fournisseurNom = t.nom;
  }
  if (!fournisseurNom) throw new ErreurFrais(400, 'Indiquez le prestataire (transporteur, transitaire…).');
  const montant = nombre(b.montant_ht, 'Montant HT', { min: 0.01 });
  if (montant === null) throw new ErreurFrais(400, 'Le montant HT est obligatoire.');
  const date = txt(b.date_frais) || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ErreurFrais(400, 'Date invalide.');
  if (date > new Date().toISOString().slice(0, 10)) throw new ErreurFrais(400, 'La date du frais ne peut pas être dans le futur.');
  const lim = (v, n, nom) => { const s = txt(v); if (s.length > n) throw new ErreurFrais(400, `${nom} : ${n} caractères au plus.`); return s; };
  return {
    bc_id: bcId, rubrique, libelle: lim(b.libelle, 200, 'Libellé'), fournisseur_id: fournisseurId, fournisseur_nom: fournisseurNom.slice(0, 150),
    reference_piece: lim(b.reference_piece, 60, 'Référence'), date_frais: date, montant_ht: m2(montant),
    montant_taxe: m2(nombre(b.montant_taxe, 'Taxe', { vide: 0 })), methode, observations: lim(b.observations, 1000, 'Observations'),
  };
};

const ecrireRepartition = async (ctx, tr, fraisId, v, manuel) => {
  const rep = calculerRepartition(await lignesBon(v.bc_id, tr), v.methode, v.montant_ht, manuel);
  await X('DELETE FROM com_frais_repartition WHERE frais_id = :f', { f: fraisId }, tr);
  for (const r of rep) {
    await X(`INSERT INTO com_frais_repartition (frais_id, bc_ligne_id, tenant_id, article_id, base, montant) VALUES (:f, :l, :t, :a, :b, :m)`,
      { f: fraisId, l: r.bc_ligne_id, t: ctx.tenantId, a: r.article_id, b: r.base, m: r.montant }, tr);
  }
  return rep;
};

const creer = async (ctx, body = {}) => {
  exiger(ctx, 'com.frais.saisir', 'saisir les frais d\'achat');
  const id = await sequelize.transaction(async (tr) => {
    const v = await valeurs(ctx, body, tr);
    const annee = new Date().getFullYear();
    const [c] = await Q(`INSERT INTO com_compteurs (tenant_id, type, annee, dernier) VALUES (:t, 'FRA', :a, 1)
                         ON CONFLICT (tenant_id, type, annee) DO UPDATE SET dernier = com_compteurs.dernier + 1 RETURNING dernier`, { t: ctx.tenantId, a: annee }, tr);
    const numero = `FRA-${annee}-${String(c.dernier).padStart(4, '0')}`;
    const [r] = await Q(`INSERT INTO com_frais_achat (tenant_id, numero, bc_id, rubrique, libelle, fournisseur_id, fournisseur_nom, reference_piece, date_frais,
                           montant_ht, montant_taxe, methode, observations, cree_par)
                         VALUES (:t, :numero, :bc_id, :rubrique, :libelle, :fournisseur_id, :fournisseur_nom, :reference_piece, :date_frais,
                           :montant_ht, :montant_taxe, :methode, :observations, :u) RETURNING id`, { ...v, t: ctx.tenantId, numero, u: ctx.userId }, tr);
    await ecrireRepartition(ctx, tr, Number(r.id), v, body.manuel);
    await auditer(tr, ctx, 'COM_FRAIS_CREATION', r.id, { numero, ...v });
    return Number(r.id);
  });
  return lire(ctx, id);
};

const modifier = async (ctx, id, body = {}) => {
  exiger(ctx, 'com.frais.saisir', 'saisir les frais d\'achat');
  await sequelize.transaction(async (tr) => {
    const f = await charger(ctx, id, tr, true);
    if (f.statut !== 'brouillon') throw new ErreurFrais(409, 'Un frais validé ne se modifie pas : annulez-le puis ressaisissez-le.');
    const v = await valeurs(ctx, { ...formater(f), ...body }, tr);
    await X(`UPDATE com_frais_achat SET bc_id = :bc_id, rubrique = :rubrique, libelle = :libelle, fournisseur_id = :fournisseur_id, fournisseur_nom = :fournisseur_nom,
               reference_piece = :reference_piece, date_frais = :date_frais, montant_ht = :montant_ht, montant_taxe = :montant_taxe, methode = :methode,
               observations = :observations, modifie_le = NOW() WHERE id = :id`, { ...v, id: f.id }, tr);
    await ecrireRepartition(ctx, tr, Number(f.id), v, body.manuel);
    await auditer(tr, ctx, 'COM_FRAIS_MODIFICATION', f.id, v);
  });
  return lire(ctx, id);
};

const supprimer = async (ctx, id) => {
  exiger(ctx, 'com.frais.saisir', 'saisir les frais d\'achat');
  await sequelize.transaction(async (tr) => {
    const f = await charger(ctx, id, tr, true);
    if (f.statut !== 'brouillon') throw new ErreurFrais(409, 'Seul un brouillon se supprime ; un frais validé s\'annule.');
    await X('DELETE FROM com_frais_achat WHERE id = :id', { id: f.id }, tr);
    await auditer(tr, ctx, 'COM_FRAIS_SUPPRESSION', f.id, { numero: f.numero });
  });
  return { ok: true };
};

const valider = async (ctx, id) => {
  exiger(ctx, 'com.frais.valider', 'valider les frais d\'achat');
  await sequelize.transaction(async (tr) => {
    const f = await charger(ctx, id, tr, true);
    if (f.statut !== 'brouillon') throw new ErreurFrais(409, 'Seul un brouillon se valide.');
    await Q('SELECT id FROM com_bons_commande WHERE id = :b FOR UPDATE', { b: f.bc_id }, tr);
    const v = await valeurs(ctx, formater(f), tr);   // bon toujours émis, montants contrôlés
    const [x] = await Q(`SELECT COUNT(*) FILTER (WHERE bc_ligne_id IS NOT NULL)::int AS n FROM com_frais_repartition WHERE frais_id = :f`, { f: f.id }, tr);
    if (v.methode !== 'manuel' || !x.n) await ecrireRepartition(ctx, tr, Number(f.id), v, []);   // recalcul sur le bon tel qu'il est
    await X("UPDATE com_frais_achat SET statut = 'valide', valide_par = :u, valide_le = NOW(), modifie_le = NOW() WHERE id = :id", { u: ctx.userId, id: f.id }, tr);
    const articles = await appliquer(tr, ctx.tenantId, Number(f.bc_id));
    await auditer(tr, ctx, 'COM_FRAIS_VALIDATION', f.id, { numero: f.numero, montant_ht: Number(f.montant_ht), articles_revalorises: articles.length });
  });
  return lire(ctx, id);
};

const annuler = async (ctx, id, body = {}) => {
  exiger(ctx, 'com.frais.valider', 'annuler les frais d\'achat');
  const motif = txt(body.motif);
  if (motif.length < 3) throw new ErreurFrais(400, 'Indiquez le motif de l\'annulation.');
  await sequelize.transaction(async (tr) => {
    const f = await charger(ctx, id, tr, true);
    if (f.statut !== 'valide') throw new ErreurFrais(409, 'Seul un frais validé s\'annule.');
    await X("UPDATE com_frais_achat SET statut = 'annule', annule_par = :u, annule_le = NOW(), motif_annulation = :m, modifie_le = NOW() WHERE id = :id",
      { u: ctx.userId, m: motif.slice(0, 500), id: f.id }, tr);
    const articles = await appliquer(tr, ctx.tenantId, Number(f.bc_id));
    await auditer(tr, ctx, 'COM_FRAIS_ANNULATION', f.id, { numero: f.numero, motif, articles_revalorises: articles.length });
  });
  return lire(ctx, id);
};

// Coût réel d'acquisition d'un bon : par ligne, prix net + part des frais validés.
const coutsBon = async (ctx, bcId) => {
  exigerVue(ctx);
  const [b] = await Q('SELECT id, magasin_id, numero_complet, devise FROM com_bons_commande WHERE id = :b AND tenant_id = :t', { b: entier(bcId, 'Bon'), t: ctx.tenantId });
  if (!b || !perim().dansPerimetre(ctx, b.magasin_id)) throw new ErreurFrais(404, 'Bon de commande introuvable.');
  const lignes = await lignesBon(b.id);
  const frais = await Q(`SELECT r.bc_ligne_id, f.statut, SUM(r.montant) AS montant FROM com_frais_repartition r JOIN com_frais_achat f ON f.id = r.frais_id
                          WHERE f.bc_id = :b AND f.statut IN ('brouillon', 'valide') GROUP BY r.bc_ligne_id, f.statut`, { b: b.id });
  const de = (lid, s) => Number(frais.find((x) => Number(x.bc_ligne_id) === lid && x.statut === s)?.montant || 0);
  const out = lignes.map((l) => {
    const q = Number(l.quantite); const k = Number(l.coefficient);
    const net = Number(l.prix_unitaire) * (1 - Number(l.remise_pct) / 100);
    const fv = de(Number(l.id), 'valide'); const fb = de(Number(l.id), 'brouillon');
    const fu = q > 0 ? fv / q : 0;
    return {
      bc_ligne_id: Number(l.id), reference: l.reference, designation: l.designation, unite: l.unite, unite_stock: l.unite_stock, quantite: q, coefficient: k,
      suivi_stock: l.suivi_stock, montant_ht: Number(l.montant_ht), prix_net: m2(net), frais_valides: m2(fv), frais_brouillon: m2(fb),
      frais_unitaire: c6(fu), cout_reel_unitaire: c6(net + fu), cout_reel_unitaire_stock: k ? c6((net + fu) / k) : null, cout_reel_total: m2(Number(l.montant_ht) + fv),
    };
  });
  const tous = await lister(ctx, { bc_id: b.id });
  return { bc_id: Number(b.id), bc_numero: b.numero_complet, devise: b.devise, lignes: out,
    total_achat: m2(out.reduce((t, l) => t + l.montant_ht, 0)), total_frais: m2(out.reduce((t, l) => t + l.frais_valides, 0)),
    total_reel: m2(out.reduce((t, l) => t + l.cout_reel_total, 0)), frais: tous };
};

// Aperçu de répartition (avant enregistrement), pour l'écran de saisie.
const apercu = async (ctx, body = {}) => {
  exiger(ctx, 'com.frais.saisir', 'saisir les frais d\'achat');
  const v = await valeurs(ctx, { fournisseur_nom: '-', ...body }, null);
  const lignes = await lignesBon(v.bc_id);
  const rep = calculerRepartition(lignes, v.methode, v.montant_ht, body.manuel);
  return lignes.map((l, i) => ({ bc_ligne_id: Number(l.id), designation: l.designation, reference: l.reference, quantite: Number(l.quantite), unite: l.unite,
    montant_ht: Number(l.montant_ht), poids_kg: l.poids_kg === null ? null : Number(l.poids_kg), part: rep[i].montant,
    part_unitaire: Number(l.quantite) > 0 ? m2(rep[i].montant / Number(l.quantite)) : 0 }));
};

// Pièce justificative (scan de la facture du transporteur, du transitaire…).
const joindre = async (ctx, id, body = {}) => {
  exiger(ctx, 'com.frais.saisir', 'saisir les frais d\'achat');
  const f = await charger(ctx, id);
  if (f.statut === 'annule') throw new ErreurFrais(409, 'Frais annulé : pièces figées.');
  const fic = docs.preparer(body);
  const chemin = await docs.ecrire(ctx.tenantId, 'frais_achat', f.id, fic);
  await sequelize.transaction(async (tr) => {
    await X(`INSERT INTO com_documents (tenant_id, objet_type, objet_id, categorie, nom, mime, taille, sha256, chemin, ajoute_par)
             VALUES (:t, 'frais_achat', :f, 'justificatif', :nom, :mime, :taille, :sha, :chemin, :u)`,
    { t: ctx.tenantId, f: f.id, nom: fic.nom, mime: fic.mime, taille: fic.taille, sha: fic.sha256, chemin, u: ctx.userId }, tr);
    await auditer(tr, ctx, 'COM_FRAIS_PIECE', f.id, { nom: fic.nom, sha256: fic.sha256 });
  });
  return lire(ctx, f.id);
};
const lirePiece = async (ctx, id, docId) => {
  exigerVue(ctx);
  const f = await charger(ctx, id);
  const [x] = await Q("SELECT * FROM com_documents WHERE id = :x AND tenant_id = :t AND objet_type = 'frais_achat' AND objet_id = :f AND NOT retire",
    { x: entier(docId, 'Pièce'), t: ctx.tenantId, f: f.id });
  if (!x) throw new ErreurFrais(404, 'Pièce introuvable.');
  return { chemin: docs.resoudre(x.chemin), nom: x.nom, mime: x.mime, sha256: x.sha256 };
};

module.exports = {
  ErreurFrais, RUBRIQUES, METHODES, lister, lire, creer, modifier, supprimer, valider, annuler, coutsBon, apercu, joindre, lirePiece,
  appliquerMouvements, appliquer, calculerRepartition, repartir,
};
