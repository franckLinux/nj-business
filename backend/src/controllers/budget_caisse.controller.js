// src/controllers/budget_caisse.controller.js
// Gestion du budget de dépense par journal/mois + demandes de dépassement
const { query } = require('../config/database');
const { sendDepassementAlert } = require('../services/email.service');

// ── GET /api/budget-caisse?journal_id=&mois=&annee= ──────────────────────
const getBudgetCaisse = async (req, res) => {
  const { journal_id, mois, annee } = req.query;
  if (!journal_id || !mois || !annee) {
    return res.status(400).json({ error: 'journal_id, mois et annee requis.' });
  }
  try {
    const jid = parseInt(journal_id);
    const an  = parseInt(annee);
    const [bcRes, sortiesRes, depRes] = await Promise.all([
      query(
        `SELECT bc.*, u.username AS set_par_nom
         FROM budget_caisse bc
         LEFT JOIN users u ON u.id = bc.set_par
         WHERE bc.tenant_id=$1 AND bc.journal_id=$2 AND bc.mois=$3 AND bc.annee=$4`,
        [req.tenantId, jid, mois, an]
      ),
      // Sorties réelles du mois (hors demandes en attente)
      query(
        `SELECT COALESCE(SUM(sortie),0) AS total
         FROM journal
         WHERE tenant_id=$1 AND journal_id=$2 AND mois=$3 AND annee=$4`,
        [req.tenantId, jid, mois, an]
      ),
      // Demandes de dépassement en attente (sorties bloquées)
      query(
        `SELECT COUNT(*) AS nb, COALESCE(SUM(sortie),0) AS total
         FROM demandes_depassement
         WHERE tenant_id=$1 AND journal_id=$2 AND mois=$3 AND annee=$4 AND statut='en_attente'`,
        [req.tenantId, jid, mois, an]
      ),
    ]);

    const budget = bcRes.rows[0] || null;
    const sorties_actuelles  = parseFloat(sortiesRes.rows[0].total) || 0;
    const en_attente_nb      = parseInt(depRes.rows[0].nb) || 0;
    const en_attente_montant = parseFloat(depRes.rows[0].total) || 0;
    const budget_montant     = budget ? parseFloat(budget.montant) : 0;
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

    res.json(budget
      ? { ...budget, sorties_actuelles, taux_consommation, restant, alerte, en_attente_nb, en_attente_montant }
      : null
    );
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
    const { rows } = await query(
      `INSERT INTO budget_caisse(tenant_id, journal_id, mois, annee, montant, set_par, updated_at)
       VALUES($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT(tenant_id, journal_id, mois, annee) DO UPDATE SET
         montant    = EXCLUDED.montant,
         set_par    = EXCLUDED.set_par,
         updated_at = NOW()
       RETURNING *`,
      [req.tenantId, parseInt(journal_id), mois, parseInt(annee),
       parseFloat(montant) || 0, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('[BudgetCaisse] setBudgetCaisse :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── DELETE /api/budget-caisse ────────────────────────────────────────────
const deleteBudgetCaisse = async (req, res) => {
  const { journal_id, mois, annee } = req.query;
  await query(
    `DELETE FROM budget_caisse WHERE tenant_id=$1 AND journal_id=$2 AND mois=$3 AND annee=$4`,
    [req.tenantId, parseInt(journal_id), mois, parseInt(annee)]
  );
  res.json({ message: 'Budget supprimé.' });
};

// ── GET /api/budget-caisse/depassements?statut=en_attente ───────────────
const getDepassements = async (req, res) => {
  const statut = req.query.statut || 'en_attente';
  try {
    const { rows } = await query(
      `SELECT d.*,
              jx.nom AS journal_nom, jx.code AS journal_code, jx.type AS journal_type,
              u.username AS demandeur_nom,
              vu.username AS valideur_nom
       FROM demandes_depassement d
       LEFT JOIN journaux jx ON jx.id = d.journal_id
       LEFT JOIN users   u  ON u.id  = d.demande_par
       LEFT JOIN users   vu ON vu.id = d.valide_par
       WHERE d.tenant_id=$1 AND ($2='all' OR d.statut=$2)
       ORDER BY d.created_at DESC`,
      [req.tenantId, statut]
    );
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
    // ── Anti-doublon : même paiement déjà en attente ? ──────────────────
    const { rows: existRows } = await query(
      `SELECT id FROM demandes_depassement
       WHERE tenant_id=$1 AND journal_id=$2 AND mois=$3 AND annee=$4
         AND rubrique_code=$5 AND sortie=$6 AND statut='en_attente'
         AND (beneficiaire=$7 OR ($7='' AND beneficiaire=''))`,
      [req.tenantId, parseInt(journal_id), mois, parseInt(annee),
       rubrique_code, parseFloat(sortie), beneficiaire || '']
    );
    if (existRows.length > 0) {
      return res.status(409).json({
        error: 'Une demande identique est déjà en attente de validation.',
        existing_id: existRows[0].id,
      });
    }

    // Récupérer infos journal
    const { rows: jRows } = await query(
      `SELECT jx.nom, jx.code, t.nom AS tenant_nom
       FROM journaux jx
       LEFT JOIN tenants t ON t.id = jx.tenant_id
       WHERE jx.id=$1 AND jx.tenant_id=$2`,
      [parseInt(journal_id), req.tenantId]
    );
    if (!jRows.length) return res.status(404).json({ error: 'Journal introuvable.' });
    const journalNom = jRows[0].nom;
    const tenantNom  = jRows[0].tenant_nom;

    // Caissier
    const caissierNom = req.user.username;

    // Insérer la demande
    const typeD = ['journal','rubrique','sans_budget'].includes(type_depassement) ? type_depassement : 'journal';
    const { rows } = await query(
      `INSERT INTO demandes_depassement(
         tenant_id, journal_id, mois, annee, date_mvt,
         rubrique_code, intitule, objet, beneficiaire, piece_identite, telephone,
         sortie, budget_montant, sorties_actuelles, depassement,
         demande_par, demandeur_nom, statut, type_depassement
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'en_attente',$18)
       RETURNING *`,
      [
        req.tenantId, parseInt(journal_id), mois, parseInt(annee),
        date_mvt, rubrique_code, intitule,
        objet || '', beneficiaire || '', piece_identite || '', telephone || '',
        parseFloat(sortie), parseFloat(budget_montant) || 0,
        parseFloat(sorties_actuelles) || 0, parseFloat(depassement) || 0,
        req.user.id, caissierNom, typeD,
      ]
    );
    const demande = rows[0];

    // Récupérer email du directeur
    const { rows: dirRows } = await query(
      `SELECT email, username FROM users
       WHERE tenant_id=$1 AND role='directeur' AND actif=true AND email<>'' LIMIT 1`,
      [req.tenantId]
    );

    let emailSent = false;
    if (dirRows.length > 0) {
      const { sent } = await sendDepassementAlert({
        dirEmail:         dirRows[0].email,
        dirNom:           dirRows[0].username,
        tenantNom,
        journalNom,
        caissierNom,
        mois, annee,
        sortie:           parseFloat(sortie),
        budgetMontant:    parseFloat(budget_montant) || 0,
        sortiesActuelles: parseFloat(sorties_actuelles) || 0,
        depassement:      parseFloat(depassement) || 0,
        intitule, beneficiaire,
        demandeId: demande.id,
      });
      emailSent = sent;
    }

    res.status(201).json({ ...demande, email_sent: emailSent });
  } catch (err) {
    console.error('[BudgetCaisse] createDemande :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── PATCH /api/budget-caisse/demande/:id/statut ─────────────────────────
// Directeur valide ou rejette une demande
const validerDemande = async (req, res) => {
  if (!['directeur', 'super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Validation réservée au directeur.' });
  }

  const { statut, commentaire } = req.body;
  if (!['approuve', 'rejete'].includes(statut)) {
    return res.status(400).json({ error: "statut doit être 'approuve' ou 'rejete'." });
  }

  const demandeId = parseInt(req.params.id);

  try {
    // Récupérer la demande
    const { rows: dRows } = await query(
      `SELECT * FROM demandes_depassement WHERE id=$1 AND tenant_id=$2`,
      [demandeId, req.tenantId]
    );
    if (!dRows.length) return res.status(404).json({ error: 'Demande introuvable.' });
    const d = dRows[0];

    if (d.statut !== 'en_attente') {
      return res.status(409).json({ error: 'Cette demande a déjà été traitée.' });
    }

    // Mettre à jour la demande
    await query(
      `UPDATE demandes_depassement SET
         statut=$1, commentaire_dir=$2, valide_par=$3, valide_le=NOW()
       WHERE id=$4 AND tenant_id=$5`,
      [statut, commentaire || '', req.user.id, demandeId, req.tenantId]
    );

    // Si approuvé → créer le mouvement dans journal
    if (statut === 'approuve') {
      // Récupérer type_caisse depuis le journal
      let resolvedCaisse = 'especes';
      try {
        const { rows: jRows } = await query(
          'SELECT type FROM journaux WHERE id=$1', [d.journal_id]
        );
        if (jRows.length) {
          resolvedCaisse = ['om','momo','carte_prepayee'].includes(jRows[0].type) ? 'om' : 'especes';
        }
      } catch (_) {}

      // Objet enrichi avec la référence de la demande pour traçabilité comptable
      const objetTrace = d.objet
        ? `${d.objet} [Dépassement autorisé réf. #${demandeId}]`
        : `[Dépassement autorisé réf. #${demandeId}]`;

      await query(
        `INSERT INTO journal(
           tenant_id, date, mois, annee, journal_id, type_caisse,
           rubrique_code, intitule, objet, beneficiaire, piece_identite, telephone,
           entree, sortie, created_by
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0,$13,$14)`,
        [
          req.tenantId, d.date_mvt, d.mois, d.annee,
          d.journal_id, resolvedCaisse,
          d.rubrique_code, d.intitule, objetTrace, d.beneficiaire,
          d.piece_identite, d.telephone,
          d.sortie, req.user.id,
        ]
      );
    }

    res.json({ message: `Demande ${statut === 'approuve' ? 'approuvée et mouvement enregistré' : 'rejetée'}.` });
  } catch (err) {
    console.error('[BudgetCaisse] validerDemande :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── DELETE /api/budget-caisse/demande/:id ───────────────────────────────
const deleteDemande = async (req, res) => {
  if (!['directeur', 'super_admin', 'caissier'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Non autorisé.' });
  }
  await query(
    'DELETE FROM demandes_depassement WHERE id=$1 AND tenant_id=$2',
    [parseInt(req.params.id), req.tenantId]
  );
  res.json({ message: 'Demande supprimée.' });
};

// ── GET /api/budget-caisse/depassements/count ────────────────────────────
// Nombre de demandes en attente (badge notification)
const countDepassements = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT COUNT(*) AS nb FROM demandes_depassement
       WHERE tenant_id=$1 AND statut='en_attente'`,
      [req.tenantId]
    );
    res.json({ count: parseInt(rows[0].nb) });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = {
  getBudgetCaisse, setBudgetCaisse, deleteBudgetCaisse,
  getDepassements, createDemande, validerDemande, deleteDemande,
  countDepassements,
};
