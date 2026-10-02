const { body, param } = require('express-validator');
const { ROLES_VALIDES, TOUS_ROLES } = require('../controllers/users.controller');

const createUserRules = [
  body('username').trim().notEmpty().withMessage('Tous les champs sont requis. Mot de passe : minimum 6 caractères.'),
  body('password').isLength({ min: 6 }).withMessage('Tous les champs sont requis. Mot de passe : minimum 6 caractères.'),
  body('role').isIn(ROLES_VALIDES).withMessage(`Rôle invalide. Valeurs acceptées : ${ROLES_VALIDES.join(', ')}`),
  body('email').optional({ checkFalsy: true }).isEmail(),
  body('custom_role_id').optional({ checkFalsy: true }).isInt(),
];

const updateUserRules = [
  param('id').isUUID().withMessage('Identifiant utilisateur invalide.'),
  body('username').optional({ checkFalsy: true }).isString(),
  body('email').optional({ checkFalsy: true }).isEmail(),
  // Contrôle de forme seulement : QUI peut attribuer QUEL rôle est décidé par
  // le contrôleur (rolesAttribuables). TOUS_ROLES permet d'éditer l'e-mail d'un
  // super_admin sans changer son rôle.
  body('role').optional({ checkFalsy: true }).isIn(TOUS_ROLES).withMessage('Rôle invalide.'),
  body('custom_role_id').optional({ checkFalsy: true }).isInt(),
];

const userIdParamRule = [param('id').isUUID().withMessage('Identifiant utilisateur invalide.')];

const resetPasswordRules = [
  ...userIdParamRule,
  body('password').isLength({ min: 6 }).withMessage('Minimum 6 caractères.'),
];

module.exports = { createUserRules, updateUserRules, userIdParamRule, resetPasswordRules };
