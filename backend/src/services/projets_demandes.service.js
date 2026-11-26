'use strict';
// Gestion des activités simplifiée (ONG et associations) — migration 083, 25/11/2026.
//
//  1. Le RESPONSABLE D'ACTIVITÉ (ou le chef du projet) établit une demande de
//     fonds sur une activité déclarée en configuration : lignes budgétaires
//     (désignation × quantité × jours × prix unitaire).
//  2. Validation par le CHEF DE PROJET, puis APPROBATION par le DIRECTEUR
//     (contrôlé en base). Approuvée, la demande est le budget de la dépense.
//     Si le projet n'a pas de chef, ou si le demandeur est le chef, l'étape du
//     chef est acquise à la soumission.
//  3. La CAISSIÈRE décaisse (caisse ou banque) : la sortie passe par la saisie
//     du journal (mêmes contrôles), reliée à la demande, plafonnée au reste.
//  4. Le responsable DÉCLARE ses dépenses avec pièce ; le COMPTABLE
//     (justificatifs.valider) les valide ou les rejette — jamais les siennes.
//  5. Le RELIQUAT (reçu − dépenses − déjà reversé) est reversé en caisse ou en
//     banque par une entrée reliée à la demande.
//  6. RAPPORT FINANCIER par projet et activité, à tout moment ; il signale les
//     dépenses pas encore contrôlées.
const fs = require('fs');
const { sequelize } = require('../models');
const { userHasPermission } = require('./permission.service');
const { ErreurProjet, estOng } = require('./projets.service');
const gestion = require('./projets_gestion.service');
const pv = require('./pv_storage.service');
const journalSvc = require('./journal.service');
const hebdo = require('./budget_hebdo.service');
const notifs = require('./projets_notifications.service');

const T = sequelize.QueryTypes;
const Q = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: T.SELECT, transaction });
const X = (sql, replacements, transaction) => sequelize.query(sql, { replacements, transaction });
const err = (status, message, code) => new ErreurProjet(status, message, code);
const n = (v) => (v === null || v === undefined ? 0 : Number(v) || 0);
const fmt = (v) => Math.round(n(v)).toLocaleString('fr-FR');
const MOIS = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// Règles de la base → messages clairs.
const traduire = (e) => {
  if (e instanceof ErreurProjet) return e;
  const msg = e?.original?.message || e?.parent?.message || '';
  const m = /^([A-Z_]+): (.*)$/s.exec(msg);
  if ((e?.original?.code || e?.parent?.code) === '23514') {
    if (m) return err(409, m[2], m[1]);
    if (/chk_depense_pas_autocontrole/.test(msg)) return err(403, 'Vous ne contrôlez pas une dépense que vous avez déclarée.', 'AUTOCONTROLE');
    return err(400, 'Donnée refusée par les règles de la base.', 'REGLE_BASE');
  }
  return e;
};
const enTransaction = async (fn) => { try { return await sequelize.transaction(fn); } catch (e) { throw traduire(e); } };

const texte = (v, max, quoi, { obligatoire = false } = {}) => {
  const s = String(v ?? '').trim();
  if (obligatoire && !s) throw err(400, `${quoi} : obligatoire.`, 'SAISIE');
  if (s.length > max) throw err(400, `${quoi} : ${max} caractères au plus.`, 'SAISIE');
  return s;
};
const nombre = (v, quoi, { min = 0, strict = false, decimales = 2 } = {}) => {
  const x = Number(String(v ?? '').replace(/[\s  ]/g, '').replace(',', '.'));
  if (String(v ?? '').trim() === '' || !Number.isFinite(x) || x < min || (strict && x <= min)) throw err(400, `${quoi} invalide.`, 'SAISIE');
  return Math.round(x * 10 ** decimales) / 10 ** decimales;
};
const dateIso = (v, quoi, { obligatoire = false } = {}) => {
  const s = String(v ?? '').trim();
  if (!s) { if (obligatoire) throw err(400, `${quoi} : obligatoire.`, 'SAISIE'); return null; }
  if (!ISO.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw err(400, `${quoi} invalide.`, 'SAISIE');
  return s;
};
const idNum = (v, quoi) => {
  const x = Number(v);
  if (!Number.isInteger(x) || x <= 0) throw err(400, `${quoi} invalide.`, 'SAISIE');
  return x;
};

// ── Droits ──────────────────────────────────────────────────────────────────
const profil = async (req) => {
  if (!(await estOng(req.tenantId))) throw err(403, 'La gestion des activités est réservée aux ONG et associations.', 'PROJETS_RESERVES_ONG');
  const d = await gestion.droits(req);
  const ctx = { tenantId: req.tenantId, userId: req.user.id, role: req.user.role };
  const [comptable, caisse] = await Promise.all([
    userHasPermission(ctx, 'justificatifs.valider'), userHasPermission(ctx, 'journal.create'),
  ]);
  return { ...d, directeur: req.user.role === 'directeur', comptable, caisse, userId: req.user.id };
};
const voitTout = (p) => p.voirTous || p.directeur || p.comptable;
const peutVoir = (p, dem) => voitTout(p) || p.chef.includes(Number(dem.projet_id)) || p.responsable.includes(Number(dem.activite_id))
  || dem.demandeur_id === p.userId || (p.caisse && dem.statut === 'approuvee');
// Décision de Franck (26/11) : le chef de projet (ou le directeur) initie le décaissement ;
// la caisse le valide ensuite (ordre de décaissement, migration 086).
const peutInitier = (p, d) => p.directeur || p.chef.includes(Number(d.projet_id));
const peutDemander = (p, projetId, activiteId) => p.responsable.includes(Number(activiteId)) || p.chef.includes(Number(projetId));

// ── Lecture ─────────────────────────────────────────────────────────────────
const SELECT_DEMANDE = `
  SELECT d.id::text AS id, d.numero, d.projet_id, d.activite_id, d.objet, d.date_besoin::text AS date_besoin, d.statut, d.total,
         d.demandeur_id, d.cree_le, d.soumis_le, d.chef_le, d.directeur_le, d.motif, d.annule_le,
         p.nom AS projet, p.chef_projet_id, a.nom AS activite, a.responsable_id,
         ud.username AS demandeur, uc.username AS chef_nom, ux.username AS directeur_nom, uch.username AS chef_projet_nom,
         c.decaisse, c.reverse, c.depenses, c.depenses_validees,
         (SELECT count(*)::int FROM projet_depenses x WHERE x.demande_id = d.id AND x.statut = 'declaree') AS depenses_a_controler,
         (SELECT coalesce(sum(o.montant), 0) FROM projet_ordres_decaissement o WHERE o.demande_id = d.id AND o.statut = 'en_attente') AS en_attente_caisse
    FROM projet_demandes_fonds d
    JOIN activites p ON p.id = d.projet_id JOIN activites a ON a.id = d.activite_id
    LEFT JOIN users ud ON ud.id = d.demandeur_id LEFT JOIN users uc ON uc.id = d.chef_par
    LEFT JOIN users ux ON ux.id = d.directeur_par LEFT JOIN users uch ON uch.id = p.chef_projet_id
    CROSS JOIN LATERAL projet_demande_chiffres(d.id) c`;

const LIBELLES = { brouillon: 'Brouillon', soumise: 'Chez le chef de projet', validee_chef: 'Chez le directeur', rejetee: 'Rejetée', annulee: 'Annulée' };
// État lisible d'une demande approuvée : décaissement puis justification.
const etat = (d) => {
  if (d.statut !== 'approuvee') return LIBELLES[d.statut];
  const dec = n(d.decaisse); const tot = n(d.total);
  if (dec <= 0) return n(d.en_attente_caisse) > 0 ? 'Sortie à valider par la caisse' : 'À décaisser';
  const reste = dec - n(d.depenses) - n(d.reverse);
  if (dec < tot) return reste > 0 ? 'Décaissée en partie' : 'Décaissée en partie, justifiée';
  if (reste > 0) return 'À justifier';
  if (n(d.depenses_a_controler) > 0) return 'Dépenses à contrôler';
  return 'Justifiée';
};
const former = (d) => ({
  ...d, total: n(d.total), decaisse: n(d.decaisse), reverse: n(d.reverse), depenses: n(d.depenses), depenses_validees: n(d.depenses_validees),
  reste_a_decaisser: d.statut === 'approuvee' ? Math.max(n(d.total) - n(d.decaisse), 0) : 0,
  en_attente_caisse: n(d.en_attente_caisse),
  // Ce que le chef de projet peut encore envoyer à la caisse (ordres en attente déduits).
  reste_a_initier: d.statut === 'approuvee' ? Math.max(n(d.total) - n(d.decaisse) - n(d.en_attente_caisse), 0) : 0,
  reste_a_justifier: Math.max(n(d.decaisse) - n(d.depenses) - n(d.reverse), 0),
  etat: etat(d),
});

const contexte = async (req) => {
  const p = await profil(req);
  const ids = [...p.responsable, ...p.chef];
  const activites = ids.length ? await Q(
    `SELECT a.id, a.nom, a.projet_id, pr.nom AS projet
       FROM activites a JOIN activites pr ON pr.id = a.projet_id
      WHERE a.tenant_id = :t AND a.actif AND pr.actif AND (a.id IN (:resp) OR a.projet_id IN (:chef))
      ORDER BY pr.nom, a.nom`,
    { t: req.tenantId, resp: p.responsable.length ? p.responsable : [0], chef: p.chef.length ? p.chef : [0] }) : [];
  // Pour la caissière : caisses et banques, rubriques de sortie (décaissement) et d'entrée (reliquat).
  const [journaux, rubriques] = p.caisse ? await Promise.all([
    Q('SELECT id::text AS id, code, nom, type FROM journaux WHERE tenant_id = :t AND actif ORDER BY ordre, code', { t: req.tenantId })
      .then((js) => Promise.all(js.map(async (j) => ({ ...j, solde: (await soldeDisponible(req.tenantId, j.id, new Date().toISOString().slice(0, 10))).solde })))),
    Q(`SELECT code, intitule, type FROM rubriques WHERE tenant_id = :t AND actif AND nature_recette IS NULL ORDER BY intitule`, { t: req.tenantId }),
  ]) : [[], []];
  const projets = await Q(`SELECT id, nom FROM activites WHERE tenant_id = :t AND type = 'projet' ORDER BY nom`, { t: req.tenantId });
  return {
    journaux, rubriques,
    projets: projets.filter((x) => voitTout(p) || p.chef.includes(Number(x.id)) || p.projetsResponsable.includes(Number(x.id))),
    activites, directeur: p.directeur, comptable: p.comptable, caisse: p.caisse, voit_tout: voitTout(p),
    chef_de: p.chef, peut_demander: activites.length > 0,
  };
};

const lister = async (req) => {
  const p = await profil(req);
  const vue = String(req.query.vue || '');
  const projet = req.query.projet_id ? idNum(req.query.projet_id, 'Projet') : null;
  const lignes = (await Q(`${SELECT_DEMANDE} WHERE d.tenant_id = :t AND (CAST(:projet AS INTEGER) IS NULL OR d.projet_id = :projet)
                           ORDER BY d.id DESC LIMIT 500`, { t: req.tenantId, projet }))
    .filter((d) => peutVoir(p, d)).map(former);
  const aValider = (d) => (d.statut === 'soumise' && (p.chef.includes(Number(d.projet_id))))
    || (d.statut === 'validee_chef' && p.directeur);
  const filtres = {
    a_valider: aValider,
    // Caisse : sorties initiées par le chef de projet, à valider. Chef : reste à envoyer à la caisse.
    a_decaisser: (d) => d.statut === 'approuvee' && d.en_attente_caisse > 0,
    a_initier: (d) => d.statut === 'approuvee' && d.reste_a_initier > 0 && peutInitier(p, d),
    a_justifier: (d) => d.statut === 'approuvee' && d.reste_a_justifier > 0,
    mes: (d) => d.demandeur_id === p.userId || p.responsable.includes(Number(d.activite_id)),
  };
  return {
    demandes: filtres[vue] ? lignes.filter(filtres[vue]) : lignes,
    compteurs: {
      a_valider: lignes.filter(aValider).length,
      a_decaisser: lignes.filter(filtres.a_decaisser).length,
      a_initier: lignes.filter(filtres.a_initier).length,
      a_justifier: lignes.filter(filtres.a_justifier).length,
    },
  };
};

const charger = async (tenantId, id, transaction, verrou = false) => {
  const [d] = await Q(`SELECT * FROM projet_demandes_fonds WHERE id = :id AND tenant_id = :t${verrou ? ' FOR UPDATE' : ''}`,
    { id: idNum(id, 'Demande'), t: tenantId }, transaction);
  if (!d) throw err(404, 'Demande introuvable.', 'DEMANDE_INTROUVABLE');
  return d;
};

const lire = async (req, id) => {
  const p = await profil(req);
  const [d] = await Q(`${SELECT_DEMANDE} WHERE d.id = :id AND d.tenant_id = :t`, { id: idNum(id, 'Demande'), t: req.tenantId });
  if (!d || !peutVoir(p, d)) throw err(404, 'Demande introuvable.', 'DEMANDE_INTROUVABLE');
  const lignes = await Q(`SELECT id::text AS id, ordre, designation, quantite, jours, prix_unitaire, montant
                            FROM projet_demande_lignes WHERE demande_id = :id ORDER BY ordre, id`, { id: d.id });
  const mouvements = await Q(
    `SELECT m.sens, j.id::text AS journal_id, j.date::text AS date, j.numero, jx.code AS caisse, jx.nom AS caisse_nom, jx.type AS caisse_type,
            j.entree, j.sortie, coalesce(j.annule, false) AS annule, j.beneficiaire, u.username AS saisi_par
       FROM projet_demande_mouvements m JOIN journal j ON j.id = m.journal_id LEFT JOIN journaux jx ON jx.id = j.journal_id
       LEFT JOIN users u ON u.id = m.cree_par WHERE m.demande_id = :id ORDER BY j.date, j.id`, { id: d.id });
  const depenses = await Q(
    `SELECT x.id::text AS id, x.ligne_id::text AS ligne_id, x.date_depense::text AS date_depense, x.designation, x.beneficiaire, x.montant,
            x.fichier_nom, x.mime, x.statut, x.motif, x.declare_le, x.controle_le, x.declare_par,
            ud.username AS declare_par_nom, uc.username AS controle_par_nom, l.designation AS ligne
       FROM projet_depenses x LEFT JOIN users ud ON ud.id = x.declare_par LEFT JOIN users uc ON uc.id = x.controle_par
       LEFT JOIN projet_demande_lignes l ON l.id = x.ligne_id
      WHERE x.demande_id = :id ORDER BY x.date_depense, x.id`, { id: d.id });
  const sollicitations = await Q(
    `SELECT s.montant, s.solde_constate, s.mois, s.annee, s.semaine, s.demandee_le, j.nom AS caisse, u.username AS par,
            coalesce(v.statut, 'en_attente') AS statut_demande_fonds
       FROM projet_demande_sollicitations s JOIN journaux j ON j.id = s.journal_id LEFT JOIN users u ON u.id = s.demandee_par
       LEFT JOIN budget_validation v ON v.tenant_id = s.tenant_id AND v.mois = s.mois AND v.annee = s.annee AND v.semaine IS NOT DISTINCT FROM s.semaine
      WHERE s.demande_id = :id ORDER BY s.id`, { id: d.id });
  const ordres = await Q(`${SELECT_ORDRE} WHERE o.demande_id = :id ORDER BY o.id`, { id: d.id });
  const f = former(d);
  const estDemandeur = d.demandeur_id === p.userId || p.responsable.includes(Number(d.activite_id));
  return {
    demande: f, lignes: lignes.map((l) => ({ ...l, quantite: n(l.quantite), jours: l.jours === null ? null : n(l.jours), prix_unitaire: n(l.prix_unitaire), montant: n(l.montant) })),
    mouvements: mouvements.map((m) => ({ ...m, entree: n(m.entree), sortie: n(m.sortie) })),
    ordres: ordres.map((o) => ({ ...formerOrdre(o), de_moi: o.initie_par === p.userId,
      a_moi_de_valider: o.statut === 'en_attente' && p.caisse && o.initie_par !== p.userId })),
    sollicitations: sollicitations.map((s) => ({ ...s, montant: n(s.montant), solde_constate: n(s.solde_constate) })),
    depenses: depenses.map((x) => ({ ...x, montant: n(x.montant), declare_par: undefined, de_moi: x.declare_par === p.userId })),
    actions: {
      modifier: d.statut === 'brouillon' && (d.demandeur_id === p.userId || p.chef.includes(Number(d.projet_id))),
      valider_chef: d.statut === 'soumise' && p.chef.includes(Number(d.projet_id)),
      approuver: d.statut === 'validee_chef' && p.directeur,
      renvoyer: (d.statut === 'soumise' && p.chef.includes(Number(d.projet_id))) || (d.statut === 'validee_chef' && p.directeur),
      annuler: (['brouillon', 'soumise', 'validee_chef'].includes(d.statut) && (d.demandeur_id === p.userId || p.directeur))
        || (d.statut === 'approuvee' && p.directeur && f.decaisse === 0),
      initier: d.statut === 'approuvee' && peutInitier(p, d) && f.reste_a_initier > 0,
      decaisser: d.statut === 'approuvee' && p.caisse && ordres.some((o) => o.statut === 'en_attente' && o.initie_par !== p.userId),
      reverser: d.statut === 'approuvee' && p.caisse && f.reste_a_justifier > 0,
      declarer: d.statut === 'approuvee' && estDemandeur && f.reste_a_justifier > 0,
      controler: p.comptable,
    },
  };
};

// ── Notifications (mail + application) à chaque étape ────────────────────────
const annoncer = async (req, demandeId, quoi, extra = {}) => {
  const [d] = await Q(`SELECT d.id, d.numero, d.objet, d.total, d.demandeur_id, d.motif, p.nom AS projet, p.chef_projet_id, a.nom AS activite,
                              u.username AS demandeur
                         FROM projet_demandes_fonds d JOIN activites p ON p.id = d.projet_id JOIN activites a ON a.id = d.activite_id
                         LEFT JOIN users u ON u.id = d.demandeur_id WHERE d.id = :id`, { id: demandeId });
  if (!d) return;
  const ref = `${d.numero || 'Demande'} — ${d.projet} / ${d.activite}`;
  const base = [`Demande : ${ref}.`, `Objet : ${d.objet}.`, `Montant : ${fmt(d.total)} FCFA.`];
  const chemin = `/projets/demandes/${d.id}`;
  const par = req.user?.username ? ` par ${req.user.username}` : '';
  const E = {
    soumise: { dest: { ids: [d.chef_projet_id] }, titre: `Demande de fonds à valider (chef de projet) — ${d.numero}`, lignes: [...base, `Envoyée${par}.`] },
    validee_chef: { dest: { role: 'directeur' }, titre: `Demande de fonds à approuver — ${d.numero}`, lignes: [...base, d.chef_projet_id ? 'Validée par le chef de projet.' : 'Envoyée directement au directeur.'] },
    approuvee: { dest: { permission: 'journal.create', ids: [d.demandeur_id] }, titre: `Demande de fonds approuvée — ${d.numero}`, lignes: [...base, `Approuvée${par} : les fonds peuvent être décaissés.`] },
    brouillon: { dest: { ids: [d.demandeur_id] }, titre: `Demande de fonds renvoyée pour correction — ${d.numero}`, lignes: [...base, `Motif : ${d.motif}.`] },
    rejetee: { dest: { ids: [d.demandeur_id] }, titre: `Demande de fonds rejetée — ${d.numero}`, lignes: [...base, `Motif : ${d.motif}.`] },
    annulee: { dest: { ids: [d.demandeur_id, d.chef_projet_id] }, titre: `Demande de fonds annulée — ${d.numero}`, lignes: [...base, `Motif : ${d.motif}.`] },
    ordre: { dest: { permission: 'journal.create' }, titre: `Sortie de caisse à valider — ${d.numero}`,
      lignes: [...base, `Décaissement initié${par} : ${fmt(extra.montant)} FCFA${extra.beneficiaire ? ` pour ${extra.beneficiaire}` : ''}.`,
        'Remettez les fonds, validez la sortie dans Caisse Pro → Fonds à décaisser, puis imprimez le bon de sortie à faire signer.'] },
    ordre_refuse: { dest: { ids: [extra.initiateur] }, titre: `Sortie refusée par la caisse — ${d.numero}`,
      lignes: [...base, `Ordre de ${fmt(extra.montant)} FCFA refusé${par}.`, `Motif : ${extra.motif}.`] },
    ordre_annule: { dest: { permission: 'journal.create', ids: [extra.initiateur] }, titre: `Ordre de décaissement retiré — ${d.numero}`,
      lignes: [...base, `Ordre de ${fmt(extra.montant)} FCFA retiré${par} : la caisse ne doit plus le payer.`, `Motif : ${extra.motif}.`] },
    decaissement: { dest: { ids: [d.demandeur_id, extra.initiateur] }, titre: `Fonds décaissés — ${d.numero}`, lignes: [...base, `Décaissé${par} : ${fmt(extra.montant)} FCFA. Déclarez ensuite vos dépenses avec les pièces.`] },
    reversement: { dest: { ids: [d.demandeur_id] }, titre: `Reliquat encaissé — ${d.numero}`, lignes: [...base, `Reliquat reversé : ${fmt(extra.montant)} FCFA.`] },
    depense: { dest: { permission: 'justificatifs.valider' }, titre: `Dépense à contrôler — ${d.numero}`, lignes: [...base, `Dépense déclarée${par} : ${extra.designation} (${fmt(extra.montant)} FCFA).`] },
    depense_rejetee: { dest: { ids: [extra.declarant] }, titre: `Dépense rejetée — ${d.numero}`, lignes: [...base, `Dépense : ${extra.designation} (${fmt(extra.montant)} FCFA).`, `Motif : ${extra.motif}.`] },
    sollicitation: { dest: { role: 'directeur', permission: 'budget.validate' }, titre: `Réapprovisionnement à valider — ${d.numero}`,
      lignes: [...base, `La caisse « ${extra.caisse} » n'a que ${fmt(extra.solde)} FCFA : il manque ${fmt(extra.manque)} FCFA pour décaisser.`,
        extra.figee ? `La Demande de fonds de ${extra.periode} est déjà validée : remettez-la « en attente » pour y ajouter ce besoin.`
          : `Le besoin est ajouté à la Demande de fonds de ${extra.periode} (rubrique ${extra.rubrique}) : validez-la dans Caisse Pro → Demande de fonds.`] },
  }[quoi];
  if (!E) return;
  notifs.plusTard({ tenantId: req.tenantId, auteurId: req.user?.id, destinataires: E.dest, type: `demande_fonds_${quoi}`, titre: E.titre,
    lignes: E.lignes, chemin: quoi === 'sollicitation' ? '/appel-fonds' : chemin, refType: 'demande_fonds', refId: d.id });
};
// L'annonce ne doit jamais faire échouer l'action déjà enregistrée.
const annoncerSansRisque = (req, id, quoi, extra) => annoncer(req, id, quoi, extra)
  .catch((e) => console.warn(`[Gestion des activités] annonce « ${quoi} » :`, e.message));

// ── Saisie de la demande ────────────────────────────────────────────────────
const lireSaisie = async (req, p, b, transaction) => {
  const activiteId = idNum(b.activite_id, 'Activité');
  const [a] = await Q(`SELECT a.id, a.projet_id, a.actif, pr.actif AS projet_actif FROM activites a JOIN activites pr ON pr.id = a.projet_id
                        WHERE a.id = :a AND a.tenant_id = :t`, { a: activiteId, t: req.tenantId }, transaction);
  if (!a) throw err(400, 'Choisissez une activité d\'un projet déclaré en configuration.', 'ACTIVITE_INVALIDE');
  if (!a.actif || !a.projet_actif) throw err(400, 'Activité ou projet désactivé.', 'ACTIVITE_INVALIDE');
  if (!peutDemander(p, a.projet_id, a.id)) throw err(403, 'Seuls le responsable de l\'activité et le chef du projet demandent des fonds pour cette activité.', 'DEMANDE_NON_AUTORISEE');
  if (!Array.isArray(b.lignes) || !b.lignes.length) throw err(400, 'Ajoutez au moins une ligne budgétaire.', 'SAISIE');
  if (b.lignes.length > 100) throw err(400, '100 lignes au plus.', 'SAISIE');
  const lignes = b.lignes.map((l, i) => {
    const quoi = `Ligne ${i + 1}`;
    const q = nombre(l.quantite ?? 1, `${quoi} : quantité`, { min: 0, strict: true, decimales: 3 });
    const j = l.jours === undefined || l.jours === null || String(l.jours).trim() === '' ? null : nombre(l.jours, `${quoi} : jours`, { min: 0, strict: true });
    const pu = nombre(l.prix_unitaire, `${quoi} : prix unitaire`, { min: 0 });
    return { designation: texte(l.designation, 300, `${quoi} : désignation`, { obligatoire: true }), quantite: q, jours: j, prix_unitaire: pu,
      montant: Math.round(q * (j || 1) * pu) };
  });
  const total = lignes.reduce((s, l) => s + l.montant, 0);
  if (total <= 0) throw err(400, 'Le montant demandé est nul.', 'SAISIE');
  return { projetId: a.projet_id, activiteId: a.id, objet: texte(b.objet, 300, 'Objet', { obligatoire: true }),
    dateBesoin: dateIso(b.date_besoin, 'Date du besoin'), lignes, total };
};
const ecrireLignes = async (transaction, tenantId, demandeId, lignes) => {
  await X('DELETE FROM projet_demande_lignes WHERE demande_id = :id', { id: demandeId }, transaction);
  let ordre = 0;
  for (const l of lignes) {
    ordre += 1;
    await X(`INSERT INTO projet_demande_lignes (demande_id, tenant_id, ordre, designation, quantite, jours, prix_unitaire, montant)
             VALUES (:demandeId, :tenantId, :ordre, :designation, :quantite, :jours, :prix_unitaire, :montant)`,
    { demandeId, tenantId, ordre, ...l }, transaction);
  }
};

// Soumission : numéro DF-AAAA-00001 ; étape du chef acquise s'il n'y a pas de chef ou si le chef est le demandeur.
const soumettreDans = async (transaction, tenantId, d, userId) => {
  await Q('SELECT pg_advisory_xact_lock(hashtext(:k))', { k: `demandes_fonds_numero:${tenantId}` }, transaction);
  let numero = d.numero;
  if (!numero) {
    const an = new Date().getFullYear();
    const [{ dernier }] = await Q(
      `SELECT coalesce(max(substring(numero from '(\\d+)$')::int), 0) AS dernier FROM projet_demandes_fonds
        WHERE tenant_id = :t AND numero LIKE :prefixe`, { t: tenantId, prefixe: `DF-${an}-%` }, transaction);
    numero = `DF-${an}-${String(dernier + 1).padStart(5, '0')}`;
  }
  const [pr] = await Q('SELECT chef_projet_id FROM activites WHERE id = :p', { p: d.projet_id }, transaction);
  const sansChef = !pr.chef_projet_id || pr.chef_projet_id === userId;
  await X(`UPDATE projet_demandes_fonds SET numero = :numero, statut = :statut, soumis_le = NOW(), motif = '',
                  chef_par = :chef, chef_le = CASE WHEN :sansChef THEN NOW() ELSE NULL END
            WHERE id = :id`,
  { numero, statut: sansChef ? 'validee_chef' : 'soumise', chef: sansChef && pr.chef_projet_id ? userId : null, sansChef, id: d.id }, transaction);
  return { numero, statut: sansChef ? 'validee_chef' : 'soumise' };
};

const creer = async (req) => {
  const p = await profil(req);
  const b = req.body || {};
  return enTransaction(async (t) => {
    const s = await lireSaisie(req, p, b, t);
    const [[d]] = await X(
      `INSERT INTO projet_demandes_fonds (tenant_id, projet_id, activite_id, objet, date_besoin, total, demandeur_id)
       VALUES (:t, :p, :a, :objet, :date, :total, :u) RETURNING id, projet_id, numero`,
      { t: req.tenantId, p: s.projetId, a: s.activiteId, objet: s.objet, date: s.dateBesoin, total: s.total, u: req.user.id }, t);
    await ecrireLignes(t, req.tenantId, d.id, s.lignes);
    const r = b.soumettre ? await soumettreDans(t, req.tenantId, d, req.user.id) : { statut: 'brouillon' };
    return { id: String(d.id), ...r };
  }).then((r) => { if (b.soumettre) annoncerSansRisque(req, r.id, r.statut); return r; });
};

const modifier = async (req, id) => {
  const p = await profil(req);
  const b = req.body || {};
  return enTransaction(async (t) => {
    const d = await charger(req.tenantId, id, t, true);
    if (d.statut !== 'brouillon') throw err(409, 'Seul un brouillon se modifie.', 'DEMANDE_INTANGIBLE');
    if (d.demandeur_id !== p.userId && !p.chef.includes(Number(d.projet_id))) throw err(403, 'Vous n\'êtes pas l\'auteur de cette demande.', 'DEMANDE_NON_AUTORISEE');
    const s = await lireSaisie(req, p, b, t);
    await X(`UPDATE projet_demandes_fonds SET projet_id = :p, activite_id = :a, objet = :objet, date_besoin = :date, total = :total WHERE id = :id`,
      { p: s.projetId, a: s.activiteId, objet: s.objet, date: s.dateBesoin, total: s.total, id: d.id }, t);
    await ecrireLignes(t, req.tenantId, d.id, s.lignes);
    const r = b.soumettre ? await soumettreDans(t, req.tenantId, { ...d, projet_id: s.projetId }, req.user.id) : { statut: 'brouillon' };
    return { id: String(d.id), ...r };
  }).then((r) => { if (b.soumettre) annoncerSansRisque(req, r.id, r.statut); return r; });
};

const supprimer = async (req, id) => {
  const p = await profil(req);
  return enTransaction(async (t) => {
    const d = await charger(req.tenantId, id, t, true);
    if (d.statut !== 'brouillon') throw err(409, 'Seul un brouillon se supprime ; sinon annulez la demande.', 'DEMANDE_INTANGIBLE');
    if (d.demandeur_id !== p.userId && !p.chef.includes(Number(d.projet_id))) throw err(403, 'Vous n\'êtes pas l\'auteur de cette demande.', 'DEMANDE_NON_AUTORISEE');
    await X('DELETE FROM projet_demandes_fonds WHERE id = :id', { id: d.id }, t);
    return { supprimee: true };
  });
};

const soumettre = async (req, id) => {
  const p = await profil(req);
  return enTransaction(async (t) => {
    const d = await charger(req.tenantId, id, t, true);
    if (d.statut !== 'brouillon') throw err(409, 'Seul un brouillon se soumet.', 'DEMANDE_CIRCUIT');
    if (d.demandeur_id !== p.userId && !p.chef.includes(Number(d.projet_id))) throw err(403, 'Vous n\'êtes pas l\'auteur de cette demande.', 'DEMANDE_NON_AUTORISEE');
    return { id: d.id, ...(await soumettreDans(t, req.tenantId, d, req.user.id)) };
  }).then((r) => { annoncerSansRisque(req, r.id, r.statut); return { numero: r.numero, statut: r.statut }; });
};

// Validation : chef de projet (soumise → validee_chef), puis directeur (validee_chef → approuvee).
const valider = async (req, id) => {
  const p = await profil(req);
  return enTransaction(async (t) => {
    const d = await charger(req.tenantId, id, t, true);
    if (d.statut === 'soumise') {
      if (!p.chef.includes(Number(d.projet_id))) throw err(403, 'Seul le chef de ce projet valide la demande à cette étape.', 'CHEF_SEUL');
      await X(`UPDATE projet_demandes_fonds SET statut = 'validee_chef', chef_par = :u, chef_le = NOW() WHERE id = :id`, { u: req.user.id, id: d.id }, t);
      return { statut: 'validee_chef', id: d.id };
    }
    if (d.statut === 'validee_chef') {
      if (!p.directeur) throw err(403, 'Seul le directeur approuve une demande de fonds.', 'DIRECTEUR_SEUL');
      await X(`UPDATE projet_demandes_fonds SET statut = 'approuvee', directeur_par = :u, directeur_le = NOW() WHERE id = :id`, { u: req.user.id, id: d.id }, t);
      return { statut: 'approuvee', id: d.id };
    }
    throw err(409, 'Cette demande n\'attend pas de validation.', 'DEMANDE_CIRCUIT');
  }).then((r) => { annoncerSansRisque(req, r.id, r.statut); return { statut: r.statut }; });
};

// Renvoi pour correction, rejet définitif, annulation : motif obligatoire.
const decider = (action) => async (req, id) => {
  const p = await profil(req);
  const motif = texte(req.body?.motif, 500, 'Motif', { obligatoire: true });
  const demandeId = idNum(id, 'Demande');
  return enTransaction(async (t) => {
    const d = await charger(req.tenantId, id, t, true);
    const valideur = (d.statut === 'soumise' && p.chef.includes(Number(d.projet_id))) || (d.statut === 'validee_chef' && p.directeur);
    if (action === 'annuler') {
      const auteur = d.demandeur_id === p.userId;
      if (!(p.directeur || (auteur && ['brouillon', 'soumise', 'validee_chef'].includes(d.statut)))) {
        throw err(403, 'Une demande approuvée ne s\'annule que par le directeur.', 'DIRECTEUR_SEUL');
      }
      await X(`UPDATE projet_demandes_fonds SET statut = 'annulee', motif = :motif, annule_par = :u, annule_le = NOW() WHERE id = :id`,
        { motif, u: req.user.id, id: d.id }, t);
      await X(`UPDATE projet_ordres_decaissement SET statut = 'annule', motif = left('Demande annulée : ' || :motif, 300), traite_par = :u, traite_le = NOW()
                WHERE demande_id = :id AND statut = 'en_attente'`, { motif, u: req.user.id, id: d.id }, t);
      return { statut: 'annulee' };
    }
    if (!valideur) throw err(403, 'Seul le valideur de l\'étape en cours peut renvoyer ou rejeter la demande.', 'DEMANDE_NON_AUTORISEE');
    const statut = action === 'renvoyer' ? 'brouillon' : 'rejetee';
    await X('UPDATE projet_demandes_fonds SET statut = :statut, motif = :motif WHERE id = :id', { statut, motif, id: d.id }, t);
    return { statut };
  }).then((r) => { annoncerSansRisque(req, demandeId, r.statut); return r; });
};

// ── Décaissement et reversement : la saisie de caisse elle-même ─────────────
// `creerMouvement(corps)` appelle POST /api/journal pour la même personne (mêmes
// contrôles : période, ordre chronologique, solde). Le lien à la demande est
// posé dans la transaction de l'écriture (voir lienCaisse / relierMouvement).
const mouvement = (sens) => async (req, id, { creerMouvement }) => {
  const p = await profil(req);
  if (!p.caisse) throw err(403, 'Permission requise : saisir en caisse.', 'CAISSE_SEULE');
  const b = req.body || {};
  const d = await charger(req.tenantId, id);
  if (d.statut !== 'approuvee') throw err(409, 'La demande n\'est pas approuvée.', 'DEMANDE_NON_APPROUVEE');
  const [c] = await Q('SELECT * FROM projet_demande_chiffres(:id)', { id: d.id });
  // Décaissement : la caisse exécute un ordre initié par le chef de projet (086),
  // pour son montant exact ; elle ne décaisse jamais de sa propre initiative.
  let ordre = null;
  if (sens === 'decaissement') {
    if (!b.ordre_id) throw err(409, 'Le décaissement est initié par le chef de projet : validez un ordre de décaissement en attente.', 'ORDRE_REQUIS');
    [ordre] = await Q(`${SELECT_ORDRE} WHERE o.id = :o AND o.tenant_id = :t`, { o: idNum(b.ordre_id, 'Ordre de décaissement'), t: req.tenantId });
    if (!ordre || ordre.demande_id !== String(d.id)) throw err(404, 'Ordre de décaissement introuvable.', 'ORDRE_INTROUVABLE');
    if (ordre.statut !== 'en_attente') throw err(409, 'Cet ordre de décaissement a déjà été traité.', 'ORDRE_TRAITE');
    if (ordre.initie_par === req.user.id) {
      throw err(403, 'Vous avez initié ce décaissement : une autre personne de la caisse doit valider la sortie.', 'MEME_PERSONNE');
    }
  }
  const plafond = sens === 'decaissement' ? n(ordre.montant) : n(c.decaisse) - n(c.depenses) - n(c.reverse);
  const montant = sens === 'decaissement' || b.montant === undefined || b.montant === '' ? plafond : nombre(b.montant, 'Montant', { min: 0, strict: true });
  if (plafond <= 0) throw err(409, 'Aucun reliquat à reverser.', 'RIEN_A_FAIRE');
  if (montant > plafond) throw err(409, `Reliquat : ${fmt(plafond)} FCFA.`, 'PLAFOND');
  const jour = dateIso(b.date, 'Date') || new Date().toISOString().slice(0, 10);
  const journalId = idNum(b.journal_id, 'Caisse ou banque');
  const rubrique = texte(b.rubrique_code, 40, 'Rubrique', { obligatoire: true });
  const [r] = await Q('SELECT type FROM rubriques WHERE tenant_id = :t AND code = :c', { t: req.tenantId, c: rubrique });
  if (!r || (sens === 'decaissement' ? r.type === 'entree' : r.type !== 'entree')) {
    throw err(400, sens === 'decaissement' ? 'Choisissez une rubrique de dépense.' : 'Choisissez une rubrique d\'entrée pour le reversement.', 'RUBRIQUE');
  }
  // Décision de Franck (26/11) : on regarde le solde AVANT de décaisser. Une caisse
  // (hors banque) qui n'a pas l'argent ne décaisse pas : le manque passe par la
  // Demande de fonds de Caisse Pro (voir solliciter).
  if (sens === 'decaissement') {
    const etat = await soldeDisponible(req.tenantId, journalId, jour);
    if (!etat.banque && montant > etat.solde + 0.004) {
      throw Object.assign(err(409, `Solde insuffisant dans « ${etat.nom} » : ${fmt(etat.solde)} FCFA disponibles pour ${fmt(montant)} FCFA à décaisser `
        + `(il manque ${fmt(montant - etat.solde)} FCFA). Sollicitez la Demande de fonds pour réapprovisionner la caisse.`, 'SOLDE_INSUFFISANT'),
      { details: { disponible: etat.solde, manque: Math.round((montant - Math.max(etat.solde, 0)) * 100) / 100, journal_id: String(journalId) } });
    }
  }
  const [a] = await Q('SELECT a.nom, pr.nom AS projet FROM activites a JOIN activites pr ON pr.id = a.projet_id WHERE a.id = :a', { a: d.activite_id });
  const [u] = await Q('SELECT username FROM users WHERE id = :u', { u: d.demandeur_id });
  const corps = {
    date: jour, mois: MOIS[Number(jour.slice(5, 7)) - 1], annee: Number(jour.slice(0, 4)), journal_id: journalId, rubrique_code: rubrique,
    intitule: `${sens === 'decaissement' ? 'Fonds' : 'Reliquat'} ${d.numero} — ${a.projet} / ${a.nom}`.slice(0, 200),
    objet: d.objet.slice(0, 200), beneficiaire: texte(b.beneficiaire, 150, 'Bénéficiaire') || ordre?.beneficiaire || u?.username || '',
    activite_id: d.activite_id, demande_fonds_id: String(d.id), ...(ordre ? { ordre_decaissement_id: ordre.id } : {}),
    ...(sens === 'decaissement' ? { sortie: montant, entree: 0 } : { entree: montant, sortie: 0 }),
  };
  const res = await creerMouvement(corps);
  if (res.status >= 400) throw err(res.status, res.data?.error || 'Saisie refusée.', res.data?.code || 'SAISIE_CAISSE');
  if (res.data?.en_attente) throw err(409, 'La sortie a été mise en attente du directeur au lieu d\'être enregistrée.', 'EN_ATTENTE');
  annoncerSansRisque(req, d.id, sens, { montant, initiateur: ordre?.initie_par });
  return { journal_id: String(res.data.id), numero: res.data.numero, montant, ...(ordre ? { ordre_id: ordre.id } : {}) };
};

// ── Ordres de décaissement (086) ────────────────────────────────────────────
// Le chef de projet (ou le directeur) initie ; le paiement reste en attente ;
// la caisse remet les fonds et valide la sortie (mouvement du journal à son nom),
// puis imprime le bon de sortie signé par le bénéficiaire.
const SELECT_ORDRE = `
  SELECT o.id::text AS id, o.demande_id::text AS demande_id, o.montant, o.beneficiaire, o.instructions, o.statut, o.initie_le, o.traite_le,
         o.motif, o.journal_id::text AS journal_id, o.initie_par, o.traite_par, ui.username AS initie_par_nom, ut.username AS traite_par_nom,
         d.numero, d.objet, d.projet_id, d.activite_id, d.demandeur_id, p.nom AS projet, a.nom AS activite, ud.username AS demandeur,
         j.numero AS mouvement_numero, j.date::text AS mouvement_date, coalesce(j.annule, false) AS mouvement_annule,
         jx.nom AS caisse, jx.code AS caisse_code
    FROM projet_ordres_decaissement o JOIN projet_demandes_fonds d ON d.id = o.demande_id
    JOIN activites p ON p.id = d.projet_id JOIN activites a ON a.id = d.activite_id
    LEFT JOIN users ui ON ui.id = o.initie_par LEFT JOIN users ut ON ut.id = o.traite_par LEFT JOIN users ud ON ud.id = d.demandeur_id
    LEFT JOIN journal j ON j.id = o.journal_id LEFT JOIN journaux jx ON jx.id = j.journal_id`;
const numeroOrdre = (id) => `OD-${String(id).padStart(5, '0')}`;
const formerOrdre = (o) => {
  const { initie_par: _i, traite_par: _t, demandeur_id: _d, ...reste } = o;
  return { ...reste, montant: n(o.montant), numero_ordre: numeroOrdre(o.id) };
};
const peutVoirOrdre = (p, o) => p.caisse || voitTout(p) || p.chef.includes(Number(o.projet_id))
  || p.responsable.includes(Number(o.activite_id)) || o.demandeur_id === p.userId || o.initie_par === p.userId;
const chargerOrdre = async (req, p, id) => {
  const [o] = await Q(`${SELECT_ORDRE} WHERE o.id = :id AND o.tenant_id = :t`, { id: idNum(id, 'Ordre de décaissement'), t: req.tenantId });
  if (!o || !peutVoirOrdre(p, o)) throw err(404, 'Ordre de décaissement introuvable.', 'ORDRE_INTROUVABLE');
  return o;
};

const initier = async (req, id) => {
  const p = await profil(req);
  const b = req.body || {};
  const beneficiaire = texte(b.beneficiaire, 150, 'Bénéficiaire');
  const instructions = texte(b.instructions, 300, 'Instructions');
  const r = await enTransaction(async (t) => {
    const d = await charger(req.tenantId, id, t, true);
    if (!peutInitier(p, d)) throw err(403, 'Seul le chef de projet (ou le directeur) initie le décaissement.', 'CHEF_SEUL');
    if (d.statut !== 'approuvee') throw err(409, 'La demande n\'est pas approuvée.', 'DEMANDE_NON_APPROUVEE');
    const [c] = await Q('SELECT * FROM projet_demande_chiffres(:id)', { id: d.id }, t);
    const [{ attente }] = await Q(`SELECT coalesce(sum(montant), 0) AS attente FROM projet_ordres_decaissement
                                    WHERE demande_id = :id AND statut = 'en_attente'`, { id: d.id }, t);
    const reste = Math.round((n(d.total) - n(c.decaisse) - n(attente)) * 100) / 100;
    if (reste <= 0) {
      throw err(409, n(attente) > 0 ? 'Le reste à décaisser attend déjà la validation de la caisse.' : 'Tout est déjà décaissé.', 'RIEN_A_FAIRE');
    }
    const montant = b.montant === undefined || b.montant === '' ? reste : nombre(b.montant, 'Montant', { min: 0, strict: true });
    if (montant > reste + 0.004) throw err(409, `Reste à décaisser : ${fmt(reste)} FCFA.`, 'PLAFOND');
    const [u] = await Q('SELECT username FROM users WHERE id = :u', { u: d.demandeur_id }, t);
    const [[o]] = await X(`INSERT INTO projet_ordres_decaissement (tenant_id, demande_id, montant, beneficiaire, instructions, initie_par)
                           VALUES (:t, :d, :m, :b, :i, :u) RETURNING id`,
    { t: req.tenantId, d: d.id, m: montant, b: beneficiaire || u?.username || '', i: instructions, u: req.user.id }, t);
    await X(`INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, nouvelle_valeur)
             VALUES (:t, :u, 'ORDRE_DECAISSEMENT', 'projet_ordres_decaissement', :id, CAST(:det AS jsonb))`,
    { t: req.tenantId, u: req.user.id, id: String(o.id), det: JSON.stringify({ demande: d.numero, montant }) }, t);
    return { id: String(o.id), demandeId: d.id, montant, beneficiaire: beneficiaire || u?.username || '' };
  });
  annoncerSansRisque(req, r.demandeId, 'ordre', { montant: r.montant, beneficiaire: r.beneficiaire });
  return formerOrdre(await chargerOrdre(req, await profil(req), r.id));
};

// La caisse refuse (fonds non remis : bénéficiaire absent, montant contesté…),
// ou l'initiateur / le directeur retire l'ordre. Motif obligatoire.
const clore = (statut) => async (req, id) => {
  const p = await profil(req);
  const motif = texte(req.body?.motif, 300, 'Motif', { obligatoire: true });
  const o = await chargerOrdre(req, p, id);
  if (o.statut !== 'en_attente') throw err(409, 'Cet ordre de décaissement a déjà été traité.', 'ORDRE_TRAITE');
  if (statut === 'refuse' && !p.caisse) throw err(403, 'Seule la caisse refuse une sortie.', 'CAISSE_SEULE');
  if (statut === 'annule' && !(o.initie_par === p.userId || p.directeur)) {
    throw err(403, 'Seul l\'initiateur ou le directeur retire un ordre de décaissement.', 'INITIATEUR_SEUL');
  }
  const [, meta] = await enTransaction((t) => X(`UPDATE projet_ordres_decaissement SET statut = :s, motif = :motif, traite_par = :u, traite_le = NOW()
                                                WHERE id = :id AND tenant_id = :t AND statut = 'en_attente'`,
  { s: statut, motif, u: req.user.id, id: o.id, t: req.tenantId }, t));
  if (meta.rowCount !== 1) throw err(409, 'Cet ordre de décaissement vient d\'être traité.', 'ORDRE_TRAITE');
  annoncerSansRisque(req, Number(o.demande_id), statut === 'refuse' ? 'ordre_refuse' : 'ordre_annule',
    { montant: o.montant, motif, initiateur: o.initie_par });
  return formerOrdre(await chargerOrdre(req, p, o.id));
};

const listerOrdres = async (req) => {
  const p = await profil(req);
  const statut = ['en_attente', 'execute', 'refuse', 'annule'].includes(req.query.statut) ? req.query.statut : null;
  const lignes = await Q(`${SELECT_ORDRE} WHERE o.tenant_id = :t AND (CAST(:s AS TEXT) IS NULL OR o.statut = :s) ORDER BY o.id DESC LIMIT 500`,
    { t: req.tenantId, s: statut });
  return {
    ordres: lignes.filter((o) => peutVoirOrdre(p, o)).map((o) => ({ ...formerOrdre(o), de_moi: o.initie_par === p.userId,
      a_moi_de_valider: o.statut === 'en_attente' && p.caisse && o.initie_par !== p.userId })),
    caisse: p.caisse,
  };
};

/** Bon de sortie de caisse : à faire signer par le bénéficiaire au moment de la remise des fonds. */
const bonDeSortiePdf = async (req, id) => {
  const p = await profil(req);
  const o = await chargerOrdre(req, p, id);
  if (o.statut !== 'execute') throw err(409, 'Le bon de sortie s\'imprime une fois la sortie validée par la caisse.', 'ORDRE_NON_EXECUTE');
  const { dateFr, montantEnLettres, COULEURS } = require('./commercial/bc_pdf.service');
  const mp = require('./commercial/ventes_pdf.service');
  const s = await require('./entreprise.service').identitePour(req.tenantId, null);
  const numero = o.mouvement_numero ? `N° ${o.mouvement_numero}` : numeroOrdre(o.id);
  const { doc, fin } = mp.nouveauDoc(`Bon de sortie ${numero}`, s);
  const m = (v) => Math.round(n(v)).toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ');
  let y = mp.entete(doc, s, 'BON DE SORTIE DE CAISSE', numero, [
    `Date : ${dateFr(o.mouvement_date)}`, `Caisse : ${o.caisse}${o.caisse_code ? ` (${o.caisse_code})` : ''}`,
    `Ordre : ${numeroOrdre(o.id)}`, 'Montants en FCFA']);
  y = mp.boites(doc, y, ['Bénéficiaire', [o.beneficiaire || o.demandeur || '—', o.demandeur && o.demandeur !== o.beneficiaire ? `Demandeur : ${o.demandeur}` : '']],
    ['Demande de fonds', [o.numero, `Projet : ${o.projet}`, `Activité : ${o.activite}`]]);
  y = mp.tableau(doc, y, [['Réf.', 80, 'left'], ['Objet', 335, 'left'], ['Montant', 100, 'right']],
    [[o.numero, `${o.objet}${o.instructions ? `\n${o.instructions}` : ''}`, m(o.montant)]]);
  const lettres = montantEnLettres(o.montant, 'XAF');
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#0f172a')
    .text(`Arrêté le présent bon à la somme de ${lettres.charAt(0).toUpperCase()}${lettres.slice(1)}.`, 40, y + 12, { width: 515 });
  doc.font('Helvetica').fontSize(8.3).fillColor('#475569').text([
    `Décaissement initié par ${o.initie_par_nom || '—'} le ${dateFr(String(o.initie_le.toISOString ? o.initie_le.toISOString() : o.initie_le).slice(0, 10))}.`,
    `Sortie validée par ${o.traite_par_nom || '—'} (caisse) le ${dateFr(String(o.traite_le.toISOString ? o.traite_le.toISOString() : o.traite_le).slice(0, 10))}.`,
  ].join('\n'), 40, doc.y + 6, { width: 515, lineGap: 1 });
  y = doc.y + 18;
  if (y > 650) { doc.addPage(); y = 50; }
  const wZ = (515 - 24) / 3;
  mp.zoneSignature(doc, 40, y, wZ, 92, `Le caissier / la caissière — ${o.traite_par_nom || ''}\nfonds remis`);
  mp.zoneSignature(doc, 40 + wZ + 12, y, wZ, 92, 'Le bénéficiaire — « reçu la somme ci-dessus », date et signature');
  mp.zoneSignature(doc, 40 + 2 * (wZ + 12), y, wZ, 92, `Le chef de projet — ${o.initie_par_nom || ''}\nvisa`);
  doc.fillColor(COULEURS.GRIS);
  mp.finaliser(doc, s, numero, o.mouvement_annule ? 'MOUVEMENT ANNULÉ' : '');   // termine le document
  return { contenu: await fin, nom: `bon-de-sortie-${String(o.mouvement_numero || numeroOrdre(o.id)).replace(/[^\w-]/g, '_')}.pdf` };
};

// Solde d'une caisse ou d'une banque à la date du mouvement (mois de la date).
const MOIS_SOLDE = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
const soldeDisponible = async (tenantId, journalId, jour) => {
  const [j] = await Q('SELECT id, nom, type FROM journaux WHERE id = :j AND tenant_id = :t', { j: journalId, t: tenantId });
  if (!j) throw err(400, 'Caisse ou banque introuvable.', 'JOURNAL');
  const s = await journalSvc.soldeJournal(tenantId, MOIS_SOLDE[Number(jour.slice(5, 7)) - 1], Number(jour.slice(0, 4)), journalId);
  return { nom: j.nom, banque: j.type === 'banque', solde: Math.round(n(s.solde) * 100) / 100 };
};

/**
 * Le solde ne suffit pas : le manque est porté à la Demande de fonds de Caisse Pro
 * de la période en cours (ligne de « dépenses en attente » sur la rubrique du
 * décaissement), que le directeur valide comme aujourd'hui. Mail au directeur.
 */
const solliciter = async (req, id) => {
  const p = await profil(req);
  if (!p.caisse) throw err(403, 'Permission requise : saisir en caisse.', 'CAISSE_SEULE');
  const b = req.body || {};
  const d = await charger(req.tenantId, id);
  if (d.statut !== 'approuvee') throw err(409, 'La demande n\'est pas approuvée.', 'DEMANDE_NON_APPROUVEE');
  const [c] = await Q('SELECT * FROM projet_demande_chiffres(:id)', { id: d.id });
  const reste = n(d.total) - n(c.decaisse);
  const voulu = b.montant === undefined || b.montant === '' ? reste : Math.min(nombre(b.montant, 'Montant', { min: 0, strict: true }), reste);
  const jour = new Date().toISOString().slice(0, 10);
  const journalId = idNum(b.journal_id, 'Caisse');
  const etat = await soldeDisponible(req.tenantId, journalId, jour);
  if (etat.banque) throw err(400, 'Une banque n\'est pas réapprovisionnée par la Demande de fonds : choisissez la caisse.', 'JOURNAL');
  const manque = Math.round((voulu - Math.max(etat.solde, 0)) * 100) / 100;
  if (manque <= 0) throw err(409, `La caisse « ${etat.nom} » a assez d'argent (${fmt(etat.solde)} FCFA) : décaissez directement.`, 'SOLDE_SUFFISANT');
  const rubrique = texte(b.rubrique_code, 40, 'Rubrique', { obligatoire: true });
  const [r] = await Q('SELECT type FROM rubriques WHERE tenant_id = :t AND code = :c', { t: req.tenantId, c: rubrique });
  if (!r || r.type === 'entree') throw err(400, 'Choisissez la rubrique de dépense du décaissement.', 'RUBRIQUE');
  const mois = MOIS_SOLDE[Number(jour.slice(5, 7)) - 1]; const annee = Number(jour.slice(0, 4));
  const semaine = (await hebdo.estHebdo(req.tenantId, mois, annee)) ? hebdo.semaineDeDate(jour).semaine : null;
  const periode = semaine ? `la semaine ${semaine} de ${mois} ${annee}` : `${mois} ${annee}`;
  const [v] = await Q(`SELECT statut FROM budget_validation WHERE tenant_id = :t AND mois = :mois AND annee = :annee AND semaine IS NOT DISTINCT FROM :semaine`,
    { t: req.tenantId, mois, annee, semaine });
  if (v?.statut === 'valide') {
    annoncerSansRisque(req, d.id, 'sollicitation', { caisse: etat.nom, solde: etat.solde, manque, periode, rubrique, figee: true });
    throw err(409, `La Demande de fonds de ${periode} est déjà validée : elle ne peut plus recevoir ce besoin. `
      + 'Le directeur vient d\'être prévenu ; il doit la remettre « en attente » pour l\'y ajouter.', 'DEMANDE_FONDS_VALIDEE');
  }
  const res = await enTransaction(async (t) => {
    await Q('SELECT pg_advisory_xact_lock(hashtext(:k))', { k: `depenses_attente:${req.tenantId}:${mois}:${annee}:${semaine || 0}` }, t);
    const libelle = `Réappro. caisse ${etat.nom} — ${d.numero}`;
    const [ex] = await Q(`SELECT id FROM depenses_attente WHERE tenant_id = :t AND mois = :mois AND annee = :annee AND coalesce(semaine, 0) = :s AND rubrique_code = :rub FOR UPDATE`,
      { t: req.tenantId, mois, annee, s: semaine || 0, rub: rubrique }, t);
    let ligneId;
    if (ex) {
      await X(`UPDATE depenses_attente SET montant = coalesce(montant, 0) + :m, intitule = left(intitule || ' ; ' || :lib, 250) WHERE id = :id`,
        { m: manque, lib: libelle, id: ex.id }, t);
      ligneId = ex.id;
    } else {
      const [[l]] = await X(`INSERT INTO depenses_attente (tenant_id, mois, annee, semaine, rubrique_code, intitule, montant)
                             VALUES (:t, :mois, :annee, :semaine, :rub, :lib, :m) RETURNING id`,
      { t: req.tenantId, mois, annee, semaine, rub: rubrique, lib: libelle, m: manque }, t);
      ligneId = l.id;
    }
    await X(`INSERT INTO projet_demande_sollicitations (tenant_id, demande_id, journal_id, rubrique_code, montant, solde_constate, mois, annee, semaine, depense_attente_id, demandee_par)
             VALUES (:t, :d, :j, :rub, :m, :solde, :mois, :annee, :semaine, :ligne, :u)`,
    { t: req.tenantId, d: d.id, j: journalId, rub: rubrique, m: manque, solde: etat.solde, mois, annee, semaine, ligne: ligneId, u: req.user.id }, t);
    return { manque, mois, annee, semaine, periode, solde: etat.solde };
  });
  annoncerSansRisque(req, d.id, 'sollicitation', { caisse: etat.nom, solde: etat.solde, manque, periode, rubrique });
  return res;
};

/** Appelé quand le directeur décide de la Demande de fonds d'une période (budget.controller). */
const annoncerDecisionDemandeFonds = async ({ tenantId, user, mois, annee, semaine, statut }) => {
  const lignes = await Q(`SELECT s.demande_id, s.montant, d.numero, d.demandeur_id, j.nom AS caisse
                            FROM projet_demande_sollicitations s JOIN projet_demandes_fonds d ON d.id = s.demande_id
                            JOIN journaux j ON j.id = s.journal_id
                           WHERE s.tenant_id = :t AND s.mois = :mois AND s.annee = :annee AND s.semaine IS NOT DISTINCT FROM :semaine`,
  { t: tenantId, mois, annee: Number(annee), semaine: semaine || null });
  if (!lignes.length || !['valide', 'rejete'].includes(statut)) return 0;
  const periode = semaine ? `la semaine ${semaine} de ${mois} ${annee}` : `${mois} ${annee}`;
  const valide = statut === 'valide';
  notifs.plusTard({ tenantId, auteurId: user?.id, destinataires: { permission: 'journal.create', ids: lignes.map((l) => l.demandeur_id) },
    type: 'demande_fonds_reappro', titre: `Demande de fonds de ${periode} ${valide ? 'validée' : 'rejetée'}`,
    lignes: [valide ? 'Le directeur a validé la Demande de fonds : réapprovisionnez la caisse, puis décaissez.' : 'Le directeur a rejeté la Demande de fonds : les décaissements ci-dessous restent en attente de fonds.',
      ...lignes.map((l) => `${l.numero} : ${fmt(l.montant)} FCFA pour la caisse « ${l.caisse} ».`)],
    chemin: '/projets/demandes?vue=a_decaisser', refType: 'demande_fonds', refId: lignes[0].demande_id });
  return lignes.length;
};

/** Appelé par la saisie de caisse (journal.controller) quand le corps porte demande_fonds_id. */
const lienCaisse = async (tenantId, demandeId, { entree, sortie, ordreId, userId }) => {
  const id = idNum(demandeId, 'Demande de fonds');
  const [d] = await Q('SELECT id, statut, activite_id, numero FROM projet_demandes_fonds WHERE id = :id AND tenant_id = :t', { id, t: tenantId });
  if (!d) throw err(400, 'Demande de fonds introuvable.', 'DEMANDE_INTROUVABLE');
  if (d.statut !== 'approuvee') throw err(409, `La demande ${d.numero} n'est pas approuvée.`, 'DEMANDE_NON_APPROUVEE');
  const s = n(sortie); const e = n(entree);
  if ((s > 0) === (e > 0)) throw err(400, 'Un mouvement relié à une demande est soit une sortie (décaissement), soit une entrée (reliquat).', 'SAISIE');
  if (s <= 0) return { demandeId: id, activiteId: Number(d.activite_id), sens: 'reversement', ordreId: null };
  // 086 : une sortie reliée à une demande exécute un ordre initié par le chef de projet.
  if (!ordreId) throw err(409, 'Le décaissement d\'une demande de fonds est initié par le chef de projet : validez l\'ordre en attente (Caisse Pro → Fonds à décaisser).', 'ORDRE_REQUIS');
  const [o] = await Q('SELECT id, demande_id, montant, statut, initie_par FROM projet_ordres_decaissement WHERE id = :o AND tenant_id = :t',
    { o: idNum(ordreId, 'Ordre de décaissement'), t: tenantId });
  if (!o || Number(o.demande_id) !== id) throw err(404, 'Ordre de décaissement introuvable.', 'ORDRE_INTROUVABLE');
  if (o.statut !== 'en_attente') throw err(409, 'Cet ordre de décaissement a déjà été traité.', 'ORDRE_TRAITE');
  if (Math.abs(n(o.montant) - s) > 0.004) throw err(409, `La sortie doit être de ${fmt(o.montant)} FCFA, le montant de l'ordre.`, 'ORDRE_MONTANT');
  if (o.initie_par && o.initie_par === userId) throw err(403, 'Vous avez initié ce décaissement : une autre personne de la caisse doit valider la sortie.', 'MEME_PERSONNE');
  return { demandeId: id, activiteId: Number(d.activite_id), sens: 'decaissement', ordreId: Number(o.id) };
};
const relierMouvement = async (tenantId, lien, journalId, userId, transaction) => {
  await X(`INSERT INTO projet_demande_mouvements (tenant_id, demande_id, journal_id, sens, cree_par, ordre_id) VALUES (:t, :d, :j, :s, :u, :o)`,
    { t: tenantId, d: lien.demandeId, j: journalId, s: lien.sens, u: userId || null, o: lien.ordreId || null }, transaction);
  if (!lien.ordreId) return;
  const [, meta] = await X(`UPDATE projet_ordres_decaissement SET statut = 'execute', journal_id = :j, traite_par = :u, traite_le = NOW()
                             WHERE id = :o AND tenant_id = :t AND statut = 'en_attente'`,
  { j: journalId, u: userId || null, o: lien.ordreId, t: tenantId }, transaction);
  if (meta.rowCount !== 1) throw err(409, 'Cet ordre de décaissement vient d\'être traité par quelqu\'un d\'autre.', 'ORDRE_TRAITE');
};

// ── Dépenses ────────────────────────────────────────────────────────────────
const declarer = async (req, id) => {
  const p = await profil(req);
  const b = req.body || {};
  const d = await charger(req.tenantId, id);
  if (!(d.demandeur_id === p.userId || p.responsable.includes(Number(d.activite_id)))) {
    throw err(403, 'Seuls le demandeur et le responsable de l\'activité déclarent les dépenses.', 'DEPENSE_NON_AUTORISEE');
  }
  let fichier = null;
  if (b.data_base64) {
    try { fichier = pv.preparer({ nom_fichier: b.nom_fichier, data_base64: b.data_base64 }); } catch (e) { throw err(e.status || 400, e.message.replace(/PV/g, 'justificatif'), 'FICHIER'); }
  }
  if (!fichier) throw err(400, 'Joignez la pièce justificative (PDF ou photo).', 'FICHIER');
  const ligneId = b.ligne_id ? idNum(b.ligne_id, 'Ligne budgétaire') : null;
  return enTransaction(async (t) => {
    if (ligneId) {
      const [l] = await Q('SELECT id FROM projet_demande_lignes WHERE id = :l AND demande_id = :d', { l: ligneId, d: d.id }, t);
      if (!l) throw err(400, 'Ligne budgétaire introuvable sur cette demande.', 'SAISIE');
    }
    const [[x]] = await X(
      `INSERT INTO projet_depenses (tenant_id, demande_id, ligne_id, date_depense, designation, beneficiaire, montant, declare_par)
       VALUES (:t, :d, :l, :date, :designation, :beneficiaire, :montant, :u) RETURNING id`,
      { t: req.tenantId, d: d.id, l: ligneId, date: dateIso(b.date_depense, 'Date de la dépense', { obligatoire: true }),
        designation: texte(b.designation, 300, 'Désignation', { obligatoire: true }), beneficiaire: texte(b.beneficiaire, 200, 'Bénéficiaire'),
        montant: nombre(b.montant, 'Montant', { min: 0, strict: true }), u: req.user.id }, t);
    const chemin = await pv.enregistrer(req.tenantId, 'depenses-projets', x.id, fichier);
    await X('UPDATE projet_depenses SET fichier_chemin = :c, fichier_nom = :nom, mime = :mime, sha256 = :sha WHERE id = :id',
      { c: chemin, nom: fichier.nom, mime: fichier.mime, sha: fichier.sha256, id: x.id }, t);
    return { id: String(x.id) };
  }).then((r) => { annoncerSansRisque(req, d.id, 'depense', { designation: String(b.designation).trim(), montant: Number(String(b.montant).replace(',', '.')) }); return r; });
};

const chargerDepense = async (req, p, id, transaction, verrou = false) => {
  const [x] = await Q(`SELECT x.*, d.projet_id, d.activite_id, d.demandeur_id, d.statut AS statut_demande
                         FROM projet_depenses x JOIN projet_demandes_fonds d ON d.id = x.demande_id
                        WHERE x.id = :id AND x.tenant_id = :t${verrou ? ' FOR UPDATE OF x' : ''}`,
  { id: idNum(id, 'Dépense'), t: req.tenantId }, transaction);
  if (!x || !peutVoir(p, { ...x, statut: x.statut_demande })) throw err(404, 'Dépense introuvable.', 'DEPENSE_INTROUVABLE');
  return x;
};

const retirerDepense = async (req, id) => {
  const p = await profil(req);
  return enTransaction(async (t) => {
    const x = await chargerDepense(req, p, id, t, true);
    if (x.declare_par !== p.userId) throw err(403, 'Seul l\'auteur retire sa déclaration.', 'DEPENSE_NON_AUTORISEE');
    if (x.statut !== 'declaree') throw err(409, 'Une dépense contrôlée ne se retire pas.', 'DEPENSE_INTANGIBLE');
    await X('DELETE FROM projet_depenses WHERE id = :id', { id: x.id }, t);
    return { supprimee: true };
  });
};

const controler = async (req, id) => {
  const p = await profil(req);
  if (!p.comptable) throw err(403, 'Le contrôle des dépenses revient au comptable.', 'COMPTABLE_SEUL');
  const decision = req.body?.decision === 'rejeter' ? 'rejetee' : req.body?.decision === 'valider' ? 'validee' : null;
  if (!decision) throw err(400, 'Décision : valider ou rejeter.', 'SAISIE');
  const motif = texte(req.body?.motif, 500, 'Motif', { obligatoire: decision === 'rejetee' });
  return enTransaction(async (t) => {
    const x = await chargerDepense(req, p, id, t, true);
    if (x.statut !== 'declaree') throw err(409, 'Dépense déjà contrôlée.', 'DEPENSE_INTANGIBLE');
    if (x.declare_par === p.userId) throw err(403, 'Vous ne contrôlez pas une dépense que vous avez déclarée.', 'AUTOCONTROLE');
    await X('UPDATE projet_depenses SET statut = :s, motif = :m, controle_par = :u, controle_le = NOW() WHERE id = :id',
      { s: decision, m: motif, u: req.user.id, id: x.id }, t);
    return { statut: decision, x };
  }).then(({ statut, x }) => {
    if (statut === 'rejetee') annoncerSansRisque(req, x.demande_id, 'depense_rejetee', { declarant: x.declare_par, designation: x.designation, montant: x.montant, motif });
    return { statut };
  });
};

const listerDepenses = async (req) => {
  const p = await profil(req);
  const vue = String(req.query.vue || '');
  const rows = await Q(
    `SELECT x.id::text AS id, x.demande_id::text AS demande_id, d.numero, x.date_depense::text AS date_depense, x.designation, x.beneficiaire, x.montant,
            x.fichier_nom, x.mime, x.statut, x.motif, x.declare_par, ud.username AS declare_par_nom, uc.username AS controle_par_nom,
            d.projet_id, d.activite_id, d.demandeur_id, d.statut AS statut_demande, p.nom AS projet, a.nom AS activite
       FROM projet_depenses x JOIN projet_demandes_fonds d ON d.id = x.demande_id
       JOIN activites p ON p.id = d.projet_id JOIN activites a ON a.id = d.activite_id
       LEFT JOIN users ud ON ud.id = x.declare_par LEFT JOIN users uc ON uc.id = x.controle_par
      WHERE x.tenant_id = :t ORDER BY (x.statut = 'declaree') DESC, x.date_depense DESC, x.id DESC LIMIT 1000`, { t: req.tenantId });
  const visibles = rows.filter((x) => peutVoir(p, { ...x, statut: x.statut_demande }));
  const filtres = {
    a_controler: (x) => x.statut === 'declaree' && p.comptable && x.declare_par !== p.userId,
    mes: (x) => x.declare_par === p.userId,
  };
  const out = (filtres[vue] ? visibles.filter(filtres[vue]) : visibles)
    .map((x) => ({ ...x, montant: n(x.montant), de_moi: x.declare_par === p.userId, declare_par: undefined, demandeur_id: undefined }));
  return { depenses: out, compteurs: { a_controler: visibles.filter(filtres.a_controler).length }, comptable: p.comptable };
};

const fichierDepense = async (req, id) => {
  const p = await profil(req);
  const x = await chargerDepense(req, p, id);
  if (!x.fichier_chemin) throw err(404, 'Aucune pièce pour cette dépense.', 'FICHIER_ABSENT');
  const chemin = pv.cheminComplet(x.fichier_chemin);
  try { await fs.promises.access(chemin, fs.constants.R_OK); } catch (e) {
    throw err(410, `La pièce est introuvable sur le serveur (${e.code}).`, 'FICHIER_ABSENT');
  }
  return { chemin, nom: x.fichier_nom || 'piece', mime: x.mime || 'application/octet-stream' };
};

// ── Rapport financier ───────────────────────────────────────────────────────
const rapport = async (req) => {
  const p = await profil(req);
  const projetId = req.query.projet_id ? idNum(req.query.projet_id, 'Projet') : null;
  const projets = (await Q(
    `SELECT id, nom, code, date_debut::text AS date_debut, date_fin::text AS date_fin, chef_projet_id FROM activites
      WHERE tenant_id = :t AND type = 'projet' AND (CAST(:p AS INTEGER) IS NULL OR id = :p) ORDER BY nom`, { t: req.tenantId, p: projetId }))
    .filter((x) => voitTout(p) || p.chef.includes(Number(x.id)) || p.projetsResponsable.includes(Number(x.id)));
  if (projetId && !projets.length) throw err(404, 'Projet introuvable.', 'PROJET_INTROUVABLE');
  const ids = projets.map((x) => x.id);
  if (!ids.length) return { projets: [], genere_le: new Date().toISOString() };
  const lignes = await Q(
    `SELECT a.id, a.projet_id, a.nom, u.username AS responsable,
            coalesce(sum(d.total) FILTER (WHERE d.statut = 'approuvee'), 0) AS approuve,
            coalesce(sum(c.decaisse) FILTER (WHERE d.statut = 'approuvee'), 0) AS decaisse,
            coalesce(sum(c.reverse), 0) AS reverse,
            coalesce(sum(c.depenses_validees), 0) AS depenses_validees,
            coalesce(sum(c.depenses - c.depenses_validees), 0) AS depenses_attente,
            count(d.id) FILTER (WHERE d.statut IN ('soumise', 'validee_chef'))::int AS demandes_en_cours,
            (SELECT coalesce(sum(j.sortie), 0) FROM journal j WHERE j.tenant_id = :t AND j.activite_id = a.id AND NOT coalesce(j.annule, false)
                AND j.annulation_de_id IS NULL AND coalesce(j.sortie, 0) > 0
                AND NOT EXISTS (SELECT 1 FROM projet_demande_mouvements m WHERE m.journal_id = j.id)) AS hors_demande
       FROM activites a LEFT JOIN users u ON u.id = a.responsable_id
       LEFT JOIN projet_demandes_fonds d ON d.activite_id = a.id
       LEFT JOIN LATERAL projet_demande_chiffres(d.id) c ON d.id IS NOT NULL
      WHERE a.tenant_id = :t AND a.projet_id IN (:ids)
      GROUP BY a.id, a.projet_id, a.nom, u.username ORDER BY a.nom`, { t: req.tenantId, ids });
  const financements = await Q(
    `SELECT i.projet_id, coalesce(sum(j.entree), 0) AS recu FROM journal_imputations_projet i JOIN journal j ON j.id = i.journal_id
      WHERE i.tenant_id = :t AND i.projet_id IN (:ids) AND NOT coalesce(j.annule, false) GROUP BY i.projet_id`, { t: req.tenantId, ids });
  const depenses = await Q(
    `SELECT x.date_depense::text AS date, d.numero, d.projet_id, a.nom AS activite, x.designation, x.beneficiaire, x.montant, x.statut
       FROM projet_depenses x JOIN projet_demandes_fonds d ON d.id = x.demande_id JOIN activites a ON a.id = d.activite_id
      WHERE x.tenant_id = :t AND d.projet_id IN (:ids) AND x.statut <> 'rejetee' ORDER BY x.date_depense, x.id`, { t: req.tenantId, ids });
  const users = new Map((await Q('SELECT id, username FROM users WHERE tenant_id = :t', { t: req.tenantId })).map((u) => [u.id, u.username]));
  const res = projets.map((pr) => {
    const acts = lignes.filter((l) => Number(l.projet_id) === Number(pr.id)).map((l) => {
      const o = { id: l.id, nom: l.nom, responsable: l.responsable, approuve: n(l.approuve), decaisse: n(l.decaisse), reverse: n(l.reverse),
        depenses_validees: n(l.depenses_validees), depenses_attente: n(l.depenses_attente), hors_demande: n(l.hors_demande), demandes_en_cours: l.demandes_en_cours };
      o.reste_a_decaisser = Math.max(o.approuve - o.decaisse, 0);
      o.reste_a_justifier = Math.max(o.decaisse - o.depenses_validees - o.depenses_attente - o.reverse, 0);
      return o;
    });
    const somme = (k) => acts.reduce((s, a) => s + a[k], 0);
    const totaux = Object.fromEntries(['approuve', 'decaisse', 'reverse', 'depenses_validees', 'depenses_attente', 'hors_demande', 'reste_a_decaisser', 'reste_a_justifier']
      .map((k) => [k, somme(k)]));
    const recu = n(financements.find((f) => Number(f.projet_id) === Number(pr.id))?.recu);
    return {
      id: pr.id, nom: pr.nom, code: pr.code, date_debut: pr.date_debut, date_fin: pr.date_fin, chef: users.get(pr.chef_projet_id) || null,
      financements_recus: recu, solde_fonds: recu - totaux.decaisse - totaux.hors_demande + totaux.reverse,
      activites: acts, totaux, provisoire: totaux.depenses_attente > 0,
      depenses: depenses.filter((x) => Number(x.projet_id) === Number(pr.id)).map((x) => ({ ...x, montant: n(x.montant), projet_id: undefined })),
    };
  });
  return { projets: res, genere_le: new Date().toISOString() };
};

const rapportPdf = async (req) => {
  const r = await rapport(req);
  const { dateFr, COULEURS } = require('./commercial/bc_pdf.service');
  const mp = require('./commercial/ventes_pdf.service');
  const s = await require('./entreprise.service').identitePour(req.tenantId, null);
  const titre = 'Rapport financier';
  const numero = r.projets.length === 1 ? r.projets[0].nom : 'Tous les projets';
  const { doc, fin } = mp.nouveauDoc(`${titre} — ${numero}`, s);
  let y = mp.entete(doc, s, titre, numero, [`Établi le ${dateFr(r.genere_le.slice(0, 10))}`, 'Montants en FCFA']);
  const m = (v) => Math.round(v).toLocaleString('fr-FR').replace(/ | /g, ' ');
  for (const pr of r.projets) {
    if (y > 640) { doc.addPage(); y = 50; }
    doc.font('Helvetica-Bold').fontSize(11.5).fillColor(COULEURS.BLEU).text(pr.nom, 40, y);
    doc.font('Helvetica').fontSize(8.5).fillColor('#334155').text([
      pr.chef ? `Chef de projet : ${pr.chef}` : '', pr.date_debut ? `Du ${dateFr(pr.date_debut)}${pr.date_fin ? ` au ${dateFr(pr.date_fin)}` : ''}` : '',
      `Financements reçus : ${m(pr.financements_recus)}`].filter(Boolean).join(' · '), 40, doc.y + 2);
    y = doc.y + 8;
    if (pr.provisoire) {
      doc.font('Helvetica-Oblique').fontSize(8.3).fillColor('#b45309')
        .text(`Provisoire : ${m(pr.totaux.depenses_attente)} FCFA de dépenses déclarées attendent le contrôle du comptable.`, 40, y);
      y = doc.y + 6;
    }
    const cols = [['Activité', 135, 'left'], ['Approuvé', 62, 'right'], ['Décaissé', 62, 'right'], ['Dépenses validées', 66, 'right'],
      ['À contrôler', 56, 'right'], ['Reversé', 56, 'right'], ['Reste à justifier', 78, 'right']];
    const rangees = pr.activites.map((a) => [`${a.nom}${a.responsable ? ` (${a.responsable})` : ''}`, m(a.approuve), m(a.decaisse),
      m(a.depenses_validees), m(a.depenses_attente), m(a.reverse), m(a.reste_a_justifier)]);
    rangees.push(['TOTAL', m(pr.totaux.approuve), m(pr.totaux.decaisse), m(pr.totaux.depenses_validees), m(pr.totaux.depenses_attente),
      m(pr.totaux.reverse), m(pr.totaux.reste_a_justifier)]);
    y = mp.tableau(doc, y, cols, rangees) + 8;
    if (pr.totaux.hors_demande > 0) {
      doc.font('Helvetica').fontSize(8).fillColor('#475569')
        .text(`Remises de fonds antérieures à la procédure des demandes : ${m(pr.totaux.hors_demande)} FCFA.`, 40, y);
      y = doc.y + 6;
    }
    if (pr.depenses.length) {
      if (y > 660) { doc.addPage(); y = 50; }
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#0f172a').text('Détail des dépenses', 40, y);
      y = doc.y + 4;
      y = mp.tableau(doc, y, [['Date', 55, 'left'], ['Désignation', 175, 'left'], ['Activité', 95, 'left'], ['Demande', 70, 'left'],
        ['Montant', 60, 'right'], ['Statut', 60, 'left']],
      pr.depenses.map((x) => [dateFr(x.date), `${x.designation}${x.beneficiaire ? ` — ${x.beneficiaire}` : ''}`, x.activite, x.numero, m(x.montant),
        x.statut === 'validee' ? 'Validée' : 'À contrôler'])) + 14;
    } else y += 8;
  }
  mp.finaliser(doc, s, numero, r.projets.some((x) => x.provisoire) ? 'PROVISOIRE' : '');   // termine le document
  return { contenu: await fin, nom: `rapport-financier-${new Date().toISOString().slice(0, 10)}.pdf` };
};

/** Compteurs du menu (sans erreur pour une PME : appelé par /projets/acces). */
const compteurs = async (req, d) => {
  const ctx = { tenantId: req.tenantId, userId: req.user.id, role: req.user.role };
  const [comptable, caisse] = await Promise.all([userHasPermission(ctx, 'justificatifs.valider'), userHasPermission(ctx, 'journal.create')]);
  const directeur = req.user.role === 'directeur';
  const [c] = await Q(
    `SELECT count(*) FILTER (WHERE (statut = 'soumise' AND projet_id IN (:chef)) OR (statut = 'validee_chef' AND :directeur))::int AS a_valider,
            count(*) FILTER (WHERE statut = 'approuvee' AND :caisse AND EXISTS (SELECT 1 FROM projet_ordres_decaissement o
                              WHERE o.demande_id = d.id AND o.statut = 'en_attente' AND o.initie_par IS DISTINCT FROM :u))::int AS a_decaisser
       FROM projet_demandes_fonds d WHERE tenant_id = :t`,
    { t: req.tenantId, chef: d.chef.length ? d.chef : [0], directeur, caisse, u: req.user.id });
  const [x] = comptable ? await Q(`SELECT count(*)::int AS nb FROM projet_depenses WHERE tenant_id = :t AND statut = 'declaree' AND declare_par <> :u`,
    { t: req.tenantId, u: req.user.id }) : [{ nb: 0 }];
  return { demandes_a_valider: c.a_valider, demandes_a_decaisser: c.a_decaisser, depenses_a_controler: x.nb, comptable, caisse, directeur };
};

module.exports = {
  compteurs, traduire, contexte, lister, lire, creer, modifier, supprimer, soumettre, valider,
  renvoyer: decider('renvoyer'), rejeter: decider('rejeter'), annuler: decider('annuler'),
  decaisser: mouvement('decaissement'), reverser: mouvement('reversement'), solliciter, annoncerDecisionDemandeFonds,
  lienCaisse, relierMouvement,
  initier, refuserOrdre: clore('refuse'), annulerOrdre: clore('annule'), listerOrdres, bonDeSortiePdf,
  declarer, retirerDepense, controler, listerDepenses, fichierDepense, rapport, rapportPdf,
};
