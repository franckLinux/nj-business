'use strict';
// NJ FINANCE — factures fournisseurs (lot F6, migration 080) et clients (lot F8, migration 081).
// Le même service traite les deux sens (paramètre `sens` : 'fournisseur' par défaut, ou 'client').
// Ventes : facture, avoir et PROFORMA (numérotée, sans écriture, transformée en facture) ;
// écriture de vente (journal VT) : D 411 + tiers (TTC) / C produits (HT) / C taxe collectée.
// Règlement : depuis la facture, NJ FINANCE crée lui-même le mouvement de caisse ou de
// banque (mêmes contrôles que la saisie en caisse) puis le relie ; ou règlement HORS CAISSE
// ni banque (compte au choix, motif), valable seulement une fois validé par le directeur.
//
//
// Deux origines, une seule liste :
//   • « fin »    : factures et avoirs fournisseurs saisis dans NJ FINANCE
//                  (fin_factures) — brouillon → à valider → validée → annulée ;
//   • « com_ff » : factures et avoirs VALIDÉS dans NJ COMMERCIAL, lus par
//                  référence. NJ FINANCE n'y ajoute que l'imputation comptable
//                  (fin_imputations_externes) ; rien n'est recopié.
//
// Écriture d'achat (journal AC), validée avec la facture :
//   D charges / immobilisations (HT, par compte)  ·  D taxe déductible
//   C fournisseur 401 (481 pour une immobilisation) + tiers (TTC)
// Un avoir s'inscrit en sens inverse. Une facture annulée est extournée.
//
// Règlement : TOUJOURS un mouvement du journal de caisse (sortie de caisse ou de
// banque) relié à une ou plusieurs factures (fin_reglement_affectations). Le
// générateur des écritures de caisse (F3) passe alors la part réglée au compte
// du fournisseur et non au compte de charge de la rubrique.
//
// Reste à payer = TTC − avoirs validés − règlements (sorties non annulées).
const crypto = require('node:crypto');
const { sequelize } = require('../../models');
const extractions = require('./extractions.service');
const socle = require('../comptabilite/socle.service');
const generation = require('../comptabilite/generation_caisse.service');
const config = require('./config.service');

const T = sequelize.QueryTypes;
const Q = (sql, replacements, opts = {}) => sequelize.query(sql, { replacements, type: T.SELECT, ...opts });
const X = (sql, replacements, opts = {}) => sequelize.query(sql, { replacements, ...opts });

class ErreurAchat extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}
const CONFLITS = new Set(['FACTURE_INTANGIBLE', 'REGLEMENT_DEPASSE', 'PERIODE_FERMEE', 'EXERCICE_CLOS', 'ECRITURE_INTANGIBLE']);
const traduire = (err) => {
  if (err instanceof extractions.ErreurExtraction) return new ErreurAchat(err.status, err.message, err.doublon ? { doublon: err.doublon } : undefined);
  if (err instanceof ErreurAchat) return err;
  if (err instanceof socle.ErreurFinance || err instanceof config.ErreurConfig) return new ErreurAchat(err.status, err.message);
  const code = err?.original?.code || err?.parent?.code;
  const msg = err?.original?.message || err?.parent?.message || '';
  const m = /^([A-Z_]+): (.*)$/s.exec(msg);
  if (code === '23514' && m) return new ErreurAchat(m[1] === 'DIRECTEUR_SEUL' ? 403 : CONFLITS.has(m[1]) ? 409 : 400, m[2]);
  if (code === '23505' && /uq_fin_factures_reference/.test(msg)) return new ErreurAchat(409, 'Cette facture du fournisseur est déjà enregistrée.');
  if (code === '23505') return new ErreurAchat(409, 'Modification concurrente : rechargez la page et recommencez.');
  if (code === '23514') return new ErreurAchat(400, 'Donnée refusée par les règles de la base.');
  return err;
};
const enTransaction = async (fn) => {
  try { return await sequelize.transaction(fn); } catch (err) { throw traduire(err); }
};

// ── Lecture des saisies ─────────────────────────────────────────────────────
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const cts = (v) => Math.round(Number(v || 0) * 100);
const mt = (c) => (c / 100).toFixed(2);
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const ajouterJours = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};
const date = (v, quoi, { obligatoire = false } = {}) => {
  const s = String(v ?? '').trim();
  if (!s) { if (obligatoire) throw new ErreurAchat(400, `${quoi} : obligatoire.`); return null; }
  if (!ISO.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new ErreurAchat(400, `${quoi} invalide.`);
  return s;
};
const id = (v, quoi, { obligatoire = true } = {}) => {
  if (v === null || v === undefined || v === '') {
    if (obligatoire) throw new ErreurAchat(400, `${quoi} : obligatoire.`);
    return null;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ErreurAchat(400, `${quoi} invalide.`);
  return n;
};
const nombre = (v, quoi, { min = 0, max = Infinity, decimales = 2 } = {}) => {
  const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  const f = 10 ** decimales;
  if (String(v ?? '').trim() === '' || !Number.isFinite(n) || n < min || n > max || Math.round(n * f) !== Math.round(n * f * 1e6) / 1e6) {
    throw new ErreurAchat(400, `${quoi} invalide.`);
  }
  return n;
};
const texte = (v, max, quoi, { obligatoire = false } = {}) => {
  const s = String(v ?? '').trim();
  if (obligatoire && !s) throw new ErreurAchat(400, `${quoi} : obligatoire.`);
  if (s.length > max) throw new ErreurAchat(400, `${quoi} : ${max} caractères au plus.`);
  return s;
};

// Montants d'une ligne, en centimes : HT = quantité × prix × (1 − remise), taxe = HT × taux.
const calculLigne = (l) => {
  const ht = Math.round(l.quantite * l.prix_unitaire * (100 - l.remise_pct));     // centimes (prix × 100 × (100 − r) / 100)
  const taxe = Math.round((ht * l.taxe_taux) / 100);
  return { ht, taxe };
};

const estOng = async (tenantId, transaction) => {
  const [r] = await Q('SELECT tenant_est_ong(:tenantId) AS ong', { tenantId }, { transaction });
  return Boolean(r?.ong);
};

// Paramètres de chaque sens.
const SENS = {
  fournisseur: { categorie: 'charge', typesTiers: ['fournisseur', 'mixte'], nomTiers: 'fournisseur', colCompte: 'compte_charge', colPrix: 'prix_achat',
    docs: { facture: 'facture_fournisseur', avoir: 'avoir_fournisseur' }, journal: 'achats', journalCode: 'AC', libelleJournal: 'd\'achats',
    sensRubrique: 'depense' },
  client: { categorie: 'produit', typesTiers: ['client', 'mixte'], nomTiers: 'client', colCompte: 'compte_produit', colPrix: 'prix_vente',
    docs: { facture: 'facture_client', avoir: 'avoir_client', proforma: 'proforma' }, journal: 'ventes', journalCode: 'VT', libelleJournal: 'de ventes',
    sensRubrique: 'entree' },
};
const sensDe = (s) => (s === 'client' ? 'client' : 'fournisseur');

// Comptes autorisés selon le sens et le type d'achat de la catégorie.
const PREFIXES = { marchandises: ['60'], autres: ['6'], immobilisation: ['2'] };
const verifierCompte = async (tenantId, compte, typeAchat, quoi, transaction, sens = 'fournisseur') => {
  const c = String(compte || '').trim();
  if (!c) throw new ErreurAchat(400, `${quoi} : compte manquant. Renseignez-le sur la ligne, la prestation, la famille ou la catégorie.`);
  if (sens === 'client') {
    if (!c.startsWith('7')) throw new ErreurAchat(400, `${quoi} : le compte ${c} n'est pas un compte de produits (classe 7).`);
  } else {
    const prefixes = PREFIXES[typeAchat] || ['6', '2'];
    if (!prefixes.some((p) => c.startsWith(p))) {
      throw new ErreurAchat(400, `${quoi} : le compte ${c} ne convient pas à une catégorie « ${config.TYPES_ACHAT[typeAchat] || typeAchat} » (comptes ${prefixes.join(' ou ')}…).`);
    }
  }
  const [{ a }] = await Q('SELECT fin_compte_anomalie(:tenantId, :c) AS a', { tenantId, c }, { transaction });
  if (a) throw new ErreurAchat(400, `${quoi} : ${a}.`);
  return c;
};

// Compte du tiers : fournisseur 481 pour une immobilisation, sinon le collectif
// du compte auxiliaire du tiers (401, 408… ; 411, 416… pour un client), 401 / 411
// par défaut — premier compte de détail.
const compteFournisseur = async (tenantId, tiers, typeAchat, transaction, sens = 'fournisseur') => {
  const aux = String(tiers.compte_tiers || '').trim().toUpperCase();
  const defaut = sens === 'client' ? '411' : '401';
  const racine = sens === 'client' ? (/^41\d/.test(aux) ? aux.slice(0, 3) : '411')
    : typeAchat === 'immobilisation' ? '481' : (/^40\d/.test(aux) ? aux.slice(0, 3) : '401');
  const c = await config.premierDetail(tenantId, racine, transaction) || (racine !== defaut ? await config.premierDetail(tenantId, defaut, transaction) : '');
  if (!c) throw new ErreurAchat(400, `Aucun compte de détail ${racine} dans le plan comptable : ajoutez-le avant de valider.`);
  return c;
};

// ── Référentiels de saisie ──────────────────────────────────────────────────
const referentiels = async (tenantId, sensBrut = 'fournisseur') => {
  const sens = sensDe(sensBrut);
  const P = SENS[sens];
  const ong = await estOng(tenantId);
  const [tiers, categories, prestations, taxes, activites, journaux, rubriques] = await Promise.all([
    Q(`SELECT t.id::text AS id, t.nom, t.nui, t.compte_tiers, t.type, coalesce(f.delai_paiement_jours, 30) AS delai
         FROM registre_tiers t LEFT JOIN fin_tiers f ON f.tiers_id = t.id
        WHERE t.tenant_id = :tenantId AND t.actif AND t.type IN (:types) ORDER BY lower(t.nom)`, { tenantId, types: P.typesTiers }),
    Q(`SELECT id::text AS id, code, libelle, type_achat, compte_defaut FROM fin_categories
        WHERE tenant_id = :tenantId AND sens = :cat AND actif ORDER BY ordre, code`, { tenantId, cat: P.categorie }),
    Q(`SELECT p.id::text AS id, p.code, p.libelle, p.unite, p.${P.colPrix} AS prix, p.taxe_id::text AS taxe_id,
              coalesce(nullif(p.${P.colCompte}, ''), nullif(f.${P.colCompte}, ''), '') AS compte
         FROM fin_prestations p LEFT JOIN fin_familles f ON f.id = p.famille_id
        WHERE p.tenant_id = :tenantId AND p.actif ORDER BY p.code`, { tenantId }),
    Q(`SELECT t.id::text AS id, t.code, t.intitule, t.taux, coalesce(x.compte_deductible, '') AS compte_deductible,
              coalesce(x.compte_deductible_immo, '') AS compte_deductible_immo, coalesce(x.compte_collecte, '') AS compte_collecte
         FROM com_taxes t LEFT JOIN fin_taxes_comptes x ON x.taxe_id = t.id
        WHERE t.tenant_id = :tenantId AND t.actif ORDER BY t.code`, { tenantId }),
    ong ? Q(`SELECT id::text AS id, nom, type FROM activites WHERE tenant_id = :tenantId AND actif ORDER BY type, lower(nom)`, { tenantId }) : [],
    // Paiement depuis la facture : caisses et banques, rubriques du bon sens.
    Q(`SELECT id::text AS id, code, nom, type FROM journaux WHERE tenant_id = :tenantId AND actif ORDER BY ordre, code`, { tenantId }),
    Q(`SELECT code, intitule FROM rubriques WHERE tenant_id = :tenantId AND type = :type AND coalesce(actif, true)
         AND NOT coalesce(est_virement_interne, false) ORDER BY code`, { tenantId, type: P.sensRubrique }),
  ]);
  return { sens, tiers, fournisseurs: tiers, categories, prestations: prestations.map((p) => ({ ...p, prix_achat: p.prix, prix_vente: p.prix })),
    taxes, activites, ong, types_achat: config.TYPES_ACHAT, journaux, rubriques };
};

// ── Liste unifiée (NJ FINANCE + NJ COMMERCIAL pour les fournisseurs) ───────
const SQL_FIN = `
  SELECT 'fin' AS origine, f.id::text AS id, f.type, f.numero, f.reference, f.tiers_id::text AS tiers_id, t.nom AS tiers_nom,
         f.date_facture::text AS date_facture, f.date_echeance::text AS date_echeance, f.objet,
         f.total_ht, f.total_taxes, f.total_ttc, f.statut, c.libelle AS categorie, f.facture_origine_id::text AS origine_id,
         CASE WHEN f.statut = 'validee' AND f.type = 'facture' THEN fin_facture_reste('fin', f.id) END AS reste,
         true AS impute, f.cree_le, c.type_achat, a.nom AS activite,
         (SELECT string_agg(DISTINCT l.compte, ', ') FROM fin_facture_lignes l WHERE l.facture_id = f.id) AS comptes
    FROM fin_factures f JOIN registre_tiers t ON t.id = f.tiers_id JOIN fin_categories c ON c.id = f.categorie_id
    LEFT JOIN activites a ON a.id = f.activite_id
   WHERE f.tenant_id = :tenantId AND f.sens = :sens`;
const SQL_COM = `
  SELECT 'com_ff', cf.id::text, cf.type, cf.numero, cf.reference_fournisseur, cf.fournisseur_id::text, t.nom,
         cf.date_facture::text, cf.date_echeance::text, '',
         cf.total_ht, cf.total_taxes, cf.total_ttc,
         CASE cf.statut WHEN 'valide' THEN 'validee' ELSE 'annulee' END, c.libelle, cf.facture_origine_id::text,
         CASE WHEN cf.statut = 'valide' AND cf.type = 'facture' THEN fin_facture_reste('com_ff', cf.id) END,
         i.id IS NOT NULL, cf.cree_le, coalesce(c.type_achat, 'marchandises'), a.nom,
         coalesce(nullif(i.compte, ''), c.compte_defaut)
    FROM com_factures_fournisseurs cf JOIN registre_tiers t ON t.id = cf.fournisseur_id
    LEFT JOIN fin_imputations_externes i ON i.com_ff_id = cf.id LEFT JOIN fin_categories c ON c.id = i.categorie_id
    LEFT JOIN activites a ON a.id = i.activite_id
   WHERE cf.tenant_id = :tenantId AND (cf.statut = 'valide' OR (cf.statut = 'annule' AND cf.valide_le IS NOT NULL))`;
const sqlListe = (sens) => (sens === 'client' ? SQL_FIN : `${SQL_FIN} UNION ALL ${SQL_COM}`);

const STATUTS = { brouillon: 'Brouillon', a_valider: 'À valider', validee: 'Validée', annulee: 'Annulée', transformee: 'Facturée' };
const enrichirListe = (r, jour) => {
  const reste = r.reste === null || r.reste === undefined ? null : cts(r.reste);
  const echue = reste !== null && reste > 0 && r.date_echeance && r.date_echeance < jour;
  let etat = STATUTS[r.statut];
  if (r.origine === 'com_ff' && r.statut === 'validee' && !r.impute) etat = 'À imputer';
  else if (r.type === 'proforma' && r.statut === 'validee') etat = 'Émise';
  else if (r.statut === 'validee' && r.type === 'facture') etat = reste <= 0 ? 'Réglée' : (reste < cts(r.total_ttc) ? 'Réglée en partie' : (r.sens === 'client' ? 'À encaisser' : 'À payer'));
  return {
    ...r, cle: `${r.origine}-${r.id}`, reste: reste === null ? null : mt(Math.max(reste, 0)), echue,
    jours_retard: echue ? Math.round((Date.parse(jour) - Date.parse(r.date_echeance)) / 864e5) : 0, etat,
    origine_libelle: r.origine === 'fin' ? 'NJ FINANCE' : 'NJ COMMERCIAL',
  };
};

const lister = async (tenantId, q = {}, sensBrut = 'fournisseur') => {
  const sens = sensDe(sensBrut);
  if (sens === 'fournisseur') await synchroniserCommercial(tenantId);
  const jour = aujourdhui();
  const rows = (await Q(`${sqlListe(sens)} ORDER BY 8 DESC, 2 DESC`, { tenantId, sens })).map((r) => enrichirListe({ ...r, sens }, jour));
  const rech = String(q.q || '').trim().toLowerCase();
  const filtre = String(q.filtre || '');
  const liste = rows.filter((r) => (!q.tiers_id || r.tiers_id === String(q.tiers_id))
    && (!q.origine || r.origine === q.origine)
    && (!q.type || r.type_achat === q.type)
    && (!q.du || r.date_facture >= q.du) && (!q.au || r.date_facture <= q.au)
    && (!rech || [r.numero, r.reference, r.tiers_nom, r.objet].some((v) => String(v || '').toLowerCase().includes(rech)))
    && (!filtre
      || (filtre === 'a_valider' && ['brouillon', 'a_valider'].includes(r.statut))
      || (filtre === 'a_imputer' && r.etat === 'À imputer')
      || (filtre === 'a_payer' && r.reste !== null && cts(r.reste) > 0)
      || (filtre === 'echues' && r.echue)
      || (filtre === 'annulees' && r.statut === 'annulee')
      || (filtre === 'factures' && r.type === 'facture')
      || (filtre === 'avoirs' && r.type === 'avoir')
      || (filtre === 'proformas' && r.type === 'proforma')));
  const ouvertes = rows.filter((r) => r.reste !== null && cts(r.reste) > 0);
  const [hc] = await Q(`SELECT count(*)::int AS n FROM fin_reglements_hors_caisse h
                         LEFT JOIN fin_factures f ON h.facture_type = 'fin' AND f.id = h.facture_id
                        WHERE h.tenant_id = :tenantId AND h.statut = 'propose' AND coalesce(f.sens, 'fournisseur') = :sens`, { tenantId, sens });
  return {
    factures: liste.slice(0, 1000),
    total: liste.length,
    compteurs: {
      a_valider: rows.filter((r) => r.statut === 'a_valider').length,
      brouillons: rows.filter((r) => r.statut === 'brouillon').length,
      a_imputer: rows.filter((r) => r.etat === 'À imputer').length,
      a_payer: ouvertes.length,
      echues: rows.filter((r) => r.echue).length,
      reste_total: mt(ouvertes.reduce((t, r) => t + cts(r.reste), 0)),
      echu_total: mt(rows.filter((r) => r.echue).reduce((t, r) => t + cts(r.reste), 0)),
      proformas: rows.filter((r) => r.type === 'proforma' && r.statut === 'validee').length,
      hors_caisse_a_valider: hc.n,
    },
  };
};

// ── Détail ──────────────────────────────────────────────────────────────────
const ecritureDe = async (tenantId, origineType, origineId) => Q(
  `SELECT e.id::text AS id, e.statut, e.numero, j.code AS journal_code, x.code AS exercice_code, e.date_ecriture::text AS date,
          e.extournee_par_id IS NOT NULL AS extournee
     FROM fin_ecritures e JOIN fin_journaux j ON j.id = e.journal_id JOIN fin_exercices x ON x.id = e.exercice_id
    WHERE e.tenant_id = :tenantId AND e.origine_type = :origineType AND e.origine_id = :origineId ORDER BY e.id`,
  { tenantId, origineType, origineId });

const affectationsDe = async (tenantId, type, fid) => Q(
  `SELECT a.id::text AS id, a.montant, a.cree_le, j.id::text AS mouvement_id, j.date::text AS date, j.numero, jo.code AS caisse,
          j.intitule, coalesce(j.beneficiaire, '') AS beneficiaire, j.annule_par_id IS NOT NULL AS annule, u.username AS par
     FROM fin_reglement_affectations a JOIN journal j ON j.id = a.mouvement_id LEFT JOIN journaux jo ON jo.id = j.journal_id
     LEFT JOIN users u ON u.id = a.cree_par
    WHERE a.tenant_id = :tenantId AND a.facture_type = :type AND a.facture_id = :fid ORDER BY j.date, a.id`,
  { tenantId, type, fid });

// Règlements hors caisse ni banque d'une facture.
const horsCaisseDe = async (tenantId, type, fid) => Q(
  `SELECT h.id::text AS id, h.date_reglement::text AS date, h.montant, h.compte, h.motif, h.statut, h.motif_decision,
          t.nom AS tiers_nom, up.username AS propose_par_nom, ud.username AS decide_par_nom, h.propose_le, h.decide_le
     FROM fin_reglements_hors_caisse h LEFT JOIN registre_tiers t ON t.id = h.tiers_id
     LEFT JOIN users up ON up.id = h.propose_par LEFT JOIN users ud ON ud.id = h.decide_par
    WHERE h.tenant_id = :tenantId AND h.facture_type = :type AND h.facture_id = :fid ORDER BY h.id`, { tenantId, type, fid });

const lire = async (tenantId, origine, idBrut, sensBrut = 'fournisseur') => {
  const sens = sensDe(sensBrut);
  const fid = id(idBrut, 'Facture');
  if (origine === 'fin') {
    const [f] = await Q(
      `SELECT f.*, f.id::text AS id, f.tiers_id::text AS tiers_id, f.categorie_id::text AS categorie_id,
              f.facture_origine_id::text AS facture_origine_id, f.date_facture::text AS date_facture, f.date_echeance::text AS date_echeance,
              t.nom AS tiers_nom, t.nui AS tiers_nui, c.libelle AS categorie, c.type_achat, a.nom AS activite,
              uc.username AS cree_par_nom, us.username AS soumis_par_nom, uv.username AS valide_par_nom, ua.username AS annule_par_nom,
              o.numero AS origine_numero, o.reference AS origine_reference, f.proforma_id::text AS proforma_id, pr.numero AS proforma_numero,
              (SELECT x.id::text FROM fin_factures x WHERE x.proforma_id = f.id AND x.statut <> 'annulee' LIMIT 1) AS facture_issue_id,
              (SELECT coalesce(x.numero, 'brouillon') FROM fin_factures x WHERE x.proforma_id = f.id AND x.statut <> 'annulee' LIMIT 1) AS facture_issue_numero
         FROM fin_factures f JOIN registre_tiers t ON t.id = f.tiers_id JOIN fin_categories c ON c.id = f.categorie_id
         LEFT JOIN activites a ON a.id = f.activite_id LEFT JOIN fin_factures o ON o.id = f.facture_origine_id
         LEFT JOIN fin_factures pr ON pr.id = f.proforma_id
         LEFT JOIN users uc ON uc.id = f.cree_par LEFT JOIN users us ON us.id = f.soumis_par
         LEFT JOIN users uv ON uv.id = f.valide_par LEFT JOIN users ua ON ua.id = f.annule_par
        WHERE f.id = :fid AND f.tenant_id = :tenantId AND f.sens = :sens`, { fid, tenantId, sens });
    if (!f) throw new ErreurAchat(404, 'Facture introuvable.');
    const lignes = await Q(
      `SELECT l.id::text AS id, l.ordre, l.prestation_id::text AS prestation_id, l.designation, l.quantite, l.prix_unitaire, l.remise_pct,
              l.taxe_id::text AS taxe_id, l.taxe_taux, t.code AS taxe_code, l.compte, l.activite_id::text AS activite_id, l.montant_ht, l.montant_taxe
         FROM fin_facture_lignes l LEFT JOIN com_taxes t ON t.id = l.taxe_id WHERE l.facture_id = :fid ORDER BY l.ordre, l.id`, { fid });
    const avoirs = await Q(`SELECT id::text AS id, numero, reference, date_facture::text AS date_facture, total_ttc, statut
                              FROM fin_factures WHERE facture_origine_id = :fid ORDER BY id`, { fid });
    const [{ reste }] = await Q('SELECT fin_facture_reste(\'fin\', :fid) AS reste', { fid });
    return { origine: 'fin', sens, facture: { ...f, identite_emetteur: undefined, statut_libelle: f.type === 'proforma' && f.statut === 'validee' ? 'Émise' : STATUTS[f.statut] },
      lignes, avoirs,
      piece_lue: f.sens === 'fournisseur' ? await extractions.pourFacture(tenantId, fid) : null,
      reglements: f.type === 'facture' ? await affectationsDe(tenantId, 'fin', fid) : [],
      hors_caisse: f.type === 'facture' ? await horsCaisseDe(tenantId, 'fin', fid) : [],
      reste: f.statut === 'validee' && f.type === 'facture' ? mt(Math.max(cts(reste), 0)) : null,
      ecritures: await ecritureDe(tenantId, 'fin_facture', fid) };
  }
  if (origine !== 'com_ff' || sens !== 'fournisseur') throw new ErreurAchat(400, 'Origine inconnue.');
  const [f] = await Q(
    `SELECT cf.id::text AS id, cf.type, cf.numero, cf.reference_fournisseur AS reference, cf.fournisseur_id::text AS tiers_id,
            cf.date_facture::text AS date_facture, cf.date_echeance::text AS date_echeance, cf.total_ht, cf.total_taxes, cf.total_ttc,
            CASE cf.statut WHEN 'valide' THEN 'validee' WHEN 'annule' THEN 'annulee' ELSE cf.statut END AS statut,
            cf.facture_origine_id::text AS facture_origine_id, cf.observations, t.nom AS tiers_nom, t.nui AS tiers_nui,
            uv.username AS valide_par_nom, cf.valide_le, o.numero AS origine_numero,
            i.id::text AS imputation_id, i.categorie_id::text AS categorie_id, i.compte AS imputation_compte,
            i.activite_id::text AS activite_id, i.compte_tiers, i.impute_le, ui.username AS impute_par_nom, c.libelle AS categorie, c.type_achat
       FROM com_factures_fournisseurs cf JOIN registre_tiers t ON t.id = cf.fournisseur_id
       LEFT JOIN users uv ON uv.id = cf.valide_par LEFT JOIN com_factures_fournisseurs o ON o.id = cf.facture_origine_id
       LEFT JOIN fin_imputations_externes i ON i.com_ff_id = cf.id LEFT JOIN users ui ON ui.id = i.impute_par
       LEFT JOIN fin_categories c ON c.id = i.categorie_id
      WHERE cf.id = :fid AND cf.tenant_id = :tenantId AND cf.statut IN ('valide', 'annule')`, { fid, tenantId });
  if (!f) throw new ErreurAchat(404, 'Facture introuvable (seules les factures validées de NJ COMMERCIAL apparaissent ici).');
  const lignes = await lignesCommercial(f.id);
  const [{ reste }] = await Q('SELECT fin_facture_reste(\'com_ff\', :fid) AS reste', { fid });
  return { origine: 'com_ff', facture: { ...f, statut_libelle: STATUTS[f.statut] }, lignes,
    avoirs: await Q(`SELECT id::text AS id, numero, reference_fournisseur AS reference, date_facture::text AS date_facture, total_ttc, statut
                       FROM com_factures_fournisseurs WHERE facture_origine_id = :fid AND statut IN ('valide', 'annule') ORDER BY id`, { fid }),
    reglements: f.type === 'facture' ? await affectationsDe(tenantId, 'com_ff', fid) : [],
    hors_caisse: f.type === 'facture' ? await horsCaisseDe(tenantId, 'com_ff', fid) : [],
    sens,
    reste: f.statut === 'validee' && f.type === 'facture' && f.imputation_id ? mt(Math.max(cts(reste), 0)) : null,
    ecritures: await ecritureDe(tenantId, 'com_ff', fid) };
};

const lignesCommercial = (fid, transaction) => Q(
  `SELECT l.id::text AS id, l.ordre, l.article_id::text AS article_id, l.designation, l.unite, l.quantite, l.prix_unitaire, l.remise_pct,
          l.taxe_id::text AS taxe_id, l.taxe_code, l.taxe_taux, l.montant_ht, l.montant_taxe,
          coalesce(nullif(p.compte_charge, ''), nullif(fa.compte_charge, ''), '') AS compte_article
     FROM com_facture_fourn_lignes l
     LEFT JOIN fin_prestations p ON p.com_article_id = l.article_id AND p.tenant_id = l.tenant_id
     LEFT JOIN fin_familles fa ON fa.id = p.famille_id
    WHERE l.facture_id = :fid ORDER BY l.ordre, l.id`, { fid }, { transaction });

// ── Saisie d'une facture (brouillon) ────────────────────────────────────────
const lireSaisie = async (tenantId, b, transaction, sens = 'fournisseur') => {
  const P = SENS[sens];
  const type = b.type === 'avoir' ? 'avoir' : (b.type === 'proforma' && sens === 'client' ? 'proforma' : 'facture');
  const tiersId = id(b.tiers_id, sens === 'client' ? 'Client' : 'Fournisseur');
  const [tiers] = await Q(
    `SELECT t.id, t.nom, t.type, t.compte_tiers, t.actif, coalesce(f.delai_paiement_jours, 30) AS delai
       FROM registre_tiers t LEFT JOIN fin_tiers f ON f.tiers_id = t.id WHERE t.id = :tiersId AND t.tenant_id = :tenantId`,
    { tiersId, tenantId }, { transaction });
  if (!tiers) throw new ErreurAchat(400, `${sens === 'client' ? 'Client' : 'Fournisseur'} introuvable.`);
  if (!P.typesTiers.includes(tiers.type)) throw new ErreurAchat(400, `${tiers.nom} n'est pas enregistré comme ${P.nomTiers}.`);
  const reference = sens === 'client' ? texte(b.reference, 60, 'Référence du client (bon de commande)')
    : texte(b.reference, 60, 'Référence de la facture du fournisseur', { obligatoire: true });
  const dateFacture = date(b.date_facture, 'Date', { obligatoire: true });
  // Échéance : délai de paiement du tiers ; validité d'une proforma : 30 jours par défaut.
  const echeance = date(b.date_echeance, type === 'proforma' ? 'Date de validité' : 'Échéance')
    || (type === 'facture' ? ajouterJours(dateFacture, Number(tiers.delai)) : type === 'proforma' ? ajouterJours(dateFacture, 30) : null);
  if (echeance && echeance < dateFacture) throw new ErreurAchat(400, 'L\'échéance précède la date du document.');
  const categorieId = id(b.categorie_id, 'Catégorie');
  const [cat] = await Q(`SELECT id, libelle, type_achat, compte_defaut FROM fin_categories
                          WHERE id = :categorieId AND tenant_id = :tenantId AND sens = :sensCat`, { categorieId, tenantId, sensCat: P.categorie }, { transaction });
  if (!cat) throw new ErreurAchat(400, `Catégorie de ${sens === 'client' ? 'produits' : 'charges'} introuvable.`);
  const ong = await estOng(tenantId, transaction);
  const activiteId = id(b.activite_id, 'Activité', { obligatoire: false });
  if (activiteId && !ong) throw new ErreurAchat(400, 'Les activités et projets sont réservés aux ONG et associations.');
  let origineId = null;
  if (type === 'avoir') {
    origineId = id(b.facture_origine_id, 'Facture d\'origine de l\'avoir');
    const [o] = await Q(`SELECT id, tiers_id, statut, type FROM fin_factures WHERE id = :origineId AND tenant_id = :tenantId AND sens = :sens`,
      { origineId, tenantId, sens }, { transaction });
    if (!o || o.type !== 'facture') throw new ErreurAchat(400, 'Facture d\'origine introuvable.');
    if (String(o.tiers_id) !== String(tiersId)) throw new ErreurAchat(400, `L'avoir doit concerner le ${P.nomTiers} de la facture d'origine.`);
    if (o.statut !== 'validee') throw new ErreurAchat(400, 'Un avoir se rattache à une facture validée.');
  }
  if (!Array.isArray(b.lignes) || !b.lignes.length) throw new ErreurAchat(400, 'Ajoutez au moins une ligne.');
  if (b.lignes.length > 200) throw new ErreurAchat(400, '200 lignes au plus.');
  const prestations = new Map((await Q(
    `SELECT p.id, p.taxe_id, coalesce(nullif(p.${P.colCompte}, ''), nullif(f.${P.colCompte}, ''), '') AS compte
       FROM fin_prestations p LEFT JOIN fin_familles f ON f.id = p.famille_id WHERE p.tenant_id = :tenantId`, { tenantId }, { transaction }))
    .map((p) => [String(p.id), p]));
  const taxes = new Map((await Q('SELECT id, code, taux FROM com_taxes WHERE tenant_id = :tenantId', { tenantId }, { transaction }))
    .map((t) => [String(t.id), t]));
  const lignes = [];
  let n = 0;
  for (const l of b.lignes) {
    n += 1;
    const quoi = `Ligne ${n}`;
    const prestationId = id(l.prestation_id, `${quoi} : prestation`, { obligatoire: false });
    const p = prestationId ? prestations.get(String(prestationId)) : null;
    if (prestationId && !p) throw new ErreurAchat(400, `${quoi} : prestation introuvable.`);
    const taxeId = id(l.taxe_id, `${quoi} : taxe`, { obligatoire: false });
    const tx = taxeId ? taxes.get(String(taxeId)) : null;
    if (taxeId && !tx) throw new ErreurAchat(400, `${quoi} : taxe introuvable.`);
    const ligne = {
      prestation_id: prestationId,
      designation: texte(l.designation, 300, `${quoi} : désignation`, { obligatoire: true }),
      quantite: nombre(l.quantite, `${quoi} : quantité`, { min: 0.001, decimales: 3 }),
      prix_unitaire: nombre(l.prix_unitaire, `${quoi} : prix unitaire HT`, { min: 0 }),
      remise_pct: l.remise_pct === undefined || l.remise_pct === '' ? 0 : nombre(l.remise_pct, `${quoi} : remise`, { min: 0, max: 100 }),
      taxe_id: taxeId, taxe_taux: tx ? Number(tx.taux) : 0,
      activite_id: activiteId,
    };
    ligne.compte = await verifierCompte(tenantId, String(l.compte || '').trim() || p?.compte || cat.compte_defaut, cat.type_achat, quoi, transaction, sens);
    const m = calculLigne(ligne);
    ligne.ht = m.ht; ligne.taxe = m.taxe;
    lignes.push(ligne);
  }
  const ht = lignes.reduce((t, l) => t + l.ht, 0);
  const tva = lignes.reduce((t, l) => t + l.taxe, 0);
  if (ht + tva <= 0) throw new ErreurAchat(400, 'Le montant du document est nul.');
  return {
    sens, type, tiers, tiersId, reference, dateFacture, echeance, cat, activiteId, origineId, lignes,
    objet: texte(b.objet, 300, 'Objet'), observations: texte(b.observations, 2000, 'Observations'),
    conditions: texte(b.conditions_paiement, 300, 'Conditions de paiement'),
    ht, tva, ttc: ht + tva,
  };
};

// Une même pièce du fournisseur n'entre qu'une fois, dans NJ FINANCE comme dans NJ COMMERCIAL.
const verifierDoublon = async (tenantId, s, saufId, transaction) => {
  if (s.sens === 'client') return;   // la référence d'un client est libre
  const [f] = await Q(
    `SELECT id, numero, statut FROM fin_factures
      WHERE tenant_id = :tenantId AND sens = 'fournisseur' AND tiers_id = :tiersId AND type = :type AND statut <> 'annulee'
        AND upper(btrim(reference)) = upper(btrim(:reference)) AND (CAST(:sauf AS BIGINT) IS NULL OR id <> CAST(:sauf AS BIGINT))`,
    { tenantId, tiersId: s.tiersId, type: s.type, reference: s.reference, sauf: saufId }, { transaction });
  if (f) {
    throw new ErreurAchat(409, `La pièce « ${s.reference} » de ${s.tiers.nom} est déjà enregistrée dans NJ FINANCE${f.numero ? ` (${f.numero})` : ' (brouillon)'}.`,
      { doublon: { origine: 'fin', id: String(f.id) } });
  }
  const [c] = await Q(
    `SELECT id, numero FROM com_factures_fournisseurs
      WHERE tenant_id = :tenantId AND fournisseur_id = :tiersId AND type = :type AND statut <> 'annule'
        AND upper(btrim(reference_fournisseur)) = upper(btrim(:reference))`,
    { tenantId, tiersId: s.tiersId, type: s.type, reference: s.reference }, { transaction });
  if (c) {
    throw new ErreurAchat(409, `La pièce « ${s.reference} » de ${s.tiers.nom} est déjà enregistrée dans NJ COMMERCIAL (${c.numero}) : imputez-la depuis la liste des achats au lieu de la ressaisir.`,
      { doublon: { origine: 'com_ff', id: String(c.id) } });
  }
};

const ecrireLignes = async (transaction, tenantId, fid, lignes) => {
  await X('DELETE FROM fin_facture_lignes WHERE facture_id = :fid', { fid }, { transaction });
  let ordre = 0;
  for (const l of lignes) {
    ordre += 1;
    await X(`INSERT INTO fin_facture_lignes (facture_id, tenant_id, ordre, prestation_id, designation, quantite, prix_unitaire, remise_pct,
                                             taxe_id, taxe_taux, compte, activite_id, montant_ht, montant_taxe)
             VALUES (:fid, :tenantId, :ordre, :prestation_id, :designation, :quantite, :prix_unitaire, :remise_pct,
                     :taxe_id, :taxe_taux, :compte, :activite_id, :ht, :taxe)`,
    { fid, tenantId, ordre, ...l, ht: mt(l.ht), taxe: mt(l.taxe) }, { transaction });
  }
};

const creer = ({ tenantId, userId, body, sens = 'fournisseur' }) => enTransaction(async (transaction) => {
  const s = await lireSaisie(tenantId, body, transaction, sensDe(sens));
  await verifierDoublon(tenantId, s, null, transaction);
  const [[f]] = await X(
    `INSERT INTO fin_factures (tenant_id, sens, type, tiers_id, reference, date_facture, date_echeance, facture_origine_id, categorie_id,
                               activite_id, objet, observations, conditions_paiement, total_ht, total_taxes, total_ttc, cree_par)
     VALUES (:tenantId, :sens, :type, :tiersId, :reference, :dateFacture, :echeance, :origineId, :categorieId,
             :activiteId, :objet, :observations, :conditions, :ht, :tva, :ttc, :userId) RETURNING id`,
    { tenantId, sens: s.sens, conditions: s.conditions, type: s.type, tiersId: s.tiersId, reference: s.reference, dateFacture: s.dateFacture, echeance: s.echeance,
      origineId: s.origineId, categorieId: s.cat.id, activiteId: s.activiteId, objet: s.objet, observations: s.observations,
      ht: mt(s.ht), tva: mt(s.tva), ttc: mt(s.ttc), userId }, { transaction });
  await ecrireLignes(transaction, tenantId, f.id, s.lignes);
  // Lot F7 : facture saisie à partir d'une pièce lue (et vérifiée par la personne qui l'enregistre).
  if (body.extraction_id) {
    if (s.sens !== 'fournisseur') throw new ErreurAchat(400, 'La lecture automatique concerne les factures fournisseurs.');
    await extractions.rattacher(transaction, tenantId, body.extraction_id, f.id);
  }
  if (body.soumettre) await X(`UPDATE fin_factures SET statut = 'a_valider', soumis_par = :userId, soumis_le = NOW() WHERE id = :fid`,
    { userId, fid: f.id }, { transaction });
  return { id: String(f.id) };
});

const verrouiller = async (tenantId, fid, transaction, sens = 'fournisseur') => {
  const [f] = await Q(`SELECT * FROM fin_factures WHERE id = :fid AND tenant_id = :tenantId AND sens = :sens FOR UPDATE`,
    { fid, tenantId, sens: sensDe(sens) }, { transaction });
  if (!f) throw new ErreurAchat(404, 'Facture introuvable.');
  return f;
};

const modifier = ({ tenantId, userId, id: idBrut, body, sens = 'fournisseur' }) => enTransaction(async (transaction) => {
  const fid = id(idBrut, 'Facture');
  const f = await verrouiller(tenantId, fid, transaction, sens);
  if (!['brouillon', 'a_valider'].includes(f.statut)) throw new ErreurAchat(409, 'Une facture validée ou annulée ne se modifie plus.');
  // Modifier une facture soumise la ramène au brouillon (le validateur doit revoir la nouvelle version).
  if (f.statut === 'a_valider') await X(`UPDATE fin_factures SET statut = 'brouillon' WHERE id = :fid`, { fid }, { transaction });
  const s = await lireSaisie(tenantId, { ...body, type: f.type, facture_origine_id: body.facture_origine_id ?? f.facture_origine_id }, transaction, sensDe(sens));
  await verifierDoublon(tenantId, s, fid, transaction);
  await X(`UPDATE fin_factures SET tiers_id = :tiersId, reference = :reference, date_facture = :dateFacture, date_echeance = :echeance,
                                   facture_origine_id = :origineId, categorie_id = :categorieId, activite_id = :activiteId, objet = :objet,
                                   observations = :observations, conditions_paiement = :conditions, total_ht = :ht, total_taxes = :tva,
                                   total_ttc = :ttc, motif_renvoi = ''
            WHERE id = :fid`,
  { conditions: s.conditions, fid, tiersId: s.tiersId, reference: s.reference, dateFacture: s.dateFacture, echeance: s.echeance, origineId: s.origineId,
    categorieId: s.cat.id, activiteId: s.activiteId, objet: s.objet, observations: s.observations,
    ht: mt(s.ht), tva: mt(s.tva), ttc: mt(s.ttc) }, { transaction });
  await ecrireLignes(transaction, tenantId, fid, s.lignes);
  if (body.soumettre) await X(`UPDATE fin_factures SET statut = 'a_valider', soumis_par = :userId, soumis_le = NOW() WHERE id = :fid`,
    { userId, fid }, { transaction });
  return { id: String(fid) };
});

const supprimer = ({ tenantId, id: idBrut, sens = 'fournisseur' }) => enTransaction(async (transaction) => {
  const fid = id(idBrut, 'Facture');
  const f = await verrouiller(tenantId, fid, transaction, sens);
  if (!['brouillon', 'a_valider'].includes(f.statut)) throw new ErreurAchat(409, 'Une facture validée ne se supprime pas : annulez-la avec un motif.');
  await extractions.liberer(transaction, fid);      // la pièce lue redevient « à vérifier »
  await X('DELETE FROM fin_factures WHERE id = :fid', { fid }, { transaction });
  return { supprimee: true };
});

const soumettre = ({ tenantId, userId, id: idBrut, sens = 'fournisseur' }) => enTransaction(async (transaction) => {
  const fid = id(idBrut, 'Facture');
  const f = await verrouiller(tenantId, fid, transaction, sens);
  if (f.statut !== 'brouillon') throw new ErreurAchat(409, 'Seul un brouillon se soumet à la validation.');
  if (f.type === 'proforma') throw new ErreurAchat(409, 'Une proforma ne se soumet pas : émettez-la.');
  await X(`UPDATE fin_factures SET statut = 'a_valider', soumis_par = :userId, soumis_le = NOW(), motif_renvoi = '' WHERE id = :fid`,
    { userId, fid }, { transaction });
  return { statut: 'a_valider' };
});

const renvoyer = ({ tenantId, id: idBrut, body, sens = 'fournisseur' }) => enTransaction(async (transaction) => {
  const fid = id(idBrut, 'Facture');
  const motif = texte(body?.motif, 500, 'Motif du renvoi', { obligatoire: true });
  const f = await verrouiller(tenantId, fid, transaction, sens);
  if (f.statut !== 'a_valider') throw new ErreurAchat(409, 'Seule une facture à valider se renvoie au brouillon.');
  await X(`UPDATE fin_factures SET statut = 'brouillon', motif_renvoi = :motif WHERE id = :fid`, { motif, fid }, { transaction });
  return { statut: 'brouillon' };
});

// ── Écriture d'achat ────────────────────────────────────────────────────────
const journalDe = async (tenantId, type, code, libelle, transaction) => {
  const [j] = await Q(`SELECT id, code FROM fin_journaux WHERE tenant_id = :tenantId AND type = :type AND actif
                        ORDER BY (code = :code) DESC, id LIMIT 1`, { tenantId, type, code }, { transaction });
  if (!j) throw new ErreurAchat(400, `Aucun journal comptable ${libelle} actif : créez-le dans NJ COMPTABILITÉ (Exercices et journaux).`);
  return j;
};
const journalAchats = (tenantId, transaction) => journalDe(tenantId, 'achats', 'AC', 'd\'achats', transaction);

// Prépare exercice et journaux avant la transaction du document (un client sans
// NJ COMPTABILITÉ n'a personne pour les créer).
const preparerComptabilite = async (tenantId, userId, dateIso) => {
  try {
    await generation.assurerExercices(tenantId, userId, dateIso);
    await socle.initialiserJournaux({ tenantId, userId });
  } catch (err) { throw traduire(err); }
};

// Lignes : { compte, debit, credit (centimes), tiers_id, activite_id, libelle } ; regroupées par compte / tiers / activité / sens.
const regrouper = (lignes) => {
  const m = new Map();
  for (const l of lignes) {
    if (!l.debit && !l.credit) continue;
    const k = [l.compte, l.tiers_id || '', l.activite_id || '', l.debit ? 'D' : 'C'].join('|');
    const x = m.get(k) || { ...l, debit: 0, credit: 0 };
    x.debit += l.debit; x.credit += l.credit; m.set(k, x);
  }
  return [...m.values()];
};

const ecrireEcriture = async (transaction, { tenantId, origineType, origineId, journalId, dateIso, reference, libelle, lignes, validePar, creePar }) => {
  const groupees = regrouper(lignes);
  const empreinte = crypto.createHash('sha256').update(JSON.stringify(groupees.map((l) => [l.compte, l.debit, l.credit, l.tiers_id, l.activite_id])))
    .digest('hex').slice(0, 32);
  const [[e]] = await X(
    `INSERT INTO fin_ecritures (tenant_id, exercice_id, periode_id, journal_id, date_ecriture, reference_piece, libelle,
                                origine_type, origine_id, origine_empreinte, cree_par)
     VALUES (:tenantId, 0, 0, :journalId, :dateIso, :reference, :libelle, :origineType, :origineId, :empreinte, :creePar) RETURNING id`,
    { tenantId, journalId, dateIso, reference: reference.slice(0, 60), libelle: libelle.slice(0, 300), origineType, origineId,
      empreinte, creePar: creePar || null }, { transaction });
  let n = 0;
  for (const l of groupees) {
    n += 1;
    await X(`INSERT INTO fin_ecriture_lignes (tenant_id, ecriture_id, ordre, compte, tiers_id, activite_id, libelle, debit, credit, echeance)
             VALUES (:tenantId, :e, :n, :compte, :tiers, :activite, :libelle, :debit, :credit, :echeance)`,
    { tenantId, e: e.id, n, compte: l.compte, tiers: l.tiers_id || null, activite: l.activite_id || null, libelle: (l.libelle || libelle).slice(0, 300),
      debit: mt(l.debit), credit: mt(l.credit), echeance: l.echeance || null }, { transaction });
  }
  await X(`UPDATE fin_ecritures SET statut = 'validee', valide_par = :validePar WHERE id = :e`, { validePar, e: e.id }, { transaction });
  return String(e.id);
};

// Extourne de l'écriture active d'une origine (même date que l'origine).
const extournerOrigine = async (transaction, tenantId, origineType, origineId, userId, motif) => {
  const [e] = await Q(`SELECT * FROM fin_ecritures WHERE tenant_id = :tenantId AND origine_type = :origineType AND origine_id = :origineId
                         AND extournee_par_id IS NULL FOR UPDATE`, { tenantId, origineType, origineId }, { transaction });
  if (!e) return null;
  if (e.statut === 'brouillard') { await X('DELETE FROM fin_ecritures WHERE id = :id', { id: e.id }, { transaction }); return null; }
  // Sans auteur connu (annulation venue de NJ COMMERCIAL), le validateur de l'écriture d'origine valide l'extourne.
  const validePar = userId || e.valide_par;
  const lignes = await Q('SELECT compte, tiers_id, activite_id, libelle, debit, credit FROM fin_ecriture_lignes WHERE ecriture_id = :id ORDER BY ordre, id',
    { id: e.id }, { transaction });
  const [[x]] = await X(
    `INSERT INTO fin_ecritures (tenant_id, exercice_id, periode_id, journal_id, date_ecriture, reference_piece, libelle,
                                origine_type, origine_id, extourne_de_id, motif_extourne, cree_par)
     VALUES (:tenantId, 0, 0, :journal, :date, :ref, :libelle, 'extourne', :id, :id, :motif, :userId) RETURNING id`,
    { tenantId, journal: e.journal_id, date: String(e.date_ecriture instanceof Date ? e.date_ecriture.toISOString() : e.date_ecriture).slice(0, 10),
      ref: e.reference_piece, libelle: `Extourne — ${e.libelle}`.slice(0, 300), id: e.id, motif: motif.slice(0, 500), userId: userId || null }, { transaction });
  let n = 0;
  for (const l of lignes) {
    n += 1;
    await X(`INSERT INTO fin_ecriture_lignes (tenant_id, ecriture_id, ordre, compte, tiers_id, activite_id, libelle, debit, credit)
             VALUES (:tenantId, :x, :n, :compte, :tiers_id, :activite_id, :libelle, :debit, :credit)`,
    { tenantId, x: x.id, n, ...l, debit: l.credit, credit: l.debit }, { transaction });
  }
  await X(`UPDATE fin_ecritures SET statut = 'validee', valide_par = :validePar WHERE id = :x`, { validePar, x: x.id }, { transaction });
  await X('UPDATE fin_ecritures SET extournee_par_id = :x WHERE id = :id', { x: x.id, id: e.id }, { transaction });
  return String(x.id);
};

// Lignes de taxe : compte déductible (sur immobilisations pour une catégorie
// d'immobilisation) pour un achat ; compte de taxe collectée pour une vente.
const comptesTaxes = async (tenantId, transaction) => new Map((await Q(
  `SELECT t.id, t.code, coalesce(x.compte_deductible, '') AS deductible, coalesce(x.compte_deductible_immo, '') AS immo,
          coalesce(x.compte_collecte, '') AS collecte
     FROM com_taxes t LEFT JOIN fin_taxes_comptes x ON x.taxe_id = t.id WHERE t.tenant_id = :tenantId`, { tenantId }, { transaction }))
  .map((t) => [String(t.id), t]));
const compteTaxe = (taxes, taxeId, typeAchat, sens = 'fournisseur') => {
  const t = taxes.get(String(taxeId));
  const c = sens === 'client' ? t?.collecte : typeAchat === 'immobilisation' ? (t?.immo || t?.deductible) : t?.deductible;
  if (!c) {
    throw new ErreurAchat(400, `Le compte de taxe ${sens === 'client' ? 'collectée' : 'déductible'} de ${t?.code || 'la taxe'} n'est pas paramétré : NJ FINANCE → Configuration → Facturation → Taxes.`);
  }
  return c;
};

// Lignes d'écriture d'une facture : achat = D charges, D taxe / C tiers ; vente = l'inverse
// (D tiers / C produits, C taxe). Un avoir inverse encore.
const lignesEcriture = async (transaction, tenantId, { type, typeAchat, compteTiers, tiersId, activiteId, echeance, libelle, lignes, sens = 'fournisseur' }) => {
  const taxes = await comptesTaxes(tenantId, transaction);
  const out = [];
  let ttc = 0;
  for (const l of lignes) {
    out.push({ compte: l.compte, debit: l.ht, credit: 0, tiers_id: null, activite_id: l.activite_id || activiteId || null, libelle });
    if (l.taxe > 0) out.push({ compte: compteTaxe(taxes, l.taxe_id, typeAchat, sens), debit: l.taxe, credit: 0, tiers_id: null, activite_id: null, libelle });
    ttc += l.ht + l.taxe;
  }
  out.push({ compte: compteTiers, debit: 0, credit: ttc, tiers_id: String(tiersId), activite_id: null, libelle, echeance });
  if ((type === 'avoir') !== (sens === 'client')) for (const l of out) [l.debit, l.credit] = [l.credit, l.debit];
  if (sens === 'client') {   // la ligne du client en tête
    const i = out.findIndex((l) => l.tiers_id);
    out.unshift(...out.splice(i, 1));
  }
  for (const l of out) {
    const [{ a }] = await Q('SELECT fin_compte_anomalie(:tenantId, :c) AS a', { tenantId, c: l.compte }, { transaction });
    if (a) throw new ErreurAchat(400, `Écriture impossible : ${a}.`);
  }
  return out;
};

// Identité de l'émetteur figée sur les documents clients (logo, NIU, RCCM…), comme NJ COMMERCIAL.
const identiteFigee = async (tenantId) => JSON.stringify(await require('../entreprise.service').identiteDocuments(tenantId));

const valider = async ({ tenantId, userId, id: idBrut, sens: sensBrut = 'fournisseur' }) => {
  const sens = sensDe(sensBrut);
  const P = SENS[sens];
  const fid = id(idBrut, 'Facture');
  const [apercu] = await Q('SELECT date_facture::text AS d, type FROM fin_factures WHERE id = :fid AND tenant_id = :tenantId AND sens = :sens', { fid, tenantId, sens });
  if (!apercu) throw new ErreurAchat(404, 'Facture introuvable.');
  if (apercu.type === 'proforma') throw new ErreurAchat(409, 'Une proforma ne se valide pas : émettez-la, puis transformez-la en facture.');
  await preparerComptabilite(tenantId, userId, apercu.d);
  const identite = sens === 'client' ? await identiteFigee(tenantId) : null;
  return enTransaction(async (transaction) => {
    const f = await verrouiller(tenantId, fid, transaction, sens);
    if (!['brouillon', 'a_valider'].includes(f.statut)) throw new ErreurAchat(409, 'Cette facture est déjà validée ou annulée.');
    if (f.cree_par && f.cree_par === userId) {
      throw new ErreurAchat(403, `Vous avez ${sens === 'client' ? 'établi' : 'saisi'} cette facture : une autre personne habilitée doit la valider.`);
    }
    const [cat] = await Q('SELECT type_achat FROM fin_categories WHERE id = :c', { c: f.categorie_id }, { transaction });
    const [tiers] = await Q('SELECT id, nom, compte_tiers FROM registre_tiers WHERE id = :t', { t: f.tiers_id }, { transaction });
    const lignes = (await Q('SELECT * FROM fin_facture_lignes WHERE facture_id = :fid ORDER BY ordre, id', { fid }, { transaction }))
      .map((l) => ({ compte: l.compte, ht: cts(l.montant_ht), taxe: cts(l.montant_taxe), taxe_id: l.taxe_id, activite_id: l.activite_id }));
    if (!lignes.length) throw new ErreurAchat(400, 'La facture n\'a pas de ligne.');
    const ttc = lignes.reduce((t, l) => t + l.ht + l.taxe, 0);
    if (ttc !== cts(f.total_ttc)) throw new ErreurAchat(409, 'Total incohérent avec les lignes : rouvrez la facture et enregistrez-la à nouveau.');
    const dateIso = String(f.date_facture instanceof Date ? f.date_facture.toISOString() : f.date_facture).slice(0, 10);
    if (f.type === 'avoir') {
      const [o] = await Q('SELECT total_ttc, statut, compte_tiers FROM fin_factures WHERE id = :o FOR UPDATE', { o: f.facture_origine_id }, { transaction });
      if (o.statut !== 'validee') throw new ErreurAchat(409, 'La facture d\'origine n\'est plus validée.');
      const [{ av }] = await Q(`SELECT coalesce(sum(total_ttc), 0) AS av FROM fin_factures WHERE facture_origine_id = :o AND statut = 'validee'`,
        { o: f.facture_origine_id }, { transaction });
      if (ttc > cts(o.total_ttc) - cts(av)) {
        throw new ErreurAchat(400, `L'avoir (${mt(ttc)}) dépasse ce qui reste de la facture d'origine après avoirs (${mt(cts(o.total_ttc) - cts(av))}).`);
      }
    }
    const compteTiers = f.type === 'avoir'
      ? (await Q('SELECT compte_tiers FROM fin_factures WHERE id = :o', { o: f.facture_origine_id }, { transaction }))[0].compte_tiers
      : await compteFournisseur(tenantId, tiers, cat.type_achat, transaction, sens);
    const numero = await config.prochainNumero(transaction, tenantId, P.docs[f.type], dateIso);
    const libelle = sens === 'client' ? `${f.type === 'avoir' ? 'Avoir' : 'Facture'} ${numero} — ${tiers.nom}`
      : `${f.type === 'avoir' ? 'Avoir' : 'Facture'} ${tiers.nom} n° ${f.reference}`;
    const journal = await journalDe(tenantId, P.journal, P.journalCode, P.libelleJournal, transaction);
    const lEcr = await lignesEcriture(transaction, tenantId, { type: f.type, typeAchat: cat.type_achat, compteTiers, tiersId: f.tiers_id,
      activiteId: f.activite_id, echeance: f.date_echeance, libelle, lignes, sens });
    await X(`UPDATE fin_factures SET statut = 'validee', numero = :numero, compte_tiers = :compteTiers, valide_par = :userId, valide_le = NOW(),
                                     identite_emetteur = CAST(:identite AS jsonb)
              WHERE id = :fid`, { numero, compteTiers, userId, fid, identite }, { transaction });
    const ecritureId = await ecrireEcriture(transaction, { tenantId, origineType: 'fin_facture', origineId: fid, journalId: journal.id,
      dateIso, reference: numero, libelle, lignes: lEcr, validePar: userId, creePar: f.cree_par });
    return { statut: 'validee', numero, ecriture_id: ecritureId };
  });
};

const annuler = async (o) => {
  const r = await annulerSansSync(o);
  // Les règlements portés par des sorties déjà annulées en caisse sont retirés avec la facture :
  // les écritures de ces mouvements (et de leurs contre-passations) sont refaites ensemble.
  if (r.reglements_retires) await generation.synchroniser({ tenantId: o.tenantId, userId: o.userId, force: true });
  return { statut: r.statut, extourne_id: r.extourne_id };
};
const annulerSansSync = ({ tenantId, userId, id: idBrut, body, sens = 'fournisseur' }) => enTransaction(async (transaction) => {
  const fid = id(idBrut, 'Facture');
  const motif = texte(body?.motif, 500, 'Motif de l\'annulation', { obligatoire: true });
  const f = await verrouiller(tenantId, fid, transaction, sens);
  if (f.statut !== 'validee') throw new ErreurAchat(409, 'Seul un document validé ou émis s\'annule (un brouillon se supprime).');
  const [{ hc }] = await Q(`SELECT count(*)::int AS hc FROM fin_reglements_hors_caisse WHERE facture_type = 'fin' AND facture_id = :fid AND statut = 'valide'`,
    { fid }, { transaction });
  if (hc) throw new ErreurAchat(409, 'Cette facture a un règlement hors caisse validé : le directeur doit d\'abord l\'annuler.');
  await X(`DELETE FROM fin_reglements_hors_caisse WHERE facture_type = 'fin' AND facture_id = :fid AND statut = 'propose'`, { fid }, { transaction });
  const [{ n }] = await Q(`SELECT count(*)::int AS n FROM fin_reglement_affectations a JOIN journal j ON j.id = a.mouvement_id
                            WHERE a.facture_type = 'fin' AND a.facture_id = :fid AND j.annule_par_id IS NULL`, { fid }, { transaction });
  if (n) throw new ErreurAchat(409, 'Cette facture a des règlements : retirez-les d\'abord (ou passez un avoir).');
  const [{ av }] = await Q(`SELECT count(*)::int AS av FROM fin_factures WHERE facture_origine_id = :fid AND statut = 'validee'`, { fid }, { transaction });
  if (av) throw new ErreurAchat(409, 'Cette facture a des avoirs validés : annulez-les d\'abord.');
  await X(`UPDATE fin_factures SET statut = 'annulee', annule_par = :userId, annule_le = NOW(), motif_annulation = :motif WHERE id = :fid`,
    { userId, motif, fid }, { transaction });
  const [, meta] = await X(`DELETE FROM fin_reglement_affectations WHERE facture_type = 'fin' AND facture_id = :fid`, { fid }, { transaction });
  const extourne = await extournerOrigine(transaction, tenantId, 'fin_facture', fid, userId, `Facture ${f.numero} annulée : ${motif}`);
  return { statut: 'annulee', extourne_id: extourne, reglements_retires: Boolean(meta?.rowCount) };
});

// ── Factures de NJ COMMERCIAL : imputation ──────────────────────────────────
const imputer = async ({ tenantId, userId, id: idBrut, body }) => {
  const fid = id(idBrut, 'Facture');
  const [cf0] = await Q('SELECT date_facture::text AS d FROM com_factures_fournisseurs WHERE id = :fid AND tenant_id = :tenantId', { fid, tenantId });
  if (!cf0) throw new ErreurAchat(404, 'Facture introuvable.');
  await preparerComptabilite(tenantId, userId, cf0.d);
  const r = await enTransaction(async (transaction) => {
    const [cf] = await Q(`SELECT * FROM com_factures_fournisseurs WHERE id = :fid AND tenant_id = :tenantId FOR UPDATE`, { fid, tenantId }, { transaction });
    if (cf.statut !== 'valide') throw new ErreurAchat(409, 'Seule une facture validée dans NJ COMMERCIAL s\'impute.');
    const categorieId = id(body?.categorie_id, 'Catégorie');
    const [cat] = await Q(`SELECT id, type_achat, compte_defaut FROM fin_categories WHERE id = :categorieId AND tenant_id = :tenantId AND sens = 'charge'`,
      { categorieId, tenantId }, { transaction });
    if (!cat) throw new ErreurAchat(400, 'Catégorie de charge introuvable.');
    const activiteId = id(body?.activite_id, 'Activité', { obligatoire: false });
    if (activiteId && !(await estOng(tenantId, transaction))) throw new ErreurAchat(400, 'Les activités et projets sont réservés aux ONG et associations.');
    const compteForce = String(body?.compte || '').trim();
    if (compteForce) await verifierCompte(tenantId, compteForce, cat.type_achat, 'Compte d\'imputation', transaction);
    const lignesC = await lignesCommercial(fid, transaction);
    const lignes = [];
    for (const l of lignesC) {
      const compte = await verifierCompte(tenantId, compteForce || l.compte_article || cat.compte_defaut, cat.type_achat,
        `Article « ${l.designation} »`, transaction);
      lignes.push({ compte, ht: cts(l.montant_ht), taxe: cts(l.montant_taxe), taxe_id: l.taxe_id, activite_id: activiteId });
    }
    const ttc = lignes.reduce((t, l) => t + l.ht + l.taxe, 0);
    if (!lignes.length || ttc !== cts(cf.total_ttc)) {
      throw new ErreurAchat(409, `Les lignes de la facture ${cf.numero} (${mt(ttc)}) ne correspondent pas à son total (${cf.total_ttc}) : corrigez-la dans NJ COMMERCIAL.`);
    }
    const [tiers] = await Q('SELECT id, nom, compte_tiers FROM registre_tiers WHERE id = :t', { t: cf.fournisseur_id }, { transaction });
    let compteTiers;
    if (cf.type === 'avoir') {
      const [oi] = await Q('SELECT compte_tiers FROM fin_imputations_externes WHERE com_ff_id = :o', { o: cf.facture_origine_id }, { transaction });
      compteTiers = oi?.compte_tiers || await compteFournisseur(tenantId, tiers, cat.type_achat, transaction);
    } else compteTiers = await compteFournisseur(tenantId, tiers, cat.type_achat, transaction);
    const [existante] = await Q('SELECT id FROM fin_imputations_externes WHERE com_ff_id = :fid FOR UPDATE', { fid }, { transaction });
    if (existante) {
      const [{ n }] = await Q(`SELECT count(*)::int AS n FROM fin_reglement_affectations WHERE facture_type = 'com_ff' AND facture_id = :fid`, { fid }, { transaction });
      if (n) throw new ErreurAchat(409, 'Cette facture a déjà des règlements : retirez-les avant de changer son imputation.');
      await extournerOrigine(transaction, tenantId, 'com_ff', fid, userId, `Imputation de la facture ${cf.numero} modifiée`);
      await X(`UPDATE fin_imputations_externes SET categorie_id = :c, compte = :compte, activite_id = :a, compte_tiers = :ct,
                                                   impute_par = :userId, impute_le = NOW() WHERE id = :id`,
      { c: cat.id, compte: compteForce, a: activiteId, ct: compteTiers, userId, id: existante.id }, { transaction });
    } else {
      await X(`INSERT INTO fin_imputations_externes (tenant_id, com_ff_id, categorie_id, compte, activite_id, compte_tiers, impute_par)
               VALUES (:tenantId, :fid, :c, :compte, :a, :ct, :userId)`,
      { tenantId, fid, c: cat.id, compte: compteForce, a: activiteId, ct: compteTiers, userId }, { transaction });
    }
    const libelle = `${cf.type === 'avoir' ? 'Avoir' : 'Facture'} ${tiers.nom} n° ${cf.reference_fournisseur} (NJ COMMERCIAL ${cf.numero})`;
    const journal = await journalAchats(tenantId, transaction);
    const lEcr = await lignesEcriture(transaction, tenantId, { type: cf.type, typeAchat: cat.type_achat, compteTiers, tiersId: cf.fournisseur_id,
      activiteId, echeance: cf.date_echeance, libelle, lignes });
    const dateIso = String(cf.date_facture instanceof Date ? cf.date_facture.toISOString() : cf.date_facture).slice(0, 10);
    const ecritureId = await ecrireEcriture(transaction, { tenantId, origineType: 'com_ff', origineId: fid, journalId: journal.id,
      dateIso, reference: cf.numero, libelle, lignes: lEcr, validePar: userId, creePar: userId });
    return { impute: true, ecriture_id: ecritureId, compte_tiers: compteTiers };
  });
  return r;
};

// Une facture de NJ COMMERCIAL annulée après imputation : son écriture est extournée
// et ses règlements retirés (les sorties de caisse redeviennent libres).
const synchroniserCommercial = async (tenantId) => {
  const annulees = await Q(
    `SELECT cf.id, cf.numero, cf.annule_par, coalesce(nullif(cf.motif_annulation, ''), 'annulée dans NJ COMMERCIAL') AS motif
       FROM com_factures_fournisseurs cf JOIN fin_ecritures e ON e.origine_type = 'com_ff' AND e.origine_id = cf.id AND e.extournee_par_id IS NULL
      WHERE cf.tenant_id = :tenantId AND cf.statut = 'annule'`, { tenantId });
  let traitees = 0;
  for (const a of annulees) {
    await enTransaction(async (transaction) => {
      await X(`DELETE FROM fin_reglement_affectations WHERE facture_type = 'com_ff' AND facture_id = :id`, { id: a.id }, { transaction });
      await extournerOrigine(transaction, tenantId, 'com_ff', a.id, a.annule_par || null, `Facture ${a.numero} annulée dans NJ COMMERCIAL : ${a.motif}`);
    });
    traitees += 1;
  }
  if (traitees) await generation.synchroniser({ tenantId, force: true });
  return traitees;
};

// ── Règlements (affectation de sorties de caisse) ───────────────────────────
const reglerParCaisse = async ({ tenantId, userId, body }) => {
  const mouvementId = id(body?.mouvement_id, 'Mouvement de caisse');
  if (!Array.isArray(body?.affectations) || !body.affectations.length) throw new ErreurAchat(400, 'Indiquez au moins une facture à régler.');
  const crees = await enTransaction(async (transaction) => {
    const out = [];
    for (const a of body.affectations) {
      const type = a.facture_type === 'com_ff' ? 'com_ff' : 'fin';
      const fid = id(a.facture_id, 'Facture');
      const montant = nombre(a.montant, 'Montant réglé', { min: 0.01 });
      const [[r]] = await X(
        `INSERT INTO fin_reglement_affectations (tenant_id, mouvement_id, facture_type, facture_id, montant, cree_par)
         VALUES (:tenantId, :mouvementId, :type, :fid, :montant, :userId) RETURNING id`,
        { tenantId, mouvementId, type, fid, montant: montant.toFixed(2), userId }, { transaction });
      out.push(String(r.id));
    }
    await X(`INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, nouvelle_valeur)
             VALUES (:tenantId, :userId, 'FINANCE_REGLEMENT_AFFECTE', 'journal', :m, CAST(:v AS jsonb))`,
    { tenantId, userId, m: String(mouvementId), v: JSON.stringify({ affectations: body.affectations }) }, { transaction });
    return out;
  });
  const sync = await generation.synchroniser({ tenantId, userId, force: true });
  return { affectations: crees, anomalies: (sync.anomalies || []).filter((x) => String(x.mouvement_id) === String(mouvementId)) };
};

const retirerReglement = async ({ tenantId, userId, id: idBrut }) => {
  const aid = id(idBrut, 'Règlement');
  await enTransaction(async (transaction) => {
    const [a] = await Q('SELECT * FROM fin_reglement_affectations WHERE id = :aid AND tenant_id = :tenantId FOR UPDATE', { aid, tenantId }, { transaction });
    if (!a) throw new ErreurAchat(404, 'Règlement introuvable.');
    await X('DELETE FROM fin_reglement_affectations WHERE id = :aid', { aid }, { transaction });
    await X(`INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, ancienne_valeur)
             VALUES (:tenantId, :userId, 'FINANCE_REGLEMENT_RETIRE', 'journal', :m, CAST(:v AS jsonb))`,
    { tenantId, userId, m: String(a.mouvement_id), v: JSON.stringify({ facture_type: a.facture_type, facture_id: String(a.facture_id), montant: a.montant }) },
    { transaction });
  });
  await generation.synchroniser({ tenantId, userId, force: true });
  return { retire: true };
};

// Mouvements de caisse et de banque encore libres (en tout ou partie) : sorties pour
// un fournisseur, entrées pour un client.
const sortiesDisponibles = async (tenantId, q = {}, sensBrut = 'fournisseur') => {
  const sens = sensDe(sensBrut);
  const col = sens === 'client' ? 'entree' : 'sortie';
  const autre = sens === 'client' ? 'sortie' : 'entree';
  const tiersId = id(q.tiers_id, 'Tiers', { obligatoire: false });
  const rows = await Q(
    `SELECT j.id::text AS id, j.date::text AS date, j.numero, jo.code AS caisse, jo.nom AS caisse_nom, j.intitule,
            coalesce(j.beneficiaire, '') AS beneficiaire, j.tiers_id::text AS tiers_id, j.${col} AS sortie, j.${col} AS montant,
            j.${col} - coalesce((SELECT sum(a.montant) FROM fin_reglement_affectations a WHERE a.mouvement_id = j.id), 0) AS disponible
       FROM journal j JOIN journaux jo ON jo.id = j.journal_id
       LEFT JOIN rubriques r ON r.tenant_id = j.tenant_id AND r.code = j.rubrique_code
      WHERE j.tenant_id = :tenantId AND coalesce(j.${col}, 0) > 0 AND coalesce(j.${autre}, 0) = 0
        AND j.annule_par_id IS NULL AND j.annulation_de_id IS NULL AND NOT coalesce(r.est_virement_interne, false)
        AND (CAST(:tiers AS BIGINT) IS NULL OR j.tiers_id IS NULL OR j.tiers_id = CAST(:tiers AS BIGINT))
        AND j.date >= CURRENT_DATE - INTERVAL '18 months'
      ORDER BY (j.tiers_id IS NOT NULL) DESC, j.date DESC, j.id DESC LIMIT 300`, { tenantId, tiers: tiersId });
  return rows.filter((r) => cts(r.disponible) > 0).slice(0, 100);
};

// Factures ouvertes (reste > 0) d'un sens, toutes origines.
const facturesOuvertes = async (tenantId, q = {}, sensBrut = 'fournisseur') => {
  const sens = sensDe(sensBrut);
  const tiersId = id(q.tiers_id, 'Tiers', { obligatoire: false });
  const jour = aujourdhui();
  return (await Q(`SELECT * FROM (${sqlListe(sens)}) x
                    WHERE x.reste > 0 AND x.impute AND (CAST(:tiers AS TEXT) IS NULL OR x.tiers_id = CAST(:tiers AS TEXT))
                    ORDER BY x.date_echeance NULLS LAST, x.date_facture`, { tenantId, sens, tiers: tiersId ? String(tiersId) : null }))
    .map((r) => enrichirListe({ ...r, sens }, jour));
};

// Échéancier : factures ouvertes par tranche d'échéance.
const TRANCHES = [
  ['echu_60', 'Échues depuis plus de 60 jours'], ['echu_30', 'Échues depuis 31 à 60 jours'], ['echu', 'Échues depuis 30 jours au plus'],
  ['30j', 'À échéance sous 30 jours'], ['plus', 'À échéance au-delà de 30 jours'], ['sans', 'Sans échéance'],
];
const echeancier = async (tenantId, sensBrut = 'fournisseur') => {
  const sens = sensDe(sensBrut);
  if (sens === 'fournisseur') await synchroniserCommercial(tenantId);
  const jour = aujourdhui();
  const ouvertes = await facturesOuvertes(tenantId, {}, sens);
  const tranche = (f) => {
    if (!f.date_echeance) return 'sans';
    const j = Math.round((Date.parse(f.date_echeance) - Date.parse(jour)) / 864e5);
    if (j < -60) return 'echu_60';
    if (j < -30) return 'echu_30';
    if (j < 0) return 'echu';
    return j <= 30 ? '30j' : 'plus';
  };
  const groupes = TRANCHES.map(([code, libelle]) => {
    const factures = ouvertes.filter((f) => tranche(f) === code);
    return { code, libelle, nombre: factures.length, total: mt(factures.reduce((t, f) => t + cts(f.reste), 0)), factures };
  });
  return { sens, au: jour, total: mt(ouvertes.reduce((t, f) => t + cts(f.reste), 0)), groupes };
};

// ── Proformas ───────────────────────────────────────────────────────────────
// Émettre : numéro PRO-AAAA-…, identité figée, PDF valable. Aucune écriture.
const emettreProforma = async ({ tenantId, userId, id: idBrut }) => {
  const fid = id(idBrut, 'Proforma');
  const identite = await identiteFigee(tenantId);
  return enTransaction(async (transaction) => {
    const f = await verrouiller(tenantId, fid, transaction, 'client');
    if (f.type !== 'proforma') throw new ErreurAchat(400, 'Ce document n\'est pas une proforma.');
    if (!['brouillon', 'a_valider'].includes(f.statut)) throw new ErreurAchat(409, 'Cette proforma est déjà émise.');
    const dateIso = String(f.date_facture instanceof Date ? f.date_facture.toISOString() : f.date_facture).slice(0, 10);
    const numero = await config.prochainNumero(transaction, tenantId, 'proforma', dateIso);
    await X(`UPDATE fin_factures SET statut = 'validee', numero = :numero, soumis_par = :userId, soumis_le = NOW(), valide_le = NOW(),
                                     identite_emetteur = CAST(:identite AS jsonb) WHERE id = :fid`,
    { numero, userId, fid, identite }, { transaction });
    return { statut: 'validee', numero };
  });
};

// Transformer : une facture brouillon reprend client, catégorie, objet, conditions et lignes.
const transformerProforma = ({ tenantId, userId, id: idBrut }) => enTransaction(async (transaction) => {
  const fid = id(idBrut, 'Proforma');
  const f = await verrouiller(tenantId, fid, transaction, 'client');
  if (f.type !== 'proforma') throw new ErreurAchat(400, 'Ce document n\'est pas une proforma.');
  if (f.statut !== 'validee') throw new ErreurAchat(409, f.statut === 'transformee' ? 'Cette proforma est déjà facturée.' : 'Émettez d\'abord la proforma.');
  const [tiers] = await Q('SELECT coalesce(x.delai_paiement_jours, 30) AS delai FROM registre_tiers t LEFT JOIN fin_tiers x ON x.tiers_id = t.id WHERE t.id = :t',
    { t: f.tiers_id }, { transaction });
  const jour = aujourdhui();
  const [[n]] = await X(
    `INSERT INTO fin_factures (tenant_id, sens, type, tiers_id, reference, date_facture, date_echeance, categorie_id, activite_id, objet,
                               observations, conditions_paiement, total_ht, total_taxes, total_ttc, proforma_id, cree_par)
     SELECT tenant_id, 'client', 'facture', tiers_id, reference, :jour, :echeance, categorie_id, activite_id, objet,
            observations, conditions_paiement, total_ht, total_taxes, total_ttc, id, :userId
       FROM fin_factures WHERE id = :fid RETURNING id`,
    { jour, echeance: ajouterJours(jour, Number(tiers?.delai ?? 30)), userId, fid }, { transaction });
  await X(`INSERT INTO fin_facture_lignes (facture_id, tenant_id, ordre, prestation_id, designation, quantite, prix_unitaire, remise_pct,
                                           taxe_id, taxe_taux, compte, activite_id, montant_ht, montant_taxe)
           SELECT :n, tenant_id, ordre, prestation_id, designation, quantite, prix_unitaire, remise_pct, taxe_id, taxe_taux, compte,
                  activite_id, montant_ht, montant_taxe FROM fin_facture_lignes WHERE facture_id = :fid ORDER BY ordre, id`,
  { n: n.id, fid }, { transaction });
  await X(`UPDATE fin_factures SET statut = 'transformee' WHERE id = :fid`, { fid }, { transaction });
  return { facture_id: String(n.id) };
});

// ── Paiement depuis la facture : NJ FINANCE crée le mouvement de caisse/banque ─
// `creerMouvement(corps)` est la saisie de caisse elle-même (mêmes contrôles :
// période ouverte, ordre chronologique, solde jamais négatif, budget, rubrique…),
// fournie par le contrôleur ; elle renvoie { status, data }.
const MOIS = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
const payer = async ({ tenantId, userId, body, creerMouvement }) => {
  const type = body?.facture_type === 'com_ff' ? 'com_ff' : 'fin';
  const fid = id(body?.facture_id, 'Facture');
  const jid = id(body?.journal_id, 'Caisse ou banque');
  const jourPaiement = date(body?.date, 'Date du paiement', { obligatoire: true });
  const montant = nombre(body?.montant, 'Montant', { min: 0.01 });
  const rubrique = texte(body?.rubrique_code, 40, 'Rubrique', { obligatoire: true });
  const [f] = await Q('SELECT * FROM fin_facture_reglable(:tenantId, :type, :fid)', { tenantId, type, fid });
  if (!f?.ok) throw new ErreurAchat(400, 'Seule une facture validée (et imputée, pour NJ COMMERCIAL) se règle.');
  const [{ reste }] = await Q('SELECT fin_facture_reste(:type, :fid) AS reste', { type, fid });
  if (cts(montant) > cts(reste)) throw new ErreurAchat(409, `Le reste à payer de la facture est de ${mt(Math.max(cts(reste), 0))}.`);
  const P = SENS[f.sens];
  const [r] = await Q('SELECT type, intitule FROM rubriques WHERE tenant_id = :tenantId AND code = :rubrique', { tenantId, rubrique });
  if (!r || r.type !== P.sensRubrique) {
    throw new ErreurAchat(400, `Choisissez une rubrique ${f.sens === 'client' ? 'd\'entrée' : 'de dépense'} pour ce ${f.sens === 'client' ? 'encaissement' : 'paiement'}.`);
  }
  const [j] = await Q('SELECT id, code, nom FROM journaux WHERE id = :jid AND tenant_id = :tenantId AND actif', { jid, tenantId });
  if (!j) throw new ErreurAchat(400, 'Caisse ou banque introuvable.');
  const [doc] = type === 'fin'
    ? await Q('SELECT numero, reference, activite_id FROM fin_factures WHERE id = :fid', { fid })
    : await Q('SELECT numero, reference_fournisseur AS reference FROM com_factures_fournisseurs WHERE id = :fid', { fid });
  const [tiers] = await Q('SELECT id, nom, nui FROM registre_tiers WHERE id = :t', { t: f.tiers_id });
  const intitule = `${f.sens === 'client' ? 'Encaissement facture' : 'Règlement facture'} ${doc.numero}${f.sens === 'fournisseur' && doc.reference ? ` (réf. ${doc.reference})` : ''}`;
  const res = await creerMouvement({
    date: jourPaiement, mois: MOIS[Number(jourPaiement.slice(5, 7)) - 1], annee: Number(jourPaiement.slice(0, 4)),
    journal_id: j.id, rubrique_code: rubrique, intitule: intitule.slice(0, 200),
    objet: texte(body?.reference_paiement, 200, 'Référence du paiement') || '', beneficiaire: tiers.nom, tiers_id: tiers.id, nui: tiers.nui || '',
    entree: f.sens === 'client' ? montant : 0, sortie: f.sens === 'client' ? 0 : montant,
    ...(doc.activite_id ? { activite_id: doc.activite_id } : {}),
  });
  if (res.status === 200 && res.data?.en_attente) {
    return { en_attente: true, message: `${res.data.message} La dépense attend l'approbation du directeur ; reliez-la à la facture une fois approuvée.` };
  }
  if (res.status !== 201 || !res.data?.id) {
    throw new ErreurAchat(res.status >= 400 && res.status < 600 ? res.status : 400, res.data?.error || 'La caisse a refusé ce mouvement.');
  }
  try {
    const lien = await reglerParCaisse({ tenantId, userId, body: { mouvement_id: res.data.id, affectations: [{ facture_type: type, facture_id: fid, montant }] } });
    return { mouvement_id: String(res.data.id), numero: res.data.numero, caisse: j.code, budget_warning: res.data.budget_warning || null, anomalies: lien.anomalies };
  } catch (err) {
    const e = traduire(err);
    throw new ErreurAchat(e.status || 500, `Le mouvement ${j.code}-${res.data.numero} est enregistré en caisse, mais n'a pas pu être relié à la facture : ${e.message} Reliez-le depuis la facture.`);
  }
};

// ── Règlement hors caisse ni banque ─────────────────────────────────────────
// Proposé (compte au choix, motif) ; SEUL LE DIRECTEUR le valide : il passe
// alors une écriture d'OD entre le compte du tiers de la facture et ce compte.
const proposerHorsCaisse = async ({ tenantId, userId, role, body }) => {
  const type = body?.facture_type === 'com_ff' ? 'com_ff' : 'fin';
  const fid = id(body?.facture_id, 'Facture');
  const r = await enTransaction(async (transaction) => {
    const [[h]] = await X(
      `INSERT INTO fin_reglements_hors_caisse (tenant_id, facture_type, facture_id, date_reglement, montant, compte, tiers_id, motif, propose_par)
       VALUES (:tenantId, :type, :fid, :d, :montant, :compte, :tiers, :motif, :userId) RETURNING id`,
      { tenantId, type, fid, d: date(body?.date, 'Date', { obligatoire: true }), montant: nombre(body?.montant, 'Montant', { min: 0.01 }).toFixed(2),
        compte: texte(body?.compte, 20, 'Compte de contrepartie', { obligatoire: true }), tiers: id(body?.tiers_id, 'Tiers', { obligatoire: false }),
        motif: texte(body?.motif, 500, 'Motif', { obligatoire: true }), userId }, { transaction });
    return { id: String(h.id), statut: 'propose' };
  });
  // Le directeur qui propose peut valider dans la foulée.
  if (body?.valider && role === 'directeur') return { id: r.id, ...(await deciderHorsCaisse({ tenantId, userId, role, id: r.id, body: { decision: 'valider' } })) };
  return r;
};

const deciderHorsCaisse = async ({ tenantId, userId, role, id: idBrut, body }) => {
  const hid = id(idBrut, 'Règlement');
  if (role !== 'directeur') throw new ErreurAchat(403, 'Seul le directeur valide, rejette ou annule un règlement hors caisse ni banque.');
  const decision = String(body?.decision || '');
  if (!['valider', 'rejeter', 'annuler'].includes(decision)) throw new ErreurAchat(400, 'Décision inconnue.');
  const [h0] = await Q('SELECT date_reglement::text AS d FROM fin_reglements_hors_caisse WHERE id = :hid AND tenant_id = :tenantId', { hid, tenantId });
  if (!h0) throw new ErreurAchat(404, 'Règlement introuvable.');
  if (decision === 'valider') await preparerComptabilite(tenantId, userId, h0.d);
  return enTransaction(async (transaction) => {
    const [h] = await Q('SELECT * FROM fin_reglements_hors_caisse WHERE id = :hid FOR UPDATE', { hid }, { transaction });
    if (decision !== 'valider') {
      const motif = texte(body?.motif, 500, 'Motif', { obligatoire: true });
      const statut = decision === 'rejeter' ? 'rejete' : 'annule';
      await X(`UPDATE fin_reglements_hors_caisse SET statut = :statut, decide_par = :userId, decide_le = NOW(), motif_decision = :motif WHERE id = :hid`,
        { statut, userId, motif, hid }, { transaction });
      if (statut === 'annule') await extournerOrigine(transaction, tenantId, 'fin_reglement_hc', hid, userId, `Règlement hors caisse annulé : ${motif}`);
      return { statut };
    }
    await X(`UPDATE fin_reglements_hors_caisse SET statut = 'valide', decide_par = :userId, decide_le = NOW() WHERE id = :hid`, { userId, hid }, { transaction });
    const [f] = h.facture_type === 'fin'
      ? await Q('SELECT sens, numero, tiers_id, compte_tiers FROM fin_factures WHERE id = :id', { id: h.facture_id }, { transaction })
      : await Q(`SELECT 'fournisseur' AS sens, c.numero, c.fournisseur_id AS tiers_id, i.compte_tiers FROM com_factures_fournisseurs c
                  JOIN fin_imputations_externes i ON i.com_ff_id = c.id WHERE c.id = :id`, { id: h.facture_id }, { transaction });
    const m = cts(h.montant);
    const libelle = `Règlement hors caisse ${f.numero} : ${h.motif}`.slice(0, 300);
    const lTiers = { compte: f.compte_tiers, tiers_id: String(f.tiers_id), activite_id: null, libelle };
    const lContre = { compte: h.compte, tiers_id: h.tiers_id ? String(h.tiers_id) : null, activite_id: null, libelle };
    // Fournisseur : la dette est éteinte (D 401) ; client : la créance est éteinte (C 411).
    const lignes = f.sens === 'client'
      ? [{ ...lContre, debit: m, credit: 0 }, { ...lTiers, debit: 0, credit: m }]
      : [{ ...lTiers, debit: m, credit: 0 }, { ...lContre, debit: 0, credit: m }];
    const od = await journalDe(tenantId, 'od', 'OD', 'd\'opérations diverses', transaction);
    const dateIso = String(h.date_reglement instanceof Date ? h.date_reglement.toISOString() : h.date_reglement).slice(0, 10);
    const ecritureId = await ecrireEcriture(transaction, { tenantId, origineType: 'fin_reglement_hc', origineId: hid, journalId: od.id, dateIso,
      reference: f.numero, libelle, lignes, validePar: userId, creePar: h.propose_par });
    return { statut: 'valide', ecriture_id: ecritureId };
  });
};

const retirerHorsCaisse = ({ tenantId, userId, role, id: idBrut }) => enTransaction(async (transaction) => {
  const hid = id(idBrut, 'Règlement');
  const [h] = await Q('SELECT * FROM fin_reglements_hors_caisse WHERE id = :hid AND tenant_id = :tenantId FOR UPDATE', { hid, tenantId }, { transaction });
  if (!h) throw new ErreurAchat(404, 'Règlement introuvable.');
  if (h.statut !== 'propose') throw new ErreurAchat(409, 'Un règlement décidé ne se retire pas.');
  if (h.propose_par !== userId && role !== 'directeur') throw new ErreurAchat(403, 'Seule la personne qui l\'a proposé (ou le directeur) le retire.');
  await X('DELETE FROM fin_reglements_hors_caisse WHERE id = :hid', { hid }, { transaction });
  return { retire: true };
});

// Règlements hors caisse en attente du directeur.
const horsCaisseEnAttente = (tenantId) => Q(
  `SELECT h.id::text AS id, h.facture_type, h.facture_id::text AS facture_id, h.date_reglement::text AS date, h.montant, h.compte, h.motif,
          coalesce(f.numero, c.numero) AS numero, coalesce(f.sens, 'fournisseur') AS sens, t.nom AS tiers_nom, u.username AS propose_par_nom
     FROM fin_reglements_hors_caisse h
     LEFT JOIN fin_factures f ON h.facture_type = 'fin' AND f.id = h.facture_id
     LEFT JOIN com_factures_fournisseurs c ON h.facture_type = 'com_ff' AND c.id = h.facture_id
     LEFT JOIN registre_tiers t ON t.id = coalesce(f.tiers_id, c.fournisseur_id) LEFT JOIN users u ON u.id = h.propose_par
    WHERE h.tenant_id = :tenantId AND h.statut = 'propose' ORDER BY h.propose_le`, { tenantId });

module.exports = {
  ErreurAchat, traduire, referentiels, lister, lire, creer, modifier, supprimer, soumettre, renvoyer, valider, annuler,
  imputer, synchroniserCommercial, reglerParCaisse, retirerReglement, sortiesDisponibles, facturesOuvertes, echeancier,
  emettreProforma, transformerProforma, payer, proposerHorsCaisse, deciderHorsCaisse, retirerHorsCaisse, horsCaisseEnAttente,
  calculLigne, SENS,
};
