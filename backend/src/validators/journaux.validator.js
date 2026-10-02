const { body, param } = require('express-validator');
const { TYPES_JOURNAUX } = require('../controllers/journaux.controller');

const TYPES = Object.keys(TYPES_JOURNAUX);

const createJournalRules = [
  body('nom').trim().notEmpty().withMessage('Nom et type obligatoires.'),
  body('type').isIn(TYPES).withMessage(`Type invalide. Valeurs : ${TYPES.join(', ')}`),
  body('code').optional({ checkFalsy: true }).isString(),
  body('devise').optional({ checkFalsy: true }).isString(),
  body('responsable_saisie').optional({ checkFalsy: true }).isUUID(),
  body('responsable_arret').optional({ checkFalsy: true }).isUUID(),
  body('ordre').optional({ checkFalsy: true }).isInt(),
];

const updateJournalRules = [
  param('id').isInt().withMessage('Identifiant de journal invalide.'),
  body('nom').optional({ checkFalsy: true }).isString(),
  body('devise').optional({ checkFalsy: true }).isString(),
  body('responsable_saisie').optional({ checkFalsy: true }).isUUID(),
  body('responsable_arret').optional({ checkFalsy: true }).isUUID(),
  body('ordre').optional({ checkFalsy: true }).isInt(),
  body('actif').optional().isBoolean(),
];

const journalIdParamRule = [param('id').isInt().withMessage('Identifiant de journal invalide.')];

module.exports = { createJournalRules, updateJournalRules, journalIdParamRule };
