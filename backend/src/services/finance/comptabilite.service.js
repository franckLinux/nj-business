'use strict';
// NJ FINANCE — lot F2 : socle comptable (migration 075).
//
// Exercices et périodes, journaux comptables, écritures en partie double
// (brouillard → validée, extourne), grand livre et balance.
//
// Les règles qui protègent les comptes (équilibre, comptes de détail, tiers
// sur 40/41, période ouverte, numérotation sans trou, intangibilité d'une
// écriture validée, pas d'auto-validation) sont GARANTIES EN BASE par les
// triggers de la 075. Ce service les vérifie aussi en amont pour donner des
// messages clairs, et traduit les refus de la base en erreurs 400/409.
const { sequelize } = require('../../models');

const T = sequelize.QueryTypes;
const Q = (sql, replacements, opts = {}) => sequelize.query(sql, { replacements, type: T.SELECT, ...opts });
const X = (sql, replacements, opts = {}) => sequelize.query(sql, { replacements, ...opts });

class ErreurFinance extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Refus des triggers : « CODE: message » (check_violation) → 400 / 409.
const CODES_CONFLIT = new Set(['ECRITURE_INTANGIBLE', 'PERIODE_FERMEE', 'EXERCICE_CLOS', 'PERIODE_CLOTUREE',
  'EXERCICE_UTILISE', 'JOURNAL_UTILISE', 'PERIODE_UTILISEE']);
const traduire = (err) => {
  if (err instanceof ErreurFinance) return err;
  const code = err?.original?.code || err?.parent?.code;
  const msg = err?.original?.message || err?.parent?.message || err?.message || '';
  const m = /^([A-Z_]+): (.*)$/s.exec(msg);
  if (code === '23514' && m) return new ErreurFinance(CODES_CONFLIT.has(m[1]) ? 409 : 400, m[2]);
  if (code === '23505') {
    if (/uq_fin_exercices_code/.test(msg)) return new ErreurFinance(409, 'Ce code d\'exercice existe déjà.');
    if (/uq_fin_journaux_code/.test(msg)) return new ErreurFinance(409, 'Ce code de journal existe déjà.');
    if (/uq_fin_ecritures_extourne/.test(msg)) return new ErreurFinance(409, 'Cette écriture a déjà été extournée.');
    return new ErreurFinance(409, 'Modification concurrente : rechargez la page et recommencez.');
  }
  if (code === '23514') return new ErreurFinance(400, 'Donnée refusée par les règles de la base.');
  return err;
};
const enTransaction = async (fn) => {
  try { return await sequelize.transaction(fn); } catch (err) { throw traduire(err); }
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dateValide = (d) => typeof d === 'string' && ISO.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`))
  && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
const exigerDate = (d, quoi) => {
  if (!dateValide(d)) throw new ErreurFinance(400, `${quoi} : date invalide (AAAA-MM-JJ attendu).`);
  return d;
};
const entierPositif = (v, quoi) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ErreurFinance(400, `${quoi} invalide.`);
  return n;
};
const texte = (v, max, quoi, { obligatoire = false } = {}) => {
  const s = String(v ?? '').trim();
  if (obligatoire && !s) throw new ErreurFinance(400, `${quoi} : champ obligatoire.`);
  if (s.length > max) throw new ErreurFinance(400, `${quoi} : ${max} caractères au plus.`);
  return s;
};
// Montant en FCFA (deux décimales au plus), renvoyé en centimes entiers pour les sommes exactes.
const centimes = (v, quoi) => {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw new ErreurFinance(400, `${quoi} : montant invalide.`);
  const c = Math.round(n * 100);
  if (Math.abs(c - n * 100) > 1e-6) throw new ErreurFinance(400, `${quoi} : deux décimales au plus.`);
  if (c > 1e17) throw new ErreurFinance(400, `${quoi} : montant trop élevé.`);
  return c;
};
const montant = (c) => (c / 100).toFixed(2);
const numeroAffiche = (e) => (e.numero ? `${e.journal_code}-${e.exercice_code}-${String(e.numero).padStart(5, '0')}` : null);

// ── Exercices et périodes ───────────────────────────────────────────────────
const periodesMensuelles = (debut, fin) => {
  const out = [];
  let d = new Date(`${debut}T00:00:00Z`);
  const f = new Date(`${fin}T00:00:00Z`);
  let n = 1;
  while (d <= f) {
    const finMois = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    const fp = finMois < f ? finMois : f;
    out.push({ numero: n, date_debut: d.toISOString().slice(0, 10), date_fin: fp.toISOString().slice(0, 10) });
    d = new Date(Date.UTC(fp.getUTCFullYear(), fp.getUTCMonth(), fp.getUTCDate() + 1));
    n += 1;
  }
  return out;
};

const listerExercices = async (tenantId) => {
  const exercices = await Q(
    `SELECT e.id, e.code, e.date_debut, e.date_fin, e.statut, e.cree_le, e.cloture_le,
            (SELECT count(*)::int FROM fin_ecritures x WHERE x.exercice_id = e.id) AS nb_ecritures,
            (SELECT count(*)::int FROM fin_ecritures x WHERE x.exercice_id = e.id AND x.statut = 'brouillard') AS nb_brouillard
       FROM fin_exercices e WHERE e.tenant_id = :tenantId ORDER BY e.date_debut DESC`, { tenantId });
  const periodes = await Q(
    `SELECT p.id, p.exercice_id, p.numero, p.date_debut, p.date_fin, p.statut, p.modifie_le,
            u.username AS modifie_par_nom,
            (SELECT count(*)::int FROM fin_ecritures x WHERE x.periode_id = p.id) AS nb_ecritures,
            (SELECT count(*)::int FROM fin_ecritures x WHERE x.periode_id = p.id AND x.statut = 'brouillard') AS nb_brouillard
       FROM fin_periodes p LEFT JOIN users u ON u.id = p.modifie_par
      WHERE p.tenant_id = :tenantId ORDER BY p.date_debut`, { tenantId });
  return exercices.map((e) => ({ ...e, periodes: periodes.filter((p) => String(p.exercice_id) === String(e.id)) }));
};

// Proposition pour le premier exercice : dates de l'entité, sinon année civile en cours.
const propositionExercice = async (tenantId) => {
  const [t] = await Q('SELECT exercice_debut, exercice_fin FROM tenants WHERE id = :tenantId', { tenantId });
  const [dernier] = await Q('SELECT date_fin FROM fin_exercices WHERE tenant_id = :tenantId ORDER BY date_fin DESC LIMIT 1', { tenantId });
  let debut; let fin;
  if (dernier) {
    const d = new Date(`${String(dernier.date_fin).slice(0, 10)}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    debut = d.toISOString().slice(0, 10);
    const f = new Date(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate() - 1));
    fin = f.toISOString().slice(0, 10);
  } else if (t?.exercice_debut && t?.exercice_fin) {
    debut = String(t.exercice_debut).slice(0, 10); fin = String(t.exercice_fin).slice(0, 10);
  } else {
    const an = new Date().getUTCFullYear();
    debut = `${an}-01-01`; fin = `${an}-12-31`;
  }
  return { code: debut.slice(0, 4) === fin.slice(0, 4) ? debut.slice(0, 4) : `${debut.slice(0, 4)}-${fin.slice(2, 4)}`, date_debut: debut, date_fin: fin };
};

const creerExercice = async ({ tenantId, userId, body }) => {
  const code = texte(body.code, 12, 'Code de l\'exercice', { obligatoire: true });
  if (!/^[A-Za-z0-9_.-]{1,12}$/.test(code)) throw new ErreurFinance(400, 'Code de l\'exercice : lettres, chiffres, tiret ou point (12 au plus).');
  const debut = exigerDate(body.date_debut, 'Début de l\'exercice');
  const fin = exigerDate(body.date_fin, 'Fin de l\'exercice');
  if (fin <= debut) throw new ErreurFinance(400, 'La fin de l\'exercice doit suivre son début.');
  const periodes = periodesMensuelles(debut, fin);
  if (periodes.length > 24) throw new ErreurFinance(400, 'Un exercice dure 24 mois au plus.');
  return enTransaction(async (transaction) => {
    const [[ex]] = await X(
      `INSERT INTO fin_exercices (tenant_id, code, date_debut, date_fin, cree_par)
       VALUES (:tenantId, :code, :debut, :fin, :userId) RETURNING id`,
      { tenantId, code, debut, fin, userId }, { transaction });
    for (const p of periodes) {
      await X(`INSERT INTO fin_periodes (tenant_id, exercice_id, numero, date_debut, date_fin)
               VALUES (:tenantId, :ex, :numero, :d, :f)`,
      { tenantId, ex: ex.id, numero: p.numero, d: p.date_debut, f: p.date_fin }, { transaction });
    }
    return { id: ex.id, nb_periodes: periodes.length };
  });
};

const changerStatutPeriode = async ({ tenantId, userId, periodeId, statut }) => {
  if (!['ouverte', 'verrouillee'].includes(statut)) throw new ErreurFinance(400, 'Statut de période invalide (ouverte ou verrouillee).');
  const id = entierPositif(periodeId, 'Période');
  return enTransaction(async (transaction) => {
    const [p] = await Q('SELECT id, statut FROM fin_periodes WHERE id = :id AND tenant_id = :tenantId FOR UPDATE',
      { id, tenantId }, { transaction });
    if (!p) throw new ErreurFinance(404, 'Période introuvable.');
    if (p.statut === statut) return { id, statut };
    await X('UPDATE fin_periodes SET statut = :statut, modifie_par = :userId, modifie_le = NOW() WHERE id = :id',
      { statut, userId, id }, { transaction });
    return { id, statut };
  });
};

// ── Journaux comptables ─────────────────────────────────────────────────────
const TYPES_JOURNAL = {
  achats: 'Achats', ventes: 'Ventes', tresorerie: 'Trésorerie', od: 'Opérations diverses', an: 'À-nouveaux', inventaire: 'Inventaire',
};
const listerJournaux = async (tenantId) => Q(
  `SELECT fj.id, fj.code, fj.intitule, fj.type, fj.actif, fj.journal_tresorerie_id,
          j.code AS caisse_code, j.nom AS caisse_nom, j.compte_tresorerie,
          (SELECT count(*)::int FROM fin_ecritures e WHERE e.journal_id = fj.id) AS nb_ecritures
     FROM fin_journaux fj LEFT JOIN journaux j ON j.id = fj.journal_tresorerie_id
    WHERE fj.tenant_id = :tenantId ORDER BY fj.actif DESC, fj.type, fj.code`, { tenantId });

const normCode = (v) => String(v ?? '').trim().toUpperCase();
const verifierCodeJournal = (code) => {
  if (!/^[A-Z0-9]{1,6}$/.test(code)) throw new ErreurFinance(400, 'Code du journal : 1 à 6 lettres ou chiffres.');
  return code;
};

const creerJournal = async ({ tenantId, userId, body }) => {
  const code = verifierCodeJournal(normCode(body.code));
  const intitule = texte(body.intitule, 80, 'Intitulé du journal', { obligatoire: true });
  const type = String(body.type || '');
  if (!TYPES_JOURNAL[type]) throw new ErreurFinance(400, 'Type de journal invalide.');
  const lien = body.journal_tresorerie_id ? entierPositif(body.journal_tresorerie_id, 'Journal de caisse') : null;
  if (lien && type !== 'tresorerie') throw new ErreurFinance(400, 'Seul un journal de trésorerie se rattache à un journal de caisse.');
  return enTransaction(async (transaction) => {
    const [[j]] = await X(
      `INSERT INTO fin_journaux (tenant_id, code, intitule, type, journal_tresorerie_id, cree_par)
       VALUES (:tenantId, :code, :intitule, :type, :lien, :userId) RETURNING id`,
      { tenantId, code, intitule, type, lien, userId }, { transaction });
    return { id: j.id };
  });
};

const modifierJournal = async ({ tenantId, journalId, body }) => {
  const id = entierPositif(journalId, 'Journal');
  return enTransaction(async (transaction) => {
    const [j] = await Q('SELECT id, intitule, actif FROM fin_journaux WHERE id = :id AND tenant_id = :tenantId FOR UPDATE',
      { id, tenantId }, { transaction });
    if (!j) throw new ErreurFinance(404, 'Journal introuvable.');
    const intitule = body.intitule !== undefined ? texte(body.intitule, 80, 'Intitulé du journal', { obligatoire: true }) : j.intitule;
    const actif = body.actif !== undefined ? Boolean(body.actif) : j.actif;
    await X('UPDATE fin_journaux SET intitule = :intitule, actif = :actif WHERE id = :id', { intitule, actif, id }, { transaction });
    return { id, intitule, actif };
  });
};

// Journaux par défaut + un journal de trésorerie par journal de caisse actif.
// Idempotent : ce qui existe déjà (même code, ou caisse déjà rattachée) est conservé.
const JOURNAUX_DEFAUT = [
  { code: 'AN', intitule: 'À-nouveaux', type: 'an' },
  { code: 'OD', intitule: 'Opérations diverses', type: 'od' },
  { code: 'AC', intitule: 'Achats', type: 'achats' },
  { code: 'VT', intitule: 'Ventes', type: 'ventes' },
  { code: 'INV', intitule: 'Inventaire', type: 'inventaire' },
];
const initialiserJournaux = async ({ tenantId, userId }) => enTransaction(async (transaction) => {
  const existants = await Q('SELECT code, journal_tresorerie_id FROM fin_journaux WHERE tenant_id = :tenantId FOR UPDATE',
    { tenantId }, { transaction });
  const codes = new Set(existants.map((e) => e.code));
  const lies = new Set(existants.filter((e) => e.journal_tresorerie_id).map((e) => String(e.journal_tresorerie_id)));
  const crees = [];
  const ajouter = async (code, intitule, type, lien = null) => {
    await X(`INSERT INTO fin_journaux (tenant_id, code, intitule, type, journal_tresorerie_id, cree_par)
             VALUES (:tenantId, :code, :intitule, :type, :lien, :userId)`,
    { tenantId, code, intitule, type, lien, userId }, { transaction });
    codes.add(code); crees.push({ code, intitule, type });
  };
  for (const d of JOURNAUX_DEFAUT) if (!codes.has(d.code)) await ajouter(d.code, d.intitule, d.type);
  const caisses = await Q(
    `SELECT id, code, nom, code_journal_compta FROM journaux WHERE tenant_id = :tenantId AND actif ORDER BY ordre, id`,
    { tenantId }, { transaction });
  for (const c of caisses) {
    if (lies.has(String(c.id))) continue;
    let base = normCode(c.code_journal_compta || c.code).replace(/[^A-Z0-9]/g, '').slice(0, 6) || `TR${c.id}`.slice(0, 6);
    let code = base; let i = 2;
    while (codes.has(code)) { code = `${base.slice(0, 6 - String(i).length)}${i}`; i += 1; }
    await ajouter(code, texte(c.nom, 80, 'Intitulé') || code, 'tresorerie', c.id);
  }
  return { crees };
});

// ── Référentiels de saisie ──────────────────────────────────────────────────
const rechercherComptes = async (tenantId, q) => {
  const s = String(q ?? '').trim();
  const [t] = await Q('SELECT plan_initialise_le IS NOT NULL AS client FROM tenants WHERE id = :tenantId', { tenantId });
  const filtre = s ? `AND (compte LIKE :p OR intitule ILIKE :i)` : '';
  const rows = t?.client
    ? await Q(`SELECT c.compte, c.intitule,
                      NOT EXISTS (SELECT 1 FROM plan_comptable_client s WHERE s.tenant_id = c.tenant_id AND s.statut = 'actif'
                                    AND s.compte LIKE c.compte || '%' AND s.compte <> c.compte) AS detail
                 FROM plan_comptable_client c
                WHERE c.tenant_id = :tenantId AND c.statut = 'actif' ${filtre}
                ORDER BY c.compte LIMIT 40`, { tenantId, p: `${s}%`, i: `%${s}%` })
    : await Q(`SELECT c.compte, c.intitule,
                      NOT EXISTS (SELECT 1 FROM plan_comptable_syscohada s WHERE s.actif
                                    AND s.compte LIKE c.compte || '%' AND s.compte <> c.compte) AS detail
                 FROM plan_comptable_syscohada c WHERE c.actif ${filtre}
                ORDER BY c.compte LIMIT 40`, { p: `${s}%`, i: `%${s}%` });
  return rows;
};
const referentiels = async (tenantId) => {
  const [tiers, activites, journaux, exercices] = await Promise.all([
    Q(`SELECT id, nom, nui, type FROM registre_tiers WHERE tenant_id = :tenantId AND actif ORDER BY nom LIMIT 2000`, { tenantId }),
    Q(`SELECT id, code, nom, type FROM activites WHERE tenant_id = :tenantId AND actif ORDER BY type DESC, nom`, { tenantId }),
    Q(`SELECT id, code, intitule, type FROM fin_journaux WHERE tenant_id = :tenantId AND actif ORDER BY type, code`, { tenantId }),
    Q(`SELECT id, code, date_debut, date_fin, statut FROM fin_exercices WHERE tenant_id = :tenantId ORDER BY date_debut DESC`, { tenantId }),
  ]);
  return { tiers, activites, journaux, exercices, types_journal: TYPES_JOURNAL };
};

// ── Écritures ───────────────────────────────────────────────────────────────
const lireLignes = (body) => {
  const lignes = Array.isArray(body.lignes) ? body.lignes : [];
  if (lignes.length < 2) throw new ErreurFinance(400, 'Une écriture compte au moins deux lignes.');
  if (lignes.length > 500) throw new ErreurFinance(400, 'Une écriture compte 500 lignes au plus.');
  return lignes.map((l, i) => {
    const n = i + 1;
    const compte = texte(l.compte, 20, `Ligne ${n} : compte`, { obligatoire: true });
    const debit = centimes(l.debit, `Ligne ${n} : débit`);
    const credit = centimes(l.credit, `Ligne ${n} : crédit`);
    if ((debit > 0) === (credit > 0)) throw new ErreurFinance(400, `Ligne ${n} : saisissez un débit OU un crédit.`);
    return {
      ordre: n, compte, debit, credit,
      libelle: texte(l.libelle, 300, `Ligne ${n} : libellé`),
      tiers_id: l.tiers_id ? entierPositif(l.tiers_id, `Ligne ${n} : tiers`) : null,
      activite_id: l.activite_id ? entierPositif(l.activite_id, `Ligne ${n} : activité`) : null,
      echeance: l.echeance ? exigerDate(l.echeance, `Ligne ${n} : échéance`) : null,
    };
  });
};

const verifierComptes = async (tenantId, lignes, transaction) => {
  for (const l of lignes) {
    const [{ anomalie }] = await Q('SELECT fin_compte_anomalie(:tenantId, :compte) AS anomalie',
      { tenantId, compte: l.compte }, { transaction });
    if (anomalie) throw new ErreurFinance(400, `Ligne ${l.ordre} : ${anomalie}.`);
    if ((l.compte.startsWith('40') || l.compte.startsWith('41')) && !l.tiers_id) {
      throw new ErreurFinance(400, `Ligne ${l.ordre} : le compte ${l.compte} exige un tiers (client ou fournisseur).`);
    }
  }
};

const ecrireLignes = async (tenantId, ecritureId, lignes, transaction) => {
  for (const l of lignes) {
    await X(`INSERT INTO fin_ecriture_lignes (tenant_id, ecriture_id, ordre, compte, tiers_id, activite_id, libelle, debit, credit, echeance)
             VALUES (:tenantId, :ecritureId, :ordre, :compte, :tiers_id, :activite_id, :libelle, :debit, :credit, :echeance)`,
    { tenantId, ecritureId, ...l, debit: montant(l.debit), credit: montant(l.credit) }, { transaction });
  }
};

const entete = (body) => ({
  journal_id: entierPositif(body.journal_id, 'Journal'),
  date_ecriture: exigerDate(body.date_ecriture, 'Date de l\'écriture'),
  reference_piece: texte(body.reference_piece, 60, 'Référence de la pièce'),
  libelle: texte(body.libelle, 300, 'Libellé', { obligatoire: true }),
});

const creerEcriture = async ({ tenantId, userId, body }) => {
  const e = entete(body);
  const lignes = lireLignes(body);
  return enTransaction(async (transaction) => {
    await verifierComptes(tenantId, lignes, transaction);
    const [[ec]] = await X(
      `INSERT INTO fin_ecritures (tenant_id, exercice_id, periode_id, journal_id, date_ecriture, reference_piece, libelle, origine_type, cree_par)
       VALUES (:tenantId, 0, 0, :journal_id, :date_ecriture, :reference_piece, :libelle, 'manuelle', :userId) RETURNING id`,
      { tenantId, userId, ...e }, { transaction });
    await ecrireLignes(tenantId, ec.id, lignes, transaction);
    return { id: ec.id };
  });
};

const ecritureModifiable = async (tenantId, id, transaction) => {
  const [e] = await Q('SELECT id, statut, origine_type FROM fin_ecritures WHERE id = :id AND tenant_id = :tenantId FOR UPDATE',
    { id, tenantId }, { transaction });
  if (!e) throw new ErreurFinance(404, 'Écriture introuvable.');
  if (e.statut !== 'brouillard') throw new ErreurFinance(409, 'Une écriture validée ne se modifie pas ; passez une extourne.');
  if (e.origine_type !== 'manuelle') throw new ErreurFinance(409, 'Cette écriture est générée par une autre opération : corrigez l\'opération d\'origine.');
  return e;
};

const modifierEcriture = async ({ tenantId, ecritureId, body }) => {
  const id = entierPositif(ecritureId, 'Écriture');
  const e = entete(body);
  const lignes = lireLignes(body);
  return enTransaction(async (transaction) => {
    await ecritureModifiable(tenantId, id, transaction);
    await verifierComptes(tenantId, lignes, transaction);
    await X(`UPDATE fin_ecritures SET journal_id = :journal_id, date_ecriture = :date_ecriture,
                    reference_piece = :reference_piece, libelle = :libelle WHERE id = :id`, { id, ...e }, { transaction });
    await X('DELETE FROM fin_ecriture_lignes WHERE ecriture_id = :id', { id }, { transaction });
    await ecrireLignes(tenantId, id, lignes, transaction);
    return { id };
  });
};

const supprimerEcriture = async ({ tenantId, ecritureId }) => {
  const id = entierPositif(ecritureId, 'Écriture');
  return enTransaction(async (transaction) => {
    await ecritureModifiable(tenantId, id, transaction);
    await X('DELETE FROM fin_ecritures WHERE id = :id', { id }, { transaction });
    return { id, supprimee: true };
  });
};

const validerEcriture = async ({ tenantId, userId, ecritureId }) => {
  const id = entierPositif(ecritureId, 'Écriture');
  return enTransaction(async (transaction) => {
    const [e] = await Q('SELECT id, statut, cree_par, origine_type FROM fin_ecritures WHERE id = :id AND tenant_id = :tenantId FOR UPDATE',
      { id, tenantId }, { transaction });
    if (!e) throw new ErreurFinance(404, 'Écriture introuvable.');
    if (e.statut === 'validee') throw new ErreurFinance(409, 'Cette écriture est déjà validée.');
    if (e.origine_type === 'manuelle' && e.cree_par && String(e.cree_par) === String(userId)) {
      throw new ErreurFinance(403, 'Personne ne valide sa propre écriture : un autre utilisateur habilité doit la valider.');
    }
    await X(`UPDATE fin_ecritures SET statut = 'validee', valide_par = :userId WHERE id = :id`, { id, userId }, { transaction });
    const [v] = await Q('SELECT numero FROM fin_ecritures WHERE id = :id', { id }, { transaction });
    return { id, statut: 'validee', numero: v.numero };
  });
};

const extournerEcriture = async ({ tenantId, userId, ecritureId, body }) => {
  const id = entierPositif(ecritureId, 'Écriture');
  const date = exigerDate(body.date_ecriture, 'Date de l\'extourne');
  const motif = texte(body.motif, 500, 'Motif de l\'extourne', { obligatoire: true });
  if (motif.length < 5) throw new ErreurFinance(400, 'Motif de l\'extourne : précisez la raison (5 caractères au moins).');
  return enTransaction(async (transaction) => {
    const [o] = await Q(
      `SELECT e.id, e.statut, e.journal_id, e.date_ecriture, e.libelle, e.reference_piece, e.origine_type, e.extournee_par_id,
              e.numero, j.code AS journal_code, x.code AS exercice_code
         FROM fin_ecritures e JOIN fin_journaux j ON j.id = e.journal_id JOIN fin_exercices x ON x.id = e.exercice_id
        WHERE e.id = :id AND e.tenant_id = :tenantId FOR UPDATE OF e`, { id, tenantId }, { transaction });
    if (!o) throw new ErreurFinance(404, 'Écriture introuvable.');
    if (o.statut !== 'validee') throw new ErreurFinance(409, 'Seule une écriture validée s\'extourne ; un brouillard se modifie ou se supprime.');
    if (o.origine_type === 'extourne') throw new ErreurFinance(409, 'Une extourne ne s\'extourne pas : saisissez une nouvelle écriture.');
    if (o.extournee_par_id) throw new ErreurFinance(409, 'Cette écriture a déjà été extournée.');
    if (date < String(o.date_ecriture).slice(0, 10)) throw new ErreurFinance(400, 'L\'extourne ne peut pas précéder l\'écriture d\'origine.');
    const lignes = await Q('SELECT compte, tiers_id, activite_id, libelle, debit, credit, echeance FROM fin_ecriture_lignes WHERE ecriture_id = :id ORDER BY ordre, id',
      { id }, { transaction });
    const ref = numeroAffiche(o);
    const [[ex]] = await X(
      `INSERT INTO fin_ecritures (tenant_id, exercice_id, periode_id, journal_id, date_ecriture, reference_piece, libelle,
                                  origine_type, origine_id, extourne_de_id, motif_extourne, cree_par)
       VALUES (:tenantId, 0, 0, :journal, :date, :ref, :libelle, 'extourne', :id, :id, :motif, :userId) RETURNING id`,
      { tenantId, journal: o.journal_id, date, ref: (o.reference_piece || ref || '').slice(0, 60),
        libelle: `Extourne ${ref} — ${o.libelle}`.slice(0, 300), id, motif, userId }, { transaction });
    let n = 1;
    for (const l of lignes) {
      await X(`INSERT INTO fin_ecriture_lignes (tenant_id, ecriture_id, ordre, compte, tiers_id, activite_id, libelle, debit, credit, echeance)
               VALUES (:tenantId, :ec, :n, :compte, :tiers_id, :activite_id, :libelle, :debit, :credit, :echeance)`,
      { tenantId, ec: ex.id, n, ...l, debit: l.credit, credit: l.debit }, { transaction });
      n += 1;
    }
    await X(`UPDATE fin_ecritures SET statut = 'validee', valide_par = :userId WHERE id = :ex`, { ex: ex.id, userId }, { transaction });
    await X('UPDATE fin_ecritures SET extournee_par_id = :ex WHERE id = :id', { ex: ex.id, id }, { transaction });
    return { id: ex.id, extourne_de_id: id };
  });
};

const SELECT_ECRITURE = `
  SELECT e.id, e.exercice_id, e.periode_id, e.journal_id, e.numero, e.date_ecriture, e.reference_piece, e.libelle,
         e.statut, e.origine_type, e.origine_id, e.extourne_de_id, e.extournee_par_id, e.motif_extourne,
         e.cree_le, e.valide_le, j.code AS journal_code, j.intitule AS journal_intitule, j.type AS journal_type,
         x.code AS exercice_code, p.statut AS periode_statut,
         uc.username AS cree_par_nom, uv.username AS valide_par_nom, e.cree_par, e.valide_par,
         coalesce((SELECT sum(debit) FROM fin_ecriture_lignes l WHERE l.ecriture_id = e.id), 0) AS total_debit,
         coalesce((SELECT sum(credit) FROM fin_ecriture_lignes l WHERE l.ecriture_id = e.id), 0) AS total_credit
    FROM fin_ecritures e
    JOIN fin_journaux j ON j.id = e.journal_id
    JOIN fin_exercices x ON x.id = e.exercice_id
    JOIN fin_periodes p ON p.id = e.periode_id
    LEFT JOIN users uc ON uc.id = e.cree_par
    LEFT JOIN users uv ON uv.id = e.valide_par`;

const decorer = (e) => ({
  ...e, numero_affiche: numeroAffiche(e),
  equilibree: Number(e.total_debit) === Number(e.total_credit) && Number(e.total_debit) > 0,
});

const listerEcritures = async (tenantId, q = {}) => {
  const where = ['e.tenant_id = :tenantId'];
  const r = { tenantId };
  if (q.exercice_id) { where.push('e.exercice_id = :exercice_id'); r.exercice_id = entierPositif(q.exercice_id, 'Exercice'); }
  if (q.journal_id) { where.push('e.journal_id = :journal_id'); r.journal_id = entierPositif(q.journal_id, 'Journal'); }
  if (q.statut) {
    if (!['brouillard', 'validee'].includes(q.statut)) throw new ErreurFinance(400, 'Statut invalide.');
    where.push('e.statut = :statut'); r.statut = q.statut;
  }
  if (q.date_du) { where.push('e.date_ecriture >= :du'); r.du = exigerDate(q.date_du, 'Date de début'); }
  if (q.date_au) { where.push('e.date_ecriture <= :au'); r.au = exigerDate(q.date_au, 'Date de fin'); }
  if (q.recherche) {
    where.push(`(e.libelle ILIKE :rech OR e.reference_piece ILIKE :rech
                 OR EXISTS (SELECT 1 FROM fin_ecriture_lignes l WHERE l.ecriture_id = e.id AND (l.compte LIKE :rechc OR l.libelle ILIKE :rech)))`);
    r.rech = `%${String(q.recherche).trim().slice(0, 80)}%`; r.rechc = `${String(q.recherche).trim().slice(0, 20)}%`;
  }
  const taille = Math.min(Math.max(Number(q.taille) || 50, 10), 200);
  const page = Math.max(Number(q.page) || 1, 1);
  const tri = q.tri === 'ancien' ? 'e.date_ecriture, e.id' : 'e.date_ecriture DESC, e.id DESC';
  const [{ total, nb_brouillard: nbBrouillard }] = await Q(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE e.statut = 'brouillard')::int AS nb_brouillard
       FROM fin_ecritures e WHERE ${where.join(' AND ')}`, r);
  const rows = await Q(`${SELECT_ECRITURE} WHERE ${where.join(' AND ')} ORDER BY ${tri} LIMIT :taille OFFSET :offset`,
    { ...r, taille, offset: (page - 1) * taille });
  return { total, nb_brouillard: nbBrouillard, page, taille, ecritures: rows.map(decorer) };
};

const lireEcriture = async (tenantId, ecritureId) => {
  const id = entierPositif(ecritureId, 'Écriture');
  const [e] = await Q(`${SELECT_ECRITURE} WHERE e.id = :id AND e.tenant_id = :tenantId`, { id, tenantId });
  if (!e) throw new ErreurFinance(404, 'Écriture introuvable.');
  const [t] = await Q('SELECT plan_initialise_le IS NOT NULL AS client FROM tenants WHERE id = :tenantId', { tenantId });
  const lignes = await Q(
    `SELECT l.id, l.ordre, l.compte, l.tiers_id, l.activite_id, l.libelle, l.debit, l.credit, l.echeance,
            rt.nom AS tiers_nom, a.nom AS activite_nom,
            ${t?.client
    ? '(SELECT c.intitule FROM plan_comptable_client c WHERE c.tenant_id = l.tenant_id AND c.compte = l.compte LIMIT 1)'
    : '(SELECT c.intitule FROM plan_comptable_syscohada c WHERE c.compte = l.compte LIMIT 1)'} AS compte_intitule
       FROM fin_ecriture_lignes l
       LEFT JOIN registre_tiers rt ON rt.id = l.tiers_id
       LEFT JOIN activites a ON a.id = l.activite_id
      WHERE l.ecriture_id = :id ORDER BY l.ordre, l.id`, { id });
  const liees = await Q(
    `SELECT e.id, e.numero, j.code AS journal_code, x.code AS exercice_code, e.date_ecriture
       FROM fin_ecritures e JOIN fin_journaux j ON j.id = e.journal_id JOIN fin_exercices x ON x.id = e.exercice_id
      WHERE e.id IN (:a, :b)`, { a: e.extourne_de_id || 0, b: e.extournee_par_id || 0 });
  const lien = (lid) => { const x = liees.find((y) => String(y.id) === String(lid)); return x ? { id: x.id, numero_affiche: numeroAffiche(x), date_ecriture: x.date_ecriture } : null; };
  return { ...decorer(e), lignes, extourne_de: lien(e.extourne_de_id), extournee_par: lien(e.extournee_par_id) };
};

// ── États : grand livre et balance ──────────────────────────────────────────
const filtreEtat = (tenantId, q) => {
  const r = { tenantId };
  const where = ['l.tenant_id = :tenantId'];
  r.exercice_id = entierPositif(q.exercice_id, 'Exercice');
  where.push('e.exercice_id = :exercice_id');
  if (!(q.brouillard === 'true' || q.brouillard === true)) where.push(`e.statut = 'validee'`);
  if (q.compte_du) { where.push('l.compte >= :cdu'); r.cdu = String(q.compte_du).trim(); }
  if (q.compte_au) { where.push(`l.compte <= :cau`); r.cau = `${String(q.compte_au).trim()}￿`; }
  if (q.classe) {
    if (!/^[1-9]$/.test(String(q.classe))) throw new ErreurFinance(400, 'Classe invalide.');
    where.push('l.compte LIKE :classe'); r.classe = `${q.classe}%`;
  }
  if (q.tiers_id) { where.push('l.tiers_id = :tiers'); r.tiers = entierPositif(q.tiers_id, 'Tiers'); }
  if (q.activite_id) { where.push('l.activite_id = :activite'); r.activite = entierPositif(q.activite_id, 'Activité'); }
  if (q.journal_id) { where.push('e.journal_id = :journal'); r.journal = entierPositif(q.journal_id, 'Journal'); }
  return { where, r };
};
const intituleSql = async (tenantId) => {
  const [t] = await Q('SELECT plan_initialise_le IS NOT NULL AS client FROM tenants WHERE id = :tenantId', { tenantId });
  return t?.client
    ? '(SELECT c.intitule FROM plan_comptable_client c WHERE c.tenant_id = :tenantId AND c.compte = b.compte LIMIT 1)'
    : '(SELECT c.intitule FROM plan_comptable_syscohada c WHERE c.compte = b.compte LIMIT 1)';
};
const exerciceDuClient = async (tenantId, id) => {
  const [x] = await Q('SELECT id, code, date_debut, date_fin, statut FROM fin_exercices WHERE id = :id AND tenant_id = :tenantId', { id, tenantId });
  if (!x) throw new ErreurFinance(404, 'Exercice introuvable.');
  return x;
};

// Balance : totaux et soldes par compte sur la période ; « report » = mouvements
// de l'exercice antérieurs à la date de début choisie (dont les à-nouveaux).
const balance = async (tenantId, q = {}) => {
  const { where, r } = filtreEtat(tenantId, q);
  const ex = await exerciceDuClient(tenantId, r.exercice_id);
  const du = q.date_du ? exigerDate(q.date_du, 'Date de début') : String(ex.date_debut).slice(0, 10);
  const au = q.date_au ? exigerDate(q.date_au, 'Date de fin') : String(ex.date_fin).slice(0, 10);
  const rows = await Q(
    `SELECT b.compte, ${await intituleSql(tenantId)} AS intitule,
            b.report_debit, b.report_credit, b.debit, b.credit
       FROM (SELECT l.compte,
                    coalesce(sum(l.debit)  FILTER (WHERE e.date_ecriture < :du), 0) AS report_debit,
                    coalesce(sum(l.credit) FILTER (WHERE e.date_ecriture < :du), 0) AS report_credit,
                    coalesce(sum(l.debit)  FILTER (WHERE e.date_ecriture BETWEEN :du AND :au), 0) AS debit,
                    coalesce(sum(l.credit) FILTER (WHERE e.date_ecriture BETWEEN :du AND :au), 0) AS credit
               FROM fin_ecriture_lignes l JOIN fin_ecritures e ON e.id = l.ecriture_id
              WHERE ${where.join(' AND ')} AND e.date_ecriture <= :au
              GROUP BY l.compte) b
      ORDER BY b.compte`, { ...r, du, au });
  const c = (v) => Math.round(Number(v) * 100);
  const tot = { report_debit: 0, report_credit: 0, debit: 0, credit: 0, solde_debiteur: 0, solde_crediteur: 0 };
  const comptes = rows.map((x) => {
    const solde = c(x.report_debit) + c(x.debit) - c(x.report_credit) - c(x.credit);
    const o = {
      compte: x.compte, intitule: x.intitule || '',
      report_debit: c(x.report_debit), report_credit: c(x.report_credit), debit: c(x.debit), credit: c(x.credit),
      solde_debiteur: solde > 0 ? solde : 0, solde_crediteur: solde < 0 ? -solde : 0,
    };
    for (const k of Object.keys(tot)) tot[k] += o[k];
    return o;
  });
  const enMontant = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? montant(v) : v]));
  const [{ nb }] = await Q(`SELECT count(*)::int AS nb FROM fin_ecritures WHERE tenant_id = :tenantId AND exercice_id = :ex AND statut = 'brouillard'`,
    { tenantId, ex: ex.id });
  return {
    exercice: ex, date_du: du, date_au: au, inclut_brouillard: q.brouillard === 'true' || q.brouillard === true,
    nb_brouillard_exercice: nb,
    equilibree: tot.debit === tot.credit && tot.report_debit === tot.report_credit && tot.solde_debiteur === tot.solde_crediteur,
    comptes: comptes.map(enMontant), totaux: enMontant(tot),
  };
};

// Grand livre : lignes par compte avec solde progressif, à partir du report.
const grandLivre = async (tenantId, q = {}) => {
  const { where, r } = filtreEtat(tenantId, q);
  const ex = await exerciceDuClient(tenantId, r.exercice_id);
  const du = q.date_du ? exigerDate(q.date_du, 'Date de début') : String(ex.date_debut).slice(0, 10);
  const au = q.date_au ? exigerDate(q.date_au, 'Date de fin') : String(ex.date_fin).slice(0, 10);
  const reports = await Q(
    `SELECT l.compte, coalesce(sum(l.debit), 0) AS debit, coalesce(sum(l.credit), 0) AS credit
       FROM fin_ecriture_lignes l JOIN fin_ecritures e ON e.id = l.ecriture_id
      WHERE ${where.join(' AND ')} AND e.date_ecriture < :du GROUP BY l.compte`, { ...r, du });
  const LIMITE = 5000;
  const lignes = await Q(
    `SELECT l.compte, l.libelle AS ligne_libelle, l.debit, l.credit, l.tiers_id, rt.nom AS tiers_nom, a.nom AS activite_nom,
            e.id AS ecriture_id, e.date_ecriture, e.numero, e.libelle, e.reference_piece, e.statut,
            j.code AS journal_code, x.code AS exercice_code
       FROM fin_ecriture_lignes l
       JOIN fin_ecritures e ON e.id = l.ecriture_id
       JOIN fin_journaux j ON j.id = e.journal_id
       JOIN fin_exercices x ON x.id = e.exercice_id
       LEFT JOIN registre_tiers rt ON rt.id = l.tiers_id
       LEFT JOIN activites a ON a.id = l.activite_id
      WHERE ${where.join(' AND ')} AND e.date_ecriture BETWEEN :du AND :au
      ORDER BY l.compte, e.date_ecriture, j.code, e.numero NULLS LAST, e.id, l.ordre
      LIMIT ${LIMITE + 1}`, { ...r, du, au });
  const tronque = lignes.length > LIMITE;
  if (tronque) lignes.pop();
  const intitules = new Map((await Q(
    `SELECT DISTINCT b.compte, ${await intituleSql(tenantId)} AS intitule
       FROM (SELECT DISTINCT l.compte FROM fin_ecriture_lignes l WHERE l.tenant_id = :tenantId) b`, { tenantId }))
    .map((x) => [x.compte, x.intitule || '']));
  const c = (v) => Math.round(Number(v) * 100);
  const parCompte = new Map();
  const comptePour = (compte) => {
    if (!parCompte.has(compte)) {
      const rep = reports.find((x) => x.compte === compte);
      const rd = rep ? c(rep.debit) : 0; const rc = rep ? c(rep.credit) : 0;
      parCompte.set(compte, { compte, intitule: intitules.get(compte) || '', report_debit: rd, report_credit: rc, debit: 0, credit: 0, solde: rd - rc, lignes: [] });
    }
    return parCompte.get(compte);
  };
  for (const rep of reports) comptePour(rep.compte);
  for (const l of lignes) {
    const g = comptePour(l.compte);
    g.debit += c(l.debit); g.credit += c(l.credit); g.solde += c(l.debit) - c(l.credit);
    g.lignes.push({
      ecriture_id: l.ecriture_id, date_ecriture: l.date_ecriture, journal_code: l.journal_code,
      numero_affiche: numeroAffiche(l), reference_piece: l.reference_piece, libelle: l.ligne_libelle || l.libelle,
      tiers_nom: l.tiers_nom, activite_nom: l.activite_nom, statut: l.statut,
      debit: l.debit, credit: l.credit, solde: montant(g.solde),
    });
  }
  const comptes = [...parCompte.values()].sort((a, b) => a.compte.localeCompare(b.compte)).map((g) => ({
    ...g, report_debit: montant(g.report_debit), report_credit: montant(g.report_credit),
    debit: montant(g.debit), credit: montant(g.credit), solde: montant(g.solde),
  }));
  return { exercice: ex, date_du: du, date_au: au, tronque, limite: LIMITE, comptes };
};

module.exports = {
  ErreurFinance, traduire, TYPES_JOURNAL, periodesMensuelles,
  listerExercices, propositionExercice, creerExercice, changerStatutPeriode,
  listerJournaux, creerJournal, modifierJournal, initialiserJournaux,
  rechercherComptes, referentiels,
  listerEcritures, lireEcriture, creerEcriture, modifierEcriture, supprimerEcriture, validerEcriture, extournerEcriture,
  balance, grandLivre,
};
