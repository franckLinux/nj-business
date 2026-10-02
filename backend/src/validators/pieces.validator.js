const { body, param } = require('express-validator');

const uploadRules = [
  param('mouvementId').isInt().withMessage('Mouvement introuvable.'),
  body('nom_fichier').trim().notEmpty().withMessage('Fichier invalide.'),
  body('mime_type').trim().notEmpty().withMessage('Fichier invalide.'),
  body('data_base64').notEmpty().withMessage('Fichier invalide.'),
];

const createTypeRules = [
  body('rubrique_code').trim().notEmpty().withMessage('Rubrique et intitulé obligatoires.'),
  body('intitule_piece').trim().notEmpty().withMessage('Rubrique et intitulé obligatoires.'),
  body('description').optional({ checkFalsy: true }).isString(),
  body('obligatoire').optional().isBoolean(),
  body('ordre').optional({ checkFalsy: true }).isInt(),
];

const updateTypeRules = [
  param('id').isInt().withMessage('Identifiant de type invalide.'),
  body('intitule_piece').optional({ checkFalsy: true }).isString(),
  body('description').optional({ checkFalsy: true }).isString(),
  body('obligatoire').optional().isBoolean(),
  body('ordre').optional({ checkFalsy: true }).isInt(),
  body('actif').optional().isBoolean(),
];

const typeIdParamRule = [param('id').isInt().withMessage('Identifiant de type invalide.')];

module.exports = { uploadRules, createTypeRules, updateTypeRules, typeIdParamRule };
