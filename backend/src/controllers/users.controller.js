// src/controllers/users.controller.js
const bcrypt    = require('bcryptjs');
const { query } = require('../config/database');

const ROLES_VALIDES = ['directeur','caissier','auditeur','comptable_cabinet'];
const ROLES_LABELS  = {
  directeur:          'Directeur',
  caissier:           'Caissier(ère)',
  auditeur:           'Auditeur',
  comptable_cabinet:  'Comptable Cabinet',
  super_admin:        'Super Admin',
};

// GET /api/users
const getUsers = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.username, u.email, u.role, u.actif, u.derniere_connexion, u.created_at,
              u.custom_role_id,
              r.nom AS custom_role_nom, r.couleur AS custom_role_couleur, r.code AS custom_role_code
       FROM users u
       LEFT JOIN roles r ON r.id = u.custom_role_id
       WHERE u.tenant_id=$1
       ORDER BY
         CASE u.role
           WHEN 'directeur'         THEN 1
           WHEN 'comptable_cabinet' THEN 2
           WHEN 'caissier'          THEN 3
           WHEN 'auditeur'          THEN 4
           ELSE 5
         END, u.username`,
      [req.tenantId]
    );
    res.json(rows);
  } catch (err) {
    console.error('[Users] getUsers :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// POST /api/users
const createUser = async (req, res) => {
  if (!['directeur','super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Réservé au directeur.' });
  }
  const { username, password, role, email, custom_role_id } = req.body;
  if (!username || !password || password.length < 6 || !role) {
    return res.status(400).json({ error: 'Tous les champs sont requis. Mot de passe : minimum 6 caractères.' });
  }
  if (!ROLES_VALIDES.includes(role)) {
    return res.status(400).json({ error: `Rôle invalide. Valeurs acceptées : ${ROLES_VALIDES.join(', ')}` });
  }
  const roleId = custom_role_id ? parseInt(custom_role_id) : null;
  try {
    const hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS)||12);
    const { rows } = await query(
      `INSERT INTO users(tenant_id, username, email, password_hash, role, custom_role_id)
       VALUES($1,$2,$3,$4,$5,$6)
       RETURNING id, username, email, role, actif, created_at, custom_role_id`,
      [req.tenantId, username.trim(), email||null, hash, role, roleId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: "Ce nom d'utilisateur existe déjà." });
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// PUT /api/users/:id
const updateUser = async (req, res) => {
  if (!['directeur','super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Réservé au directeur.' });
  }
  const { username, email, role, custom_role_id } = req.body;
  if (role && !ROLES_VALIDES.concat(['super_admin']).includes(role)) {
    return res.status(400).json({ error: 'Rôle invalide.' });
  }
  if (req.params.id === req.user.id && role && role !== req.user.role) {
    return res.status(400).json({ error: 'Vous ne pouvez pas modifier votre propre rôle.' });
  }
  const roleId = custom_role_id !== undefined ? (custom_role_id ? parseInt(custom_role_id) : null) : undefined;
  try {
    const { rows } = await query(
      `UPDATE users SET username=$1, email=$2, role=$3, custom_role_id=$4
       WHERE id=$5 AND tenant_id=$6
       RETURNING id, username, email, role, actif, custom_role_id`,
      [username, email||null, role, roleId !== undefined ? roleId : null, req.params.id, req.tenantId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: "Ce nom d'utilisateur existe déjà." });
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// PATCH /api/users/:id/actif  — activer ou désactiver
const toggleActif = async (req, res) => {
  if (!['directeur','super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Réservé au directeur.' });
  }
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Impossible de désactiver votre propre compte.' });
  }
  try {
    const { rows } = await query(
      `UPDATE users SET actif = NOT actif
       WHERE id=$1 AND tenant_id=$2
       RETURNING id, username, role, actif`,
      [req.params.id, req.tenantId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    const statut = rows[0].actif ? 'activé' : 'désactivé';
    res.json({ message: `Compte ${statut} avec succès.`, user: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// POST /api/users/:id/password  — réinitialiser mot de passe
const resetPassword = async (req, res) => {
  if (!['directeur','super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Réservé au directeur.' });
  }
  const { password } = req.body;
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Minimum 6 caractères.' });
  }
  try {
    const hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS)||12);
    const { rowCount } = await query(
      'UPDATE users SET password_hash=$1 WHERE id=$2 AND tenant_id=$3',
      [hash, req.params.id, req.tenantId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    res.json({ message: 'Mot de passe réinitialisé.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// DELETE /api/users/:id
const deleteUser = async (req, res) => {
  if (!['directeur','super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Réservé au directeur.' });
  }
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Impossible de supprimer votre propre compte.' });
  }
  try {
    const { rowCount } = await query(
      'DELETE FROM users WHERE id=$1 AND tenant_id=$2',
      [req.params.id, req.tenantId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    res.json({ message: 'Utilisateur supprimé.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = { getUsers, createUser, updateUser, toggleActif, resetPassword, deleteUser, ROLES_LABELS };
