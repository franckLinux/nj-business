// src/controllers/plan_comptable.controller.js
// Recherche dans le plan SYSCOHADA révisé
const { Op, where, fn, col } = require('sequelize');
const { sequelize, PlanComptableSyscohada } = require('../models');
const planClient = require('../services/plan_client.service');

// Réforme du plan comptable (étape 3) : chaque route sert d'abord le plan DU
// CLIENT consulté (req.tenantId, fixé par tenantGuard — jamais un identifiant
// envoyé par le navigateur). Sans client, ou pour un client pas encore
// initialisé, le comportement d'origine (plan global) est conservé à l'identique.

// GET /api/plan-comptable/search?q=transport&classe=6
const search = async (req, res) => {
  const { q, classe, nature } = req.query;
  if (!q || q.trim().length < 2) {
    return res.status(400).json({ error: 'Minimum 2 caractères.' });
  }
  if (await planClient.planClientActif(req.tenantId)) {
    try {
      const rows = await planClient.rechercher(req.tenantId, { q, classe, nature }, 20);
      return res.json(rows.map(({ source, ...c }) => c));
    } catch (err) {
      console.error('[PlanComptable] search (client) :', err.message);
      return res.status(500).json({ error: 'Erreur serveur.' });
    }
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
  if (await planClient.planClientActif(req.tenantId)) {
    try {
      const comptes = await planClient.rechercher(req.tenantId, { q, classe, nature }, limit);
      return res.json({ comptes, total: comptes.length, limit });
    } catch (err) {
      console.error('[PlanComptable] list (client) :', err.message);
      return res.status(500).json({ error: 'Erreur serveur.' });
    }
  }
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
  if (await planClient.planClientActif(req.tenantId)) {
    try {
      return res.json(await planClient.statsParClasse(req.tenantId));
    } catch (err) {
      console.error('[PlanComptable] stats (client) :', err.message);
      return res.status(500).json({ error: 'Erreur serveur.' });
    }
  }
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

  // Plan propre au client : l'ajout reste dans SON plan (le modèle global et
  // les autres clients ne sont jamais touchés).
  if (await planClient.planClientActif(req.tenantId)) {
    try {
      const ligne = await planClient.ajouterCompte({
        tenantId: req.tenantId, userId: req.user.id,
        compte, intitule, classe: classeNum, nature: nature || null,
      });
      return res.status(201).json(ligne);
    } catch (err) {
      console.error('[PlanComptable] createCompte (client) :', err.message);
      return res.status(500).json({ error: "Impossible d'ajouter le compte." });
    }
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
  if (await planClient.planClientActif(req.tenantId)) {
    try {
      const ok = await planClient.desactiverCompte({ tenantId: req.tenantId, userId: req.user.id, compte });
      if (!ok) {
        return res.status(404).json({
          error: 'Compte introuvable ou issu du référentiel (seuls les comptes ajoutés peuvent être retirés).',
        });
      }
      return res.json({ message: 'Compte désactivé.' });
    } catch (err) {
      console.error('[PlanComptable] deleteCompte (client) :', err.message);
      return res.status(500).json({ error: 'Erreur lors de la désactivation du compte.' });
    }
  }
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

// ── Gestion du plan PAR LE CLIENT (réforme, étape 5) ──────────────────────
// Ces routes n'existent que pour un client dont le plan est initialisé :
// sans plan propre, on répond 409 (le frontend garde alors l'ancien écran).
const exigerPlanClient = async (req, res) => {
  if (await planClient.planClientActif(req.tenantId)) return true;
  res.status(409).json({ error: 'Ce client n\'a pas encore de plan comptable propre.', plan_client: false });
  return false;
};
const repondreErreur = (res, err, ctx) => {
  if (err instanceof planClient.ErreurMetier) return res.status(err.status).json({ error: err.message });
  // Protection posée en base (trigger 019) : compte utilisé.
  if (err.original?.code === '23001' || err.parent?.code === '23001') {
    return res.status(409).json({ error: err.parent?.message || err.message });
  }
  console.error(`[PlanComptable] ${ctx} :`, err.message);
  return res.status(500).json({ error: 'Erreur serveur.' });
};
const idParam = (req) => {
  const id = Number.parseInt(req.params.id, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

// GET /api/plan-comptable/comptes — plan complet du client, tous statuts.
const listComptes = async (req, res) => {
  if (!(await exigerPlanClient(req, res))) return;
  try {
    const comptes = await planClient.listerComptes(req.tenantId);
    res.json({ comptes, total: comptes.length, plan_client: true });
  } catch (err) { repondreErreur(res, err, 'listComptes'); }
};

// PUT /api/plan-comptable/comptes/:id — { intitule?, description?, compte? }
const updateCompte = async (req, res) => {
  const id = idParam(req);
  if (!id) return res.status(400).json({ error: 'Identifiant de compte invalide.' });
  if (!(await exigerPlanClient(req, res))) return;
  try {
    const { intitule, description, compte } = req.body;
    res.json(await planClient.modifierCompte({ tenantId: req.tenantId, userId: req.user.id, id, intitule, description, compte }));
  } catch (err) { repondreErreur(res, err, 'updateCompte'); }
};

// PATCH /api/plan-comptable/comptes/:id/statut — { statut: actif|inactif|archive }
const updateStatut = async (req, res) => {
  const id = idParam(req);
  if (!id) return res.status(400).json({ error: 'Identifiant de compte invalide.' });
  if (!(await exigerPlanClient(req, res))) return;
  try {
    res.json(await planClient.changerStatut({ tenantId: req.tenantId, userId: req.user.id, id, statut: req.body.statut }));
  } catch (err) { repondreErreur(res, err, 'updateStatut'); }
};

// GET /api/plan-comptable/comptes/:id/historique
const getHistorique = async (req, res) => {
  const id = idParam(req);
  if (!id) return res.status(400).json({ error: 'Identifiant de compte invalide.' });
  if (!(await exigerPlanClient(req, res))) return;
  try {
    res.json(await planClient.historique(req.tenantId, id));
  } catch (err) { repondreErreur(res, err, 'getHistorique'); }
};

module.exports = {
  search, getClasses, list, getStats, createCompte, deleteCompte,
  listComptes, updateCompte, updateStatut, getHistorique,
};
