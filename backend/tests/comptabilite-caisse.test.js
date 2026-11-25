// tests/comptabilite-caisse.test.js — NJ FINANCE lot F3 : écritures produites par la caisse (077).
//
// Lance le VRAI serveur (index.js) sur une base de TEST, puis appelle l'API.
//   TEST_DATABASE_URL=postgres://…/base_de_test  node --test tests/comptabilite-caisse.test.js
// La base doit être migrée jusqu'à 077. Aucune base n'est utilisée sans
// TEST_DATABASE_URL explicite.
//
// Couvre :
//   • sans mouvement : rien n'est créé ;
//   • premier passage : exercice de l'année et journaux créés, une écriture par
//     mouvement (encaissement, décaissement, virement interne) au brouillard ;
//   • anomalies (compte manquant, tiers manquant) listées, sans bloquer ;
//     corrigées, elles se comptabilisent au passage suivant ;
//   • mouvements antérieurs à l'exercice non repris ;
//   • arrêté validé → écritures validées et numérotées, par le directeur ;
//   • mouvement modifié après validation (activité) → extourne + nouvelle écriture ;
//   • contre-passation → écriture inverse ; passage rejouable sans effet ;
//   • contrôle : mouvement du compte de trésorerie = mouvement de la caisse, par mois ;
//     ouverture (report de la caisse) comparée aux à-nouveaux ;
//   • balance équilibrée ; le journal de caisse n'est jamais modifié.
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
const PORT = 6600 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}/api`;
const sfx = crypto.randomBytes(3).toString('hex');
const pool = new Pool({ connectionString: DB });
const AN = new Date().getFullYear();
const MOIS = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
let serveur;
const C = { u: {}, j: {}, l: {} };

const sql = async (texte, params = []) => (await pool.query(texte, params)).rows;
const appel = async (methode, url, qui, corps) => {
  const r = await fetch(BASE + url, {
    method: methode,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${C.u[qui].token}` },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.data ?? j, message: j.message ?? j.error };
};
const etat = async () => {
  const r = await appel('GET', '/comptabilite/caisse/etat', 'cpt');
  assert.equal(r.status, 200, r.message);
  return r.data;
};
const mouvement = async (cle, { journal, date, rubrique, entree = 0, sortie = 0, intitule = cle, tiers = null, annule = null }) => {
  const [r] = await sql(
    `INSERT INTO journal (tenant_id, date, mois, annee, type_caisse, rubrique_code, intitule, entree, sortie, journal_id, tiers_id, annulation_de_id, created_by)
     VALUES ($1, $2, $3, $4, 'especes', $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [C.tenant, date, MOIS[Number(date.slice(5, 7)) - 1], Number(date.slice(0, 4)), rubrique, intitule, entree, sortie, C.j[journal], tiers, annule, C.u.cai.id]);
  C.l[cle] = r.id;
  return r.id;
};
const ecritureDe = async (cle) => (await sql(
  `SELECT e.*, (SELECT json_agg(l ORDER BY l.ordre) FROM fin_ecriture_lignes l WHERE l.ecriture_id = e.id) AS lignes
     FROM fin_ecritures e WHERE e.origine_type = 'journal' AND e.origine_id = $1 AND e.extournee_par_id IS NULL`, [C.l[cle]]))[0];

before(async () => {
  [{ id: C.tenant }] = await sql(
    `INSERT INTO tenants (slug, nom, forme_juridique, initialise_le, compte_virements) VALUES ($1, $2, 'SARL', NOW(), '585') RETURNING id`,
    [`cai-${sfx}`, `CAISSE ${sfx}`]);
  for (const m of ['caisse', 'comptabilite']) {
    await sql('INSERT INTO tenant_modules (tenant_id, module_code, actif) VALUES ($1, $2, true) ON CONFLICT DO NOTHING', [C.tenant, m]);
  }
  for (const [code, nom, type, compte] of [['CA1', 'Caisse siège', 'caisse', '5711'], ['BQ1', 'Banque', 'banque', '521']]) {
    [{ id: C.j[code] }] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type, date_ouverture, compte_tresorerie)
                                     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [C.tenant, code, nom, type, `${AN - 1}-12-01`, compte]);
  }
  for (const [qui, role] of [['dir', 'directeur'], ['cpt', 'auditeur'], ['cai', 'caissier']]) {
    const username = `${qui}-cai-${sfx}`;
    const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif)
                            VALUES ($1, $2, $3, 'x', $4, true) RETURNING id`, [C.tenant, username, `${username}@test.cm`, role]);
    for (const m of ['caisse', 'comptabilite']) {
      await sql('INSERT INTO user_modules (user_id, module_code, tenant_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [u.id, m, C.tenant]);
    }
    C.u[qui] = { id: u.id, token: jwt.sign({ sub: u.id, username, role, tenantId: C.tenant }, SECRET, { expiresIn: '1h' }) };
  }
  [{ id: C.fournisseur }] = await sql(`INSERT INTO registre_tiers (tenant_id, type, nom) VALUES ($1, 'fournisseur', 'Fournisseur caisse') RETURNING id`, [C.tenant]);
  [{ id: C.activite }] = await sql(`INSERT INTO activites (tenant_id, nom, type) VALUES ($1, 'Activité A', 'activite') RETURNING id`, [C.tenant]);
  C.r = {};
  for (const [code, type, compte, vir] of [['DON', 'entree', '758', false], ['EAU', 'depense', '6051', false], ['FOUR', 'depense', '401', false],
    ['SANSEQ', 'depense', null, false], ['VIR', 'depense', null, true]]) {
    const [r] = await sql(`INSERT INTO rubriques (tenant_id, code, intitule, type, est_virement_interne) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [C.tenant, code, `Rubrique ${code}`, type, vir]);
    C.r[code] = r.id;
    if (compte) await sql(`INSERT INTO equivalences_comptables (tenant_id, rubrique_id, compte, statut) VALUES ($1, $2, $3, 'valide')`, [C.tenant, r.id, compte]);
  }
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
    await cx.query('DELETE FROM audit_log WHERE tenant_id = $1', [C.tenant]);
    await cx.query('DELETE FROM user_modules WHERE tenant_id = $1', [C.tenant]);
    await cx.query('DELETE FROM tenant_modules WHERE tenant_id = $1', [C.tenant]);
    await cx.query('UPDATE fin_ecritures SET extournee_par_id = NULL WHERE tenant_id = $1', [C.tenant]);
    await cx.query('DELETE FROM tenants WHERE id = $1', [C.tenant]);
    await cx.query('COMMIT');
  } catch (e) {
    await cx.query('ROLLBACK');
    console.error('Nettoyage de la base de test incomplet :', e.message);
  } finally {
    cx.release();
  }
  await pool.end();
});

test('Sans mouvement de caisse : rien n\'est créé', async () => {
  const e = await etat();
  assert.equal(e.perimetre.mouvements, 0);
  assert.equal((await sql('SELECT count(*)::int AS n FROM fin_exercices WHERE tenant_id = $1', [C.tenant]))[0].n, 0);
  assert.equal((await sql('SELECT count(*)::int AS n FROM fin_journaux WHERE tenant_id = $1', [C.tenant]))[0].n, 0);
});

test('Premier passage : exercice et journaux créés, une écriture par mouvement, anomalies listées', async () => {
  await mouvement('ancien', { journal: 'CA1', date: `${AN - 1}-12-20`, rubrique: 'EAU', sortie: 1000 });
  await mouvement('don', { journal: 'BQ1', date: `${AN}-03-02`, rubrique: 'DON', entree: 100000, intitule: 'Don reçu' });
  await mouvement('eau', { journal: 'CA1', date: `${AN}-03-05`, rubrique: 'EAU', sortie: 25000 });
  await mouvement('sanseq', { journal: 'CA1', date: `${AN}-03-06`, rubrique: 'SANSEQ', sortie: 5000 });
  await mouvement('four', { journal: 'BQ1', date: `${AN}-03-07`, rubrique: 'FOUR', sortie: 10000 });
  await mouvement('virS', { journal: 'BQ1', date: `${AN}-03-08`, rubrique: 'VIR', sortie: 30000 });
  await mouvement('virE', { journal: 'CA1', date: `${AN}-03-08`, rubrique: 'VIR', entree: 30000 });
  const avant = await sql('SELECT id, entree, sortie, updated_at FROM journal WHERE tenant_id = $1 ORDER BY id', [C.tenant]);

  const e = await etat();
  assert.deepEqual(e.synchronisation.exercices_crees, [String(AN)]);
  assert.deepEqual(e.synchronisation.journaux_crees.sort(), ['AC', 'AN', 'BQ1', 'CA1', 'INV', 'OD', 'VT']);
  assert.equal(e.synchronisation.crees, 4);
  assert.equal(e.perimetre.anterieurs_non_repris, 1);
  assert.equal(e.ecritures.brouillard, 4);
  assert.equal(e.anomalies.length, 2);
  assert.match(e.anomalies.find((a) => String(a.mouvement_id) === String(C.l.sanseq)).motif, /compte validé de la rubrique SANSEQ/);
  assert.match(e.anomalies.find((a) => String(a.mouvement_id) === String(C.l.four)).motif, /exige un tiers/);

  const don = await ecritureDe('don');
  assert.equal(don.statut, 'brouillard');
  assert.deepEqual(don.lignes.map((l) => [l.compte, Number(l.debit), Number(l.credit)]), [['521', 100000, 0], ['758', 0, 100000]]);
  const eau = await ecritureDe('eau');
  assert.deepEqual(eau.lignes.map((l) => [l.compte, Number(l.debit), Number(l.credit)]), [['6051', 25000, 0], ['5711', 0, 25000]]);
  const virS = await ecritureDe('virS');
  assert.deepEqual(virS.lignes.map((l) => l.compte), ['585', '521']);
  const [{ n: ecrituresAncien }] = await sql(`SELECT count(*)::int AS n FROM fin_ecritures WHERE origine_type = 'journal' AND origine_id = $1`, [C.l.ancien]);
  assert.equal(ecrituresAncien, 0);

  // Contrôle de trésorerie de mars : la caisse a 5 000 de sortie non comptabilisée.
  const ca = e.tresorerie.find((t) => t.compte === '5711' && t.mois === `${AN}-03`);
  assert.equal(ca.caisse, '0.00');           // −25 000 − 5 000 + 30 000
  assert.equal(ca.compta, '5000.00');        // −25 000 + 30 000
  assert.equal(ca.ecart, '-5000.00');
  assert.equal(ca.concorde, false);
  // Le journal de caisse n'a pas bougé.
  assert.deepEqual(await sql('SELECT id, entree, sortie, updated_at FROM journal WHERE tenant_id = $1 ORDER BY id', [C.tenant]), avant);
});

test('Anomalies levées : comptabilisées au passage suivant, trésorerie concordante', async () => {
  await sql(`INSERT INTO equivalences_comptables (tenant_id, rubrique_id, compte, statut) VALUES ($1, $2, '6051', 'valide')`, [C.tenant, C.r.SANSEQ]);
  await sql('UPDATE journal SET tiers_id = $2 WHERE id = $1', [C.l.four, C.fournisseur]);
  const e = await etat();
  assert.equal(e.anomalies.length, 0);
  assert.equal(e.synchronisation.crees, 2);
  assert.ok(e.tresorerie.every((t) => t.concorde), JSON.stringify(e.tresorerie));
  const four = await ecritureDe('four');
  assert.equal(String(four.lignes[0].tiers_id), String(C.fournisseur));
});

test('Arrêté validé : écritures du mois validées et numérotées par le directeur', async () => {
  await sql(`INSERT INTO controles_arrets (tenant_id, journal_id, mois, annee, statut, valide_par, valide_le)
             VALUES ($1, $2, 'Mars', $3, 'validee', $4, NOW())`, [C.tenant, C.j.CA1, AN, C.u.dir.id]);
  const e = await etat();
  assert.equal(e.synchronisation.validees, 3);    // eau, sanseq, virE (caisse CA1)
  const eau = await ecritureDe('eau');
  assert.equal(eau.statut, 'validee');
  assert.equal(eau.valide_par, C.u.dir.id);
  assert.ok(eau.numero >= 1);
  assert.equal((await ecritureDe('don')).statut, 'brouillard');   // banque non arrêtée
});

test('Mouvement modifié après validation : extourne puis nouvelle écriture validée', async () => {
  const ancienne = await ecritureDe('eau');
  await sql('UPDATE journal SET activite_id = $2 WHERE id = $1', [C.l.eau, C.activite]);
  const e = await etat();
  assert.equal(e.synchronisation.extournees, 1);
  const [orig] = await sql('SELECT extournee_par_id FROM fin_ecritures WHERE id = $1', [ancienne.id]);
  assert.ok(orig.extournee_par_id);
  const [x] = await sql('SELECT origine_type, statut, motif_extourne FROM fin_ecritures WHERE id = $1', [orig.extournee_par_id]);
  assert.equal(x.origine_type, 'extourne');
  assert.equal(x.statut, 'validee');
  const nouvelle = await ecritureDe('eau');
  assert.notEqual(String(nouvelle.id), String(ancienne.id));
  assert.equal(nouvelle.statut, 'validee');
  assert.equal(String(nouvelle.lignes[0].activite_id), String(C.activite));
  // Le libellé seul ne refait pas l'écriture.
  await sql('UPDATE journal SET intitule = $2 WHERE id = $1', [C.l.eau, 'Eau — facture de mars']);
  const e2 = await etat();
  assert.equal(e2.synchronisation.extournees, 0);
  assert.equal(e2.synchronisation.crees + e2.synchronisation.refaites, 0);
});

test('Contre-passation : écriture inverse ; passage rejouable sans effet', async () => {
  await mouvement('annulDon', { journal: 'BQ1', date: `${AN}-03-20`, rubrique: 'DON', entree: -100000, annule: C.l.don, intitule: 'Annulation don' });
  const e = await etat();
  assert.equal(e.synchronisation.crees, 1);
  const a = await ecritureDe('annulDon');
  assert.deepEqual(a.lignes.map((l) => [l.compte, Number(l.debit), Number(l.credit)]), [['758', 100000, 0], ['521', 0, 100000]]);
  const e2 = await etat();
  assert.equal(e2.synchronisation.crees + e2.synchronisation.refaites + e2.synchronisation.extournees + e2.synchronisation.validees, 0);
  assert.ok(e2.tresorerie.every((t) => t.concorde));
});

test('Ouverture : report de la caisse comparé aux à-nouveaux', async () => {
  await sql(`INSERT INTO ran (tenant_id, mois, annee, type_caisse, montant, journal_id) VALUES ($1, 'Janvier', $2, 'especes', 50000, $3)`, [C.tenant, AN, C.j.CA1]);
  const e = await etat();
  const o = e.ouvertures.find((x) => x.compte === '5711');
  // Report de la caisse au 1er janvier : ouverture 50 000 et mouvement de décembre (− 1 000).
  assert.equal(o.ran, '49000.00');
  assert.equal(o.a_nouveaux, '0.00');
  assert.equal(o.concorde, false);
});

test('Balance : équilibrée, comptes de trésorerie = caisse', async () => {
  const [{ id: ex }] = await sql('SELECT id FROM fin_exercices WHERE tenant_id = $1', [C.tenant]);
  const b = await appel('GET', `/comptabilite/balance?exercice_id=${ex}&brouillard=true`, 'cpt');
  assert.equal(b.status, 200, b.message);
  assert.equal(b.data.equilibree, true);
  const c = (compte) => b.data.comptes.find((x) => x.compte === compte);
  assert.equal(c('6051').solde_debiteur, '30000.00');    // eau 25 000 + 5 000
  assert.equal(c('758').solde_crediteur, '0.00');        // don annulé
  assert.equal(c('585').solde_debiteur, '0.00');         // virement soldé
  assert.equal(c('5711').solde_debiteur, '0.00');        // −25 000 − 5 000 + 30 000
  assert.equal(c('521').solde_crediteur, '40000.00');    // +100 000 − 10 000 − 30 000 − 100 000
});
