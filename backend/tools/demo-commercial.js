#!/usr/bin/env node
// backend/tools/demo-commercial.js
// ============================================================================
//  Compte de démonstration NJ COMMERCIAL (client FICTIF, séparé de tous les autres).
//
//      node tools/demo-commercial.js                       → crée la démo
//      DEMO_MOT_DE_PASSE='…' node tools/demo-commercial.js → avec ce mot de passe
//
//  • Crée UN nouveau client « DÉMO — Ets Nkolo Distribution (fictif) », identifiant
//    demo-nj-commercial, avec NJ COMMERCIAL activé, et neuf comptes « demo.* ».
//  • Ne touche à AUCUN autre client ni à aucune donnée existante. S'arrête sans
//    rien faire si ce client ou l'un de ces comptes existe déjà.
//  • Toutes les données passent par les services de l'application (mêmes
//    contrôles, mêmes circuits, mêmes séparations des tâches) : le stock ne naît
//    que du stock d'ouverture et de documents validés ; rien n'est écrit « à la main ».
//  • Aucune notification par e-mail : les comptes de démo sont en « plateforme ».
//  • Pour fermer la démo : Plateforme › client › Suspendre (un client qui a des
//    mouvements de stock se suspend, il ne se supprime pas).
//
//  SANS TERMINAL (hébergement cPanel / Passenger) : dans le .env du serveur,
//      DEMO_COMMERCIAL=true
//      DEMO_MOT_DE_PASSE=…            (obligatoire dans ce mode, 8 caractères au moins)
//  puis redémarrer l'application : la démo est créée une fois au démarrage (après
//  les migrations si AUTO_SETUP=true) ; aux démarrages suivants, elle existe déjà et
//  rien ne se passe. Le résultat est dans les journaux, sans le mot de passe.
//  Repasser ensuite DEMO_COMMERCIAL=false et retirer DEMO_MOT_DE_PASSE.
// ============================================================================
if (require.main === module) require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { sequelize } = require('../src/models');
const modules = require('../src/services/modules.service');
const ref = require('../src/services/commercial/referentiel.service');
const da = require('../src/services/commercial/demandes.service');
const bc = require('../src/services/commercial/bons.service');
const sd = require('../src/services/commercial/stock_docs.service');
const ad = require('../src/services/commercial/achats_docs.service');
const vt = require('../src/services/commercial/ventes.service');
const cons = require('../src/services/commercial/consultations.service');
const frais = require('../src/services/commercial/frais.service');

const SLUG = 'demo-nj-commercial';
const T = sequelize.QueryTypes.SELECT;
const Q = (sql, r) => sequelize.query(sql, { replacements: r, type: T });
const etape = (t) => console.log(`  • ${t}`);

const COMPTES = [
  ['directeur', 'directeur', null, 'Directeur : tous les droits, validations de direction'],
  ['demandeur', 'collaborateur', 'achats_demandeur', 'Exprime les besoins d\'achat'],
  ['achats', 'collaborateur', 'achats_gestionnaire', 'Gestionnaire des achats : bons de commande, frais d\'achat'],
  ['comptable', 'collaborateur', 'achats_comptable', 'Comptable : factures fournisseurs, validation des frais d\'achat'],
  ['respachats', 'collaborateur', 'achats_responsable', 'Responsable des achats : approuve, émet les bons, valide'],
  ['magasinier', 'collaborateur', 'stock_magasinier', 'Magasinier : saisies de stock, réceptions, préparations'],
  ['stock', 'collaborateur', 'stock_gestionnaire', 'Gestionnaire de stock : valide stock et livraisons'],
  ['commercial', 'collaborateur', 'ventes_commercial', 'Commercial : devis et commandes clients'],
  ['respcommercial', 'collaborateur', 'ventes_responsable', 'Responsable commercial : valide les devis'],
];

class DemoDejaLa extends Error {}

async function creerDemo({ motDePasse = process.env.DEMO_MOT_DE_PASSE, auto = false } = {}) {
  console.log(auto ? '[Démo] Création du compte de démonstration NJ COMMERCIAL…' : '\nNJ COMMERCIAL — compte de démonstration\n');
  // ── 0. Garde-fous ──────────────────────────────────────────────────────
  const [mig] = await Q("SELECT COUNT(*)::int AS n FROM schema_migrations WHERE version LIKE '059_%'");
  if (!mig.n) throw new Error('Migration 059 non jouée : lancez d\'abord « node db/migrate.js ».');
  const [existe] = await Q('SELECT id FROM tenants WHERE slug = :s', { s: SLUG });
  if (existe) throw new DemoDejaLa(`Le client de démonstration « ${SLUG} » existe déjà : rien n'a été modifié.`);
  const noms = COMPTES.map(([c]) => `demo.${c}`);
  const pris = await Q('SELECT username FROM users WHERE lower(username) IN (:n)', { n: noms });
  if (pris.length) throw new DemoDejaLa(`Comptes déjà utilisés : ${pris.map((u) => u.username).join(', ')}. Rien n'a été modifié.`);

  if (!process.env.VERIFICATION_URL && !process.env.APP_URL) throw new Error('APP_URL (ou VERIFICATION_URL) absente du .env : les bons de commande ne peuvent pas être émis. Rien n\'a été modifié.');
  if (auto && !motDePasse) throw new Error('DEMO_MOT_DE_PASSE absent du .env : obligatoire avec DEMO_COMMERCIAL=true. Rien n\'a été modifié.');
  const mdp = motDePasse || `Demo-${crypto.randomBytes(4).toString('hex')}!`;
  if (mdp.length < 8) throw new Error('DEMO_MOT_DE_PASSE : 8 caractères au moins.');

  // ── 1. Client fictif, module, comptes ──────────────────────────────────
  const [t] = await Q(`INSERT INTO tenants (slug, nom, initialise_le, adresse, ville, pays, telephone, email)
                       VALUES (:s, :n, NOW(), 'Rue de la Démonstration (adresse fictive)', 'Yaoundé', 'Cameroun', '', 'demo@exemple.invalid') RETURNING id`,
  { s: SLUG, n: 'DÉMO — Ets Nkolo Distribution (fictif)' });
  const tenantId = t.id;
  etape('Client fictif créé');
  // 065 : aucun module n'est plus activé d'office ; la démonstration active la caisse et le commercial.
  await modules.definir({ tenantId, code: 'caisse', actif: true, motif: 'Compte de démonstration NJ COMMERCIAL', userId: null });
  await modules.definir({ tenantId, code: 'commercial', actif: true, motif: 'Compte de démonstration NJ COMMERCIAL', userId: null });
  etape('NJ COMMERCIAL activé (profils métier créés)');
  const hash = await bcrypt.hash(mdp, 10);
  const U = {};
  for (const [cle, role, profil] of COMPTES) {
    const username = `demo.${cle}`;
    const [u] = await Q(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif, canal_notif, custom_role_id)
                         VALUES (:t, :u, :e, :h, :r, true, 'plateforme', (SELECT id FROM roles WHERE tenant_id = :t AND code = :p)) RETURNING id`,
    { t: tenantId, u: username, e: `${username}@exemple.invalid`, h: hash, r: role, p: profil });
    U[cle] = { id: u.id, role, username };
  }
  etape(`${COMPTES.length} comptes créés`);
  // 062 : types de gestion (domaine de travail), en plus du profil (niveau).
  const [tg] = await Q("SELECT to_regclass('public.com_utilisateur_types_gestion') IS NOT NULL AS ok");
  if (tg.ok) {
    const TYPES = { demandeur: ['achats'], achats: ['achats'], respachats: ['achats'], magasinier: ['stock'], stock: ['stock', 'achats'],
      commercial: ['ventes'], respcommercial: ['ventes', 'stock'] };
    for (const [cle, types] of Object.entries(TYPES)) {
      for (const tc of types) {
        await Q('INSERT INTO com_utilisateur_types_gestion (user_id, type_code, tenant_id) VALUES (:u, :c, :t) ON CONFLICT DO NOTHING RETURNING 1',
          { u: U[cle].id, c: tc, t: tenantId });
      }
    }
    etape('Types de gestion attribués (achats, ventes, stock — dont deux personnes sur deux domaines)');
  }
  // 066 : chaque compte est rattaché aux modules où il a des droits.
  const rep = await require('../src/services/utilisateurs_modules.service').reprendre({ tenantId, origine: 'creation' });
  etape(`Comptes rattachés aux modules (${rep.affectations.length} sur ${rep.comptes})`);
  const C = {};
  for (const [k, u] of Object.entries(U)) C[k] = await da.contexte({ tenantId, user: u });
  const base = (k) => ({ tenantId, userId: U[k].id });

  // ── 2. Paramétrage ─────────────────────────────────────────────────────
  // 064 : le nom commercial appartient à l'identité centrale de l'entreprise.
  await Q("UPDATE tenants SET nom_commercial = 'Nkolo Distribution' WHERE id = :t", { t: tenantId });
  await ref.modifierSociete({ ...base('directeur'), body: { mentions_documents: 'Document de démonstration — société fictive.' } });
  const agences = await ref.listerAgences(tenantId, {});
  const siege = agences[0];
  const dla = await ref.enregistrerAgence({ ...base('directeur'), body: { code: 'DLA', nom: 'Agence de Douala', adresse: 'Akwa (fictif)' } });
  const cen = await ref.enregistrerMagasin({ ...base('directeur'), body: { code: 'CEN', nom: 'Magasin central Yaoundé', agence_id: siege?.id } });
  const mdl = await ref.enregistrerMagasin({ ...base('directeur'), body: { code: 'DLA', nom: 'Dépôt de Douala', agence_id: dla.id } });
  const unite = async (code, libelle, decimales) => (await ref.enregistrerUnite({ ...base('directeur'), body: { code, libelle, decimales } })).id;
  const u = { piece: await unite('pièce', 'Pièce', 0), carton: await unite('carton', 'Carton', 0), sac: await unite('sac', 'Sac', 0),
    rame: await unite('rame', 'Rame', 0), boite: await unite('boîte', 'Boîte', 0), kg: await unite('kg', 'Kilogramme', 3) };
  const tva = (await ref.enregistrerTaxe({ ...base('directeur'), body: { code: 'TVA', intitule: 'TVA 19,25 %', taux: '19,25' } })).id;
  const tiers = async (type, nom, extra = {}) => (await ref.enregistrerTiers({ ...base('directeur'), body: { type, nom, ...extra }, peutBanque: false })).id;
  const fou = {
    sobraga: await tiers('fournisseur', 'Brasseries du Centre (fictif)', { ville: 'Yaoundé', conditions_paiement: '30 jours fin de mois' }),
    agro: await tiers('fournisseur', 'AgroPlus Négoce (fictif)', { ville: 'Douala', conditions_paiement: 'Comptant' }),
    bureau: await tiers('fournisseur', 'Office Pro Cameroun (fictif)', { ville: 'Yaoundé', conditions_paiement: '50 % à la commande' }),
  };
  const cli = {
    hotel: await tiers('client', 'Hôtel des Collines (fictif)', { adresse: 'Bastos, Yaoundé', ville: 'Yaoundé', conditions_paiement: '30 jours' }),
    resto: await tiers('client', 'Restaurant Le Baobab (fictif)', { adresse: 'Akwa, Douala', ville: 'Douala', conditions_paiement: 'Comptant' }),
    ecole: await tiers('client', 'Collège Saint-Exemple (fictif)', { adresse: 'Mvog-Mbi, Yaoundé', ville: 'Yaoundé' }),
    super: await tiers('client', 'Supermarché Bon Prix (fictif)', { adresse: 'Bonamoussadi, Douala', ville: 'Douala', conditions_paiement: '15 jours' }),
  };
  const famille = async (code, nom, x) => (await ref.enregistrerFamille({ ...base('directeur'), body: { code, nom, ...x } })).id;
  const fam = {
    boi: await famille('BOI', 'Boissons', { unite_stock_id: u.piece, methode_valorisation: 'cmup', fournisseur_ids: [fou.sobraga] }),
    ali: await famille('ALI', 'Alimentation', { unite_stock_id: u.sac, methode_valorisation: 'fifo', fournisseur_ids: [fou.agro] }),
    fou: await famille('FOU', 'Fournitures de bureau', { unite_stock_id: u.piece, methode_valorisation: 'cmup', fournisseur_ids: [fou.bureau] }),
    ser: await famille('SER', 'Prestations', { unite_stock_id: u.piece, suivi_stock: false, methode_valorisation: 'cmup' }),
  };
  const article = async (reference, designation, f, x) => (await ref.enregistrerArticle({ ...base('directeur'),
    body: { reference, designation, famille_id: f, suivi_comptable: false, ...x } })).id;
  const A = {
    eau: await article('EAU15', 'Eau minérale 1,5 L', fam.boi, { unite_achat_id: u.carton, coef_achat: 12, unite_vente_id: u.carton, coef_vente: 12,
      prix_achat_indicatif: 3600, prix_vente_indicatif: 5400, seuil_alerte: 60 }),
    jus: await article('JUS1', 'Jus d\'orange 1 L', fam.boi, { unite_achat_id: u.carton, coef_achat: 6, unite_vente_id: u.carton, coef_vente: 6,
      prix_achat_indicatif: 4800, prix_vente_indicatif: 7200, seuil_alerte: 30 }),
    soda: await article('SODA33', 'Soda 33 cl', fam.boi, { unite_achat_id: u.carton, coef_achat: 24, unite_vente_id: u.carton, coef_vente: 24,
      prix_achat_indicatif: 7200, prix_vente_indicatif: 10800 }),
    riz: await article('RIZ25', 'Riz parfumé 25 kg', fam.ali, { prix_achat_indicatif: 14500, prix_vente_indicatif: 18500, seuil_alerte: 10 }),
    sucre: await article('SUC50', 'Sucre en poudre 50 kg', fam.ali, { prix_achat_indicatif: 26000, prix_vente_indicatif: 32000 }),
    papier: await article('A4-80', 'Papier A4 80 g', fam.fou, { unite_achat_id: u.carton, coef_achat: 5, unite_vente_id: u.rame, coef_vente: 1,
      prix_achat_indicatif: 15000, prix_vente_indicatif: 3800, seuil_alerte: 20 }),
    stylo: await article('STY-B', 'Stylo à bille bleu', fam.fou, { unite_achat_id: u.boite, coef_achat: 50, unite_vente_id: u.boite, coef_vente: 50,
      prix_achat_indicatif: 5000, prix_vente_indicatif: 7500 }),
    cart: await article('CART-N', 'Cartouche d\'encre noire', fam.fou, { prix_achat_indicatif: 18000, prix_vente_indicatif: 25000, seuil_alerte: 5 }),
    transport: await article('TRANSP', 'Transport et livraison', fam.ser, { prix_vente_indicatif: 10000 }),
    install: await article('INSTAL', 'Installation et mise en service', fam.ser, { prix_vente_indicatif: 25000 }),
  };
  etape('Paramétrage : 2 agences, 2 magasins, 6 unités, TVA, 3 fournisseurs, 4 clients, 4 familles, 10 articles');

  // ── 3. Stock d'ouverture (coûts d'origine ; un article laissé « à valoriser ») ──
  const ouverture = new Date(); ouverture.setDate(1); ouverture.setMonth(ouverture.getMonth() - 1);
  const dOuv = ouverture.toISOString().slice(0, 10);
  for (const [a, m, q, c] of [[A.eau, cen, 240, 300], [A.jus, cen, 60, 800], [A.soda, cen, 480, 300], [A.riz, cen, 40, 14500], [A.sucre, cen, 12, 26000],
    [A.papier, cen, 80, 3000], [A.stylo, cen, 300, 100], [A.cart, cen, 4, 18000], [A.eau, mdl, 96, 300], [A.riz, mdl, 15, 14000], [A.papier, mdl, 30, null]]) {
    await ref.enregistrerStockInitial({ ...base('directeur'), body: { article_id: a, magasin_id: m.id, quantite: q, cout_unitaire: c, date_mouvement: dOuv } });
  }
  etape('Stock d\'ouverture saisi (Yaoundé et Douala)');

  // ── 4. Achats ──────────────────────────────────────────────────────────
  const demande = async (qui, magasin, motif, lignes) => da.creer(C[qui], { magasin_id: magasin.id, motif, lignes });
  const soumettreDa = (qui, d) => da.soumettre(C[qui], d.id, { justification_stock: 'Réassort avant la période de forte demande' });
  // a) Demande approuvée → bon émis → réception partielle validée → facture validée.
  const d1 = await demande('demandeur', cen, 'Réassort boissons du mois', [{ article_id: A.eau, quantite: 20 }, { article_id: A.jus, quantite: 10 }]);
  await soumettreDa('demandeur', d1);
  await da.decider(C.respachats, d1.id, { decision: 'approuver' });
  const p1 = await bc.proposition(C.achats, d1.id);
  const b1 = await bc.creer(C.achats, { demande_id: d1.id, fournisseur_id: fou.sobraga, delai_livraison: '5 jours',
    lignes: p1.lignes.map((l) => ({ demande_ligne_id: l.demande_ligne_id, quantite: l.reste, prix_unitaire: l.prix_approuve ?? (l.article_id === A.eau ? 3600 : 4800), taxe_id: tva })) });
  const e1 = await bc.emettre(C.respachats, b1.id, null);
  const r1 = await ad.creerReception(C.magasinier, { bc_id: b1.id, bl_numero: 'BL-DEMO-0458',
    lignes: e1.lignes.map((l) => ({ bc_ligne_id: l.id, quantite: l.article_id === A.eau ? 12 : 10 })) });
  await ad.soumettre(C.magasinier, 'reception', r1.id);
  const r1v = await ad.validerReception(C.respachats, r1.id);
  // 063 : la facture fournisseur est saisie par le comptable, validée par une autre personne.
  const f1 = await ad.creerFacture(C.comptable, { fournisseur_id: fou.sobraga, reference_fournisseur: 'FA-DEMO-2211', date_facture: new Date().toISOString().slice(0, 10),
    lignes: r1v.lignes.map((l) => ({ reception_ligne_id: l.id, quantite: l.quantite, prix_unitaire: l.article_id === A.eau ? 3600 : 4800 })) });
  await ad.soumettre(C.comptable, 'facture', f1.id);
  await ad.validerFacture(C.directeur, f1.id);
  // b) Bon émis, rien reçu encore ; c) réception saisie qui attend sa validation.
  const d2 = await demande('demandeur', cen, 'Fournitures du trimestre', [{ article_id: A.papier, quantite: 10 }, { article_id: A.cart, quantite: 6 }]);
  await soumettreDa('demandeur', d2);
  await da.decider(C.respachats, d2.id, { decision: 'approuver' });
  const p2 = await bc.proposition(C.achats, d2.id);
  const b2 = await bc.creer(C.achats, { demande_id: d2.id, fournisseur_id: fou.bureau,
    lignes: p2.lignes.map((l) => ({ demande_ligne_id: l.demande_ligne_id, quantite: l.reste, prix_unitaire: l.prix_approuve ?? (l.article_id === A.papier ? 15000 : 18000), taxe_id: tva })) });
  const e2 = await bc.emettre(C.respachats, b2.id, null);
  const r2 = await ad.creerReception(C.magasinier, { bc_id: b2.id, bl_numero: 'BL-DEMO-0771',
    lignes: e2.lignes.filter((l) => l.article_id === A.cart).map((l) => ({ bc_ligne_id: l.id, quantite: 6 })) });
  await ad.soumettre(C.magasinier, 'reception', r2.id);
  // d) Demande au-delà du seuil : en attente de la direction ; e) demande à examiner ; f) brouillon.
  const d3 = await demande('demandeur', mdl, 'Stock de riz et de sucre pour Douala', [{ article_id: A.riz, quantite: 30 }, { article_id: A.sucre, quantite: 10 }]);
  await soumettreDa('demandeur', d3);
  await da.decider(C.respachats, d3.id, { decision: 'approuver' }).catch(() => {});
  const d4 = await demande('demandeur', cen, 'Sodas pour la fin d\'année', [{ article_id: A.soda, quantite: 10 }]);
  await soumettreDa('demandeur', d4);
  await demande('demandeur', cen, 'Stylos pour l\'accueil', [{ article_id: A.stylo, quantite: 2 }]);
  etape('Achats : 5 demandes (approuvées, direction, à examiner, brouillon), 2 bons émis, réceptions, facture validée');

  // ── 4 bis. Lot 8 (063) : frais d'achat et consultation des fournisseurs ──
  // g) Transport du bon 1 : saisi par les achats, validé par le comptable → coût réel du stock.
  const fr = await frais.creer(C.achats, { bc_id: b1.id, rubrique: 'transport', fournisseur_nom: 'Trans Express (fictif)', reference_piece: 'TE-DEMO-118',
    libelle: 'Transport Douala – Yaoundé', montant_ht: 18000, montant_taxe: 3465, methode: 'valeur' });
  await frais.valider(C.comptable, fr.id);
  // h) Demande validée puis consultation de trois fournisseurs : deux offres reçues, une attendue.
  const d5 = await demande('demandeur', cen, 'Réassort jus et riz', [{ article_id: A.jus, quantite: 8 }, { article_id: A.riz, quantite: 12 }]);
  await soumettreDa('demandeur', d5);
  await da.decider(C.respachats, d5.id, { decision: 'approuver', commentaire: 'Consulter avant de commander' });
  const limite = new Date(); limite.setDate(limite.getDate() + 10);
  const cs = await cons.creer(C.respachats, { demande_id: d5.id, date_limite: limite.toISOString().slice(0, 10), delai_souhaite: 'Sous 7 jours',
    fournisseur_ids: [fou.sobraga, fou.agro, fou.bureau], validite_offre_jours: 30, conditions_reponse: 'Prix hors taxes, livraison au magasin central.' });
  const cl = await cons.lancer(C.respachats, cs.id, { envoyer_emails: false });
  const jetonDe = (fid) => cl.fournisseurs.find((x) => x.fournisseur_id === fid).lien.split('/offre/')[1];
  for (const f of cl.fournisseurs) await cons.envoyer(C.respachats, cs.id, f.id, { mode: 'manuel', destinataire: 'Lien envoyé par WhatsApp (démo)' });
  const offre = async (fid, prix, delai, cond) => {
    const v = await cons.publicLire(jetonDe(fid));
    await cons.publicSoumettre(jetonDe(fid), { signataire: 'Service commercial (démo)', delai_livraison_jours: delai, conditions_paiement: cond, validite_jours: 30,
      lignes: v.lignes.map((l) => ({ consultation_ligne_id: l.id, disponibilite: 'disponible', prix_unitaire: prix[l.reference], taux_taxe: 19.25 })) }, '127.0.0.1');
  };
  await offre(fou.sobraga, { JUS1: 4700, RIZ25: 14900 }, 5, '30 jours fin de mois');
  await offre(fou.agro, { JUS1: 4950, RIZ25: 14200 }, 3, 'Comptant à la livraison');
  etape('Approvisionnement : frais de transport validé (coût réel), consultation lancée avec 2 offres sur 3');

  // ── 5. Stock : documents validés et en attente ─────────────────────────
  const docStock = async (qui, valideur, corps) => {
    const d = await sd.creer(C[qui], corps);
    await sd.soumettre(C[qui], d.id);
    return valideur ? sd.valider(C[valideur], d.id) : d;
  };
  await docStock('magasinier', 'stock', { type: 'transfert', magasin_id: cen.id, magasin_dest_id: mdl.id, motif: 'Approvisionnement du dépôt de Douala',
    lignes: [{ article_id: A.soda, quantite: 96 }, { article_id: A.jus, quantite: 12 }] });
  await docStock('magasinier', 'stock', { type: 'entree', magasin_id: cen.id, motif: 'Échantillons offerts par le fournisseur',
    lignes: [{ article_id: A.stylo, quantite: 50, cout_unitaire: 100 }] });
  await docStock('magasinier', 'stock', { type: 'sortie', magasin_id: cen.id, motif: 'Consommation du bureau',
    lignes: [{ article_id: A.papier, quantite: 5 }] });
  const inv = await sd.articlesInventaire(C.magasinier, mdl.id, {});
  await docStock('magasinier', 'stock', { type: 'inventaire', magasin_id: mdl.id, motif: 'Inventaire tournant du dépôt',
    lignes: inv.filter((a) => a.id === A.eau || a.id === A.riz).map((a) => ({ article_id: a.id, quantite_comptee: a.id === A.eau ? Number(a.theorique) - 2 : Number(a.theorique) })) });
  await docStock('magasinier', null, { type: 'sortie', magasin_id: cen.id, motif: 'Casse constatée au déchargement', lignes: [{ article_id: A.eau, quantite: 6 }] });
  etape('Stock : transfert, entrée, sortie, inventaire validés ; une sortie à valider');

  // ── 6. Ventes ──────────────────────────────────────────────────────────
  // 062 : la taxe se choisit sur chaque ligne de l'opération.
  const devis = (client, objet, lignes, extra = {}) => vt.creerDevis(C.commercial, { client_id: client, objet, lignes: lignes.map((l) => ({ taxe_id: tva, ...l })), ...extra });
  const valider = async (dv, qui = 'respcommercial') => { await vt.soumettreDevis(C.commercial, dv.id); return vt.validerDevis(C[qui], dv.id); };
  // a) Commande livrée en partie + une préparation en attente de validation.
  const v1 = await devis(cli.hotel, 'Approvisionnement du bar', [{ article_id: A.eau, quantite: 10 }, { article_id: A.jus, quantite: 4, remise_pct: 5 },
    { article_id: A.transport, quantite: 1 }], { delai_livraison: '48 heures' });
  await valider(v1);
  const c1 = await vt.accepterDevis(C.commercial, v1.id, { reference_client: 'BC-HDC-2026-118', adresse_livraison: 'Bastos, Yaoundé' });
  const l1 = await vt.creerLivraison(C.magasinier, { commande_id: c1.id, magasin_id: cen.id, transporteur: 'Camion 12 (fictif)',
    lignes: c1.lignes.map((l) => ({ commande_ligne_id: l.id, quantite: l.article_id === A.eau ? 6 : l.quantite })) });
  await vt.preparerLivraison(C.magasinier, l1.id);
  await vt.validerLivraison(C.stock, l1.id);
  const l2 = await vt.creerLivraison(C.magasinier, { commande_id: c1.id, magasin_id: cen.id,
    lignes: c1.lignes.filter((l) => l.article_id === A.eau).map((l) => ({ commande_ligne_id: l.id, quantite: 4 })) });
  await vt.preparerLivraison(C.magasinier, l2.id);
  // b) Commande entièrement livrée (Douala).
  const v2 = await devis(cli.resto, 'Boissons de la semaine', [{ article_id: A.eau, quantite: 3 }]);
  await valider(v2);
  const c2 = await vt.accepterDevis(C.commercial, v2.id, { reference_client: 'Commande téléphonique' });
  const l3 = await vt.creerLivraison(C.magasinier, { commande_id: c2.id, magasin_id: mdl.id, lignes: [{ commande_ligne_id: c2.lignes[0].id, quantite: 3 }] });
  await vt.preparerLivraison(C.magasinier, l3.id);
  await vt.validerLivraison(C.stock, l3.id);
  // c) Commande à livrer.
  const v3 = await devis(cli.super, 'Riz et sucre', [{ article_id: A.riz, quantite: 8 }, { article_id: A.sucre, quantite: 2 }]);
  await valider(v3);
  await vt.accepterDevis(C.commercial, v3.id, { reference_client: 'BP-DLA-0042' });
  // d) Devis validé à remettre ; e) remise hors plafond chez la direction ; f) gros devis à valider ; g) refusé ; h) brouillon.
  await valider(await devis(cli.ecole, 'Fournitures de la rentrée', [{ article_id: A.papier, quantite: 40 }, { article_id: A.stylo, quantite: 6 }]));
  const v5 = await devis(cli.ecole, 'Cartouches pour la salle informatique', [{ article_id: A.cart, quantite: 3, remise_pct: 15 }, { article_id: A.install, quantite: 1 }]);
  await valider(v5);
  const v6 = await devis(cli.super, 'Commande de fin d\'année', [{ article_id: A.soda, quantite: 60 }, { article_id: A.eau, quantite: 120 }]);
  await vt.soumettreDevis(C.commercial, v6.id);
  const v7 = await devis(cli.resto, 'Jus pour un banquet', [{ article_id: A.jus, quantite: 20 }]);
  await valider(v7);
  await vt.refuserDevis(C.commercial, v7.id, { motif: 'Le client a trouvé moins cher ailleurs' });
  await devis(cli.hotel, 'Papier pour la réception', [{ article_id: A.papier, quantite: 10 }]);
  etape('Ventes : 8 devis (brouillon, à valider, direction, validé, accepté, refusé), 3 commandes, 3 livraisons');

  if (auto) {
    console.log(`[Démo] ✅ Démonstration prête : client ${SLUG}, comptes ${COMPTES.map(([c]) => `demo.${c}`).join(', ')} (mot de passe : DEMO_MOT_DE_PASSE du .env).`);
    return { ok: true };
  }
  console.log('\n✅ Démonstration prête.\n');
  console.log(`   Client : DÉMO — Ets Nkolo Distribution (fictif)   identifiant : ${SLUG}`);
  console.log(`   Mot de passe commun : ${mdp}${motDePasse ? ' (celui que vous avez fourni)' : '   ← notez-le, il n\'est affiché qu\'une fois'}\n`);
  for (const [cle, , , role] of COMPTES) console.log(`   demo.${cle.padEnd(15)} ${role}`);
  console.log('\n   Pour fermer la démo : Plateforme › client › Suspendre.\n');
  return { ok: true };
}

// Message d'échec commun (terminal ou démarrage automatique).
const expliquer = (e) => {
  if (e instanceof DemoDejaLa) return e.message;
  if (/Migration 059|DEMO_MOT_DE_PASSE|Rien n'a été modifié/.test(e.message || '')) return e.message;
  return `${e.message} — démonstration incomplète : suspendez le client « ${SLUG} » (Plateforme).`;
};

// Démarrage du serveur (DEMO_COMMERCIAL=true) : jamais bloquant, jamais d'arrêt du process.
const creerDemoAuDemarrage = () => creerDemo({ auto: true })
  .catch((e) => (e instanceof DemoDejaLa ? console.log(`[Démo] ${e.message}`) : console.error(`[Démo] ❌ ${expliquer(e)}`)));

module.exports = { creerDemo, creerDemoAuDemarrage };

if (require.main === module) {
  creerDemo()
    .then(() => sequelize.close())
    .catch(async (e) => {
      console.error(`\n❌ ${expliquer(e)}\n`);
      await sequelize.close().catch(() => {});
      process.exit(1);
    });
}
