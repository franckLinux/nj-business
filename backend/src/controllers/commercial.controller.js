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
