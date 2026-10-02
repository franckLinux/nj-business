const { body } = require('express-validator');
const { FORMES_JURIDIQUES } = require('../controllers/config.controller');

const CODES = FORMES_JURIDIQUES.map((f) => f.code);

const updateConfigRules = [
  body('nom').trim().notEmpty().withMessage("Le nom de l'entité est obligatoire."),
  body('forme_juridique').optional({ checkFalsy: true }).isIn(CODES)
    .withMessage(`Forme juridique invalide. Codes acceptés : ${CODES.join(', ')}`),
  body('nui').optional({ checkFalsy: true }).isLength({ max: 20 }).withMessage('NUI trop long (max 20 caractères).'),
  body('devise').optional({ checkFalsy: true }).isString(),
  body('exercice_debut').optional({ checkFalsy: true }).isISO8601(),
  body('exercice_fin').optional({ checkFalsy: true }).isISO8601(),
];

module.exports = { updateConfigRules };
