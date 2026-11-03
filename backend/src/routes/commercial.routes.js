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

// ── Lot 5 : documents d'achat (contrôles fins — auteur, périmètre, plafonds — dans le service) ──
const RC_VUE = [...base, requireAnyPermission('com.receptions.saisir', 'com.receptions.valider', 'com.receptions.annuler', 'com.retours_fourn.saisir',
  'com.retours_fourn.valider', 'com.bc.preparer', 'com.bc.emettre', 'com.da.voir_tout', 'com.factures_fourn.voir', 'com.factures_fourn.saisir',
  'com.factures_fourn.valider', 'com.stock.journal')];
const FF_VUE = [...base, requireAnyPermission('com.factures_fourn.voir', 'com.factures_fourn.saisir', 'com.factures_fourn.valider', 'com.factures_fourn.annuler')];
router.get   ('/achats/compteurs',                       ...RC_VUE, c.getAchatsCompteurs);
router.get   ('/receptions/a-recevoir',                  ...[...base, requireAnyPermission('com.receptions.saisir', 'com.receptions.valider')], c.getARecevoir);
router.get   ('/receptions/proposition/:bc',             ...P('com.receptions.saisir'), c.getPropositionReception);
router.get   ('/receptions',                             ...RC_VUE, c.listerDoc('reception'));
router.get   ('/receptions/:id',                         ...RC_VUE, c.getReception);
router.post  ('/receptions',                             ...P('com.receptions.saisir'), c.postReception);
router.put   ('/receptions/:id',                         ...P('com.receptions.saisir'), c.putReception);
router.delete('/receptions/:id',                         ...P('com.receptions.saisir'), c.supprimerDoc('reception'));
router.post  ('/receptions/:id/soumission',              ...P('com.receptions.saisir'), c.soumettreDoc('reception'));
router.post  ('/receptions/:id/renvoi',                  ...P('com.receptions.valider'), c.renvoyerDoc('reception'));
router.post  ('/receptions/:id/validation',              ...P('com.receptions.valider'), c.postValidationReception);
router.post  ('/receptions/:id/annulation',              ...P('com.receptions.annuler'), c.postAnnulationReception);
router.post  ('/receptions/:id/pieces',                  ...RC_VUE, c.joindreDoc('reception'));
router.get   ('/receptions/:id/pieces/:doc',             ...RC_VUE, c.pieceDoc('reception'));

router.get   ('/retours-fournisseurs/proposition/:rec',  ...P('com.retours_fourn.saisir'), c.getPropositionRetour);
router.get   ('/retours-fournisseurs',                   ...RC_VUE, c.listerDoc('retour'));
router.get   ('/retours-fournisseurs/:id',               ...RC_VUE, c.getRetour);
router.post  ('/retours-fournisseurs',                   ...P('com.retours_fourn.saisir'), c.postRetour);
router.put   ('/retours-fournisseurs/:id',               ...P('com.retours_fourn.saisir'), c.putRetour);
router.delete('/retours-fournisseurs/:id',               ...P('com.retours_fourn.saisir'), c.supprimerDoc('retour'));
router.post  ('/retours-fournisseurs/:id/soumission',    ...P('com.retours_fourn.saisir'), c.soumettreDoc('retour'));
router.post  ('/retours-fournisseurs/:id/renvoi',        ...P('com.retours_fourn.valider'), c.renvoyerDoc('retour'));
router.post  ('/retours-fournisseurs/:id/validation',    ...P('com.retours_fourn.valider'), c.postValidationRetour);
router.post  ('/retours-fournisseurs/:id/annulation',    ...P('com.receptions.annuler'), c.postAnnulationRetour);
router.post  ('/retours-fournisseurs/:id/pieces',        ...RC_VUE, c.joindreDoc('retour'));
router.get   ('/retours-fournisseurs/:id/pieces/:doc',   ...RC_VUE, c.pieceDoc('retour'));

router.get   ('/factures-fournisseurs/a-facturer',       ...P('com.factures_fourn.saisir'), c.getFournisseursAFacturer);
router.get   ('/factures-fournisseurs/a-facturer/:f',    ...P('com.factures_fourn.saisir'), c.getAFacturer);
router.get   ('/factures-fournisseurs',                  ...FF_VUE, c.listerDoc('facture'));
router.get   ('/factures-fournisseurs/:id',              ...FF_VUE, c.getFacture);
router.post  ('/factures-fournisseurs',                  ...P('com.factures_fourn.saisir'), c.postFacture);
router.put   ('/factures-fournisseurs/:id',              ...P('com.factures_fourn.saisir'), c.putFacture);
router.delete('/factures-fournisseurs/:id',              ...P('com.factures_fourn.saisir'), c.supprimerDoc('facture'));
router.post  ('/factures-fournisseurs/:id/soumission',   ...P('com.factures_fourn.saisir'), c.soumettreDoc('facture'));
router.post  ('/factures-fournisseurs/:id/renvoi',       ...P('com.factures_fourn.valider'), c.renvoyerDoc('facture'));
router.post  ('/factures-fournisseurs/:id/validation',   ...P('com.factures_fourn.valider'), c.postValidationFacture);
router.post  ('/factures-fournisseurs/:id/annulation',   ...P('com.factures_fourn.annuler'), c.postAnnulationFacture);
router.post  ('/factures-fournisseurs/:id/pieces',       ...FF_VUE, c.joindreDoc('facture'));
router.get   ('/factures-fournisseurs/:id/pieces/:doc',  ...FF_VUE, c.pieceDoc('facture'));

// ── Lot 6 : ventes (devis → commande client → préparation / livraison) ────
const VT_VUE = [...base, requireAnyPermission('com.ventes.voir', 'com.ventes.devis', 'com.ventes.valider', 'com.ventes.valider_direction',
  'com.ventes.commandes', 'com.ventes.preparer', 'com.ventes.livrer', 'com.ventes.annuler')];
const VT_VALIDER = [...base, requireAnyPermission('com.ventes.valider', 'com.ventes.valider_direction')];
router.get   ('/ventes/compteurs',                       ...VT_VUE, c.getVentesCompteurs);
router.get   ('/devis',                                  ...VT_VUE, c.getDevisListe);
router.get   ('/devis/:id',                              ...VT_VUE, c.getDevis);
router.get   ('/devis/:id/pdf',                          ...VT_VUE, c.getPdfDevis);
router.post  ('/devis',                                  ...P('com.ventes.devis'), c.postDevis);
router.put   ('/devis/:id',                              ...P('com.ventes.devis'), c.putDevis);
router.delete('/devis/:id',                              ...P('com.ventes.devis'), c.deleteDevis);
router.post  ('/devis/:id/soumission',                   ...P('com.ventes.devis'), c.postSoumissionDevis);
router.post  ('/devis/:id/validation',                   ...VT_VALIDER, c.postValidationDevis);
router.post  ('/devis/:id/renvoi',                       ...VT_VALIDER, c.postRenvoiDevis);
router.post  ('/devis/:id/annulation',                   ...P('com.ventes.annuler'), c.postAnnulationDevis);
router.post  ('/devis/:id/refus',                        ...P('com.ventes.commandes'), c.postRefusDevis);
router.post  ('/devis/:id/acceptation',                  ...P('com.ventes.commandes'), c.postAcceptationDevis);
router.post  ('/devis/:id/duplication',                  ...P('com.ventes.devis'), c.postDuplicationDevis);
router.post  ('/devis/:id/pieces',                       ...VT_VUE, c.joindreVente('devis'));
router.get   ('/devis/:id/pieces/:doc',                  ...VT_VUE, c.pieceVente('devis'));
router.get   ('/commandes-clients',                      ...VT_VUE, c.getCommandesClients);
router.get   ('/commandes-clients/:id',                  ...VT_VUE, c.getCommandeClient);
router.post  ('/commandes-clients/:id/annulation',       ...P('com.ventes.annuler'), c.postAnnulationCommande);
router.post  ('/commandes-clients/:id/pieces',           ...VT_VUE, c.joindreVente('commande'));
router.get   ('/commandes-clients/:id/pieces/:doc',      ...VT_VUE, c.pieceVente('commande'));
router.get   ('/livraisons/a-livrer',                    ...VT_VUE, c.getALivrer);
router.get   ('/livraisons/proposition/:cmd',            ...P('com.ventes.preparer'), c.getPropositionLivraison);
router.get   ('/livraisons',                             ...VT_VUE, c.getLivraisons);
router.get   ('/livraisons/:id',                         ...VT_VUE, c.getLivraison);
router.get   ('/livraisons/:id/pdf',                     ...VT_VUE, c.getPdfLivraison);
router.post  ('/livraisons',                             ...P('com.ventes.preparer'), c.postLivraison);
router.put   ('/livraisons/:id',                         ...P('com.ventes.preparer'), c.putLivraison);
router.delete('/livraisons/:id',                         ...P('com.ventes.preparer'), c.deleteLivraison);
router.post  ('/livraisons/:id/preparation',             ...P('com.ventes.preparer'), c.postPreparationLivraison);
router.post  ('/livraisons/:id/renvoi',                  ...P('com.ventes.livrer'), c.postRenvoiLivraison);
router.post  ('/livraisons/:id/validation',              ...P('com.ventes.livrer'), c.postValidationLivraison);
router.post  ('/livraisons/:id/annulation',              ...P('com.ventes.annuler'), c.postAnnulationLivraison);
router.post  ('/livraisons/:id/pieces',                  ...VT_VUE, c.joindreVente('livraison'));
router.get   ('/livraisons/:id/pieces/:doc',             ...VT_VUE, c.pieceVente('livraison'));

router.get   ('/tableau-bord',                           ...P('com.tableau_bord.voir'), c.getTableau);
router.get   ('/documents',                              ...BC_VUE, c.getDocuments);
router.get   ('/historique',                             ...[...base, requireAnyPermission('com.da.voir_tout', 'com.tableau_bord.voir')], c.getHistorique);

module.exports = router;
