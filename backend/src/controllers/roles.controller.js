// src/controllers/roles.controller.js
const { sequelize, Role, RolePermission } = require('../models');
const { verifierCodesAccordables, getEffectivePermissions } = require('../services/permission.service');

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
    console.error('[Roles]', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── Créer un rôle ────────────────────────────────────────────────────────────
const createRole = async (req, res) => {
  const { nom, code, description, couleur } = req.body;
  if (!nom || !code) return res.status(400).json({ error: 'Nom et code obligatoires.' });
  const safeCode = code.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  // Les profils métier appartiennent à un client. Créés hors client, ils
  // devenaient des rôles « globaux » orphelins (UNIQUE(code, tenant_id) ne
  // s'applique pas à NULL → doublons possibles). Les rôles globaux sont
  // désormais réservés aux rôles système (migration 014).
  if (!req.tenantId) return res.status(400).json({ error: 'Sélectionnez d\'abord un client.' });
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
    console.error('[Roles]', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
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
    console.error('[Roles]', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── Supprimer un rôle ────────────────────────────────────────────────────────
const deleteRole = async (req, res) => {
  const { id } = req.params;
  try {
    const n = await Role.destroy({ where: { id, tenant_id: req.tenantId, is_system: false } });
    if (n === 0) return res.status(404).json({ error: 'Rôle introuvable ou rôle système (non supprimable).' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[Roles]', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
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
    console.error('[Roles]', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
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
    // Anti-escalade : hors super_admin (ex. directeur, permission roles.edit),
    // on ne peut mettre dans un profil que des permissions que l'on détient.
    if (req.user.role !== 'super_admin') {
      const miennes = new Set(await getEffectivePermissions({
        tenantId: req.tenantId, userId: req.user.id, role: req.user.role,
      }) || []);
      const hors = codes.filter((c) => !miennes.has(c));
      if (hors.length) {
        return res.status(403).json({ error: `Vous ne détenez pas : ${hors.join(', ')}. Impossible de les accorder.` });
      }
    }
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
    console.error('[Roles]', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = { getRoles, createRole, updateRole, deleteRole, getRolePermissions, setRolePermissions };
