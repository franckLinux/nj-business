'use strict';
// NJ FINANCE — Missions (087). Droits vérifiés par le service à chaque appel.
const svc = require('../services/finance/missions.service');
const { ErreurProjet } = require('../services/projets.service');
const journalCtrl = require('./journal.controller');

const repondre = (res, err, nom) => {
  const e = svc.traduire(err);
  if (e instanceof ErreurProjet) return res.status(e.status).json({ error: e.message, code: e.code });
  console.error(`[Missions] ${nom} :`, err.message);
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
const envoyer = (res, f) => {
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Content-Disposition', `inline; filename="${String(f.nom).replace(/[^\w.\- ()]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(f.nom)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
};

module.exports = {
  contexte:   traiter('contexte', (req) => svc.contexte(req)),
  lister:     traiter('liste', (req) => svc.lister(req)),
  compteurs:  traiter('compteurs', (req) => svc.compteurs(req)),
  lire:       traiter('mission', (req) => svc.lire(req, req.params.id)),
  creer:      traiter('création', (req) => svc.creer(req), 201),
  modifier:   traiter('modification', (req) => svc.modifier(req, req.params.id)),
  supprimer:  traiter('suppression', (req) => svc.supprimer(req, req.params.id)),
  soumettre:  traiter('envoi', (req) => svc.soumettre(req, req.params.id)),
  decider:    traiter('décision', (req) => svc.decider(req, req.params.id)),
  annuler:    traiter('annulation', (req) => svc.annuler(req, req.params.id)),
  declarer:   traiter('dépense', (req) => svc.declarer(req, req.params.id), 201),
  retirerDepense: traiter('retrait de dépense', (req) => svc.retirerDepense(req, req.params.id, req.params.depenseId)),
  rapport:    traiter('rapport', (req) => svc.enregistrerRapport(req, req.params.id)),
  justifier:  traiter('justification', (req) => svc.soumettreJustification(req, req.params.id)),
  controler:  traiter('contrôle', (req) => svc.controler(req, req.params.id)),
  cloturer:   traiter('clôture', (req) => svc.cloturer(req, req.params.id)),
  avance:     traiter('avance', (req) => svc.verserAvance(req, req.params.id, { creerMouvement: creerMouvementPour(req) }), 201),
  complement: traiter('complément', (req) => svc.payerComplement(req, req.params.id, { creerMouvement: creerMouvementPour(req) }), 201),
  reliquat:   traiter('reliquat', (req) => svc.reverserReliquat(req, req.params.id, { creerMouvement: creerMouvementPour(req) }), 201),
  parametres: traiter('paramètres', async (req) => svc.parametres(req.tenantId)),
  enregistrerParametres: traiter('paramètres', (req) => svc.enregistrerParametres(req)),
  piece: async (req, res) => {
    try {
      const f = await svc.fichierDepense(req, req.params.id, req.params.depenseId);
      envoyer(res, f);
      require('fs').createReadStream(f.chemin)
        .on('error', (e) => { console.error('[Missions] pièce :', e.message); if (!res.headersSent) res.status(500).end(); else res.destroy(); })
        .pipe(res);
    } catch (err) { repondre(res, err, 'pièce'); }
  },
  pdf: async (req, res) => {
    try {
      const f = await svc.ordrePdf(req, req.params.id);
      envoyer(res, { ...f, mime: 'application/pdf' });
      res.end(f.contenu);
    } catch (err) { repondre(res, err, 'ordre de mission'); }
  },
};
