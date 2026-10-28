'use strict';
// Registre des clients / fournisseurs (migration 043). Règles : services/registre_tiers.service.js
const svc = require('../services/registre_tiers.service');

const repondre = (res, err, quoi) => {
  if (err instanceof svc.ErreurRegistre) return res.status(err.status).json({ error: err.message });
  if (err?.original?.code === '23505') return res.status(409).json({ error: 'Ce NUI ou ce compte tiers est déjà au registre.' });
  console.error(`[Registre tiers] ${quoi} :`, err.message);
  return res.status(500).json({ error: 'Erreur serveur.' });
};

// GET /api/registre-tiers?q=&type=&actifs=1
const getListe = async (req, res) => {
  try { res.json(await svc.lister(req.tenantId, req.query)); } catch (err) { repondre(res, err, 'liste'); }
};
// GET /api/registre-tiers/saisie?q=&sens=entree|sortie — aide à la saisie de caisse (044)
const getSaisie = async (req, res) => {
  try { res.json(await svc.pourSaisie(req.tenantId, req.query)); } catch (err) { repondre(res, err, 'saisie'); }
};
// POST /api/registre-tiers
const post = async (req, res) => {
  try {
    const t = await svc.creer({ tenantId: req.tenantId, userId: req.user.id, body: req.body || {} });
    res.status(201).json({ message: `${t.nom} ajouté au registre.`, tiers: t });
  } catch (err) { repondre(res, err, 'création'); }
};
// PUT /api/registre-tiers/:id
const put = async (req, res) => {
  try {
    const t = await svc.modifier({ tenantId: req.tenantId, userId: req.user.id, id: req.params.id, body: req.body || {} });
    res.json({ message: `Fiche de ${t.nom} enregistrée.`, tiers: t });
  } catch (err) { repondre(res, err, 'modification'); }
};
// POST /api/registre-tiers/import-pieces
const postImport = async (req, res) => {
  try {
    const r = await svc.importerDepuisPieces({ tenantId: req.tenantId, userId: req.user.id });
    res.json({ ...r, message: r.crees ? `${r.crees} tiers repris des pièces (à vérifier).` : 'Aucun nouveau tiers à reprendre : tous les NUI des pièces sont déjà au registre.' });
  } catch (err) { repondre(res, err, 'import'); }
};

module.exports = { getListe, getSaisie, post, put, postImport };
