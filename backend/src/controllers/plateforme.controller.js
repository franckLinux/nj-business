// src/controllers/plateforme.controller.js — administration plateforme (étape 8).
const svc = require('../services/plateforme.service');
const support = require('../services/support.service');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v) => {
  if (!UUID_RE.test(String(v || ''))) throw new svc.ErreurMetier(400, 'Identifiant client invalide.');
  return v;
};
const repondre = (ctx, fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    if (err instanceof svc.ErreurMetier) return res.status(err.status).json({ error: err.message });
    console.error(`[Plateforme] ${ctx} :`, err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = {
  getClients:   repondre('clients', () => svc.listerClients()),
  getClient:    repondre('client',  (req) => svc.detailClient(uuid(req.params.id))),
  putClient:    repondre('modif',   (req) => svc.modifierClient({ tenantId: uuid(req.params.id), userId: req.user.id, champs: req.body || {} })),
  patchActif:   repondre('actif',   (req) => svc.changerActif({ tenantId: uuid(req.params.id), userId: req.user.id, actif: req.body.actif, motif: req.body.motif })),
  getAudit:     repondre('audit',   (req) => svc.journalAudit(req.query.tenant && UUID_RE.test(req.query.tenant) ? req.query.tenant : null)),
  getSupport:   repondre('support', async (req) => ({ mode_limite: support.modeLimite(), sessions: await svc.mesSessions(req.user.id) })),
  postSupport:  repondre('support.ouvrir', (req) => svc.ouvrirSupport({
    tenantId: uuid(req.body.tenant_id), userId: req.user.id, motif: req.body.motif, dureeMinutes: req.body.duree_minutes,
  })),
  deleteSupport: repondre('support.fermer', (req) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!(id > 0)) throw new svc.ErreurMetier(400, 'Identifiant invalide.');
    return svc.fermerSupport({ id, userId: req.user.id });
  }),
};
