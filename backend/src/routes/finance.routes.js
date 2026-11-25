'use strict';
// NJ FINANCE — routes sous /api/finance (module « caisse », préfixe ajouté par la 075).
// tenantGuard bloque ces routes si le module n'est pas activé ; chaque route
// exige en plus sa permission. Lot F4 : clients et fournisseurs.
const router = require('express').Router();
const { authGuard } = require('../middleware/auth');
const { tenantGuard } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/permission');
const c = require('../controllers/finance.controller');

const P = (code) => [authGuard, tenantGuard, requirePermission(code)];

router.get ('/tiers',               ...P('finance.tiers.voir'),  c.getTiers);
router.post('/tiers',               ...P('finance.tiers.gerer'), c.postTiers);
router.get ('/tiers/:id',           ...P('finance.tiers.voir'),  c.getFiche);
router.put ('/tiers/:id',           ...P('finance.tiers.gerer'), c.putTiers);
router.get ('/tiers/:id/releve',    ...P('finance.tiers.voir'),  c.getReleve);
router.get ('/tiers/:id/caisse',    ...P('finance.tiers.voir'),  c.getCaisseTiers);
router.get ('/creances',            ...P('finance.tiers.voir'),  c.getCreances);
router.get ('/dettes',              ...P('finance.tiers.voir'),  c.getDettes);

module.exports = router;
