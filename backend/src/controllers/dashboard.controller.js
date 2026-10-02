// src/controllers/dashboard.controller.js
const { sequelize, Mouvement, Journal } = require('../models');

// ── GET /api/dashboard/stats?annee= ───────────────────────────────────────
const getStats = async (req, res) => {
  const yr = parseInt(req.query.annee) || new Date().getFullYear();
  try {
    const [totaux, journaux, soldesParJournal, tendance] = await Promise.all([
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
        attributes: ['id', 'nom', 'type', 'code'],
        order: [['ordre', 'ASC']],
        raw: true,
      }),
      // Somme par journal, tous mois/années confondus (LEFT JOIN émulé : les
      // journaux sans mouvement n'apparaissent pas ici et valent 0 plus bas).
      Mouvement.findAll({
        where: { tenant_id: req.tenantId },
        attributes: [
          'journal_id',
          [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.literal('entree - sortie')), 0), 'solde'],
        ],
        group: ['journal_id'],
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
        order: [[sequelize.fn('MIN', sequelize.col('date')), 'ASC']],
        raw: true,
      }),
    ]);

    const soldeByJournalId = new Map(soldesParJournal.map((s) => [s.journal_id, parseFloat(s.solde)]));
    const soldesJournaux = journaux.map((j) => ({ ...j, solde: soldeByJournalId.get(j.id) || 0 }));

    res.json({
      totalEntrees: parseFloat(totaux.totalEntrees),
      totalSorties: parseFloat(totaux.totalSorties),
      nbMouvements: parseInt(totaux.nbMouvements, 10),
      soldesJournaux,
      tendance,
    });
  } catch (err) {
    console.error('[Dashboard] getStats :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = { getStats };
