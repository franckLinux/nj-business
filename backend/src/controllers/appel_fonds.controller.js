// src/controllers/appel_fonds.controller.js
// M12 — Appel de Fonds (prévisions mois suivant)
const { sequelize, AppelFonds, Journal, User, BudgetValidation } = require('../models');

// GET /api/appel-fonds?mois=&annee=&journal_id=
const getAppelFonds = async (req, res) => {
  const { mois, annee, journal_id } = req.query;
  try {
    const where = { tenant_id: req.tenantId };
    if (mois) where.mois_cible = mois;
    if (annee) where.annee_cible = parseInt(annee, 10);
    if (journal_id) where.journal_id = parseInt(journal_id, 10);

    const appels = await AppelFonds.findAll({
      where,
      include: [
        { model: Journal, attributes: ['nom', 'type'], required: false },
        { model: User, as: 'auteur', attributes: ['username'], required: false },
        { model: User, as: 'approbateur', attributes: ['username'], required: false },
      ],
      order: [['created_at', 'DESC']],
    });

    const rows = appels.map(a => {
      const { Journal: jx, auteur, approbateur, ...rest } = a.toJSON();
      return {
        ...rest,
        journal_nom: jx?.nom || null, journal_type: jx?.type || null,
        created_by_nom: auteur ? auteur.username : null,
        approved_by_nom: approbateur ? approbateur.username : null,
      };
    });

    const total_prevu    = rows.reduce((s, r) => s + parseFloat(r.montant_prevu || 0), 0);
    const total_approuve = rows.reduce((s, r) => s + parseFloat(r.montant_approuve || 0), 0);

    res.json({ appels: rows, total_prevu, total_approuve });
  } catch (err) {
    console.error('[AppelFonds] getAppelFonds :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// POST /api/appel-fonds
const createAppelFonds = async (req, res) => {
  const { journal_id, mois_cible, annee_cible, rubrique_code, intitule, montant_prevu, justification } = req.body;
  if (!mois_cible || !annee_cible || !rubrique_code || !intitule || !montant_prevu) {
    return res.status(400).json({ error: 'Champs obligatoires manquants.' });
  }
  try {
    const jid = journal_id ? parseInt(journal_id, 10) : null;
    const appel = await sequelize.transaction(async (t) => {
      const [row] = await AppelFonds.findOrCreate({
        where: { tenant_id: req.tenantId, mois_cible, annee_cible: parseInt(annee_cible, 10), rubrique_code, journal_id: jid },
        defaults: { intitule, created_by: req.user.id },
        transaction: t, lock: t.LOCK.UPDATE,
      });
      row.montant_prevu = parseFloat(montant_prevu);
      row.justification = justification || '';
      await row.save({ transaction: t });
      return row;
    });
    res.status(201).json(appel);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// PATCH /api/appel-fonds/:id/statut — approbation directeur
const updateStatut = async (req, res) => {
  const { statut, montant_approuve, commentaire_approbation } = req.body;
  const STATUTS = ['approuve', 'rejete', 'partiellement_approuve', 'en_attente'];
  if (!STATUTS.includes(statut)) {
    return res.status(400).json({ error: 'Statut invalide.' });
  }
  try {
    const [count, rows] = await AppelFonds.update(
      { statut, montant_approuve: parseFloat(montant_approuve) || 0, commentaire_approbation: commentaire_approbation || '', approved_by: req.user.id, approved_at: new Date() },
      { where: { id: req.params.id, tenant_id: req.tenantId }, returning: true },
    );
    if (count === 0) return res.status(404).json({ error: 'Appel de fonds introuvable.' });
    const af = rows[0];

    // ── Lien automatique vers budget_validation (RG-03) ───────────────────
    // Seule une demande de fonds "approuve" valide le mois de DÉPENSE (mois_cible),
    // ce qui ouvre la saisie caisse pour toutes les rubriques de ce mois.
    // "partiellement_approuve" ne valide PAS le mois ; "rejete" le marque rejeté.
    // La clé pointe sur (mois_cible, annee_cible) — le mois de la dépense —
    // afin que le contrôle caisse (journal.mois) retrouve la bonne ligne.
    // Best-effort et ISOLÉ de la mise à jour principale : un souci sur cette
    // liaison ne doit jamais faire échouer/annuler l'approbation elle-même.
    if (statut === 'approuve' || statut === 'rejete') {
      try {
        await sequelize.transaction(async (t) => {
          const valStatut = statut === 'rejete' ? 'rejete' : 'valide';
          const [bv] = await BudgetValidation.findOrCreate({
            where: { tenant_id: req.tenantId, mois: af.mois_cible, annee: af.annee_cible },
            defaults: {}, transaction: t, lock: t.LOCK.UPDATE,
          });
          bv.statut = valStatut;
          bv.commentaire = `Validation automatique — demande de fonds ${af.mois_cible} ${af.annee_cible} (réf. #${af.id})`;
          bv.validated_by = req.user.id;
          bv.validated_at = new Date();
          await bv.save({ transaction: t });
        });
      } catch (bvErr) {
        console.warn('[AppelFonds] budget_validation auto :', bvErr.message);
      }
    }

    res.json({ ...af.toJSON(), budget_validation_liee: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// DELETE /api/appel-fonds/:id
const deleteAppelFonds = async (req, res) => {
  try {
    await AppelFonds.destroy({ where: { id: req.params.id, tenant_id: req.tenantId, statut: 'en_attente' } });
    res.json({ message: 'Appel de fonds supprimé.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = { getAppelFonds, createAppelFonds, updateStatut, deleteAppelFonds };
