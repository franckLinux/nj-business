// tests/caisse-parametres.test.js — NJ BUSINESS lot B (migration 065).
//
//  • Scénario 1 : client créé SANS module (aucune donnée de caisse, aucun module) ;
//  • modules choisis à la création, activés et préparés dans la même transaction ;
//    module inconnu ou en préparation : rien n'est créé ;
//  • Scénario 2 : activation de NJ CAISSE PRO → rubriques, journaux, plan
//    (référentiel suggéré par la forme juridique) ; paramètres propres à la caisse ;
//  • choix du plan comptable dans la caisse (aperçu, confirmation), la forme
//    juridique ne fait que le suggérer ;
//  • signataires et exercice ; droits ;
//  • Scénario 7 : désactivation puis réactivation, données et réglages intacts ;
//  • migration 065 rejouable.
//
//   TEST_DATABASE_URL=postgres://…/base_de_test  node --test tests/caisse-parametres.test.js
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
const PORT = 8300 + Math.floor(Math.random() * 400);
const sfx = crypto.randomBytes(3).toString('hex');
const pool = new Pool({ connectionString: DB });
let serveur;
const U = {};
const T = {};   // clients créés par les tests

const sql = async (texte, params = []) => (await pool.query(texte, params)).rows;
const appel = async (methode, url, qui, corps, entetes = {}) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api${url}`, {
    method: methode,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${U[qui].token}`, ...entetes },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.data ?? j, message: j.message ?? j.error };
};
const creerUtilisateur = async (cle, role, tenant) => {
  const username = `${cle}-${sfx}`;
  const hash = await bcrypt.hash('Mdp-test-2026!', 4);
  const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif)
                          VALUES ($1, $2, $3, $4, $5, true) RETURNING id`, [tenant, username, `${username}@test.cm`, hash, role]);
  U[cle] = { id: u.id, username, token: jwt.sign({ sub: u.id, username, role, tenantId: tenant }, SECRET, { expiresIn: '1h' }) };
};
const compte = async (table, tenant) => (await sql(`SELECT COUNT(*)::int AS n FROM ${table} WHERE tenant_id = $1`, [tenant]))[0].n;
const actifs = async (tenant) => (await sql(
  'SELECT module_code FROM tenant_modules WHERE tenant_id = $1 AND actif ORDER BY module_code', [tenant])).map((r) => r.module_code);

before(async () => {
  await creerUtilisateur('adm', 'super_admin', null);
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
});

after(async () => {
  serveur?.kill();
  const ids = Object.values(T);
  for (const u of Object.values(U)) {
    await sql('DELETE FROM audit_log WHERE user_id = $1', [u.id]).catch(() => {});
    await sql('DELETE FROM users WHERE id = $1', [u.id]).catch(() => {});
  }
  for (const t of ids) {
    await sql('DELETE FROM audit_log WHERE tenant_id = $1', [t]).catch(() => {});
    await sql('DELETE FROM plan_bascules WHERE tenant_id = $1', [t]).catch(() => {});
    await sql('DELETE FROM tenants WHERE id = $1', [t]).catch((e) => console.error('nettoyage', e.message));
  }
  await pool.end();
});

test('Scénario 1 — client créé sans aucun module : aucune donnée de caisse, configuration accessible', async () => {
  const r = await appel('POST', '/tenants', 'adm', { slug: `sans-${sfx}`, nom: `Sans module ${sfx}` });
  assert.equal(r.status, 201, r.message);
  T.sans = r.data.id;
  assert.deepEqual(r.data.modules, []);
  assert.deepEqual(await actifs(T.sans), [], 'aucun module');
  for (const t of ['rubriques', 'journaux', 'plan_comptable_client']) assert.equal(await compte(t, T.sans), 0, `${t} : rien`);
  await creerUtilisateur('dirSans', 'directeur', T.sans);
  assert.equal((await appel('GET', '/entreprise', 'dirSans')).status, 200, 'configuration de l\'entreprise accessible');
  assert.equal((await appel('PUT', '/entreprise', 'dirSans', { forme_juridique: 'ONG', ville: 'Bafoussam' })).status, 200);
  assert.equal((await appel('GET', '/caisse/parametres', 'dirSans')).status, 403, 'caisse non activée');
  const [audit] = await sql("SELECT nouvelle_valeur FROM audit_log WHERE tenant_id = $1 AND action = 'CREATION_CLIENT'", [T.sans]);
  assert.deepEqual(audit.nouvelle_valeur.modules, []);
});

test('Création avec modules choisis : activés et préparés ; module invalide → rien n\'est créé', async () => {
  let r = await appel('POST', '/tenants', 'adm', { slug: `deux-${sfx}`, nom: `Deux modules ${sfx}`, modules: ['caisse', 'commercial'] });
  assert.equal(r.status, 201, r.message);
  T.deux = r.data.id;
  assert.deepEqual(await actifs(T.deux), ['caisse', 'commercial']);
  assert.ok(await compte('rubriques', T.deux) > 0 && await compte('journaux', T.deux) === 5, 'caisse préparée');
  assert.ok(await compte('plan_comptable_client', T.deux) > 0, 'plan comptable initialisé');
  assert.ok((await sql("SELECT 1 FROM roles WHERE tenant_id = $1 AND code = 'achats_responsable'", [T.deux])).length, 'profils du commercial créés');
  for (const [modules, code] of [[['inexistant'], 404], [['dsf'], 400], ['caisse', 400]]) {
    r = await appel('POST', '/tenants', 'adm', { slug: `ko-${sfx}`, nom: 'Ne doit pas exister', modules });
    assert.equal(r.status, code, JSON.stringify(modules));
    assert.equal((await sql('SELECT 1 FROM tenants WHERE slug = $1', [`ko-${sfx}`])).length, 0, 'aucun client à moitié créé');
  }
});

test('Scénario 2 — activation de la caisse : préparation, plan suggéré par la forme, paramètres propres', async () => {
  const r = await appel('PUT', `/plateforme/clients/${T.sans}/modules/caisse`, 'adm', { actif: true, motif: 'Souscription' });
  assert.equal(r.status, 200, r.message);
  assert.equal(await compte('journaux', T.sans), 5);
  const [{ plan_referentiel: ref }] = await sql('SELECT plan_referentiel FROM tenants WHERE id = $1', [T.sans]);
  assert.equal(ref, 'SYCEBNL', 'ONG : le plan initialisé est celui que la forme suggère');
  await creerUtilisateur('caiSans', 'caissier', T.sans);
  const p = await appel('GET', '/caisse/parametres', 'caiSans');
  assert.equal(p.status, 200, p.message);
  assert.equal(p.data.plan.actuel, 'SYCEBNL');
  assert.equal(p.data.plan.suggere, 'SYCEBNL');
  assert.equal(p.data.plan.ecart, false);
});

test('Plan comptable choisi dans la caisse : aperçu, confirmation, la forme ne fait que suggérer', async () => {
  assert.equal((await appel('POST', '/caisse/parametres/plan', 'caiSans', { referentiel: 'SYSCOHADA', confirmer: true })).status, 403);
  assert.equal((await appel('POST', '/caisse/parametres/plan', 'dirSans', { referentiel: 'XYZ', confirmer: true })).status, 400);
  assert.equal((await appel('POST', '/caisse/parametres/plan', 'dirSans', { referentiel: 'SYSCOHADA' })).status, 400, 'confirmation exigée');
  const a = await appel('GET', '/caisse/parametres/plan?referentiel=SYSCOHADA', 'dirSans');
  assert.equal(a.status, 200, a.message);
  assert.equal(a.data.change, true);
  assert.ok(a.data.apercu && typeof a.data.apercu.ajoutes === 'number', 'aperçu chiffré');
  assert.equal((await sql('SELECT plan_referentiel FROM tenants WHERE id = $1', [T.sans]))[0].plan_referentiel, 'SYCEBNL', 'l\'aperçu n\'écrit rien');
  let r = await appel('POST', '/caisse/parametres/plan', 'dirSans', { referentiel: 'SYSCOHADA', confirmer: true });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.parametres.plan.actuel, 'SYSCOHADA');
  assert.equal(r.data.parametres.plan.ecart, true, 'écart signalé : la forme suggère le SYCEBNL');
  // Changer la forme juridique (configuration de l'entreprise ou ancienne route) ne touche pas au plan.
  assert.equal((await appel('PUT', '/entreprise', 'dirSans', { forme_juridique: 'SARL' })).status, 200);
  assert.equal((await appel('PUT', '/config', 'dirSans', { nom: `Sans module ${sfx}`, forme_juridique: 'ASSOC' })).status, 200);
  assert.equal((await sql('SELECT plan_referentiel FROM tenants WHERE id = $1', [T.sans]))[0].plan_referentiel, 'SYSCOHADA');
  r = await appel('POST', '/caisse/parametres/plan', 'dirSans', { referentiel: 'SYSCOHADA', confirmer: true });
  assert.equal(r.data.resultat, null, 'déjà en place : rien à faire');
});

test('Signataires et exercice : enregistrés, contrôlés, tracés ; le représentant légal ne les écrase pas', async () => {
  assert.equal((await appel('PUT', '/caisse/parametres', 'caiSans', { caissier_nom: 'X' })).status, 403);
  assert.equal((await appel('PUT', '/caisse/parametres', 'dirSans', { exercice_debut: '2026-12-31', exercice_fin: '2026-01-01' })).status, 400);
  assert.equal((await appel('PUT', '/caisse/parametres', 'dirSans', { exercice_debut: '2026-13-01' })).status, 400);
  const r = await appel('PUT', '/caisse/parametres', 'dirSans', {
    caissier_nom: 'Aline FOUDA', directeur_nom: 'Paul ESSOMBA', exercice_debut: '2026-01-01', exercice_fin: '2026-12-31' });
  assert.equal(r.status, 200, r.message);
  assert.deepEqual([r.data.signataires.caissier_nom, r.data.signataires.directeur_nom], ['Aline FOUDA', 'Paul ESSOMBA']);
  assert.deepEqual(r.data.exercice, { debut: '2026-01-01', fin: '2026-12-31' });
  const [audit] = await sql("SELECT nouvelle_valeur FROM audit_log WHERE tenant_id = $1 AND action = 'CAISSE_PARAMETRES'", [T.sans]);
  assert.equal(audit.nouvelle_valeur.directeur_nom, 'Paul ESSOMBA');
  assert.equal((await appel('POST', '/entreprise/representants', 'dirSans', { nom: 'MBALLA', prenoms: 'Rose', fonction: 'Présidente' })).status, 200);
  const [t] = await sql('SELECT directeur_nom, dirigeant_nom FROM tenants WHERE id = $1', [T.sans]);
  assert.deepEqual([t.directeur_nom, t.dirigeant_nom], ['Paul ESSOMBA', 'Rose MBALLA'], 'signataire de caisse conservé');
});

test('Scénario 7 — désactivation puis réactivation : données et réglages intacts, rien en double', async () => {
  await sql("UPDATE journaux SET nom = 'Caisse siège' WHERE tenant_id = $1 AND code = 'CS1'", [T.sans]);
  await sql("DELETE FROM journaux WHERE tenant_id = $1 AND code = 'CP1'", [T.sans]);
  const avant = { r: await compte('rubriques', T.sans), j: await compte('journaux', T.sans), p: await compte('plan_comptable_client', T.sans) };
  let r = await appel('PUT', `/plateforme/clients/${T.sans}/modules/caisse`, 'adm', { actif: false, motif: 'Suspension du contrat' });
  assert.equal(r.status, 200, r.message);
  assert.equal((await appel('GET', '/caisse/parametres', 'dirSans')).status, 403, 'module fermé');
  assert.equal((await appel('GET', '/entreprise', 'dirSans')).status, 200, 'configuration de l\'entreprise toujours ouverte');
  r = await appel('PUT', `/plateforme/clients/${T.sans}/modules/caisse`, 'adm', { actif: true, motif: 'Reprise du contrat' });
  assert.equal(r.status, 200, r.message);
  assert.deepEqual({ r: await compte('rubriques', T.sans), j: await compte('journaux', T.sans), p: await compte('plan_comptable_client', T.sans) }, avant,
    'aucune donnée recréée ni perdue');
  assert.equal((await sql("SELECT nom FROM journaux WHERE tenant_id = $1 AND code = 'CS1'", [T.sans]))[0].nom, 'Caisse siège');
  const p = await appel('GET', '/caisse/parametres', 'dirSans');
  assert.equal(p.data.signataires.directeur_nom, 'Paul ESSOMBA');
  assert.equal(p.data.plan.actuel, 'SYSCOHADA');
});

test('Migration 065 rejouable', async () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '065_creation_client_sans_module.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(migration);
    await client.query(migration);
    await client.query('COMMIT');
  } finally { client.release(); }
  const [m] = await sql("SELECT par_defaut, prefixes_api FROM modules WHERE code = 'caisse'");
  assert.equal(m.par_defaut, false);
  assert.equal(m.prefixes_api.filter((x) => x === '/caisse').length, 1, 'préfixe ajouté une seule fois');
});
