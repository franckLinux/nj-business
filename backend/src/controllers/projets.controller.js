// src/controllers/projets.controller.js — Suivi de la caisse des projets (069)
// ONG / associations seulement.
//   Lot P1 : contexte de saisie du journal.
//   Lot P2 : menu « Projets » — projets, activités, désignations, budget
//            (chargement, soumission, validation par le directeur).
// Le périmètre de chacun est vérifié par le service, à chaque appel.
const projetsSvc = require('../services/projets.service');
const gestion = require('../services/projets_gestion.service');

// Réponse commune : erreurs métier en clair, le reste en 500 journalisé.
const traiter = (nom, fn, statutOk = 200) => async (req, res) => {
  try {
    const r = await fn(req);
    res.status(statutOk).json(r === undefined ? { ok: true } : r);
  } catch (err) {
    if (err instanceof projetsSvc.ErreurProjet) return res.status(err.status).json({ error: err.message, code: err.code });
    if (/BUDGET_FIGE|BUDGET_INVALIDE|PROJET_INCOHERENT/.test(err?.message || '')) {
      return res.status(409).json({ error: String(err.message).replace(/^[A-Z_]+: /, ''), code: 'REGLE_BASE' });
    }
    console.error(`[Projets] ${nom} :`, err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = {
  // P1
  contexteSaisie: traiter('contexte de saisie', (req) => projetsSvc.contexteSaisie(req.tenantId)),
  // P2
  acces:            traiter('accès', (req) => gestion.acces(req)),
  lister:           traiter('liste', (req) => gestion.lister(req)),
  detail:           traiter('détail', (req) => gestion.detail(req, req.params.id)),
  utilisateurs:     traiter('utilisateurs', (req) => gestion.utilisateurs(req)),
  creerProjet:      traiter('création', (req) => gestion.creerProjet(req, req.body || {}), 201),
  modifierProjet:   traiter('modification', (req) => gestion.modifierProjet(req, req.params.id, req.body || {})),
  creerActivite:    traiter('création d\'activité', (req) => gestion.creerActivite(req, req.params.id, req.body || {}), 201),
  modifierActivite: traiter('modification d\'activité', (req) => gestion.modifierActivite(req, req.params.id, req.params.aid, req.body || {})),
  creerBudget:      traiter('nouveau budget', (req) => gestion.creerBudget(req, req.params.id), 201),
  enregistrerBudget: traiter('budget', (req) => gestion.enregistrerBudget(req, req.params.id, req.params.bid, req.body || {})),
  soumettreBudget:  traiter('soumission', (req) => gestion.soumettreBudget(req, req.params.id, req.params.bid)),
  retirerBudget:    traiter('reprise', (req) => gestion.retirerBudget(req, req.params.id, req.params.bid)),
  supprimerBudget:  traiter('suppression', (req) => gestion.supprimerBudget(req, req.params.id, req.params.bid)),
  validerBudget:    traiter('validation', (req) => gestion.deciderBudget(req, req.params.id, req.params.bid, { valider: true })),
  rejeterBudget:    traiter('rejet', (req) => gestion.deciderBudget(req, req.params.id, req.params.bid, { valider: false, motif: req.body?.motif })),
};
