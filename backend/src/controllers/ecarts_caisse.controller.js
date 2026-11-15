'use strict';
// Contrôle comptable → « Écarts de caisse » (migration 061).
// Règles : services/ecarts_caisse.service.js
const svc = require('../services/ecarts_caisse.service');

const repondre = (res, err, quoi) => {
  if (err instanceof svc.ErreurEcart) return res.status(err.status).json({ error: err.message });
  console.error(`[Écarts de caisse] ${quoi} :`, err.message);
  return res.status(500).json({ error: 'Erreur serveur.' });
};
const ctx = (req) => ({ tenantId: req.tenantId, userId: req.user.id, body: req.body || {} });

// GET /api/controle/ecarts?annee=&mois=&journal_id=&statut=&sens=
const getEcarts = async (req, res) => {
  try { res.json(await svc.lister(req.tenantId, req.query)); } catch (err) { repondre(res, err, 'liste'); }
};
// GET /api/controle/ecarts/parametres
const getParametres = async (req, res) => {
  try { res.json(await svc.parametres(req.tenantId)); } catch (err) { repondre(res, err, 'paramètres'); }
};
// GET /api/controle/ecarts/solde-theorique?journal_id=&date=
const getSoldeTheorique = async (req, res) => {
  try { res.json(await svc.soldeTheorique(req.tenantId, req.query)); } catch (err) { repondre(res, err, 'solde théorique'); }
};
// GET /api/controle/ecarts/:id
const getEcart = async (req, res) => {
  try { res.json(await svc.lire(req.tenantId, req.params.id)); } catch (err) { repondre(res, err, 'lecture'); }
};
// POST /api/controle/ecarts { origine, origine_id?, journal_id?, date_constat, solde_constate?, cause, date_ecriture? }
const postEcart = async (req, res) => {
  try {
    const e = await svc.constater(ctx(req));
    res.status(201).json({
      message: `Écart ${e.numero} constaté : ${e.sens === 'manquant' ? 'manquant' : 'excédent'} passé au journal ${e.journal_code} (écriture n°${e.ecriture?.numero}).`,
      ecart: e,
    });
  } catch (err) { repondre(res, err, 'constat'); }
};
const action = (fn, quoi, message) => async (req, res) => {
  try {
    const e = await fn({ ...ctx(req), id: req.params.id });
    res.json({ message: message(e), ecart: e });
  } catch (err) { repondre(res, err, quoi); }
};
// POST /api/controle/ecarts/:id/affectation { destination, compte_destination?, responsable_nom?, responsable_id?, observation? }
const postAffectation = action(svc.affecter, 'affectation',
  (e) => `Écart ${e.numero} : ${e.destination_libelle}${e.statut === 'solde' ? ' — écart soldé' : ' — à suivre jusqu\'à sa régularisation'}.`);
// POST /api/controle/ecarts/:id/regularisation { date, mode, reference?, observation? }
const postRegularisation = action(svc.regulariser, 'régularisation', (e) => `Écart ${e.numero} régularisé et soldé.`);
// POST /api/controle/ecarts/:id/annulation { motif }
const postAnnulation = action(svc.annuler, 'annulation', (e) => `Écart ${e.numero} annulé (écriture contre-passée).`);

module.exports = { getEcarts, getParametres, getSoldeTheorique, getEcart, postEcart, postAffectation, postRegularisation, postAnnulation };
