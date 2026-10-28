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

module.exports = router;
