// src/validators/auth.validator.js
const { body } = require('express-validator');

const loginRules = [
  body('username').trim().notEmpty().withMessage('Identifiant et mot de passe requis.'),
  body('password').notEmpty().withMessage('Identifiant et mot de passe requis.'),
  body('remplacer').optional().isBoolean({ strict: true }).withMessage('Paramètre « remplacer » invalide.'),
  body('type_appareil').optional().isIn(['mobile', 'ordinateur']).withMessage('Type d\'appareil invalide.'),
];

const changePasswordRules = [
  body('ancienPassword').notEmpty().withMessage('Mot de passe invalide (minimum 6 caractères).'),
  body('nouveauPassword').isLength({ min: 6 }).withMessage('Mot de passe invalide (minimum 6 caractères).'),
];

module.exports = { loginRules, changePasswordRules };
