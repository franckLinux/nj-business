// src/controllers/caisse_parametres.controller.js — paramètres propres à NJ CAISSE PRO (065).
const svc = require('../services/caisse_parametres.service');
const { ErreurReferentiel } = require('../services/plan_referentiel.service');

const repondre = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    if (err instanceof svc.ErreurCaisse || err instanceof ErreurReferentiel) return res.status(err.status).json({ error: err.message });
    console.error('[Caisse/paramètres]', req.method, req.originalUrl, ':', err.message);
    res.status(500).json({ error: 'Erreur serveur : les paramètres de la caisse n\'ont pas pu être traités.' });
  }
};

module.exports = {
  lire: repondre((req) => svc.lire(req.tenantId)),
  modifier: repondre((req) => svc.modifier({ tenantId: req.tenantId, userId: req.user.id, body: req.body || {} })),
  apercuPlan: repondre((req) => svc.apercuPlan(req.tenantId, req.query.referentiel)),
  choisirPlan: repondre((req) => svc.choisirPlan({ tenantId: req.tenantId, userId: req.user.id,
    referentiel: req.body?.referentiel, confirmer: req.body?.confirmer })),
};
