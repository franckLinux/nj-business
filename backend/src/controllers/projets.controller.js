// src/controllers/projets.controller.js — Suivi de la caisse des projets (069)
// Lot P1 : contexte de saisie du journal (natures de recette, projets,
// activités et budget restant). Les écrans du menu Projets viennent au lot P2.
const projetsSvc = require('../services/projets.service');

// GET /api/projets/saisie → { ong: false } pour une PME ; sinon natures,
// projets actifs et leurs activités (budget validé, déjà remis, reste).
const contexteSaisie = async (req, res) => {
  try {
    res.json(await projetsSvc.contexteSaisie(req.tenantId));
  } catch (err) {
    console.error('[Projets] contexte de saisie :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = { contexteSaisie };
