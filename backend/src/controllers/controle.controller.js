'use strict';
// Contrôle comptable des pièces (migration 042). Règles : services/controle.service.js
const svc = require('../services/controle.service');
const { userHasPermission } = require('../services/permission.service');

const repondre = (res, err, quoi) => {
  if (err instanceof svc.ErreurControle) {
    return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  }
  console.error(`[Controle] ${quoi} :`, err.message);
  return res.status(500).json({ error: 'Erreur serveur.' });
};

// GET /api/controle/pieces?du=&au=&journal_id=&statut=&anomalies=&tiers=&q=
const getPieces = async (req, res) => {
  try { res.json(await svc.lister(req.tenantId, req.query)); } catch (err) { repondre(res, err, 'liste'); }
};

// PUT /api/controle/pieces/:id  { tiers_nui, tiers_nom, tiers_id, observation, statut, compte_corrige }
// controle.saisir : tiers, observation, statut ; controle.compte : code comptable (044).
const putPiece = async (req, res) => {
  try {
    const ctx = { tenantId: req.tenantId, userId: req.user.id, role: req.user.role };
    const [saisir, compte] = await Promise.all([userHasPermission(ctx, 'controle.saisir'), userHasPermission(ctx, 'controle.compte')]);
    const r = await svc.enregistrer({ tenantId: req.tenantId, userId: req.user.id, mouvementId: req.params.id, body: req.body || {}, droits: { saisir, compte } });
    const p = r.piece;
    const msg = r.compte_modifie
      ? (p.compte_corrige ? `Opération ${p.reference} : compte corrigé en ${p.compte}.` : `Opération ${p.reference} : compte de la rubrique rétabli (${p.compte || 'aucun'}).`)
      : `Opération ${p.reference} : ${p.statut_libelle.toLowerCase()}.`;
    res.json({ message: msg, piece: p, ...(r.avertissement ? { avertissement: r.avertissement } : {}) });
  } catch (err) { repondre(res, err, 'enregistrement'); }
};

// ── Régularité formelle (045) ──
const action = (fn, quoi, message) => async (req, res) => {
  try {
    const piece = await fn({ tenantId: req.tenantId, userId: req.user.id, mouvementId: req.params.id, anomalieId: req.params.aid, body: req.body || {} });
    res.json({ message: message(piece), piece });
  } catch (err) { repondre(res, err, quoi); }
};
// POST /api/controle/pieces/:id/anomalies { libelle, bloquante }
const postAnomalie = action(svc.ajouterAnomalie, 'anomalie', (p) => `Anomalie enregistrée sur la pièce ${p.reference}.`);
// PUT /api/controle/anomalies/:aid { libelle, bloquante }
const putAnomalie = action(svc.modifierAnomalie, 'anomalie', (p) => `Anomalie modifiée (pièce ${p.reference}).`);
// POST /api/controle/anomalies/:aid/levee { motif }
const postLevee = action(svc.leverAnomalie, 'levée', (p) => `Anomalie levée (pièce ${p.reference}).`);
// POST /api/controle/pieces/:id/validation { observation? }
const postValidation = action(svc.valider, 'validation', (p) => `Pièce ${p.reference} validée.`);
// POST /api/controle/pieces/:id/reouverture { motif }
const postReouverture = action(svc.rouvrir, 'réouverture', (p) => `Pièce ${p.reference} rouverte.`);
// GET /api/controle/pieces/:id/historique
const getHistorique = async (req, res) => {
  try { res.json(await svc.historique(req.tenantId, req.params.id)); } catch (err) { repondre(res, err, 'historique'); }
};

// GET /api/controle/tiers?q=
const getTiers = async (req, res) => {
  try { res.json(await svc.tiersConnus(req.tenantId, req.query.q)); } catch (err) { repondre(res, err, 'tiers'); }
};

module.exports = { getPieces, putPiece, getTiers, postAnomalie, putAnomalie, postLevee, postValidation, postReouverture, getHistorique };
