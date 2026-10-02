const { body, param } = require('express-validator');

const arreterRules = [
  param('id').isInt().withMessage('Identifiant de journal invalide.'),
  body('mois').trim().notEmpty().withMessage('mois et annee requis.'),
  body('annee').notEmpty().withMessage('mois et annee requis.').isInt(),
  body('solde_final').optional({ checkFalsy: true }).isFloat(),
  body('commentaire').optional({ checkFalsy: true }).isString(),
];

module.exports = { arreterRules };
