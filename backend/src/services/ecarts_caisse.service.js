// src/services/ecarts_caisse.service.js
// Contrôle comptable → « Écarts de caisse » (migration 061, 09/11/2026).
//
// Cycle d'un écart :
//   1. CONSTAT (comptable) : solde théorique du journal vs solde compté, cause.
//      Une écriture est passée dans le journal — rubrique système ECP (excédent,
//      entrée) ou ECN (manquant, sortie) — pour que le journal rejoigne la
//      caisse réelle. Mêmes contrôles que toute écriture (période ouverte,
//      ordre chronologique, caisse jamais négative) ; pas de contrôle
//      budgétaire (un écart n'est pas une dépense prévue).
//   2. AFFECTATION : où est passé l'écart ? caissier / tiers / charge /
//      attente (manquant) ; produit / restitution / attente (excédent).
//      Compte de destination proposé (modifiable, vérifié dans le plan du
//      client) et reclassement comptable 471 → destination affiché.
//      Charge et produit soldent l'écart ; les autres restent « à suivre ».
//   3. RÉGULARISATION : recouvrement, restitution ou issue de l'investigation.
//   Annulation possible tant que la période de l'écriture est ouverte :
//   contre-passation (motif obligatoire), l'écart passe « annulé ».
//
// Origines : arrêté de caisse (controles_arrets, 046), ligne d'inventaire
// validé (inventaires_lignes, 046), ou comptage ponctuel à une date.
const { sequelize } = require('../models');
const {
  verifierPeriodeOuverte, verifierOrdreChronologique, verifierSoldeNonNegatif, ErreurComptable,
} = require('./journal.service');
const { verifierInitialise } = require('./initialisation.service');
const { soldesAuDate, MOIS } = require('./arretes_inventaires.service');

const T = sequelize.QueryTypes;
const Q = (sql, replacements, opts = {}) => sequelize.query(sql, { replacements, type: T.SELECT, ...opts });
const X = (sql, replacements, opts = {}) => sequelize.query(sql, { replacements, ...opts });

const TOLERANCE = 0.005;
const COMPTE_ATTENTE = '471';

class ErreurEcart extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ── Rubriques système ──────────────────────────────────────────────────────
const RUBRIQUES = {
  excedent: { code: 'ECP', intitule: 'ÉCART DE CAISSE — EXCÉDENT', type: 'entree' },
  manquant: { code: 'ECN', intitule: 'ÉCART DE CAISSE — MANQUANT', type: 'depense' },
};
const CODES_RUBRIQUES_ECART = Object.values(RUBRIQUES).map((r) => r.code);

// ── Destinations ───────────────────────────────────────────────────────────
// suivi = true : l'écart reste « affecté » jusqu'à sa régularisation.
const DESTINATIONS = {
  manquant: [
    { code: 'caissier', libelle: 'Imputé au caissier', compte: '421', icone: '🧑‍💼', suivi: true, responsable: 'obligatoire',
      description: 'Somme à recouvrer auprès du caissier (remboursement ou retenue sur salaire).' },
    { code: 'tiers', libelle: 'Imputé à un tiers identifié', compte: '471', icone: '🤝', suivi: true, responsable: 'obligatoire',
      description: 'Paiement en trop ou avance non justifiée : somme à récupérer auprès du tiers.' },
    { code: 'charge', libelle: 'Perte constatée (charge)', compte: '658', icone: '📉', suivi: false, responsable: 'facultatif',
      description: 'Manquant non recouvrable, passé en charges diverses après décision de la direction.' },
    { code: 'attente', libelle: 'En attente d\'investigation', compte: '471', icone: '🔎', suivi: true, responsable: 'facultatif',
      description: 'Cause non encore établie : l\'écart reste au compte d\'attente jusqu\'à sa résolution.' },
  ],
  excedent: [
    { code: 'produit', libelle: 'Produit constaté', compte: '758', icone: '📈', suivi: false, responsable: 'facultatif',
      description: 'Excédent sans propriétaire identifié, passé en produits divers.' },
    { code: 'restitution', libelle: 'À restituer à un tiers identifié', compte: '471', icone: '↩️', suivi: true, responsable: 'obligatoire',
      description: 'Monnaie non rendue, versement en double… : somme à rendre à son propriétaire.' },
    { code: 'attente', libelle: 'En attente d\'investigation', compte: '471', icone: '🔎', suivi: true, responsable: 'facultatif',
      description: 'Origine non encore établie : l\'excédent reste au compte d\'attente.' },
  ],
};
const destination = (sens, code) => (DESTINATIONS[sens] || []).find((d) => d.code === code) || null;

// ── Petites aides ──────────────────────────────────────────────────────────
const txt = (v) => String(v ?? '').trim();
const arrondi = (n) => Math.round(Number(n) * 100) / 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const aujourdhui = () => new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10); // UTC+1
const lireDate = (v, quoi) => {
  const d = txt(v);
  if (!DATE_RE.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) throw new ErreurEcart(400, `${quoi} invalide.`);
  if (d > aujourdhui()) throw new ErreurEcart(400, `${quoi} : une date future n'est pas admise.`);
  return d;
};
const lireMontant = (v, quoi) => {
  const t = txt(v).replace(/[\s  ]/g, '').replace(',', '.');
  const n = Number(t);
  if (t === '' || !Number.isFinite(n)) throw new ErreurEcart(400, `${quoi} invalide.`);
  return arrondi(n);
};
const entier = (v, quoi) => {
  const n = Number.parseInt(v, 10);
  if (!Number.isInteger(n) || n <= 0) throw new ErreurEcart(400, `${quoi} invalide.`);
  return n;
};
const periodeDeDate = (d) => {
  const x = new Date(`${d}T00:00:00Z`);
  return { mois: MOIS[x.getUTCMonth()], annee: x.getUTCFullYear() };
};
const dateFr = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const fmt = (n) => Math.round(Math.abs(Number(n) || 0)).toLocaleString('fr-FR');
const exigerClient = (tenantId) => { if (!tenantId) throw new ErreurEcart(400, 'Choisissez d\'abord un client.'); };
const audit = (transaction, { tenantId, userId, action, id, avant = null, apres = null }) => X(
  `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, ancienne_valeur, nouvelle_valeur)
   VALUES (:t, :u, :action, 'ecart_caisse', :id, CAST(:av AS jsonb), CAST(:ap AS jsonb))`,
  { t: tenantId, u: userId, action, id: String(id), av: avant ? JSON.stringify(avant) : null, ap: apres ? JSON.stringify(apres) : null },
  { transaction, type: T.INSERT });

/** Crée (si besoin) les deux rubriques système ECP / ECN du client. Renvoie { excedent, manquant }. */
const assurerRubriques = async (tenantId, transaction) => {
  const res = {};
  for (const [sens, r] of Object.entries(RUBRIQUES)) {
    await X(
      `INSERT INTO rubriques (tenant_id, code, intitule, type, est_virement_interne, est_ecart_caisse, code_comptable, actif, ordre)
       VALUES (:t, :code, :intitule, :type, false, true, :compte, true, 990)
       ON CONFLICT (tenant_id, code) DO UPDATE SET est_ecart_caisse = true, actif = true`,
      { t: tenantId, code: r.code, intitule: r.intitule, type: r.type, compte: COMPTE_ATTENTE },
      { transaction, type: T.INSERT });
    const [row] = await Q('SELECT code, intitule, type, code_comptable FROM rubriques WHERE tenant_id = :t AND code = :code',
      { t: tenantId, code: r.code }, { transaction });
    if (row.type !== r.type) {
      throw new ErreurEcart(409, `La rubrique ${r.code} existe déjà chez ce client avec un autre type (${row.type}) : renommez-la avant de constater un écart.`);
    }
    res[sens] = row;
  }
  return res;
};

// ── Lecture ────────────────────────────────────────────────────────────────
const SELECT_ECART = `
  SELECT e.*, j.code AS journal_code, j.nom AS journal_nom, j.type AS journal_type,
         m.numero AS mouvement_numero, m.annule AS mouvement_annule,
         uc.username AS constate_par_nom, ua.username AS affecte_par_nom,
         us.username AS solde_par_nom, uan.username AS annule_par_nom, ur.username AS responsable_login
    FROM ecarts_caisse e
    JOIN journaux j ON j.id = e.journal_id
    LEFT JOIN journal m ON m.id = e.mouvement_id
    LEFT JOIN users uc  ON uc.id = e.constate_par
    LEFT JOIN users ua  ON ua.id = e.affecte_par
    LEFT JOIN users us  ON us.id = e.solde_par
    LEFT JOIN users uan ON uan.id = e.annule_par
    LEFT JOIN users ur  ON ur.id = e.responsable_id`;

const presenter = (r) => {
  const dest = r.destination ? destination(r.sens, r.destination) : null;
  const montant = Number(r.montant);
  const compteDest = r.compte_destination || '';
  const attente = r.compte_attente || COMPTE_ATTENTE;
  // Reclassement à passer en comptabilité quand la destination n'est pas le compte d'attente lui-même.
  const reclassement = dest && compteDest && compteDest !== attente
    ? (r.sens === 'manquant'
      ? { debit: compteDest, credit: attente, montant: Math.abs(montant) }
      : { debit: attente, credit: compteDest, montant: Math.abs(montant) })
    : null;
  return {
    id: Number(r.id), numero: r.numero,
    journal_id: Number(r.journal_id), journal_code: r.journal_code, journal_nom: r.journal_nom, journal_type: r.journal_type,
    origine: r.origine, origine_id: r.origine_id ? Number(r.origine_id) : null,
    periode: r.periode_mois ? { mois: r.periode_mois, annee: Number(r.periode_annee) } : null,
    date_constat: r.date_constat, date_ecriture: r.date_ecriture,
    solde_theorique: Number(r.solde_theorique), solde_constate: Number(r.solde_constate),
    montant, sens: r.sens, cause: r.cause || '',
    ecriture: r.mouvement_id ? { id: Number(r.mouvement_id), numero: r.mouvement_numero, annulee: Boolean(r.mouvement_annule) } : null,
    statut: r.statut,
    destination: r.destination || null, destination_libelle: dest?.libelle || null, destination_icone: dest?.icone || null,
    compte_destination: compteDest, compte_attente: attente, reclassement,
    responsable: r.responsable_nom || r.responsable_login || '', responsable_id: r.responsable_id || null,
    observation: r.observation || '',
    regularisation: r.regularisation_date ? {
      date: r.regularisation_date, mode: r.regularisation_mode, reference: r.regularisation_ref, observation: r.regularisation_obs,
    } : null,
    a_suivre: r.statut === 'affecte',
    traces: {
      constat: { par: r.constate_par_nom || null, le: r.constate_le },
      affectation: r.affecte_le ? { par: r.affecte_par_nom || null, le: r.affecte_le } : null,
      solde: r.solde_le ? { par: r.solde_par_nom || null, le: r.solde_le } : null,
      annulation: r.annule_le ? { par: r.annule_par_nom || null, le: r.annule_le, motif: r.motif_annulation || '' } : null,
    },
  };
};

const lireEcart = async (tenantId, id, transaction, verrou = false) => {
  const [r] = await Q(`${SELECT_ECART} WHERE e.tenant_id = :t AND e.id = :id${verrou ? ' FOR UPDATE OF e' : ''}`,
    { t: tenantId, id }, { transaction });
  if (!r) throw new ErreurEcart(404, 'Écart introuvable.');
  return r;
};

/**
 * Écarts détectés par les arrêtés et inventaires, pas encore constatés au
 * registre (« à constater »). Un arrêté compte dès que son solde constaté est
 * saisi ; un inventaire dès qu'il est validé (soldes figés).
 */
const ecartsDetectes = async (tenantId) => {
  const arrets = await Q(
    `SELECT 'arret' AS origine, c.id AS origine_id, c.journal_id, j.code AS journal_code, j.nom AS journal_nom,
            c.mois AS periode_mois, c.annee AS periode_annee, c.statut AS etat,
            COALESCE(CASE WHEN c.statut = 'validee' THEN c.solde_arrete END, a.solde_final) AS solde_theorique,
            c.solde_constate, c.observation AS cause,
            (date_trunc('month', make_date(c.annee, array_position(:mois::text[], c.mois), 1)) + INTERVAL '1 month - 1 day')::date AS date_ref
       FROM controles_arrets c
       JOIN journaux j ON j.id = c.journal_id
       JOIN arrets_caisse a ON a.tenant_id = c.tenant_id AND a.journal_id = c.journal_id AND a.mois = c.mois AND a.annee = c.annee
      WHERE c.tenant_id = :t AND c.solde_constate IS NOT NULL
        AND abs(c.solde_constate - COALESCE(CASE WHEN c.statut = 'validee' THEN c.solde_arrete END, a.solde_final)) >= :tol
        AND NOT EXISTS (SELECT 1 FROM ecarts_caisse e WHERE e.tenant_id = c.tenant_id AND e.origine = 'arret'
                         AND e.origine_id = c.id AND e.statut <> 'annule')`,
    { t: tenantId, tol: TOLERANCE, mois: `{${MOIS.join(',')}}` });
  const inventaires = await Q(
    `SELECT 'inventaire' AS origine, l.id AS origine_id, l.journal_id, j.code AS journal_code, j.nom AS journal_nom,
            NULL AS periode_mois, NULL AS periode_annee, i.statut AS etat,
            l.solde_theorique, l.solde_constate, COALESCE(NULLIF(l.observation, ''), i.observation) AS cause,
            i.date_inventaire AS date_ref, i.libelle AS inventaire_libelle
       FROM inventaires_lignes l
       JOIN inventaires i ON i.id = l.inventaire_id
       JOIN journaux j ON j.id = l.journal_id
      WHERE l.tenant_id = :t AND i.statut = 'valide'
        AND l.solde_theorique IS NOT NULL AND l.solde_constate IS NOT NULL
        AND abs(l.solde_constate - l.solde_theorique) >= :tol
        AND NOT EXISTS (SELECT 1 FROM ecarts_caisse e WHERE e.tenant_id = l.tenant_id AND e.origine = 'inventaire'
                         AND e.origine_id = l.id AND e.statut <> 'annule')`,
    { t: tenantId, tol: TOLERANCE });
  return [...arrets, ...inventaires].map((r) => {
    const montant = arrondi(Number(r.solde_constate) - Number(r.solde_theorique));
    return {
      origine: r.origine, origine_id: Number(r.origine_id),
      journal_id: Number(r.journal_id), journal_code: r.journal_code, journal_nom: r.journal_nom,
      periode: r.periode_mois ? { mois: r.periode_mois, annee: Number(r.periode_annee) } : null,
      etat_origine: r.etat, date_ref: r.date_ref, libelle: r.inventaire_libelle || '',
      solde_theorique: Number(r.solde_theorique), solde_constate: Number(r.solde_constate),
      montant, sens: montant > 0 ? 'excedent' : 'manquant', cause: r.cause || '',
    };
  }).sort((a, b) => String(b.date_ref).localeCompare(String(a.date_ref)));
};

/** Registre + écarts à constater + synthèse. Filtres : annee, mois (facultatif), journal_id, statut, sens. */
const lister = async (tenantId, query = {}) => {
  exigerClient(tenantId);
  const w = ['e.tenant_id = :t'];
  const rep = { t: tenantId };
  if (query.annee) { w.push('EXTRACT(YEAR FROM e.date_constat) = :annee'); rep.annee = entier(query.annee, 'Année'); }
  if (query.mois && MOIS.includes(query.mois)) { w.push('EXTRACT(MONTH FROM e.date_constat) = :m'); rep.m = MOIS.indexOf(query.mois) + 1; }
  if (query.journal_id) { w.push('e.journal_id = :j'); rep.j = entier(query.journal_id, 'Journal'); }
  if (['constate', 'affecte', 'solde', 'annule'].includes(query.statut)) { w.push('e.statut = :st'); rep.st = query.statut; }
  if (['excedent', 'manquant'].includes(query.sens)) { w.push('e.sens = :sens'); rep.sens = query.sens; }
  const rows = await Q(`${SELECT_ECART} WHERE ${w.join(' AND ')} ORDER BY e.date_constat DESC, e.id DESC`, rep);
  const lignes = rows.map(presenter);
  const actifs = lignes.filter((l) => l.statut !== 'annule');
  const somme = (arr) => arrondi(arr.reduce((s, l) => s + Math.abs(l.montant), 0));
  const resume = {
    total: actifs.length,
    excedents: { nb: actifs.filter((l) => l.sens === 'excedent').length, montant: somme(actifs.filter((l) => l.sens === 'excedent')) },
    manquants: { nb: actifs.filter((l) => l.sens === 'manquant').length, montant: somme(actifs.filter((l) => l.sens === 'manquant')) },
    a_affecter: actifs.filter((l) => l.statut === 'constate').length,
    a_suivre: { nb: actifs.filter((l) => l.statut === 'affecte').length, montant: somme(actifs.filter((l) => l.statut === 'affecte')) },
    soldes: actifs.filter((l) => l.statut === 'solde').length,
    par_destination: Object.values(actifs.filter((l) => l.destination).reduce((acc, l) => {
      const k = `${l.sens}:${l.destination}`;
      acc[k] = acc[k] || { sens: l.sens, destination: l.destination, libelle: l.destination_libelle, compte: l.compte_destination, nb: 0, montant: 0 };
      acc[k].nb += 1; acc[k].montant = arrondi(acc[k].montant + Math.abs(l.montant));
      return acc;
    }, {})),
  };
  return { lignes, resume, a_constater: await ecartsDetectes(tenantId) };
};

const lire = async (tenantId, id) => presenter(await lireEcart(tenantId, entier(id, 'Écart')));

/** Paramètres de l'écran : destinations, rubriques, compte d'attente. */
const parametres = async (tenantId) => {
  exigerClient(tenantId);
  const rub = await Q('SELECT code, intitule, type, code_comptable FROM rubriques WHERE tenant_id = :t AND est_ecart_caisse',
    { t: tenantId }).catch(() => []);
  return { destinations: DESTINATIONS, rubriques: rub, compte_attente_defaut: COMPTE_ATTENTE, tolerance: TOLERANCE };
};

/** Solde théorique d'un journal à la fin d'une journée (aperçu du constat par comptage). */
const soldeTheorique = async (tenantId, { journal_id: jid, date }) => {
  exigerClient(tenantId);
  const journalId = entier(jid, 'Journal');
  const d = lireDate(date || aujourdhui(), 'Date');
  const [j] = await Q('SELECT id, code, nom, type FROM journaux WHERE id = :id AND tenant_id = :t', { id: journalId, t: tenantId });
  if (!j) throw new ErreurEcart(404, 'Journal introuvable pour ce client.');
  const soldes = await soldesAuDate(tenantId, d, [journalId]);
  return { journal_id: journalId, journal_code: j.code, journal_nom: j.nom, date: d, solde_theorique: soldes.get(journalId) || 0 };
};

// ── Constat ────────────────────────────────────────────────────────────────
/**
 * body : { origine: 'arret'|'inventaire'|'comptage', origine_id?, journal_id (comptage),
 *          date_constat, solde_constate (comptage), cause, date_ecriture? }
 * Pour un arrêté ou un inventaire, les soldes viennent du serveur (figés) :
 * aucun montant saisi par l'utilisateur n'est cru sur parole.
 */
const constater = async ({ tenantId, userId, body = {} }) => {
  exigerClient(tenantId);
  const origine = txt(body.origine) || 'comptage';
  if (!['arret', 'inventaire', 'comptage'].includes(origine)) throw new ErreurEcart(400, 'Origine de l\'écart invalide.');
  const cause = txt(body.cause).slice(0, 2000);
  if (cause.length < 5) throw new ErreurEcart(400, 'Décrivez la cause constatée de l\'écart (5 caractères au moins).');
  const dateConstat = lireDate(body.date_constat || aujourdhui(), 'Date du constat');

  // 1. Soldes : serveur pour arrêté / inventaire, saisie pour un comptage.
  let src;
  if (origine === 'arret') {
    const id = entier(body.origine_id, 'Arrêté');
    const [r] = await Q(
      `SELECT c.id, c.journal_id, c.mois, c.annee, c.statut, c.solde_constate,
              COALESCE(CASE WHEN c.statut = 'validee' THEN c.solde_arrete END, a.solde_final) AS solde_theorique
         FROM controles_arrets c
         JOIN arrets_caisse a ON a.tenant_id = c.tenant_id AND a.journal_id = c.journal_id AND a.mois = c.mois AND a.annee = c.annee
        WHERE c.id = :id AND c.tenant_id = :t`, { id, t: tenantId });
    if (!r) throw new ErreurEcart(404, 'Arrêté introuvable, ou caisse non arrêtée pour ce mois.');
    if (r.solde_constate === null) throw new ErreurEcart(409, 'Le solde constaté de cet arrêté n\'est pas encore saisi (Arrêtés & inventaires).');
    src = { journalId: Number(r.journal_id), origineId: id, theo: Number(r.solde_theorique), constate: Number(r.solde_constate), periode: { mois: r.mois, annee: Number(r.annee) } };
  } else if (origine === 'inventaire') {
    const id = entier(body.origine_id, 'Ligne d\'inventaire');
    const [r] = await Q(
      `SELECT l.id, l.journal_id, l.solde_theorique, l.solde_constate, i.statut
         FROM inventaires_lignes l JOIN inventaires i ON i.id = l.inventaire_id
        WHERE l.id = :id AND l.tenant_id = :t`, { id, t: tenantId });
    if (!r) throw new ErreurEcart(404, 'Ligne d\'inventaire introuvable.');
    if (r.statut !== 'valide') throw new ErreurEcart(409, 'Validez d\'abord l\'inventaire : ses soldes ne sont figés qu\'à la validation.');
    src = { journalId: Number(r.journal_id), origineId: id, theo: Number(r.solde_theorique), constate: Number(r.solde_constate), periode: null };
  } else {
    const journalId = entier(body.journal_id, 'Journal');
    const constate = lireMontant(body.solde_constate, 'Solde compté');
    if (constate < 0) throw new ErreurEcart(400, 'Le solde compté ne peut pas être négatif.');
    const s = await soldeTheorique(tenantId, { journal_id: journalId, date: dateConstat });
    src = { journalId, origineId: null, theo: s.solde_theorique, constate, periode: null };
  }
  const montant = arrondi(src.constate - src.theo);
  if (Math.abs(montant) < TOLERANCE) throw new ErreurEcart(409, 'Aucun écart : le solde compté est égal au solde théorique.');
  const sens = montant > 0 ? 'excedent' : 'manquant';

  // 2. Écriture dans le journal : date (par défaut celle du constat) dans une période ouverte.
  const dateEcriture = lireDate(body.date_ecriture || dateConstat, 'Date de l\'écriture');
  if (dateEcriture < dateConstat) throw new ErreurEcart(400, 'L\'écriture ne peut pas être antérieure au constat.');
  const { mois, annee } = periodeDeDate(dateEcriture);
  const [journal] = await Q('SELECT id, code, nom, type, actif FROM journaux WHERE id = :id AND tenant_id = :t', { id: src.journalId, t: tenantId });
  if (!journal) throw new ErreurEcart(404, 'Journal introuvable pour ce client.');
  try {
    await verifierInitialise(tenantId);
    await verifierPeriodeOuverte(tenantId, journal.id, mois, annee);
    await verifierOrdreChronologique(tenantId, journal.id, dateEcriture, { rattrapage: false });
    await verifierSoldeNonNegatif(tenantId, journal.id, mois, annee, montant);
  } catch (err) {
    if (err instanceof ErreurComptable) {
      const conseil = src.periode && /arrêtée/.test(err.message)
        ? ` L'arrêté ${/^[AEIOU]/i.test(src.periode.mois) ? 'd\'' : 'de '}${src.periode.mois} ${src.periode.annee} étant clos, datez l'écriture d'écart dans une période ouverte (par ex. aujourd'hui).`
        : '';
      throw new ErreurEcart(err.status, `${err.message}${conseil}`);
    }
    throw err;
  }
  const typeCaisse = ['om', 'momo', 'carte_prepayee'].includes(journal.type) ? 'om' : 'especes';

  return sequelize.transaction(async (transaction) => {
    const rubs = await assurerRubriques(tenantId, transaction);
    const rub = rubs[sens];
    // Numéro ECA-AAAA-NNNN, séquentiel par client et par année.
    await X('SELECT pg_advisory_xact_lock(hashtext(:k))', { k: `ecarts_caisse:${tenantId}` }, { transaction, type: T.SELECT });
    const an = dateConstat.slice(0, 4);
    const [{ n }] = await Q(
      `SELECT COALESCE(MAX(NULLIF(split_part(numero, '-', 3), '')::int), 0) + 1 AS n
         FROM ecarts_caisse WHERE tenant_id = :t AND numero LIKE :p`, { t: tenantId, p: `ECA-${an}-%` }, { transaction });
    const numero = `ECA-${an}-${String(n).padStart(4, '0')}`;
    const libelle = sens === 'manquant' ? 'MANQUANT DE CAISSE' : 'EXCÉDENT DE CAISSE';
    const [mvt] = await Q(
      `INSERT INTO journal (tenant_id, date, mois, annee, journal_id, type_caisse, rubrique_code, intitule, objet,
                            beneficiaire, piece_identite, telephone, entree, sortie, created_by)
       VALUES (:t, :date, :mois, :annee, :j, :tc, :rub, :intitule, :objet, '', :piece, '', :e, :s, :u)
       RETURNING id, numero`,
      { t: tenantId, date: dateEcriture, mois, annee, j: journal.id, tc: typeCaisse, rub: rub.code,
        intitule: `${libelle} ${numero} — constat du ${dateFr(dateConstat)}`.slice(0, 250),
        objet: cause.slice(0, 250), piece: numero,
        e: sens === 'excedent' ? Math.abs(montant) : 0, s: sens === 'manquant' ? Math.abs(montant) : 0, u: userId },
      { transaction });
    let ecart;
    try {
      [ecart] = await Q(
        `INSERT INTO ecarts_caisse (tenant_id, numero, journal_id, origine, origine_id, periode_mois, periode_annee,
                                    date_constat, solde_theorique, solde_constate, montant, sens, cause,
                                    mouvement_id, date_ecriture, compte_attente, constate_par)
         VALUES (:t, :numero, :j, :origine, :oid, :pm, :pa, :dc, :theo, :constate, :montant, :sens, :cause,
                 :mvt, :de, :attente, :u)
         RETURNING id`,
        { t: tenantId, numero, j: journal.id, origine, oid: src.origineId, pm: src.periode?.mois || null, pa: src.periode?.annee || null,
          dc: dateConstat, theo: src.theo, constate: src.constate, montant, sens, cause,
          mvt: mvt.id, de: dateEcriture, attente: txt(rub.code_comptable) || COMPTE_ATTENTE, u: userId },
        { transaction });
    } catch (err) {
      if (err?.original?.code === '23505' || /uq_ecarts_caisse_origine/.test(err.message)) {
        throw new ErreurEcart(409, 'Cet écart est déjà constaté au registre.');
      }
      throw err;
    }
    await audit(transaction, { tenantId, userId, action: 'CONSTAT_ECART_CAISSE', id: ecart.id,
      apres: { numero, journal: journal.code, origine, montant, sens, ecriture: mvt.numero, date_ecriture: dateEcriture } });
    return presenter(await lireEcart(tenantId, ecart.id, transaction));
  });
};

// ── Affectation ────────────────────────────────────────────────────────────
/** body : { destination, compte_destination?, responsable_nom?, responsable_id?, observation? } */
const affecter = async ({ tenantId, userId, id, body = {} }) => sequelize.transaction(async (transaction) => {
  const e = await lireEcart(tenantId, entier(id, 'Écart'), transaction, true);
  if (e.statut === 'annule') throw new ErreurEcart(409, 'Écart annulé : il ne s\'affecte plus.');
  if (e.statut === 'solde') throw new ErreurEcart(409, 'Écart déjà soldé : annulez-le pour le reprendre.');
  const dest = destination(e.sens, txt(body.destination));
  if (!dest) {
    throw new ErreurEcart(400, `Destination invalide pour un ${e.sens === 'manquant' ? 'manquant' : 'excédent'} : `
      + DESTINATIONS[e.sens].map((d) => d.libelle).join(', ') + '.');
  }
  const compte = txt(body.compte_destination || dest.compte).slice(0, 20);
  if (!/^\d[\dA-Za-z]*$/.test(compte)) throw new ErreurEcart(400, 'Compte de destination invalide.');
  // Le compte doit exister (actif) dans le plan du client, s'il a son propre plan.
  const [plan] = await Q('SELECT plan_initialise_le IS NOT NULL AS ok FROM tenants WHERE id = :t', { t: tenantId }, { transaction });
  if (plan?.ok) {
    const [c] = await Q(`SELECT compte FROM plan_comptable_client WHERE tenant_id = :t AND lower(btrim(compte)) = lower(:c) AND statut = 'actif'`,
      { t: tenantId, c: compte }, { transaction });
    if (!c) throw new ErreurEcart(400, `Le compte ${compte} n'existe pas (ou n'est pas actif) dans le plan comptable de ce client. Ajoutez-le dans Configuration → Plan comptable ou choisissez un autre compte.`);
  }
  let responsableId = null;
  if (body.responsable_id) {
    const [u] = await Q('SELECT id, username FROM users WHERE id = :id AND tenant_id = :t', { id: txt(body.responsable_id), t: tenantId }, { transaction })
      .catch(() => []);
    if (!u) throw new ErreurEcart(400, 'Utilisateur responsable introuvable pour ce client.');
    responsableId = u.id;
  }
  const responsable = txt(body.responsable_nom).slice(0, 200);
  if (dest.responsable === 'obligatoire' && !responsable && !responsableId) {
    throw new ErreurEcart(400, dest.code === 'caissier' ? 'Indiquez le caissier à qui l\'écart est imputé.' : 'Indiquez le tiers concerné.');
  }
  const observation = txt(body.observation).slice(0, 2000);
  const statut = dest.suivi ? 'affecte' : 'solde';
  await X(
    `UPDATE ecarts_caisse SET destination = :d, compte_destination = :c, responsable_nom = :rn, responsable_id = :rid,
            observation = :o, statut = :st, affecte_par = :u, affecte_le = NOW(),
            solde_par = CASE WHEN :st = 'solde' THEN CAST(:u AS uuid) ELSE NULL END,
            solde_le  = CASE WHEN :st = 'solde' THEN NOW() ELSE NULL END,
            regularisation_date = NULL, regularisation_mode = '', regularisation_ref = '', regularisation_obs = ''
      WHERE id = :id`,
    { d: dest.code, c: compte, rn: responsable, rid: responsableId, o: observation, st: statut, u: userId, id: e.id },
    { transaction, type: T.UPDATE });
  await audit(transaction, { tenantId, userId, action: 'AFFECTATION_ECART_CAISSE', id: e.id,
    avant: { statut: e.statut, destination: e.destination, compte: e.compte_destination },
    apres: { statut, destination: dest.code, compte, responsable: responsable || responsableId } });
  return presenter(await lireEcart(tenantId, e.id, transaction));
});

// ── Régularisation ─────────────────────────────────────────────────────────
/** body : { date, mode, reference?, observation? } — recouvrement, restitution, issue de l'investigation. */
const regulariser = async ({ tenantId, userId, id, body = {} }) => sequelize.transaction(async (transaction) => {
  const e = await lireEcart(tenantId, entier(id, 'Écart'), transaction, true);
  if (e.statut !== 'affecte') throw new ErreurEcart(409, e.statut === 'constate' ? 'Choisissez d\'abord la destination de l\'écart.' : 'Cet écart n\'est pas en attente de régularisation.');
  const date = lireDate(body.date || aujourdhui(), 'Date de régularisation');
  if (date < String(e.date_constat).slice(0, 10)) throw new ErreurEcart(400, 'La régularisation ne peut pas précéder le constat.');
  const mode = txt(body.mode).slice(0, 100);
  if (!mode) throw new ErreurEcart(400, 'Indiquez comment l\'écart a été régularisé (remboursement, retenue sur salaire, restitution…).');
  await X(
    `UPDATE ecarts_caisse SET statut = 'solde', regularisation_date = :d, regularisation_mode = :m,
            regularisation_ref = :r, regularisation_obs = :o, solde_par = :u, solde_le = NOW()
      WHERE id = :id`,
    { d: date, m: mode, r: txt(body.reference).slice(0, 200), o: txt(body.observation).slice(0, 1000), u: userId, id: e.id },
    { transaction, type: T.UPDATE });
  await audit(transaction, { tenantId, userId, action: 'REGULARISATION_ECART_CAISSE', id: e.id,
    avant: { statut: e.statut }, apres: { statut: 'solde', date, mode, reference: txt(body.reference) } });
  return presenter(await lireEcart(tenantId, e.id, transaction));
});

// ── Annulation ─────────────────────────────────────────────────────────────
/** body : { motif } — contre-passe l'écriture d'écart (période ouverte) et annule l'écart. */
const annuler = async ({ tenantId, userId, id, body = {} }) => {
  const motif = txt(body.motif);
  if (motif.length < 5) throw new ErreurEcart(400, 'Indiquez le motif de l\'annulation (5 caractères au moins).');
  const annulation = require('./annulation.service');
  return sequelize.transaction(async (transaction) => {
    const e = await lireEcart(tenantId, entier(id, 'Écart'), transaction, true);
    if (e.statut === 'annule') throw new ErreurEcart(409, 'Écart déjà annulé.');
    let contrePassation = null;
    if (e.mouvement_id && !e.mouvement_annule) {
      try {
        const r = await annulation.passerAnnulation({ tenantId, mouvementId: e.mouvement_id,
          motif: `Annulation de l'écart ${e.numero} : ${motif}`.slice(0, 500), userId, t: transaction });
        contrePassation = r.annulation.numero;
      } catch (err) {
        if (err instanceof ErreurComptable) throw new ErreurEcart(err.status, `Annulation impossible : ${err.message}`);
        throw err;
      }
    }
    await X(
      `UPDATE ecarts_caisse SET statut = 'annule', annule_par = :u, annule_le = NOW(), motif_annulation = :m WHERE id = :id`,
      { u: userId, m: motif.slice(0, 500), id: e.id }, { transaction, type: T.UPDATE });
    await audit(transaction, { tenantId, userId, action: 'ANNULATION_ECART_CAISSE', id: e.id,
      avant: { statut: e.statut }, apres: { statut: 'annule', motif, contre_passation: contrePassation } });
    return presenter(await lireEcart(tenantId, e.id, transaction));
  });
};

/** Garde de la saisie manuelle : les rubriques d'écart ne se choisissent pas au journal. */
const estRubriqueEcart = async (tenantId, code) => {
  if (!code) return false;
  const [r] = await Q('SELECT est_ecart_caisse FROM rubriques WHERE tenant_id = :t AND code = :c', { t: tenantId, c: String(code) })
    .catch(() => []);
  return Boolean(r?.est_ecart_caisse);
};

module.exports = {
  ErreurEcart, DESTINATIONS, RUBRIQUES, CODES_RUBRIQUES_ECART,
  lister, lire, parametres, soldeTheorique, constater, affecter, regulariser, annuler, estRubriqueEcart, assurerRubriques,
};
