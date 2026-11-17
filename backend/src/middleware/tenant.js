// src/middleware/tenant.js
// Garantit que chaque requête s'exécute dans le contexte du bon tenant
const { query } = require('../config/database');
const { isCabinet } = require('./auth');
const { peutAccederTenant } = require('../services/affectation.service');
const support = require('../services/support.service');
const modules = require('../services/modules.service');
const perm = require('../services/permission.service');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Injecte req.tenantId depuis :
 *  1. req.user.tenantId (JWT/base) — utilisateur rattaché à un client : TOUJOURS
 *     son propre client, l'en-tête et l'URL sont ignorés ;
 *  2. req.headers['x-tenant-id'] ou req.params.tenantId — UNIQUEMENT pour un
 *     membre du cabinet (super_admin / comptable_cabinet sans client) qui
 *     choisit le client à administrer — pour un comptable_cabinet, parmi les
 *     clients qui lui sont affectés (cabinet_affectations, migration 015).
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

  // Comptable cabinet : seulement les clients qui lui sont affectés (015).
  if (!req.user.tenantId) {
    try {
      if (!(await peutAccederTenant(req.user, String(tenantId)))) {
        return res.status(403).json({ error: 'Ce client ne vous est pas affecté.' });
      }
    } catch (err) {
      console.error('[Tenant] contrôle affectation :', err.message);
      return res.status(500).json({ error: 'Erreur serveur.' });
    }
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
    // NJ BUSINESS (048) : la route appartient-elle à un module désactivé pour
    // ce client ? Contrôle serveur, quel que soit le rôle (cabinet compris).
    // Les routes du socle (configuration, utilisateurs…) ne sont jamais bloquées.
    const cheminRoute = (req.originalUrl.split('?')[0] || '').replace(/^\/api/, '');
    const module = await modules.moduleDeRoute(cheminRoute);
    if (module) {
      const actifs = await modules.modulesActifs(rows[0].id);
      if (!actifs.includes(module)) {
        if (modules.modeControle() === 'appliquer') {
          return res.status(403).json({
            error: 'Ce module n\'est pas activé pour votre espace. Contactez le cabinet.',
            code: 'MODULE_INACTIF', module,
          });
        }
        console.warn(`[Modules] refus simulé (mode observer) : ${module} inactif pour ${rows[0].id} — ${req.method} ${cheminRoute} (utilisateur ${req.user.id})`);
      }
      // 066 : utilisateurs par module. Une personne du client n'entre dans un
      // module que si elle y est rattachée (mode « appliquer »).
      if (perm.ROLES_CLIENT.includes(req.user.role) && (await perm.modeAccesModules()) === 'appliquer') {
        const membre = await perm.modulesDe(req.user.id);
        if (!membre.has(module)) {
          return res.status(403).json({
            error: 'Vous n\'êtes pas rattaché(e) à ce module. Demandez l\'accès à votre directeur.',
            code: 'MODULE_NON_AUTORISE', module,
          });
        }
      }
    }
    // super_admin « limité » (étape 8) : données métier du client uniquement
    // pendant un accès support explicite, motivé et limité dans le temps.
    if (req.user.role === 'super_admin' && support.modeLimite()) {
      const chemin = (req.originalUrl.split('?')[0] || '').replace(/^\/api/, '');
      if (support.estRouteMetier(chemin)) {
        const session = await support.sessionActive(req.user.id, rows[0].id);
        if (!session) {
          return res.status(403).json({
            error: 'Accès support requis : les données de caisse de ce client ne sont accessibles qu\'avec un accès support temporaire.',
            code: 'SUPPORT_REQUIS', tenant_id: rows[0].id,
          });
        }
        req.supportSession = session;
      }
    }
    next();
  } catch (err) {
    console.error('[Tenant] Erreur vérification tenant :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = { tenantGuard };
