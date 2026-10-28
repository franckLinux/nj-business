// tests/modules.test.js — NJ BUSINESS : modules activés par client (migration 048).
//
//  • tous les clients ont NJ CAISSE PRO après la migration ; un nouveau client
//    le reçoit automatiquement (déclencheur) ; migration rejouable ;
//  • /auth/login et /auth/me renvoient les modules de l'espace ;
//  • module désactivé → 403 MODULE_INACTIF sur ses routes, pour ce client
//    seulement, rôle cabinet compris ; les routes du socle restent ouvertes ;
//  • désactivation sans motif refusée ; module en préparation non activable ;
//    seul le super_admin modifie l'activation ; tout est tracé ;
//  • réactivation : les données sont intactes ;
//  • mode « observer » : aucun refus.
//
//   TEST_DATABASE_URL=postgres://…/base_de_test  npm run test:modules
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const DB = process.env.TEST_DATABASE_URL;
if (!DB) {
  console.error('TEST_DATABASE_URL absent : test ignoré (ne jamais viser la base de production).');
  process.exit(0);
}
const SECRET = 'test-secret-' + crypto.randomBytes(16).toString('hex');
const PORT = 7500 + Math.floor(Math.random() * 400);
const PORT_OBS = PORT + 1;
const sfx = crypto.randomBytes(3).toString('hex');
const pool = new Pool({ connectionString: DB });
const MOT_DE_PASSE = 'Mdp-test-2026!';
const serveurs = [];
let A;
let B;
const U = {};

const sql = async (texte, params = []) => (await pool.query(texte, params)).rows;
const appel = async (methode, url, qui, corps, { port = PORT, entetes = {} } = {}) => {
  const r = await fetch(`http://127.0.0.1:${port}/api${url}`, {
    method: methode,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${U[qui].token}`, ...entetes },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.data ?? j, message: j.message ?? j.error };
};
const creerUtilisateur = async (cle, role, tenant) => {
  const username = `${cle}-${sfx}`;
  const hash = await bcrypt.hash(MOT_DE_PASSE, 4);
  const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif)
                          VALUES ($1, $2, $3, $4, $5, true) RETURNING id`, [tenant, username, `${username}@test.cm`, hash, role]);
  U[cle] = { id: u.id, username, token: jwt.sign({ sub: u.id, username, role, tenantId: tenant }, SECRET, { expiresIn: '1h' }) };
};
const demarrer = async (port, mode) => {
  const s = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: DB, JWT_SECRET: SECRET, PORT: String(port), NODE_ENV: 'test', SMTP_HOST: '',
      RATE_LIMIT_MAX: '100000', MODULES_CONTROLE: mode },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = (d) => process.env.DEBUG_TEST && process.stderr.write(d);
  s.stdout.on('data', log); s.stderr.on('data', log);
  serveurs.push(s);
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch { /* démarrage */ }
    await new Promise((r) => setTimeout(r, 250));
  }
};
const caisse = async (tenant) => (await sql(
  "SELECT actif FROM tenant_modules WHERE tenant_id = $1 AND module_code = 'caisse'", [tenant]))[0]?.actif;

before(async () => {
  [{ id: A }] = await sql('INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id', [`ma-${sfx}`, `Modules A ${sfx}`]);
  [{ id: B }] = await sql('INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id', [`mb-${sfx}`, `Modules B ${sfx}`]);
  const [{ id: jA }] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type) VALUES ($1, 'CS1', 'Caisse', 'caisse') RETURNING id`, [A]);
  await sql(`INSERT INTO journal (tenant_id, date, mois, annee, journal_id, type_caisse, rubrique_code, intitule, beneficiaire, entree, sortie)
             VALUES ($1, '2025-03-02', 'Mars', 2025, $2, 'especes', 'D1', 'Test modules', 'X', 50000, 0)`, [A, jA]);
  await creerUtilisateur('dirA', 'directeur', A);
  await creerUtilisateur('caiA', 'caissier', A);
  await creerUtilisateur('dirB', 'directeur', B);
  await creerUtilisateur('adm', 'super_admin', null);
  await creerUtilisateur('cab', 'comptable_cabinet', null);
  await sql('INSERT INTO cabinet_affectations (user_id, tenant_id) VALUES ($1, $2)', [U.cab.id, A]);
  await demarrer(PORT, 'appliquer');
  await demarrer(PORT_OBS, 'observer');
});

after(async () => {
  serveurs.forEach((s) => s.kill());
  // Base de test uniquement : les écritures de caisse sont protégées contre la
  // suppression (027) ; le mode maintenance n'est ouvert que dans cette transaction.
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL app.journal_maintenance = 'on'");
    for (const t of [A, B]) await c.query('DELETE FROM journal WHERE tenant_id = $1', [t]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK'); console.error('nettoyage journal :', e.message); } finally { c.release(); }
  for (const t of [A, B]) {
    await sql('DELETE FROM audit_log WHERE tenant_id = $1', [t]).catch(() => {});
    await sql('DELETE FROM cabinet_affectations WHERE tenant_id = $1', [t]).catch(() => {});
    await sql('DELETE FROM tenant_modules WHERE tenant_id = $1', [t]).catch(() => {});
    await sql('DELETE FROM journaux WHERE tenant_id = $1', [t]).catch(() => {});
  }
  for (const u of Object.values(U)) {
    await sql('DELETE FROM audit_log WHERE user_id = $1', [u.id]).catch(() => {});
    await sql('DELETE FROM users WHERE id = $1', [u.id]).catch(() => {});
  }
  for (const t of [A, B]) await sql('DELETE FROM tenants WHERE id = $1', [t]).catch(() => {});
  await pool.end();
});

test('T1/T3/T4 — tous les clients ont NJ CAISSE PRO ; déclencheur à la création ; migration rejouable', async () => {
  const [{ n }] = await sql(`SELECT COUNT(*)::int AS n FROM tenants t
     WHERE NOT EXISTS (SELECT 1 FROM tenant_modules tm WHERE tm.tenant_id = t.id AND tm.module_code = 'caisse' AND tm.actif)`);
  assert.equal(n, 0, 'aucun client sans NJ CAISSE PRO');
  assert.equal(await caisse(A), true, 'nouveau client : module par défaut activé par le déclencheur');
  const avant = await sql('SELECT COUNT(*)::int AS n FROM tenant_modules');
  const migration = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '048_modules_nj_business.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(migration);
    await client.query('COMMIT');
  } finally { client.release(); }
  assert.deepEqual(await sql('SELECT COUNT(*)::int AS n FROM tenant_modules'), avant, 'rejouée : aucune ligne en plus');
  // Rejouer la 048 ne réécrit pas le catalogue : NJ COMMERCIAL reste opérationnel (050).
  const [{ statut }] = await sql("SELECT statut FROM modules WHERE code = 'commercial'");
  assert.equal(statut, 'operationnel');
});

test('T5 — la connexion renvoie les modules de l\'espace', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: U.caiA.username, password: MOT_DE_PASSE }),
  });
  assert.equal(r.status, 200);
  const { data } = await r.json();
  const c = data.user.modules.find((m) => m.code === 'caisse');
  assert.equal(c.actif, true);
  assert.equal(c.statut, 'operationnel');
  assert.equal(data.user.modules.find((m) => m.code === 'commercial').actif, false);
  assert.equal(data.user.modules.find((m) => m.code === 'stock'), undefined, 'stock intégré à NJ COMMERCIAL (049)');
  assert.ok(['dsf', 'revis', 'cg'].every((c) => data.user.modules.some((m) => m.code === c && m.statut === 'en_preparation')), 'nouveaux modules (049)');
  assert.equal((await appel('GET', '/journaux', 'caiA')).status, 200, 'la caisse fonctionne comme avant');
});

test('T9/T10 — seul le super_admin modifie ; motif exigé ; module en préparation non activable', async () => {
  assert.equal((await appel('PUT', `/plateforme/clients/${A}/modules/caisse`, 'dirA', { actif: false, motif: 'essai' })).status, 403, 'directeur refusé');
  assert.equal((await appel('PUT', `/plateforme/clients/${A}/modules/caisse`, 'cab', { actif: false, motif: 'essai' })).status, 403, 'comptable cabinet refusé');
  let r = await appel('PUT', `/plateforme/clients/${A}/modules/caisse`, 'adm', { actif: false });
  assert.equal(r.status, 400);
  assert.match(r.message, /Motif/);
  r = await appel('PUT', `/plateforme/clients/${A}/modules/dsf`, 'adm', { actif: true });   // NJ DSF : en préparation (049)
  assert.equal(r.status, 400);
  assert.match(r.message, /préparation/);
  assert.equal((await appel('PUT', `/plateforme/clients/${A}/modules/inexistant`, 'adm', { actif: true })).status, 404);
  assert.equal(await caisse(A), true, 'rien n\'a changé');
});

test('T6/T7/T12 — module désactivé : routes du module refusées pour CE client seulement, socle ouvert', async () => {
  const lignesAvant = await sql('SELECT COUNT(*)::int AS n FROM journal WHERE tenant_id = $1', [A]);
  const r = await appel('PUT', `/plateforme/clients/${A}/modules/caisse`, 'adm', { actif: false, motif: 'Test de désactivation' });
  assert.equal(r.status, 200, r.message);
  assert.equal(await caisse(A), false);

  let x = await appel('GET', '/journaux', 'caiA');
  assert.equal(x.status, 403);
  assert.equal(x.data.code, 'MODULE_INACTIF');
  assert.equal(x.data.module, 'caisse');
  assert.equal((await appel('GET', '/journal/soldes?mois=Mars&annee=2025', 'dirA')).status, 403, 'directeur aussi');
  assert.equal((await appel('GET', '/journaux', 'dirB')).status, 200, 'client B non touché');
  // Comptable cabinet affecté au client A : même règle.
  x = await appel('GET', '/journaux', 'cab', undefined, { entetes: { 'X-Tenant-Id': A } });
  assert.equal(x.status, 403);
  assert.equal(x.data.code, 'MODULE_INACTIF');
  // Socle : profil et notifications restent accessibles ; /auth/me signale le module inactif.
  const me = await appel('GET', '/auth/me', 'caiA');
  assert.equal(me.status, 200);
  assert.equal(me.data.modules.find((m) => m.code === 'caisse').actif, false);
  assert.equal((await appel('GET', '/notifications/count', 'caiA')).status, 200);
  // Rien n'a été supprimé.
  assert.deepEqual(await sql('SELECT COUNT(*)::int AS n FROM journal WHERE tenant_id = $1', [A]), lignesAvant);
  const [trace] = await sql("SELECT action, nouvelle_valeur FROM audit_log WHERE tenant_id = $1 AND entite = 'tenant_modules' ORDER BY id DESC LIMIT 1", [A]);
  assert.equal(trace.action, 'MODULE_DESACTIVATION');
  assert.equal(trace.nouvelle_valeur.motif, 'Test de désactivation');
  // Matrice d'administration.
  const m = await appel('GET', '/plateforme/modules', 'adm');
  assert.equal(m.status, 200);
  assert.equal(m.data.clients.find((c) => c.id === A).modules.caisse, false);
  assert.equal(m.data.clients.find((c) => c.id === B).modules.caisse, true);
});

test('T11 — mode observer : aucun refus, le serveur journalise seulement', async () => {
  assert.equal(await caisse(A), false, 'précondition : module toujours désactivé');
  assert.equal((await appel('GET', '/journaux', 'caiA', undefined, { port: PORT_OBS })).status, 200);
});

test('T8 — réactivation : accès rétabli, données identiques', async () => {
  const r = await appel('PUT', `/plateforme/clients/${A}/modules/caisse`, 'adm', { actif: true, motif: 'Fin du test' });
  assert.equal(r.status, 200, r.message);
  const x = await appel('GET', '/journaux', 'caiA');
  assert.equal(x.status, 200);
  assert.equal((await sql("SELECT COUNT(*)::int AS n FROM journal WHERE tenant_id = $1 AND intitule = 'Test modules'", [A]))[0].n, 1);
  const cfg = await appel('GET', `/plateforme/clients/${A}/modules`, 'adm');
  const c = cfg.data.modules.find((mm) => mm.code === 'caisse');
  assert.equal(c.actif, true);
  assert.equal(c.modifie_par, U.adm.username);
  assert.equal((await appel('PUT', `/plateforme/clients/${A}/modules/caisse`, 'adm', { actif: true })).data.inchange, true);
});
