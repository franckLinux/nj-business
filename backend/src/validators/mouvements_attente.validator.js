const { param, body } = require('express-validator');

const idParamRule = [param('id').isInt().withMessage('Identifiant de dépense invalide.')];

const decisionRules = [
  ...idParamRule,
  body('commentaire').optional({ checkFalsy: true }).isString(),
];

module.exports = { idParamRule, decisionRules };
