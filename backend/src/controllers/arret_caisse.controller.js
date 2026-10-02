const { sequelize, Journal, ArretCaisse } = require('../models');
const { userHasPermission } = require('../services/permission.service');

// ── POST /api/journaux/:id/arreter ────────────────────────────────────────
// Autorisé au responsable_arret désigné du journal, ou à qui détient
// journaux.arreter (par défaut : le DIRECTEUR seul — décision du 02/10/2026,
// migration 015). Le comptable cabinet n'arrête plus les caisses.
// super_admin : toujours autorisé (getEffectivePermissions → null).
const arreter = async (req, res) => {
  const { mois, annee, commentaire, solde_final } = req.body;
  if (!mois || !annee) return res.status(400).json({ error: 'mois et annee requis.' });
  const journalId = parseInt(req.params.id, 10);
  try {
    const journal = await Journal.findOne({
      where: { id: journalId, tenant_id: req.tenantId },
      attributes: ['responsable_arret'],
    });
    if (!journal) return res.status(404).json({ error: 'Journal introuvable.' });
    const isResponsable = journal.responsable_arret === req.user.id;
    const peutArreter = isResponsable || await userHasPermission(
      { tenantId: req.tenantId, userId: req.user.id, role: req.user.role }, 'journaux.arreter'
    );
    if (!peutArreter) {
      return res.status(403).json({ error: "Vous n'êtes pas le responsable d'arrêt de ce journal." });
    }

    const arret = await sequelize.transaction(async (t) => {
      const [row] = await ArretCaisse.findOrCreate({
        where: { tenant_id: req.tenantId, journal_id: journalId, mois, annee: parseInt(annee, 10) },
        defaults: {},
        transaction: t, lock: t.LOCK.UPDATE,
      });
      row.arrete_le   = new Date();
      row.arrete_par  = req.user.id;
      row.solde_final = parseFloat(solde_final) || 0;
      row.commentaire = commentaire || '';
      await row.save({ transaction: t });
      return row;
    });

    res.status(201).json(arret);
  } catch (err) {
    console.error('[Arrêt caisse] arreter :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── DELETE /api/journaux/:id/arreter ──────────────────────────────────────
// Réouverture réservée au directeur / super_admin.
const reouvrir = async (req, res) => {
  const mois = req.query.mois || req.body.mois;
  const annee = req.query.annee || req.body.annee;
  try {
    await ArretCaisse.destroy({
      where: { tenant_id: req.tenantId, journal_id: parseInt(req.params.id, 10), mois, annee: parseInt(annee, 10) },
    });
    res.json({ message: 'Caisse réouverte.' });
  } catch (err) {
    console.error('[Arrêt caisse] reouvrir :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = { arreter, reouvrir };
