const { body, param } = require('express-validator');

const createRoleRules = [
  body('nom').trim().notEmpty().withMessage('Nom et code obligatoires.'),
  body('code').trim().notEmpty().withMessage('Nom et code obligatoires.'),
  body('description').optional({ checkFalsy: true }).isString(),
  body('couleur').optional({ checkFalsy: true }).isString(),
];

const updateRoleRules = [
  param('id').isInt().withMessage('Identifiant de rôle invalide.'),
  body('nom').trim().notEmpty().withMessage('Nom obligatoire.'),
  body('description').optional({ checkFalsy: true }).isString(),
  body('couleur').optional({ checkFalsy: true }).isString(),
];

const roleIdParamRule = [param('id').isInt().withMessage('Identifiant de rôle invalide.')];

const setRolePermissionsRules = [
  ...roleIdParamRule,
  body('codes').optional().isArray(),
];

module.exports = { createRoleRules, updateRoleRules, roleIdParamRule, setRolePermissionsRules };
