// src/controllers/plan_modele.controller.js
// Administration du modèle global de plan comptable (réforme, étape 6).
// Toutes les routes sont réservées au super_admin (routes/index.js).
const svc = require('../services/plan_modele.service');
const synchro = require('../services/plan_synchro.service');

const repondre = (ctx, fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    if (err instanceof svc.ErreurMetier || err instanceof synchro.ErreurMetier) {
      return res.status(err.status).json({ error: err.message });
    }
    if (err.name === 'SequelizeUniqueConstraintError' || err.parent?.code === '23505') {
      return res.status(409).json({ error: 'Ce numéro de compte existe déjà dans le modèle.' });
    }
    console.error(`[PlanModele] ${ctx} :`, err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

const idParam = (req) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(id) || id <= 0) throw new svc.ErreurMetier(400, 'Identifiant de compte invalide.');
  return id;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tenantParam = (req) => {
  if (!UUID_RE.test(String(req.params.tenantId || ''))) throw new synchro.ErreurMetier(400, 'Identifiant client invalide.');
  return req.params.tenantId;
};
const versionParam = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number.parseInt(v, 10);
  if (!Number.isSafeInteger(n) || n <= 0) throw new synchro.ErreurMetier(400, 'Version invalide.');
  return n;
};

module.exports = {
  // Synchronisation modèle → clients (étape 7)
  getSynchroClients:   repondre('synchro.clients',    () => synchro.listerClients()),
  getSynchroApercu:    repondre('synchro.apercu',     (req) => synchro.apercu(tenantParam(req), versionParam(req.query.version))),
  postSynchroAppliquer: repondre('synchro.appliquer', (req) => synchro.appliquer({
    tenantId: tenantParam(req), versionId: versionParam(req.body.version_id), cles: req.body.cles, userId: req.user.id,
  })),
  getSynchroHistorique: repondre('synchro.historique', (req) => synchro.historique(
    req.query.tenant && UUID_RE.test(req.query.tenant) ? req.query.tenant : null)),

  getVersions:   repondre('versions',   () => svc.listerVersions()),
  getComptes:    repondre('comptes',    () => svc.listerComptes()),
  getApercu:     repondre('apercu',     () => svc.apercu()),
  createCompte:  repondre('create',     (req) => svc.ajouterCompte({ userId: req.user.id, ...req.body })),
  updateCompte:  repondre('update',     (req) => svc.modifierCompte({ userId: req.user.id, id: idParam(req), champs: req.body })),
  updateStatut:  repondre('statut',     (req) => svc.changerStatut({ userId: req.user.id, id: idParam(req), statut: req.body.statut })),
  getHistorique: repondre('historique', (req) => svc.historiqueCompte(idParam(req))),
  publier:       repondre('publier',    (req) => svc.publier({ userId: req.user.id, libelle: req.body.libelle, notes: req.body.notes })),
};
