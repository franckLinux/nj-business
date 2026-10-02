// src/controllers/plan_comptable.controller.js
// Recherche dans le plan SYSCOHADA révisé
const { Op, where, fn, col } = require('sequelize');
const { sequelize, PlanComptableSyscohada } = require('../models');

// GET /api/plan-comptable/search?q=transport&classe=6
const search = async (req, res) => {
  const { q, classe, nature } = req.query;
  if (!q || q.trim().length < 2) {
    return res.status(400).json({ error: 'Minimum 2 caractères.' });
  }
  try {
    const filtre = { actif: true };
    filtre[Op.or] = [
      { compte: { [Op.iLike]: `%${q.trim()}%` } },
      { intitule: { [Op.iLike]: `%${q.trim()}%` } },
    ];
    if (classe) filtre.classe = parseInt(classe, 10);
    if (nature) filtre.nature = nature;

    const comptes = await PlanComptableSyscohada.findAll({
      where: filtre,
      attributes: ['compte', 'intitule', 'classe', 'nature'],
      order: [['compte', 'ASC']],
      limit: 20,
    });
    res.json(comptes);
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
  const limit = Math.min(parseInt(req.query.limit, 10) || 1000, 5000);
  try {
    const filtre = { actif: true };
    if (q && q.trim().length > 0) {
      filtre[Op.or] = [
        { compte: { [Op.iLike]: `%${q.trim()}%` } },
        { intitule: { [Op.iLike]: `%${q.trim()}%` } },
      ];
    }
    if (classe) filtre.classe = parseInt(classe, 10);
    if (nature) filtre.nature = nature;

    const comptes = await PlanComptableSyscohada.findAll({
      where: filtre,
      attributes: ['compte', 'intitule', 'classe', 'nature', 'source'],
      order: [['compte', 'ASC']],
      limit,
      raw: true,
    });
    res.json({
      comptes: comptes.map(c => ({ ...c, source: c.source || 'syscohada' })),
      total: comptes.length,
      limit,
    });
  } catch (err) {
    console.warn('[PlanComptable] list - table absente :', err.message);
    res.json({ comptes: [], total: 0, limit, error: 'Plan comptable non chargé en base.' });
  }
};

// GET /api/plan-comptable/stats — comptage par classe (pour les badges UI)
const getStats = async (req, res) => {
  try {
    const rows = await PlanComptableSyscohada.findAll({
      where: { actif: true },
      attributes: ['classe', [fn('COUNT', col('classe')), 'nb']],
      group: ['classe'],
      order: [['classe', 'ASC']],
      raw: true,
    });
    const parClasse = rows.map(r => ({ classe: r.classe, nb: parseInt(r.nb, 10) }));
    const total = parClasse.reduce((s, r) => s + r.nb, 0);
    res.json({ par_classe: parClasse, total });
  } catch (err) {
    res.json({ par_classe: [], total: 0 });
  }
};

// POST /api/plan-comptable — ajouter un compte personnalisé
// Numéro de compte sans limite de taille (colonne TEXT).
// Autorisation déléguée à requirePermission('plan_comptable.edit') sur la route
// (voir routes/index.js) — pas de contrôle de rôle en dur ici, pour que la
// permission accordée à un utilisateur/tenant fasse foi, comme journal/budget-caisse.
const createCompte = async (req, res) => {
  let { compte, intitule, classe, nature } = req.body;
  compte   = (compte   || '').toString().trim();
  intitule = (intitule || '').toString().trim();

  if (!compte || !intitule) {
    return res.status(400).json({ error: 'Numéro de compte et intitulé obligatoires.' });
  }

  // Classe déduite du 1er chiffre si non fournie (1..9 SYSCOHADA).
  let classeNum = parseInt(classe, 10);
  if (!classeNum || classeNum < 1 || classeNum > 9) {
    const firstDigit = compte.match(/\d/);
    classeNum = firstDigit ? parseInt(firstDigit[0], 10) : null;
  }

  // Upsert sur l'index fonctionnel lower(btrim(compte)) : au-delà de ce que
  // le query builder Sequelize exprime proprement, on passe par une requête
  // SQL paramétrée exécutée via l'instance Sequelize (toujours dans l'ORM).
  try {
    const [rows] = await sequelize.query(
      `INSERT INTO plan_comptable_syscohada (compte, intitule, classe, nature, source, actif, created_by)
       VALUES (:compte, :intitule, :classe, :nature, 'custom', true, :createdBy)
       ON CONFLICT (lower(btrim(compte))) DO UPDATE
         SET intitule = EXCLUDED.intitule,
             classe   = EXCLUDED.classe,
             nature   = EXCLUDED.nature,
             actif    = true
       RETURNING compte, intitule, classe, nature, source`,
      { replacements: { compte, intitule, classe: classeNum, nature: nature || null, createdBy: req.user.id } }
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
  const compte = decodeURIComponent(req.params.compte || '').trim();
  try {
    const [count, rows] = await PlanComptableSyscohada.update(
      { actif: false },
      {
        where: {
          [Op.and]: [
            where(fn('lower', fn('btrim', col('compte'))), fn('lower', fn('btrim', compte))),
            { source: 'custom' },
          ],
        },
        returning: true,
      }
    );
    if (count === 0) {
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
