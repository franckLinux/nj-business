// src/controllers/plan_comptable.controller.js
// Recherche dans le plan SYSCOHADA révisé
const { query } = require('../config/database');

// GET /api/plan-comptable/search?q=transport&classe=6
const search = async (req, res) => {
  const { q, classe, nature } = req.query;
  if (!q || q.trim().length < 2) {
    return res.status(400).json({ error: 'Minimum 2 caractères.' });
  }
  try {
    const params = [`%${q.trim()}%`];
    const conditions = [
      `(compte ILIKE $1 OR intitule ILIKE $1)`,
      `actif = true`,
    ];
    if (classe) { params.push(parseInt(classe)); conditions.push(`classe = $${params.length}`); }
    if (nature) { params.push(nature);           conditions.push(`nature = $${params.length}`); }

    const { rows } = await query(
      `SELECT compte, intitule, classe, nature
       FROM plan_comptable_syscohada
       WHERE ${conditions.join(' AND ')}
       ORDER BY compte
       LIMIT 20`,
      params
    );
    res.json(rows);
  } catch (err) {
    // Table pas encore créée → retourner liste vide
    console.warn('[PlanComptable] Table absente :', err.message);
    res.json([]);
  }
};

// GET /api/plan-comptable/classes — liste des classes pour filtre
const getClasses = async (req, res) => {
  const classes = [
    { id: 1, label: 'Classe 1 — Ressources durables' },
    { id: 2, label: 'Classe 2 — Actif immobilisé' },
    { id: 3, label: 'Classe 3 — Stocks' },
    { id: 4, label: 'Classe 4 — Tiers' },
    { id: 5, label: 'Classe 5 — Trésorerie' },
    { id: 6, label: 'Classe 6 — Charges' },
    { id: 7, label: 'Classe 7 — Produits' },
  ];
  res.json(classes);
};

// GET /api/plan-comptable/list?classe=6&nature=charge&q=transport&limit=500
// Endpoint de consultation : pas de minimum sur q, filtre optionnel.
const list = async (req, res) => {
  const { q, classe, nature } = req.query;
  const limit = Math.min(parseInt(req.query.limit) || 1000, 5000);
  try {
    const params = [];
    const conditions = ['actif = true'];
    if (q && q.trim().length > 0) {
      params.push(`%${q.trim()}%`);
      conditions.push(`(compte ILIKE $${params.length} OR intitule ILIKE $${params.length})`);
    }
    if (classe) {
      params.push(parseInt(classe));
      conditions.push(`classe = $${params.length}`);
    }
    if (nature) {
      params.push(nature);
      conditions.push(`nature = $${params.length}`);
    }
    params.push(limit);
    let rows;
    try {
      ({ rows } = await query(
        `SELECT compte, intitule, classe, nature,
                COALESCE(source, 'syscohada') AS source
         FROM plan_comptable_syscohada
         WHERE ${conditions.join(' AND ')}
         ORDER BY compte
         LIMIT $${params.length}`,
        params
      ));
    } catch (e) {
      // Repli si la colonne `source` n'existe pas encore (migration non appliquée)
      ({ rows } = await query(
        `SELECT compte, intitule, classe, nature
         FROM plan_comptable_syscohada
         WHERE ${conditions.join(' AND ')}
         ORDER BY compte
         LIMIT $${params.length}`,
        params
      ));
      rows = rows.map(r => ({ ...r, source: 'syscohada' }));
    }
    res.json({ comptes: rows, total: rows.length, limit });
  } catch (err) {
    console.warn('[PlanComptable] list - table absente :', err.message);
    res.json({ comptes: [], total: 0, limit, error: 'Plan comptable non chargé en base.' });
  }
};

// GET /api/plan-comptable/stats — comptage par classe (pour les badges UI)
const getStats = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT classe, COUNT(*)::int AS nb
       FROM plan_comptable_syscohada
       WHERE actif = true
       GROUP BY classe ORDER BY classe`
    );
    const total = rows.reduce((s, r) => s + r.nb, 0);
    res.json({ par_classe: rows, total });
  } catch (err) {
    res.json({ par_classe: [], total: 0 });
  }
};

// POST /api/plan-comptable — ajouter un compte personnalisé
// Numéro de compte sans limite de taille (colonne TEXT).
const ROLES_GESTION = ['directeur', 'super_admin', 'comptable_cabinet'];

const createCompte = async (req, res) => {
  if (!ROLES_GESTION.includes(req.user?.role)) {
    return res.status(403).json({ error: 'Accès refusé : droits insuffisants.' });
  }

  let { compte, intitule, classe, nature } = req.body;
  compte   = (compte   || '').toString().trim();
  intitule = (intitule || '').toString().trim();

  if (!compte || !intitule) {
    return res.status(400).json({ error: 'Numéro de compte et intitulé obligatoires.' });
  }

  // Classe déduite du 1er chiffre si non fournie (1..9 SYSCOHADA).
  let classeNum = parseInt(classe);
  if (!classeNum || classeNum < 1 || classeNum > 9) {
    const firstDigit = compte.match(/\d/);
    classeNum = firstDigit ? parseInt(firstDigit[0]) : null;
  }

  try {
    const { rows } = await query(
      `INSERT INTO plan_comptable_syscohada
         (compte, intitule, classe, nature, source, actif, created_by)
       VALUES ($1, $2, $3, $4, 'custom', true, $5)
       ON CONFLICT (lower(btrim(compte))) DO UPDATE
         SET intitule = EXCLUDED.intitule,
             classe   = EXCLUDED.classe,
             nature   = EXCLUDED.nature,
             actif    = true
       RETURNING compte, intitule, classe, nature, source`,
      [compte, intitule, classeNum, nature || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[PlanComptable] createCompte :', err.message);
    res.status(500).json({
      error: "Impossible d'ajouter le compte. Vérifiez que la migration "
           + 'plan comptable a bien été appliquée.',
    });
  }
};

// DELETE /api/plan-comptable/:compte — désactive un compte personnalisé
// (on ne supprime jamais un compte du référentiel SYSCOHADA)
const deleteCompte = async (req, res) => {
  if (!ROLES_GESTION.includes(req.user?.role)) {
    return res.status(403).json({ error: 'Accès refusé : droits insuffisants.' });
  }
  const compte = decodeURIComponent(req.params.compte || '').trim();
  try {
    const { rows } = await query(
      `UPDATE plan_comptable_syscohada
         SET actif = false
       WHERE lower(btrim(compte)) = lower(btrim($1))
         AND source = 'custom'
       RETURNING compte`,
      [compte]
    );
    if (rows.length === 0) {
      return res.status(404).json({
        error: 'Compte introuvable ou non personnalisé (référentiel SYSCOHADA protégé).',
      });
    }
    res.json({ message: 'Compte désactivé.' });
  } catch (err) {
    console.error('[PlanComptable] deleteCompte :', err.message);
    res.status(500).json({ error: 'Erreur lors de la désactivation du compte.' });
  }
};

module.exports = { search, getClasses, list, getStats, createCompte, deleteCompte };
