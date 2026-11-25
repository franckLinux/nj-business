'use strict';
// Contrôle comptable → « Arrêtés & inventaires » (migration 046).
// Règles : services/arretes_inventaires.service.js
const fs = require('fs');
const svc = require('../services/arretes_inventaires.service');
const generation = require('../services/comptabilite/generation_caisse.service');

const repondre = (res, err, quoi) => {
  if (err instanceof svc.ErreurArrete) {
    return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  }
  console.error(`[Arrêtés & inventaires] ${quoi} :`, err.message);
  return res.status(500).json({ error: 'Erreur serveur.' });
};
const ctx = (req) => ({ tenantId: req.tenantId, userId: req.user.id, body: req.body || {} });

// ── Arrêtés de caisse ──
// GET /api/controle/arrets?mois=&annee=
const getArrets = async (req, res) => {
  try { res.json(await svc.listerArrets(req.tenantId, req.query, req.user.id)); } catch (err) { repondre(res, err, 'liste des arrêtés'); }
};
const actionArret = (fn, quoi, message) => async (req, res) => {
  try {
    const ligne = await fn({ ...ctx(req), journalId: req.params.journalId });
    res.json({ message: message(ligne), ligne });
  } catch (err) { repondre(res, err, quoi); }
};
// PUT /api/controle/arrets/:journalId { mois, annee, solde_constate, observation }
const putArret = actionArret(svc.saisirArret, 'saisie', (l) => `Contrôle de l'arrêté ${l.journal_code} enregistré.`);
// POST /api/controle/arrets/:journalId/pv { mois, annee, nom_fichier, data_base64 }
const postPvArret = actionArret(svc.deposerPvArret, 'dépôt du PV', (l) => `PV joint à l'arrêté ${l.journal_code}.`);
// POST /api/controle/arrets/:journalId/validation { mois, annee, solde_constate?, observation? }
// NJ FINANCE (077) : l'arrêté validé rend définitives les écritures de caisse du
// mois. Si la comptabilisation échoue, l'arrêté reste validé ; la réponse le dit
// et la page « Écritures de caisse » de NJ COMPTABILITÉ montre les anomalies.
const postValidationArret = async (req, res) => {
  let ligne;
  try {
    ligne = await svc.validerArret({ ...ctx(req), journalId: req.params.journalId });
  } catch (err) { return repondre(res, err, 'validation'); }
  let comptabilite;
  try {
    const r = await generation.synchroniser({ tenantId: req.tenantId, userId: req.user.id, force: true });
    comptabilite = { validees: r.validees || 0, anomalies: (r.anomalies || []).length };
  } catch (err) {
    console.error('[Arrêtés & inventaires] comptabilisation après validation :', err.message);
    comptabilite = { erreur: 'Les écritures de caisse n\'ont pas pu être mises à jour : voyez NJ COMPTABILITÉ → Écritures de caisse.' };
  }
  const suite = comptabilite.erreur ? ` ${comptabilite.erreur}`
    : (comptabilite.anomalies ? ` ${comptabilite.anomalies} mouvement(s) restent à comptabiliser (comptes à compléter).` : '');
  return res.json({ message: `Arrêté ${ligne.journal_code} validé.${suite}`, ligne, comptabilite });
};
// POST /api/controle/arrets/:journalId/annulation { mois, annee, motif }
const postAnnulationArret = actionArret(svc.annulerValidationArret, 'annulation', (l) => `Validation de l'arrêté ${l.journal_code} annulée.`);

// ── Inventaires ──
// GET /api/controle/inventaires?annee=
const getInventaires = async (req, res) => {
  try { res.json(await svc.listerInventaires(req.tenantId, req.query)); } catch (err) { repondre(res, err, 'liste des inventaires'); }
};
// GET /api/controle/inventaires/:id
const getInventaire = async (req, res) => {
  try { res.json(await svc.lireInventaire(req.tenantId, req.params.id)); } catch (err) { repondre(res, err, 'inventaire'); }
};
const actionInv = (fn, quoi, message, statut = 200) => async (req, res) => {
  try {
    const inv = await fn({ ...ctx(req), id: req.params.id });
    res.status(statut).json({ message: message(inv), inventaire: inv });
  } catch (err) { repondre(res, err, quoi); }
};
const dateFr = (d) => String(d || '').split('-').reverse().join('/');
// POST /api/controle/inventaires { date_inventaire, libelle, journal_ids? }
const postInventaire = actionInv(svc.creerInventaire, 'création', (i) => `Inventaire du ${dateFr(i.date_inventaire)} créé.`, 201);
// PUT /api/controle/inventaires/:id
const putInventaire = actionInv(svc.modifierInventaire, 'modification', () => 'Inventaire enregistré.');
// POST /api/controle/inventaires/:id/pv { nom_fichier, data_base64 }
const postPvInventaire = actionInv(svc.deposerPvInventaire, 'dépôt du PV', () => 'PV d\'inventaire joint.');
// POST /api/controle/inventaires/:id/validation
const postValidationInventaire = actionInv(svc.validerInventaire, 'validation', (i) => `Inventaire du ${dateFr(i.date_inventaire)} validé.`);
// POST /api/controle/inventaires/:id/reouverture { motif }
const postReouvertureInventaire = actionInv(svc.rouvrirInventaire, 'réouverture', () => 'Inventaire rouvert.');
// DELETE /api/controle/inventaires/:id
const deleteInventaire = async (req, res) => {
  try { await svc.supprimerInventaire({ ...ctx(req), id: req.params.id }); res.json({ message: 'Inventaire supprimé.' }); } catch (err) { repondre(res, err, 'suppression'); }
};

// ── PV : téléchargement authentifié (jamais par /uploads) ──
// GET /api/controle/pv/:objet/:id   (objet = arret | inventaire)
const getPv = async (req, res) => {
  try {
    const f = await svc.lirePv(req.tenantId, req.params.objet, req.params.id);
    await fs.promises.access(f.chemin, fs.constants.R_OK).catch(() => {
      throw new svc.ErreurArrete(410, 'Le fichier du PV est introuvable sur le serveur (dossier PV_DIR). Redéposez-le.');
    });
    const nom = String(f.nom || 'pv').replace(/[^\w.\- ()À-ÿ]/g, '_');
    res.setHeader('Content-Type', f.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${nom.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(f.nom || 'pv')}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    if (f.sha256) res.setHeader('X-PV-SHA256', f.sha256);
    fs.createReadStream(f.chemin).on('error', (e) => { console.error('[PV] lecture :', e.message); if (!res.headersSent) res.status(500).end(); else res.destroy(); }).pipe(res);
  } catch (err) { repondre(res, err, 'PV'); }
};

module.exports = {
  getArrets, putArret, postPvArret, postValidationArret, postAnnulationArret,
  getInventaires, getInventaire, postInventaire, putInventaire, postPvInventaire,
  postValidationInventaire, postReouvertureInventaire, deleteInventaire, getPv,
};
