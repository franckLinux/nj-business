// src/middleware/validate.js — exécute les règles express-validator posées sur
// une route et coupe court avec 400 si l'une d'elles échoue.
const { validationResult } = require('express-validator');

const validate = (req, res, next) => {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  res.status(400).json({ error: result.array({ onlyFirstError: true })[0].msg });
};

module.exports = { validate };
