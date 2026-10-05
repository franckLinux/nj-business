// src/services/permission.service.js
// Résolution des permissions — source d'autorisation unique de l'application.
//
// Modèle (depuis la migration 014) — tout est EN BASE, plus rien en dur :
//
//   base        = permissions du profil métier (users.custom_role_id) s'il en
//                 porte au moins une, sinon celles du rôle système
//                 (roles.is_system, code = users.role) ;
//   effectives  = (base ∪ exceptions 'grant') − exceptions 'deny'
//                 ∩ plafond du client (tenant_permissions), s'il en a un.
//   super_admin = aucune restriction (null).
//
// Les exceptions individuelles (user_permissions.effet) S'AJOUTENT au rôle au
// lieu de le remplacer : modifier un rôle ou ajouter une permission au
// catalogue profite donc aussi aux personnes qui ont des exceptions.
const { sequelize, Permission, TenantPermission } = require('../models');

const SQL_BASE = `
  WITH u AS (
    SELECT id, role, custom_role_id FROM users WHERE id = :userId
  ),
  profil AS (
    SELECT rp.permission_code FROM role_permissions rp JOIN u ON rp.role_id = u.custom_role_id
  ),
  systeme AS (
    SELECT rp.permission_code
      FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id AND r.tenant_id IS NULL AND r.is_system
      JOIN u ON r.code = u.role
  )
  SELECT permission_code FROM profil
  UNION
  SELECT permission_code FROM systeme WHERE NOT EXISTS (SELECT 1 FROM profil)
`;

const SQL_EFFECTIVES = `
  WITH base AS (${SQL_BASE}),
  ex AS (
    SELECT permission_code, effet FROM user_permissions WHERE user_id = :userId
  ),
  eff AS (
    (SELECT permission_code FROM base
     UNION
     SELECT permission_code FROM ex WHERE effet = 'grant')
    EXCEPT
    SELECT permission_code FROM ex WHERE effet = 'deny'
  ),
  plafond AS (
    SELECT permission_code FROM tenant_permissions WHERE tenant_id = CAST(:tenantId AS uuid)
  )
  SELECT permission_code FROM eff
   WHERE NOT EXISTS (SELECT 1 FROM plafond)
      OR permission_code IN (SELECT permission_code FROM plafond)
   ORDER BY permission_code
`;

/** Permissions de BASE (rôle système ou profil métier), sans exceptions ni plafond. */
const getBasePermissions = async (userId) => {
  const rows = await sequelize.query(SQL_BASE, {
    replacements: { userId }, type: sequelize.QueryTypes.SELECT,
  });
  return rows.map((r) => r.permission_code);
};

/**
 * Liste des codes autorisés, ou `null` pour « aucune restriction »
 * (super_admin uniquement). Utilisée par requirePermission et renvoyée au
 * frontend par /auth/login et /auth/me : interface et API appliquent la même règle.
 * `tenantId` = client du CONTEXTE (req.tenantId), qui fixe le plafond.
 */
const getEffectivePermissions = async ({ tenantId, userId, role }) => {
  if (role === 'super_admin') return null;
  const rows = await sequelize.query(SQL_EFFECTIVES, {
    replacements: { userId, tenantId: tenantId || null },
    type: sequelize.QueryTypes.SELECT,
  });
  return rows.map((r) => r.permission_code);
};

/**
 * Permissions accordées INDIVIDUELLEMENT à la personne (exceptions 'grant').
 * Le frontend s'en sert pour réafficher un onglet de paramétrage qu'on a
 * explicitement ouvert à quelqu'un (ex. rubriques pour une caissière).
 */
const getPermissionsAccordees = async (userId) => {
  const rows = await sequelize.query(
    `SELECT permission_code FROM user_permissions WHERE user_id = :userId AND effet = 'grant'`,
    { replacements: { userId }, type: sequelize.QueryTypes.SELECT }
  );
  return rows.map((r) => r.permission_code);
};

const userHasPermission = async (ctx, code) => {
  const accordees = await getEffectivePermissions(ctx);
  return accordees === null || accordees.includes(code);
};

// Contrôle d'une liste de codes avant enregistrement (exceptions ou profil).
// Renvoie { codes, erreur } : `codes` nettoyé (inconnus ignorés), `erreur`
// non nulle si un code est hors plafond du client.
const verifierCodesAccordables = async (codes, tenantId) => {
  const catalogue = new Set((await Permission.findAll({ attributes: ['code'], raw: true })).map((p) => p.code));
  codes = [...new Set(codes)].filter((c) => catalogue.has(c));
  if (tenantId) {
    const perTenant = await TenantPermission.findAll({
      where: { tenant_id: tenantId }, attributes: ['permission_code'], raw: true,
    });
    if (perTenant.length > 0) {
      const plafond = new Set(perTenant.map((r) => r.permission_code));
      const hors = codes.filter((c) => !plafond.has(c));
      if (hors.length) {
        return {
          codes,
          erreur: `Désactivée(s) pour ce client : ${hors.join(', ')}. `
                + 'Activez-la(les) d\'abord dans Clients → 🔐 Permissions.',
        };
      }
    }
  }
  return { codes, erreur: null };
};

/**
 * Utilisateurs ACTIFS d'un client qui détiennent une permission — remplace
 * les requêtes « WHERE role = 'directeur' » des notifications : la personne
 * notifiée est celle qui peut réellement agir.
 */
const usersAvecPermission = async (tenantId, code) => {
  const { User } = require('../models');
  const users = await User.findAll({
    where: { tenant_id: tenantId, actif: true },
    attributes: ['id', 'username', 'email', 'role', 'canal_notif'], raw: true,
  });
  const res = [];
  for (const u of users) {
    if (await userHasPermission({ tenantId, userId: u.id, role: u.role }, code)) res.push(u);
  }
  return res;
};

module.exports = {
  getEffectivePermissions, getBasePermissions, getPermissionsAccordees, userHasPermission,
  verifierCodesAccordables, usersAvecPermission,
};
