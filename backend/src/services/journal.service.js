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

const MOIS = ['Janvier','Fevrier','Mars','Avril','Mai','Juin',
              'Juillet','Aout','Septembre','Octobre','Novembre','Decembre'];

// ── Mois précédent ───────────────────────────────────────────────────────
const moisPrecedent = (mois, annee) => {
  const idx = MOIS.indexOf(mois);
  if (idx === 0) return { mois: MOIS[11], annee: annee - 1 };
  return { mois: MOIS[idx - 1], annee };
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
    const typeCaisse = ['om', 'momo', 'carte_prepayee'].includes(j.type) ? 'om' : 'especes';
    return { journal_id: j.id, type_caisse: typeCaisse };
  }
  if (caisse) {
    return { journal_id: null, type_caisse: caisse };
  }
  return { journal_id: null, type_caisse: null };
};

// ── Calcul solde final ───────────────────────────────────────────────────
const calcSoldeFinal = async (tenantId, mois, annee, filtre) => {
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
  const existingWhere = filtre.journal_id
    ? { tenant_id: tenantId, mois, annee, journal_id: filtre.journal_id }
    : { tenant_id: tenantId, mois, annee, type_caisse: filtre.type_caisse || 'especes', journal_id: null };

  const existing = await Ran.findOne({ where: existingWhere });
  if (existing) return parseFloat(existing.montant);

  const prev = moisPrecedent(mois, annee);
  const soldePrev = await calcSoldeFinal(tenantId, prev.mois, prev.annee, filtre);

  if (soldePrev.solde !== 0) {
    if (filtre.journal_id) {
      await Ran.findOrCreate({
        where: { tenant_id: tenantId, mois, annee, journal_id: filtre.journal_id },
        defaults: { type_caisse: filtre.type_caisse || 'especes', montant: soldePrev.solde },
      });
    } else {
      await Ran.findOrCreate({
        where: { tenant_id: tenantId, mois, annee, type_caisse: filtre.type_caisse || 'especes' },
        defaults: { montant: soldePrev.solde },
      });
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
    piece_identite: m.piece_identite || '', telephone: m.telephone || '',
    sortie: m.sortie, motif_attente: motif,
    montant_prevu: snap.montant_prevu || 0, cumul_sorties: snap.cumul || 0,
    created_by: userId,
  });
  // Notification directeur — best-effort, ne bloque jamais la réponse au caissier
  notif.notifyMouvementEnAttente({
    tenantId, mouvement: row, caissierNom: username,
  }).catch(e => console.warn('[Journal] notif attente :', e.message));
  return row;
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

  const [approuveVal, srVal] = await Promise.all([
    AppelFonds.sum('montant_approuve', {
      where: {
        tenant_id: tenantId, rubrique_code: p.rubrique_code,
        mois_cible: p.mois, annee_cible: an,
        statut: { [Op.in]: ['approuve', 'partiellement_approuve'] },
      },
    }),
    Mouvement.sum('sortie', { where: sortiesRubriqueWhere }),
  ]);

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

module.exports = {
  MOIS, moisPrecedent, resolveFiltre, calcSoldeFinal, autoRan,
  mettreEnAttente, controleBudgetSortie,
};
