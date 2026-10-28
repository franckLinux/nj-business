'use strict';
// Contrôle comptable des opérations (migrations 042-044) — menu « Contrôle
// comptable » → « Rapport » (044 : le rapport est le seul point d'accès).
//
// Contrôle COMPTABLE, pas documentaire (044) : tiers, compte tiers, code
// comptable, observation, statut. Aucune vérification des justificatifs.
//
// Règles :
//  • Lecture seule sur les écritures : la table journal (montants, tiers
//    saisis par la caissière) n'est jamais modifiée ; la passerelle non plus.
//  • Le tiers retenu = celui du contrôle s'il a été saisi, sinon celui de la
//    pièce (prérempli).
//  • Le compte de la pièce = compte VALIDÉ dans la passerelle pour sa
//    rubrique (compte des virements pour un virement interne). Aucun compte
//    n'est inventé : sinon anomalie « compte manquant / non validé ».
//  • Les anomalies sont recalculées à chaque lecture. Le statut, lui, ne
//    change que sur une action explicite : « Contrôlé » est refusé tant
//    qu'une anomalie n'est pas expliquée par une observation ; « Anomalie
//    détectée » exige une observation. L'observation est toujours saisie à la
//    main : aucun texte n'est généré.
//  • Correction du code comptable (044, permission controle.compte) : le
//    compte corrigé remplace, pour CETTE opération, le compte de la rubrique
//    (passerelle comprise) tant qu'elle n'est pas transmise. Mêmes règles que
//    la passerelle : compte du plan, actif, de détail, sens cohérent. Après
//    transmission : annulation / contre-passation, jamais de modification.
//  • Régularité formelle (045) : anomalies constatées saisies à la main
//    (controles_anomalies), « bloquantes » ou non ; « Confirmer la
//    validation » passe la pièce « Validée » (date + validateur). Bloquent
//    la validation (décision du 24/10/2026) : une anomalie saisie bloquante
//    non levée, un code comptable manquant, un tiers non identifié (hors
//    virement interne). Les autres points relevés sont seulement signalés,
//    sans exiger d'observation. Une pièce validée est
//    verrouillée ; la réouverture exige la permission controle.reouvrir et un
//    motif. Tout est tracé dans audit_log. Aucune de ces actions ne touche au
//    journal, à l'arrêté de caisse, aux exports ni à la passerelle.
const { sequelize } = require('../models');
const registre = require('./registre_tiers.service');
const passerelle = require('./passerelle.service');

const T = sequelize.QueryTypes;
const Q = (sql, replacements, opts = {}) => sequelize.query(sql, { replacements, type: T.SELECT, ...opts });

class ErreurControle extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

const STATUTS = ['a_controler', 'en_cours', 'controle', 'anomalie'];
const STATUT_LIB = { a_controler: 'À contrôler', en_cours: 'En cours', controle: 'Validée', anomalie: 'Anomalies constatées' };
// Anomalies automatiques qui empêchent la validation (règle 045) : une
// écriture sans compte ne peut pas être régulière en la forme.
// Points automatiques qui bloquent la validation (24/10/2026).
const AUTO_BLOQUANTES = ['compte_manquant', 'nom_manquant'];
const LIB_BLOQUANT = { compte_manquant: 'Code comptable manquant', nom_manquant: 'Tiers non identifié (nom du fournisseur / client manquant)' };
const ANOMALIES = {
  nui_manquant: 'NUI manquant',
  nui_format: 'NUI au format inhabituel',
  nom_manquant: 'Nom du tiers manquant',
  tiers_incoherent: 'Même NUI rattaché à des noms différents',
  compte_manquant: 'Code comptable manquant',
  compte_non_valide: 'Compte non validé dans la passerelle',
  tresorerie_manquante: 'Compte de trésorerie du journal manquant',
  // Registre des tiers (043)
  nom_different_registre: 'Nom différent de celui du registre',
  tiers_hors_registre: 'Tiers absent du registre',
};
const MAX_LIGNES = 3000;
const MAX_JOURS = 370;

const txt = (v) => String(v ?? '').trim();
const normNui = (v) => txt(v).toUpperCase().replace(/\s+/g, '');
const normNom = (v) => txt(v).toLowerCase().replace(/\s+/g, ' ');
// NUI camerounais : une lettre, 12 chiffres, une lettre (ex. M050000123456P).
const NUI_RE = /^[A-Z]\d{12}[A-Z]$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const exigerClient = (tenantId) => {
  if (!tenantId) throw new ErreurControle(400, 'Choisissez d\'abord un client.');
};

// Index NUI → ensemble de noms (tiers retenus de toutes les pièces du client),
// pour détecter un même NUI rattaché à des noms différents.
const indexTiers = async (tenantId, { sauf = null, transaction } = {}) => {
  const rows = await Q(
    `SELECT upper(regexp_replace(COALESCE(NULLIF(btrim(c.tiers_nui), ''), j.nui, ''), '\\s+', '', 'g')) AS nui,
            lower(regexp_replace(btrim(COALESCE(NULLIF(btrim(c.tiers_nom), ''), j.beneficiaire, '')), '\\s+', ' ', 'g')) AS nom
       FROM journal j
       LEFT JOIN controles_pieces c ON c.mouvement_id = j.id
      WHERE j.tenant_id = :t AND NOT j.annule AND j.annulation_de_id IS NULL
        AND (CAST(:sauf AS BIGINT) IS NULL OR j.id <> CAST(:sauf AS BIGINT))
      GROUP BY 1, 2`,
    { t: tenantId, sauf }, { transaction });
  const idx = new Map();
  for (const r of rows) {
    if (!r.nui || !r.nom) continue;
    if (!idx.has(r.nui)) idx.set(r.nui, new Set());
    idx.get(r.nui).add(r.nom);
  }
  return idx;
};

const contexte = async (tenantId, { sauf = null, transaction } = {}) => {
  const [compteVirements, idx, reg, regId] = await Promise.all([
    compteVirementsDe(tenantId, transaction), indexTiers(tenantId, { sauf, transaction }),
    registre.indexParNui(tenantId, transaction), registre.indexParId(tenantId, transaction),
  ]);
  return { compteVirements, idx, registre: reg, registreId: regId };
};

const normCompte = (v) => txt(v).toUpperCase().replace(/\s+/g, '');

const SELECT_PIECES = `
  SELECT j.id, j.date::text AS date, j.numero, j.mois, j.annee, j.journal_id,
         jo.code AS journal_code, jo.nom AS journal_nom, COALESCE(jo.compte_tresorerie, '') AS compte_tresorerie,
         j.rubrique_code, r.intitule AS rubrique_intitule, COALESCE(r.est_virement_interne, false) AS virement,
         COALESCE(r.code_comptable, '') AS compte_rubrique, v.compte AS compte_valide, r.type AS rubrique_type,
         j.intitule, COALESCE(j.objet, '') AS objet,
         COALESCE(j.beneficiaire, '') AS beneficiaire_saisi, COALESCE(j.nui, '') AS nui_saisi,
         j.entree, j.sortie, COALESCE(j.exporte_sage, false) AS exporte,
         j.annule, j.annulation_de_id,
         c.id AS controle_id, c.tiers_nui, c.tiers_nom, COALESCE(c.observation, '') AS observation,
         COALESCE(c.statut, 'a_controler') AS statut, c.modifie_le, um.username AS modifie_par,
         c.controle_le, uc.username AS controle_par,
         c.tiers_id, j.tiers_id AS tiers_saisie_id,
         COALESCE(c.compte_corrige, '') AS compte_corrige, c.compte_corrige_le, ucc.username AS compte_corrige_par,
         c.rouvert_le, uro.username AS rouvert_par, COALESCE(c.motif_reouverture, '') AS motif_reouverture,
         an.liste AS anomalies_saisies
    FROM journal j
    LEFT JOIN journaux jo ON jo.id = j.journal_id AND jo.tenant_id = j.tenant_id
    LEFT JOIN rubriques r ON r.tenant_id = j.tenant_id AND r.code = j.rubrique_code
    LEFT JOIN equivalences_comptables v ON v.rubrique_id = r.id AND v.statut = 'valide'
    LEFT JOIN controles_pieces c ON c.mouvement_id = j.id
    LEFT JOIN users um ON um.id = c.modifie_par
    LEFT JOIN users uc ON uc.id = c.controle_par
    LEFT JOIN users ucc ON ucc.id = c.compte_corrige_par
    LEFT JOIN users uro ON uro.id = c.rouvert_par
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object(
               'id', a.id, 'libelle', a.libelle, 'bloquante', a.bloquante, 'statut', a.statut,
               'cree_par', ua.username, 'cree_le', a.cree_le, 'modifie_le', a.modifie_le,
               'levee_par', ul.username, 'levee_le', a.levee_le, 'motif_levee', a.motif_levee) ORDER BY a.id) AS liste
        FROM controles_anomalies a
        LEFT JOIN users ua ON ua.id = a.cree_par
        LEFT JOIN users ul ON ul.id = a.levee_par
       WHERE a.mouvement_id = j.id) an ON true`;

// Compte de la rubrique (sans correction) : validé dans la passerelle, sinon
// code saisi sur la rubrique (non validé) ; compte des virements pour un virement.
const compteRubrique = (r, compteVirements) => {
  if (r.virement) { const c = txt(compteVirements); return { compte: c, etat: c ? 'valide' : 'manquant' }; }
  if (txt(r.compte_valide)) return { compte: txt(r.compte_valide), etat: 'valide' };
  if (txt(r.compte_rubrique)) return { compte: txt(r.compte_rubrique), etat: 'non_valide' };
  return { compte: '', etat: 'manquant' };
};

// Tiers du registre de l'opération : celui retenu au contrôle, sinon celui
// rattaché à la saisie (044), sinon celui de même NUI.
const ficheDe = (r, nui, { registre: reg = new Map(), registreId = new Map() }) => (
  (r.tiers_id && registreId.get(Number(r.tiers_id)))
  || (r.tiers_saisie_id && registreId.get(Number(r.tiers_saisie_id)))
  || (nui ? reg.get(nui) : null) || null);

// Pièce « présentée » : tiers retenu, comptes, débit/crédit, anomalies.
const presenter = (r, ctx) => {
  const { compteVirements, idx } = ctx;
  const nui = normNui(r.tiers_nui ?? '') || normNui(r.nui_saisi);
  const nom = txt(r.tiers_nom ?? '') || txt(r.beneficiaire_saisi);
  const entree = parseFloat(r.entree) || 0;
  const sortie = parseFloat(r.sortie) || 0;
  const sens = sortie > 0 || entree < 0 ? 'sortie' : 'entree';

  const origine = compteRubrique(r, compteVirements);
  const corrige = r.virement ? '' : normCompte(r.compte_corrige);
  const compte = corrige || origine.compte;
  const compteEtat = corrige ? 'corrige' : origine.etat;

  const fiche = r.virement ? null : ficheDe(r, nui, ctx);
  const anomalies = [];
  if (!r.virement) {
    if (!nui) anomalies.push('nui_manquant');
    else if (!NUI_RE.test(nui)) anomalies.push('nui_format');
    if (!nom) anomalies.push('nom_manquant');
    if (fiche) {
      // Le registre fait foi pour le nom du tiers.
      if (nom && normNom(nom) !== normNom(fiche.nom)) anomalies.push('nom_different_registre');
    } else if (nui && nom) {
      const noms = new Set(idx.get(nui) || []);
      noms.add(normNom(nom));
      if (noms.size > 1) anomalies.push('tiers_incoherent');
    }
    if (nui && !fiche) anomalies.push('tiers_hors_registre');
  }
  if (compteEtat === 'manquant') anomalies.push('compte_manquant');
  if (compteEtat === 'non_valide') anomalies.push('compte_non_valide');
  if (r.journal_id && !txt(r.compte_tresorerie)) anomalies.push('tresorerie_manquante');
  const saisies = lireSaisies(r.anomalies_saisies);
  const bloquants = pointsBloquants(anomalies, saisies);

  return {
    id: Number(r.id),
    date: r.date,
    numero: r.numero,
    reference: `${r.journal_code || '—'}-${r.numero ?? '?'}`,
    journal_id: r.journal_id,
    journal_code: r.journal_code || '',
    journal_nom: r.journal_nom || '',
    rubrique_code: r.rubrique_code,
    rubrique_intitule: r.rubrique_intitule || '',
    virement: Boolean(r.virement),
    // Code comptable retenu (corrigé s'il y a lieu) et compte de la rubrique.
    compte, compte_etat: compteEtat,
    compte_rubrique: origine.compte, compte_rubrique_etat: origine.etat,
    compte_corrige: corrige || '',
    compte_corrige_par: corrige ? (r.compte_corrige_par || null) : null,
    compte_corrige_le: corrige ? (r.compte_corrige_le || null) : null,
    compte_tresorerie: txt(r.compte_tresorerie),
    libelle: [r.intitule, r.objet].filter((x) => txt(x)).join(' — '),
    // Vue du compte de la rubrique : sortie = débit (charge), entrée = crédit.
    debit: sortie, credit: entree,
    tiers_nui: nui, tiers_nom: nom,
    registre: fiche ? { id: fiche.id, nom: fiche.nom, type: fiche.type, verifie: Boolean(fiche.verifie) } : null,
    // Compte tiers (044) : celui du registre, sinon le collectif (401 / 411).
    compte_tiers: fiche ? (txt(fiche.compte_tiers) || registre.collectifDe(fiche.type, sens)) : '',
    compte_tiers_source: fiche ? (txt(fiche.compte_tiers) ? 'registre' : 'collectif') : '',
    tiers_saisi: { nui: txt(r.nui_saisi), nom: txt(r.beneficiaire_saisi) },
    tiers_modifie: r.controle_id != null && (normNui(r.tiers_nui) !== normNui(r.nui_saisi) || txt(r.tiers_nom) !== txt(r.beneficiaire_saisi)),
    observation: r.observation,
    statut: r.statut,
    statut_libelle: STATUT_LIB[r.statut] || r.statut,
    anomalies,
    anomalies_libelles: anomalies.map((a) => ANOMALIES[a]),
    // Régularité formelle (045) : anomalies constatées à la main, points
    // bloquants et possibilité de valider.
    anomalies_saisies: saisies,
    nb_anomalies_ouvertes: saisies.filter((a) => a.statut === 'ouverte').length,
    bloquants,
    validable: r.statut !== 'controle' && bloquants.length === 0,
    exporte: Boolean(r.exporte),
    modifie_par: r.modifie_par || null, modifie_le: r.modifie_le || null,
    controle_par: r.controle_par || null, controle_le: r.controle_le || null,
    reouverture: r.rouvert_le ? { par: r.rouvert_par || null, le: r.rouvert_le, motif: r.motif_reouverture || '' } : null,
  };
};

// Anomalies saisies (JSON agrégé) → liste propre.
const lireSaisies = (v) => {
  const l = typeof v === 'string' ? JSON.parse(v) : (v || []);
  return l.map((a) => ({ ...a, id: Number(a.id), bloquante: Boolean(a.bloquante) }));
};
// Points qui empêchent la validation : anomalies saisies bloquantes encore
// ouvertes, code comptable manquant, tiers non identifié.
const pointsBloquants = (anomalies, saisies) => [
  ...anomalies.filter((a) => AUTO_BLOQUANTES.includes(a)).map((a) => LIB_BLOQUANT[a] || ANOMALIES[a]),
  ...saisies.filter((a) => a.statut === 'ouverte' && a.bloquante).map((a) => `Anomalie bloquante : ${a.libelle}`),
];

const compteVirementsDe = async (tenantId, transaction) => {
  const [t] = await Q('SELECT COALESCE(compte_virements, \'\') AS c FROM tenants WHERE id = :t', { t: tenantId }, { transaction });
  return t ? t.c : '';
};

// ── Liste / rapport ──────────────────────────────────────────────────────────
const lister = async (tenantId, f = {}) => {
  exigerClient(tenantId);
  const du = txt(f.du); const au = txt(f.au);
  if (!DATE_RE.test(du) || !DATE_RE.test(au)) throw new ErreurControle(400, 'Période invalide : dates « du » et « au » requises (AAAA-MM-JJ).');
  if (du > au) throw new ErreurControle(400, 'La date de début est postérieure à la date de fin.');
  if ((new Date(au) - new Date(du)) / 86400000 > MAX_JOURS) throw new ErreurControle(400, 'Période trop longue : un an au plus.');
  if (f.statut && !STATUTS.includes(f.statut)) throw new ErreurControle(400, 'Statut inconnu.');
  const jid = f.journal_id ? parseInt(f.journal_id, 10) : null;
  if (f.journal_id && !Number.isInteger(jid)) throw new ErreurControle(400, 'Journal invalide.');

  const [rows, ctx] = await Promise.all([
    Q(`${SELECT_PIECES}
        WHERE j.tenant_id = :t AND NOT j.annule AND j.annulation_de_id IS NULL
          AND j.date BETWEEN CAST(:du AS DATE) AND CAST(:au AS DATE)
          AND (CAST(:jid AS INTEGER) IS NULL OR j.journal_id = CAST(:jid AS INTEGER))
        ORDER BY j.date, jo.code NULLS LAST, j.numero
        LIMIT ${MAX_LIGNES + 1}`, { t: tenantId, du, au, jid }),
    contexte(tenantId),
  ]);
  const tronque = rows.length > MAX_LIGNES;
  let lignes = rows.slice(0, MAX_LIGNES).map((r) => presenter(r, ctx));

  // Filtres calculés (statut effectif, anomalies, tiers, recherche libre).
  const tiers = normNom(f.tiers);
  const q = normNom(f.q);
  const ref = normNom(f.ref);   // référence de pièce (045)
  lignes = lignes.filter((l) => {
    if (f.statut && l.statut !== f.statut) return false;
    if (ref && !l.reference.toLowerCase().includes(ref)) return false;
    if (f.anomalies === '1' && l.anomalies.length === 0) return false;
    if (f.anomalies === '0' && l.anomalies.length > 0) return false;
    if (tiers && !(`${normNom(l.tiers_nom)} ${l.tiers_nui.toLowerCase()} ${normNom(l.registre?.nom)}`).includes(tiers)) return false;
    if (q && !(`${l.reference} ${l.libelle} ${l.tiers_nom} ${l.tiers_nui} ${l.compte} ${l.compte_tiers} ${l.observation} ${l.rubrique_code}`.toLowerCase()).includes(q)) return false;
    return true;
  });

  const resume = { total: lignes.length, par_statut: {}, par_anomalie: {}, avec_anomalies: 0, debit: 0, credit: 0 };
  for (const s of STATUTS) resume.par_statut[s] = 0;
  for (const l of lignes) {
    resume.par_statut[l.statut] += 1;
    if (l.anomalies.length) resume.avec_anomalies += 1;
    for (const a of l.anomalies) resume.par_anomalie[a] = (resume.par_anomalie[a] || 0) + 1;
    resume.debit += l.debit; resume.credit += l.credit;
  }
  return { du, au, journal_id: jid, lignes, resume, tronque, max_lignes: MAX_LIGNES, statuts: STATUT_LIB, anomalies: ANOMALIES };
};

// ── Règles de validation (045) ───────────────────────────────────────────────
const dateFr = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '');
// Une pièce validée est verrouillée : il faut la rouvrir pour la modifier.
const exigerNonValidee = (row) => {
  if (row.statut === 'controle') {
    throw new ErreurControle(409,
      `Pièce validée${row.controle_par ? ` par ${row.controle_par}` : ''}${row.controle_le ? ` le ${dateFr(row.controle_le)}` : ''} : rouvrez-la (motif obligatoire) pour la modifier.`,
      { code: 'PIECE_VALIDEE' });
  }
};
// Validation : aucun point bloquant. Les autres points relevés (NUI,
// registre, compte non validé, trésorerie…) sont signalés sans bloquer ni
// exiger d'observation (décision du 24/10/2026).
const exigerValidable = (p) => {
  if (p.bloquants.length) {
    throw new ErreurControle(409, `Validation impossible : ${p.bloquants.join(' ; ')}. Corrigez ou levez ces points avant de confirmer la validation.`,
      { bloquants: p.bloquants });
  }
};

// ── Enregistrement du contrôle d'une pièce ───────────────────────────────────
// droits = { saisir, compte } : controle.saisir (tiers, observation, statut)
// et controle.compte (correction du code comptable). Un champ hors droits
// n'est pas modifiable : la valeur enregistrée est conservée.
const enregistrer = async ({ tenantId, userId, mouvementId, body, droits = { saisir: true, compte: false } }) => {
  exigerClient(tenantId);
  const id = parseInt(mouvementId, 10);
  if (!Number.isInteger(id) || id <= 0) throw new ErreurControle(400, 'Pièce invalide.');

  return sequelize.transaction(async (transaction) => {
    const [row] = await Q(`${SELECT_PIECES} WHERE j.tenant_id = :t AND j.id = :id FOR UPDATE OF j`,
      { t: tenantId, id }, { transaction });
    if (!row) throw new ErreurControle(404, 'Pièce introuvable pour ce client.');
    if (row.annulation_de_id || row.annule) throw new ErreurControle(409, 'Pièce annulée : elle n\'est pas soumise au contrôle.');
    exigerNonValidee(row);

    // Valeurs reçues, ou valeurs enregistrées pour ce que l'utilisateur ne peut pas modifier.
    const garde = !droits.saisir;
    let nui = garde ? normNui(row.tiers_nui ?? '') : normNui(body.tiers_nui);
    let nom = garde ? txt(row.tiers_nom ?? '') : txt(body.tiers_nom).replace(/\s+/g, ' ');
    const observation = garde ? txt(row.observation) : txt(body.observation);
    let statut = garde ? row.statut : (body.statut ? String(body.statut) : 'en_cours');
    if (!STATUTS.includes(statut)) throw new ErreurControle(400, 'Statut inconnu.');
    // Statut cohérent avec les anomalies constatées encore ouvertes (045).
    if (['a_controler', 'en_cours'].includes(statut) && lireSaisies(row.anomalies_saisies).some((a) => a.statut === 'ouverte')) statut = 'anomalie';
    if (nui.length > 30) throw new ErreurControle(400, 'NUI trop long (30 caractères au plus).');
    if (nom.length > 200) throw new ErreurControle(400, 'Nom du tiers trop long (200 caractères au plus).');
    if (observation.length > 2000) throw new ErreurControle(400, 'Observation trop longue (2 000 caractères au plus).');

    const ctx = await contexte(tenantId, { sauf: id, transaction });

    // ── Code comptable de l'opération ──
    const origine = compteRubrique(row, ctx.compteVirements);
    const ancienCorrige = normCompte(row.compte_corrige);
    let corrige = ancienCorrige;
    let avertissement = null;
    if (body.compte_corrige !== undefined) {
      let demande = normCompte(body.compte_corrige);
      // Revenir au compte de la rubrique = pas de correction.
      if (demande && origine.etat === 'valide' && demande === normCompte(origine.compte)) demande = '';
      if (demande !== ancienCorrige) {
        if (!droits.compte) throw new ErreurControle(403, 'Permission requise : corriger le code comptable d\'une opération.');
        if (row.virement) throw new ErreurControle(409, 'Virement entre caisses : son compte (virements internes) se règle dans la passerelle comptable (Contrôle comptable → Contrôle de régularité formelle).');
        if (row.exporte) {
          throw new ErreurControle(409, `L'opération ${row.journal_code || '—'}-${row.numero ?? '?'} est déjà transmise à la comptabilité : son compte ne se modifie plus. Demandez son annulation (contre-passation) puis faites-la ressaisir sur la bonne rubrique.`);
        }
        if (demande) {
          try {
            await passerelle.verifierCompte(tenantId, demande, { transaction });
            await passerelle.exigerCompteDetail(tenantId, demande, transaction);
          } catch (err) {
            if (err instanceof passerelle.ErreurMetier) throw new ErreurControle(err.status, err.message);
            throw err;
          }
          const sens = passerelle.coherenceSens(row.rubrique_type || ((parseFloat(row.sortie) || 0) > 0 ? 'depense' : 'entree'), demande);
          if (sens.bloquant) throw new ErreurControle(400, sens.bloquant.replace('Une rubrique de', 'Une opération de').replace('Une rubrique d\'', 'Une opération d\''));
          avertissement = sens.avertissement || null;
        }
        corrige = demande;
      }
    }

    // Tiers choisi dans le registre : il complète le NUI et le nom laissés vides.
    let tiersId = garde ? (row.tiers_id ? Number(row.tiers_id) : null) : null;
    if (!garde && body.tiers_id) {
      const [f] = await Q('SELECT id, nui, nom FROM registre_tiers WHERE id = :id AND tenant_id = :t AND actif',
        { id: parseInt(body.tiers_id, 10) || 0, t: tenantId }, { transaction });
      if (!f) throw new ErreurControle(400, 'Tiers du registre introuvable.');
      tiersId = Number(f.id);
      if (!nui) nui = normNui(f.nui);
      if (!nom) nom = f.nom;
    }
    const nuiRetenu = nui || normNui(row.nui_saisi);
    const nomRetenu = nom || txt(row.beneficiaire_saisi);
    let fiche = nuiRetenu ? ctx.registre.get(nuiRetenu) : null;
    if (!tiersId && fiche) tiersId = fiche.id;
    // « Ajouter au registre » : le tiers de la pièce devient une fiche du registre.
    if (!garde && body.ajouter_registre && !fiche && !tiersId && !row.virement) {
      if (!nomRetenu) throw new ErreurControle(400, 'Indiquez le nom du tiers pour l\'ajouter au registre.');
      const type = (parseFloat(row.entree) || 0) > 0 ? 'client' : 'fournisseur';
      try {
        tiersId = await registre.creerDans(transaction, { tenantId, userId, body: { type, nui: nuiRetenu, nom: nomRetenu } });
      } catch (err) {
        if (err instanceof registre.ErreurRegistre) throw new ErreurControle(err.status, err.message);
        throw err;
      }
      fiche = { id: tiersId, nom: nomRetenu, type, verifie: false, compte_tiers: '' };
      ctx.registreId.set(tiersId, fiche);
      if (nuiRetenu) ctx.registre.set(nuiRetenu, fiche);
    }

    // Champs vides = on revient au tiers saisi sur la pièce (prérempli).
    const apres = presenter({ ...row, controle_id: row.controle_id ?? 0, tiers_nui: nui, tiers_nom: nom, observation, statut,
      tiers_id: tiersId, compte_corrige: corrige }, ctx);

    if (statut === 'anomalie' && !observation && !apres.nb_anomalies_ouvertes) {
      throw new ErreurControle(409, 'Décrivez l\'anomalie (observation ou anomalie constatée) avant de classer la pièce « Anomalies constatées ».');
    }
    if (!garde && statut === 'controle') exigerValidable(apres, observation);

    const compteChange = corrige !== ancienCorrige;
    const avant = row.controle_id ? {
      tiers_nui: row.tiers_nui, tiers_nom: row.tiers_nom, observation: row.observation, statut: row.statut, compte_corrige: ancienCorrige,
    } : null;
    const final = ['controle', 'anomalie'].includes(statut);
    // Une décision existante est conservée si le statut ne change pas.
    const decisionInchangee = garde || (row.controle_id && statut === row.statut);
    await sequelize.query(
      `INSERT INTO controles_pieces (tenant_id, mouvement_id, tiers_nui, tiers_nom, observation, statut, anomalies,
                                     modifie_par, modifie_le, controle_par, controle_le, tiers_id,
                                     compte_corrige, compte_corrige_par, compte_corrige_le)
       VALUES (:t, :id, :nui, :nom, :obs, :statut, CAST(:anom AS TEXT[]), :u, NOW(), :cpar, CASE WHEN :final THEN NOW() END, :tiersId,
               :cc, CASE WHEN :cc <> '' THEN CAST(:u AS UUID) END, CASE WHEN :cc <> '' THEN NOW() END)
       ON CONFLICT (mouvement_id) DO UPDATE SET
         tiers_nui = EXCLUDED.tiers_nui, tiers_nom = EXCLUDED.tiers_nom, observation = EXCLUDED.observation,
         statut = EXCLUDED.statut, anomalies = EXCLUDED.anomalies, modifie_par = EXCLUDED.modifie_par, modifie_le = NOW(),
         controle_par = CASE WHEN :garderDecision THEN controles_pieces.controle_par ELSE EXCLUDED.controle_par END,
         controle_le  = CASE WHEN :garderDecision THEN controles_pieces.controle_le  ELSE EXCLUDED.controle_le END,
         tiers_id = EXCLUDED.tiers_id,
         compte_corrige     = EXCLUDED.compte_corrige,
         compte_corrige_par = CASE WHEN :ccChange THEN EXCLUDED.compte_corrige_par ELSE controles_pieces.compte_corrige_par END,
         compte_corrige_le  = CASE WHEN :ccChange THEN EXCLUDED.compte_corrige_le  ELSE controles_pieces.compte_corrige_le END`,
      { replacements: { t: tenantId, id, nui: apres.tiers_nui, nom: apres.tiers_nom, obs: observation, statut,
        anom: `{${apres.anomalies.join(',')}}`, u: userId, cpar: final ? userId : null, final, tiersId,
        cc: corrige, ccChange: compteChange, garderDecision: Boolean(decisionInchangee) }, transaction });
    await sequelize.query(
      `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, ancienne_valeur, nouvelle_valeur)
       VALUES (:t, :u, :action, 'controle_piece', :id, CAST(:av AS jsonb), CAST(:ap AS jsonb))`,
      { replacements: { t: tenantId, u: userId, id: String(id),
        action: compteChange ? 'CONTROLE_COMPTE_CORRIGE' : 'CONTROLE_PIECE',
        av: avant ? JSON.stringify({ ...avant, compte_rubrique: origine.compte }) : JSON.stringify({ compte_rubrique: origine.compte }),
        ap: JSON.stringify({ tiers_nui: apres.tiers_nui, tiers_nom: apres.tiers_nom, tiers_id: tiersId, observation, statut,
          compte_corrige: corrige, compte_retenu: apres.compte, anomalies: apres.anomalies }) }, transaction });

    const [maj] = await Q(`${SELECT_PIECES} WHERE j.tenant_id = :t AND j.id = :id`, { t: tenantId, id }, { transaction });
    return { piece: presenter(maj, ctx), avertissement, compte_modifie: compteChange };
  });
};

// ── Régularité formelle (045) ────────────────────────────────────────────────
const lirePiece = async (transaction, tenantId, id, verrou = false) => {
  const [row] = await Q(`${SELECT_PIECES} WHERE j.tenant_id = :t AND j.id = :id${verrou ? ' FOR UPDATE OF j' : ''}`,
    { t: tenantId, id }, { transaction });
  if (!row) throw new ErreurControle(404, 'Pièce introuvable pour ce client.');
  if (row.annulation_de_id || row.annule) throw new ErreurControle(409, 'Pièce annulée : elle n\'est pas soumise au contrôle.');
  return row;
};
const idPiece = (v) => {
  const id = parseInt(v, 10);
  if (!Number.isInteger(id) || id <= 0) throw new ErreurControle(400, 'Pièce invalide.');
  return id;
};
const auditPiece = (transaction, { tenantId, userId, id, action, avant = null, apres = null }) => sequelize.query(
  `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, ancienne_valeur, nouvelle_valeur)
   VALUES (:t, :u, :action, 'controle_piece', :id, CAST(:av AS jsonb), CAST(:ap AS jsonb))`,
  { replacements: { t: tenantId, u: userId, action, id: String(id), av: avant ? JSON.stringify(avant) : null, ap: apres ? JSON.stringify(apres) : null }, transaction });
// Statut de la pièce (ligne de contrôle créée au besoin), sans toucher au tiers ni à l'observation.
const poserStatut = (transaction, { tenantId, userId, id, statut, anomalies, extra = '' }) => sequelize.query(
  `INSERT INTO controles_pieces (tenant_id, mouvement_id, statut, anomalies, modifie_par, modifie_le)
   VALUES (:t, :id, :statut, CAST(:anom AS TEXT[]), :u, NOW())
   ON CONFLICT (mouvement_id) DO UPDATE SET statut = EXCLUDED.statut, anomalies = EXCLUDED.anomalies,
     modifie_par = EXCLUDED.modifie_par, modifie_le = NOW()${extra}`,
  { replacements: { t: tenantId, id, statut, anom: `{${anomalies.join(',')}}`, u: userId }, transaction });
const relire = async (transaction, tenantId, id) => {
  const ctx = await contexte(tenantId, { sauf: id, transaction });
  const [maj] = await Q(`${SELECT_PIECES} WHERE j.tenant_id = :t AND j.id = :id`, { t: tenantId, id }, { transaction });
  return presenter(maj, ctx);
};
const libelleAnomalie = (v) => {
  const l = txt(v).replace(/\s+/g, ' ');
  if (!l) throw new ErreurControle(400, 'Décrivez l\'anomalie constatée.');
  if (l.length > 500) throw new ErreurControle(400, 'Anomalie trop longue (500 caractères au plus).');
  return l;
};

// Ajouter une anomalie constatée : la pièce passe « Anomalies constatées ».
const ajouterAnomalie = async ({ tenantId, userId, mouvementId, body = {} }) => {
  exigerClient(tenantId);
  const id = idPiece(mouvementId);
  const libelle = libelleAnomalie(body.libelle);
  const bloquante = body.bloquante === true || body.bloquante === 'true';
  return sequelize.transaction(async (transaction) => {
    const row = await lirePiece(transaction, tenantId, id, true);
    exigerNonValidee(row);
    const [a] = await Q(
      `INSERT INTO controles_anomalies (tenant_id, mouvement_id, libelle, bloquante, cree_par)
       VALUES (:t, :id, :libelle, :bloquante, :u) RETURNING id`,
      { t: tenantId, id, libelle, bloquante, u: userId }, { transaction });
    await poserStatut(transaction, { tenantId, userId, id, statut: 'anomalie', anomalies: [] });
    await auditPiece(transaction, { tenantId, userId, id, action: 'CONTROLE_ANOMALIE_AJOUT',
      apres: { anomalie_id: Number(a.id), libelle, bloquante } });
    return relire(transaction, tenantId, id);
  });
};

// Anomalie d'une pièce non validée, encore ouverte.
const lireAnomalie = async (transaction, tenantId, anomalieId) => {
  const aid = parseInt(anomalieId, 10);
  if (!Number.isInteger(aid) || aid <= 0) throw new ErreurControle(400, 'Anomalie invalide.');
  const [a] = await Q('SELECT * FROM controles_anomalies WHERE id = :aid AND tenant_id = :t FOR UPDATE',
    { aid, t: tenantId }, { transaction });
  if (!a) throw new ErreurControle(404, 'Anomalie introuvable pour ce client.');
  const row = await lirePiece(transaction, tenantId, Number(a.mouvement_id), true);
  exigerNonValidee(row);
  if (a.statut !== 'ouverte') throw new ErreurControle(409, 'Anomalie déjà levée : elle ne se modifie plus.');
  return { a, row, id: Number(a.mouvement_id) };
};

const modifierAnomalie = async ({ tenantId, userId, anomalieId, body = {} }) => {
  exigerClient(tenantId);
  return sequelize.transaction(async (transaction) => {
    const { a, id } = await lireAnomalie(transaction, tenantId, anomalieId);
    const libelle = body.libelle === undefined ? a.libelle : libelleAnomalie(body.libelle);
    const bloquante = body.bloquante === undefined ? a.bloquante : (body.bloquante === true || body.bloquante === 'true');
    await sequelize.query(
      'UPDATE controles_anomalies SET libelle = :libelle, bloquante = :bloquante, modifie_par = :u, modifie_le = NOW() WHERE id = :aid',
      { replacements: { libelle, bloquante, u: userId, aid: a.id }, transaction });
    await auditPiece(transaction, { tenantId, userId, id, action: 'CONTROLE_ANOMALIE_MODIF',
      avant: { anomalie_id: Number(a.id), libelle: a.libelle, bloquante: a.bloquante },
      apres: { anomalie_id: Number(a.id), libelle, bloquante } });
    return relire(transaction, tenantId, id);
  });
};

// Lever une anomalie (corrigée ou justifiée) : motif obligatoire, l'anomalie
// reste visible. Plus aucune anomalie ouverte : la pièce repasse « En cours ».
const leverAnomalie = async ({ tenantId, userId, anomalieId, body = {} }) => {
  exigerClient(tenantId);
  const motif = txt(body.motif);
  if (!motif) throw new ErreurControle(400, 'Indiquez pourquoi l\'anomalie est levée (corrigée, justifiée…).');
  if (motif.length > 500) throw new ErreurControle(400, 'Motif trop long (500 caractères au plus).');
  return sequelize.transaction(async (transaction) => {
    const { a, row, id } = await lireAnomalie(transaction, tenantId, anomalieId);
    await sequelize.query(
      `UPDATE controles_anomalies SET statut = 'levee', levee_par = :u, levee_le = NOW(), motif_levee = :motif WHERE id = :aid`,
      { replacements: { u: userId, motif, aid: a.id }, transaction });
    const restantes = lireSaisies(row.anomalies_saisies).filter((x) => x.statut === 'ouverte' && x.id !== Number(a.id)).length;
    if (!restantes && row.statut === 'anomalie' && !txt(row.observation)) {
      await poserStatut(transaction, { tenantId, userId, id, statut: 'en_cours', anomalies: [] });
    }
    await auditPiece(transaction, { tenantId, userId, id, action: 'CONTROLE_ANOMALIE_LEVEE',
      avant: { anomalie_id: Number(a.id), libelle: a.libelle, bloquante: a.bloquante, statut: 'ouverte' },
      apres: { anomalie_id: Number(a.id), statut: 'levee', motif } });
    return relire(transaction, tenantId, id);
  });
};

// « Confirmer la validation » : contrôle de régularité formelle terminé.
// Enregistre le validateur et la date. Ne touche à rien d'autre (journal,
// arrêté de caisse, exports, passerelle).
const valider = async ({ tenantId, userId, mouvementId, body = {} }) => {
  exigerClient(tenantId);
  const id = idPiece(mouvementId);
  return sequelize.transaction(async (transaction) => {
    const row = await lirePiece(transaction, tenantId, id, true);
    if (row.statut === 'controle') {
      throw new ErreurControle(409, `Pièce déjà validée${row.controle_par ? ` par ${row.controle_par}` : ''}${row.controle_le ? ` le ${dateFr(row.controle_le)}` : ''}.`,
        { code: 'DEJA_VALIDEE' });
    }
    const ctx = await contexte(tenantId, { sauf: id, transaction });
    const observation = body.observation === undefined ? txt(row.observation) : txt(body.observation);
    if (observation.length > 2000) throw new ErreurControle(400, 'Observation trop longue (2 000 caractères au plus).');
    const p = presenter({ ...row, observation }, ctx);
    exigerValidable(p, observation);
    await sequelize.query(
      `INSERT INTO controles_pieces (tenant_id, mouvement_id, observation, statut, anomalies, modifie_par, modifie_le, controle_par, controle_le)
       VALUES (:t, :id, :obs, 'controle', CAST(:anom AS TEXT[]), :u, NOW(), :u, NOW())
       ON CONFLICT (mouvement_id) DO UPDATE SET observation = EXCLUDED.observation, statut = 'controle', anomalies = EXCLUDED.anomalies,
         modifie_par = EXCLUDED.modifie_par, modifie_le = NOW(), controle_par = EXCLUDED.controle_par, controle_le = NOW()`,
      { replacements: { t: tenantId, id, obs: observation, anom: `{${p.anomalies.join(',')}}`, u: userId }, transaction });
    await auditPiece(transaction, { tenantId, userId, id, action: 'CONTROLE_VALIDATION',
      avant: { statut: row.statut }, apres: { statut: 'controle', observation, compte: p.compte,
        anomalies_ouvertes: p.anomalies_saisies.filter((a) => a.statut === 'ouverte').map((a) => a.libelle) } });
    return relire(transaction, tenantId, id);
  });
};

// Réouverture d'une pièce validée : permission controle.reouvrir, motif
// obligatoire. La pièce redevient modifiable (« Anomalies constatées » s'il
// reste des anomalies ouvertes, sinon « En cours »).
const rouvrir = async ({ tenantId, userId, mouvementId, body = {} }) => {
  exigerClient(tenantId);
  const id = idPiece(mouvementId);
  const motif = txt(body.motif);
  if (!motif) throw new ErreurControle(400, 'Le motif de réouverture est obligatoire.');
  if (motif.length > 500) throw new ErreurControle(400, 'Motif trop long (500 caractères au plus).');
  return sequelize.transaction(async (transaction) => {
    const row = await lirePiece(transaction, tenantId, id, true);
    if (row.statut !== 'controle') throw new ErreurControle(409, 'Cette pièce n\'est pas validée : rien à rouvrir.');
    const ouvertes = lireSaisies(row.anomalies_saisies).some((a) => a.statut === 'ouverte');
    const statut = ouvertes ? 'anomalie' : 'en_cours';
    await sequelize.query(
      `UPDATE controles_pieces SET statut = :statut, controle_par = NULL, controle_le = NULL,
              rouvert_par = :u, rouvert_le = NOW(), motif_reouverture = :motif, modifie_par = :u, modifie_le = NOW()
        WHERE mouvement_id = :id`,
      { replacements: { statut, u: userId, motif, id }, transaction });
    await auditPiece(transaction, { tenantId, userId, id, action: 'CONTROLE_REOUVERTURE',
      avant: { statut: 'controle', valide_par: row.controle_par, valide_le: row.controle_le }, apres: { statut, motif } });
    return relire(transaction, tenantId, id);
  });
};

// Historique du contrôle d'une pièce (traçabilité).
const LIB_ACTIONS = {
  CONTROLE_PIECE: 'Contrôle enregistré', CONTROLE_COMPTE_CORRIGE: 'Code comptable corrigé',
  CONTROLE_ANOMALIE_AJOUT: 'Anomalie constatée', CONTROLE_ANOMALIE_MODIF: 'Anomalie modifiée',
  CONTROLE_ANOMALIE_LEVEE: 'Anomalie levée', CONTROLE_VALIDATION: 'Validation confirmée', CONTROLE_REOUVERTURE: 'Pièce rouverte',
};
const historique = async (tenantId, mouvementId) => {
  exigerClient(tenantId);
  const id = idPiece(mouvementId);
  const [p] = await Q('SELECT id FROM journal WHERE id = :id AND tenant_id = :t', { id, t: tenantId });
  if (!p) throw new ErreurControle(404, 'Pièce introuvable pour ce client.');
  const rows = await Q(
    `SELECT a.action, a.created_at AS le, u.username AS par, a.ancienne_valeur AS avant, a.nouvelle_valeur AS apres
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.tenant_id = :t AND a.entite = 'controle_piece' AND a.entite_id = :id
      ORDER BY a.created_at DESC, a.id DESC LIMIT 200`, { t: tenantId, id: String(id) });
  return rows.map((r) => ({ ...r, libelle: LIB_ACTIONS[r.action] || r.action }));
};

// ── Tiers connus (aide à la saisie) : registre d'abord, puis pièces ──────────
const tiersConnus = async (tenantId, q = '') => {
  exigerClient(tenantId);
  const rows = await Q(
    `WITH t AS (
       SELECT upper(regexp_replace(COALESCE(NULLIF(btrim(c.tiers_nui), ''), j.nui, ''), '\\s+', '', 'g')) AS nui,
              btrim(COALESCE(NULLIF(btrim(c.tiers_nom), ''), j.beneficiaire, '')) AS nom
         FROM journal j LEFT JOIN controles_pieces c ON c.mouvement_id = j.id
        WHERE j.tenant_id = :t AND NOT j.annule AND j.annulation_de_id IS NULL),
     p AS (
       SELECT nui, nom, COUNT(*)::int AS nb FROM t
        WHERE nom <> '' AND (:q = '' OR lower(nom) LIKE :like OR lower(nui) LIKE :like)
        GROUP BY nui, nom)
     SELECT r.id AS tiers_id, upper(btrim(r.nui)) AS nui, r.nom, 1000000 AS nb, r.verifie, 'registre' AS source,
            r.type, r.compte_tiers
       FROM registre_tiers r
      WHERE r.tenant_id = :t AND r.actif AND (:q = '' OR lower(r.nom) LIKE :like OR lower(r.nui) LIKE :like)
     UNION ALL
     SELECT NULL, p.nui, p.nom, p.nb, false, 'pieces', '', '' FROM p
      WHERE NOT EXISTS (SELECT 1 FROM registre_tiers r WHERE r.tenant_id = :t AND r.actif
                           AND ((p.nui <> '' AND upper(btrim(r.nui)) = p.nui) OR (p.nui = '' AND lower(r.nom) = lower(p.nom))))
      ORDER BY nb DESC, nom LIMIT 80`,
    { t: tenantId, q: txt(q), like: `%${txt(q).toLowerCase()}%` });
  return rows.map((r) => ({ ...r, tiers_id: r.tiers_id ? Number(r.tiers_id) : null, nb: r.source === 'registre' ? null : r.nb }));
};

module.exports = {
  ErreurControle, STATUTS, STATUT_LIB, ANOMALIES, NUI_RE, lister, enregistrer, tiersConnus,
  ajouterAnomalie, modifierAnomalie, leverAnomalie, valider, rouvrir, historique,
};
