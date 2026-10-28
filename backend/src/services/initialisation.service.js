// src/services/initialisation.service.js — Initialisation guidée d'un espace.
//
// Après activation d'un compte de démonstration, le directeur de l'espace doit,
// avant toute saisie :
//   1. choisir ses caisses : combien par type (espèces, Orange Money, MoMo,
//      banque, carte prépayée, autre) et leur nom ;
//   2. choisir le mois de démarrage et saisir le solde d'ouverture (RAN) de
//      chaque caisse.
// Les caisses créées par défaut à l'ouverture de l'espace sont réutilisées
// (renommées) ; celles qui ne sont pas retenues sont DÉSACTIVÉES, jamais
// supprimées. tenants.initialise_le est renseigné à la fin (migration 029).
const { sequelize } = require('../models');
const { MOIS, typeCaisseDuJournal, ErreurComptable } = require('./journal.service');
const { PREFIX_BY_TYPE, TYPES_JOURNAUX } = require('../controllers/journaux.controller');

const SELECT = sequelize.QueryTypes.SELECT;
const q = (sql, replacements, t) => sequelize.query(sql, { replacements, type: SELECT, transaction: t });
const MAX_PAR_TYPE = 10;
const TYPES = Object.keys(PREFIX_BY_TYPE);

let colonneOk = false;
const colonneExiste = async () => {
  if (colonneOk) return true;
  const [c] = await q(`SELECT 1 AS ok FROM information_schema.columns
                        WHERE table_name = 'tenants' AND column_name = 'initialise_le'`, {});
  colonneOk = Boolean(c);
  return colonneOk;
};

// État de l'initialisation pour le client de la requête.
const etat = async ({ tenantId }) => {
  if (!tenantId || !(await colonneExiste())) return { requise: false };
  const [t] = await q('SELECT id, nom, type_compte, initialise_le FROM tenants WHERE id = :t', { t: tenantId });
  if (!t) return { requise: false };
  if (t.initialise_le) return { requise: false, initialise_le: t.initialise_le };
  const journaux = await q(
    'SELECT id, code, nom, type, ordre, actif FROM journaux WHERE tenant_id = :t ORDER BY ordre, id', { t: tenantId });
  const now = new Date();
  return {
    requise: true,
    tenant_nom: t.nom,
    journaux,
    types: TYPES.map((k) => ({ type: k, label: TYPES_JOURNAUX[k]?.label || k, icon: TYPES_JOURNAUX[k]?.icon || '' })),
    mois_defaut: MOIS[now.getMonth()],
    annee_defaut: now.getFullYear(),
    jour_defaut: now.getDate(),
    mois: MOIS,
  };
};

const valider = ({ mois, annee, jour, caisses }) => {
  if (!MOIS.includes(mois)) throw new ErreurComptable(400, 'Mois de démarrage invalide.');
  const an = parseInt(annee, 10);
  if (!an || an < 2000 || an > 2100) throw new ErreurComptable(400, 'Année de démarrage invalide.');
  // Jour d'ouverture (migration 032) : 1er du mois si non précisé (anciens clients).
  const m = MOIS.indexOf(mois) + 1;
  const nbJours = new Date(an, m, 0).getDate();
  const j = jour === undefined || jour === null || jour === '' ? 1 : parseInt(jour, 10);
  if (!Number.isInteger(j) || j < 1 || j > nbJours) {
    throw new ErreurComptable(400, `Jour d'ouverture invalide : ${mois} ${an} compte ${nbJours} jours.`);
  }
  const dateOuverture = `${an}-${String(m).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
  if (!Array.isArray(caisses) || caisses.length === 0) throw new ErreurComptable(400, 'Définissez au moins une caisse.');
  const noms = new Set();
  const propres = caisses.map((c, i) => {
    const type = String(c?.type || '');
    if (!TYPES.includes(type)) throw new ErreurComptable(400, `Caisse ${i + 1} : type invalide.`);
    const nom = String(c?.nom || '').trim().slice(0, 80);
    if (!nom) throw new ErreurComptable(400, `Caisse ${i + 1} : indiquez un nom.`);
    const cleNom = nom.toLowerCase();
    if (noms.has(cleNom)) throw new ErreurComptable(400, `Deux caisses portent le nom « ${nom} ».`);
    noms.add(cleNom);
    const ran = Number(c?.ran ?? 0);
    if (!Number.isFinite(ran) || ran < 0) throw new ErreurComptable(400, `« ${nom} » : le solde d'ouverture doit être un montant positif ou nul.`);
    return { type, nom, ran: Math.round(ran * 100) / 100 };
  });
  for (const type of TYPES) {
    if (propres.filter((c) => c.type === type).length > MAX_PAR_TYPE) {
      throw new ErreurComptable(400, `${MAX_PAR_TYPE} caisses au plus par type.`);
    }
  }
  return { mois, annee: an, jour: j, date_ouverture: dateOuverture, caisses: propres };
};

const initialiser = async ({ tenantId, user, body }) => {
  const d = valider(body || {});
  return sequelize.transaction(async (t) => {
    const [ten] = await q('SELECT id, initialise_le FROM tenants WHERE id = :t FOR UPDATE', { t: tenantId }, t);
    if (!ten) throw new ErreurComptable(404, 'Client introuvable.');
    if (ten.initialise_le) throw new ErreurComptable(409, 'Ce compte est déjà initialisé : gérez vos caisses depuis la Configuration.');
    const [ecr] = await q('SELECT 1 AS ok FROM journal WHERE tenant_id = :t LIMIT 1', { t: tenantId }, t);
    if (ecr) throw new ErreurComptable(409, 'Des écritures existent déjà : l\'initialisation n\'est plus possible.');

    const existants = await q('SELECT id, code, type FROM journaux WHERE tenant_id = :t ORDER BY ordre, id', { t: tenantId }, t);
    const libres = [...existants];
    const retenus = [];
    let ordre = 0;
    for (const c of d.caisses) {
      ordre += 1;
      // Réutilise une caisse existante du même type (code conservé), sinon en crée une.
      const i = libres.findIndex((j) => j.type === c.type);
      let id; let code;
      if (i >= 0) {
        ({ id, code } = libres[i]);
        libres.splice(i, 1);
        await q('UPDATE journaux SET nom = :nom, ordre = :o, actif = true, date_ouverture = :d WHERE id = :id RETURNING id',
          { nom: c.nom, o: ordre, id, d: d.date_ouverture }, t);
      } else {
        const prefix = PREFIX_BY_TYPE[c.type];
        const [{ n }] = await q(
          `SELECT COALESCE(MAX(NULLIF(substring(code FROM '^${prefix}([0-9]+)$'), '')::int), 0) + 1 AS n
             FROM journaux WHERE tenant_id = :t`, { t: tenantId }, t);
        code = `${prefix}${n}`;
        [{ id }] = await q(
          `INSERT INTO journaux (tenant_id, code, nom, type, ordre, actif, date_ouverture)
           VALUES (:t, :code, :nom, :type, :o, true, :d) RETURNING id`,
          { t: tenantId, code, nom: c.nom, type: c.type, o: ordre, d: d.date_ouverture }, t);
      }
      // Solde d'ouverture du mois de démarrage (un seul par caisse).
      await q('DELETE FROM ran WHERE tenant_id = :t AND journal_id = :j RETURNING id', { t: tenantId, j: id }, t);
      await q(
        `INSERT INTO ran (tenant_id, mois, annee, journal_id, type_caisse, montant, origine)
         VALUES (:t, :mois, :annee, :j, :tc, :m, 'ouverture') RETURNING id`,
        { t: tenantId, mois: d.mois, annee: d.annee, j: id, tc: typeCaisseDuJournal(c.type), m: c.ran }, t);
      retenus.push({ id, code, nom: c.nom, type: c.type, ran: c.ran });
    }
    // Caisses par défaut non retenues : désactivées (aucune suppression).
    if (libres.length) {
      await q('UPDATE journaux SET actif = false WHERE id IN (:ids) RETURNING id', { ids: libres.map((j) => j.id) }, t);
    }
    await q('UPDATE tenants SET initialise_le = NOW() WHERE id = :t RETURNING id', { t: tenantId }, t);
    await sequelize.query(
      `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, nouvelle_valeur)
       VALUES (:t, :u, 'INITIALISATION_COMPTE', 'tenant', :t, CAST(:v AS jsonb))`,
      { replacements: { t: tenantId, u: user.id, v: JSON.stringify({ mois: d.mois, annee: d.annee, date_ouverture: d.date_ouverture, caisses: retenus, desactivees: libres.map((j) => j.code) }) }, transaction: t });
    const total = retenus.reduce((s, c) => s + c.ran, 0);
    const jourTxt = d.jour === 1 ? '1er' : String(d.jour);
    return {
      message: `Compte initialisé : ${retenus.length} caisse${retenus.length > 1 ? 's' : ''}, ouverture le ${jourTxt} ${d.mois.toLowerCase()} ${d.annee}.`,
      caisses: retenus, mois: d.mois, annee: d.annee, date_ouverture: d.date_ouverture, total_ran: total,
    };
  });
};

// Garde-fou des saisies : aucune écriture tant que l'espace n'est pas initialisé.
const verifierInitialise = async (tenantId) => {
  if (!tenantId || !(await colonneExiste())) return;
  const [t] = await q('SELECT initialise_le FROM tenants WHERE id = :t', { t: tenantId });
  if (t && !t.initialise_le) {
    throw new ErreurComptable(409, 'Initialisez d\'abord votre compte (caisses et soldes d\'ouverture) avant toute saisie.');
  }
};

module.exports = { etat, initialiser, verifierInitialise };
