// src/routes/index.js — CaissePro v2 — Routes complètes
const router = require('express').Router();
const { authGuard, requireRole, requireCabinet } = require('../middleware/auth');
const { tenantGuard }             = require('../middleware/tenant');
const { validate }                = require('../middleware/validate');
const { requirePermission, requireAnyPermission } = require('../middleware/permission');

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
// 067 (lot D) : sessions — déconnexion, tous les appareils, mes sessions.
router.post('/auth/deconnexion',          authGuard, authCtrl.deconnexion);
router.post('/auth/deconnexion-globale',  authGuard, authCtrl.deconnexionGlobale);
router.get ('/auth/sessions',             authGuard, authCtrl.mesSessions);
// C9 : mot de passe oublié (public, limité en débit dans index.js).
router.post('/auth/mot-de-passe-oublie', authCtrl.motDePasseOublie);
router.get ('/auth/reinitialisation/:jeton', authCtrl.verifierReinitialisation);
router.post('/auth/reinitialisation/:jeton', authCtrl.reinitialiserMotDePasse);

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
// Annulation (contre-passation) — droits vérifiés dans le contrôleur
// (journal.annuler : annule directement / journal.annulation_demander : demande).
router.get   ('/journal/annulations',     authGuard, tenantGuard, requirePermission('journal.view'), jCtrl.listerAnnulations);
router.patch ('/journal/annulations/:id', authGuard, tenantGuard, requirePermission('journal.annuler'), jCtrl.deciderAnnulation);
router.get   ('/initialisation', authGuard, tenantGuard, jCtrl.getInitialisation);
router.post  ('/initialisation', authGuard, tenantGuard, jCtrl.postInitialisation);
router.post  ('/journal/:id/impression',  authGuard, tenantGuard, requirePermission('journal.view'), jCtrl.imprimerBon);
router.post  ('/journal/:id/annulation',  authGuard, tenantGuard, requirePermission('journal.view'), jCtrl.annulerMouvement);
router.get   ('/journal/soldes',  authGuard, tenantGuard, requirePermission('journal.view'), jCtrl.getSoldes);
router.get   ('/journal/cumuls',  authGuard, tenantGuard, requirePermission('journal.view'), jCtrl.getCumuls);
router.get   ('/journal/ran',     authGuard, tenantGuard, requirePermission('journal.view'), jCtrl.getRan);
router.get   ('/journal/recap',   authGuard, tenantGuard, requirePermission('journal.view'), jCtrl.getJournauxRecap);
router.get   ('/journal/controle-context', authGuard, tenantGuard, requirePermission('journal.view'), jCtrl.getControleContext);
router.get   ('/journal/disponible', authGuard, tenantGuard, requirePermission('journal.view'), jCtrl.getDisponible);
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
// Budget hebdomadaire (040) : calendrier d'un mois et réglage du client.
router.get   ('/budget/periode',                  authGuard, tenantGuard, requireAnyPermission('budget.view', 'previsions.view', 'appel_fonds.view', 'journal.view'), bCtrl.getPeriode);
router.get   ('/budget/periodicite',              authGuard, tenantGuard, requirePermission('config.view'), bCtrl.getPeriodicite);
router.put   ('/budget/periodicite',              authGuard, tenantGuard, requirePermission('config.edit'), bCtrl.putPeriodicite);
router.get   ('/budget',                          authGuard, tenantGuard, requirePermission('budget.view'), bCtrl.getBudget);
// C1 : les prévisions (Prévisions de dépenses) s'enregistrent aussi avec
// previsions.edit ; une demande déjà validée reste figée (demandeFigee).
router.put   ('/budget',                          authGuard, tenantGuard, requireAnyPermission('budget.edit', 'previsions.edit'), setBudgetLineRules, validate, bCtrl.setBudgetLine);
router.delete('/budget/:id',                      authGuard, tenantGuard, requireAnyPermission('budget.edit', 'previsions.edit'), budgetIdParamRule, validate, bCtrl.deleteBudgetLine);
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
// rubriques.create (044) : ajout sans droit comptable (caissière) — le
// contrôleur ignore alors le code comptable et le virement interne.
router.post  ('/rubriques',      authGuard, tenantGuard, requireAnyPermission('rubriques.edit', 'rubriques.create'), createRubriqueRules, validate, rCtrl.createRubrique);
router.put   ('/rubriques/:id',  authGuard, tenantGuard, requirePermission('rubriques.edit'), updateRubriqueRules, validate, rCtrl.updateRubrique);
router.delete('/rubriques/:id',  authGuard, tenantGuard, requirePermission('rubriques.edit'), rubriqueIdParamRule, validate, rCtrl.deleteRubrique);

// ── Contrôle comptable des pièces (migration 042) ─────────────────────────
// Lecture : controle.view ; saisie (tiers, observation, statut) : controle.saisir.
// N'écrit jamais dans le journal ni dans la passerelle.
const ctlCtrl = require('../controllers/controle.controller');
router.get   ('/controle/pieces',     authGuard, tenantGuard, requirePermission('controle.view'), ctlCtrl.getPieces);
router.put   ('/controle/pieces/:id', authGuard, tenantGuard, requireAnyPermission('controle.saisir', 'controle.compte'), ctlCtrl.putPiece);
router.get   ('/controle/tiers',      authGuard, tenantGuard, requirePermission('controle.view'), ctlCtrl.getTiers);
// Régularité formelle (045) : anomalies constatées, validation, réouverture, historique.
router.post  ('/controle/pieces/:id/anomalies',   authGuard, tenantGuard, requirePermission('controle.saisir'), ctlCtrl.postAnomalie);
router.put   ('/controle/anomalies/:aid',         authGuard, tenantGuard, requirePermission('controle.saisir'), ctlCtrl.putAnomalie);
router.post  ('/controle/anomalies/:aid/levee',   authGuard, tenantGuard, requirePermission('controle.saisir'), ctlCtrl.postLevee);
router.post  ('/controle/pieces/:id/validation',  authGuard, tenantGuard, requirePermission('controle.saisir'), ctlCtrl.postValidation);
router.post  ('/controle/pieces/:id/reouverture', authGuard, tenantGuard, requirePermission('controle.reouvrir'), ctlCtrl.postReouverture);
router.get   ('/controle/pieces/:id/historique',  authGuard, tenantGuard, requirePermission('controle.view'), ctlCtrl.getHistorique);

// ── Arrêtés de caisse & inventaires (migration 046) ───────────────────────
// Validation des arrêtés et des inventaires par le contrôle comptable, sur PV
// scanné. Lecture : controle.view ; préparation (solde constaté, PV) et
// inventaires : controle.saisir ; validation / annulation d'un arrêté :
// arrets.valider (directeur) ; réouverture d'un inventaire : controle.reouvrir. Les PV ne sortent que par
// GET /controle/pv/... (jamais par le dossier public /uploads).
const aiCtrl = require('../controllers/arretes_inventaires.controller');
router.get   ('/controle/arrets',                          authGuard, tenantGuard, requirePermission('controle.view'),     aiCtrl.getArrets);
router.put   ('/controle/arrets/:journalId',               authGuard, tenantGuard, requirePermission('controle.saisir'),   aiCtrl.putArret);
router.post  ('/controle/arrets/:journalId/pv',            authGuard, tenantGuard, requirePermission('controle.saisir'),   aiCtrl.postPvArret);
// 26/10/2026 : validation (et annulation) de l'arrêté réservée au directeur (arrets.valider, migration 047).
router.post  ('/controle/arrets/:journalId/validation',    authGuard, tenantGuard, requirePermission('arrets.valider'),    aiCtrl.postValidationArret);
router.post  ('/controle/arrets/:journalId/annulation',    authGuard, tenantGuard, requirePermission('arrets.valider'),    aiCtrl.postAnnulationArret);
router.get   ('/controle/inventaires',                     authGuard, tenantGuard, requirePermission('controle.view'),     aiCtrl.getInventaires);
router.post  ('/controle/inventaires',                     authGuard, tenantGuard, requirePermission('controle.saisir'),   aiCtrl.postInventaire);
router.get   ('/controle/inventaires/:id',                 authGuard, tenantGuard, requirePermission('controle.view'),     aiCtrl.getInventaire);
router.put   ('/controle/inventaires/:id',                 authGuard, tenantGuard, requirePermission('controle.saisir'),   aiCtrl.putInventaire);
router.delete('/controle/inventaires/:id',                 authGuard, tenantGuard, requirePermission('controle.saisir'),   aiCtrl.deleteInventaire);
router.post  ('/controle/inventaires/:id/pv',              authGuard, tenantGuard, requirePermission('controle.saisir'),   aiCtrl.postPvInventaire);
router.post  ('/controle/inventaires/:id/validation',      authGuard, tenantGuard, requirePermission('controle.saisir'),   aiCtrl.postValidationInventaire);
router.post  ('/controle/inventaires/:id/reouverture',     authGuard, tenantGuard, requirePermission('controle.reouvrir'), aiCtrl.postReouvertureInventaire);

// ── Registre des écarts de caisse (migration 061) ─────────────────────────
// Lecture controle.view ; constat, affectation, régularisation controle.saisir ;
// annulation (contre-passation de l'écriture) controle.reouvrir.
const ecCtrl = require('../controllers/ecarts_caisse.controller');
router.get ('/controle/ecarts',                     authGuard, tenantGuard, requirePermission('controle.view'),     ecCtrl.getEcarts);
router.get ('/controle/ecarts/parametres',          authGuard, tenantGuard, requirePermission('controle.view'),     ecCtrl.getParametres);
router.get ('/controle/ecarts/solde-theorique',     authGuard, tenantGuard, requirePermission('controle.view'),     ecCtrl.getSoldeTheorique);
router.get ('/controle/ecarts/:id',                 authGuard, tenantGuard, requirePermission('controle.view'),     ecCtrl.getEcart);
router.post('/controle/ecarts',                     authGuard, tenantGuard, requirePermission('controle.saisir'),   ecCtrl.postEcart);
router.post('/controle/ecarts/:id/affectation',     authGuard, tenantGuard, requirePermission('controle.saisir'),   ecCtrl.postAffectation);
router.post('/controle/ecarts/:id/regularisation',  authGuard, tenantGuard, requirePermission('controle.saisir'),   ecCtrl.postRegularisation);
router.post('/controle/ecarts/:id/annulation',      authGuard, tenantGuard, requirePermission('controle.reouvrir'), ecCtrl.postAnnulation);
router.get   ('/controle/pv/:objet/:id',                   authGuard, tenantGuard, requirePermission('controle.view'),     aiCtrl.getPv);

// ── Registre des clients / fournisseurs (migration 043) ───────────────────
const regCtrl = require('../controllers/registre_tiers.controller');
router.get   ('/registre-tiers',              authGuard, tenantGuard, requirePermission('controle.view'), regCtrl.getListe);
// Saisie de caisse (044) : bénéficiaires du registre (NUI, téléphone, compte tiers).
router.get   ('/registre-tiers/saisie',       authGuard, tenantGuard, requireAnyPermission('journal.create', 'journal.edit'), regCtrl.getSaisie);
router.post  ('/registre-tiers',              authGuard, tenantGuard, requirePermission('controle.saisir'), regCtrl.post);
router.post  ('/registre-tiers/import-pieces', authGuard, tenantGuard, requirePermission('controle.saisir'), regCtrl.postImport);
router.put   ('/registre-tiers/:id',          authGuard, tenantGuard, requirePermission('controle.saisir'), regCtrl.put);

// ── Passerelle comptable — lot 1 : paramétrage (migration 037) ────────────
// Le directeur PROPOSE les comptes des rubriques, le cabinet VALIDE
// (passerelle.valider : validation directe de ses propres saisies).
// Comptes de trésorerie des journaux et paramètres : cabinet uniquement.
const psCtrl = require('../controllers/passerelle.controller');
router.get   ('/passerelle',                           authGuard, tenantGuard, requirePermission('passerelle.view'), psCtrl.getEtat);
router.put   ('/passerelle/parametres',                authGuard, tenantGuard, requirePermission('passerelle.valider'), psCtrl.putParametres);
router.put   ('/passerelle/journaux/:id',              authGuard, tenantGuard, requirePermission('passerelle.valider'), psCtrl.putJournal);
router.post  ('/passerelle/equivalences',              authGuard, tenantGuard, requireAnyPermission('passerelle.proposer', 'passerelle.valider'), psCtrl.postEquivalence);
router.post  ('/passerelle/equivalences/lot',          authGuard, tenantGuard, requireAnyPermission('passerelle.proposer', 'passerelle.valider'), psCtrl.postLot);
router.patch ('/passerelle/equivalences/:id/decision', authGuard, tenantGuard, requirePermission('passerelle.valider'), psCtrl.patchDecision);
router.get   ('/passerelle/rubriques/:id/historique',  authGuard, tenantGuard, requirePermission('passerelle.view'), psCtrl.getHistorique);
// Simulation d'export (balance de contrôle) : lit les écritures du mois, n'exporte rien.
router.get   ('/passerelle/simulation',                authGuard, tenantGuard, requirePermission('passerelle.view'), psCtrl.getSimulation);

// ── Utilisateurs (module de permission "users") ───────────────────────────
const uCtrl = require('../controllers/users.controller');
const { createUserRules, updateUserRules, userIdParamRule, resetPasswordRules } = require('../validators/users.validator');
// 067 : sessions ouvertes du client (directeur) ou de la plateforme (super_admin).
router.get   ('/sessions',     authGuard, tenantGuard, requirePermission('users.edit'), require('../controllers/sessions.controller').lister);
router.delete('/sessions/:id', authGuard, tenantGuard, requirePermission('users.edit'), require('../controllers/sessions.controller').fermer);
router.get   ('/users',               authGuard, tenantGuard, requirePermission('users.view'), uCtrl.getUsers);
router.get   ('/users/roles-attribuables', authGuard, tenantGuard, requirePermission('users.view'), uCtrl.getRolesAttribuables);
router.post  ('/users',               authGuard, tenantGuard, requirePermission('users.create'), createUserRules, validate, uCtrl.createUser);
router.put   ('/users/:id',           authGuard, tenantGuard, requirePermission('users.edit'), updateUserRules, validate, uCtrl.updateUser);
router.patch ('/users/:id/actif',     authGuard, tenantGuard, requirePermission('users.edit'), userIdParamRule, validate, uCtrl.toggleActif);
// Rattrapage (033) : le directeur autorise une caissière à saisir des opérations antidatées.
router.put   ('/users/:id/rattrapage', authGuard, tenantGuard, requirePermission('journal.rattrapage_autoriser'), userIdParamRule, validate, uCtrl.setRattrapage);
// Activité / projet obligatoire pour une personne (039) : qui gère les activités.
router.put   ('/users/:id/activite-obligatoire', authGuard, tenantGuard, requirePermission('activites.edit'), userIdParamRule, validate, uCtrl.setActiviteObligatoire);
router.post  ('/users/:id/password',  authGuard, tenantGuard, requirePermission('users.edit'), resetPasswordRules, validate, uCtrl.resetPassword);
router.delete('/users/:id',           authGuard, tenantGuard, requirePermission('users.delete'), userIdParamRule, validate, uCtrl.deleteUser);

// ── Configuration Entité (module de permission "config") ─────────────────
const cfgCtrl = require('../controllers/config.controller');
const { updateConfigRules } = require('../validators/config.validator');
router.get('/config',             authGuard, tenantGuard, requirePermission('config.view'), cfgCtrl.getConfig);
router.put('/config',             authGuard, tenantGuard, requirePermission('config.edit'), updateConfigRules, validate, cfgCtrl.updateConfig);
router.get('/config/referentiel', authGuard,              cfgCtrl.getReferentiel);
// 060 : référentiel du plan comptable (SYSCOHADA / SYCEBNL) — état, aperçu, bascule.
router.get ('/config/plan-referentiel',         authGuard, tenantGuard, requireAnyPermission('config.view', 'plan_comptable.view'), cfgCtrl.getPlanReferentiel);
router.post('/config/plan-referentiel/bascule', authGuard, tenantGuard, requirePermission('config.edit'), cfgCtrl.postBasculePlan);
// En-tête des documents imprimés (logo, raison sociale, coordonnées) : lisible
// par tout utilisateur du client — la caissière imprime des bons sans avoir
// accès à l'écran de configuration.
router.get('/config/entete',      authGuard, tenantGuard,           cfgCtrl.getEntete);

// ── Utilisateurs d'un module (066) — SOCLE : chaque module a sa liste ─────
// Lecture : gestion des utilisateurs, ou paramétrage du commercial pour ses
// propres utilisateurs. Modification : users.edit.
const umModCtrl = require('../controllers/utilisateurs_modules.controller');
const voirUtilisateursModule = (req, res, next) => (req.params.code === 'commercial'
  ? requireAnyPermission('users.view', 'com.parametrage.modifier')(req, res, next)
  : requirePermission('users.view')(req, res, next));
router.get   ('/modules/:code/utilisateurs',          authGuard, tenantGuard, voirUtilisateursModule, umModCtrl.lister);
router.post  ('/modules/:code/utilisateurs',          authGuard, tenantGuard, requirePermission('users.edit'), umModCtrl.affecter);
router.put   ('/modules/:code/utilisateurs/:userId',  authGuard, tenantGuard, requirePermission('users.edit'), umModCtrl.modifierProfil);
router.delete('/modules/:code/utilisateurs/:userId',  authGuard, tenantGuard, requirePermission('users.edit'), umModCtrl.retirer);

// ── Configuration centrale de l'entreprise (064) — SOCLE NJ BUSINESS ──────
// Indépendante des modules : accessible même sans aucun module activé.
const entCtrl = require('../controllers/entreprise.controller');
router.get   ('/entreprise',                authGuard, tenantGuard, requirePermission('entreprise.view'), entCtrl.lire);
router.put   ('/entreprise',                authGuard, tenantGuard, requirePermission('entreprise.edit'), entCtrl.modifier);
router.put   ('/entreprise/logo',           authGuard, tenantGuard, requirePermission('entreprise.edit'), entCtrl.definirLogo);
router.delete('/entreprise/logo',           authGuard, tenantGuard, requirePermission('entreprise.edit'), entCtrl.supprimerLogo);
router.put   ('/entreprise/representant',   authGuard, tenantGuard, requirePermission('entreprise.edit'), entCtrl.modifierRepresentant);
router.post  ('/entreprise/representants',  authGuard, tenantGuard, requirePermission('entreprise.edit'), entCtrl.changerRepresentant);

// ── Paramètres propres à NJ CAISSE PRO (065) : plan comptable, signataires, exercice ──
// Préfixe /caisse : routes du module caisse (bloquées s'il n'est pas activé).
const cpCtrl = require('../controllers/caisse_parametres.controller');
router.get ('/caisse/parametres',      authGuard, tenantGuard, requireAnyPermission('config.view', 'plan_comptable.view'), cpCtrl.lire);
router.put ('/caisse/parametres',      authGuard, tenantGuard, requirePermission('config.edit'), cpCtrl.modifier);
router.get ('/caisse/parametres/plan', authGuard, tenantGuard, requirePermission('config.edit'), cpCtrl.apercuPlan);
router.post('/caisse/parametres/plan', authGuard, tenantGuard, requirePermission('config.edit'), cpCtrl.choisirPlan);

// ── Banque (module de permission "banque") ────────────────────────────────
const banqueCtrl = require('../controllers/banque.controller');
const { updateBanqueRules } = require('../validators/banque.validator');
router.get('/banque', authGuard, tenantGuard, requirePermission('banque.view'), banqueCtrl.getBanque);
// C2 : solde bancaire manuel de la demande de fonds, saisi par qui prépare la demande.
router.put('/banque', authGuard, tenantGuard, requireAnyPermission('banque.edit', 'previsions.edit'), updateBanqueRules, validate, banqueCtrl.updateBanque);

// ── Activités / projets (migration 034) ───────────────────────────────────
const actCtrl = require('../controllers/activites.controller');
router.get   ('/activites',        authGuard, tenantGuard, requireAnyPermission('activites.view', 'activites.edit', 'journal.create'), actCtrl.lister);
router.get   ('/activites/suivi',  authGuard, tenantGuard, requirePermission('rapport.view'), actCtrl.suivi);
router.post  ('/activites',        authGuard, tenantGuard, requirePermission('activites.edit'), actCtrl.creer);
router.put   ('/activites/:id',    authGuard, tenantGuard, requirePermission('activites.edit'), actCtrl.modifier);
router.delete('/activites/:id',    authGuard, tenantGuard, requirePermission('activites.edit'), actCtrl.supprimer);

// Suivi de la caisse des projets — ONG / associations (069, lot P1)
const projCtrl = require('../controllers/projets.controller');
router.get   ('/projets/saisie',   authGuard, tenantGuard, requireAnyPermission('journal.create', 'journal.view', 'projets.voir', 'rubriques.edit'), projCtrl.contexteSaisie);
// Lot P2 — menu « Projets ». Pas de permission exigée ici : un chef de projet
// ou un responsable d'activité peut n'avoir aucun droit propre au module ;
// sa DÉSIGNATION fixe son périmètre, contrôlé par le service à chaque appel.
router.get   ('/projets/acces',        authGuard, tenantGuard, projCtrl.acces);
router.get   ('/projets/utilisateurs', authGuard, tenantGuard, projCtrl.utilisateurs);
// Lot P3 — routes fixes AVANT /projets/:id.
router.get   ('/projets/bilan',                    authGuard, tenantGuard, projCtrl.bilan);
router.get   ('/projets/controle/justificatifs',   authGuard, tenantGuard, projCtrl.aControler);
router.get   ('/projets',              authGuard, tenantGuard, projCtrl.lister);
router.post  ('/projets',              authGuard, tenantGuard, projCtrl.creerProjet);
router.get   ('/projets/:id',          authGuard, tenantGuard, projCtrl.detail);
router.put   ('/projets/:id',          authGuard, tenantGuard, projCtrl.modifierProjet);
router.post  ('/projets/:id/activites',      authGuard, tenantGuard, projCtrl.creerActivite);
router.put   ('/projets/:id/activites/:aid', authGuard, tenantGuard, projCtrl.modifierActivite);
router.delete('/projets/:id',                authGuard, tenantGuard, projCtrl.supprimerProjet);
router.delete('/projets/:id/activites/:aid', authGuard, tenantGuard, projCtrl.supprimerActivite);
router.post  ('/projets/:id/budgets',                 authGuard, tenantGuard, projCtrl.creerBudget);
router.put   ('/projets/:id/budgets/:bid',            authGuard, tenantGuard, projCtrl.enregistrerBudget);
router.delete('/projets/:id/budgets/:bid',            authGuard, tenantGuard, projCtrl.supprimerBudget);
router.post  ('/projets/:id/budgets/:bid/soumettre',  authGuard, tenantGuard, projCtrl.soumettreBudget);
router.post  ('/projets/:id/budgets/:bid/retirer',    authGuard, tenantGuard, projCtrl.retirerBudget);
router.post  ('/projets/:id/budgets/:bid/valider',    authGuard, tenantGuard, projCtrl.validerBudget);
router.post  ('/projets/:id/budgets/:bid/rejeter',    authGuard, tenantGuard, projCtrl.rejeterBudget);
router.get   ('/projets/:id/justificatifs',                authGuard, tenantGuard, projCtrl.listerJustificatifs);
router.post  ('/projets/:id/justificatifs',                authGuard, tenantGuard, projCtrl.deposerJustificatif);
router.delete('/projets/:id/justificatifs/:jid',           authGuard, tenantGuard, projCtrl.supprimerJustificatif);
router.get   ('/projets/:id/justificatifs/:jid/fichier',   authGuard, tenantGuard, projCtrl.fichierJustificatif);
router.post  ('/projets/:id/justificatifs/:jid/valider',   authGuard, tenantGuard, projCtrl.validerJustificatif);
router.post  ('/projets/:id/justificatifs/:jid/rejeter',   authGuard, tenantGuard, projCtrl.rejeterJustificatif);
router.post  ('/projets/:id/justificatifs/:jid/annuler',   authGuard, tenantGuard, projCtrl.annulerJustificatif);

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
// Rôles autorisés du client (038) : null = valeur par défaut du type de compte.
router.get   ('/plateforme/clients/:id/suppression', ...admin, pfCtrl.getSuppression);
router.post  ('/plateforme/clients/:id/suppression', ...admin, pfCtrl.postSuppression);
router.get   ('/plateforme/clients/:id/roles',  ...admin, pfCtrl.getRoles);
router.put   ('/plateforme/clients/:id/roles',  ...admin, pfCtrl.putRoles);
// NJ BUSINESS (048) : modules activés par client — super_admin uniquement.
// 066 : utilisateurs par module — répartition, écarts, mode du contrôle.
const umCtrl = require('../controllers/utilisateurs_modules.controller');
router.get   ('/plateforme/utilisateurs-modules',          ...admin, umCtrl.rapport);
// 067 : réglages d'expiration des sessions.
const sessCtrl = require('../controllers/sessions.controller');
router.get   ('/plateforme/sessions',  ...admin, sessCtrl.lireReglages);
router.put   ('/plateforme/sessions',  ...admin, sessCtrl.ecrireReglages);
router.put   ('/plateforme/utilisateurs-modules/mode',     ...admin, umCtrl.definirMode);
router.post  ('/plateforme/utilisateurs-modules/reprise',  ...admin, umCtrl.reprendre);
router.get   ('/plateforme/modules',                    ...admin, pfCtrl.getModules);
router.get   ('/plateforme/clients/:id/modules',        ...admin, pfCtrl.getModulesClient);
router.put   ('/plateforme/clients/:id/modules/:code',  ...admin, pfCtrl.putModuleClient);
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
router.post  ('/prospects/:id/suppression',  authGuard, requireRole('super_admin'), prCtrl.supprimer);
// Super Admin : codes personnels de validation directe et permission associée.
router.get   ('/validation-directe',                       authGuard, requireRole('super_admin'), prCtrl.vdLister);
router.get   ('/validation-directe/historique',            authGuard, requireRole('super_admin'), prCtrl.vdHistorique);
router.put   ('/validation-directe/:userId/permission',    authGuard, requireRole('super_admin'), prCtrl.vdPermission);
router.post  ('/validation-directe/:userId/code',          authGuard, requireRole('super_admin'), prCtrl.vdCode);
router.patch ('/validation-directe/codes/:codeId',         authGuard, requireRole('super_admin'), prCtrl.vdModifier);
router.post  ('/validation-directe/codes/:codeId/revoquer', authGuard, requireRole('super_admin'), prCtrl.vdRevoquer);
router.post  ('/validation-directe/codes/:codeId/debloquer', authGuard, requireRole('super_admin'), prCtrl.vdDebloquer);
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
// Public : même demande, validée sur place par un commercial autorisé avec son
// code personnel (débit limité par IP ; blocage du code après 5 échecs).
const rateLimit = require('express-rate-limit');
router.post  ('/demande-demo/validation-directe', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.VALIDATION_DIRECTE_RATE_MAX, 10) || 10,
  message: { error: 'Trop de tentatives de validation depuis cet appareil. Réessayez dans 15 minutes ou envoyez la demande normalement.' },
}), prCtrl.demandeWebValidee);
// Public : lien d'activation reçu par le prospect (aucun JWT).
router.get   ('/activation/:token',          prCtrl.verifierActivation);
router.post  ('/activation/:token',          prCtrl.activer);
// Tâche quotidienne (cron cPanel) : rappels, expirations, notification interne.
router.all   ('/taches/quotidiennes',        prCtrl.requireTacheToken, prCtrl.taches);

// ── NJ COMMERCIAL (052) : vérification PUBLIQUE d'un bon de commande (QR code) ──
// Hors du préfixe /commercial : reste joignable même si le module est désactivé
// chez le client. Débit limité ; ni session, ni prix, ni lignes.
router.get('/verification/bc/:jeton', rateLimit({
  windowMs: 60 * 1000, max: parseInt(process.env.VERIFICATION_RATE_MAX, 10) || 30,
  message: { error: 'Trop de vérifications depuis cet appareil. Réessayez dans une minute.' },
}), require('../controllers/commercial.controller').getVerification);

// ── NJ COMMERCIAL (063) : portail PUBLIC de réponse des fournisseurs (demande de proforma) ──
// Lien individuel (jeton de 256 bits) ; aucune session ; débit limité ; seule l'offre du
// fournisseur concerné est lisible. Hors /commercial, comme la vérification des bons.
{
  const portail = require('../controllers/commercial_appro.controller');
  const limite = rateLimit({ windowMs: 60 * 1000, max: parseInt(process.env.PORTAIL_RATE_MAX, 10) || 40,
    message: { error: 'Trop de requêtes depuis cet appareil. Réessayez dans une minute.' } });
  router.get ('/offres-fournisseurs/:jeton',       limite, portail.getOffrePublique);
  router.get ('/offres-fournisseurs/:jeton/pdf',   limite, portail.getPdfPublic);
  router.post('/offres-fournisseurs/:jeton',       limite, portail.postOffrePublique);
  router.post('/offres-fournisseurs/:jeton/refus', limite, portail.postRefusPublic);
}

// ── NJ COMMERCIAL (migration 050) : /api/commercial/* ─────────────────────
router.use('/commercial', require('./commercial.routes'));

module.exports = router;
