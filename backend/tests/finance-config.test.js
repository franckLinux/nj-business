// tests/finance-config.test.js — NJ FINANCE lot F5 : configuration de la facturation (079).
//
// Lance le VRAI serveur (index.js) sur une base de TEST, puis appelle l'API.
//   TEST_DATABASE_URL=postgres://…/base_de_test  node --test tests/finance-config.test.js
// La base doit être migrée jusqu'à 079.
//
// Couvre : droits (caissier en lecture) ; paramétrage par défaut rejouable
// (catégories, modes, TVA 19,25 % et ses comptes) ; contrôles des comptes
// (détail, bonne classe) ; codes uniques ; prestation reliée à une famille, une
// taxe et un article de NJ COMMERCIAL ; numérotation sans trou, qui ne recule
// pas et ne change plus de préfixe une fois utilisée ; isolement des clients.
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
const PORT = 7400 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}/api`;
const sfx = crypto.randomBytes(3).toString('hex');
const pool = new Pool({ connectionString: DB });
const AN = new Date().getFullYear();
let serveur;
const C = { a: {}, b: {} };

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

const creerClient = async (cle) => {
  const c = C[cle];
  [{ id: c.tenant }] = await sql(`INSERT INTO tenants (slug, nom, forme_juridique, initialise_le) VALUES ($1, $2, 'SARL', NOW()) RETURNING id`,
    [`cfg-${cle}-${sfx}`, `CONFIG ${cle} ${sfx}`]);
  for (const m of ['caisse', 'comptabilite']) {
    await sql('INSERT INTO tenant_modules (tenant_id, module_code, actif) VALUES ($1, $2, true) ON CONFLICT DO NOTHING', [c.tenant, m]);
  }
  [{ id: c.caisse }] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type, date_ouverture, compte_tresorerie)
                                  VALUES ($1, 'BQ1', 'Banque', 'banque', $2, '521') RETURNING id`, [c.tenant, `${AN}-01-01`]);
  c.u = {};
  for (const [qui, role] of [['dir', 'directeur'], ['cpt', 'auditeur'], ['cai', 'caissier']]) {
    const username = `${qui}-cfg-${cle}-${sfx}`;
    const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif) VALUES ($1, $2, $3, 'x', $4, true) RETURNING id`,
      [c.tenant, username, `${username}@test.cm`, role]);
    for (const m of ['caisse', 'comptabilite']) {
      await sql('INSERT INTO user_modules (user_id, module_code, tenant_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [u.id, m, c.tenant]);
    }
    c.u[qui] = { id: u.id, token: jwt.sign({ sub: u.id, username, role, tenantId: c.tenant }, SECRET, { expiresIn: '1h' }) };
  }
};

before(async () => {
  await creerClient('a');
  await creerClient('b');
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
});
after(async () => {
  serveur?.kill();
  const cx = await pool.connect();
  try {
    await cx.query('BEGIN');
    await cx.query("SET LOCAL app.finance_maintenance = 'on'");
    await cx.query("SET LOCAL app.journal_maintenance = 'on'");
    const ids = [C.a.tenant, C.b.tenant].filter(Boolean);
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


test('Droits : le caissier lit le paramétrage, ne le modifie pas', async () => {
  assert.equal((await appel('GET', '/finance/config', 'a', 'cai')).status, 200);
  assert.equal((await appel('POST', '/finance/config/initialiser', 'a', 'cai')).status, 403);
  assert.equal((await appel('POST', '/finance/config/categories', 'a', 'cai', {})).status, 403);
});

test('Paramétrage par défaut : catégories, modes, TVA et comptes ; rejouable', async () => {
  const r = await appel('POST', '/finance/config/initialiser', 'a', 'cpt');
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.crees.categories.length, 8);
  assert.deepEqual(r.data.crees.modes, ['ESPECES', 'CHEQUE', 'VIREMENT', 'MOBILE']);
  assert.deepEqual(r.data.crees.taxes, ['TVA']);
  const e = await appel('GET', '/finance/config', 'a', 'cpt');
  const cat = (c) => e.data.categories.find((x) => x.code === c);
  assert.equal(cat('VTE_MARCH').compte_defaut, '7011');
  assert.equal(cat('PRESTA').compte_defaut, '706');
  assert.equal(cat('ACH_MARCH').type_achat, 'marchandises');
  assert.equal(cat('IMMO_MAT').compte_defaut, '2441');
  const tva = e.data.taxes.find((t) => t.code === 'TVA');
  assert.equal(Number(tva.taux), 19.25);
  assert.deepEqual([tva.compte_collecte, tva.compte_deductible, tva.compte_deductible_immo], ['4431', '4452', '4451']);
  assert.equal(String(e.data.modes.find((m) => m.code === 'VIREMENT').journal_id), String(C.a.caisse));
  C.a.tva = tva.id;
  const encore = await appel('POST', '/finance/config/initialiser', 'a', 'cpt');
  assert.deepEqual(encore.data.crees, { categories: [], modes: [], taxes: [] });
});

test('Comptes : détail obligatoire et bonne classe', async () => {
  let r = await appel('POST', '/finance/config/categories', 'a', 'cpt', { code: 'X1', libelle: 'Produit', sens: 'produit', compte_defaut: '6051' });
  assert.equal(r.status, 400);
  assert.match(r.message, /commencer par 7/);
  r = await appel('POST', '/finance/config/categories', 'a', 'cpt', { code: 'X1', libelle: 'Produit', sens: 'produit', compte_defaut: '701' });
  assert.equal(r.status, 400);
  assert.match(r.message, /regroupement/);
  r = await appel('POST', '/finance/config/categories', 'a', 'cpt', { code: 'X1', libelle: 'Charge', sens: 'charge', type_achat: 'immobilisation', compte_defaut: '6051' });
  assert.equal(r.status, 400);
  r = await appel('POST', '/finance/config/categories', 'a', 'cpt', { code: 'acc_div', libelle: 'Autres produits', sens: 'produit', compte_defaut: '7071' });
  assert.equal(r.status, 201, r.message);
  r = await appel('POST', '/finance/config/categories', 'a', 'cpt', { code: 'ACC_DIV', libelle: 'Doublon', sens: 'produit', compte_defaut: '7071' });
  assert.equal(r.status, 409);
  r = await appel('POST', '/finance/config/taxes', 'a', 'cpt', { code: 'PREC', intitule: 'Précompte', taux: 5.5, type: 'precompte', compte_collecte: '6051' });
  assert.equal(r.status, 400);
});

test('Familles et prestations : rattachements contrôlés, lien vers un article de NJ COMMERCIAL', async () => {
  let r = await appel('POST', '/finance/config/familles', 'a', 'cpt', { code: 'FORM', libelle: 'Formations', compte_produit: '706' });
  assert.equal(r.status, 201, r.message);
  const famille = r.data.id;
  const [{ id: famCom }] = await sql(`INSERT INTO com_familles (tenant_id, code, nom) VALUES ($1, 'FOUR', 'Fournitures') RETURNING id`, [C.a.tenant]);
  const [{ id: unite }] = await sql(`INSERT INTO com_unites (tenant_id, code, libelle, decimales) VALUES ($1, 'U', 'Unité', 0) RETURNING id`, [C.a.tenant]);
  const [{ id: article }] = await sql(`INSERT INTO com_articles (tenant_id, reference, designation, famille_id, suivi_comptable, unite, unite_stock_id, unite_achat_id, unite_vente_id)
                                       VALUES ($1, 'ART-1', 'Ramette papier', $2, true, 'U', $3, $3, $3) RETURNING id`, [C.a.tenant, famCom, unite]);
  r = await appel('POST', '/finance/config/prestations', 'a', 'cpt', { code: 'FORM-J', libelle: 'Journée de formation', famille_id: famille, unite: 'jour', prix_vente: 150000, taxe_id: C.a.tva });
  assert.equal(r.status, 201, r.message);
  r = await appel('POST', '/finance/config/prestations', 'a', 'cpt', { code: 'PAPIER', libelle: 'Ramette', type: 'article', com_article_id: article, prix_vente: '3500,50' });
  assert.equal(r.status, 201, r.message);
  C.a.prestation = r.data.id;
  r = await appel('POST', '/finance/config/prestations', 'a', 'cpt', { code: 'PAPIER2', libelle: 'Autre', com_article_id: article });
  assert.equal(r.status, 409);
  const e = await appel('GET', '/finance/config', 'a', 'cpt');
  const p = e.data.prestations.find((x) => x.code === 'PAPIER');
  assert.equal(p.prix_vente, '3500.50');
  assert.equal(p.article_reference, 'ART-1');
  assert.equal(e.data.prestations.find((x) => x.code === 'FORM-J').famille, 'Formations');
  // Désactivation (rien ne se supprime).
  const maj = await appel('PUT', `/finance/config/prestations/${C.a.prestation}`, 'a', 'cpt', { ...p, actif: false });
  assert.equal(maj.status, 200, maj.message);
  // Références d'un autre client refusées.
  const [{ id: taxeB }] = await sql(`INSERT INTO com_taxes (tenant_id, code, intitule, taux) VALUES ($1, 'TB', 'Taxe B', 1) RETURNING id`, [C.b.tenant]);
  r = await appel('POST', '/finance/config/prestations', 'a', 'cpt', { code: 'X', libelle: 'X', taxe_id: taxeB });
  assert.equal(r.status, 400);
});

test('Numérotation : sans trou, ne recule pas, préfixe figé une fois utilisée', async () => {
  const svc = require('../src/services/finance/config.service');
  const { sequelize } = require('../src/models');
  const numeros = await Promise.all([1, 2, 3, 4, 5].map(() => sequelize.transaction((t) => svc.prochainNumero(t, C.a.tenant, 'facture_client', `${AN}-05-10`))));
  assert.deepEqual(numeros.sort(), [1, 2, 3, 4, 5].map((n) => `FAC-${AN}-${String(n).padStart(5, '0')}`));
  // Une transaction annulée ne consomme pas de numéro.
  await assert.rejects(sequelize.transaction(async (t) => { await svc.prochainNumero(t, C.a.tenant, 'facture_client', `${AN}-05-10`); throw new Error('annulée'); }));
  assert.equal(await sequelize.transaction((t) => svc.prochainNumero(t, C.a.tenant, 'facture_client', `${AN}-06-01`)), `FAC-${AN}-00006`);
  let r = await appel('PUT', '/finance/config/sequences', 'a', 'cpt', { type_document: 'facture_client', annee: AN, prefixe: 'FAC', chiffres: 5, prochain: 3 });
  assert.equal(r.status, 409);
  r = await appel('PUT', '/finance/config/sequences', 'a', 'cpt', { type_document: 'facture_client', annee: AN, prefixe: 'FV', chiffres: 5, prochain: 10 });
  assert.equal(r.status, 409);
  r = await appel('PUT', '/finance/config/sequences', 'a', 'cpt', { type_document: 'avoir_client', annee: AN + 1, prefixe: 'AV', chiffres: 4, prochain: 1 });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.apercu, `AV-${AN + 1}-0001`);
  await sequelize.close();
});

test('Isolement entre clients', async () => {
  const e = await appel('GET', '/finance/config', 'b', 'dir');
  assert.equal(e.data.categories.length, 0);
  assert.equal(e.data.prestations.length, 0);
  const r = await appel('PUT', `/finance/config/prestations/${C.a.prestation}`, 'b', 'cpt', { code: 'Z', libelle: 'Z' });
  assert.equal(r.status, 404, r.message);
});
