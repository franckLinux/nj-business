// src/controllers/prospects.controller.js — prospects et démonstrations.
const crypto = require('crypto');
const svc = require('../services/prospects.service');
const com = require('../services/commercial.service');
const pipe = require('../services/pipeline.service');
const val = require('../services/validation-demo.service');
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

// Contexte tracé dans le journal des validations (jamais le code).
const contexte = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') || '' });
const idCode = (req) => {
  const id = parseInt(req.params.codeId, 10);
  if (!(id > 0)) throw new svc.ErreurMetier(400, 'Identifiant de code invalide.');
  return id;
};

// Accès : super_admin, ou membre du cabinet titulaire de « prospects.gerer ».
const requireProspects = async (req, res, next) => {
  try {
    if (req.user.role === 'super_admin') return next();
    if ((isCabinet(req.user) || (req.user.role === 'commercial' && !req.user.tenantId))
      && await userHasPermission({ tenantId: null, userId: req.user.id, role: req.user.role }, 'prospects.gerer')) return next();
    res.status(403).json({ error: 'Accès refusé : permission « Gérer les prospects » requise.' });
  } catch (err) {
    console.error('[Prospects] accès :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// Périmètre d'un commercial : uniquement ses prospects (404 sinon).
const scopeProspect = async (req, res, next) => {
  try {
    if (req.params.id) await pipe.verifierPerimetre(req.user, uuid(req.params.id));
    next();
  } catch (err) {
    if (err instanceof svc.ErreurMetier) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};
// Réservé à la Direction (super_admin, comptable cabinet) : conversion, etc.
const requireDirection = (req, res, next) => (pipe.estDirection(req.user)
  ? next() : res.status(403).json({ error: 'Action réservée à la Direction.' }));

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
  requireProspects, scopeProspect, requireDirection,
  // MyNjBusiness
  pipeline:      repondre('pipeline', (req) => pipe.vue({ user: req.user, recherche: req.query.recherche, commercial: req.query.commercial, filtre: req.query.filtre })),
  pipelineFiche: repondre('pipeline.fiche', (req) => pipe.fiche({ user: req.user, id: uuid(req.params.id) })),
  pipelineAction: repondre('pipeline.action', (req) => pipe.agir({
    user: req.user, id: uuid(req.params.id), type: req.body.type, note: req.body.note,
    prochaineAction: req.body.prochaine_action, prochaineActionLe: req.body.prochaine_action_le, commercialId: req.body.commercial_id,
  })),
  requireTacheToken,
  lister:     repondre('liste',   (req) => svc.lister({ ...req.query, commercialId: req.user.role === 'commercial' ? req.user.id : null })),
  detail:     repondre('détail',  (req) => svc.detail(uuid(req.params.id))),
  creer:      repondre('création', (req) => svc.creer({
    donnees: req.body || {}, userId: req.user.id,
    // Le commercial devient responsable de ce qu'il crée ; la Direction peut attribuer.
    commercialId: req.user.role === 'commercial' ? req.user.id : (req.body.commercial_id || null),
  }), 201),
  modifier:   repondre('modif',   (req) => svc.modifier({ id: uuid(req.params.id), donnees: req.body || {}, userId: req.user.id })),
  inviter:    repondre('invitation', async (req) => {
    const id = uuid(req.params.id);
    const avant = await svc.charger(id);
    const r = await svc.inviter({ id, userId: req.user.id });
    // Acceptation « classique » d'une demande du formulaire web : tracée dans
    // le journal des validations (à côté des validations directes par code).
    if (!avant.tenant_id && avant.demande_web_le) {
      await val.tracerValidationClassique({ prospectId: id, user: req.user,
        libelle: `${avant.entreprise || avant.nom_complet || ''}${avant.email ? ` <${avant.email}>` : ''}`, ctx: contexte(req) });
    }
    return r;
  }),
  apercu:     repondre('aperçu',  (req) => svc.apercuEmail({ nom: req.query.nom, debut: req.query.debut, fin: req.query.fin })),
  prolonger:  repondre('prolongation', (req) => {
    if (req.body.confirmation !== true) throw new svc.ErreurMetier(400, 'Confirmation requise pour prolonger.');
    return svc.prolonger({ id: uuid(req.params.id), nouvelleFin: req.body.nouvelle_fin, motif: req.body.motif, userId: req.user.id });
  }),
  supprimer:  repondre('suppression', (req) => svc.supprimer({ id: uuid(req.params.id), motif: req.body?.motif, user: req.user })),
  statut:     repondre('statut',  (req) => svc.changerStatut({ id: uuid(req.params.id), statut: req.body.statut, motif: req.body.motif, userId: req.user.id })),
  // Public (lien reçu par e-mail)
  verifierActivation: repondre('activation.verif', (req) => svc.verifierActivation(req.params.token)),
  activer:    repondre('activation', (req) => svc.activer({ jeton: req.params.token, motDePasse: req.body.mot_de_passe })),
  taches:     repondre('tâches', async () => {
    const bilan = await svc.tachesQuotidiennes();
    const { echus, bientot } = await com.abonnementsEchus();
    bilan.abonnements_echus = echus.length;
    bilan.abonnements_j15 = bientot.length;
    if (echus.length || bientot.length) {
      bilan.notification_abonnements = await svc.notifierCabinet('Abonnements clients à renouveler', [
        ...echus.map((a) => `ÉCHU : ${a.client} — ${a.forfait_nom}, fin le ${new Date(a.date_fin).toLocaleDateString('fr-FR')}`),
        ...bientot.map((a) => `Dans 15 jours : ${a.client} — ${a.forfait_nom}, fin le ${new Date(a.date_fin).toLocaleDateString('fr-FR')}`),
      ]);
    }
    return bilan;
  }),
  // Public : page « Demander une démo »
  demandeWeb: repondre('demande web', (req) => svc.demandeWeb(req.body || {}), 201),
  // Public : même formulaire, validé sur place par un commercial avec son code.
  demandeWebValidee: repondre('demande web validée', (req) => val.validerDemandeAvecCode({
    corps: req.body || {}, identifiant: req.body?.identifiant, code: req.body?.validationCode, ctx: contexte(req) })),
  // Super Admin : codes de validation directe et permission associée
  vdLister:      repondre('vd.liste', (req) => val.lister({ user: req.user })),
  vdPermission:  repondre('vd.permission', (req) => val.definirPermission({ user: req.user, userId: uuid(req.params.userId), autorise: req.body?.autorise === true })),
  vdCode:        repondre('vd.code', (req) => val.definirCode({ user: req.user, userId: uuid(req.params.userId), code: req.body?.code,
    expireLe: req.body?.expire_le, limite: req.body?.limite_utilisations }), 201),
  vdModifier:    repondre('vd.modif', (req) => val.modifierCode({ user: req.user, codeId: idCode(req), actif: req.body?.actif,
    expireLe: req.body?.expire_le, limite: req.body?.limite_utilisations })),
  vdRevoquer:    repondre('vd.revocation', (req) => val.revoquerCode({ user: req.user, codeId: idCode(req) })),
  vdDebloquer:   repondre('vd.deblocage', (req) => val.debloquerCode({ user: req.user, codeId: idCode(req) })),
  vdHistorique:  repondre('vd.historique', (req) => val.historique({ user: req.user,
    userId: req.query.user_id && UUID_RE.test(req.query.user_id) ? req.query.user_id : null, resultat: req.query.resultat, limite: req.query.limite })),
  // Étape 4 : forfaits, paiements, conversion
  forfaits:      repondre('forfaits', (req) => com.listerForfaits({ tous: req.query.tous === '1' && req.user.role === 'super_admin' })),
  creerForfait:  repondre('forfait.création', (req) => com.creerForfait({ donnees: req.body || {}, userId: req.user.id }), 201),
  modifierForfait: repondre('forfait.modif', (req) => {
    const id = parseInt(req.params.id, 10);
    if (!(id > 0)) throw new svc.ErreurMetier(400, 'Identifiant de forfait invalide.');
    return com.modifierForfait({ id, donnees: req.body || {}, userId: req.user.id });
  }),
  paiement:      repondre('paiement', (req) => com.enregistrerPaiement({ prospectId: uuid(req.params.id), donnees: req.body || {}, userId: req.user.id }), 201),
  statutPaiement: repondre('paiement.statut', (req) => {
    if (!UUID_RE.test(req.params.paiementId)) throw new svc.ErreurMetier(400, 'Identifiant de paiement invalide.');
    if (!pipe.estDirection(req.user)) throw new svc.ErreurMetier(403, 'Confirmation des paiements réservée à la Direction.');
    return com.changerStatutPaiement({ id: req.params.paiementId, statut: req.body.statut, motif: req.body.motif, userId: req.user.id });
  }),
  convertir:     repondre('conversion', (req) => {
    if (req.body.confirmation !== true) throw new svc.ErreurMetier(400, 'Confirmation requise pour la conversion.');
    return com.convertir({ id: uuid(req.params.id), donnees: req.body || {}, userId: req.user.id });
  }),
};
