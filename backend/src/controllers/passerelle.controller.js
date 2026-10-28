// src/controllers/passerelle.controller.js
// Passerelle comptable — lot 1 (paramétrage). Règles métier : voir
// services/passerelle.service.js. Les droits d'entrée sont posés dans
// routes/index.js ; ici on ne décide que « proposer seul » ou « proposer et
// valider » selon que la personne détient passerelle.valider.
const svc = require('../services/passerelle.service');
const simulation = require('../services/passerelle_simulation.service');
const { userHasPermission } = require('../services/permission.service');

const repondre = (fn) => async (req, res) => {
  try {
    const out = await fn(req);
    res.json(out);
  } catch (err) {
    if (err instanceof svc.ErreurMetier) return res.status(err.status).json({ error: err.message });
    // Violations d'intégrité remontées par la base (index uniques, triggers).
    const code = err?.original?.code || err?.parent?.code;
    if (code === '23505') return res.status(409).json({ error: 'Modification concurrente : rechargez la page et recommencez.' });
    if (code === '23503' || code === '23001') return res.status(400).json({ error: err.original?.message || err.message });
    console.error('[Passerelle]', req.method, req.originalUrl, ':', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

const peutValider = (req) => userHasPermission(
  { tenantId: req.tenantId, userId: req.user.id, role: req.user.role }, 'passerelle.valider');

const ctx = (req) => ({ tenantId: req.tenantId, userId: req.user.id });

// GET /api/passerelle
const getEtat = repondre(async (req) => ({
  ...(await svc.etat(req.tenantId)),
  droits: { valider: await peutValider(req) },
}));

// PUT /api/passerelle/parametres  { compte_virements?, format_export? }
const putParametres = repondre((req) => svc.enregistrerParametres({
  ...ctx(req), compte_virements: req.body.compte_virements, format_export: req.body.format_export,
}));

// PUT /api/passerelle/journaux/:id  { compte_tresorerie, code_journal_compta }
const putJournal = repondre((req) => svc.enregistrerJournal({
  ...ctx(req), journalId: parseInt(req.params.id, 10) || 0,
  compte_tresorerie: req.body.compte_tresorerie, code_journal_compta: req.body.code_journal_compta,
}));

// POST /api/passerelle/equivalences  { rubrique_id, compte, commentaire? }
const postEquivalence = repondre(async (req) => svc.proposer({
  ...ctx(req), rubriqueId: parseInt(req.body.rubrique_id, 10) || 0,
  compte: req.body.compte, commentaire: req.body.commentaire, valider: await peutValider(req),
}));

// POST /api/passerelle/equivalences/lot  { lignes: [{ rubrique_code, compte }] }
const postLot = repondre(async (req) => svc.proposerLot({
  ...ctx(req), lignes: req.body.lignes, valider: await peutValider(req),
}));

// PATCH /api/passerelle/equivalences/:id/decision  { decision, motif? }
const patchDecision = repondre((req) => svc.decider({
  ...ctx(req), equivalenceId: parseInt(req.params.id, 10) || 0,
  decision: req.body.decision, motif: req.body.motif,
}));

// GET /api/passerelle/rubriques/:id/historique
const getHistorique = repondre((req) => svc.historique(req.tenantId, parseInt(req.params.id, 10) || 0));

// GET /api/passerelle/simulation?mois=&annee=  (balance de contrôle, rien n'est exporté)
const getSimulation = repondre((req) => simulation.simuler(req.tenantId, req.query.mois, req.query.annee));

module.exports = { getEtat, putParametres, putJournal, postEquivalence, postLot, patchDecision, getHistorique, getSimulation };
