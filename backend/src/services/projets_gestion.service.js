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
  const [voirTous, gerer, valider, valJustif, annJustif] = await Promise.all([
    userHasPermission(ctx, 'projets.voir'), userHasPermission(ctx, 'projets.gerer'),
    userHasPermission(ctx, 'budgets_projet.valider'), userHasPermission(ctx, 'justificatifs.valider'),
    userHasPermission(ctx, 'justificatifs.annuler'),
  ]);
  const chef = (await q(
    `SELECT id FROM activites WHERE tenant_id = :t AND type = 'projet' AND chef_projet_id = :u`,
    { t: req.tenantId, u: req.user.id })).map((r) => Number(r.id));
  const resp = await q(
    `SELECT id, projet_id FROM activites WHERE tenant_id = :t AND projet_id IS NOT NULL AND responsable_id = :u`,
    { t: req.tenantId, u: req.user.id });
  return {
    voirTous: voirTous || gerer, gerer, valider, validerJustificatifs: valJustif, annulerJustificatifs: annJustif,
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
// Justificatifs (070) : présents seulement une fois la migration jouée.
let justifOk = false;
const justifInstalle = async () => {
  if (justifOk) return true;
  const [r] = await q("SELECT to_regclass('public.projet_justificatifs') IS NOT NULL AS ok");
  justifOk = Boolean(r?.ok);
  return justifOk;
};

// Chiffres par activité de projet : budget validé, alloué (sorties), remboursé
// (entrées sur l'activité), justifié (pièces validées), à contrôler (déposées).
const chiffresActivites = async (tenantId, projetIds) => {
  const avecJustif = await justifInstalle();
  const sj = (statut) => (avecJustif
    ? `(SELECT COALESCE(SUM(pj.montant), 0) FROM projet_justificatifs pj WHERE pj.activite_id = a.id AND pj.statut = '${statut}')`
    : '0');
  return q(
    `SELECT a.id, a.projet_id, a.code, a.nom, a.actif, a.responsable_id, u.username AS responsable_nom,
            l.montant AS budget,
            (SELECT COALESCE(SUM(j.sortie), 0) FROM journal j
              WHERE j.tenant_id = a.tenant_id AND j.activite_id = a.id AND ${FILTRE_REEL}) AS alloue,
            (SELECT COUNT(*)::int FROM journal j
              WHERE j.tenant_id = a.tenant_id AND j.activite_id = a.id AND j.sortie > 0 AND ${FILTRE_REEL}) AS nb_remises,
            (SELECT MAX(j.date) FROM journal j
              WHERE j.tenant_id = a.tenant_id AND j.activite_id = a.id AND j.sortie > 0 AND ${FILTRE_REEL}) AS derniere_remise,
            (SELECT COALESCE(SUM(j.entree), 0) FROM journal j
              WHERE j.tenant_id = a.tenant_id AND j.activite_id = a.id AND ${FILTRE_REEL}) AS rembourse,
            ${sj('valide')} AS justifie,
            ${sj('depose')} AS a_controler
       FROM activites a
       LEFT JOIN users u ON u.id = a.responsable_id
       LEFT JOIN projet_budgets b ON b.projet_id = a.projet_id AND b.statut = 'valide'
       LEFT JOIN projet_budget_lignes l ON l.budget_id = b.id AND l.activite_id = a.id
      WHERE a.tenant_id = :t AND a.projet_id IN (:ids)
      ORDER BY a.actif DESC, lower(a.nom)`, { t: tenantId, ids: projetIds.length ? projetIds : [0] });
};

// Lignes budgétaires (071) : présentes seulement une fois la migration jouée.
let postesOk = false;
const postesInstalles = async () => {
  if (postesOk) return true;
  const [r] = await q("SELECT to_regclass('public.projet_budget_postes') IS NOT NULL AS ok");
  postesOk = Boolean(r?.ok);
  return postesOk;
};

const formerActivite = (a) => {
  const budget = a.budget === null ? null : n(a.budget);
  const alloue = n(a.alloue);
  return {
    id: Number(a.id), projet_id: Number(a.projet_id), code: a.code, nom: a.nom, actif: a.actif,
    responsable_id: a.responsable_id, responsable_nom: a.responsable_nom,
    budget, alloue, reste: budget === null ? null : budget - alloue, nb_remises: a.nb_remises,
    justifie: n(a.justifie), rembourse: n(a.rembourse), a_controler: n(a.a_controler),
    derniere_remise: a.derniere_remise, postes: [],
  };
};

/**
 * Situation d'un ou plusieurs projets : activités (avec leurs lignes
 * budgétaires) et remises GLOBALES au projet (lot P4).
 *
 * Une activité couvre d'abord les fonds qui lui ont été remis en direct ;
 * ce qu'elle justifie au-delà (dépenses financées par une remise globale)
 * vient en déduction de la remise globale du projet.
 *   en attente (activité) = remis à l'activité − (justifié + remboursé) plafonné au remis
 *   en attente (global)   = remis au projet − remboursé au projet − justifications au-delà des remises directes
 * Statut d'une activité : en_attente · validee (tout son remis est couvert) ·
 * sur_global (rien de remis en direct, dépenses justifiées sur la remise
 * globale) · non_financee.
 */
const situationProjets = async (tenantId, projetIds) => {
  const ids = projetIds.length ? projetIds : [0];
  const acts = (await chiffresActivites(tenantId, projetIds)).map(formerActivite);
  const globaux = await q(
    `SELECT p.id,
            (SELECT COALESCE(SUM(j.sortie), 0) FROM journal j WHERE j.tenant_id = p.tenant_id AND j.activite_id = p.id AND ${FILTRE_REEL}) AS alloue,
            (SELECT COALESCE(SUM(j.entree), 0) FROM journal j WHERE j.tenant_id = p.tenant_id AND j.activite_id = p.id AND ${FILTRE_REEL}) AS rembourse,
            (SELECT COUNT(*)::int FROM journal j WHERE j.tenant_id = p.tenant_id AND j.activite_id = p.id AND j.sortie > 0 AND ${FILTRE_REEL}) AS nb_remises,
            (SELECT MAX(j.date) FROM journal j WHERE j.tenant_id = p.tenant_id AND j.activite_id = p.id AND j.sortie > 0 AND ${FILTRE_REEL}) AS derniere_remise
       FROM activites p WHERE p.tenant_id = :t AND p.id IN (:ids)`, { t: tenantId, ids });
  let postes = [];
  if (await postesInstalles()) {
    postes = await q(
      `SELECT po.activite_id, po.cle, po.libelle, po.montant, po.ordre,
              (SELECT COALESCE(SUM(pj.montant), 0) FROM projet_justificatifs pj WHERE pj.poste_cle = po.cle AND pj.statut = 'valide') AS justifie,
              (SELECT COALESCE(SUM(pj.montant), 0) FROM projet_justificatifs pj WHERE pj.poste_cle = po.cle AND pj.statut = 'depose') AS a_controler
         FROM projet_budget_postes po JOIN projet_budgets b ON b.id = po.budget_id AND b.statut = 'valide'
        WHERE b.projet_id IN (:ids) ORDER BY po.ordre, po.id`, { ids });
  }
  const parProjet = new Map();
  for (const pid of projetIds) {
    const g = globaux.find((x) => Number(x.id) === Number(pid)) || {};
    let surplus = 0;
    const activites = acts.filter((a) => a.projet_id === Number(pid)).map((a) => {
      const couvert = Math.min(a.justifie + a.rembourse, a.alloue);
      surplus += a.justifie + a.rembourse - couvert;
      const enAttente = Math.max(a.alloue - couvert, 0);
      let statut = 'non_financee';
      if (a.alloue > 0) statut = enAttente > 0.004 ? 'en_attente' : 'validee';
      else if (a.justifie > 0) statut = 'sur_global';
      const mesPostes = postes.filter((po) => Number(po.activite_id) === a.id).map((po) => ({
        cle: po.cle, libelle: po.libelle, budget: n(po.montant), justifie: n(po.justifie), a_controler: n(po.a_controler),
        reste: n(po.montant) - n(po.justifie) - n(po.a_controler),
      }));
      return {
        ...a, en_attente: enAttente, statut_justification: statut, postes: mesPostes,
        taux_utilisation: a.alloue > 0 ? Math.round((a.justifie / a.alloue) * 100) : null,
        reste_budget_justif: a.budget === null ? null : a.budget - a.justifie - a.a_controler,
      };
    });
    const alloueG = n(g.alloue); const rembG = n(g.rembourse);
    const global = {
      alloue: alloueG, rembourse: rembG, nb_remises: g.nb_remises || 0, derniere_remise: g.derniere_remise || null,
      justifie: Math.min(surplus, Math.max(alloueG - rembG, 0)),
      en_attente: Math.max(alloueG - rembG - surplus, 0),
    };
    parProjet.set(Number(pid), { activites, global });
  }
  return parProjet;
};

// Totaux d'un projet pour un ensemble d'activités visibles (+ remise globale si vue complète).
const totaliser = (activites, global, avecGlobal) => {
  const s = (k) => activites.reduce((t, a) => t + (a[k] || 0), 0);
  return {
    alloue: s('alloue') + (avecGlobal ? global.alloue : 0),
    justifie: s('justifie'),
    rembourse: s('rembourse') + (avecGlobal ? global.rembourse : 0),
    en_attente: s('en_attente') + (avecGlobal ? global.en_attente : 0),
    a_controler: s('a_controler'),
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
  const situation = await situationProjets(req.tenantId, visibles.map((p) => Number(p.id)));

  const liste = visibles.map((p) => {
    const acc = accesProjet(d, p);
    const sit = situation.get(Number(p.id));
    const mesActs = sit.activites.filter((a) => acc.voirTout || d.responsable.includes(a.id));
    const budget = mesActs.reduce((s, a) => s + (a.budget || 0), 0);
    const tot = totaliser(mesActs, sit.global, acc.voirTout);
    const { alloue, justifie } = tot;
    const enAttente = tot.en_attente;
    const recu = acc.voirTout ? n(p.recu) : null;
    return {
      id: Number(p.id), code: p.code, nom: p.nom, description: p.description, date_debut: p.date_debut, date_fin: p.date_fin,
      actif: p.actif, chef_projet_id: p.chef_projet_id, chef_nom: p.chef_nom,
      budget_valide: p.budget_valide, budget_ouvert: p.budget_ouvert, dernier_rejet: p.dernier_rejet,
      montant_budget: p.budget_valide ? budget : 0, recu, alloue, justifie, en_attente: enAttente,
      nb_activites_en_attente: mesActs.filter((a) => a.statut_justification === 'en_attente').length,
      disponible: recu === null ? null : recu - alloue,
      reste_a_recevoir: recu === null || !p.budget_valide ? null : Math.max(budget - recu, 0),
      nb_activites: mesActs.length, nb_financements: acc.voirTout ? p.nb_financements : null,
      remise_globale: acc.voirTout ? sit.global.alloue : null,
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
  const sit = (await situationProjets(req.tenantId, [Number(p.id)])).get(Number(p.id));
  const activites = acc.voirTout ? sit.activites : sit.activites.filter((a) => d.responsable.includes(a.id));
  const postesOn = await postesInstalles();

  const budgets = await q(
    `SELECT b.id, b.version, b.statut, b.commentaire, b.motif_rejet, b.cree_le, b.soumis_le, b.decide_le,
            uc.username AS cree_par_nom, us.username AS soumis_par_nom, ud.username AS decide_par_nom,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('activite_id', l.activite_id, 'montant', l.montant) ORDER BY l.id)
                        FROM projet_budget_lignes l WHERE l.budget_id = b.id), '[]'::jsonb) AS lignes,
            ${postesOn ? `COALESCE((SELECT jsonb_agg(jsonb_build_object('activite_id', po.activite_id, 'cle', po.cle, 'libelle', po.libelle, 'montant', po.montant)
                        ORDER BY po.ordre, po.id) FROM projet_budget_postes po WHERE po.budget_id = b.id), '[]'::jsonb)` : `'[]'::jsonb`} AS postes
       FROM projet_budgets b
       LEFT JOIN users uc ON uc.id = b.cree_par LEFT JOIN users us ON us.id = b.soumis_par LEFT JOIN users ud ON ud.id = b.decide_par
      WHERE b.projet_id = :p ORDER BY b.version DESC`, { p: p.id });
  const idsVisibles = new Set(activites.map((a) => a.id));
  const budgetsVus = budgets.map((b) => {
    const postesB = (b.postes || []).map((po) => ({ activite_id: Number(po.activite_id), cle: po.cle, libelle: po.libelle, montant: n(po.montant) }));
    const lignes = b.lignes.map((l) => ({
      activite_id: Number(l.activite_id), montant: n(l.montant),
      postes: postesB.filter((po) => po.activite_id === Number(l.activite_id)),
    })).filter((l) => acc.voirTout || idsVisibles.has(l.activite_id));
    return { ...b, postes: undefined, id: Number(b.id), lignes, total: lignes.reduce((s, l) => s + l.montant, 0) };
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
            j.activite_id, CASE WHEN a.type = 'projet' THEN 'Remise globale au projet' ELSE a.nom END AS activite_nom,
            (a.type = 'projet') AS globale, jx.code AS journal_code, jx.nom AS journal_nom, j.journal_id, u.username AS saisi_par,
            (SELECT e.compte FROM equivalences_comptables e JOIN rubriques r ON r.id = e.rubrique_id
              WHERE r.tenant_id = j.tenant_id AND r.code = j.rubrique_code AND e.statut = 'valide' LIMIT 1) AS compte
       FROM journal j
       JOIN activites a ON a.id = j.activite_id
       LEFT JOIN journaux jx ON jx.id = j.journal_id
       LEFT JOIN users u ON u.id = j.created_by
      WHERE j.tenant_id = :t AND (a.projet_id = :p OR a.id = :p) AND j.sortie > 0 AND j.annulation_de_id IS NULL
        AND (j.activite_id IN (:ids) OR (:tout AND a.id = :p))
      ORDER BY j.date DESC, j.numero DESC`, { t: req.tenantId, p: p.id, tout: acc.voirTout, ids: activites.length ? activites.map((a) => a.id) : [0] });

  const recu = financements.filter((f) => !f.annule).reduce((s, f) => s + n(f.entree), 0);
  const budgetValide = budgetsVus.find((b) => b.statut === 'valide');
  const montantBudget = budgetValide ? budgetValide.total : 0;
  const tot = totaliser(activites, sit.global, acc.voirTout);
  const { alloue, justifie } = tot;
  const enAttente = tot.en_attente;
  return {
    projet: {
      id: Number(p.id), code: p.code, nom: p.nom, description: p.description, date_debut: p.date_debut, date_fin: p.date_fin,
      actif: p.actif, chef_projet_id: p.chef_projet_id, chef_nom: p.chef_nom,
    },
    acces: {
      voir_tout: acc.voirTout, gerer: acc.gerer, valider: acc.valider, chef: acc.estChef, modifier_projet: d.gerer,
      // Justificatifs (070) : dépôt par le responsable de l'activité (ou la gestion du projet) ;
      // validation par le chef de ce projet ou le comptable ; annulation par le directeur.
      valider_justificatifs: acc.estChef || d.validerJustificatifs,
      annuler_justificatifs: d.annulerJustificatifs,
      mes_activites: d.responsable,
    },
    chiffres: {
      budget_valide: montantBudget, recu: acc.voirTout ? recu : null, alloue, justifie, en_attente: enAttente,
      rembourse: tot.rembourse, a_controler: tot.a_controler,
      disponible: acc.voirTout ? recu - alloue : null,
      reste_a_recevoir: acc.voirTout && budgetValide ? Math.max(montantBudget - recu, 0) : null,
    },
    activites, budgets: budgetsVus,
    remise_globale: acc.voirTout ? sit.global : null,
    budget_reste_a_allouer: budgetValide ? montantBudget - alloue : null,
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
    // Lignes budgétaires (071) : recopiées avec la MÊME clé, pour que les
    // justificatifs déjà rattachés restent sur leur ligne.
    if (await postesInstalles()) {
      await q(
        `INSERT INTO projet_budget_postes (tenant_id, budget_id, activite_id, cle, libelle, montant, ordre)
         SELECT :t, :b, po.activite_id, po.cle, po.libelle, po.montant, po.ordre
           FROM projet_budget_postes po JOIN projet_budgets bv ON bv.id = po.budget_id AND bv.statut = 'valide'
          WHERE bv.projet_id = :p
         RETURNING id`, { t: req.tenantId, b: b.id, p: p.id }, t);
    }
    return { id: Number(b.id), version: v };
  });
};

const lireMontant = (v) => Number(String(v ?? '').replace(/[\s  ]/g, '').replace(',', '.') || 0);
const CLE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Lignes d'activité, avec leurs lignes budgétaires facultatives (071) : quand
// une activité en a, son montant est la SOMME de ses lignes.
const lireLignes = (lignes) => {
  if (!Array.isArray(lignes)) throw err(400, 'Lignes du budget manquantes.', 'LIGNES_INVALIDES');
  const vues = new Set();
  const cles = new Set();
  return lignes.map((l) => {
    const activiteId = parseInt(l.activite_id, 10);
    if (!Number.isInteger(activiteId) || activiteId <= 0) throw err(400, 'Activité invalide dans le budget.', 'LIGNES_INVALIDES');
    if (vues.has(activiteId)) throw err(400, 'Une activité figure deux fois dans le budget.', 'LIGNES_INVALIDES');
    vues.add(activiteId);
    const postes = (Array.isArray(l.postes) ? l.postes : []).map((po, i) => {
      const libelle = lireTexte(po.libelle, 150);
      const m = lireMontant(po.montant);
      if (!libelle) throw err(400, 'Chaque ligne budgétaire doit avoir un libellé.', 'LIGNES_INVALIDES');
      if (!Number.isFinite(m) || m < 0) throw err(400, 'Les montants du budget doivent être positifs ou nuls.', 'LIGNES_INVALIDES');
      const cle = po.cle && CLE_RE.test(String(po.cle)) ? String(po.cle).toLowerCase() : null;
      if (cle && cles.has(cle)) throw err(400, 'Une ligne budgétaire figure deux fois.', 'LIGNES_INVALIDES');
      if (cle) cles.add(cle);
      return { cle, libelle, montant: Math.round(m * 100) / 100, ordre: i };
    });
    const montant = postes.length ? postes.reduce((t, po) => t + po.montant, 0) : lireMontant(l.montant);
    if (!Number.isFinite(montant) || montant < 0) throw err(400, 'Les montants du budget doivent être positifs ou nuls.', 'LIGNES_INVALIDES');
    return { activiteId, montant: Math.round(montant * 100) / 100, postes };
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
    const avecPostes = await postesInstalles();
    if (!avecPostes && lignes.some((l) => l.postes.length)) {
      throw err(503, 'Les lignes budgétaires ne sont pas encore installées (migration 071).', 'POSTES_INDISPONIBLES');
    }
    if (avecPostes) await q('DELETE FROM projet_budget_postes WHERE budget_id = :b RETURNING id', { b: budget.id }, t);
    await q('DELETE FROM projet_budget_lignes WHERE budget_id = :b RETURNING id', { b: budget.id }, t);
    for (const l of lignes) {
      await q(`INSERT INTO projet_budget_lignes (tenant_id, budget_id, activite_id, montant) VALUES (:t, :b, :a, :m) RETURNING id`,
        { t: req.tenantId, b: budget.id, a: l.activiteId, m: l.montant }, t);
      for (const po of l.postes) {
        await q(
          `INSERT INTO projet_budget_postes (tenant_id, budget_id, activite_id, cle, libelle, montant, ordre)
           VALUES (:t, :b, :a, COALESCE(CAST(:cle AS uuid), gen_random_uuid()), :lib, :m, :o) RETURNING id`,
          { t: req.tenantId, b: budget.id, a: l.activiteId, cle: po.cle, lib: po.libelle, m: po.montant, o: po.ordre }, t);
      }
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
  // Remises globales comprises (lot P4) : le total ne descend pas sous tout ce qui a été remis.
  const [{ remis }] = await q(
    `SELECT COALESCE(SUM(j.sortie), 0) AS remis FROM journal j JOIN activites x ON x.id = j.activite_id
      WHERE (x.id = :p OR x.projet_id = :p) AND ${FILTRE_REEL}`, { p: projetId }, transaction);
  if (n(remis) > n(total)) {
    throw err(409, `Le budget total (${n(total).toLocaleString('fr-FR')}) ne peut pas être inférieur aux fonds déjà remis sur le projet (${n(remis).toLocaleString('fr-FR')}).`, 'BUDGET_SOUS_ALLOUE');
  }
  // Une ligne budgétaire ne descend pas sous ce qui y est justifié ou déposé ;
  // une ligne qui porte des justificatifs ne disparaît pas.
  if (await postesInstalles() && await justifInstalle()) {
    const lignesSous = await q(
      `SELECT COALESCE(po.libelle, MAX(pj.poste_libelle)) AS libelle, COALESCE(po.montant, 0) AS montant, SUM(pj.montant) AS pris
         FROM projet_justificatifs pj
         LEFT JOIN projet_budget_postes po ON po.budget_id = :b AND po.cle = pj.poste_cle
        WHERE pj.projet_id = :p AND pj.poste_cle IS NOT NULL AND pj.statut IN ('depose', 'valide')
        GROUP BY pj.poste_cle, po.libelle, po.montant
       HAVING SUM(pj.montant) > COALESCE(po.montant, 0)`, { b: budgetId, p: projetId }, transaction);
    if (lignesSous.length) {
      const liste = lignesSous.map((m) => `« ${m.libelle} » (justifié ou déposé ${n(m.pris).toLocaleString('fr-FR')}, budget ${n(m.montant).toLocaleString('fr-FR')})`).join(', ');
      throw err(409, `Une ligne budgétaire ne peut pas être inférieure à ses justificatifs : ${liste}.`, 'BUDGET_SOUS_JUSTIFIE');
    }
  }
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
    justificatifs_a_controler: await require('./projets_justificatifs.service').nbAControler(req, d),
    controle_justificatifs: d.validerJustificatifs || d.chef.length > 0,
    voir_tous: d.voirTous, gerer: d.gerer, valider: d.valider,
    chef: d.chef.length, responsable: d.responsable.length,
  };
};

module.exports = {
  chargerProjet, chiffresActivites, formerActivite, accesProjet, exigerOng, justifInstalle,
  situationProjets, totaliser, postesInstalles,
  droits, acces, lister, detail, utilisateurs,
  creerProjet, modifierProjet, creerActivite, modifierActivite,
  creerBudget, enregistrerBudget, soumettreBudget, retirerBudget, supprimerBudget, deciderBudget,
};
