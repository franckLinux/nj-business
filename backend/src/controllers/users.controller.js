// src/controllers/users.controller.js
const bcrypt = require('bcryptjs');
const { sequelize, User, Role } = require('../models');

const ROLES_VALIDES = ['directeur', 'caissier', 'auditeur', 'comptable_cabinet'];
const ROLES_LABELS = {
  directeur: 'Directeur',
  caissier: 'Caissier(ère)',
  auditeur: 'Auditeur',
  comptable_cabinet: 'Comptable Cabinet',
  super_admin: 'Super Admin',
};
const PRIORITE_ROLE = { directeur: 1, comptable_cabinet: 2, caissier: 3, auditeur: 4 };

// GET /api/users
const getUsers = async (req, res) => {
  try {
    const users = await User.findAll({
      where: { tenant_id: req.tenantId },
      attributes: ['id', 'username', 'email', 'role', 'actif', 'derniere_connexion', 'created_at', 'custom_role_id'],
      include: [{ model: Role, as: 'roleCustom', attributes: ['nom', 'couleur', 'code'], required: false }],
    });
    const rows = users
      .map((u) => {
        const { roleCustom, ...rest } = u.toJSON();
        return {
          ...rest,
          custom_role_nom: roleCustom ? roleCustom.nom : null,
          custom_role_couleur: roleCustom ? roleCustom.couleur : null,
          custom_role_code: roleCustom ? roleCustom.code : null,
        };
      })
      .sort((a, b) => {
        const pa = PRIORITE_ROLE[a.role] || 5;
        const pb = PRIORITE_ROLE[b.role] || 5;
        return pa !== pb ? pa - pb : a.username.localeCompare(b.username);
      });
    res.json(rows);
  } catch (err) {
    console.error('[Users] getUsers :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// POST /api/users
const createUser = async (req, res) => {
  const { username, password, role, email, custom_role_id } = req.body;
  if (!username || !password || password.length < 6 || !role) {
    return res.status(400).json({ error: 'Tous les champs sont requis. Mot de passe : minimum 6 caractères.' });
  }
  if (!ROLES_VALIDES.includes(role)) {
    return res.status(400).json({ error: `Rôle invalide. Valeurs acceptées : ${ROLES_VALIDES.join(', ')}` });
  }
  const roleId = custom_role_id ? parseInt(custom_role_id, 10) : null;
  try {
    const hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS, 10) || 12);
    const user = await User.create({
      tenant_id: req.tenantId,
      username: username.trim(),
      email: email || null,
      password_hash: hash,
      role,
      custom_role_id: roleId,
    });
    res.status(201).json({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      actif: user.actif,
      created_at: user.created_at,
      custom_role_id: user.custom_role_id,
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') return res.status(409).json({ error: "Ce nom d'utilisateur existe déjà." });
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// PUT /api/users/:id
const updateUser = async (req, res) => {
  const { username, email, role, custom_role_id } = req.body;
  if (role && !ROLES_VALIDES.concat(['super_admin']).includes(role)) {
    return res.status(400).json({ error: 'Rôle invalide.' });
  }
  if (req.params.id === req.user.id && role && role !== req.user.role) {
    return res.status(400).json({ error: 'Vous ne pouvez pas modifier votre propre rôle.' });
  }
  const roleId = custom_role_id !== undefined ? (custom_role_id ? parseInt(custom_role_id, 10) : null) : null;
  try {
    const [count, rows] = await User.update(
      {
        username: username === undefined ? null : username,
        email: email || null,
        role: role === undefined ? null : role,
        custom_role_id: roleId,
      },
      { where: { id: req.params.id, tenant_id: req.tenantId }, returning: true }
    );
    if (count === 0) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    const u = rows[0];
    res.json({ id: u.id, username: u.username, email: u.email, role: u.role, actif: u.actif, custom_role_id: u.custom_role_id });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') return res.status(409).json({ error: "Ce nom d'utilisateur existe déjà." });
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// PATCH /api/users/:id/actif  — activer ou désactiver
const toggleActif = async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Impossible de désactiver votre propre compte.' });
  }
  try {
    const [count, rows] = await User.update(
      { actif: sequelize.literal('NOT actif') },
      { where: { id: req.params.id, tenant_id: req.tenantId }, returning: true }
    );
    if (count === 0) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    const u = rows[0];
    const statut = u.actif ? 'activé' : 'désactivé';
    res.json({ message: `Compte ${statut} avec succès.`, user: { id: u.id, username: u.username, role: u.role, actif: u.actif } });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// POST /api/users/:id/password  — réinitialiser mot de passe
const resetPassword = async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Minimum 6 caractères.' });
  }
  try {
    const hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS, 10) || 12);
    const [count] = await User.update(
      { password_hash: hash },
      { where: { id: req.params.id, tenant_id: req.tenantId } }
    );
    if (count === 0) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    res.json({ message: 'Mot de passe réinitialisé.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// DELETE /api/users/:id
const deleteUser = async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Impossible de supprimer votre propre compte.' });
  }
  try {
    const count = await User.destroy({ where: { id: req.params.id, tenant_id: req.tenantId } });
    if (count === 0) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    res.json({ message: 'Utilisateur supprimé.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = { getUsers, createUser, updateUser, toggleActif, resetPassword, deleteUser, ROLES_LABELS, ROLES_VALIDES };
