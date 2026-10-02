// src/controllers/permissions.controller.js
const { sequelize, Permission, TenantPermission, UserPermission, User } = require('../models');
const { getEffectivePermissions, verifierCodesAccordables } = require('../services/permission.service');

// ── Catalogue des permissions ──────────────────────────────────────────────

const getPermissions = async (req, res) => {
  try {
    const permissions = await Permission.findAll({ order: [['module', 'ASC'], ['code', 'ASC']] });
    res.json(permissions);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

const createPermission = async (req, res) => {
  const { code, nom, module, description } = req.body;
  if (!code || !nom || !module) return res.status(400).json({ error: 'code, nom et module sont obligatoires.' });
  if (!/^[a-z_]+\.[a-z_]+$/.test(code)) return res.status(400).json({ error: 'Format code invalide (ex: journal.create).' });
  try {
    const permission = await Permission.create({ code, nom, module, description: description || '' });
    res.status(201).json(permission);
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') return res.status(409).json({ error: 'Ce code de permission existe déjà.' });
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

const updatePermission = async (req, res) => {
  const { code } = req.params;
  const { nom, module, description } = req.body;
  try {
    const [count, rows] = await Permission.update(
      {
        nom: nom === undefined ? null : nom,
        module: module === undefined ? null : module,
        description: description || '',
      },
      { where: { code }, returning: true }
    );
    if (count === 0) return res.status(404).json({ error: 'Permission introuvable.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

const deletePermission = async (req, res) => {
  const { code } = req.params;
  try {
    await Permission.destroy({ where: { code } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── Permissions par tenant ─────────────────────────────────────────────────

const getTenantPermissions = async (req, res) => {
  const { tenantId } = req.params;
  try {
    const perms = await TenantPermission.findAll({ where: { tenant_id: tenantId }, attributes: ['permission_code'], raw: true });
    // Aucun plafond = aucune restriction : on présente tout le catalogue coché.
    // Sinon la modale s'ouvrait vide et décocher UNE case créait un plafond
    // réduit à presque rien pour tout le client (même piège que côté utilisateur).
    if (perms.length === 0) {
      const toutes = await Permission.findAll({ attributes: ['code'], raw: true });
      return res.json(toutes.map((p) => p.code));
    }
    res.json(perms.map((r) => r.permission_code));
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

const setTenantPermissions = async (req, res) => {
  const { tenantId } = req.params;
  let { codes } = req.body; // tableau de codes à accorder
  if (!Array.isArray(codes)) return res.status(400).json({ error: 'codes doit être un tableau.' });
  try {
    // Tout le catalogue coché = pas de plafond (on n'écrit rien). Ainsi une
    // permission ajoutée plus tard au catalogue (ex. journal.ran en 012) n'est
    // pas bloquée en silence pour ce client.
    const catalogue = (await Permission.findAll({ attributes: ['code'], raw: true })).map((p) => p.code);
    codes = [...new Set(codes)].filter((c) => catalogue.includes(c));
    const toutCoche = catalogue.every((c) => codes.includes(c));
    if (codes.length === 0) {
      return res.status(400).json({ error: 'Un client sans aucune permission ne pourrait plus rien faire. Cochez au moins une fonctionnalité.' });
    }
    await sequelize.transaction(async (t) => {
      await TenantPermission.destroy({ where: { tenant_id: tenantId }, transaction: t });
      if (!toutCoche) {
        await TenantPermission.bulkCreate(
          codes.map((permission_code) => ({ tenant_id: tenantId, permission_code })),
          { transaction: t, ignoreDuplicates: true }
        );
      }
    });
    res.json({ ok: true, count: codes.length });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── Permissions par utilisateur ────────────────────────────────────────────

// Renvoie les permissions EFFECTIVES de la personne (ce qu'elle peut
// réellement faire aujourd'hui), et non les seules lignes de user_permissions.
//
// C'est indispensable pour l'écran d'attribution : enregistrer y remplace la
// totalité de la liste (une permission individuelle est exclusive, elle ne
// s'ajoute pas au défaut du rôle). Si la modale s'ouvrait vide pour quelqu'un
// qui n'a encore aucune surcharge, cocher une seule case lui retirerait tout
// le reste — accorder un droit reviendrait à en supprimer dix.
const getUserPermissions = async (req, res) => {
  const { userId } = req.params;
  try {
    const u = await User.findByPk(userId, { attributes: ['id', 'role', 'tenant_id'], raw: true });
    if (!u) return res.status(404).json({ error: 'Utilisateur introuvable.' });

    const effectives = await getEffectivePermissions({
      tenantId: u.tenant_id, userId: u.id, role: u.role,
    });
    // null = super_admin, aucune restriction : on présente tout le catalogue.
    if (effectives === null) {
      const toutes = await Permission.findAll({ attributes: ['code'], raw: true });
      return res.json(toutes.map((p) => p.code));
    }
    res.json(effectives);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

const setUserPermissions = async (req, res) => {
  const { userId } = req.params;
  let { codes } = req.body;
  if (!Array.isArray(codes)) return res.status(400).json({ error: 'codes doit être un tableau.' });
  try {
    const u = await User.findByPk(userId, { attributes: ['id', 'tenant_id'], raw: true });
    if (!u) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    const verif = await verifierCodesAccordables(codes, u.tenant_id);
    if (verif.erreur) return res.status(400).json({ error: verif.erreur });
    codes = verif.codes;
    await sequelize.transaction(async (t) => {
      await UserPermission.destroy({ where: { user_id: userId }, transaction: t });
      if (codes.length > 0) {
        await UserPermission.bulkCreate(
          codes.map((permission_code) => ({ user_id: userId, permission_code })),
          { transaction: t, ignoreDuplicates: true }
        );
      }
    });
    res.json({ ok: true, count: codes.length });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = {
  getPermissions, createPermission, updatePermission, deletePermission,
  getTenantPermissions, setTenantPermissions,
  getUserPermissions, setUserPermissions,
};
