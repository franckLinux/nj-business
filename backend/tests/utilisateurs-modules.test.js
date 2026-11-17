// tests/utilisateurs-modules.test.js — NJ BUSINESS lot C (migration 066) : utilisateurs par module.
//
//  • Scénario 4 : reprise des comptes existants d'après leurs droits effectifs
//    (rien d'ajouté ni de retiré), comptes sans droit de module « à affecter » ;
//  • Scénario 3 : comptes créés dans le commercial (responsable des achats,
//    vendeur, magasinier) visibles dans le commercial, sans accès à la caisse ;
//  • listes par module, ajout d'un compte existant, profil propre au module,
//    retrait motivé (jamais de suppression), droits ;
//  • mode observer (rien n'est refusé, écarts signalés) puis appliquer ;
//  • Scénario 8 : isolation entre entreprises ;
//  • migration 066 rejouable.
//
//   TEST_DATABASE_URL=postgres://…/base_de_test  node --test tests/utilisateurs-modules.test.js
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
const pool = new Pool({ connectionString: DB });
let serveur;
let modeInitial;
const U = {};
const T = {};

const sql = async (texte, params = []) => (await pool.query(texte, params)).rows;
const appel = async (methode, url, qui, corps, entetes = {}) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api${url}`, {
    method: methode,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${U[qui].token}`, ...entetes },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.data ?? j, message: j.message ?? j.error, code: j.code ?? j.data?.code };
};
const jeton = (id, username, role, tenant) => jwt.sign({ sub: id, username, role, tenantId: tenant }, SECRET, { expiresIn: '1h' });
const creerUtilisateur = async (cle, role, tenant, profilCode = null) => {
  const username = `${cle}-${sfx}`;
  const hash = await bcrypt.hash('Mdp-test-2026!', 4);
  const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif, custom_role_id)
                          VALUES ($1, $2, $3, $4, $5, true, (SELECT id FROM roles WHERE tenant_id = $1 AND code = $6)) RETURNING id`,
  [tenant, username, `${username}@test.cm`, hash, role, profilCode]);
  U[cle] = { id: u.id, username, token: jeton(u.id, username, role, tenant) };
  return u.id;
};
const modulesDe = async (cle) => (await sql('SELECT module_code FROM user_modules WHERE user_id = $1 AND actif ORDER BY 1', [U[cle].id])).map((r) => r.module_code);
const mode = (m) => appel('PUT', '/plateforme/utilisateurs-modules/mode', 'adm', { mode: m });
const reprise = () => appel('POST', '/plateforme/utilisateurs-modules/reprise', 'adm');

before(async () => {
  [{ valeur: modeInitial }] = await sql("SELECT valeur #>> '{}' AS valeur FROM plateforme_reglages WHERE cle = 'acces_modules_utilisateurs'");
  [{ id: T.A }] = await sql('INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id', [`uma-${sfx}`, `Modules A ${sfx}`]);
  [{ id: T.B }] = await sql('INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id', [`umb-${sfx}`, `Modules B ${sfx}`]);
  const hashAdm = await bcrypt.hash('x', 4);
  const [a] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif) VALUES (NULL, $1, $2, $3, 'super_admin', true) RETURNING id`,
    [`adm-${sfx}`, `adm-${sfx}@test.cm`, hashAdm]);
  U.adm = { id: a.id, token: jeton(a.id, `adm-${sfx}`, 'super_admin', null) };
  serveur = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: DB, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test', SMTP_HOST: '',
      RATE_LIMIT_MAX: '100000', MODULES_CONTROLE: 'appliquer' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = (d) => process.env.DEBUG_TEST && process.stderr.write(d);
  serveur.stdout.on('data', log); serveur.stderr.on('data', log);
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) break; } catch { /* démarrage */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  // A : caisse + commercial ; B : caisse seulement.
  for (const [t, codes] of [[T.A, ['caisse', 'commercial']], [T.B, ['caisse']]]) {
    for (const code of codes) {
      const r = await appel('PUT', `/plateforme/clients/${t}/modules/${code}`, 'adm', { actif: true, motif: 'Test' });
      assert.equal(r.status, 200, r.message);
    }
  }
  // Comptes « existants » (avant la reprise) : rôles système et profils.
  await creerUtilisateur('dirA', 'directeur', T.A);
  await creerUtilisateur('caiA', 'caissier', T.A);
  await creerUtilisateur('achA', 'collaborateur', T.A, 'achats_responsable');
  await creerUtilisateur('colA', 'collaborateur', T.A);
  await creerUtilisateur('dirB', 'directeur', T.B);
  await creerUtilisateur('colB', 'collaborateur', T.B);   // B n'a pas le commercial : aucun droit de module
});

after(async () => {
  await sql(`INSERT INTO plateforme_reglages (cle, valeur) VALUES ('acces_modules_utilisateurs', to_jsonb($1::text))
             ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur`, [modeInitial || 'observer']);
  serveur?.kill();
  for (const u of Object.values(U)) await sql('DELETE FROM audit_log WHERE user_id = $1', [u.id]).catch(() => {});
  for (const t of Object.values(T)) {
    await sql('DELETE FROM audit_log WHERE tenant_id = $1', [t]).catch(() => {});
    await sql('DELETE FROM tenants WHERE id = $1', [t]).catch((e) => console.error('nettoyage', e.message));
  }
  await sql('DELETE FROM users WHERE id = $1', [U.adm.id]).catch(() => {});
  await pool.end();
});

test('Scénario 4 — reprise des comptes existants d\'après leurs droits, sans rien ajouter ni retirer', async () => {
  const droitsAvant = {};
  for (const k of ['dirA', 'caiA', 'achA', 'colA', 'colB']) droitsAvant[k] = (await appel('GET', '/auth/me', k)).data.permissions;
  const r = await reprise();
  assert.equal(r.status, 200, r.message);
  assert.deepEqual(await modulesDe('dirA'), ['caisse', 'commercial'], 'directeur : les deux modules');
  assert.deepEqual(await modulesDe('caiA'), ['caisse'], 'caissier : caisse seulement');
  assert.deepEqual(await modulesDe('achA'), ['commercial'], 'responsable des achats : commercial seulement');
  assert.deepEqual(await modulesDe('colA'), ['commercial'], 'collaborateur : ses droits de consultation du commercial');
  assert.deepEqual(await modulesDe('dirB'), ['caisse'], 'B : le commercial n\'est pas activé');
  assert.deepEqual(await modulesDe('colB'), [], 'aucun droit de module : à affecter');
  const [{ origine }] = await sql("SELECT origine FROM user_modules WHERE user_id = $1 AND module_code = 'caisse'", [U.dirA.id]);
  assert.equal(origine, 'manuel', 'reprise relancée par l\'administrateur');
  // Rejouer la reprise ne change rien (seuls les comptes sans aucune ligne sont repris).
  const n = (await sql('SELECT COUNT(*)::int AS n FROM user_modules WHERE tenant_id = $1', [T.A]))[0].n;
  await reprise();
  assert.equal((await sql('SELECT COUNT(*)::int AS n FROM user_modules WHERE tenant_id = $1', [T.A]))[0].n, n);
  // En mode observer, personne ne perd un droit.
  await mode('observer');
  for (const k of Object.keys(droitsAvant)) assert.deepEqual((await appel('GET', '/auth/me', k)).data.permissions, droitsAvant[k], k);
  // Le compte sans droit de module est « à affecter ».
  const liste = await appel('GET', '/modules/caisse/utilisateurs', 'dirB');
  assert.equal(liste.status, 200, liste.message);
  assert.equal(liste.data.resume.a_affecter, 1);
  assert.ok(liste.data.autres.some((u) => u.id === U.colB.id && u.modules.length === 0));
});

test('Listes par module : membres seulement, résumé, profils du module', async () => {
  let r = await appel('GET', '/modules/caisse/utilisateurs', 'dirA');
  const ids = r.data.utilisateurs.map((u) => u.id);
  assert.ok(ids.includes(U.dirA.id) && ids.includes(U.caiA.id));
  assert.ok(!ids.includes(U.achA.id), 'le responsable des achats n\'est pas un acteur de la caisse');
  assert.equal(r.data.resume.membres, r.data.utilisateurs.length);
  r = await appel('GET', '/modules/commercial/utilisateurs', 'dirA');
  assert.ok(r.data.utilisateurs.some((u) => u.id === U.achA.id && u.permissions_module > 0));
  assert.ok(r.data.profils.some((p) => p.code === 'achats_responsable'), 'profils propres au commercial proposés');
  assert.equal((await appel('GET', '/modules/commercial/utilisateurs', 'dirB')).status, 409, 'module non activé chez B');
  assert.equal((await appel('GET', '/modules/inconnu/utilisateurs', 'dirA')).status, 404);
  assert.equal((await appel('GET', '/modules/caisse/utilisateurs', 'achA')).status, 403, 'sans droit de gestion des utilisateurs');
});

test('Scénario 3 — comptes créés depuis le commercial : visibles dans le commercial, sans accès à la caisse', async () => {
  await mode('appliquer');
  const comptes = [['respAch', 'achats_responsable'], ['vendeur', 'ventes_commercial'], ['magasin', 'stock_magasinier']];
  for (const [cle, profil] of comptes) {
    const [{ id: roleId }] = await sql('SELECT id FROM roles WHERE tenant_id = $1 AND code = $2', [T.A, profil]);
    const r = await appel('POST', '/users', 'dirA', {
      username: `${cle}-${sfx}`, password: 'Mdp-test-2026!', role: 'collaborateur', custom_role_id: roleId, modules: ['commercial'] });
    assert.equal(r.status, 201, `${cle} : ${r.message}`);
    assert.deepEqual(r.data.modules, ['commercial']);
    U[cle] = { id: r.data.id, token: jeton(r.data.id, `${cle}-${sfx}`, 'collaborateur', T.A) };
    assert.deepEqual(await modulesDe(cle), ['commercial']);
  }
  const liste = await appel('GET', '/modules/commercial/utilisateurs', 'dirA');
  for (const [cle] of comptes) assert.ok(liste.data.utilisateurs.some((u) => u.id === U[cle].id && u.origine === 'creation'), cle);
  // Aucun accès à la caisse : ni carte, ni routes.
  const me = await appel('GET', '/auth/me', 'vendeur');
  assert.equal(me.data.modules.find((m) => m.code === 'caisse').membre, false);
  assert.equal(me.data.modules.find((m) => m.code === 'commercial').membre, true);
  assert.ok(me.data.permissions.some((p) => p.startsWith('com.')));
  const refus = await appel('GET', '/journaux', 'vendeur');
  assert.equal(refus.status, 403);
  // Module non activé chez le client : création refusée.
  assert.equal((await appel('POST', '/users', 'dirB', { username: `x-${sfx}`, password: 'Mdp-test-2026!', role: 'caissier', modules: ['commercial'] })).status, 400);
});

test('Ajout d\'un compte existant, profil propre au module, retrait motivé ; mode appliquer', async () => {
  // Le caissier n'a pas accès au commercial.
  assert.equal((await appel('GET', '/commercial/articles', 'caiA')).status, 403);
  const [{ id: profil }] = await sql("SELECT id FROM roles WHERE tenant_id = $1 AND code = 'stock_magasinier'", [T.A]);
  assert.equal((await appel('POST', '/modules/commercial/utilisateurs', 'caiA', { user_id: U.caiA.id })).status, 403, 'droit users.edit exigé');
  let r = await appel('POST', '/modules/commercial/utilisateurs', 'dirA', { user_id: U.caiA.id, role_id: profil });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.utilisateurs.find((u) => u.id === U.caiA.id).profil_module.id, profil);
  let me = await appel('GET', '/auth/me', 'caiA');
  const [{ codes: duProfil }] = await sql("SELECT array_agg(permission_code) AS codes FROM role_permissions WHERE role_id = $1 AND permission_code LIKE 'com.%'", [profil]);
  assert.ok(duProfil.every((c) => me.data.permissions.includes(c)), 'droits commerciaux du profil du module');
  assert.ok(me.data.permissions.some((p) => p.startsWith('journal.')), 'la caisse est conservée (autre module)');
  assert.equal((await appel('GET', '/commercial/articles', 'caiA')).status, 200);
  // Profil d'un autre client : refusé.
  const [{ id: profilB }] = await sql("INSERT INTO roles (tenant_id, code, nom) VALUES ($1, $2, 'Profil B') RETURNING id", [T.B, `p_b_${sfx}`]);
  assert.equal((await appel('PUT', `/modules/commercial/utilisateurs/${U.caiA.id}`, 'dirA', { role_id: profilB })).status, 400);
  r = await appel('PUT', `/modules/commercial/utilisateurs/${U.caiA.id}`, 'dirA', { role_id: null });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.utilisateurs.find((u) => u.id === U.caiA.id).profil_module, null);
  // Retrait : motif obligatoire, pas soi-même, rien de supprimé.
  assert.equal((await appel('DELETE', `/modules/commercial/utilisateurs/${U.caiA.id}`, 'dirA', {})).status, 400);
  assert.equal((await appel('DELETE', `/modules/caisse/utilisateurs/${U.dirA.id}`, 'dirA', { motif: 'test' })).status, 400, 'pas soi-même');
  r = await appel('DELETE', `/modules/commercial/utilisateurs/${U.caiA.id}`, 'dirA', { motif: 'Fin du renfort au magasin' });
  assert.equal(r.status, 200, r.message);
  assert.ok(r.data.autres.some((u) => u.id === U.caiA.id && u.retire));
  const [l] = await sql("SELECT actif, motif FROM user_modules WHERE user_id = $1 AND module_code = 'commercial'", [U.caiA.id]);
  assert.deepEqual([l.actif, l.motif], [false, 'Fin du renfort au magasin'], 'conservé, désactivé');
  assert.equal((await appel('GET', '/commercial/articles', 'caiA')).status, 403, 'plus d\'accès au commercial');
  me = await appel('GET', '/auth/me', 'caiA');
  assert.ok(!me.data.permissions.some((p) => p.startsWith('com.')));
  const audit = await sql("SELECT action FROM audit_log WHERE tenant_id = $1 AND action LIKE 'MODULE_UTILISATEUR_%'", [T.A]);
  for (const a of ['MODULE_UTILISATEUR_AJOUTE', 'MODULE_UTILISATEUR_PROFIL', 'MODULE_UTILISATEUR_RETIRE']) assert.ok(audit.some((x) => x.action === a), a);
});

test('Mode observer : rien n\'est refusé, les écarts sont signalés ; le socle reste ouvert', async () => {
  await mode('observer');
  assert.notEqual((await appel('GET', '/journaux', 'vendeur')).code, 'MODULE_NON_AUTORISE', 'observer : aucun refus lié au rattachement');
  const r = await appel('GET', '/plateforme/utilisateurs-modules', 'adm');
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.mode, 'observer');
  const a = r.data.clients.find((c) => c.id === T.A);
  assert.equal(a.modules.commercial, 6, 'directeur, responsable des achats, collaborateur et les 3 comptes créés');
  assert.ok(!r.data.ecarts.some((e) => e.user_id === U.caiA.id), 'retrait volontaire : le caissier n\'a plus de droits commerciaux, aucun écart');
  // Écart : le collaborateur garde des droits commerciaux (rôle système) mais n'est plus rattaché.
  assert.equal((await appel('DELETE', `/modules/commercial/utilisateurs/${U.colA.id}`, 'dirA', { motif: 'Contrôle des écarts' })).status, 200);
  assert.equal((await appel('GET', '/commercial/articles', 'colA')).status, 200, 'observer : rien n\'est refusé');
  const e = (await appel('GET', '/plateforme/utilisateurs-modules', 'adm')).data.ecarts.find((x) => x.user_id === U.colA.id);
  assert.deepEqual(e?.modules, ['commercial'], 'écart signalé avant le passage en mode appliquer');
  assert.equal((await appel('POST', '/modules/commercial/utilisateurs', 'dirA', { user_id: U.colA.id })).status, 200);
  assert.equal((await appel('PUT', '/plateforme/utilisateurs-modules/mode', 'dirA', { mode: 'appliquer' })).status, 403);
  assert.equal((await mode('nimporte')).status, 400);
  await mode('appliquer');
  assert.equal((await appel('GET', '/plateforme/utilisateurs-modules', 'adm')).data.mode, 'appliquer');
  // Socle : un membre du seul commercial garde l'accueil et la gestion de son compte.
  const me = await appel('GET', '/auth/me', 'respAch');
  assert.equal(me.status, 200);
  assert.ok(me.data.permissions.includes('entreprise.view'), 'droit du socle conservé');
  assert.ok(!me.data.permissions.some((p) => p.startsWith('journal.')), 'aucun droit de caisse');
});

test('Scénario 8 — isolation : chaque entreprise ne voit et ne gère que ses comptes', async () => {
  let r = await appel('GET', '/modules/caisse/utilisateurs', 'dirB');
  const ids = [...r.data.utilisateurs, ...r.data.autres].map((u) => u.id);
  assert.ok(ids.includes(U.dirB.id));
  assert.ok(!ids.includes(U.dirA.id) && !ids.includes(U.caiA.id), 'aucun compte de A');
  r = await appel('POST', '/modules/caisse/utilisateurs', 'dirB', { user_id: U.caiA.id });
  assert.equal(r.status, 404, 'compte d\'un autre client');
  assert.equal((await appel('DELETE', `/modules/caisse/utilisateurs/${U.caiA.id}`, 'dirB', { motif: 'tentative' })).status, 404);
  assert.deepEqual(await modulesDe('caiA'), ['caisse'], 'inchangé');
  await assert.rejects(sql("INSERT INTO user_modules (user_id, module_code, tenant_id) VALUES ($1, 'caisse', $2)", [U.caiA.id, T.B]),
    /n'appartient pas/, 'la base refuse un rattachement croisé');
});

test('Migration 066 rejouable', async () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '066_utilisateurs_modules.sql'), 'utf8');
  const n = (await sql('SELECT COUNT(*)::int AS n FROM user_modules'))[0].n;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(migration);
    await client.query('COMMIT');
  } finally { client.release(); }
  assert.equal((await sql('SELECT COUNT(*)::int AS n FROM user_modules'))[0].n, n);
});
