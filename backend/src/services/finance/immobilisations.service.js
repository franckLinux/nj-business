'use strict';
// NJ FINANCE — lot F10 : tableau des immobilisations (migration 084, 26/11/2026).
//
// Décision de Franck : « juste un tableau d'immobilisation » (le stock reste dans
// NJ COMMERCIAL). Registre, plan d'amortissement et tableau par exercice ; rien
// n'est comptabilisé ici (les dotations viendront avec la clôture, lot F11).
//
// Règles de calcul (choix par défaut, réglables plus tard si Franck le souhaite) :
//   • amortissement LINÉAIRE : annuité = valeur d'origine ÷ durée ;
//   • PRORATA TEMPORIS en jours, année de 360 jours (mois de 30 jours), à partir
//     de la date de mise en service, et jusqu'à la date de sortie ;
//   • montants arrondis au franc ; la dernière annuité solde exactement ;
//   • un terrain (catégorie non amortissable) n'est pas amorti ;
//   • reprise d'un bien ancien : amortissements déjà pratiqués à une date, la
//     suite du plan part du lendemain ;
//   • exercice = année civile.
const { sequelize } = require('../../models');
const { premierDetail, ErreurConfig } = require('./config.service');

const T = sequelize.QueryTypes;
const Q = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: T.SELECT, transaction });
const X = (sql, replacements, transaction) => sequelize.query(sql, { replacements, transaction });

class ErreurImmo extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const traduire = (err) => {
  if (err instanceof ErreurImmo) return err;
  if (err instanceof ErreurConfig) return new ErreurImmo(err.status, err.message);
  const code = err?.original?.code || err?.parent?.code;
  const msg = err?.original?.message || err?.parent?.message || '';
  const m = /^([A-Z_]+): (.*)$/s.exec(msg);
  if (code === '23514' && m) return new ErreurImmo(400, m[2]);
  if (code === '23505') return new ErreurImmo(409, /facture/.test(msg) ? 'Cette facture a déjà sa fiche d\'immobilisation.' : 'Ce code existe déjà.');
  if (code === '23514') return new ErreurImmo(400, 'Donnée refusée par les règles de la base (dates, montants ou statut incohérents).');
  return err;
};
const enTransaction = async (fn) => { try { return await sequelize.transaction(fn); } catch (e) { throw traduire(e); } };

const txt = (v, max, quoi, { obligatoire = false } = {}) => {
  const s = String(v ?? '').trim();
  if (obligatoire && !s) throw new ErreurImmo(400, `${quoi} : obligatoire.`);
  if (s.length > max) throw new ErreurImmo(400, `${quoi} : ${max} caractères au plus.`);
  return s;
};
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const date = (v, quoi, { obligatoire = false } = {}) => {
  const s = String(v ?? '').trim();
  if (!s) { if (obligatoire) throw new ErreurImmo(400, `${quoi} : obligatoire.`); return null; }
  if (!ISO.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`)) || new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) !== s) {
    throw new ErreurImmo(400, `${quoi} invalide.`);
  }
  return s;
};
const montant = (v, quoi, { min = 0, strict = false, obligatoire = true } = {}) => {
  if ((v === null || v === undefined || String(v).trim() === '') && !obligatoire) return null;
  const n = Number(String(v ?? '').replace(/[\s  ]/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < min || (strict && n <= min)) throw new ErreurImmo(400, `${quoi} invalide.`);
  return Math.round(n * 100) / 100;
};
const idOuNull = (v, quoi) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ErreurImmo(400, `${quoi} invalide.`);
  return n;
};
const compte = async (tenantId, v, quoi, prefixe, transaction) => {
  const c = String(v ?? '').trim();
  if (!c.startsWith(prefixe)) throw new ErreurImmo(400, `${quoi} : le compte doit commencer par ${prefixe}.`);
  const [{ a }] = await Q('SELECT fin_compte_anomalie(:tenantId, :c) AS a', { tenantId, c }, transaction);
  if (a) throw new ErreurImmo(400, `${quoi} : ${a}.`);
  return c;
};

// ── Calcul ──────────────────────────────────────────────────────────────────
/** Jours de `a` à `b` inclus, année de 360 jours (mois de 30 jours). */
const jours360 = (a, b) => {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  const fin = (y, m, d) => (d === 31 || (m === 2 && d >= new Date(Date.UTC(y, 2, 0)).getUTCDate()) ? 30 : d);
  return (y2 - y1) * 360 + (m2 - m1) * 30 + (fin(y2, m2, d2) - Math.min(d1, 30)) + 1;
};
const lendemain = (s) => new Date(Date.parse(`${s}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

/**
 * Plan d'amortissement linéaire : [{ annee, debut, fin, jours, base, dotation, cumul, vnc }].
 * S'arrête à la sortie du bien ou quand tout est amorti.
 */
const plan = (i) => {
  const vo = Number(i.valeur_origine);
  if (!i.amortissable || !Number(i.duree_annees)) return [];
  const annuite = vo / Number(i.duree_annees);
  const anterieurs = Number(i.amort_anterieurs) || 0;
  let cumul = anterieurs;
  let depart = anterieurs > 0 ? lendemain(String(i.amort_anterieurs_au).slice(0, 10)) : String(i.date_mise_service).slice(0, 10);
  const sortie = i.date_sortie ? String(i.date_sortie).slice(0, 10) : null;
  const lignes = [];
  let annee = Number(depart.slice(0, 4));
  while (cumul < vo - 0.004 && annee < 2200) {
    const debut = depart > `${annee}-01-01` ? depart : `${annee}-01-01`;
    let fin = `${annee}-12-31`;
    if (sortie && sortie < fin) fin = sortie;
    if (sortie && sortie < debut) break;
    const j = jours360(debut, fin);
    let dot = Math.round((annuite * j) / 360);
    if (dot > vo - cumul) dot = Math.round((vo - cumul) * 100) / 100;
    // Dernier exercice théorique : on solde l'arrondi.
    if (vo - cumul - dot < 1) dot = Math.round((vo - cumul) * 100) / 100;
    cumul = Math.round((cumul + dot) * 100) / 100;
    lignes.push({ annee, debut, fin, jours: j, base: vo, dotation: dot, cumul, vnc: Math.round((vo - cumul) * 100) / 100 });
    if (sortie && sortie <= fin) break;
    annee += 1;
  }
  return lignes;
};
const cumulFin = (p, annee, i) => {
  const avant = p.filter((l) => l.annee <= annee);
  if (avant.length) return avant[avant.length - 1].cumul;
  return Number(i.amort_anterieurs) || 0;
};

// ── Catégories ──────────────────────────────────────────────────────────────
// Racines SYSCOHADA révisé (le plan SYCEBNL reprend la même classe 2).
const CATEGORIES_DEFAUT = [
  { code: 'LOGICIEL', libelle: 'Logiciels et licences', immo: ['2183', '213', '21'], amort: ['2818', '2813', '281'], dot: ['6812', '681'], duree: 3 },
  { code: 'TERRAIN', libelle: 'Terrains', immo: ['22'], amortissable: false },
  { code: 'BATIMENT', libelle: 'Bâtiments', immo: ['231', '23'], amort: ['2831', '283'], dot: ['6813', '681'], duree: 20 },
  { code: 'AGENCEMENT', libelle: 'Aménagements, agencements et installations', immo: ['234', '235', '23'], amort: ['2834', '2835', '283'], dot: ['6813', '681'], duree: 10 },
  { code: 'MATERIEL', libelle: 'Matériel et outillage', immo: ['241', '24'], amort: ['2841', '284'], dot: ['6813', '681'], duree: 5 },
  { code: 'MOBILIER', libelle: 'Mobilier de bureau', immo: ['2444', '2441', '244'], amort: ['2844', '284'], dot: ['6813', '681'], duree: 10 },
  { code: 'INFORMATIQUE', libelle: 'Matériel informatique', immo: ['2442', '244'], amort: ['2844', '284'], dot: ['6813', '681'], duree: 3 },
  { code: 'TRANSPORT', libelle: 'Matériel de transport', immo: ['245'], amort: ['2845', '284'], dot: ['6813', '681'], duree: 4 },
];

const initialiserCategories = async ({ tenantId, userId }) => enTransaction(async (t) => {
  const creees = []; const anomalies = [];
  let ordre = 0;
  const premier = async (racines) => {
    for (const r of racines) { const c = await premierDetail(tenantId, r, t); if (c) return c; }
    return '';
  };
  for (const c of CATEGORIES_DEFAUT) {
    ordre += 1;
    const [existe] = await Q('SELECT id FROM fin_immo_categories WHERE tenant_id = :tenantId AND code = :code', { tenantId, code: c.code }, t);
    if (existe) continue;
    const amortissable = c.amortissable !== false;
    const ci = await premier(c.immo);
    const ca = amortissable ? await premier(c.amort) : null;
    const cd = amortissable ? await premier(c.dot) : null;
    if (!ci || (amortissable && (!ca || !cd))) {
      anomalies.push(`${c.libelle} : comptes ${[c.immo[0], c.amort?.[0], c.dot?.[0]].filter(Boolean).join(' / ')} absents du plan comptable.`);
      continue;
    }
    await X(`INSERT INTO fin_immo_categories (tenant_id, code, libelle, compte_immo, compte_amort, compte_dotation, amortissable, duree_defaut, ordre, modifie_par)
             VALUES (:tenantId, :code, :libelle, :ci, :ca, :cd, :amortissable, :duree, :ordre, :userId)`,
    { tenantId, code: c.code, libelle: c.libelle, ci, ca, cd, amortissable, duree: c.duree || null, ordre, userId }, t);
    creees.push(c.code);
  }
  return { creees, anomalies };
});

const listerCategories = (tenantId) => Q(
  `SELECT c.id::text AS id, c.code, c.libelle, c.compte_immo, c.compte_amort, c.compte_dotation, c.amortissable, c.duree_defaut, c.actif,
          (SELECT count(*)::int FROM fin_immobilisations i WHERE i.categorie_id = c.id) AS nb
     FROM fin_immo_categories c WHERE c.tenant_id = :tenantId ORDER BY c.ordre, c.libelle`, { tenantId });

const enregistrerCategorie = async ({ tenantId, userId, id, body }) => enTransaction(async (t) => {
  const b = body || {};
  const amortissable = b.amortissable !== false;
  const v = {
    code: String(b.code ?? '').trim().toUpperCase(),
    libelle: txt(b.libelle, 120, 'Libellé', { obligatoire: true }),
    ci: await compte(tenantId, b.compte_immo, 'Compte d\'immobilisation', '2', t),
    ca: amortissable ? await compte(tenantId, b.compte_amort, 'Compte d\'amortissement', '28', t) : null,
    cd: amortissable ? await compte(tenantId, b.compte_dotation, 'Compte de dotation', '68', t) : null,
    duree: amortissable ? montant(b.duree_defaut, 'Durée', { min: 0, strict: true }) : null,
    amortissable, actif: b.actif !== false, tenantId, userId,
  };
  if (!/^[A-Z0-9_]{2,20}$/.test(v.code)) throw new ErreurImmo(400, 'Code : 2 à 20 lettres majuscules, chiffres ou tiret bas.');
  if (id) {
    const [, r] = await X(`UPDATE fin_immo_categories SET code = :code, libelle = :libelle, compte_immo = :ci, compte_amort = :ca, compte_dotation = :cd,
                                  amortissable = :amortissable, duree_defaut = :duree, actif = :actif, modifie_par = :userId, modifie_le = NOW()
                            WHERE id = :id AND tenant_id = :tenantId`, { ...v, id: idOuNull(id, 'Catégorie') }, t);
    if (!r?.rowCount) throw new ErreurImmo(404, 'Catégorie introuvable.');
    return { id: String(id) };
  }
  const [[c]] = await X(`INSERT INTO fin_immo_categories (tenant_id, code, libelle, compte_immo, compte_amort, compte_dotation, amortissable, duree_defaut, actif, ordre, modifie_par)
                          VALUES (:tenantId, :code, :libelle, :ci, :ca, :cd, :amortissable, :duree, :actif, 100, :userId) RETURNING id`, v, t);
  return { id: String(c.id) };
});

// ── Registre ────────────────────────────────────────────────────────────────
const SELECT_IMMO = `
  SELECT i.id::text AS id, i.code, i.designation, i.categorie_id::text AS categorie_id, c.libelle AS categorie, c.code AS categorie_code,
         i.compte_immo, c.compte_amort, c.compte_dotation, i.date_acquisition::text AS date_acquisition, i.date_mise_service::text AS date_mise_service,
         i.valeur_origine, i.amortissable, i.duree_annees, i.amort_anterieurs, i.amort_anterieurs_au::text AS amort_anterieurs_au,
         i.fournisseur_id::text AS fournisseur_id, rt.nom AS fournisseur, i.facture_id::text AS facture_id, f.numero AS facture_numero,
         i.reference_piece, i.localisation, i.responsable, i.observations, i.statut, i.date_sortie::text AS date_sortie, i.prix_cession, i.motif_sortie
    FROM fin_immobilisations i JOIN fin_immo_categories c ON c.id = i.categorie_id
    LEFT JOIN registre_tiers rt ON rt.id = i.fournisseur_id LEFT JOIN fin_factures f ON f.id = i.facture_id`;
const nombres = (i) => ({ ...i, valeur_origine: Number(i.valeur_origine), duree_annees: i.duree_annees === null ? null : Number(i.duree_annees),
  amort_anterieurs: Number(i.amort_anterieurs), prix_cession: i.prix_cession === null ? null : Number(i.prix_cession) });

const aujourdhui = () => new Date().toISOString().slice(0, 10);
const situation = (i, auDate = aujourdhui()) => {
  const p = plan(i);
  const annee = Number(auDate.slice(0, 4));
  const cumul = cumulFin(p, annee, i);
  return { cumul, vnc: Math.round((i.valeur_origine - cumul) * 100) / 100, dotation_annee: p.find((l) => l.annee === annee)?.dotation || 0 };
};

const lister = async (tenantId, q = {}) => {
  const statut = ['en_service', 'sorties'].includes(q.statut) ? q.statut : null;
  const rows = (await Q(`${SELECT_IMMO} WHERE i.tenant_id = :tenantId
      AND (CAST(:statut AS TEXT) IS NULL OR (:statut = 'en_service' AND i.statut = 'en_service') OR (:statut = 'sorties' AND i.statut <> 'en_service'))
      AND (CAST(:categorie AS BIGINT) IS NULL OR i.categorie_id = :categorie)
      ORDER BY c.ordre, i.date_mise_service, i.code`, { tenantId, statut, categorie: idOuNull(q.categorie_id, 'Catégorie') })).map(nombres);
  const lignes = rows.map((i) => ({ ...i, ...situation(i) }));
  const somme = (k) => lignes.filter((i) => i.statut === 'en_service').reduce((s, i) => s + i[k], 0);
  return { lignes, totaux: { valeur_origine: somme('valeur_origine'), cumul: somme('cumul'), vnc: somme('vnc'), dotation_annee: somme('dotation_annee') } };
};

const charger = async (tenantId, id, transaction) => {
  const [i] = await Q(`${SELECT_IMMO} WHERE i.id = :id AND i.tenant_id = :tenantId`, { id: idOuNull(id, 'Immobilisation'), tenantId }, transaction);
  if (!i) throw new ErreurImmo(404, 'Immobilisation introuvable.');
  return nombres(i);
};
const lire = async (tenantId, id) => {
  const i = await charger(tenantId, id);
  const p = plan(i);
  const sortie = i.date_sortie ? (() => {
    const cumul = p.length ? p[p.length - 1].cumul : Number(i.amort_anterieurs);
    const vnc = Math.round((i.valeur_origine - cumul) * 100) / 100;
    return { cumul, vnc, resultat: i.statut === 'cede' ? Math.round(((i.prix_cession || 0) - vnc) * 100) / 100 : -vnc };
  })() : null;
  return { immobilisation: { ...i, ...situation(i) }, plan: p, sortie };
};

// Factures d'achat d'immobilisation validées qui n'ont pas encore leur fiche.
const facturesAEnregistrer = (tenantId) => Q(
  `SELECT f.id::text AS id, f.numero, f.reference, f.date_facture::text AS date_facture, f.total_ht, rt.id::text AS fournisseur_id, rt.nom AS fournisseur,
          (SELECT string_agg(l.designation, ' ; ' ORDER BY l.id) FROM fin_facture_lignes l WHERE l.facture_id = f.id) AS designation,
          (SELECT l.compte FROM fin_facture_lignes l WHERE l.facture_id = f.id AND l.compte LIKE '2%' ORDER BY l.id LIMIT 1) AS compte
     FROM fin_factures f JOIN fin_categories fc ON fc.id = f.categorie_id JOIN registre_tiers rt ON rt.id = f.tiers_id
    WHERE f.tenant_id = :tenantId AND f.sens = 'fournisseur' AND f.type = 'facture' AND f.statut = 'validee' AND fc.type_achat = 'immobilisation'
      AND NOT EXISTS (SELECT 1 FROM fin_immobilisations i WHERE i.facture_id = f.id)
    ORDER BY f.date_facture DESC`, { tenantId });

const referentiels = async (tenantId) => {
  const [categories, fournisseurs, factures] = await Promise.all([
    listerCategories(tenantId),
    Q(`SELECT id::text AS id, nom FROM registre_tiers WHERE tenant_id = :tenantId AND actif AND type IN ('fournisseur', 'mixte') ORDER BY nom`, { tenantId }),
    facturesAEnregistrer(tenantId),
  ]);
  return { categories, fournisseurs, factures: factures.map((f) => ({ ...f, total_ht: Number(f.total_ht) })) };
};

const prochainCode = async (tenantId, transaction) => {
  await Q('SELECT pg_advisory_xact_lock(hashtext(:k))', { k: `immo_code:${tenantId}` }, transaction);
  const [{ n }] = await Q(`SELECT coalesce(max(substring(code from '^IMM-(\\d+)$')::int), 0) + 1 AS n FROM fin_immobilisations WHERE tenant_id = :tenantId`,
    { tenantId }, transaction);
  return `IMM-${String(n).padStart(4, '0')}`;
};

const lireSaisie = async (tenantId, b, transaction) => {
  const categorieId = idOuNull(b.categorie_id, 'Catégorie');
  if (!categorieId) throw new ErreurImmo(400, 'Catégorie : obligatoire.');
  const [c] = await Q('SELECT * FROM fin_immo_categories WHERE id = :id AND tenant_id = :tenantId', { id: categorieId, tenantId }, transaction);
  if (!c) throw new ErreurImmo(400, 'Catégorie introuvable.');
  const acquisition = date(b.date_acquisition, 'Date d\'acquisition', { obligatoire: true });
  const service = date(b.date_mise_service, 'Date de mise en service') || acquisition;
  if (service < acquisition) throw new ErreurImmo(400, 'La mise en service ne peut précéder l\'acquisition.');
  const vo = montant(b.valeur_origine, 'Valeur d\'origine', { strict: true });
  const anterieurs = montant(b.amort_anterieurs, 'Amortissements antérieurs', { obligatoire: false }) || 0;
  const anterieursAu = anterieurs > 0 ? date(b.amort_anterieurs_au, 'Date des amortissements antérieurs', { obligatoire: true }) : null;
  if (anterieurs > vo) throw new ErreurImmo(400, 'Les amortissements antérieurs dépassent la valeur d\'origine.');
  if (anterieursAu && anterieursAu < service) throw new ErreurImmo(400, 'Les amortissements antérieurs sont arrêtés avant la mise en service.');
  const duree = c.amortissable ? montant(b.duree_annees === undefined || b.duree_annees === '' ? c.duree_defaut : b.duree_annees, 'Durée (années)', { strict: true }) : null;
  return {
    categorie_id: categorieId, compte_immo: b.compte_immo ? await compte(tenantId, b.compte_immo, 'Compte d\'immobilisation', '2', transaction) : c.compte_immo,
    designation: txt(b.designation, 200, 'Désignation', { obligatoire: true }), date_acquisition: acquisition, date_mise_service: service,
    valeur_origine: vo, amortissable: c.amortissable, duree_annees: duree, amort_anterieurs: anterieurs, amort_anterieurs_au: anterieursAu,
    fournisseur_id: idOuNull(b.fournisseur_id, 'Fournisseur'), facture_id: idOuNull(b.facture_id, 'Facture'),
    reference_piece: txt(b.reference_piece, 60, 'Référence de la pièce'), localisation: txt(b.localisation, 120, 'Localisation'),
    responsable: txt(b.responsable, 120, 'Responsable'), observations: txt(b.observations, 500, 'Observations'),
  };
};

const creer = async ({ tenantId, userId, body }) => enTransaction(async (t) => {
  const b = body || {};
  const v = await lireSaisie(tenantId, b, t);
  const code = txt(b.code, 30, 'Code') || await prochainCode(tenantId, t);
  const [[i]] = await X(
    `INSERT INTO fin_immobilisations (tenant_id, code, designation, categorie_id, compte_immo, date_acquisition, date_mise_service, valeur_origine,
       amortissable, duree_annees, amort_anterieurs, amort_anterieurs_au, fournisseur_id, facture_id, reference_piece, localisation, responsable,
       observations, cree_par, modifie_par)
     VALUES (:tenantId, :code, :designation, :categorie_id, :compte_immo, :date_acquisition, :date_mise_service, :valeur_origine,
       :amortissable, :duree_annees, :amort_anterieurs, :amort_anterieurs_au, :fournisseur_id, :facture_id, :reference_piece, :localisation, :responsable,
       :observations, :userId, :userId) RETURNING id`, { tenantId, userId, code, ...v }, t);
  return { id: String(i.id), code };
});

const modifier = async ({ tenantId, userId, id, body }) => enTransaction(async (t) => {
  const actuel = await charger(tenantId, id, t);
  const b = body || {};
  const v = await lireSaisie(tenantId, b, t);
  if (actuel.date_sortie && actuel.date_sortie < v.date_mise_service) throw new ErreurImmo(400, 'La mise en service ne peut suivre la sortie.');
  const code = txt(b.code, 30, 'Code', { obligatoire: true });
  await X(`UPDATE fin_immobilisations SET code = :code, designation = :designation, categorie_id = :categorie_id, compte_immo = :compte_immo,
             date_acquisition = :date_acquisition, date_mise_service = :date_mise_service, valeur_origine = :valeur_origine, amortissable = :amortissable,
             duree_annees = :duree_annees, amort_anterieurs = :amort_anterieurs, amort_anterieurs_au = :amort_anterieurs_au, fournisseur_id = :fournisseur_id,
             facture_id = :facture_id, reference_piece = :reference_piece, localisation = :localisation, responsable = :responsable,
             observations = :observations, modifie_par = :userId, modifie_le = NOW()
           WHERE id = :id AND tenant_id = :tenantId`, { ...v, code, userId, id: actuel.id, tenantId }, t);
  return { id: actuel.id };
});

const supprimer = async ({ tenantId, id }) => enTransaction(async (t) => {
  const i = await charger(tenantId, id, t);
  await X('DELETE FROM fin_immobilisations WHERE id = :id', { id: i.id }, t);
  return { supprimee: true };
});

// Sortie : cession (prix) ou mise au rebut ; l'amortissement s'arrête à la date de sortie.
const sortir = async (args) => {
  const iid = await sortirDans(args);
  return lire(args.tenantId, iid);     // relu après validation de la transaction
};
const sortirDans = async ({ tenantId, userId, id, body }) => enTransaction(async (t) => {
  const i = await charger(tenantId, id, t);
  if (i.statut !== 'en_service') throw new ErreurImmo(409, 'Ce bien est déjà sorti du patrimoine.');
  const b = body || {};
  const type = b.type === 'cession' ? 'cede' : b.type === 'rebut' ? 'rebut' : null;
  if (!type) throw new ErreurImmo(400, 'Type de sortie : cession ou mise au rebut.');
  const d = date(b.date_sortie, 'Date de sortie', { obligatoire: true });
  if (d < i.date_mise_service) throw new ErreurImmo(400, 'La sortie ne peut précéder la mise en service.');
  await X(`UPDATE fin_immobilisations SET statut = :type, date_sortie = :d, prix_cession = :prix, motif_sortie = :motif, modifie_par = :userId, modifie_le = NOW()
            WHERE id = :id`,
  { type, d, prix: type === 'cede' ? montant(b.prix_cession, 'Prix de cession') : null, motif: txt(b.motif, 300, 'Motif'), userId, id: i.id }, t);
  return i.id;
});
const annulerSortie = async ({ tenantId, userId, id }) => enTransaction(async (t) => {
  const i = await charger(tenantId, id, t);
  if (i.statut === 'en_service') throw new ErreurImmo(409, 'Ce bien est en service.');
  await X(`UPDATE fin_immobilisations SET statut = 'en_service', date_sortie = NULL, prix_cession = NULL, motif_sortie = '', modifie_par = :userId, modifie_le = NOW()
            WHERE id = :id`, { userId, id: i.id }, t);
  return { statut: 'en_service' };
});

// ── Tableau des immobilisations d'un exercice ───────────────────────────────
const tableau = async (tenantId, q = {}) => {
  const annee = Number(q.annee) || new Date().getFullYear();
  if (annee < 1990 || annee > 2100) throw new ErreurImmo(400, 'Exercice invalide.');
  const debut = `${annee}-01-01`; const fin = `${annee}-12-31`;
  const rows = (await Q(`${SELECT_IMMO} WHERE i.tenant_id = :tenantId AND i.date_acquisition <= :fin
                          AND (i.date_sortie IS NULL OR i.date_sortie >= :debut) ORDER BY c.ordre, c.libelle, i.date_mise_service, i.code`,
  { tenantId, debut, fin })).map(nombres);
  const lignes = rows.map((i) => {
    const p = plan(i);
    const vo = i.valeur_origine;
    const presentDebut = i.date_acquisition < debut;
    const sortieAnnee = i.date_sortie && i.date_sortie <= fin;
    const amortDebut = presentDebut ? cumulFin(p, annee - 1, i) : 0;
    const dotation = p.find((l) => l.annee === annee)?.dotation || 0;
    const cumulSortie = sortieAnnee ? amortDebut + dotation : 0;
    const l = {
      id: i.id, code: i.code, designation: i.designation, categorie: i.categorie, compte_immo: i.compte_immo, compte_amort: i.compte_amort,
      date_mise_service: i.date_mise_service, duree_annees: i.duree_annees, taux: i.duree_annees ? Math.round(10000 / i.duree_annees) / 100 : null,
      vb_debut: presentDebut ? vo : 0, acquisitions: presentDebut ? 0 : vo, sorties: sortieAnnee ? vo : 0,
      amort_debut: amortDebut, dotation, reprises: cumulSortie,
      statut: i.statut, date_sortie: i.date_sortie,
      prix_cession: sortieAnnee ? (i.prix_cession || 0) : null,
    };
    l.vb_fin = l.vb_debut + l.acquisitions - l.sorties;
    l.amort_fin = Math.round((l.amort_debut + l.dotation - l.reprises) * 100) / 100;
    l.vnc_fin = Math.round((l.vb_fin - l.amort_fin) * 100) / 100;
    if (sortieAnnee) {
      l.vnc_sortie = Math.round((vo - cumulSortie) * 100) / 100;
      l.resultat_sortie = Math.round((l.prix_cession - l.vnc_sortie) * 100) / 100;
    }
    return l;
  });
  const CHAMPS = ['vb_debut', 'acquisitions', 'sorties', 'vb_fin', 'amort_debut', 'dotation', 'reprises', 'amort_fin', 'vnc_fin'];
  const sommer = (ls) => Object.fromEntries(CHAMPS.map((k) => [k, Math.round(ls.reduce((s, x) => s + x[k], 0) * 100) / 100]));
  const categories = [...new Set(lignes.map((l) => l.categorie))].map((c) => {
    const ls = lignes.filter((l) => l.categorie === c);
    return { categorie: c, lignes: ls, totaux: sommer(ls) };
  });
  return { annee, categories, totaux: sommer(lignes), methode: 'Linéaire, prorata temporis en jours (année de 360 jours)' };
};

module.exports = {
  ErreurImmo, traduire, plan, jours360, initialiserCategories, listerCategories, enregistrerCategorie,
  referentiels, lister, lire, creer, modifier, supprimer, sortir, annulerSortie, tableau,
};
