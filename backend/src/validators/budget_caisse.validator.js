const { body } = require('express-validator');

const setBudgetCaisseRules = [
  body('journal_id').notEmpty().withMessage('journal_id, mois et annee requis.').isInt(),
  body('mois').trim().notEmpty().withMessage('journal_id, mois et annee requis.'),
  body('annee').notEmpty().withMessage('journal_id, mois et annee requis.').isInt(),
  body('montant').optional({ checkFalsy: true }).isFloat(),
];

const createDemandeRules = [
  body('journal_id').notEmpty().withMessage('Champs obligatoires manquants.').isInt(),
  body('mois').trim().notEmpty().withMessage('Champs obligatoires manquants.'),
  body('annee').notEmpty().withMessage('Champs obligatoires manquants.').isInt(),
  body('rubrique_code').trim().notEmpty().withMessage('Champs obligatoires manquants.'),
  body('intitule').trim().notEmpty().withMessage('Champs obligatoires manquants.'),
  body('sortie').notEmpty().withMessage('Champs obligatoires manquants.').isFloat({ gt: 0 }),
  body('date_mvt').optional({ checkFalsy: true }).notEmpty(),
  body('type_depassement').optional({ checkFalsy: true }).isIn(['journal', 'rubrique', 'sans_budget']),
];

const validerDemandeRules = [
  body('statut').isIn(['approuve', 'rejete']).withMessage("statut doit être 'approuve' ou 'rejete'."),
  body('commentaire').optional({ checkFalsy: true }).isString(),
];

module.exports = { setBudgetCaisseRules, createDemandeRules, validerDemandeRules };
