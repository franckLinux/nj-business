// src/controllers/banque.controller.js
const { sequelize, Banque } = require('../models');

// ── GET /api/banque?mois=&annee=&journal_id= ──────────────────────────────
const getBanque = async (req, res) => {
  const { mois, annee, journal_id } = req.query;
  try {
    const where = { tenant_id: req.tenantId, mois, annee: parseInt(annee) };
    if (journal_id) where.journal_id = parseInt(journal_id);
    const banque = await Banque.findOne({ where });
    res.json(banque || { solde_initial: 0, fonds_recus: 0, solde_final: 0 });
  } catch (err) {
    console.error('[Banque] getBanque :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── PUT /api/banque ────────────────────────────────────────────────────────
const updateBanque = async (req, res) => {
  const { mois, annee, solde_initial, fonds_recus, solde_final } = req.body;
  try {
    await sequelize.transaction(async (t) => {
      const [banque] = await Banque.findOrCreate({
        where: { tenant_id: req.tenantId, mois, annee: parseInt(annee) },
        defaults: {},
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (solde_initial != null) banque.solde_initial = parseFloat(solde_initial);
      if (fonds_recus != null) banque.fonds_recus = parseFloat(fonds_recus);
      if (solde_final != null) banque.solde_final = parseFloat(solde_final);
      await banque.save({ transaction: t });
    });
    res.json({ message: 'Banque mise à jour.' });
  } catch (err) {
    console.error('[Banque] updateBanque :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = { getBanque, updateBanque };
