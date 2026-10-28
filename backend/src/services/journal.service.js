// src/services/journal.service.js
// Logique métier du journal de caisse, extraite de journal.controller.js.
// Contrôles budgétaires caisse (RG-01 à RG-06) :
//   RG-01  La dotation (table budget) ne garde plus la caisse — supprimé.
//   RG-03  Sortie sur un mois non validé (budget_validation != 'valide') → mise en attente.
//   RG-04  Mois validé mais cumul sorties rubrique > montant prévu (appel_fonds) → mise en attente.
//   RG-05  Contrôles sur les SORTIES uniquement ; entrées exemptées.
//   RG-06  Plafond du journal (budget_caisse) dépassé → mise en attente (refus sec).
//   Tout blocage suit le même circuit : refus sec + mouvements_attente + validation directeur.
//   Contrôle appliqué à la création (POST) ET à la modification (PUT) ; fail-closed.
//
// Fonctions pures vis-à-vis d'Express : aucune ne touche req/res, pour rester
// appelables indépendamment du transport HTTP (tests, scripts, autres routes).
const { Op } = require('sequelize');
const { Journal, Mouvement, Ran, AppelFonds, BudgetCaisse, MouvementAttente } = require('../models');
const notif = require('../services/notification.service');
const hebdo = require('./budget_hebdo.service');

const MOIS = ['Janvier','Fevrier','Mars','Avril','Mai','Juin',
              'Juillet','Aout','Septembre','Octobre','Novembre','Decembre'];

// ── Mois précédent ───────────────────────────────────────────────────────
const moisPrecedent = (mois, annee) => {
  const idx = MOIS.indexOf(mois);
  if (idx === 0) return { mois: MOIS[11], annee: annee - 1 };
  return { mois: MOIS[idx - 1], annee };
};

// ── Type de caisse d'un journal ─────────────────────────────────────────
// SOURCE UNIQUE : la colonne ran.type_caisse n'accepte que 'especes' / 'om'
// (CHECK en base). Le frontend calculait sa propre valeur (carte prépayée →
// especes) alors que le serveur disait 'om' : le RAN d'une même caisse
// pouvait être lu et écrit sous deux types différents. Le serveur décide.
const typeCaisseDuJournal = (type) =>
  (['om', 'momo', 'carte_prepayee'].includes(type) ? 'om' : 'especes');

// ── Enregistrer un RAN (création ou mise à jour) ─────────────────────────
// Mise à jour d'abord, insertion sinon, puis nouvelle mise à jour si une
// insertion concurrente (double clic, deux onglets) a gagné la course.
// Remplace Ran.findOrCreate + lock, qui échouait en 500 dès qu'une contrainte
// d'unicité était heurtée (ancienne contrainte par type de caisse, voir 016/017).
const enregistrerRan = async ({ tenantId, mois, annee, journalId, typeCaisse, montant }) => {
  const where = journalId
    ? { tenant_id: tenantId, mois, annee, journal_id: journalId }
    : { tenant_id: tenantId, mois, annee, type_caisse: typeCaisse, journal_id: null };
  const [n] = await Ran.update({ montant }, { where });
  if (n > 0) return;
  try {
    await Ran.create({ ...where, type_caisse: typeCaisse, montant });
  } catch (err) {
    if (err.name !== 'SequelizeUniqueConstraintError') throw err;
    const [n2] = await Ran.update({ montant }, { where });
    if (n2 > 0) return;
    // La ligne en conflit n'est PAS la nôtre : c'est l'ancienne contrainte
    // UNIQUE(tenant, mois, annee, type_caisse) qui bloque une 2e caisse.
    const e = new Error('CONTRAINTE_RAN_OBSOLETE');
    e.code = 'CONTRAINTE_RAN_OBSOLETE';
    throw e;
  }
};

// ── Résoudre journal_id → type_caisse (rétrocompatibilité) ──────────────
// Si journal_id fourni → on l'utilise comme filtre principal
// Si caisse fourni (ancien mode) → on filtre par type_caisse
// Si les deux absents → on prend tout
const resolveFiltre = async (tenantId, journalId, caisse) => {
  if (journalId) {
    const j = await Journal.findOne({
      where: { id: parseInt(journalId, 10), tenant_id: tenantId },
      attributes: ['id', 'type', 'code'],
    });
    if (!j) throw new Error('Journal introuvable.');
    return { journal_id: j.id, type_caisse: typeCaisseDuJournal(j.type) };
  }
  if (caisse) {
    return { journal_id: null, type_caisse: caisse };
  }
  return { journal_id: null, type_caisse: null };
};

// ══ CONTINUITÉ COMPTABLE DES SOLDES (migration 025) ════════════════════════
// Pour un journal :
//   solde final(M) = solde d'ouverture (RAN saisi au 1er mois)
//                    + Σ (entrées − sorties) de tous les mois ≤ M
//   RAN(M)         = solde final(M-1)  — calculé, jamais figé en base.
// Une écriture tardive sur un mois passé se répercute donc sur tous les mois
// suivants, et un mois jamais consulté ne casse plus la chaîne des reports.
const { QueryTypes } = require('sequelize');
const cle = (mois, annee) => Number(annee) * 12 + MOIS.indexOf(mois) + 1;
const SQL_CLE = `(annee * 12 + array_position(ARRAY['Janvier','Fevrier','Mars','Avril','Mai','Juin','Juillet','Aout','Septembre','Octobre','Novembre','Decembre']::text[], mois))`;
const libellePeriode = (k) => `${MOIS[(k - 1) % 12]} ${Math.floor((k - 1) / 12)}`;

// Colonne ran.origine (025) : tant qu'elle n'existe pas (démarrage en cours),
// toute ligne ran rattachée à un journal est lue comme un solde d'ouverture.
let origineOk = null;
const filtreOuverture = async () => {
  if (origineOk === null || origineOk === false) {
    const [r] = await Ran.sequelize.query(
      "SELECT 1 AS ok FROM information_schema.columns WHERE table_name = 'ran' AND column_name = 'origine'",
      { type: QueryTypes.SELECT });
    origineOk = Boolean(r);
  }
  return origineOk ? "AND origine = 'ouverture'" : '';
};

/**
 * Situation d'un ou plusieurs journaux pour un mois, en UNE requête.
 * Renvoie Map(journal_id → { ran, entrees, sorties, solde, ran_source, cle_ouverture }).
 * ran_source : 'ouverture' (RAN saisi ce mois-ci) | 'report' (solde du mois précédent).
 */
const soldesJournaux = async (tenantId, mois, annee, journalIds) => {
  const ids = [...new Set(journalIds.map(Number))].filter((n) => n > 0);
  const res = new Map();
  if (!ids.length) return res;
  const k = cle(mois, annee);
  const fo = await filtreOuverture();
  const rows = await Ran.sequelize.query(`
    WITH o AS (SELECT journal_id, ${SQL_CLE} AS k, montant FROM ran
                WHERE tenant_id = :t AND journal_id IN (:ids) ${fo}),
         m AS (SELECT journal_id, ${SQL_CLE} AS k, COALESCE(SUM(entree),0) AS e, COALESCE(SUM(sortie),0) AS s
                 FROM journal WHERE tenant_id = :t AND journal_id IN (:ids) GROUP BY 1, 2)
    SELECT j.id AS journal_id,
           COALESCE((SELECT SUM(montant) FROM o WHERE o.journal_id = j.id AND o.k <  :k), 0)
         + COALESCE((SELECT SUM(e - s)  FROM m WHERE m.journal_id = j.id AND m.k <  :k), 0) AS report,
           COALESCE((SELECT SUM(montant) FROM o WHERE o.journal_id = j.id AND o.k = :k), 0) AS ouverture,
           (SELECT COUNT(*) FROM o WHERE o.journal_id = j.id AND o.k = :k) AS a_ouverture,
           COALESCE((SELECT SUM(e) FROM m WHERE m.journal_id = j.id AND m.k = :k), 0) AS entrees,
           COALESCE((SELECT SUM(s) FROM m WHERE m.journal_id = j.id AND m.k = :k), 0) AS sorties,
           (SELECT MIN(o.k) FROM o WHERE o.journal_id = j.id) AS cle_ouverture
      FROM unnest(ARRAY[:ids]::int[]) AS j(id)`,
  { replacements: { t: tenantId, ids, k }, type: QueryTypes.SELECT });
  for (const r of rows) {
    const ran = (parseFloat(r.report) || 0) + (parseFloat(r.ouverture) || 0);
    const entrees = parseFloat(r.entrees) || 0;
    const sorties = parseFloat(r.sorties) || 0;
    res.set(Number(r.journal_id), {
      ran, entrees, sorties, solde: ran + entrees - sorties,
      ran_source: Number(r.a_ouverture) > 0 ? 'ouverture' : 'report',
      cle_ouverture: r.cle_ouverture ? Number(r.cle_ouverture) : null,
    });
  }
  return res;
};

const soldeJournal = async (tenantId, mois, annee, journalId) =>
  (await soldesJournaux(tenantId, mois, annee, [journalId])).get(Number(journalId))
  || { ran: 0, entrees: 0, sorties: 0, solde: 0, ran_source: 'report', cle_ouverture: null };

class ErreurComptable extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Un mois arrêté (ou suivi d'un mois arrêté) ne reçoit plus d'écriture :
// modifier M changerait le solde arrêté de M et de tous les mois suivants.
const verifierPeriodeOuverte = async (tenantId, journalId, mois, annee) => {
  if (!journalId) return;
  const [a] = await Ran.sequelize.query(
    `SELECT mois, annee FROM arrets_caisse
      WHERE tenant_id = :t AND journal_id = :j AND ${SQL_CLE} >= :k
      ORDER BY annee, ${SQL_CLE} LIMIT 1`,
    { replacements: { t: tenantId, j: journalId, k: cle(mois, annee) }, type: QueryTypes.SELECT }).catch(() => []);
  if (a) {
    throw new ErreurComptable(409, a.mois === mois && Number(a.annee) === Number(annee)
      ? `La caisse est arrêtée pour ${mois} ${annee} : aucune écriture ne peut plus y être ajoutée, modifiée ou supprimée. Faites d'abord réouvrir la caisse.`
      : `La caisse est arrêtée pour ${a.mois} ${a.annee} : une écriture sur ${mois} ${annee} modifierait ce solde arrêté. Faites d'abord réouvrir la caisse.`);
  }
};

// Ordre chronologique : une nouvelle écriture ne peut pas être datée avant la
// dernière écriture du même journal. Numéro (ordre d'enregistrement) et date
// progressent ainsi ensemble, sans antidatage.
// Renvoie { antidatee: true } quand l'écriture est acceptée EN RATTRAPAGE
// (date antérieure à la dernière écriture, permis par `journal.rattrapage`).
const verifierOrdreChronologique = async (tenantId, journalId, date, { rattrapage = false } = {}) => {
  if (!journalId || !date) return { antidatee: false };
  // Jour d'ouverture de la caisse (migration 032) : rien ne peut être daté avant.
  const [ouv] = await Ran.sequelize.query(
    `SELECT nom, to_jsonb(jx)->>'date_ouverture' AS date_ouverture FROM journaux jx WHERE id = :j AND tenant_id = :t`,
    { replacements: { t: tenantId, j: journalId }, type: QueryTypes.SELECT });
  if (ouv?.date_ouverture && String(date).slice(0, 10) < String(ouv.date_ouverture).slice(0, 10)) {
    const fr = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR');
    throw new ErreurComptable(409, `« ${ouv.nom} » a été ouverte le ${fr(ouv.date_ouverture)} : `
      + 'aucune opération ne peut être datée avant son ouverture.');
  }
  const [der] = await Ran.sequelize.query(
    `SELECT numero, date FROM journal WHERE tenant_id = :t AND journal_id = :j
      ORDER BY date DESC, numero DESC NULLS LAST LIMIT 1`,
    { replacements: { t: tenantId, j: journalId }, type: QueryTypes.SELECT });
  if (der && String(date).slice(0, 10) < String(der.date).slice(0, 10)) {
    if (rattrapage) return { antidatee: true };
    const fr = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR');
    throw new ErreurComptable(409, `Date antérieure à la dernière écriture de ce journal (n°${der.numero} du ${fr(der.date)}) : `
      + 'les écritures se saisissent dans l\'ordre chronologique. Datez l\'opération au '
      + `${fr(der.date)} ou après, en précisant la date réelle dans l'objet si besoin — `
      + 'ou demandez au directeur l\'autorisation de saisir en rattrapage.');
  }
  return { antidatee: false };
};

// Espèces, mobile money, carte : le solde ne peut jamais devenir négatif, ni
// sur le mois de l'écriture ni sur les mois suivants (qui en héritent).
// La banque est exclue (découvert possible).
const verifierSoldeNonNegatif = async (tenantId, journalId, mois, annee, delta) => {
  if (!journalId || !(delta < 0)) return;
  const [j] = await Ran.sequelize.query('SELECT type, nom FROM journaux WHERE id = :j AND tenant_id = :t',
    { replacements: { j: journalId, t: tenantId }, type: QueryTypes.SELECT });
  if (!j || j.type === 'banque') return;
  const fo = await filtreOuverture();
  const flux = await Ran.sequelize.query(`
    SELECT k, SUM(v) AS v FROM (
      SELECT ${SQL_CLE} AS k, montant AS v FROM ran WHERE tenant_id = :t AND journal_id = :j ${fo}
      UNION ALL
      SELECT ${SQL_CLE} AS k, COALESCE(entree,0) - COALESCE(sortie,0) FROM journal WHERE tenant_id = :t AND journal_id = :j
    ) x GROUP BY k ORDER BY k`, { replacements: { t: tenantId, j: journalId }, type: QueryTypes.SELECT });
  const k0 = cle(mois, annee);
  let cumul = 0;
  let pire = null;
  const cles = [...new Set([...flux.map((f) => Number(f.k)), k0])].sort((a, b) => a - b);
  const parCle = new Map(flux.map((f) => [Number(f.k), parseFloat(f.v) || 0]));
  for (const k of cles) {
    cumul += parCle.get(k) || 0;
    if (k >= k0) {
      const apres = cumul + delta;
      if (apres < -0.004 && (pire === null || apres < pire.solde)) pire = { k, solde: apres };
    }
  }
  if (pire) {
    const fmt = (n) => Math.round(n).toLocaleString('fr-FR');
    const dispo = pire.solde - delta;
    throw new ErreurComptable(409, `Solde insuffisant dans « ${j.nom} » : disponible ${fmt(dispo)} FCFA`
      + (pire.k !== k0 ? ` (au plus bas en ${libellePeriode(pire.k)})` : ` en ${mois} ${annee}`)
      + `, montant demandé ${fmt(-delta)} FCFA. Une caisse ne peut pas devenir négative.`);
  }
};

// ── Calcul solde final ───────────────────────────────────────────────────
const calcSoldeFinal = async (tenantId, mois, annee, filtre) => {
  if (filtre.journal_id) {
    const s = await soldeJournal(tenantId, mois, annee, filtre.journal_id);
    return { ran: s.ran, entrees: s.entrees, sorties: s.sorties, solde: s.solde };
  }
  const mvtWhere = { tenant_id: tenantId, mois, annee };
  if (filtre.journal_id) mvtWhere.journal_id = filtre.journal_id;
  else if (filtre.type_caisse) mvtWhere.type_caisse = filtre.type_caisse;

  const ranWhere = filtre.journal_id
    ? { tenant_id: tenantId, mois, annee, journal_id: filtre.journal_id }
    : filtre.type_caisse
      ? { tenant_id: tenantId, mois, annee, type_caisse: filtre.type_caisse, journal_id: null }
      : null;

  const [ranRow, mvtRow] = await Promise.all([
    ranWhere ? Ran.findOne({ where: ranWhere }) : Promise.resolve(null),
    Mouvement.findOne({
      where: mvtWhere,
      attributes: [
        [Mouvement.sequelize.fn('COALESCE', Mouvement.sequelize.fn('SUM', Mouvement.sequelize.col('entree')), 0), 'total_entrees'],
        [Mouvement.sequelize.fn('COALESCE', Mouvement.sequelize.fn('SUM', Mouvement.sequelize.col('sortie')), 0), 'total_sorties'],
      ],
      raw: true,
    }),
  ]);

  const ran     = parseFloat(ranRow?.montant || 0);
  const entrees = parseFloat(mvtRow?.total_entrees || 0);
  const sorties = parseFloat(mvtRow?.total_sorties || 0);
  return { ran, entrees, sorties, solde: ran + entrees - sorties };
};

// ── RAN automatique depuis mois précédent ────────────────────────────────
const autoRan = async (tenantId, mois, annee, filtre) => {
  // Journal : RAN calculé (ouverture ou report), aucune écriture en base.
  if (filtre.journal_id) return (await soldeJournal(tenantId, mois, annee, filtre.journal_id)).ran;
  const existingWhere = filtre.journal_id
    ? { tenant_id: tenantId, mois, annee, journal_id: filtre.journal_id }
    : { tenant_id: tenantId, mois, annee, type_caisse: filtre.type_caisse || 'especes', journal_id: null };

  const existing = await Ran.findOne({ where: existingWhere });
  if (existing) return parseFloat(existing.montant);

  const prev = moisPrecedent(mois, annee);
  const soldePrev = await calcSoldeFinal(tenantId, prev.mois, prev.annee, filtre);

  if (soldePrev.solde !== 0) {
    // Report automatique du solde du mois précédent. Une simple LECTURE ne
    // doit jamais échouer à cause de cette écriture opportuniste : en cas de
    // conflit, on renvoie quand même le montant calculé.
    try {
      await enregistrerRan({
        tenantId, mois, annee,
        journalId: filtre.journal_id || null,
        typeCaisse: filtre.type_caisse || 'especes',
        montant: soldePrev.solde,
      });
    } catch (err) {
      console.error('[Journal] autoRan (report non enregistré) :', err.code || err.message);
    }
    return soldePrev.solde;
  }
  return 0;
};

// ── Mise en attente d'une sortie bloquée (RG-03 / RG-06 / RG-04) ──────────
// Persiste la dépense dans mouvements_attente (hors calcul de solde), puis notifie
// le directeur (best-effort). Lève une erreur si la persistance échoue : on ne
// doit JAMAIS répondre "en attente" sans avoir réellement enregistré la dépense.
const mettreEnAttente = async ({ tenantId, userId, username }, m, motif, snap) => {
  const row = await MouvementAttente.create({
    tenant_id: tenantId, date: m.date, mois: m.mois, annee: m.annee,
    journal_id: m.journal_id, type_caisse: m.type_caisse, rubrique_code: m.rubrique_code,
    intitule: m.intitule, objet: m.objet || '', beneficiaire: m.beneficiaire || '',
    piece_identite: m.piece_identite || '', telephone: m.telephone || '', nui: String(m.nui || '').slice(0, 30),
    activite_id: m.activite_id || null,
    sortie: m.sortie, motif_attente: motif,
    montant_prevu: snap.montant_prevu || 0, cumul_sorties: snap.cumul || 0,
    created_by: userId,
  });
  // Notification directeur — best-effort, ne bloque jamais la réponse au caissier
  notif.notifyMouvementEnAttente({
    tenantId, mouvement: row, caissierNom: username, semaine: snap.semaine || null,
  }).catch(e => console.warn('[Journal] notif attente :', e.message));
  return row;
};

// ── Budget APPROUVÉ d'un mois de dépense (source unique) ──────────────────
// La demande de fonds du mois M-1 porte les prévisions (table budget,
// mois_applic = M) ; le directeur la valide (budget_validation sur le mois de
// SAISIE). Le budget approuvé du mois M = ces prévisions, et UNIQUEMENT pour
// le mois M (mois_applic), dès que leur mois de saisie est « valide ».
// Repli : anciennes demandes de fonds (table appel_fonds) approuvées.
// Renvoie { valide, source, parRubrique: Map(code → montant), saisie: {mois, annee} | null }.
//
// Budget hebdomadaire (040) — option `semaine` = k : budget approuvé CUMULÉ
// des semaines 1..k du mois (seules les semaines validées comptent ; le non
// dépensé d'une semaine se reporte sur les suivantes, jamais sur le mois
// suivant). `valide` = la semaine k elle-même est validée.
const budgetApprouve = async (tenantId, mois, annee, { semaine = null } = {}) => {
  const seq = Mouvement.sequelize;
  if (semaine) {
    const k = Number(semaine);
    const [rows, [v]] = await Promise.all([
      seq.query(`
        SELECT b.rubrique_code, SUM(b.montant) AS montant
          FROM budget b
          JOIN budget_validation v ON v.tenant_id = b.tenant_id AND v.mois = b.mois AND v.annee = b.annee
                                  AND v.semaine = b.semaine AND v.statut = 'valide'
         WHERE b.tenant_id = :t AND b.mois_applic = :m AND b.annee_applic = :a AND b.semaine BETWEEN 1 AND :k
         GROUP BY b.rubrique_code`,
      { replacements: { t: tenantId, m: mois, a: Number(annee), k }, type: QueryTypes.SELECT }),
      seq.query(`SELECT 1 AS ok FROM budget_validation
                  WHERE tenant_id = :t AND mois = :m AND annee = :a AND semaine = :k AND statut = 'valide'`,
      { replacements: { t: tenantId, m: mois, a: Number(annee), k }, type: QueryTypes.SELECT }),
    ]);
    return {
      valide: Boolean(v), source: 'demande_de_fonds_hebdo', semaine: k,
      parRubrique: new Map(rows.map((r) => [r.rubrique_code, parseFloat(r.montant) || 0])),
      saisie: { mois, annee: Number(annee), semaine: k },
    };
  }
  const rows = await seq.query(`
    SELECT b.rubrique_code, SUM(b.montant) AS montant, MIN(b.mois) AS mois_saisie, MIN(b.annee) AS annee_saisie
      FROM budget b
      JOIN budget_validation v ON v.tenant_id = b.tenant_id AND v.mois = b.mois AND v.annee = b.annee AND v.statut = 'valide'
                              AND v.semaine IS NULL
     WHERE b.tenant_id = :t AND b.mois_applic = :m AND b.annee_applic = :a AND b.semaine IS NULL
     GROUP BY b.rubrique_code`,
  { replacements: { t: tenantId, m: mois, a: Number(annee) }, type: QueryTypes.SELECT });
  if (rows.length) {
    return {
      valide: true, source: 'demande_de_fonds',
      parRubrique: new Map(rows.map((r) => [r.rubrique_code, parseFloat(r.montant) || 0])),
      saisie: { mois: rows[0].mois_saisie, annee: Number(rows[0].annee_saisie) },
    };
  }
  const anciens = await AppelFonds.findAll({
    where: { tenant_id: tenantId, mois_cible: mois, annee_cible: Number(annee), statut: { [Op.in]: ['approuve', 'partiellement_approuve'] } },
    attributes: ['rubrique_code', [seq.fn('COALESCE', seq.fn('SUM', seq.col('montant_approuve')), 0), 'v']],
    group: ['rubrique_code'], raw: true,
  });
  return {
    valide: anciens.length > 0, source: anciens.length ? 'appel_fonds' : null,
    parRubrique: new Map(anciens.map((r) => [r.rubrique_code, parseFloat(r.v) || 0])),
    saisie: null,
  };
};

// ── Contrôle budgétaire d'une SORTIE (RG-03 / RG-06 / RG-04) ──────────────
// Priorité : mois non validé → plafond journal → montant prévu rubrique.
// Retourne { bloque, motif, message, plafond, montant_prevu, cumul, warning }.
// excludeId : mouvement à exclure des cumuls (cas d'une modification).
const controleBudgetSortie = async (tenantId, p) => {
  const jid     = p.journal_id ? parseInt(p.journal_id, 10) : null;
  const an      = parseInt(p.annee, 10);
  const montant = parseFloat(p.sortie) || 0;
  const fmt     = n => (parseFloat(n) || 0).toLocaleString('fr-FR');

  // Exclusion de l'écriture en cours (cas d'une modification uniquement).
  const hasExcl = p.excludeId !== undefined && p.excludeId !== null && p.excludeId !== '';
  const exclId  = hasExcl ? Number(p.excludeId) : null;

  // Référence budgétaire = montant APPROUVÉ de la rubrique dans la demande de fonds
  // (statuts 'approuve' et 'partiellement_approuve'), pour la période cible.
  const sortiesRubriqueWhere = { tenant_id: tenantId, mois: p.mois, annee: an, rubrique_code: p.rubrique_code };
  if (hasExcl) sortiesRubriqueWhere.id = { [Op.ne]: exclId };

  // Virement interne entre caisses (rubrique marquée « virement interne ») :
  // ce n'est pas une dépense, il n'entre pas dans le budget.
  const [rub] = await Mouvement.sequelize.query(
    'SELECT est_virement_interne FROM rubriques WHERE tenant_id = :t AND code = :c LIMIT 1',
    { replacements: { t: tenantId, c: p.rubrique_code }, type: QueryTypes.SELECT });
  if (rub && rub.est_virement_interne) {
    return { bloque: false, motif: null, montant_prevu: 0, cumul: 0, plafond: 0, warning: null };
  }

  // Budget hebdomadaire (040) : contrôle cumulé des semaines 1..k du mois.
  if (await hebdo.estHebdo(tenantId, p.mois, an)) {
    return controleBudgetSortieHebdo(tenantId, { ...p, jid, an, montant, exclId: hasExcl ? exclId : null });
  }

  const [budget, srVal] = await Promise.all([
    budgetApprouve(tenantId, p.mois, an),
    Mouvement.sum('sortie', { where: sortiesRubriqueWhere }),
  ]);
  const approuveVal = budget.parRubrique.get(p.rubrique_code) || 0;

  // Plafond du journal (budget_caisse) — requête SÉPARÉE et tolérante :
  // un souci sur cette table (ex. schéma) ne doit pas faire tomber tout le contrôle.
  let plafond = 0;
  let sj = 0;
  if (jid) {
    const sortiesJournalWhere = { tenant_id: tenantId, journal_id: jid, mois: p.mois, annee: an };
    if (hasExcl) sortiesJournalWhere.id = { [Op.ne]: exclId };
    sj = (await Mouvement.sum('sortie', { where: sortiesJournalWhere })) || 0;
    try {
      plafond = (await BudgetCaisse.sum('montant', {
        where: { tenant_id: tenantId, journal_id: jid, mois: p.mois, annee: an },
      })) || 0;
    } catch (plafondErr) {
      console.warn('[Journal] plafond budget_caisse ignoré :', plafondErr.message);
      plafond = 0;
    }
  }

  const approuve = approuveVal || 0;
  const sr       = srVal || 0;
  let warning    = null;

  // ── CŒUR · Budget de la rubrique = montant approuvé (demande de fonds) ────
  // 1. Rubrique sans budget approuvé → dépense non prévue → blocage.
  if (!budget.valide) {
    return { bloque: true, motif: 'mois_non_valide', montant_prevu: 0, cumul: sr, plafond,
      message: `la demande de fonds pour ${p.mois} ${an} n'est pas encore validée par le directeur. Sortie mise en attente : le directeur doit l'autoriser.` };
  }
  if (approuve <= 0) {
    return { bloque: true, motif: 'rubrique_non_approuvee', montant_prevu: 0, cumul: sr, plafond,
      message: `la rubrique "${p.rubrique_code}" n'a pas de budget approuvé dans la demande de fonds de ${p.mois} ${an}. Sortie mise en attente : le directeur doit l'autoriser.` };
  }
  // 2. Cumul des sorties de la rubrique > montant approuvé → dépassement → blocage.
  const apresR = sr + montant;
  if (apresR > approuve) {
    return { bloque: true, motif: 'depassement_rubrique', montant_prevu: approuve, cumul: sr, plafond,
      message: `la rubrique "${p.rubrique_code}" dépasse le budget approuvé de ${fmt(apresR - approuve)} FCFA (approuvé : ${fmt(approuve)} FCFA). Sortie mise en attente : autorisation du directeur requise.` };
  }
  const tauxR = Math.round((apresR / approuve) * 100);
  if (tauxR >= 80) warning = { type: 'rubrique', taux: tauxR, restant: approuve - apresR, rubrique_code: p.rubrique_code,
    message: tauxR >= 95
      ? `🔴 Rubrique ${p.rubrique_code} quasi-épuisée : ${tauxR}% du budget approuvé consommé.`
      : `🟡 Rubrique ${p.rubrique_code} consommée à ${tauxR}% — restant : ${fmt(approuve - apresR)} FCFA.` };

  // ── Garde-fou SECONDAIRE · Plafond global du journal (optionnel) ──────────
  if (plafond > 0) {
    const apres = sj + montant;
    if (apres > plafond) {
      return { bloque: true, motif: 'depassement_journal', montant_prevu: plafond, cumul: sj, plafond,
        message: `le plafond de caisse est dépassé de ${fmt(apres - plafond)} FCFA. Sortie mise en attente : autorisation du directeur requise.` };
    }
    const taux = Math.round((apres / plafond) * 100);
    if (taux >= 80 && !warning) warning = { type: 'journal', taux, restant: plafond - apres,
      message: taux >= 95
        ? `🔴 Plafond caisse quasi-épuisé : ${taux}% consommé, il reste ${fmt(plafond - apres)} FCFA.`
        : `🟡 Plafond caisse consommé à ${taux}% — restant : ${fmt(plafond - apres)} FCFA.` };
  }

  return { bloque: false, motif: null, montant_prevu: approuve, cumul: sr, plafond, warning };
};

// ── Contrôle d'une SORTIE pour un client au budget HEBDOMADAIRE (040) ─────
// Semaine k = semaine (dans son mois) de la DATE de l'écriture.
//   1. semaine k non validée                         → attente (semaine_non_validee)
//   2. rubrique sans budget approuvé sur S1..k        → attente (rubrique_non_approuvee)
//   3. sorties de la rubrique depuis le 1er (≤ fin Sk) + montant > approuvé cumulé
//                                                     → attente (depassement_rubrique)
//   4. plafond de caisse cumulé S1..k dépassé         → attente (depassement_journal)
// Le report du non-dépensé est donc automatique à l'intérieur du mois.
const controleBudgetSortieHebdo = async (tenantId, p) => {
  const fmt = (n) => (parseFloat(n) || 0).toLocaleString('fr-FR');
  if (!p.date) throw new Error('Date de l\'écriture requise pour le contrôle hebdomadaire.');
  const sem = hebdo.semaineDeDate(p.date);
  const k = sem.semaine;
  const debutMois = `${String(p.date).slice(0, 8)}01`;
  const periode = { [Op.between]: [debutMois, sem.fin] };
  const lib = `la semaine ${k} (du ${sem.debut.slice(8)} au ${sem.fin.slice(8)} ${p.mois})`;

  const whereR = { tenant_id: tenantId, mois: p.mois, annee: p.an, rubrique_code: p.rubrique_code, date: periode };
  if (p.exclId !== null && p.exclId !== undefined) whereR.id = { [Op.ne]: p.exclId };
  const [budget, srVal] = await Promise.all([
    budgetApprouve(tenantId, p.mois, p.an, { semaine: k }),
    Mouvement.sum('sortie', { where: whereR }),
  ]);
  const approuve = budget.parRubrique.get(p.rubrique_code) || 0;
  const sr = srVal || 0;

  let plafond = 0;
  let sj = 0;
  if (p.jid) {
    const whereJ = { tenant_id: tenantId, journal_id: p.jid, mois: p.mois, annee: p.an, date: periode };
    if (p.exclId !== null && p.exclId !== undefined) whereJ.id = { [Op.ne]: p.exclId };
    sj = (await Mouvement.sum('sortie', { where: whereJ })) || 0;
    try {
      plafond = (await BudgetCaisse.sum('montant', {
        where: { tenant_id: tenantId, journal_id: p.jid, mois: p.mois, annee: p.an, semaine: { [Op.between]: [1, k] } },
      })) || 0;
    } catch (plafondErr) {
      console.warn('[Journal] plafond budget_caisse (hebdo) ignoré :', plafondErr.message);
      plafond = 0;
    }
  }

  if (!budget.valide) {
    return { bloque: true, motif: 'semaine_non_validee', montant_prevu: 0, cumul: sr, plafond, semaine: k,
      message: `la demande de fonds de ${lib} n'est pas encore validée par le directeur. Sortie mise en attente : le directeur doit l'autoriser.` };
  }
  if (approuve <= 0) {
    return { bloque: true, motif: 'rubrique_non_approuvee', montant_prevu: 0, cumul: sr, plafond, semaine: k,
      message: `la rubrique "${p.rubrique_code}" n'a pas de budget approuvé jusqu'à ${lib}. Sortie mise en attente : le directeur doit l'autoriser.` };
  }
  const apresR = sr + p.montant;
  if (apresR > approuve) {
    return { bloque: true, motif: 'depassement_rubrique', montant_prevu: approuve, cumul: sr, plafond, semaine: k,
      message: `la rubrique "${p.rubrique_code}" dépasse de ${fmt(apresR - approuve)} FCFA le budget approuvé cumulé jusqu'à ${lib} (${fmt(approuve)} FCFA). Sortie mise en attente : autorisation du directeur requise.` };
  }
  let warning = null;
  const tauxR = Math.round((apresR / approuve) * 100);
  if (tauxR >= 80) warning = { type: 'rubrique', taux: tauxR, restant: approuve - apresR, rubrique_code: p.rubrique_code, semaine: k,
    message: `${tauxR >= 95 ? '🔴' : '🟡'} Rubrique ${p.rubrique_code} : ${tauxR}% du budget cumulé jusqu'à la semaine ${k} — reste ${fmt(approuve - apresR)} FCFA.` };
  if (plafond > 0) {
    const apres = sj + p.montant;
    if (apres > plafond) {
      return { bloque: true, motif: 'depassement_journal', montant_prevu: plafond, cumul: sj, plafond, semaine: k,
        message: `le plafond de caisse cumulé jusqu'à ${lib} est dépassé de ${fmt(apres - plafond)} FCFA. Sortie mise en attente : autorisation du directeur requise.` };
    }
    const taux = Math.round((apres / plafond) * 100);
    if (taux >= 80 && !warning) warning = { type: 'journal', taux, restant: plafond - apres, semaine: k,
      message: `${taux >= 95 ? '🔴' : '🟡'} Plafond caisse : ${taux}% consommé jusqu'à la semaine ${k} — reste ${fmt(plafond - apres)} FCFA.` };
  }
  return { bloque: false, motif: null, montant_prevu: approuve, cumul: sr, plafond, semaine: k, warning };
};

// ── Disponible d'une rubrique à une date (affichage à la saisie) ─────────
// Même calcul que le contrôle, sans le montant saisi.
const disponibleRubrique = async (tenantId, { date, mois, annee, journal_id, rubrique_code }) => {
  const an = Number(annee);
  const hebdoMois = await hebdo.estHebdo(tenantId, mois, an);
  const sem = hebdoMois ? hebdo.semaineDeDate(date) : null;
  const where = { tenant_id: tenantId, mois, annee: an, rubrique_code,
    ...(sem ? { date: { [Op.between]: [`${String(date).slice(0, 8)}01`, sem.fin] } } : {}) };
  const [budget, sr] = await Promise.all([
    budgetApprouve(tenantId, mois, an, sem ? { semaine: sem.semaine } : {}),
    Mouvement.sum('sortie', { where }),
  ]);
  const approuve = budget.parRubrique.get(rubrique_code) || 0;
  return {
    periodicite: hebdoMois ? 'hebdomadaire' : 'mensuel',
    semaine: sem ? sem.semaine : null, libelle: sem ? sem.libelle : `${mois} ${an}`,
    valide: budget.valide, approuve, consomme: sr || 0, reste: approuve - (sr || 0), journal_id: journal_id || null,
  };
};

// ── Situation du mois de plusieurs journaux (lecture seule) ─────────────
// RAN + entrées − sorties, calculé EXACTEMENT comme la page du journal :
// RAN saisi/enregistré s'il existe, sinon report du solde du mois précédent.
// Utilisé par le tableau de bord et le récapitulatif, qui affichaient
// jusqu'ici des chiffres différents de la page journal (RAN ignoré ou à 0).
// N'écrit rien : une page de synthèse ne doit pas créer de RAN.
const situationJournaux = async (tenantId, mois, annee, journaux) => {
  const ids = journaux.map((j) => j.id);
  if (ids.length === 0) return [];
  const { ArretCaisse } = require('../models');
  const [soldes, nbRows, arrets] = await Promise.all([
    soldesJournaux(tenantId, mois, annee, ids),
    Mouvement.findAll({
      where: { tenant_id: tenantId, mois, annee, journal_id: ids },
      attributes: ['journal_id', [Mouvement.sequelize.fn('COUNT', Mouvement.sequelize.col('id')), 'nb']],
      group: ['journal_id'], raw: true,
    }),
    ArretCaisse.findAll({ where: { tenant_id: tenantId, mois, annee, journal_id: ids }, attributes: ['journal_id', 'solde_final', 'arrete_le'], raw: true }),
  ]);
  const nbBy = new Map(nbRows.map((m) => [m.journal_id, parseInt(m.nb, 10) || 0]));
  const arretBy = new Map(arrets.map((a) => [a.journal_id, { solde_arrete: parseFloat(a.solde_final) || 0, arrete_le: a.arrete_le }]));
  return journaux.map((j) => {
    const s = soldes.get(Number(j.id)) || { ran: 0, entrees: 0, sorties: 0, solde: 0, ran_source: 'report' };
    return {
      ...j,
      ran: s.ran, ran_reporte: s.ran_source === 'report', total_entrees: s.entrees, total_sorties: s.sorties,
      nb_mouvements: nbBy.get(j.id) || 0,
      solde_final: s.solde,
      arrete: arretBy.get(j.id) || null,
    };
  });
};

module.exports = {
  budgetApprouve,
  situationJournaux, soldesJournaux, soldeJournal, verifierPeriodeOuverte, verifierSoldeNonNegatif, verifierOrdreChronologique,
  ErreurComptable, cle, SQL_CLE, filtreOuverture,
  MOIS, moisPrecedent, resolveFiltre, calcSoldeFinal, autoRan,
  typeCaisseDuJournal, enregistrerRan,
  mettreEnAttente, controleBudgetSortie, controleBudgetSortieHebdo, disponibleRubrique,
};
