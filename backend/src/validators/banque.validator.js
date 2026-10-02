const { body } = require('express-validator');

const updateBanqueRules = [
  body('mois').trim().notEmpty().withMessage('mois et annee requis.'),
  body('annee').notEmpty().withMessage('mois et annee requis.').isInt(),
  body('solde_initial').optional({ checkFalsy: true }).isFloat(),
  body('fonds_recus').optional({ checkFalsy: true }).isFloat(),
  body('solde_final').optional({ checkFalsy: true }).isFloat(),
];

module.exports = { updateBanqueRules };
