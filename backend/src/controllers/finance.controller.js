'use strict';
// NJ FINANCE — contrôleur des rubriques financières (lot F4 : clients et fournisseurs).
// Règles : services/finance/tiers.service.js
const tiers = require('../services/finance/tiers.service');

const repondre = (res, err, quoi) => {
  const e = tiers.traduire(err);
  if (e instanceof tiers.ErreurTiers) return res.status(e.status).json({ error: e.message, ...(e.doublon ? { doublon: e.doublon } : {}) });
  console.error(`[NJ FINANCE] ${quoi} :`, err.message);
  return res.status(500).json({ error: 'Erreur serveur.' });
};
const action = (quoi, fn, statut = 200) => async (req, res) => {
  try { res.status(statut).json(await fn(req)); } catch (err) { repondre(res, err, quoi); }
};
const ctx = (req) => ({ tenantId: req.tenantId, userId: req.user.id, body: req.body || {} });

module.exports = {
  getTiers:        action('liste des tiers', (req) => tiers.lister(req.tenantId, req.query)),
  getFiche:        action('fiche tiers', (req) => tiers.lire(req.tenantId, req.params.id, req.query)),
  postTiers:       action('création de tiers', (req) => tiers.creer(ctx(req)), 201),
  putTiers:        action('modification de tiers', (req) => tiers.modifier({ ...ctx(req), id: req.params.id })),
  getReleve:       action('relevé de compte', (req) => tiers.releve(req.tenantId, req.params.id, req.query)),
  getCaisseTiers:  action('mouvements de caisse du tiers', (req) => tiers.mouvementsCaisse(req.tenantId, req.params.id, req.query)),
  getCreances:     action('créances clients', (req) => tiers.etat(req.tenantId, 'client', req.query)),
  getDettes:       action('dettes fournisseurs', (req) => tiers.etat(req.tenantId, 'fournisseur', req.query)),
};
