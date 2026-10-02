const { body, param } = require('express-validator');

const createAppelFondsRules = [
  body('mois_cible').trim().notEmpty().withMessage('Champs obligatoires manquants.'),
  body('annee_cible').notEmpty().withMessage('Champs obligatoires manquants.').isInt(),
  body('rubrique_code').trim().notEmpty().withMessage('Champs obligatoires manquants.'),
  body('intitule').trim().notEmpty().withMessage('Champs obligatoires manquants.'),
  body('montant_prevu').notEmpty().withMessage('Champs obligatoires manquants.').isFloat({ gt: 0 }),
  body('journal_id').optional({ checkFalsy: true }).isInt(),
  body('justification').optional({ checkFalsy: true }).isString(),
];

const updateStatutRules = [
  param('id').isInt().withMessage('Identifiant invalide.'),
  body('statut').isIn(['approuve', 'rejete', 'partiellement_approuve', 'en_attente']).withMessage('Statut invalide.'),
  body('montant_approuve').optional({ checkFalsy: true }).isFloat(),
  body('commentaire_approbation').optional({ checkFalsy: true }).isString(),
];

module.exports = { createAppelFondsRules, updateStatutRules };
