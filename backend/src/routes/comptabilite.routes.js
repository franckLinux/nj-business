'use strict';
// NJ COMPTABILITÉ — routes sous /api/comptabilite (module « comptabilite », 076).
// tenantGuard bloque ces routes pour un client dont le module n'est pas activé
// (ou pour une personne qui n'y est pas rattachée) ; chaque route exige en plus
// sa permission.
const router = require('express').Router();
const { authGuard } = require('../middleware/auth');
const { tenantGuard } = require('../middleware/tenant');
const { requirePermission, requireAnyPermission } = require('../middleware/permission');
const c = require('../controllers/comptabilite.controller');

const base = [authGuard, tenantGuard];
const P = (code) => [...base, requirePermission(code)];
const VOIR = [...base, requireAnyPermission('compta.ecritures.voir', 'compta.parametrage')];

router.get ('/exercices',               ...VOIR,                                    c.getExercices);
router.get ('/exercices/proposition',   ...P('compta.parametrage'),        c.getProposition);
router.post('/exercices',               ...P('compta.parametrage'),        c.postExercice);
router.put ('/periodes/:id/statut',     ...P('compta.periodes.verrouiller'),       c.putPeriodeStatut);

router.get ('/journaux-comptables',          ...VOIR,                               c.getJournaux);
router.post('/journaux-comptables',          ...P('compta.parametrage'),   c.postJournal);
router.post('/journaux-comptables/initialiser', ...P('compta.parametrage'), c.postInitJournaux);
router.put ('/journaux-comptables/:id',      ...P('compta.parametrage'),   c.putJournal);

router.get ('/comptes',                 ...P('compta.ecritures.voir'),             c.getComptes);
router.get ('/referentiels',            ...P('compta.ecritures.voir'),             c.getReferentiels);

router.get ('/ecritures',               ...P('compta.ecritures.voir'),             c.getEcritures);
router.get ('/ecritures/:id',           ...P('compta.ecritures.voir'),             c.getEcriture);
router.post('/ecritures',               ...P('compta.ecritures.saisir'),           c.postEcriture);
router.put ('/ecritures/:id',           ...P('compta.ecritures.saisir'),           c.putEcriture);
router.delete('/ecritures/:id',         ...P('compta.ecritures.saisir'),           c.deleteEcriture);
router.post('/ecritures/:id/valider',   ...P('compta.ecritures.valider'),          c.postValider);
router.post('/ecritures/:id/extourner', ...P('compta.ecritures.valider'),          c.postExtourner);

router.get ('/balance',                 ...P('compta.ecritures.voir'),             c.getBalance);
router.get ('/grand-livre',             ...P('compta.ecritures.voir'),             c.getGrandLivre);

module.exports = router;
