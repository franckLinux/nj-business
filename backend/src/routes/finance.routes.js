'use strict';
// NJ FINANCE — routes sous /api/finance (module « caisse », préfixe ajouté par la 075).
// tenantGuard bloque ces routes si le module n'est pas activé ; chaque route
// exige en plus sa permission. Lot F4 : clients et fournisseurs.
const router = require('express').Router();
const { authGuard } = require('../middleware/auth');
const { tenantGuard } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/permission');
const c = require('../controllers/finance.controller');

const { requireAnyPermission } = require('../middleware/permission');
const config = require('../services/finance/config.service');

const P = (code) => [authGuard, tenantGuard, requirePermission(code)];
// Lecture du paramétrage : quiconque paramètre ou facture (achats et ventes viendront aux lots F6 et F8).
const LIRE_CONFIG = [authGuard, tenantGuard, requireAnyPermission('finance.config.facturation', 'finance.tiers.voir')];
const CONFIG = P('finance.config.facturation');

router.get ('/tiers',               ...P('finance.tiers.voir'),  c.getTiers);
router.post('/tiers',               ...P('finance.tiers.gerer'), c.postTiers);
router.get ('/tiers/:id',           ...P('finance.tiers.voir'),  c.getFiche);
router.put ('/tiers/:id',           ...P('finance.tiers.gerer'), c.putTiers);
router.get ('/tiers/:id/releve',    ...P('finance.tiers.voir'),  c.getReleve);
router.get ('/tiers/:id/caisse',    ...P('finance.tiers.voir'),  c.getCaisseTiers);
router.get ('/creances',            ...P('finance.tiers.voir'),  c.getCreances);
router.get ('/dettes',              ...P('finance.tiers.voir'),  c.getDettes);

router.get ('/config',                    ...LIRE_CONFIG, c.getConfig);
router.get ('/config/comptes',            ...LIRE_CONFIG, c.getComptes);
router.post('/config/initialiser',        ...CONFIG, c.postInitConfig);
router.put ('/config/sequences',          ...CONFIG, c.putSequence);
for (const [chemin, fn] of [['categories', config.enregistrerCategorie], ['familles', config.enregistrerFamille],
  ['prestations', config.enregistrerPrestation], ['modes-reglement', config.enregistrerMode], ['taxes', config.enregistrerTaxe]]) {
  router.post(`/config/${chemin}`,     ...CONFIG, c.enregistrer(fn, 201));
  router.put (`/config/${chemin}/:id`, ...CONFIG, c.enregistrer(fn));
}

// Achats (lot F6) : factures fournisseurs NJ FINANCE + factures validées de NJ COMMERCIAL.
const VOIR_ACHATS = P('finance.achats.voir');
const SAISIR = P('finance.achats.saisir');
const VALIDER = P('finance.achats.valider');
const AFFECTER = P('finance.reglements.affecter');
// La caisse relie une sortie aux factures à la saisie : la liste des factures ouvertes lui suffit.
const FACTURES_OUVERTES = [authGuard, tenantGuard, requireAnyPermission('finance.achats.voir', 'finance.reglements.affecter')];
router.get   ('/achats/referentiels',         ...VOIR_ACHATS, c.getAchatsRef);
router.get   ('/achats/echeancier',           ...VOIR_ACHATS, c.getEcheancier);
router.get   ('/achats/ouvertes',             ...FACTURES_OUVERTES, c.getOuvertes);
router.get   ('/achats/sorties-disponibles',  ...AFFECTER, c.getSorties);
router.get   ('/achats',                      ...VOIR_ACHATS, c.getAchats);
router.post  ('/achats',                      ...SAISIR, c.postAchat);
router.get   ('/achats/:origine(fin|com_ff)/:id', ...VOIR_ACHATS, c.getAchat);
router.put   ('/achats/fin/:id',              ...SAISIR, c.putAchat);
router.delete('/achats/fin/:id',              ...SAISIR, c.deleteAchat);
router.post  ('/achats/fin/:id/soumettre',    ...SAISIR, c.postSoumettre);
router.post  ('/achats/fin/:id/renvoyer',     ...VALIDER, c.postRenvoyer);
router.post  ('/achats/fin/:id/valider',      ...VALIDER, c.postValider);
router.post  ('/achats/fin/:id/annuler',      ...VALIDER, c.postAnnuler);
router.post  ('/achats/com_ff/:id/imputer',   ...VALIDER, c.postImputer);   // l'écriture d'achat est validée à l'imputation
router.post  ('/reglements',                  ...AFFECTER, c.postReglement);
router.delete('/reglements/:id',              ...AFFECTER, c.deleteReglement);

module.exports = router;
