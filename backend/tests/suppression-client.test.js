// tests/suppression-client.test.js — Suppression définitive d'un client (Administration plateforme).
//
//  • réservée au super_admin ;
//  • refusée si le client est actif, s'il contient des données (écritures…),
//    s'il est lié au circuit commercial (abonnement…) ;
//  • exige l'identifiant (slug) retapé et un motif ;
//  • un client créé manuellement et jamais utilisé est supprimé avec tout son
//    paramétrage ; le journal d'audit est conservé et trace la suppression ;
//  • les autres clients ne sont pas touchés.
//
//   TEST_DATABASE_URL=postgres://…/base_de_test  node --test tests/suppression-client.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
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
const PORT = 8100 + Math.floor(Math.random() * 400);
const sfx = crypto.randomBytes(3).toString('hex');
const pool = new Pool({ connectionString: DB });
const U = {};
let serveur;
let VIDE;      // client créé par l'écran (POST /tenants), jamais utilisé
let PLEIN;     // client avec une écriture de caisse
let ABONNE;    // client avec un abonnement
const SLUG_VIDE = `manuel-${sfx}`;

const sql = async (texte, params = []) => (await pool.query(texte, params)).rows;
const appel = async (methode, url, qui, corps) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api${url}`, {
    method: methode,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${U[qui].token}` },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.data ?? j, message: j.message ?? j.error };
};
const creerUtilisateur = async (cle, role, tenant) => {
  const username = `${cle}-${sfx}`;
  const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif)
                          VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
  [tenant, username, `${username}@test.cm`, await bcrypt.hash('x', 4), role]);
  U[cle] = { id: u.id, username, token: jwt.sign({ sub: u.id, username, role, tenantId: tenant }, SECRET, { expiresIn: '1h' }) };
};
const compte = async (table, tenant) => (await sql(`SELECT COUNT(*)::int AS n FROM ${table} WHERE tenant_id = $1`, [tenant]))[0].n;

before(async () => {
  await creerUtilisateur('adm', 'super_admin', null);
  serveur = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: DB, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test', SMTP_HOST: '', RATE_LIMIT_MAX: '100000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = (d) => process.env.DEBUG_TEST && process.stderr.write(d);
  serveur.stdout.on('data', log); serveur.stderr.on('data', log);
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) break; } catch { /* démarrage */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  // Client « ajouté manuellement » par le vrai écran : rubriques, caisses, plan comptable.
  const r = await appel('POST', '/tenants', 'adm', { slug: SLUG_VIDE, nom: `Client manuel ${sfx}`, modules: ['caisse'] });   // 065 : caisse choisie
  assert.equal(r.status, 201, r.message);
  VIDE = r.data.id;
  await creerUtilisateur('dirVide', 'directeur', VIDE);
  await creerUtilisateur('caiVide', 'caissier', VIDE);
  await sql(`INSERT INTO audit_log (tenant_id, user_id, action, entite) VALUES ($1, $2, 'CONNEXION', 'auth')`, [VIDE, U.dirVide.id]);

  [{ id: PLEIN }] = await sql("INSERT INTO tenants (slug, nom, actif) VALUES ($1, $2, false) RETURNING id", [`plein-${sfx}`, `Client plein ${sfx}`]);
  const [{ id: j }] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type) VALUES ($1, 'CS1', 'Caisse', 'caisse') RETURNING id`, [PLEIN]);
  await sql(`INSERT INTO journal (tenant_id, date, mois, annee, journal_id, type_caisse, rubrique_code, intitule, beneficiaire, entree, sortie)
             VALUES ($1, '2025-03-02', 'Mars', 2025, $2, 'especes', 'D1', 'Écriture', 'X', 50000, 0)`, [PLEIN, j]);
  await creerUtilisateur('dirPlein', 'directeur', PLEIN);

  [{ id: ABONNE }] = await sql("INSERT INTO tenants (slug, nom, actif) VALUES ($1, $2, false) RETURNING id", [`abonne-${sfx}`, `Client abonné ${sfx}`]);
  await sql(`INSERT INTO abonnements (tenant_id, forfait_id, forfait_nom, date_debut, date_fin)
             VALUES ($1, 1, 'Essentiel', '2026-01-01', '2026-12-31')`, [ABONNE]);
});

after(async () => {
  serveur?.kill();
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL app.journal_maintenance = 'on'");
    await c.query('DELETE FROM journal WHERE tenant_id = $1', [PLEIN]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK'); } finally { c.release(); }
  for (const t of [PLEIN, ABONNE, VIDE]) {
    for (const q of ['DELETE FROM abonnements WHERE tenant_id = $1', 'DELETE FROM audit_log WHERE tenant_id = $1',
      'DELETE FROM tenant_modules WHERE tenant_id = $1', 'DELETE FROM tenants WHERE id = $1']) await sql(q, [t]).catch(() => {});
  }
  await sql("DELETE FROM audit_log WHERE entite_id = $1 OR user_id = $2", [String(VIDE), U.adm.id]).catch(() => {});
  await sql('DELETE FROM users WHERE id = $1', [U.adm.id]).catch(() => {});
  await pool.end();
});

test('Réservé au super_admin', async () => {
  const r = await appel('POST', `/plateforme/clients/${VIDE}/suppression`, 'dirVide', { confirmation: SLUG_VIDE, motif: 'Créé par erreur' });
  assert.equal(r.status, 403);
  assert.equal(await compte('users', VIDE), 2);
});

test('Client actif : bilan non supprimable, suppression refusée', async () => {
  const b = await appel('GET', `/plateforme/clients/${VIDE}/suppression`, 'adm');
  assert.equal(b.status, 200);
  assert.equal(b.data.supprimable, false);
  assert.match(b.data.raisons.join(' '), /suspendez/i);
  const r = await appel('POST', `/plateforme/clients/${VIDE}/suppression`, 'adm', { confirmation: SLUG_VIDE, motif: 'Créé par erreur' });
  assert.equal(r.status, 409);
});

test('Client avec une écriture de caisse : refus, données intactes', async () => {
  const b = await appel('GET', `/plateforme/clients/${PLEIN}/suppression`, 'adm');
  assert.equal(b.data.supprimable, false);
  assert.match(b.data.raisons.join(' '), /1 écriture/);
  const r = await appel('POST', `/plateforme/clients/${PLEIN}/suppression`, 'adm', { confirmation: `plein-${sfx}`, motif: 'Essai de suppression' });
  assert.equal(r.status, 409);
  assert.equal(await compte('journal', PLEIN), 1);
  assert.equal(await compte('users', PLEIN), 1);
});

test('Client avec abonnement : refus (circuit commercial)', async () => {
  const b = await appel('GET', `/plateforme/clients/${ABONNE}/suppression`, 'adm');
  assert.equal(b.data.supprimable, false);
  assert.match(b.data.raisons.join(' '), /commercial/);
  const r = await appel('POST', `/plateforme/clients/${ABONNE}/suppression`, 'adm', { confirmation: `abonne-${sfx}`, motif: 'Essai de suppression' });
  assert.equal(r.status, 409);
  assert.equal((await sql('SELECT 1 FROM tenants WHERE id = $1', [ABONNE])).length, 1);
});

test('Confirmation incorrecte ou motif absent : refus', async () => {
  assert.equal((await appel('PATCH', `/plateforme/clients/${VIDE}/actif`, 'adm', { actif: false, motif: 'Créé par erreur' })).status, 200);
  const b = await appel('GET', `/plateforme/clients/${VIDE}/suppression`, 'adm');
  assert.equal(b.data.supprimable, true, b.data.raisons?.join(' '));
  assert.equal(b.data.nb_utilisateurs, 2);
  let r = await appel('POST', `/plateforme/clients/${VIDE}/suppression`, 'adm', { confirmation: 'autre-chose', motif: 'Créé par erreur' });
  assert.equal(r.status, 400);
  r = await appel('POST', `/plateforme/clients/${VIDE}/suppression`, 'adm', { confirmation: SLUG_VIDE, motif: '' });
  assert.equal(r.status, 400);
  assert.equal((await sql('SELECT 1 FROM tenants WHERE id = $1', [VIDE])).length, 1);
});

test('Client manuel jamais utilisé : supprimé avec son paramétrage, audit conservé', async () => {
  assert.ok(await compte('rubriques', VIDE) > 0, 'paramétrage créé avec le client');
  const r = await appel('POST', `/plateforme/clients/${VIDE}/suppression`, 'adm', { confirmation: SLUG_VIDE.toUpperCase(), motif: 'Créé par erreur' });
  assert.equal(r.status, 200, r.message);
  assert.equal((await sql('SELECT 1 FROM tenants WHERE id = $1', [VIDE])).length, 0);
  for (const t of ['users', 'rubriques', 'journaux', 'plan_comptable_client', 'tenant_modules']) {
    assert.equal(await compte(t, VIDE), 0, `${t} vidé`);
  }
  const [trace] = await sql("SELECT * FROM audit_log WHERE action = 'SUPPRESSION_CLIENT' AND entite_id = $1", [String(VIDE)]);
  assert.ok(trace, 'suppression tracée');
  assert.equal(trace.user_id, U.adm.id);
  assert.equal(trace.ancienne_valeur.slug, SLUG_VIDE);
  assert.equal(trace.nouvelle_valeur.motif, 'Créé par erreur');
  const [{ n }] = await sql("SELECT COUNT(*)::int AS n FROM audit_log WHERE action IN ('CONNEXION', 'CREATION_CLIENT', 'SUSPENSION_CLIENT') AND tenant_id IS NULL AND (entite_id = $1 OR entite = 'auth') AND created_at > NOW() - interval '1 hour'", [String(VIDE)]);
  assert.ok(n >= 3, 'anciennes lignes d\'audit conservées (détachées du client)');
  const audit = await appel('GET', '/plateforme/audit', 'adm');
  assert.ok(audit.data.some((a) => a.action === 'SUPPRESSION_CLIENT' && a.client === `Client manuel ${sfx}`), 'visible dans le journal plateforme');
});

test('Les autres clients ne sont pas touchés', async () => {
  assert.equal(await compte('journal', PLEIN), 1);
  assert.equal((await sql('SELECT 1 FROM tenants WHERE id = ANY($1)', [[PLEIN, ABONNE]])).length, 2);
  const r = await appel('GET', `/plateforme/clients/${VIDE}/suppression`, 'adm');
  assert.equal(r.status, 404);
});
