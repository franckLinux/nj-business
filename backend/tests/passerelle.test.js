// tests/passerelle.test.js — Passerelle comptable, lot 1 (migration 037).
//
// Lance le VRAI serveur (index.js) sur une base de TEST, puis appelle l'API.
//   TEST_DATABASE_URL=postgres://…/base_de_test  npm run test:passerelle
// La base doit être migrée (node db/migrate.js --schema, migrations jusqu'à 037)
// et le plan comptable chargé (node db/seed-plan-comptable.js). Aucune base
// n'est utilisée sans TEST_DATABASE_URL explicite.
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
const U = {};
const R = {};   // code rubrique → id
const J = {};   // code journal → id

const sql = async (texte, params = []) => (await pool.query(texte, params)).rows;
const appel = async (methode, url, qui, corps) => {
  const r = await fetch(BASE + url, {
    method: methode,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${U[qui].token}`,
      ...(U[qui].cabinet ? { 'X-Tenant-Id': TENANT } : {}),
    },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.data ?? j, message: j.message ?? j.error };
};
const creerUtilisateur = async (cle, role, tenantId) => {
  const username = `${cle}-${sfx}`;
  const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif)
                          VALUES ($1, $2, $3, 'x', $4, true) RETURNING id`, [tenantId, username, `${username}@test.cm`, role]);
  U[cle] = { id: u.id, cabinet: !tenantId,
    token: jwt.sign({ sub: u.id, username, role, tenantId }, SECRET, { expiresIn: '1h' }) };
};

before(async () => {
  [{ id: TENANT }] = await sql(`INSERT INTO tenants (slug, nom) VALUES ($1, $2) RETURNING id`, [`passerelle-${sfx}`, `PASSERELLE ${sfx}`]);
  await sql('SELECT plan_client_initialiser($1)', [TENANT]);
  for (const [code, intitule, type, vir, cc] of [
    ['D1', 'EAU ELECTRICITE', 'depense', false, '6053'],
    ['D2', 'INTERNET', 'depense', false, '6282'],
    ['D3', 'COMPTE FAUX', 'depense', false, '6015'],
    ['E1', 'APPORT', 'entree', false, ''],
    ['VIR', 'VIREMENT CAISSE OM', 'depense', true, ''],
  ]) {
    const [r] = await sql(`INSERT INTO rubriques (tenant_id, code, intitule, type, est_virement_interne, code_comptable)
                            VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [TENANT, code, intitule, type, vir, cc]);
    R[code] = r.id;
  }
  for (const [code, type] of [['CS1', 'caisse'], ['OM1', 'om']]) {
    const [j] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type) VALUES ($1, $2, $2, $3) RETURNING id`, [TENANT, code, type]);
    J[code] = j.id;
  }
  await creerUtilisateur('dir', 'directeur', TENANT);
  await creerUtilisateur('cai', 'caissier', TENANT);
  await creerUtilisateur('cpt', 'comptable_cabinet', null);
  await creerUtilisateur('cpt2', 'comptable_cabinet', null);   // non affecté
  await sql('INSERT INTO cabinet_affectations (user_id, tenant_id) VALUES ($1, $2)', [U.cpt.id, TENANT]);

  serveur = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: DB, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test',
      SMTP_HOST: '', RATE_LIMIT_MAX: '100000' },
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
  await sql('DELETE FROM users WHERE username LIKE $1', [`%-${sfx}`]).catch(() => {});
  await pool.end();
});

test('Accès : caissier refusé, comptable non affecté refusé, directeur en lecture + proposition', async () => {
  assert.equal((await appel('GET', '/passerelle', 'cai')).status, 403);
  assert.equal((await appel('GET', '/passerelle', 'cpt2')).status, 403);
  const r = await appel('GET', '/passerelle', 'dir');
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.droits.valider, false);
  assert.equal(r.data.completude.pret, false);
  assert.equal(r.data.journaux.find((j) => j.code === 'CS1').suggestion.compte_tresorerie.startsWith('571'), true);
  assert.equal((await appel('PUT', `/passerelle/journaux/${J.CS1}`, 'dir', { compte_tresorerie: '5711', code_journal_compta: 'CA' })).status, 403);
});

test('Journaux : compte de trésorerie contrôlé (existant, actif, classe 5)', async () => {
  assert.equal((await appel('PUT', `/passerelle/journaux/${J.CS1}`, 'cpt', { compte_tresorerie: '6053', code_journal_compta: 'CA' })).status, 400);
  assert.equal((await appel('PUT', `/passerelle/journaux/${J.CS1}`, 'cpt', { compte_tresorerie: '5799999', code_journal_compta: 'CA' })).status, 400);
  assert.equal((await appel('PUT', `/passerelle/journaux/${J.CS1}`, 'cpt', { compte_tresorerie: '5711', code_journal_compta: '' })).status, 400);
  assert.equal((await appel('PUT', `/passerelle/journaux/${J.CS1}`, 'cpt', { compte_tresorerie: '5711', code_journal_compta: 'ca' })).status, 200);
  assert.equal((await appel('PUT', `/passerelle/journaux/${J.OM1}`, 'cpt', { compte_tresorerie: '552', code_journal_compta: 'OM' })).status, 200);
  const [j] = await sql('SELECT compte_tresorerie, code_journal_compta FROM journaux WHERE id = $1', [J.CS1]);
  assert.deepEqual(j, { compte_tresorerie: '5711', code_journal_compta: 'CA' });
});

test('Proposition du directeur → validation du cabinet, versionnée, recopiée sur la rubrique', async () => {
  let r = await appel('POST', '/passerelle/equivalences', 'dir', { rubrique_id: R.D1, compte: '6053' });
  assert.equal(r.data.statut, 'brouillon');
  assert.equal((await appel('POST', '/passerelle/equivalences', 'dir', { rubrique_id: R.VIR, compte: '585' })).status, 400);
  assert.equal((await appel('POST', '/passerelle/equivalences', 'dir', { rubrique_id: R.D3, compte: '6015' })).status, 400);

  const [b] = await sql("SELECT id FROM equivalences_comptables WHERE rubrique_id = $1 AND statut = 'brouillon'", [R.D1]);
  assert.equal((await appel('PATCH', `/passerelle/equivalences/${b.id}/decision`, 'dir', { decision: 'valider' })).status, 403);
  r = await appel('PATCH', `/passerelle/equivalences/${b.id}/decision`, 'cpt', { decision: 'valider' });
  assert.equal(r.status, 200, r.message);
  assert.equal((await appel('PATCH', `/passerelle/equivalences/${b.id}/decision`, 'cpt', { decision: 'valider' })).status, 409);

  // Le cabinet change le compte : nouvelle version, l'ancienne est archivée.
  r = await appel('POST', '/passerelle/equivalences', 'cpt', { rubrique_id: R.D1, compte: '6052' });
  assert.equal(r.data.statut, 'valide');
  assert.equal(r.data.version, 2);
  const lignes = await sql('SELECT version, statut, compte FROM equivalences_comptables WHERE rubrique_id = $1 ORDER BY version', [R.D1]);
  assert.deepEqual(lignes.map((l) => `${l.version}:${l.statut}:${l.compte}`), ['1:archive:6053', '2:valide:6052']);
  const [rub] = await sql('SELECT code_comptable FROM rubriques WHERE id = $1', [R.D1]);
  assert.equal(rub.code_comptable, '6052');
  const h = await appel('GET', `/passerelle/rubriques/${R.D1}/historique`, 'dir');
  assert.equal(h.data.length, 2);
});

test('Rejet : motif obligatoire', async () => {
  await appel('POST', '/passerelle/equivalences', 'dir', { rubrique_id: R.D2, compte: '6282' });
  const [b] = await sql("SELECT id FROM equivalences_comptables WHERE rubrique_id = $1 AND statut = 'brouillon'", [R.D2]);
  assert.equal((await appel('PATCH', `/passerelle/equivalences/${b.id}/decision`, 'cpt', { decision: 'rejeter' })).status, 400);
  const r = await appel('PATCH', `/passerelle/equivalences/${b.id}/decision`, 'cpt', { decision: 'rejeter', motif: 'Utiliser 6281' });
  assert.equal(r.data.statut, 'rejete');
});

test('Import en lot : lignes en erreur signalées sans bloquer les autres', async () => {
  const r = await appel('POST', '/passerelle/equivalences/lot', 'cpt', { lignes: [
    { rubrique_code: 'D2', compte: '6282' }, { rubrique_code: 'D3', compte: '6015' },
    { rubrique_code: 'INCONNUE', compte: '6282' }, { rubrique_code: 'E1', compte: '7078' },
  ] });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.erreurs.length >= 2, true);
  const [d2] = await sql("SELECT compte FROM equivalences_comptables WHERE rubrique_id = $1 AND statut = 'valide'", [R.D2]);
  assert.equal(d2.compte, '6282');
});

test('Modifier le code d\'une rubrique validée crée une proposition, sans toucher au compte validé', async () => {
  const r = await appel('PUT', `/rubriques/${R.D1}`, 'dir', { intitule: 'EAU ELECTRICITE', code_comptable: '6053', est_virement_interne: false, ordre: 0, actif: true });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.code_comptable, '6052');
  assert.match(r.data.passerelle_message, /proposé au cabinet/);
  const [b] = await sql("SELECT compte FROM equivalences_comptables WHERE rubrique_id = $1 AND statut = 'brouillon'", [R.D1]);
  assert.equal(b.compte, '6053');
});

test('Compte cité par la passerelle : ni supprimable ni renumérotable dans le plan du client', async () => {
  await sql(`INSERT INTO plan_comptable_client (tenant_id, compte, intitule, classe, origine) VALUES ($1, '60539', 'Eau test', 6, 'client')`, [TENANT]);
  await sql('UPDATE rubriques SET code_comptable = \'\' WHERE id = $1', [R.D3]);
  assert.equal((await appel('POST', '/passerelle/equivalences', 'cpt', { rubrique_id: R.D3, compte: '60539' })).status, 200);
  await sql("UPDATE rubriques SET code_comptable = '' WHERE id = $1", [R.D3]);   // seule l'équivalence le cite désormais
  await assert.rejects(sql("DELETE FROM plan_comptable_client WHERE tenant_id = $1 AND compte = '60539'", [TENANT]));
  await assert.rejects(sql("UPDATE plan_comptable_client SET compte = '60538' WHERE tenant_id = $1 AND compte = '60539'", [TENANT]));
});

test('Paramètres : SAGE i7 pas encore activable, compte des virements en classe 5', async () => {
  assert.equal((await appel('PUT', '/passerelle/parametres', 'cpt', { format_export: 'sage_i7' })).status, 400);
  assert.equal((await appel('PUT', '/passerelle/parametres', 'cpt', { compte_virements: '6052' })).status, 400);
  assert.equal((await appel('PUT', '/passerelle/parametres', 'cpt', { compte_virements: '585', format_export: 'csv' })).status, 200);
  assert.equal((await appel('PUT', '/passerelle/parametres', 'dir', { compte_virements: '585' })).status, 403);
});

test('Complétude : prête quand toutes les rubriques et tous les journaux sont paramétrés', async () => {
  const [b] = await sql("SELECT id FROM equivalences_comptables WHERE rubrique_id = $1 AND statut = 'brouillon'", [R.D1]);
  await appel('PATCH', `/passerelle/equivalences/${b.id}/decision`, 'cpt', { decision: 'rejeter', motif: 'On garde 6052' });
  let e = await appel('GET', '/passerelle', 'cpt');
  const manquantes = e.data.rubriques.filter((x) => !x.est_virement_interne && x.etat !== 'valide').map((x) => x.code);
  for (const code of manquantes) {
    const r = await appel('POST', '/passerelle/equivalences', 'cpt', { rubrique_id: R[code], compte: code.startsWith('E') ? '7078' : '6052' });
    assert.equal(r.status, 200, `${code} : ${r.message}`);
  }
  e = await appel('GET', '/passerelle', 'cpt');
  assert.equal(e.data.completude.pret, true, JSON.stringify(e.data.anomalies));
  assert.equal(e.data.anomalies.length, 0);
});
