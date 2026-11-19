// tests/sessions.test.js — NJ BUSINESS lot D (migration 067) : sessions.
//
//  • Scénario 5 : une seule session active par compte ; deuxième appareil
//    refusé (409 SESSION_ACTIVE) ; remplacement explicite avec mot de passe ;
//    l'ancien jeton devient inutilisable immédiatement (SESSION_REMPLACEE) ;
//  • deux connexions simultanées : une seule passe ;
//  • changer de module ne crée pas de session ;
//  • expiration par inactivité, déconnexion, déconnexion de tous les appareils,
//    révocation par le directeur, changement / réinitialisation du mot de passe,
//    désactivation du compte ;
//  • jeton sans session refusé en mode appliquer ;
//  • isolation : un directeur ne voit ni ne ferme les sessions d'un autre client ;
//  • réglages (super_admin) ; migration 067 rejouable.
//
//   TEST_DATABASE_URL=postgres://…/base_de_test  node --test tests/sessions.test.js
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
const PORT = 8800 + Math.floor(Math.random() * 400);
const sfx = crypto.randomBytes(3).toString('hex');
const MDP = 'Mdp-test-2026!';
const pool = new Pool({ connectionString: DB });
let serveur;
let reglagesInitiaux;
const U = {};
const T = {};

const sql = async (texte, params = []) => (await pool.query(texte, params)).rows;
const brut = async (methode, url, token, corps, ua = 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0') => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api${url}`, {
    method: methode,
    headers: { 'Content-Type': 'application/json', 'User-Agent': ua, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const j = await r.json().catch(() => ({}));
  const data = j.data ?? j;
  return { status: r.status, data, message: j.message ?? j.error ?? data?.error, code: data?.code ?? j.code };
};
const connexion = (cle, { remplacer, ua, mdp } = {}) => brut('POST', '/auth/login', null,
  { username: U[cle].username, password: mdp || MDP, ...(remplacer !== undefined ? { remplacer } : {}) }, ua);
const ouvrir = async (cle, opts) => {
  const r = await connexion(cle, opts);
  assert.equal(r.status, 200, `${cle} : ${r.message}`);
  U[cle].token = r.data.accessToken;
  return r;
};
const creerUtilisateur = async (cle, role, tenant) => {
  const username = `${cle}-${sfx}`;
  const hash = await bcrypt.hash(MDP, 4);
  const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif)
                          VALUES ($1, $2, $3, $4, $5, true) RETURNING id`, [tenant, username, `${username}@test.cm`, hash, role]);
  U[cle] = { id: u.id, username };
};
const actives = async (cle) => sql("SELECT id, statut FROM sessions WHERE user_id = $1 AND statut = 'active'", [U[cle].id]);

before(async () => {
  [reglagesInitiaux] = await sql("SELECT valeur FROM plateforme_reglages WHERE cle = 'sessions'");
  [{ id: T.A }] = await sql('INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id', [`sea-${sfx}`, `Sessions A ${sfx}`]);
  [{ id: T.B }] = await sql('INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id', [`seb-${sfx}`, `Sessions B ${sfx}`]);
  await creerUtilisateur('adm', 'super_admin', null);
  await creerUtilisateur('dirA', 'directeur', T.A);
  await creerUtilisateur('caiA', 'caissier', T.A);
  await creerUtilisateur('colA', 'collaborateur', T.A);
  await creerUtilisateur('dirB', 'directeur', T.B);
  await creerUtilisateur('caiB', 'caissier', T.B);
  serveur = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: DB, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test', SMTP_HOST: '',
      RATE_LIMIT_MAX: '100000', LOGIN_RATE_MAX: '100000', SESSIONS_CONTROLE: 'appliquer' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = (d) => process.env.DEBUG_TEST && process.stderr.write(d);
  serveur.stdout.on('data', log); serveur.stderr.on('data', log);
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) break; } catch { /* démarrage */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  await ouvrir('adm');
  for (const [t, codes] of [[T.A, ['caisse', 'commercial']], [T.B, ['caisse']]]) {
    for (const code of codes) {
      const r = await brut('PUT', `/plateforme/clients/${t}/modules/${code}`, U.adm.token, { actif: true, motif: 'Test' });
      assert.equal(r.status, 200, r.message);
    }
  }
});

after(async () => {
  if (reglagesInitiaux) await sql("UPDATE plateforme_reglages SET valeur = $1 WHERE cle = 'sessions'", [JSON.stringify(reglagesInitiaux.valeur)]);
  serveur?.kill();
  for (const u of Object.values(U)) await sql('DELETE FROM audit_log WHERE user_id = $1', [u.id]).catch(() => {});
  for (const t of Object.values(T)) {
    await sql('DELETE FROM audit_log WHERE tenant_id = $1', [t]).catch(() => {});
    await sql('DELETE FROM tenants WHERE id = $1', [t]).catch((e) => console.error('nettoyage', e.message));
  }
  await sql('DELETE FROM users WHERE id = $1', [U.adm.id]).catch(() => {});
  await pool.end();
});

test('Scénario 5 : une seule session, deuxième appareil refusé puis remplacement', async () => {
  const pc = await ouvrir('caiA');
  assert.ok(pc.data.session?.id, 'identifiant de session renvoyé');
  assert.equal(jwt.decode(U.caiA.token).sid, pc.data.session.id, 'le jeton porte sa session');
  const jetonPc = U.caiA.token;
  assert.equal((await brut('GET', '/auth/me', jetonPc)).status, 200);

  // Deuxième appareil : refus clair, avec l'appareil de la session ouverte, sans jeton.
  // Deuxième ORDINATEUR (068 : même type d'appareil que le premier).
  const tel = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Version/17.0 Safari/605.1.15';
  let r = await connexion('caiA', { ua: tel });
  assert.equal(r.status, 409);
  assert.equal(r.code, 'SESSION_ACTIVE');
  assert.match(r.message, /déjà connecté sur un autre appareil/);
  assert.equal(r.data.session.appareil, 'Chrome sur Windows');
  assert.ok(!r.data.accessToken, 'aucun jeton');
  assert.equal((await actives('caiA')).length, 1);
  assert.equal((await brut('GET', '/auth/me', jetonPc)).status, 200, 'la session existante n\'est pas touchée');

  // Remplacement : exige le mot de passe.
  r = await connexion('caiA', { ua: tel, remplacer: true, mdp: 'faux' });
  assert.equal(r.status, 401, 'mauvais mot de passe : pas de remplacement');
  assert.equal((await brut('GET', '/auth/me', jetonPc)).status, 200);
  r = await connexion('caiA', { ua: tel, remplacer: true });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.session.remplace, true);
  const jetonTel = r.data.accessToken;

  // Ancien jeton invalidé immédiatement, avec un message explicite.
  r = await brut('GET', '/auth/me', jetonPc);
  assert.equal(r.status, 401);
  assert.equal(r.code, 'SESSION_REMPLACEE');
  assert.equal((await brut('GET', '/auth/me', jetonTel)).status, 200);
  const toutes = await sql('SELECT statut, appareil, motif_fin FROM sessions WHERE user_id = $1 ORDER BY cree_le', [U.caiA.id]);
  assert.deepEqual(toutes.map((s) => s.statut), ['remplacee', 'active']);
  assert.match(toutes[0].motif_fin, /Mac/);
  const audit = await sql("SELECT action FROM audit_log WHERE user_id = $1 AND entite = 'session' ORDER BY id", [U.caiA.id]);
  assert.deepEqual(audit.map((a) => a.action), ['SESSION_OUVERTURE', 'SESSION_REFUSEE', 'SESSION_REMPLACEMENT']);
  U.caiA.token = jetonTel;
});

test('068 : ordinateur ET téléphone en même temps ; un seul de chaque type', async () => {
  const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/120.0 Mobile Safari/537.36';
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1';
  await sql("UPDATE sessions SET statut = 'fermee', terminee_le = NOW() WHERE user_id = $1 AND statut = 'active'", [U.dirB.id]);
  const pc = await ouvrir('dirB');
  assert.equal(pc.data.session.type_appareil, 'ordinateur');
  const jetonPc = U.dirB.token;
  let r = await connexion('dirB', { ua: android });
  assert.equal(r.status, 200, `téléphone accepté à côté de l'ordinateur : ${r.message}`);
  assert.equal(r.data.session.type_appareil, 'mobile');
  const jetonTel = r.data.accessToken;
  assert.equal((await brut('GET', '/auth/me', jetonPc)).status, 200, 'ordinateur toujours connecté');
  assert.equal((await brut('GET', '/auth/me', jetonTel, undefined, android)).status, 200);
  assert.equal((await actives('dirB')).length, 2);

  // Deuxième téléphone : refusé, avec le téléphone en cours ; remplacement = le téléphone seulement.
  r = await connexion('dirB', { ua: iphone });
  assert.equal(r.status, 409);
  assert.equal(r.data.session.type_appareil, 'mobile');
  assert.match(r.data.session.appareil, /Android/);
  r = await connexion('dirB', { ua: iphone, remplacer: true });
  assert.equal(r.status, 200, r.message);
  assert.equal((await brut('GET', '/auth/me', jetonTel)).code, 'SESSION_REMPLACEE');
  assert.equal((await brut('GET', '/auth/me', jetonPc)).status, 200, 'l\'ordinateur n\'est pas touché');
  const jetonIphone = r.data.accessToken;

  // Téléphone en « version pour ordinateur » (User-Agent de PC) : reconnu par
  // l'indice client Sec-CH-UA-Mobile ou par l'indice de l'interface.
  const pcUa = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0 Safari/537.36';
  r = await connexion('dirB', { ua: pcUa });
  assert.equal(r.status, 409, 'User-Agent de PC sans indice : compté comme ordinateur');
  assert.deepEqual(r.data.session.cet_appareil, { appareil: 'Chrome sur Linux', type_appareil: 'ordinateur' });
  const avecIndice = await fetch(`http://127.0.0.1:${PORT}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': pcUa },
    body: JSON.stringify({ username: U.dirB.username, password: MDP, type_appareil: 'mobile' }) });
  const j = await avecIndice.json();
  assert.equal(avecIndice.status, 409, 'indice mobile : en concurrence avec l\'iPhone');
  assert.equal((j.data ?? j).session.cet_appareil.type_appareil, 'mobile');
  const ch = await fetch(`http://127.0.0.1:${PORT}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': pcUa, 'Sec-CH-UA-Mobile': '?1' },
    body: JSON.stringify({ username: U.dirB.username, password: MDP }) });
  assert.equal(((await ch.json()).data).session.cet_appareil.type_appareil, 'mobile');
  assert.equal((await brut('POST', '/auth/login', null, { username: U.dirB.username, password: MDP, type_appareil: 'frigo' })).status, 400);

  // Réglage désactivé : une seule session par compte, tous appareils confondus.
  r = await brut('PUT', '/plateforme/sessions', U.adm.token, { inactivite_min: 60, duree_max_min: 720, par_type_appareil: false });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.reglages.par_type_appareil, false);
  await new Promise((ok) => setTimeout(ok, 50));
  r = await connexion('dirB', { ua: 'Mozilla/5.0 (Windows NT 10.0) Firefox/121.0' });
  assert.equal(r.status, 409, 'un autre ordinateur est refusé');
  assert.equal(r.data.session.par_type_appareil, false);
  r = await connexion('dirB', { remplacer: true });
  assert.equal(r.status, 200, r.message);
  assert.equal((await brut('GET', '/auth/me', jetonPc)).code, 'SESSION_REMPLACEE');
  assert.equal((await brut('GET', '/auth/me', jetonIphone)).code, 'SESSION_REMPLACEE', 'les deux sessions sont fermées');
  assert.equal((await actives('dirB')).length, 1);
  U.dirB.token = r.data.accessToken;
  r = await brut('PUT', '/plateforme/sessions', U.adm.token, { inactivite_min: 60, duree_max_min: 720, par_type_appareil: true });
  assert.equal(r.status, 200);
  assert.equal((await brut('PUT', '/plateforme/sessions', U.adm.token, { inactivite_min: 60, duree_max_min: 720, par_type_appareil: 'oui' })).status, 400);
});

test('Connexions simultanées : une seule passe', async () => {
  await sql("UPDATE sessions SET statut = 'fermee', terminee_le = NOW() WHERE user_id = $1 AND statut = 'active'", [U.colA.id]);
  const essais = await Promise.all(Array.from({ length: 6 }, () => connexion('colA')));
  const ok = essais.filter((e) => e.status === 200);
  assert.equal(ok.length, 1, `une seule connexion acceptée (${essais.map((e) => e.status).join(',')})`);
  assert.ok(essais.filter((e) => e.status !== 200).every((e) => e.status === 409 && e.code === 'SESSION_ACTIVE'));
  assert.equal((await actives('colA')).length, 1);
  U.colA.token = ok[0].data.accessToken;
});

test('Changer de module ne crée pas de session', async () => {
  await ouvrir('dirA');
  const avant = (await sql('SELECT COUNT(*)::int AS n FROM sessions WHERE user_id = $1', [U.dirA.id]))[0].n;
  assert.equal((await brut('GET', '/auth/me', U.dirA.token)).status, 200);
  assert.equal((await brut('GET', '/caisse/parametres', U.dirA.token)).status, 200, 'caisse');
  assert.equal((await brut('GET', '/commercial/societe', U.dirA.token)).status, 200, 'commercial');
  assert.equal((await brut('GET', '/entreprise', U.dirA.token)).status, 200, 'entreprise');
  assert.equal((await sql('SELECT COUNT(*)::int AS n FROM sessions WHERE user_id = $1', [U.dirA.id]))[0].n, avant);
  assert.equal((await actives('dirA')).length, 1);
});

test('Expiration par inactivité : refus explicite puis nouvelle connexion possible', async () => {
  await ouvrir('caiB');
  await sql("UPDATE sessions SET derniere_activite = NOW() - interval '2 hours' WHERE user_id = $1 AND statut = 'active'", [U.caiB.id]);
  const r = await brut('GET', '/auth/me', U.caiB.token);
  assert.equal(r.status, 401);
  assert.equal(r.code, 'SESSION_EXPIREE');
  assert.equal((await actives('caiB')).length, 0);
  // Session périmée non encore constatée : elle ne bloque pas une nouvelle connexion.
  await ouvrir('caiB');
  await sql("UPDATE sessions SET expire_le = NOW() - interval '1 minute' WHERE user_id = $1 AND statut = 'active'", [U.caiB.id]);
  await ouvrir('caiB');
  assert.equal((await actives('caiB')).length, 1);
});

test('Déconnexion, tous les appareils, jeton sans session', async () => {
  await ouvrir('caiB', { remplacer: true });
  let r = await brut('POST', '/auth/deconnexion', U.caiB.token);
  assert.equal(r.status, 200);
  r = await brut('GET', '/auth/me', U.caiB.token);
  assert.equal(r.code, 'SESSION_FERMEE');
  await ouvrir('caiB');      // la session fermée ne bloque pas
  r = await brut('POST', '/auth/deconnexion-globale', U.caiB.token);
  assert.equal(r.data.fermees, 1);
  assert.equal((await brut('GET', '/auth/me', U.caiB.token)).status, 401);

  // Jeton signé correctement mais sans session (ancienne version) : refusé.
  const ancien = jwt.sign({ sub: U.caiB.id, username: U.caiB.username, role: 'caissier', tenantId: T.B }, SECRET, { expiresIn: '1h' });
  r = await brut('GET', '/auth/me', ancien);
  assert.equal(r.status, 401);
  assert.equal(r.code, 'SESSION_INVALIDE');
  // Session d'un autre compte glissée dans un jeton : refusée.
  await ouvrir('caiB');
  const vol = jwt.sign({ sub: U.colA.id, username: 'x', role: 'collaborateur', tenantId: T.A, sid: jwt.decode(U.caiB.token).sid }, SECRET);
  assert.equal((await brut('GET', '/auth/me', vol)).code, 'SESSION_INVALIDE');
});

test('Mes sessions, révocation par le directeur, isolation', async () => {
  let r = await brut('GET', '/auth/sessions', U.caiA.token);
  assert.equal(r.status, 200);
  assert.ok(r.data.sessions.find((s) => s.courante && s.statut === 'active'));
  assert.ok(!r.data.sessions.some((s) => s.user_id !== U.caiA.id), 'seulement les siennes');

  r = await brut('GET', '/sessions', U.dirA.token);
  assert.equal(r.status, 200);
  const ids = r.data.sessions.map((s) => s.user_id);
  assert.ok(ids.includes(U.caiA.id) && ids.includes(U.dirA.id));
  assert.ok(!ids.includes(U.caiB.id), 'aucune session d\'un autre client');
  assert.equal((await brut('GET', '/sessions', U.caiA.token)).status, 403, 'caissier : pas de liste (adresses IP)');

  const [sCaiA] = await actives('caiA');
  const [sCaiB] = await actives('caiB');
  assert.equal((await brut('DELETE', `/sessions/${sCaiB.id}`, U.dirA.token, {})).status, 404, 'autre client');
  assert.equal((await brut('GET', '/auth/me', U.caiB.token)).status, 200, 'intacte');
  assert.equal((await brut('DELETE', `/sessions/${jwt.decode(U.dirA.token).sid}`, U.dirA.token, {})).status, 400, 'sa propre session');
  r = await brut('DELETE', `/sessions/${sCaiA.id}`, U.dirA.token, { motif: 'Poste laissé ouvert' });
  assert.equal(r.status, 200, r.message);
  r = await brut('GET', '/auth/me', U.caiA.token);
  assert.equal(r.code, 'SESSION_REVOQUEE');
  assert.equal((await brut('DELETE', `/sessions/${sCaiA.id}`, U.dirA.token, {})).status, 409, 'déjà fermée');
  const [a] = await sql("SELECT user_id FROM audit_log WHERE action = 'SESSION_REVOCATION' AND entite_id = $1", [sCaiA.id]);
  assert.equal(a.user_id, U.dirA.id, 'auteur de la révocation');

  r = await brut('GET', '/sessions', U.adm.token);
  assert.equal(r.status, 200);
  assert.ok(r.data.sessions.some((s) => s.user_id === U.caiB.id), 'super_admin : toute la plateforme');
});

test('Mot de passe changé ou réinitialisé, compte désactivé : sessions fermées', async () => {
  await ouvrir('caiA');
  let r = await brut('POST', `/users/${U.caiA.id}/password`, U.dirA.token, { password: 'Nouveau-2026' });
  assert.equal(r.status, 200, r.message);
  assert.equal((await brut('GET', '/auth/me', U.caiA.token)).code, 'SESSION_REVOQUEE');
  await ouvrir('caiA', { mdp: 'Nouveau-2026' });
  r = await brut('POST', '/auth/change-password', U.caiA.token, { ancienPassword: 'Nouveau-2026', nouveauPassword: MDP });
  assert.equal(r.status, 200, r.message);
  assert.equal((await brut('GET', '/auth/me', U.caiA.token)).status, 200, 'la session courante reste ouverte');

  r = await brut('PATCH', `/users/${U.caiA.id}/actif`, U.dirA.token, {});
  assert.equal(r.status, 200, r.message);
  assert.equal((await actives('caiA')).length, 0, 'compte désactivé : plus de session');
  r = await brut('PATCH', `/users/${U.caiA.id}/actif`, U.dirA.token, {});
  assert.equal(r.data.user.actif, true);
  await ouvrir('caiA');   // réactivé : connexion directe, aucune session ne survit
});

test('Réglages des sessions (super_admin)', async () => {
  assert.equal((await brut('PUT', '/plateforme/sessions', U.dirA.token, { inactivite_min: 30, duree_max_min: 600 })).status, 403);
  let r = await brut('PUT', '/plateforme/sessions', U.adm.token, { inactivite_min: 2, duree_max_min: 600 });
  assert.equal(r.status, 400);
  r = await brut('PUT', '/plateforme/sessions', U.adm.token, { inactivite_min: 90, duree_max_min: 60 });
  assert.equal(r.status, 400, 'durée maximale inférieure à l\'inactivité');
  r = await brut('PUT', '/plateforme/sessions', U.adm.token, { inactivite_min: 30, duree_max_min: 600 });
  assert.equal(r.status, 200, r.message);
  assert.deepEqual(r.data.reglages, { inactivite_min: 30, duree_max_min: 600, par_type_appareil: true });
  assert.equal(r.data.mode, 'appliquer');
  await new Promise((ok) => setTimeout(ok, 50));
  const c = await ouvrir('dirB', { remplacer: true });
  const p = jwt.decode(c.data.accessToken);
  assert.equal(p.exp - p.iat, 600 * 60, 'le jeton ne vit pas plus longtemps que la session');
});

test('Migrations 067 et 068 rejouables', async () => {
  const migration = ['067_sessions.sql', '068_sessions_par_appareil.sql'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', f), 'utf8')).join('\n');
  const n = (await sql('SELECT COUNT(*)::int AS n FROM sessions'))[0].n;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(migration);
    await client.query('COMMIT');
  } finally { client.release(); }
  assert.equal((await sql('SELECT COUNT(*)::int AS n FROM sessions'))[0].n, n);
  await assert.rejects(sql("INSERT INTO sessions (user_id, expire_le) VALUES ($1, NOW() + interval '1 hour')", [U.dirB.id]),
    /uq_sessions_active_par_type/, 'la base refuse une deuxième session active du même type');
});
