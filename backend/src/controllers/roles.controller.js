// src/controllers/roles.controller.js
const { sequelize, Role, RolePermission } = require('../models');
const { verifierCodesAccordables } = require('../services/permission.service');

// ── Liste des rôles du tenant ────────────────────────────────────────────────
const getRoles = async (req, res) => {
  try {
    const roles = await Role.findAll({
      where: { tenant_id: req.tenantId },
      attributes: {
        include: [[sequelize.fn('COUNT', sequelize.col('RolePermissions.permission_code')), 'nb_permissions']],
      },
      include: [{ model: RolePermission, attributes: [] }],
      group: ['Role.id'],
      order: [['created_at', 'ASC']],
      subQuery: false,
    });
    res.json(roles.map((r) => ({ ...r.toJSON(), nb_permissions: parseInt(r.get('nb_permissions'), 10) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── Créer un rôle ────────────────────────────────────────────────────────────
const createRole = async (req, res) => {
  const { nom, code, description, couleur } = req.body;
  if (!nom || !code) return res.status(400).json({ error: 'Nom et code obligatoires.' });
  const safeCode = code.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  try {
    const role = await Role.create({
      nom: nom.trim(),
      code: safeCode,
      description: description || '',
      couleur: couleur || '#6366f1',
      tenant_id: req.tenantId,
    });
    res.status(201).json(role);
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') return res.status(409).json({ error: `Le code "${code}" existe déjà.` });
    res.status(500).json({ error: err.message });
  }
};

// ── Modifier un rôle ─────────────────────────────────────────────────────────
const updateRole = async (req, res) => {
  const { id } = req.params;
  const { nom, description, couleur } = req.body;
  if (!nom) return res.status(400).json({ error: 'Nom obligatoire.' });
  try {
    const [count, rows] = await Role.update(
      { nom: nom.trim(), description: description || '', couleur: couleur || '#6366f1' },
      { where: { id, tenant_id: req.tenantId }, returning: true }
    );
    if (count === 0) return res.status(404).json({ error: 'Rôle introuvable.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── Supprimer un rôle ────────────────────────────────────────────────────────
const deleteRole = async (req, res) => {
  const { id } = req.params;
  try {
    await Role.destroy({ where: { id, tenant_id: req.tenantId } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── Permissions d'un rôle ────────────────────────────────────────────────────
const getRolePermissions = async (req, res) => {
  const { id } = req.params;
  try {
    const role = await Role.findOne({ where: { id, tenant_id: req.tenantId }, attributes: ['id'], raw: true });
    if (!role) return res.status(404).json({ error: 'Rôle introuvable pour ce client.' });
    const perms = await RolePermission.findAll({ where: { role_id: id }, attributes: ['permission_code'], raw: true });
    res.json(perms.map((r) => r.permission_code));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── Définir les permissions d'un rôle (remplace tout) ───────────────────────
const setRolePermissions = async (req, res) => {
  const { id } = req.params;
  let codes = Array.isArray(req.body.codes) ? req.body.codes : [];
  try {
    const role = await Role.findOne({ where: { id, tenant_id: req.tenantId }, attributes: ['id', 'tenant_id'], raw: true });
    if (!role) return res.status(404).json({ error: 'Rôle introuvable pour ce client.' });
    const verif = await verifierCodesAccordables(codes, role.tenant_id);
    if (verif.erreur) return res.status(400).json({ error: verif.erreur });
    codes = verif.codes;
    await sequelize.transaction(async (t) => {
      await RolePermission.destroy({ where: { role_id: id }, transaction: t });
      if (codes.length > 0) {
        await RolePermission.bulkCreate(
          codes.map((permission_code) => ({ role_id: id, permission_code })),
          { transaction: t }
        );
      }
    });
    res.json({ ok: true, count: codes.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getRoles, createRole, updateRole, deleteRole, getRolePermissions, setRolePermissions };
