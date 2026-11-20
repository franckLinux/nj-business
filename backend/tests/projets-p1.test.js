// tests/projets-p1.test.js — Suivi de la caisse des projets, lot P1 (migration 069).
//
// Lance le VRAI serveur (index.js) sur une base de TEST, puis appelle l'API.
//   TEST_DATABASE_URL=postgres://…/base_de_test  npm run test:projets
// La base doit être migrée jusqu'à 069. Aucune base n'est utilisée sans
// TEST_DATABASE_URL explicite.
//
// Couvre :
//   • PME : rien ne change (pas de nature de recette, pas de projet, contrôle
//     de fonctionnement inchangé) ;
//   • ONG : nature de recette sur les rubriques d'entrée, projet obligatoire
//     sur un financement affecté, lien écriture ↔ projet sans montant et figé ;
//   • ONG : remise de fonds à une activité contrôlée par le budget VALIDÉ du
//     projet, jamais par le budget de fonctionnement, et réciproquement ;
//   • contre-passation, correction en place refusée, garde-fous en base.
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
const C = { ong: {}, pme: {} };   // par client : tenant, journal, utilisateurs, ids

const sql = async (texte, params = []) => (await pool.query(texte, params)).rows;
const appel = async (methode, url, client, qui, corps) => {
  const r = await fetch(BASE + url, {
    method: methode,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${C[client].u[qui].token}` },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.data ?? j, message: j.message ?? j.error, code: j.code ?? j.data?.code };
};
const MOIS = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
const auj = new Date();
const jour = auj.toISOString().slice(0, 10);
const MOIS_COURANT = MOIS[auj.getMonth()];
const AN = auj.getFullYear();
const saisie = (client, qui, extra) => appel('POST', '/journal', client, qui, {
  date: jour, mois: MOIS_COURANT, annee: AN, journal_id: C[client].journal, intitule: 'Test', entree: 0, sortie: 0, ...extra,
});

const creerClient = async (cle, forme) => {
  const c = C[cle];
  [{ id: c.tenant }] = await sql(
    `INSERT INTO tenants (slug, nom, forme_juridique, initialise_le) VALUES ($1, $2, $3, NOW()) RETURNING id`,
    [`proj-${cle}-${sfx}`, `PROJ ${cle} ${sfx}`, forme]);
  await sql(`INSERT INTO rubriques (tenant_id, code, intitule, type) VALUES
             ($1, 'SUB', 'SUBVENTION', 'entree'), ($1, 'COT', 'COTISATIONS', 'entree'), ($1, 'D1', 'FRAIS ACTIVITES', 'depense')`, [c.tenant]);
  [{ id: c.journal }] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type, date_ouverture)
                                   VALUES ($1, 'BQ1', 'Banque', 'banque', CURRENT_DATE - 40) RETURNING id`, [c.tenant]);
  c.u = {};
  for (const [qui, role] of [['dir', 'directeur'], ['cai', 'caissier'], ['cpt', 'auditeur']]) {
    const username = `${qui}-${cle}-${sfx}`;
    const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif)
                            VALUES ($1, $2, $3, 'x', $4, true) RETURNING id`, [c.tenant, username, `${username}@test.cm`, role]);
    c.u[qui] = { id: u.id, token: jwt.sign({ sub: u.id, username, role, tenantId: c.tenant }, SECRET, { expiresIn: '1h' }) };
  }
  const [{ id: rid }] = await sql(`SELECT id FROM rubriques WHERE tenant_id = $1 AND code = 'SUB'`, [c.tenant]);
  c.rubSub = rid;
};
const solde = async (cle) => {
  const [r] = await sql(`SELECT COALESCE(SUM(entree - sortie), 0)::numeric AS s FROM journal WHERE journal_id = $1`, [C[cle].journal]);
  return Number(r.s);
};

before(async () => {
  await creerClient('ong', 'ONG');
  await creerClient('pme', 'SARL');
  // Projet structuré de l'ONG : deux activités, responsable désigné.
  const o = C.ong;
  [{ id: o.projet }] = await sql(`INSERT INTO activites (tenant_id, nom, type, chef_projet_id) VALUES ($1, 'Projet Eau', 'projet', $2) RETURNING id`,
    [o.tenant, o.u.cai.id]);
  [{ id: o.act1 }] = await sql(`INSERT INTO activites (tenant_id, nom, type, projet_id, responsable_id) VALUES ($1, 'Forages', 'activite', $2, $3) RETURNING id`,
    [o.tenant, o.projet, o.u.cai.id]);
  [{ id: o.act2 }] = await sql(`INSERT INTO activites (tenant_id, nom, type, projet_id) VALUES ($1, 'Formation', 'activite', $2) RETURNING id`,
    [o.tenant, o.projet]);
  [{ id: o.actFonct }] = await sql(`INSERT INTO activites (tenant_id, nom, type) VALUES ($1, 'Secrétariat', 'activite') RETURNING id`, [o.tenant]);
  // Activité de la PME (usage actuel, inchangé).
  [{ id: C.pme.act }] = await sql(`INSERT INTO activites (tenant_id, nom, type) VALUES ($1, 'Chantier A', 'projet') RETURNING id`, [C.pme.tenant]);

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
  // Nettoyage : les écritures sont intangibles, on passe en maintenance le
  // temps d'une transaction (uniquement sur la base de test).
  const cx = await pool.connect();
  try {
    await cx.query('BEGIN');
    await cx.query("SET LOCAL app.journal_maintenance = 'on'");
    const ids = [C.ong.tenant, C.pme.tenant].filter(Boolean);
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

// ── PME : rien ne change ────────────────────────────────────────────────────
test('PME : contexte de saisie sans projets', async () => {
  const r = await appel('GET', '/projets/saisie', 'pme', 'cai');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { ong: false });
});

test('PME : la nature de recette est refusée, les rubriques sont servies comme avant', async () => {
  const r = await appel('PUT', `/rubriques/${C.pme.rubSub}`, 'pme', 'dir', { intitule: 'SUBVENTION', nature_recette: 'subvention' });
  assert.equal(r.status, 400);
  assert.match(r.message, /réservée aux ONG/);
  const l = await appel('GET', '/rubriques', 'pme', 'cai');
  assert.equal(l.status, 200);
  assert.equal(l.data.entrees.find((x) => x.code === 'SUB').nature_recette, undefined);
});

test('PME : un projet bénéficiaire est refusé sur une entrée', async () => {
  const r = await saisie('pme', 'cai', { rubrique_code: 'SUB', entree: 1000, projet_id: C.pme.act });
  assert.equal(r.status, 400);
  assert.equal(r.code, 'PROJETS_RESERVES_ONG');
});

test('PME : une sortie rattachée à un « projet » reste soumise au budget de fonctionnement', async () => {
  assert.equal((await saisie('pme', 'cai', { rubrique_code: 'COT', entree: 50000 })).status, 201);
  const r = await saisie('pme', 'cai', { rubrique_code: 'D1', sortie: 1000, activite_id: C.pme.act });
  assert.equal(r.status, 200);
  assert.equal(r.data.en_attente, true);   // mois non validé → attente, comme avant
});

// ── ONG : nature des recettes ───────────────────────────────────────────────
test('ONG : seul qui gère les rubriques fixe la nature ; elle est servie avec la rubrique', async () => {
  const refus = await appel('PUT', `/rubriques/${C.ong.rubSub}`, 'ong', 'dir', { intitule: 'SUBVENTION', nature_recette: 'inconnue' });
  assert.equal(refus.status, 400);
  const ok = await appel('PUT', `/rubriques/${C.ong.rubSub}`, 'ong', 'dir', { intitule: 'SUBVENTION', nature_recette: 'subvention' });
  assert.equal(ok.status, 200, ok.message);
  assert.equal(ok.data.nature_recette, 'subvention');
  const l = await appel('GET', '/rubriques', 'ong', 'cai');
  assert.equal(l.data.entrees.find((x) => x.code === 'SUB').nature_recette, 'subvention');
  // Une rubrique de dépense n'a pas de nature (contrainte en base aussi).
  await assert.rejects(sql(`UPDATE rubriques SET nature_recette = 'subvention' WHERE tenant_id = $1 AND code = 'D1'`, [C.ong.tenant]));
});

test('ONG : nouvelle rubrique de financement créée avec sa nature', async () => {
  const r = await appel('POST', '/rubriques', 'ong', 'dir', { code: 'DON', intitule: 'DONS AFFECTES', type: 'entree', nature_recette: 'don_affecte' });
  assert.equal(r.status, 201, r.message);
  assert.equal(r.data.nature_recette, 'don_affecte');
});

// ── ONG : financement reçu ──────────────────────────────────────────────────
test('ONG : financement affecté sans projet → refusé, rien n\'est écrit', async () => {
  const avant = await solde('ong');
  const r = await saisie('ong', 'cai', { rubrique_code: 'SUB', entree: 500000 });
  assert.equal(r.status, 400);
  assert.equal(r.code, 'PROJET_OBLIGATOIRE');
  assert.equal(await solde('ong'), avant);
});

test('ONG : financement imputé au projet — lien sans montant, consultable', async () => {
  const r = await saisie('ong', 'cai', { rubrique_code: 'SUB', entree: 500000, projet_id: C.ong.projet, reference_financement: 'AVIS 2026-118' });
  assert.equal(r.status, 201, r.message);
  assert.equal(r.data.projet.projet_id, C.ong.projet);
  C.ong.ecritureFin = r.data.id;
  const [imp] = await sql('SELECT * FROM journal_imputations_projet WHERE journal_id = $1', [r.data.id]);
  assert.equal(imp.projet_id, C.ong.projet);
  assert.equal(imp.nature_recette, 'subvention');
  assert.equal(imp.reference_financement, 'AVIS 2026-118');
  assert.equal(imp.impute_par, C.ong.u.cai.id);
  assert.equal('montant' in imp, false);
});

test('ONG : recette non affectée → pas de projet, et refus si on en donne un', async () => {
  assert.equal((await saisie('ong', 'cai', { rubrique_code: 'COT', entree: 20000 })).status, 201);
  const r = await saisie('ong', 'cai', { rubrique_code: 'COT', entree: 20000, projet_id: C.ong.projet });
  assert.equal(r.status, 400);
  assert.equal(r.code, 'PROJET_NON_APPLICABLE');
});

test('ONG : un financement ne se rattache pas à une activité du projet', async () => {
  const r = await saisie('ong', 'cai', { rubrique_code: 'SUB', entree: 1000, projet_id: C.ong.projet, activite_id: C.ong.act1 });
  assert.equal(r.status, 400);
  assert.equal(r.code, 'ACTIVITE_SUR_FINANCEMENT');
});

test('ONG : le lien écriture ↔ projet est figé en base', async () => {
  await assert.rejects(sql('UPDATE journal_imputations_projet SET projet_id = projet_id WHERE journal_id = $1', [C.ong.ecritureFin]), /IMPUTATION_INTANGIBLE/);
  await assert.rejects(sql('DELETE FROM journal_imputations_projet WHERE journal_id = $1', [C.ong.ecritureFin]), /IMPUTATION_INTANGIBLE/);
  // Une même écriture ne peut pas être imputée deux fois.
  await assert.rejects(sql(`INSERT INTO journal_imputations_projet (tenant_id, journal_id, projet_id, nature_recette)
                            VALUES ($1, $2, $3, 'subvention')`, [C.ong.tenant, C.ong.ecritureFin, C.ong.projet]));
});

// ── ONG : remise de fonds aux activités ─────────────────────────────────────
test('ONG : remise de fonds refusée tant que le budget du projet n\'est pas validé', async () => {
  const r = await saisie('ong', 'cai', { rubrique_code: 'D1', sortie: 100000, activite_id: C.ong.act1, beneficiaire: 'Resp. forages' });
  assert.equal(r.status, 409);
  assert.equal(r.code, 'BUDGET_PROJET_NON_VALIDE');
  const [{ n }] = await sql('SELECT COUNT(*)::int AS n FROM mouvements_attente WHERE tenant_id = $1', [C.ong.tenant]);
  assert.equal(n, 0);   // pas de mise en attente : le budget du projet décide
});

test('ONG : budget figé une fois soumis ; validé, il ouvre les remises de fonds', async () => {
  const o = C.ong;
  const [b] = await sql(`INSERT INTO projet_budgets (tenant_id, projet_id, cree_par) VALUES ($1, $2, $3) RETURNING id`, [o.tenant, o.projet, o.u.cai.id]);
  o.budget = b.id;
  await sql(`INSERT INTO projet_budget_lignes (tenant_id, budget_id, activite_id, montant) VALUES ($1, $2, $3, 300000), ($1, $2, $4, 0)`,
    [o.tenant, b.id, o.act1, o.act2]);
  // Une activité étrangère au projet ne peut pas entrer dans son budget.
  await assert.rejects(sql(`INSERT INTO projet_budget_lignes (tenant_id, budget_id, activite_id, montant) VALUES ($1, $2, $3, 1)`,
    [o.tenant, b.id, o.actFonct]), /BUDGET_INVALIDE/);
  await sql(`UPDATE projet_budgets SET statut = 'soumis', soumis_par = $2, soumis_le = NOW() WHERE id = $1`, [b.id, o.u.cai.id]);
  await assert.rejects(sql('UPDATE projet_budget_lignes SET montant = 900000 WHERE budget_id = $1', [b.id]), /BUDGET_FIGE/);
  await sql(`UPDATE projet_budgets SET statut = 'valide', decide_par = $2, decide_le = NOW() WHERE id = $1`, [b.id, o.u.dir.id]);
  await assert.rejects(sql('DELETE FROM projet_budgets WHERE id = $1', [b.id]), /BUDGET_FIGE/);
  await assert.rejects(sql(`UPDATE projet_budgets SET statut = 'brouillon' WHERE id = $1`, [b.id]), /BUDGET_FIGE/);

  const ctx = await appel('GET', '/projets/saisie', 'ong', 'cai');
  assert.equal(ctx.data.ong, true);
  const p = ctx.data.projets.find((x) => x.id === o.projet);
  assert.equal(p.budget_valide, true);
  assert.equal(p.activites.find((a) => a.id === o.act1).reste, 300000);
});

test('ONG : remise de fonds dans le budget du projet, sans budget de fonctionnement validé', async () => {
  const r = await saisie('ong', 'cai', { rubrique_code: 'D1', sortie: 200000, activite_id: C.ong.act1, beneficiaire: 'Resp. forages' });
  assert.equal(r.status, 201, r.message);
  assert.equal(r.data.en_attente, undefined);
  assert.equal(r.data.projet.reste, 100000);
  C.ong.remise = r.data.id;
});

test('ONG : dépassement du budget de l\'activité → refusé, rien n\'est écrit', async () => {
  const avant = await solde('ong');
  const r = await saisie('ong', 'cai', { rubrique_code: 'D1', sortie: 150000, activite_id: C.ong.act1 });
  assert.equal(r.status, 409);
  assert.equal(r.code, 'DEPASSEMENT_BUDGET_PROJET');
  assert.equal(await solde('ong'), avant);
  const sansBudget = await saisie('ong', 'cai', { rubrique_code: 'D1', sortie: 1000, activite_id: C.ong.act2 });
  assert.equal(sansBudget.status, 409);
  assert.equal(sansBudget.code, 'ACTIVITE_SANS_BUDGET');
});

test('ONG : remise GLOBALE au projet (lot P4), plafonnée par le budget total', async () => {
  const r = await saisie('ong', 'cai', { rubrique_code: 'D1', sortie: 1000, activite_id: C.ong.projet });
  assert.equal(r.status, 201, r.message);
  assert.equal(r.data.projet.global, true);
  assert.equal(r.data.projet.reste, 300000 - 200000 - 1000);
  const trop = await saisie('ong', 'cai', { rubrique_code: 'D1', sortie: 100000, activite_id: C.ong.projet });
  assert.equal(trop.status, 409);
  assert.equal(trop.code, 'DEPASSEMENT_BUDGET_PROJET');
});

test('ONG : les remises de projet ne pèsent pas sur le budget de fonctionnement', async () => {
  const o = C.ong;
  // Budget de fonctionnement validé : D1 = 50 000 pour le mois.
  await sql(`INSERT INTO appel_fonds (tenant_id, journal_id, mois_cible, annee_cible, rubrique_code, intitule, montant_prevu, montant_approuve, statut)
             VALUES ($1, $2, $3, $4, 'D1', 'FRAIS ACTIVITES', 50000, 50000, 'approuve')`, [o.tenant, o.journal, MOIS_COURANT, AN]);
  // 200 000 déjà remis sur D1 au projet : une sortie de fonctionnement de 40 000 passe.
  const r = await saisie('ong', 'cai', { rubrique_code: 'D1', sortie: 40000, activite_id: o.actFonct });
  assert.equal(r.status, 201, r.message);
  assert.equal(r.data.en_attente, undefined);
  // Le disponible de fonctionnement affiché ignore aussi les remises de projet.
  const d = await appel('GET', `/journal/disponible?date=${jour}&mois=${MOIS_COURANT}&annee=${AN}&rubrique_code=D1&journal_id=${o.journal}`, 'ong', 'cai');
  assert.equal(d.status, 200);
  assert.equal(d.data.consomme, 40000);
  assert.equal(d.data.reste, 10000);
  // Contexte du pré-contrôle hors ligne : même exclusion.
  const cc = await appel('GET', `/journal/controle-context?journal_id=${o.journal}&mois=${MOIS_COURANT}&annee=${AN}`, 'ong', 'cai');
  assert.equal(cc.status, 200);
  assert.equal(cc.data.sorties_by_rubrique.D1, 40000);
  assert.equal(cc.data.sorties_journal, 40000);
  // Au-delà de 50 000 de fonctionnement : attente du directeur, comme avant.
  const att = await saisie('ong', 'cai', { rubrique_code: 'D1', sortie: 20000 });
  assert.equal(att.status, 200);
  assert.equal(att.data.en_attente, true);
});

test('ONG : le rattachement à une activité de projet ne se corrige pas en place', async () => {
  const r = await appel('PUT', `/journal/${C.ong.remise}`, 'ong', 'dir', { activite_id: C.ong.actFonct });
  assert.equal(r.status, 409);
  assert.equal(r.code, 'ANNULATION_REQUISE');
  // Les descriptifs, eux, se corrigent toujours.
  const ok = await appel('PUT', `/journal/${C.ong.remise}`, 'ong', 'dir', { objet: 'Avance forages lot 1' });
  assert.equal(ok.status, 200, ok.message);
});

test('ONG : la contre-passation rend le budget de l\'activité', async () => {
  const a = await appel('POST', `/journal/${C.ong.remise}/annulation`, 'ong', 'dir', { motif: 'Erreur de montant' });
  assert.equal(a.status, 201, a.message);
  const ctx = await appel('GET', '/projets/saisie', 'ong', 'cai');
  const act = ctx.data.projets.find((x) => x.id === C.ong.projet).activites.find((x) => x.id === C.ong.act1);
  assert.equal(act.consomme, 0);
  assert.equal(act.reste, 300000);
  const r = await saisie('ong', 'cai', { rubrique_code: 'D1', sortie: 250000, activite_id: C.ong.act1 });
  assert.equal(r.status, 201, r.message);
});

test('ONG devenue PME : plus aucun rattachement de recette à un projet, rien n\'est supprimé', async () => {
  await sql(`UPDATE tenants SET forme_juridique = 'SARL' WHERE id = $1`, [C.ong.tenant]);
  const r = await saisie('ong', 'cai', { rubrique_code: 'SUB', entree: 1000, projet_id: C.ong.projet });
  assert.equal(r.status, 400);
  assert.equal(r.code, 'PROJETS_RESERVES_ONG');
  const [{ n }] = await sql('SELECT COUNT(*)::int AS n FROM journal_imputations_projet WHERE tenant_id = $1', [C.ong.tenant]);
  assert.equal(n, 1);
  assert.deepEqual((await appel('GET', '/projets/saisie', 'ong', 'cai')).data, { ong: false });
  await sql(`UPDATE tenants SET forme_juridique = 'ONG' WHERE id = $1`, [C.ong.tenant]);
});
