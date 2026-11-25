'use strict';
// NJ FINANCE — contrôleur du socle comptable (lot F2, migration 075).
// Règles : services/finance/comptabilite.service.js
const svc = require('../services/finance/comptabilite.service');

const repondre = (res, err, quoi) => {
  const e = svc.traduire(err);
  if (e instanceof svc.ErreurFinance) return res.status(e.status).json({ error: e.message });
  console.error(`[NJ FINANCE] ${quoi} :`, err.message);
  return res.status(500).json({ error: 'Erreur serveur.' });
};
const ctx = (req) => ({ tenantId: req.tenantId, userId: req.user.id, body: req.body || {} });
const action = (quoi, fn, statut = 200) => async (req, res) => {
  try { res.status(statut).json(await fn(req)); } catch (err) { repondre(res, err, quoi); }
};

module.exports = {
  // Exercices et périodes
  getExercices:       action('exercices', (req) => svc.listerExercices(req.tenantId)),
  getProposition:     action('proposition d\'exercice', (req) => svc.propositionExercice(req.tenantId)),
  postExercice:       action('création d\'exercice', (req) => svc.creerExercice(ctx(req)), 201),
  putPeriodeStatut:   action('statut de période', (req) => svc.changerStatutPeriode({ ...ctx(req), periodeId: req.params.id, statut: req.body?.statut })),
  // Journaux comptables
  getJournaux:        action('journaux comptables', (req) => svc.listerJournaux(req.tenantId)),
  postJournal:        action('création de journal', (req) => svc.creerJournal(ctx(req)), 201),
  putJournal:         action('modification de journal', (req) => svc.modifierJournal({ ...ctx(req), journalId: req.params.id })),
  postInitJournaux:   action('initialisation des journaux', (req) => svc.initialiserJournaux(ctx(req))),
  // Référentiels de saisie
  getComptes:         action('comptes', (req) => svc.rechercherComptes(req.tenantId, req.query.q)),
  getReferentiels:    action('référentiels', (req) => svc.referentiels(req.tenantId)),
  // Écritures
  getEcritures:       action('écritures', (req) => svc.listerEcritures(req.tenantId, req.query)),
  getEcriture:        action('écriture', (req) => svc.lireEcriture(req.tenantId, req.params.id)),
  postEcriture:       action('saisie d\'écriture', (req) => svc.creerEcriture(ctx(req)), 201),
  putEcriture:        action('modification d\'écriture', (req) => svc.modifierEcriture({ ...ctx(req), ecritureId: req.params.id })),
  deleteEcriture:     action('suppression d\'écriture', (req) => svc.supprimerEcriture({ ...ctx(req), ecritureId: req.params.id })),
  postValider:        action('validation d\'écriture', (req) => svc.validerEcriture({ ...ctx(req), ecritureId: req.params.id })),
  postExtourner:      action('extourne', (req) => svc.extournerEcriture({ ...ctx(req), ecritureId: req.params.id }), 201),
  // États
  getBalance:         action('balance', (req) => svc.balance(req.tenantId, req.query)),
  getGrandLivre:      action('grand livre', (req) => svc.grandLivre(req.tenantId, req.query)),
};
