// src/controllers/users.controller.js
const { verifierLimiteUtilisateursDemo } = require('../services/prospects.service');
const bcrypt = require('bcryptjs');
const { sequelize, User, Role } = require('../models');

// Rôles (« types de compte ») — liste unique côté serveur.
//  - ROLES_TENANT  : attribuables à l'intérieur d'un client ;
//  - ROLES_CABINET_CREABLES : attribuables par le super_admin hors client.
// super_admin n'est JAMAIS attribuable via l'API : auparavant, un directeur
// disposant de users.edit pouvait promouvoir un compte de son client en
// super_admin et prendre le contrôle de toute la plateforme.
const ROLES_TENANT = ['directeur', 'caissier', 'auditeur'];
const ROLES_CABINET_CREABLES = ['comptable_cabinet', 'commercial'];
const TOUS_ROLES = ['super_admin', 'comptable_cabinet', 'commercial', ...ROLES_TENANT];
const ROLES_VALIDES = [...ROLES_TENANT, ...ROLES_CABINET_CREABLES]; // compat (validators)
const ROLES_LABELS = {
  directeur: 'Directeur',
  caissier: 'Caissier(ère)',
  auditeur: 'Auditeur',
  comptable_cabinet: 'Comptable Cabinet',
  commercial: 'Commercial',
  super_admin: 'Super Admin',
};
const PRIORITE_ROLE = { directeur: 1, comptable_cabinet: 2, caissier: 3, auditeur: 4 };

// Rôles que l'appelant peut attribuer dans le contexte courant.
const rolesAttribuables = (req) => {
  if (req.tenantId) return ROLES_TENANT;
  return req.user.role === 'super_admin' ? ROLES_CABINET_CREABLES : [];
};

// Le profil métier doit appartenir au client courant (sinon : IDOR — un
// directeur pouvait rattacher un profil d'un autre client par son id).
const verifierProfil = async (customRoleId, tenantId) => {
  if (customRoleId === null) return null;
  if (!Number.isInteger(customRoleId)) return 'Profil métier invalide.';
  const r = await Role.findOne({ where: { id: customRoleId, tenant_id: tenantId }, attributes: ['id'], raw: true });
  return r ? null : 'Profil métier introuvable pour ce client.';
};

const msgRoleRefuse = (req) => {
  const ok = rolesAttribuables(req);
  return ok.length
    ? `Rôle non attribuable ici. Valeurs acceptées : ${ok.join(', ')}.`
    : 'Aucun rôle attribuable dans ce contexte.';
};

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
  if (!rolesAttribuables(req).includes(role)) {
    return res.status(400).json({ error: msgRoleRefuse(req) });
  }
  const roleId = custom_role_id ? parseInt(custom_role_id, 10) : null;
  try {
    const errProfil = await verifierProfil(roleId, req.tenantId);
    if (errProfil) return res.status(400).json({ error: errProfil });
    // Espace de démonstration : nombre d'utilisateurs limité.
    try { await verifierLimiteUtilisateursDemo(req.tenantId); }
    catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); throw e; }

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
    console.error('[Users] createUser :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// PUT /api/users/:id — mise à jour PARTIELLE : un champ absent du corps n'est
// pas modifié. Auparavant un champ absent était écrit à NULL (username/role →
// erreur 500, email et profil métier effacés en silence).
const updateUser = async (req, res) => {
  const { username, email, role, custom_role_id } = req.body;
  try {
    const cible = await User.findOne({ where: { id: req.params.id, tenant_id: req.tenantId } });
    if (!cible) return res.status(404).json({ error: 'Utilisateur introuvable.' });

    const patch = {};
    if (username !== undefined) {
      if (!String(username).trim()) return res.status(400).json({ error: 'Identifiant obligatoire.' });
      patch.username = String(username).trim();
    }
    if (email !== undefined) patch.email = email ? String(email).trim() : null;
    if (role !== undefined && role !== '' && role !== cible.role) {
      if (req.params.id === req.user.id) {
        return res.status(400).json({ error: 'Vous ne pouvez pas modifier votre propre rôle.' });
      }
      if (!rolesAttribuables(req).includes(role)) return res.status(400).json({ error: msgRoleRefuse(req) });
      patch.role = role;
    }
    if (custom_role_id !== undefined) {
      const roleId = custom_role_id ? parseInt(custom_role_id, 10) : null;
      const errProfil = await verifierProfil(roleId, req.tenantId);
      if (errProfil) return res.status(400).json({ error: errProfil });
      patch.custom_role_id = roleId;
    }

    await cible.update(patch);
    const u = cible;
    res.json({ id: u.id, username: u.username, email: u.email, role: u.role, actif: u.actif, custom_role_id: u.custom_role_id });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') return res.status(409).json({ error: "Ce nom d'utilisateur existe déjà." });
    console.error('[Users] updateUser :', err.message);
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
    console.error('[Users] toggleActif :', err.message);
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
    console.error('[Users] resetPassword :', err.message);
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
    console.error('[Users] deleteUser :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = {
  getUsers, createUser, updateUser, toggleActif, resetPassword, deleteUser,
  ROLES_LABELS, ROLES_VALIDES, ROLES_TENANT, TOUS_ROLES,
};
