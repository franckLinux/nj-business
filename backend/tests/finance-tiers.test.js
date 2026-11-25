// tests/finance-tiers.test.js — NJ FINANCE lot F4 : clients et fournisseurs (078).
//
// Lance le VRAI serveur (index.js) sur une base de TEST, puis appelle l'API.
//   TEST_DATABASE_URL=postgres://…/base_de_test  node --test tests/finance-tiers.test.js
// La base doit être migrée jusqu'à 078.
//
// Couvre : droits (caissier en lecture) ; création avec conditions de paiement,
// NIU unique (format inhabituel signalé), doublon de nom signalé ; modification (identité + conditions,
// la vérification sur pièce n'est pas modifiable ici) ; soldes, relevé de compte
// avec report et solde progressif ; mouvements de caisse du tiers ; états des
// créances et des dettes (validées / brouillard inclus) ; isolement des clients.
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
const PORT = 7000 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}/api`;
const sfx = crypto.randomBytes(3).toString('hex');
const pool = new Pool({ connectionString: DB });
const AN = new Date().getFullYear();
let serveur;
const C = { a: {}, b: {} };

const sql = async (texte, params = []) => (await pool.query(texte, params)).rows;
const appel = async (methode, url, client, qui, corps) => {
  const r = await fetch(BASE + url, {
    method: methode,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${C[client].u[qui].token}` },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.data ?? j, message: j.message ?? j.error, brut: j };
};

const creerClient = async (cle) => {
  const c = C[cle];
  [{ id: c.tenant }] = await sql(`INSERT INTO tenants (slug, nom, forme_juridique, initialise_le) VALUES ($1, $2, 'SARL', NOW()) RETURNING id`,
    [`tie-${cle}-${sfx}`, `TIERS ${cle} ${sfx}`]);
  for (const m of ['caisse', 'comptabilite']) {
    await sql('INSERT INTO tenant_modules (tenant_id, module_code, actif) VALUES ($1, $2, true) ON CONFLICT DO NOTHING', [c.tenant, m]);
  }
  [{ id: c.caisse }] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type, date_ouverture, compte_tresorerie)
                                  VALUES ($1, 'BQ1', 'Banque', 'banque', $2, '521') RETURNING id`, [c.tenant, `${AN}-01-01`]);
  c.u = {};
  for (const [qui, role] of [['dir', 'directeur'], ['cpt', 'auditeur'], ['cai', 'caissier']]) {
    const username = `${qui}-tie-${cle}-${sfx}`;
    const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif) VALUES ($1, $2, $3, 'x', $4, true) RETURNING id`,
      [c.tenant, username, `${username}@test.cm`, role]);
    for (const m of ['caisse', 'comptabilite']) {
      await sql('INSERT INTO user_modules (user_id, module_code, tenant_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [u.id, m, c.tenant]);
    }
    c.u[qui] = { id: u.id, token: jwt.sign({ sub: u.id, username, role, tenantId: c.tenant }, SECRET, { expiresIn: '1h' }) };
  }
};

before(async () => {
  await creerClient('a');
  await creerClient('b');
  serveur = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: DB, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test', SMTP_HOST: '', RATE_LIMIT_MAX: '100000', MODULES_CONTROLE: 'appliquer' },
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
  const cx = await pool.connect();
  try {
    await cx.query('BEGIN');
    await cx.query("SET LOCAL app.finance_maintenance = 'on'");
    await cx.query("SET LOCAL app.journal_maintenance = 'on'");
    const ids = [C.a.tenant, C.b.tenant].filter(Boolean);
    await cx.query('DELETE FROM audit_log WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM user_modules WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM tenant_modules WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [ids]);
    await cx.query('COMMIT');
  } catch (e) {
    await cx.query('ROLLBACK');
    console.error('Nettoyage de la base de test incomplet :', e.message);
  } finally {
    cx.release();
  }
  await pool.end();
});

test('Droits : le caissier consulte, ne crée pas', async () => {
  assert.equal((await appel('GET', '/finance/tiers', 'a', 'cai')).status, 200);
  assert.equal((await appel('POST', '/finance/tiers', 'a', 'cai', { type: 'client', nom: 'X' })).status, 403);
  assert.equal((await appel('GET', '/finance/creances', 'a', 'cai')).status, 200);
});

test('Création : conditions de paiement, NIU contrôlé, doublon de nom signalé', async () => {
  let r = await appel('POST', '/finance/tiers', 'a', 'cpt', { type: 'client', nom: 'Client Etranger', nui: '123' });
  assert.equal(r.status, 201, r.message);
  assert.equal(r.data.nui_format_ok, false);   // signalé, pas bloqué (tiers étrangers)
  assert.equal((await appel('POST', '/finance/tiers', 'a', 'cpt', { type: 'client', nom: 'Copie', nui: '123' })).status, 409);
  r = await appel('POST', '/finance/tiers', 'a', 'cpt', { type: 'client', nom: 'Société Alpha', nui: 'M012345678901A',
    telephone: '699000000', compte_tiers: '411ALPHA', delai_paiement_jours: 45, mode_reglement: 'virement' });
  assert.equal(r.status, 201, r.message);
  assert.equal(r.data.delai_paiement_jours, 45);
  assert.equal(r.data.mode_reglement_libelle, 'Virement');
  assert.equal(r.data.compte_collectif, '411');
  C.a.client = r.data.id;
  r = await appel('POST', '/finance/tiers', 'a', 'cpt', { type: 'fournisseur', nom: 'Fournisseur Beta' });
  assert.equal(r.status, 201, r.message);
  assert.equal(r.data.delai_paiement_jours, 30);
  C.a.fournisseur = r.data.id;
  const d = await appel('POST', '/finance/tiers', 'a', 'cpt', { type: 'fournisseur', nom: '  fournisseur   BETA ' });
  assert.equal(d.status, 409);
  assert.equal(d.brut.doublon?.id ?? d.data?.doublon?.id, C.a.fournisseur);
  const ok = await appel('POST', '/finance/tiers', 'a', 'cpt', { type: 'fournisseur', nom: 'Fournisseur Beta', confirmer_doublon: true });
  assert.equal(ok.status, 201);
  const compte = await appel('POST', '/finance/tiers', 'a', 'cpt', { type: 'client', nom: 'Autre', compte_tiers: '411ALPHA' });
  assert.equal(compte.status, 409);
});

test('Modification : identité et conditions ; la vérification sur pièce reste au contrôle', async () => {
  const r = await appel('PUT', `/finance/tiers/${C.a.client}`, 'a', 'cpt', { nom: 'Société Alpha SA', delai_paiement_jours: 60, verifie: true });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.nom, 'Société Alpha SA');
  assert.equal(r.data.delai_paiement_jours, 60);
  assert.equal(r.data.verifie, false);
  assert.equal((await appel('PUT', `/finance/tiers/${C.a.client}`, 'a', 'cpt', { delai_paiement_jours: 400 })).status, 400);
  assert.equal((await appel('PUT', `/finance/tiers/${C.a.client}`, 'a', 'cai', { delai_paiement_jours: 10 })).status, 403);
});

test('Soldes et relevé : écritures validées, brouillard sur option', async () => {
  for (const c of ['a']) {
    assert.equal((await appel('POST', '/comptabilite/exercices', c, 'cpt', { code: String(AN), date_debut: `${AN}-01-01`, date_fin: `${AN}-12-31` })).status, 201);
    await appel('POST', '/comptabilite/journaux-comptables/initialiser', c, 'cpt');
  }
  const j = await appel('GET', '/comptabilite/journaux-comptables', 'a', 'cpt');
  const od = j.data.find((x) => x.code === 'OD').id;
  const ecr = async (date, lignes, valider = true) => {
    const r = await appel('POST', '/comptabilite/ecritures', 'a', 'cpt', { journal_id: od, date_ecriture: date, libelle: 'Test', lignes });
    assert.equal(r.status, 201, r.message);
    if (valider) assert.equal((await appel('POST', `/comptabilite/ecritures/${r.data.id}/valider`, 'a', 'dir')).status, 200);
  };
  await ecr(`${AN}-02-10`, [{ compte: '6051', debit: 10000 }, { compte: '401', credit: 10000, tiers_id: C.a.fournisseur, libelle: 'Facture eau' }]);
  await ecr(`${AN}-02-15`, [{ compte: '411', debit: 50000, tiers_id: C.a.client, libelle: 'Facture client' }, { compte: '758', credit: 50000 }]);
  await ecr(`${AN}-03-05`, [{ compte: '401', debit: 4000, tiers_id: C.a.fournisseur, libelle: 'Acompte' }, { compte: '521', credit: 4000 }]);
  await ecr(`${AN}-03-20`, [{ compte: '411', debit: 5000, tiers_id: C.a.client }, { compte: '758', credit: 5000 }], false);

  const l = await appel('GET', '/finance/tiers?sens=fournisseur', 'a', 'dir');
  assert.equal(l.status, 200, l.message);
  const f = l.data.tiers.find((t) => t.id === C.a.fournisseur);
  assert.equal(f.dette, '6000.00');
  assert.equal(f.total_achats, '10000.00');
  assert.equal(f.total_paye_fournisseur, '4000.00');
  assert.ok(!l.data.tiers.some((t) => t.id === C.a.client), 'un client n\'apparaît pas parmi les fournisseurs');
  const cl = await appel('GET', `/finance/tiers/${C.a.client}`, 'a', 'dir');
  assert.equal(cl.data.creance, '50000.00');
  assert.equal(cl.data.nb_ecritures_brouillard, 1);
  const clb = await appel('GET', `/finance/tiers/${C.a.client}?brouillard=true`, 'a', 'dir');
  assert.equal(clb.data.creance, '55000.00');

  const r = await appel('GET', `/finance/tiers/${C.a.fournisseur}/releve`, 'a', 'dir');
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.sens, 'dette');
  assert.deepEqual(r.data.lignes.map((x) => x.solde), ['10000.00', '6000.00']);
  assert.equal(r.data.solde, '6000.00');
  assert.match(r.data.lignes[0].numero_affiche, /^OD-\d{4}-\d{5}$/);
  const r2 = await appel('GET', `/finance/tiers/${C.a.fournisseur}/releve?date_du=${AN}-03-01`, 'a', 'dir');
  assert.equal(r2.data.report, '10000.00');
  assert.equal(r2.data.lignes.length, 1);
  assert.equal(r2.data.solde, '6000.00');
});

test('Mouvements de caisse du tiers', async () => {
  await sql(`INSERT INTO rubriques (tenant_id, code, intitule, type) VALUES ($1, 'ACH', 'Achats divers', 'depense')`, [C.a.tenant]);
  await sql(`INSERT INTO journal (tenant_id, date, mois, annee, type_caisse, rubrique_code, intitule, entree, sortie, journal_id, tiers_id, created_by)
             VALUES ($1, $2, 'Avril', $3, 'especes', 'ACH', 'Paiement Beta', 0, 7000, $4, $5, $6)`,
  [C.a.tenant, `${AN}-04-02`, AN, C.a.caisse, C.a.fournisseur, C.a.u.cai.id]);
  const m = await appel('GET', `/finance/tiers/${C.a.fournisseur}/caisse`, 'a', 'cai');
  assert.equal(m.status, 200, m.message);
  assert.equal(m.data.length, 1);
  assert.equal(Number(m.data[0].sortie), 7000);
  const f = await appel('GET', `/finance/tiers/${C.a.fournisseur}`, 'a', 'dir');
  assert.equal(f.data.caisse_paye, '7000.00');
  assert.equal(f.data.caisse_nb, 1);
});

test('États : créances clients et dettes fournisseurs', async () => {
  const c = await appel('GET', '/finance/creances', 'a', 'dir');
  assert.equal(c.status, 200, c.message);
  assert.equal(c.data.total, '50000.00');
  assert.equal(c.data.lignes[0].id, C.a.client);
  assert.equal((await appel('GET', '/finance/creances?brouillard=true', 'a', 'dir')).data.total, '55000.00');
  const d = await appel('GET', '/finance/dettes', 'a', 'dir');
  assert.equal(d.data.total, '6000.00');
  const passe = await appel('GET', `/finance/dettes?date_au=${AN}-02-28`, 'a', 'dir');
  assert.equal(passe.data.total, '10000.00');
});

test('Isolement entre clients', async () => {
  assert.equal((await appel('GET', `/finance/tiers/${C.a.client}`, 'b', 'dir')).status, 404);
  assert.equal((await appel('GET', `/finance/tiers/${C.a.client}/releve`, 'b', 'dir')).status, 404);
  assert.equal((await appel('PUT', `/finance/tiers/${C.a.client}`, 'b', 'cpt', { delai_paiement_jours: 5 })).status, 404);
  assert.equal((await appel('GET', '/finance/tiers', 'b', 'dir')).data.tiers.length, 0);
});
