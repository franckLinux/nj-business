// tests/finance-f2.test.js — NJ FINANCE, lot F2 : socle comptable (migration 075).
//
// Lance le VRAI serveur (index.js) sur une base de TEST, puis appelle l'API.
//   TEST_DATABASE_URL=postgres://…/base_de_test  node --test tests/finance-f2.test.js
// La base doit être migrée jusqu'à 075. Aucune base n'est utilisée sans
// TEST_DATABASE_URL explicite.
//
// Couvre (critères du lot F2) :
//   • droits : caissier sans accès, directeur sans saisie ;
//   • exercice + 12 périodes, chevauchement refusé ; journaux par défaut et
//     journal de trésorerie par caisse, initialisation rejouable ;
//   • écriture déséquilibrée refusée, compte de regroupement refusé, tiers
//     obligatoire sur 40/41, pas d'auto-validation ;
//   • écriture validée intangible (API ET base), numérotation sans trou ;
//   • extourne liée et unique ; balance équilibrée ; grand livre et soldes ;
//   • période verrouillée : plus de saisie, rouverture possible ;
//   • isolement entre clients.
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
let serveur;
const C = { a: {}, b: {} };
const AN = 2026;

const sql = async (texte, params = []) => (await pool.query(texte, params)).rows;
const appel = async (methode, url, client, qui, corps) => {
  const r = await fetch(BASE + url, {
    method: methode,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${C[client].u[qui].token}` },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.data ?? j, message: j.message ?? j.error };
};
const echoue = async (promesse, motif) => {
  await assert.rejects(promesse, (e) => { assert.match(e.message, motif); return true; });
};

const creerClient = async (cle) => {
  const c = C[cle];
  [{ id: c.tenant }] = await sql(
    `INSERT INTO tenants (slug, nom, forme_juridique, initialise_le) VALUES ($1, $2, 'SARL', NOW()) RETURNING id`,
    [`fin-${cle}-${sfx}`, `FIN ${cle} ${sfx}`]);
  [{ id: c.caisse }] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type, date_ouverture, code_journal_compta)
                                  VALUES ($1, 'BQ1', 'Banque principale', 'banque', CURRENT_DATE - 40, 'BQ') RETURNING id`, [c.tenant]);
  [{ id: c.fournisseur }] = await sql(`INSERT INTO registre_tiers (tenant_id, type, nom) VALUES ($1, 'fournisseur', 'Fournisseur test') RETURNING id`, [c.tenant]);
  c.u = {};
  for (const [qui, role] of [['dir', 'directeur'], ['cpt', 'auditeur'], ['cpt2', 'auditeur'], ['cai', 'caissier']]) {
    const username = `${qui}-${cle}-${sfx}`;
    const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif)
                            VALUES ($1, $2, $3, 'x', $4, true) RETURNING id`, [c.tenant, username, `${username}@test.cm`, role]);
    c.u[qui] = { id: u.id, token: jwt.sign({ sub: u.id, username, role, tenantId: c.tenant }, SECRET, { expiresIn: '1h' }) };
  }
};

before(async () => {
  await creerClient('a');
  await creerClient('b');
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
  const cx = await pool.connect();
  try {
    await cx.query('BEGIN');
    await cx.query("SET LOCAL app.finance_maintenance = 'on'");
    await cx.query("SET LOCAL app.journal_maintenance = 'on'");
    const ids = [C.a.tenant, C.b.tenant].filter(Boolean);
    await cx.query('DELETE FROM audit_log WHERE tenant_id = ANY($1::uuid[])', [ids]);
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

const od = (c, lignes, extra = {}) => ({
  journal_id: C[c].od, date_ecriture: `${AN}-03-15`, reference_piece: 'PC-1', libelle: 'Achat d\'eau', lignes, ...extra,
});
const eauBanque = (montant = 10000) => [
  { compte: '6051', debit: montant, libelle: 'Eau' },
  { compte: '521', credit: montant, libelle: 'Paiement' },
];

test('Droits : caissier sans accès, directeur sans saisie', async () => {
  assert.equal((await appel('GET', '/finance/ecritures', 'a', 'cai')).status, 403);
  assert.equal((await appel('POST', '/finance/exercices', 'a', 'cai', { code: 'X' })).status, 403);
  assert.equal((await appel('GET', '/finance/ecritures', 'a', 'dir')).status, 200);
  assert.equal((await appel('POST', '/finance/ecritures', 'a', 'dir', {})).status, 403);
});

test('Exercice : 12 périodes mensuelles, chevauchement refusé', async () => {
  for (const c of ['a', 'b']) {
    const r = await appel('POST', '/finance/exercices', c, 'cpt', { code: String(AN), date_debut: `${AN}-01-01`, date_fin: `${AN}-12-31` });
    assert.equal(r.status, 201, r.message);
    assert.equal(r.data.nb_periodes, 12);
  }
  const chev = await appel('POST', '/finance/exercices', 'a', 'cpt', { code: 'X26', date_debut: `${AN}-06-01`, date_fin: `${AN + 1}-05-31` });
  assert.equal(chev.status, 400);
  assert.match(chev.message, /chevauche/);
  const l = await appel('GET', '/finance/exercices', 'a', 'dir');
  assert.equal(l.data.length, 1);
  assert.equal(l.data[0].periodes.length, 12);
  assert.equal(l.data[0].periodes[1].date_fin, `${AN}-02-28`);
  C.a.exercice = l.data[0].id;
  C.a.periodeMars = l.data[0].periodes[2].id;
  const p = await appel('GET', '/finance/exercices/proposition', 'a', 'cpt');
  assert.equal(p.data.date_debut, `${AN + 1}-01-01`);
});

test('Journaux comptables : défauts + trésorerie par caisse, initialisation rejouable', async () => {
  for (const c of ['a', 'b']) {
    const r = await appel('POST', '/finance/journaux-comptables/initialiser', c, 'cpt');
    assert.equal(r.status, 200, r.message);
    assert.deepEqual(r.data.crees.map((j) => j.code).sort(), ['AC', 'AN', 'BQ', 'INV', 'OD', 'VT']);
    const j = await appel('GET', '/finance/journaux-comptables', c, 'cpt');
    C[c].od = j.data.find((x) => x.code === 'OD').id;
    C[c].an = j.data.find((x) => x.code === 'AN').id;
    const bq = j.data.find((x) => x.code === 'BQ');
    assert.equal(bq.type, 'tresorerie');
    assert.equal(String(bq.journal_tresorerie_id), String(C[c].caisse));
  }
  const encore = await appel('POST', '/finance/journaux-comptables/initialiser', 'a', 'cpt');
  assert.deepEqual(encore.data.crees, []);
});

test('Saisie : comptes de regroupement et tiers manquant refusés ; brouillard déséquilibré accepté, validation refusée', async () => {
  let r = await appel('POST', '/finance/ecritures', 'a', 'cpt', od('a', [{ compte: '60', debit: 100 }, { compte: '521', credit: 100 }]));
  assert.equal(r.status, 400);
  assert.match(r.message, /regroupement/);
  r = await appel('POST', '/finance/ecritures', 'a', 'cpt', od('a', [{ compte: '401', debit: 100 }, { compte: '521', credit: 100 }]));
  assert.equal(r.status, 400);
  assert.match(r.message, /tiers/);
  r = await appel('POST', '/finance/ecritures', 'a', 'cpt', od('a', [{ compte: '6051', debit: 100, credit: 100 }, { compte: '521', credit: 100 }]));
  assert.equal(r.status, 400);
  r = await appel('POST', '/finance/ecritures', 'a', 'cpt', od('a', [{ compte: '6051', debit: 100 }, { compte: '521', credit: 90 }]));
  assert.equal(r.status, 201, r.message);
  C.a.desequilibree = r.data.id;
  const v = await appel('POST', `/finance/ecritures/${r.data.id}/valider`, 'a', 'dir');
  assert.equal(v.status, 400);
  assert.match(v.message, /débit 100\.00 ≠ total crédit 90\.00/);
  const d = await appel('DELETE', `/finance/ecritures/${r.data.id}`, 'a', 'cpt');
  assert.equal(d.status, 200);
});

test('Validation : jamais par l\'auteur, numéro sans trou, puis écriture intangible', async () => {
  const r = await appel('POST', '/finance/ecritures', 'a', 'cpt', od('a', [
    { compte: '6051', debit: 10000, libelle: 'Eau' },
    { compte: '401', credit: 10000, tiers_id: C.a.fournisseur, libelle: 'Fournisseur' },
  ]));
  assert.equal(r.status, 201, r.message);
  const id = r.data.id;
  C.a.ecriture = id;
  const auto = await appel('POST', `/finance/ecritures/${id}/valider`, 'a', 'cpt');
  assert.equal(auto.status, 403);
  const v = await appel('POST', `/finance/ecritures/${id}/valider`, 'a', 'cpt2');
  assert.equal(v.status, 200, v.message);
  assert.equal(v.data.numero, 1);
  const r2 = await appel('POST', '/finance/ecritures', 'a', 'cpt', od('a', eauBanque(5000), { date_ecriture: `${AN}-04-02` }));
  const v2 = await appel('POST', `/finance/ecritures/${r2.data.id}/valider`, 'a', 'dir');
  assert.equal(v2.data.numero, 2);
  C.a.ecriture2 = r2.data.id;
  const l = await appel('GET', `/finance/ecritures/${id}`, 'a', 'dir');
  assert.equal(l.data.numero_affiche, `OD-${AN}-00001`);
  assert.equal(l.data.lignes.length, 2);
  assert.equal(l.data.lignes[1].tiers_nom, 'Fournisseur test');

  assert.equal((await appel('PUT', `/finance/ecritures/${id}`, 'a', 'cpt', od('a', eauBanque()))).status, 409);
  assert.equal((await appel('DELETE', `/finance/ecritures/${id}`, 'a', 'cpt')).status, 409);
  assert.equal((await appel('POST', `/finance/ecritures/${id}/valider`, 'a', 'dir')).status, 409);
  // Garanties de la base, hors API.
  await echoue(pool.query('UPDATE fin_ecritures SET libelle = $2 WHERE id = $1', [id, 'modifié']), /ECRITURE_INTANGIBLE/);
  await echoue(pool.query('UPDATE fin_ecriture_lignes SET debit = 1 WHERE ecriture_id = $1 AND debit > 0', [id]), /ECRITURE_INTANGIBLE/);
  await echoue(pool.query('DELETE FROM fin_ecriture_lignes WHERE ecriture_id = $1', [id]), /ECRITURE_INTANGIBLE/);
  await echoue(pool.query('DELETE FROM fin_ecritures WHERE id = $1', [id]), /ECRITURE_INTANGIBLE/);
  await echoue(pool.query(`INSERT INTO fin_ecriture_lignes (tenant_id, ecriture_id, compte, debit) VALUES ($1, $2, '6051', 5)`, [C.a.tenant, id]), /ECRITURE_INTANGIBLE/);
});

test('Base : un brouillard déséquilibré ne se valide pas, même hors API', async () => {
  const r = await appel('POST', '/finance/ecritures', 'a', 'cpt', od('a', [{ compte: '6051', debit: 100 }, { compte: '521', credit: 90 }]));
  await echoue(pool.query(`UPDATE fin_ecritures SET statut = 'validee', valide_par = $2 WHERE id = $1`, [r.data.id, C.a.u.dir.id]), /ECRITURE_DESEQUILIBREE/);
  await echoue(pool.query(`UPDATE fin_ecritures SET statut = 'validee', valide_par = $2 WHERE id = $1`, [r.data.id, C.a.u.cpt.id]), /DESEQUILIBREE|AUTO_VALIDATION/);
  assert.equal((await appel('DELETE', `/finance/ecritures/${r.data.id}`, 'a', 'cpt')).status, 200);
});

test('Extourne : écriture inverse liée, unique, validée', async () => {
  const sansMotif = await appel('POST', `/finance/ecritures/${C.a.ecriture}/extourner`, 'a', 'dir', { date_ecriture: `${AN}-03-31` });
  assert.equal(sansMotif.status, 400);
  const x = await appel('POST', `/finance/ecritures/${C.a.ecriture}/extourner`, 'a', 'dir', { date_ecriture: `${AN}-03-31`, motif: 'Erreur de compte' });
  assert.equal(x.status, 201, x.message);
  const e = await appel('GET', `/finance/ecritures/${x.data.id}`, 'a', 'dir');
  assert.equal(e.data.statut, 'validee');
  assert.equal(e.data.origine_type, 'extourne');
  assert.equal(e.data.extourne_de.numero_affiche, `OD-${AN}-00001`);
  assert.equal(Number(e.data.lignes[0].credit), 10000);
  assert.equal(Number(e.data.lignes[1].debit), 10000);
  const o = await appel('GET', `/finance/ecritures/${C.a.ecriture}`, 'a', 'dir');
  assert.equal(String(o.data.extournee_par.id), String(x.data.id));
  assert.equal((await appel('POST', `/finance/ecritures/${C.a.ecriture}/extourner`, 'a', 'dir', { date_ecriture: `${AN}-03-31`, motif: 'Encore une fois' })).status, 409);
  assert.equal((await appel('POST', `/finance/ecritures/${x.data.id}/extourner`, 'a', 'dir', { date_ecriture: `${AN}-03-31`, motif: 'Extourne d\'extourne' })).status, 409);
});

test('Balance équilibrée et grand livre cohérent', async () => {
  const b = await appel('GET', `/finance/balance?exercice_id=${C.a.exercice}`, 'a', 'dir');
  assert.equal(b.status, 200, b.message);
  assert.equal(b.data.equilibree, true);
  assert.equal(b.data.totaux.debit, b.data.totaux.credit);
  assert.equal(b.data.totaux.debit, '25000.00');    // 10 000 + extourne 10 000 + 5 000
  const eau = b.data.comptes.find((c) => c.compte === '6051');
  assert.equal(eau.solde_debiteur, '5000.00');      // l'écriture extournée s'annule
  assert.equal(b.data.comptes.find((c) => c.compte === '401').solde_crediteur, '0.00');
  const bavril = await appel('GET', `/finance/balance?exercice_id=${C.a.exercice}&date_du=${AN}-04-01&date_au=${AN}-04-30`, 'a', 'dir');
  const eauAvril = bavril.data.comptes.find((c) => c.compte === '6051');
  assert.equal(eauAvril.report_debit, '10000.00');
  assert.equal(eauAvril.debit, '5000.00');
  const gl = await appel('GET', `/finance/grand-livre?exercice_id=${C.a.exercice}&compte_du=6051&compte_au=6051`, 'a', 'dir');
  assert.equal(gl.status, 200, gl.message);
  assert.equal(gl.data.comptes.length, 1);
  assert.equal(gl.data.comptes[0].lignes.length, 3);
  assert.deepEqual(gl.data.comptes[0].lignes.map((l) => l.solde), ['10000.00', '0.00', '5000.00']);
  assert.equal(gl.data.comptes[0].solde, '5000.00');
});

test('Période verrouillée : plus de saisie ni de validation, rouverture possible', async () => {
  const brouillon = await appel('POST', '/finance/ecritures', 'a', 'cpt', od('a', eauBanque(700)));
  assert.equal(brouillon.status, 201);
  assert.equal((await appel('PUT', `/finance/periodes/${C.a.periodeMars}/statut`, 'a', 'cai', { statut: 'verrouillee' })).status, 403);
  const v = await appel('PUT', `/finance/periodes/${C.a.periodeMars}/statut`, 'a', 'cpt', { statut: 'verrouillee' });
  assert.equal(v.status, 200, v.message);
  const r = await appel('POST', '/finance/ecritures', 'a', 'cpt', od('a', eauBanque(700)));
  assert.equal(r.status, 409);
  assert.match(r.message, /n'est pas ouverte/);
  assert.equal((await appel('POST', `/finance/ecritures/${brouillon.data.id}/valider`, 'a', 'dir')).status, 409);
  assert.equal((await appel('DELETE', `/finance/ecritures/${brouillon.data.id}`, 'a', 'cpt')).status, 409);
  const ouv = await appel('PUT', `/finance/periodes/${C.a.periodeMars}/statut`, 'a', 'dir', { statut: 'ouverte' });
  assert.equal(ouv.status, 200);
  assert.equal((await appel('POST', `/finance/ecritures/${brouillon.data.id}/valider`, 'a', 'dir')).status, 200);
  const hors = await appel('POST', '/finance/ecritures', 'a', 'cpt', od('a', eauBanque(10), { date_ecriture: `${AN - 1}-12-31` }));
  assert.equal(hors.status, 400);
  assert.match(hors.message, /aucun exercice/);
});

test('Isolement : un client ne voit ni n\'utilise les données d\'un autre', async () => {
  assert.equal((await appel('GET', `/finance/ecritures/${C.a.ecriture}`, 'b', 'dir')).status, 404);
  assert.equal((await appel('POST', `/finance/ecritures/${C.a.ecriture}/extourner`, 'b', 'dir', { date_ecriture: `${AN}-03-31`, motif: 'Intrusion' })).status, 404);
  const r = await appel('POST', '/finance/ecritures', 'b', 'cpt', od('b', eauBanque(), { journal_id: C.a.od }));
  assert.equal(r.status, 400);
  const t = await appel('POST', '/finance/ecritures', 'b', 'cpt', od('b', [
    { compte: '6051', debit: 10 }, { compte: '401', credit: 10, tiers_id: C.a.fournisseur },
  ]));
  assert.equal(t.status, 400);
  const lb = await appel('GET', '/finance/ecritures', 'b', 'dir');
  assert.equal(lb.data.total, 0);
});
