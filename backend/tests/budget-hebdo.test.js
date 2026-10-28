// tests/budget-hebdo.test.js — Budget hebdomadaire au choix (migration 040).
//
// Lance le VRAI serveur (index.js) sur une base de TEST, puis appelle l'API.
//   TEST_DATABASE_URL=postgres://…/base_de_test  npm run test:budget-hebdo
// La base doit être migrée jusqu'à 040. Aucune base n'est utilisée sans
// TEST_DATABASE_URL explicite. Les dates sont fixées en octobre/novembre
// de l'année suivante pour ne jamais dépendre du jour d'exécution.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const hebdo = require('../src/services/budget_hebdo.service');

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
const AN = new Date().getFullYear() + 1;          // toujours dans le futur
const M = 'Octobre';
let serveur;
let TENANT;
let TENANT_MENSUEL;
let JOURNAL;
const U = {};

const sql = async (texte, params = []) => (await pool.query(texte, params)).rows;
const appel = async (methode, url, qui, corps) => {
  const r = await fetch(BASE + url, {
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
                          VALUES ($1, $2, $3, 'x', $4, true) RETURNING id`, [tenant, username, `${username}@test.cm`, role]);
  U[cle] = { id: u.id, token: jwt.sign({ sub: u.id, username, role, tenantId: tenant }, SECRET, { expiresIn: '1h' }) };
};
const d = (jour) => `${AN}-10-${String(jour).padStart(2, '0')}`;
const sortie = (jour, montant, rubrique = 'D1') => appel('POST', '/journal', 'cai', {
  date: d(jour), mois: M, annee: AN, journal_id: JOURNAL, rubrique_code: rubrique, intitule: 'Achat', entree: 0, sortie: montant,
});
const prevoir = (semaine, montant, qui = 'cai') => appel('PUT', '/budget', qui, {
  mois: M, annee: AN, semaine, rubrique_code: 'D1', intitule: 'FOURNITURES', montant, mois_applic: M, annee_applic: AN,
});
const valider = (semaine, statut = 'valide') => appel('POST', '/budget/validation', 'dir', { mois: M, annee: AN, semaine, statut });

before(async () => {
  [{ id: TENANT }] = await sql(`INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id`, [`hebdo-${sfx}`, `HEBDO ${sfx}`]);
  [{ id: TENANT_MENSUEL }] = await sql(`INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id`, [`mensuel-${sfx}`, `MENSUEL ${sfx}`]);
  await sql(`INSERT INTO rubriques (tenant_id, code, intitule, type) VALUES ($1, 'D1', 'FOURNITURES', 'depense'), ($1, 'E1', 'APPORT', 'entree')`, [TENANT]);
  [{ id: JOURNAL }] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type, date_ouverture)
                                 VALUES ($1, 'CS1', 'Caisse', 'caisse', $2) RETURNING id`, [TENANT, `${AN}-10-01`]);
  await creerUtilisateur('dir', 'directeur', TENANT);
  await creerUtilisateur('cai', 'caissier', TENANT);
  await creerUtilisateur('dirm', 'directeur', TENANT_MENSUEL);
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
  for (const t of [TENANT, TENANT_MENSUEL]) await sql('DELETE FROM tenants WHERE id = $1', [t]).catch(() => {});
  await pool.end();
});

test('Calendrier : semaines lundi→dimanche dans le mois, morceaux de moins de 3 jours rattachés', () => {
  for (let a = 2025; a <= 2030; a += 1) {
    for (const m of hebdo.MOIS) {
      const s = hebdo.semainesDuMois(m, a);
      const nb = new Date(a, hebdo.indexMois(m) + 1, 0).getDate();
      assert.equal(s[0].debut.slice(8), '01');
      assert.equal(Number(s[s.length - 1].fin.slice(8)), nb);
      assert.equal(s.reduce((t, x) => t + x.jours, 0), nb, `${m} ${a} : tous les jours couverts une fois`);
      s.forEach((x, i) => {
        assert.ok(x.jours >= 3 && x.jours <= 9, `${m} ${a} S${x.num} : ${x.jours} jours`);
        if (i > 0) assert.equal(new Date(`${x.debut}T12:00:00Z`).getUTCDay(), 1, 'une semaine commence un lundi');
      });
    }
  }
  // Novembre 2026 commence un dimanche : le 1er est rattaché à la semaine du 2 au 8.
  assert.deepEqual(hebdo.semainesDuMois('Novembre', 2026).map((x) => `${x.debut.slice(8)}-${x.fin.slice(8)}`), ['01-08', '09-15', '16-22', '23-30']);
});

test('Réglage : réservé au directeur, jamais rétroactif, effet au 1er du mois', async () => {
  assert.equal((await appel('PUT', '/budget/periodicite', 'cai', { periodicite: 'hebdomadaire', mois: M, annee: AN })).status, 403);
  assert.equal((await appel('PUT', '/budget/periodicite', 'dir', { periodicite: 'hebdomadaire', mois: 'Janvier', annee: 2020 })).status, 400);
  const r = await appel('PUT', '/budget/periodicite', 'dir', { periodicite: 'hebdomadaire', mois: M, annee: AN });
  assert.equal(r.status, 200, r.message);
  const p = await appel('GET', `/budget/periode?mois=${M}&annee=${AN}`, 'cai');
  assert.equal(p.data.periodicite, 'hebdomadaire');
  assert.ok(p.data.semaines.length >= 4);
  const avant = await appel('GET', `/budget/periode?mois=Septembre&annee=${AN}`, 'cai');
  assert.equal(avant.data.periodicite, 'mensuel', 'les mois antérieurs restent mensuels');
  assert.equal((await appel('GET', '/budget/periodicite', 'dir')).data.historique.length, 1);
});

test('Prévisions : semaine obligatoire en hebdomadaire, interdite en mensuel', async () => {
  let r = await appel('PUT', '/budget', 'cai', { mois: M, annee: AN, rubrique_code: 'D1', intitule: 'X', montant: 1000, mois_applic: M, annee_applic: AN });
  assert.equal(r.status, 400);
  assert.match(r.message, /hebdomadaire/);
  assert.equal((await prevoir(3, 10000)).status, 200);
  assert.equal((await prevoir(4, 5000)).status, 200);
  r = await appel('GET', `/budget?mois=${M}&annee=${AN}&semaine=4`, 'dir');
  assert.equal(r.data.dotations.length, 1);
  assert.equal(parseFloat(r.data.dotations[0].montant), 5000);
  r = await appel('GET', `/budget?mois=${M}&annee=${AN}`, 'dir');
  assert.equal(r.data.periodicite, 'hebdomadaire');
  assert.equal(r.data.par_semaine.D1[3] + r.data.par_semaine.D1[4], 15000);
  // Client mensuel : rien ne change.
  r = await appel('GET', `/budget?mois=${M}&annee=${AN}`, 'dirm');
  assert.equal(r.data.periodicite, 'mensuel');
  assert.equal((await appel('GET', `/budget?mois=${M}&annee=${AN}&semaine=2`, 'dirm')).status, 400);
});

test('Contrôle des sorties : semaine non validée, cumul avec report, dépassement', async () => {
  // Fonds d'ouverture (entrée, sans contrôle budgétaire).
  let r = await appel('POST', '/journal', 'cai', { date: d(1), mois: M, annee: AN, journal_id: JOURNAL, rubrique_code: 'E1', intitule: 'Apport', entree: 1000000, sortie: 0 });
  assert.equal(r.status, 201, r.message);
  // S4 non validée → attente.
  r = await sortie(20, 3000);
  assert.equal(r.data.en_attente, true);
  assert.equal(r.data.motif, 'semaine_non_validee');
  // S4 validée seule : budget cumulé = 5 000.
  assert.equal((await valider(4)).status, 200);
  r = await sortie(20, 12000);
  assert.equal(r.data.en_attente, true);
  assert.equal(r.data.motif, 'depassement_rubrique');
  // S3 validée : cumul S1..S4 = 15 000 (report du non-dépensé de S3).
  assert.equal((await valider(3)).status, 200);
  r = await sortie(20, 12000);
  assert.equal(r.status, 201, r.message);
  const dispo = await appel('GET', `/journal/disponible?date=${d(21)}&mois=${M}&annee=${AN}&rubrique_code=D1`, 'cai');
  assert.equal(dispo.data.semaine, 4);
  assert.equal(dispo.data.reste, 3000);
  r = await sortie(21, 4000);
  assert.equal(r.data.en_attente, true, 'au-delà du cumul : attente');
  // Une semaine validée est figée.
  assert.equal((await prevoir(4, 9000)).status, 409);
  // S5 non validée.
  r = await sortie(27, 1000);
  assert.equal(r.data.motif, 'semaine_non_validee');
});

test('Demande de fonds hebdomadaire : porte sur la semaine suivante, puis sur S1 du mois suivant', async () => {
  const n = hebdo.semainesDuMois(M, AN).length;
  let r = await appel('GET', `/appel-fonds/synthese?mois=${M}&annee=${AN}&semaine=2`, 'dir');
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.semaine_cible, 3);
  assert.equal(r.data.total_prevision, 10000);
  assert.equal(r.data.validation.statut, 'valide');
  r = await appel('GET', `/appel-fonds/synthese?mois=${M}&annee=${AN}&semaine=${n}`, 'dir');
  assert.equal(r.data.mois_cible, 'Novembre');
  assert.equal(r.data.semaine_cible, 1);
  assert.equal((await appel('GET', `/appel-fonds/synthese?mois=${M}&annee=${AN}`, 'dir')).status, 400, 'semaine obligatoire');
});

test('Budget de caisse hebdomadaire et contexte hors ligne', async () => {
  let r = await appel('PUT', '/budget-caisse', 'dir', { journal_id: JOURNAL, mois: M, annee: AN, semaine: 4, montant: 50000 });
  assert.equal(r.status, 200, r.message);
  r = await appel('GET', `/budget-caisse?journal_id=${JOURNAL}&mois=${M}&annee=${AN}&semaine=4`, 'dir');
  assert.equal(parseFloat(r.data.montant), 50000);
  assert.equal(r.data.sorties_actuelles, 12000);
  r = await appel('GET', `/journal/controle-context?journal_id=${JOURNAL}&mois=${M}&annee=${AN}`, 'cai');
  const s4 = r.data.hebdo.semaines.find((x) => x.num === 4);
  assert.equal(s4.valide, true);
  assert.equal(s4.approuve_cumul.D1, 15000);
  assert.equal(s4.sorties_cumul.D1, 12000);
  assert.equal(s4.plafond_cumul, 50000);
});

test('Changement de réglage refusé une fois le mois commencé', async () => {
  const r = await appel('PUT', '/budget/periodicite', 'dir', { periodicite: 'mensuel', mois: M, annee: AN });
  assert.equal(r.status, 409);
  assert.equal((await appel('PUT', '/budget/periodicite', 'dir', { periodicite: 'mensuel', mois: 'Decembre', annee: AN })).status, 200);
  assert.equal((await appel('GET', `/budget/periode?mois=Decembre&annee=${AN}`, 'cai')).data.periodicite, 'mensuel');
  assert.equal((await appel('GET', `/budget/periode?mois=Novembre&annee=${AN}`, 'cai')).data.periodicite, 'hebdomadaire');
});

test('En base : pas de mélange mensuel / hebdomadaire dans un même mois', async () => {
  await assert.rejects(sql(`INSERT INTO budget (tenant_id, mois, annee, rubrique_code, intitule, montant, mois_applic, annee_applic)
                            VALUES ($1, $2, $3, 'D2', 'X', 1, $2, $3)`, [TENANT, M, AN]), /mélangerait/);
});
