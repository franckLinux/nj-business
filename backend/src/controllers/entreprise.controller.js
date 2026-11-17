// src/controllers/entreprise.controller.js — configuration centrale de l'entreprise (064).
// Routes du SOCLE : jamais bloquées par l'activation d'un module.
const svc = require('../services/entreprise.service');

const repondre = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    if (err instanceof svc.ErreurEntreprise) return res.status(err.status).json({ error: err.message });
    console.error('[Entreprise]', req.method, req.originalUrl, ':', err.message);
    res.status(500).json({ error: 'Erreur serveur : la configuration de l\'entreprise n\'a pas pu être traitée.' });
  }
};
const ctx = (req) => ({ tenantId: req.tenantId, userId: req.user.id, body: req.body || {} });

module.exports = {
  lire: repondre((req) => svc.lire(req.tenantId)),
  modifier: repondre((req) => svc.modifier(ctx(req))),
  definirLogo: repondre((req) => svc.definirLogo({ ...ctx(req), logo: req.body?.logo })),
  supprimerLogo: repondre((req) => svc.definirLogo({ ...ctx(req), logo: null })),
  modifierRepresentant: repondre((req) => svc.modifierRepresentant(ctx(req))),
  changerRepresentant: repondre((req) => svc.changerRepresentant(ctx(req))),
};
