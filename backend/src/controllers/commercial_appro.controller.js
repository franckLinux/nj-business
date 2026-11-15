'use strict';
// NJ COMMERCIAL — lot 8 (migration 063) : consultations des fournisseurs, portail public de
// réponse, frais accessoires et coût réel, envoi des bons. Règles : services/commercial/*.
const fs = require('fs');
const da = require('../services/commercial/demandes.service');
const cons = require('../services/commercial/consultations.service');
const frais = require('../services/commercial/frais.service');
const bc = require('../services/commercial/bons.service');

const erreur = (res, quoi, err) => {
  if (Number.isInteger(err.status) && err.status >= 400 && err.status < 600) return res.status(err.status).json({ error: err.message });
  if (/INTANGIBLE/.test(err.message || '')) return res.status(409).json({ error: err.message.replace(/^.*?: /, '') });
  if (err?.original?.code === '23514' || err?.parent?.code === '23514') return res.status(400).json({ error: 'Donnée refusée par les règles de la base.' });
  if (err?.original?.code === '23505' || err?.parent?.code === '23505') return res.status(409).json({ error: 'Opération déjà faite (doublon refusé).' });
  console.error(`[Commercial] ${quoi} :`, err.message);
  return res.status(500).json({ error: 'Erreur serveur.' });
};
const repondre = (quoi, fn, statut = 200) => async (req, res) => {
  try {
    const ctx = await da.contexte(req);
    res.status(statut).json(await fn(ctx, req));
  } catch (err) { erreur(res, quoi, err); }
};
const pdf = (quoi, fn) => async (req, res) => {
  try {
    const ctx = await da.contexte(req);
    const f = await fn(ctx, req);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${f.nom}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(f.buffer);
  } catch (err) { erreur(res, quoi, err); }
};
const fichier = (quoi, fn) => async (req, res) => {
  try {
    const ctx = await da.contexte(req);
    const f = await fn(ctx, req);
    await fs.promises.access(f.chemin, fs.constants.R_OK).catch(() => { const e = new Error('Fichier introuvable sur le serveur.'); e.status = 410; throw e; });
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `inline; filename="${String(f.nom).replace(/[^\w.\- ()]/g, '_')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    fs.createReadStream(f.chemin).pipe(res);
  } catch (err) { erreur(res, quoi, err); }
};
// Public : aucune session ; adresse IP gardée pour la traçabilité des offres.
const publique = (quoi, fn) => async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await fn(req));
  } catch (err) { erreur(res, quoi, err); }
};

module.exports = {
  // Consultations
  getConsultations:   repondre('consultations', (ctx, req) => cons.lister(ctx, req.query)),
  getConsultation:    repondre('consultation', (ctx, req) => cons.lire(ctx, req.params.id)),
  postConsultation:   repondre('consultation.création', (ctx, req) => cons.creer(ctx, req.body || {}), 201),
  putConsultation:    repondre('consultation.modif', (ctx, req) => cons.modifier(ctx, req.params.id, req.body || {})),
  postLancement:      repondre('consultation.lancement', (ctx, req) => cons.lancer(ctx, req.params.id, req.body || {})),
  postEnvoiConsultation: repondre('consultation.envoi', (ctx, req) => cons.envoyer(ctx, req.params.id, req.params.cf, req.body || {})),
  postAjoutFournisseur: repondre('consultation.ajout', (ctx, req) => cons.ajouterFournisseur(ctx, req.params.id, req.body || {})),
  postReouverture:    repondre('consultation.réouverture', (ctx, req) => cons.rouvrir(ctx, req.params.id, req.params.cf, req.body || {})),
  postAnnulationConsultation: repondre('consultation.annulation', (ctx, req) => cons.annuler(ctx, req.params.id, req.body || {})),
  getComparatif:      repondre('consultation.comparatif', (ctx, req) => cons.comparatif(ctx, req.params.id)),
  postAttribution:    repondre('consultation.attribution', (ctx, req) => cons.attribuer(ctx, req.params.id, req.body || {})),
  getPdfConsultation: pdf('consultation.pdf', (ctx, req) => cons.lirePdf(ctx, req.params.id, req.params.cf)),
  getProformaOffre:   fichier('consultation.proforma', (ctx, req) => cons.lireProforma(ctx, req.params.id, req.params.offre)),
  // Portail fournisseur
  getOffrePublique:   publique('portail.lecture', (req) => cons.publicLire(req.params.jeton)),
  postOffrePublique:  publique('portail.offre', (req) => cons.publicSoumettre(req.params.jeton, req.body || {}, req.ip)),
  postRefusPublic:    publique('portail.refus', (req) => cons.publicRefuser(req.params.jeton, req.body || {})),
  getPdfPublic: async (req, res) => {
    try {
      const f = await cons.publicPdf(req.params.jeton);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${f.nom}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.end(f.buffer);
    } catch (err) { erreur(res, 'portail.pdf', err); }
  },
  // Frais accessoires
  getFrais:           repondre('frais', (ctx, req) => frais.lister(ctx, req.query)),
  getUnFrais:         repondre('frais.lecture', (ctx, req) => frais.lire(ctx, req.params.id)),
  postFrais:          repondre('frais.création', (ctx, req) => frais.creer(ctx, req.body || {}), 201),
  putFrais:           repondre('frais.modif', (ctx, req) => frais.modifier(ctx, req.params.id, req.body || {})),
  deleteFrais:        repondre('frais.suppression', (ctx, req) => frais.supprimer(ctx, req.params.id)),
  postValidationFrais: repondre('frais.validation', (ctx, req) => frais.valider(ctx, req.params.id)),
  postAnnulationFrais: repondre('frais.annulation', (ctx, req) => frais.annuler(ctx, req.params.id, req.body || {})),
  postApercuFrais:    repondre('frais.aperçu', (ctx, req) => frais.apercu(ctx, req.body || {})),
  postPieceFrais:     repondre('frais.pièce', (ctx, req) => frais.joindre(ctx, req.params.id, req.body || {}), 201),
  getPieceFrais:      fichier('frais.pièce', (ctx, req) => frais.lirePiece(ctx, req.params.id, req.params.doc)),
  getCoutsBon:        repondre('bon.coûts', (ctx, req) => frais.coutsBon(ctx, req.params.id)),
  // Bons de commande : envoi au fournisseur
  postEnvoiBon:       repondre('bon.envoi', (ctx, req) => bc.envoyer(ctx, req.params.id, req.body || {})),
};
