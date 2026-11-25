'use strict';
// NJ FINANCE — routes sous /api/finance (module « caisse », préfixe ajouté par la 075).
// tenantGuard bloque ces routes pour un client dont le module n'est pas activé ;
// chaque route exige en plus sa permission. Lot F2 : socle comptable.
const router = require('express').Router();
const { authGuard } = require('../middleware/auth');
const { tenantGuard } = require('../middleware/tenant');
const { requirePermission, requireAnyPermission } = require('../middleware/permission');
const c = require('../controllers/finance.controller');

const base = [authGuard, tenantGuard];
const P = (code) => [...base, requirePermission(code)];
const VOIR = [...base, requireAnyPermission('finance.ecritures.voir', 'finance.config.comptabilite')];

router.get ('/exercices',               ...VOIR,                                    c.getExercices);
router.get ('/exercices/proposition',   ...P('finance.config.comptabilite'),        c.getProposition);
router.post('/exercices',               ...P('finance.config.comptabilite'),        c.postExercice);
router.put ('/periodes/:id/statut',     ...P('finance.periodes.verrouiller'),       c.putPeriodeStatut);

router.get ('/journaux-comptables',          ...VOIR,                               c.getJournaux);
router.post('/journaux-comptables',          ...P('finance.config.comptabilite'),   c.postJournal);
router.post('/journaux-comptables/initialiser', ...P('finance.config.comptabilite'), c.postInitJournaux);
router.put ('/journaux-comptables/:id',      ...P('finance.config.comptabilite'),   c.putJournal);

router.get ('/comptes',                 ...P('finance.ecritures.voir'),             c.getComptes);
router.get ('/referentiels',            ...P('finance.ecritures.voir'),             c.getReferentiels);

router.get ('/ecritures',               ...P('finance.ecritures.voir'),             c.getEcritures);
router.get ('/ecritures/:id',           ...P('finance.ecritures.voir'),             c.getEcriture);
router.post('/ecritures',               ...P('finance.ecritures.saisir'),           c.postEcriture);
router.put ('/ecritures/:id',           ...P('finance.ecritures.saisir'),           c.putEcriture);
router.delete('/ecritures/:id',         ...P('finance.ecritures.saisir'),           c.deleteEcriture);
router.post('/ecritures/:id/valider',   ...P('finance.ecritures.valider'),          c.postValider);
router.post('/ecritures/:id/extourner', ...P('finance.ecritures.valider'),          c.postExtourner);

router.get ('/balance',                 ...P('finance.ecritures.voir'),             c.getBalance);
router.get ('/grand-livre',             ...P('finance.ecritures.voir'),             c.getGrandLivre);

module.exports = router;
