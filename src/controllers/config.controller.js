// src/controllers/config.controller.js
// M05 — Configuration Entité (étendue OHADA/CEMAC)
// Champs : nom, sigle, forme_juridique, adresse, registre_commerce,
//          boite_postale, nui, activite, dirigeant_nom, devise, exercice_fiscal
const { query } = require('../config/database');

// ── Migration douce : ajoute les colonnes manquantes au schéma ─────────────
// Sûr à exécuter à chaque démarrage (idempotent grâce à IF NOT EXISTS).
const ensureColumns = async () => {
  const patches = [
    // Existant (conservé pour rétrocompatibilité)
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS caissier_nom    TEXT DEFAULT ''`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS directeur_nom   TEXT DEFAULT ''`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS exercice_debut  DATE`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS exercice_fin    DATE`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ DEFAULT NOW()`,
    // Nouveaux champs OHADA/CEMAC
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS sigle             TEXT DEFAULT ''`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS forme_juridique   TEXT DEFAULT ''`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS adresse           TEXT DEFAULT ''`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS registre_commerce TEXT DEFAULT ''`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS boite_postale     TEXT DEFAULT ''`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS nui               TEXT DEFAULT ''`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS activite          TEXT DEFAULT ''`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS dirigeant_nom     TEXT DEFAULT ''`,
  ];
  for (const sql of patches) {
    try { await query(sql); } catch (_) { /* colonne déjà présente */ }
  }
  // Backfill : recopier directeur_nom vers dirigeant_nom (une seule fois)
  // pour ne perdre aucune donnée historique.
  try {
    await query(
      `UPDATE tenants
       SET dirigeant_nom = directeur_nom
       WHERE COALESCE(dirigeant_nom,'') = ''
         AND COALESCE(directeur_nom,'') <> ''`
    );
  } catch (_) { /* ignore */ }
};

// ── Formes juridiques OHADA reconnues (référentiel UI) ────────────────────
// Exposé via GET /api/config/referentiel pour alimenter un <select>.
const FORMES_JURIDIQUES = [
  { code: 'SA',          label: 'SA — Société Anonyme' },
  { code: 'SAS',         label: 'SAS — Société par Actions Simplifiée' },
  { code: 'SARL',        label: 'SARL — Société à Responsabilité Limitée' },
  { code: 'SARLU',       label: 'SARLU — SARL Unipersonnelle' },
  { code: 'SNC',         label: 'SNC — Société en Nom Collectif' },
  { code: 'SCS',         label: 'SCS — Société en Commandite Simple' },
  { code: 'GIE',         label: 'GIE — Groupement d\'Intérêt Économique' },
  { code: 'EI',          label: 'EI — Entreprise Individuelle' },
  { code: 'ETS',         label: 'Ets — Établissement' },
  { code: 'COOP',        label: 'Coopérative' },
  { code: 'ASSOC',       label: 'Association' },
  { code: 'ONG',         label: 'ONG' },
  { code: 'AUTRE',       label: 'Autre' },
];

// ── GET /api/config ───────────────────────────────────────────────────────
const getConfig = async (req, res) => {
  try {
    await ensureColumns();
    const { rows } = await query(
      `SELECT id, slug, nom,
              COALESCE(logo_url,'')          AS logo_url,
              COALESCE(devise,'FCFA')        AS devise,
              COALESCE(sigle,'')             AS sigle,
              COALESCE(forme_juridique,'')   AS forme_juridique,
              COALESCE(adresse,'')           AS adresse,
              COALESCE(registre_commerce,'') AS registre_commerce,
              COALESCE(boite_postale,'')     AS boite_postale,
              COALESCE(nui,'')               AS nui,
              COALESCE(activite,'')          AS activite,
              COALESCE(dirigeant_nom,'')     AS dirigeant_nom,
              exercice_debut, exercice_fin, actif
       FROM tenants WHERE id = $1`,
      [req.tenantId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Configuration introuvable. Vérifiez que le tenant existe.' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('[Config] getConfig :', err.message);
    res.status(500).json({ error: `Erreur serveur : ${err.message}` });
  }
};

// ── GET /api/config/referentiel ───────────────────────────────────────────
// Renvoie les listes de référence pour alimenter les <select> côté UI.
const getReferentiel = async (req, res) => {
  res.json({ formes_juridiques: FORMES_JURIDIQUES });
};

// ── PUT /api/config ───────────────────────────────────────────────────────
const updateConfig = async (req, res) => {
  if (!['directeur', 'super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Réservé au directeur.' });
  }

  const {
    nom, sigle, forme_juridique, adresse, registre_commerce,
    boite_postale, nui, activite, dirigeant_nom,
    devise, exercice_debut, exercice_fin,
  } = req.body;

  if (!nom || nom.trim() === '') {
    return res.status(400).json({ error: "Le nom de l'entité est obligatoire." });
  }

  // Validation forme juridique (souple : on accepte aussi une saisie libre via code "AUTRE")
  if (forme_juridique && !FORMES_JURIDIQUES.some(f => f.code === forme_juridique)) {
    return res.status(400).json({
      error: `Forme juridique invalide. Codes acceptés : ${FORMES_JURIDIQUES.map(f => f.code).join(', ')}`,
    });
  }

  // Validation NUI (Cameroun : 14 caractères alphanumériques en général — souple)
  if (nui && nui.trim().length > 0 && nui.trim().length > 20) {
    return res.status(400).json({ error: 'NUI trop long (max 20 caractères).' });
  }

  try {
    await ensureColumns();
    const { rows } = await query(
      `UPDATE tenants
       SET nom               = $1,
           sigle             = $2,
           forme_juridique   = $3,
           adresse           = $4,
           registre_commerce = $5,
           boite_postale     = $6,
           nui               = $7,
           activite          = $8,
           dirigeant_nom     = $9,
           -- Synchroniser directeur_nom pour rétrocompatibilité (rapport, etc.)
           directeur_nom     = $9,
           devise            = $10,
           exercice_debut    = $11,
           exercice_fin      = $12,
           updated_at        = NOW()
       WHERE id = $13
       RETURNING id, slug, nom,
                 COALESCE(logo_url,'')          AS logo_url,
                 COALESCE(devise,'FCFA')        AS devise,
                 COALESCE(sigle,'')             AS sigle,
                 COALESCE(forme_juridique,'')   AS forme_juridique,
                 COALESCE(adresse,'')           AS adresse,
                 COALESCE(registre_commerce,'') AS registre_commerce,
                 COALESCE(boite_postale,'')     AS boite_postale,
                 COALESCE(nui,'')               AS nui,
                 COALESCE(activite,'')          AS activite,
                 COALESCE(dirigeant_nom,'')     AS dirigeant_nom,
                 exercice_debut, exercice_fin`,
      [
        nom.trim(),
        (sigle             || '').trim().toUpperCase(),
        (forme_juridique   || '').trim().toUpperCase(),
        (adresse           || '').trim(),
        (registre_commerce || '').trim(),
        (boite_postale     || '').trim(),
        (nui               || '').trim().toUpperCase(),
        (activite          || '').trim(),
        (dirigeant_nom     || '').trim(),
        devise || 'FCFA',
        exercice_debut || null,
        exercice_fin   || null,
        req.tenantId,
      ]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Entité introuvable.' });
    res.json({ message: 'Configuration mise à jour avec succès.', config: rows[0] });
  } catch (err) {
    console.error('[Config] updateConfig :', err.message);
    res.status(500).json({ error: `Erreur serveur : ${err.message}` });
  }
};

module.exports = { getConfig, updateConfig, getReferentiel, FORMES_JURIDIQUES };
