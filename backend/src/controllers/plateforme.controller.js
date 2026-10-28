// src/controllers/plateforme.controller.js — administration plateforme (étape 8).
const svc = require('../services/plateforme.service');
const support = require('../services/support.service');
const rolesClient = require('../services/roles_client.service');
const modules = require('../services/modules.service');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v) => {
  if (!UUID_RE.test(String(v || ''))) throw new svc.ErreurMetier(400, 'Identifiant client invalide.');
  return v;
};
const repondre = (ctx, fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    if (err instanceof svc.ErreurMetier || err instanceof rolesClient.ErreurMetier || err instanceof modules.ErreurMetier) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(`[Plateforme] ${ctx} :`, err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = {
  getClients:   repondre('clients', () => svc.listerClients()),
  getClient:    repondre('client',  (req) => svc.detailClient(uuid(req.params.id))),
  putClient:    repondre('modif',   (req) => svc.modifierClient({ tenantId: uuid(req.params.id), userId: req.user.id, champs: req.body || {} })),
  patchActif:   repondre('actif',   (req) => svc.changerActif({ tenantId: uuid(req.params.id), userId: req.user.id, actif: req.body.actif, motif: req.body.motif })),
  getSuppression:  repondre('suppression.bilan', (req) => svc.bilanSuppression(uuid(req.params.id))),
  postSuppression: repondre('suppression', (req) => svc.supprimerClient({
    tenantId: uuid(req.params.id), userId: req.user.id, confirmation: req.body?.confirmation, motif: req.body?.motif,
  })),
  getRoles:     repondre('roles',   (req) => rolesClient.lire(uuid(req.params.id))),
  putRoles:     repondre('roles.modif', (req) => rolesClient.definir({
    tenantId: uuid(req.params.id), userId: req.user.id, roles: req.body?.roles === undefined ? null : req.body.roles,
  })),
  // NJ BUSINESS (048) : activation des modules par client.
  getModules:       repondre('modules', () => modules.matrice()),
  getModulesClient: repondre('modules.client', (req) => modules.configurationClient(uuid(req.params.id))),
  putModuleClient:  repondre('modules.modif', (req) => {
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(String(req.params.code || ''))) throw new modules.ErreurMetier(400, 'Code module invalide.');
    return modules.definir({
      tenantId: uuid(req.params.id), code: req.params.code, userId: req.user.id,
      actif: req.body?.actif, motif: req.body?.motif,
    });
  }),
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
