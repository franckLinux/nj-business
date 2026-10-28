'use strict';
// Registre des clients / fournisseurs (migration 043).
// Référentiel des tiers du client : sert au contrôle des pièces (le nom saisi
// est comparé à celui du registre) et à la saisie assistée.
const { sequelize } = require('../models');
const { chercherCompte } = require('./passerelle.service');

const T = sequelize.QueryTypes;
const Q = (sql, replacements, opts = {}) => sequelize.query(sql, { replacements, type: T.SELECT, ...opts });

class ErreurRegistre extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const TYPES = ['fournisseur', 'client', 'mixte'];
const TYPE_LIB = { fournisseur: 'Fournisseur', client: 'Client', mixte: 'Client et fournisseur' };
const txt = (v) => String(v ?? '').trim();
const normNui = (v) => txt(v).toUpperCase().replace(/\s+/g, '');
const NUI_RE = /^[A-Z]\d{12}[A-Z]$/;
const LIMITES = { nom: 200, nui: 30, rccm: 60, telephone: 40, email: 120, adresse: 300, notes: 1000 };
// Compte tiers (044) : compte de classe 4 (401… fournisseur, 411… client),
// 3 à 17 caractères, dont la racine à 3 chiffres existe dans le plan du client.
const COMPTE_TIERS_RE = /^4\d{2}[0-9A-Z]{0,14}$/;
const normCompte = (v) => txt(v).toUpperCase().replace(/\s+/g, '');
// Collectif par défaut quand le tiers n'a pas encore de compte individuel.
const COLLECTIF = { fournisseur: '401', client: '411' };
const collectifDe = (type, sens) => (type === 'mixte' ? (sens === 'entree' ? '411' : '401') : (COLLECTIF[type] || ''));

const exigerClient = (tenantId) => {
  if (!tenantId) throw new ErreurRegistre(400, 'Choisissez d\'abord un client.');
};

// NUI « retenu » d'une pièce : celui du contrôle s'il existe, sinon celui saisi.
const NUI_PIECE = "upper(regexp_replace(COALESCE(NULLIF(btrim(c.tiers_nui), ''), j.nui, ''), '\\s+', '', 'g'))";

const auditer = (transaction, { tenantId, userId, action, id, avant, apres }) => sequelize.query(
  `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, ancienne_valeur, nouvelle_valeur)
   VALUES (:t, :u, :a, 'registre_tiers', :id, CAST(:av AS jsonb), CAST(:ap AS jsonb))`,
  { replacements: { t: tenantId, u: userId, a: action, id: String(id), av: avant ? JSON.stringify(avant) : null, ap: apres ? JSON.stringify(apres) : null }, transaction });

const lister = async (tenantId, { q = '', type = '', actifs = '1' } = {}) => {
  exigerClient(tenantId);
  if (type && !TYPES.includes(type)) throw new ErreurRegistre(400, 'Type de tiers inconnu.');
  const rows = await Q(
    `SELECT t.*, uv.username AS verifie_par_nom,
            COALESCE(s.nb, 0)::int AS nb_pieces, COALESCE(s.sorties, 0) AS total_sorties,
            COALESCE(s.entrees, 0) AS total_entrees, s.derniere::text AS derniere_piece
       FROM registre_tiers t
       LEFT JOIN users uv ON uv.id = t.verifie_par
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS nb, SUM(j.sortie) AS sorties, SUM(j.entree) AS entrees, MAX(j.date) AS derniere
           FROM journal j LEFT JOIN controles_pieces c ON c.mouvement_id = j.id
          WHERE j.tenant_id = t.tenant_id AND NOT j.annule AND j.annulation_de_id IS NULL
            AND (c.tiers_id = t.id OR j.tiers_id = t.id OR (btrim(t.nui) <> '' AND ${NUI_PIECE} = upper(btrim(t.nui))))
       ) s ON true
      WHERE t.tenant_id = :t
        AND (:type = '' OR t.type = :type OR t.type = 'mixte')
        AND (:actifs <> '1' OR t.actif)
        AND (:q = '' OR lower(t.nom) LIKE :like OR lower(t.nui) LIKE :like OR lower(t.rccm) LIKE :like)
      ORDER BY t.actif DESC, lower(t.nom)`,
    { t: tenantId, type, actifs: String(actifs), q: txt(q), like: `%${txt(q).toLowerCase()}%` });
  return rows.map((r) => ({
    ...r,
    id: Number(r.id),
    type_libelle: TYPE_LIB[r.type],
    nui_format_ok: !r.nui || NUI_RE.test(r.nui),
    total_sorties: parseFloat(r.total_sorties) || 0,
    total_entrees: parseFloat(r.total_entrees) || 0,
  }));
};

const valeurs = (body) => {
  const v = {
    type: txt(body.type) || 'fournisseur',
    nui: normNui(body.nui),
    nom: txt(body.nom).replace(/\s+/g, ' '),
    rccm: txt(body.rccm), telephone: txt(body.telephone), email: txt(body.email),
    adresse: txt(body.adresse), notes: txt(body.notes),
    compte_tiers: normCompte(body.compte_tiers),
  };
  if (!TYPES.includes(v.type)) throw new ErreurRegistre(400, 'Type de tiers inconnu.');
  if (!v.nom) throw new ErreurRegistre(400, 'Le nom du tiers est obligatoire.');
  for (const [k, max] of Object.entries(LIMITES)) {
    if (v[k].length > max) throw new ErreurRegistre(400, `Champ « ${k} » trop long (${max} caractères au plus).`);
  }
  if (v.compte_tiers && !COMPTE_TIERS_RE.test(v.compte_tiers)) {
    throw new ErreurRegistre(400, `Compte tiers ${v.compte_tiers} invalide : compte de classe 4 de 3 à 17 caractères (ex. 401ACME pour un fournisseur, 411DUPONT pour un client).`);
  }
  return v;
};

// Le compte tiers se rattache à un compte collectif du plan du client (401, 411…).
const verifierCompteTiers = async (tenantId, compte, transaction) => {
  if (!compte) return;
  const racine = compte.slice(0, 3);
  const c = await chercherCompte(tenantId, racine, transaction);
  if (!c) throw new ErreurRegistre(400, `Compte tiers ${compte} : le compte collectif ${racine} n'existe pas dans le plan comptable du client.`);
  if (!c.actif) throw new ErreurRegistre(400, `Compte tiers ${compte} : le compte collectif ${racine} est inactif dans le plan du client.`);
};

const doublonCompte = async (tenantId, compte, sauf, transaction) => {
  if (!compte) return null;
  const [d] = await Q(
    `SELECT id, nom FROM registre_tiers WHERE tenant_id = :t AND upper(btrim(compte_tiers)) = :c AND (CAST(:sauf AS BIGINT) IS NULL OR id <> CAST(:sauf AS BIGINT))`,
    { t: tenantId, c: compte, sauf }, { transaction });
  return d || null;
};

const doublonNui = async (tenantId, nui, sauf, transaction) => {
  if (!nui) return null;
  const [d] = await Q(
    `SELECT id, nom FROM registre_tiers WHERE tenant_id = :t AND upper(btrim(nui)) = :nui AND (CAST(:sauf AS BIGINT) IS NULL OR id <> CAST(:sauf AS BIGINT))`,
    { t: tenantId, nui, sauf }, { transaction });
  return d || null;
};

const creerDans = async (transaction, { tenantId, userId, body }) => {
  const v = valeurs(body);
  const d = await doublonNui(tenantId, v.nui, null, transaction);
  if (d) throw new ErreurRegistre(409, `Le NUI ${v.nui} est déjà au registre (${d.nom}).`);
  await verifierCompteTiers(tenantId, v.compte_tiers, transaction);
  const dc = await doublonCompte(tenantId, v.compte_tiers, null, transaction);
  if (dc) throw new ErreurRegistre(409, `Le compte tiers ${v.compte_tiers} est déjà attribué à ${dc.nom}.`);
  const verifie = Boolean(body.verifie);
  const [row] = await Q(
    `INSERT INTO registre_tiers (tenant_id, type, nui, nom, rccm, telephone, email, adresse, notes, compte_tiers, verifie, verifie_par, verifie_le, cree_par)
     VALUES (:t, :type, :nui, :nom, :rccm, :telephone, :email, :adresse, :notes, :compte_tiers, :verifie, :vpar, CASE WHEN :verifie THEN NOW() END, :u)
     RETURNING id`,
    { t: tenantId, ...v, verifie, vpar: verifie ? userId : null, u: userId }, { transaction });
  await auditer(transaction, { tenantId, userId, action: 'REGISTRE_TIERS_CREATION', id: row.id, apres: { ...v, verifie } });
  return Number(row.id);
};

const creer = async ({ tenantId, userId, body }) => {
  exigerClient(tenantId);
  const id = await sequelize.transaction((transaction) => creerDans(transaction, { tenantId, userId, body }));
  return (await lister(tenantId, { actifs: '0' })).find((x) => x.id === id);
};

const modifier = async ({ tenantId, userId, id, body }) => {
  exigerClient(tenantId);
  const tid = parseInt(id, 10);
  if (!Number.isInteger(tid)) throw new ErreurRegistre(400, 'Tiers invalide.');
  await sequelize.transaction(async (transaction) => {
    const [avant] = await Q('SELECT * FROM registre_tiers WHERE id = :id AND tenant_id = :t FOR UPDATE', { id: tid, t: tenantId }, { transaction });
    if (!avant) throw new ErreurRegistre(404, 'Tiers introuvable.');
    const v = valeurs({ ...avant, ...body });
    const d = await doublonNui(tenantId, v.nui, tid, transaction);
    if (d) throw new ErreurRegistre(409, `Le NUI ${v.nui} est déjà au registre (${d.nom}).`);
    if (v.compte_tiers !== normCompte(avant.compte_tiers)) await verifierCompteTiers(tenantId, v.compte_tiers, transaction);
    const dc = await doublonCompte(tenantId, v.compte_tiers, tid, transaction);
    if (dc) throw new ErreurRegistre(409, `Le compte tiers ${v.compte_tiers} est déjà attribué à ${dc.nom}.`);
    const verifie = body.verifie === undefined ? avant.verifie : Boolean(body.verifie);
    const actif = body.actif === undefined ? avant.actif : Boolean(body.actif);
    // Toute modification de l'identité (NUI, nom) d'un tiers vérifié lève la vérification,
    // sauf si elle est confirmée dans le même enregistrement.
    const identiteChange = v.nui !== normNui(avant.nui) || v.nom !== avant.nom;
    const verifieFinal = identiteChange && body.verifie === undefined ? false : verifie;
    await sequelize.query(
      `UPDATE registre_tiers SET type = :type, nui = :nui, nom = :nom, rccm = :rccm, telephone = :telephone, email = :email,
              adresse = :adresse, notes = :notes, compte_tiers = :compte_tiers, actif = :actif, verifie = :verifie,
              verifie_par = CASE WHEN :verifie AND NOT :etait THEN :u WHEN :verifie THEN verifie_par END,
              verifie_le  = CASE WHEN :verifie AND NOT :etait THEN NOW() WHEN :verifie THEN verifie_le END,
              modifie_le = NOW()
        WHERE id = :id`,
      { replacements: { ...v, actif, verifie: verifieFinal, etait: Boolean(avant.verifie) && !identiteChange, u: userId, id: tid }, transaction });
    await auditer(transaction, { tenantId, userId, action: 'REGISTRE_TIERS_MODIFICATION', id: tid,
      avant: { type: avant.type, nui: avant.nui, nom: avant.nom, compte_tiers: avant.compte_tiers, verifie: avant.verifie, actif: avant.actif },
      apres: { ...v, verifie: verifieFinal, actif } });
  });
  return (await lister(tenantId, { actifs: '0' })).find((x) => x.id === tid);
};

// Alimente le registre à partir des tiers déjà présents sur les pièces (NUI
// renseigné, absent du registre). Nom retenu : le plus fréquent pour ce NUI.
// Les tiers créés ainsi ne sont PAS marqués vérifiés.
const importerDepuisPieces = async ({ tenantId, userId }) => {
  exigerClient(tenantId);
  return sequelize.transaction(async (transaction) => {
    const candidats = await Q(
      `WITH p AS (
         SELECT ${NUI_PIECE} AS nui,
                btrim(COALESCE(NULLIF(btrim(c.tiers_nom), ''), j.beneficiaire, '')) AS nom,
                (j.sortie > 0) AS est_sortie, (j.entree > 0) AS est_entree
           FROM journal j
           LEFT JOIN controles_pieces c ON c.mouvement_id = j.id
           LEFT JOIN rubriques r ON r.tenant_id = j.tenant_id AND r.code = j.rubrique_code
          WHERE j.tenant_id = :t AND NOT j.annule AND j.annulation_de_id IS NULL
            AND NOT COALESCE(r.est_virement_interne, false))
       SELECT nui,
              (array_agg(nom ORDER BY n DESC, nom))[1] AS nom,
              bool_or(s) AS sortie, bool_or(e) AS entree
         FROM (SELECT nui, nom, COUNT(*) AS n, bool_or(est_sortie) AS s, bool_or(est_entree) AS e
                 FROM p WHERE nui <> '' AND nom <> '' GROUP BY nui, nom) x
        WHERE NOT EXISTS (SELECT 1 FROM registre_tiers t WHERE t.tenant_id = :t AND upper(btrim(t.nui)) = x.nui)
        GROUP BY nui`,
      { t: tenantId }, { transaction });
    for (const c of candidats) {
      const type = c.sortie && c.entree ? 'mixte' : (c.entree ? 'client' : 'fournisseur');
      await creerDans(transaction, { tenantId, userId, body: { type, nui: c.nui, nom: c.nom, notes: 'Repris des pièces de caisse (à vérifier).' } });
    }
    return { crees: candidats.length };
  });
};

// Tiers du registre par NUI (pour le contrôle des pièces).
const indexParNui = async (tenantId, transaction) => {
  const rows = await Q(
    `SELECT id, upper(btrim(nui)) AS nui, nom, type, verifie, compte_tiers FROM registre_tiers WHERE tenant_id = :t AND actif AND btrim(nui) <> ''`,
    { t: tenantId }, { transaction });
  return new Map(rows.map((r) => [r.nui, { ...r, id: Number(r.id) }]));
};

// Tiers du registre par identifiant (actifs ou non : une écriture ancienne
// garde son tiers même désactivé).
const indexParId = async (tenantId, transaction) => {
  const rows = await Q(
    'SELECT id, upper(btrim(nui)) AS nui, nom, type, verifie, compte_tiers, actif FROM registre_tiers WHERE tenant_id = :t',
    { t: tenantId }, { transaction });
  return new Map(rows.map((r) => [Number(r.id), { ...r, id: Number(r.id) }]));
};

// Aide à la saisie de caisse (044) : la caissière choisit un bénéficiaire et
// son NUI, son téléphone et son compte tiers se remplissent. Lecture seule,
// champs strictement utiles à la saisie.
const pourSaisie = async (tenantId, { q = '', sens = '' } = {}) => {
  exigerClient(tenantId);
  const rows = await Q(
    `SELECT id, type, upper(btrim(nui)) AS nui, nom, telephone, compte_tiers
       FROM registre_tiers
      WHERE tenant_id = :t AND actif
        AND (:sens = '' OR type = 'mixte' OR type = CASE WHEN :sens = 'entree' THEN 'client' ELSE 'fournisseur' END)
        AND (:q = '' OR lower(nom) LIKE :like OR lower(nui) LIKE :like)
      ORDER BY lower(nom) LIMIT 300`,
    { t: tenantId, q: txt(q), like: `%${txt(q).toLowerCase()}%`, sens: ['entree', 'sortie'].includes(sens) ? sens : '' });
  return rows.map((r) => ({ ...r, id: Number(r.id),
    compte_effectif: txt(r.compte_tiers) || collectifDe(r.type, sens || 'sortie'), compte_collectif: !txt(r.compte_tiers) }));
};

module.exports = {
  ErreurRegistre, TYPES, TYPE_LIB, NUI_RE, COMPTE_TIERS_RE, collectifDe,
  lister, creer, creerDans, modifier, importerDepuisPieces, indexParNui, indexParId, pourSaisie,
};
