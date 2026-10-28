// src/services/budget_hebdo.service.js
// Budget hebdomadaire au choix (migration 040, fiche du 19/10/2026).
//
// Source UNIQUE du calendrier des semaines et du réglage de périodicité :
//   - semainesDuMois(mois, annee) : semaines lundi → dimanche, coupées aux
//     bornes du mois, numérotées 1..N ; un morceau de moins de 3 jours en
//     début ou en fin de mois est rattaché à la semaine voisine (même mois) ;
//   - periodicite(tenantId, mois, annee) : 'mensuel' | 'hebdomadaire', d'après
//     l'historique tenant_periodicites (réglage en vigueur au 1er du mois) ;
//   - exigerSemaine() : cohérence « semaine fournie ⇔ mois hebdomadaire ».
// L'interface reçoit les semaines par l'API (GET /budget/periode) : elle ne
// recalcule jamais elle-même le calendrier.
const { sequelize } = require('../models');

const T = sequelize.QueryTypes;
const MOIS = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
const MOIS_COURT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const JOURS_MIN = 3;   // morceau de semaine plus court → rattaché à la voisine

class ErreurMetier extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const sansAccent = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const indexMois = (mois) => {
  const m = sansAccent(mois).toLowerCase();
  return MOIS.findIndex((x) => x.toLowerCase() === m);
};
const iso = (annee, idx, jour) => `${annee}-${String(idx + 1).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;

/** Semaines d'un mois : [{ num, debut, fin, jours, libelle }]. */
const semainesDuMois = (mois, annee) => {
  const idx = indexMois(mois);
  const an = Number(annee);
  if (idx < 0 || !Number.isInteger(an)) throw new ErreurMetier(400, `Mois invalide : ${mois} ${annee}.`);
  const nbJours = new Date(Date.UTC(an, idx + 1, 0)).getUTCDate();
  const segs = [];
  for (let d = 1; d <= nbJours; d += 1) {
    const lundi = new Date(Date.UTC(an, idx, d)).getUTCDay() === 1;
    if (d === 1 || lundi) segs.push({ debut: d, fin: d });
    else segs[segs.length - 1].fin = d;
  }
  const long = (s) => s.fin - s.debut + 1;
  if (segs.length > 1 && long(segs[0]) < JOURS_MIN) { segs[1].debut = segs[0].debut; segs.shift(); }
  if (segs.length > 1 && long(segs[segs.length - 1]) < JOURS_MIN) {
    segs[segs.length - 2].fin = segs[segs.length - 1].fin; segs.pop();
  }
  return segs.map((s, i) => ({
    num: i + 1,
    debut: iso(an, idx, s.debut),
    fin: iso(an, idx, s.fin),
    jours: long(s),
    libelle: `S${i + 1} · du ${s.debut} au ${s.fin} ${MOIS_COURT[idx]}`,
  }));
};

/** Numéro de semaine (dans son mois) d'une date 'YYYY-MM-DD'. */
const semaineDeDate = (date) => {
  const d = String(date || '').slice(0, 10);
  const [a, m] = d.split('-').map(Number);
  if (!a || !m) throw new ErreurMetier(400, `Date invalide : ${date}.`);
  const s = semainesDuMois(MOIS[m - 1], a).find((x) => d >= x.debut && d <= x.fin);
  return { mois: MOIS[m - 1], annee: a, semaine: s.num, ...s };
};

const semaineSuivante = (mois, annee, k) => {
  const n = semainesDuMois(mois, annee).length;
  if (k < n) return { mois: MOIS[indexMois(mois)], annee: Number(annee), semaine: k + 1 };
  const idx = indexMois(mois);
  return idx === 11 ? { mois: MOIS[0], annee: Number(annee) + 1, semaine: 1 } : { mois: MOIS[idx + 1], annee: Number(annee), semaine: 1 };
};
const semainePrecedente = (mois, annee, k) => {
  if (k > 1) return { mois: MOIS[indexMois(mois)], annee: Number(annee), semaine: k - 1 };
  const idx = indexMois(mois);
  const p = idx === 0 ? { mois: MOIS[11], annee: Number(annee) - 1 } : { mois: MOIS[idx - 1], annee: Number(annee) };
  return { ...p, semaine: semainesDuMois(p.mois, p.annee).length };
};

// ── Réglage de périodicité ─────────────────────────────────────────────────
// Table absente (migration 040 pas encore jouée) → tout est mensuel.
let table = null;
const aTable = async () => {
  if (table === true) return true;
  const r = await sequelize.query("SELECT to_regclass('public.tenant_periodicites') IS NOT NULL AS ok", { type: T.SELECT });
  table = Boolean(r[0]?.ok);
  return table;
};

const premierDuMois = (mois, annee) => iso(Number(annee), indexMois(mois), 1);

const periodicite = async (tenantId, mois, annee, transaction) => {
  if (!tenantId || !(await aTable())) return 'mensuel';
  const [r] = await sequelize.query(
    `SELECT periodicite FROM tenant_periodicites
      WHERE tenant_id = :t AND a_partir_de <= CAST(:d AS date)
      ORDER BY a_partir_de DESC LIMIT 1`,
    { replacements: { t: tenantId, d: premierDuMois(mois, annee) }, type: T.SELECT, transaction });
  return r?.periodicite || 'mensuel';
};
const estHebdo = async (tenantId, mois, annee) => (await periodicite(tenantId, mois, annee)) === 'hebdomadaire';

/**
 * Cohérence de la semaine demandée avec le réglage du mois :
 *   mois hebdomadaire → semaine obligatoire (1..N) ; mois mensuel → aucune.
 * Retourne la semaine normalisée (entier) ou null.
 */
const exigerSemaine = async (tenantId, mois, annee, semaine) => {
  const hebdo = await estHebdo(tenantId, mois, annee);
  const vide = semaine === undefined || semaine === null || semaine === '' || semaine === 'null';
  if (!hebdo) {
    if (!vide) throw new ErreurMetier(400, `Le budget de ${mois} ${annee} est mensuel : aucune semaine à indiquer.`);
    return null;
  }
  if (vide) {
    throw new ErreurMetier(400, `Le budget de ${mois} ${annee} est hebdomadaire : précisez la semaine concernée (écran Prévisions ou Demande de fonds).`);
  }
  const k = parseInt(semaine, 10);
  const n = semainesDuMois(mois, annee).length;
  if (!(k >= 1 && k <= n)) throw new ErreurMetier(400, `Semaine invalide : ${mois} ${annee} compte ${n} semaines.`);
  return k;
};

/** État du réglage : en vigueur ce mois-ci, historique, et calendrier du mois demandé. */
const etatPeriodicite = async (tenantId) => {
  const auj = new Date();
  const mois = MOIS[auj.getMonth()];
  const annee = auj.getFullYear();
  const historique = (await aTable())
    ? await sequelize.query(
      `SELECT p.a_partir_de, p.periodicite, p.defini_le, u.username AS defini_par
         FROM tenant_periodicites p LEFT JOIN users u ON u.id = p.defini_par
        WHERE p.tenant_id = :t ORDER BY p.a_partir_de DESC`,
      { replacements: { t: tenantId }, type: T.SELECT })
    : [];
  return {
    disponible: await aTable(),
    mois_courant: mois, annee_courante: annee,
    actuelle: await periodicite(tenantId, mois, annee),
    historique: historique.map((h) => ({
      ...h, a_partir_de: String(h.a_partir_de instanceof Date ? h.a_partir_de.toISOString() : h.a_partir_de).slice(0, 10),
    })),
  };
};

/**
 * Change le réglage à partir du 1er d'un mois (jamais en cours de mois,
 * jamais rétroactif) ; refusé si ce mois a déjà un budget saisi ou validé.
 */
const definirPeriodicite = async ({ tenantId, userId, periodicite: p, mois, annee }) => {
  if (!['mensuel', 'hebdomadaire'].includes(p)) throw new ErreurMetier(400, 'Périodicité attendue : mensuel ou hebdomadaire.');
  if (!(await aTable())) throw new ErreurMetier(503, 'Migration 040 non appliquée : lancez « node db/migrate.js ».');
  const idx = indexMois(mois);
  const an = parseInt(annee, 10);
  if (idx < 0 || !an) throw new ErreurMetier(400, 'Mois de prise d\'effet invalide.');
  const auj = new Date();
  if (an * 12 + idx < auj.getFullYear() * 12 + auj.getMonth()) {
    throw new ErreurMetier(400, 'Le changement ne peut pas être rétroactif : choisissez le mois en cours ou un mois à venir.');
  }
  const m = MOIS[idx];
  return sequelize.transaction(async (transaction) => {
    const [{ n }] = await sequelize.query(
      `SELECT (SELECT COUNT(*) FROM budget WHERE tenant_id = :t AND mois = :m AND annee = :a)
            + (SELECT COUNT(*) FROM budget_validation WHERE tenant_id = :t AND mois = :m AND annee = :a) AS n`,
      { replacements: { t: tenantId, m, a: an }, type: T.SELECT, transaction });
    const actuelle = await periodicite(tenantId, m, an, transaction);
    if (Number(n) > 0 && actuelle !== p) {
      throw new ErreurMetier(409, `Le budget de ${m} ${an} est déjà commencé (prévisions ou validation) : `
        + 'le changement ne peut prendre effet qu\'au mois suivant.');
    }
    await sequelize.query(
      `INSERT INTO tenant_periodicites (tenant_id, a_partir_de, periodicite, defini_par)
       VALUES (:t, CAST(:d AS date), :p, :u)
       ON CONFLICT (tenant_id, a_partir_de) DO UPDATE SET periodicite = EXCLUDED.periodicite,
         defini_par = EXCLUDED.defini_par, defini_le = NOW()`,
      { replacements: { t: tenantId, d: premierDuMois(m, an), p, u: userId }, type: T.INSERT, transaction });
    await sequelize.query(
      `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, ancienne_valeur, nouvelle_valeur)
       VALUES (:t, :u, 'PERIODICITE_BUDGET', 'tenants', :t, CAST(:av AS jsonb), CAST(:ap AS jsonb))`,
      { replacements: { t: tenantId, u: userId, av: JSON.stringify({ periodicite: actuelle }),
          ap: JSON.stringify({ periodicite: p, a_partir_de: premierDuMois(m, an) }) }, type: T.INSERT, transaction });
    return { periodicite: p, a_partir_de: premierDuMois(m, an), mois: m, annee: an };
  });
};

/** Calendrier et réglage d'un mois donné (écrans Prévisions, Demande de fonds…). */
const periode = async (tenantId, mois, annee) => {
  const p = await periodicite(tenantId, mois, annee);
  return { mois: MOIS[indexMois(mois)], annee: Number(annee), periodicite: p,
    semaines: p === 'hebdomadaire' ? semainesDuMois(mois, annee) : [] };
};

// ── Rappel du vendredi (tâche quotidienne) ─────────────────────────────────
// Le vendredi, chaque client hebdomadaire dont la semaine suivante n'est pas
// validée reçoit une notification (titulaires de budget.validate). Une seule
// fois par semaine (clé de référence unique).
const rappelsVendredi = async (maintenant = new Date()) => {
  if (maintenant.getDay() !== 5 || !(await aTable())) return { envoyes: 0, vendredi: maintenant.getDay() === 5 };
  const lundi = new Date(maintenant); lundi.setDate(lundi.getDate() + 3);
  const iso10 = `${lundi.getFullYear()}-${String(lundi.getMonth() + 1).padStart(2, '0')}-${String(lundi.getDate()).padStart(2, '0')}`;
  const cible = semaineDeDate(iso10);
  const { notifierPermission } = require('./notification.service');
  const tenants = await sequelize.query('SELECT id FROM tenants WHERE actif', { type: T.SELECT });
  let envoyes = 0;
  for (const { id } of tenants) {
    if (!(await estHebdo(id, cible.mois, cible.annee))) continue;
    const ref = `${cible.mois}-${cible.annee}-S${cible.semaine}`;
    const [deja] = await sequelize.query(
      `SELECT 1 FROM budget_validation WHERE tenant_id = :t AND mois = :m AND annee = :a AND semaine = :k AND statut = 'valide'
        UNION ALL SELECT 1 FROM notifications WHERE tenant_id = :t AND ref_type = 'budget_semaine' AND ref_id = :ref LIMIT 1`,
      { replacements: { t: id, m: cible.mois, a: cible.annee, k: cible.semaine, ref }, type: T.SELECT });
    if (deja) continue;
    envoyes += await notifierPermission({
      tenantId: id, permission: 'budget.validate', type: 'budget_semaine',
      titre: `Budget de la semaine ${cible.semaine} (${cible.mois}) à valider`,
      message: `La demande de fonds de la semaine du ${cible.debut.slice(8)} au ${cible.fin.slice(8)} ${cible.mois} n'est pas encore validée : `
        + 'sans validation, les dépenses de cette semaine seront mises en attente.',
      refType: 'budget_semaine', refId: ref,
    });
  }
  return { envoyes, semaine: `${cible.mois} ${cible.annee} S${cible.semaine}` };
};

module.exports = {
  ErreurMetier, MOIS, indexMois, semainesDuMois, semaineDeDate, semaineSuivante, semainePrecedente,
  periodicite, estHebdo, exigerSemaine, etatPeriodicite, definirPeriodicite, periode, rappelsVendredi,
};
