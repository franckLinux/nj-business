// src/routes/index.js — CaissePro v2 — Routes complètes
const router = require('express').Router();
const { authGuard, requireRole, requireCabinet } = require('../middleware/auth');
const { tenantGuard }             = require('../middleware/tenant');
const { validate }                = require('../middleware/validate');
const { requirePermission }       = require('../middleware/permission');

// ── Initialisation de la base (déploiement) ───────────────────────────────
// Monté en premier, sans authGuard : ces routes servent précisément quand
// aucun compte n'existe encore. Elles sont protégées par SETUP_TOKEN et
// restent invisibles (404) tant que cette variable n'est pas renseignée.
//
// IMPÉRATIF : router.use() et non router.get(). Avec .get('/admin', sousRouteur),
// Express exige une correspondance EXACTE sur /api/admin et ne retire pas le
// préfixe : /api/admin/setup retombait alors en 404, rendant tout le mécanisme
// d'initialisation à distance inatteignable. Seul .use() monte le sous-routeur
// en préfixe et lui transmet /setup et /setup/status.
router.use('/admin', require('./admin-setup.route'));

// ── Auth ──────────────────────────────────────────────────────────────────
const authCtrl = require('../controllers/auth.controller');
const { loginRules, changePasswordRules } = require('../validators/auth.validator');
router.post('/auth/login',           loginRules, validate, authCtrl.login);
router.get ('/auth/me',              authGuard, authCtrl.me);
router.post('/auth/change-password', authGuard, changePasswordRules, validate, authCtrl.changePassword);

// ── Journaux (dynamique — module de permission "journaux") ────────────────
// Définition des caisses/journaux, à distinguer du module "journal" qui porte
// les mouvements (cf. plus bas).
const jxCtrl = require('../controllers/journaux.controller');
const { createJournalRules, updateJournalRules, journalIdParamRule } = require('../validators/journaux.validator');
router.get   ('/journaux/next-code', authGuard, tenantGuard, requirePermission('journaux.view'), jxCtrl.getNextCode);
router.get   ('/journaux',      authGuard, tenantGuard, requirePermission('journaux.view'), jxCtrl.getJournaux);
router.post  ('/journaux',      authGuard, tenantGuard, requirePermission('journaux.edit'), createJournalRules, validate, jxCtrl.createJournal);
router.put   ('/journaux/:id',  authGuard, tenantGuard, requirePermission('journaux.edit'), updateJournalRules, validate, jxCtrl.updateJournal);
router.delete('/journaux/:id',  authGuard, tenantGuard, requirePermission('journaux.edit'), journalIdParamRule, validate, jxCtrl.deleteJournal);

// Arrêt de caisse
// L'arrêt lui-même reste gouverné par la règle d'appartenance du contrôleur
// (responsable_arret du journal, ou encadrement) : y poser une permission
// créerait une seconde source de vérité contradictoire. Seule la réouverture,
// qui est une décision d'encadrement, porte un code.
const acCtrl = require('../controllers/arret_caisse.controller');
const { arreterRules } = require('../validators/arret_caisse.validator');
router.post  ('/journaux/:id/arreter', authGuard, tenantGuard, arreterRules, validate, acCtrl.arreter);
router.delete('/journaux/:id/arreter', authGuard, tenantGuard, requirePermission('journaux.reouvrir'), journalIdParamRule, validate, acCtrl.reouvrir);

// ── Journal des mouvements (module de permission "journal") ──────────────
const jCtrl = require('../controllers/journal.controller');
const { createMouvementRules, setRanRules } = require('../validators/journal.validator');
router.get   ('/journal',         authGuard, tenantGuard, requirePermission('journal.view'), jCtrl.getJournal);
router.post  ('/journal',         authGuard, tenantGuard, requirePermission('journal.create'), createMouvementRules, validate, jCtrl.createMouvement);
router.put   ('/journal/:id',     authGuard, tenantGuard, requirePermission('journal.edit'), jCtrl.updateMouvement);
router.delete('/journal/:id',     authGuard, tenantGuard, requirePermission('journal.delete'), jCtrl.deleteMouvement);
router.get   ('/journal/soldes',  authGuard, tenantGuard, requirePermission('journal.view'), jCtrl.getSoldes);
router.get   ('/journal/cumuls',  authGuard, tenantGuard, requirePermission('journal.view'), jCtrl.getCumuls);
router.get   ('/journal/ran',     authGuard, tenantGuard, requirePermission('journal.view'), jCtrl.getRan);
router.get   ('/journal/recap',   authGuard, tenantGuard, requirePermission('journal.view'), jCtrl.getJournauxRecap);
router.get   ('/journal/controle-context', authGuard, tenantGuard, requirePermission('journal.view'), jCtrl.getControleContext);
router.post  ('/journal/ran',     authGuard, tenantGuard, requirePermission('journal.ran'), setRanRules, validate, jCtrl.setRan);

// ── Mouvements en attente (RG-03 / RG-04 — module de permission "journal") ─
const maCtrl = require('../controllers/mouvements_attente.controller');
const { decisionRules } = require('../validators/mouvements_attente.validator');
router.get   ('/mouvements-attente',               authGuard, tenantGuard, requirePermission('journal.view'), maCtrl.list);
router.get   ('/mouvements-attente/count',         authGuard, tenantGuard, requirePermission('journal.view'), maCtrl.count);
router.patch ('/mouvements-attente/:id/approuver', authGuard, tenantGuard, requirePermission('journal.validate'), decisionRules, validate, maCtrl.approuver);
router.patch ('/mouvements-attente/:id/rejeter',   authGuard, tenantGuard, requirePermission('journal.validate'), decisionRules, validate, maCtrl.rejeter);

// ── Notifications (cloche in-app) ──────────────────────────────────────────
const notifCtrl = require('../controllers/notifications.controller');
router.get   ('/notifications',        authGuard, tenantGuard, notifCtrl.list);
router.get   ('/notifications/count',  authGuard, tenantGuard, notifCtrl.count);
router.patch ('/notifications/lu-tout',authGuard, tenantGuard, notifCtrl.markAllRead);
router.patch ('/notifications/:id/lu', authGuard, tenantGuard, notifCtrl.markRead);

// ── Budget Caisse (module de permission "budget") ─────────────────────────
const bcCtrl = require('../controllers/budget_caisse.controller');
const { setBudgetCaisseRules, createDemandeRules, validerDemandeRules } = require('../validators/budget_caisse.validator');
router.get   ('/budget-caisse',                          authGuard, tenantGuard, requirePermission('budget.view'), bcCtrl.getBudgetCaisse);
router.put   ('/budget-caisse',                          authGuard, tenantGuard, requirePermission('budget.edit'), setBudgetCaisseRules, validate, bcCtrl.setBudgetCaisse);
router.delete('/budget-caisse',                          authGuard, tenantGuard, requirePermission('budget.edit'), bcCtrl.deleteBudgetCaisse);
router.get   ('/budget-caisse/depassements/count',       authGuard, tenantGuard, requirePermission('budget.view'), bcCtrl.countDepassements);
router.get   ('/budget-caisse/depassements',             authGuard, tenantGuard, requirePermission('budget.view'), bcCtrl.getDepassements);
router.post  ('/budget-caisse/demande',                  authGuard, tenantGuard, requirePermission('budget.demande_create'), createDemandeRules, validate, bcCtrl.createDemande);
router.patch ('/budget-caisse/demande/:id/statut',       authGuard, tenantGuard, requirePermission('budget.demande_validate'), validerDemandeRules, validate, bcCtrl.validerDemande);
router.delete('/budget-caisse/demande/:id',              authGuard, tenantGuard, requirePermission('budget.demande_delete'), bcCtrl.deleteDemande);

// ── Budget & Réalisations (module de permission "budget") ────────────────
// Les endpoints depenses/ressources-attente portent "previsions.edit" et non
// "budget.edit" : ce sont les lignes prévisionnelles, saisies aussi bien
// depuis la page Prévisions que depuis la synthèse Appel de fonds, et une
// caissière doit pouvoir les saisir sans pour autant modifier les dotations
// budgétaires. C'est la frontière que le module "previsions" du catalogue
// décrivait sans être branché nulle part.
const bCtrl = require('../controllers/budget.controller');
const { setBudgetLineRules, setValidationRules, attenteLigneRules, batchAttenteRules, budgetIdParamRule } = require('../validators/budget.validator');
router.get   ('/budget',                          authGuard, tenantGuard, requirePermission('budget.view'), bCtrl.getBudget);
router.put   ('/budget',                          authGuard, tenantGuard, requirePermission('budget.edit'), setBudgetLineRules, validate, bCtrl.setBudgetLine);
router.delete('/budget/:id',                      authGuard, tenantGuard, requirePermission('budget.edit'), budgetIdParamRule, validate, bCtrl.deleteBudgetLine);
router.post  ('/budget/validation',               authGuard, tenantGuard, requirePermission('budget.validate'), setValidationRules, validate, bCtrl.setValidation);
router.post  ('/budget/depenses-attente',         authGuard, tenantGuard, requirePermission('previsions.edit'), attenteLigneRules, validate, bCtrl.addDepenseAttente);
router.put   ('/budget/depenses-attente/batch',   authGuard, tenantGuard, requirePermission('previsions.edit'), batchAttenteRules, validate, bCtrl.batchDepenseAttente);
router.delete('/budget/depenses-attente/:id',     authGuard, tenantGuard, requirePermission('previsions.edit'), budgetIdParamRule, validate, bCtrl.deleteDepenseAttente);
router.post  ('/budget/ressources-attente',       authGuard, tenantGuard, requirePermission('previsions.edit'), attenteLigneRules, validate, bCtrl.addRessourceAttente);
router.put   ('/budget/ressources-attente/batch', authGuard, tenantGuard, requirePermission('previsions.edit'), batchAttenteRules, validate, bCtrl.batchRessourceAttente);
router.delete('/budget/ressources-attente/:id',   authGuard, tenantGuard, requirePermission('previsions.edit'), budgetIdParamRule, validate, bCtrl.deleteRessourceAttente);

// ── Appel de Fonds (module de permission "appel_fonds") ───────────────────
const afCtrl = require('../controllers/appel_fonds.controller');
const { createAppelFondsRules, updateStatutRules } = require('../validators/appel_fonds.validator');
router.get   ('/appel-fonds',            authGuard, tenantGuard, requirePermission('appel_fonds.view'), afCtrl.getAppelFonds);
router.post  ('/appel-fonds',            authGuard, tenantGuard, requirePermission('appel_fonds.create'), createAppelFondsRules, validate, afCtrl.createAppelFonds);
router.patch ('/appel-fonds/:id/statut', authGuard, tenantGuard, requirePermission('appel_fonds.validate'), updateStatutRules, validate, afCtrl.updateStatut);
router.delete('/appel-fonds/:id',        authGuard, tenantGuard, requirePermission('appel_fonds.delete'), afCtrl.deleteAppelFonds);

// ── Appel de Fonds — Synthèse Demande de Fonds ────────────────────────────
const afSynthCtrl = require('../controllers/appel_fonds_synthese.controller');
router.get('/appel-fonds/synthese', authGuard, tenantGuard, requirePermission('appel_fonds.view'), afSynthCtrl.getSynthese);

// ── Rubriques (module de permission "rubriques") ──────────────────────────
const rCtrl = require('../controllers/rubriques.controller');
const { createRubriqueRules, updateRubriqueRules, rubriqueIdParamRule } = require('../validators/rubriques.validator');
router.get   ('/rubriques',      authGuard, tenantGuard, requirePermission('rubriques.view'), rCtrl.getRubriques);
router.post  ('/rubriques',      authGuard, tenantGuard, requirePermission('rubriques.edit'), createRubriqueRules, validate, rCtrl.createRubrique);
router.put   ('/rubriques/:id',  authGuard, tenantGuard, requirePermission('rubriques.edit'), updateRubriqueRules, validate, rCtrl.updateRubrique);
router.delete('/rubriques/:id',  authGuard, tenantGuard, requirePermission('rubriques.edit'), rubriqueIdParamRule, validate, rCtrl.deleteRubrique);

// ── Utilisateurs (module de permission "users") ───────────────────────────
const uCtrl = require('../controllers/users.controller');
const { createUserRules, updateUserRules, userIdParamRule, resetPasswordRules } = require('../validators/users.validator');
router.get   ('/users',               authGuard, tenantGuard, requirePermission('users.view'), uCtrl.getUsers);
router.post  ('/users',               authGuard, tenantGuard, requirePermission('users.create'), createUserRules, validate, uCtrl.createUser);
router.put   ('/users/:id',           authGuard, tenantGuard, requirePermission('users.edit'), updateUserRules, validate, uCtrl.updateUser);
router.patch ('/users/:id/actif',     authGuard, tenantGuard, requirePermission('users.edit'), userIdParamRule, validate, uCtrl.toggleActif);
router.post  ('/users/:id/password',  authGuard, tenantGuard, requirePermission('users.edit'), resetPasswordRules, validate, uCtrl.resetPassword);
router.delete('/users/:id',           authGuard, tenantGuard, requirePermission('users.delete'), userIdParamRule, validate, uCtrl.deleteUser);

// ── Configuration Entité (module de permission "config") ─────────────────
const cfgCtrl = require('../controllers/config.controller');
const { updateConfigRules } = require('../validators/config.validator');
router.get('/config',             authGuard, tenantGuard, requirePermission('config.view'), cfgCtrl.getConfig);
router.put('/config',             authGuard, tenantGuard, requirePermission('config.edit'), updateConfigRules, validate, cfgCtrl.updateConfig);
router.get('/config/referentiel', authGuard,              cfgCtrl.getReferentiel);

// ── Banque (module de permission "banque") ────────────────────────────────
const banqueCtrl = require('../controllers/banque.controller');
const { updateBanqueRules } = require('../validators/banque.validator');
router.get('/banque', authGuard, tenantGuard, requirePermission('banque.view'), banqueCtrl.getBanque);
router.put('/banque', authGuard, tenantGuard, requirePermission('banque.edit'), updateBanqueRules, validate, banqueCtrl.updateBanque);

// ── Rapports (module de permission "rapport") ─────────────────────────────
const rapportCtrl = require('../controllers/rapport.controller');
router.get('/rapport/compte-emploi',     authGuard, tenantGuard, requirePermission('rapport.view'), rapportCtrl.getCompteEmploi);
router.get('/rapport/synthese-annuelle', authGuard, tenantGuard, requirePermission('rapport.view'), rapportCtrl.getSyntheseAnnuelle);

// ── Dashboard ─────────────────────────────────────────────────────────────
const dashCtrl = require('../controllers/dashboard.controller');
router.get('/dashboard/stats', authGuard, tenantGuard, dashCtrl.getStats);

// ── Permissions ───────────────────────────────────────────────────────────
// Catalogue en lecture (+ libellés) : les codes sont créés par migration SQL,
// jamais depuis l'interface. Exceptions individuelles : POST = enregistrer,
// DELETE = revenir aux droits du rôle.
const permCtrl = require('../controllers/permissions.controller');
const { updatePermissionRules, codesArrayRules } = require('../validators/permissions.validator');
// Catalogue lisible par tout utilisateur connecté, FILTRÉ par le contrôleur
// (hors cabinet : seulement ses propres permissions) — sert à composer un profil.
router.get   ('/permissions',                        authGuard, permCtrl.getPermissions);
router.put   ('/permissions/:code',                  authGuard, requireRole('super_admin'),                    updatePermissionRules, validate, permCtrl.updatePermission);
router.get   ('/tenants/:tenantId/permissions',      authGuard, requireCabinet, permCtrl.getTenantPermissions);
router.post  ('/tenants/:tenantId/permissions',      authGuard, requireRole('super_admin'),                    codesArrayRules, validate, permCtrl.setTenantPermissions);
router.get   ('/users/:userId/permissions',          authGuard, requireCabinet, permCtrl.getUserPermissions);
router.post  ('/users/:userId/permissions',          authGuard, requireRole('super_admin'),                    codesArrayRules, validate, permCtrl.setUserPermissions);
router.delete('/users/:userId/permissions',          authGuard, requireRole('super_admin'),                    permCtrl.resetUserPermissions);

// ── Rôles personnalisés ───────────────────────────────────────────────────
// Profils métier : gérés par le directeur du client (roles.edit, décision du
// 02/10/2026) ou le super_admin. Les rôles système (tenant_id NULL) ne sont
// atteignables que hors client, donc par le super_admin seul.
const rolesCtrl = require('../controllers/roles.controller');
const { createRoleRules, updateRoleRules, roleIdParamRule, setRolePermissionsRules } = require('../validators/roles.validator');
router.get   ('/roles',                    authGuard, tenantGuard, requirePermission('users.view'), rolesCtrl.getRoles);
router.post  ('/roles',                    authGuard, tenantGuard, requirePermission('roles.edit'),        createRoleRules, validate, rolesCtrl.createRole);
router.put   ('/roles/:id',                authGuard, tenantGuard, requirePermission('roles.edit'),        updateRoleRules, validate, rolesCtrl.updateRole);
router.delete('/roles/:id',                authGuard, tenantGuard, requirePermission('roles.edit'),        roleIdParamRule, validate, rolesCtrl.deleteRole);
router.get   ('/roles/:id/permissions',    authGuard, tenantGuard, requirePermission('users.view'), rolesCtrl.getRolePermissions);
router.post  ('/roles/:id/permissions',    authGuard, tenantGuard, requirePermission('roles.edit'),        setRolePermissionsRules, validate, rolesCtrl.setRolePermissions);

// ── Tenants ───────────────────────────────────────────────────────────────
const tenantsCtrl = require('../controllers/tenants.controller');
const { createTenantRules, toggleActifRules } = require('../validators/tenants.validator');
router.get  ('/tenants',           authGuard, requireCabinet, tenantsCtrl.getTenants);
router.post ('/tenants',           authGuard, requireRole('super_admin'),                     createTenantRules, validate, tenantsCtrl.createTenant);
router.patch('/tenants/:id/actif', authGuard, requireRole('super_admin'),                     toggleActifRules, validate, tenantsCtrl.toggleActif);
// Affectations des comptables cabinet aux clients (migration 015).
router.get  ('/users/:userId/affectations', authGuard, requireRole('super_admin'), tenantsCtrl.getAffectations);
router.put  ('/users/:userId/affectations', authGuard, requireRole('super_admin'), tenantsCtrl.setAffectations);

// ── Pièces justificatives (module de permission "pieces") ─────────────────
// "pieces.edit" gouverne la définition des justificatifs attendus par
// rubrique ; "pieces.upload" le fait de joindre ou retirer une pièce sur un
// mouvement — deux gestes de nature différente, séparés volontairement.
const piecesCtrl = require('../controllers/pieces.controller');
const { uploadRules, createTypeRules, updateTypeRules, typeIdParamRule } = require('../validators/pieces.validator');
router.get   ('/pieces/types',              authGuard, tenantGuard, requirePermission('pieces.view'), piecesCtrl.getTypes);
router.post  ('/pieces/types',              authGuard, tenantGuard, requirePermission('pieces.edit'), createTypeRules, validate, piecesCtrl.createType);
router.put   ('/pieces/types/:id',          authGuard, tenantGuard, requirePermission('pieces.edit'), updateTypeRules, validate, piecesCtrl.updateType);
router.delete('/pieces/types/:id',          authGuard, tenantGuard, requirePermission('pieces.edit'), typeIdParamRule, validate, piecesCtrl.deleteType);
router.get   ('/pieces/:mouvementId',       authGuard, tenantGuard, requirePermission('pieces.view'), piecesCtrl.getByMouvement);
router.post  ('/pieces/upload/:mouvementId',authGuard, tenantGuard, requirePermission('pieces.upload'), uploadRules, validate, piecesCtrl.upload);
router.delete('/pieces/item/:pieceId',      authGuard, tenantGuard, requirePermission('pieces.upload'), piecesCtrl.deletePiece);

// ── Plan Comptable SYSCOHADA (module de permission "plan_comptable") ──────
const planCtrl = require('../controllers/plan_comptable.controller');
const { createCompteRules, updateCompteRules, statutCompteRules } = require('../validators/plan_comptable.validator');
router.get('/plan-comptable/search',  authGuard, tenantGuard, requirePermission('plan_comptable.view'), planCtrl.search);
router.get('/plan-comptable/classes', authGuard, planCtrl.getClasses);
router.get('/plan-comptable/list',    authGuard, tenantGuard, requirePermission('plan_comptable.view'), planCtrl.list);
router.get('/plan-comptable/stats',   authGuard, tenantGuard, requirePermission('plan_comptable.view'), planCtrl.getStats);
router.post  ('/plan-comptable',         authGuard, tenantGuard, requirePermission('plan_comptable.edit'), createCompteRules, validate, planCtrl.createCompte);
router.delete('/plan-comptable/:compte', authGuard, tenantGuard, requirePermission('plan_comptable.delete'), planCtrl.deleteCompte);
// Gestion du plan propre au client (réforme du plan, étape 5).
router.get   ('/plan-comptable/comptes',                authGuard, tenantGuard, requirePermission('plan_comptable.view'),   planCtrl.listComptes);
router.put   ('/plan-comptable/comptes/:id',            authGuard, tenantGuard, requirePermission('plan_comptable.edit'),   updateCompteRules, validate, planCtrl.updateCompte);
router.patch ('/plan-comptable/comptes/:id/statut',     authGuard, tenantGuard, requirePermission('plan_comptable.delete'), statutCompteRules, validate, planCtrl.updateStatut);
router.get   ('/plan-comptable/comptes/:id/historique', authGuard, tenantGuard, requirePermission('plan_comptable.view'),   planCtrl.getHistorique);

// ── Modèle global de plan comptable (réforme du plan, étape 6) ───────────
// Administration plateforme uniquement : super_admin. Les modifications ne
// touchent aucun client tant qu'elles ne sont pas publiées, et une
// publication ne modifie que les NOUVEAUX clients.
const pmCtrl = require('../controllers/plan_modele.controller');
const admin = [authGuard, requireRole('super_admin')];
router.get   ('/plan-modele/versions',               ...admin, pmCtrl.getVersions);
router.get   ('/plan-modele/apercu',                 ...admin, pmCtrl.getApercu);
router.post  ('/plan-modele/versions/publier',       ...admin, pmCtrl.publier);
router.get   ('/plan-modele/comptes',                ...admin, pmCtrl.getComptes);
router.post  ('/plan-modele/comptes',                ...admin, pmCtrl.createCompte);
router.put   ('/plan-modele/comptes/:id',            ...admin, pmCtrl.updateCompte);
router.patch ('/plan-modele/comptes/:id/statut',     ...admin, pmCtrl.updateStatut);
router.get   ('/plan-modele/comptes/:id/historique', ...admin, pmCtrl.getHistorique);
// Synchronisation modèle → clients (étape 7) : aperçu puis application
// explicite, client par client. Jamais automatique.
router.get   ('/plan-modele/synchro/clients',               ...admin, pmCtrl.getSynchroClients);
router.get   ('/plan-modele/synchro/historique',            ...admin, pmCtrl.getSynchroHistorique);
router.get   ('/plan-modele/synchro/:tenantId/apercu',      ...admin, pmCtrl.getSynchroApercu);
router.post  ('/plan-modele/synchro/:tenantId/appliquer',   ...admin, pmCtrl.postSynchroAppliquer);

// ── Administration plateforme (réforme, étape 8) — super_admin ───────────
// Vue administrative des clients (aucune donnée de transaction) et accès
// support temporaire aux données métier d'un client.
const pfCtrl = require('../controllers/plateforme.controller');
router.get   ('/plateforme/clients',            ...admin, pfCtrl.getClients);
router.get   ('/plateforme/clients/:id',        ...admin, pfCtrl.getClient);
router.put   ('/plateforme/clients/:id',        ...admin, pfCtrl.putClient);
router.patch ('/plateforme/clients/:id/actif',  ...admin, pfCtrl.patchActif);
router.get   ('/plateforme/audit',              ...admin, pfCtrl.getAudit);
router.get   ('/plateforme/support',            ...admin, pfCtrl.getSupport);
router.post  ('/plateforme/support',            ...admin, pfCtrl.postSupport);
router.delete('/plateforme/support/:id',        ...admin, pfCtrl.deleteSupport);

// ── Prospects et comptes de démonstration (réforme prospects) ─────────────
// Cabinet : super_admin, ou comptable cabinet titulaire de « prospects.gerer ».
const prCtrl = require('../controllers/prospects.controller');
const prospects = [authGuard, prCtrl.requireProspects];
router.get   ('/prospects',                  ...prospects, prCtrl.lister);
router.get   ('/prospects/apercu-email',     ...prospects, prCtrl.apercu);
router.post  ('/prospects',                  ...prospects, prCtrl.creer);
// Routes d'une fiche : périmètre du commercial vérifié côté serveur.
const fiche = [...prospects, prCtrl.scopeProspect];
router.get   ('/prospects/:id',              ...fiche, prCtrl.detail);
router.put   ('/prospects/:id',              ...fiche, prCtrl.modifier);
router.post  ('/prospects/:id/invitation',   ...fiche, prCtrl.inviter);
router.post  ('/prospects/:id/prolongation', ...fiche, prCtrl.prolonger);
router.post  ('/prospects/:id/statut',       ...fiche, prCtrl.statut);
// Étape 4 : forfaits (catalogue modifiable par le super_admin seul), paiements, conversion.
router.get   ('/forfaits',                   ...prospects, prCtrl.forfaits);
router.post  ('/forfaits',                   ...admin, prCtrl.creerForfait);
router.put   ('/forfaits/:id',               ...admin, prCtrl.modifierForfait);
router.post  ('/prospects/:id/paiements',    ...fiche, prCtrl.paiement);
router.patch ('/paiements/:paiementId/statut', ...prospects, prCtrl.statutPaiement);
router.post  ('/prospects/:id/conversion',   ...fiche, prCtrl.requireDirection, prCtrl.convertir);
// MyNjBusiness — vue pipeline + fiche + actions rapides (périmètre serveur).
router.get   ('/pipeline',                   ...prospects, prCtrl.pipeline);
router.get   ('/pipeline/:id',               ...fiche, prCtrl.pipelineFiche);
router.post  ('/pipeline/:id/action',        ...fiche, prCtrl.pipelineAction);
// Public : page « Demander une démo » (aucun JWT, débit limité).
router.post  ('/demande-demo',               prCtrl.demandeWeb);
// Public : lien d'activation reçu par le prospect (aucun JWT).
router.get   ('/activation/:token',          prCtrl.verifierActivation);
router.post  ('/activation/:token',          prCtrl.activer);
// Tâche quotidienne (cron cPanel) : rappels, expirations, notification interne.
router.all   ('/taches/quotidiennes',        prCtrl.requireTacheToken, prCtrl.taches);

module.exports = router;
