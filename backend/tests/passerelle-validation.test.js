// tests/passerelle-validation.test.js — Validation du paramétrage de la passerelle
// (lot du 22/10/2026) : cohérence de sens, compte de détail, journaux, rubriques
// archivées, simulation d'export (balance de contrôle).
//   TEST_DATABASE_URL=postgres://…/base_de_test  npm run test:passerelle-validation
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
const PORT = 6200 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}/api`;
const sfx = crypto.randomBytes(3).toString('hex');
const pool = new Pool({ connectionString: DB });
const AN = new Date().getFullYear() + 1;
let serveur;
let TENANT;
const J = {};
const R = {};
const U = {};

const sql = async (texte, params = []) => (await pool.query(texte, params)).rows;
const appel = async (methode, url, qui, corps) => {
  const r = await fetch(BASE + url, {
    method: methode,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${U[qui].token}`, ...(U[qui].cabinet ? { 'X-Tenant-Id': TENANT } : {}) },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.data ?? j, message: j.message ?? j.error };
};
const creerUtilisateur = async (cle, role, tenant) => {
  const username = `${cle}-${sfx}`;
  const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif)
                          VALUES ($1, $2, $3, 'x', $4, true) RETURNING id`, [tenant, username, `${username}@test.cm`, role]);
  U[cle] = { id: u.id, cabinet: !tenant, token: jwt.sign({ sub: u.id, username, role, tenantId: tenant }, SECRET, { expiresIn: '1h' }) };
};
const mvt = async (journal, jour, rubrique, { entree = 0, sortie = 0, intitule = 'Pièce', exporte = false } = {}) => {
  const [r] = await sql(
    `INSERT INTO journal (tenant_id, date, mois, annee, journal_id, type_caisse, rubrique_code, intitule, entree, sortie, exporte_sage)
     VALUES ($1, $2, 'Mars', $3, $4, 'especes', $5, $6, $7, $8, $9) RETURNING id`,
    [TENANT, `${AN}-03-${String(jour).padStart(2, '0')}`, AN, journal, rubrique, intitule, entree, sortie, exporte]);
  return Number(r.id);
};
const proposer = (rubrique, compte, qui = 'cpt') => appel('POST', '/passerelle/equivalences', qui, { rubrique_id: R[rubrique], compte });
const simuler = () => appel('GET', `/passerelle/simulation?mois=Mars&annee=${AN}`, 'cpt');

before(async () => {
  [{ id: TENANT }] = await sql(`INSERT INTO tenants (slug, nom, initialise_le, compte_virements) VALUES ($1, $2, NOW(), '585') RETURNING id`, [`psv-${sfx}`, `PSV ${sfx}`]);
  const rubs = [['D1', 'ELECTRICITE', 'depense', true, false], ['D2', 'AVANCE PERSONNEL', 'depense', true, false],
    ['E1', 'VENTES', 'entree', true, false], ['V1', 'VIREMENT CAISSE BANQUE', 'depense', true, true],
    ['VE', 'VIREMENT RECU', 'entree', true, true], ['OLD', 'ANCIENNE RUBRIQUE', 'depense', false, false],
    ['MORTE', 'RUBRIQUE MORTE', 'depense', false, false]];
  for (const [code, intitule, type, actif, vir] of rubs) {
    const [r] = await sql(`INSERT INTO rubriques (tenant_id, code, intitule, type, actif, est_virement_interne) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [TENANT, code, intitule, type, actif, vir]);
    R[code] = r.id;
  }
  for (const [code, type] of [['CS1', 'caisse'], ['BQ1', 'banque'], ['OM1', 'om']]) {
    const [j] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type) VALUES ($1, $2, $2, $3) RETURNING id`, [TENANT, code, type]);
    J[code] = j.id;
  }
  await creerUtilisateur('cpt', 'comptable_cabinet', null);
  await sql('INSERT INTO cabinet_affectations (user_id, tenant_id) VALUES ($1, $2)', [U.cpt.id, TENANT]);
  await creerUtilisateur('dir', 'directeur', TENANT);
  serveur = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: DB, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test', SMTP_HOST: '', RATE_LIMIT_MAX: '100000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = (x) => process.env.DEBUG_TEST && process.stderr.write(x);
  serveur.stdout.on('data', log); serveur.stderr.on('data', log);
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* démarrage */ }
    await new Promise((r) => setTimeout(r, 250));
  }
});
after(async () => {
  serveur?.kill();
  await sql('DELETE FROM journal WHERE tenant_id = $1', [TENANT]).catch(() => {});
  await sql('DELETE FROM tenants WHERE id = $1', [TENANT]).catch(() => {});
  await sql('DELETE FROM users WHERE id = $1', [U.cpt?.id]).catch(() => {});
  await pool.end();
});

test('A — Sens : dépense sur classe 7 et recette sur classe 6 refusées ; classe 4 acceptée avec avertissement', async () => {
  let r = await proposer('D1', '7011');
  assert.equal(r.status, 400); assert.match(r.message, /produit \(classe 7\)/);
  r = await proposer('E1', '6052');
  assert.equal(r.status, 400); assert.match(r.message, /charge \(classe 6\)/);
  r = await proposer('D1', '6052');
  assert.equal(r.status, 200, r.message); assert.equal(r.data.statut, 'valide'); assert.equal(r.data.avertissement, null);
  r = await proposer('D2', '421');
  assert.equal(r.status, 200, r.message); assert.match(r.data.avertissement, /tiers/);
  // Le directeur aussi est arrêté dès la proposition.
  r = await proposer('E1', '6055', 'dir');
  assert.equal(r.status, 400);
});

test('A — Compte de regroupement refusé (rubrique et trésorerie) ; code journal unique et au bon format', async () => {
  let r = await proposer('E1', '701');
  assert.equal(r.status, 400); assert.match(r.message, /regroupement.*7011/);
  assert.equal((await proposer('E1', '7011')).status, 200);
  r = await appel('PUT', `/passerelle/journaux/${J.CS1}`, 'cpt', { compte_tresorerie: '571', code_journal_compta: 'CA' });
  assert.equal(r.status, 400); assert.match(r.message, /5711/);
  assert.equal((await appel('PUT', `/passerelle/journaux/${J.CS1}`, 'cpt', { compte_tresorerie: '5711', code_journal_compta: 'CAISSE01' })).status, 400, 'plus de 6 caractères');
  assert.equal((await appel('PUT', `/passerelle/journaux/${J.CS1}`, 'cpt', { compte_tresorerie: '5711', code_journal_compta: 'C-A' })).status, 400, 'caractère interdit');
  assert.equal((await appel('PUT', `/passerelle/journaux/${J.CS1}`, 'cpt', { compte_tresorerie: '5711', code_journal_compta: 'ca' })).status, 200);
  r = await appel('PUT', `/passerelle/journaux/${J.BQ1}`, 'cpt', { compte_tresorerie: '521', code_journal_compta: 'CA' });
  assert.equal(r.status, 409); assert.match(r.message, /déjà utilisé/);
  assert.equal((await appel('PUT', `/passerelle/journaux/${J.BQ1}`, 'cpt', { compte_tresorerie: '521', code_journal_compta: 'BQ' })).status, 200);
  r = await appel('PUT', `/passerelle/journaux/${J.OM1}`, 'cpt', { compte_tresorerie: '521', code_journal_compta: 'OM' });
  assert.equal(r.status, 200); assert.match(r.data.avertissement, /aussi utilisé par BQ1/);
  r = await appel('GET', '/passerelle', 'cpt');
  assert.match(r.data.journaux.find((j) => j.code === 'OM1').alerte, /partagé/);
  assert.equal((await appel('PUT', `/passerelle/journaux/${J.OM1}`, 'cpt', { compte_tresorerie: '552', code_journal_compta: 'OM' })).status, 200);
});

test('B — Rubrique archivée encore mouvementée : listée, mappable, classée par montant ; une rubrique morte reste cachée', async () => {
  await mvt(J.CS1, 2, 'OLD', { sortie: 90000 });
  await mvt(J.CS1, 2, 'MORTE', { sortie: 5000, exporte: true });
  let r = await appel('GET', '/passerelle', 'cpt');
  const old = r.data.rubriques.find((x) => x.code === 'OLD');
  assert.ok(old, 'rubrique archivée avec mouvements à exporter listée');
  assert.equal(old.archivee, true); assert.equal(old.nb_a_exporter, 1); assert.equal(old.montant_a_exporter, 90000);
  assert.ok(!r.data.rubriques.some((x) => x.code === 'MORTE'), 'archivée et déjà exportée : ignorée');
  assert.equal(r.data.completude.pret, false);
  assert.equal((await proposer('OLD', '6055')).status, 200);
  assert.equal((await proposer('MORTE', '6055')).status, 404);
  // Sens contraire déjà en base (donnée ancienne) : état « incoherent ».
  await sql(`UPDATE equivalences_comptables SET compte = '7011' WHERE rubrique_id = $1 AND statut = 'valide'`, [R.OLD]);
  r = await appel('GET', '/passerelle', 'cpt');
  assert.equal(r.data.rubriques.find((x) => x.code === 'OLD').etat, 'incoherent');
  await sql(`UPDATE equivalences_comptables SET compte = '6055' WHERE rubrique_id = $1 AND statut = 'valide'`, [R.OLD]);
});

test('C — Simulation : blocages (compte manquant, virement non soldé) puis balance juste', async () => {
  await mvt(J.CS1, 1, 'E1', { entree: 300000, intitule: 'Ventes' });
  await mvt(J.CS1, 3, 'D1', { sortie: 45000, intitule: 'ENEO' });
  await mvt(J.CS1, 4, 'D2', { sortie: 20000, intitule: 'Avance' });
  await mvt(J.CS1, 5, 'V1', { sortie: 100000, intitule: 'Versement banque' });
  let r = await simuler();
  assert.equal(r.status, 200, r.message);
  const niv = (code) => r.data.controles.find((c) => c.code === code).niveau;
  assert.equal(r.data.verdict, 'bloquant');
  assert.equal(niv('virements'), 'bloquant', 'la sortie de caisse vers la banque n\'a pas son entrée');
  assert.equal(niv('arrets'), 'avertissement');
  assert.equal(niv('controle'), 'avertissement');
  // Contrepartie du virement côté banque → 585 soldé.
  await mvt(J.BQ1, 5, 'VE', { entree: 100000, intitule: 'Versement reçu' });
  r = await simuler();
  assert.equal(r.data.controles.find((c) => c.code === 'virements').niveau, 'ok');
  assert.equal(r.data.controles.find((c) => c.code === 'comptes').niveau, 'ok', JSON.stringify(r.data.sans_compte));
  assert.equal(r.data.controles.find((c) => c.code === 'equilibre').niveau, 'ok');
  assert.equal(r.data.controles.find((c) => c.code === 'tresorerie').niveau, 'ok', JSON.stringify(r.data.rapprochement));
  assert.equal(r.data.totaux.debit, r.data.totaux.credit);
  const b = Object.fromEntries(r.data.balance.map((x) => [x.compte, x]));
  assert.equal(b['5711'].debit, 300000); assert.equal(b['5711'].credit, 45000 + 20000 + 100000 + 90000);
  assert.equal(b['7011'].credit, 300000);
  assert.equal(b['585'].debit, 100000); assert.equal(b['585'].credit, 100000);
  assert.equal(b['521'].debit, 100000);
  assert.notEqual(r.data.verdict, 'bloquant');
  // Une rubrique de dépense imputée sur la trésorerie fausse le rapprochement.
  await sql(`UPDATE equivalences_comptables SET compte = '5711' WHERE rubrique_id = $1 AND statut = 'valide'`, [R.D1]);
  r = await simuler();
  assert.equal(r.data.controles.find((c) => c.code === 'tresorerie').niveau, 'bloquant');
  await sql(`UPDATE equivalences_comptables SET compte = '6052' WHERE rubrique_id = $1 AND statut = 'valide'`, [R.D1]);
  assert.equal((await appel('GET', '/passerelle/simulation?mois=Mars&annee=abc', 'cpt')).status, 400);
});
