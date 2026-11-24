// tests/pieces-privees.test.js — Pièces justificatives privées (migration 073, audit S36/S35).
//
//  • une pièce n'est plus lisible par l'ancien lien public /uploads/… (404) ;
//  • elle se lit par GET /api/pieces/fichier/:id avec un jeton du bon client ;
//  • sans jeton : 401 ; jeton d'un autre client : 404 (rien n'est révélé) ;
//  • sans la permission pieces.view : 403 ;
//  • le type est contrôlé sur le contenu : un faux PDF est refusé ;
//  • l'adresse enregistrée est celle de l'API ; la migration 073 réécrit les anciennes.
//
//   TEST_DATABASE_URL=postgres://…/base_de_test  npm run test:pieces-privees
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const DB = process.env.TEST_DATABASE_URL;
if (!DB) {
  console.error('TEST_DATABASE_URL absent : test ignoré (ne jamais viser la base de production).');
  process.exit(0);
}
const SECRET = 'test-secret-' + crypto.randomBytes(16).toString('hex');
const PORT = 7500 + Math.floor(Math.random() * 400);
const ORIGINE = `http://127.0.0.1:${PORT}`;
const BASE = `${ORIGINE}/api`;
const sfx = crypto.randomBytes(3).toString('hex');
const pool = new Pool({ connectionString: DB });
const STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pieces-test-'));
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
let serveur;
let TENANT;
let AUTRE;
let MVT;
const U = {};

const sql = async (texte, params = []) => (await pool.query(texte, params)).rows;
const appel = async (methode, url, qui, corps) => {
  const r = await fetch(BASE + url, {
    method: methode,
    headers: { 'Content-Type': 'application/json', ...(qui ? { Authorization: `Bearer ${U[qui].token}` } : {}) },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const brut = Buffer.from(await r.arrayBuffer());
  let j = {};
  try { j = JSON.parse(brut.toString('utf8')); } catch { /* binaire */ }
  return { status: r.status, data: j.data ?? j, message: j.message ?? j.error, brut, type: r.headers.get('content-type') || '' };
};
const creerUtilisateur = async (cle, role, tenant = TENANT) => {
  const username = `${cle}-${sfx}`;
  const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif)
                          VALUES ($1, $2, $3, 'x', $4, true) RETURNING id`, [tenant, username, `${username}@test.cm`, role]);
  U[cle] = { id: u.id, token: jwt.sign({ sub: u.id, username, role, tenantId: tenant }, SECRET, { expiresIn: '1h' }) };
};

before(async () => {
  [{ id: TENANT }] = await sql('INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id', [`pp-${sfx}`, `PP ${sfx}`]);
  [{ id: AUTRE }] = await sql('INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id', [`pp2-${sfx}`, `PP2 ${sfx}`]);
  const [{ id: CS1 }] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type) VALUES ($1, 'CS1', 'Caisse', 'caisse') RETURNING id`, [TENANT]);
  [{ id: MVT }] = await sql(`INSERT INTO journal (tenant_id, date, mois, annee, journal_id, type_caisse, rubrique_code, intitule, beneficiaire, entree, sortie)
    VALUES ($1, CURRENT_DATE, 'Mars', 2025, $2, 'especes', 'D1', 'Test pièce', 'X', 1000, 0) RETURNING id`, [TENANT, CS1]);
  await creerUtilisateur('dir', 'directeur');
  await creerUtilisateur('aut', 'directeur', AUTRE);
  await creerUtilisateur('sansdroit', 'caissier');
  await sql(`INSERT INTO user_permissions (user_id, permission_code, effet) VALUES ($1, 'pieces.view', 'deny')`, [U.sansdroit.id]);
  serveur = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: DB, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test', SMTP_HOST: '', RATE_LIMIT_MAX: '100000', STORAGE_DIR },
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
  for (const t of [TENANT, AUTRE]) {
    await sql('DELETE FROM pieces_jointes WHERE tenant_id = $1', [t]).catch(() => {});
    await sql('DELETE FROM journal WHERE tenant_id = $1', [t]).catch(() => {});
    await sql('DELETE FROM users WHERE tenant_id = $1', [t]).catch(() => {});
    await sql('DELETE FROM journaux WHERE tenant_id = $1', [t]).catch(() => {});
    await sql('DELETE FROM tenants WHERE id = $1', [t]).catch(() => {});
  }
  await pool.end();
  fs.rmSync(STORAGE_DIR, { recursive: true, force: true });
});

let PIECE;

test('Envoi : le type est contrôlé sur le contenu, l\'adresse enregistrée est celle de l\'API', async () => {
  let r = await appel('POST', `/pieces/upload/${MVT}`, 'dir',
    { nom_fichier: 'facture.pdf', mime_type: 'application/pdf', data_base64: Buffer.from('<html><script>alert(1)</script></html>').toString('base64') });
  assert.equal(r.status, 400, 'un faux PDF est refusé');
  r = await appel('POST', `/pieces/upload/${MVT}`, 'dir', { nom_fichier: '../../Facture mars.pdf', mime_type: 'application/pdf', data_base64: PDF.toString('base64') });
  assert.equal(r.status, 201, r.message);
  PIECE = r.data;
  assert.equal(PIECE.storage_url, `/api/pieces/fichier/${PIECE.id}`);
  assert.equal(PIECE.nom_fichier, 'Facture mars.pdf', 'nom nettoyé, sans chemin');
  assert.ok(fs.existsSync(path.join(STORAGE_DIR, PIECE.storage_path)), 'fichier écrit dans le dossier privé');
});

test('Lecture : jeton du bon client seulement ; l\'ancien lien public est fermé', async () => {
  let r = await appel('GET', `/pieces/fichier/${PIECE.id}`, 'dir');
  assert.equal(r.status, 200);
  assert.match(r.type, /application\/pdf/);
  assert.ok(r.brut.equals(PDF), 'contenu identique');
  assert.equal((await appel('GET', `/pieces/fichier/${PIECE.id}`)).status, 401, 'sans jeton');
  assert.equal((await appel('GET', `/pieces/fichier/${PIECE.id}`, 'aut')).status, 404, 'autre client : rien n\'est révélé');
  assert.equal((await appel('GET', `/pieces/fichier/${PIECE.id}`, 'sansdroit')).status, 403, 'sans pieces.view');
  assert.equal((await appel('GET', '/pieces/fichier/abc', 'dir')).status, 404);
  const pub = await fetch(`${ORIGINE}/uploads/${PIECE.storage_path}`);
  assert.equal(pub.status, 404, 'l\'ancien lien public ne sert plus le fichier');
  assert.ok(!Buffer.from(await pub.arrayBuffer()).equals(PDF));
});

test('Migration 073 : les anciennes adresses /uploads sont réécrites, de façon idempotente', async () => {
  await sql('UPDATE pieces_jointes SET storage_url = $2 WHERE id = $1', [PIECE.id, `/uploads/${PIECE.storage_path}`]);
  const migration = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '073_pieces_privees.sql'), 'utf8');
  await pool.query(migration);
  await pool.query(migration);
  const [p] = await sql('SELECT storage_url FROM pieces_jointes WHERE id = $1', [PIECE.id]);
  assert.equal(p.storage_url, `/api/pieces/fichier/${PIECE.id}`);
});

test('Fichier absent du disque : 404 propre, sans fuite', async () => {
  fs.rmSync(path.join(STORAGE_DIR, PIECE.storage_path));
  const r = await appel('GET', `/pieces/fichier/${PIECE.id}`, 'dir');
  assert.equal(r.status, 404);
  assert.ok(!/ENOENT|\/tmp|pieces-test/.test(r.brut.toString()), 'aucun chemin du serveur dans la réponse');
});
