// src/services/affectation.service.js
// Périmètre d'un membre du cabinet (migration 015) :
//   - super_admin       → tous les clients ;
//   - comptable_cabinet → uniquement les clients de cabinet_affectations.
const { query } = require('../config/database');

/** Liste des tenant_id accessibles, ou null = tous (super_admin). */
const tenantsAccessibles = async (user) => {
  if (user.role === 'super_admin') return null;
  if (user.role !== 'comptable_cabinet' || user.tenantId) return user.tenantId ? [user.tenantId] : [];
  const { rows } = await query('SELECT tenant_id FROM cabinet_affectations WHERE user_id = $1', [user.id]);
  return rows.map((r) => r.tenant_id);
};

const peutAccederTenant = async (user, tenantId) => {
  if (!tenantId) return false;
  const liste = await tenantsAccessibles(user);
  return liste === null || liste.includes(tenantId);
};

module.exports = { tenantsAccessibles, peutAccederTenant };
