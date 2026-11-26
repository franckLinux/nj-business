// src/controllers/projets_demandes.controller.js — Gestion des activités simplifiée (083).
// Demandes de fonds, décaissement et reliquat (par la saisie de caisse), dépenses
// et pièces, rapport financier. Droits vérifiés par le service à chaque appel.
const svc = require('../services/projets_demandes.service');
const { ErreurProjet } = require('../services/projets.service');
const journalCtrl = require('./journal.controller');

const repondre = (res, err, nom) => {
  const e = svc.traduire(err);
  if (e instanceof ErreurProjet) return res.status(e.status).json({ error: e.message, code: e.code, ...(e.details ? { details: e.details } : {}) });
  console.error(`[Gestion des activités] ${nom} :`, err.message);
  return res.status(500).json({ error: 'Erreur serveur.' });
};
const traiter = (nom, fn, statut = 200) => async (req, res) => {
  try { res.status(statut).json(await fn(req)); } catch (err) { repondre(res, err, nom); }
};
// Saisie de caisse (POST /api/journal) pour la même personne, avec tous ses contrôles.
const creerMouvementPour = (req) => async (corps) => {
  const sousReq = Object.create(req);
  sousReq.body = corps;
  let status = 200; let data = null;
  const res = { status(c) { status = c; return this; }, json(d) { data = d; return this; }, setHeader() { return this; } };
  await journalCtrl.createMouvement(sousReq, res);
  return { status, data };
};
const envoyerFichier = (res, f) => {
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Content-Disposition', `inline; filename="${String(f.nom).replace(/[^\w.\- ()]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(f.nom)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
};

module.exports = {
  contexte:  traiter('contexte', (req) => svc.contexte(req)),
  lister:    traiter('liste des demandes', (req) => svc.lister(req)),
  lire:      traiter('demande', (req) => svc.lire(req, req.params.id)),
  creer:     traiter('création de demande', (req) => svc.creer(req), 201),
  modifier:  traiter('modification de demande', (req) => svc.modifier(req, req.params.id)),
  supprimer: traiter('suppression de demande', (req) => svc.supprimer(req, req.params.id)),
  soumettre: traiter('soumission de demande', (req) => svc.soumettre(req, req.params.id)),
  valider:   traiter('validation de demande', (req) => svc.valider(req, req.params.id)),
  renvoyer:  traiter('renvoi de demande', (req) => svc.renvoyer(req, req.params.id)),
  rejeter:   traiter('rejet de demande', (req) => svc.rejeter(req, req.params.id)),
  annuler:   traiter('annulation de demande', (req) => svc.annuler(req, req.params.id)),
  decaisser: traiter('décaissement', (req) => svc.decaisser(req, req.params.id, { creerMouvement: creerMouvementPour(req) }), 201),
  reverser:  traiter('reliquat', (req) => svc.reverser(req, req.params.id, { creerMouvement: creerMouvementPour(req) }), 201),
  solliciter: traiter('sollicitation de la demande de fonds', (req) => svc.solliciter(req, req.params.id), 201),
  declarer:  traiter('déclaration de dépense', (req) => svc.declarer(req, req.params.id), 201),
  depenses:  traiter('liste des dépenses', (req) => svc.listerDepenses(req)),
  retirerDepense: traiter('retrait de dépense', (req) => svc.retirerDepense(req, req.params.id)),
  controler: traiter('contrôle de dépense', (req) => svc.controler(req, req.params.id)),
  rapport:   traiter('rapport financier', (req) => svc.rapport(req)),
  fichierDepense: async (req, res) => {
    try {
      const f = await svc.fichierDepense(req, req.params.id);
      envoyerFichier(res, f);
      require('fs').createReadStream(f.chemin)
        .on('error', (e) => { console.error('[Gestion des activités] pièce :', e.message); if (!res.headersSent) res.status(500).end(); else res.destroy(); })
        .pipe(res);
    } catch (err) { repondre(res, err, 'pièce de dépense'); }
  },
  rapportPdf: async (req, res) => {
    try {
      const f = await svc.rapportPdf(req);
      envoyerFichier(res, { ...f, mime: 'application/pdf' });
      res.end(f.contenu);
    } catch (err) { repondre(res, err, 'rapport financier PDF'); }
  },
};
