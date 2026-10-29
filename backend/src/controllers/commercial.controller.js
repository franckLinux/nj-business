'use strict';
// NJ COMMERCIAL — contrôleur du paramétrage (livraison A). Règles : services/commercial/referentiel.service.js
const svc = require('../services/commercial/referentiel.service');
const { userHasPermission } = require('../services/permission.service');

const repondre = (quoi, fn, statut = 200) => async (req, res) => {
  try {
    res.status(statut).json(await fn(req));
  } catch (err) {
    if (err instanceof svc.ErreurCom) return res.status(err.status).json({ error: err.message });
    if (err?.original?.code === '23514' || err?.parent?.code === '23514') {
      return res.status(400).json({ error: 'Donnée refusée par les règles de la base (valeur hors limites ou référence d\'un autre client).' });
    }
    console.error(`[Commercial] ${quoi} :`, err.message);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
};

const ctx = (req) => ({ tenantId: req.tenantId, userId: req.user.id });
const peut = (req, code) => userHasPermission({ tenantId: req.tenantId, userId: req.user.id, role: req.user.role }, code);

module.exports = {
  getSociete:   repondre('société', (req) => svc.lireSociete(req.tenantId)),
  putSociete:   repondre('société.modif', (req) => svc.modifierSociete({ ...ctx(req), body: req.body || {} })),

  getMagasins:  repondre('magasins', (req) => svc.listerMagasins(req.tenantId, req.query)),
  postMagasin:  repondre('magasin.création', (req) => svc.enregistrerMagasin({ ...ctx(req), body: req.body || {} }), 201),
  putMagasin:   repondre('magasin.modif', (req) => svc.enregistrerMagasin({ ...ctx(req), id: req.params.id, body: req.body || {} })),

  getFamilles:  repondre('familles', (req) => svc.listerFamilles(req.tenantId, req.query)),
  postFamille:  repondre('famille.création', (req) => svc.enregistrerFamille({ ...ctx(req), body: req.body || {} }), 201),
  putFamille:   repondre('famille.modif', (req) => svc.enregistrerFamille({ ...ctx(req), id: req.params.id, body: req.body || {} })),

  getTaxes:     repondre('taxes', (req) => svc.listerTaxes(req.tenantId, req.query)),
  postTaxe:     repondre('taxe.création', (req) => svc.enregistrerTaxe({ ...ctx(req), body: req.body || {} }), 201),
  putTaxe:      repondre('taxe.modif', (req) => svc.enregistrerTaxe({ ...ctx(req), id: req.params.id, body: req.body || {} })),

  getTiers:     repondre('tiers', async (req) => svc.listerTiers(req.tenantId, { ...req.query, avecBanque: await peut(req, 'com.tiers.banque') })),
  postTiers:    repondre('tiers.création', async (req) => svc.enregistrerTiers({ ...ctx(req), body: req.body || {}, peutBanque: await peut(req, 'com.tiers.banque') }), 201),
  putTiers:     repondre('tiers.modif', async (req) => svc.enregistrerTiers({ ...ctx(req), id: req.params.id, body: req.body || {}, peutBanque: await peut(req, 'com.tiers.banque') })),

  getArticles:  repondre('articles', (req) => svc.listerArticles(req.tenantId, req.query)),
  getArticle:   repondre('article', (req) => svc.lireArticle(req.tenantId, req.params.id)),
  postArticle:  repondre('article.création', (req) => svc.enregistrerArticle({ ...ctx(req), body: req.body || {} }), 201),
  putArticle:   repondre('article.modif', (req) => svc.enregistrerArticle({ ...ctx(req), id: req.params.id, body: req.body || {} })),
  deleteArticle: repondre('article.suppression', (req) => svc.supprimerArticle({ ...ctx(req), id: req.params.id })),

  getStock:     repondre('stock', (req) => svc.consulterStock(req.tenantId, req.query)),
  putStockInitial: repondre('stock.initial', (req) => svc.enregistrerStockInitial({ ...ctx(req), body: req.body || {} })),

  getUtilisateurs: repondre('utilisateurs', (req) => svc.utilisateurs(req.tenantId)),
};

// ── Livraison B : demandes d'achat et autorisations (services/commercial/demandes.service.js) ──
const fs = require('fs');
const da = require('../services/commercial/demandes.service');
const { ErreurDocument } = require('../services/commercial/documents.service');
const repondreDa = (quoi, fn, statut = 200) => async (req, res) => {
  try {
    const ctx = await da.contexte(req);
    res.status(statut).json(await fn(ctx, req));
  } catch (err) {
    if (err instanceof da.ErreurDemande || err instanceof ErreurDocument || err instanceof svc.ErreurCom) return res.status(err.status).json({ error: err.message });
    if (/INTANGIBLE/.test(err.message || '')) return res.status(409).json({ error: err.message.replace(/^.*?: /, '') });
    if (err?.original?.code === '23514' || err?.parent?.code === '23514') return res.status(400).json({ error: 'Donnée refusée par les règles de la base.' });
    console.error(`[Commercial] ${quoi} :`, err.message);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
};
Object.assign(module.exports, {
  getDemandes:    repondreDa('demandes', (ctx, req) => da.lister(ctx, req.query)),
  getCompteurs:   repondreDa('compteurs', (ctx) => da.compteurs(ctx)),
  getDemande:     repondreDa('demande', (ctx, req) => da.lire(ctx, req.params.id)),
  postDemande:    repondreDa('demande.création', (ctx, req) => da.creer(ctx, req.body || {}), 201),
  putDemande:     repondreDa('demande.modif', (ctx, req) => da.modifier(ctx, req.params.id, req.body || {})),
  deleteDemande:  repondreDa('demande.suppression', (ctx, req) => da.supprimer(ctx, req.params.id)),
  postSoumission: repondreDa('demande.soumission', (ctx, req) => da.soumettre(ctx, req.params.id, req.body || {})),
  postDecision:   repondreDa('demande.décision', (ctx, req) => da.decider(ctx, req.params.id, req.body || {})),
  postAnnulation: repondreDa('demande.annulation', (ctx, req) => da.annuler(ctx, req.params.id, req.body || {})),
  postPiece:      repondreDa('demande.pièce', (ctx, req) => da.joindre(ctx, req.params.id, req.body || {}), 201),
  postRetraitPiece: repondreDa('demande.pièce.retrait', (ctx, req) => da.retirerPiece(ctx, req.params.id, req.params.doc, req.body || {})),
  // Téléchargement authentifié (jamais par /uploads).
  getPiece: async (req, res) => {
    try {
      const ctx = await da.contexte(req);
      const f = await da.lirePiece(ctx, req.params.id, req.params.doc);
      await fs.promises.access(f.chemin, fs.constants.R_OK).catch(() => { throw new da.ErreurDemande(410, 'Fichier introuvable sur le serveur.'); });
      res.setHeader('Content-Type', f.mime);
      res.setHeader('Content-Disposition', `inline; filename="${String(f.nom).replace(/[^\w.\- ()]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(f.nom)}`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Piece-SHA256', f.sha256);
      fs.createReadStream(f.chemin).on('error', () => { if (!res.headersSent) res.status(500).end(); else res.destroy(); }).pipe(res);
    } catch (err) {
      if (err instanceof da.ErreurDemande) return res.status(err.status).json({ error: err.message });
      console.error('[Commercial] pièce :', err.message);
      return res.status(500).json({ error: 'Erreur serveur.' });
    }
  },
});

// ── Livraison C : bons de commande, vérification, tableau de bord ──────────
const bc = require('../services/commercial/bons.service');
const tb = require('../services/commercial/tableau.service');
const repondreBc = (quoi, fn, statut = 200) => async (req, res) => {
  try {
    const ctx = await da.contexte(req);
    res.status(statut).json(await fn(ctx, req));
  } catch (err) {
    if (err instanceof bc.ErreurBon || err instanceof tb.ErreurTableau || err instanceof ErreurDocument || err instanceof da.ErreurDemande) {
      return res.status(err.status).json({ error: err.message });
    }
    if (/INTANGIBLE/.test(err.message || '')) return res.status(409).json({ error: err.message.replace(/^.*?: /, '') });
    if (err?.original?.code === '23514' || err?.parent?.code === '23514') return res.status(400).json({ error: 'Donnée refusée par les règles de la base.' });
    console.error(`[Commercial] ${quoi} :`, err.message);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
};
const envoyerFichier = async (res, f, mime) => {
  await fs.promises.access(f.chemin, fs.constants.R_OK).catch(() => { throw new bc.ErreurBon(410, 'Fichier introuvable sur le serveur.'); });
  res.setHeader('Content-Type', mime || f.mime);
  res.setHeader('Content-Disposition', `inline; filename="${String(f.nom).replace(/[^\w.\- ()]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(f.nom)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  if (f.sha256) res.setHeader('X-Document-SHA256', f.sha256);
  fs.createReadStream(f.chemin).on('error', () => { if (!res.headersSent) res.status(500).end(); else res.destroy(); }).pipe(res);
};
const fichierBc = (lire) => async (req, res) => {
  try {
    const ctx = await da.contexte(req);
    const f = await lire(ctx, req);
    if (f.contenu) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${f.nom}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      return res.end(f.contenu);
    }
    return await envoyerFichier(res, f, f.mime || 'application/pdf');
  } catch (err) {
    if (err instanceof bc.ErreurBon) return res.status(err.status).json({ error: err.message });
    console.error('[Commercial] fichier bon :', err.message);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
};
Object.assign(module.exports, {
  getBons:          repondreBc('bons', (ctx, req) => bc.lister(ctx, req.query)),
  getACommander:    repondreBc('à commander', (ctx) => bc.aCommander(ctx)),
  getProposition:   repondreBc('proposition', (ctx, req) => bc.proposition(ctx, req.params.id)),
  getBon:           repondreBc('bon', (ctx, req) => bc.lire(ctx, req.params.id)),
  postBon:          repondreBc('bon.préparation', (ctx, req) => bc.creer(ctx, req.body || {}), 201),
  putBon:           repondreBc('bon.modif', (ctx, req) => bc.modifier(ctx, req.params.id, req.body || {})),
  deleteBon:        repondreBc('bon.suppression', (ctx, req) => bc.supprimer(ctx, req.params.id)),
  postRevalidation: repondreBc('bon.revalidation', (ctx, req) => bc.revalider(ctx, req.params.id, req.body || {}, bc.notifierRevalidation(ctx))),
  postEmission:     repondreBc('bon.émission', (ctx, req) => bc.emettre(ctx, req.params.id, bc.notifierEmission(ctx))),
  postAnnulationBon: repondreBc('bon.annulation', (ctx, req) => bc.annuler(ctx, req.params.id, req.body || {})),
  postRevision:     repondreBc('bon.révision', (ctx, req) => bc.reviser(ctx, req.params.id), 201),
  postProforma:     repondreBc('bon.proforma', (ctx, req) => bc.joindreProforma(ctx, req.params.id, req.body || {}), 201),
  postRetraitProforma: repondreBc('bon.proforma.retrait', (ctx, req) => bc.retirerProforma(ctx, req.params.id, req.params.doc, req.body || {})),
  getPdfBon:        fichierBc((ctx, req) => bc.lirePdf(ctx, req.params.id)),
  getPieceBon:      fichierBc((ctx, req) => bc.lirePiece(ctx, req.params.id, req.params.doc)),
  getTableau:       repondreBc('tableau de bord', (ctx, req) => tb.tableau(ctx, req.query)),
  getDocuments:     repondreBc('documents', (ctx, req) => tb.documents(ctx, req.query)),
  getHistorique:    repondreBc('historique', (ctx, req) => tb.historique(ctx, req.query)),
  // Public (QR code) : aucune session, aucune donnée chiffrée.
  getVerification: async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await bc.verifier(req.params.jeton));
    } catch (err) {
      console.error('[Commercial] vérification :', err.message);
      res.status(500).json({ error: 'Vérification momentanément indisponible.' });
    }
  },
});
