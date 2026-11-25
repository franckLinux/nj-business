'use strict';
// NJ FINANCE — lot F5 : configuration de la facturation (migration 079).
//
// Référentiels de classification FINANCIÈRE (la gestion opérationnelle des
// articles et des stocks reste dans NJ COMMERCIAL) : catégories de charges et
// de produits, familles, prestations et articles, modes de règlement, comptes
// des taxes (les taxes restent dans com_taxes, partagées avec NJ COMMERCIAL),
// numérotation des factures et avoirs.
//
// Règles : codes uniques par client ; comptes de DÉTAIL existants dans le plan
// du client et de la bonne classe (produits en 7, charges en 6, immobilisations
// en 2, taxes en 44) ; rien ne se supprime : on désactive. La numérotation est
// sans trou (ligne de séquence verrouillée dans la transaction du document) et
// ne recule jamais.
const { sequelize } = require('../../models');

const T = sequelize.QueryTypes;
const Q = (sql, replacements, opts = {}) => sequelize.query(sql, { replacements, type: T.SELECT, ...opts });
const X = (sql, replacements, opts = {}) => sequelize.query(sql, { replacements, ...opts });

class ErreurConfig extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const traduire = (err) => {
  if (err instanceof ErreurConfig) return err;
  const code = err?.original?.code || err?.parent?.code;
  const msg = err?.original?.message || err?.parent?.message || '';
  const m = /^([A-Z_]+): (.*)$/s.exec(msg);
  if (code === '23514' && m) return new ErreurConfig(400, m[2]);
  if (code === '23505') return new ErreurConfig(409, 'Ce code existe déjà pour ce client.');
  if (code === '23514') return new ErreurConfig(400, 'Valeur refusée par les règles de la base.');
  return err;
};
const enTransaction = async (fn) => {
  try { return await sequelize.transaction(fn); } catch (err) { throw traduire(err); }
};

const txt = (v, max, quoi, { obligatoire = false } = {}) => {
  const s = String(v ?? '').trim();
  if (obligatoire && !s) throw new ErreurConfig(400, `${quoi} : champ obligatoire.`);
  if (s.length > max) throw new ErreurConfig(400, `${quoi} : ${max} caractères au plus.`);
  return s;
};
const code = (v, re, quoi) => {
  const s = String(v ?? '').trim().toUpperCase();
  if (!re.test(s)) throw new ErreurConfig(400, `${quoi} : lettres majuscules, chiffres ou tiret bas.`);
  return s;
};
const montantOuNull = (v, quoi) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || Math.round(n * 100) !== n * 100) throw new ErreurConfig(400, `${quoi} : montant invalide (deux décimales au plus).`);
  return n.toFixed(2);
};
const idOuNull = (v, quoi) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ErreurConfig(400, `${quoi} invalide.`);
  return n;
};

// Compte de détail du plan du client, de la classe attendue.
const compte = async (tenantId, v, { quoi, prefixes, obligatoire = false }, transaction) => {
  const c = String(v ?? '').trim();
  if (!c) {
    if (obligatoire) throw new ErreurConfig(400, `${quoi} : compte obligatoire.`);
    return '';
  }
  if (prefixes && !prefixes.some((p) => c.startsWith(p))) {
    throw new ErreurConfig(400, `${quoi} : le compte ${c} doit commencer par ${prefixes.join(' ou ')}.`);
  }
  const [{ a }] = await Q('SELECT fin_compte_anomalie(:tenantId, :c) AS a', { tenantId, c }, { transaction });
  if (a) throw new ErreurConfig(400, `${quoi} : ${a}.`);
  return c;
};
// Premier compte de détail actif commençant par une racine (pour les valeurs par défaut).
const premierDetail = async (tenantId, racine, transaction) => {
  const [t] = await Q('SELECT plan_initialise_le IS NOT NULL AS client FROM tenants WHERE id = :tenantId', { tenantId }, { transaction });
  const table = t?.client ? 'plan_comptable_client' : 'plan_comptable_syscohada';
  const filtre = t?.client ? "c.tenant_id = :tenantId AND c.statut = 'actif'" : 'c.actif';
  const filtreS = t?.client ? "s.tenant_id = :tenantId AND s.statut = 'actif'" : 's.actif';
  const [r] = await Q(
    `SELECT c.compte FROM ${table} c
      WHERE ${filtre} AND c.compte LIKE :p
        AND NOT EXISTS (SELECT 1 FROM ${table} s WHERE ${filtreS} AND s.compte LIKE c.compte || '%' AND s.compte <> c.compte)
      ORDER BY length(c.compte), c.compte LIMIT 1`, { tenantId, p: `${racine}%` }, { transaction });
  return r?.compte || '';
};

// ── Lecture ─────────────────────────────────────────────────────────────────
const TYPES_ACHAT = { marchandises: 'Achats de marchandises', autres: 'Autres achats et charges', immobilisation: 'Achats d\'immobilisations' };
const DOCUMENTS = {
  facture_client: { libelle: 'Factures clients', prefixe: 'FAC' },
  avoir_client: { libelle: 'Avoirs clients', prefixe: 'AVC' },
  proforma: { libelle: 'Proformas clients', prefixe: 'PRO' },
  facture_fournisseur: { libelle: 'Factures fournisseurs (n° interne)', prefixe: 'FFR' },
  avoir_fournisseur: { libelle: 'Avoirs fournisseurs (n° interne)', prefixe: 'AVF' },
};

const sequencesDe = async (tenantId, annee, transaction) => {
  const rows = await Q('SELECT type_document, prefixe, prochain, chiffres FROM fin_sequences WHERE tenant_id = :tenantId AND annee = :annee',
    { tenantId, annee }, { transaction });
  return Object.entries(DOCUMENTS).map(([type, d]) => {
    const r = rows.find((x) => x.type_document === type);
    const prefixe = r?.prefixe || d.prefixe; const prochain = r?.prochain || 1; const chiffres = r?.chiffres || 5;
    return { type_document: type, libelle: d.libelle, annee, prefixe, prochain, chiffres, apercu: `${prefixe}-${annee}-${String(prochain).padStart(chiffres, '0')}`, utilisee: Boolean(r && r.prochain > 1) };
  });
};

const etat = async (tenantId, q = {}) => {
  const annee = Number(q.annee) || new Date().getFullYear();
  const [categories, familles, prestations, modes, taxes, journaux, articles, sequences] = await Promise.all([
    Q('SELECT * FROM fin_categories WHERE tenant_id = :tenantId ORDER BY sens DESC, ordre, code', { tenantId }),
    Q(`SELECT f.*, (SELECT count(*)::int FROM fin_prestations p WHERE p.famille_id = f.id) AS nb_prestations
         FROM fin_familles f WHERE f.tenant_id = :tenantId ORDER BY f.code`, { tenantId }),
    Q(`SELECT p.*, f.libelle AS famille, t.code AS taxe_code, t.taux AS taxe_taux, a.reference AS article_reference, a.designation AS article_designation
         FROM fin_prestations p LEFT JOIN fin_familles f ON f.id = p.famille_id LEFT JOIN com_taxes t ON t.id = p.taxe_id
         LEFT JOIN com_articles a ON a.id = p.com_article_id
        WHERE p.tenant_id = :tenantId ORDER BY p.actif DESC, p.code`, { tenantId }),
    Q(`SELECT m.*, j.code AS journal_code, j.nom AS journal_nom FROM fin_modes_reglement m LEFT JOIN journaux j ON j.id = m.journal_id
        WHERE m.tenant_id = :tenantId ORDER BY m.ordre, m.code`, { tenantId }),
    Q(`SELECT t.id, t.code, t.intitule, t.taux, t.type, t.actif, t.description,
              coalesce(c.compte_collecte, '') AS compte_collecte, coalesce(c.compte_deductible, '') AS compte_deductible,
              coalesce(c.compte_deductible_immo, '') AS compte_deductible_immo
         FROM com_taxes t LEFT JOIN fin_taxes_comptes c ON c.taxe_id = t.id
        WHERE t.tenant_id = :tenantId ORDER BY t.actif DESC, t.code`, { tenantId }),
    Q('SELECT id, code, nom, type FROM journaux WHERE tenant_id = :tenantId AND actif ORDER BY ordre, code', { tenantId }),
    Q(`SELECT id, reference, designation FROM com_articles WHERE tenant_id = :tenantId AND actif ORDER BY reference LIMIT 1000`, { tenantId }),
    sequencesDe(tenantId, annee),
  ]);
  return { categories, familles, prestations, modes, taxes, journaux, articles_commerciaux: articles, sequences, types_achat: TYPES_ACHAT, annee };
};

// ── Écriture d'un élément (création si pas d'id, sinon modification) ───────
const upsert = async (transaction, { table, tenantId, userId, id, champs }) => {
  const cles = Object.keys(champs);
  if (id) {
    const [r] = await Q(`SELECT id FROM ${table} WHERE id = :id AND tenant_id = :tenantId FOR UPDATE`, { id, tenantId }, { transaction });
    if (!r) throw new ErreurConfig(404, 'Élément introuvable.');
    await X(`UPDATE ${table} SET ${cles.map((k) => `${k} = :${k}`).join(', ')}, modifie_par = :userId, modifie_le = NOW() WHERE id = :id`,
      { ...champs, userId, id }, { transaction });
    return id;
  }
  const [[r]] = await X(`INSERT INTO ${table} (tenant_id, ${cles.join(', ')}, modifie_par) VALUES (:tenantId, ${cles.map((k) => `:${k}`).join(', ')}, :userId) RETURNING id`,
    { ...champs, tenantId, userId }, { transaction });
  return r.id;
};
const actif = (b) => (b.actif === undefined ? true : Boolean(b.actif));

const enregistrerCategorie = ({ tenantId, userId, id, body: b }) => enTransaction(async (transaction) => {
  const sens = b.sens === 'produit' ? 'produit' : b.sens === 'charge' ? 'charge' : null;
  if (!sens) throw new ErreurConfig(400, 'Précisez s\'il s\'agit d\'une catégorie de charges ou de produits.');
  const typeAchat = sens === 'charge' ? b.type_achat : null;
  if (sens === 'charge' && !TYPES_ACHAT[typeAchat]) throw new ErreurConfig(400, 'Type d\'achat invalide.');
  const prefixes = sens === 'produit' ? ['7'] : typeAchat === 'marchandises' ? ['60'] : typeAchat === 'immobilisation' ? ['2'] : ['6'];
  const champs = {
    code: code(b.code, /^[A-Z0-9_]{1,16}$/, 'Code'), libelle: txt(b.libelle, 120, 'Libellé', { obligatoire: true }), sens, type_achat: typeAchat,
    compte_defaut: await compte(tenantId, b.compte_defaut, { quoi: 'Compte par défaut', prefixes, obligatoire: true }, transaction),
    actif: actif(b), ordre: Number.isInteger(Number(b.ordre)) ? Number(b.ordre) : 0,
  };
  return { id: await upsert(transaction, { table: 'fin_categories', tenantId, userId, id: idOuNull(id, 'Catégorie'), champs }) };
});

const enregistrerFamille = ({ tenantId, userId, id, body: b }) => enTransaction(async (transaction) => {
  const champs = {
    code: code(b.code, /^[A-Z0-9_]{1,16}$/, 'Code'), libelle: txt(b.libelle, 120, 'Libellé', { obligatoire: true }),
    compte_produit: await compte(tenantId, b.compte_produit, { quoi: 'Compte de produit', prefixes: ['7'] }, transaction),
    compte_charge: await compte(tenantId, b.compte_charge, { quoi: 'Compte de charge', prefixes: ['6', '2'] }, transaction),
    actif: actif(b),
  };
  return { id: await upsert(transaction, { table: 'fin_familles', tenantId, userId, id: idOuNull(id, 'Famille'), champs }) };
});

const enregistrerPrestation = ({ tenantId, userId, id, body: b }) => enTransaction(async (transaction) => {
  const type = b.type === 'article' ? 'article' : 'prestation';
  const champs = {
    code: code(b.code, /^[A-Z0-9_.-]{1,20}$/, 'Code'), libelle: txt(b.libelle, 200, 'Libellé', { obligatoire: true }), type,
    famille_id: idOuNull(b.famille_id, 'Famille'), unite: txt(b.unite, 20, 'Unité'),
    prix_vente: montantOuNull(b.prix_vente, 'Prix de vente'), prix_achat: montantOuNull(b.prix_achat, 'Prix d\'achat'),
    taxe_id: idOuNull(b.taxe_id, 'Taxe'),
    compte_produit: await compte(tenantId, b.compte_produit, { quoi: 'Compte de produit', prefixes: ['7'] }, transaction),
    compte_charge: await compte(tenantId, b.compte_charge, { quoi: 'Compte de charge', prefixes: ['6', '2'] }, transaction),
    com_article_id: idOuNull(b.com_article_id, 'Article de NJ COMMERCIAL'), actif: actif(b),
  };
  try {
    return { id: await upsert(transaction, { table: 'fin_prestations', tenantId, userId, id: idOuNull(id, 'Prestation'), champs }) };
  } catch (err) {
    if (/uq_fin_prestations_article/.test(err?.original?.message || '')) throw new ErreurConfig(409, 'Cet article de NJ COMMERCIAL est déjà relié à une autre prestation.');
    throw err;
  }
});

const enregistrerMode = ({ tenantId, userId, id, body: b }) => enTransaction(async (transaction) => {
  const champs = {
    code: code(b.code, /^[A-Z0-9_]{1,16}$/, 'Code'), libelle: txt(b.libelle, 80, 'Libellé', { obligatoire: true }),
    journal_id: idOuNull(b.journal_id, 'Caisse ou banque'), reference_obligatoire: Boolean(b.reference_obligatoire),
    actif: actif(b), ordre: Number.isInteger(Number(b.ordre)) ? Number(b.ordre) : 0,
  };
  return { id: await upsert(transaction, { table: 'fin_modes_reglement', tenantId, userId, id: idOuNull(id, 'Mode de règlement'), champs }) };
});

// Taxe : la taxe vit dans com_taxes (partagée) ; ses comptes dans fin_taxes_comptes.
const enregistrerTaxe = ({ tenantId, userId, id, body: b }) => enTransaction(async (transaction) => {
  const taux = Number(String(b.taux ?? '').replace(',', '.'));
  if (!Number.isFinite(taux) || taux < 0 || taux > 100) throw new ErreurConfig(400, 'Taux : nombre entre 0 et 100.');
  const type = ['tva', 'precompte', 'autre'].includes(b.type) ? b.type : 'tva';
  const champs = {
    code: code(b.code, /^[A-Z0-9_.-]{1,20}$/, 'Code'), intitule: txt(b.intitule, 120, 'Intitulé', { obligatoire: true }),
    taux: taux.toFixed(4), type, actif: actif(b),
  };
  const comptes = {
    compte_collecte: await compte(tenantId, b.compte_collecte, { quoi: 'Compte de taxe collectée', prefixes: ['44'] }, transaction),
    compte_deductible: await compte(tenantId, b.compte_deductible, { quoi: 'Compte de taxe déductible sur achats', prefixes: ['44'] }, transaction),
    compte_deductible_immo: await compte(tenantId, b.compte_deductible_immo, { quoi: 'Compte de taxe déductible sur immobilisations', prefixes: ['44'] }, transaction),
  };
  let tid = idOuNull(id, 'Taxe');
  if (tid) {
    const [r] = await Q('SELECT id FROM com_taxes WHERE id = :tid AND tenant_id = :tenantId FOR UPDATE', { tid, tenantId }, { transaction });
    if (!r) throw new ErreurConfig(404, 'Taxe introuvable.');
    await X('UPDATE com_taxes SET code = :code, intitule = :intitule, taux = :taux, type = :type, actif = :actif, modifie_le = NOW() WHERE id = :tid',
      { ...champs, tid }, { transaction });
  } else {
    const [[r]] = await X(`INSERT INTO com_taxes (tenant_id, code, intitule, taux, type, actif, cree_par) VALUES (:tenantId, :code, :intitule, :taux, :type, :actif, :userId) RETURNING id`,
      { ...champs, tenantId, userId }, { transaction });
    tid = r.id;
  }
  await X(`INSERT INTO fin_taxes_comptes (taxe_id, tenant_id, compte_collecte, compte_deductible, compte_deductible_immo, modifie_par)
           VALUES (:tid, :tenantId, :compte_collecte, :compte_deductible, :compte_deductible_immo, :userId)
           ON CONFLICT (taxe_id) DO UPDATE SET compte_collecte = EXCLUDED.compte_collecte, compte_deductible = EXCLUDED.compte_deductible,
             compte_deductible_immo = EXCLUDED.compte_deductible_immo, modifie_par = EXCLUDED.modifie_par, modifie_le = NOW()`,
  { tid, tenantId, userId, ...comptes }, { transaction });
  return { id: tid };
});

// ── Numérotation ────────────────────────────────────────────────────────────
const definirSequence = ({ tenantId, body: b }) => enTransaction(async (transaction) => {
  if (!DOCUMENTS[b.type_document]) throw new ErreurConfig(400, 'Type de document inconnu.');
  const annee = Number(b.annee);
  if (!Number.isInteger(annee) || annee < 2000 || annee > 2100) throw new ErreurConfig(400, 'Année invalide.');
  const prefixe = String(b.prefixe ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{1,8}$/.test(prefixe)) throw new ErreurConfig(400, 'Préfixe : 1 à 8 lettres, chiffres ou tirets.');
  const chiffres = Number(b.chiffres);
  if (!Number.isInteger(chiffres) || chiffres < 3 || chiffres > 8) throw new ErreurConfig(400, 'Nombre de chiffres : entre 3 et 8.');
  const prochain = Number(b.prochain);
  if (!Number.isInteger(prochain) || prochain < 1) throw new ErreurConfig(400, 'Prochain numéro invalide.');
  const [r] = await Q('SELECT prochain FROM fin_sequences WHERE tenant_id = :tenantId AND type_document = :t AND annee = :annee FOR UPDATE',
    { tenantId, t: b.type_document, annee }, { transaction });
  if (r && prochain < r.prochain) throw new ErreurConfig(409, `La numérotation ne recule pas : le prochain numéro est déjà ${r.prochain}.`);
  if (r && r.prochain > 1 && (await Q('SELECT prefixe FROM fin_sequences WHERE tenant_id = :tenantId AND type_document = :t AND annee = :annee',
    { tenantId, t: b.type_document, annee }, { transaction }))[0].prefixe !== prefixe) {
    throw new ErreurConfig(409, 'Des numéros ont déjà été attribués cette année : le préfixe ne change plus avant l\'année suivante.');
  }
  await X(`INSERT INTO fin_sequences (tenant_id, type_document, annee, prefixe, prochain, chiffres)
           VALUES (:tenantId, :t, :annee, :prefixe, :prochain, :chiffres)
           ON CONFLICT (tenant_id, type_document, annee) DO UPDATE SET prefixe = EXCLUDED.prefixe, prochain = EXCLUDED.prochain,
             chiffres = EXCLUDED.chiffres, modifie_le = NOW()`, { tenantId, t: b.type_document, annee, prefixe, prochain, chiffres }, { transaction });
  return (await sequencesDe(tenantId, annee, transaction)).find((s) => s.type_document === b.type_document);
});

/**
 * Attribue le numéro suivant d'un document, DANS la transaction du document :
 * la ligne de séquence reste verrouillée jusqu'à la validation ou l'annulation
 * de cette transaction, ce qui garantit une numérotation sans trou ni doublon.
 */
const prochainNumero = async (transaction, tenantId, typeDocument, dateIso) => {
  if (!DOCUMENTS[typeDocument]) throw new ErreurConfig(400, 'Type de document inconnu.');
  const annee = Number(String(dateIso).slice(0, 4));
  await X(`INSERT INTO fin_sequences (tenant_id, type_document, annee, prefixe) VALUES (:tenantId, :t, :annee, :prefixe)
           ON CONFLICT (tenant_id, type_document, annee) DO NOTHING`,
  { tenantId, t: typeDocument, annee, prefixe: DOCUMENTS[typeDocument].prefixe }, { transaction });
  const [s] = await Q('SELECT prefixe, prochain, chiffres FROM fin_sequences WHERE tenant_id = :tenantId AND type_document = :t AND annee = :annee FOR UPDATE',
    { tenantId, t: typeDocument, annee }, { transaction });
  await X('UPDATE fin_sequences SET prochain = prochain + 1, modifie_le = NOW() WHERE tenant_id = :tenantId AND type_document = :t AND annee = :annee',
    { tenantId, t: typeDocument, annee }, { transaction });
  return `${s.prefixe}-${annee}-${String(s.prochain).padStart(s.chiffres, '0')}`;
};

// ── Paramétrage par défaut (rejouable : ce qui existe est conservé) ─────────
const CATEGORIES_DEFAUT = [
  { code: 'VTE_MARCH', libelle: 'Ventes de marchandises', sens: 'produit', racines: ['701'] },
  { code: 'PRESTA', libelle: 'Prestations de services', sens: 'produit', racines: ['706'] },
  { code: 'PROD_ACC', libelle: 'Produits accessoires', sens: 'produit', racines: ['707'] },
  { code: 'ACH_MARCH', libelle: 'Achats de marchandises', sens: 'charge', type_achat: 'marchandises', racines: ['601'] },
  { code: 'FOURN', libelle: 'Fournitures et autres achats', sens: 'charge', type_achat: 'autres', racines: ['605', '604'] },
  { code: 'SERV_EXT', libelle: 'Services extérieurs', sens: 'charge', type_achat: 'autres', racines: ['62', '63'] },
  { code: 'IMMO_MAT', libelle: 'Matériel et mobilier', sens: 'charge', type_achat: 'immobilisation', racines: ['244', '24'] },
  { code: 'IMMO_TRANS', libelle: 'Matériel de transport', sens: 'charge', type_achat: 'immobilisation', racines: ['245'] },
];
const MODES_DEFAUT = [
  { code: 'ESPECES', libelle: 'Espèces', type: 'caisse', ref: false },
  { code: 'CHEQUE', libelle: 'Chèque', type: 'banque', ref: true },
  { code: 'VIREMENT', libelle: 'Virement bancaire', type: 'banque', ref: true },
  { code: 'MOBILE', libelle: 'Mobile money', type: ['om', 'momo'], ref: true },
];

const initialiser = ({ tenantId, userId }) => enTransaction(async (transaction) => {
  const crees = { categories: [], modes: [], taxes: [] };
  const anomalies = [];
  let ordre = 0;
  for (const c of CATEGORIES_DEFAUT) {
    ordre += 1;
    const [existe] = await Q('SELECT id FROM fin_categories WHERE tenant_id = :tenantId AND code = :code', { tenantId, code: c.code }, { transaction });
    if (existe) continue;
    let cpt = '';
    for (const r of c.racines) { cpt = await premierDetail(tenantId, r, transaction); if (cpt) break; }
    if (!cpt) { anomalies.push(`${c.libelle} : aucun compte de détail ${c.racines.join(' / ')} dans le plan.`); continue; }
    await X(`INSERT INTO fin_categories (tenant_id, code, libelle, sens, type_achat, compte_defaut, ordre, modifie_par)
             VALUES (:tenantId, :code, :libelle, :sens, :ta, :cpt, :ordre, :userId)`,
    { tenantId, code: c.code, libelle: c.libelle, sens: c.sens, ta: c.type_achat || null, cpt, ordre, userId }, { transaction });
    crees.categories.push(c.code);
  }
  const journaux = await Q('SELECT id, type FROM journaux WHERE tenant_id = :tenantId AND actif ORDER BY ordre, id', { tenantId }, { transaction });
  ordre = 0;
  for (const m of MODES_DEFAUT) {
    ordre += 1;
    const [existe] = await Q('SELECT id FROM fin_modes_reglement WHERE tenant_id = :tenantId AND code = :code', { tenantId, code: m.code }, { transaction });
    if (existe) continue;
    const types = Array.isArray(m.type) ? m.type : [m.type];
    const j = journaux.find((x) => types.includes(x.type));
    await X(`INSERT INTO fin_modes_reglement (tenant_id, code, libelle, journal_id, reference_obligatoire, ordre, modifie_par)
             VALUES (:tenantId, :code, :libelle, :j, :ref, :ordre, :userId)`,
    { tenantId, code: m.code, libelle: m.libelle, j: j?.id || null, ref: m.ref, ordre, userId }, { transaction });
    crees.modes.push(m.code);
  }
  // TVA au Cameroun : 17,5 % + centimes additionnels communaux (10 % de la TVA) = 19,25 %.
  let [tva] = await Q("SELECT id FROM com_taxes WHERE tenant_id = :tenantId AND type = 'tva' AND actif ORDER BY id LIMIT 1", { tenantId }, { transaction });
  if (!tva) {
    const [[r]] = await X(`INSERT INTO com_taxes (tenant_id, code, intitule, taux, type, description, cree_par)
                           VALUES (:tenantId, 'TVA', 'TVA (17,5 % + CAC)', 19.25, 'tva', 'TVA au taux normal, centimes additionnels communaux compris', :userId) RETURNING id`,
    { tenantId, userId }, { transaction });
    tva = r; crees.taxes.push('TVA');
  }
  const [comptes] = await Q('SELECT 1 FROM fin_taxes_comptes WHERE taxe_id = :id', { id: tva.id }, { transaction });
  if (!comptes) {
    const col = await premierDetail(tenantId, '4431', transaction) || await premierDetail(tenantId, '443', transaction);
    const ded = await premierDetail(tenantId, '4452', transaction) || await premierDetail(tenantId, '445', transaction);
    const imm = await premierDetail(tenantId, '4451', transaction);
    await X(`INSERT INTO fin_taxes_comptes (taxe_id, tenant_id, compte_collecte, compte_deductible, compte_deductible_immo, modifie_par)
             VALUES (:id, :tenantId, :col, :ded, :imm, :userId)`, { id: tva.id, tenantId, col, ded, imm, userId }, { transaction });
  }
  return { crees, anomalies };
});

module.exports = {
  ErreurConfig, traduire, TYPES_ACHAT, DOCUMENTS, etat, initialiser, prochainNumero, definirSequence, premierDetail,
  enregistrerCategorie, enregistrerFamille, enregistrerPrestation, enregistrerMode, enregistrerTaxe,
};
