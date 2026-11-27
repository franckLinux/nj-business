'use strict';
// NJ FINANCE — Missions (migration 087, 27/11/2026). PME et ONG.
//
// Décisions de Franck :
//  · l'ordre de mission est APPROUVÉ PAR LE DIRECTEUR (contrôlé en base) ;
//  · frais prévus en saisie libre (quantité × jours × prix unitaire) ;
//  · l'avance est FACULTATIVE ; versée, elle passe au compte 42x « avance au
//    personnel » (et non en charge) ;
//  · un mail à chaque étape.
//
// Circuit : brouillon → soumise → approuvee → (avance) → a_controler (dépenses
// réelles avec pièces + rapport) → justifiee (contrôle par le directeur ou le
// comptable, jamais par celui qui a présenté la justification) → régularisation
// (reliquat reversé en caisse ou complément payé au missionnaire) → cloturee :
// écriture D charges (618x par défaut, compte par dépense possible) / C 42x, qui
// solde l'avance. Les mouvements de caisse de la mission passent au 42x dans
// les écritures de caisse (generation_caisse.service).
const fs = require('fs');
const { sequelize } = require('../../models');
const { userHasPermission } = require('../permission.service');
const { ErreurProjet, estOng } = require('../projets.service');
const pv = require('../pv_storage.service');
const journalSvc = require('../journal.service');
const notifs = require('../projets_notifications.service');
const achats = require('./achats.service');
const { premierDetail } = require('./config.service');

const T = sequelize.QueryTypes;
const Q = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: T.SELECT, transaction });
const X = (sql, replacements, transaction) => sequelize.query(sql, { replacements, transaction });
const err = (status, message, code) => new ErreurProjet(status, message, code);
const n = (v) => (v === null || v === undefined ? 0 : Number(v) || 0);
const r2 = (v) => Math.round(n(v) * 100) / 100;
const fmt = (v) => Math.round(n(v)).toLocaleString('fr-FR').replace(/[  ]/g, ' ');
const MOIS = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const iso = (d) => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10) : null);

const NATURES = { transport: 'Transport', hebergement: 'Hébergement', restauration: 'Restauration', perdiem: 'Per diem', autre: 'Autres frais' };
const STATUTS = {
  brouillon: 'Brouillon', soumise: 'À approuver', approuvee: 'Approuvée', a_controler: 'Justification à contrôler',
  justifiee: 'À régulariser', cloturee: 'Clôturée', rejetee: 'Rejetée', annulee: 'Annulée',
};

const traduire = (e) => {
  if (e instanceof ErreurProjet) return e;
  if (e instanceof achats.ErreurAchat) return err(e.status || 400, e.message, 'COMPTABILITE');
  const msg = e?.original?.message || e?.parent?.message || '';
  const m = /^([A-Z_]+): (.*)$/s.exec(msg);
  if ((e?.original?.code || e?.parent?.code) === '23514') {
    if (m) return err(409, m[2], m[1]);
    if (/controle_par/.test(msg)) return err(403, 'Vous ne contrôlez pas une justification que vous avez présentée.', 'AUTOCONTROLE');
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
const nombre = (v, quoi, { min = 0, strict = false } = {}) => {
  const x = Number(String(v ?? '').replace(/[\s  ]/g, '').replace(',', '.'));
  if (String(v ?? '').trim() === '' || !Number.isFinite(x) || x < min || (strict && x <= min)) throw err(400, `${quoi} invalide.`, 'SAISIE');
  return Math.round(x * 100) / 100;
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
  const ctx = { tenantId: req.tenantId, userId: req.user.id, role: req.user.role };
  const [voir, demander, comptable, caisse] = await Promise.all([
    userHasPermission(ctx, 'finance.missions.voir'), userHasPermission(ctx, 'finance.missions.demander'),
    userHasPermission(ctx, 'justificatifs.valider'), userHasPermission(ctx, 'journal.create'),
  ]);
  if (!voir && !demander) throw err(403, 'Permission requise : voir les missions.', 'MISSIONS_INTERDIT');
  const directeur = req.user.role === 'directeur';
  return {
    userId: req.user.id, role: req.user.role, directeur, comptable, caisse, demander,
    voitTout: directeur || comptable || caisse || ['auditeur', 'comptable_cabinet'].includes(req.user.role),
  };
};
const estConcerne = (p, m) => m.cree_par === p.userId || m.missionnaire_id === p.userId;
const peutVoir = (p, m) => p.voitTout || estConcerne(p, m);
const peutControler = (p, m) => (p.directeur || p.comptable) && m.justif_soumise_par !== p.userId;

// ── Paramètres : compte d'avance (42x) et compte de charge par défaut (618x) ─
const parametres = async (tenantId, transaction) => {
  const [r] = await Q('SELECT compte_avance, compte_charge FROM fin_missions_parametres WHERE tenant_id = :t', { t: tenantId }, transaction);
  const choisir = async (fixe, racines) => {
    if (fixe) return fixe;
    for (const x of racines) { const c = await premierDetail(tenantId, x, transaction); if (c) return c; }
    return '';
  };
  return {
    compte_avance: await choisir(r?.compte_avance, ['4211', '421', '42']),
    compte_charge: await choisir(r?.compte_charge, ['6181', '618', '61']),
    personnalises: Boolean(r),
  };
};
const verifierCompte = async (tenantId, compte, racine, quoi, transaction) => {
  if (!compte) return '';
  if (!compte.startsWith(racine)) throw err(400, `${quoi} : un compte ${racine}… est attendu.`, 'COMPTE');
  const [{ a }] = await Q('SELECT fin_compte_anomalie(:t, :c) AS a', { t: tenantId, c: compte }, transaction);
  if (a) throw err(400, `${quoi} : ${a}.`, 'COMPTE');
  return compte;
};
const enregistrerParametres = async (req) => {
  if (req.user.role !== 'directeur' && !(await userHasPermission({ tenantId: req.tenantId, userId: req.user.id, role: req.user.role }, 'finance.config.facturation'))) {
    throw err(403, 'Le paramétrage des missions revient au directeur ou au comptable.', 'PARAMETRAGE_INTERDIT');
  }
  const b = req.body || {};
  const avance = await verifierCompte(req.tenantId, texte(b.compte_avance, 20, 'Compte d\'avance'), '4', 'Compte d\'avance');
  const charge = await verifierCompte(req.tenantId, texte(b.compte_charge, 20, 'Compte de charge'), '6', 'Compte de charge');
  await X(`INSERT INTO fin_missions_parametres (tenant_id, compte_avance, compte_charge, modifie_par, modifie_le)
           VALUES (:t, :a, :c, :u, NOW())
           ON CONFLICT (tenant_id) DO UPDATE SET compte_avance = :a, compte_charge = :c, modifie_par = :u, modifie_le = NOW()`,
  { t: req.tenantId, a: avance, c: charge, u: req.user.id });
  return parametres(req.tenantId);
};

// ── Lecture ─────────────────────────────────────────────────────────────────
const SELECT_MISSION = `
  SELECT m.id::text AS id, m.numero, m.missionnaire_id, m.missionnaire_nom, m.fonction, m.objet, m.destination,
         m.date_depart::text AS date_depart, m.date_retour::text AS date_retour, m.transport, m.activite_id, m.statut,
         m.cree_par, m.cree_le, m.soumise_le, m.approuve_par, m.approuve_le, m.compte_avance, m.motif, m.rapport,
         m.justif_soumise_par, m.justif_soumise_le, m.controle_par, m.controle_le, m.cloture_le,
         a.nom AS activite, pr.nom AS projet, uc.username AS cree_par_nom, ua.username AS approuve_par_nom,
         uk.username AS controle_par_nom, c.prevu, c.verse, c.reverse, c.depenses,
         (SELECT e.id::text FROM fin_ecritures e WHERE e.tenant_id = m.tenant_id AND e.origine_type = 'fin_mission'
            AND e.origine_id = m.id AND e.extournee_par_id IS NULL LIMIT 1) AS ecriture_id
    FROM fin_missions m
    LEFT JOIN activites a ON a.id = m.activite_id LEFT JOIN activites pr ON pr.id = a.projet_id
    LEFT JOIN users uc ON uc.id = m.cree_par LEFT JOIN users ua ON ua.id = m.approuve_par LEFT JOIN users uk ON uk.id = m.controle_par
    CROSS JOIN LATERAL fin_mission_chiffres(m.id) c`;

const jours = (m) => Math.round((Date.parse(`${m.date_retour}T00:00:00Z`) - Date.parse(`${m.date_depart}T00:00:00Z`)) / 864e5) + 1;
const former = (m) => {
  const net = r2(n(m.verse) - n(m.reverse));
  const solde = r2(net - n(m.depenses));   // > 0 : reliquat à reverser ; < 0 : complément dû au missionnaire
  return {
    ...m, prevu: n(m.prevu), verse: n(m.verse), reverse: n(m.reverse), depenses: n(m.depenses), avance_nette: net,
    jours: jours(m), statut_libelle: STATUTS[m.statut] || m.statut,
    reste_avance: m.statut === 'approuvee' || m.statut === 'a_controler' ? Math.max(r2(n(m.prevu) - n(m.verse)), 0) : 0,
    reliquat: m.statut === 'justifiee' ? Math.max(solde, 0) : 0,
    complement: m.statut === 'justifiee' ? Math.max(-solde, 0) : 0,
  };
};

const charger = async (tenantId, id, transaction, verrou = false) => {
  const [m] = await Q(`SELECT * FROM fin_missions WHERE id = :id AND tenant_id = :t${verrou ? ' FOR UPDATE' : ''}`,
    { id: idNum(id, 'Mission'), t: tenantId }, transaction);
  if (!m) throw err(404, 'Mission introuvable.', 'MISSION_INTROUVABLE');
  return m;
};
const chargerVisible = async (req, p, id) => {
  const [m] = await Q(`${SELECT_MISSION} WHERE m.id = :id AND m.tenant_id = :t`, { id: idNum(id, 'Mission'), t: req.tenantId });
  if (!m || !peutVoir(p, m)) throw err(404, 'Mission introuvable.', 'MISSION_INTROUVABLE');
  return m;
};

const contexte = async (req) => {
  const p = await profil(req);
  const ong = await estOng(req.tenantId);
  const [utilisateurs, activites, journaux, rubriques, param] = await Promise.all([
    Q(`SELECT id, username, role FROM users WHERE tenant_id = :t AND actif ORDER BY username`, { t: req.tenantId }),
    ong ? Q(`SELECT a.id, a.nom, pr.nom AS projet FROM activites a LEFT JOIN activites pr ON pr.id = a.projet_id
              WHERE a.tenant_id = :t AND a.type = 'activite' ORDER BY pr.nom, a.nom`, { t: req.tenantId }) : [],
    p.caisse ? Q(`SELECT id::text AS id, code, nom, type FROM journaux WHERE tenant_id = :t AND actif ORDER BY code`, { t: req.tenantId }) : [],
    p.caisse ? Q(`SELECT code, intitule, type FROM rubriques WHERE tenant_id = :t AND actif IS NOT FALSE ORDER BY code`, { t: req.tenantId }) : [],
    parametres(req.tenantId),
  ]);
  const jour = aujourdhui();
  for (const j of journaux) {
    const s = await journalSvc.soldeJournal(req.tenantId, MOIS[Number(jour.slice(5, 7)) - 1], Number(jour.slice(0, 4)), j.id);
    j.solde = r2(s.solde);
  }
  return {
    ong, natures: NATURES, utilisateurs, activites, journaux, rubriques, parametres: param,
    droits: { demander: p.demander, directeur: p.directeur, comptable: p.comptable, caisse: p.caisse, voit_tout: p.voitTout },
  };
};

const VUES = {
  a_approuver: (m) => m.statut === 'soumise',
  en_cours: (m) => ['approuvee', 'a_controler', 'justifiee'].includes(m.statut),
  a_controler: (m) => m.statut === 'a_controler',
  a_regulariser: (m) => m.statut === 'justifiee',
  avance_a_verser: (m) => m.statut === 'approuvee' && m.verse === 0 && m.prevu > 0,
  cloturees: (m) => m.statut === 'cloturee',
};
const lister = async (req) => {
  const p = await profil(req);
  const lignes = (await Q(`${SELECT_MISSION} WHERE m.tenant_id = :t ORDER BY m.id DESC LIMIT 1000`, { t: req.tenantId }))
    .filter((m) => peutVoir(p, m)).map(former);
  const vue = VUES[req.query.vue] ? req.query.vue : null;
  const q = String(req.query.q || '').trim().toLowerCase();
  const filtrees = lignes.filter((m) => (!vue || VUES[vue](m))
    && (!q || [m.numero, m.missionnaire_nom, m.objet, m.destination].some((x) => String(x || '').toLowerCase().includes(q))));
  const compteurs = Object.fromEntries(Object.entries(VUES).map(([k, f]) => [k, lignes.filter(f).length]));
  return { missions: filtrees.map(({ rapport, ...m }) => m), compteurs, total: lignes.length };
};

const lire = async (req, id) => {
  const p = await profil(req);
  const m = await chargerVisible(req, p, id);
  const [frais, depenses, mouvements] = await Promise.all([
    Q('SELECT id::text AS id, nature, designation, quantite, jours, prix_unitaire, montant FROM fin_mission_frais WHERE mission_id = :id ORDER BY ordre, id', { id: m.id }),
    Q(`SELECT x.id::text AS id, x.nature, x.date_depense::text AS date_depense, x.designation, x.montant, x.compte, x.fichier_nom,
              (x.fichier_chemin IS NOT NULL) AS a_piece, x.declare_par, u.username AS declare_par_nom
         FROM fin_mission_depenses x LEFT JOIN users u ON u.id = x.declare_par WHERE x.mission_id = :id ORDER BY x.date_depense, x.id`, { id: m.id }),
    Q(`SELECT mm.sens, j.id::text AS journal_id, j.numero, j.date::text AS date, coalesce(j.entree, 0) AS entree, coalesce(j.sortie, 0) AS sortie,
              coalesce(j.annule, false) AS annule, jo.code AS caisse_code, jo.nom AS caisse, u.username AS par
         FROM fin_mission_mouvements mm JOIN journal j ON j.id = mm.journal_id LEFT JOIN journaux jo ON jo.id = j.journal_id
         LEFT JOIN users u ON u.id = mm.cree_par WHERE mm.mission_id = :id ORDER BY j.date, j.id`, { id: m.id }),
  ]);
  const f = former(m);
  const proprio = m.cree_par === p.userId;
  const concerne = estConcerne(p, m);
  const aucunMouvement = !mouvements.some((x) => !x.annule);
  return {
    mission: f,
    frais: frais.map((x) => ({ ...x, quantite: n(x.quantite), jours: x.jours === null ? null : n(x.jours), prix_unitaire: n(x.prix_unitaire), montant: n(x.montant) })),
    depenses: depenses.map((x) => ({ ...x, montant: n(x.montant), de_moi: x.declare_par === p.userId, declare_par: undefined })),
    mouvements: mouvements.map((x) => ({ ...x, entree: n(x.entree), sortie: n(x.sortie) })),
    actions: {
      modifier: m.statut === 'brouillon' && proprio,
      soumettre: m.statut === 'brouillon' && proprio,
      supprimer: m.statut === 'brouillon' && proprio,
      decider: m.statut === 'soumise' && p.directeur,
      verser_avance: p.caisse && m.statut === 'approuvee' && f.reste_avance > 0,
      declarer: ['approuvee'].includes(m.statut) && concerne,
      soumettre_justification: m.statut === 'approuvee' && concerne,
      controler: m.statut === 'a_controler' && peutControler(p, m),
      payer_complement: p.caisse && f.complement > 0,
      reverser_reliquat: p.caisse && f.reliquat > 0,
      cloturer: m.statut === 'justifiee' && f.reliquat === 0 && f.complement === 0 && (p.directeur || p.comptable),
      annuler: ['soumise', 'approuvee'].includes(m.statut) && aucunMouvement && depenses.length === 0 && (p.directeur || proprio),
    },
  };
};

// ── Saisie (brouillon) ──────────────────────────────────────────────────────
const lireSaisie = async (req, b, transaction) => {
  const depart = dateIso(b.date_depart, 'Date de départ', { obligatoire: true });
  const retour = dateIso(b.date_retour, 'Date de retour', { obligatoire: true });
  if (retour < depart) throw err(400, 'La date de retour précède la date de départ.', 'SAISIE');
  let missionnaireId = null;
  let nom = texte(b.missionnaire_nom, 150, 'Missionnaire');
  if (b.missionnaire_id) {
    if (!/^[0-9a-f-]{36}$/i.test(String(b.missionnaire_id))) throw err(400, 'Missionnaire introuvable.', 'SAISIE');
    const [u] = await Q('SELECT id, username FROM users WHERE id = :u AND tenant_id = :t', { u: String(b.missionnaire_id), t: req.tenantId }, transaction);
    if (!u) throw err(400, 'Missionnaire introuvable.', 'SAISIE');
    missionnaireId = u.id;
    nom = nom || u.username;
  }
  if (!nom) throw err(400, 'Missionnaire : obligatoire.', 'SAISIE');
  let activiteId = null;
  if (b.activite_id) {
    activiteId = idNum(b.activite_id, 'Activité');
    const [a] = await Q(`SELECT id FROM activites WHERE id = :a AND tenant_id = :t AND type = 'activite'`, { a: activiteId, t: req.tenantId }, transaction);
    if (!a) throw err(400, 'Activité introuvable.', 'SAISIE');
  }
  const frais = (Array.isArray(b.frais) ? b.frais : []).map((l, i) => {
    const nature = NATURES[l.nature] ? l.nature : null;
    if (!nature) throw err(400, `Ligne ${i + 1} : nature de frais inconnue.`, 'SAISIE');
    const quantite = nombre(l.quantite ?? 1, `Ligne ${i + 1} : quantité`, { strict: true });
    const j = l.jours === undefined || l.jours === null || l.jours === '' ? null : nombre(l.jours, `Ligne ${i + 1} : jours`, { strict: true });
    const pu = nombre(l.prix_unitaire, `Ligne ${i + 1} : prix unitaire`);
    return { nature, designation: texte(l.designation, 300, `Ligne ${i + 1} : désignation`) || NATURES[nature], quantite, jours: j, prix_unitaire: pu,
      montant: r2(quantite * (j || 1) * pu) };
  });
  return {
    missionnaire_id: missionnaireId, missionnaire_nom: nom, fonction: texte(b.fonction, 150, 'Fonction'),
    objet: texte(b.objet, 500, 'Objet de la mission', { obligatoire: true }), destination: texte(b.destination, 200, 'Destination', { obligatoire: true }),
    date_depart: depart, date_retour: retour, transport: texte(b.transport, 150, 'Moyen de transport'), activite_id: activiteId, frais,
  };
};
const ecrireFrais = async (missionId, frais, t) => {
  await X('DELETE FROM fin_mission_frais WHERE mission_id = :m', { m: missionId }, t);
  let ordre = 0;
  for (const l of frais) {
    ordre += 1;
    await X(`INSERT INTO fin_mission_frais (mission_id, ordre, nature, designation, quantite, jours, prix_unitaire, montant)
             VALUES (:m, :o, :nature, :designation, :quantite, :jours, :prix_unitaire, :montant)`, { m: missionId, o: ordre, ...l }, t);
  }
};

const creer = async (req) => {
  const p = await profil(req);
  if (!p.demander) throw err(403, 'Permission requise : demander une mission.', 'MISSIONS_INTERDIT');
  const r = await enTransaction(async (t) => {
    const s = await lireSaisie(req, req.body || {}, t);
    const [[m]] = await X(`INSERT INTO fin_missions (tenant_id, missionnaire_id, missionnaire_nom, fonction, objet, destination, date_depart,
                                                    date_retour, transport, activite_id, cree_par)
                           VALUES (:t, :missionnaire_id, :missionnaire_nom, :fonction, :objet, :destination, :date_depart, :date_retour,
                                   :transport, :activite_id, :u) RETURNING id`, { t: req.tenantId, u: req.user.id, ...s }, t);
    await ecrireFrais(m.id, s.frais, t);
    return String(m.id);
  });
  if (req.body?.soumettre) return soumettre(req, r);
  return lire(req, r);
};

const modifier = async (req, id) => {
  const p = await profil(req);
  await enTransaction(async (t) => {
    const m = await charger(req.tenantId, id, t, true);
    if (m.cree_par !== p.userId) throw err(403, 'Seul l\'auteur modifie son ordre de mission.', 'AUTEUR_SEUL');
    if (m.statut !== 'brouillon') throw err(409, 'Un ordre de mission envoyé ne se modifie plus (demandez son renvoi au directeur).', 'MISSION_INTANGIBLE');
    const s = await lireSaisie(req, req.body || {}, t);
    await X(`UPDATE fin_missions SET missionnaire_id = :missionnaire_id, missionnaire_nom = :missionnaire_nom, fonction = :fonction, objet = :objet,
                    destination = :destination, date_depart = :date_depart, date_retour = :date_retour, transport = :transport,
                    activite_id = :activite_id WHERE id = :id`, { id: m.id, ...s }, t);
    await ecrireFrais(m.id, s.frais, t);
  });
  if (req.body?.soumettre) return soumettre(req, id);
  return lire(req, id);
};

const supprimer = async (req, id) => {
  const p = await profil(req);
  return enTransaction(async (t) => {
    const m = await charger(req.tenantId, id, t, true);
    if (m.cree_par !== p.userId || m.statut !== 'brouillon') throw err(409, 'Seul un brouillon se supprime, par son auteur.', 'MISSION_INTANGIBLE');
    await X('DELETE FROM fin_missions WHERE id = :id', { id: m.id }, t);
    return { supprimee: true };
  });
};

const soumettre = async (req, id) => {
  const p = await profil(req);
  const r = await enTransaction(async (t) => {
    const m = await charger(req.tenantId, id, t, true);
    if (m.cree_par !== p.userId) throw err(403, 'Seul l\'auteur envoie son ordre de mission.', 'AUTEUR_SEUL');
    if (m.statut !== 'brouillon') throw err(409, 'Cet ordre de mission est déjà envoyé.', 'MISSION_INTANGIBLE');
    let numero = m.numero;
    if (!numero) {
      const annee = String(m.date_depart instanceof Date ? m.date_depart.toISOString() : m.date_depart).slice(0, 4);
      await X('SELECT pg_advisory_xact_lock(hashtext(:k))', { k: `fin_missions_numero:${req.tenantId}:${annee}` }, t);
      const [{ dernier }] = await Q(`SELECT coalesce(max(substring(numero FROM '(\\d+)$')::int), 0) AS dernier FROM fin_missions
                                      WHERE tenant_id = :t AND numero LIKE :pref`, { t: req.tenantId, pref: `OM-${annee}-%` }, t);
      numero = `OM-${annee}-${String(Number(dernier) + 1).padStart(5, '0')}`;
    }
    await X(`UPDATE fin_missions SET statut = 'soumise', numero = :numero, soumise_le = NOW(), motif = '' WHERE id = :id`, { numero, id: m.id }, t);
    return m.id;
  });
  annoncer(req, r, 'soumise');
  return lire(req, r);
};

/** Le directeur approuve, renvoie au brouillon (motif) ou rejette (motif). */
const decider = async (req, id) => {
  const p = await profil(req);
  if (!p.directeur) throw err(403, 'Seul le directeur approuve un ordre de mission.', 'DIRECTEUR_SEUL');
  const decision = String(req.body?.decision || '');
  if (!['approuver', 'renvoyer', 'rejeter'].includes(decision)) throw err(400, 'Décision : approuver, renvoyer ou rejeter.', 'SAISIE');
  const motif = texte(req.body?.motif, 500, 'Motif', { obligatoire: decision !== 'approuver' });
  const param = decision === 'approuver' ? await parametres(req.tenantId) : null;
  if (param && !param.compte_avance) {
    throw err(400, 'Aucun compte d\'avance au personnel (42x) dans le plan comptable : renseignez-le dans les paramètres des missions.', 'COMPTE');
  }
  const r = await enTransaction(async (t) => {
    const m = await charger(req.tenantId, id, t, true);
    if (m.statut !== 'soumise') throw err(409, 'Cet ordre de mission n\'attend pas de décision.', 'MISSION_INTANGIBLE');
    if (decision === 'approuver') {
      await X(`UPDATE fin_missions SET statut = 'approuvee', approuve_par = :u, approuve_le = NOW(), compte_avance = :c, motif = '' WHERE id = :id`,
        { u: req.user.id, c: param.compte_avance, id: m.id }, t);
    } else {
      await X(`UPDATE fin_missions SET statut = :s, motif = :motif WHERE id = :id`,
        { s: decision === 'renvoyer' ? 'brouillon' : 'rejetee', motif, id: m.id }, t);
    }
    return m.id;
  });
  annoncer(req, r, decision === 'approuver' ? 'approuvee' : decision, { motif });
  return lire(req, r);
};

const annuler = async (req, id) => {
  const p = await profil(req);
  const motif = texte(req.body?.motif, 500, 'Motif', { obligatoire: true });
  const r = await enTransaction(async (t) => {
    const m = await charger(req.tenantId, id, t, true);
    if (!(p.directeur || m.cree_par === p.userId)) throw err(403, 'Seuls l\'auteur et le directeur annulent un ordre de mission.', 'ANNULATION_INTERDITE');
    if (!['soumise', 'approuvee'].includes(m.statut)) throw err(409, 'Seul un ordre envoyé ou approuvé, sans mouvement, s\'annule.', 'MISSION_INTANGIBLE');
    const [c] = await Q('SELECT * FROM fin_mission_chiffres(:id)', { id: m.id }, t);
    if (n(c.verse) > 0 || n(c.depenses) > 0) throw err(409, 'Une avance est versée ou des dépenses sont déclarées : la mission ne s\'annule plus.', 'MISSION_ENGAGEE');
    await X(`UPDATE fin_missions SET statut = 'annulee', motif = :motif WHERE id = :id`, { motif, id: m.id }, t);
    return m.id;
  });
  annoncer(req, r, 'annulee', { motif });
  return lire(req, r);
};

// ── Dépenses réelles et rapport ─────────────────────────────────────────────
const exigerJustifiable = async (req, p, id, t) => {
  const m = await charger(req.tenantId, id, t, true);
  if (!estConcerne(p, m)) throw err(403, 'Seuls le missionnaire et l\'auteur de l\'ordre présentent la justification.', 'JUSTIFICATION_INTERDITE');
  if (m.statut !== 'approuvee') throw err(409, 'La justification se prépare sur une mission approuvée, avant son envoi au contrôle.', 'MISSION_INTANGIBLE');
  return m;
};

const declarer = async (req, id) => {
  const p = await profil(req);
  const b = req.body || {};
  let fichier = null;
  if (b.data_base64) {
    try { fichier = pv.preparer({ nom_fichier: b.nom_fichier, data_base64: b.data_base64 }); } catch (e) {
      throw err(e.status || 400, e.message.replace(/PV/g, 'justificatif'), 'FICHIER');
    }
  }
  if (!fichier) throw err(400, 'Joignez la pièce justificative (PDF ou photo).', 'FICHIER');
  const nature = NATURES[b.nature] ? b.nature : null;
  if (!nature) throw err(400, 'Nature de la dépense inconnue.', 'SAISIE');
  const compte = await verifierCompte(req.tenantId, texte(b.compte, 20, 'Compte'), '6', 'Compte de charge');
  return enTransaction(async (t) => {
    const m = await exigerJustifiable(req, p, id, t);
    const [[x]] = await X(`INSERT INTO fin_mission_depenses (tenant_id, mission_id, nature, date_depense, designation, montant, compte, declare_par)
                           VALUES (:t, :m, :nature, :d, :designation, :montant, :compte, :u) RETURNING id`,
    { t: req.tenantId, m: m.id, nature, d: dateIso(b.date_depense, 'Date de la dépense', { obligatoire: true }),
      designation: texte(b.designation, 300, 'Désignation') || NATURES[nature], montant: nombre(b.montant, 'Montant', { strict: true }),
      compte, u: req.user.id }, t);
    const chemin = await pv.enregistrer(req.tenantId, 'missions', x.id, fichier);
    await X('UPDATE fin_mission_depenses SET fichier_chemin = :c, fichier_nom = :nom, mime = :mime, sha256 = :sha WHERE id = :id',
      { c: chemin, nom: fichier.nom, mime: fichier.mime, sha: fichier.sha256, id: x.id }, t);
    return { id: String(x.id) };
  });
};

const retirerDepense = async (req, id, depenseId) => {
  const p = await profil(req);
  return enTransaction(async (t) => {
    const m = await exigerJustifiable(req, p, id, t);
    const [, meta] = await X('DELETE FROM fin_mission_depenses WHERE id = :d AND mission_id = :m', { d: idNum(depenseId, 'Dépense'), m: m.id }, t);
    if (meta.rowCount !== 1) throw err(404, 'Dépense introuvable.', 'DEPENSE_INTROUVABLE');
    return { supprimee: true };
  });
};

const enregistrerRapport = async (req, id) => {
  const p = await profil(req);
  const rapport = texte(req.body?.rapport, 8000, 'Rapport de mission');
  await enTransaction(async (t) => {
    const m = await exigerJustifiable(req, p, id, t);
    await X('UPDATE fin_missions SET rapport = :r WHERE id = :id', { r: rapport, id: m.id }, t);
  });
  return lire(req, id);
};

const soumettreJustification = async (req, id) => {
  const p = await profil(req);
  const r = await enTransaction(async (t) => {
    const m = await exigerJustifiable(req, p, id, t);
    if (!String(m.rapport || '').trim()) throw err(400, 'Rédigez le rapport de mission avant d\'envoyer la justification.', 'RAPPORT_REQUIS');
    await X(`UPDATE fin_missions SET statut = 'a_controler', justif_soumise_par = :u, justif_soumise_le = NOW(), motif = '' WHERE id = :id`,
      { u: req.user.id, id: m.id }, t);
    return m.id;
  });
  annoncer(req, r, 'a_controler');
  return lire(req, r);
};

/** Contrôle de la justification : directeur ou comptable, jamais celui qui l'a présentée. */
const controler = async (req, id) => {
  const p = await profil(req);
  if (!(p.directeur || p.comptable)) throw err(403, 'Le contrôle de la justification revient au directeur ou au comptable.', 'CONTROLE_INTERDIT');
  const decision = String(req.body?.decision || '');
  if (!['valider', 'renvoyer'].includes(decision)) throw err(400, 'Décision : valider ou renvoyer.', 'SAISIE');
  const motif = texte(req.body?.motif, 500, 'Motif', { obligatoire: decision === 'renvoyer' });
  const r = await enTransaction(async (t) => {
    const m = await charger(req.tenantId, id, t, true);
    if (m.statut !== 'a_controler') throw err(409, 'Aucune justification n\'attend de contrôle sur cette mission.', 'MISSION_INTANGIBLE');
    if (m.justif_soumise_par === req.user.id) throw err(403, 'Vous ne contrôlez pas une justification que vous avez présentée.', 'AUTOCONTROLE');
    if (decision === 'renvoyer') {
      await X(`UPDATE fin_missions SET statut = 'approuvee', motif = :motif WHERE id = :id`, { motif, id: m.id }, t);
    } else {
      await X(`UPDATE fin_missions SET statut = 'justifiee', controle_par = :u, controle_le = NOW(), motif = '' WHERE id = :id`, { u: req.user.id, id: m.id }, t);
    }
    return m.id;
  });
  let cloture = null;
  if (decision === 'valider') cloture = await cloturerSiSolde(req, r);
  annoncer(req, r, decision === 'valider' ? 'justifiee' : 'justif_renvoyee', { motif });
  return { ...(await lire(req, r)), cloture };
};

// ── Clôture : écriture D charges / C avance au personnel ────────────────────
const cloturerSiSolde = async (req, id) => {
  const [m0] = await Q(`${SELECT_MISSION} WHERE m.id = :id AND m.tenant_id = :t`, { id: Number(id), t: req.tenantId });
  if (!m0 || m0.statut !== 'justifiee') return null;
  const f = former(m0);
  if (f.reliquat > 0 || f.complement > 0) return { cloturee: false, reliquat: f.reliquat, complement: f.complement };
  const jour = aujourdhui();
  try {
    if (f.depenses > 0) await achats.preparerComptabilite(req.tenantId, req.user.id, jour);
    await enTransaction(async (t) => {
      const m = await charger(req.tenantId, id, t, true);
      if (m.statut !== 'justifiee') return;
      const param = await parametres(req.tenantId, t);
      const deps = await Q('SELECT designation, montant, compte FROM fin_mission_depenses WHERE mission_id = :id', { id: m.id }, t);
      if (deps.length) {
        if (!param.compte_charge && deps.some((d) => !d.compte)) {
          throw err(400, 'Aucun compte de charge par défaut (618x) : renseignez-le dans les paramètres des missions.', 'COMPTE');
        }
        const libelle = `Mission ${m.numero} — ${m.missionnaire_nom} (${m.destination})`;
        const lignes = deps.map((d) => ({ compte: d.compte || param.compte_charge, debit: Math.round(n(d.montant) * 100), credit: 0,
          tiers_id: null, activite_id: m.activite_id || null, libelle }));
        lignes.push({ compte: m.compte_avance, debit: 0, credit: lignes.reduce((s, l) => s + l.debit, 0), tiers_id: null, activite_id: null, libelle });
        for (const l of lignes) {
          const [{ a }] = await Q('SELECT fin_compte_anomalie(:t, :c) AS a', { t: req.tenantId, c: l.compte }, t);
          if (a) throw err(400, `Écriture de clôture impossible : ${a}.`, 'COMPTE');
        }
        const od = await achats.journalDe(req.tenantId, 'od', 'OD', 'd\'opérations diverses', t);
        await achats.ecrireEcriture(t, { tenantId: req.tenantId, origineType: 'fin_mission', origineId: m.id, journalId: od.id, dateIso: jour,
          reference: m.numero, libelle, lignes, validePar: m.controle_par || req.user.id, creePar: req.user.id });
      }
      await X(`UPDATE fin_missions SET statut = 'cloturee', cloture_le = NOW() WHERE id = :id`, { id: m.id }, t);
    });
    return { cloturee: true };
  } catch (e) {
    const x = traduire(e);
    if (!(x instanceof ErreurProjet)) throw e;
    // La mission reste « à régulariser » ; la clôture se relance depuis la fiche.
    return { cloturee: false, erreur: x.message };
  }
};

const cloturer = async (req, id) => {
  const p = await profil(req);
  const m = await chargerVisible(req, p, id);
  if (!(p.directeur || p.comptable)) throw err(403, 'La clôture revient au directeur ou au comptable.', 'CLOTURE_INTERDITE');
  if (m.statut !== 'justifiee') throw err(409, 'Seule une mission justifiée et régularisée se clôture.', 'MISSION_INTANGIBLE');
  const r = await cloturerSiSolde(req, m.id);
  if (!r?.cloturee) throw err(409, r?.erreur || 'La mission n\'est pas encore régularisée (reliquat ou complément).', 'NON_REGULARISEE');
  return lire(req, m.id);
};

// ── Mouvements de caisse : avance, complément, reliquat ─────────────────────
const SENS_LIB = { avance: 'Avance', complement: 'Complément', reliquat: 'Reliquat' };
const soldeDisponible = async (tenantId, journalId, jour) => {
  const [j] = await Q('SELECT id, nom, type FROM journaux WHERE id = :j AND tenant_id = :t', { j: journalId, t: tenantId });
  if (!j) throw err(400, 'Caisse ou banque introuvable.', 'JOURNAL');
  const s = await journalSvc.soldeJournal(tenantId, MOIS[Number(jour.slice(5, 7)) - 1], Number(jour.slice(0, 4)), journalId);
  return { nom: j.nom, banque: j.type === 'banque', solde: r2(s.solde) };
};

const mouvement = (sens) => async (req, id, { creerMouvement }) => {
  const p = await profil(req);
  if (!p.caisse) throw err(403, 'Permission requise : saisir en caisse.', 'CAISSE_SEULE');
  const b = req.body || {};
  const m = former(await chargerVisible(req, p, id));
  const plafond = sens === 'avance' ? m.reste_avance : sens === 'complement' ? m.complement : m.reliquat;
  if (sens === 'avance' && m.statut !== 'approuvee') throw err(409, 'L\'avance se verse sur une mission approuvée.', 'MISSION_INTANGIBLE');
  if (plafond <= 0) {
    throw err(409, { avance: 'Aucune avance ne reste à verser.', complement: 'Aucun complément n\'est dû.', reliquat: 'Aucun reliquat à reverser.' }[sens], 'RIEN_A_FAIRE');
  }
  const montant = b.montant === undefined || b.montant === '' ? plafond : nombre(b.montant, 'Montant', { strict: true });
  if (montant > plafond + 0.004) throw err(409, `${SENS_LIB[sens]} : ${fmt(plafond)} FCFA au plus.`, 'PLAFOND');
  // Complément et reliquat soldent la mission : montant exact.
  if (sens !== 'avance' && Math.abs(montant - plafond) > 0.004) throw err(409, `${SENS_LIB[sens]} : ${fmt(plafond)} FCFA exactement.`, 'PLAFOND');
  const jour = dateIso(b.date, 'Date') || aujourdhui();
  const journalId = idNum(b.journal_id, 'Caisse ou banque');
  const rubrique = texte(b.rubrique_code, 40, 'Rubrique', { obligatoire: true });
  const [r] = await Q('SELECT type FROM rubriques WHERE tenant_id = :t AND code = :c', { t: req.tenantId, c: rubrique });
  const sortie = sens !== 'reliquat';
  if (!r || (sortie ? r.type === 'entree' : r.type !== 'entree')) {
    throw err(400, sortie ? 'Choisissez une rubrique de dépense.' : 'Choisissez une rubrique d\'entrée pour le reliquat.', 'RUBRIQUE');
  }
  if (sortie) {
    const etat = await soldeDisponible(req.tenantId, journalId, jour);
    if (!etat.banque && montant > etat.solde + 0.004) {
      throw err(409, `Solde insuffisant dans « ${etat.nom} » : ${fmt(etat.solde)} FCFA disponibles pour ${fmt(montant)} FCFA `
        + `(il manque ${fmt(montant - etat.solde)} FCFA).`, 'SOLDE_INSUFFISANT');
    }
  }
  const res = await creerMouvement({
    date: jour, mois: MOIS[Number(jour.slice(5, 7)) - 1], annee: Number(jour.slice(0, 4)), journal_id: journalId, rubrique_code: rubrique,
    intitule: `${SENS_LIB[sens]} mission ${m.numero} — ${m.destination}`.slice(0, 200), objet: m.objet.slice(0, 200),
    beneficiaire: texte(b.beneficiaire, 150, 'Bénéficiaire') || m.missionnaire_nom,
    ...(m.activite_id ? { activite_id: m.activite_id } : {}),
    mission_id: m.id, mission_sens: sens,
    ...(sortie ? { sortie: montant, entree: 0 } : { entree: montant, sortie: 0 }),
  });
  if (res.status >= 400) throw err(res.status, res.data?.error || 'Saisie refusée.', res.data?.code || 'SAISIE_CAISSE');
  if (res.data?.en_attente) {
    throw err(409, `${res.data.message || 'Sortie hors budget.'} Elle attend l'approbation du directeur dans Caisse Pro → Dépenses en attente ; versez de nouveau une fois le budget ajusté.`, 'EN_ATTENTE');
  }
  const cloture = sens === 'avance' ? null : await cloturerSiSolde(req, m.id);
  annoncer(req, m.id, sens, { montant });
  return { journal_id: String(res.data.id), numero: res.data.numero, montant, cloture };
};

// Liaison au journal (journal.controller, dans la transaction de la saisie).
const lienCaisse = async (tenantId, missionId, { entree, sortie, sens }) => {
  const id = idNum(missionId, 'Mission');
  if (!SENS_LIB[sens]) throw err(400, 'Nature du mouvement de mission inconnue.', 'SAISIE');
  const [m] = await Q('SELECT id, activite_id, statut FROM fin_missions WHERE id = :id AND tenant_id = :t', { id, t: tenantId });
  if (!m) throw err(404, 'Mission introuvable.', 'MISSION_INTROUVABLE');
  const s = n(sortie); const e = n(entree);
  if ((sens === 'reliquat') !== (e > 0 && s === 0)) throw err(400, 'Avance et complément sont des sorties ; le reliquat est une entrée.', 'SAISIE');
  return { missionId: id, sens, activiteId: m.activite_id ? Number(m.activite_id) : null };
};
const relierMouvement = (tenantId, lien, journalId, userId, transaction) => X(
  `INSERT INTO fin_mission_mouvements (tenant_id, mission_id, journal_id, sens, cree_par) VALUES (:t, :m, :j, :s, :u)`,
  { t: tenantId, m: lien.missionId, j: journalId, s: lien.sens, u: userId || null }, transaction);

const fichierDepense = async (req, id, depenseId) => {
  const p = await profil(req);
  const m = await chargerVisible(req, p, id);
  const [x] = await Q('SELECT fichier_chemin, fichier_nom, mime FROM fin_mission_depenses WHERE id = :d AND mission_id = :m',
    { d: idNum(depenseId, 'Dépense'), m: m.id });
  if (!x?.fichier_chemin) throw err(404, 'Aucune pièce pour cette dépense.', 'FICHIER_ABSENT');
  const chemin = pv.cheminComplet(x.fichier_chemin);
  try { await fs.promises.access(chemin, fs.constants.R_OK); } catch (e) {
    throw err(410, `La pièce est introuvable sur le serveur (${e.code}).`, 'FICHIER_ABSENT');
  }
  return { chemin, nom: x.fichier_nom || 'piece', mime: x.mime || 'application/octet-stream' };
};

// ── Ordre de mission (PDF), avec le décompte une fois la justification présentée ─
const ordrePdf = async (req, id) => {
  const { dateFr, montantEnLettres } = require('../commercial/bc_pdf.service');
  const mp = require('../commercial/ventes_pdf.service');
  const data = await lire(req, id);
  const m = data.mission;
  if (!m.numero) throw err(409, 'L\'ordre de mission s\'imprime une fois envoyé (numéroté).', 'NON_NUMEROTE');
  const s = await require('../entreprise.service').identitePour(req.tenantId, null);
  const { doc, fin } = mp.nouveauDoc(`Ordre de mission ${m.numero}`, s);
  const mt = (v) => fmt(v);
  let y = mp.entete(doc, s, 'ORDRE DE MISSION', m.numero, [
    `Établi le ${dateFr(iso(m.soumise_le || m.cree_le))}`, `Statut : ${m.statut_libelle}`, 'Montants en FCFA']);
  y = mp.boites(doc, y, ['Missionnaire', [m.missionnaire_nom, m.fonction || '', m.transport ? `Transport : ${m.transport}` : '']],
    ['Mission', [`Destination : ${m.destination}`, `Du ${dateFr(m.date_depart)} au ${dateFr(m.date_retour)} (${m.jours} jour${m.jours > 1 ? 's' : ''})`,
      m.activite ? `Activité : ${m.projet ? `${m.projet} / ` : ''}${m.activite}` : '']]);
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text('Objet de la mission', 40, y + 4);
  doc.font('Helvetica').fontSize(9).fillColor('#334155').text(m.objet, 40, doc.y + 2, { width: 515 });
  y = doc.y + 10;
  y = mp.tableau(doc, y, [['Nature', 95, 'left'], ['Désignation', 220, 'left'], ['Qté', 45, 'right'], ['Jours', 45, 'right'], ['P.U.', 55, 'right'], ['Montant', 55, 'right']],
    data.frais.length ? data.frais.map((f) => [NATURES[f.nature], f.designation, String(f.quantite), f.jours === null ? '—' : String(f.jours), mt(f.prix_unitaire), mt(f.montant)])
      : [['—', 'Aucun frais prévu', '', '', '', '0']]);
  const lettres = montantEnLettres(m.prevu, 'XAF');
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a')
    .text(`Frais prévus : ${mt(m.prevu)} FCFA — ${lettres.charAt(0).toUpperCase()}${lettres.slice(1)}.`, 40, y + 8, { width: 515 });
  if (m.approuve_par_nom) {
    doc.font('Helvetica').fontSize(8.3).fillColor('#475569').text(`Approuvé par ${m.approuve_par_nom} (directeur) le ${dateFr(iso(m.approuve_le))}.`, 40, doc.y + 4);
  }
  y = doc.y + 16;
  if (['a_controler', 'justifiee', 'cloturee'].includes(m.statut) || data.depenses.length) {
    if (y > 560) { doc.addPage(); y = 50; }
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a').text('Décompte des frais de mission', 40, y);
    y = mp.tableau(doc, doc.y + 4, [['Date', 60, 'left'], ['Nature', 95, 'left'], ['Désignation', 270, 'left'], ['Montant', 90, 'right']],
      data.depenses.length ? data.depenses.map((d) => [dateFr(d.date_depense), NATURES[d.nature], d.designation, mt(d.montant)]) : [['—', '—', 'Aucune dépense', '0']]);
    doc.font('Helvetica').fontSize(9).fillColor('#0f172a').text([
      `Dépenses justifiées : ${mt(m.depenses)} FCFA`, `Avance versée : ${mt(m.verse)} FCFA${m.reverse ? ` — reliquat reversé : ${mt(m.reverse)} FCFA` : ''}`,
      m.reliquat ? `Reliquat à reverser par le missionnaire : ${mt(m.reliquat)} FCFA` : m.complement ? `Complément dû au missionnaire : ${mt(m.complement)} FCFA` : 'Mission soldée.',
    ].join('\n'), 40, y + 8, { width: 515, lineGap: 1 });
    y = doc.y + 16;
  }
  if (y > 650) { doc.addPage(); y = 50; }
  const wZ = (515 - 24) / 3;
  mp.zoneSignature(doc, 40, y, wZ, 88, `Le missionnaire — ${m.missionnaire_nom}`);
  mp.zoneSignature(doc, 40 + wZ + 12, y, wZ, 88, 'Visa à destination (cachet, date d\'arrivée et de départ)');
  mp.zoneSignature(doc, 40 + 2 * (wZ + 12), y, wZ, 88, `Le directeur${m.approuve_par_nom ? ` — ${m.approuve_par_nom}` : ''}`);
  mp.finaliser(doc, s, m.numero, ['brouillon', 'soumise'].includes(m.statut) ? 'NON APPROUVÉ' : ['rejetee', 'annulee'].includes(m.statut) ? m.statut_libelle.toUpperCase() : '');
  return { contenu: await fin, nom: `ordre-de-mission-${m.numero}.pdf` };
};

// ── Notifications (mail + cloche) ───────────────────────────────────────────
const annoncer = (req, missionId, evenement, extra = {}) => {
  setImmediate(async () => {
    try {
      const [m] = await Q(`${SELECT_MISSION} WHERE m.id = :id`, { id: Number(missionId) });
      if (!m) return;
      const base = [`Mission ${m.numero || ''} : ${m.missionnaire_nom} → ${m.destination}, du ${m.date_depart} au ${m.date_retour}.`, `Objet : ${m.objet}.`];
      const par = req.user?.username ? ` par ${req.user.username}` : '';
      const concernes = [m.cree_par, m.missionnaire_id];
      const E = {
        soumise: { dest: { role: 'directeur' }, titre: `Ordre de mission à approuver — ${m.numero}`, lignes: [...base, `Frais prévus : ${fmt(m.prevu)} FCFA.`] },
        approuvee: { dest: { ids: concernes, permission: 'journal.create' }, titre: `Ordre de mission approuvé — ${m.numero}`,
          lignes: [...base, `Approuvé${par}. Frais prévus : ${fmt(m.prevu)} FCFA ; l'avance éventuelle se verse depuis la fiche de la mission.`] },
        renvoyer: { dest: { ids: concernes }, titre: `Ordre de mission renvoyé pour correction — ${m.numero}`, lignes: [...base, `Motif : ${extra.motif}.`] },
        rejeter: { dest: { ids: concernes }, titre: `Ordre de mission rejeté — ${m.numero}`, lignes: [...base, `Motif : ${extra.motif}.`] },
        annulee: { dest: { ids: concernes, role: 'directeur' }, titre: `Ordre de mission annulé — ${m.numero}`, lignes: [...base, `Motif : ${extra.motif}.`] },
        avance: { dest: { ids: concernes }, titre: `Avance de mission versée — ${m.numero}`, lignes: [...base, `Avance de ${fmt(extra.montant)} FCFA versée${par}.`] },
        a_controler: { dest: { role: 'directeur', permission: 'justificatifs.valider' }, titre: `Justification de mission à contrôler — ${m.numero}`,
          lignes: [...base, `Dépenses présentées : ${fmt(m.depenses)} FCFA ; avance versée : ${fmt(n(m.verse) - n(m.reverse))} FCFA.`] },
        justifiee: { dest: { ids: concernes, permission: 'journal.create' }, titre: `Justification de mission validée — ${m.numero}`,
          lignes: [...base, `Dépenses retenues : ${fmt(m.depenses)} FCFA.`, m.statut === 'cloturee' ? 'La mission est soldée et clôturée.'
            : 'La caisse régularise : reliquat à reverser ou complément à payer au missionnaire.'] },
        justif_renvoyee: { dest: { ids: [m.justif_soumise_par, ...concernes] }, titre: `Justification de mission à reprendre — ${m.numero}`, lignes: [...base, `Motif : ${extra.motif}.`] },
        complement: { dest: { ids: concernes }, titre: `Complément de mission payé — ${m.numero}`, lignes: [...base, `Complément de ${fmt(extra.montant)} FCFA payé${par}.`] },
        reliquat: { dest: { ids: concernes }, titre: `Reliquat de mission reversé — ${m.numero}`, lignes: [...base, `Reliquat de ${fmt(extra.montant)} FCFA encaissé${par}.`] },
      }[evenement];
      if (!E) return;
      await notifs.notifier({ tenantId: req.tenantId, auteurId: req.user.id, destinataires: E.dest, type: `mission_${evenement}`, titre: E.titre,
        lignes: E.lignes, chemin: `/finance/missions/${m.id}`, refType: 'mission', refId: m.id, rubrique: 'Missions' });
    } catch (e) {
      console.warn('[Missions] notification :', e.message);
    }
  });
};

const compteurs = async (req) => {
  const p = await profil(req).catch((e) => { if (e instanceof ErreurProjet && e.status === 403) return null; throw e; });
  if (!p) return { a_approuver: 0, a_controler: 0, a_regulariser: 0, avance_a_verser: 0 };
  const l = await lister(Object.assign(Object.create(req), { query: {} }));
  return {
    a_approuver: p.directeur ? l.compteurs.a_approuver : 0,
    a_controler: p.directeur || p.comptable ? l.compteurs.a_controler : 0,
    a_regulariser: p.caisse ? l.compteurs.a_regulariser : 0,
    avance_a_verser: p.caisse ? l.compteurs.avance_a_verser : 0,
  };
};

module.exports = {
  traduire, contexte, lister, lire, creer, modifier, supprimer, soumettre, decider, annuler,
  declarer, retirerDepense, enregistrerRapport, soumettreJustification, controler, cloturer,
  verserAvance: mouvement('avance'), payerComplement: mouvement('complement'), reverserReliquat: mouvement('reliquat'),
  lienCaisse, relierMouvement, fichierDepense, ordrePdf, parametres, enregistrerParametres, compteurs, NATURES,
};
