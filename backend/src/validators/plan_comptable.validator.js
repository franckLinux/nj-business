const { body } = require('express-validator');

const createCompteRules = [
  body('compte').trim().notEmpty().withMessage('Numéro de compte et intitulé obligatoires.'),
  body('intitule').trim().notEmpty().withMessage('Numéro de compte et intitulé obligatoires.'),
  body('classe').optional({ checkFalsy: true }).isInt({ min: 1, max: 9 }),
  body('nature').optional({ checkFalsy: true }).isString(),
];

module.exports = { createCompteRules };
