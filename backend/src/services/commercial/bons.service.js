'use strict';
// NJ COMMERCIAL — livraison C : bons de commande (migration 052).
//
//   demande approuvée ──préparer──▶ brouillon ──émettre──▶ émis ──annuler──▶ annulé
//                                      │                     └──réviser──▶ brouillon R1 ──émettre──▶ émis (l'original devient « remplacé »)
//                                      └──revalidation──▶ la demande repasse dans le circuit (prix ou fournisseur hors de ce qui a été approuvé)
//
// Contrôles avant émission (serveur seul juge) :
//   • demande approuvée ; fournisseur actif ; lignes issues de la demande ;
//   • quantités ≤ quantités approuvées, compte tenu des autres bons actifs ;
//   • prix renseignés ; totaux recalculés ici, jamais repris de l'écran ;
//   • fournisseur conforme à celui retenu sur la ligne de la demande, prix net
//     ≤ prix approuvé × (1 + tolérance du client) — sinon revalidation ;
//   • proforma si le client l'exige ; adresse de vérification configurée.
// À l'émission : numéro définitif, taux de taxe figés, PDF archivé + SHA-256, jeton
// de vérification aléatoire (QR code). Ensuite, la base refuse toute modification.
const crypto = require('crypto');
const fs = require('fs/promises');
const { sequelize } = require('../../models');
const { usersAvecPermission } = require('../permission.service');
const { creerNotification } = require('../notification.service');
const docs = require('./documents.service');
const perim = () => require('./demandes.service');   // chargé à la demande (dépendance circulaire)
const pdf = require('./bc_pdf.service');

const T = sequelize.QueryTypes;
const Q = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: T.SELECT, transaction });
const X = (sql, replacements, transaction) => sequelize.query(sql, { replacements, transaction });

class ErreurBon extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const STATUTS = { brouillon: 'Brouillon', emis: 'Émis', annule: 'Annulé', remplace: 'Remplacé' };
const ACTIFS = ['brouillon', 'emis'];
const txt = (v) => String(v ?? '').trim();
const entier = (v, nom) => {
  const n = Number.parseInt(v, 10);
  if (!Number.isInteger(n) || n <= 0) throw new ErreurBon(400, `${nom} invalide.`);
  return n;
};
const nombre = (v, nom, { min = 0, max = 1e13, vide = null } = {}) => {
  if (v === undefined || v === null || txt(v) === '') return vide;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) throw new ErreurBon(400, `${nom} invalide.`);
  return n;
};
const arrondi = (n, dec) => { const f = 10 ** dec; return Math.round(n * f) / f; };

// 063 : le comptable (factures, frais) et qui consulte les fournisseurs voient aussi les bons.
const VOIR = ['com.bc.preparer', 'com.bc.emettre', 'com.bc.annuler', 'com.da.voir_tout', 'com.tableau_bord.voir',
  'com.factures_fourn.voir', 'com.frais.saisir', 'com.consultations.gerer'];
const exigerVue = (ctx) => { if (!VOIR.some((c) => ctx.peut(c))) throw new ErreurBon(403, 'Permission requise : consulter les bons de commande.'); };
const exiger = (ctx, code, libelle) => { if (!ctx.peut(code)) throw new ErreurBon(403, `Permission requise : ${libelle}.`); };

const auditer = (tr, ctx, action, bcId, apres, avant = null) => X(
  `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, ancienne_valeur, nouvelle_valeur)
   VALUES (:t, :u, :a, 'commercial', :id, CAST(:av AS jsonb), CAST(:ap AS jsonb))`,
  { t: ctx.tenantId, u: ctx.userId, a: action, id: `BC:${bcId}`, av: avant ? JSON.stringify(avant) : null, ap: apres ? JSON.stringify(apres) : null }, tr);

const parametres = async (tenantId, tr) => {
  const [p] = await Q('SELECT * FROM com_parametres WHERE tenant_id = :t', { t: tenantId }, tr);
  const [t] = await Q('SELECT devise FROM tenants WHERE id = :t', { t: tenantId }, tr);
  return {
    prefixe_bc: p?.prefixe_bc || 'BC', tolerance: p ? Number(p.tolerance_ecart_pct) : 10,
    proforma_obligatoire: Boolean(p?.proforma_obligatoire), devise: t?.devise || 'FCFA',
  };
};

// Adresse publique de vérification : jamais de lien fictif.
const baseVerification = () => {
  const brut = txt(process.env.VERIFICATION_URL) || String(process.env.APP_URL || '').split(',')[0].trim();
  if (!/^https?:\/\/[^\s"'<>]+$/i.test(brut)) return null;
  return brut.replace(/\/$/, '');
};
const urlVerification = (jeton) => { const b = baseVerification(); return b ? `${b}/verifier/${jeton}` : null; };

// ── Quantités : approuvées, déjà commandées, restantes ───────────────────
// `sauf` : bons à ignorer (le bon en cours, et l'original qu'une révision remplace).
const restes = async (tenantId, demandeId, sauf = [], tr) => {
  const rows = await Q(
    `SELECT l.id, l.article_id, l.quantite, l.unite, l.unite_id, l.coefficient, l.prix_estime, l.fournisseur_id, a.reference, a.designation,
            (SELECT u.decimales FROM com_unites u WHERE u.id = l.unite_id) AS decimales, a.unite AS unite_stock,
            COALESCE((SELECT SUM(bl.quantite) FROM com_bc_lignes bl JOIN com_bons_commande b ON b.id = bl.bc_id
                       WHERE bl.demande_ligne_id = l.id AND b.statut IN ('brouillon', 'emis')
                         AND NOT (b.id = ANY (CAST(:sauf AS BIGINT[])))), 0) AS commande,
            COALESCE((SELECT SUM(bl.quantite) FROM com_bc_lignes bl JOIN com_bons_commande b ON b.id = bl.bc_id
                       WHERE bl.demande_ligne_id = l.id AND b.statut = 'emis'), 0) AS emis
       FROM com_demande_lignes l JOIN com_articles a ON a.id = l.article_id
      WHERE l.demande_id = :d AND l.tenant_id = :t ORDER BY l.ordre, l.id`,
    { d: demandeId, t: tenantId, sauf: `{${sauf.map(Number).join(',')}}` }, tr);
  return rows.map((r) => ({
    demande_ligne_id: Number(r.id), article_id: Number(r.article_id), reference: r.reference, designation: r.designation, unite: r.unite,
    unite_id: r.unite_id ? Number(r.unite_id) : null, coefficient: Number(r.coefficient || 1), unite_stock: r.unite_stock,
    decimales: r.decimales === null || r.decimales === undefined ? 3 : Number(r.decimales),
    approuve: Number(r.quantite), commande: Number(r.commande), emis: Number(r.emis),
    reste: Math.max(0, Math.round((Number(r.quantite) - Number(r.commande)) * 1000) / 1000),
    prix_approuve: r.prix_estime === null ? null : Number(r.prix_estime),
    // 062 : aucune taxe proposée par l'article ; elle se choisit sur la ligne du bon.
    fournisseur_id: r.fournisseur_id ? Number(r.fournisseur_id) : null, taxe_id: null,
  }));
};

// État de commande d'une demande approuvée (affiché dans les listes et la fiche).
const etatCommande = async (tenantId, demandeId) => {
  const r = await restes(tenantId, demandeId);
  if (!r.length) return 'a_commander';
  if (r.every((l) => l.emis >= l.approuve)) return 'commandee';
  if (r.some((l) => l.emis > 0)) return 'partielle';
  return 'a_commander';
};

// ── Lecture ──────────────────────────────────────────────────────────────
const SQL_BC = `
  SELECT b.*, d.numero AS demande_numero, d.statut AS demande_statut, d.demandeur_id, u.username AS demandeur_nom, d.service,
         f.nom AS fournisseur_nom, f.actif AS fournisseur_actif, f.type AS fournisseur_type,
         m.code AS magasin_code, m.nom AS magasin_nom,
         pp.username AS prepare_par_nom, ap.username AS annule_par_nom,
         r.numero_complet AS remplace_numero, rb.numero_complet AS remplace_par_numero, rb.id AS remplace_par_id,
         (SELECT COUNT(*)::int FROM com_documents x WHERE x.objet_type = 'bon_commande' AND x.objet_id = b.id AND x.categorie = 'proforma' AND NOT x.retire) AS nb_proformas,
         -- 063 : suivi de livraison d'un bon émis (réceptions validées).
         CASE WHEN b.statut <> 'emis' THEN NULL
              WHEN NOT EXISTS (SELECT 1 FROM com_bc_lignes l WHERE l.bc_id = b.id AND l.quantite > COALESCE((SELECT SUM(rl.quantite) FROM com_reception_lignes rl
                     JOIN com_receptions r ON r.id = rl.reception_id WHERE rl.bc_ligne_id = l.id AND r.statut = 'valide'), 0)) THEN 'livre'
              WHEN EXISTS (SELECT 1 FROM com_receptions r WHERE r.bc_id = b.id AND r.statut = 'valide') THEN 'partiellement_livre'
              ELSE NULL END AS etat_livraison,
         (SELECT c.numero FROM com_consultations c WHERE c.id = b.consultation_id) AS consultation_numero
    FROM com_bons_commande b
    JOIN com_demandes d ON d.id = b.demande_id
    JOIN users u ON u.id = d.demandeur_id
    JOIN registre_tiers f ON f.id = b.fournisseur_id
    JOIN com_magasins m ON m.id = b.magasin_id
    LEFT JOIN users pp ON pp.id = b.prepare_par
    LEFT JOIN users ap ON ap.id = b.annule_par
    LEFT JOIN com_bons_commande r ON r.id = b.remplace_id
    LEFT JOIN LATERAL (SELECT id, numero_complet FROM com_bons_commande x WHERE x.remplace_id = b.id ORDER BY x.id DESC LIMIT 1) rb ON true`;

// Statut de suivi (063) : brouillon, validé (émis), envoyé au fournisseur, partiellement livré, livré, annulé.
const SUIVI = { brouillon: 'Brouillon', valide: 'Validé', envoye: 'Envoyé au fournisseur', partiellement_livre: 'Partiellement livré', livre: 'Livré',
  annule: 'Annulé', remplace: 'Remplacé' };
const suivi = (b) => (b.statut !== 'emis' ? b.statut : b.etat_livraison || (b.envoye_le ? 'envoye' : 'valide'));
const formater = (b) => ({
  // 064 : l'identité figée (logo compris) ne circule pas dans les listes ; seul le PDF l'utilise.
  identite_figee: Boolean(b.identite_emetteur),
  ...b, id: Number(b.id), suivi: suivi(b), suivi_libelle: SUIVI[suivi(b)], consultation_id: b.consultation_id ? Number(b.consultation_id) : null, demande_id: Number(b.demande_id), fournisseur_id: Number(b.fournisseur_id), magasin_id: Number(b.magasin_id),
  remplace_id: b.remplace_id ? Number(b.remplace_id) : null, remplace_par_id: b.remplace_par_id ? Number(b.remplace_par_id) : null,
  total_ht: Number(b.total_ht), total_taxes: Number(b.total_taxes), total_ttc: Number(b.total_ttc), statut_libelle: STATUTS[b.statut],
  // Le jeton et le chemin du PDF ne sortent jamais par les listes.
  jeton_verification: undefined, pdf_chemin: undefined, identite_emetteur: undefined,
});

const charger = async (ctx, id, tr, verrou = false) => {
  const [b] = await Q(`${SQL_BC} WHERE b.tenant_id = :t AND b.id = :id${verrou ? ' FOR UPDATE OF b' : ''}`, { t: ctx.tenantId, id: entier(id, 'Bon de commande') }, tr);
  if (!b || !perim().dansPerimetre(ctx, b.magasin_id)) throw new ErreurBon(404, 'Bon de commande introuvable.');
  return b;
};

const lister = async (ctx, { statut = '', q = '', du = '', au = '', fournisseur_id = '', demande_id = '' } = {}) => {
  exigerVue(ctx);
  const pp = perim().sqlPerimetre(ctx, 'b.magasin_id');
  const conds = ['b.tenant_id = :t', pp.sql]; const r = { t: ctx.tenantId, ...pp.r };
  if (statut) { if (!STATUTS[statut]) throw new ErreurBon(400, 'Statut inconnu.'); conds.push('b.statut = :statut'); r.statut = statut; }
  if (Number.parseInt(fournisseur_id, 10)) { conds.push('b.fournisseur_id = :f'); r.f = Number.parseInt(fournisseur_id, 10); }
  if (Number.parseInt(demande_id, 10)) { conds.push('b.demande_id = :d'); r.d = Number.parseInt(demande_id, 10); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(du)) { conds.push('COALESCE(b.emis_le, b.cree_le)::date >= :du'); r.du = du; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(au)) { conds.push('COALESCE(b.emis_le, b.cree_le)::date <= :au'); r.au = au; }
  if (txt(q)) {
    conds.push('(lower(b.numero_complet) LIKE :like OR lower(d.numero) LIKE :like OR lower(f.nom) LIKE :like)');
    r.like = `%${txt(q).toLowerCase()}%`;
  }
  return (await Q(`${SQL_BC} WHERE ${conds.join(' AND ')} ORDER BY b.cree_le DESC LIMIT 500`, r)).map(formater);
};

// Demandes approuvées qui ont encore des quantités à commander.
const aCommander = async (ctx) => {
  exiger(ctx, 'com.bc.preparer', 'préparer les bons de commande');
  const ds = await Q(
    `SELECT d.id, d.numero, d.date_demande, d.service, d.priorite, d.montant_estime, d.decidee_le, u.username AS demandeur_nom, m.code AS magasin_code
       FROM com_demandes d JOIN users u ON u.id = d.demandeur_id JOIN com_magasins m ON m.id = d.magasin_id
      WHERE d.tenant_id = :t AND d.statut = 'approuvee' AND ${perim().sqlPerimetre(ctx, 'd.magasin_id').sql} ORDER BY d.decidee_le`,
    { t: ctx.tenantId, ...perim().sqlPerimetre(ctx, 'd.magasin_id').r });
  const out = [];
  for (const d of ds) {
    const r = await restes(ctx.tenantId, d.id);
    const reste = r.filter((l) => l.reste > 0);
    if (reste.length) out.push({ ...d, id: Number(d.id), montant_estime: Number(d.montant_estime), lignes_restantes: reste.length, nb_lignes: r.length });
  }
  return out;
};

// Proposition de bon pour une demande : lignes restantes, prix et taxes par défaut.
const proposition = async (ctx, demandeId) => {
  exiger(ctx, 'com.bc.preparer', 'préparer les bons de commande');
  const [d] = await Q(`SELECT d.*, f.nom AS fournisseur_nom FROM com_demandes d LEFT JOIN registre_tiers f ON f.id = d.fournisseur_propose_id
                        WHERE d.id = :d AND d.tenant_id = :t`, { d: entier(demandeId, 'Demande'), t: ctx.tenantId });
  if (!d || !perim().dansPerimetre(ctx, d.magasin_id)) throw new ErreurBon(404, 'Demande introuvable.');
  if (d.statut !== 'approuvee') throw new ErreurBon(409, 'Seule une demande approuvée peut donner un bon de commande.');
  const lignes = (await restes(ctx.tenantId, d.id)).filter((l) => l.reste > 0);
  const fournisseurs = [...new Set([...lignes.map((l) => l.fournisseur_id).filter(Boolean), d.fournisseur_propose_id && Number(d.fournisseur_propose_id)].filter(Boolean))];
  const p = await parametres(ctx.tenantId);
  return { demande: { id: Number(d.id), numero: d.numero, magasin_id: Number(d.magasin_id), fournisseur_propose_id: d.fournisseur_propose_id ? Number(d.fournisseur_propose_id) : null },
    lignes, fournisseurs_retenus: fournisseurs, devise: p.devise, tolerance: p.tolerance, proforma_obligatoire: p.proforma_obligatoire };
};

// ── Saisie d'un brouillon ────────────────────────────────────────────────
const ecrireLignes = async (ctx, tr, bc, lignes, sauf) => {
  if (!Array.isArray(lignes) || !lignes.length) throw new ErreurBon(400, 'Un bon de commande comporte au moins une ligne.');
  const p = await parametres(ctx.tenantId, tr);
  const dec = pdf.decimales(p.devise);
  const dispo = await restes(ctx.tenantId, bc.demande_id, sauf, tr);
  await X('DELETE FROM com_bc_lignes WHERE bc_id = :b', { b: bc.id }, tr);
  let ht = 0; let tx = 0; const vus = new Set();
  for (const [i, l] of lignes.entries()) {
    const dlId = entier(l.demande_ligne_id, 'Ligne de demande');
    if (vus.has(dlId)) throw new ErreurBon(400, 'Une même ligne de la demande figure deux fois.');
    vus.add(dlId);
    const src = dispo.find((x) => x.demande_ligne_id === dlId);
    if (!src) throw new ErreurBon(400, 'Cette ligne n\'appartient pas à la demande d\'origine.');
    const q = nombre(l.quantite, 'Quantité', { min: 0.001 });
    if (q === null) throw new ErreurBon(400, 'Chaque ligne doit avoir une quantité.');
    if (Math.round(q * 10 ** src.decimales) !== q * 10 ** src.decimales) {
      throw new ErreurBon(400, `« ${src.designation} » : ${src.unite} se compte avec ${src.decimales ? `${src.decimales} décimale(s) au plus` : 'des nombres entiers'}.`);
    }
    if (q > src.reste + 1e-9) {
      throw new ErreurBon(409, `« ${src.designation} » : ${q} ${src.unite} commandé(s) pour ${src.reste} restant(s) sur ${src.approuve} approuvé(s).`);
    }
    const pu = nombre(l.prix_unitaire, 'Prix unitaire', { vide: null });
    const remise = nombre(l.remise_pct, 'Remise', { max: 100, vide: 0 });
    let taxe = null;
    // 062 : la taxe est celle choisie sur la ligne (aucune si rien n'est choisi).
    const taxeId = l.taxe_id === undefined || l.taxe_id === null || l.taxe_id === '' ? null : entier(l.taxe_id, 'Taxe');
    if (taxeId) {
      [taxe] = await Q('SELECT id, code, taux, actif, usage FROM com_taxes WHERE id = :x AND tenant_id = :t', { x: taxeId, t: ctx.tenantId }, tr);
      if (!taxe) throw new ErreurBon(400, 'Taxe inconnue.');
      if (!taxe.actif) throw new ErreurBon(400, `La taxe ${taxe.code} est désactivée.`);
      if (taxe.usage === 'vente') throw new ErreurBon(400, `La taxe ${taxe.code} est réservée aux ventes.`);
    }
    const prix = pu === null ? 0 : pu;
    const mht = arrondi(q * prix * (1 - remise / 100), dec);
    const mtx = taxe ? arrondi(mht * Number(taxe.taux) / 100, dec) : 0;
    ht += mht; tx += mtx;
    await X(`INSERT INTO com_bc_lignes (bc_id, tenant_id, ordre, demande_ligne_id, article_id, reference, designation, unite, unite_id, coefficient, quantite,
               prix_unitaire, remise_pct, taxe_id, taxe_code, taxe_taux, montant_ht, montant_taxe, montant_ttc)
             VALUES (:b, :t, :o, :dl, :a, :ref, :des, :u, :uid, :k, :q, :pu, :rm, :tid, :tc, :tt, :ht, :tx, :ttc)`,
    { b: bc.id, t: ctx.tenantId, o: i, dl: dlId, a: src.article_id, ref: src.reference, des: src.designation, u: src.unite, uid: src.unite_id, k: src.coefficient, q,
      pu: prix, rm: remise, tid: taxe ? taxe.id : null, tc: taxe ? taxe.code : '', tt: taxe ? Number(taxe.taux) : 0,
      ht: mht, tx: mtx, ttc: arrondi(mht + mtx, dec) }, tr);
  }
  await X('UPDATE com_bons_commande SET total_ht = :ht, total_taxes = :tx, total_ttc = :ttc, modifie_le = NOW() WHERE id = :b',
    { ht: arrondi(ht, dec), tx: arrondi(tx, dec), ttc: arrondi(ht + tx, dec), b: bc.id }, tr);
};

const valeursEntete = async (ctx, b, tr) => {
  const fournisseur = entier(b.fournisseur_id, 'Fournisseur');
  const [f] = await Q(`SELECT id, actif, type FROM registre_tiers WHERE id = :f AND tenant_id = :t`, { f: fournisseur, t: ctx.tenantId }, tr);
  if (!f) throw new ErreurBon(400, 'Fournisseur inconnu.');
  const magasin = entier(b.magasin_id, 'Lieu de livraison');
  const [m] = await Q('SELECT id FROM com_magasins WHERE id = :m AND tenant_id = :t', { m: magasin, t: ctx.tenantId }, tr);
  if (!m) throw new ErreurBon(400, 'Lieu de livraison inconnu.');
  if (!perim().dansPerimetre(ctx, magasin)) throw new ErreurBon(403, 'Ce lieu de livraison n\'appartient pas à vos agences.');
  const champ = (v, max, nom) => { const s = txt(v); if (s.length > max) throw new ErreurBon(400, `${nom} : ${max} caractères au plus.`); return s; };
  return {
    fournisseur_id: fournisseur, magasin_id: magasin,
    conditions_paiement: champ(b.conditions_paiement, 300, 'Conditions de paiement'),
    delai_livraison: champ(b.delai_livraison, 200, 'Délai de livraison'), observations: champ(b.observations, 2000, 'Observations'),
  };
};

// Création dans une transaction fournie (063 : plusieurs bons d'un coup depuis une consultation).
const creerDans = async (ctx, body, tr) => {
  {
    const [d] = await Q('SELECT * FROM com_demandes WHERE id = :d AND tenant_id = :t FOR UPDATE', { d: entier(body.demande_id, 'Demande'), t: ctx.tenantId }, tr);
    if (!d || !perim().dansPerimetre(ctx, d.magasin_id)) throw new ErreurBon(404, 'Demande introuvable.');
    if (d.statut !== 'approuvee') throw new ErreurBon(409, d.statut === 'rejetee'
      ? 'Une demande rejetée ne peut pas donner de bon de commande : une nouvelle demande et une nouvelle autorisation sont nécessaires.'
      : 'Seule une demande approuvée peut donner un bon de commande.');
    // Conditions de paiement par défaut : celles de la fiche fournisseur.
    let conditions = body.conditions_paiement;
    if (conditions === undefined && body.fournisseur_id) {
      const [c] = await Q('SELECT conditions_paiement FROM com_tiers WHERE tiers_id = :f', { f: entier(body.fournisseur_id, 'Fournisseur') }, tr);
      conditions = c?.conditions_paiement || '';
    }
    const v = await valeursEntete(ctx, { magasin_id: d.magasin_id, ...body, conditions_paiement: conditions }, tr);
    const p = await parametres(ctx.tenantId, tr);
    const provisoire = `BROUILLON-${crypto.randomBytes(5).toString('hex')}`;
    const [r] = await Q(
      `INSERT INTO com_bons_commande (tenant_id, numero, numero_complet, demande_id, fournisseur_id, magasin_id, devise, conditions_paiement,
         delai_livraison, observations, prepare_par, consultation_id)
       VALUES (:t, '', :nc, :d, :fournisseur_id, :magasin_id, :devise, :conditions_paiement, :delai_livraison, :observations, :u, :cons) RETURNING id`,
      { ...v, t: ctx.tenantId, nc: provisoire, d: d.id, devise: p.devise, u: ctx.userId, cons: body.consultation_id || null }, tr);
    const bc = { id: Number(r.id), demande_id: Number(d.id) };
    await ecrireLignes(ctx, tr, bc, body.lignes, [bc.id]);
    await auditer(tr, ctx, 'COM_BC_PREPARATION', bc.id, { demande: d.numero, ...v, nb_lignes: body.lignes.length,
      ...(body.consultation_id ? { consultation_id: body.consultation_id } : {}) });
    return bc.id;
  }
};
const creer = async (ctx, body = {}) => {
  exiger(ctx, 'com.bc.preparer', 'préparer les bons de commande');
  if (!Array.isArray(body.lignes)) throw new ErreurBon(400, 'Liste de lignes invalide.');
  const id = await sequelize.transaction((tr) => creerDans(ctx, body, tr));
  return lire(ctx, id);
};

// ── Envoi au fournisseur (063) : par e-mail avec le PDF archivé, ou envoi constaté (remis, WhatsApp…) ──
const envoyer = async (ctx, id, body = {}) => {
  exiger(ctx, 'com.bc.emettre', 'envoyer les bons de commande');
  const b = await charger(ctx, id);
  if (b.statut !== 'emis') throw new ErreurBon(409, 'Seul un bon émis s\'envoie au fournisseur.');
  const mode = txt(body.mode) || 'email';
  if (!['email', 'manuel'].includes(mode)) throw new ErreurBon(400, 'Mode d\'envoi inconnu (email ou manuel).');
  let destinataire = txt(body.destinataire);
  if (mode === 'email') {
    if (!destinataire) {
      const [f] = await Q(`SELECT COALESCE(NULLIF(c.contact_email, ''), r.email, '') AS email FROM registre_tiers r LEFT JOIN com_tiers c ON c.tiers_id = r.id WHERE r.id = :f`, { f: b.fournisseur_id });
      destinataire = f?.email || '';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destinataire)) throw new ErreurBon(400, 'Adresse e-mail du fournisseur absente ou invalide : renseignez-la ou choisissez « envoi constaté ».');
    const [full] = await Q('SELECT pdf_chemin FROM com_bons_commande WHERE id = :id', { id: b.id });
    const contenu = await fs.readFile(docs.resoudre(full.pdf_chemin));
    const { envoyer: mail } = require('../email.service');
    const p = await donneesPdf(ctx, b, [], null);
    const r = await mail({ to: destinataire, subject: `Bon de commande ${b.numero_complet} — ${p.societe.nom_affiche}`,
      html: `<p>Bonjour,</p><p>Veuillez trouver ci-joint notre bon de commande <strong>${b.numero_complet}</strong>${b.delai_livraison ? ` (délai : ${b.delai_livraison})` : ''}.</p>
             <p>Merci d'en accuser réception et de rappeler sa référence sur votre bon de livraison et votre facture.</p><p>${p.societe.nom_affiche}</p>`,
      attachments: [{ filename: `${b.numero_complet}.pdf`, content: contenu, contentType: 'application/pdf' }] });
    if (r.statut !== 'envoye') throw new ErreurBon(502, `E-mail non envoyé : ${r.erreur || r.statut}. Vous pouvez constater un envoi fait par un autre moyen.`);
  } else if (destinataire.length < 2) throw new ErreurBon(400, 'Précisez comment et à qui le bon a été remis (ex. « remis au livreur », « WhatsApp au 699… »).');
  await sequelize.transaction(async (tr) => {
    await X(`UPDATE com_bons_commande SET envoye_le = NOW(), envoye_par = :u, envoi_mode = :m, envoi_destinataire = :d, modifie_le = NOW() WHERE id = :id`,
      { u: ctx.userId, m: mode, d: destinataire.slice(0, 200), id: b.id }, tr);
    await auditer(tr, ctx, 'COM_BC_ENVOI', b.id, { numero: b.numero_complet, mode, destinataire: destinataire.slice(0, 200), renvoi: Boolean(b.envoye_le) });
  });
  return lire(ctx, id);
};

const modifier = async (ctx, id, body = {}) => {
  exiger(ctx, 'com.bc.preparer', 'préparer les bons de commande');
  await sequelize.transaction(async (tr) => {
    const b = await charger(ctx, id, tr, true);
    if (b.statut !== 'brouillon') throw new ErreurBon(409, 'Un bon émis ne se modifie pas : annulez-le ou faites une révision.');
    const v = await valeursEntete(ctx, { ...b, ...body }, tr);
    await X(`UPDATE com_bons_commande SET fournisseur_id = :fournisseur_id, magasin_id = :magasin_id, conditions_paiement = :conditions_paiement,
               delai_livraison = :delai_livraison, observations = :observations, modifie_le = NOW() WHERE id = :id`, { ...v, id: b.id }, tr);
    if (body.lignes !== undefined) await ecrireLignes(ctx, tr, { id: Number(b.id), demande_id: Number(b.demande_id) }, body.lignes, [b.id, b.remplace_id].filter(Boolean));
    await auditer(tr, ctx, 'COM_BC_MODIFICATION', b.id, { ...v, ...(body.lignes ? { nb_lignes: body.lignes.length } : {}) });
  });
  return lire(ctx, id);
};

const supprimer = async (ctx, id) => {
  exiger(ctx, 'com.bc.preparer', 'préparer les bons de commande');
  return sequelize.transaction(async (tr) => {
    const b = await charger(ctx, id, tr, true);
    if (b.statut !== 'brouillon') throw new ErreurBon(409, 'Un bon émis ne se supprime pas : annulez-le.');
    await X("UPDATE com_documents SET retire = true, retire_par = :u, retire_le = NOW(), motif_retrait = 'Brouillon supprimé' WHERE objet_type = 'bon_commande' AND objet_id = :b AND NOT retire",
      { u: ctx.userId, b: b.id }, tr);
    await X('DELETE FROM com_bons_commande WHERE id = :b', { b: b.id }, tr);
    await auditer(tr, ctx, 'COM_BC_SUPPRESSION', b.id, null, { demande: b.demande_numero, total_ttc: Number(b.total_ttc) });
    return { ok: true };
  });
};

// ── Contrôles avant émission ─────────────────────────────────────────────
// Chaque contrôle : { code, ok, message, revalidation? }. L'émission exige tout « ok ».
const controler = async (ctx, b, tr) => {
  const p = await parametres(ctx.tenantId, tr);
  const lignes = await Q('SELECT * FROM com_bc_lignes WHERE bc_id = :b ORDER BY ordre, id', { b: b.id }, tr);
  const dispo = await restes(ctx.tenantId, b.demande_id, [b.id, b.remplace_id].filter(Boolean), tr);
  const c = [];
  const ajoute = (code, ok, message, extra = {}) => c.push({ code, ok, message, ...extra });
  ajoute('demande', b.demande_statut === 'approuvee', b.demande_statut === 'approuvee'
    ? `Demande ${b.demande_numero} approuvée.` : `La demande ${b.demande_numero} n'est pas approuvée (${b.demande_statut}).`);
  ajoute('fournisseur', b.fournisseur_actif && ['fournisseur', 'mixte'].includes(b.fournisseur_type),
    b.fournisseur_actif ? `Fournisseur ${b.fournisseur_nom} actif.` : `Le fournisseur ${b.fournisseur_nom} est inactif ou n'est pas un fournisseur.`);
  ajoute('lignes', lignes.length > 0, lignes.length ? `${lignes.length} ligne(s), toutes issues de la demande.` : 'Aucune ligne.');
  const depasse = lignes.filter((l) => { const s = dispo.find((x) => x.demande_ligne_id === Number(l.demande_ligne_id)); return !s || Number(l.quantite) > s.reste + 1e-9; });
  ajoute('quantites', !depasse.length, depasse.length
    ? `Quantités au-delà de l'approuvé : ${depasse.map((l) => l.designation).join(', ')}.` : 'Quantités dans les limites approuvées.');
  const sansPrix = lignes.filter((l) => !(Number(l.prix_unitaire) > 0));
  ajoute('prix', !sansPrix.length, sansPrix.length ? `Prix manquant : ${sansPrix.map((l) => l.designation).join(', ')}.` : 'Prix renseignés.');
  // Conformité à l'autorisation : fournisseur retenu et prix approuvé (+ tolérance).
  const hors = [];
  for (const l of lignes) {
    const s = dispo.find((x) => x.demande_ligne_id === Number(l.demande_ligne_id));
    if (!s) continue;
    if (s.fournisseur_id && s.fournisseur_id !== Number(b.fournisseur_id)) hors.push(`${l.designation} (autre fournisseur que celui retenu)`);
    const net = Number(l.prix_unitaire) * (1 - Number(l.remise_pct) / 100);
    if (s.prix_approuve === null) hors.push(`${l.designation} (aucun prix n'a été approuvé)`);
    else if (net > s.prix_approuve * (1 + p.tolerance / 100) + 1e-6) hors.push(`${l.designation} (prix ${net.toLocaleString('fr-FR')} > ${s.prix_approuve.toLocaleString('fr-FR')} approuvé + ${p.tolerance} %)`);
  }
  ajoute('autorisation', !hors.length, hors.length
    ? `Hors de ce qui a été approuvé : ${hors.join(' ; ')}. Demandez une revalidation.` : `Conforme à l'autorisation (tolérance ${p.tolerance} %).`, { revalidation: hors.length > 0 });
  if (p.proforma_obligatoire) {
    ajoute('proforma', Number(b.nb_proformas) > 0, Number(b.nb_proformas) > 0 ? 'Proforma jointe.' : 'Le client exige la proforma du fournisseur avant émission.');
  }
  const base = baseVerification();
  ajoute('verification', Boolean(base), base ? `QR code vers ${base}/verifier/…` : 'Adresse de vérification non configurée (APP_URL ou VERIFICATION_URL du serveur).');
  return c;
};

// Lot 5 : un bon qui a des réceptions (non annulées) ne s'annule ni ne se révise plus.
const sansReception = async (bcId, tr) => {
  const [r] = await Q("SELECT numero FROM com_receptions WHERE bc_id = :b AND statut <> 'annule' ORDER BY id LIMIT 1", { b: bcId }, tr);
  if (r) throw new ErreurBon(409, `Ce bon a déjà des réceptions (${r.numero}) : il ne peut plus être annulé ni révisé. Annulez d'abord les réceptions.`);
};
// État de réception d'un bon émis : quantités reçues (réceptions validées) par ligne.
const etatReception = async (bcId) => {
  const rows = await Q(`SELECT l.id, l.quantite, COALESCE(SUM(rl.quantite) FILTER (WHERE r.statut = 'valide'), 0) AS recu,
                               COALESCE(SUM(rl.quantite) FILTER (WHERE r.statut IN ('brouillon', 'a_valider')), 0) AS en_cours
                          FROM com_bc_lignes l LEFT JOIN com_reception_lignes rl ON rl.bc_ligne_id = l.id
                          LEFT JOIN com_receptions r ON r.id = rl.reception_id
                         WHERE l.bc_id = :b GROUP BY l.id`, { b: bcId });
  const receptions = await Q(`SELECT id, numero, statut, date_reception, bl_numero FROM com_receptions WHERE bc_id = :b ORDER BY id`, { b: bcId });
  const recu = rows.reduce((t, r) => t + Number(r.recu), 0);
  const solde = rows.length > 0 && rows.every((r) => Number(r.recu) >= Number(r.quantite));
  return {
    etat: solde ? 'recu' : recu > 0 ? 'partiel' : 'a_recevoir',
    par_ligne: Object.fromEntries(rows.map((r) => [Number(r.id), { recu: Number(r.recu), en_cours: Number(r.en_cours) }])),
    receptions: receptions.map((x) => ({ ...x, id: Number(x.id) })),
  };
};

const lire = async (ctx, id) => {
  exigerVue(ctx);
  const b = await charger(ctx, id);
  const lignes = await Q(`SELECT l.*, x.actif AS taxe_active, a.unite AS unite_stock FROM com_bc_lignes l LEFT JOIN com_taxes x ON x.id = l.taxe_id
                            JOIN com_articles a ON a.id = l.article_id WHERE l.bc_id = :b ORDER BY l.ordre, l.id`, { b: b.id });
  const documents = await Q(
    `SELECT x.id, x.categorie, x.nom, x.mime, x.taille, x.sha256, x.ajoute_le, u.username AS ajoute_par_nom, x.retire, x.retire_le, x.motif_retrait
       FROM com_documents x LEFT JOIN users u ON u.id = x.ajoute_par
      WHERE x.tenant_id = :t AND x.objet_type = 'bon_commande' AND x.objet_id = :b ORDER BY x.ajoute_le`, { t: ctx.tenantId, b: b.id });
  const historique = await Q(
    `SELECT a.created_at AS le, a.action, u.username AS par_nom, a.nouvelle_valeur FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.tenant_id = :t AND a.entite = 'commercial' AND a.entite_id = :e ORDER BY a.created_at, a.id`, { t: ctx.tenantId, e: `BC:${b.id}` });
  const disponibles = b.statut === 'brouillon' ? await restes(ctx.tenantId, b.demande_id, [b.id, b.remplace_id].filter(Boolean)) : [];
  const controles = b.statut === 'brouillon' ? await controler(ctx, b) : [];
  const bloque = controles.some((x) => !x.ok);
  return {
    ...formater(b),
    verification_url: b.statut !== 'brouillon' && b.jeton_verification ? urlVerification(b.jeton_verification) : null,
    regles: await parametres(ctx.tenantId).then((p) => ({ tolerance: p.tolerance, proforma_obligatoire: p.proforma_obligatoire })),
    lignes: lignes.map((l) => ({ ...l, id: Number(l.id), demande_ligne_id: Number(l.demande_ligne_id), article_id: Number(l.article_id), taxe_id: l.taxe_id ? Number(l.taxe_id) : null,
      quantite: Number(l.quantite), prix_unitaire: Number(l.prix_unitaire), remise_pct: Number(l.remise_pct), taxe_taux: Number(l.taxe_taux),
      unite_id: l.unite_id ? Number(l.unite_id) : null, coefficient: Number(l.coefficient || 1),
      quantite_stock: Math.round(Number(l.quantite) * Number(l.coefficient || 1) * 1000) / 1000,
      montant_ht: Number(l.montant_ht), montant_taxe: Number(l.montant_taxe), montant_ttc: Number(l.montant_ttc) })),
    disponibles, controles, documents: documents.map((x) => ({ ...x, id: Number(x.id), taille: Number(x.taille) })), historique,
    reception: b.statut === 'emis' || b.statut === 'annule' || b.statut === 'remplace' ? await etatReception(b.id) : null,
    droits: {
      receptionner: b.statut === 'emis' && ctx.peut('com.receptions.saisir'),
      modifier: b.statut === 'brouillon' && ctx.peut('com.bc.preparer'),
      emettre: b.statut === 'brouillon' && ctx.peut('com.bc.emettre') && !bloque,
      emettre_permission: ctx.peut('com.bc.emettre'),
      revalider: b.statut === 'brouillon' && ctx.peut('com.bc.preparer') && controles.some((x) => x.revalidation) && b.demande_statut === 'approuvee',
      annuler: b.statut === 'emis' && ctx.peut('com.bc.annuler'),
      reviser: b.statut === 'emis' && ctx.peut('com.bc.annuler') && ctx.peut('com.bc.preparer') && !b.remplace_par_id,
      proforma: b.statut === 'brouillon' && ctx.peut('com.bc.preparer'),
      envoyer: b.statut === 'emis' && ctx.peut('com.bc.emettre'),
      frais: b.statut === 'emis' && ctx.peut('com.frais.saisir'),
    },
  };
};

// ── Revalidation : la demande repasse dans le circuit avec les prix et le fournisseur du bon ──
const revalider = async (ctx, id, body = {}, notifier) => {
  exiger(ctx, 'com.bc.preparer', 'préparer les bons de commande');
  const res = await sequelize.transaction(async (tr) => {
    const b = await charger(ctx, id, tr, true);
    if (b.statut !== 'brouillon') throw new ErreurBon(409, 'Seul un brouillon peut faire l\'objet d\'une revalidation.');
    const [d] = await Q('SELECT * FROM com_demandes WHERE id = :d FOR UPDATE', { d: b.demande_id }, tr);
    if (d.statut !== 'approuvee') throw new ErreurBon(409, 'La demande n\'est pas approuvée : elle est déjà en cours de revalidation ou close.');
    const lignes = await Q('SELECT * FROM com_bc_lignes WHERE bc_id = :b', { b: b.id }, tr);
    for (const l of lignes) {
      const net = arrondi(Number(l.prix_unitaire) * (1 - Number(l.remise_pct) / 100), 2);
      // Ligne déjà commandée en partie chez un autre fournisseur : plusieurs fournisseurs sont
      // alors approuvés pour elle, on n'en impose plus aucun (le motif de la revalidation les cite).
      const [autre] = await Q(`SELECT 1 FROM com_bc_lignes bl JOIN com_bons_commande x ON x.id = bl.bc_id
                                WHERE bl.demande_ligne_id = :dl AND x.id <> :b AND x.statut IN ('brouillon', 'emis') AND x.fournisseur_id <> :f LIMIT 1`,
      { dl: l.demande_ligne_id, b: b.id, f: b.fournisseur_id }, tr);
      await X('UPDATE com_demande_lignes SET prix_estime = GREATEST(COALESCE(prix_estime, 0), :p), fournisseur_id = :f WHERE id = :id',
        { p: net, f: autre ? null : b.fournisseur_id, id: l.demande_ligne_id }, tr);
    }
    const [m] = await Q(`SELECT COALESCE(SUM(quantite * prix_estime), 0) AS m, bool_or(prix_estime IS NULL) AS inc FROM com_demande_lignes WHERE demande_id = :d`, { d: d.id }, tr);
    const [p] = await Q('SELECT seuil_direction FROM com_parametres WHERE tenant_id = :t', { t: ctx.tenantId }, tr);
    const seuil = p ? (p.seuil_direction === null ? null : Number(p.seuil_direction)) : 500000;
    const montant = arrondi(Number(m.m), 2);
    const motif = txt(body.commentaire) || `Revalidation pour le bon ${b.numero_complet.startsWith('BROUILLON') ? 'en préparation' : b.numero_complet} : fournisseur ${b.fournisseur_nom}, ${Number(b.total_ht).toLocaleString('fr-FR')} ${b.devise} HT.`;
    await X(`UPDATE com_demandes SET statut = 'examen_achats', montant_estime = :m, montant_incomplet = :inc, direction_requise = :dir, seuil_applique = :s,
               decidee_le = NULL, modifie_le = NOW() WHERE id = :d`, { m: montant, inc: Boolean(m.inc), dir: seuil !== null && montant >= seuil, s: seuil, d: d.id }, tr);
    await X(`INSERT INTO com_decisions (tenant_id, demande_id, etape, decision, par, par_nom, commentaire, statut_avant, statut_apres, montant)
             VALUES (:t, :d, 'gestionnaire', 'soumise', :u, :n, :c, 'approuvee', 'examen_achats', :m)`,
    { t: ctx.tenantId, d: d.id, u: ctx.userId, n: ctx.username, c: motif.slice(0, 2000), m: montant }, tr);
    await auditer(tr, ctx, 'COM_BC_REVALIDATION', b.id, { demande: d.numero, montant, motif });
    return { demandeId: Number(d.id), numero: d.numero };
  });
  if (notifier) await notifier(res.demandeId);
  return lire(ctx, id);
};

// ── Émission ─────────────────────────────────────────────────────────────
// 064 : l'identité vient de la configuration centrale de l'entreprise ; un bon
// émis garde celle figée à son émission (identite_emetteur).
const entreprise = () => require('../entreprise.service');
const donneesPdf = async (ctx, b, lignes, tr) => {
  const [p] = await Q('SELECT mentions_documents FROM com_parametres WHERE tenant_id = :t', { t: ctx.tenantId }, tr);
  const s = { ...(await entreprise().identitePour(ctx.tenantId, b.identite_emetteur)), mentions_documents: p?.mentions_documents || '' };
  const [f] = await Q(`SELECT r.nom, r.nui, r.telephone, r.email, r.adresse, COALESCE(c.nom_commercial, '') AS nom_commercial, COALESCE(c.ville, '') AS ville,
                              COALESCE(c.pays, '') AS pays, COALESCE(c.contact_nom, '') AS contact_nom, COALESCE(c.contact_telephone, '') AS contact_telephone
                         FROM registre_tiers r LEFT JOIN com_tiers c ON c.tiers_id = r.id WHERE r.id = :f`, { f: b.fournisseur_id }, tr);
  const [m] = await Q('SELECT code, nom, localisation FROM com_magasins WHERE id = :m', { m: b.magasin_id }, tr);
  return {
    societe: s, fournisseur: f, magasin: m, lignes,
    demande: { numero: b.demande_numero },
  };
};

const resumeAutorisation = async (demandeId, tr) => {
  const ds = await Q(`SELECT etape, par_nom, le FROM com_decisions WHERE demande_id = :d AND decision = 'approuvee' ORDER BY le, id`, { d: demandeId }, tr);
  const [d] = await Q('SELECT numero FROM com_demandes WHERE id = :d', { d: demandeId }, tr);
  const lib = { achats: 'achats', direction: 'direction', achats_direction: 'achats et direction' };
  const dernier = {};
  ds.forEach((x) => { dernier[x.etape] = x; });   // en cas de revalidation : la dernière décision fait foi
  const parts = Object.values(dernier).map((x) => `${x.par_nom} (${lib[x.etape] || x.etape}) le ${new Date(x.le).toLocaleDateString('fr-FR')}`);
  return `Demande ${d.numero} autorisée par ${parts.join(', ') || '—'}.`;
};

const emettre = async (ctx, id, notifier) => {
  exiger(ctx, 'com.bc.emettre', 'émettre les bons de commande');
  const out = await sequelize.transaction(async (tr) => {
    const b = await charger(ctx, id, tr, true);
    if (b.statut !== 'brouillon') throw new ErreurBon(409, `Bon ${STATUTS[b.statut].toLowerCase()} : il ne peut pas être émis.`);
    await Q('SELECT id FROM com_demandes WHERE id = :d FOR UPDATE', { d: b.demande_id }, tr);   // sérialise les émissions d'une même demande
    const c = await controler(ctx, b, tr);
    const ko = c.filter((x) => !x.ok);
    if (ko.length) throw new ErreurBon(409, `Émission impossible : ${ko.map((x) => x.message).join(' ')}`);
    const p = await parametres(ctx.tenantId, tr);
    // Numéro définitif (une révision garde le numéro de l'original, avec -R1, -R2…).
    let numero; let revision = 0; let ancien = null;
    if (b.remplace_id) {
      [ancien] = await Q('SELECT id, numero, revision, statut FROM com_bons_commande WHERE id = :r FOR UPDATE', { r: b.remplace_id }, tr);
      if (!ancien || ancien.statut !== 'emis') throw new ErreurBon(409, 'Le bon que cette révision remplace n\'est plus émis (déjà annulé ou remplacé).');
      numero = ancien.numero; revision = Number(ancien.revision) + 1;
    } else {
      const annee = new Date().getFullYear();
      const [r] = await Q(`INSERT INTO com_compteurs (tenant_id, type, annee, dernier) VALUES (:t, 'BC', :a, 1)
                           ON CONFLICT (tenant_id, type, annee) DO UPDATE SET dernier = com_compteurs.dernier + 1 RETURNING dernier`,
      { t: ctx.tenantId, a: annee }, tr);
      numero = `${p.prefixe_bc}-${annee}-${String(r.dernier).padStart(4, '0')}`;
    }
    const numeroComplet = revision ? `${numero}-R${revision}` : numero;
    const jeton = crypto.randomBytes(32).toString('base64url');
    const emisLe = new Date();
    const autorisation = await resumeAutorisation(b.demande_id, tr);
    const lignes = await Q('SELECT * FROM com_bc_lignes WHERE bc_id = :b ORDER BY ordre, id', { b: b.id }, tr);
    const donnees = await donneesPdf(ctx, { ...b, identite_emetteur: null }, lignes, tr);
    const contenu = await pdf.rendre({
      ...donnees,
      bc: { ...b, numero_complet: numeroComplet, revision, emis_le: emisLe, emis_par_nom: ctx.username, autorisation },
      verificationUrl: urlVerification(jeton), apercu: false,
    });
    const sha = crypto.createHash('sha256').update(contenu).digest('hex');
    const chemin = await docs.ecrireBrut(ctx.tenantId, 'bon_commande', b.id, contenu, 'pdf');
    await X(`UPDATE com_bons_commande SET statut = 'emis', numero = :n, revision = :r, numero_complet = :nc, jeton_verification = :j,
               pdf_chemin = :ch, pdf_sha256 = :sha, emis_par = :u, emis_par_nom = :un, emis_le = :le, autorisation = :au,
               identite_emetteur = CAST(:ie AS jsonb), modifie_le = NOW()
             WHERE id = :id`,
    { n: numero, r: revision, nc: numeroComplet, j: jeton, ch: chemin, sha, u: ctx.userId, un: ctx.username, le: emisLe, au: autorisation,
      ie: JSON.stringify(donnees.societe), id: b.id }, tr);
    if (ancien) {
      await X(`UPDATE com_bons_commande SET statut = 'remplace', motif_annulation = :m, annule_par = :u, annule_le = NOW() WHERE id = :id`,
        { m: `Remplacé par la révision ${numeroComplet}`, u: ctx.userId, id: ancien.id }, tr);
      await auditer(tr, ctx, 'COM_BC_REMPLACE', ancien.id, { par: numeroComplet });
    }
    await auditer(tr, ctx, 'COM_BC_EMISSION', b.id, { numero: numeroComplet, total_ttc: Number(b.total_ttc), sha256: sha });
    return { demandeurId: b.demandeur_id, numero: numeroComplet, demande: b.demande_numero, demandeId: Number(b.demande_id) };
  });
  if (notifier) await notifier(out);
  return lire(ctx, id);
};

const annuler = async (ctx, id, body = {}) => {
  exiger(ctx, 'com.bc.annuler', 'annuler les bons de commande');
  const motif = txt(body.motif);
  if (motif.length < 3) throw new ErreurBon(400, 'Indiquez le motif de l\'annulation.');
  if (motif.length > 2000) throw new ErreurBon(400, 'Motif : 2000 caractères au plus.');
  await sequelize.transaction(async (tr) => {
    const b = await charger(ctx, id, tr, true);
    if (b.statut !== 'emis') throw new ErreurBon(409, `Bon ${STATUTS[b.statut].toLowerCase()} : seul un bon émis s'annule.`);
    const [rev] = await Q("SELECT numero_complet FROM com_bons_commande WHERE remplace_id = :b AND statut = 'brouillon'", { b: b.id }, tr);
    if (rev) throw new ErreurBon(409, 'Une révision de ce bon est en préparation : supprimez-la ou émettez-la.');
    await sansReception(b.id, tr);
    await X(`UPDATE com_bons_commande SET statut = 'annule', motif_annulation = :m, annule_par = :u, annule_le = NOW() WHERE id = :id`,
      { m: motif, u: ctx.userId, id: b.id }, tr);
    await auditer(tr, ctx, 'COM_BC_ANNULATION', b.id, { numero: b.numero_complet, motif });
  });
  return lire(ctx, id);
};

const reviser = async (ctx, id) => {
  exiger(ctx, 'com.bc.annuler', 'annuler ou réviser les bons de commande');
  exiger(ctx, 'com.bc.preparer', 'préparer les bons de commande');
  const nouveau = await sequelize.transaction(async (tr) => {
    const b = await charger(ctx, id, tr, true);
    if (b.statut !== 'emis') throw new ErreurBon(409, 'Seul un bon émis peut être révisé.');
    const [deja] = await Q("SELECT id FROM com_bons_commande WHERE remplace_id = :b AND statut IN ('brouillon', 'emis')", { b: b.id }, tr);
    if (deja) throw new ErreurBon(409, 'Une révision de ce bon existe déjà.');
    await sansReception(b.id, tr);
    const [r] = await Q(
      `INSERT INTO com_bons_commande (tenant_id, numero, revision, numero_complet, demande_id, fournisseur_id, magasin_id, devise,
         conditions_paiement, delai_livraison, observations, total_ht, total_taxes, total_ttc, remplace_id, prepare_par)
       SELECT tenant_id, numero, revision, :nc, demande_id, fournisseur_id, magasin_id, devise, conditions_paiement, delai_livraison, observations,
              total_ht, total_taxes, total_ttc, id, :u FROM com_bons_commande WHERE id = :b RETURNING id`,
      { nc: `BROUILLON-${crypto.randomBytes(5).toString('hex')}`, u: ctx.userId, b: b.id }, tr);
    await X(`INSERT INTO com_bc_lignes (bc_id, tenant_id, ordre, demande_ligne_id, article_id, reference, designation, unite, unite_id, coefficient, quantite, prix_unitaire,
               remise_pct, taxe_id, taxe_code, taxe_taux, montant_ht, montant_taxe, montant_ttc)
             SELECT :n, tenant_id, ordre, demande_ligne_id, article_id, reference, designation, unite, unite_id, coefficient, quantite, prix_unitaire,
                    remise_pct, taxe_id, taxe_code, taxe_taux, montant_ht, montant_taxe, montant_ttc FROM com_bc_lignes WHERE bc_id = :b`,
    { n: r.id, b: b.id }, tr);
    await auditer(tr, ctx, 'COM_BC_REVISION', r.id, { revise: b.numero_complet });
    return Number(r.id);
  });
  return lire(ctx, nouveau);
};

// ── PDF : archivé (émis) ou aperçu filigrané (brouillon) ─────────────────
const lirePdf = async (ctx, id) => {
  exigerVue(ctx);
  const b = await charger(ctx, id);
  if (b.statut !== 'brouillon') {
    return { chemin: docs.resoudre(b.pdf_chemin), nom: `${b.numero_complet}.pdf`, sha256: b.pdf_sha256 };
  }
  const lignes = await Q('SELECT * FROM com_bc_lignes WHERE bc_id = :b ORDER BY ordre, id', { b: b.id });
  const contenu = await pdf.rendre({
    ...(await donneesPdf(ctx, b, lignes)), bc: { ...b, numero_complet: 'APERÇU', autorisation: await resumeAutorisation(b.demande_id) },
    verificationUrl: null, apercu: true,
  });
  return { contenu, nom: `apercu-bon-de-commande-${b.id}.pdf` };
};

// ── Proformas ────────────────────────────────────────────────────────────
const joindreProforma = async (ctx, id, body = {}) => {
  exiger(ctx, 'com.bc.preparer', 'préparer les bons de commande');
  const b = await charger(ctx, id);
  if (b.statut !== 'brouillon') throw new ErreurBon(409, 'La proforma se joint pendant la préparation du bon.');
  const f = docs.preparer(body);
  const chemin = await docs.ecrire(ctx.tenantId, 'bon_commande', b.id, f);
  await sequelize.transaction(async (tr) => {
    await X(`INSERT INTO com_documents (tenant_id, objet_type, objet_id, categorie, nom, mime, taille, sha256, chemin, ajoute_par)
             VALUES (:t, 'bon_commande', :b, 'proforma', :nom, :mime, :taille, :sha, :chemin, :u)`,
    { t: ctx.tenantId, b: b.id, nom: f.nom, mime: f.mime, taille: f.taille, sha: f.sha256, chemin, u: ctx.userId }, tr);
    await auditer(tr, ctx, 'COM_BC_PROFORMA_AJOUT', b.id, { nom: f.nom, sha256: f.sha256 });
  });
  return lire(ctx, b.id);
};

const retirerProforma = async (ctx, id, docId, body = {}) => {
  exiger(ctx, 'com.bc.preparer', 'préparer les bons de commande');
  const b = await charger(ctx, id);
  if (b.statut !== 'brouillon') throw new ErreurBon(409, 'Les pièces d\'un bon émis sont figées.');
  const motif = txt(body.motif);
  if (motif.length < 3) throw new ErreurBon(400, 'Indiquez le motif du retrait.');
  await sequelize.transaction(async (tr) => {
    const [x] = await Q(`SELECT * FROM com_documents WHERE id = :x AND tenant_id = :t AND objet_type = 'bon_commande' AND objet_id = :b AND NOT retire FOR UPDATE`,
      { x: entier(docId, 'Pièce'), t: ctx.tenantId, b: b.id }, tr);
    if (!x) throw new ErreurBon(404, 'Pièce introuvable.');
    await X('UPDATE com_documents SET retire = true, retire_par = :u, retire_le = NOW(), motif_retrait = :m WHERE id = :x', { u: ctx.userId, m: motif, x: x.id }, tr);
    await auditer(tr, ctx, 'COM_BC_PROFORMA_RETRAIT', b.id, { nom: x.nom, motif });
  });
  return lire(ctx, b.id);
};

const lirePiece = async (ctx, id, docId) => {
  exigerVue(ctx);
  const b = await charger(ctx, id);
  const [x] = await Q(`SELECT * FROM com_documents WHERE id = :x AND tenant_id = :t AND objet_type = 'bon_commande' AND objet_id = :b`,
    { x: entier(docId, 'Pièce'), t: ctx.tenantId, b: b.id });
  if (!x) throw new ErreurBon(404, 'Pièce introuvable.');
  return { chemin: docs.resoudre(x.chemin), nom: x.nom, mime: x.mime, sha256: x.sha256 };
};

// ── Vérification publique (QR code) ──────────────────────────────────────
// Aucun prix, aucune ligne : de quoi reconnaître un document authentique, annulé ou inconnu.
const verifier = async (jeton) => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(jeton || ''))) return { etat: 'inconnu' };
  const [b] = await Q(
    // 064 : identité figée à l'émission, sinon identité centrale (bons émis avant la 064).
    `SELECT b.numero_complet, b.statut, b.emis_le, b.annule_le, b.pdf_sha256, b.revision,
            COALESCE(b.identite_emetteur->>'raison_sociale', t.nom) AS societe,
            COALESCE(b.identite_emetteur->>'nui', t.nui) AS societe_nui,
            COALESCE(b.identite_emetteur->>'nom_commercial', NULLIF(t.nom_commercial, ''), p.nom_commercial, '') AS nom_commercial, f.nom AS fournisseur,
            (SELECT numero_complet FROM com_bons_commande x WHERE x.remplace_id = b.id AND x.statut = 'emis' LIMIT 1) AS remplace_par
       FROM com_bons_commande b JOIN tenants t ON t.id = b.tenant_id JOIN registre_tiers f ON f.id = b.fournisseur_id
       LEFT JOIN com_parametres p ON p.tenant_id = b.tenant_id
      WHERE b.jeton_verification = :j AND b.statut <> 'brouillon'`, { j: jeton });
  if (!b) return { etat: 'inconnu' };
  return {
    etat: b.statut === 'emis' ? 'authentique' : b.statut === 'annule' ? 'annule' : 'remplace',
    numero: b.numero_complet, societe: b.nom_commercial || b.societe, societe_nui: b.societe_nui || '', fournisseur: b.fournisseur,
    date_emission: b.emis_le, date_annulation: b.statut !== 'emis' ? b.annule_le : null, remplace_par: b.remplace_par || null,
    pdf_sha256: b.pdf_sha256,
  };
};

// Notifications (best-effort) : bon émis → demandeur ; revalidation → valideurs achats.
const notifierEmission = (ctx) => async ({ demandeurId, numero, demande, demandeId }) => {
  try {
    if (demandeurId !== ctx.userId) {
      await creerNotification({ tenantId: ctx.tenantId, destinataireId: demandeurId, type: 'com_demande',
        titre: `Bon de commande ${numero} émis`, message: `Votre demande ${demande} a donné le bon de commande ${numero}.`, refType: 'com_demande', refId: demandeId });
    }
  } catch (e) { console.warn('[Commercial] notification émission :', e.message); }
};
const notifierRevalidation = (ctx) => async (demandeId) => {
  try {
    const [d] = await Q('SELECT numero, magasin_id FROM com_demandes WHERE id = :d', { d: demandeId });
    for (const u of await usersAvecPermission(ctx.tenantId, 'com.da.approuver')) {
      if (u.id === ctx.userId) continue;
      const m = await perim().perimetreMagasins(ctx.tenantId, u.id);
      if (m && !m.includes(Number(d.magasin_id))) continue;
      await creerNotification({ tenantId: ctx.tenantId, destinataireId: u.id, type: 'com_demande',
        titre: `Revalidation demandée — ${d.numero}`, message: `${ctx.username} demande une nouvelle autorisation : prix ou fournisseur différents de ce qui a été approuvé.`,
        refType: 'com_demande', refId: demandeId });
    }
  } catch (e) { console.warn('[Commercial] notification revalidation :', e.message); }
};

// Bons d'une demande (fiche de la demande).
const bonsDeDemande = async (tenantId, demandeId) => (await Q(
  `SELECT b.id, b.numero_complet, b.statut, b.total_ttc, b.devise, f.nom AS fournisseur_nom FROM com_bons_commande b
     JOIN registre_tiers f ON f.id = b.fournisseur_id WHERE b.tenant_id = :t AND b.demande_id = :d ORDER BY b.id`, { t: tenantId, d: demandeId }))
  .map((b) => ({ ...b, id: Number(b.id), total_ttc: Number(b.total_ttc), statut_libelle: STATUTS[b.statut] }));

module.exports = {
  ErreurBon, STATUTS, SUIVI, lister, aCommander, proposition, creer, creerDans, envoyer, donneesPdf, modifier, supprimer, lire, revalider, emettre, annuler, reviser,
  lirePdf, joindreProforma, retirerProforma, lirePiece, verifier, notifierEmission, notifierRevalidation,
  restes, etatCommande, bonsDeDemande, baseVerification, etatReception,
};
