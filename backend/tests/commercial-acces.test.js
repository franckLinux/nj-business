// tests/commercial-acces.test.js — NJ COMMERCIAL : accès au module chez le client (053).
//
//  • un profil métier ne remplace que les droits de SON module : un directeur
//    doté d'un profil de caisse garde NJ COMMERCIAL ; un caissier doté d'un
//    profil achats garde sa caisse ;
//  • un profil de caisse restreint toujours la caisse comme avant ;
//  • /auth/me renvoie bien les permissions com.* et le module activé ;
//  • migration 053 : plafond sans aucune com.* complété si le module est
//    activé ; plafond choisi (au moins une com.*) ou module inactif : intacts.
//
//   TEST_DATABASE_URL=postgres://…/base_de_test  node --test tests/commercial-acces.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const DB = process.env.TEST_DATABASE_URL;
if (!DB) { console.error('TEST_DATABASE_URL absent : test ignoré.'); process.exit(0); }
const SECRET = 'test-secret-' + crypto.randomBytes(16).toString('hex');
const PORT = 9600 + Math.floor(Math.random() * 300);
const sfx = crypto.randomBytes(3).toString('hex');
const pool = new Pool({ connectionString: DB });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const T = {};
const U = {};
let serveur;

const profil = async (tenant, code, perms) => {
  const [r] = await sql('INSERT INTO roles (nom, code, tenant_id, is_system) VALUES ($1, $2, $3, false) RETURNING id', [code, code, tenant]);
  for (const p of perms) await sql('INSERT INTO role_permissions (role_id, permission_code) VALUES ($1, $2)', [r.id, p]);
  return r.id;
};
const utilisateur = async (cle, tenant, role, profilId = null) => {
  const username = `${cle}-${sfx}`;
  const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif, custom_role_id)
                          VALUES ($1, $2, $3, $4, $5, true, $6) RETURNING id`,
  [tenant, username, `${username}@test.cm`, await bcrypt.hash('x', 4), role, profilId]);
  U[cle] = { id: u.id, token: jwt.sign({ sub: u.id, username, role, tenantId: tenant }, SECRET, { expiresIn: '1h' }) };
};
const moi = async (cle) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/auth/me`, { headers: { Authorization: `Bearer ${U[cle].token}` } });
  const j = await r.json();
  return j.data ?? j;
};
const perms = (m) => m.permissions || m.user?.permissions || [];
const modules = (m) => m.modules || m.user?.modules || [];

before(async () => {
  for (const k of ['A', 'P1', 'P2', 'P3']) {
    [{ id: T[k] }] = await sql('INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id', [`acc-${k.toLowerCase()}-${sfx}`, `Accès ${k} ${sfx}`]);
  }
  for (const k of ['A', 'P1', 'P2']) {
    await sql("INSERT INTO tenant_modules (tenant_id, module_code, actif) VALUES ($1, 'commercial', true), ($1, 'caisse', true) ON CONFLICT DO NOTHING", [T[k]]);
  }
  const caisseAdjoint = await profil(T.A, `adjoint-${sfx}`, ['journal.view', 'journal.validate']);
  const achats = await profil(T.A, `achats-${sfx}`, ['com.da.creer', 'com.articles.voir']);
  await utilisateur('dir', T.A, 'directeur', caisseAdjoint);
  await utilisateur('cai', T.A, 'caissier', achats);
  await utilisateur('dirSans', T.A, 'directeur');
  serveur = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: DB, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test', SMTP_HOST: '', RATE_LIMIT_MAX: '100000', MODULES_CONTROLE: 'appliquer' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 60; i += 1) {
    try { await fetch(`http://127.0.0.1:${PORT}/api/health`); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
});

after(async () => {
  serveur?.kill();
  await sql('DELETE FROM users WHERE username LIKE $1', [`%-${sfx}`]).catch(() => {});
  for (const t of Object.values(T)) {
    const c = await pool.connect();   // tout ou rien : un client non supprimé garde ses modules
    try {
      await c.query('BEGIN');
      for (const q of ['DELETE FROM com_acces_053 WHERE tenant_id = $1', 'DELETE FROM tenant_permissions WHERE tenant_id = $1', 'DELETE FROM tenant_modules WHERE tenant_id = $1',
        'DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE tenant_id = $1)', 'DELETE FROM roles WHERE tenant_id = $1', 'DELETE FROM tenants WHERE id = $1']) {
        await c.query(q, [t]);
      }
      await c.query('COMMIT');
    } catch { await c.query('ROLLBACK').catch(() => {}); } finally { c.release(); }
  }
  await pool.end();
});

test('directeur doté d\'un profil de caisse : garde NJ COMMERCIAL, et sa caisse reste restreinte par le profil', async () => {
  const m = await moi('dir');
  const p = perms(m);
  assert.ok(p.filter((x) => x.startsWith('com.')).length >= 10, `com.* attendues, reçu : ${p.join(', ')}`);
  assert.ok(p.includes('journal.validate'));
  assert.ok(!p.includes('journal.delete'), 'le profil de caisse restreint toujours la caisse');
  assert.equal(modules(m).find((x) => x.code === 'commercial')?.actif, true);
});

test('caissier doté d\'un profil achats : garde sa caisse et reçoit les droits achats du profil seulement', async () => {
  const p = perms(await moi('cai'));
  assert.ok(p.includes('journal.create'), 'droits de caisse du rôle conservés');
  assert.ok(p.includes('com.da.creer'));
  assert.ok(!p.includes('com.da.approuver'));
});

test('directeur sans profil : toutes les permissions com.*', async () => {
  const p = perms(await moi('dirSans'));
  const [{ n }] = await sql("SELECT COUNT(*)::int AS n FROM permissions WHERE module = 'commercial'");
  assert.equal(p.filter((x) => x.startsWith('com.')).length, n);
});

test('migration 053 : complète un plafond sans com.* seulement si le module est activé', async () => {
  // P1 : module actif, plafond de caisse seule → complété.
  await sql("INSERT INTO tenant_permissions (tenant_id, permission_code) VALUES ($1, 'journal.view')", [T.P1]);
  // P2 : module actif, plafond avec une com.* choisie → intact.
  await sql("INSERT INTO tenant_permissions (tenant_id, permission_code) VALUES ($1, 'journal.view'), ($1, 'com.da.creer')", [T.P2]);
  // P3 : module inactif, plafond de caisse → intact.
  await sql("INSERT INTO tenant_permissions (tenant_id, permission_code) VALUES ($1, 'journal.view')", [T.P3]);
  const migration = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '053_commercial_acces.sql'), 'utf8');
  await pool.query(migration);
  await pool.query(migration); // rejouable
  const com = async (t) => (await sql(`SELECT COUNT(*)::int AS n FROM tenant_permissions tp JOIN permissions p ON p.code = tp.permission_code
                                       WHERE tp.tenant_id = $1 AND p.module = 'commercial'`, [t]))[0].n;
  const [{ total }] = await sql("SELECT COUNT(*)::int AS total FROM permissions WHERE module = 'commercial'");
  assert.equal(await com(T.P1), total);
  assert.equal(await com(T.P2), 1);
  assert.equal(await com(T.P3), 0);
  // Retour arrière : retire exactement ce que la 053 a ajouté.
  const retour = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations-retour-arriere', '053_retour_arriere.sql'), 'utf8');
  const avant = (await sql('SELECT tenant_id, permission_code FROM com_acces_053')).length;
  assert.ok(avant >= total);
  await pool.query(retour);
  assert.equal(await com(T.P1), 0);
  assert.equal(await com(T.P2), 1);
  await pool.query(migration); // la base de test retrouve la 053
});
