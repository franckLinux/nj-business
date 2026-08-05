// src/middleware/tenant.js
// Garantit que chaque requête s'exécute dans le contexte du bon tenant
const { query } = require('../config/database');

/**
 * Injecte req.tenantId depuis :
 *  1. req.user.tenantId (JWT) — pour les utilisateurs clients
 *  2. req.headers['x-tenant-id'] — pour le super_admin cabinet qui switche de tenant
 *  3. req.params.tenantId — pour les routes /tenants/:tenantId/...
 */
const tenantGuard = async (req, res, next) => {
  let tenantId = req.user?.tenantId || req.headers['x-tenant-id'] || req.params.tenantId;

  if (!tenantId) {
    // Super admin sans contexte tenant → accès global autorisé
    if (req.user?.role === 'super_admin' || req.user?.role === 'comptable_cabinet') {
      req.tenantId = null;
      return next();
    }
    return res.status(400).json({ error: 'Contexte tenant manquant.' });
  }

  // Vérification que le tenant existe et est actif
  try {
    const { rows } = await query(
      'SELECT id, nom, devise FROM tenants WHERE id = $1 AND actif = true',
      [tenantId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Client introuvable ou inactif.' });
    }
    req.tenantId   = rows[0].id;
    req.tenantInfo = rows[0];
    next();
  } catch (err) {
    console.error('[Tenant] Erreur vérification tenant :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = { tenantGuard };
