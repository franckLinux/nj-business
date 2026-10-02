const { body } = require('express-validator');

const createMouvementRules = [
  body('date').notEmpty().withMessage('Champs obligatoires manquants (date, mois, annee, rubrique_code).'),
  body('mois').trim().notEmpty().withMessage('Champs obligatoires manquants (date, mois, annee, rubrique_code).'),
  body('annee').notEmpty().withMessage('Champs obligatoires manquants (date, mois, annee, rubrique_code).').isInt(),
  body('rubrique_code').trim().notEmpty().withMessage('Champs obligatoires manquants (date, mois, annee, rubrique_code).'),
  body('journal_id').optional({ checkFalsy: true }).isInt(),
  body('type_caisse').optional({ checkFalsy: true }).isIn(['especes', 'om']),
  body('entree').optional({ checkFalsy: true }).isFloat({ min: 0 }),
  body('sortie').optional({ checkFalsy: true }).isFloat({ min: 0 }),
  body().custom((b) => {
    if (!b.journal_id && !b.type_caisse) throw new Error('journal_id ou type_caisse requis.');
    if ((parseFloat(b.entree) || 0) === 0 && (parseFloat(b.sortie) || 0) === 0) {
      throw new Error('Montant entrée ou sortie requis.');
    }
    return true;
  }),
];

const setRanRules = [
  body('mois').optional({ checkFalsy: true }).isString(),
  body('annee').optional({ checkFalsy: true }).isInt(),
  body('journal_id').optional({ checkFalsy: true }).isInt(),
  body('caisse').optional({ checkFalsy: true }).isIn(['especes', 'om']),
  body('montant').optional({ checkFalsy: true }).isFloat(),
];

module.exports = { createMouvementRules, setRanRules };
