const { body, param } = require('express-validator');

const setBudgetLineRules = [
  body('mois').trim().notEmpty().withMessage('Champs obligatoires manquants.'),
  body('annee').notEmpty().withMessage('Champs obligatoires manquants.').isInt(),
  body('rubrique_code').trim().notEmpty().withMessage('Champs obligatoires manquants.'),
  body('intitule').trim().notEmpty().withMessage('Champs obligatoires manquants.'),
  body('montant').optional({ checkFalsy: true }).isFloat(),
  body('mois_applic').optional({ checkFalsy: true }).isString(),
  body('annee_applic').optional({ checkFalsy: true }).isInt(),
];

const setValidationRules = [
  body('mois').trim().notEmpty(),
  body('annee').notEmpty().isInt(),
  body('statut').isIn(['en_attente', 'valide', 'rejete']).withMessage('Statut invalide.'),
  body('commentaire').optional({ checkFalsy: true }).isString(),
];

const attenteLigneRules = [
  body('mois').trim().notEmpty(),
  body('annee').notEmpty().isInt(),
  body('rubrique_code').trim().notEmpty(),
  body('intitule').optional({ checkFalsy: true }).isString(),
  body('montant').optional({ checkFalsy: true }).isFloat(),
];

const batchAttenteRules = [
  body('mois').trim().notEmpty().withMessage('Données invalides.'),
  body('annee').notEmpty().withMessage('Données invalides.').isInt(),
  body('lignes').isArray().withMessage('Données invalides.'),
];

const budgetIdParamRule = [param('id').isInt().withMessage('Identifiant invalide.')];

module.exports = {
  setBudgetLineRules, setValidationRules, attenteLigneRules, batchAttenteRules, budgetIdParamRule,
};
