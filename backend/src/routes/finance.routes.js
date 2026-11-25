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

module.exports = router;
