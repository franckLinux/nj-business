// src/controllers/auth.controller.js
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { query } = require('../config/database');
const { getEffectivePermissions, getPermissionsAccordees } = require('../services/permission.service');

/**
 * POST /api/auth/login
 */
const login = async (req, res) => {
  const { username, password } = req.body;

  try {
    const { rows } = await query(
      `SELECT u.id, u.username, u.password_hash, u.role, u.tenant_id, u.actif,
              t.nom AS tenant_nom, t.slug AS tenant_slug, t.devise
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE u.username = $1`,
      [username.trim()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' });
    }

    const user = rows[0];
    if (!user.actif) {
      return res.status(403).json({ error: 'Compte désactivé. Contactez votre administrateur.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' });
    }

    // Génération JWT
    const tokenPayload = {
      sub:      user.id,
      username: user.username,
      role:     user.role,
      tenantId: user.tenant_id,
    };

    const accessToken = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    });

    // Mise à jour dernière connexion
    await query('UPDATE users SET derniere_connexion = NOW() WHERE id = $1', [user.id]);

    const permissions = await getEffectivePermissions({ tenantId: user.tenant_id, userId: user.id, role: user.role });
    const permissionsAccordees = await getPermissionsAccordees(user.id);

    res.json({
      accessToken,
      user: {
        id:          user.id,
        username:    user.username,
        role:        user.role,
        tenantId:    user.tenant_id,
        tenantNom:   user.tenant_nom,
        tenantSlug:  user.tenant_slug,
        devise:      user.devise || process.env.DEVISE || 'FCFA',
        permissionsAccordees, // exceptions individuelles 'grant' (affichage des onglets)
        permissions, // null = pas de restriction configurée (rôle fixe seul) ; tableau = liste exclusive
      },
    });
  } catch (err) {
    console.error('[Auth] Erreur login :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

/**
 * GET /api/auth/me
 */
const me = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.username, u.role, u.tenant_id, u.derniere_connexion,
              t.nom AS tenant_nom, t.slug AS tenant_slug, t.devise, t.logo_url
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1`,
      [req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    const u = rows[0];
    // Le plafond appliqué doit être celui du client CONSULTÉ, exactement comme
    // le fait requirePermission (req.tenantId = en-tête X-Tenant-Id pour le
    // cabinet). Sans cela, un membre du cabinet positionné sur un client voyait
    // des onglets (calculés sans plafond) que l'API lui refusait ensuite (403).
    const enTete = req.get('X-Tenant-Id');
    const uuidValide = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const tenantContexte = u.tenant_id || (enTete && uuidValide.test(enTete) ? enTete : null);
    const permissions = await getEffectivePermissions({ tenantId: tenantContexte, userId: u.id, role: u.role });
    const permissionsAccordees = await getPermissionsAccordees(u.id);
    res.json({ ...u, permissions, permissionsAccordees });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

/**
 * POST /api/auth/change-password
 */
const changePassword = async (req, res) => {
  const { ancienPassword, nouveauPassword } = req.body;

  try {
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const valid = await bcrypt.compare(ancienPassword, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Ancien mot de passe incorrect.' });

    const hash = await bcrypt.hash(nouveauPassword, parseInt(process.env.BCRYPT_ROUNDS) || 12);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);

    res.json({ message: 'Mot de passe modifié avec succès.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = { login, me, changePassword };
