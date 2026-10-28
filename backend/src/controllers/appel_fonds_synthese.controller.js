// src/controllers/appel_fonds_synthese.controller.js
// Synthèse Demande de Fonds — transposition de prev_ui / app_26.r
// treso_dispo <- tres + total_ress  (formule R)
const { Banque, Journal, RessourceAttente, DepenseAttente, Budget, BudgetValidation, User } = require('../models');
const { situationJournaux } = require('../services/journal.service');
const hebdo = require('../services/budget_hebdo.service');

const FAMILLE = (type) => (type === 'banque' ? 'banque'
  : ['om', 'momo', 'carte_prepayee'].includes(type) ? 'mobile' : 'especes');

const MOIS = ['Janvier','Fevrier','Mars','Avril','Mai','Juin',
              'Juillet','Aout','Septembre','Octobre','Novembre','Decembre'];

const moisSuivant = (mois, annee) => {
  const idx = MOIS.indexOf(mois);
  if (idx === 11) return { mois: MOIS[0], annee: annee + 1 };
  return { mois: MOIS[idx + 1], annee };
};

// GET /api/appel-fonds/synthese?mois=&annee=[&semaine=]
// Budget hebdomadaire (040) : `semaine` = semaine EN COURS du mois ; la
// demande porte alors sur la semaine suivante (éventuellement S1 du mois
// suivant). En mensuel, la demande d'un mois porte sur le mois suivant ;
// si ce mois suivant est hebdomadaire, elle porte sur sa semaine 1.
const getSynthese = async (req, res) => {
  const { mois, annee } = req.query;
  if (!mois || !annee) {
    return res.status(400).json({ error: 'Paramètres mois et annee requis.' });
  }
  const an = parseInt(annee, 10);
  const tenantId = req.tenantId;

  try {
    const semaine = await hebdo.exigerSemaine(tenantId, mois, an, req.query.semaine);
    let next = semaine ? hebdo.semaineSuivante(mois, an, semaine) : { ...moisSuivant(mois, an), semaine: null };
    const cibleHebdo = await hebdo.estHebdo(tenantId, next.mois, next.annee);
    if (cibleHebdo && !next.semaine) next = { ...next, semaine: 1 };
    if (!cibleHebdo && next.semaine) next = { ...next, semaine: null };
    const semCible = next.semaine ? hebdo.semainesDuMois(next.mois, next.annee).find((x) => x.num === next.semaine) : null;
    const libelleCible = semCible ? `${semCible.libelle} — ${next.mois} ${next.annee}` : `${next.mois} ${next.annee}`;
    // ── 1. Trésorerie courante — détaillée par journal (caisse) ─────────────
    // Chaque caisse = son SOLDE DU MOIS (RAN + entrées − sorties), calculé
    // comme sur la page journal et le tableau de bord. La banque provient du
    // solde du mois de son journal banque (plus de saisie manuelle).
    // Repli : sans journal banque actif, ancien solde saisi (table banque).
    const journaux = await Journal.findAll({
      where: { tenant_id: tenantId, actif: true },
      attributes: ['id', 'nom', 'type', 'code', 'ordre'],
      order: [['ordre', 'ASC'], ['nom', 'ASC']],
      raw: true,
    });
    const [situation, banque, resAttRows, depAttRows] = await Promise.all([
      situationJournaux(tenantId, mois, an, journaux),
      Banque.findOne({ where: { tenant_id: tenantId, mois, annee: an } }),
      RessourceAttente.findAll({ where: { tenant_id: tenantId, mois, annee: an, semaine }, order: [['id', 'ASC']] }),
      DepenseAttente.findAll({ where: { tenant_id: tenantId, mois, annee: an, semaine }, order: [['id', 'ASC']] }),
    ]);
    const lignesTreso = situation.map((j) => ({
      id: j.id, nom: j.nom, code: j.code, type: j.type, famille: FAMILLE(j.type),
      ran: j.ran, entrees: j.total_entrees, sorties: j.total_sorties, solde: j.solde_final,
      arrete: Boolean(j.arrete),
    }));
    const somme = (f) => lignesTreso.filter((l) => l.famille === f).reduce((t, l) => t + (Number(l.solde) || 0), 0);
    const aJournalBanque = lignesTreso.some((l) => l.famille === 'banque');
    const solde_espece = somme('especes');
    const solde_om     = somme('mobile');
    const soldeBanque  = aJournalBanque ? somme('banque') : (parseFloat(banque?.solde_final) || 0);
    const total_tres   = solde_espece + solde_om + soldeBanque;

    // ── 2. Ressources & dépenses en attente ──────────────────────────────────
    const total_ressources = resAttRows.reduce((s, r) => s + parseFloat(r.montant || 0), 0);
    const total_attente    = depAttRows.reduce((s, r) => s + parseFloat(r.montant || 0), 0);

    // treso_dispo <- tres + total_ress  (formule R)
    const tresorerie_disponible    = total_tres + total_ressources;
    const tresorerie_apres_attente = tresorerie_disponible - total_attente;

    // ── 3. Prévision pour mois_cible ─────────────────────────────────────────
    // Budget saisi pour s'appliquer au mois suivant
    const prevRows = await Budget.findAll({
      where: { tenant_id: tenantId, mois_applic: next.mois, annee_applic: next.annee, semaine: next.semaine },
      order: [['rubrique_code', 'ASC']],
    });
    const total_prevision = prevRows.reduce((s, r) => s + parseFloat(r.montant || 0), 0);

    // ── 4. Validation (cherche sur le mois de saisie du budget applicable) ───
    // Le mois/année de saisie sont déjà portés par les lignes budget elles-mêmes
    // (mois, annee) — pas besoin d'une requête séparée pour les retrouver.
    // Semaine cible : la demande est identifiée par la semaine qu'elle finance.
    let moisSaisie = next.semaine ? next.mois : mois, anneeSaisie = next.semaine ? next.annee : an;
    if (prevRows.length > 0) {
      moisSaisie  = prevRows[0].mois;
      anneeSaisie = prevRows[0].annee;
    }

    const validationRow = await BudgetValidation.findOne({
      where: { tenant_id: tenantId, mois: moisSaisie, annee: anneeSaisie, semaine: next.semaine },
      include: [{ model: User, as: 'validateur', attributes: ['username'], required: false }],
    });
    let validation = { statut: 'en_attente' };
    if (validationRow) {
      const { validateur, ...rest } = validationRow.toJSON();
      validation = { ...rest, validated_by_nom: validateur ? validateur.username : null };
    }

    // ── 5. Bilan ──────────────────────────────────────────────────────────────
    const besoin   = Math.max(0, total_prevision - tresorerie_disponible);
    const excedent = Math.max(0, tresorerie_disponible - total_prevision);

    res.json({
      mois,
      annee: an,
      mois_cible:  next.mois,
      annee_cible: next.annee,
      // Budget hebdomadaire (040)
      periodicite: semaine ? 'hebdomadaire' : 'mensuel',
      semaine, semaines: semaine ? hebdo.semainesDuMois(mois, an) : [],
      semaine_cible: next.semaine, libelle_cible: libelleCible,
      tresorerie: {
        solde_espece: solde_espece,
        solde_om:     solde_om,
        solde_banque: soldeBanque,
        total:        total_tres,
        journaux:     lignesTreso,
        banque_saisie_manuelle: !aJournalBanque,
      },
      tresorerie_apres_attente,
      ressources_attente: resAttRows,
      depenses_attente:   depAttRows,
      total_ressources,
      total_attente,
      prevision:          prevRows,
      total_prevision,
      validation,
      // Clé de la validation : mois de SAISIE de la demande (à renvoyer tel quel).
      mois_saisie: moisSaisie, annee_saisie: anneeSaisie, semaine_saisie: next.semaine,
      tresorerie_disponible,
      besoin,
      excedent,
    });

  } catch (err) {
    if (err instanceof hebdo.ErreurMetier) return res.status(err.status).json({ error: err.message });
    console.error('[AfSynthese] getSynthese :', err.message);
    res.status(500).json({ error: `Erreur serveur : ${err.message}` });
  }
};

module.exports = { getSynthese };
