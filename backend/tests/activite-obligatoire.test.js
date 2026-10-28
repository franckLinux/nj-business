// tests/activite-obligatoire.test.js — Activité / projet obligatoire, personne
// par personne (migration 039).
//
// Lance le VRAI serveur (index.js) sur une base de TEST, puis appelle l'API.
//   TEST_DATABASE_URL=postgres://…/base_de_test  npm run test:activite-obligatoire
// La base doit être migrée jusqu'à 039. Aucune base n'est utilisée sans
// TEST_DATABASE_URL explicite.
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
const PORT = 5400 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}/api`;
const sfx = crypto.randomBytes(3).toString('hex');
const pool = new Pool({ connectionString: DB });
let serveur;
let TENANT;
let JOURNAL;
let ACT;
const U = {};

const sql = async (texte, params = []) => (await pool.query(texte, params)).rows;
const appel = async (methode, url, qui, corps) => {
  const r = await fetch(BASE + url, {
    method: methode,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${U[qui].token}` },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.data ?? j, message: j.message ?? j.error };
};
const creerUtilisateur = async (cle, role) => {
  const username = `${cle}-${sfx}`;
  const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif)
                          VALUES ($1, $2, $3, 'x', $4, true) RETURNING id`, [TENANT, username, `${username}@test.cm`, role]);
  U[cle] = { id: u.id, token: jwt.sign({ sub: u.id, username, role, tenantId: TENANT }, SECRET, { expiresIn: '1h' }) };
};
const jour = new Date().toISOString().slice(0, 10);
const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const saisie = (qui, rubrique, extra = {}) => appel('POST', '/journal', qui, {
  date: jour, mois: MOIS[new Date().getMonth()], annee: new Date().getFullYear(), journal_id: JOURNAL,
  rubrique_code: rubrique, intitule: 'Test', entree: 1000, sortie: 0, ...extra,
});

before(async () => {
  [{ id: TENANT }] = await sql(`INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id`,
    [`act-oblig-${sfx}`, `ACT OBLIG ${sfx}`]);
  await sql(`INSERT INTO rubriques (tenant_id, code, intitule, type, est_virement_interne) VALUES
             ($1, 'E1', 'VENTES', 'entree', false), ($1, 'VIR', 'VIREMENT', 'entree', true)`, [TENANT]);
  [{ id: JOURNAL }] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type, date_ouverture)
                                 VALUES ($1, 'CS1', 'Caisse', 'caisse', CURRENT_DATE - 40) RETURNING id`, [TENANT]);
  [{ id: ACT }] = await sql(`INSERT INTO activites (tenant_id, nom) VALUES ($1, 'Formation') RETURNING id`, [TENANT]);
  await creerUtilisateur('dir', 'directeur');
  await creerUtilisateur('cai', 'caissier');
  serveur = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: DB, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test', SMTP_HOST: '', RATE_LIMIT_MAX: '100000' },
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
  await sql('DELETE FROM tenants WHERE id = $1', [TENANT]).catch(() => {});
  await pool.end();
});

test('Par défaut, l\'activité reste facultative', async () => {
  const r = await saisie('cai', 'E1');
  assert.equal(r.status, 201, r.message);
});

test('Seul un responsable règle l\'option, jamais pour lui-même', async () => {
  assert.equal((await appel('PUT', `/users/${U.dir.id}/activite-obligatoire`, 'cai', { obligatoire: true })).status, 403);
  assert.equal((await appel('PUT', `/users/${U.dir.id}/activite-obligatoire`, 'dir', { obligatoire: true })).status, 400);
  const r = await appel('PUT', `/users/${U.cai.id}/activite-obligatoire`, 'dir', { obligatoire: true });
  assert.equal(r.status, 200, r.message);
  const liste = await appel('GET', '/users', 'dir');
  assert.equal(liste.data.find((u) => u.id === U.cai.id).activite_obligatoire, true);
  assert.equal(liste.data.find((u) => u.id === U.dir.id).activite_obligatoire, false);
  assert.equal((await appel('GET', '/auth/me', 'cai')).data.activite_obligatoire, true);
});

test('Obligatoire : saisie refusée sans activité, acceptée avec ; virements exemptés', async () => {
  let r = await saisie('cai', 'E1');
  assert.equal(r.status, 400);
  assert.match(r.message, /obligatoire/);
  r = await saisie('cai', 'E1', { activite_id: ACT });
  assert.equal(r.status, 201, r.message);
  const id = r.data.id;
  assert.equal((await saisie('cai', 'VIR')).status, 201, 'virement interne exempté');
  // Le directeur, non concerné, saisit librement.
  assert.equal((await saisie('dir', 'E1')).status, 201);
  // Retirer l'activité d'une écriture : refusé pour la personne concernée.
  r = await appel('PUT', `/journal/${id}`, 'cai', { activite_id: null });
  assert.equal(r.status, 400);
});

test('Sans aucune activité active, la règle reste sans effet', async () => {
  await sql('UPDATE activites SET actif = false WHERE tenant_id = $1', [TENANT]);
  assert.equal((await saisie('cai', 'E1')).status, 201);
  await sql('UPDATE activites SET actif = true WHERE tenant_id = $1', [TENANT]);
});

test('Retour au facultatif, journalisé', async () => {
  assert.equal((await appel('PUT', `/users/${U.cai.id}/activite-obligatoire`, 'dir', { obligatoire: false })).status, 200);
  assert.equal((await saisie('cai', 'E1')).status, 201);
  const a = await sql(`SELECT action FROM audit_log WHERE tenant_id = $1 AND action LIKE 'ACTIVITE_OBLIGATOIRE%' ORDER BY id`, [TENANT]);
  assert.deepEqual(a.map((x) => x.action), ['ACTIVITE_OBLIGATOIRE_ACTIVEE', 'ACTIVITE_OBLIGATOIRE_RETIREE']);
});
