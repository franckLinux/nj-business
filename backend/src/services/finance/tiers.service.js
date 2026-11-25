'use strict';
// NJ FINANCE — lot F4 : Clients et fournisseurs (migration 078).
//
// Un seul fichier de tiers : registre_tiers (identité, NIU, compte individuel
// « compte_tiers » qui sert de code / compte auxiliaire). NJ FINANCE y ajoute ses
// conditions financières (fin_tiers) et CALCULE le reste :
//   • relevé de compte, soldes, créances et dettes : lignes d'écritures des
//     comptes 40 (fournisseurs) et 41 (clients) qui portent le tiers ;
//   • paiements et encaissements : mouvements du journal de caisse du tiers.
// Les chiffres reposent sur les écritures VALIDÉES ; le brouillard peut être
// inclus pour une lecture provisoire. L'identité se modifie avec les mêmes
// règles que le registre (NIU unique — un format inhabituel est signalé, pas
// bloqué : tiers étrangers —, compte individuel
// unique et rattaché à un collectif du plan) ; la vérification « sur pièce »
// reste l'affaire du contrôle comptable.
const { sequelize } = require('../../models');
const registre = require('../registre_tiers.service');

const T = sequelize.QueryTypes;
const Q = (sql, replacements, opts = {}) => sequelize.query(sql, { replacements, type: T.SELECT, ...opts });
const X = (sql, replacements, opts = {}) => sequelize.query(sql, { replacements, ...opts });

class ErreurTiers extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const traduire = (err) => {
  if (err instanceof ErreurTiers) return err;
  if (err instanceof registre.ErreurRegistre) return new ErreurTiers(err.status, err.message);
  const code = err?.original?.code || err?.parent?.code;
  const msg = err?.original?.message || err?.parent?.message || '';
  const m = /^([A-Z_]+): (.*)$/s.exec(msg);
  if (code === '23514' && m) return new ErreurTiers(400, m[2]);
  if (code === '23505') return new ErreurTiers(409, 'Ce NIU ou ce compte individuel est déjà attribué à un autre tiers.');
  return err;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dateOuNull = (v, quoi) => {
  if (v === undefined || v === null || v === '') return null;
  if (!ISO.test(String(v)) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new ErreurTiers(400, `${quoi} : date invalide.`);
  return String(v);
};
const entier = (v, quoi) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ErreurTiers(400, `${quoi} invalide.`);
  return n;
};
const cts = (v) => Math.round(Number(v || 0) * 100);
const mt = (c) => (c / 100).toFixed(2);
const MODES = { '': '—', especes: 'Espèces', cheque: 'Chèque', virement: 'Virement', mobile_money: 'Mobile money', carte: 'Carte', compensation: 'Compensation' };
const SENS = { client: ['client', 'mixte'], fournisseur: ['fournisseur', 'mixte'] };

// Comptes de tiers suivis : 40 et 481 (fournisseurs, d'exploitation et
// d'investissement — lot F6) et 41 (clients).
const COMPTES_TIERS = `(l.compte LIKE '40%' OR l.compte LIKE '41%' OR l.compte LIKE '481%')`;
const FOURN = `(l.compte LIKE '40%' OR l.compte LIKE '481%')`;
const filtreStatut = (brouillard) => (brouillard ? '' : `AND e.statut = 'validee'`);

// Soldes par tiers depuis les écritures (centimes) : clients = 41 (D − C), fournisseurs = 40 (C − D).
const soldesParTiers = async (tenantId, { au = null, brouillard = false, tiersId = null } = {}) => {
  const rows = await Q(
    `SELECT l.tiers_id,
            coalesce(sum(l.debit)  FILTER (WHERE l.compte LIKE '41%'), 0) AS d41, coalesce(sum(l.credit) FILTER (WHERE l.compte LIKE '41%'), 0) AS c41,
            coalesce(sum(l.debit)  FILTER (WHERE ${FOURN}), 0) AS d40, coalesce(sum(l.credit) FILTER (WHERE ${FOURN}), 0) AS c40,
            max(e.date_ecriture)::text AS dernier
       FROM fin_ecriture_lignes l JOIN fin_ecritures e ON e.id = l.ecriture_id
      WHERE l.tenant_id = :tenantId AND l.tiers_id IS NOT NULL AND ${COMPTES_TIERS} ${filtreStatut(brouillard)}
        AND (CAST(:au AS DATE) IS NULL OR e.date_ecriture <= CAST(:au AS DATE))
        AND (CAST(:tiers AS BIGINT) IS NULL OR l.tiers_id = CAST(:tiers AS BIGINT))
      GROUP BY l.tiers_id`, { tenantId, au, tiers: tiersId });
  return new Map(rows.map((r) => [String(r.tiers_id), {
    debit_client: cts(r.d41), credit_client: cts(r.c41), creance: cts(r.d41) - cts(r.c41),
    debit_fournisseur: cts(r.d40), credit_fournisseur: cts(r.c40), dette: cts(r.c40) - cts(r.d40), dernier: r.dernier,
  }]));
};

// Mouvements de caisse du tiers (hors virements internes) : payé / encaissé.
const caisseParTiers = async (tenantId, { tiersId = null } = {}) => {
  const rows = await Q(
    `SELECT j.tiers_id, coalesce(sum(j.entree), 0) AS encaisse, coalesce(sum(j.sortie), 0) AS paye, count(*)::int AS nb,
            max(j.date)::text AS dernier
       FROM journal j LEFT JOIN rubriques r ON r.tenant_id = j.tenant_id AND r.code = j.rubrique_code
      WHERE j.tenant_id = :tenantId AND j.tiers_id IS NOT NULL AND NOT coalesce(r.est_virement_interne, false)
        AND (CAST(:tiers AS BIGINT) IS NULL OR j.tiers_id = CAST(:tiers AS BIGINT))
      GROUP BY j.tiers_id`, { tenantId, tiers: tiersId });
  return new Map(rows.map((r) => [String(r.tiers_id), { encaisse: cts(r.encaisse), paye: cts(r.paye), nb: r.nb, dernier: r.dernier }]));
};

const SELECT_FICHE = `
  SELECT t.id, t.type, t.nom, t.nui, t.rccm, t.telephone, t.email, t.adresse, t.notes, t.compte_tiers, t.verifie, t.actif,
         t.cree_le, coalesce(f.delai_paiement_jours, 30) AS delai_paiement_jours, coalesce(f.mode_reglement, '') AS mode_reglement,
         coalesce(f.observations, '') AS observations, f.modifie_le AS finance_modifie_le,
         ct.code AS code_commercial, ct.ville, ct.pays, ct.contact_nom, ct.contact_telephone, ct.contact_email, ct.conditions_paiement
    FROM registre_tiers t
    LEFT JOIN fin_tiers f ON f.tiers_id = t.id
    LEFT JOIN com_tiers ct ON ct.tiers_id = t.id`;

const enrichir = (t, s, c) => ({
  ...t,
  id: String(t.id),
  type_libelle: registre.TYPE_LIB[t.type] || t.type,
  nui_format_ok: !t.nui || registre.NUI_RE.test(t.nui),
  mode_reglement_libelle: MODES[t.mode_reglement] || t.mode_reglement,
  compte_collectif: t.compte_tiers ? t.compte_tiers.slice(0, 3) : (t.type === 'fournisseur' ? '401' : t.type === 'client' ? '411' : '401 / 411'),
  creance: mt(s?.creance || 0), dette: mt(s?.dette || 0),
  total_facture_client: mt(s?.debit_client || 0), total_regle_client: mt(s?.credit_client || 0),
  total_achats: mt(s?.credit_fournisseur || 0), total_paye_fournisseur: mt(s?.debit_fournisseur || 0),
  caisse_encaisse: mt(c?.encaisse || 0), caisse_paye: mt(c?.paye || 0), caisse_nb: c?.nb || 0,
  dernier_mouvement: [s?.dernier, c?.dernier].filter(Boolean).sort().pop() || null,
});

const lister = async (tenantId, q = {}) => {
  const sens = ['client', 'fournisseur'].includes(q.sens) ? q.sens : '';
  const rech = String(q.recherche || '').trim().toLowerCase().slice(0, 80);
  const rows = await Q(`${SELECT_FICHE} WHERE t.tenant_id = :tenantId ${q.actifs !== '0' ? 'AND t.actif' : ''} ORDER BY t.nom LIMIT 5000`, { tenantId });
  const brouillard = q.brouillard === 'true';
  const [soldes, caisse] = await Promise.all([soldesParTiers(tenantId, { brouillard }), caisseParTiers(tenantId)]);
  const tous = rows.map((t) => enrichir(t, soldes.get(String(t.id)), caisse.get(String(t.id))));
  // Indicateurs : sur tous les tiers, quels que soient l'onglet et la recherche.
  const totaux = tous.reduce((a, t) => ({
    creances: a.creances + Math.max(cts(t.creance), 0), dettes: a.dettes + Math.max(cts(t.dette), 0),
    clients: a.clients + (SENS.client.includes(t.type) ? 1 : 0), fournisseurs: a.fournisseurs + (SENS.fournisseur.includes(t.type) ? 1 : 0),
  }), { creances: 0, dettes: 0, clients: 0, fournisseurs: 0 });
  const tiers = tous.filter((t) => (!sens || SENS[sens].includes(t.type))
    && (!rech || [t.nom, t.nui, t.compte_tiers, t.telephone].some((v) => String(v || '').toLowerCase().includes(rech))));
  return { tiers, totaux: { ...totaux, creances: mt(totaux.creances), dettes: mt(totaux.dettes) }, inclut_brouillard: brouillard };
};

const lire = async (tenantId, id, q = {}) => {
  const tid = entier(id, 'Tiers');
  const [t] = await Q(`${SELECT_FICHE} WHERE t.tenant_id = :tenantId AND t.id = :tid`, { tenantId, tid });
  if (!t) throw new ErreurTiers(404, 'Client ou fournisseur introuvable.');
  const brouillard = q.brouillard === 'true';
  const [soldes, caisse] = await Promise.all([soldesParTiers(tenantId, { brouillard, tiersId: tid }), caisseParTiers(tenantId, { tiersId: tid })]);
  const [{ nb_brouillard: nbBrouillard }] = await Q(
    `SELECT count(DISTINCT e.id)::int AS nb_brouillard FROM fin_ecriture_lignes l JOIN fin_ecritures e ON e.id = l.ecriture_id
      WHERE l.tenant_id = :tenantId AND l.tiers_id = :tid AND ${COMPTES_TIERS} AND e.statut = 'brouillard'`, { tenantId, tid });
  return { ...enrichir(t, soldes.get(String(tid)), caisse.get(String(tid))), nb_ecritures_brouillard: nbBrouillard, inclut_brouillard: brouillard };
};

// Identité : mêmes règles que le registre (la vérification sur pièce n'est pas modifiable ici).
const identite = (body) => {
  const b = { ...body };
  delete b.verifie;
  return b;
};
const conditions = (body) => {
  const out = {};
  if (body.delai_paiement_jours !== undefined) {
    const n = Number(body.delai_paiement_jours);
    if (!Number.isInteger(n) || n < 0 || n > 365) throw new ErreurTiers(400, 'Délai de paiement : nombre de jours entre 0 et 365.');
    out.delai = n;
  }
  if (body.mode_reglement !== undefined) {
    if (!(body.mode_reglement in MODES)) throw new ErreurTiers(400, 'Mode de règlement invalide.');
    out.mode = body.mode_reglement;
  }
  if (body.observations !== undefined) {
    const o = String(body.observations ?? '').trim();
    if (o.length > 2000) throw new ErreurTiers(400, 'Observations : 2 000 caractères au plus.');
    out.obs = o;
  }
  return out;
};
const ecrireConditions = async (transaction, { tenantId, userId, tid, c }) => {
  await X(
    `INSERT INTO fin_tiers (tiers_id, tenant_id, delai_paiement_jours, mode_reglement, observations, modifie_par, modifie_le)
     VALUES (:tid, :tenantId, coalesce(:delai, 30), coalesce(:mode, ''), coalesce(:obs, ''), :userId, NOW())
     ON CONFLICT (tiers_id) DO UPDATE SET
       delai_paiement_jours = coalesce(:delai, fin_tiers.delai_paiement_jours),
       mode_reglement = coalesce(:mode, fin_tiers.mode_reglement),
       observations = coalesce(:obs, fin_tiers.observations),
       modifie_par = :userId, modifie_le = NOW()`,
    { tid, tenantId, userId, delai: c.delai ?? null, mode: c.mode ?? null, obs: c.obs ?? null }, { transaction });
};

// Doublon probable : même nom (casse et espaces ignorés), sans NIU pour les départager.
const doublonNom = async (tenantId, nom, sauf = null) => {
  const [d] = await Q(
    `SELECT id, nom FROM registre_tiers WHERE tenant_id = :tenantId AND lower(regexp_replace(btrim(nom), '\\s+', ' ', 'g')) = :n
       AND (CAST(:sauf AS BIGINT) IS NULL OR id <> CAST(:sauf AS BIGINT)) LIMIT 1`,
    { tenantId, n: String(nom || '').trim().replace(/\s+/g, ' ').toLowerCase(), sauf });
  return d || null;
};

const creer = async ({ tenantId, userId, body }) => {
  if (!['client', 'fournisseur', 'mixte'].includes(body.type)) throw new ErreurTiers(400, 'Précisez s\'il s\'agit d\'un client, d\'un fournisseur ou des deux.');
  const c = conditions(body);
  if (!body.confirmer_doublon) {
    const d = await doublonNom(tenantId, body.nom);
    if (d) throw Object.assign(new ErreurTiers(409, `Un tiers porte déjà ce nom (${d.nom}). Ouvrez sa fiche, ou confirmez qu'il s'agit d'un autre tiers.`), { doublon: { id: String(d.id), nom: d.nom } });
  }
  try {
    const tid = await sequelize.transaction(async (transaction) => {
      const id = await registre.creerDans(transaction, { tenantId, userId, body: identite(body) });
      await ecrireConditions(transaction, { tenantId, userId, tid: id, c });
      return id;
    });
    return lire(tenantId, tid);
  } catch (err) { throw traduire(err); }
};

const modifier = async ({ tenantId, userId, id, body }) => {
  const tid = entier(id, 'Tiers');
  const c = conditions(body);
  const champsIdentite = ['type', 'nom', 'nui', 'rccm', 'telephone', 'email', 'adresse', 'notes', 'compte_tiers', 'actif'];
  try {
    if (champsIdentite.some((k) => body[k] !== undefined)) {
      await registre.modifier({ tenantId, userId, id: tid, body: identite(Object.fromEntries(champsIdentite.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]))) });
    } else {
      const [t] = await Q('SELECT id FROM registre_tiers WHERE id = :tid AND tenant_id = :tenantId', { tid, tenantId });
      if (!t) throw new ErreurTiers(404, 'Client ou fournisseur introuvable.');
    }
    if (Object.keys(c).length) await sequelize.transaction((transaction) => ecrireConditions(transaction, { tenantId, userId, tid, c }));
    return lire(tenantId, tid);
  } catch (err) { throw traduire(err); }
};

// Relevé de compte : lignes 40/41 du tiers, report au début de la période, solde progressif.
// Solde affiché dans le sens du tiers : client = ce qu'il nous doit, fournisseur = ce que nous lui devons.
const releve = async (tenantId, id, q = {}) => {
  const tid = entier(id, 'Tiers');
  const [t] = await Q('SELECT id, type, nom FROM registre_tiers WHERE id = :tid AND tenant_id = :tenantId', { tid, tenantId });
  if (!t) throw new ErreurTiers(404, 'Client ou fournisseur introuvable.');
  const du = dateOuNull(q.date_du, 'Date de début');
  const au = dateOuNull(q.date_au, 'Date de fin');
  const brouillard = q.brouillard === 'true';
  const sensSolde = t.type === 'fournisseur' ? -1 : 1;   // D − C pour un client ou un tiers mixte, C − D pour un fournisseur
  const [rep] = await Q(
    `SELECT coalesce(sum(l.debit), 0) AS d, coalesce(sum(l.credit), 0) AS c
       FROM fin_ecriture_lignes l JOIN fin_ecritures e ON e.id = l.ecriture_id
      WHERE l.tenant_id = :tenantId AND l.tiers_id = :tid AND ${COMPTES_TIERS} ${filtreStatut(brouillard)}
        AND CAST(:du AS DATE) IS NOT NULL AND e.date_ecriture < CAST(:du AS DATE)`, { tenantId, tid, du });
  const lignes = await Q(
    `SELECT e.id AS ecriture_id, e.date_ecriture::text AS date, e.reference_piece, e.statut, e.origine_type,
            coalesce(nullif(l.libelle, ''), e.libelle) AS libelle, l.compte, l.debit, l.credit, l.echeance::text AS echeance,
            j.code AS journal_code, x.code AS exercice_code, e.numero
       FROM fin_ecriture_lignes l JOIN fin_ecritures e ON e.id = l.ecriture_id
       JOIN fin_journaux j ON j.id = e.journal_id JOIN fin_exercices x ON x.id = e.exercice_id
      WHERE l.tenant_id = :tenantId AND l.tiers_id = :tid AND ${COMPTES_TIERS} ${filtreStatut(brouillard)}
        AND (CAST(:du AS DATE) IS NULL OR e.date_ecriture >= CAST(:du AS DATE))
        AND (CAST(:au AS DATE) IS NULL OR e.date_ecriture <= CAST(:au AS DATE))
      ORDER BY e.date_ecriture, e.id, l.ordre LIMIT 5000`, { tenantId, tid, du, au });
  let solde = sensSolde * (cts(rep.d) - cts(rep.c));
  const report = solde;
  let td = 0; let tc = 0;
  const out = lignes.map((l) => {
    td += cts(l.debit); tc += cts(l.credit);
    solde += sensSolde * (cts(l.debit) - cts(l.credit));
    return {
      ...l, numero_affiche: l.numero ? `${l.journal_code}-${l.exercice_code}-${String(l.numero).padStart(5, '0')}` : null,
      solde: mt(solde),
    };
  });
  return {
    tiers: { id: String(t.id), nom: t.nom, type: t.type }, sens: t.type === 'fournisseur' ? 'dette' : 'creance',
    date_du: du, date_au: au, inclut_brouillard: brouillard,
    report: mt(report), total_debit: mt(td), total_credit: mt(tc), solde: mt(solde), lignes: out,
  };
};

// Mouvements de caisse du tiers (payé / encaissé), les plus récents d'abord.
const mouvementsCaisse = async (tenantId, id, q = {}) => {
  const tid = entier(id, 'Tiers');
  const [t] = await Q('SELECT id FROM registre_tiers WHERE id = :tid AND tenant_id = :tenantId', { tid, tenantId });
  if (!t) throw new ErreurTiers(404, 'Client ou fournisseur introuvable.');
  const du = dateOuNull(q.date_du, 'Date de début');
  const au = dateOuNull(q.date_au, 'Date de fin');
  return Q(
    `SELECT j.id, j.date::text AS date, j.numero, jo.code AS journal_code, j.rubrique_code, r.intitule AS rubrique,
            j.intitule, j.objet, coalesce(j.entree, 0) AS entree, coalesce(j.sortie, 0) AS sortie, j.annule,
            (j.annulation_de_id IS NOT NULL) AS contre_passation, a.nom AS activite
       FROM journal j
       LEFT JOIN journaux jo ON jo.id = j.journal_id
       LEFT JOIN rubriques r ON r.tenant_id = j.tenant_id AND r.code = j.rubrique_code
       LEFT JOIN activites a ON a.id = j.activite_id
      WHERE j.tenant_id = :tenantId AND j.tiers_id = :tid
        AND (CAST(:du AS DATE) IS NULL OR j.date >= CAST(:du AS DATE))
        AND (CAST(:au AS DATE) IS NULL OR j.date <= CAST(:au AS DATE))
      ORDER BY j.date DESC, j.id DESC LIMIT 1000`, { tenantId, tid, du, au });
};

// État des créances clients ou des dettes fournisseurs à une date (balance auxiliaire).
const etat = async (tenantId, sens, q = {}) => {
  if (!['client', 'fournisseur'].includes(sens)) throw new ErreurTiers(400, 'État inconnu.');
  const au = dateOuNull(q.date_au, 'Date') || new Date().toISOString().slice(0, 10);
  const brouillard = q.brouillard === 'true';
  const soldes = await soldesParTiers(tenantId, { au, brouillard });
  const ids = [...soldes.entries()].filter(([, s]) => (sens === 'client' ? s.debit_client || s.credit_client : s.debit_fournisseur || s.credit_fournisseur)).map(([k]) => k);
  const tiers = ids.length ? await Q(`${SELECT_FICHE} WHERE t.tenant_id = :tenantId AND t.id IN (:ids)`, { tenantId, ids }) : [];
  const lignes = tiers.map((t) => {
    const s = soldes.get(String(t.id));
    const debit = sens === 'client' ? s.debit_client : s.debit_fournisseur;
    const credit = sens === 'client' ? s.credit_client : s.credit_fournisseur;
    const solde = sens === 'client' ? s.creance : s.dette;
    return { id: String(t.id), nom: t.nom, nui: t.nui, compte_tiers: t.compte_tiers, telephone: t.telephone,
      delai_paiement_jours: t.delai_paiement_jours, dernier: s.dernier, debit: mt(debit), credit: mt(credit), solde: mt(solde), _s: solde };
  }).sort((a, b) => b._s - a._s);
  const total = lignes.reduce((a, l) => a + Math.max(l._s, 0), 0);
  const avances = lignes.reduce((a, l) => a + Math.min(l._s, 0), 0);
  const [{ nb }] = await Q(`SELECT count(*)::int AS nb FROM fin_ecritures WHERE tenant_id = :tenantId AND statut = 'brouillard'`, { tenantId });
  return {
    sens, date_au: au, inclut_brouillard: brouillard, nb_brouillard: nb,
    total: mt(total), avances: mt(-avances), lignes: lignes.map(({ _s, ...l }) => l),
  };
};

module.exports = { ErreurTiers, traduire, MODES, lister, lire, creer, modifier, releve, mouvementsCaisse, etat };
