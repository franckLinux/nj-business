const { body } = require('express-validator');

const createCompteRules = [
  body('compte').trim().notEmpty().withMessage('Numéro de compte et intitulé obligatoires.'),
  body('intitule').trim().notEmpty().withMessage('Numéro de compte et intitulé obligatoires.'),
  body('classe').optional({ checkFalsy: true }).isInt({ min: 1, max: 9 }),
  body('nature').optional({ checkFalsy: true }).isString(),
];

const updateCompteRules = [
  body('intitule').optional().isString().trim().isLength({ min: 1, max: 300 }).withMessage("L'intitulé est obligatoire (300 caractères max)."),
  body('description').optional().isString().isLength({ max: 1000 }),
  body('compte').optional().isString().trim().isLength({ min: 1, max: 30 }).withMessage('Numéro de compte invalide.'),
];

const statutCompteRules = [
  body('statut').isIn(['actif', 'inactif', 'archive']).withMessage('Statut invalide (actif, inactif ou archive).'),
];

module.exports = { createCompteRules, updateCompteRules, statutCompteRules };
