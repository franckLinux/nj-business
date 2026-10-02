// src/middleware/permission.js — usine de guards par permission.
// À placer après authGuard (+ tenantGuard quand la route est multi-tenant).
// Ex: requirePermission('journal.create')
//
// La permission est la règle d'autorisation unique : voir la résolution et la
// matrice des défauts par rôle dans services/permission.service.js.
const { getEffectivePermissions } = require('../services/permission.service');

// La résolution touche jusqu'à 4 tables ; on la mémoïse sur la requête pour
// qu'une route portant plusieurs guards ne la rejoue pas.
const resoudre = async (req) => {
  if (req._permissionsResolues === undefined) {
    req._permissionsResolues = await getEffectivePermissions({
      tenantId: req.tenantId ?? req.user.tenantId,
      userId:   req.user.id,
      role:     req.user.role,
    });
  }
  return req._permissionsResolues;
};

const requirePermission = (code) => async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Non authentifié.' });
  try {
    const accordees = await resoudre(req);
    if (accordees !== null && !accordees.includes(code)) {
      return res.status(403).json({ error: `Permission requise : ${code}.` });
    }
    next();
  } catch (err) {
    console.error('[Permission] vérification échouée :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = { requirePermission };
