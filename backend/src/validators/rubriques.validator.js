const { body, param } = require('express-validator');

const createRubriqueRules = [
  body('code').trim().notEmpty().withMessage('Code, intitulé et type requis.'),
  body('intitule').trim().notEmpty().withMessage('Code, intitulé et type requis.'),
  body('type').isIn(['entree', 'depense']).withMessage('Code, intitulé et type requis.'),
  body('est_virement_interne').optional().isBoolean(),
  body('code_comptable').optional({ checkFalsy: true }).isString(),
  body('ordre').optional({ checkFalsy: true }).isInt(),
];

const updateRubriqueRules = [
  param('id').isInt().withMessage('Identifiant de rubrique invalide.'),
  body('intitule').optional({ checkFalsy: true }).isString(),
  body('est_virement_interne').optional().isBoolean(),
  body('code_comptable').optional({ checkFalsy: true }).isString(),
  body('ordre').optional({ checkFalsy: true }).isInt(),
  body('actif').optional().isBoolean(),
];

const rubriqueIdParamRule = [param('id').isInt().withMessage('Identifiant de rubrique invalide.')];

module.exports = { createRubriqueRules, updateRubriqueRules, rubriqueIdParamRule };
