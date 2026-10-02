// src/middleware/auth.js
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

// Rôles « cabinet » : comptes du cabinet qui administrent plusieurs clients.
const ROLES_CABINET = ['super_admin', 'comptable_cabinet'];

/**
 * Guard JWT — vérifie le token Bearer puis RECHARGE l'utilisateur en base.
 * Injecte req.user = { id, username, role, tenantId }.
 *
 * Le JWT ne sert plus qu'à prouver l'identité (sub). Le rôle, le client et
 * l'état actif sont lus en base à chaque requête : auparavant ils venaient du
 * token, si bien qu'un compte désactivé, supprimé ou rétrogradé gardait ses
 * anciens droits jusqu'à l'expiration du token (8 h par défaut), et que
 * l'interface (rôle frais via /auth/me) et l'API (rôle figé du token)
 * appliquaient deux règles différentes.
 */
const authGuard = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant ou invalide.' });
  }

  let payload;
  try {
    payload = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expirée. Veuillez vous reconnecter.' });
    }
    return res.status(401).json({ error: 'Token invalide.' });
  }

  try {
    const { rows } = await query(
      'SELECT id, username, role, tenant_id, actif FROM users WHERE id = $1',
      [payload.sub]
    );
    const u = rows[0];
    if (!u || !u.actif) {
      return res.status(401).json({ error: 'Compte désactivé ou supprimé. Veuillez vous reconnecter.' });
    }
    req.user = {
      id:       u.id,
      username: u.username,
      role:     u.role,
      tenantId: u.tenant_id || null,
    };
    next();
  } catch (err) {
    console.error('[Auth] chargement utilisateur :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

/**
 * Usine de guards par rôle — réservée à l'IDENTITÉ (cabinet / client),
 * jamais aux fonctionnalités, qui passent par requirePermission.
 * Ex: requireRole('super_admin')
 */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Non authentifié.' });
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({
      error: `Accès refusé. Rôles requis : ${roles.join(', ')}.`,
    });
  }
  next();
};

/**
 * Appartenance au cabinet : super_admin, ou comptable_cabinet NON rattaché à
 * un client. Un « comptable_cabinet » créé à l'intérieur d'un client (ce que
 * l'API permettait) n'est pas un membre du cabinet et ne doit voir ni la liste
 * des clients ni les droits des autres clients.
 */
const isCabinet = (user) => Boolean(user) && (
  user.role === 'super_admin' || (user.role === 'comptable_cabinet' && !user.tenantId)
);

const requireCabinet = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Non authentifié.' });
  if (!isCabinet(req.user)) return res.status(403).json({ error: 'Accès réservé au cabinet.' });
  next();
};

module.exports = { authGuard, requireRole, requireCabinet, isCabinet, ROLES_CABINET };
