// src/services/support.service.js
// Accès SUPPORT temporaire du super_admin aux données métier d'un client
// (réforme, étape 8). Sans session active, le super_admin ne voit plus la
// caisse, les journaux de mouvements, le budget, les rapports… d'un client :
// uniquement l'administration (clients, utilisateurs, rôles, configuration,
// plan comptable). Interrupteur : SUPER_ADMIN_ACCES_METIER = support (défaut)
// | libre (retour au comportement d'avant, en cas d'urgence).
const { query } = require('../config/database');

const DUREE_MAX_MIN = 240;

// Écrans « métier » : données détaillées des transactions du client.
const PREFIXES_METIER = [
  '/journal', '/mouvements-attente', '/budget', '/appel-fonds',
  '/rapport', '/banque', '/dashboard',
  '/controle',   // contrôle des pièces (042) : détail des écritures
  '/passerelle/simulation',   // balance de contrôle : détail des écritures du mois
  '/registre-tiers',   // registre clients / fournisseurs (043) : totaux par tiers
];
const estRouteMetier = (path) => {
  if (path.startsWith('/pieces/') && !path.startsWith('/pieces/types')) return true; // pièces jointes des mouvements
  return PREFIXES_METIER.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}-`) || path.startsWith(`${p}?`));
};

const modeLimite = () => (process.env.SUPER_ADMIN_ACCES_METIER || 'support').toLowerCase() !== 'libre';

const sessionActive = async (userId, tenantId) => {
  const { rows } = await query(
    `SELECT id, expire_le FROM support_acces
      WHERE user_id = $1 AND tenant_id = $2 AND revoque_le IS NULL AND expire_le > NOW()
      ORDER BY expire_le DESC LIMIT 1`,
    [userId, tenantId]
  );
  return rows[0] || null;
};

module.exports = { DUREE_MAX_MIN, estRouteMetier, modeLimite, sessionActive };
