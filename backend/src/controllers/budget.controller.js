const { Op } = require('sequelize');
const { sequelize, Budget, BudgetValidation, DepenseAttente, RessourceAttente } = require('../models');

// ── GET /api/budget?mois=&annee= ──────────────────────────────────────────
// Renvoie le budget APPLICABLE au mois demandé :
//   1. d'abord celui saisi pour s'appliquer ce mois (mois_applic/annee_applic)
//   2. à défaut, le budget saisi directement ce mois-là
// La validation retournée est celle du mois de SAISIE du budget applicable.
const getBudget = async (req, res) => {
  const { mois, annee } = req.query;
  if (!mois || !annee) {
    return res.status(400).json({ error: 'Paramètres mois et annee requis.' });
  }
  const an = parseInt(annee, 10);
  try {
    // 1. Budget applicable (saisi un autre mois pour s'appliquer ici)
    let budgetRows = await Budget.findAll({
      where: { tenant_id: req.tenantId, mois_applic: mois, annee_applic: an },
      order: [['rubrique_code', 'ASC']],
    });

    // Mois de saisie (pour retrouver la bonne validation)
    let moisSaisie = mois, anneeSaisie = an;
    if (budgetRows.length > 0) {
      moisSaisie  = budgetRows[0].mois;
      anneeSaisie = budgetRows[0].annee;
    } else {
      // 2. Fallback : budget saisi directement ce mois
      budgetRows = await Budget.findAll({
        where: { tenant_id: req.tenantId, mois, annee: an },
        order: [['rubrique_code', 'ASC']],
      });
    }

    const [validation, depAtt, resAtt] = await Promise.all([
      BudgetValidation.findOne({
        where: { tenant_id: req.tenantId, mois: moisSaisie, annee: anneeSaisie },
        attributes: ['statut', 'commentaire', 'validated_at'],
      }),
      DepenseAttente.findAll({ where: { tenant_id: req.tenantId, mois, annee: an }, order: [['id', 'ASC']] }),
      RessourceAttente.findAll({ where: { tenant_id: req.tenantId, mois, annee: an }, order: [['id', 'ASC']] }),
    ]);

    res.json({
      dotations:          budgetRows,
      validation:         validation || { statut: 'en_attente' },
      mois_saisie:        moisSaisie,
      annee_saisie:       anneeSaisie,
      depenses_attente:   depAtt,
      ressources_attente: resAtt,
    });
  } catch (err) {
    console.error('[Budget] getBudget :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── PUT /api/budget ───────────────────────────────────────────────────────
const setBudgetLine = async (req, res) => {
  const { mois, annee, rubrique_code, intitule, montant, mois_applic, annee_applic } = req.body;
  if (!mois || !annee || !rubrique_code || !intitule) {
    return res.status(400).json({ error: 'Champs obligatoires manquants.' });
  }
  try {
    await sequelize.transaction(async (t) => {
      const [row] = await Budget.findOrCreate({
        where: { tenant_id: req.tenantId, mois, annee: parseInt(annee, 10), rubrique_code },
        defaults: { intitule },
        transaction: t, lock: t.LOCK.UPDATE,
      });
      row.intitule = intitule;
      row.montant = parseFloat(montant) || 0;
      row.mois_applic = mois_applic || '';
      row.annee_applic = parseInt(annee_applic, 10) || 0;
      await row.save({ transaction: t });
    });
    res.json({ message: 'Dotation mise à jour.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── POST /api/budget/validation ───────────────────────────────────────────
const setValidation = async (req, res) => {
  const { mois, annee, statut, commentaire } = req.body;
  try {
    await sequelize.transaction(async (t) => {
      const [row] = await BudgetValidation.findOrCreate({
        where: { tenant_id: req.tenantId, mois, annee: parseInt(annee, 10) },
        defaults: {},
        transaction: t, lock: t.LOCK.UPDATE,
      });
      row.statut = statut;
      row.commentaire = commentaire || '';
      row.validated_by = req.user.id;
      row.validated_at = new Date();
      await row.save({ transaction: t });
    });
    res.json({ message: `Budget ${statut}.` });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── POST /api/budget/depenses-attente ─────────────────────────────────────
const addDepenseAttente = async (req, res) => {
  const { mois, annee, rubrique_code, intitule, montant } = req.body;
  try {
    const row = await DepenseAttente.create({
      tenant_id: req.tenantId, mois, annee: parseInt(annee, 10), rubrique_code, intitule, montant: parseFloat(montant) || 0,
    });
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── DELETE /api/budget/:id ────────────────────────────────────────────────
const deleteBudgetLine = async (req, res) => {
  try {
    await Budget.destroy({ where: { id: req.params.id, tenant_id: req.tenantId } });
    res.json({ message: 'Ligne budget supprimée.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── DELETE /api/budget/depenses-attente/:id ───────────────────────────────
const deleteDepenseAttente = async (req, res) => {
  try {
    await DepenseAttente.destroy({ where: { id: parseInt(req.params.id, 10), tenant_id: req.tenantId } });
    res.json({ message: 'Dépense supprimée.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── POST /api/budget/ressources-attente ───────────────────────────────────
const addRessourceAttente = async (req, res) => {
  const { mois, annee, rubrique_code, intitule, montant } = req.body;
  try {
    const row = await RessourceAttente.create({
      tenant_id: req.tenantId, mois, annee: parseInt(annee, 10), rubrique_code, intitule, montant: parseFloat(montant) || 0,
    });
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── DELETE /api/budget/ressources-attente/:id ─────────────────────────────
const deleteRessourceAttente = async (req, res) => {
  try {
    await RessourceAttente.destroy({ where: { id: parseInt(req.params.id, 10), tenant_id: req.tenantId } });
    res.json({ message: 'Ressource supprimée.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── PUT /api/budget/depenses-attente/batch ────────────────────────────────
// Body: { mois, annee, lignes:[{rubrique_code,intitule,montant}, ...] }
// Stratégie DELETE+INSERT dans une transaction — pas besoin de contrainte UNIQUE.
// montant>0 → enregistre ; montant<=0 → supprime la ligne.
const batchDepenseAttente = async (req, res) => {
  const { mois, annee, lignes } = req.body;
  if (!mois || !annee || !Array.isArray(lignes)) {
    return res.status(400).json({ error: 'Données invalides.' });
  }
  const an = parseInt(annee, 10);
  const toInsert = lignes.filter(l => parseFloat(l.montant) > 0);
  const allCodes = lignes.map(l => l.rubrique_code);
  try {
    await sequelize.transaction(async (t) => {
      await DepenseAttente.destroy({
        where: { tenant_id: req.tenantId, mois, annee: an, rubrique_code: { [Op.in]: allCodes } },
        transaction: t,
      });
      if (toInsert.length) {
        await DepenseAttente.bulkCreate(
          toInsert.map(l => ({
            tenant_id: req.tenantId, mois, annee: an,
            rubrique_code: l.rubrique_code, intitule: l.intitule || l.rubrique_code, montant: parseFloat(l.montant),
          })),
          { transaction: t },
        );
      }
    });
    res.json({ message: 'Dépenses en attente enregistrées.' });
  } catch (err) {
    console.error('[Budget] batchDepenseAttente :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── PUT /api/budget/ressources-attente/batch ──────────────────────────────
const batchRessourceAttente = async (req, res) => {
  const { mois, annee, lignes } = req.body;
  if (!mois || !annee || !Array.isArray(lignes)) {
    return res.status(400).json({ error: 'Données invalides.' });
  }
  const an = parseInt(annee, 10);
  const toInsert = lignes.filter(l => parseFloat(l.montant) > 0);
  const allCodes = lignes.map(l => l.rubrique_code);
  try {
    await sequelize.transaction(async (t) => {
      await RessourceAttente.destroy({
        where: { tenant_id: req.tenantId, mois, annee: an, rubrique_code: { [Op.in]: allCodes } },
        transaction: t,
      });
      if (toInsert.length) {
        await RessourceAttente.bulkCreate(
          toInsert.map(l => ({
            tenant_id: req.tenantId, mois, annee: an,
            rubrique_code: l.rubrique_code, intitule: l.intitule || l.rubrique_code, montant: parseFloat(l.montant),
          })),
          { transaction: t },
        );
      }
    });
    res.json({ message: 'Ressources attendues enregistrées.' });
  } catch (err) {
    console.error('[Budget] batchRessourceAttente :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = {
  getBudget, setBudgetLine, deleteBudgetLine, setValidation,
  addDepenseAttente, deleteDepenseAttente,
  addRessourceAttente, deleteRessourceAttente,
  batchDepenseAttente, batchRessourceAttente,
};
