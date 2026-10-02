// src/controllers/budget_caisse.controller.js
// Gestion du budget de dépense par journal/mois + demandes de dépassement
const { Op } = require('sequelize');
const { sequelize, BudgetCaisse, DemandeDepassement, Mouvement, Journal, User, Tenant } = require('../models');
const { sendDepassementAlert } = require('../services/email.service');
const { usersAvecPermission } = require('../services/permission.service');

// ── GET /api/budget-caisse?journal_id=&mois=&annee= ──────────────────────
const getBudgetCaisse = async (req, res) => {
  const { journal_id, mois, annee } = req.query;
  if (!journal_id || !mois || !annee) {
    return res.status(400).json({ error: 'journal_id, mois et annee requis.' });
  }
  try {
    const jid = parseInt(journal_id, 10);
    const an  = parseInt(annee, 10);
    const [bc, sortiesVal, depNb, depTotal] = await Promise.all([
      BudgetCaisse.findOne({
        where: { tenant_id: req.tenantId, journal_id: jid, mois, annee: an },
        include: [{ model: User, attributes: ['username'], required: false }],
      }),
      // Sorties réelles du mois (hors demandes en attente)
      Mouvement.sum('sortie', { where: { tenant_id: req.tenantId, journal_id: jid, mois, annee: an } }),
      // Demandes de dépassement en attente (sorties bloquées)
      DemandeDepassement.count({ where: { tenant_id: req.tenantId, journal_id: jid, mois, annee: an, statut: 'en_attente' } }),
      DemandeDepassement.sum('sortie', { where: { tenant_id: req.tenantId, journal_id: jid, mois, annee: an, statut: 'en_attente' } }),
    ]);

    if (!bc) return res.json(null);

    const sorties_actuelles  = sortiesVal || 0;
    const en_attente_nb      = depNb || 0;
    const en_attente_montant = depTotal || 0;
    const budget_montant     = parseFloat(bc.montant) || 0;
    const taux_consommation  = budget_montant > 0
      ? Math.round((sorties_actuelles / budget_montant) * 100)
      : null;
    const restant = budget_montant > 0 ? budget_montant - sorties_actuelles : null;
    const alerte  = taux_consommation !== null
      ? taux_consommation >= 100 ? 'depasse'
        : taux_consommation >= 95 ? 'critique'
        : taux_consommation >= 80 ? 'attention'
        : 'ok'
      : null;

    const { User: setParUser, ...rest } = bc.toJSON();
    res.json({
      ...rest, set_par_nom: setParUser ? setParUser.username : null,
      sorties_actuelles, taux_consommation, restant, alerte, en_attente_nb, en_attente_montant,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── PUT /api/budget-caisse ───────────────────────────────────────────────
const setBudgetCaisse = async (req, res) => {
  const { journal_id, mois, annee, montant } = req.body;
  if (!journal_id || !mois || !annee) {
    return res.status(400).json({ error: 'journal_id, mois et annee requis.' });
  }
  try {
    const budget = await sequelize.transaction(async (t) => {
      const [row] = await BudgetCaisse.findOrCreate({
        where: { tenant_id: req.tenantId, journal_id: parseInt(journal_id, 10), mois, annee: parseInt(annee, 10) },
        defaults: {},
        transaction: t, lock: t.LOCK.UPDATE,
      });
      row.montant    = parseFloat(montant) || 0;
      row.set_par    = req.user.id;
      row.updated_at = new Date();
      await row.save({ transaction: t });
      return row;
    });
    res.json(budget);
  } catch (err) {
    console.error('[BudgetCaisse] setBudgetCaisse :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── DELETE /api/budget-caisse ────────────────────────────────────────────
const deleteBudgetCaisse = async (req, res) => {
  const { journal_id, mois, annee } = req.query;
  try {
    await BudgetCaisse.destroy({
      where: { tenant_id: req.tenantId, journal_id: parseInt(journal_id, 10), mois, annee: parseInt(annee, 10) },
    });
    res.json({ message: 'Budget supprimé.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── GET /api/budget-caisse/depassements?statut=en_attente ───────────────
const getDepassements = async (req, res) => {
  const statut = req.query.statut || 'en_attente';
  try {
    const where = { tenant_id: req.tenantId };
    if (statut !== 'all') where.statut = statut;
    const demandes = await DemandeDepassement.findAll({
      where,
      include: [
        { model: Journal, attributes: ['nom', 'code', 'type'], required: false },
        { model: User, as: 'demandeur', attributes: ['username'], required: false },
        { model: User, as: 'validateur', attributes: ['username'], required: false },
      ],
      order: [['created_at', 'DESC']],
    });
    const rows = demandes.map(d => {
      const { Journal: jx, demandeur, validateur, ...rest } = d.toJSON();
      return {
        ...rest,
        journal_nom: jx?.nom || null, journal_code: jx?.code || null, journal_type: jx?.type || null,
        demandeur_nom: demandeur ? demandeur.username : null,
        valideur_nom: validateur ? validateur.username : null,
      };
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── POST /api/budget-caisse/demande ─────────────────────────────────────
// Caissière soumet une demande de dépassement
const createDemande = async (req, res) => {
  const {
    journal_id, mois, annee, date_mvt,
    rubrique_code, intitule, objet, beneficiaire,
    piece_identite, telephone, sortie,
    budget_montant, sorties_actuelles, depassement,
    type_depassement,
  } = req.body;

  if (!journal_id || !mois || !annee || !rubrique_code || !intitule || !sortie) {
    return res.status(400).json({ error: 'Champs obligatoires manquants.' });
  }

  try {
    const beneficiaireVal = beneficiaire || '';

    // ── Anti-doublon : même paiement déjà en attente ? ──────────────────
    const existing = await DemandeDepassement.findOne({
      where: {
        tenant_id: req.tenantId, journal_id: parseInt(journal_id, 10), mois, annee: parseInt(annee, 10),
        rubrique_code, sortie: parseFloat(sortie), statut: 'en_attente', beneficiaire: beneficiaireVal,
      },
    });
    if (existing) {
      return res.status(409).json({
        error: 'Une demande identique est déjà en attente de validation.',
        existing_id: existing.id,
      });
    }

    // Récupérer infos journal
    const journal = await Journal.findOne({
      where: { id: parseInt(journal_id, 10), tenant_id: req.tenantId },
      include: [{ model: Tenant, attributes: ['nom'], required: false }],
    });
    if (!journal) return res.status(404).json({ error: 'Journal introuvable.' });
    const journalNom = journal.nom;
    const tenantNom  = journal.Tenant?.nom;

    const caissierNom = req.user.username;
    const typeD = ['journal', 'rubrique', 'sans_budget'].includes(type_depassement) ? type_depassement : 'journal';

    const demande = await DemandeDepassement.create({
      tenant_id: req.tenantId, journal_id: parseInt(journal_id, 10), mois, annee: parseInt(annee, 10),
      date_mvt, rubrique_code, intitule,
      objet: objet || '', beneficiaire: beneficiaireVal, piece_identite: piece_identite || '', telephone: telephone || '',
      sortie: parseFloat(sortie), budget_montant: parseFloat(budget_montant) || 0,
      sorties_actuelles: parseFloat(sorties_actuelles) || 0, depassement: parseFloat(depassement) || 0,
      demande_par: req.user.id, demandeur_nom: caissierNom, statut: 'en_attente', type_depassement: typeD,
    });

    // Destinataires : toute personne active qui peut VALIDER la demande
    // (permission budget.demande_validate), et non le premier « directeur »
    // trouvé — la règle d'autorisation et la règle de notification coïncident.
    const valideurs = (await usersAvecPermission(req.tenantId, 'budget.demande_validate'))
      .filter((u) => u.email);

    let emailSent = false;
    for (const directeur of valideurs) {
      const { sent } = await sendDepassementAlert({
        dirEmail:         directeur.email,
        dirNom:           directeur.username,
        tenantNom, journalNom, caissierNom,
        mois, annee,
        sortie:           parseFloat(sortie),
        budgetMontant:    parseFloat(budget_montant) || 0,
        sortiesActuelles: parseFloat(sorties_actuelles) || 0,
        depassement:      parseFloat(depassement) || 0,
        intitule, beneficiaire,
        demandeId: demande.id,
      });
      emailSent = emailSent || sent;
    }

    res.status(201).json({ ...demande.toJSON(), email_sent: emailSent });
  } catch (err) {
    console.error('[BudgetCaisse] createDemande :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── PATCH /api/budget-caisse/demande/:id/statut ─────────────────────────
// Directeur valide ou rejette une demande
const validerDemande = async (req, res) => {
  const { statut, commentaire } = req.body;
  if (!['approuve', 'rejete'].includes(statut)) {
    return res.status(400).json({ error: "statut doit être 'approuve' ou 'rejete'." });
  }
  const demandeId = parseInt(req.params.id, 10);

  try {
    await sequelize.transaction(async (t) => {
      const d = await DemandeDepassement.findOne({
        where: { id: demandeId, tenant_id: req.tenantId },
        transaction: t, lock: t.LOCK.UPDATE,
      });
      if (!d) { const e = new Error('NOT_FOUND'); e.code = 'NOT_FOUND'; throw e; }
      if (d.statut !== 'en_attente') { const e = new Error('ALREADY_HANDLED'); e.code = 'ALREADY_HANDLED'; throw e; }

      d.statut = statut;
      d.commentaire_dir = commentaire || '';
      d.valide_par = req.user.id;
      d.valide_le = new Date();
      await d.save({ transaction: t });

      // Si approuvé → créer le mouvement dans journal
      if (statut === 'approuve') {
        let resolvedCaisse = 'especes';
        const journal = await Journal.findOne({ where: { id: d.journal_id }, attributes: ['type'], transaction: t });
        if (journal?.type) resolvedCaisse = ['om', 'momo', 'carte_prepayee'].includes(journal.type) ? 'om' : 'especes';

        // Objet enrichi avec la référence de la demande pour traçabilité comptable
        const objetTrace = d.objet
          ? `${d.objet} [Dépassement autorisé réf. #${demandeId}]`
          : `[Dépassement autorisé réf. #${demandeId}]`;

        await Mouvement.create({
          tenant_id: req.tenantId, date: d.date_mvt, mois: d.mois, annee: d.annee,
          journal_id: d.journal_id, type_caisse: resolvedCaisse,
          rubrique_code: d.rubrique_code, intitule: d.intitule, objet: objetTrace, beneficiaire: d.beneficiaire,
          piece_identite: d.piece_identite, telephone: d.telephone,
          entree: 0, sortie: d.sortie, created_by: req.user.id,
        }, { transaction: t });
      }
    });

    res.json({ message: `Demande ${statut === 'approuve' ? 'approuvée et mouvement enregistré' : 'rejetée'}.` });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: 'Demande introuvable.' });
    if (err.code === 'ALREADY_HANDLED') return res.status(409).json({ error: 'Cette demande a déjà été traitée.' });
    console.error('[BudgetCaisse] validerDemande :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── DELETE /api/budget-caisse/demande/:id ───────────────────────────────
const deleteDemande = async (req, res) => {
  try {
    await DemandeDepassement.destroy({ where: { id: parseInt(req.params.id, 10), tenant_id: req.tenantId } });
    res.json({ message: 'Demande supprimée.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── GET /api/budget-caisse/depassements/count ────────────────────────────
// Nombre de demandes en attente (badge notification)
const countDepassements = async (req, res) => {
  try {
    const count = await DemandeDepassement.count({ where: { tenant_id: req.tenantId, statut: 'en_attente' } });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = {
  getBudgetCaisse, setBudgetCaisse, deleteBudgetCaisse,
  getDepassements, createDemande, validerDemande, deleteDemande,
  countDepassements,
};
