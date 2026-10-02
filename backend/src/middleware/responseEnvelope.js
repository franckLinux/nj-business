// src/middleware/responseEnvelope.js
// Enveloppe uniforme de toutes les réponses JSON de l'API : { success, message, data, errors }.
// Patché sur res.json() plutôt que réécrit dans chacun des ~20 controllers : un seul
// point de vérité, aucun risque d'oubli/incohérence controller par controller.
// `data` contient toujours le corps exact que le controller a construit — donc aucune
// information n'est perdue (y compris les champs additionnels d'erreur comme
// `existing_id`) — ce qui permet à `frontend/src/lib/api.js` de déballer `data` et de
// laisser tout le reste du frontend inchangé.
module.exports = function responseEnvelope(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    if (body && typeof body === 'object' && typeof body.success === 'boolean') {
      // Déjà enveloppé (ne devrait pas arriver) — évite un double-emballage.
      return originalJson(body);
    }

    const isError = res.statusCode >= 400;
    const message = (body && typeof body === 'object' && (body.error || body.message)) || (isError ? 'Erreur.' : '');

    return originalJson({
      success: !isError,
      message,
      data: body ?? null,
      errors: isError ? [message] : null,
    });
  };

  next();
};
