// src/controllers/budget.controller.js
const { query, getClient } = require('../config/database');

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
  const an = parseInt(annee);
  try {
    // 1. Budget applicable (saisi un autre mois pour s'appliquer ici)
    let budgetRows = (await query(
      `SELECT * FROM budget
       WHERE tenant_id=$1 AND mois_applic=$2 AND annee_applic=$3
       ORDER BY rubrique_code`,
      [req.tenantId, mois, an]
    )).rows;

    // Mois de saisie (pour retrouver la bonne validation)
    let moisSaisie = mois, anneeSaisie = an;
    if (budgetRows.length > 0) {
      moisSaisie  = budgetRows[0].mois;
      anneeSaisie = budgetRows[0].annee;
    } else {
      // 2. Fallback : budget saisi directement ce mois
      budgetRows = (await query(
        `SELECT * FROM budget
         WHERE tenant_id=$1 AND mois=$2 AND annee=$3
         ORDER BY rubrique_code`,
        [req.tenantId, mois, an]
      )).rows;
    }

    const [validRes, depAttRes, resAttRes] = await Promise.all([
      query('SELECT statut, commentaire, validated_at FROM budget_validation WHERE tenant_id=$1 AND mois=$2 AND annee=$3',
            [req.tenantId, moisSaisie, anneeSaisie]),
      query('SELECT * FROM depenses_attente WHERE tenant_id=$1 AND mois=$2 AND annee=$3 ORDER BY id',
            [req.tenantId, mois, an]),
      query('SELECT * FROM ressources_attente WHERE tenant_id=$1 AND mois=$2 AND annee=$3 ORDER BY id',
            [req.tenantId, mois, an]),
    ]);

    res.json({
      dotations:          budgetRows,
      validation:         validRes.rows[0] || { statut: 'en_attente' },
      mois_saisie:        moisSaisie,
      annee_saisie:       anneeSaisie,
      depenses_attente:   depAttRes.rows,
      ressources_attente: resAttRes.rows,
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
    await query(
      `INSERT INTO budget(tenant_id,mois,annee,rubrique_code,intitule,montant,mois_applic,annee_applic)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(tenant_id,mois,annee,rubrique_code) DO UPDATE SET
         intitule=EXCLUDED.intitule, montant=EXCLUDED.montant,
         mois_applic=EXCLUDED.mois_applic, annee_applic=EXCLUDED.annee_applic`,
      [req.tenantId, mois, parseInt(annee), rubrique_code, intitule,
       parseFloat(montant)||0, mois_applic||'', parseInt(annee_applic)||0]
    );
    res.json({ message: 'Dotation mise à jour.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── POST /api/budget/validation ───────────────────────────────────────────
const setValidation = async (req, res) => {
  const { mois, annee, statut, commentaire } = req.body;
  if (!['directeur','super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Validation réservée au directeur.' });
  }
  try {
    await query(
      `INSERT INTO budget_validation(tenant_id,mois,annee,statut,commentaire,validated_by,validated_at)
       VALUES($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT(tenant_id,mois,annee) DO UPDATE SET
         statut=EXCLUDED.statut, commentaire=EXCLUDED.commentaire,
         validated_by=EXCLUDED.validated_by, validated_at=EXCLUDED.validated_at`,
      [req.tenantId, mois, parseInt(annee), statut, commentaire||'', req.user.id]
    );
    res.json({ message: `Budget ${statut}.` });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── POST /api/budget/depenses-attente ─────────────────────────────────────
const addDepenseAttente = async (req, res) => {
  const { mois, annee, rubrique_code, intitule, montant } = req.body;
  try {
    const { rows } = await query(
      `INSERT INTO depenses_attente(tenant_id,mois,annee,rubrique_code,intitule,montant)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.tenantId, mois, parseInt(annee), rubrique_code, intitule, parseFloat(montant)||0]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── DELETE /api/budget/depenses-attente/:id ───────────────────────────────
const deleteDepenseAttente = async (req, res) => {
  await query('DELETE FROM depenses_attente WHERE id=$1 AND tenant_id=$2',
              [parseInt(req.params.id), req.tenantId]);
  res.json({ message: 'Dépense supprimée.' });
};

// ── POST /api/budget/ressources-attente ───────────────────────────────────
const addRessourceAttente = async (req, res) => {
  const { mois, annee, rubrique_code, intitule, montant } = req.body;
  try {
    const { rows } = await query(
      `INSERT INTO ressources_attente(tenant_id,mois,annee,rubrique_code,intitule,montant)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.tenantId, mois, parseInt(annee), rubrique_code, intitule, parseFloat(montant)||0]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── DELETE /api/budget/ressources-attente/:id ─────────────────────────────
const deleteRessourceAttente = async (req, res) => {
  await query('DELETE FROM ressources_attente WHERE id=$1 AND tenant_id=$2',
              [parseInt(req.params.id), req.tenantId]);
  res.json({ message: 'Ressource supprimée.' });
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
  const an = parseInt(annee);
  const toInsert = lignes.filter(l => parseFloat(l.montant) > 0);
  const allCodes = lignes.map(l => l.rubrique_code);
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM depenses_attente
       WHERE tenant_id=$1 AND mois=$2 AND annee=$3 AND rubrique_code=ANY($4::text[])`,
      [req.tenantId, mois, an, allCodes]
    );
    if (toInsert.length) {
      await client.query(
        `INSERT INTO depenses_attente(tenant_id,mois,annee,rubrique_code,intitule,montant)
         SELECT $1,$2,$3,unnest($4::text[]),unnest($5::text[]),unnest($6::numeric[])`,
        [req.tenantId, mois, an,
         toInsert.map(l => l.rubrique_code),
         toInsert.map(l => l.intitule || l.rubrique_code),
         toInsert.map(l => parseFloat(l.montant))]
      );
    }
    await client.query('COMMIT');
    res.json({ message: 'Dépenses en attente enregistrées.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Budget] batchDepenseAttente :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  } finally {
    client.release();
  }
};

// ── PUT /api/budget/ressources-attente/batch ──────────────────────────────
const batchRessourceAttente = async (req, res) => {
  const { mois, annee, lignes } = req.body;
  if (!mois || !annee || !Array.isArray(lignes)) {
    return res.status(400).json({ error: 'Données invalides.' });
  }
  const an = parseInt(annee);
  const toInsert = lignes.filter(l => parseFloat(l.montant) > 0);
  const allCodes = lignes.map(l => l.rubrique_code);
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM ressources_attente
       WHERE tenant_id=$1 AND mois=$2 AND annee=$3 AND rubrique_code=ANY($4::text[])`,
      [req.tenantId, mois, an, allCodes]
    );
    if (toInsert.length) {
      await client.query(
        `INSERT INTO ressources_attente(tenant_id,mois,annee,rubrique_code,intitule,montant)
         SELECT $1,$2,$3,unnest($4::text[]),unnest($5::text[]),unnest($6::numeric[])`,
        [req.tenantId, mois, an,
         toInsert.map(l => l.rubrique_code),
         toInsert.map(l => l.intitule || l.rubrique_code),
         toInsert.map(l => parseFloat(l.montant))]
      );
    }
    await client.query('COMMIT');
    res.json({ message: 'Ressources attendues enregistrées.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Budget] batchRessourceAttente :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  } finally {
    client.release();
  }
};

module.exports = {
  getBudget, setBudgetLine, setValidation,
  addDepenseAttente, deleteDepenseAttente,
  addRessourceAttente, deleteRessourceAttente,
  batchDepenseAttente, batchRessourceAttente,
};
