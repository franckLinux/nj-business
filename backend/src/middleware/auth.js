// src/middleware/auth.js
const jwt = require('jsonwebtoken');

/**
 * Guard JWT — vérifie le token Bearer dans Authorization header
 * Injecte req.user = { id, username, role, tenantId }
 */
const authGuard = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant ou invalide.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      id:       payload.sub,
      username: payload.username,
      role:     payload.role,
      tenantId: payload.tenantId || null,
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expirée. Veuillez vous reconnecter.' });
    }
    return res.status(401).json({ error: 'Token invalide.' });
  }
};

/**
 * Usine de guards par rôle
 * Ex: requireRole('directeur','super_admin')
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

module.exports = { authGuard, requireRole };
