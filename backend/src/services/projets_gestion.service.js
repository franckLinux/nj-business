// src/services/projets_gestion.service.js — Menu « Projets » (lot P2, ONG / ASSOC)
//
// Projets, activités, désignations, budget (chargement → soumission →
// validation par le directeur) et chiffres de suivi. Aucune table nouvelle :
// tout repose sur la migration 069.
//
// Périmètre (contrôlé ici, jamais par l'écran) :
//   • projets.voir (directeur, comptable)  → tous les projets ;
//   • chef de projet désigné               → ses projets ;
//   • responsable d'activité désigné        → ses activités seulement
//                                             (pas les financements du projet).
// Gestion d'un projet (activités, budget) : projets.gerer, ou son chef de projet.
// Validation / rejet du budget : budgets_projet.valider.
//
// Montants, toujours relus dans le journal (jamais recopiés) :
//   reçu   = entrées imputées au projet, non annulées ;
//   alloué = sorties vers les activités du projet, hors écritures annulées et
//            contre-passations.
const { sequelize } = require('../models');
const { userHasPermission } = require('./permission.service');
const notif = require('./notification.service');
const { ErreurProjet, estOng } = require('./projets.service');

const SELECT = sequelize.QueryTypes.SELECT;
const q = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: SELECT, transaction });
const n = (v) => (v === null || v === undefined ? 0 : parseFloat(v) || 0);
const err = (status, message, code) => new ErreurProjet(status, message, code);

const FILTRE_REEL = 'NOT COALESCE(j.annule, false) AND j.annulation_de_id IS NULL';

// ── Droits et périmètre ─────────────────────────────────────────────────────
const droits = async (req) => {
  const ctx = { tenantId: req.tenantId, userId: req.user.id, role: req.user.role };
  const [voirTous, gerer, valider, valJustif] = await Promise.all([
    userHasPermission(ctx, 'projets.voir'), userHasPermission(ctx, 'projets.gerer'),
    userHasPermission(ctx, 'budgets_projet.valider'), userHasPermission(ctx, 'justificatifs.valider'),
  ]);
  const chef = (await q(
    `SELECT id FROM activites WHERE tenant_id = :t AND type = 'projet' AND chef_projet_id = :u`,
    { t: req.tenantId, u: req.user.id })).map((r) => Number(r.id));
  const resp = await q(
    `SELECT id, projet_id FROM activites WHERE tenant_id = :t AND projet_id IS NOT NULL AND responsable_id = :u`,
    { t: req.tenantId, u: req.user.id });
  return {
    voirTous: voirTous || gerer, gerer, valider, validerJustificatifs: valJustif,
    chef, responsable: resp.map((r) => Number(r.id)),
    projetsResponsable: [...new Set(resp.map((r) => Number(r.projet_id)))],
  };
};

// Ce que l'utilisateur peut faire sur UN projet.
const accesProjet = (d, projet) => {
  const id = Number(projet.id);
  const estChef = d.chef.includes(id);
  const voirTout = d.voirTous || estChef;
  return {
    voir: voirTout || d.projetsResponsable.includes(id),
    voirTout,                       // financements, toutes les activités
    gerer: d.gerer || estChef,      // activités, budget
    valider: d.valider,
    estChef,
  };
};

const exigerOng = async (tenantId) => {
  if (!(await estOng(tenantId))) {
    throw err(403, 'Le suivi des projets est réservé aux ONG et associations.', 'PROJETS_RESERVES_ONG');
  }
};

// ── Lecture ─────────────────────────────────────────────────────────────────
// Chiffres par activité de projet (budget validé, alloué).
const chiffresActivites = (tenantId, projetIds) => q(
  `SELECT a.id, a.projet_id, a.code, a.nom, a.actif, a.responsable_id, u.username AS responsable_nom,
          l.montant AS budget,
          (SELECT COALESCE(SUM(j.sortie), 0) FROM journal j
            WHERE j.tenant_id = a.tenant_id AND j.activite_id = a.id AND ${FILTRE_REEL}) AS alloue,
          (SELECT COUNT(*)::int FROM journal j
            WHERE j.tenant_id = a.tenant_id AND j.activite_id = a.id AND j.sortie > 0 AND ${FILTRE_REEL}) AS nb_remises
     FROM activites a
     LEFT JOIN users u ON u.id = a.responsable_id
     LEFT JOIN projet_budgets b ON b.projet_id = a.projet_id AND b.statut = 'valide'
     LEFT JOIN projet_budget_lignes l ON l.budget_id = b.id AND l.activite_id = a.id
    WHERE a.tenant_id = :t AND a.projet_id IN (:ids)
    ORDER BY a.actif DESC, lower(a.nom)`, { t: tenantId, ids: projetIds.length ? projetIds : [0] });

const formerActivite = (a) => {
  const budget = a.budget === null ? null : n(a.budget);
  const alloue = n(a.alloue);
  return {
    id: Number(a.id), projet_id: Number(a.projet_id), code: a.code, nom: a.nom, actif: a.actif,
    responsable_id: a.responsable_id, responsable_nom: a.responsable_nom,
    budget, alloue, reste: budget === null ? null : budget - alloue, nb_remises: a.nb_remises,
  };
};

/** Liste des projets visibles, avec leurs chiffres, et les budgets à valider. */
const lister = async (req) => {
  await exigerOng(req.tenantId);
  const d = await droits(req);
  const projets = await q(
    `SELECT p.id, p.code, p.nom, p.description, p.date_debut, p.date_fin, p.actif, p.chef_projet_id, u.username AS chef_nom,
            (SELECT COALESCE(SUM(j.entree), 0) FROM journal_imputations_projet i JOIN journal j ON j.id = i.journal_id
              WHERE i.projet_id = p.id AND NOT COALESCE(j.annule, false)) AS recu,
            (SELECT COUNT(*)::int FROM journal_imputations_projet i JOIN journal j ON j.id = i.journal_id
              WHERE i.projet_id = p.id AND NOT COALESCE(j.annule, false)) AS nb_financements,
            (SELECT jsonb_build_object('id', b.id, 'version', b.version, 'decide_le', b.decide_le)
               FROM projet_budgets b WHERE b.projet_id = p.id AND b.statut = 'valide') AS budget_valide,
            (SELECT jsonb_build_object('id', b.id, 'version', b.version, 'statut', b.statut, 'soumis_le', b.soumis_le)
               FROM projet_budgets b WHERE b.projet_id = p.id AND b.statut IN ('brouillon', 'soumis')) AS budget_ouvert,
            (SELECT jsonb_build_object('id', b.id, 'version', b.version, 'motif_rejet', b.motif_rejet)
               FROM projet_budgets b WHERE b.projet_id = p.id AND b.statut = 'rejete'
              ORDER BY b.version DESC LIMIT 1) AS dernier_rejet
       FROM activites p
       LEFT JOIN users u ON u.id = p.chef_projet_id
      WHERE p.tenant_id = :t AND p.type = 'projet'
      ORDER BY p.actif DESC, lower(p.nom)`, { t: req.tenantId });
  const visibles = projets.filter((p) => accesProjet(d, p).voir);
  const acts = (await chiffresActivites(req.tenantId, visibles.map((p) => Number(p.id)))).map(formerActivite);

  const liste = visibles.map((p) => {
    const acc = accesProjet(d, p);
    const mesActs = acts.filter((a) => a.projet_id === Number(p.id) && (acc.voirTout || d.responsable.includes(a.id)));
    const budget = mesActs.reduce((s, a) => s + (a.budget || 0), 0);
    const alloue = mesActs.reduce((s, a) => s + a.alloue, 0);
    const recu = acc.voirTout ? n(p.recu) : null;
    return {
      id: Number(p.id), code: p.code, nom: p.nom, description: p.description, date_debut: p.date_debut, date_fin: p.date_fin,
      actif: p.actif, chef_projet_id: p.chef_projet_id, chef_nom: p.chef_nom,
      budget_valide: p.budget_valide, budget_ouvert: p.budget_ouvert, dernier_rejet: p.dernier_rejet,
      montant_budget: p.budget_valide ? budget : 0, recu, alloue,
      disponible: recu === null ? null : recu - alloue,
      reste_a_recevoir: recu === null || !p.budget_valide ? null : Math.max(budget - recu, 0),
      nb_activites: mesActs.length, nb_financements: acc.voirTout ? p.nb_financements : null,
      acces: { voir_tout: acc.voirTout, gerer: acc.gerer, chef: acc.estChef, responsable: !acc.voirTout },
    };
  });

  const aValider = d.valider ? await q(
    `SELECT b.id, b.projet_id, b.version, b.soumis_le, p.nom AS projet_nom, u.username AS soumis_par_nom,
            (SELECT COALESCE(SUM(l.montant), 0) FROM projet_budget_lignes l WHERE l.budget_id = b.id) AS montant
       FROM projet_budgets b JOIN activites p ON p.id = b.projet_id LEFT JOIN users u ON u.id = b.soumis_par
      WHERE b.tenant_id = :t AND b.statut = 'soumis' ORDER BY b.soumis_le`, { t: req.tenantId }) : [];

  return {
    projets: liste,
    a_valider: aValider.map((b) => ({ ...b, id: Number(b.id), projet_id: Number(b.projet_id), montant: n(b.montant) })),
    droits: { voir_tous: d.voirTous, gerer: d.gerer, valider: d.valider, valider_justificatifs: d.validerJustificatifs },
  };
};

/** Projet chargé et contrôlé pour l'utilisateur ; 404 si hors périmètre. */
const chargerProjet = async (req, projetId, { gerer = false } = {}) => {
  await exigerOng(req.tenantId);
  const id = parseInt(projetId, 10);
  const [p] = await q(
    `SELECT p.*, u.username AS chef_nom FROM activites p LEFT JOIN users u ON u.id = p.chef_projet_id
      WHERE p.id = :id AND p.tenant_id = :t AND p.type = 'projet'`, { id: Number.isInteger(id) ? id : 0, t: req.tenantId });
  if (!p) throw err(404, 'Projet introuvable.', 'PROJET_INTROUVABLE');
  const d = await droits(req);
  const acc = accesProjet(d, p);
  if (!acc.voir) throw err(404, 'Projet introuvable.', 'PROJET_INTROUVABLE');
  if (gerer && !acc.gerer) throw err(403, 'Seul le chef de ce projet (ou la direction) peut le modifier.', 'PROJET_NON_AUTORISE');
  return { projet: p, acces: acc, droits: d };
};

/** Fiche détaillée d'un projet. */
const detail = async (req, projetId) => {
  const { projet: p, acces: acc, droits: d } = await chargerProjet(req, projetId);
  const toutes = (await chiffresActivites(req.tenantId, [Number(p.id)])).map(formerActivite);
  const activites = acc.voirTout ? toutes : toutes.filter((a) => d.responsable.includes(a.id));

  const budgets = await q(
    `SELECT b.id, b.version, b.statut, b.commentaire, b.motif_rejet, b.cree_le, b.soumis_le, b.decide_le,
            uc.username AS cree_par_nom, us.username AS soumis_par_nom, ud.username AS decide_par_nom,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('activite_id', l.activite_id, 'montant', l.montant) ORDER BY l.id)
                        FROM projet_budget_lignes l WHERE l.budget_id = b.id), '[]'::jsonb) AS lignes
       FROM projet_budgets b
       LEFT JOIN users uc ON uc.id = b.cree_par LEFT JOIN users us ON us.id = b.soumis_par LEFT JOIN users ud ON ud.id = b.decide_par
      WHERE b.projet_id = :p ORDER BY b.version DESC`, { p: p.id });
  const idsVisibles = new Set(activites.map((a) => a.id));
  const budgetsVus = budgets.map((b) => {
    const lignes = b.lignes.map((l) => ({ activite_id: Number(l.activite_id), montant: n(l.montant) }))
      .filter((l) => acc.voirTout || idsVisibles.has(l.activite_id));
    return { ...b, id: Number(b.id), lignes, total: lignes.reduce((s, l) => s + l.montant, 0) };
  });

  let financements = [];
  if (acc.voirTout) {
    financements = await q(
      `SELECT j.id, j.numero, j.date, j.rubrique_code, j.intitule, j.objet, j.beneficiaire, j.entree, j.annule, j.motif_annulation,
              jx.code AS journal_code, jx.nom AS journal_nom, j.journal_id,
              i.nature_recette, i.reference_financement, i.impute_le, u.username AS saisi_par,
              (SELECT e.compte FROM equivalences_comptables e JOIN rubriques r ON r.id = e.rubrique_id
                WHERE r.tenant_id = j.tenant_id AND r.code = j.rubrique_code AND e.statut = 'valide' LIMIT 1) AS compte
         FROM journal_imputations_projet i
         JOIN journal j ON j.id = i.journal_id
         LEFT JOIN journaux jx ON jx.id = j.journal_id
         LEFT JOIN users u ON u.id = i.impute_par
        WHERE i.projet_id = :p ORDER BY j.date DESC, j.numero DESC`, { p: p.id });
  }
  const remises = await q(
    `SELECT j.id, j.numero, j.date, j.rubrique_code, j.intitule, j.objet, j.beneficiaire, j.sortie, j.annule, j.motif_annulation,
            j.activite_id, a.nom AS activite_nom, jx.code AS journal_code, jx.nom AS journal_nom, j.journal_id, u.username AS saisi_par,
            (SELECT e.compte FROM equivalences_comptables e JOIN rubriques r ON r.id = e.rubrique_id
              WHERE r.tenant_id = j.tenant_id AND r.code = j.rubrique_code AND e.statut = 'valide' LIMIT 1) AS compte
       FROM journal j
       JOIN activites a ON a.id = j.activite_id
       LEFT JOIN journaux jx ON jx.id = j.journal_id
       LEFT JOIN users u ON u.id = j.created_by
      WHERE j.tenant_id = :t AND a.projet_id = :p AND j.sortie > 0 AND j.annulation_de_id IS NULL
        AND j.activite_id IN (:ids)
      ORDER BY j.date DESC, j.numero DESC`, { t: req.tenantId, p: p.id, ids: activites.length ? activites.map((a) => a.id) : [0] });

  const recu = financements.filter((f) => !f.annule).reduce((s, f) => s + n(f.entree), 0);
  const budgetValide = budgetsVus.find((b) => b.statut === 'valide');
  const montantBudget = budgetValide ? budgetValide.total : 0;
  const alloue = activites.reduce((s, a) => s + a.alloue, 0);
  return {
    projet: {
      id: Number(p.id), code: p.code, nom: p.nom, description: p.description, date_debut: p.date_debut, date_fin: p.date_fin,
      actif: p.actif, chef_projet_id: p.chef_projet_id, chef_nom: p.chef_nom,
    },
    acces: { voir_tout: acc.voirTout, gerer: acc.gerer, valider: acc.valider, chef: acc.estChef, modifier_projet: d.gerer },
    chiffres: {
      budget_valide: montantBudget, recu: acc.voirTout ? recu : null, alloue,
      disponible: acc.voirTout ? recu - alloue : null,
      reste_a_recevoir: acc.voirTout && budgetValide ? Math.max(montantBudget - recu, 0) : null,
    },
    activites, budgets: budgetsVus,
    financements: financements.map((f) => ({ ...f, id: Number(f.id), entree: n(f.entree) })),
    remises: remises.map((r) => ({ ...r, id: Number(r.id), sortie: n(r.sortie) })),
  };
};

// ── Projets et activités ────────────────────────────────────────────────────
const lireTexte = (v, max) => String(v ?? '').trim().slice(0, max);
const lireDate = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null);

const verifierUtilisateur = async (tenantId, userId, libelle) => {
  if (!userId) return null;
  const [u] = await q('SELECT id FROM users WHERE id = :u AND tenant_id = :t AND actif', { u: userId, t: tenantId });
  if (!u) throw err(400, `${libelle} introuvable parmi les utilisateurs actifs de l'entreprise.`, 'UTILISATEUR_INVALIDE');
  return u.id;
};

const doublonNom = (e) => e?.original?.code === '23505' || /uq_activites_nom/.test(e?.message || '');

const creerProjet = async (req, b) => {
  await exigerOng(req.tenantId);
  const d = await droits(req);
  if (!d.gerer) throw err(403, 'Permission requise : gérer les projets.', 'PROJET_NON_AUTORISE');
  const nom = lireTexte(b.nom, 120);
  if (!nom) throw err(400, 'Le nom du projet est obligatoire.', 'CHAMP_REQUIS');
  const dd = lireDate(b.date_debut); const df = lireDate(b.date_fin);
  if (dd && df && df < dd) throw err(400, 'La date de fin précède la date de début.', 'DATES_INVALIDES');
  const chef = await verifierUtilisateur(req.tenantId, b.chef_projet_id || null, 'Le chef de projet');
  try {
    const [p] = await q(
      `INSERT INTO activites (tenant_id, code, nom, type, description, date_debut, date_fin, chef_projet_id)
       VALUES (:t, :code, :nom, 'projet', :desc, :dd, :df, :chef) RETURNING id`,
      { t: req.tenantId, code: lireTexte(b.code, 20).toUpperCase(), nom, desc: lireTexte(b.description, 500), dd, df, chef });
    return { id: Number(p.id) };
  } catch (e) {
    if (doublonNom(e)) throw err(409, `« ${nom} » existe déjà (projet ou activité).`, 'NOM_EXISTANT');
    throw e;
  }
};

const modifierProjet = async (req, projetId, b) => {
  const { projet: p, droits: d } = await chargerProjet(req, projetId);
  if (!d.gerer) throw err(403, 'Permission requise : gérer les projets.', 'PROJET_NON_AUTORISE');
  const nom = b.nom === undefined ? p.nom : lireTexte(b.nom, 120);
  if (!nom) throw err(400, 'Le nom du projet est obligatoire.', 'CHAMP_REQUIS');
  const dd = b.date_debut === undefined ? p.date_debut : lireDate(b.date_debut);
  const df = b.date_fin === undefined ? p.date_fin : lireDate(b.date_fin);
  if (dd && df && String(df) < String(dd)) throw err(400, 'La date de fin précède la date de début.', 'DATES_INVALIDES');
  const chef = b.chef_projet_id === undefined ? p.chef_projet_id
    : await verifierUtilisateur(req.tenantId, b.chef_projet_id || null, 'Le chef de projet');
  try {
    await q(
      `UPDATE activites SET nom = :nom, code = :code, description = :desc, date_debut = :dd, date_fin = :df,
              chef_projet_id = :chef, actif = :actif
        WHERE id = :id AND tenant_id = :t RETURNING id`,
      { id: p.id, t: req.tenantId, nom, code: b.code === undefined ? p.code : lireTexte(b.code, 20).toUpperCase(),
        desc: b.description === undefined ? p.description : lireTexte(b.description, 500), dd, df, chef,
        actif: b.actif === undefined ? p.actif : Boolean(b.actif) });
  } catch (e) {
    if (doublonNom(e)) throw err(409, `« ${nom} » existe déjà (projet ou activité).`, 'NOM_EXISTANT');
    throw e;
  }
};

const creerActivite = async (req, projetId, b) => {
  const { projet: p } = await chargerProjet(req, projetId, { gerer: true });
  const nom = lireTexte(b.nom, 120);
  if (!nom) throw err(400, 'Le nom de l\'activité est obligatoire.', 'CHAMP_REQUIS');
  const resp = await verifierUtilisateur(req.tenantId, b.responsable_id || null, 'Le responsable d\'activité');
  try {
    const [a] = await q(
      `INSERT INTO activites (tenant_id, code, nom, type, projet_id, responsable_id, description)
       VALUES (:t, :code, :nom, 'activite', :p, :resp, :desc) RETURNING id`,
      { t: req.tenantId, code: lireTexte(b.code, 20).toUpperCase(), nom, p: p.id, resp, desc: lireTexte(b.description, 500) });
    return { id: Number(a.id) };
  } catch (e) {
    if (doublonNom(e)) throw err(409, `« ${nom} » existe déjà (projet ou activité).`, 'NOM_EXISTANT');
    throw e;
  }
};

const modifierActivite = async (req, projetId, activiteId, b) => {
  const { projet: p } = await chargerProjet(req, projetId, { gerer: true });
  const [a] = await q('SELECT * FROM activites WHERE id = :a AND projet_id = :p AND tenant_id = :t',
    { a: parseInt(activiteId, 10) || 0, p: p.id, t: req.tenantId });
  if (!a) throw err(404, 'Activité introuvable dans ce projet.', 'ACTIVITE_INTROUVABLE');
  const nom = b.nom === undefined ? a.nom : lireTexte(b.nom, 120);
  if (!nom) throw err(400, 'Le nom de l\'activité est obligatoire.', 'CHAMP_REQUIS');
  const resp = b.responsable_id === undefined ? a.responsable_id
    : await verifierUtilisateur(req.tenantId, b.responsable_id || null, 'Le responsable d\'activité');
  try {
    await q(
      `UPDATE activites SET nom = :nom, code = :code, responsable_id = :resp, actif = :actif, description = :desc
        WHERE id = :id RETURNING id`,
      { id: a.id, nom, code: b.code === undefined ? a.code : lireTexte(b.code, 20).toUpperCase(), resp,
        actif: b.actif === undefined ? a.actif : Boolean(b.actif),
        desc: b.description === undefined ? a.description : lireTexte(b.description, 500) });
  } catch (e) {
    if (doublonNom(e)) throw err(409, `« ${nom} » existe déjà (projet ou activité).`, 'NOM_EXISTANT');
    throw e;
  }
};

// ── Budget ──────────────────────────────────────────────────────────────────
const chargerBudget = async (req, projetId, budgetId, opts) => {
  const ctx = await chargerProjet(req, projetId, opts);
  const [b] = await q('SELECT * FROM projet_budgets WHERE id = :b AND projet_id = :p AND tenant_id = :t',
    { b: parseInt(budgetId, 10) || 0, p: ctx.projet.id, t: req.tenantId });
  if (!b) throw err(404, 'Budget introuvable.', 'BUDGET_INTROUVABLE');
  return { ...ctx, budget: b };
};

/** Nouveau budget en brouillon, pré-rempli avec le budget en vigueur. */
const creerBudget = async (req, projetId) => {
  const { projet: p } = await chargerProjet(req, projetId, { gerer: true });
  return sequelize.transaction(async (t) => {
    await q('SELECT pg_advisory_xact_lock(hashtext(:k))', { k: `projet_budget:${p.id}` }, t);
    const [ouvert] = await q(`SELECT id FROM projet_budgets WHERE projet_id = :p AND statut IN ('brouillon', 'soumis')`, { p: p.id }, t);
    if (ouvert) throw err(409, 'Un budget est déjà en préparation pour ce projet : reprenez-le.', 'BUDGET_DEJA_OUVERT');
    const [{ v }] = await q('SELECT COALESCE(MAX(version), 0) + 1 AS v FROM projet_budgets WHERE projet_id = :p', { p: p.id }, t);
    const [b] = await q(
      `INSERT INTO projet_budgets (tenant_id, projet_id, version, cree_par) VALUES (:t, :p, :v, :u) RETURNING id`,
      { t: req.tenantId, p: p.id, v, u: req.user.id }, t);
    // Lignes : celles du budget en vigueur, puis 0 pour les activités actives absentes.
    await q(
      `INSERT INTO projet_budget_lignes (tenant_id, budget_id, activite_id, montant)
       SELECT :t, :b, a.id, COALESCE(l.montant, 0)
         FROM activites a
         LEFT JOIN projet_budgets bv ON bv.projet_id = a.projet_id AND bv.statut = 'valide'
         LEFT JOIN projet_budget_lignes l ON l.budget_id = bv.id AND l.activite_id = a.id
        WHERE a.projet_id = :p AND (a.actif OR l.id IS NOT NULL)
       RETURNING id`, { t: req.tenantId, b: b.id, p: p.id }, t);
    return { id: Number(b.id), version: v };
  });
};

const lireLignes = (lignes) => {
  if (!Array.isArray(lignes)) throw err(400, 'Lignes du budget manquantes.', 'LIGNES_INVALIDES');
  const vues = new Set();
  return lignes.map((l) => {
    const activiteId = parseInt(l.activite_id, 10);
    const montant = Number(String(l.montant ?? '').replace(/[\s  ]/g, '').replace(',', '.') || 0);
    if (!Number.isInteger(activiteId) || activiteId <= 0) throw err(400, 'Activité invalide dans le budget.', 'LIGNES_INVALIDES');
    if (!Number.isFinite(montant) || montant < 0) throw err(400, 'Les montants du budget doivent être positifs ou nuls.', 'LIGNES_INVALIDES');
    if (vues.has(activiteId)) throw err(400, 'Une activité figure deux fois dans le budget.', 'LIGNES_INVALIDES');
    vues.add(activiteId);
    return { activiteId, montant: Math.round(montant * 100) / 100 };
  });
};

/** Enregistre les lignes d'un brouillon (ou d'un budget rejeté, qui redevient brouillon). */
const enregistrerBudget = async (req, projetId, budgetId, b) => {
  const { projet: p, budget } = await chargerBudget(req, projetId, budgetId, { gerer: true });
  if (!['brouillon', 'rejete'].includes(budget.statut)) {
    throw err(409, 'Ce budget a été soumis ou validé : il ne se modifie plus.', 'BUDGET_FIGE');
  }
  const lignes = lireLignes(b.lignes);
  await sequelize.transaction(async (t) => {
    if (budget.statut === 'rejete') {
      const [autre] = await q(`SELECT id FROM projet_budgets WHERE projet_id = :p AND statut IN ('brouillon', 'soumis')`, { p: p.id }, t);
      if (autre) throw err(409, 'Un autre budget est déjà en préparation pour ce projet.', 'BUDGET_DEJA_OUVERT');
      await q(`UPDATE projet_budgets SET statut = 'brouillon' WHERE id = :b RETURNING id`, { b: budget.id }, t);
    }
    if (lignes.length) {
      const ok = await q('SELECT id FROM activites WHERE projet_id = :p AND id IN (:ids)', { p: p.id, ids: lignes.map((l) => l.activiteId) }, t);
      if (ok.length !== lignes.length) throw err(400, 'Une activité du budget n\'appartient pas à ce projet.', 'LIGNES_INVALIDES');
    }
    await q('DELETE FROM projet_budget_lignes WHERE budget_id = :b RETURNING id', { b: budget.id }, t);
    for (const l of lignes) {
      await q(`INSERT INTO projet_budget_lignes (tenant_id, budget_id, activite_id, montant) VALUES (:t, :b, :a, :m) RETURNING id`,
        { t: req.tenantId, b: budget.id, a: l.activiteId, m: l.montant }, t);
    }
    await q('UPDATE projet_budgets SET commentaire = :c WHERE id = :b RETURNING id',
      { c: b.commentaire === undefined ? budget.commentaire : lireTexte(b.commentaire, 2000), b: budget.id }, t);
  });
};

// Un budget ne peut pas descendre sous ce qui a déjà été remis à une activité.
const controlerCouverture = async (budgetId, projetId, transaction) => {
  const manques = await q(
    `SELECT a.nom, COALESCE(l.montant, 0) AS montant,
            (SELECT COALESCE(SUM(j.sortie), 0) FROM journal j WHERE j.activite_id = a.id AND ${FILTRE_REEL}) AS alloue
       FROM activites a
       LEFT JOIN projet_budget_lignes l ON l.budget_id = :b AND l.activite_id = a.id
      WHERE a.projet_id = :p`, { b: budgetId, p: projetId }, transaction);
  const sous = manques.filter((m) => n(m.alloue) > n(m.montant));
  if (sous.length) {
    const liste = sous.map((m) => `« ${m.nom} » (déjà remis ${n(m.alloue).toLocaleString('fr-FR')}, budget ${n(m.montant).toLocaleString('fr-FR')})`).join(', ');
    throw err(409, `Le budget ne peut pas être inférieur aux fonds déjà remis : ${liste}.`, 'BUDGET_SOUS_ALLOUE');
  }
  const [{ total }] = await q('SELECT COALESCE(SUM(montant), 0) AS total FROM projet_budget_lignes WHERE budget_id = :b', { b: budgetId }, transaction);
  if (n(total) <= 0) throw err(400, 'Le budget est vide : indiquez le montant d\'au moins une activité.', 'BUDGET_VIDE');
  return n(total);
};

const soumettreBudget = async (req, projetId, budgetId) => {
  const { projet: p, budget } = await chargerBudget(req, projetId, budgetId, { gerer: true });
  if (budget.statut !== 'brouillon') throw err(409, 'Seul un budget en préparation se soumet.', 'BUDGET_STATUT');
  const total = await sequelize.transaction(async (t) => {
    const tot = await controlerCouverture(budget.id, p.id, t);
    await q(`UPDATE projet_budgets SET statut = 'soumis', soumis_par = :u, soumis_le = NOW(), motif_rejet = '' WHERE id = :b RETURNING id`,
      { u: req.user.id, b: budget.id }, t);
    return tot;
  });
  await notif.notifierPermission({
    tenantId: req.tenantId, permission: 'budgets_projet.valider', type: 'projet_budget',
    titre: `Budget à valider : ${p.nom}`,
    message: `${req.user.username || 'Le chef de projet'} a soumis le budget v${budget.version} (${total.toLocaleString('fr-FR')} FCFA).`,
    refType: 'projet', refId: p.id,
  });
};

const retirerBudget = async (req, projetId, budgetId) => {
  const { budget } = await chargerBudget(req, projetId, budgetId, { gerer: true });
  if (budget.statut !== 'soumis') throw err(409, 'Seul un budget soumis peut être repris.', 'BUDGET_STATUT');
  await q(`UPDATE projet_budgets SET statut = 'brouillon' WHERE id = :b RETURNING id`, { b: budget.id });
};

const supprimerBudget = async (req, projetId, budgetId) => {
  const { budget } = await chargerBudget(req, projetId, budgetId, { gerer: true });
  if (budget.statut !== 'brouillon') throw err(409, 'Seul un budget en préparation se supprime (un budget rejeté reste archivé).', 'BUDGET_FIGE');
  await q('DELETE FROM projet_budgets WHERE id = :b RETURNING id', { b: budget.id });
};

const deciderBudget = async (req, projetId, budgetId, { valider, motif }) => {
  const { projet: p, budget, droits: d } = await chargerBudget(req, projetId, budgetId);
  if (!d.valider) throw err(403, 'Permission requise : valider les budgets de projet.', 'PROJET_NON_AUTORISE');
  if (budget.statut !== 'soumis') throw err(409, 'Ce budget n\'est pas en attente de validation.', 'BUDGET_STATUT');
  const motifRejet = lireTexte(motif, 2000);
  if (!valider && !motifRejet) throw err(400, 'Le motif du rejet est obligatoire.', 'MOTIF_REQUIS');
  await sequelize.transaction(async (t) => {
    await q('SELECT pg_advisory_xact_lock(hashtext(:k))', { k: `projet_budget:${p.id}` }, t);
    if (valider) {
      await controlerCouverture(budget.id, p.id, t);
      await q(`UPDATE projet_budgets SET statut = 'remplace' WHERE projet_id = :p AND statut = 'valide' RETURNING id`, { p: p.id }, t);
      await q(`UPDATE projet_budgets SET statut = 'valide', decide_par = :u, decide_le = NOW() WHERE id = :b RETURNING id`,
        { u: req.user.id, b: budget.id }, t);
    } else {
      await q(`UPDATE projet_budgets SET statut = 'rejete', motif_rejet = :m, decide_par = :u, decide_le = NOW() WHERE id = :b RETURNING id`,
        { m: motifRejet, u: req.user.id, b: budget.id }, t);
    }
  });
  const destinataires = [...new Set([budget.soumis_par, p.chef_projet_id].filter((u) => u && u !== req.user.id))];
  for (const u of destinataires) {
    await notif.creerNotification({
      tenantId: req.tenantId, destinataireId: u, type: 'projet_budget',
      titre: valider ? `Budget validé : ${p.nom}` : `Budget rejeté : ${p.nom}`,
      message: valider ? `Le budget v${budget.version} est validé : les remises de fonds sont ouvertes.` : `Motif : ${motifRejet}`,
      refType: 'projet', refId: p.id,
    });
  }
};

/** Utilisateurs actifs de l'entreprise, pour les désignations. */
const utilisateurs = async (req) => {
  await exigerOng(req.tenantId);
  const d = await droits(req);
  if (!d.gerer && !d.chef.length) throw err(403, 'Permission requise : gérer les projets.', 'PROJET_NON_AUTORISE');
  return q(`SELECT id, username, role FROM users WHERE tenant_id = :t AND actif ORDER BY lower(username)`, { t: req.tenantId });
};

/** Le menu « Projets » est-il visible pour cet utilisateur ? */
const acces = async (req) => {
  if (!(await estOng(req.tenantId))) return { ong: false, visible: false };
  const d = await droits(req);
  const [{ nb }] = d.valider
    ? await q(`SELECT COUNT(*)::int AS nb FROM projet_budgets WHERE tenant_id = :t AND statut = 'soumis'`, { t: req.tenantId })
    : [{ nb: 0 }];
  return {
    ong: true,
    visible: d.voirTous || d.chef.length > 0 || d.responsable.length > 0,
    a_valider: nb,
    voir_tous: d.voirTous, gerer: d.gerer, valider: d.valider,
    chef: d.chef.length, responsable: d.responsable.length,
  };
};

module.exports = {
  droits, acces, lister, detail, utilisateurs,
  creerProjet, modifierProjet, creerActivite, modifierActivite,
  creerBudget, enregistrerBudget, soumettreBudget, retirerBudget, supprimerBudget, deciderBudget,
};
