// src/controllers/dashboard.controller.js
const { sequelize, Mouvement, Journal } = require('../models');
const { MOIS, situationJournaux } = require('../services/journal.service');

// ── GET /api/dashboard/stats?annee=&mois= ─────────────────────────────────
// Les cartes par journal donnent la situation du MOIS sélectionné, calculée
// comme la page du journal (RAN + entrées − sorties). Avant, le solde était
// la somme de tous les mouvements depuis l'origine, sans RAN : il ne
// correspondait à rien de ce que la caissière voit dans ses journaux.
const getStats = async (req, res) => {
  if (!req.tenantId) return res.status(400).json({ error: 'Client requis.' });
  const yr = parseInt(req.query.annee, 10) || new Date().getFullYear();
  const mois = MOIS.includes(req.query.mois) ? req.query.mois : MOIS[new Date().getMonth()];
  try {
    const [totaux, journaux, tendance] = await Promise.all([
      Mouvement.findOne({
        where: { tenant_id: req.tenantId, annee: yr },
        attributes: [
          [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('entree')), 0), 'totalEntrees'],
          [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('sortie')), 0), 'totalSorties'],
          [sequelize.fn('COUNT', sequelize.col('id')), 'nbMouvements'],
        ],
        raw: true,
      }),
      Journal.findAll({
        where: { tenant_id: req.tenantId, actif: true },
        attributes: ['id', 'nom', 'type', 'code', 'ordre'],
        order: [['ordre', 'ASC'], ['nom', 'ASC']],
        raw: true,
      }),
      Mouvement.findAll({
        where: { tenant_id: req.tenantId, annee: yr },
        attributes: [
          'mois',
          [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('entree')), 0), 'entrees'],
          [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('sortie')), 0), 'sorties'],
        ],
        group: ['mois'],
        raw: true,
      }),
    ]);

    const situation = await situationJournaux(req.tenantId, mois, yr, journaux);
    const soldesJournaux = situation.map((j) => ({ ...j, solde: j.solde_final }));

    res.json({
      mois,
      annee: yr,
      totalEntrees: parseFloat(totaux.totalEntrees) || 0,
      totalSorties: parseFloat(totaux.totalSorties) || 0,
      nbMouvements: parseInt(totaux.nbMouvements, 10) || 0,
      tresorerieMois: soldesJournaux.reduce((s, j) => s + j.solde, 0),
      soldesJournaux,
      tendance,
    });
  } catch (err) {
    console.error('[Dashboard] getStats :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = { getStats };
