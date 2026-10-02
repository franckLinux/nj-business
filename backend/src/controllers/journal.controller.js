// src/controllers/journal.controller.js — v2 (journaux dynamiques)
// Route HTTP du journal de caisse. Les règles budgétaires (RG-01 à RG-06) et
// les fonctions de calcul partagées (soldes, RAN, contrôle budgétaire, mise en
// attente) vivent dans services/journal.service.js — ce fichier ne garde que
// la validation des entrées HTTP et le mapping requête → réponse.
const { Op, fn, col } = require('sequelize');
const { sequelize, Mouvement, Journal, Rubrique, ArretCaisse, User, BudgetCaisse, AppelFonds, Ran, Banque } = require('../models');
const {
  moisPrecedent, resolveFiltre, calcSoldeFinal, autoRan,
  mettreEnAttente, controleBudgetSortie,
} = require('../services/journal.service');

// ── GET /api/journal?mois=&annee=&journal_id=&rubrique_code= ─────────────
const getJournal = async (req, res) => {
  const { mois, annee, journal_id, caisse, rubrique_code } = req.query;

  if (!mois || !annee) {
    return res.status(400).json({ error: 'Paramètres mois et annee requis.' });
  }

  try {
    const filtre = await resolveFiltre(req.tenantId, journal_id, caisse);
    const an = parseInt(annee, 10);

    // RAN automatique
    const ranAuto = await autoRan(req.tenantId, mois, an, filtre);

    const where = { tenant_id: req.tenantId, mois, annee: an };
    if (filtre.journal_id) where.journal_id = filtre.journal_id;
    else if (filtre.type_caisse) where.type_caisse = filtre.type_caisse;
    if (rubrique_code) where.rubrique_code = rubrique_code;

    // rubriques/journaux : pas de vraie FK sur rubrique_code (code applicatif,
    // pas de contrainte en base) → on les charge à part et on fusionne en JS
    // plutôt que de fabriquer une association qui prétendrait à une intégrité
    // qui n'existe pas dans le schéma.
    const [mouvements, rubriques, journaux] = await Promise.all([
      Mouvement.findAll({ where, order: [['date', 'ASC'], ['id', 'ASC']], raw: true }),
      Rubrique.findAll({ where: { tenant_id: req.tenantId }, attributes: ['code', 'intitule'], raw: true }),
      Journal.findAll({ where: { tenant_id: req.tenantId }, attributes: ['id', 'nom', 'code'], raw: true }),
    ]);
    const rubriqueByCode = new Map(rubriques.map(r => [r.code, r.intitule]));
    const journalById = new Map(journaux.map(j => [j.id, j]));
    const rows = mouvements.map(m => ({
      ...m,
      rubrique_intitule: rubriqueByCode.get(m.rubrique_code) || null,
      journal_nom: journalById.get(m.journal_id)?.nom || null,
      journal_code: journalById.get(m.journal_id)?.code || null,
    }));

    const soldes = await calcSoldeFinal(req.tenantId, mois, an, filtre);

    // Info mois précédent
    const prev = moisPrecedent(mois, an);
    const soldePrev = await calcSoldeFinal(req.tenantId, prev.mois, prev.annee, filtre);

    // Arrêt de caisse pour ce journal/mois
    let arret = null;
    if (filtre.journal_id) {
      try {
        const arretRow = await ArretCaisse.findOne({
          where: { tenant_id: req.tenantId, journal_id: filtre.journal_id, mois, annee: an },
          include: [{ model: User, attributes: ['username'], required: false }],
        });
        if (arretRow) {
          const { User: arreteParUser, ...rest } = arretRow.toJSON();
          arret = { ...rest, arrete_par_nom: arreteParUser ? arreteParUser.username : null };
        }
      } catch (_) { /* table pas encore créée */ }
    }

    res.json({
      mouvements:      rows,
      soldes,
      ran_auto:        ranAuto,
      solde_precedent: soldePrev.solde,
      arret,
    });
  } catch (err) {
    console.error('[Journal] getJournal :', err.message);
    res.status(500).json({ error: `Erreur serveur : ${err.message}` });
  }
};

// ── POST /api/journal ─────────────────────────────────────────────────────
const createMouvement = async (req, res) => {
  const { date, mois, annee, journal_id, type_caisse,
          rubrique_code, intitule, objet, beneficiaire,
          piece_identite, telephone, entree, sortie } = req.body;

  if (!date || !mois || !annee || !rubrique_code) {
    return res.status(400).json({ error: 'Champs obligatoires manquants (date, mois, annee, rubrique_code).' });
  }
  if (!journal_id && !type_caisse) {
    return res.status(400).json({ error: 'journal_id ou type_caisse requis.' });
  }
  if ((parseFloat(entree)||0) === 0 && (parseFloat(sortie)||0) === 0) {
    return res.status(400).json({ error: 'Montant entrée ou sortie requis.' });
  }

  // ── Résolution type_caisse + contrôles budgétaires (RG-03 / RG-06 / RG-04) ──
  const montantSortie = parseFloat(sortie) || 0;
  let resolvedCaisse = type_caisse || 'especes';
  let budgetWarning  = null;
  const jid = journal_id ? parseInt(journal_id, 10) : null;
  const an  = parseInt(annee, 10);

  // Résolution type_caisse (nécessaire aussi pour les entrées)
  if (jid && !type_caisse) {
    try {
      const j = await Journal.findOne({ where: { id: jid }, attributes: ['type'] });
      if (j?.type) resolvedCaisse = ['om','momo','carte_prepayee'].includes(j.type) ? 'om' : 'especes';
    } catch (_) { /* défaut 'especes' */ }
  }

  // RG-05 : les contrôles ne s'appliquent qu'aux SORTIES (entrées exemptées).
  if (montantSortie > 0) {
    let ctrl;
    try {
      ctrl = await controleBudgetSortie(req.tenantId, {
        mois, annee: an, journal_id: jid, rubrique_code, sortie: montantSortie,
      });
    } catch (budgetErr) {
      // Fail-closed : si le contrôle échoue, on REFUSE la sortie (jamais de dépassement silencieux).
      console.error('[Journal] contrôle budgétaire indisponible :', budgetErr.message);
      return res.status(503).json({
        error: `Contrôle budgétaire indisponible (${budgetErr.message}) — sortie refusée par sécurité. Réessayez.`,
      });
    }

    // Blocage (RG-03 / RG-06 / RG-04) — refus sec + mise en attente du directeur
    if (ctrl.bloque) {
      let row;
      try {
        row = await mettreEnAttente(
          { tenantId: req.tenantId, userId: req.user.id, username: req.user.username },
          { date, mois, annee: an, journal_id: jid, type_caisse: resolvedCaisse,
            rubrique_code, intitule, objet, beneficiaire, piece_identite, telephone,
            sortie: montantSortie },
          ctrl.motif, { montant_prevu: ctrl.montant_prevu, cumul: ctrl.cumul });
      } catch (attenteErr) {
        // La mise en attente a échoué (ex. table absente / migration non lancée) :
        // on NE prétend PAS "en attente" et on n'écrit rien dans le journal.
        console.error('[Journal] échec mise en attente :', attenteErr.message);
        return res.status(503).json({
          error: `La dépense n'a pas pu être mise en attente (${attenteErr.message}). `
               + `Aucune écriture n'a été effectuée. Vérifiez que la migration mouvements_attente est appliquée, puis réessayez.`,
        });
      }
      return res.status(200).json({
        en_attente:   true,
        motif:        ctrl.motif,
        mouvement_id: row.id,
        message:      `Sortie refusée : ${ctrl.message}`,
      });
    }

    budgetWarning = ctrl.warning || null;
  }

  try {
    const mouvement = await Mouvement.create({
      tenant_id: req.tenantId, date, mois, annee: an,
      journal_id: jid, type_caisse: resolvedCaisse,
      rubrique_code, intitule, objet: objet||'', beneficiaire: beneficiaire||'',
      piece_identite: piece_identite||'', telephone: telephone||'',
      entree: parseFloat(entree)||0, sortie: montantSortie, created_by: req.user.id,
    });
    res.status(201).json({ ...mouvement.toJSON(), budget_warning: budgetWarning });
  } catch (err) {
    console.error('[Journal] createMouvement :', err.message);
    res.status(500).json({ error: `Erreur serveur : ${err.message}` });
  }
};

// ── PUT /api/journal/:id ──────────────────────────────────────────────────
const updateMouvement = async (req, res) => {
  const { date, rubrique_code, intitule, objet, beneficiaire,
          piece_identite, telephone, entree, sortie } = req.body;
  const id = req.params.id;   // texte : Postgres caste vers le type réel (bigint)
  const montantSortie = parseFloat(sortie) || 0;
  try {
    // Mouvement existant (pour retrouver mois/annee/journal et exclure sa propre sortie du cumul)
    const old = await Mouvement.findOne({
      where: { id, tenant_id: req.tenantId },
      attributes: ['mois', 'annee', 'journal_id'],
    });
    if (!old) return res.status(404).json({ error: 'Mouvement introuvable.' });

    // Contrôle budgétaire sur la NOUVELLE valeur (RG-03 / RG-06 / RG-04) — refus sec.
    // On ferme ainsi le contournement : impossible de gonfler une sortie par édition.
    if (montantSortie > 0) {
      let ctrl;
      try {
        ctrl = await controleBudgetSortie(req.tenantId, {
          mois: old.mois, annee: old.annee, journal_id: old.journal_id,
          rubrique_code, sortie: montantSortie, excludeId: id,
        });
      } catch (budgetErr) {
        console.error('[Journal] contrôle budgétaire (edit) indisponible :', budgetErr.message);
        return res.status(503).json({
          error: `Contrôle budgétaire indisponible (${budgetErr.message}) — modification refusée par sécurité.`,
        });
      }
      if (ctrl.bloque) {
        // La sortie d'origine reste inchangée ; la modification est refusée.
        return res.status(200).json({
          refus_modification: true,
          motif:   ctrl.motif,
          message: `Modification refusée : ${ctrl.message}`,
        });
      }
    }

    const [count, rows] = await Mouvement.update(
      {
        date, rubrique_code, intitule, objet: objet || '', beneficiaire: beneficiaire || '',
        piece_identite: piece_identite || '', telephone: telephone || '',
        entree: parseFloat(entree) || 0, sortie: montantSortie,
      },
      { where: { id, tenant_id: req.tenantId }, returning: true },
    );
    if (count === 0) return res.status(404).json({ error: 'Mouvement introuvable.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[Journal] updateMouvement :', err.message);
    res.status(500).json({ error: `Erreur serveur : ${err.message}` });
  }
};

// ── DELETE /api/journal/:id ────────────────────────────────────────────────
const deleteMouvement = async (req, res) => {
  try {
    await Mouvement.destroy({ where: { id: req.params.id, tenant_id: req.tenantId } });
    res.json({ message: 'Mouvement supprimé.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── GET /api/journal/soldes ────────────────────────────────────────────────
const getSoldes = async (req, res) => {
  const { mois, annee } = req.query;
  try {
    const [especes, om] = await Promise.all([
      calcSoldeFinal(req.tenantId, mois, parseInt(annee, 10), { type_caisse: 'especes' }),
      calcSoldeFinal(req.tenantId, mois, parseInt(annee, 10), { type_caisse: 'om' }),
    ]);
    res.json({ especes, om });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── GET /api/journal/ran ───────────────────────────────────────────────────
const getRan = async (req, res) => {
  const { mois, annee, caisse, journal_id } = req.query;
  try {
    const filtre = await resolveFiltre(req.tenantId, journal_id, caisse || 'especes');
    const an = parseInt(annee, 10);
    const montant = await autoRan(req.tenantId, mois, an, filtre);
    const prev = moisPrecedent(mois, an);
    const soldePrev = await calcSoldeFinal(req.tenantId, prev.mois, prev.annee, filtre);
    res.json({
      montant,
      mois_precedent:   prev.mois,
      annee_precedente: prev.annee,
      solde_precedent:  soldePrev.solde,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── POST /api/journal/ran — saisie manuelle ──────────────────────────────
const setRan = async (req, res) => {
  const { mois, annee, caisse, journal_id, montant } = req.body;
  if (!req.tenantId) return res.status(400).json({ error: 'Client requis.' });
  try {
    // Le RAN est désormais ouvert aux caissières (journal.ran) : on vérifie
    // que le journal appartient bien au client et que le mois n'est pas arrêté
    // — un solde d'ouverture ne se modifie plus après l'arrêt de caisse.
    if (journal_id) {
      const jid = parseInt(journal_id, 10);
      const journal = await Journal.findOne({ where: { id: jid, tenant_id: req.tenantId }, attributes: ['id'], raw: true });
      if (!journal) return res.status(404).json({ error: 'Journal introuvable pour ce client.' });
      const arret = await ArretCaisse.findOne({
        where: { tenant_id: req.tenantId, journal_id: jid, mois, annee: parseInt(annee, 10) },
        attributes: ['id'], raw: true,
      });
      if (arret) {
        return res.status(409).json({ error: 'Ce journal est arrêté pour ce mois : le RAN ne peut plus être modifié. Faites d\'abord réouvrir le journal.' });
      }
    }
    await sequelize.transaction(async (t) => {
      const where = journal_id
        ? { tenant_id: req.tenantId, mois, annee: parseInt(annee, 10), journal_id: parseInt(journal_id, 10) }
        : { tenant_id: req.tenantId, mois, annee: parseInt(annee, 10), type_caisse: caisse || 'especes' };
      const defaults = journal_id ? { type_caisse: caisse || 'especes' } : {};
      const [row] = await Ran.findOrCreate({ where, defaults, transaction: t, lock: t.LOCK.UPDATE });
      row.montant = parseFloat(montant) || 0;
      await row.save({ transaction: t });
    });
    res.json({ message: 'RAN mis à jour.' });
  } catch (err) {
    console.error('[Journal] setRan :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── GET /api/journal/recap?mois=&annee= ───────────────────────────────────
// Vue consolidée de tous les journaux (hors banque) pour la période
const getJournauxRecap = async (req, res) => {
  const { mois, annee } = req.query;
  if (!mois || !annee) return res.status(400).json({ error: 'mois et annee requis.' });
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Client requis.' });
  const yr = parseInt(annee, 10);

  try {
    const [journaux, ranRows, mvtRows, banque, arrets] = await Promise.all([
      Journal.findAll({
        where: { tenant_id: tenantId, actif: true, type: { [Op.ne]: 'banque' } },
        attributes: ['id', 'nom', 'code', 'type', 'ordre'], raw: true,
      }),
      Ran.findAll({ where: { tenant_id: tenantId, mois, annee: yr }, attributes: ['journal_id', 'montant'], raw: true }),
      Mouvement.findAll({
        where: { tenant_id: tenantId, mois, annee: yr },
        attributes: ['journal_id', [fn('COALESCE', fn('SUM', col('entree')), 0), 'total_entrees'], [fn('COALESCE', fn('SUM', col('sortie')), 0), 'total_sorties']],
        group: ['journal_id'], raw: true,
      }),
      Banque.findOne({ where: { tenant_id: tenantId, mois, annee: yr } }),
      ArretCaisse.findAll({ where: { tenant_id: tenantId, mois, annee: yr }, attributes: ['journal_id', 'solde_final', 'arrete_le'], raw: true }),
    ]);

    const ranByJournal = new Map(ranRows.map(r => [r.journal_id, parseFloat(r.montant)]));
    const mvtByJournal = new Map(mvtRows.map(m => [m.journal_id, m]));
    const arretByJournal = new Map(arrets.map(a => [a.journal_id, { solde_arrete: a.solde_final, arrete_le: a.arrete_le }]));

    const rows = [...journaux]
      .sort((a, b) => (a.ordre ?? Infinity) - (b.ordre ?? Infinity) || a.nom.localeCompare(b.nom))
      .map(j => {
        const ran = ranByJournal.get(j.id) || 0;
        const mvt = mvtByJournal.get(j.id) || { total_entrees: 0, total_sorties: 0 };
        const total_entrees = parseFloat(mvt.total_entrees) || 0;
        const total_sorties = parseFloat(mvt.total_sorties) || 0;
        return {
          ...j,
          ran, total_entrees, total_sorties,
          solde_final: ran + total_entrees - total_sorties,
          arrete: arretByJournal.get(j.id) || null,
        };
      });

    res.json({
      journaux: rows,
      banque: {
        solde_initial: parseFloat(banque?.solde_initial) || 0,
        fonds_recus:   parseFloat(banque?.fonds_recus) || 0,
        solde_final:   parseFloat(banque?.solde_final) || 0,
      },
      mois, annee: yr,
    });
  } catch (err) {
    console.error('[Journal] recap :', err.message);
    res.status(500).json({ error: `Erreur serveur : ${err.message}` });
  }
};

// ── GET /api/journal/cumuls ────────────────────────────────────────────────
const getCumuls = async (req, res) => {
  const { mois, annee, journal_id } = req.query;
  try {
    const where = { tenant_id: req.tenantId, mois, annee: parseInt(annee, 10) };
    if (journal_id) where.journal_id = parseInt(journal_id, 10);
    const rows = await Mouvement.findAll({
      where,
      attributes: [
        'rubrique_code', 'type_caisse',
        [fn('COALESCE', fn('SUM', col('entree')), 0), 'total_entrees'],
        [fn('COALESCE', fn('SUM', col('sortie')), 0), 'total_sorties'],
      ],
      group: ['rubrique_code', 'type_caisse'],
      raw: true,
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── GET /api/journal/controle-context?journal_id=&mois=&annee= ──────────
// Snapshot des données nécessaires au pré-contrôle budgétaire hors-ligne
// (miroir de controleBudgetSortie, mais pour toutes les rubriques du mois).
const getControleContext = async (req, res) => {
  const { journal_id, mois, annee } = req.query;
  if (!mois || !annee) return res.status(400).json({ error: 'mois et annee requis.' });
  try {
    const jid = journal_id ? parseInt(journal_id, 10) : null;
    const an  = parseInt(annee, 10);

    const plafondPromise = jid
      ? BudgetCaisse.sum('montant', { where: { tenant_id: req.tenantId, journal_id: jid, mois, annee: an } }).catch(() => 0)
      : Promise.resolve(0);
    const sjPromise = jid
      ? Mouvement.sum('sortie', { where: { tenant_id: req.tenantId, journal_id: jid, mois, annee: an } })
      : Promise.resolve(0);

    const [plafondVal, sjVal, apprRows, srRows] = await Promise.all([
      plafondPromise,
      sjPromise,
      AppelFonds.findAll({
        where: { tenant_id: req.tenantId, mois_cible: mois, annee_cible: an, statut: { [Op.in]: ['approuve', 'partiellement_approuve'] } },
        attributes: ['rubrique_code', [fn('COALESCE', fn('SUM', col('montant_approuve')), 0), 'v']],
        group: ['rubrique_code'], raw: true,
      }),
      Mouvement.findAll({
        where: { tenant_id: req.tenantId, mois, annee: an },
        attributes: ['rubrique_code', [fn('COALESCE', fn('SUM', col('sortie')), 0), 'v']],
        group: ['rubrique_code'], raw: true,
      }),
    ]);

    const approuve_by_rubrique = {};
    apprRows.forEach(r => { approuve_by_rubrique[r.rubrique_code] = parseFloat(r.v) || 0; });
    const sorties_by_rubrique  = {};
    srRows.forEach(r  => { sorties_by_rubrique[r.rubrique_code] = parseFloat(r.v) || 0; });

    res.json({
      journal_id: jid, mois, annee: an,
      plafond:            parseFloat(plafondVal) || 0,
      sorties_journal:    parseFloat(sjVal) || 0,
      approuve_by_rubrique,
      sorties_by_rubrique,
      cached_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Journal] controle-context :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = {
  getJournal, createMouvement, updateMouvement, deleteMouvement,
  getSoldes, getRan, setRan, getCumuls, getJournauxRecap, getControleContext,
};
