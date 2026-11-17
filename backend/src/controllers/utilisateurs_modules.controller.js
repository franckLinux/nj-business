// src/controllers/utilisateurs_modules.controller.js — utilisateurs par module (066).
const svc = require('../services/utilisateurs_modules.service');

const repondre = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    if (err instanceof svc.ErreurUM) return res.status(err.status).json({ error: err.message });
    console.error('[Modules/utilisateurs]', req.method, req.originalUrl, ':', err.message);
    res.status(500).json({ error: 'Erreur serveur : l\'opération sur les utilisateurs du module n\'a pas abouti.' });
  }
};
const base = (req) => ({ tenantId: req.tenantId, code: req.params.code, par: req.user.id });

module.exports = {
  lister: repondre((req) => svc.lister(req.tenantId, req.params.code)),
  affecter: repondre(async (req) => {
    await svc.affecter({ ...base(req), cibleId: req.body?.user_id, roleId: req.body?.role_id ?? null });
    return svc.lister(req.tenantId, req.params.code);
  }),
  modifierProfil: repondre(async (req) => {
    await svc.modifierProfil({ ...base(req), cibleId: req.params.userId, roleId: req.body?.role_id ?? null });
    return svc.lister(req.tenantId, req.params.code);
  }),
  retirer: repondre(async (req) => {
    await svc.retirer({ ...base(req), cibleId: req.params.userId, motif: req.body?.motif });
    return svc.lister(req.tenantId, req.params.code);
  }),
  // Plateforme (super_admin)
  rapport: repondre(() => svc.rapport()),
  definirMode: repondre((req) => svc.definirMode({ mode: req.body?.mode, par: req.user.id })),
  reprendre: repondre(async (req) => {
    const r = await svc.reprendre({ par: req.user.id, origine: 'manuel' });
    return { reprise: r, rapport: await svc.rapport() };
  }),
};
