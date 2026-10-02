// src/middleware/tenant.js
// Garantit que chaque requête s'exécute dans le contexte du bon tenant
const { query } = require('../config/database');
const { isCabinet } = require('./auth');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Injecte req.tenantId depuis :
 *  1. req.user.tenantId (JWT/base) — utilisateur rattaché à un client : TOUJOURS
 *     son propre client, l'en-tête et l'URL sont ignorés ;
 *  2. req.headers['x-tenant-id'] ou req.params.tenantId — UNIQUEMENT pour un
 *     membre du cabinet (super_admin / comptable_cabinet sans client) qui
 *     choisit le client à administrer.
 * Tout autre compte sans client (ex. caissier créé hors contexte client) est
 * refusé : auparavant il pouvait viser n'importe quel client via l'en-tête.
 */
const tenantGuard = async (req, res, next) => {
  let tenantId;
  if (req.user?.tenantId) {
    tenantId = req.user.tenantId;
  } else if (isCabinet(req.user)) {
    tenantId = req.headers['x-tenant-id'] || req.params.tenantId || null;
    if (!tenantId) {
      // Membre du cabinet sans client sélectionné → contexte global.
      req.tenantId = null;
      return next();
    }
  } else {
    return res.status(403).json({ error: 'Compte non rattaché à un client.' });
  }

  if (!UUID_RE.test(String(tenantId))) {
    return res.status(400).json({ error: 'Identifiant client invalide.' });
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
