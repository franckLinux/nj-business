// src/services/permission.service.js
// Résolution des permissions — source d'autorisation unique de l'application.
//
// Modèle retenu : LA PERMISSION PRIME. Le rôle fixe (users.role) ne décide
// plus rien par lui-même ; il désigne seulement le jeu de permissions par
// DÉFAUT de la personne (ROLE_DEFAULTS ci-dessous). Toute attribution plus
// fine remplace ce défaut. C'est ce qui permet enfin d'accorder une action
// précise à une personne précise sans changer son rôle.
//
// Ordre de résolution (le premier niveau qui existe l'emporte, il REMPLACE
// les suivants — il ne s'y ajoute pas) :
//   1. super_admin              → tout autorisé (administrateur du cabinet).
//   2. user_permissions         → permissions individuelles de la personne.
//   3. role_permissions         → « profil métier » (users.custom_role_id).
//   4. ROLE_DEFAULTS[role]      → défaut du rôle fixe.
// Puis, quel que soit le niveau retenu :
//   5. tenant_permissions       → plafond du client, s'il en a un de configuré
//                                 (intersection : le tenant ne peut que
//                                 retirer, jamais accorder).
const { TenantPermission, UserPermission, RolePermission, User, Permission } = require('../models');

// Permissions par défaut de chaque rôle fixe.
//
// Construite pour ne rien ÉLARGIR par rapport au comportement d'avant son
// introduction : jusqu'ici `requirePermission` laissait tout passer quand rien
// n'était configuré (et rien ne l'était), si bien qu'un auditeur pouvait
// techniquement saisir un mouvement et un caissier supprimer une rubrique via
// l'API — seul le frontend le masquait. Cette matrice referme ces accès non
// voulus ; elle n'en ouvre aucun. Une personne ayant besoin de plus reçoit
// une permission individuelle, ce qui est désormais le geste prévu.
const ROLE_DEFAULTS = {
  directeur: [
    'journal.view', 'journal.create', 'journal.edit', 'journal.delete', 'journal.validate', 'journal.ran',
    'budget.view', 'budget.edit', 'budget.validate',
    'budget.demande_create', 'budget.demande_validate', 'budget.demande_delete',
    'previsions.view', 'previsions.edit',
    'appel_fonds.view', 'appel_fonds.create', 'appel_fonds.validate', 'appel_fonds.delete',
    'rubriques.view', 'rubriques.edit',
    'users.view', 'users.create', 'users.edit', 'users.delete',
    'config.view', 'config.edit',
    'rapport.view', 'rapport.export',
    'plan_comptable.view', 'plan_comptable.edit', 'plan_comptable.delete',
    'journaux.view', 'journaux.edit', 'journaux.reouvrir',
    'pieces.view', 'pieces.edit', 'pieces.upload',
    'banque.view', 'banque.edit',
  ],

  // Intervient sur les données comptables de ses clients, pas sur leurs
  // utilisateurs ni leur configuration, et ne valide pas à leur place.
  comptable_cabinet: [
    'journal.view', 'journal.create', 'journal.edit', 'journal.delete', 'journal.ran',
    'budget.view', 'budget.edit',
    'previsions.view', 'previsions.edit',
    'appel_fonds.view', 'appel_fonds.create',
    'rubriques.view', 'rubriques.edit',
    'users.view',
    'config.view',
    'rapport.view', 'rapport.export',
    'plan_comptable.view', 'plan_comptable.edit', 'plan_comptable.delete',
    'journaux.view',
    'pieces.view', 'pieces.edit', 'pieces.upload',
    'banque.view', 'banque.edit',
  ],

  // Saisie quotidienne. `journal.edit` est conservé : le contrôleur
  // updateMouvement ne cadre pas la propriété du mouvement, cette action fait
  // partie de son travail courant (corriger une écriture) depuis toujours.
  caissier: [
    'journal.view', 'journal.create', 'journal.edit',
    // Report à nouveau : la caissière saisit le solde d'ouverture de sa caisse
    // (bloqué côté serveur une fois le mois arrêté — voir setRan).
    'journal.ran',
    'budget.view', 'budget.demande_create', 'budget.demande_delete',
    // Saisit les lignes prévisionnelles (page Prévisions, synthèse Appel de
    // fonds) sans pouvoir modifier les dotations budgétaires elles-mêmes.
    'previsions.view', 'previsions.edit',
    'appel_fonds.view', 'appel_fonds.create',
    'rubriques.view',
    'users.view', // alimente les listes de responsables dans l'interface
    'config.view',
    'rapport.view',
    // Peut AJOUTER des comptes additifs au plan comptable, pas en désactiver :
    // le plan est commun à tous les clients (plan_comptable.delete).
    'plan_comptable.view', 'plan_comptable.edit',
    'journaux.view',
    'pieces.view', 'pieces.upload',
    'banque.view',
  ],

  // Lecture seule.
  auditeur: [
    'journal.view',
    'budget.view',
    'previsions.view',
    'appel_fonds.view',
    'rubriques.view',
    'users.view',
    'config.view',
    'rapport.view', 'rapport.export',
    'plan_comptable.view',
    'journaux.view',
    'pieces.view',
    'banque.view',
  ],
};

// Renvoie la liste des codes autorisés, ou `null` pour « aucune restriction »
// (super_admin uniquement). Utilisée par le guard requirePermission et
// exposée au frontend via /auth/login et /auth/me, afin que l'interface et le
// backend appliquent exactement la même règle.
const getEffectivePermissions = async ({ tenantId, userId, role }) => {
  if (role === 'super_admin') return null;

  let accordees = null;

  // 2. Permissions individuelles — priment sur tout le reste.
  const perUser = await UserPermission.findAll({
    where: { user_id: userId }, attributes: ['permission_code'], raw: true,
  });
  if (perUser.length > 0) accordees = perUser.map((r) => r.permission_code);

  // 3. Profil métier (rôle personnalisé du tenant).
  if (!accordees) {
    const u = await User.findByPk(userId, { attributes: ['custom_role_id'], raw: true });
    if (u && u.custom_role_id) {
      const perProfil = await RolePermission.findAll({
        where: { role_id: u.custom_role_id }, attributes: ['permission_code'], raw: true,
      });
      if (perProfil.length > 0) accordees = perProfil.map((r) => r.permission_code);
    }
  }

  // 4. Défaut du rôle fixe.
  if (!accordees) accordees = [...(ROLE_DEFAULTS[role] || [])];

  // 5. Plafond du tenant : ne peut que retirer.
  if (tenantId) {
    const perTenant = await TenantPermission.findAll({
      where: { tenant_id: tenantId }, attributes: ['permission_code'], raw: true,
    });
    if (perTenant.length > 0) {
      const plafond = new Set(perTenant.map((r) => r.permission_code));
      accordees = accordees.filter((code) => plafond.has(code));
    }
  }

  // Implication : qui travaille dans un journal doit pouvoir en voir la liste
  // (menu latéral). journaux.view n'existe que depuis la 012 : les profils,
  // surcharges et plafonds enregistrés avant l'ignorent, et la personne
  // perdait alors tous ses journaux à l'écran alors qu'elle a journal.view.
  if (accordees.includes('journal.view') && !accordees.includes('journaux.view')) {
    accordees.push('journaux.view');
  }

  return accordees;
};

// Contrôle d'une liste de codes avant enregistrement (utilisateur ou profil).
// Renvoie { codes, erreur } : `codes` nettoyé, `erreur` null si tout est accordable.
//  - code inconnu du catalogue → ignoré. La modale renvoie la liste EFFECTIVE,
//    qui peut contenir un code du défaut de rôle pas encore migré en base
//    (ex. plan_comptable.delete avant la 013) : le refuser bloquait tout
//    enregistrement, et l'insérer violerait la clé étrangère ;
//  - code hors plafond du client → refus explicite. Sans ce contrôle, la case
//    cochée était enregistrée puis silencieusement retirée par le plafond
//    (étape 5) : la personne n'obtenait rien et la case réapparaissait vide.
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

const userHasPermission = async ({ tenantId, userId, role }, code) => {
  if (role === 'super_admin') return true;
  const accordees = await getEffectivePermissions({ tenantId, userId, role });
  return accordees === null || accordees.includes(code);
};

module.exports = { userHasPermission, getEffectivePermissions, verifierCodesAccordables, ROLE_DEFAULTS };
