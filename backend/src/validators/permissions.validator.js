const { body, param } = require('express-validator');

const createPermissionRules = [
  body('code').matches(/^[a-z_]+\.[a-z_]+$/).withMessage('Format code invalide (ex: journal.create).'),
  body('nom').trim().notEmpty().withMessage('code, nom et module sont obligatoires.'),
  body('module').trim().notEmpty().withMessage('code, nom et module sont obligatoires.'),
  body('description').optional({ checkFalsy: true }).isString(),
];

const updatePermissionRules = [
  param('code').notEmpty(),
  body('nom').optional({ checkFalsy: true }).isString(),
  body('module').optional({ checkFalsy: true }).isString(),
  body('description').optional({ checkFalsy: true }).isString(),
];

const codesArrayRules = [
  body('codes').isArray().withMessage('codes doit être un tableau.'),
];

module.exports = { createPermissionRules, updatePermissionRules, codesArrayRules };
