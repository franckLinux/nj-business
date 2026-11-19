// tests/projets-p2.test.js — Menu « Projets » des ONG / associations, lot P2.
//
// Lance le VRAI serveur (index.js) sur une base de TEST, puis appelle l'API.
//   TEST_DATABASE_URL=postgres://…/base_de_test  npm run test:projets
// La base doit être migrée jusqu'à 069.
//
// Couvre : réservé aux ONG ; périmètre (direction, comptable, chef de projet,
// responsable d'activité, utilisateur non désigné) ; projets et activités ;
// budget chargé par le chef de projet, soumis, rejeté avec motif, corrigé,
// validé par le directeur ; remise de fonds ouverte après validation ; budget
// révisé jamais inférieur aux fonds déjà remis ; versions archivées.
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
const C = { ong: {}, pme: {} };
const S = {};   // identifiants créés en cours de route

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
const ong = (m, url, qui, corps) => appel(m, url, 'ong', qui, corps);
const MOIS = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
const auj = new Date();
const saisie = (qui, extra) => ong('POST', '/journal', qui, {
  date: auj.toISOString().slice(0, 10), mois: MOIS[auj.getMonth()], annee: auj.getFullYear(), journal_id: C.ong.journal,
  intitule: 'Test', entree: 0, sortie: 0, ...extra,
});

const creerClient = async (cle, forme, utilisateurs) => {
  const c = C[cle];
  [{ id: c.tenant }] = await sql(
    `INSERT INTO tenants (slug, nom, forme_juridique, initialise_le) VALUES ($1, $2, $3, NOW()) RETURNING id`,
    [`proj2-${cle}-${sfx}`, `PROJ2 ${cle} ${sfx}`, forme]);
  await sql(`INSERT INTO rubriques (tenant_id, code, intitule, type, nature_recette) VALUES
             ($1, 'SUB', 'SUBVENTION', 'entree', $2), ($1, 'D1', 'FRAIS ACTIVITES', 'depense', NULL)`,
  [c.tenant, forme === 'ONG' ? 'subvention' : null]);
  [{ id: c.journal }] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type, date_ouverture)
                                   VALUES ($1, 'BQ1', 'Banque', 'banque', CURRENT_DATE - 40) RETURNING id`, [c.tenant]);
  c.u = {};
  for (const [qui, role] of utilisateurs) {
    const username = `${qui}-${cle}-${sfx}`;
    const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif)
                            VALUES ($1, $2, $3, 'x', $4, true) RETURNING id`, [c.tenant, username, `${username}@test.cm`, role]);
    c.u[qui] = { id: u.id, token: jwt.sign({ sub: u.id, username, role, tenantId: c.tenant }, SECRET, { expiresIn: '1h' }) };
  }
};

before(async () => {
  await creerClient('ong', 'ONG', [['dir', 'directeur'], ['cpt', 'auditeur'], ['chef', 'caissier'], ['resp', 'caissier'], ['autre', 'caissier']]);
  await creerClient('pme', 'SARL', [['dir', 'directeur']]);
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
    const ids = [C.ong.tenant, C.pme.tenant].filter(Boolean);
    await cx.query('BEGIN');
    await cx.query("SET LOCAL app.journal_maintenance = 'on'");
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

test('PME : pas de menu Projets, API refusée', async () => {
  const a = await appel('GET', '/projets/acces', 'pme', 'dir');
  assert.equal(a.status, 200);
  assert.equal(a.data.visible, false);
  const l = await appel('GET', '/projets', 'pme', 'dir');
  assert.equal(l.status, 403);
  assert.equal(l.code, 'PROJETS_RESERVES_ONG');
  assert.equal((await appel('POST', '/projets', 'pme', 'dir', { nom: 'X' })).status, 403);
});

test('ONG : le directeur crée un projet et désigne le chef de projet', async () => {
  assert.equal((await ong('POST', '/projets', 'chef', { nom: 'Projet Eau' })).status, 403);   // pas encore chef, pas projets.gerer
  const r = await ong('POST', '/projets', 'dir', { nom: 'Projet Eau', code: 'pep', chef_projet_id: C.ong.u.chef.id, date_debut: '2026-01-01', date_fin: '2026-12-31' });
  assert.equal(r.status, 201, r.message);
  S.projet = r.data.id;
  const dup = await ong('POST', '/projets', 'dir', { nom: 'projet eau' });
  assert.equal(dup.status, 409);
  const mauvaisesDates = await ong('POST', '/projets', 'dir', { nom: 'P2', date_debut: '2026-12-31', date_fin: '2026-01-01' });
  assert.equal(mauvaisesDates.status, 400);
});

test('ONG : menu visible selon la désignation', async () => {
  assert.equal((await ong('GET', '/projets/acces', 'dir')).data.visible, true);
  assert.equal((await ong('GET', '/projets/acces', 'cpt')).data.visible, true);
  const chef = await ong('GET', '/projets/acces', 'chef');
  assert.equal(chef.data.visible, true);
  assert.equal(chef.data.chef, 1);
  assert.equal((await ong('GET', '/projets/acces', 'autre')).data.visible, false);
  assert.equal((await ong('GET', '/projets/acces', 'resp')).data.visible, false);
  // Hors périmètre : invisible, 404 sur la fiche.
  assert.deepEqual((await ong('GET', '/projets', 'autre')).data.projets, []);
  assert.equal((await ong('GET', `/projets/${S.projet}`, 'autre')).status, 404);
});

test('ONG : le chef de projet crée les activités et désigne les responsables', async () => {
  const a1 = await ong('POST', `/projets/${S.projet}/activites`, 'chef', { nom: 'Forages', responsable_id: C.ong.u.resp.id });
  assert.equal(a1.status, 201, a1.message);
  S.act1 = a1.data.id;
  const a2 = await ong('POST', `/projets/${S.projet}/activites`, 'chef', { nom: 'Sensibilisation' });
  assert.equal(a2.status, 201);
  S.act2 = a2.data.id;
  // Responsable étranger à l'entreprise : refusé.
  const etranger = await appel('GET', '/projets/acces', 'pme', 'dir');
  assert.equal(etranger.status, 200);
  const bad = await ong('POST', `/projets/${S.projet}/activites`, 'chef', { nom: 'Bad', responsable_id: C.pme.u.dir.id });
  assert.equal(bad.status, 400);
  // Le chef ne change pas le chef de projet (direction seulement).
  assert.equal((await ong('PUT', `/projets/${S.projet}`, 'chef', { chef_projet_id: C.ong.u.autre.id })).status, 403);
  // Le responsable voit désormais le menu, mais ne gère rien.
  assert.equal((await ong('GET', '/projets/acces', 'resp')).data.visible, true);
  assert.equal((await ong('POST', `/projets/${S.projet}/activites`, 'resp', { nom: 'Pirate' })).status, 403);
  // Le comptable consulte, sans gérer.
  assert.equal((await ong('GET', `/projets/${S.projet}`, 'cpt')).status, 200);
  assert.equal((await ong('POST', `/projets/${S.projet}/activites`, 'cpt', { nom: 'Compta' })).status, 403);
});

test('ONG : budget chargé, soumis ; rejet motivé ; corrigé ; validé par le directeur', async () => {
  const b = await ong('POST', `/projets/${S.projet}/budgets`, 'chef');
  assert.equal(b.status, 201, b.message);
  S.b1 = b.data.id;
  assert.equal((await ong('POST', `/projets/${S.projet}/budgets`, 'chef')).code, 'BUDGET_DEJA_OUVERT');
  // Budget vide : soumission refusée.
  assert.equal((await ong('POST', `/projets/${S.projet}/budgets/${S.b1}/soumettre`, 'chef')).code, 'BUDGET_VIDE');
  const lignes = [{ activite_id: S.act1, montant: '3 000 000' }, { activite_id: S.act2, montant: 500000 }];
  assert.equal((await ong('PUT', `/projets/${S.projet}/budgets/${S.b1}`, 'chef', { lignes, commentaire: 'Budget initial' })).status, 200);
  const s1 = await ong('POST', `/projets/${S.projet}/budgets/${S.b1}/soumettre`, 'chef');
  assert.equal(s1.status, 200, s1.message);
  // Soumis : figé.
  assert.equal((await ong('PUT', `/projets/${S.projet}/budgets/${S.b1}`, 'chef', { lignes })).code, 'BUDGET_FIGE');
  // Le directeur est prévenu et le voit dans « À valider ».
  const [{ nb }] = await sql(`SELECT COUNT(*)::int AS nb FROM notifications WHERE destinataire_id = $1 AND type = 'projet_budget'`, [C.ong.u.dir.id]);
  assert.equal(nb, 1);
  const liste = await ong('GET', '/projets', 'dir');
  assert.equal(liste.data.a_valider.length, 1);
  assert.equal(liste.data.a_valider[0].montant, 3500000);
  // Ni le chef ni le comptable ne valident.
  assert.equal((await ong('POST', `/projets/${S.projet}/budgets/${S.b1}/valider`, 'chef')).status, 403);
  assert.equal((await ong('POST', `/projets/${S.projet}/budgets/${S.b1}/valider`, 'cpt')).status, 403);
  // Rejet : motif obligatoire.
  assert.equal((await ong('POST', `/projets/${S.projet}/budgets/${S.b1}/rejeter`, 'dir', {})).code, 'MOTIF_REQUIS');
  assert.equal((await ong('POST', `/projets/${S.projet}/budgets/${S.b1}/rejeter`, 'dir', { motif: 'Forages surévalués' })).status, 200);
  const [{ nbChef }] = await sql(`SELECT COUNT(*)::int AS "nbChef" FROM notifications WHERE destinataire_id = $1 AND type = 'projet_budget'`, [C.ong.u.chef.id]);
  assert.equal(nbChef, 1);
  // Corrigé par le chef (redevient brouillon), resoumis, validé.
  const corr = await ong('PUT', `/projets/${S.projet}/budgets/${S.b1}`, 'chef', { lignes: [{ activite_id: S.act1, montant: 2500000 }, { activite_id: S.act2, montant: 500000 }] });
  assert.equal(corr.status, 200, corr.message);
  assert.equal((await ong('POST', `/projets/${S.projet}/budgets/${S.b1}/soumettre`, 'chef')).status, 200);
  const v = await ong('POST', `/projets/${S.projet}/budgets/${S.b1}/valider`, 'dir');
  assert.equal(v.status, 200, v.message);
  const d = await ong('GET', `/projets/${S.projet}`, 'chef');
  assert.equal(d.data.chiffres.budget_valide, 3000000);
  assert.equal(d.data.budgets[0].statut, 'valide');
  assert.equal(d.data.budgets[0].motif_rejet, '');
});

test('ONG : après validation, financement et remise de fonds ; chiffres relus dans le journal', async () => {
  const f = await saisie('chef', { rubrique_code: 'SUB', entree: 2000000, projet_id: S.projet, reference_financement: 'AVIS 7' });
  assert.equal(f.status, 201, f.message);
  const r = await saisie('chef', { rubrique_code: 'D1', sortie: 1500000, activite_id: S.act1, beneficiaire: 'Resp' });
  assert.equal(r.status, 201, r.message);
  const d = await ong('GET', `/projets/${S.projet}`, 'dir');
  assert.equal(d.data.chiffres.recu, 2000000);
  assert.equal(d.data.chiffres.alloue, 1500000);
  assert.equal(d.data.chiffres.disponible, 500000);
  assert.equal(d.data.chiffres.reste_a_recevoir, 1000000);
  assert.equal(d.data.financements.length, 1);
  assert.equal(d.data.financements[0].reference_financement, 'AVIS 7');
  assert.equal(d.data.remises.length, 1);
  const a1 = d.data.activites.find((a) => a.id === S.act1);
  assert.equal(a1.reste, 1000000);
  assert.equal(a1.responsable_id, C.ong.u.resp.id);
});

test('ONG : le responsable ne voit que son activité, sans les financements', async () => {
  const d = await ong('GET', `/projets/${S.projet}`, 'resp');
  assert.equal(d.status, 200);
  assert.deepEqual(d.data.activites.map((a) => a.id), [S.act1]);
  assert.equal(d.data.chiffres.recu, null);
  assert.deepEqual(d.data.financements, []);
  assert.equal(d.data.remises.length, 1);
  assert.equal(d.data.acces.gerer, false);
  assert.ok(d.data.budgets.every((b) => b.lignes.every((l) => l.activite_id === S.act1)));
  const l = await ong('GET', '/projets', 'resp');
  assert.equal(l.data.projets[0].recu, null);
  assert.equal(l.data.projets[0].alloue, 1500000);
});

test('ONG : budget révisé jamais sous les fonds remis ; l\'ancienne version est archivée', async () => {
  const b = await ong('POST', `/projets/${S.projet}/budgets`, 'chef');
  assert.equal(b.status, 201);
  S.b2 = b.data.id;
  // Pré-rempli avec le budget en vigueur.
  const d0 = await ong('GET', `/projets/${S.projet}`, 'chef');
  const brouillon = d0.data.budgets.find((x) => x.id === S.b2);
  assert.equal(brouillon.total, 3000000);
  await ong('PUT', `/projets/${S.projet}/budgets/${S.b2}`, 'chef', { lignes: [{ activite_id: S.act1, montant: 1000000 }, { activite_id: S.act2, montant: 500000 }] });
  const refus = await ong('POST', `/projets/${S.projet}/budgets/${S.b2}/soumettre`, 'chef');
  assert.equal(refus.status, 409);
  assert.equal(refus.code, 'BUDGET_SOUS_ALLOUE');
  await ong('PUT', `/projets/${S.projet}/budgets/${S.b2}`, 'chef', { lignes: [{ activite_id: S.act1, montant: 4000000 }, { activite_id: S.act2, montant: 500000 }] });
  assert.equal((await ong('POST', `/projets/${S.projet}/budgets/${S.b2}/soumettre`, 'chef')).status, 200);
  assert.equal((await ong('POST', `/projets/${S.projet}/budgets/${S.b2}/valider`, 'dir')).status, 200);
  const d = await ong('GET', `/projets/${S.projet}`, 'dir');
  assert.deepEqual(d.data.budgets.map((x) => [x.version, x.statut]), [[2, 'valide'], [1, 'remplace']]);
  assert.equal(d.data.chiffres.budget_valide, 4500000);
  // La remise suivante s'appuie sur la nouvelle version.
  assert.equal((await saisie('chef', { rubrique_code: 'D1', sortie: 2000000, activite_id: S.act1 })).status, 201);
});

test('ONG : brouillon supprimable, budget validé jamais', async () => {
  const b = await ong('POST', `/projets/${S.projet}/budgets`, 'chef');
  assert.equal((await ong('DELETE', `/projets/${S.projet}/budgets/${b.data.id}`, 'chef')).status, 200);
  assert.equal((await ong('DELETE', `/projets/${S.projet}/budgets/${S.b2}`, 'dir')).code, 'BUDGET_FIGE');
});

test('ONG : désactivation d\'une activité et changement de chef par la direction', async () => {
  assert.equal((await ong('PUT', `/projets/${S.projet}/activites/${S.act2}`, 'chef', { actif: false })).status, 200);
  assert.equal((await ong('PUT', `/projets/${S.projet}`, 'dir', { chef_projet_id: C.ong.u.autre.id })).status, 200);
  assert.equal((await ong('GET', '/projets/acces', 'autre')).data.chef, 1);
  assert.equal((await ong('GET', `/projets/${S.projet}`, 'chef')).status, 404);   // plus chef, plus rien
  const u = await ong('GET', '/projets/utilisateurs', 'dir');
  assert.ok(u.data.length >= 5);
  assert.equal((await ong('GET', '/projets/utilisateurs', 'resp')).status, 403);
});
