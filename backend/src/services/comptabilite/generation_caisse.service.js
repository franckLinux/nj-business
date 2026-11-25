'use strict';
// NJ FINANCE — lot F3 : écritures produites par les mouvements de caisse (077).
//
// Un mouvement du journal de caisse (table journal) = une écriture
// (origine_type 'journal', origine_id = journal.id), dans le journal comptable de
// trésorerie rattaché à la caisse. Même règle que la passerelle (037/044) :
//   entrée  : D compte de trésorerie / C contrepartie
//   sortie  : D contrepartie / C compte de trésorerie
//   contrepartie = compte corrigé par le comptable (044), sinon compte validé
//   de la rubrique ; compte des virements internes pour un virement.
//   Une contre-passation (montants négatifs) s'inscrit en sens inverse.
//
// Statut : brouillard tant que l'arrêté de la caisse du mois n'est pas validé,
// validée ensuite (par le directeur qui a validé l'arrêté). Les montants, la date
// et la rubrique d'un mouvement sont intangibles (027) ; peuvent changer : le
// compte (équivalence validée, compte corrigé par le comptable), le tiers,
// l'activité. Une écriture au brouillard est alors refaite ; une écriture
// validée est EXTOURNÉE puis remplacée — jamais modifiée. Une annulation de
// caisse (contre-passation) produit sa propre écriture, en sens inverse.
//
// Périmètre (décision du 25/11/2026) : à partir du premier exercice comptable.
// Sans exercice, celui de l'année en cours est créé, avec les journaux standards
// (le client peut ne pas avoir NJ COMPTABILITÉ). Les exercices suivants se créent
// quand les mouvements les atteignent.
//
// Rien n'empêche la caisse de travailler : un mouvement qu'on ne peut pas
// comptabiliser (compte manquant, période verrouillée…) est listé comme
// ANOMALIE dans le rapport ; il sera repris dès que la cause est levée.
const crypto = require('node:crypto');
const { sequelize } = require('../../models');
const socle = require('./socle.service');
const { soldesJournaux } = require('../journal.service');

const T = sequelize.QueryTypes;
const Q = (sql, replacements, opts = {}) => sequelize.query(sql, { replacements, type: T.SELECT, ...opts });
const X = (sql, replacements, opts = {}) => sequelize.query(sql, { replacements, ...opts });
const norm = (c) => String(c ?? '').trim();
const cts = (v) => Math.round(Number(v || 0) * 100);
const mt = (c) => (c / 100).toFixed(2);
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

// ── Exercices et journaux nécessaires ───────────────────────────────────────
const exercices = (tenantId, transaction) => Q(
  'SELECT id, code, date_debut::text AS debut, date_fin::text AS fin, statut FROM fin_exercices WHERE tenant_id = :tenantId ORDER BY date_debut',
  { tenantId }, { transaction });

// Garantit qu'un exercice couvre chaque date jusqu'à `jusquA` (au plus 3 créations par appel).
const assurerExercices = async (tenantId, userId, jusquA) => {
  let liste = await exercices(tenantId);
  const crees = [];
  if (!liste.length) {
    const p = await socle.propositionExercice(tenantId);
    await socle.creerExercice({ tenantId, userId, body: p });
    crees.push(p.code);
    liste = await exercices(tenantId);
  }
  for (let i = 0; i < 3 && jusquA && liste.length && liste[liste.length - 1].fin < jusquA; i += 1) {
    const p = await socle.propositionExercice(tenantId);
    await socle.creerExercice({ tenantId, userId, body: p });
    crees.push(p.code);
    liste = await exercices(tenantId);
  }
  return { liste, crees };
};

// ── Mouvements et écritures en place ────────────────────────────────────────
const SQL_MOUVEMENTS = `
  SELECT j.id, j.date::text AS date, j.numero, j.journal_id, j.intitule, coalesce(j.beneficiaire, '') AS beneficiaire,
         coalesce(j.entree, 0) AS entree, coalesce(j.sortie, 0) AS sortie, j.rubrique_code,
         j.tiers_id, j.activite_id, j.created_by, j.annulation_de_id,
         jo.code AS jcode, coalesce(jo.compte_tresorerie, '') AS ctreso,
         coalesce(r.est_virement_interne, false) AS virement,
         coalesce(v.compte, '') AS cvalide, coalesce(cc.compte_corrige, '') AS ccorrige,
         fj.id AS fin_journal_id, fj.actif AS fin_journal_actif
    FROM journal j
    LEFT JOIN journaux jo ON jo.id = j.journal_id AND jo.tenant_id = j.tenant_id
    LEFT JOIN rubriques r ON r.tenant_id = j.tenant_id AND r.code = j.rubrique_code
    LEFT JOIN equivalences_comptables v ON v.rubrique_id = r.id AND v.statut = 'valide'
    LEFT JOIN controles_pieces cc ON cc.mouvement_id = coalesce(j.annulation_de_id, j.id)
    LEFT JOIN fin_journaux fj ON fj.journal_tresorerie_id = j.journal_id AND fj.tenant_id = j.tenant_id
   WHERE j.tenant_id = :tenantId AND j.date >= :debut AND j.date <= :fin`;

// Arrêtés validés : clé "journal:Mois:annee" → validateur.
const MOIS = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
const cleArret = (journalId, date) => `${journalId}:${MOIS[Number(date.slice(5, 7)) - 1]}:${date.slice(0, 4)}`;
const arretsValides = async (tenantId) => new Map((await Q(
  `SELECT journal_id, mois, annee, valide_par FROM controles_arrets WHERE tenant_id = :tenantId AND statut = 'validee'`,
  { tenantId })).map((a) => [`${a.journal_id}:${a.mois}:${a.annee}`, a.valide_par]));

// Écriture attendue pour un mouvement : { lignes, empreinte } ou { anomalie }.
const attendue = (m, compteVirements) => {
  const net = cts(m.entree) - cts(m.sortie);
  if (net === 0) return { vide: true };
  if (!m.journal_id) return { anomalie: 'mouvement sans journal de caisse (ancienne saisie) : rattachez-le à une caisse' };
  const treso = norm(m.ctreso);
  const contre = m.virement ? norm(compteVirements) : (norm(m.ccorrige) || norm(m.cvalide));
  const manque = [];
  if (!treso) manque.push(`compte de trésorerie de la caisse ${m.jcode}`);
  if (!contre) manque.push(m.virement ? 'compte des virements internes' : `compte validé de la rubrique ${m.rubrique_code}`);
  if (manque.length) return { anomalie: `${manque.join(' et ')} manquant` };
  const montant = Math.abs(net);
  const libelle = [norm(m.intitule), norm(m.beneficiaire)].filter(Boolean).join(' — ').slice(0, 300) || `Mouvement ${m.jcode}-${m.numero}`;
  const lTreso = { compte: treso, debit: net > 0 ? montant : 0, credit: net > 0 ? 0 : montant, tiers_id: null, activite_id: null, libelle };
  const lContre = { compte: contre, debit: net > 0 ? 0 : montant, credit: net > 0 ? montant : 0,
    tiers_id: m.tiers_id || null, activite_id: m.activite_id || null, libelle };
  const lignes = net > 0 ? [lTreso, lContre] : [lContre, lTreso];
  const entete = { date: m.date, reference_piece: `${m.jcode}-${m.numero ?? m.id}`.slice(0, 60), libelle };
  // Empreinte des seules données comptables (date, journal, comptes, sens, montants,
  // tiers, activité) : changer le libellé d'un mouvement ne refait pas l'écriture.
  const empreinte = crypto.createHash('sha256')
    .update(JSON.stringify({ date: m.date, fj: String(m.fin_journal_id || ''),
      lignes: lignes.map(({ compte, debit, credit, tiers_id: ti, activite_id: ac }) => [compte, debit, credit, ti ? String(ti) : null, ac ? String(ac) : null]) }))
    .digest('hex').slice(0, 32);
  return { entete, lignes, empreinte, montant };
};

// ── Opérations élémentaires (une transaction par mouvement) ─────────────────
const anomalieCompte = async (tenantId, lignes, transaction) => {
  for (const l of lignes) {
    const [{ a }] = await Q('SELECT fin_compte_anomalie(:tenantId, :compte) AS a', { tenantId, compte: l.compte }, { transaction });
    if (a) return a;
    if ((l.compte.startsWith('40') || l.compte.startsWith('41')) && !l.tiers_id) {
      return `le compte ${l.compte} exige un tiers : renseignez le bénéficiaire (registre des tiers) sur le mouvement`;
    }
  }
  return null;
};

const creer = async (tenantId, m, att, validePar, transaction) => {
  const [[e]] = await X(
    `INSERT INTO fin_ecritures (tenant_id, exercice_id, periode_id, journal_id, date_ecriture, reference_piece, libelle,
                                origine_type, origine_id, origine_empreinte, cree_par)
     VALUES (:tenantId, 0, 0, :fj, :date, :ref, :libelle, 'journal', :id, :emp, :createur) RETURNING id`,
    { tenantId, fj: m.fin_journal_id, date: att.entete.date, ref: att.entete.reference_piece, libelle: att.entete.libelle,
      id: m.id, emp: att.empreinte, createur: m.created_by || null }, { transaction });
  let n = 1;
  for (const l of att.lignes) {
    await X(`INSERT INTO fin_ecriture_lignes (tenant_id, ecriture_id, ordre, compte, tiers_id, activite_id, libelle, debit, credit)
             VALUES (:tenantId, :e, :n, :compte, :tiers, :activite, :libelle, :debit, :credit)`,
    { tenantId, e: e.id, n, compte: l.compte, tiers: l.tiers_id, activite: l.activite_id, libelle: l.libelle,
      debit: mt(l.debit), credit: mt(l.credit) }, { transaction });
    n += 1;
  }
  if (validePar) await X(`UPDATE fin_ecritures SET statut = 'validee', valide_par = :u WHERE id = :e`, { u: validePar, e: e.id }, { transaction });
  return e.id;
};

// Extourne d'une écriture validée générée (même date que l'origine).
const extourner = async (tenantId, e, userId, motif, transaction) => {
  const lignes = await Q('SELECT compte, tiers_id, activite_id, libelle, debit, credit FROM fin_ecriture_lignes WHERE ecriture_id = :id ORDER BY ordre, id',
    { id: e.id }, { transaction });
  const [[x]] = await X(
    `INSERT INTO fin_ecritures (tenant_id, exercice_id, periode_id, journal_id, date_ecriture, reference_piece, libelle,
                                origine_type, origine_id, extourne_de_id, motif_extourne, cree_par)
     VALUES (:tenantId, 0, 0, :journal, :date, :ref, :libelle, 'extourne', :id, :id, :motif, :userId) RETURNING id`,
    { tenantId, journal: e.journal_id, date: iso(e.date_ecriture), ref: e.reference_piece,
      libelle: `Extourne — ${e.libelle}`.slice(0, 300), id: e.id, motif, userId: userId || null }, { transaction });
  let n = 1;
  for (const l of lignes) {
    await X(`INSERT INTO fin_ecriture_lignes (tenant_id, ecriture_id, ordre, compte, tiers_id, activite_id, libelle, debit, credit)
             VALUES (:tenantId, :x, :n, :compte, :tiers_id, :activite_id, :libelle, :debit, :credit)`,
    { tenantId, x: x.id, n, ...l, debit: l.credit, credit: l.debit }, { transaction });
    n += 1;
  }
  await X(`UPDATE fin_ecritures SET statut = 'validee', valide_par = :u WHERE id = :x`, { u: userId || e.valide_par, x: x.id }, { transaction });
  await X('UPDATE fin_ecritures SET extournee_par_id = :x WHERE id = :id', { x: x.id, id: e.id }, { transaction });
};

// ── Synchronisation ─────────────────────────────────────────────────────────
const derniereSync = new Map();   // tenantId → horodatage (limite les synchronisations automatiques)

/**
 * Met les écritures de caisse en accord avec le journal de caisse.
 * @param {object} o  { tenantId, userId, force }  — sans force : au plus une fois par 30 s.
 * @returns {object}  compteurs et anomalies.
 */
const synchroniser = async ({ tenantId, userId = null, force = true }) => {
  if (!force && Date.now() - (derniereSync.get(tenantId) || 0) < 30e3) return { ignoree: true };
  derniereSync.set(tenantId, Date.now());
  // Un seul passage à la fois par client (verrou pris pour toute la durée).
  const verrou = await sequelize.transaction();
  try {
    const [{ ok }] = await Q('SELECT pg_try_advisory_xact_lock(hashtext(:k)) AS ok', { k: `fin_generation_caisse:${tenantId}` }, { transaction: verrou });
    if (!ok) { await verrou.commit(); return { ignoree: true, en_cours: true }; }
    const resultat = await synchroniserSousVerrou(tenantId, userId);
    await verrou.commit();
    return resultat;
  } catch (err) {
    await verrou.rollback();
    throw socle.traduire(err);
  }
};

const synchroniserSousVerrou = async (tenantId, userId) => {
  const [{ max }] = await Q('SELECT max(date)::text AS max FROM journal WHERE tenant_id = :tenantId', { tenantId });
  if (!max) {
    // Aucun mouvement de caisse : rien à comptabiliser, rien à créer.
    const liste = await exercices(tenantId);
    return { exercices_crees: [], journaux_crees: [], crees: 0, refaites: 0, extournees: 0, validees: 0, inchangees: 0, anomalies: [],
      perimetre: { debut: liste[0]?.debut || null, fin: liste[liste.length - 1]?.fin || null, mouvements: 0 }, synchronise_le: new Date().toISOString() };
  }
  const { liste, crees: exercicesCrees } = await assurerExercices(tenantId, userId, max);
  const debut = liste[0].debut;
  const fin = liste[liste.length - 1].fin;
  const journaux = await socle.initialiserJournaux({ tenantId, userId });
  const [t] = await Q('SELECT coalesce(compte_virements, \'\') AS cv FROM tenants WHERE id = :tenantId', { tenantId });
  const arrets = await arretsValides(tenantId);
  const mouvements = await Q(`${SQL_MOUVEMENTS} ORDER BY j.date, j.id`, { tenantId, debut, fin });
  const actives = new Map((await Q(
    `SELECT e.id, e.origine_id, e.statut, e.origine_empreinte, e.journal_id, e.date_ecriture, e.reference_piece, e.libelle, e.valide_par,
            p.statut AS periode_statut
       FROM fin_ecritures e JOIN fin_periodes p ON p.id = e.periode_id
      WHERE e.tenant_id = :tenantId AND e.origine_type = 'journal' AND e.extournee_par_id IS NULL`, { tenantId }))
    .map((e) => [String(e.origine_id), e]));

  const r = { exercices_crees: exercicesCrees, journaux_crees: journaux.crees.map((j) => j.code), crees: 0, refaites: 0,
    extournees: 0, validees: 0, inchangees: 0, anomalies: [] };
  const anomalie = (m, texte) => r.anomalies.push({ mouvement_id: m.id, reference: `${m.jcode || '—'}-${m.numero ?? m.id}`, date: m.date,
    libelle: m.intitule, montant: mt(Math.abs(cts(m.entree) - cts(m.sortie))), motif: texte });

  for (const m of mouvements) {
    const att = attendue(m, t?.cv);
    const e = actives.get(String(m.id));
    actives.delete(String(m.id));
    const validePar = m.journal_id ? arrets.get(cleArret(m.journal_id, m.date)) || null : null;
    if (att.anomalie) { anomalie(m, att.anomalie); continue; }
    if (att.vide && !e) continue;
    if (!att.vide && !m.fin_journal_id) { anomalie(m, `aucun journal comptable de trésorerie pour la caisse ${m.jcode}`); continue; }
    if (!att.vide && m.fin_journal_actif === false) { anomalie(m, `le journal comptable de la caisse ${m.jcode} est désactivé`); continue; }
    if (e && !att.vide && e.origine_empreinte === att.empreinte) {
      if (e.statut === 'brouillard' && validePar) {
        try {
          await sequelize.transaction((transaction) => X(`UPDATE fin_ecritures SET statut = 'validee', valide_par = :u WHERE id = :id`,
            { u: validePar, id: e.id }, { transaction }));
          r.validees += 1;
        } catch (err) { anomalie(m, `validation impossible : ${socle.traduire(err).message}`); }
      } else r.inchangees += 1;
      continue;
    }
    // Création, remplacement ou suppression (mouvement ramené à zéro).
    try {
      await sequelize.transaction(async (transaction) => {
        if (!att.vide) {
          const a = await anomalieCompte(tenantId, att.lignes, transaction);
          if (a) throw new socle.ErreurFinance(400, a);
        }
        if (e) {
          if (e.statut === 'brouillard') await X('DELETE FROM fin_ecritures WHERE id = :id', { id: e.id }, { transaction });
          else await extourner(tenantId, e, userId || validePar, `Mouvement de caisse ${e.reference_piece} modifié après validation`, transaction);
        }
        if (!att.vide) await creer(tenantId, m, att, validePar, transaction);
      });
      if (e && e.statut === 'validee') r.extournees += 1;
      if (e && !att.vide) r.refaites += 1; else if (!att.vide) r.crees += 1;
      if (!att.vide && validePar) r.validees += 1;
    } catch (err) {
      anomalie(m, socle.traduire(err).message);
    }
  }
  // Écritures dont le mouvement a disparu du périmètre (supprimé).
  for (const e of actives.values()) {
    const [existe] = await Q('SELECT 1 FROM journal WHERE id = :id AND tenant_id = :tenantId', { id: e.origine_id, tenantId });
    if (existe) continue;   // hors périmètre de dates : on n'y touche pas
    try {
      await sequelize.transaction(async (transaction) => {
        if (e.statut === 'brouillard') await X('DELETE FROM fin_ecritures WHERE id = :id', { id: e.id }, { transaction });
        else await extourner(tenantId, e, userId || e.valide_par, `Mouvement de caisse ${e.reference_piece} supprimé`, transaction);
      });
      if (e.statut === 'validee') r.extournees += 1;
    } catch (err) {
      r.anomalies.push({ mouvement_id: e.origine_id, reference: e.reference_piece, date: iso(e.date_ecriture), libelle: e.libelle,
        montant: null, motif: `mouvement supprimé, écriture impossible à retirer : ${socle.traduire(err).message}` });
    }
  }
  r.perimetre = { debut, fin, mouvements: mouvements.length };
  r.synchronise_le = new Date().toISOString();
  return r;
};

// ── Rapport : état de la génération et contrôle de la trésorerie ────────────
const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const etat = async ({ tenantId, userId }) => {
  const sync = await synchroniser({ tenantId, userId, force: true });
  if (sync.en_cours) throw new socle.ErreurFinance(409, 'Une génération est déjà en cours pour ce client : réessayez dans quelques secondes.');
  const { debut, fin } = sync.perimetre;
  if (!debut) {
    return { perimetre: { debut: null, fin: null, mouvements: 0, anterieurs_non_repris: 0 }, ecritures: { brouillard: 0, validees: 0 },
      synchronisation: sync, anomalies: [], tresorerie: [], ouvertures: [] };
  }
  const [compteurs] = await Q(
    `SELECT count(*) FILTER (WHERE statut = 'brouillard')::int AS brouillard, count(*) FILTER (WHERE statut = 'validee')::int AS validees
       FROM fin_ecritures WHERE tenant_id = :tenantId AND origine_type = 'journal' AND extournee_par_id IS NULL`, { tenantId });
  const [{ anterieurs }] = await Q('SELECT count(*)::int AS anterieurs FROM journal WHERE tenant_id = :tenantId AND date < :debut',
    { tenantId, debut });
  // Contrôle : pour chaque compte de trésorerie et chaque mois, le mouvement de la
  // caisse (entrées − sorties) = le mouvement du compte dans les écritures de caisse.
  const caisse = await Q(
    `SELECT coalesce(jo.compte_tresorerie, '') AS compte, to_char(j.date, 'YYYY-MM') AS mois,
            string_agg(DISTINCT jo.code, ', ') AS caisses, sum(coalesce(j.entree, 0) - coalesce(j.sortie, 0)) AS net
       FROM journal j JOIN journaux jo ON jo.id = j.journal_id
      WHERE j.tenant_id = :tenantId AND j.date BETWEEN :debut AND :fin
      GROUP BY 1, 2`, { tenantId, debut, fin });
  const compta = await Q(
    `SELECT l.compte, to_char(e.date_ecriture, 'YYYY-MM') AS mois, sum(l.debit - l.credit) AS net
       FROM fin_ecriture_lignes l JOIN fin_ecritures e ON e.id = l.ecriture_id
      WHERE e.tenant_id = :tenantId AND e.date_ecriture BETWEEN :debut AND :fin
        AND (e.origine_type = 'journal' OR (e.origine_type = 'extourne'
             AND EXISTS (SELECT 1 FROM fin_ecritures o WHERE o.id = e.extourne_de_id AND o.origine_type = 'journal')))
        AND l.compte IN (SELECT compte_tresorerie FROM journaux WHERE tenant_id = :tenantId AND coalesce(compte_tresorerie, '') <> '')
      GROUP BY 1, 2`, { tenantId, debut, fin });
  const cles = new Map();
  for (const c of caisse) cles.set(`${c.compte}|${c.mois}`, { compte: c.compte || '(sans compte)', mois: c.mois, caisses: c.caisses, caisse: cts(c.net), compta: 0 });
  for (const c of compta) {
    const k = `${c.compte}|${c.mois}`;
    const x = cles.get(k) || { compte: c.compte, mois: c.mois, caisses: '', caisse: 0, compta: 0 };
    x.compta = cts(c.net); cles.set(k, x);
  }
  const tresorerie = [...cles.values()].sort((a, b) => (a.compte + a.mois).localeCompare(b.compte + b.mois)).map((x) => ({
    ...x, libelle_mois: `${MOIS_COURTS[Number(x.mois.slice(5, 7)) - 1]} ${x.mois.slice(0, 4)}`,
    caisse: mt(x.caisse), compta: mt(x.compta), ecart: mt(x.caisse - x.compta), concorde: x.caisse === x.compta,
  }));
  // Ouverture : RAN de la caisse au début du périmètre vs à-nouveaux passés sur le compte de trésorerie.
  const caissesCompte = await Q(
    `SELECT id, code, compte_tresorerie AS compte FROM journaux
      WHERE tenant_id = :tenantId AND coalesce(compte_tresorerie, '') <> ''`, { tenantId });
  const soldes = await soldesJournaux(tenantId, MOIS[Number(debut.slice(5, 7)) - 1], Number(debut.slice(0, 4)), caissesCompte.map((c) => c.id));
  const parCompte = new Map();
  for (const c of caissesCompte) {
    const o = parCompte.get(c.compte) || { compte: c.compte, caisses: [], ran: 0 };
    o.caisses.push(c.code); o.ran += cts(soldes.get(Number(c.id))?.ran || 0);
    parCompte.set(c.compte, o);
  }
  const ouverture = [...parCompte.values()].map((o) => ({ ...o, caisses: o.caisses.join(', ') }));
  const an = await Q(
    `SELECT l.compte, sum(l.debit - l.credit) AS net FROM fin_ecriture_lignes l JOIN fin_ecritures e ON e.id = l.ecriture_id
       JOIN fin_journaux j ON j.id = e.journal_id
      WHERE e.tenant_id = :tenantId AND j.type = 'an' AND e.date_ecriture BETWEEN :debut AND :fin GROUP BY l.compte`,
    { tenantId, debut, fin });
  const ouvertures = ouverture.map((o) => {
    const a = an.find((x) => x.compte === o.compte);
    return { compte: o.compte, caisses: o.caisses, ran: mt(o.ran), a_nouveaux: mt(cts(a?.net)), concorde: o.ran === cts(a?.net) };
  });
  return {
    perimetre: { debut, fin, mouvements: sync.perimetre.mouvements, anterieurs_non_repris: anterieurs },
    ecritures: compteurs, synchronisation: sync, anomalies: sync.anomalies, tresorerie, ouvertures,
  };
};

module.exports = { synchroniser, etat, attendue };
