// src/controllers/appel_fonds.controller.js
// M12 — Appel de Fonds (prévisions mois suivant)
const { query } = require('../config/database');

// GET /api/appel-fonds?mois=&annee=&journal_id=
const getAppelFonds = async (req, res) => {
  const { mois, annee, journal_id } = req.query;
  try {
    const { rows } = await query(
      `SELECT af.*, j.nom AS journal_nom, j.type AS journal_type,
              u.username AS created_by_nom, ua.username AS approved_by_nom
       FROM appel_fonds af
       LEFT JOIN journaux j  ON j.id = af.journal_id
       LEFT JOIN users u     ON u.id = af.created_by
       LEFT JOIN users ua    ON ua.id = af.approved_by
       WHERE af.tenant_id=$1
         ${mois      ? 'AND af.mois_cible=$2'    : ''}
         ${annee     ? `AND af.annee_cible=$${mois?3:2}` : ''}
         ${journal_id? `AND af.journal_id=$${[mois,annee,journal_id].filter(Boolean).length+1}` : ''}
       ORDER BY af.created_at DESC`,
      [req.tenantId, ...[mois, annee ? parseInt(annee) : null, journal_id ? parseInt(journal_id) : null].filter(v => v !== null && v !== undefined)]
    );
    // Totaux
    const total_prevu    = rows.reduce((s,r) => s + parseFloat(r.montant_prevu||0), 0);
    const total_approuve = rows.reduce((s,r) => s + parseFloat(r.montant_approuve||0), 0);

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
    const { rows } = await query(
      `INSERT INTO appel_fonds(tenant_id,journal_id,mois_cible,annee_cible,
         rubrique_code,intitule,montant_prevu,justification,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT(tenant_id,mois_cible,annee_cible,rubrique_code,journal_id)
       DO UPDATE SET montant_prevu=EXCLUDED.montant_prevu,
         justification=EXCLUDED.justification
       RETURNING *`,
      [req.tenantId, journal_id||null, mois_cible, parseInt(annee_cible),
       rubrique_code, intitule, parseFloat(montant_prevu), justification||'', req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// PATCH /api/appel-fonds/:id/statut — approbation directeur
const updateStatut = async (req, res) => {
  if (!['directeur','super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Approbation réservée au directeur.' });
  }
  const { statut, montant_approuve, commentaire_approbation } = req.body;
  const STATUTS = ['approuve','rejete','partiellement_approuve','en_attente'];
  if (!STATUTS.includes(statut)) {
    return res.status(400).json({ error: 'Statut invalide.' });
  }
  try {
    const { rows } = await query(
      `UPDATE appel_fonds SET statut=$1, montant_approuve=$2,
         commentaire_approbation=$3, approved_by=$4, approved_at=NOW()
       WHERE id=$5 AND tenant_id=$6 RETURNING *`,
      [statut, parseFloat(montant_approuve)||0, commentaire_approbation||'',
       req.user.id, req.params.id, req.tenantId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Appel de fonds introuvable.' });
    const af = rows[0];

    // ── Lien automatique vers budget_validation (RG-03) ───────────────────
    // Seule une demande de fonds "approuve" valide le mois de DÉPENSE (mois_cible),
    // ce qui ouvre la saisie caisse pour toutes les rubriques de ce mois.
    // "partiellement_approuve" ne valide PAS le mois ; "rejete" le marque rejeté.
    // La clé pointe sur (mois_cible, annee_cible) — le mois de la dépense —
    // afin que le contrôle caisse (journal.mois) retrouve la bonne ligne.
    if (statut === 'approuve' || statut === 'rejete') {
      try {
        const valStatut = statut === 'rejete' ? 'rejete' : 'valide';
        await query(
          `INSERT INTO budget_validation(tenant_id, mois, annee, statut, commentaire, validated_by, validated_at)
           VALUES($1,$2,$3,$4,$5,$6,NOW())
           ON CONFLICT(tenant_id, mois, annee) DO UPDATE SET
             statut=EXCLUDED.statut, commentaire=EXCLUDED.commentaire,
             validated_by=EXCLUDED.validated_by, validated_at=EXCLUDED.validated_at`,
          [req.tenantId, af.mois_cible, af.annee_cible, valStatut,
           `Validation automatique — demande de fonds ${af.mois_cible} ${af.annee_cible} (réf. #${af.id})`,
           req.user.id]
        );
      } catch (bvErr) {
        console.warn('[AppelFonds] budget_validation auto :', bvErr.message);
      }
    }

    res.json({ ...af, budget_validation_liee: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// DELETE /api/appel-fonds/:id
const deleteAppelFonds = async (req, res) => {
  await query('DELETE FROM appel_fonds WHERE id=$1 AND tenant_id=$2 AND statut=\'en_attente\'',
              [req.params.id, req.tenantId]);
  res.json({ message: 'Appel de fonds supprimé.' });
};

module.exports = { getAppelFonds, createAppelFonds, updateStatut, deleteAppelFonds };
