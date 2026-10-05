// src/controllers/prospects.controller.js — prospects et démonstrations.
const crypto = require('crypto');
const svc = require('../services/prospects.service');
const { isCabinet } = require('../middleware/auth');
const { userHasPermission } = require('../services/permission.service');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v) => {
  if (!UUID_RE.test(String(v || ''))) throw new svc.ErreurMetier(400, 'Identifiant prospect invalide.');
  return v;
};
const repondre = (ctx, fn, statut = 200) => async (req, res) => {
  try {
    res.status(statut).json(await fn(req));
  } catch (err) {
    if (err instanceof svc.ErreurMetier) {
      return res.status(err.status).json({ error: err.message, ...(err.existing_id ? { existing_id: err.existing_id } : {}) });
    }
    console.error(`[Prospects] ${ctx} :`, err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// Accès : super_admin, ou membre du cabinet titulaire de « prospects.gerer ».
const requireProspects = async (req, res, next) => {
  try {
    if (req.user.role === 'super_admin') return next();
    if (isCabinet(req.user)
      && await userHasPermission({ tenantId: null, userId: req.user.id, role: req.user.role }, 'prospects.gerer')) return next();
    res.status(403).json({ error: 'Accès refusé : permission « Gérer les prospects » requise.' });
  } catch (err) {
    console.error('[Prospects] accès :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// Tâche planifiée : protégée par un jeton dédié (TACHES_TOKEN). Sans jeton
// configuré, la route n'existe pas (404).
const requireTacheToken = (req, res, next) => {
  const attendu = process.env.TACHES_TOKEN || '';
  const fourni = String(req.get('X-Taches-Token') || req.query.token || '');
  const ok = attendu.length >= 24 && fourni.length === attendu.length
    && crypto.timingSafeEqual(Buffer.from(fourni), Buffer.from(attendu));
  if (!ok) return res.status(404).json({ error: 'Route API inconnue.' });
  next();
};

module.exports = {
  requireProspects,
  requireTacheToken,
  lister:     repondre('liste',   (req) => svc.lister(req.query)),
  detail:     repondre('détail',  (req) => svc.detail(uuid(req.params.id))),
  creer:      repondre('création', (req) => svc.creer({ donnees: req.body || {}, userId: req.user.id }), 201),
  modifier:   repondre('modif',   (req) => svc.modifier({ id: uuid(req.params.id), donnees: req.body || {}, userId: req.user.id })),
  inviter:    repondre('invitation', (req) => svc.inviter({ id: uuid(req.params.id), userId: req.user.id })),
  apercu:     repondre('aperçu',  (req) => svc.apercuEmail({ nom: req.query.nom, debut: req.query.debut, fin: req.query.fin })),
  prolonger:  repondre('prolongation', (req) => {
    if (req.body.confirmation !== true) throw new svc.ErreurMetier(400, 'Confirmation requise pour prolonger.');
    return svc.prolonger({ id: uuid(req.params.id), nouvelleFin: req.body.nouvelle_fin, motif: req.body.motif, userId: req.user.id });
  }),
  statut:     repondre('statut',  (req) => svc.changerStatut({ id: uuid(req.params.id), statut: req.body.statut, motif: req.body.motif, userId: req.user.id })),
  // Public (lien reçu par e-mail)
  verifierActivation: repondre('activation.verif', (req) => svc.verifierActivation(req.params.token)),
  activer:    repondre('activation', (req) => svc.activer({ jeton: req.params.token, motDePasse: req.body.mot_de_passe })),
  taches:     repondre('tâches', () => svc.tachesQuotidiennes()),
};
