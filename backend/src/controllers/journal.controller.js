// src/controllers/journal.controller.js — v2 (journaux dynamiques)
// Route HTTP du journal de caisse. Les règles budgétaires (RG-01 à RG-06) et
// les fonctions de calcul partagées (soldes, RAN, contrôle budgétaire, mise en
// attente) vivent dans services/journal.service.js — ce fichier ne garde que
// la validation des entrées HTTP et le mapping requête → réponse.
const { Op, fn, col } = require('sequelize');
const { resoudreActivite } = require('./activites.controller');
const hebdoSvc = require('../services/budget_hebdo.service');
const projetsSvc = require('../services/projets.service');
const demandesSvc = require('../services/projets_demandes.service');
const ecartsSvc = require('../services/ecarts_caisse.service');

// ── Activité / projet obligatoire (039) ───────────────────────────────────
// Réglage PERSONNEL (users.activite_obligatoire), posé par le directeur.
// Exemptés : virements internes. Sans activité active dans le client : sans
// effet. to_jsonb : neutre tant que la migration 039 n'est pas jouée.
// Activités et projets réservés aux ONG / associations (25/11/2026) : jamais
// exigé pour une PME, même si le réglage avait été posé avant.
const exigerActivite = async (req, rubriqueCode, activiteId) => {
  if (activiteId) return;
  const [r] = await sequelize.query(
    `SELECT (to_jsonb(u)->>'activite_obligatoire')::boolean IS TRUE AS obligatoire,
            EXISTS (SELECT 1 FROM rubriques rb WHERE rb.tenant_id = :t AND rb.code = :code AND rb.est_virement_interne) AS virement,
            EXISTS (SELECT 1 FROM activites a WHERE a.tenant_id = :t AND a.actif) AS a_des_activites,
            tenant_est_ong(:t) AS ong
       FROM users u WHERE u.id = :u`,
    { replacements: { u: req.user.id, t: req.tenantId, code: String(rubriqueCode || '') }, type: sequelize.QueryTypes.SELECT });
  if (r?.obligatoire && r.ong && !r.virement && r.a_des_activites) {
    const err = new Error('Activité / projet obligatoire : choisissez l\'activité ou le projet concerné par cette opération.');
    err.status = 400; err.code = 'ACTIVITE_OBLIGATOIRE';
    throw err;
  }
};
const { sequelize, Mouvement, Journal, Rubrique, ArretCaisse, User, BudgetCaisse, AppelFonds, Ran, Banque } = require('../models');
const {
  moisPrecedent, resolveFiltre, calcSoldeFinal, autoRan,
  typeCaisseDuJournal, enregistrerRan, situationJournaux, MOIS: MOIS_VALIDES,
  mettreEnAttente, controleBudgetSortie, budgetApprouve, disponibleRubrique,
  verifierPeriodeOuverte, verifierSoldeNonNegatif, verifierOrdreChronologique, soldeJournal, ErreurComptable, cle, SQL_CLE, filtreOuverture,
} = require('../services/journal.service');

// Refus comptable (mois arrêté, solde insuffisant) → 409 avec le message clair.
const refusComptable = (res, err) => {
  if (err instanceof ErreurComptable) { res.status(err.status).json({ error: err.message }); return true; }
  return false;
};

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
      Mouvement.findAll({ where, order: [['numero', 'ASC'], ['id', 'ASC']], raw: true }),  // ordre d'enregistrement
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

// Tiers du registre (044) : identifiant facultatif, vérifié sur le client.
const resoudreTiers = async (tenantId, valeur) => {
  if (valeur === undefined || valeur === null || valeur === '') return null;
  const id = parseInt(valeur, 10);
  const err = (m) => Object.assign(new Error(m), { status: 400 });
  if (!Number.isInteger(id) || id <= 0) throw err('Tiers invalide.');
  const [t] = await sequelize.query('SELECT id FROM registre_tiers WHERE id = :id AND tenant_id = :t AND actif',
    { replacements: { id, t: tenantId }, type: sequelize.QueryTypes.SELECT });
  if (!t) throw err('Tiers introuvable dans le registre de ce client.');
  return id;
};

// ── POST /api/journal ─────────────────────────────────────────────────────
const createMouvement = async (req, res) => {
  const { date, mois, annee, journal_id, type_caisse,
          rubrique_code, intitule, objet, beneficiaire,
          piece_identite, telephone, entree, sortie, nui } = req.body;
  // Activité / projet (034) : facultatif, contrôlé avant tout.
  let activiteId = null;
  let tiersId = null;
  try {
    activiteId = await resoudreActivite(req.tenantId, req.body.activite_id);
    // Tiers du registre choisi à la saisie (044). Sans choix, la base
    // rattache l'écriture au tiers de même NUI (ou de même nom).
    tiersId = await resoudreTiers(req.tenantId, req.body.tiers_id);
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.status ? e.message : 'Erreur serveur.' });
  }

  if (!date || !mois || !annee || !rubrique_code) {
    return res.status(400).json({ error: 'Champs obligatoires manquants (date, mois, annee, rubrique_code).' });
  }
  // 061 : les rubriques d'écart de caisse ne se saisissent pas à la main —
  // un écart se constate dans Contrôle comptable → Écarts de caisse.
  try {
    if (await ecartsSvc.estRubriqueEcart(req.tenantId, rubrique_code)) {
      return res.status(409).json({ error: 'Rubrique réservée aux écarts de caisse : constatez l\'écart dans Contrôle comptable → Écarts de caisse.', code: 'RUBRIQUE_ECART_RESERVEE' });
    }
  } catch (e) {
    console.error('[Journal] contrôle rubrique d\'écart :', e.message);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
  // Gestion des activités (083) : décaissement ou reliquat d'une demande de
  // fonds approuvée. L'activité est celle de la demande.
  let lienDemande = null;
  if (req.body.demande_fonds_id) {
    try {
      lienDemande = await demandesSvc.lienCaisse(req.tenantId, req.body.demande_fonds_id,
        { entree, sortie, ordreId: req.body.ordre_decaissement_id, userId: req.user.id });
      activiteId = lienDemande.activiteId;
    } catch (e) {
      if (e instanceof projetsSvc.ErreurProjet) return res.status(e.status).json({ error: e.message, code: e.code });
      console.error('[Journal] demande de fonds :', e.message);
      return res.status(500).json({ error: 'Erreur serveur.' });
    }
  }
  // ONG / association (069) : projet bénéficiaire d'un financement affecté,
  // activité de projet d'une remise de fonds. null pour une PME.
  let projetCtx = null;
  try {
    projetCtx = await projetsSvc.preparerSaisie(req.tenantId, {
      rubriqueCode: rubrique_code, entree, sortie, activiteId,
      projetId: req.body.projet_id, reference: req.body.reference_financement,
    });
  } catch (e) {
    if (e instanceof projetsSvc.ErreurProjet) return res.status(e.status).json({ error: e.message, code: e.code });
    console.error('[Journal] contrôle projet :', e.message);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
  // Activité / projet obligatoire pour cette personne (039). Un financement
  // imputé à un projet n'en a pas besoin : le projet est déjà désigné.
  try {
    if (!projetCtx?.imputation) await exigerActivite(req, rubrique_code, activiteId);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message, code: e.code });
    console.error('[Journal] contrôle activité obligatoire :', e.message);
    return res.status(500).json({ error: 'Erreur serveur.' });
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

  // Contrôles comptables : mois ouvert, et caisse jamais négative.
  // Rattrapage (033) : une personne autorisée par le directeur peut antidater
  // (date antérieure à la dernière écriture) ; l'écriture est alors marquée.
  let antidatee = false;
  try {
    await initialisation.verifierInitialise(req.tenantId);
    await verifierPeriodeOuverte(req.tenantId, jid, mois, an);
    const chrono = await verifierOrdreChronologique(req.tenantId, jid, date,
      { rattrapage: await peut(req, 'journal.rattrapage') });
    antidatee = Boolean(chrono?.antidatee);
    await verifierSoldeNonNegatif(req.tenantId, jid, mois, an, (parseFloat(entree) || 0) - montantSortie);
  } catch (err) {
    if (refusComptable(res, err)) return;
    console.error('[Journal] contrôle comptable :', err.message);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }

  // RG-05 : les contrôles ne s'appliquent qu'aux SORTIES (entrées exemptées).
  // Sortie vers une activité de projet (ONG, 069) : contrôlée par le budget du
  // projet au moment de l'enregistrement, pas par le budget de fonctionnement.
  const sortieProjet = montantSortie > 0 && Boolean(projetCtx?.activiteProjet);
  if (montantSortie > 0 && !sortieProjet) {
    let ctrl;
    try {
      ctrl = await controleBudgetSortie(req.tenantId, {
        mois, annee: an, journal_id: jid, rubrique_code, sortie: montantSortie, date,
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
            rubrique_code, intitule, objet, beneficiaire, piece_identite, telephone, nui,
            activite_id: activiteId, sortie: montantSortie },
          ctrl.motif, { montant_prevu: ctrl.montant_prevu, cumul: ctrl.cumul, semaine: ctrl.semaine });
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
    const valeurs = {
      tenant_id: req.tenantId, date, mois, annee: an,
      journal_id: jid, type_caisse: resolvedCaisse,
      rubrique_code, intitule, objet: objet||'', beneficiaire: beneficiaire||'',
      piece_identite: piece_identite||'', telephone: telephone||'', nui: String(nui||'').slice(0, 30),
      entree: parseFloat(entree)||0, sortie: montantSortie, created_by: req.user.id,
      ...(antidatee ? { rattrapage: true } : {}),
      ...(activiteId ? { activite_id: activiteId } : {}),
      ...(tiersId ? { tiers_id: tiersId } : {}),
    };
    let mouvement;
    let projetInfo = null;
    if (projetCtx?.imputation || sortieProjet || lienDemande) {
      // Écriture + lien projet (ou contrôle du budget du projet, ou lien à la
      // demande de fonds — plafonds contrôlés en base) dans UNE transaction.
      mouvement = await sequelize.transaction(async (t) => {
        if (sortieProjet && !lienDemande) {
          projetInfo = await projetsSvc.controlerSortieProjet(req.tenantId,
            { activiteId: projetCtx.activiteProjet.id, montant: montantSortie }, t);
        }
        const m = await Mouvement.create(valeurs, { transaction: t });
        if (lienDemande) {
          await demandesSvc.relierMouvement(req.tenantId, lienDemande, m.id, req.user.id, t);
          projetInfo = { demande_fonds_id: String(lienDemande.demandeId), sens: lienDemande.sens };
        }
        if (projetCtx?.imputation) {
          await projetsSvc.enregistrerImputation(req.tenantId,
            { journalId: m.id, imputation: projetCtx.imputation, userId: req.user.id }, t);
          projetInfo = { projet_id: projetCtx.imputation.projetId };
        }
        return m;
      });
    } else {
      mouvement = await Mouvement.create(valeurs);
    }
    if (antidatee) {
      sequelize.query(
        `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, nouvelle_valeur)
         VALUES (:t, :u, 'SAISIE_RATTRAPAGE', 'journal', :id, CAST(:v AS jsonb))`,
        { replacements: { t: req.tenantId, u: req.user.id, id: String(mouvement.id),
          v: JSON.stringify({ numero: mouvement.numero, date, journal_id: jid }) } }).catch(() => {});
    }
    res.status(201).json({ ...mouvement.toJSON(), budget_warning: budgetWarning, ...(projetInfo ? { projet: projetInfo } : {}) });
  } catch (err) {
    if (err instanceof projetsSvc.ErreurProjet) return res.status(err.status).json({ error: err.message, code: err.code });
    const e = demandesSvc.traduire(err);
    if (e instanceof projetsSvc.ErreurProjet) return res.status(e.status).json({ error: e.message, code: e.code });
    console.error('[Journal] createMouvement :', err.message);
    res.status(500).json({ error: `Erreur serveur : ${err.message}` });
  }
};

// ── PUT /api/journal/:id ──────────────────────────────────────────────────
// Écriture intangible (migration 027) : seuls les champs DESCRIPTIFS se
// corrigent (libellé, objet, bénéficiaire, pièce d'identité, téléphone).
// Montant, date, rubrique ou caisse erronés → annulation puis nouvelle saisie.
const CHAMPS_DESCRIPTIFS = ['intitule', 'objet', 'beneficiaire', 'piece_identite', 'telephone', 'nui'];
const updateMouvement = async (req, res) => {
  const id = req.params.id;
  try {
    const old = await Mouvement.findOne({ where: { id, tenant_id: req.tenantId }, raw: true });
    if (!old) return res.status(404).json({ error: 'Mouvement introuvable.' });
    if (old.annule || old.annulation_de_id) {
      return res.status(409).json({ error: 'Écriture annulée ou d\'annulation : elle ne se modifie plus.' });
    }
    const b = req.body || {};
    const num = (v) => parseFloat(v) || 0;
    const changeMontant = (b.entree !== undefined && num(b.entree) !== num(old.entree))
      || (b.sortie !== undefined && num(b.sortie) !== num(old.sortie))
      || (b.rubrique_code !== undefined && b.rubrique_code !== old.rubrique_code)
      || (b.date !== undefined && String(b.date).slice(0, 10) !== String(old.date).slice(0, 10));
    if (changeMontant) {
      return res.status(409).json({
        error: `Le montant, la date ou la rubrique de l'écriture n°${old.numero} ne se modifient pas : demandez son annulation (contre-passation) puis ressaisissez l'écriture correcte.`,
        code: 'ANNULATION_REQUISE',
      });
    }
    await verifierPeriodeOuverte(req.tenantId, old.journal_id, old.mois, old.annee);
    const maj = {};
    for (const c of CHAMPS_DESCRIPTIFS) if (b[c] !== undefined) maj[c] = String(b[c] ?? '').slice(0, c === 'intitule' ? 250 : 200);
    // Le classement par activité / projet (034) se corrige comme un descriptif.
    if (b.activite_id !== undefined) {
      const nouv = await resoudreActivite(req.tenantId, b.activite_id);
      if ((nouv || null) !== (old.activite_id || null)) {
        // 069 : un rattachement à un projet (ONG) ne se corrige pas en place.
        await projetsSvc.verifierChangementActivite(req.tenantId, old.activite_id || null, nouv || null);
        if (!nouv) await exigerActivite(req, old.rubrique_code, null);   // 039 : pas de retrait
        maj.activite_id = nouv;
      }
    }
    // Tiers du registre (044) : choix explicite ; sinon la base ré-identifie
    // le tiers si le NUI ou le bénéficiaire change.
    if (b.tiers_id !== undefined) {
      const t = await resoudreTiers(req.tenantId, b.tiers_id);
      if ((t || null) !== (old.tiers_id ? Number(old.tiers_id) : null)) maj.tiers_id = t;
    }
    if (maj.intitule !== undefined && !maj.intitule.trim()) return res.status(400).json({ error: 'Le libellé est obligatoire.' });
    const [, rows] = await Mouvement.update(maj, { where: { id, tenant_id: req.tenantId }, returning: true });
    const avant = Object.fromEntries(Object.keys(maj).map((k) => [k, old[k]]));
    await sequelize.query(
      `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, ancienne_valeur, nouvelle_valeur)
       VALUES (:t, :u, 'MODIF_DESCRIPTIF_ECRITURE', 'journal', :id, CAST(:av AS jsonb), CAST(:ap AS jsonb))`,
      { replacements: { t: req.tenantId, u: req.user.id, id: String(id), av: JSON.stringify(avant), ap: JSON.stringify(maj) } });
    res.json(rows[0]);
  } catch (err) {
    if (refusComptable(res, err)) return;
    if (err instanceof projetsSvc.ErreurProjet) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error('[Journal] updateMouvement :', err.message);
    res.status(500).json({ error: `Erreur serveur : ${err.message}` });
  }
};

// ── DELETE /api/journal/:id — interdit (intégrité) ──────────────────────────
const deleteMouvement = async (req, res) => {
  res.status(409).json({
    error: 'Une écriture de caisse ne se supprime pas : utilisez « Annuler » (contre-passation), qui garde la trace et la numérotation.',
    code: 'ANNULATION_REQUISE',
  });
};

// ── Annulation (contre-passation) ──────────────────────────────────────────
const annulation = require('../services/annulation.service');
const { userHasPermission } = require('../services/permission.service');
const peut = (req, code) => userHasPermission({ tenantId: req.tenantId, userId: req.user.id, role: req.user.role }, code);

// POST /api/journal/:id/annulation { motif } — annule (directeur) ou demande (caissière)
const annulerMouvement = async (req, res) => {
  try {
    const peutAnnuler = await peut(req, 'journal.annuler');
    if (!peutAnnuler && !(await peut(req, 'journal.annulation_demander'))) {
      return res.status(403).json({ error: 'Permission requise : demander l\'annulation d\'une écriture.' });
    }
    const r = await annulation.demanderOuAnnuler({
      tenantId: req.tenantId, user: req.user, mouvementId: req.params.id, motif: req.body?.motif, peutAnnuler,
    });
    res.status(r.annule ? 201 : 202).json(r);
  } catch (err) {
    if (refusComptable(res, err)) return;
    console.error('[Journal] annulation :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};
// POST /api/journal/:id/impression — enregistre l'impression du bon de caisse
// et renvoie tout ce qu'il faut pour l'imprimer (données serveur, pas d'écran).
// 1re impression = ORIGINAL, les suivantes = DUPLICATA n°x.
const imprimerBon = async (req, res) => {
  try {
    const [row] = await sequelize.query(
      `UPDATE journal SET nb_impressions = nb_impressions + 1, derniere_impression_le = NOW()
        WHERE id = :id AND tenant_id = :t RETURNING id`,
      { replacements: { id: req.params.id, t: req.tenantId }, type: sequelize.QueryTypes.SELECT });
    if (!row) return res.status(404).json({ error: 'Écriture introuvable.' });
    const [m] = await sequelize.query(
      `SELECT j.id, j.numero, j.date, j.mois, j.annee, j.type_caisse, j.rubrique_code, j.intitule, j.objet,
              j.beneficiaire, j.piece_identite, j.telephone, to_jsonb(j)->>'nui' AS nui, j.entree, j.sortie, j.annule, j.annulation_de_id,
              j.motif_annulation, j.nb_impressions, j.created_at, to_jsonb(j)->>'rattrapage' AS rattrapage,
              jx.nom AS journal_nom, jx.code AS journal_code, jx.type AS journal_type,
              r.intitule AS rubrique_libelle, u.username AS saisi_par,
              o.numero AS numero_origine, a.numero AS numero_annulation, t.nom AS tenant_nom, t.sigle AS tenant_sigle, t.adresse AS tenant_adresse, t.boite_postale AS tenant_bp,
              t.nui AS tenant_nui, t.registre_commerce AS tenant_rc, t.logo_url AS tenant_logo, t.devise,
              to_jsonb(t)->>'telephone' AS tenant_tel, to_jsonb(t)->>'email' AS tenant_email,
              -- 065 : directeur signataire de la caisse, à défaut le représentant légal.
              t.caissier_nom, COALESCE(NULLIF(t.directeur_nom, ''), t.dirigeant_nom) AS directeur_nom
         FROM journal j
         LEFT JOIN journaux jx ON jx.id = j.journal_id
         LEFT JOIN rubriques r ON r.code = j.rubrique_code AND r.tenant_id = j.tenant_id
         LEFT JOIN users u ON u.id = j.created_by
         LEFT JOIN journal o ON o.id = j.annulation_de_id
         LEFT JOIN journal a ON a.id = j.annule_par_id
         LEFT JOIN tenants t ON t.id = j.tenant_id
        WHERE j.id = :id`,
      { replacements: { id: row.id }, type: sequelize.QueryTypes.SELECT });
    if (m.nb_impressions > 1) {
      sequelize.query(
        `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, nouvelle_valeur)
         VALUES (:t, :u, 'REIMPRESSION_BON', 'journal', :id, CAST(:v AS jsonb))`,
        { replacements: { t: req.tenantId, u: req.user.id, id: String(m.id),
          v: JSON.stringify({ numero: m.numero, duplicata: m.nb_impressions - 1 }) } }).catch(() => {});
    }
    res.json({ ...m, imprime_par: req.user.username });
  } catch (err) {
    console.error('[Journal] impression bon :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};
// ── Initialisation guidée du compte (migration 029) ───────────────────────
const initialisation = require('../services/initialisation.service');
// GET /api/initialisation — l'espace doit-il encore être initialisé ?
const getInitialisation = async (req, res) => {
  try {
    const e = await initialisation.etat({ tenantId: req.tenantId });
    const peutInitialiser = e.requise
      ? (req.user.role === 'directeur' || ((await peut(req, 'journaux.edit')) && (await peut(req, 'journal.ran'))))
      : false;
    res.json({ ...e, peut_initialiser: peutInitialiser });
  } catch (err) {
    console.error('[Initialisation] état :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};
// POST /api/initialisation { mois, annee, caisses: [{ type, nom, ran }] }
const postInitialisation = async (req, res) => {
  try {
    const autorise = req.user.role === 'directeur' || ((await peut(req, 'journaux.edit')) && (await peut(req, 'journal.ran')));
    if (!autorise) return res.status(403).json({ error: 'Seul le directeur de l\'espace peut initialiser le compte.' });
    res.status(201).json(await initialisation.initialiser({ tenantId: req.tenantId, user: req.user, body: req.body }));
  } catch (err) {
    if (refusComptable(res, err)) return;
    console.error('[Initialisation] :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};
// GET /api/journal/annulations?statut=en_attente|approuvee|refusee|toutes
const listerAnnulations = async (req, res) => {
  try { res.json(await annulation.lister({ tenantId: req.tenantId, statut: String(req.query.statut || 'en_attente') })); }
  catch (err) { console.error('[Journal] annulations :', err.message); res.status(500).json({ error: 'Erreur serveur.' }); }
};
// PATCH /api/journal/annulations/:id { decision: approuver|refuser, commentaire }
const deciderAnnulation = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!(id > 0)) return res.status(400).json({ error: 'Identifiant invalide.' });
    res.json(await annulation.decider({ tenantId: req.tenantId, user: req.user, demandeId: id, decision: req.body?.decision, commentaire: req.body?.commentaire }));
  } catch (err) {
    if (refusComptable(res, err)) return;
    console.error('[Journal] décision annulation :', err.message);
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
    const etat = filtre.journal_id ? await etatSaisieRan(req.tenantId, filtre.journal_id, mois, an) : { modifiable: true };
    res.json({
      ...etat,
      montant,
      mois_precedent:   prev.mois,
      annee_precedente: prev.annee,
      solde_precedent:  soldePrev.solde,
    });
  } catch (err) {
    if (err.message === 'Journal introuvable.') return res.status(404).json({ error: 'Journal introuvable pour ce client.' });
    console.error('[Journal] getRan :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── RAN : saisie limitée au solde d'OUVERTURE (décision du 05/10/2026) ───
// Le RAN ne se saisit qu'au premier mois d'activité d'un journal. Ensuite il
// vaut toujours le solde final du mois précédent (calculé) : on ne peut plus
// créer d'écart de report. Une correction se fait par une écriture.
const etatSaisieRan = async (tenantId, journalId, mois, annee) => {
  const k = cle(mois, annee);
  const q = (sql, r) => sequelize.query(sql, { replacements: { t: tenantId, j: journalId, k, ...r }, type: sequelize.QueryTypes.SELECT });
  const [avant] = await q(`SELECT mois, annee FROM journal WHERE tenant_id = :t AND journal_id = :j AND ${SQL_CLE} < :k ORDER BY ${SQL_CLE} LIMIT 1`);
  if (avant) {
    const prev = moisPrecedent(mois, annee);
    return { modifiable: false, raison: `Le RAN de ${mois} ${annee} est le solde final de ${prev.mois} ${prev.annee}, calculé automatiquement : `
      + `il ne se saisit qu'à l'ouverture de la caisse (des écritures existent depuis ${avant.mois} ${avant.annee}). `
      + 'Pour corriger un solde, passez une écriture dans le mois concerné.' };
  }
  const [arret] = await q(`SELECT mois, annee FROM arrets_caisse WHERE tenant_id = :t AND journal_id = :j AND ${SQL_CLE} >= :k LIMIT 1`).catch(() => []);
  if (arret) {
    return { modifiable: false, raison: `La caisse est arrêtée pour ${arret.mois} ${arret.annee} : le solde d'ouverture ne peut plus être modifié. Faites d'abord réouvrir la caisse.` };
  }
  return { modifiable: true, raison: '' };
};

// Un seul solde d'ouverture par journal : l'ancien (autre mois) est neutralisé
// (conservé en 'report', jamais supprimé), celui du mois saisi est créé/mis à jour.
const enregistrerOuverture = async ({ tenantId, journalId, mois, annee, typeCaisse, montant }) => {
  const avecOrigine = Boolean(await filtreOuverture());
  await sequelize.transaction(async (t) => {
    const opts = { replacements: { t: tenantId, j: journalId, mois, annee, tc: typeCaisse, m: montant }, transaction: t };
    if (avecOrigine) {
      await sequelize.query(`UPDATE ran SET origine = 'report' WHERE tenant_id = :t AND journal_id = :j
                               AND origine = 'ouverture' AND NOT (mois = :mois AND annee = :annee)`, opts);
      const maj = await sequelize.query(`UPDATE ran SET montant = :m, origine = 'ouverture', type_caisse = :tc
                               WHERE tenant_id = :t AND journal_id = :j AND mois = :mois AND annee = :annee RETURNING id`,
      { ...opts, type: sequelize.QueryTypes.SELECT });
      if (maj.length === 0) {
        await sequelize.query(`INSERT INTO ran (tenant_id, mois, annee, journal_id, type_caisse, montant, origine)
                               VALUES (:t, :mois, :annee, :j, :tc, :m, 'ouverture')`, opts);
      }
    } else {
      await enregistrerRan({ tenantId, mois, annee, journalId, typeCaisse, montant });
    }
  });
};

// ── POST /api/journal/ran — saisie manuelle ──────────────────────────────
const setRan = async (req, res) => {
  const { mois, annee, caisse, journal_id, montant } = req.body;
  if (!req.tenantId) return res.status(400).json({ error: 'Client requis.' });
  const an = parseInt(annee, 10);
  const valeur = Number(montant);
  if (!MOIS_VALIDES.includes(mois) || !an) return res.status(400).json({ error: 'Mois ou année invalide.' });
  if (!Number.isFinite(valeur) || valeur < 0) return res.status(400).json({ error: 'Montant invalide.' });

  try {
    let journalId = null;
    let typeCaisse = caisse === 'om' ? 'om' : 'especes';

    if (journal_id) {
      journalId = parseInt(journal_id, 10);
      // Le journal doit appartenir au client ; son type de caisse est décidé
      // ICI, pas par le frontend.
      const journal = await Journal.findOne({ where: { id: journalId, tenant_id: req.tenantId }, attributes: ['id', 'type'], raw: true });
      if (!journal) return res.status(404).json({ error: 'Journal introuvable pour ce client.' });
      // Journal banque : RAN saisi comme pour les autres journaux.
      typeCaisse = typeCaisseDuJournal(journal.type);
      const etat = await etatSaisieRan(req.tenantId, journalId, mois, an);
      if (!etat.modifiable) return res.status(409).json({ error: etat.raison });
      await enregistrerOuverture({ tenantId: req.tenantId, journalId, mois, annee: an, typeCaisse, montant: valeur });
      return res.json({ message: 'Solde d\'ouverture enregistré.' });
    }

    await enregistrerRan({ tenantId: req.tenantId, mois, annee: an, journalId, typeCaisse, montant: valeur });
    res.json({ message: 'RAN mis à jour.' });
  } catch (err) {
    console.error('[Journal] setRan :', err.code || '', err.message, err.parent?.detail || '');
    if (err.code === 'CONTRAINTE_RAN_OBSOLETE') {
      return res.status(409).json({
        error: 'La base n\'autorise encore qu\'un seul RAN par type de caisse et par mois. '
             + 'Appliquez les migrations (redémarrage de l\'application ou /api/admin/setup), puis réessayez.',
      });
    }
    res.status(500).json({ error: 'Erreur serveur lors de l\'enregistrement du RAN.' });
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
    const [journaux, banque] = await Promise.all([
      Journal.findAll({
        // Journal banque inclus : il se lit comme les autres caisses.
        where: { tenant_id: tenantId, actif: true },
        attributes: ['id', 'nom', 'code', 'type', 'ordre'], raw: true,
      }),
      Banque.findOne({ where: { tenant_id: tenantId, mois, annee: yr } }),
    ]);
    // Même calcul que la page journal et le tableau de bord (RAN reporté du
    // mois précédent quand aucun RAN n'est enregistré — il valait 0 ici).
    const tries = [...journaux]
      .sort((a, b) => (a.ordre ?? Infinity) - (b.ordre ?? Infinity) || a.nom.localeCompare(b.nom));
    const rows = (await situationJournaux(tenantId, mois, yr, tries)).map((r) => ({
      ...r,
      arrete: r.arrete ? { solde_arrete: r.arrete.solde_arrete, arrete_le: r.arrete.arrete_le } : null,
    }));

    res.json({
      journaux: rows,
      // Ancienne saisie banque : affichée seulement sans journal banque.
      banque: journaux.some((j) => j.type === 'banque') ? { solde_initial: 0, fonds_recus: 0, solde_final: 0 } : {
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
// ── GET /api/journal/disponible?date=&mois=&annee=&rubrique_code=&journal_id= ──
// Reste disponible d'une rubrique, affiché pendant la saisie d'une sortie
// (semaine en cours avec report pour un budget hebdomadaire, sinon le mois).
const getDisponible = async (req, res) => {
  const { date, mois, annee, rubrique_code, journal_id } = req.query;
  if (!date || !mois || !annee || !rubrique_code) return res.status(400).json({ error: 'date, mois, annee et rubrique_code requis.' });
  try {
    res.json(await disponibleRubrique(req.tenantId, { date, mois, annee, rubrique_code, journal_id }));
  } catch (err) {
    if (err instanceof hebdoSvc.ErreurMetier) return res.status(err.status).json({ error: err.message });
    console.error('[Journal] disponible :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

const getControleContext = async (req, res) => {
  const { journal_id, mois, annee } = req.query;
  if (!mois || !annee) return res.status(400).json({ error: 'mois et annee requis.' });
  try {
    const jid = journal_id ? parseInt(journal_id, 10) : null;
    const an  = parseInt(annee, 10);
    // ONG (069) : les remises de fonds aux activités de projet ne comptent pas
    // dans le budget de fonctionnement — même règle que le contrôle serveur.
    const exclureProjets = await projetsSvc.exclureProjetsDuFonctionnement(req.tenantId);
    const horsProjets = exclureProjets ? { [Op.and]: [sequelize.literal(projetsSvc.SQL_HORS_PROJETS)] } : {};
    const sqlHorsProjets = exclureProjets ? ` AND ${projetsSvc.sqlHorsProjets('journal')}` : '';

    const plafondPromise = jid
      ? BudgetCaisse.sum('montant', { where: { tenant_id: req.tenantId, journal_id: jid, mois, annee: an } }).catch(() => 0)
      : Promise.resolve(0);
    const sjPromise = jid
      ? Mouvement.sum('sortie', { where: { tenant_id: req.tenantId, journal_id: jid, mois, annee: an, ...horsProjets } })
      : Promise.resolve(0);

    const [plafondVal, sjVal, apprRows, srRows] = await Promise.all([
      plafondPromise,
      sjPromise,
      budgetApprouve(req.tenantId, mois, an),
      Mouvement.findAll({
        where: { tenant_id: req.tenantId, mois, annee: an, ...horsProjets },
        attributes: ['rubrique_code', [fn('COALESCE', fn('SUM', col('sortie')), 0), 'v']],
        group: ['rubrique_code'], raw: true,
      }),
    ]);

    // Même source que le contrôle serveur (demande de fonds validée du mois).
    const approuve_by_rubrique = Object.fromEntries(apprRows.parRubrique);
    const sorties_by_rubrique  = {};
    srRows.forEach(r  => { sorties_by_rubrique[r.rubrique_code] = parseFloat(r.v) || 0; });

    // Budget hebdomadaire (040) : cumuls par semaine pour le pré-contrôle hors ligne.
    let hebdoCtx = null;
    if (await hebdoSvc.estHebdo(req.tenantId, mois, an)) {
      const semaines = hebdoSvc.semainesDuMois(mois, an);
      const [parJour, plafonds, valides] = await Promise.all([
        sequelize.query(
          `SELECT rubrique_code, journal_id, date::text AS date, COALESCE(SUM(sortie), 0) AS v
             FROM journal WHERE tenant_id = :t AND mois = :m AND annee = :a AND sortie > 0${sqlHorsProjets}
            GROUP BY rubrique_code, journal_id, date`,
          { replacements: { t: req.tenantId, m: mois, a: an }, type: sequelize.QueryTypes.SELECT }),
        jid ? BudgetCaisse.findAll({ where: { tenant_id: req.tenantId, journal_id: jid, mois, annee: an }, attributes: ['semaine', 'montant'], raw: true }) : [],
        Promise.all(semaines.map((x) => budgetApprouve(req.tenantId, mois, an, { semaine: x.num }))),
      ]);
      hebdoCtx = { semaines: semaines.map((x, i) => {
        const jusque = parJour.filter((r) => r.date.slice(0, 10) <= x.fin);
        const sorties = {};
        jusque.forEach((r) => { sorties[r.rubrique_code] = (sorties[r.rubrique_code] || 0) + (parseFloat(r.v) || 0); });
        return {
          num: x.num, debut: x.debut, fin: x.fin, valide: valides[i].valide,
          approuve_cumul: Object.fromEntries(valides[i].parRubrique),
          sorties_cumul: sorties,
          plafond_cumul: plafonds.filter((b) => b.semaine && b.semaine <= x.num).reduce((t, b) => t + (parseFloat(b.montant) || 0), 0),
          sorties_journal_cumul: jusque.filter((r) => jid && Number(r.journal_id) === jid).reduce((t, r) => t + (parseFloat(r.v) || 0), 0),
        };
      }) };
    }

    res.json({
      journal_id: jid, mois, annee: an,
      hebdo: hebdoCtx,
      plafond:            parseFloat(plafondVal) || 0,
      sorties_journal:    parseFloat(sjVal) || 0,
      approuve_by_rubrique,
      budget_valide: apprRows.valide,
      sorties_by_rubrique,
      cached_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Journal] controle-context :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = {
  getJournal, createMouvement, updateMouvement, deleteMouvement, annulerMouvement, listerAnnulations, deciderAnnulation, imprimerBon, getInitialisation, postInitialisation,
  getSoldes, getRan, setRan, getCumuls, getJournauxRecap, getControleContext, getDisponible,
};
