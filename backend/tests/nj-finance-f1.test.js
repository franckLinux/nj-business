// tests/nj-finance-f1.test.js — NJ FINANCE, lot F1 (migration 074).
//  • le module « caisse » s'affiche NJ FINANCE ; son code ne change pas ;
//  • la migration est rejouable sans effet ;
//  • le retour arrière rétablit NJ CAISSE PRO, puis la 074 se réapplique ;
//  • aucune donnée de caisse ni aucun module client n'est touché.
//
//   TEST_DATABASE_URL=postgres://…/base_de_test  node --test tests/nj-finance-f1.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const DB = process.env.TEST_DATABASE_URL;
if (!DB) {
  console.error('TEST_DATABASE_URL absent : test ignoré (ne jamais viser la base de production).');
  process.exit(0);
}
const pool = new Pool({ connectionString: DB });
const lire = (f) => fs.readFileSync(path.join(__dirname, '..', 'db', f), 'utf8');
const MIGRATION = lire('migrations/074_nj_finance_nom.sql');
const RETOUR = lire('migrations-retour-arriere/074_retour_arriere.sql');
const moduleCaisse = async () => (await pool.query(
  "SELECT code, nom, description, statut, par_defaut, prefixes_api FROM modules WHERE code = 'caisse'")).rows[0];
const empreinte = async () => (await pool.query(`
  SELECT (SELECT count(*) FROM journal) AS journal,
         (SELECT count(*) FROM tenant_modules) AS tenant_modules,
         (SELECT count(*) FROM user_modules) AS user_modules,
         (SELECT count(*) FROM modules) AS modules`)).rows[0];

test.after(() => pool.end());

test('Le module caisse s\'affiche NJ FINANCE, code et réglages inchangés', async () => {
  const m = await moduleCaisse();
  assert.equal(m.code, 'caisse');
  assert.equal(m.nom, 'NJ FINANCE');
  assert.match(m.description, /gestion d'activité/);
  assert.equal(m.statut, 'operationnel');
  assert.ok(m.prefixes_api.includes('/journal'), 'préfixes d\'API conservés');
  const v = await pool.query("SELECT 1 FROM schema_migrations WHERE version = '074_nj_finance_nom.sql'");
  assert.equal(v.rowCount, 1);
});

test('La migration 074 est rejouable sans effet de bord', async () => {
  const avant = await empreinte();
  const mAvant = await moduleCaisse();
  await pool.query(MIGRATION);
  await pool.query(MIGRATION);
  assert.deepEqual(await empreinte(), avant);
  const mApres = await moduleCaisse();
  assert.equal(mApres.nom, mAvant.nom);
  assert.equal(mApres.description, mAvant.description);
});

test('Retour arrière : NJ CAISSE PRO rétabli, puis 074 réappliquée', async () => {
  const avant = await empreinte();
  await pool.query(RETOUR);
  const r = await moduleCaisse();
  assert.equal(r.nom, 'NJ CAISSE PRO');
  assert.equal((await pool.query("SELECT 1 FROM schema_migrations WHERE version LIKE '074_%'")).rowCount, 0);
  await pool.query(MIGRATION);
  await pool.query("INSERT INTO schema_migrations(version) VALUES ('074_nj_finance_nom.sql') ON CONFLICT DO NOTHING");
  assert.equal((await moduleCaisse()).nom, 'NJ FINANCE');
  assert.deepEqual(await empreinte(), avant, 'aucune donnée de caisse ni aucun module client touché');
});
