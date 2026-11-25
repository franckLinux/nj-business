// src/services/permission.service.js
// Résolution des permissions — source d'autorisation unique de l'application.
//
// Modèle (depuis la migration 014) — tout est EN BASE, plus rien en dur :
//
//   base        = MODULE PAR MODULE : les permissions du profil métier
//                 (users.custom_role_id) pour chaque module où le profil en
//                 porte au moins une, sinon celles du rôle système
//                 (roles.is_system, code = users.role) pour ce module.
//                 (Avant la 053 : un profil remplaçait TOUT le rôle ; un directeur
//                 doté d'un profil de caisse perdait ainsi NJ COMMERCIAL, et un
//                 caissier doté d'un profil achats perdait sa caisse.)
//   effectives  = (base ∪ exceptions 'grant') − exceptions 'deny'
//                 ∩ plafond du client (tenant_permissions), s'il en a un.
//   super_admin = aucune restriction (null).
//
// Les exceptions individuelles (user_permissions.effet) S'AJOUTENT au rôle au
// lieu de le remplacer : modifier un rôle ou ajouter une permission au
// catalogue profite donc aussi aux personnes qui ont des exceptions.
//
// Types de gestion NJ COMMERCIAL (062) : achats, ventes, stock — zéro, un ou
// plusieurs par personne (com_utilisateur_types_gestion). Chacun ajoute à la
// base son lot de permissions com.* : celui du client s'il l'a personnalisé
// (com_types_gestion_client), sinon le lot par défaut. Le type dit le DOMAINE
// de travail ; le rôle / profil garde le NIVEAU (les validations). Exceptions
// 'deny' et plafond du client s'appliquent ensuite, comme pour le reste.
const { sequelize, Permission, TenantPermission } = require('../models');

// Groupe d'une permission = module NJ BUSINESS auquel elle appartient. Toutes
// les permissions historiques (journal, budget, contrôle…) forment « caisse ».
// 064 : les permissions « entreprise » forment le SOCLE, indépendant des modules.
const GROUPE = `CASE WHEN p.module IN ('commercial', 'comptabilite', 'dsf', 'revis', 'cg') THEN p.module
                     WHEN p.module = 'entreprise' THEN 'socle' ELSE 'caisse' END`;
const SQL_BASE = `
  WITH u AS (
    SELECT id, role, custom_role_id FROM users WHERE id = :userId
  ),
  profil AS (
    SELECT rp.permission_code, ${GROUPE} AS groupe
      FROM role_permissions rp JOIN permissions p ON p.code = rp.permission_code
      JOIN u ON rp.role_id = u.custom_role_id
     /*PROFIL_MODULE_EXCLU*/
  ),
  systeme AS (
    SELECT rp.permission_code, ${GROUPE} AS groupe
      FROM role_permissions rp JOIN permissions p ON p.code = rp.permission_code
      JOIN roles r ON r.id = rp.role_id AND r.tenant_id IS NULL AND r.is_system
      JOIN u ON r.code = u.role
  )
  SELECT permission_code FROM profil
  UNION
  SELECT permission_code FROM systeme WHERE groupe NOT IN (SELECT groupe FROM profil)
`;

// Permissions apportées par les types de gestion de la personne (062).
const SQL_TYPES = `
  SELECT d.permission_code
    FROM com_utilisateur_types_gestion ut
    JOIN users uu ON uu.id = ut.user_id AND uu.tenant_id = ut.tenant_id
    JOIN com_types_gestion tg ON tg.code = ut.type_code AND tg.actif
    JOIN com_type_gestion_permissions_defaut d ON d.type_code = ut.type_code
   WHERE ut.user_id = :userId
     AND NOT EXISTS (SELECT 1 FROM com_types_gestion_client c WHERE c.tenant_id = ut.tenant_id AND c.type_code = ut.type_code)
  UNION
  SELECT pc.permission_code
    FROM com_utilisateur_types_gestion ut
    JOIN users uu ON uu.id = ut.user_id AND uu.tenant_id = ut.tenant_id
    JOIN com_types_gestion tg ON tg.code = ut.type_code AND tg.actif
    JOIN com_type_gestion_permissions_client pc ON pc.tenant_id = ut.tenant_id AND pc.type_code = ut.type_code
   WHERE ut.user_id = :userId
`;

// Tant que la 062 n'est pas jouée, la résolution reste celle d'avant (jamais
// d'erreur sur une table absente). Seule la présence est mémorisée.
let typesPresents = false;
const typesDisponibles = async () => {
  if (typesPresents) return true;
  const [r] = await sequelize.query("SELECT to_regclass('public.com_utilisateur_types_gestion') IS NOT NULL AS ok",
    { type: sequelize.QueryTypes.SELECT });
  typesPresents = Boolean(r?.ok);
  return typesPresents;
};
// Profil propre à un module (066, user_modules.role_id) : pour ce module, il
// remplace le profil métier du compte ; ailleurs, rien ne change.
const PROFIL_MODULE = `
    UNION
    SELECT rp.permission_code, ${GROUPE} AS groupe
      FROM user_modules um
      JOIN role_permissions rp ON rp.role_id = um.role_id
      JOIN permissions p ON p.code = rp.permission_code
     WHERE um.user_id = :userId AND um.actif AND um.role_id IS NOT NULL AND ${GROUPE} = um.module_code`;
const PROFIL_MODULE_EXCLU = `WHERE ${GROUPE} NOT IN (
      SELECT module_code FROM user_modules WHERE user_id = :userId AND actif AND role_id IS NOT NULL)`;

let modulesUtilisateursPresents = false;
const modulesUtilisateursDisponibles = async () => {
  if (modulesUtilisateursPresents) return true;
  const [r] = await sequelize.query("SELECT to_regclass('public.user_modules') IS NOT NULL AS ok",
    { type: sequelize.QueryTypes.SELECT });
  modulesUtilisateursPresents = Boolean(r?.ok);
  return modulesUtilisateursPresents;
};

const sqlBase = (avecTypes, avecModules = false) => {
  const base = avecModules
    ? SQL_BASE.replace('/*PROFIL_MODULE_EXCLU*/', PROFIL_MODULE_EXCLU + PROFIL_MODULE)
    : SQL_BASE.replace('/*PROFIL_MODULE_EXCLU*/', '');
  return avecTypes ? `${base} UNION ${SQL_TYPES}` : base;
};

const sqlEffectives = (avecTypes, avecModules) => `
  WITH base AS (${sqlBase(avecTypes, avecModules)}),
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

/** Permissions de BASE (rôle système ou profil métier, + types de gestion), sans exceptions ni plafond. */
const getBasePermissions = async (userId) => {
  const rows = await sequelize.query(sqlBase(await typesDisponibles(), await modulesUtilisateursDisponibles()), {
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
const getEffectivePermissions = async ({ tenantId, userId, role, brut = false }) => {
  if (role === 'super_admin') return null;
  const avecModules = await modulesUtilisateursDisponibles();
  const rows = await sequelize.query(sqlEffectives(await typesDisponibles(), avecModules), {
    replacements: { userId, tenantId: tenantId || null },
    type: sequelize.QueryTypes.SELECT,
  });
  const codes = rows.map((r) => r.permission_code);
  // 066 : accès par module. En mode « appliquer », une personne d'un client ne
  // garde les droits d'un module que si elle y est rattachée (user_modules).
  // Les droits du socle (entreprise, utilisateurs, rôles) ne dépendent d'aucun module.
  // `brut` : droits avant ce filtre (reprise, rapport de répartition).
  if (brut || !avecModules || !ROLES_CLIENT.includes(role) || (await modeAccesModules()) !== 'appliquer') return codes;
  const [modules, membre] = await Promise.all([modulesDesPermissions(), modulesDe(userId)]);
  return codes.filter((c) => {
    const g = groupeDe(modules.get(c));
    return g === 'socle' || membre.has(g);
  });
};

// ── Accès par module (066) ────────────────────────────────────────────────
const ROLES_CLIENT = ['directeur', 'caissier', 'auditeur', 'collaborateur'];
const MODULES_SOCLE = new Set(['entreprise', 'users', 'roles', 'plateforme']);
/** Module NJ BUSINESS d'une permission, pour le contrôle d'accès ('socle' : aucun). */
const groupeDe = (moduleCatalogue) => {
  if (!moduleCatalogue || MODULES_SOCLE.has(moduleCatalogue)) return 'socle';
  return ['commercial', 'comptabilite', 'dsf', 'revis', 'cg'].includes(moduleCatalogue) ? moduleCatalogue : 'caisse';
};
let cacheModulesPerm = null;
const modulesDesPermissions = async () => {
  if (cacheModulesPerm && Date.now() - cacheModulesPerm.t < 60000) return cacheModulesPerm.m;
  const rows = await sequelize.query('SELECT code, module FROM permissions', { type: sequelize.QueryTypes.SELECT });
  cacheModulesPerm = { t: Date.now(), m: new Map(rows.map((r) => [r.code, r.module])) };
  return cacheModulesPerm.m;
};
const modulesDe = async (userId) => new Set((await sequelize.query(
  'SELECT module_code FROM user_modules WHERE user_id = :userId AND actif', { replacements: { userId }, type: sequelize.QueryTypes.SELECT }))
  .map((r) => r.module_code));
let cacheMode = null;
/** Mode du contrôle d'accès par module : 'observer' (défaut) ou 'appliquer'. Mis en cache 15 s. */
const modeAccesModules = async () => {
  if (cacheMode && Date.now() - cacheMode.t < 15000) return cacheMode.v;
  let v = 'observer';
  if (await modulesUtilisateursDisponibles()) {
    const [r] = await sequelize.query("SELECT valeur #>> '{}' AS v FROM plateforme_reglages WHERE cle = 'acces_modules_utilisateurs'",
      { type: sequelize.QueryTypes.SELECT });
    if (r?.v === 'appliquer') v = 'appliquer';
  }
  cacheMode = { t: Date.now(), v };
  return v;
};
const oublierModeAccesModules = () => { cacheMode = null; };

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

/** Permissions apportées par les seuls types de gestion (affichage « d'où vient ce droit »). */
const getPermissionsTypes = async (userId) => {
  if (!(await typesDisponibles())) return [];
  const rows = await sequelize.query(SQL_TYPES, { replacements: { userId }, type: sequelize.QueryTypes.SELECT });
  return rows.map((r) => r.permission_code);
};

module.exports = {
  getEffectivePermissions, getBasePermissions, getPermissionsAccordees, getPermissionsTypes, userHasPermission,
  verifierCodesAccordables, usersAvecPermission,
  ROLES_CLIENT, groupeDe, modulesDesPermissions, modulesDe, modeAccesModules, oublierModeAccesModules,
};
