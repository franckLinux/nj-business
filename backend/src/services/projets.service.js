// src/services/projets.service.js — Suivi de la caisse des projets (069, lot P1)
//
// Réservé aux clients ONG / ASSOC (tenants.forme_juridique). Pour tous les
// autres clients, chaque fonction de ce fichier répond « rien à faire » et le
// journal se comporte exactement comme avant.
//
//   • Financement reçu : une ENTRÉE de journal sur une rubrique de nature
//     « affectée » doit désigner le projet bénéficiaire. Le lien est rangé dans
//     journal_imputations_projet, SANS montant (le montant reste dans journal).
//   • Argent remis aux responsables : une SORTIE de journal rattachée à une
//     activité de projet. Elle est contrôlée par le budget VALIDÉ du projet et
//     n'entre pas dans le budget de fonctionnement (appel_fonds, plafond de
//     caisse) — décision du 19/11/2026.
const { sequelize } = require('../models');

const SELECT = sequelize.QueryTypes.SELECT;
const q = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: SELECT, transaction });

const NATURES = [
  { code: 'financement_projet',          libelle: 'Financement de projet',          affectee: true },
  { code: 'subvention',                  libelle: 'Subvention',                     affectee: true },
  { code: 'don_affecte',                 libelle: 'Don affecté',                    affectee: true },
  { code: 'contribution_partenaire',     libelle: "Contribution d'un partenaire",   affectee: true },
  { code: 'financement_complementaire',  libelle: 'Financement complémentaire',     affectee: true },
  { code: 'fonctionnement',              libelle: 'Recette de fonctionnement',      affectee: false },
  { code: 'cotisations',                 libelle: 'Cotisations',                    affectee: false },
  { code: 'autres',                      libelle: 'Autres recettes',                affectee: false },
];
const CODES_NATURES = NATURES.map((n) => n.code);
const estAffectee = (code) => NATURES.some((n) => n.code === code && n.affectee);

class ErreurProjet extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

// Présence de la migration 069 (mémorisée une fois vraie) : tant qu'elle n'est
// pas jouée, le module est inerte et le journal fonctionne comme avant.
let installe = false;
const estInstalle = async () => {
  if (installe) return true;
  const [r] = await q("SELECT to_regclass('public.journal_imputations_projet') IS NOT NULL AS ok");
  installe = Boolean(r?.ok);
  return installe;
};

/** Le client est-il une ONG / association ? (false si la 069 n'est pas jouée) */
const estOng = async (tenantId, transaction) => {
  if (!tenantId || !(await estInstalle())) return false;
  const [r] = await q('SELECT tenant_est_ong(:t) AS ong', { t: tenantId }, transaction);
  return Boolean(r?.ong);
};

// Condition SQL « l'écriture n'est pas rattachée à une activité de projet »,
// pour les sommes du budget de fonctionnement (alias Sequelize "Mouvement").
// « Projet géré » : un projet qui a des activités ou un budget (069). Une
// écriture qui lui est rattachée en direct est une remise GLOBALE (lot P4).
const sqlProjetGere = (alias) => `(${alias}.type = 'projet' AND (EXISTS (SELECT 1 FROM activites c_p WHERE c_p.projet_id = ${alias}.id)
  OR EXISTS (SELECT 1 FROM projet_budgets b_p WHERE b_p.projet_id = ${alias}.id)))`;
const sqlHorsProjets = (alias) => `NOT EXISTS (SELECT 1 FROM activites a_p
  WHERE a_p.id = ${alias}.activite_id AND (a_p.projet_id IS NOT NULL OR ${sqlProjetGere('a_p')}))`;
const SQL_HORS_PROJETS = sqlHorsProjets('"Mouvement"');

/** Faut-il retirer les sorties de projet des contrôles de fonctionnement ? */
const exclureProjetsDuFonctionnement = (tenantId) => estOng(tenantId);

/**
 * Prépare la saisie d'une écriture : contrôle le projet / l'activité et dit
 * ce qu'il faudra faire. Ne fait AUCUNE écriture en base.
 *   → null pour un client qui n'est pas une ONG / association (sauf si un
 *     projet est demandé : refus).
 *   → { ong: true, imputation: { projetId, nature, reference } | null,
 *       activiteProjet: { id, projet_id } | null }
 */
const preparerSaisie = async (tenantId, { rubriqueCode, entree, sortie, activiteId, projetId, reference }) => {
  const projetDemande = projetId !== undefined && projetId !== null && projetId !== '' && projetId !== 0 && projetId !== '0';
  if (!(await estInstalle())) {
    if (projetDemande) throw new ErreurProjet(400, 'Le suivi des projets n\'est pas encore installé sur ce serveur.', 'PROJETS_INDISPONIBLE');
    return null;
  }
  const [ctx] = await q(
    `SELECT tenant_est_ong(:t) AS ong,
            (SELECT to_jsonb(r)->>'nature_recette' FROM rubriques r WHERE r.tenant_id = :t AND r.code = :code LIMIT 1) AS nature,
            (SELECT jsonb_build_object('id', a.id, 'type', a.type, 'projet_id', a.projet_id, 'gere', ${sqlProjetGere('a')})
               FROM activites a WHERE a.id = :a AND a.tenant_id = :t) AS activite`,
    { t: tenantId, code: String(rubriqueCode || ''), a: activiteId || 0 });
  if (!ctx?.ong) {
    if (projetDemande) throw new ErreurProjet(400, 'Le rattachement d\'une recette à un projet est réservé aux ONG et associations.', 'PROJETS_RESERVES_ONG');
    return null;
  }

  const montantEntree = parseFloat(entree) || 0;
  const montantSortie = parseFloat(sortie) || 0;
  const act = ctx.activite;
  // Rattachement à une activité du projet, ou au projet lui-même (remise
  // GLOBALE, lot P4 — justifiée ensuite activité par activité).
  let activiteProjet = null;
  if (act && act.projet_id) activiteProjet = { id: Number(act.id), projet_id: Number(act.projet_id), global: false };
  else if (act && act.type === 'projet' && act.gere) activiteProjet = { id: Number(act.id), projet_id: Number(act.id), global: true };

  let imputation = null;
  const affectee = montantEntree > 0 && estAffectee(ctx.nature);
  if (affectee) {
    if (!projetDemande) {
      throw new ErreurProjet(400, 'Projet obligatoire : cette recette est un financement affecté. Choisissez le projet bénéficiaire.', 'PROJET_OBLIGATOIRE');
    }
    const id = parseInt(projetId, 10);
    if (!Number.isInteger(id) || id <= 0) throw new ErreurProjet(400, 'Projet invalide.', 'PROJET_INVALIDE');
    const [p] = await q(`SELECT id FROM activites WHERE id = :id AND tenant_id = :t AND type = 'projet' AND actif`, { id, t: tenantId });
    if (!p) throw new ErreurProjet(400, 'Projet introuvable ou désactivé.', 'PROJET_INVALIDE');
    if (activiteProjet) {
      throw new ErreurProjet(400, 'Un financement se rattache par « Projet bénéficiaire » : laissez le champ activité / projet vide.', 'ACTIVITE_SUR_FINANCEMENT');
    }
    imputation = { projetId: id, nature: ctx.nature, reference: String(reference || '').trim().slice(0, 120) };
  } else if (projetDemande) {
    throw new ErreurProjet(400, montantEntree > 0
      ? 'Cette rubrique n\'est pas une recette affectée à un projet : le projet ne peut pas être choisi.'
      : 'Le projet bénéficiaire ne se choisit que pour une recette. Pour une sortie, choisissez le projet ou l\'activité dans « Activité / projet ».', 'PROJET_NON_APPLICABLE');
  }
  return { ong: true, imputation, activiteProjet };
};

/**
 * Contrôle d'une SORTIE vers un projet, à faire DANS la transaction qui
 * enregistre l'écriture (verrou par projet : deux remises simultanées ne
 * peuvent pas dépasser ensemble le budget). Référence = budget VALIDÉ.
 *   • remise à une activité : ≤ budget de l'activité − déjà remis à l'activité,
 *     et ≤ budget total du projet − total déjà remis ;
 *   • remise GLOBALE au projet : ≤ budget total − total déjà remis.
 * Remis = sorties nettes (contre-passations déduites).
 */
const controlerSortieProjet = async (tenantId, { activiteId, montant, excludeId = null }, transaction) => {
  const fmt = (v) => (parseFloat(v) || 0).toLocaleString('fr-FR');
  const [a] = await q('SELECT id, nom, type, projet_id FROM activites WHERE id = :a AND tenant_id = :t',
    { a: activiteId, t: tenantId }, transaction);
  if (!a) throw new ErreurProjet(400, 'Activité de projet introuvable.', 'ACTIVITE_INVALIDE');
  const global = a.type === 'projet';
  const projetId = global ? a.id : a.projet_id;
  await q('SELECT pg_advisory_xact_lock(hashtext(:k))', { k: `projet_remise:${projetId}` }, transaction);
  const [r] = await q(
    `SELECT p.nom AS projet_nom, b.id AS budget_id,
            (SELECT COALESCE(SUM(l.montant), 0) FROM projet_budget_lignes l WHERE l.budget_id = b.id) AS budget_total,
            (SELECT l.montant FROM projet_budget_lignes l WHERE l.budget_id = b.id AND l.activite_id = :a) AS budget_activite,
            (SELECT COALESCE(SUM(j.sortie), 0) FROM journal j JOIN activites x ON x.id = j.activite_id
              WHERE j.tenant_id = :t AND (x.id = p.id OR x.projet_id = p.id)
                AND (:excl::bigint IS NULL OR j.id <> :excl::bigint)) AS remis_total,
            (SELECT COALESCE(SUM(j.sortie), 0) FROM journal j
              WHERE j.tenant_id = :t AND j.activite_id = :a AND (:excl::bigint IS NULL OR j.id <> :excl::bigint)) AS remis_activite
       FROM activites p
       LEFT JOIN projet_budgets b ON b.projet_id = p.id AND b.statut = 'valide'
      WHERE p.id = :p`,
    { t: tenantId, a: a.id, p: projetId, excl: excludeId }, transaction);
  if (!r.budget_id) {
    throw new ErreurProjet(409, `Le budget du projet « ${r.projet_nom} » n'est pas encore validé par le directeur : aucune remise de fonds possible.`, 'BUDGET_PROJET_NON_VALIDE');
  }
  const total = parseFloat(r.budget_total) || 0;
  const remisTotal = parseFloat(r.remis_total) || 0;
  if (!global) {
    const budget = parseFloat(r.budget_activite) || 0;
    const remis = parseFloat(r.remis_activite) || 0;
    if (budget <= 0) {
      throw new ErreurProjet(409, `L'activité « ${a.nom} » n'a pas de montant dans le budget validé du projet « ${r.projet_nom} ».`, 'ACTIVITE_SANS_BUDGET');
    }
    if (remis + montant > budget) {
      throw new ErreurProjet(409,
        `Budget de l'activité « ${a.nom} » dépassé de ${fmt(remis + montant - budget)} FCFA (budget validé : ${fmt(budget)} FCFA, déjà remis : ${fmt(remis)} FCFA). Sortie refusée.`,
        'DEPASSEMENT_BUDGET_PROJET');
    }
  }
  if (remisTotal + montant > total) {
    throw new ErreurProjet(409,
      `Budget du projet « ${r.projet_nom} » dépassé de ${fmt(remisTotal + montant - total)} FCFA (budget validé : ${fmt(total)} FCFA, déjà remis : ${fmt(remisTotal)} FCFA). Sortie refusée.`,
      'DEPASSEMENT_BUDGET_PROJET');
  }
  if (global) return { budget: total, consomme: remisTotal, reste: total - remisTotal - montant, global: true };
  const budget = parseFloat(r.budget_activite) || 0;
  const remis = parseFloat(r.remis_activite) || 0;
  return { budget, consomme: remis, reste: budget - remis - montant, reste_projet: total - remisTotal - montant };
};

/** Enregistre le lien écriture ↔ projet (dans la transaction de l'écriture). */
const enregistrerImputation = async (tenantId, { journalId, imputation, userId }, transaction) => {
  await q(
    `INSERT INTO journal_imputations_projet (tenant_id, journal_id, projet_id, nature_recette, reference_financement, impute_par)
     VALUES (:t, :j, :p, :n, :r, :u) RETURNING id`,
    { t: tenantId, j: journalId, p: imputation.projetId, n: imputation.nature, r: imputation.reference, u: userId || null }, transaction);
};

/**
 * Modification descriptive d'une écriture (PUT) : pour une ONG, le
 * rattachement à une activité de projet ne se corrige pas en place (il
 * déplacerait de l'argent d'un budget à l'autre sans contrôle).
 */
const verifierChangementActivite = async (tenantId, ancienId, nouveauId) => {
  if ((ancienId || null) === (nouveauId || null)) return;
  if (!(await estOng(tenantId))) return;
  const ids = [ancienId, nouveauId].filter(Boolean);
  const rows = await q(
    `SELECT id FROM activites WHERE tenant_id = :t AND id IN (:ids)
        AND (projet_id IS NOT NULL OR ${sqlProjetGere('activites')})`,
    { t: tenantId, ids });
  if (rows.length) {
    throw new ErreurProjet(409, 'Le rattachement d\'une écriture à un projet ne se corrige pas : annulez l\'écriture (contre-passation) puis ressaisissez-la.', 'ANNULATION_REQUISE');
  }
};

/** Activité de projet d'une écriture en attente (approbation du directeur). */
const activiteDeProjet = async (tenantId, activiteId, transaction) => {
  if (!activiteId || !(await estOng(tenantId, transaction))) return null;
  const [a] = await q(`SELECT id, projet_id, type FROM activites
                        WHERE id = :a AND tenant_id = :t AND (projet_id IS NOT NULL OR ${sqlProjetGere('activites')})`,
  { a: activiteId, t: tenantId }, transaction);
  if (!a) return null;
  return a.projet_id ? { id: Number(a.id), projet_id: Number(a.projet_id), global: false } : { id: Number(a.id), projet_id: Number(a.id), global: true };
};

/**
 * Contexte de saisie du journal (écran « Nouveau mouvement ») :
 * natures de recette, projets actifs et leurs activités avec budget validé,
 * déjà remis et reste. { ong: false } pour une PME.
 */
const contexteSaisie = async (tenantId) => {
  if (!(await estOng(tenantId))) return { ong: false };
  const projets = await q(
    `SELECT p.id, p.code, p.nom,
            EXISTS (SELECT 1 FROM projet_budgets b WHERE b.projet_id = p.id AND b.statut = 'valide') AS budget_valide,
            (SELECT COALESCE(SUM(l.montant), 0) FROM projet_budgets b JOIN projet_budget_lignes l ON l.budget_id = b.id
              WHERE b.projet_id = p.id AND b.statut = 'valide') AS budget_total,
            (SELECT COALESCE(SUM(j.sortie), 0) FROM journal j JOIN activites x ON x.id = j.activite_id
              WHERE j.tenant_id = p.tenant_id AND (x.id = p.id OR x.projet_id = p.id)) AS remis_total
       FROM activites p
      WHERE p.tenant_id = :t AND p.type = 'projet' AND p.actif
      ORDER BY lower(p.nom)`, { t: tenantId });
  const activites = await q(
    `SELECT a.id, a.code, a.nom, a.projet_id, a.responsable_id, u.username AS responsable_nom,
            l.montant AS budget,
            (SELECT COALESCE(SUM(j.sortie), 0) FROM journal j WHERE j.tenant_id = a.tenant_id AND j.activite_id = a.id) AS consomme
       FROM activites a
       JOIN activites p ON p.id = a.projet_id AND p.actif
       LEFT JOIN users u ON u.id = a.responsable_id
       LEFT JOIN projet_budgets b ON b.projet_id = a.projet_id AND b.statut = 'valide'
       LEFT JOIN projet_budget_lignes l ON l.budget_id = b.id AND l.activite_id = a.id
      WHERE a.tenant_id = :t AND a.actif
      ORDER BY lower(a.nom)`, { t: tenantId });
  return {
    ong: true,
    natures: NATURES,
    projets: projets.map((p) => ({
      ...p,
      budget_total: parseFloat(p.budget_total) || 0,
      remis_total: parseFloat(p.remis_total) || 0,
      reste_total: (parseFloat(p.budget_total) || 0) - (parseFloat(p.remis_total) || 0),
      activites: activites.filter((a) => Number(a.projet_id) === Number(p.id)).map((a) => {
        const budget = a.budget === null ? null : parseFloat(a.budget);
        const consomme = parseFloat(a.consomme) || 0;
        return { id: a.id, code: a.code, nom: a.nom, responsable_id: a.responsable_id, responsable_nom: a.responsable_nom,
          budget, consomme, reste: budget === null ? null : budget - consomme };
      }),
    })),
  };
};

module.exports = {
  NATURES, CODES_NATURES, estAffectee, ErreurProjet, SQL_HORS_PROJETS, sqlHorsProjets,
  estInstalle, estOng, exclureProjetsDuFonctionnement,
  preparerSaisie, controlerSortieProjet, enregistrerImputation, verifierChangementActivite,
  activiteDeProjet, contexteSaisie,
};
