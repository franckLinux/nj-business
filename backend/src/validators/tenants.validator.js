const { body, param } = require('express-validator');

const createTenantRules = [
  body('slug').trim().notEmpty().withMessage('Nom et slug obligatoires.')
    .matches(/^[a-z0-9-]+$/).withMessage('Slug invalide.'),
  body('nom').trim().notEmpty().withMessage('Nom et slug obligatoires.'),
  body('caissier_nom').optional({ checkFalsy: true }).isString(),
  body('modules').optional().isArray().withMessage('Modules : liste attendue.'),
  body('directeur_nom').optional({ checkFalsy: true }).isString(),
  body('devise').optional({ checkFalsy: true }).isString(),
];

const toggleActifRules = [
  param('id').isUUID().withMessage('Identifiant de tenant invalide.'),
  body('actif').optional().isBoolean(),
];

module.exports = { createTenantRules, toggleActifRules };
