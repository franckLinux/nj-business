// src/controllers/journaux.controller.js
// Gestion dynamique des journaux (Caisse, OM, MOMO, Banque, Carte prépayée, Autre)
// + Génération automatique du code par type (CS1, BQ1, OM1, MM1, CP1, AU1)
const { query } = require('../config/database');

const TYPES_JOURNAUX = {
  caisse:         { label: 'Journal de Caisse',     icon: '💵' },
  banque:         { label: 'Journal Banque',         icon: '🏦' },
  om:             { label: 'Orange Money',          icon: '🟠' },
  momo:           { label: 'MTN Mobile Money',      icon: '🟡' },
  carte_prepayee: { label: 'Carte Prépayée',        icon: '💳' },
  autre:          { label: 'Autre',                 icon: '📒' },
};

// ── Mapping type → préfixe code journal ──────────────────────────────────
const PREFIX_BY_TYPE = {
  caisse:         'CS',
  banque:         'BQ',
  om:             'OM',
  momo:           'MM',
  carte_prepayee: 'CP',
  autre:          'AU',
};

// ── Calcul du prochain numéro disponible pour un (tenant, prefix) ─────────
// Cherche tous les codes existants du tenant qui matchent ^PREFIX\d+$,
// extrait le max et retourne max+1.
const nextNumberForPrefix = async (tenantId, prefix) => {
  const { rows } = await query(
    `SELECT code FROM journaux WHERE tenant_id = $1 AND code ~ $2`,
    [tenantId, `^${prefix}[0-9]+$`]
  );
  if (rows.length === 0) return 1;
  const nums = rows
    .map(r => parseInt(r.code.substring(prefix.length), 10))
    .filter(n => Number.isFinite(n) && n > 0);
  return nums.length === 0 ? 1 : Math.max(...nums) + 1;
};

// ── GET /api/journaux/next-code?type=banque ───────────────────────────────
const getNextCode = async (req, res) => {
  const { type } = req.query;
  if (!type || !PREFIX_BY_TYPE[type]) {
    return res.status(400).json({
      error: `Paramètre 'type' requis. Valeurs : ${Object.keys(PREFIX_BY_TYPE).join(', ')}`,
    });
  }
  try {
    const prefix = PREFIX_BY_TYPE[type];
    const n      = await nextNumberForPrefix(req.tenantId, prefix);
    res.json({ code: `${prefix}${n}`, prefix, numero: n });
  } catch (err) {
    console.error('[Journaux] getNextCode :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── GET /api/journaux ─────────────────────────────────────────────────────
const getJournaux = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT j.*,
              us.username AS responsable_saisie_nom,
              ua.username AS responsable_arret_nom
       FROM journaux j
       LEFT JOIN users us ON us.id = j.responsable_saisie
       LEFT JOIN users ua ON ua.id = j.responsable_arret
       WHERE j.tenant_id = $1
       ORDER BY j.ordre, j.type, j.nom`,
      [req.tenantId]
    );
    const grouped = {};
    rows.forEach(j => {
      if (!grouped[j.type]) grouped[j.type] = [];
      grouped[j.type].push(j);
    });
    res.json({ journaux: rows, grouped, types: TYPES_JOURNAUX });
  } catch (err) {
    console.error('[Journaux] getJournaux :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── POST /api/journaux ────────────────────────────────────────────────────
// Si le client ne fournit pas de code, on le génère automatiquement.
const createJournal = async (req, res) => {
  if (!['directeur','super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Réservé au directeur.' });
  }
  let { code, nom, type, devise, responsable_saisie, responsable_arret, ordre } = req.body;
  if (!nom || !type) {
    return res.status(400).json({ error: 'Nom et type obligatoires.' });
  }
  if (!Object.keys(TYPES_JOURNAUX).includes(type)) {
    return res.status(400).json({
      error: `Type invalide. Valeurs : ${Object.keys(TYPES_JOURNAUX).join(', ')}`,
    });
  }

  // Auto-génération du code si absent
  try {
    if (!code || !code.trim()) {
      const prefix = PREFIX_BY_TYPE[type];
      const n      = await nextNumberForPrefix(req.tenantId, prefix);
      code         = `${prefix}${n}`;
    } else {
      code = code.trim().toUpperCase();
    }

    const { rows } = await query(
      `INSERT INTO journaux(tenant_id,code,nom,type,devise,responsable_saisie,responsable_arret,ordre)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.tenantId, code, nom, type, devise||'FCFA',
       responsable_saisie||null, responsable_arret||null, ordre||0]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      // Course concurrente : retry une fois avec un nouveau numéro
      try {
        const prefix = PREFIX_BY_TYPE[type];
        const n      = await nextNumberForPrefix(req.tenantId, prefix);
        const retryCode = `${prefix}${n}`;
        const { rows } = await query(
          `INSERT INTO journaux(tenant_id,code,nom,type,devise,responsable_saisie,responsable_arret,ordre)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [req.tenantId, retryCode, nom, type, devise||'FCFA',
           responsable_saisie||null, responsable_arret||null, ordre||0]
        );
        return res.status(201).json(rows[0]);
      } catch (e2) {
        return res.status(409).json({ error: 'Ce code de journal existe déjà.' });
      }
    }
    console.error('[Journaux] createJournal :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── PUT /api/journaux/:id ─────────────────────────────────────────────────
const updateJournal = async (req, res) => {
  if (!['directeur','super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Réservé au directeur.' });
  }
  const { nom, devise, responsable_saisie, responsable_arret, ordre, actif } = req.body;
  try {
    const { rows } = await query(
      `UPDATE journaux SET nom=$1, devise=$2, responsable_saisie=$3,
         responsable_arret=$4, ordre=$5, actif=$6
       WHERE id=$7 AND tenant_id=$8 RETURNING *`,
      [nom, devise||'FCFA', responsable_saisie||null, responsable_arret||null,
       ordre||0, actif!==false, req.params.id, req.tenantId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Journal introuvable.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── DELETE /api/journaux/:id ──────────────────────────────────────────────
const deleteJournal = async (req, res) => {
  if (!['directeur','super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Réservé au directeur.' });
  }
  const { rows } = await query(
    'SELECT COUNT(*) AS cnt FROM journal WHERE journal_id=$1', [req.params.id]
  );
  if (parseInt(rows[0].cnt) > 0) {
    return res.status(400).json({
      error: `Ce journal contient ${rows[0].cnt} mouvement(s). Désactivez-le plutôt que de le supprimer.`
    });
  }
  await query('DELETE FROM journaux WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenantId]);
  res.json({ message: 'Journal supprimé.' });
};

// ── Seed journaux par défaut pour un nouveau tenant ──────────────────────
// Utilise la nouvelle convention de codes (CS1, OM1, MM1, BQ1, CP1).
const seedJournauxDefaut = async (tenantId) => {
  const defauts = [
    { code:'CS1', nom:'Caisse Principale',  type:'caisse',         ordre:1 },
    { code:'OM1', nom:'Orange Money',        type:'om',             ordre:2 },
    { code:'MM1', nom:'MTN Mobile Money',    type:'momo',           ordre:3 },
    { code:'BQ1', nom:'Compte Banque',       type:'banque',         ordre:4 },
    { code:'CP1', nom:'Carte Prépayée',      type:'carte_prepayee', ordre:5 },
  ];
  for (const j of defauts) {
    await query(
      `INSERT INTO journaux(tenant_id,code,nom,type,ordre)
       VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,code) DO NOTHING`,
      [tenantId, j.code, j.nom, j.type, j.ordre]
    );
  }
};

module.exports = {
  getJournaux, createJournal, updateJournal, deleteJournal,
  getNextCode, seedJournauxDefaut,
  TYPES_JOURNAUX, PREFIX_BY_TYPE,
};
