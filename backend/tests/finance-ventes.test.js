// tests/finance-ventes.test.js — NJ FINANCE lot F8 : ventes, proformas, paiement depuis la facture,
// règlements hors caisse ni banque (081).
//
// Lance le VRAI serveur (index.js) sur une base de TEST, puis appelle l'API.
//   TEST_DATABASE_URL=postgres://…/base_de_test  node --test tests/finance-achats.test.js
// La base doit être migrée jusqu'à 080.
//
// Couvre : proforma émise (PRO-…, PDF), transformée une seule fois en facture ;
// facture client validée par une autre personne (FAC-…, écriture VT 411 / 706 /
// 4431, identité figée) ; PDF ; paiement depuis la facture = mouvement de caisse
// créé par la saisie de caisse elle-même et relié (D caisse / C 411) ; plafond du
// reste ; avoir client ; règlement hors caisse : proposé, refusé sur un compte de
// trésorerie, décidé par le DIRECTEUR SEUL (écriture d'OD), annulé avec extourne.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const DB = process.env.TEST_DATABASE_URL;
if (!DB) {
  console.error('TEST_DATABASE_URL absent : test ignoré (ne jamais viser la base de production).');
  process.exit(0);
}
const SECRET = 'test-secret-' + crypto.randomBytes(16).toString('hex');
const PORT = 7800 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}/api`;
const sfx = crypto.randomBytes(3).toString('hex');
const pool = new Pool({ connectionString: DB });
const AN = new Date().getFullYear();
const MOIS = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
let serveur;
const C = { a: { u: {} }, b: { u: {} } };
const F = {};

const sql = async (texte, params = []) => (await pool.query(texte, params)).rows;
const appel = async (methode, url, client, qui, corps) => {
  const r = await fetch(BASE + url, {
    method: methode,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${C[client].u[qui].token}` },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.data ?? j, message: j.message ?? j.error, brut: j };
};
const lignesEcriture = async (origineType, origineId) => (await sql(
  `SELECT l.compte, l.debit::numeric AS debit, l.credit::numeric AS credit, l.tiers_id::text AS tiers
     FROM fin_ecriture_lignes l JOIN fin_ecritures e ON e.id = l.ecriture_id
    WHERE e.origine_type = $1 AND e.origine_id = $2 AND e.extournee_par_id IS NULL ORDER BY l.ordre`, [origineType, origineId]))
  .map((l) => `${l.compte} ${Number(l.debit) ? `D${Number(l.debit)}` : `C${Number(l.credit)}`}${l.tiers ? ' T' : ''}`);
const mouvement = async ({ date, sortie, tiers = null, annule = null, rubrique = 'ACH' }) => {
  const [r] = await sql(
    `INSERT INTO journal (tenant_id, date, mois, annee, type_caisse, rubrique_code, intitule, entree, sortie, journal_id, tiers_id, annulation_de_id, created_by)
     VALUES ($1, $2, $3, $4, 'especes', $5, 'Paiement fournisseur', 0, $6, $7, $8, $9, $10) RETURNING id`,
    [C.a.tenant, date, MOIS[Number(date.slice(5, 7)) - 1], Number(date.slice(0, 4)), rubrique, sortie, C.a.caisse, tiers, annule, C.a.u.cai.id]);
  return String(r.id);
};
const JOUR = new Date().toISOString().slice(0, 10);
const document = (extra = {}) => ({
  tiers_id: F.client, reference: 'BC-77', date_facture: JOUR, categorie_id: F.cat.PRESTA, objet: 'Mission d\'assistance comptable',
  conditions_paiement: 'Virement à 30 jours', lignes: [{ designation: 'Tenue de comptabilité', quantite: 3, prix_unitaire: 100000, taxe_id: F.tva }], ...extra,
});

const creerClient = async (cle) => {
  const c = C[cle];
  [{ id: c.tenant }] = await sql(`INSERT INTO tenants (slug, nom, forme_juridique, initialise_le) VALUES ($1, $2, 'SARL', NOW()) RETURNING id`,
    [`vte-${cle}-${sfx}`, `VENTES ${cle} ${sfx}`]);
  await sql('INSERT INTO tenant_modules (tenant_id, module_code, actif) VALUES ($1, \'caisse\', true) ON CONFLICT DO NOTHING', [c.tenant]);
  [{ id: c.caisse }] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type, date_ouverture, compte_tresorerie)
                                  VALUES ($1, 'CA1', 'Caisse', 'caisse', $2, '5711') RETURNING id`, [c.tenant, `${AN}-01-01`]);
  const [r] = await sql(`INSERT INTO rubriques (tenant_id, code, intitule, type) VALUES ($1, 'ACH', 'ACHATS DIVERS', 'depense') RETURNING id`, [c.tenant]);
  await sql(`INSERT INTO equivalences_comptables (tenant_id, rubrique_id, compte, statut) VALUES ($1, $2, '6051', 'valide')`, [c.tenant, r.id]);
  const [r2] = await sql(`INSERT INTO rubriques (tenant_id, code, intitule, type) VALUES ($1, 'VTE', 'ENCAISSEMENTS CLIENTS', 'entree') RETURNING id`, [c.tenant]);
  await sql(`INSERT INTO equivalences_comptables (tenant_id, rubrique_id, compte, statut) VALUES ($1, $2, '7011', 'valide')`, [c.tenant, r2.id]);
  for (const [qui, role] of [['dir', 'directeur'], ['cpt', 'auditeur'], ['cai', 'caissier']]) {
    const username = `${qui}-vte-${cle}-${sfx}`;
    const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif) VALUES ($1, $2, $3, 'x', $4, true) RETURNING id`,
      [c.tenant, username, `${username}@test.cm`, role]);
    await sql('INSERT INTO user_modules (user_id, module_code, tenant_id) VALUES ($1, \'caisse\', $2) ON CONFLICT DO NOTHING', [u.id, c.tenant]);
    c.u[qui] = { id: u.id, token: jwt.sign({ sub: u.id, username, role, tenantId: c.tenant }, SECRET, { expiresIn: '1h' }) };
  }
};

before(async () => {
  await creerClient('a');
  await creerClient('b');
  [{ id: F.client }] = await sql(`INSERT INTO registre_tiers (tenant_id, type, nom, nui) VALUES ($1, 'client', 'Hôtel des Lacs', 'M098765432101Z') RETURNING id::text`, [C.a.tenant]);
  [{ id: F.associe }] = await sql(`INSERT INTO registre_tiers (tenant_id, type, nom) VALUES ($1, 'mixte', 'M. Ngan, associé') RETURNING id::text`, [C.a.tenant]);
  serveur = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: DB, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test', SMTP_HOST: '', RATE_LIMIT_MAX: '100000', MODULES_CONTROLE: 'appliquer' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = (d) => process.env.DEBUG_TEST && process.stderr.write(d);
  serveur.stdout.on('data', log); serveur.stderr.on('data', log);
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* démarrage */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const init = await appel('POST', '/finance/config/initialiser', 'a', 'cpt');
  assert.equal(init.status, 200, init.message);
  const ref = await appel('GET', '/finance/ventes/referentiels', 'a', 'cai');
  assert.equal(ref.status, 200, ref.message);
  F.cat = Object.fromEntries(ref.data.categories.map((c) => [c.code, c.id]));
  F.tva = ref.data.taxes.find((t) => t.code === 'TVA').id;
  assert.ok(ref.data.rubriques.some((r) => r.code === 'VTE') && !ref.data.rubriques.some((r) => r.code === 'ACH'), 'rubriques d\'entrée seulement');
});
after(async () => {
  serveur?.kill();
  const cx = await pool.connect();
  try {
    await cx.query('BEGIN');
    await cx.query("SET LOCAL app.finance_maintenance = 'on'");
    await cx.query("SET LOCAL app.journal_maintenance = 'on'");
    const ids = [C.a.tenant, C.b.tenant].filter(Boolean);
    await cx.query('DELETE FROM fin_reglement_affectations WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM fin_reglements_hors_caisse WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('UPDATE fin_factures SET proforma_id = NULL WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM fin_factures WHERE tenant_id = ANY($1::uuid[]) AND facture_origine_id IS NOT NULL', [ids]);
    await cx.query('DELETE FROM fin_imputations_externes WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM fin_ecritures WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM fin_factures WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('UPDATE journal SET annule_par_id = NULL WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM journal WHERE tenant_id = ANY($1::uuid[]) AND annulation_de_id IS NOT NULL', [ids]);
    await cx.query('DELETE FROM journal WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM com_facture_fourn_lignes WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM com_factures_fournisseurs WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM com_articles WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM com_unites WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM com_familles WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM audit_log WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM user_modules WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM tenant_modules WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [ids]);
    await cx.query('COMMIT');
  } catch (e) {
    await cx.query('ROLLBACK');
    console.error('Nettoyage de la base de test incomplet :', e.message);
  } finally {
    cx.release();
  }
  await pool.end();
});


test('Proforma : établie par le caissier, émise (PRO-…), PDF, transformée une seule fois en facture', async () => {
  const p = await appel('POST', '/finance/ventes', 'a', 'cai', document({ type: 'proforma' }));
  assert.equal(p.status, 201, p.message);
  F.pro = p.data.id;
  let d = (await appel('GET', `/finance/ventes/${F.pro}`, 'a', 'cai')).data;
  assert.equal(d.facture.type, 'proforma');
  assert.equal(Number(d.facture.total_ttc), 357750);
  assert.equal((await appel('POST', `/finance/ventes/${F.pro}/valider`, 'a', 'dir')).status, 409, 'une proforma ne se valide pas');
  assert.equal((await appel('POST', `/finance/ventes/${F.pro}/transformer`, 'a', 'cai')).status, 409, 'pas encore émise');
  const e = await appel('POST', `/finance/ventes/${F.pro}/emettre`, 'a', 'cai');
  assert.equal(e.status, 200, e.message);
  assert.equal(e.data.numero, `PRO-${AN}-00001`);
  const [{ n }] = await sql(`SELECT count(*)::int AS n FROM fin_ecritures WHERE origine_type = 'fin_facture' AND origine_id = $1`, [F.pro]);
  assert.equal(n, 0, 'aucune écriture pour une proforma');
  const pdf = await fetch(`${BASE}/finance/ventes/${F.pro}/pdf`, { headers: { Authorization: `Bearer ${C.a.u.cai.token}` } });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal((await pdf.arrayBuffer()).byteLength > 1500, true);
  const t = await appel('POST', `/finance/ventes/${F.pro}/transformer`, 'a', 'cai');
  assert.equal(t.status, 201, t.message);
  F.fac = t.data.facture_id;
  assert.equal((await appel('POST', `/finance/ventes/${F.pro}/transformer`, 'a', 'cai')).status, 409, 'déjà facturée');
  d = (await appel('GET', `/finance/ventes/${F.fac}`, 'a', 'cai')).data;
  assert.equal(d.facture.statut, 'brouillon');
  assert.equal(d.facture.proforma_numero, `PRO-${AN}-00001`);
  assert.equal(d.lignes.length, 1);
  assert.equal(Number(d.facture.total_ttc), 357750);
});

test('Facture client : validée par une autre personne, FAC-…, écriture VT 411 / 706 / 4431', async () => {
  assert.equal((await appel('POST', `/finance/ventes/${F.fac}/valider`, 'a', 'cai')).status, 403, 'droit de valider');
  const propre = await appel('POST', '/finance/ventes', 'a', 'cpt', document());
  assert.equal((await appel('POST', `/finance/ventes/${propre.data.id}/valider`, 'a', 'cpt')).status, 403, 'pas sa propre facture');
  await appel('DELETE', `/finance/ventes/${propre.data.id}`, 'a', 'cpt');
  const v = await appel('POST', `/finance/ventes/${F.fac}/valider`, 'a', 'cpt');
  assert.equal(v.status, 200, v.message);
  assert.equal(v.data.numero, `FAC-${AN}-00001`);
  assert.deepEqual(await lignesEcriture('fin_facture', F.fac), ['411 D357750 T', '706 C300000', '4431 C57750']);
  const [e] = await sql(`SELECT j.code, (f.identite_emetteur IS NOT NULL) AS figee FROM fin_ecritures e JOIN fin_journaux j ON j.id = e.journal_id
                           JOIN fin_factures f ON f.id = e.origine_id WHERE e.origine_type = 'fin_facture' AND e.origine_id = $1`, [F.fac]);
  assert.deepEqual([e.code, e.figee], ['VT', true]);
  const creances = await appel('GET', '/finance/creances', 'a', 'cpt');
  assert.equal(Number(creances.data.lignes.find((t) => t.id === F.client).solde), 357750);
  const pdf = await fetch(`${BASE}/finance/ventes/${F.fac}/pdf`, { headers: { Authorization: `Bearer ${C.a.u.cai.token}` } });
  assert.equal(pdf.status, 200);
  const liste = await appel('GET', '/finance/ventes', 'a', 'cai');
  assert.equal(liste.data.factures.find((f) => f.id === F.fac).etat, 'À encaisser');
  assert.equal(liste.data.factures.find((f) => f.id === F.pro).etat, 'Facturée');
});

test('Paiement depuis la facture : la caisse enregistre l\'entrée, la facture est réglée (D caisse / C 411)', async () => {
  const trop = await appel('POST', '/finance/reglements/paiement', 'a', 'cai',
    { facture_type: 'fin', facture_id: F.fac, journal_id: C.a.caisse, date: JOUR, montant: 400000, rubrique_code: 'VTE' });
  assert.equal(trop.status, 409, 'plafond du reste');
  const mauvais = await appel('POST', '/finance/reglements/paiement', 'a', 'cai',
    { facture_type: 'fin', facture_id: F.fac, journal_id: C.a.caisse, date: JOUR, montant: 1000, rubrique_code: 'ACH' });
  assert.equal(mauvais.status, 400, 'rubrique de dépense refusée pour un encaissement');
  const r = await appel('POST', '/finance/reglements/paiement', 'a', 'cai',
    { facture_type: 'fin', facture_id: F.fac, journal_id: C.a.caisse, date: JOUR, montant: 200000, rubrique_code: 'VTE', reference_paiement: 'Chèque 0012' });
  assert.equal(r.status, 201, r.message);
  const [m] = await sql('SELECT entree, sortie, tiers_id::text AS tiers, rubrique_code, intitule FROM journal WHERE id = $1', [r.data.mouvement_id]);
  assert.deepEqual([Number(m.entree), Number(m.sortie), m.tiers, m.rubrique_code], [200000, 0, F.client, 'VTE']);
  assert.match(m.intitule, /FAC-/);
  assert.deepEqual(await lignesEcriture('journal', r.data.mouvement_id), ['5711 D200000', '411 C200000 T']);
  const d = (await appel('GET', `/finance/ventes/${F.fac}`, 'a', 'cpt')).data;
  assert.equal(Number(d.reste), 157750);
  assert.equal(d.reglements.length, 1);
});

test('Règlement hors caisse : jamais un compte de trésorerie, décidé par le directeur seul', async () => {
  const base = { facture_type: 'fin', facture_id: F.fac, date: JOUR, montant: 50000, motif: 'Compensation avec la note de frais de l\'associé' };
  assert.equal((await appel('POST', '/finance/reglements/hors-caisse', 'a', 'cai', { ...base, compte: '462', tiers_id: F.associe })).status, 403, 'droit de proposer');
  assert.equal((await appel('POST', '/finance/reglements/hors-caisse', 'a', 'cpt', { ...base, compte: '5711' })).status, 400, 'pas de trésorerie');
  assert.equal((await appel('POST', '/finance/reglements/hors-caisse', 'a', 'cpt', { ...base, compte: '462', montant: 900000 })).status, 409, 'plafond du reste');
  const p = await appel('POST', '/finance/reglements/hors-caisse', 'a', 'cpt', { ...base, compte: '462' });
  assert.equal(p.status, 201, p.message);
  let d = (await appel('GET', `/finance/ventes/${F.fac}`, 'a', 'cpt')).data;
  assert.equal(Number(d.reste), 157750, 'proposé : ne règle encore rien');
  assert.equal((await appel('GET', '/finance/ventes', 'a', 'cpt')).data.compteurs.hors_caisse_a_valider, 1);
  const refus = await appel('POST', `/finance/reglements/hors-caisse/${p.data.id}/decision`, 'a', 'cpt', { decision: 'valider' });
  assert.equal(refus.status, 403);
  assert.match(refus.message, /directeur/);
  const v = await appel('POST', `/finance/reglements/hors-caisse/${p.data.id}/decision`, 'a', 'dir', { decision: 'valider' });
  assert.equal(v.status, 200, v.message);
  assert.deepEqual(await lignesEcriture('fin_reglement_hc', p.data.id), ['462 D50000', '411 C50000 T']);
  d = (await appel('GET', `/finance/ventes/${F.fac}`, 'a', 'cpt')).data;
  assert.equal(Number(d.reste), 107750);
  assert.equal(d.hors_caisse[0].statut, 'valide');
  // Le directeur propose et valide dans la foulée.
  const dir = await appel('POST', '/finance/reglements/hors-caisse', 'a', 'dir', { ...base, montant: 7750, compte: '658', motif: 'Arrondi accordé au client', valider: true });
  assert.equal(dir.status, 201, dir.message);
  assert.equal(dir.data.statut, 'valide');
  assert.equal(Number((await appel('GET', `/finance/ventes/${F.fac}`, 'a', 'cpt')).data.reste), 100000);
  // Annulation par le directeur : extourne.
  assert.equal((await appel('POST', `/finance/reglements/hors-caisse/${dir.data.id}/decision`, 'a', 'dir', { decision: 'annuler' })).status, 400, 'motif');
  const an = await appel('POST', `/finance/reglements/hors-caisse/${dir.data.id}/decision`, 'a', 'dir', { decision: 'annuler', motif: 'Arrondi refusé finalement' });
  assert.equal(an.status, 200, an.message);
  assert.deepEqual(await lignesEcriture('fin_reglement_hc', dir.data.id), []);
  assert.equal(Number((await appel('GET', `/finance/ventes/${F.fac}`, 'a', 'cpt')).data.reste), 107750);
  // Une facture réglée hors caisse ne s'annule pas tant que le règlement tient.
  assert.equal((await appel('POST', `/finance/ventes/${F.fac}/annuler`, 'a', 'cpt', { motif: 'Erreur' })).status, 409);
});

test('Avoir client : limité à la facture, écriture inverse (D 706 / D 4431 / C 411)', async () => {
  const trop = await appel('POST', '/finance/ventes', 'a', 'cai', document({ type: 'avoir', facture_origine_id: F.fac,
    lignes: [{ designation: 'Remise', quantite: 1, prix_unitaire: 400000, taxe_id: F.tva }] }));
  assert.equal(trop.status, 201);
  assert.equal((await appel('POST', `/finance/ventes/${trop.data.id}/valider`, 'a', 'cpt')).status, 400);
  await appel('DELETE', `/finance/ventes/${trop.data.id}`, 'a', 'cai');
  const av = await appel('POST', '/finance/ventes', 'a', 'cai', document({ type: 'avoir', facture_origine_id: F.fac,
    lignes: [{ designation: 'Remise commerciale', quantite: 1, prix_unitaire: 20000, taxe_id: F.tva }] }));
  const v = await appel('POST', `/finance/ventes/${av.data.id}/valider`, 'a', 'cpt');
  assert.equal(v.status, 200, v.message);
  assert.equal(v.data.numero, `AVC-${AN}-00001`);
  assert.deepEqual(await lignesEcriture('fin_facture', av.data.id), ['411 C23850 T', '706 D20000', '4431 D3850']);
  assert.equal(Number((await appel('GET', `/finance/ventes/${F.fac}`, 'a', 'cpt')).data.reste), 83900);
  const e = await appel('GET', '/finance/ventes/echeancier', 'a', 'cpt');
  assert.equal(Number(e.data.total), 83900);
});

test('Isolement : un autre client ne voit ni ne règle ces documents', async () => {
  assert.equal((await appel('GET', `/finance/ventes/${F.fac}`, 'b', 'dir')).status, 404);
  assert.equal((await fetch(`${BASE}/finance/ventes/${F.fac}/pdf`, { headers: { Authorization: `Bearer ${C.b.u.dir.token}` } })).status, 404);
  assert.equal((await appel('POST', '/finance/reglements/hors-caisse', 'b', 'dir', { facture_type: 'fin', facture_id: F.fac, date: JOUR, montant: 1, compte: '658', motif: 'x' })).status, 400);
});

test('Fournisseur : « Enregistrer le paiement » crée la sortie de caisse (D 401 / C caisse), solde de caisse contrôlé', async () => {
  const ref = (await appel('GET', '/finance/achats/referentiels', 'a', 'cai')).data;
  const cat = ref.categories.find((c) => c.code === 'FOURN').id;
  const f = await appel('POST', '/finance/achats', 'a', 'cai', { tiers_id: F.associe, reference: 'NF-9', date_facture: JOUR, categorie_id: cat,
    lignes: [{ designation: 'Fournitures avancées par l\'associé', quantite: 1, prix_unitaire: 300000 }] });
  assert.equal(f.status, 201, f.message);
  assert.equal((await appel('POST', `/finance/achats/fin/${f.data.id}/valider`, 'a', 'cpt')).status, 200);
  // 200 000 en caisse (encaissement précédent) : une sortie de 300 000 rendrait la caisse négative.
  const neg = await appel('POST', '/finance/reglements/paiement', 'a', 'cai',
    { facture_type: 'fin', facture_id: f.data.id, journal_id: C.a.caisse, date: JOUR, montant: 300000, rubrique_code: 'ACH' });
  assert.ok(neg.status >= 400, 'la caisse refuse');
  const [{ n }] = await sql('SELECT count(*)::int AS n FROM journal WHERE tenant_id = $1 AND sortie > 0', [C.a.tenant]);
  assert.equal(n, 0, 'rien n\'est écrit en caisse');
  const r = await appel('POST', '/finance/reglements/paiement', 'a', 'cai',
    { facture_type: 'fin', facture_id: f.data.id, journal_id: C.a.caisse, date: JOUR, montant: 150000, rubrique_code: 'ACH' });
  if (r.data?.en_attente) {
    assert.match(r.data.message, /approbation/);   // budget : la dépense attend le directeur
  } else {
    assert.equal(r.status, 201, r.message);
    assert.deepEqual(await lignesEcriture('journal', r.data.mouvement_id), ['401 D150000 T', '5711 C150000']);
    assert.equal(Number((await appel('GET', `/finance/achats/fin/${f.data.id}`, 'a', 'cpt')).data.reste), 150000);
  }
});
