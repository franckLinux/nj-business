'use strict';
// Contrôle comptable → « Arrêtés & inventaires » (migration 046, 25/10/2026).
//
// 1. VALIDATION DES ARRÊTÉS DE CAISSE
//    L'arrêté reste l'acte du directeur / du responsable d'arrêt (inchangé).
//    Le contrôle comptable le VALIDE : solde constaté (d'après le PV de
//    caisse ou le relevé), PV scanné obligatoire, observation obligatoire si
//    écart. Règles :
//      • on ne valide qu'un journal ARRÊTÉ pour le mois ;
//      • (26/10/2026) l'arrêt peut être fait par le directeur ou le comptable
//        (journaux.arreter) ; la VALIDATION est réservée au directeur
//        (permission arrets.valider), qui peut valider son propre arrêt ;
//      • le solde arrêté doit toujours correspondre au solde calculé du
//        journal (sinon : refus, fail-closed) ;
//      • un arrêté validé ne se rouvre plus et ne se ré-arrête plus (trigger
//        en base + contrôleur arret_caisse) : il faut d'abord ANNULER la
//        validation (controle.reouvrir, motif obligatoire).
// 2. INVENTAIRES
//    Constat des soldes de plusieurs journaux à une date (comptage de caisse,
//    relevés banque / mobile money). Solde théorique calculé par le serveur
//    (figé à la validation), solde constaté saisi, PV scanné obligatoire,
//    observation obligatoire sur chaque ligne en écart. Inventaire validé =
//    figé ; réouverture : controle.reouvrir + motif.
//
// Rien ici n'écrit dans le journal, la passerelle ni les exports. Tout est
// tracé dans audit_log. Les PV sont stockés hors du dossier public.
const { sequelize } = require('../models');
const { soldesJournaux } = require('./journal.service');
const pv = require('./pv_storage.service');

const T = sequelize.QueryTypes;
const Q = (sql, replacements, opts = {}) => sequelize.query(sql, { replacements, type: T.SELECT, ...opts });
const X = (sql, replacements, opts = {}) => sequelize.query(sql, { replacements, ...opts });

const MOIS = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
const ORDRE_TYPES = ['caisse', 'banque', 'om', 'momo', 'carte_prepayee', 'autre'];
const TOLERANCE = 0.005;     // écart nul au centime près
const TOLERANCE_CALCUL = 0.5; // même tolérance que l'arrêt de caisse

class ErreurArrete extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

const txt = (v) => String(v ?? '').trim();
const num = (v) => (v === null || v === undefined ? null : Number(v));
const arrondi = (n) => Math.round(n * 100) / 100;
const exigerClient = (tenantId) => { if (!tenantId) throw new ErreurArrete(400, 'Choisissez d\'abord un client.'); };
const dateFr = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '');

// Montant saisi : nombre, ou texte « 1 250 000,50 ». '' / null → null.
const montant = (v, quoi = 'Montant') => {
  if (v === null || v === undefined || txt(v) === '') return null;
  const n = typeof v === 'number' ? v : Number(txt(v).replace(/[\s  ]/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || Math.abs(n) >= 1e13) throw new ErreurArrete(400, `${quoi} invalide.`);
  return arrondi(n);
};
const periode = (mois, annee) => {
  const a = parseInt(annee, 10);
  if (!MOIS.includes(mois) || !Number.isInteger(a) || a < 2000 || a > 2100) throw new ErreurArrete(400, 'Période (mois, année) invalide.');
  return { mois, annee: a };
};
const entier = (v, quoi) => {
  const n = parseInt(v, 10);
  if (!Number.isInteger(n) || n <= 0 || String(n) !== txt(v)) throw new ErreurArrete(400, `${quoi} invalide.`);
  return n;
};
const observation = (v, max = 2000) => {
  const o = txt(v);
  if (o.length > max) throw new ErreurArrete(400, `Observation trop longue (${max} caractères au plus).`);
  return o;
};
const audit = (transaction, { tenantId, userId, action, entite, id, avant = null, apres = null }) => X(
  `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, ancienne_valeur, nouvelle_valeur)
   VALUES (:t, :u, :action, :entite, :id, CAST(:av AS jsonb), CAST(:ap AS jsonb))`,
  { t: tenantId, u: userId, action, entite, id: String(id), av: avant ? JSON.stringify(avant) : null, ap: apres ? JSON.stringify(apres) : null },
  { transaction });
const infoPv = (r) => (r.pv_path ? {
  nom: r.pv_nom, mime: r.pv_mime, taille: num(r.pv_taille), sha256: r.pv_sha256,
  depose_par: r.pv_depose_par_nom || null, depose_le: r.pv_depose_le,
} : null);
const trierJournaux = (a, b) => (ORDRE_TYPES.indexOf(a.journal_type) - ORDRE_TYPES.indexOf(b.journal_type))
  || String(a.journal_code).localeCompare(String(b.journal_code));

// ══ 1. ARRÊTÉS DE CAISSE ═════════════════════════════════════════════════════
const SELECT_ARRETS = `
  SELECT j.id AS journal_id, j.code AS journal_code, j.nom AS journal_nom, j.type AS journal_type, j.actif,
         j.compte_tresorerie,
         a.id AS arret_id, a.solde_final, a.arrete_le, a.arrete_par, a.commentaire, ua.username AS arrete_par_nom,
         c.id AS controle_id, c.arret_id AS c_arret_id, c.solde_arrete, c.solde_constate, c.observation, c.statut,
         c.pv_nom, c.pv_path, c.pv_mime, c.pv_taille, c.pv_sha256, c.pv_depose_le, up.username AS pv_depose_par_nom,
         c.valide_par, c.valide_le, uv.username AS valide_par_nom,
         c.annule_le, uan.username AS annule_par_nom, c.motif_annulation, c.modifie_le, um.username AS modifie_par_nom,
         (SELECT COUNT(*) FROM journal m
           WHERE m.tenant_id = j.tenant_id AND m.journal_id = j.id AND m.mois = :m AND m.annee = :a
             AND m.annulation_de_id IS NULL AND NOT COALESCE(m.annule, false)) AS nb_pieces,
         (SELECT COUNT(*) FROM journal m JOIN controles_pieces cp ON cp.mouvement_id = m.id AND cp.statut = 'controle'
           WHERE m.tenant_id = j.tenant_id AND m.journal_id = j.id AND m.mois = :m AND m.annee = :a
             AND m.annulation_de_id IS NULL AND NOT COALESCE(m.annule, false)) AS nb_pieces_validees
    FROM journaux j
    LEFT JOIN arrets_caisse a     ON a.tenant_id = j.tenant_id AND a.journal_id = j.id AND a.mois = :m AND a.annee = :a
    LEFT JOIN users ua            ON ua.id = a.arrete_par
    LEFT JOIN controles_arrets c  ON c.tenant_id = j.tenant_id AND c.journal_id = j.id AND c.mois = :m AND c.annee = :a
    LEFT JOIN users up            ON up.id = c.pv_depose_par
    LEFT JOIN users uv            ON uv.id = c.valide_par
    LEFT JOIN users uan           ON uan.id = c.annule_par
    LEFT JOIN users um            ON um.id = c.modifie_par
   WHERE j.tenant_id = :t`;

const presenterArret = (r, soldes, userId) => {
  const arrete = Boolean(r.arret_id);
  const validee = arrete && r.statut === 'validee' && Number(r.c_arret_id) === Number(r.arret_id);
  const soldeArrete = arrete ? num(validee ? r.solde_arrete : r.solde_final) : null;
  // Solde calculé du journal : affiché aussi avant l'arrêt (solde qui sera arrêté).
  const soldeCalcule = soldes.has(Number(r.journal_id)) ? arrondi(soldes.get(Number(r.journal_id)).solde) : null;
  const constate = num(r.solde_constate);
  const ecart = arrete && constate !== null ? arrondi(constate - soldeArrete) : null;
  const etat = !arrete ? 'non_arrete' : validee ? 'validee' : 'a_valider';
  // Contrôle préparé sur un arrêté depuis rouvert (puis éventuellement ré-arrêté).
  const caduc = Boolean(r.controle_id) && !validee && (r.c_arret_id === null || Number(r.c_arret_id) !== Number(r.arret_id));
  const bloquants = [];
  if (etat === 'a_valider') {
    if (!r.pv_path) bloquants.push('PV scanné non joint');
    if (constate === null) bloquants.push('Solde constaté non saisi');
    if (ecart !== null && Math.abs(ecart) >= TOLERANCE && !txt(r.observation)) bloquants.push('Écart à justifier dans l\'observation');
    if (soldeCalcule !== null && Math.abs(soldeCalcule - soldeArrete) > TOLERANCE_CALCUL) bloquants.push('Le solde arrêté ne correspond plus au solde du journal');
  }
  return {
    journal_id: Number(r.journal_id), journal_code: r.journal_code, journal_nom: r.journal_nom, journal_type: r.journal_type,
    journal_actif: r.actif !== false, compte_tresorerie: r.compte_tresorerie || '',
    etat, controle_id: r.controle_id ? Number(r.controle_id) : null,
    arret: arrete ? {
      id: Number(r.arret_id), solde_final: num(r.solde_final), arrete_le: r.arrete_le,
      arrete_par: r.arrete_par_nom || null, commentaire: r.commentaire || '',
    } : null,
    solde_arrete: soldeArrete, solde_calcule: soldeCalcule, solde_constate: constate, ecart,
    observation: r.observation || '', pv: infoPv(r),
    validation: validee ? { par: r.valide_par_nom || null, le: r.valide_le } : null,
    derniere_annulation: r.annule_le ? { par: r.annule_par_nom || null, le: r.annule_le, motif: r.motif_annulation || '' } : null,
    modifie: r.modifie_le ? { par: r.modifie_par_nom || null, le: r.modifie_le } : null,
    caduc,
    pieces: { total: Number(r.nb_pieces) || 0, validees: Number(r.nb_pieces_validees) || 0 },
    bloquants, validable: etat === 'a_valider' && bloquants.length === 0,
  };
};

const lignesArrets = async (tenantId, { mois, annee }, { journalId = null, userId = null, transaction } = {}) => {
  const rows = await Q(`${SELECT_ARRETS}
       AND (j.actif OR a.id IS NOT NULL OR c.id IS NOT NULL)${journalId ? ' AND j.id = :j' : ''}`,
  { t: tenantId, m: mois, a: annee, j: journalId }, { transaction });
  const ids = rows.map((r) => Number(r.journal_id));
  const soldes = ids.length ? await soldesJournaux(tenantId, mois, annee, ids) : new Map();
  return rows.map((r) => presenterArret(r, soldes, userId)).sort(trierJournaux);
};

// GET /controle/arrets?mois=&annee=
const listerArrets = async (tenantId, query = {}, userId = null) => {
  exigerClient(tenantId);
  const p = periode(query.mois, query.annee);
  const lignes = await lignesArrets(tenantId, p, { userId });
  const resume = { total: lignes.length, non_arretes: 0, a_valider: 0, validees: 0, avec_ecart: 0 };
  for (const l of lignes) {
    if (l.etat === 'non_arrete') resume.non_arretes += 1;
    if (l.etat === 'a_valider') resume.a_valider += 1;
    if (l.etat === 'validee') resume.validees += 1;
    if (l.ecart !== null && Math.abs(l.ecart) >= TOLERANCE) resume.avec_ecart += 1;
  }
  return { ...p, lignes, resume };
};

const ligneArret = async (tenantId, p, journalId, userId) => (await lignesArrets(tenantId, p, { journalId, userId }))[0];

// Arrêté du journal pour le mois (verrouillé) + contrôle existant (verrouillé).
const lireArretVerrouille = async (transaction, tenantId, journalId, { mois, annee }) => {
  const [j] = await Q('SELECT id, code FROM journaux WHERE id = :j AND tenant_id = :t', { j: journalId, t: tenantId }, { transaction });
  if (!j) throw new ErreurArrete(404, 'Journal introuvable pour ce client.');
  const [a] = await Q(`SELECT id, solde_final, arrete_par, arrete_le FROM arrets_caisse
                        WHERE tenant_id = :t AND journal_id = :j AND mois = :m AND annee = :a FOR UPDATE`,
  { t: tenantId, j: journalId, m: mois, a: annee }, { transaction });
  const [c] = await Q(`SELECT * FROM controles_arrets
                        WHERE tenant_id = :t AND journal_id = :j AND mois = :m AND annee = :a FOR UPDATE`,
  { t: tenantId, j: journalId, m: mois, a: annee }, { transaction });
  return { journal: j, arret: a || null, controle: c || null };
};
const exigerArrete = (arret, journal, { mois, annee }) => {
  if (!arret) throw new ErreurArrete(409, `Le journal ${journal.code} n'est pas arrêté pour ${mois} ${annee} : il n'y a rien à valider. L'arrêt se fait depuis le journal (directeur ou responsable d'arrêt).`);
};
const exigerNonValide = (controle, arret) => {
  if (controle && controle.statut === 'validee' && arret && Number(controle.arret_id) === Number(arret.id)) {
    throw new ErreurArrete(409, `Arrêté déjà validé le ${dateFr(controle.valide_le)} : annulez d'abord la validation pour le modifier.`, { code: 'DEJA_VALIDEE' });
  }
};

// Crée / met à jour la ligne de contrôle (toujours rattachée à l'arrêté courant).
const upsertControle = (transaction, { tenantId, userId, journalId, mois, annee, arret, champs }) => {
  const cols = Object.keys(champs);
  return X(
    `INSERT INTO controles_arrets (tenant_id, journal_id, mois, annee, arret_id, solde_arrete, cree_par, modifie_par, modifie_le${cols.map((c) => `, ${c}`).join('')})
     VALUES (:t, :j, :m, :a, :arret, :sa, :u, :u, NOW()${cols.map((c) => `, :${c}`).join('')})
     ON CONFLICT (tenant_id, journal_id, mois, annee) DO UPDATE SET
       arret_id = EXCLUDED.arret_id, solde_arrete = EXCLUDED.solde_arrete,
       modifie_par = EXCLUDED.modifie_par, modifie_le = NOW()${cols.map((c) => `, ${c} = EXCLUDED.${c}`).join('')}`,
    { t: tenantId, j: journalId, m: mois, a: annee, arret: arret.id, sa: num(arret.solde_final), u: userId, ...champs },
    { transaction });
};

// PUT /controle/arrets/:journalId  { mois, annee, solde_constate, observation }
const saisirArret = async ({ tenantId, userId, journalId, body = {} }) => {
  exigerClient(tenantId);
  const jId = entier(journalId, 'Journal');
  const p = periode(body.mois, body.annee);
  await sequelize.transaction(async (transaction) => {
    const { journal, arret, controle } = await lireArretVerrouille(transaction, tenantId, jId, p);
    exigerArrete(arret, journal, p);
    exigerNonValide(controle, arret);
    const champs = {};
    if (body.solde_constate !== undefined) champs.solde_constate = montant(body.solde_constate, 'Solde constaté');
    if (body.observation !== undefined) champs.observation = observation(body.observation);
    // Contrôle repris sur un nouvel arrêté (caisse rouverte entre-temps) : statut remis à valider.
    champs.statut = 'a_valider';
    await upsertControle(transaction, { tenantId, userId, journalId: jId, ...p, arret, champs });
    await audit(transaction, { tenantId, userId, action: 'ARRET_CONTROLE_SAISIE', entite: 'controle_arret', id: `${jId}:${p.mois}:${p.annee}`,
      avant: controle ? { solde_constate: num(controle.solde_constate), observation: controle.observation, arret_id: controle.arret_id } : null,
      apres: { ...champs, arret_id: arret.id, solde_arrete: num(arret.solde_final) } });
  });
  return ligneArret(tenantId, p, jId, userId);
};

// POST /controle/arrets/:journalId/pv  { mois, annee, nom_fichier, data_base64 }
const deposerPvArret = async ({ tenantId, userId, journalId, body = {} }) => {
  exigerClient(tenantId);
  const jId = entier(journalId, 'Journal');
  const p = periode(body.mois, body.annee);
  const f = preparerPv(body);
  await sequelize.transaction(async (transaction) => {
    const { journal, arret, controle } = await lireArretVerrouille(transaction, tenantId, jId, p);
    exigerArrete(arret, journal, p);
    exigerNonValide(controle, arret);
    const chemin = await pv.enregistrer(tenantId, 'arret', `${jId}-${p.annee}-${p.mois}`, f);
    await upsertControle(transaction, { tenantId, userId, journalId: jId, ...p, arret, champs: {
      statut: 'a_valider', pv_nom: f.nom, pv_path: chemin, pv_mime: f.mime, pv_taille: f.taille, pv_sha256: f.sha256,
      pv_depose_par: userId, pv_depose_le: new Date(),
    } });
    await audit(transaction, { tenantId, userId, action: 'ARRET_PV_DEPOT', entite: 'controle_arret', id: `${jId}:${p.mois}:${p.annee}`,
      avant: controle?.pv_path ? { pv_nom: controle.pv_nom, pv_sha256: controle.pv_sha256 } : null,
      apres: { pv_nom: f.nom, pv_mime: f.mime, pv_taille: f.taille, pv_sha256: f.sha256 } });
  });
  return ligneArret(tenantId, p, jId, userId);
};

// POST /controle/arrets/:journalId/validation  { mois, annee, solde_constate?, observation? }
const validerArret = async ({ tenantId, userId, journalId, body = {} }) => {
  exigerClient(tenantId);
  const jId = entier(journalId, 'Journal');
  const p = periode(body.mois, body.annee);
  await sequelize.transaction(async (transaction) => {
    const { journal, arret, controle } = await lireArretVerrouille(transaction, tenantId, jId, p);
    exigerArrete(arret, journal, p);
    exigerNonValide(controle, arret);
    const constate = body.solde_constate !== undefined ? montant(body.solde_constate, 'Solde constaté') : num(controle?.solde_constate);
    const obs = body.observation !== undefined ? observation(body.observation) : txt(controle?.observation);
    const soldeArrete = num(arret.solde_final);

    if (!controle?.pv_path) throw new ErreurArrete(400, 'Joignez d\'abord le PV d\'arrêté scanné : il atteste le solde constaté.');
    if (constate === null) throw new ErreurArrete(400, 'Saisissez le solde constaté (d\'après le PV).');
    const ecart = arrondi(constate - soldeArrete);
    if (Math.abs(ecart) >= TOLERANCE && !obs) {
      throw new ErreurArrete(400, `Écart de ${ecart.toLocaleString('fr-FR')} entre le solde constaté et le solde arrêté : justifiez-le dans l'observation.`);
    }
    const calc = (await soldesJournaux(tenantId, p.mois, p.annee, [jId])).get(jId);
    const soldeCalcule = calc ? arrondi(calc.solde) : 0;
    if (Math.abs(soldeCalcule - soldeArrete) > TOLERANCE_CALCUL) {
      throw new ErreurArrete(409, `Le solde arrêté (${soldeArrete.toLocaleString('fr-FR')}) ne correspond plus au solde du journal (${soldeCalcule.toLocaleString('fr-FR')}). Faites rouvrir puis ré-arrêter la caisse avant de valider.`);
    }
    await X(
      `UPDATE controles_arrets SET statut = 'validee', arret_id = :arret, solde_arrete = :sa, solde_constate = :sc, observation = :obs,
              valide_par = :u, valide_le = NOW(), modifie_par = :u, modifie_le = NOW()
        WHERE id = :id`,
      { arret: arret.id, sa: soldeArrete, sc: constate, obs, u: userId, id: controle.id }, { transaction });
    await audit(transaction, { tenantId, userId, action: 'ARRET_VALIDATION', entite: 'controle_arret', id: `${jId}:${p.mois}:${p.annee}`,
      avant: { statut: controle.statut },
      apres: { statut: 'validee', arret_id: arret.id, solde_arrete: soldeArrete, solde_constate: constate, ecart, observation: obs, pv_sha256: controle.pv_sha256 } });
  });
  return ligneArret(tenantId, p, jId, userId);
};

// POST /controle/arrets/:journalId/annulation  { mois, annee, motif }  (arrets.valider : directeur)
const annulerValidationArret = async ({ tenantId, userId, journalId, body = {} }) => {
  exigerClient(tenantId);
  const jId = entier(journalId, 'Journal');
  const p = periode(body.mois, body.annee);
  const motif = txt(body.motif);
  if (!motif) throw new ErreurArrete(400, 'Le motif d\'annulation est obligatoire.');
  if (motif.length > 500) throw new ErreurArrete(400, 'Motif trop long (500 caractères au plus).');
  await sequelize.transaction(async (transaction) => {
    const { arret, controle } = await lireArretVerrouille(transaction, tenantId, jId, p);
    if (!controle || controle.statut !== 'validee') throw new ErreurArrete(409, 'Cet arrêté n\'est pas validé : rien à annuler.');
    await X(
      `UPDATE controles_arrets SET statut = 'a_valider', valide_par = NULL, valide_le = NULL,
              annule_par = :u, annule_le = NOW(), motif_annulation = :motif, modifie_par = :u, modifie_le = NOW()
        WHERE id = :id`,
      { u: userId, motif, id: controle.id }, { transaction });
    await audit(transaction, { tenantId, userId, action: 'ARRET_VALIDATION_ANNULEE', entite: 'controle_arret', id: `${jId}:${p.mois}:${p.annee}`,
      avant: { statut: 'validee', valide_par: controle.valide_par, valide_le: controle.valide_le, arret_id: arret?.id ?? null },
      apres: { statut: 'a_valider', motif } });
  });
  return ligneArret(tenantId, p, jId, userId);
};

// Utilisé par arret_caisse.controller : un arrêté validé ne se rouvre ni ne se ré-arrête.
const arretValide = async (tenantId, journalId, mois, annee) => {
  const [r] = await Q(`SELECT c.valide_le FROM controles_arrets c JOIN arrets_caisse a ON a.id = c.arret_id
                        WHERE c.tenant_id = :t AND c.journal_id = :j AND c.mois = :m AND c.annee = :a AND c.statut = 'validee'`,
  { t: tenantId, j: journalId, m: mois, a: parseInt(annee, 10) });
  return r || null;
};

// ══ 2. INVENTAIRES ═══════════════════════════════════════════════════════════
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const aujourdhui = () => {
  // Date du jour au Cameroun (UTC+1), pour refuser un inventaire daté dans le futur.
  const d = new Date(Date.now() + 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
};
const dateInventaire = (v) => {
  const d = txt(v);
  if (!DATE_RE.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) throw new ErreurArrete(400, 'Date d\'inventaire invalide.');
  if (d > aujourdhui()) throw new ErreurArrete(400, 'Un inventaire ne peut pas être daté dans le futur.');
  return d;
};
const idInventaire = (v) => entier(v, 'Inventaire');

// Solde de chaque journal à la fin de la journée `date` (report + mouvements du mois jusqu'à cette date).
const soldesAuDate = async (tenantId, date, journalIds, transaction) => {
  const ids = [...new Set(journalIds.map(Number))].filter((n) => n > 0);
  const res = new Map();
  if (!ids.length) return res;
  const d = new Date(`${date}T00:00:00Z`);
  const mois = MOIS[d.getUTCMonth()];
  const annee = d.getUTCFullYear();
  const base = await soldesJournaux(tenantId, mois, annee, ids);
  const rows = await Q(`SELECT journal_id, COALESCE(SUM(entree), 0) - COALESCE(SUM(sortie), 0) AS net
                          FROM journal WHERE tenant_id = :t AND journal_id IN (:ids) AND mois = :m AND annee = :a AND date <= :d
                         GROUP BY journal_id`, { t: tenantId, ids, m: mois, a: annee, d: date }, { transaction });
  const net = new Map(rows.map((r) => [Number(r.journal_id), Number(r.net) || 0]));
  for (const id of ids) res.set(id, arrondi((base.get(id)?.ran || 0) + (net.get(id) || 0)));
  return res;
};

const SELECT_INV = `
  SELECT i.*, uc.username AS cree_par_nom, uv.username AS valide_par_nom, ur.username AS rouvert_par_nom,
         up.username AS pv_depose_par_nom, um.username AS modifie_par_nom
    FROM inventaires i
    LEFT JOIN users uc ON uc.id = i.cree_par
    LEFT JOIN users uv ON uv.id = i.valide_par
    LEFT JOIN users ur ON ur.id = i.rouvert_par
    LEFT JOIN users up ON up.id = i.pv_depose_par
    LEFT JOIN users um ON um.id = i.modifie_par`;
const dateIso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

const presenterEntete = (r) => ({
  id: Number(r.id), date_inventaire: dateIso(r.date_inventaire), libelle: r.libelle || '', observation: r.observation || '',
  statut: r.statut, pv: infoPv(r),
  cree: { par: r.cree_par_nom || null, le: r.cree_le },
  modifie: r.modifie_le ? { par: r.modifie_par_nom || null, le: r.modifie_le } : null,
  validation: r.statut === 'valide' ? { par: r.valide_par_nom || null, le: r.valide_le } : null,
  derniere_reouverture: r.rouvert_le ? { par: r.rouvert_par_nom || null, le: r.rouvert_le, motif: r.motif_reouverture || '' } : null,
});

// GET /controle/inventaires?annee=
const listerInventaires = async (tenantId, query = {}) => {
  exigerClient(tenantId);
  const annee = query.annee ? parseInt(query.annee, 10) : null;
  const rows = await Q(`${SELECT_INV}
     WHERE i.tenant_id = :t${annee ? ' AND EXTRACT(YEAR FROM i.date_inventaire) = :a' : ''}
     ORDER BY i.date_inventaire DESC, i.id DESC`, { t: tenantId, a: annee });
  const stats = rows.length ? await Q(`
      SELECT inventaire_id, COUNT(*) AS nb, COUNT(solde_constate) AS saisis,
             SUM(CASE WHEN solde_theorique IS NOT NULL AND solde_constate IS NOT NULL THEN solde_constate - solde_theorique END) AS ecart,
             string_agg(j.code, ', ' ORDER BY j.code) AS codes
        FROM inventaires_lignes l JOIN journaux j ON j.id = l.journal_id
       WHERE l.tenant_id = :t AND l.inventaire_id IN (:ids) GROUP BY inventaire_id`,
  { t: tenantId, ids: rows.map((r) => r.id) }) : [];
  const parId = new Map(stats.map((s) => [String(s.inventaire_id), s]));
  return rows.map((r) => {
    const s = parId.get(String(r.id)) || {};
    return { ...presenterEntete(r), nb_journaux: Number(s.nb) || 0, nb_saisis: Number(s.saisis) || 0, journaux: s.codes || '',
      ecart_total: r.statut === 'valide' && s.ecart !== null && s.ecart !== undefined ? arrondi(Number(s.ecart)) : null };
  });
};

const lireInventaireBrut = async (transaction, tenantId, id, verrou = false) => {
  const [r] = await Q(`${SELECT_INV} WHERE i.tenant_id = :t AND i.id = :id${verrou ? ' FOR UPDATE OF i' : ''}`, { t: tenantId, id }, { transaction });
  if (!r) throw new ErreurArrete(404, 'Inventaire introuvable pour ce client.');
  return r;
};
const lignesInventaire = async (transaction, tenantId, inv) => {
  const rows = await Q(`SELECT l.*, j.code AS journal_code, j.nom AS journal_nom, j.type AS journal_type, j.compte_tresorerie
                          FROM inventaires_lignes l JOIN journaux j ON j.id = l.journal_id
                         WHERE l.inventaire_id = :id AND l.tenant_id = :t`, { id: inv.id, t: tenantId }, { transaction });
  const live = inv.statut === 'brouillon'
    ? await soldesAuDate(tenantId, dateIso(inv.date_inventaire), rows.map((r) => r.journal_id), transaction) : null;
  return rows.map((r) => {
    const theo = live ? live.get(Number(r.journal_id)) ?? 0 : num(r.solde_theorique);
    const constate = num(r.solde_constate);
    return {
      id: Number(r.id), journal_id: Number(r.journal_id), journal_code: r.journal_code, journal_nom: r.journal_nom,
      journal_type: r.journal_type, compte_tresorerie: r.compte_tresorerie || '',
      solde_theorique: theo, solde_constate: constate,
      ecart: constate !== null && theo !== null ? arrondi(constate - theo) : null,
      observation: r.observation || '',
    };
  }).sort(trierJournaux);
};
const bloquantsInventaire = (entete, lignes) => {
  const b = [];
  if (!lignes.length) b.push('Aucun journal dans l\'inventaire');
  if (!entete.pv) b.push('PV d\'inventaire scanné non joint');
  const nonSaisis = lignes.filter((l) => l.solde_constate === null);
  if (nonSaisis.length) b.push(`Solde constaté non saisi : ${nonSaisis.map((l) => l.journal_code).join(', ')}`);
  const sansObs = lignes.filter((l) => l.ecart !== null && Math.abs(l.ecart) >= TOLERANCE && !l.observation);
  if (sansObs.length) b.push(`Écart à justifier (observation de la ligne) : ${sansObs.map((l) => l.journal_code).join(', ')}`);
  return b;
};
const detailInventaire = async (transaction, tenantId, id) => {
  const r = await lireInventaireBrut(transaction, tenantId, id);
  const entete = presenterEntete(r);
  const lignes = await lignesInventaire(transaction, tenantId, r);
  const tot = (k) => arrondi(lignes.reduce((s, l) => s + (l[k] || 0), 0));
  const bloquants = r.statut === 'brouillon' ? bloquantsInventaire(entete, lignes) : [];
  return { ...entete, lignes, totaux: { solde_theorique: tot('solde_theorique'), solde_constate: tot('solde_constate'), ecart: tot('ecart') },
    bloquants, validable: r.statut === 'brouillon' && bloquants.length === 0 };
};

// GET /controle/inventaires/:id
const lireInventaire = async (tenantId, id) => {
  exigerClient(tenantId);
  return detailInventaire(undefined, tenantId, idInventaire(id));
};

// POST /controle/inventaires  { date_inventaire, libelle, journal_ids? }
const creerInventaire = async ({ tenantId, userId, body = {} }) => {
  exigerClient(tenantId);
  const date = dateInventaire(body.date_inventaire);
  const libelle = txt(body.libelle).slice(0, 200);
  const id = await sequelize.transaction(async (transaction) => {
    let journaux;
    if (Array.isArray(body.journal_ids) && body.journal_ids.length) {
      const ids = [...new Set(body.journal_ids.map((v) => entier(v, 'Journal')))];
      journaux = await Q('SELECT id FROM journaux WHERE tenant_id = :t AND id IN (:ids)', { t: tenantId, ids }, { transaction });
      if (journaux.length !== ids.length) throw new ErreurArrete(400, 'Un des journaux choisis n\'appartient pas à ce client.');
    } else {
      journaux = await Q('SELECT id FROM journaux WHERE tenant_id = :t AND actif', { t: tenantId }, { transaction });
    }
    if (!journaux.length) throw new ErreurArrete(400, 'Aucun journal actif à inventorier.');
    const [ins] = await Q(`INSERT INTO inventaires (tenant_id, date_inventaire, libelle, cree_par)
                           VALUES (:t, :d, :l, :u) RETURNING id`, { t: tenantId, d: date, l: libelle, u: userId }, { transaction });
    for (const j of journaux) {
      await X('INSERT INTO inventaires_lignes (inventaire_id, tenant_id, journal_id) VALUES (:i, :t, :j)', { i: ins.id, t: tenantId, j: j.id }, { transaction });
    }
    await audit(transaction, { tenantId, userId, action: 'INVENTAIRE_CREATION', entite: 'inventaire', id: ins.id,
      apres: { date_inventaire: date, libelle, journaux: journaux.map((j) => j.id) } });
    return Number(ins.id);
  });
  return detailInventaire(undefined, tenantId, id);
};

const exigerBrouillon = (r) => {
  if (r.statut !== 'brouillon') {
    throw new ErreurArrete(409, `Inventaire validé le ${dateFr(r.valide_le)} : il est figé. Rouvrez-le (motif obligatoire) pour le modifier.`, { code: 'DEJA_VALIDE' });
  }
};

// PUT /controle/inventaires/:id  { date_inventaire?, libelle?, observation?, lignes?: [{ journal_id, solde_constate, observation }] }
const modifierInventaire = async ({ tenantId, userId, id: brut, body = {} }) => {
  exigerClient(tenantId);
  const id = idInventaire(brut);
  await sequelize.transaction(async (transaction) => {
    const r = await lireInventaireBrut(transaction, tenantId, id, true);
    exigerBrouillon(r);
    const ent = {};
    if (body.date_inventaire !== undefined) ent.date_inventaire = dateInventaire(body.date_inventaire);
    if (body.libelle !== undefined) ent.libelle = txt(body.libelle).slice(0, 200);
    if (body.observation !== undefined) ent.observation = observation(body.observation);
    const cols = Object.keys(ent);
    await X(`UPDATE inventaires SET modifie_par = :u, modifie_le = NOW()${cols.map((c) => `, ${c} = :${c}`).join('')} WHERE id = :id`,
      { u: userId, id, ...ent }, { transaction });
    const lignesAvant = await Q('SELECT journal_id, solde_constate, observation FROM inventaires_lignes WHERE inventaire_id = :id', { id }, { transaction });
    const connues = new Set(lignesAvant.map((l) => Number(l.journal_id)));
    const maj = [];
    for (const l of Array.isArray(body.lignes) ? body.lignes : []) {
      const jId = entier(l.journal_id, 'Journal');
      if (!connues.has(jId)) throw new ErreurArrete(400, 'Ligne d\'inventaire inconnue (journal absent de cet inventaire).');
      const champs = {};
      if (l.solde_constate !== undefined) champs.solde_constate = montant(l.solde_constate, 'Solde constaté');
      if (l.observation !== undefined) champs.observation = observation(l.observation, 1000);
      const c = Object.keys(champs);
      if (!c.length) continue;
      await X(`UPDATE inventaires_lignes SET ${c.map((k) => `${k} = :${k}`).join(', ')} WHERE inventaire_id = :id AND journal_id = :j`,
        { id, j: jId, ...champs }, { transaction });
      maj.push({ journal_id: jId, ...champs });
    }
    await audit(transaction, { tenantId, userId, action: 'INVENTAIRE_MODIF', entite: 'inventaire', id,
      avant: { date_inventaire: dateIso(r.date_inventaire), libelle: r.libelle, observation: r.observation,
        lignes: lignesAvant.filter((l) => maj.some((m) => m.journal_id === Number(l.journal_id))) },
      apres: { ...ent, lignes: maj } });
  });
  return detailInventaire(undefined, tenantId, id);
};

// POST /controle/inventaires/:id/pv  { nom_fichier, data_base64 }
const deposerPvInventaire = async ({ tenantId, userId, id: brut, body = {} }) => {
  exigerClient(tenantId);
  const id = idInventaire(brut);
  const f = preparerPv(body);
  await sequelize.transaction(async (transaction) => {
    const r = await lireInventaireBrut(transaction, tenantId, id, true);
    exigerBrouillon(r);
    const chemin = await pv.enregistrer(tenantId, 'inventaire', id, f);
    await X(`UPDATE inventaires SET pv_nom = :nom, pv_path = :p, pv_mime = :mime, pv_taille = :taille, pv_sha256 = :sha,
                    pv_depose_par = :u, pv_depose_le = NOW(), modifie_par = :u, modifie_le = NOW() WHERE id = :id`,
    { nom: f.nom, p: chemin, mime: f.mime, taille: f.taille, sha: f.sha256, u: userId, id }, { transaction });
    await audit(transaction, { tenantId, userId, action: 'INVENTAIRE_PV_DEPOT', entite: 'inventaire', id,
      avant: r.pv_path ? { pv_nom: r.pv_nom, pv_sha256: r.pv_sha256 } : null,
      apres: { pv_nom: f.nom, pv_mime: f.mime, pv_taille: f.taille, pv_sha256: f.sha256 } });
  });
  return detailInventaire(undefined, tenantId, id);
};

// POST /controle/inventaires/:id/validation
const validerInventaire = async ({ tenantId, userId, id: brut }) => {
  exigerClient(tenantId);
  const id = idInventaire(brut);
  await sequelize.transaction(async (transaction) => {
    const r = await lireInventaireBrut(transaction, tenantId, id, true);
    exigerBrouillon(r);
    if (dateIso(r.date_inventaire) > aujourdhui()) throw new ErreurArrete(400, 'Un inventaire ne peut pas être daté dans le futur.');
    const entete = presenterEntete(r);
    const lignes = await lignesInventaire(transaction, tenantId, r);
    const bloquants = bloquantsInventaire(entete, lignes);
    if (bloquants.length) throw new ErreurArrete(400, `Validation impossible : ${bloquants.join(' ; ')}.`, { bloquants });
    for (const l of lignes) {
      await X('UPDATE inventaires_lignes SET solde_theorique = :s WHERE id = :id', { s: l.solde_theorique, id: l.id }, { transaction });
    }
    await X(`UPDATE inventaires SET statut = 'valide', valide_par = :u, valide_le = NOW(), modifie_par = :u, modifie_le = NOW() WHERE id = :id`,
      { u: userId, id }, { transaction });
    await audit(transaction, { tenantId, userId, action: 'INVENTAIRE_VALIDATION', entite: 'inventaire', id,
      avant: { statut: 'brouillon' },
      apres: { statut: 'valide', date_inventaire: entete.date_inventaire, pv_sha256: r.pv_sha256,
        lignes: lignes.map((l) => ({ journal: l.journal_code, theorique: l.solde_theorique, constate: l.solde_constate, ecart: l.ecart })) } });
  });
  return detailInventaire(undefined, tenantId, id);
};

// POST /controle/inventaires/:id/reouverture  { motif }  (controle.reouvrir)
const rouvrirInventaire = async ({ tenantId, userId, id: brut, body = {} }) => {
  exigerClient(tenantId);
  const id = idInventaire(brut);
  const motif = txt(body.motif);
  if (!motif) throw new ErreurArrete(400, 'Le motif de réouverture est obligatoire.');
  if (motif.length > 500) throw new ErreurArrete(400, 'Motif trop long (500 caractères au plus).');
  await sequelize.transaction(async (transaction) => {
    const r = await lireInventaireBrut(transaction, tenantId, id, true);
    if (r.statut !== 'valide') throw new ErreurArrete(409, 'Cet inventaire n\'est pas validé : rien à rouvrir.');
    await X(`UPDATE inventaires SET statut = 'brouillon', valide_par = NULL, valide_le = NULL,
                    rouvert_par = :u, rouvert_le = NOW(), motif_reouverture = :motif, modifie_par = :u, modifie_le = NOW() WHERE id = :id`,
    { u: userId, motif, id }, { transaction });
    // Le solde théorique redevient calculé en direct tant que l'inventaire est rouvert.
    await X('UPDATE inventaires_lignes SET solde_theorique = NULL WHERE inventaire_id = :id', { id }, { transaction });
    await audit(transaction, { tenantId, userId, action: 'INVENTAIRE_REOUVERTURE', entite: 'inventaire', id,
      avant: { statut: 'valide', valide_par: r.valide_par, valide_le: r.valide_le }, apres: { statut: 'brouillon', motif } });
  });
  return detailInventaire(undefined, tenantId, id);
};

// DELETE /controle/inventaires/:id — brouillon uniquement (trace conservée dans audit_log).
const supprimerInventaire = async ({ tenantId, userId, id: brut }) => {
  exigerClient(tenantId);
  const id = idInventaire(brut);
  await sequelize.transaction(async (transaction) => {
    const r = await lireInventaireBrut(transaction, tenantId, id, true);
    exigerBrouillon(r);
    const lignes = await Q('SELECT journal_id, solde_constate, observation FROM inventaires_lignes WHERE inventaire_id = :id', { id }, { transaction });
    await X('DELETE FROM inventaires WHERE id = :id AND tenant_id = :t', { id, t: tenantId }, { transaction });
    await audit(transaction, { tenantId, userId, action: 'INVENTAIRE_SUPPRESSION', entite: 'inventaire', id,
      avant: { date_inventaire: dateIso(r.date_inventaire), libelle: r.libelle, pv_nom: r.pv_nom, pv_sha256: r.pv_sha256, lignes } });
  });
  return { id };
};

// ══ PV : contrôle à l'entrée, lecture authentifiée ═══════════════════════════
const preparerPv = (body) => {
  try { return pv.preparer(body); } catch (err) {
    if (err.status) throw new ErreurArrete(err.status, err.message);
    throw err;
  }
};

// GET /controle/pv/:objet/:id — :objet = arret (id du contrôle d'arrêté) | inventaire
const lirePv = async (tenantId, objet, idBrut) => {
  exigerClient(tenantId);
  const id = entier(idBrut, 'Identifiant');
  const table = { arret: 'controles_arrets', inventaire: 'inventaires' }[objet];
  if (!table) throw new ErreurArrete(404, 'Document inconnu.');
  const [r] = await Q(`SELECT pv_nom, pv_path, pv_mime, pv_sha256 FROM ${table} WHERE id = :id AND tenant_id = :t`, { id, t: tenantId });
  if (!r || !r.pv_path) throw new ErreurArrete(404, 'Aucun PV joint.');
  return { chemin: pv.cheminComplet(r.pv_path), nom: r.pv_nom, mime: r.pv_mime, sha256: r.pv_sha256 };
};

module.exports = {
  ErreurArrete, MOIS,
  listerArrets, saisirArret, deposerPvArret, validerArret, annulerValidationArret, arretValide,
  listerInventaires, lireInventaire, creerInventaire, modifierInventaire, deposerPvInventaire,
  validerInventaire, rouvrirInventaire, supprimerInventaire,
  lirePv, soldesAuDate,
};
