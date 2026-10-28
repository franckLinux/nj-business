// src/controllers/mouvements_attente.controller.js
const { verifierPeriodeOuverte, verifierSoldeNonNegatif, ErreurComptable } = require('../services/journal.service');
// File des dépenses (sorties) bloquées en attente d'autorisation (RG-03 / RG-04).
// L'approbation bascule la ligne en écriture réelle dans `journal` (transaction atomique).
const { sequelize, MouvementAttente, Mouvement, Rubrique, Journal, User } = require('../models');
const notif = require('../services/notification.service');

// ── GET /api/mouvements-attente?mois=&annee=&statut= ────────────────────────
const list = async (req, res) => {
  const { mois, annee, statut } = req.query;
  try {
    const where = { tenant_id: req.tenantId };
    if (mois)  where.mois = mois;
    if (annee) where.annee = parseInt(annee, 10);
    if (statut && statut !== 'all') where.statut = statut;

    const [mouvements, rubriques, journaux] = await Promise.all([
      MouvementAttente.findAll({
        where,
        include: [
          { model: User, as: 'auteur', attributes: ['username'], required: false },
          { model: User, as: 'decideur', attributes: ['username'], required: false },
        ],
        order: [['created_at', 'DESC']],
      }),
      Rubrique.findAll({ where: { tenant_id: req.tenantId }, attributes: ['code', 'intitule'], raw: true }),
      Journal.findAll({ where: { tenant_id: req.tenantId }, attributes: ['id', 'nom', 'code'], raw: true }),
    ]);
    const rubriqueByCode = new Map(rubriques.map(r => [r.code, r.intitule]));
    const journalById = new Map(journaux.map(j => [j.id, j]));

    const rows = mouvements.map(m => {
      const { auteur, decideur, ...rest } = m.toJSON();
      return {
        ...rest,
        rubrique_intitule: rubriqueByCode.get(rest.rubrique_code) || null,
        journal_nom: journalById.get(rest.journal_id)?.nom || null,
        journal_code: journalById.get(rest.journal_id)?.code || null,
        created_by_nom: auteur ? auteur.username : null,
        decided_by_nom: decideur ? decideur.username : null,
      };
    });

    const total_en_attente = rows
      .filter(r => r.statut === 'en_attente')
      .reduce((s, r) => s + (parseFloat(r.sortie) || 0), 0);
    res.json({ mouvements: rows, total_en_attente });
  } catch (err) {
    console.error('[MvtAttente] list :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── GET /api/mouvements-attente/count?mois=&annee= ──────────────────────────
const count = async (req, res) => {
  const { mois, annee } = req.query;
  try {
    const where = { tenant_id: req.tenantId, statut: 'en_attente' };
    if (mois)  where.mois = mois;
    if (annee) where.annee = parseInt(annee, 10);
    const nb = await MouvementAttente.count({ where });
    res.json({ nb });
  } catch (err) {
    console.error('[MvtAttente] count :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── PATCH /api/mouvements-attente/:id/approuver ──────────────────────────────
// Transaction : verrouille la ligne, crée l'écriture dans journal, marque 'approuve'.
const approuver = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const { journal, mouvement } = await sequelize.transaction(async (t) => {
      const m = await MouvementAttente.findOne({
        where: { id, tenant_id: req.tenantId, statut: 'en_attente' },
        transaction: t, lock: t.LOCK.UPDATE,
      });
      if (!m) {
        const notFound = new Error('NOT_FOUND');
        notFound.code = 'NOT_FOUND';
        throw notFound;
      }

      // Même contrôles comptables qu'une saisie directe : mois ouvert et
      // caisse jamais négative (la dépense reste en attente sinon).
      await verifierPeriodeOuverte(m.tenant_id, m.journal_id, m.mois, m.annee);
      await verifierSoldeNonNegatif(m.tenant_id, m.journal_id, m.mois, m.annee, -(parseFloat(m.sortie) || 0));

      const j = await Mouvement.create({
        tenant_id: m.tenant_id, date: m.date, mois: m.mois, annee: m.annee,
        journal_id: m.journal_id, type_caisse: m.type_caisse, rubrique_code: m.rubrique_code,
        intitule: m.intitule, objet: m.objet, beneficiaire: m.beneficiaire,
        piece_identite: m.piece_identite, telephone: m.telephone, nui: m.nui || '',
        activite_id: m.activite_id || null,
        entree: 0, sortie: m.sortie, created_by: req.user.id,
      }, { transaction: t });

      m.statut = 'approuve';
      m.decided_by = req.user.id;
      m.decided_at = new Date();
      m.commentaire_dir = req.body.commentaire || '';
      await m.save({ transaction: t });

      return { journal: j, mouvement: m };
    });

    // Notifier le créateur de la dépense (cloche) — best-effort, hors transaction
    notif.notifyDecisionMouvement({
      tenantId: req.tenantId, mouvement, decision: 'approuvee',
      directeurNom: req.user.username,
    }).catch(e => console.warn('[MvtAttente] notif approbation :', e.message));

    res.json({ ok: true, journal });
  } catch (err) {
    if (err instanceof ErreurComptable) return res.status(err.status).json({ error: `Approbation impossible : ${err.message}` });
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Dépense en attente introuvable ou déjà traitée.' });
    }
    console.error('[MvtAttente] approuver :', err.message);
    res.status(500).json({ error: `Erreur serveur : ${err.message}` });
  }
};

// ── PATCH /api/mouvements-attente/:id/rejeter ────────────────────────────────
const rejeter = async (req, res) => {
  try {
    const [count, rows] = await MouvementAttente.update(
      { statut: 'rejete', decided_by: req.user.id, decided_at: new Date(), commentaire_dir: req.body.commentaire || '' },
      { where: { id: parseInt(req.params.id, 10), tenant_id: req.tenantId, statut: 'en_attente' }, returning: true },
    );
    if (count === 0) {
      return res.status(404).json({ error: 'Dépense en attente introuvable ou déjà traitée.' });
    }

    // Notifier le créateur de la dépense du refus (cloche) — best-effort
    notif.notifyDecisionMouvement({
      tenantId: req.tenantId, mouvement: rows[0], decision: 'rejetee',
      commentaire: req.body.commentaire || '', directeurNom: req.user.username,
    }).catch(e => console.warn('[MvtAttente] notif rejet :', e.message));

    res.json({ ok: true, mouvement: rows[0] });
  } catch (err) {
    console.error('[MvtAttente] rejeter :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = { list, count, approuver, rejeter };
