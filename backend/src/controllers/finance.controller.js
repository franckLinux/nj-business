'use strict';
// NJ FINANCE — contrôleur des rubriques financières (lot F4 : clients et fournisseurs).
// Règles : services/finance/tiers.service.js
const tiers = require('../services/finance/tiers.service');
const config = require('../services/finance/config.service');
const socle = require('../services/comptabilite/socle.service');
const achats = require('../services/finance/achats.service');
const facturesPdf = require('../services/finance/factures_pdf.service');
const journalCtrl = require('./journal.controller');

const repondre = (res, err, quoi) => {
  const e = err instanceof config.ErreurConfig ? err : tiers.traduire(config.traduire(err));
  if (e instanceof config.ErreurConfig) return res.status(e.status).json({ error: e.message });
  if (e instanceof tiers.ErreurTiers) return res.status(e.status).json({ error: e.message, ...(e.doublon ? { doublon: e.doublon } : {}) });
  const a = achats.traduire(err);
  if (a instanceof achats.ErreurAchat) return res.status(a.status).json({ error: a.message, ...(a.doublon ? { doublon: a.doublon } : {}) });
  console.error(`[NJ FINANCE] ${quoi} :`, err.message);
  return res.status(500).json({ error: 'Erreur serveur.' });
};
const action = (quoi, fn, statut = 200) => async (req, res) => {
  try { res.status(statut).json(await fn(req)); } catch (err) { repondre(res, err, quoi); }
};
const ctx = (req) => ({ tenantId: req.tenantId, userId: req.user.id, role: req.user.role, body: req.body || {} });

// Paiement depuis une facture : la saisie de caisse elle-même (POST /api/journal),
// avec tous ses contrôles, appelée pour le compte de la même personne.
const creerMouvementPour = (req) => async (corps) => {
  const sousReq = Object.create(req);
  sousReq.body = corps;
  let status = 200; let data = null;
  const res = { status(c) { status = c; return this; }, json(d) { data = d; return this; }, setHeader() { return this; } };
  await journalCtrl.createMouvement(sousReq, res);
  return { status, data };
};

module.exports = {
  getTiers:        action('liste des tiers', (req) => tiers.lister(req.tenantId, req.query)),
  getFiche:        action('fiche tiers', (req) => tiers.lire(req.tenantId, req.params.id, req.query)),
  postTiers:       action('création de tiers', (req) => tiers.creer(ctx(req)), 201),
  putTiers:        action('modification de tiers', (req) => tiers.modifier({ ...ctx(req), id: req.params.id })),
  getReleve:       action('relevé de compte', (req) => tiers.releve(req.tenantId, req.params.id, req.query)),
  getCaisseTiers:  action('mouvements de caisse du tiers', (req) => tiers.mouvementsCaisse(req.tenantId, req.params.id, req.query)),
  getCreances:     action('créances clients', (req) => tiers.etat(req.tenantId, 'client', req.query)),
  getDettes:       action('dettes fournisseurs', (req) => tiers.etat(req.tenantId, 'fournisseur', req.query)),
  // Configuration de la facturation (lot F5)
  getConfig:       action('configuration de la facturation', (req) => config.etat(req.tenantId, req.query)),
  getComptes:      action('comptes', (req) => socle.rechercherComptes(req.tenantId, req.query.q)),
  postInitConfig:  action('paramétrage par défaut', (req) => config.initialiser(ctx(req))),
  putSequence:     action('numérotation', (req) => config.definirSequence(ctx(req))),
  enregistrer: (fn, statut = 200) => action('configuration', (req) => fn({ ...ctx(req), id: req.params.id || null }), statut),
  // Achats (lot F6)
  getAchatsRef:    action('référentiels des achats', (req) => achats.referentiels(req.tenantId)),
  getAchats:       action('liste des achats', (req) => achats.lister(req.tenantId, req.query)),
  getAchat:        action('facture fournisseur', (req) => achats.lire(req.tenantId, req.params.origine, req.params.id)),
  postAchat:       action('saisie de facture', (req) => achats.creer(ctx(req)), 201),
  putAchat:        action('modification de facture', (req) => achats.modifier({ ...ctx(req), id: req.params.id })),
  deleteAchat:     action('suppression de facture', (req) => achats.supprimer({ ...ctx(req), id: req.params.id })),
  postSoumettre:   action('soumission de facture', (req) => achats.soumettre({ ...ctx(req), id: req.params.id })),
  postRenvoyer:    action('renvoi de facture', (req) => achats.renvoyer({ ...ctx(req), id: req.params.id })),
  postValider:     action('validation de facture', (req) => achats.valider({ ...ctx(req), id: req.params.id })),
  postAnnuler:     action('annulation de facture', (req) => achats.annuler({ ...ctx(req), id: req.params.id })),
  postImputer:     action('imputation de facture', (req) => achats.imputer({ ...ctx(req), id: req.params.id })),
  getEcheancier:   action('échéancier', (req) => achats.echeancier(req.tenantId)),
  getOuvertes:     action('factures à payer', (req) => achats.facturesOuvertes(req.tenantId, req.query)),
  getSorties:      action('sorties disponibles', (req) => achats.sortiesDisponibles(req.tenantId, req.query)),
  postReglement:   action('règlement', (req) => achats.reglerParCaisse(ctx(req)), 201),
  postPaiement:    action('paiement depuis la facture', (req) => achats.payer({ ...ctx(req), creerMouvement: creerMouvementPour(req) }), 201),
  postHorsCaisse:  action('règlement hors caisse', (req) => achats.proposerHorsCaisse(ctx(req)), 201),
  postDecisionHorsCaisse: action('décision hors caisse', (req) => achats.deciderHorsCaisse({ ...ctx(req), id: req.params.id })),
  deleteHorsCaisse: action('retrait hors caisse', (req) => achats.retirerHorsCaisse({ ...ctx(req), id: req.params.id })),
  getHorsCaisse:   action('règlements hors caisse en attente', (req) => achats.horsCaisseEnAttente(req.tenantId)),
  // Ventes et facturation (lot F8) : même service, sens « client ».
  getVentesRef:    action('référentiels des ventes', (req) => achats.referentiels(req.tenantId, 'client')),
  getVentes:       action('liste des ventes', (req) => achats.lister(req.tenantId, req.query, 'client')),
  getVente:        action('facture client', (req) => achats.lire(req.tenantId, 'fin', req.params.id, 'client')),
  postVente:       action('établissement de facture', (req) => achats.creer({ ...ctx(req), sens: 'client' }), 201),
  putVente:        action('modification de facture', (req) => achats.modifier({ ...ctx(req), id: req.params.id, sens: 'client' })),
  deleteVente:     action('suppression de facture', (req) => achats.supprimer({ ...ctx(req), id: req.params.id, sens: 'client' })),
  postVenteSoumettre: action('soumission de facture', (req) => achats.soumettre({ ...ctx(req), id: req.params.id, sens: 'client' })),
  postVenteRenvoyer:  action('renvoi de facture', (req) => achats.renvoyer({ ...ctx(req), id: req.params.id, sens: 'client' })),
  postVenteValider:   action('validation de facture', (req) => achats.valider({ ...ctx(req), id: req.params.id, sens: 'client' })),
  postVenteAnnuler:   action('annulation de facture', (req) => achats.annuler({ ...ctx(req), id: req.params.id, sens: 'client' })),
  postProformaEmettre:    action('émission de proforma', (req) => achats.emettreProforma({ ...ctx(req), id: req.params.id })),
  postProformaTransformer: action('transformation de proforma', (req) => achats.transformerProforma({ ...ctx(req), id: req.params.id }), 201),
  getVentesEcheancier: action('échéancier clients', (req) => achats.echeancier(req.tenantId, 'client')),
  getVentesOuvertes:   action('factures à encaisser', (req) => achats.facturesOuvertes(req.tenantId, req.query, 'client')),
  getEntreesDisponibles: action('entrées disponibles', (req) => achats.sortiesDisponibles(req.tenantId, req.query, 'client')),
  getVentePdf: async (req, res) => {
    try {
      const f = await facturesPdf.generer(req.tenantId, req.params.id);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${f.nom}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      return res.end(f.contenu);
    } catch (err) {
      if (err instanceof facturesPdf.ErreurPdf) return res.status(err.status).json({ error: err.message });
      return repondre(res, err, 'PDF de facture');
    }
  },
  deleteReglement: action('retrait de règlement', (req) => achats.retirerReglement({ ...ctx(req), id: req.params.id })),
};
