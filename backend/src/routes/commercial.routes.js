'use strict';
// NJ COMMERCIAL — routes sous /api/commercial (module « commercial », migration 050).
// tenantGuard bloque toutes ces routes (403 MODULE_INACTIF) pour un client dont le
// module n'est pas activé ; chaque route exige en plus sa permission.
const router = require('express').Router();
const { authGuard } = require('../middleware/auth');
const { tenantGuard } = require('../middleware/tenant');
const { requirePermission, requireAnyPermission } = require('../middleware/permission');
const c = require('../controllers/commercial.controller');

const base = [authGuard, tenantGuard];
const P = (code) => [...base, requirePermission(code)];
// Listes de référence lues aussi par les demandeurs (formulaire de demande d'achat).
const LECTURE = [...base, requireAnyPermission('com.parametrage.voir', 'com.articles.voir', 'com.da.creer')];

router.get ('/societe',            ...P('com.parametrage.voir'),     c.getSociete);
router.put ('/societe',            ...P('com.parametrage.modifier'), c.putSociete);

router.get ('/unites',             ...LECTURE,                       c.getUnites);
router.post('/unites',             ...P('com.parametrage.modifier'), c.postUnite);
router.put ('/unites/:id',         ...P('com.parametrage.modifier'), c.putUnite);
router.get ('/agences',            ...LECTURE,                       c.getAgences);
router.post('/agences',            ...P('com.parametrage.modifier'), c.postAgence);
router.put ('/agences/:id',        ...P('com.parametrage.modifier'), c.putAgence);
router.put ('/utilisateurs/:id/agences', ...P('com.parametrage.modifier'), c.putAgencesUtilisateur);
router.get ('/magasins',           ...LECTURE,                       c.getMagasins);
router.post('/magasins',           ...P('com.parametrage.modifier'), c.postMagasin);
router.put ('/magasins/:id',       ...P('com.parametrage.modifier'), c.putMagasin);

router.get ('/familles',           ...LECTURE,                       c.getFamilles);
router.post('/familles',           ...P('com.parametrage.modifier'), c.postFamille);
router.put ('/familles/:id',       ...P('com.parametrage.modifier'), c.putFamille);

router.get ('/taxes',              ...LECTURE,                       c.getTaxes);
router.post('/taxes',              ...P('com.parametrage.modifier'), c.postTaxe);
router.put ('/taxes/:id',          ...P('com.parametrage.modifier'), c.putTaxe);

router.get ('/tiers',              ...[...base, requireAnyPermission('com.tiers.voir', 'com.da.creer')], c.getTiers);
router.post('/tiers',              ...P('com.tiers.modifier'),       c.postTiers);
router.put ('/tiers/:id',          ...P('com.tiers.modifier'),       c.putTiers);

router.get ('/articles',           ...LECTURE,                       c.getArticles);
router.get ('/articles/:id',       ...LECTURE,                       c.getArticle);
router.post('/articles',           ...P('com.articles.modifier'),    c.postArticle);
router.put ('/articles/:id',       ...P('com.articles.modifier'),    c.putArticle);
router.delete('/articles/:id',     ...P('com.articles.modifier'),    c.deleteArticle);

router.get ('/stock',              ...LECTURE,                       c.getStock);
router.put ('/stock/initial',      ...P('com.stock.initial'),        c.putStockInitial);

// Droits de chacun : réservé à qui administre le module.
router.get ('/utilisateurs',       ...P('com.parametrage.modifier'), c.getUtilisateurs);

// ── Livraison B : demandes d'achat (les droits fins — auteur, étape, auto-validation —
// sont vérifiés par le service ; ici, l'entrée minimale du module achats).
const DA = [...base, requireAnyPermission('com.da.creer', 'com.da.voir_tout', 'com.da.approuver', 'com.da.approuver_direction')];
router.get   ('/demandes',                      ...DA, c.getDemandes);
router.get   ('/demandes/compteurs',            ...DA, c.getCompteurs);
router.get   ('/demandes/:id',                  ...DA, c.getDemande);
router.post  ('/demandes',                      ...P('com.da.creer'), c.postDemande);
router.put   ('/demandes/:id',                  ...P('com.da.creer'), c.putDemande);
router.delete('/demandes/:id',                  ...P('com.da.creer'), c.deleteDemande);
router.post  ('/demandes/:id/soumission',       ...P('com.da.creer'), c.postSoumission);
router.post  ('/demandes/:id/decision',         ...DA, c.postDecision);
router.post  ('/demandes/:id/annulation',       ...DA, c.postAnnulation);
router.post  ('/demandes/:id/pieces',           ...P('com.documents.ajouter'), c.postPiece);
router.post  ('/demandes/:id/pieces/:doc/retrait', ...P('com.documents.ajouter'), c.postRetraitPiece);
router.get   ('/demandes/:id/pieces/:doc',      ...DA, c.getPiece);

// ── Livraison C : bons de commande (contrôles fins dans le service) ─────────
const BC_VUE = [...base, requireAnyPermission('com.bc.preparer', 'com.bc.emettre', 'com.bc.annuler', 'com.da.voir_tout', 'com.tableau_bord.voir')];
router.get   ('/bons-commande',                          ...BC_VUE, c.getBons);
router.get   ('/bons-commande/a-commander',              ...P('com.bc.preparer'), c.getACommander);
router.get   ('/bons-commande/proposition/:id',          ...P('com.bc.preparer'), c.getProposition);
router.get   ('/bons-commande/:id',                      ...BC_VUE, c.getBon);
router.get   ('/bons-commande/:id/pdf',                  ...BC_VUE, c.getPdfBon);
router.post  ('/bons-commande',                          ...P('com.bc.preparer'), c.postBon);
router.put   ('/bons-commande/:id',                      ...P('com.bc.preparer'), c.putBon);
router.delete('/bons-commande/:id',                      ...P('com.bc.preparer'), c.deleteBon);
router.post  ('/bons-commande/:id/revalidation',         ...P('com.bc.preparer'), c.postRevalidation);
router.post  ('/bons-commande/:id/emission',             ...P('com.bc.emettre'), c.postEmission);
router.post  ('/bons-commande/:id/annulation',           ...P('com.bc.annuler'), c.postAnnulationBon);
router.post  ('/bons-commande/:id/revision',             ...P('com.bc.annuler'), c.postRevision);
router.post  ('/bons-commande/:id/proformas',            ...P('com.bc.preparer'), c.postProforma);
router.post  ('/bons-commande/:id/proformas/:doc/retrait', ...P('com.bc.preparer'), c.postRetraitProforma);
router.get   ('/bons-commande/:id/pieces/:doc',          ...BC_VUE, c.getPieceBon);

// ── Lot 4 : moteur de stock (contrôles fins — auteur, périmètre — dans le service) ──
// Droits fins (057) : une permission par fonction ; le service contrôle le type du document.
const DROITS_STOCK = ['com.stock.voir', 'com.stock.entree', 'com.stock.sortie', 'com.stock.transfert', 'com.stock.inventaire',
  'com.stock.valider', 'com.stock.annuler', 'com.stock.journal', 'com.stock.valorisation'];
const STOCK = [...base, requireAnyPermission(...DROITS_STOCK)];
const SAISIE = [...base, requireAnyPermission('com.stock.entree', 'com.stock.sortie', 'com.stock.transfert', 'com.stock.inventaire')];
router.get   ('/stock/etat',                             ...STOCK, c.getStockEtat);
router.get   ('/stock/mouvements',                       ...STOCK, c.getStockMouvements);
router.get   ('/stock/valorisation',                     ...STOCK, c.getStockValorisation);
router.get   ('/stock/compteurs',                        ...STOCK, c.getStockCompteurs);
router.get   ('/stock/inventaire/articles',              ...P('com.stock.inventaire'), c.getArticlesInventaire);
router.get   ('/stock/documents',                        ...STOCK, c.getStockDocs);
router.get   ('/stock/documents/:id',                    ...STOCK, c.getStockDoc);
router.post  ('/stock/documents',                        ...SAISIE, c.postStockDoc);
router.put   ('/stock/documents/:id',                    ...SAISIE, c.putStockDoc);
router.delete('/stock/documents/:id',                    ...SAISIE, c.deleteStockDoc);
router.post  ('/stock/documents/:id/soumission',         ...SAISIE, c.postStockSoumission);
router.post  ('/stock/documents/:id/renvoi',             ...P('com.stock.valider'), c.postStockRenvoi);
router.post  ('/stock/documents/:id/validation',         ...P('com.stock.valider'), c.postStockValidation);
router.post  ('/stock/documents/:id/annulation',         ...P('com.stock.annuler'), c.postStockAnnulation);
router.post  ('/stock/documents/:id/pieces',             ...STOCK, c.postStockPiece);
router.get   ('/stock/documents/:id/pieces/:doc',        ...STOCK, c.getStockPiece);

router.get   ('/tableau-bord',                           ...P('com.tableau_bord.voir'), c.getTableau);
router.get   ('/documents',                              ...BC_VUE, c.getDocuments);
router.get   ('/historique',                             ...[...base, requireAnyPermission('com.da.voir_tout', 'com.tableau_bord.voir')], c.getHistorique);

module.exports = router;
