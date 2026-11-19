// tests/parcours-nj-business.test.js — NJ BUSINESS lot E : validation de bout en bout.
//
// Les 8 scénarios du cahier de restructuration, rejoués dans l'ordre où une
// entreprise les vit, avec de VRAIES connexions (sessions en mode appliquer,
// contrôle par module en mode appliquer) :
//   1. client créé sans module ;          2. activation et paramètres de la caisse ;
//   3. comptes du commercial sans caisse ; 4. reprise d'un compte existant ;
//   5. deuxième appareil (ordinateur, téléphone, remplacement) ;
//   6. changement de module sans nouvelle session ;
//   7. désactivation puis réactivation d'un module ; 8. isolation entre deux entreprises.
// Plus le parcours de connexion : modules renvoyés à la connexion (membre),
// refus explicites MODULE_INACTIF / MODULE_NON_AUTORISE.
//
//   TEST_DATABASE_URL=postgres://…/base_de_test  node --test tests/parcours-nj-business.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const DB = process.env.TEST_DATABASE_URL;
if (!DB) {
  console.error('TEST_DATABASE_URL absent : test ignoré (ne jamais viser la base de production).');
  process.exit(0);
}
const SECRET = 'test-secret-' + crypto.randomBytes(16).toString('hex');
const PORT = 9300 + Math.floor(Math.random() * 400);
const sfx = crypto.randomBytes(3).toString('hex');
const MDP = 'Mdp-parcours-2026!';
const PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36';
const PC2 = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Version/17.0 Safari/605.1.15';
const TEL = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/120.0 Mobile Safari/537.36';
const pool = new Pool({ connectionString: DB });
let serveur;
let modeInitial;
const U = {};
const T = {};

const sql = async (texte, params = []) => (await pool.query(texte, params)).rows;
const http = async (methode, url, token, corps, ua = PC) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api${url}`, {
    method: methode,
    headers: { 'Content-Type': 'application/json', 'User-Agent': ua, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const j = await r.json().catch(() => ({}));
  const data = j.data ?? j;
  return { status: r.status, data, message: j.message ?? j.error ?? data?.error, code: data?.code ?? j.code };
};
const appel = (m, url, cle, corps) => http(m, url, U[cle].token, corps, U[cle].ua);
const connexion = (cle, { ua = PC, remplacer } = {}) => http('POST', '/auth/login', null,
  { username: U[cle].username, password: MDP, ...(remplacer ? { remplacer: true } : {}) }, ua);
const ouvrir = async (cle, ua = PC, remplacer = false) => {
  const r = await connexion(cle, { ua, remplacer });
  assert.equal(r.status, 200, `${cle} : ${r.message}`);
  Object.assign(U[cle], { token: r.data.accessToken, ua, login: r.data });
  return r.data;
};
const compte = async (table, t) => (await sql(`SELECT COUNT(*)::int AS n FROM ${table} WHERE tenant_id = $1`, [t]))[0].n;
const directeur = async (cle, tenant) => {
  const username = `${cle}-${sfx}`;
  const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif)
                          VALUES ($1, $2, $3, $4, 'directeur', true) RETURNING id`, [tenant, username, `${username}@test.cm`, await bcrypt.hash(MDP, 4)]);
  U[cle] = { id: u.id, username };
};
const basculer = (t, code, actif) => appel('PUT', `/plateforme/clients/${t}/modules/${code}`, 'adm', { actif, motif: 'Parcours de validation' });

before(async () => {
  [modeInitial] = await sql("SELECT valeur FROM plateforme_reglages WHERE cle = 'acces_modules_utilisateurs'");
  const [a] = await sql(`INSERT INTO users (username, email, password_hash, role, actif) VALUES ($1, $2, $3, 'super_admin', true) RETURNING id`,
    [`adm-${sfx}`, `adm-${sfx}@test.cm`, await bcrypt.hash(MDP, 4)]);
  U.adm = { id: a.id, username: `adm-${sfx}` };
  serveur = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: DB, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test', SMTP_HOST: '',
      RATE_LIMIT_MAX: '100000', LOGIN_RATE_MAX: '100000', SESSIONS_CONTROLE: 'appliquer', MODULES_CONTROLE: 'appliquer' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = (d) => process.env.DEBUG_TEST && process.stderr.write(d);
  serveur.stdout.on('data', log); serveur.stderr.on('data', log);
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) break; } catch { /* démarrage */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  await ouvrir('adm');
});

after(async () => {
  if (modeInitial) await sql("UPDATE plateforme_reglages SET valeur = $1 WHERE cle = 'acces_modules_utilisateurs'", [JSON.stringify(modeInitial.valeur)]);
  serveur?.kill();
  for (const u of Object.values(U)) await sql('DELETE FROM audit_log WHERE user_id = $1', [u.id]).catch(() => {});
  for (const t of Object.values(T)) {
    await sql('DELETE FROM audit_log WHERE tenant_id = $1', [t]).catch(() => {});
    await sql('DELETE FROM tenants WHERE id = $1', [t]).catch((e) => console.error('nettoyage', e.message));
  }
  await sql('DELETE FROM users WHERE id = $1', [U.adm.id]).catch(() => {});
  await pool.end();
});

test('Scénario 1 — client créé sans module : entreprise accessible, aucune donnée de caisse', async () => {
  const r = await appel('POST', '/tenants', 'adm', { slug: `parcours-${sfx}`, nom: `Parcours ${sfx}`, modules: [],
    identite: { forme_juridique: 'SARL', ville: 'Yaoundé' } });
  assert.equal(r.status, 201, r.message);
  T.A = r.data.id ?? r.data.tenant?.id;
  for (const t of ['rubriques', 'journaux']) assert.equal(await compte(t, T.A), 0, `${t} : rien`);
  await directeur('dirA', T.A);
  const login = await ouvrir('dirA');
  // Parcours de connexion : les modules de l'espace sont renvoyés dès la connexion, aucun actif.
  assert.ok(Array.isArray(login.user.modules));
  assert.ok(!login.user.modules.some((m) => m.actif), 'aucun module actif');
  assert.equal((await appel('GET', '/entreprise', 'dirA')).status, 200, 'configuration de l\'entreprise ouverte');
  const caisse = await appel('GET', '/caisse/parametres', 'dirA');
  assert.equal(caisse.status, 403);
  assert.equal(caisse.code, 'MODULE_INACTIF');
});

test('Scénario 2 — activation de la caisse : données préparées, paramètres propres au module', async () => {
  assert.equal((await basculer(T.A, 'caisse', true)).status, 200);
  assert.ok(await compte('journaux', T.A) > 0 && await compte('rubriques', T.A) > 0, 'caisse préparée à l\'activation');
  let r = await appel('GET', '/caisse/parametres', 'dirA');
  assert.equal(r.status, 200, r.message);
  r = await appel('PUT', '/caisse/parametres', 'dirA', { caissier_nom: 'Awa Caissière', directeur_nom: 'M. Directeur' });
  assert.equal(r.status, 200, r.message);
  const ent = await appel('GET', '/entreprise', 'dirA');
  assert.equal(JSON.stringify(ent.data).includes('Awa Caissière'), false, 'les signataires ne sont pas dans l\'identité');
});

test('Scénario 3 — comptes créés dans le commercial : aucun accès à la caisse', async () => {
  assert.equal((await basculer(T.A, 'commercial', true)).status, 200);
  assert.equal((await appel('PUT', '/plateforme/utilisateurs-modules/mode', 'adm', { mode: 'appliquer' })).status, 200);
  // Le directeur garde ses deux modules (reprise de son compte).
  assert.equal((await appel('POST', '/plateforme/utilisateurs-modules/reprise', 'adm')).status, 200);
  // Déconnexion puis reconnexion : la deuxième connexion relit ses modules.
  assert.equal((await appel('POST', '/auth/deconnexion', 'dirA')).status, 200);
  const relu = await ouvrir('dirA');
  assert.deepEqual(relu.user.modules.filter((m) => m.membre).map((m) => m.code).sort(), ['caisse', 'commercial']);
  const [{ id: profil }] = await sql("SELECT id FROM roles WHERE tenant_id = $1 AND code = 'ventes_commercial'", [T.A]);
  U.vendeur = { username: `vendeur-${sfx}` };
  const r = await appel('POST', '/users', 'dirA', { username: U.vendeur.username, password: MDP, role: 'collaborateur', custom_role_id: profil, modules: ['commercial'] });
  assert.equal(r.status, 201, r.message);
  U.vendeur.id = r.data.id;
  const login = await ouvrir('vendeur');
  const mods = Object.fromEntries(login.user.modules.map((m) => [m.code, m.membre]));
  assert.deepEqual({ caisse: mods.caisse, commercial: mods.commercial }, { caisse: false, commercial: true }, 'carte de la caisse absente dès la connexion');
  const refus = await appel('GET', '/journaux', 'vendeur');
  assert.equal(refus.status, 403);
  assert.equal(refus.code, 'MODULE_NON_AUTORISE');
  assert.equal((await appel('GET', '/commercial/unites', 'vendeur')).status, 200, 'le commercial est ouvert');
  const liste = await appel('GET', '/modules/commercial/utilisateurs', 'dirA');
  assert.ok(liste.data.utilisateurs.some((u) => u.id === U.vendeur.id));
  assert.ok(!(await appel('GET', '/modules/caisse/utilisateurs', 'dirA')).data.utilisateurs.some((u) => u.id === U.vendeur.id));
});

test('Scénario 4 — compte existant repris selon ses droits, sans droit ajouté ni retiré', async () => {
  const username = `ancien-${sfx}`;
  const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif)
                          VALUES ($1, $2, $3, $4, 'caissier', true) RETURNING id`, [T.A, username, `${username}@test.cm`, await bcrypt.hash(MDP, 4)]);
  U.ancien = { id: u.id, username };
  const r = await appel('POST', '/plateforme/utilisateurs-modules/reprise', 'adm');
  assert.equal(r.status, 200, r.message);
  const rows = await sql('SELECT module_code, origine FROM user_modules WHERE user_id = $1 AND actif', [u.id]);
  assert.deepEqual(rows.map((x) => x.module_code), ['caisse'], 'caissier : la caisse seulement');
  const login = await ouvrir('ancien');
  assert.equal(login.user.modules.find((m) => m.code === 'caisse').membre, true);
  assert.equal((await appel('GET', '/journaux', 'ancien')).status, 200);
});

test('Scénario 5 — deuxième appareil : téléphone accepté, deuxième ordinateur refusé puis remplacement', async () => {
  const pc = U.vendeur.token;
  let r = await connexion('vendeur', { ua: TEL });
  assert.equal(r.status, 200, 'ordinateur + téléphone');
  r = await connexion('vendeur', { ua: PC2 });
  assert.equal(r.status, 409);
  assert.equal(r.code, 'SESSION_ACTIVE');
  assert.match(r.message, /déjà connecté sur un autre appareil/);
  r = await connexion('vendeur', { ua: PC2, remplacer: true });
  assert.equal(r.status, 200);
  assert.equal((await http('GET', '/auth/me', pc)).code, 'SESSION_REMPLACEE', 'l\'ancien ordinateur est déconnecté');
  Object.assign(U.vendeur, { token: r.data.accessToken, ua: PC2 });
  const actives = await sql("SELECT type_appareil FROM sessions WHERE user_id = $1 AND statut = 'active' ORDER BY type_appareil", [U.vendeur.id]);
  assert.deepEqual(actives.map((s) => s.type_appareil), ['mobile', 'ordinateur']);
});

test('Scénario 6 — passer d\'un module à l\'autre ne crée pas de session', async () => {
  const n = async () => (await sql('SELECT COUNT(*)::int AS n FROM sessions WHERE user_id = $1', [U.dirA.id]))[0].n;
  const avant = await n();
  for (const url of ['/auth/me', '/caisse/parametres', '/journaux', '/commercial/societe', '/entreprise', '/modules/commercial/utilisateurs', '/auth/me']) {
    assert.equal((await appel('GET', url, 'dirA')).status, 200, url);
  }
  assert.equal(await n(), avant);
});

test('Scénario 7 — module désactivé puis réactivé : refus explicite, puis tout est retrouvé', async () => {
  const avant = await sql("SELECT user_id, role_id FROM user_modules WHERE tenant_id = $1 AND module_code = 'commercial' AND actif ORDER BY user_id", [T.A]);
  assert.equal((await basculer(T.A, 'commercial', false)).status, 200);
  let r = await appel('GET', '/commercial/unites', 'vendeur');
  assert.equal(r.status, 403);
  assert.equal(r.code, 'MODULE_INACTIF');
  r = await appel('GET', '/auth/me', 'vendeur');
  assert.equal(r.status, 200, 'la session reste ouverte');
  assert.equal(r.data.modules.find((m) => m.code === 'commercial').actif, false);
  assert.equal((await basculer(T.A, 'commercial', true)).status, 200);
  assert.equal((await appel('GET', '/commercial/unites', 'vendeur')).status, 200);
  const apres = await sql("SELECT user_id, role_id FROM user_modules WHERE tenant_id = $1 AND module_code = 'commercial' AND actif ORDER BY user_id", [T.A]);
  assert.deepEqual(apres, avant, 'rattachements et profils intacts');
});

test('Scénario 8 — isolation entre deux entreprises (utilisateurs, modules, sessions, en-tête forgé)', async () => {
  const r = await appel('POST', '/tenants', 'adm', { slug: `parcours-b-${sfx}`, nom: `Parcours B ${sfx}`, modules: ['caisse'] });
  assert.equal(r.status, 201, r.message);
  T.B = r.data.id ?? r.data.tenant?.id;
  await directeur('dirB', T.B);
  await appel('POST', '/plateforme/utilisateurs-modules/reprise', 'adm');
  await ouvrir('dirB');
  const users = await appel('GET', '/users', 'dirB');
  assert.ok(!JSON.stringify(users.data).includes(U.vendeur.username), 'aucun compte de A');
  const caisse = await appel('GET', '/modules/caisse/utilisateurs', 'dirB');
  assert.ok(caisse.data.utilisateurs.every((u) => u.id !== U.ancien.id));
  const sessions = await appel('GET', '/sessions', 'dirB');
  assert.ok(sessions.data.sessions.every((s) => s.tenant_id === T.B));
  const [sA] = await sql("SELECT id FROM sessions WHERE user_id = $1 AND statut = 'active' LIMIT 1", [U.vendeur.id]);
  assert.equal((await appel('DELETE', `/sessions/${sA.id}`, 'dirB', {})).status, 404);
  assert.equal((await appel('POST', `/modules/caisse/utilisateurs`, 'dirB', { user_id: U.vendeur.id })).status, 404);
  // En-tête X-Tenant-Id forgé par un compte de B : ignoré.
  const forge = await fetch(`http://127.0.0.1:${PORT}/api/users`, { headers: { Authorization: `Bearer ${U.dirB.token}`, 'X-Tenant-Id': T.A, 'User-Agent': PC } });
  const j = await forge.json();
  assert.ok(!JSON.stringify(j).includes(U.vendeur.username), 'en-tête d\'un autre client sans effet');
  // B n'a pas le commercial : refusé, même avec le jeton d'un directeur.
  assert.equal((await appel('GET', '/commercial/societe', 'dirB')).code, 'MODULE_INACTIF');
});
