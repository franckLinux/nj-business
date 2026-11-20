// src/controllers/projets.controller.js — Suivi de la caisse des projets (069)
// ONG / associations seulement.
//   Lot P1 : contexte de saisie du journal.
//   Lot P2 : menu « Projets » — projets, activités, désignations, budget
//            (chargement, soumission, validation par le directeur).
// Le périmètre de chacun est vérifié par le service, à chaque appel.
const projetsSvc = require('../services/projets.service');
const gestion = require('../services/projets_gestion.service');
const justif = require('../services/projets_justificatifs.service');

// Réponse commune : erreurs métier en clair, le reste en 500 journalisé.
const traiter = (nom, fn, statutOk = 200) => async (req, res) => {
  try {
    const r = await fn(req);
    res.status(statutOk).json(r === undefined ? { ok: true } : r);
  } catch (err) {
    if (err instanceof projetsSvc.ErreurProjet) return res.status(err.status).json({ error: err.message, code: err.code });
    if (/BUDGET_FIGE|BUDGET_INVALIDE|PROJET_INCOHERENT|JUSTIFICATIF_INTANGIBLE|JUSTIFICATIF_INVALIDE|chk_justif_pas_auto_validation/.test(err?.message || '')) {
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
  supprimerProjet:  traiter('suppression de projet', (req) => gestion.supprimerProjet(req, req.params.id)),
  supprimerActivite: traiter('suppression d\'activité', (req) => gestion.supprimerActivite(req, req.params.id, req.params.aid)),
  creerActivite:    traiter('création d\'activité', (req) => gestion.creerActivite(req, req.params.id, req.body || {}), 201),
  modifierActivite: traiter('modification d\'activité', (req) => gestion.modifierActivite(req, req.params.id, req.params.aid, req.body || {})),
  creerBudget:      traiter('nouveau budget', (req) => gestion.creerBudget(req, req.params.id), 201),
  enregistrerBudget: traiter('budget', (req) => gestion.enregistrerBudget(req, req.params.id, req.params.bid, req.body || {})),
  soumettreBudget:  traiter('soumission', (req) => gestion.soumettreBudget(req, req.params.id, req.params.bid)),
  retirerBudget:    traiter('reprise', (req) => gestion.retirerBudget(req, req.params.id, req.params.bid)),
  // Brouillon : chef de projet. Budget validé : directeur, motif obligatoire (corps { motif }).
  supprimerBudget:  traiter('suppression', async (req) => {
    const [b] = await require('../models').sequelize.query('SELECT statut FROM projet_budgets WHERE id = :b',
      { replacements: { b: parseInt(req.params.bid, 10) || 0 }, type: require('../models').sequelize.QueryTypes.SELECT });
    return b?.statut === 'valide'
      ? gestion.supprimerBudgetValide(req, req.params.id, req.params.bid, req.body?.motif ?? req.query.motif)
      : gestion.supprimerBudget(req, req.params.id, req.params.bid);
  }),
  validerBudget:    traiter('validation', (req) => gestion.deciderBudget(req, req.params.id, req.params.bid, { valider: true })),
  rejeterBudget:    traiter('rejet', (req) => gestion.deciderBudget(req, req.params.id, req.params.bid, { valider: false, motif: req.body?.motif })),
  // P3 — justificatifs et bilan
  listerJustificatifs: traiter('justificatifs', (req) => justif.lister(req, req.params.id, { activiteId: req.query.activite_id, statut: req.query.statut })),
  deposerJustificatif: traiter('dépôt de justificatif', (req) => justif.deposer(req, req.params.id, req.body || {}), 201),
  validerJustificatif: traiter('validation de justificatif', (req) => justif.decider(req, req.params.id, req.params.jid, { valider: true })),
  rejeterJustificatif: traiter('rejet de justificatif', (req) => justif.decider(req, req.params.id, req.params.jid, { valider: false, motif: req.body?.motif })),
  annulerJustificatif: traiter('annulation de justificatif', (req) => justif.annuler(req, req.params.id, req.params.jid, req.body?.motif)),
  supprimerJustificatif: traiter('retrait de justificatif', (req) => justif.supprimer(req, req.params.id, req.params.jid)),
  aControler:          traiter('justificatifs à contrôler', (req) => justif.aControler(req)),
  bilan:               traiter('bilan', (req) => justif.bilan(req)),
  // Fichier d'une pièce : flux binaire, jamais par /uploads.
  fichierJustificatif: async (req, res) => {
    try {
      const f = await justif.fichier(req, req.params.id, req.params.jid);
      const nom = String(f.nom || 'justificatif');
      res.setHeader('Content-Type', f.mime || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${nom.replace(/[^\w.\- ()]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(nom)}`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      require('fs').createReadStream(f.chemin)
        .on('error', (e) => { console.error('[Projets] fichier :', e.message); if (!res.headersSent) res.status(500).end(); else res.destroy(); })
        .pipe(res);
    } catch (err) {
      if (err instanceof projetsSvc.ErreurProjet) return res.status(err.status).json({ error: err.message, code: err.code });
      console.error('[Projets] fichier :', err.message);
      res.status(500).json({ error: 'Erreur serveur.' });
    }
  },
};
