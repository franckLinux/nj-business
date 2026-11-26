// tests/pme-ong-bascule.test.js — NJ FINANCE pour une PME, et passage PME → ONG (26/11/2026).
//
// Décision de Franck : une PME a accès à tout NJ FINANCE (achats, facturation,
// clients et fournisseurs, caisse, contrôle, reporting), sauf la gestion des
// activités. Si sa forme juridique devient ONG ou association, la gestion des
// activités apparaît ; si elle redevient PME, elle disparaît (rien n'est supprimé).
//   TEST_DATABASE_URL=postgres://…/base_de_test  node --test tests/pme-ong-bascule.test.js
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
const PORT = 6300 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}/api`;
const sfx = crypto.randomBytes(3).toString('hex');
const pool = new Pool({ connectionString: DB });
let serveur;
const C = { u: {} };

const sql = async (texte, params = []) => (await pool.query(texte, params)).rows;
const appel = async (methode, url, qui, corps) => {
  const r = await fetch(BASE + url, {
    method: methode,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${C.u[qui].token}` },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.data ?? j, message: j.message ?? j.error };
};

before(async () => {
  [{ id: C.tenant }] = await sql(`INSERT INTO tenants (slug, nom, forme_juridique, initialise_le) VALUES ($1, $2, 'SARL', NOW()) RETURNING id`,
    [`bascule-${sfx}`, `BASCULE ${sfx}`]);
  for (const [qui, role] of [['dir', 'directeur'], ['cpt', 'auditeur'], ['cai', 'caissier']]) {
    const username = `${qui}-bascule-${sfx}`;
    const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif) VALUES ($1, $2, $3, 'x', $4, true) RETURNING id`,
      [C.tenant, username, `${username}@test.cm`, role]);
    C.u[qui] = { id: u.id, token: jwt.sign({ sub: u.id, username, role, tenantId: C.tenant }, SECRET, { expiresIn: '1h' }) };
  }
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
  assert.equal((await appel('POST', '/finance/config/initialiser', 'cpt')).status, 200);
});
after(async () => {
  serveur?.kill();
  const cx = await pool.connect();
  try {
    await cx.query('BEGIN');
    await cx.query("SET LOCAL app.journal_maintenance = 'on'");
    await cx.query("SET LOCAL app.finance_maintenance = 'on'");
    await cx.query('DELETE FROM audit_log WHERE tenant_id = $1', [C.tenant]);
    await cx.query('DELETE FROM tenants WHERE id = $1', [C.tenant]);
    await cx.query('COMMIT');
  } catch (e) {
    await cx.query('ROLLBACK');
    console.error('Nettoyage de la base de test incomplet :', e.message);
  } finally {
    cx.release();
  }
  await pool.end();
});

test('PME : tout NJ FINANCE est ouvert, sauf la gestion des activités', async () => {
  for (const [url, qui] of [
    ['/finance/achats', 'cai'], ['/finance/achats/referentiels', 'cai'], ['/finance/achats/echeancier', 'cpt'],
    ['/finance/ventes', 'cai'], ['/finance/ventes/referentiels', 'cai'], ['/finance/ventes/echeancier', 'cpt'],
    ['/finance/tiers', 'cpt'], ['/finance/achats/extractions', 'cai'], ['/finance/config', 'dir'],
  ]) {
    const r = await appel('GET', url, qui);
    assert.equal(r.status, 200, `${url} (${qui}) : ${r.status} ${r.message || ''}`);
  }
  const acces = (await appel('GET', '/projets/acces', 'dir')).data;
  assert.deepEqual([acces.ong, acces.visible], [false, false]);
  assert.equal((await appel('GET', '/projets/demandes', 'dir')).status, 403);
  assert.equal((await appel('GET', '/projets/rapport-financier', 'dir')).status, 403);
});

test('La PME devient ONG : la gestion des activités apparaît ; redevenue PME, elle disparaît', async () => {
  const m = await appel('PUT', '/entreprise', 'dir', { forme_juridique: 'ONG' });
  assert.equal(m.status, 200, m.message);
  let acces = (await appel('GET', '/projets/acces', 'dir')).data;
  assert.deepEqual([acces.ong, acces.visible], [true, true]);
  assert.equal((await appel('GET', '/projets/demandes', 'dir')).status, 200);
  const p = await appel('POST', '/projets', 'dir', { nom: 'Projet pilote', chef_projet_id: C.u.dir.id });
  assert.equal(p.status, 201, p.message);
  assert.equal((await appel('GET', '/finance/achats', 'cai')).status, 200, 'les achats restent ouverts');

  assert.equal((await appel('PUT', '/entreprise', 'dir', { forme_juridique: 'ASSOC' })).status, 200);
  assert.equal((await appel('GET', '/projets/acces', 'dir')).data.ong, true, 'association : même chose');

  assert.equal((await appel('PUT', '/entreprise', 'dir', { forme_juridique: 'SARL' })).status, 200);
  acces = (await appel('GET', '/projets/acces', 'dir')).data;
  assert.deepEqual([acces.ong, acces.visible], [false, false]);
  const [{ n }] = await sql('SELECT count(*)::int AS n FROM activites WHERE tenant_id = $1', [C.tenant]);
  assert.equal(n, 1, 'le projet n\'est pas supprimé');
});
