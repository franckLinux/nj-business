// tests/finance-immobilisations.test.js — NJ FINANCE lot F10 : tableau des immobilisations (084).
//   TEST_DATABASE_URL=postgres://…/base_de_test  node --test tests/finance-immobilisations.test.js
// Couvre : catégories standard tirées du plan ; registre (code automatique, durée
// par défaut, terrain non amorti) ; plan linéaire au prorata (année de 360 jours) ;
// reprise d'un bien ancien ; sortie (cession, résultat) et annulation ; tableau
// d'un exercice (valeurs brutes, amortissements, VNC) ; droits ; isolement.
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
const PORT = 6900 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}/api`;
const sfx = crypto.randomBytes(3).toString('hex');
const pool = new Pool({ connectionString: DB });
let serveur;
const C = { a: { u: {} }, b: { u: {} } };
const S = {};

const sql = async (texte, params = []) => (await pool.query(texte, params)).rows;
const appel = async (methode, url, qui, corps, client = 'a') => {
  const r = await fetch(BASE + url, {
    method: methode,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${C[client].u[qui].token}` },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.data ?? j, message: j.message ?? j.error };
};

before(async () => {
  for (const cle of ['a', 'b']) {
    const c = C[cle];
    [{ id: c.tenant }] = await sql(`INSERT INTO tenants (slug, nom, forme_juridique, initialise_le) VALUES ($1, $2, 'SARL', NOW()) RETURNING id`,
      [`immo-${cle}-${sfx}`, `IMMO ${cle} ${sfx}`]);
    for (const [qui, role] of [['dir', 'directeur'], ['cpt', 'auditeur'], ['cai', 'caissier']]) {
      const username = `${qui}-immo-${cle}-${sfx}`;
      const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif) VALUES ($1, $2, $3, 'x', $4, true) RETURNING id`,
        [c.tenant, username, `${username}@test.cm`, role]);
      c.u[qui] = { id: u.id, token: jwt.sign({ sub: u.id, username, role, tenantId: c.tenant }, SECRET, { expiresIn: '1h' }) };
    }
  }
  serveur = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: DB, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test', SMTP_HOST: '', RATE_LIMIT_MAX: '100000' },
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
  const ids = [C.a.tenant, C.b.tenant].filter(Boolean);
  try {
    await sql('DELETE FROM audit_log WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await sql('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [ids]);
  } catch (e) {
    console.error('Nettoyage de la base de test incomplet :', e.message);
  }
  await pool.end();
});

test('Catégories standard tirées du plan comptable ; la caissière n\'y a pas accès', async () => {
  assert.equal((await appel('GET', '/finance/immobilisations', 'cai')).status, 403);
  const r = await appel('POST', '/finance/immobilisations/categories', 'cpt');
  assert.equal(r.status, 200, r.message);
  assert.ok(r.data.creees.includes('INFORMATIQUE'), JSON.stringify(r.data));
  const cats = (await appel('GET', '/finance/immobilisations/categories', 'dir')).data;
  S.cat = Object.fromEntries(cats.map((c) => [c.code, c]));
  assert.match(S.cat.INFORMATIQUE.compte_immo, /^244/);
  assert.match(S.cat.INFORMATIQUE.compte_amort, /^284/);
  assert.equal(S.cat.TERRAIN.amortissable, false);
  assert.equal((await appel('POST', '/finance/immobilisations/categories', 'cpt')).data.creees.length, 0, 'idempotent');
});

test('Registre et plan : linéaire, prorata en jours (360), dernière annuité qui solde', async () => {
  const r = await appel('POST', '/finance/immobilisations', 'cpt', {
    designation: 'Serveur et postes informatiques', categorie_id: S.cat.INFORMATIQUE.id,
    date_acquisition: '2026-03-20', date_mise_service: '2026-04-01', valeur_origine: '3 600 000', localisation: 'Siège',
  });
  assert.equal(r.status, 201, r.message);
  assert.equal(r.data.code, 'IMM-0001');
  S.info = r.data.id;
  const f = (await appel('GET', `/finance/immobilisations/${S.info}`, 'dir')).data;
  assert.equal(f.immobilisation.duree_annees, Number(S.cat.INFORMATIQUE.duree_defaut), 'durée de la catégorie');
  assert.deepEqual(f.plan.map((l) => [l.annee, l.jours, l.dotation, l.vnc]),
    [[2026, 270, 900000, 2700000], [2027, 360, 1200000, 1500000], [2028, 360, 1200000, 300000], [2029, 360, 300000, 0]]);
  const terrain = await appel('POST', '/finance/immobilisations', 'cpt', { designation: 'Terrain de Nkolbisson', categorie_id: S.cat.TERRAIN.id,
    date_acquisition: '2020-05-01', valeur_origine: 15000000 });
  assert.equal(terrain.status, 201, terrain.message);
  assert.equal((await appel('GET', `/finance/immobilisations/${terrain.data.id}`, 'dir')).data.plan.length, 0, 'un terrain ne s\'amortit pas');
  // Reprise d'un véhicule acheté en 2023 : amortissements antérieurs arrêtés au 31/12/2025.
  const v = await appel('POST', '/finance/immobilisations', 'cpt', { designation: 'Véhicule Toyota Hilux', categorie_id: S.cat.TRANSPORT.id,
    date_acquisition: '2023-01-10', date_mise_service: '2023-01-10', valeur_origine: 20000000, duree_annees: 4,
    amort_anterieurs: 14861111, amort_anterieurs_au: '2025-12-31' });
  assert.equal(v.status, 201, v.message);
  S.vehicule = v.data.id;
  const pv = (await appel('GET', `/finance/immobilisations/${S.vehicule}`, 'dir')).data.plan;
  assert.deepEqual(pv.map((l) => [l.annee, l.dotation, l.vnc]), [[2026, 5000000, 138889], [2027, 138889, 0]]);
  // Contrôles de saisie.
  assert.equal((await appel('POST', '/finance/immobilisations', 'cpt', { designation: 'X', categorie_id: S.cat.MOBILIER.id,
    date_acquisition: '2026-05-01', date_mise_service: '2026-04-01', valeur_origine: 10 })).status, 400);
  assert.equal((await appel('POST', '/finance/immobilisations', 'cai', { designation: 'X', categorie_id: S.cat.MOBILIER.id,
    date_acquisition: '2026-05-01', valeur_origine: 10 })).status, 403);
});

test('Sortie : cession, amortissement arrêté à la date, résultat ; annulation', async () => {
  const s = await appel('POST', `/finance/immobilisations/${S.vehicule}/sortie`, 'cpt', { type: 'cession', date_sortie: '2026-06-30', prix_cession: 3000000, motif: 'Vendu' });
  assert.equal(s.status, 200, s.message);
  assert.equal(s.data.plan.at(-1).dotation, 2500000, '6 mois sur 2026');
  assert.equal(s.data.sortie.vnc, 2638889);
  assert.equal(s.data.sortie.resultat, 361111);
  assert.equal((await appel('POST', `/finance/immobilisations/${S.vehicule}/sortie`, 'cpt', { type: 'rebut', date_sortie: '2026-07-01' })).status, 409);
  const liste = (await appel('GET', '/finance/immobilisations?statut=sorties', 'dir')).data;
  assert.equal(liste.lignes.length, 1);
});

test('Tableau de l\'exercice : valeurs brutes, amortissements et VNC', async () => {
  const t = (await appel('GET', '/finance/immobilisations/tableau?annee=2026', 'dir')).data;
  assert.equal(t.totaux.vb_debut, 15000000 + 20000000);
  assert.equal(t.totaux.acquisitions, 3600000);
  assert.equal(t.totaux.sorties, 20000000);
  assert.equal(t.totaux.vb_fin, 18600000);
  assert.equal(t.totaux.amort_debut, 14861111);
  assert.equal(t.totaux.dotation, 900000 + 2500000);
  assert.equal(t.totaux.reprises, 14861111 + 2500000);
  assert.equal(t.totaux.amort_fin, 900000);
  assert.equal(t.totaux.vnc_fin, 17700000);
  const vehicule = t.categories.flatMap((c) => c.lignes).find((l) => l.id === S.vehicule);
  assert.equal(vehicule.resultat_sortie, 361111);
  // L'année précédente ne voit pas l'acquisition 2026.
  const t25 = (await appel('GET', '/finance/immobilisations/tableau?annee=2025', 'dir')).data;
  assert.equal(t25.totaux.acquisitions, 0);
  assert.equal((await appel('DELETE', `/finance/immobilisations/${S.vehicule}/sortie`, 'cpt')).status, 200);
  assert.equal((await appel('GET', `/finance/immobilisations/${S.vehicule}`, 'dir')).data.immobilisation.statut, 'en_service');
});

test('Isolement entre clients', async () => {
  assert.equal((await appel('GET', `/finance/immobilisations/${S.info}`, 'dir', undefined, 'b')).status, 404);
  assert.equal((await appel('GET', '/finance/immobilisations', 'dir', undefined, 'b')).data.lignes.length, 0);
  assert.equal((await appel('POST', '/finance/immobilisations', 'cpt', { designation: 'X', categorie_id: S.cat.MOBILIER.id,
    date_acquisition: '2026-05-01', valeur_origine: 10 }, 'b')).status, 400, 'catégorie d\'un autre client');
});
