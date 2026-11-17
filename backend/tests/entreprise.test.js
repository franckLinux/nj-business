// tests/entreprise.test.js — NJ BUSINESS : configuration centrale de l'entreprise (064, lot A).
//
//  • permissions du socle reprises de config.* (aucun droit de modification nouveau) ;
//  • entreprise SANS module : configuration lisible et modifiable, modules bloqués ;
//  • contrôles de saisie ; la forme juridique ne bascule plus le plan comptable ;
//  • logo : ajout, remplacement, suppression, formats refusés, journal sans l'image ;
//  • représentant légal : correction sans historique, changement avec historique,
//    identité inchangée, nom recopié pour la caisse ;
//  • isolation entre entreprises et contrôle des comptes du cabinet ;
//  • migration rejouable.
//
//   TEST_DATABASE_URL=postgres://…/base_de_test  node --test tests/entreprise.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const DB = process.env.TEST_DATABASE_URL;
if (!DB) {
  console.error('TEST_DATABASE_URL absent : test ignoré (ne jamais viser la base de production).');
  process.exit(0);
}
const SECRET = 'test-secret-' + crypto.randomBytes(16).toString('hex');
const PORT = 7900 + Math.floor(Math.random() * 400);
const sfx = crypto.randomBytes(3).toString('hex');
const pool = new Pool({ connectionString: DB });
let serveur;
let A;          // entreprise sans aucun module
let B;          // entreprise avec NJ CAISSE PRO
const U = {};
// Petite image PNG valide (1 × 1 px).
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const sql = async (texte, params = []) => (await pool.query(texte, params)).rows;
const appel = async (methode, url, qui, corps, entetes = {}) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api${url}`, {
    method: methode,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${U[qui].token}`, ...entetes },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.data ?? j, message: j.message ?? j.error, code: j.code };
};
const creerUtilisateur = async (cle, role, tenant) => {
  const username = `${cle}-${sfx}`;
  const hash = await bcrypt.hash('Mdp-test-2026!', 4);
  const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif)
                          VALUES ($1, $2, $3, $4, $5, true) RETURNING id`, [tenant, username, `${username}@test.cm`, hash, role]);
  U[cle] = { id: u.id, username, token: jwt.sign({ sub: u.id, username, role, tenantId: tenant }, SECRET, { expiresIn: '1h' }) };
};

before(async () => {
  [{ id: A }] = await sql(`INSERT INTO tenants (slug, nom, initialise_le, dirigeant_nom) VALUES ($1, $2, NOW(), '') RETURNING id`,
    [`ea-${sfx}`, `Entreprise A ${sfx}`]);
  [{ id: B }] = await sql(`INSERT INTO tenants (slug, nom, initialise_le, dirigeant_nom, forme_juridique) VALUES ($1, $2, NOW(), 'Paul MBARGA', 'SARL') RETURNING id`,
    [`eb-${sfx}`, `Entreprise B ${sfx}`]);
  // A : aucun module (le déclencheur a activé la caisse, on la retire).
  await sql("UPDATE tenant_modules SET actif = false, motif = 'Test : entreprise sans module' WHERE tenant_id = $1", [A]);
  await creerUtilisateur('dirA', 'directeur', A);
  await creerUtilisateur('caiA', 'caissier', A);
  await creerUtilisateur('dirB', 'directeur', B);
  await creerUtilisateur('adm', 'super_admin', null);
  await creerUtilisateur('cab', 'comptable_cabinet', null);
  await sql('INSERT INTO cabinet_affectations (user_id, tenant_id) VALUES ($1, $2)', [U.cab.id, B]);
  serveur = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: DB, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test', SMTP_HOST: '',
      RATE_LIMIT_MAX: '100000', MODULES_CONTROLE: 'appliquer' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = (d) => process.env.DEBUG_TEST && process.stderr.write(d);
  serveur.stdout.on('data', log); serveur.stderr.on('data', log);
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) break; } catch { /* démarrage */ }
    await new Promise((r) => setTimeout(r, 250));
  }
});

after(async () => {
  serveur?.kill();
  for (const t of [A, B]) {
    for (const table of ['audit_log', 'cabinet_affectations', 'tenant_modules', 'entreprise_references', 'entreprise_representants']) {
      await sql(`DELETE FROM ${table} WHERE tenant_id = $1`, [t]).catch(() => {});
    }
  }
  for (const u of Object.values(U)) {
    await sql('DELETE FROM audit_log WHERE user_id = $1', [u.id]).catch(() => {});
    await sql('DELETE FROM users WHERE id = $1', [u.id]).catch(() => {});
  }
  for (const t of [A, B]) {
    await sql('DELETE FROM rubriques WHERE tenant_id = $1', [t]).catch(() => {});
    await sql('DELETE FROM tenants WHERE id = $1', [t]).catch(() => {});
  }
  await pool.end();
});

test('Permissions du socle reprises de la configuration ; aucun droit de modification nouveau', async () => {
  const droits = await sql(`SELECT r.code, array_agg(rp.permission_code ORDER BY rp.permission_code) AS p
                              FROM roles r JOIN role_permissions rp ON rp.role_id = r.id
                             WHERE r.tenant_id IS NULL AND r.is_system AND rp.permission_code LIKE 'entreprise.%' GROUP BY r.code`);
  const de = Object.fromEntries(droits.map((d) => [d.code, d.p]));
  assert.deepEqual(de.directeur, ['entreprise.edit', 'entreprise.view']);
  assert.deepEqual(de.caissier, ['entreprise.view']);
  assert.deepEqual(de.auditeur, ['entreprise.view']);
  const [{ n }] = await sql(`SELECT COUNT(*)::int AS n FROM role_permissions rp
                              WHERE rp.permission_code = 'entreprise.edit'
                                AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.permission_code = 'config.edit')`);
  assert.equal(n, 0, 'entreprise.edit seulement là où config.edit existait');
});

test('Scénario 1 — entreprise sans module : la configuration est accessible et modifiable', async () => {
  let r = await appel('GET', '/entreprise', 'dirA');
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.modules_actifs, 0);
  assert.equal(r.data.identite.nom, `Entreprise A ${sfx}`);
  assert.equal(r.data.representant, null);
  // Les modules restent fermés.
  const ferme = await appel('GET', '/journal', 'dirA');
  assert.equal(ferme.status, 403, JSON.stringify(ferme));
  assert.match(ferme.message, /pas activé/);
  r = await appel('PUT', '/entreprise', 'dirA', {
    nom: `Kamga Distribution ${sfx}`, nom_commercial: 'Kamga', sigle: 'kd', slogan: 'Toujours là', forme_juridique: 'SARL',
    activite: 'Commerce général', date_creation: '2015-03-01', pays: 'Cameroun', region: 'Littoral', ville: 'Douala',
    adresse: 'Rue Joss', telephone: '+237 699 00 00 00', email: 'Contact@Kamga.CM', site_web: 'kamga.cm', devise: 'FCFA',
    nui: 'm0123456789x', registre_commerce: 'RC/DLA/2015/B/123', immatriculation: 'IMM-1', numero_statistique: 'STAT-9',
    references: [{ libelle: 'CNPS employeur', valeur: '123-456' }],
  });
  assert.equal(r.status, 200, r.message);
  const i = r.data.identite;
  assert.deepEqual([i.sigle, i.nui, i.email, i.region, i.nom_commercial], ['KD', 'M0123456789X', 'contact@kamga.cm', 'Littoral', 'Kamga']);
  assert.equal(r.data.references.length, 1);
  assert.equal(i.date_creation, '2015-03-01', 'date restituée telle quelle (sans décalage de fuseau)');
  const [audit] = await sql("SELECT nouvelle_valeur FROM audit_log WHERE tenant_id = $1 AND action = 'ENTREPRISE_IDENTITE'", [A]);
  assert.equal(audit.nouvelle_valeur.ville, 'Douala', 'modification tracée');
  // Un champ absent n'est pas effacé.
  r = await appel('PUT', '/entreprise', 'dirA', { slogan: 'Nouveau slogan' });
  assert.equal(r.data.identite.ville, 'Douala');
  assert.equal(r.data.references.length, 1, 'références inchangées si non envoyées');
});

test('Contrôles de saisie', async () => {
  for (const [corps, motif] of [
    [{ nom: '  ' }, /raison sociale/],
    [{ email: 'pas-un-email' }, /e-mail/],
    [{ forme_juridique: 'XYZ' }, /Forme juridique/],
    [{ date_creation: '2999-01-01' }, /futur/],
    [{ devise: 'GBP' }, /Devise/],
    [{ nui: 'X'.repeat(21) }, /20 caractères/],
    [{ references: [{ libelle: 'Sans valeur', valeur: '' }] }, /obligatoires/],
    [{ references: Array.from({ length: 21 }, (_, k) => ({ libelle: `R${k}`, valeur: 'v' })) }, /20 références/],
  ]) {
    const r = await appel('PUT', '/entreprise', 'dirA', corps);
    assert.equal(r.status, 400, JSON.stringify(corps));
    assert.match(r.message, motif);
  }
});

test('Droits : le caissier consulte sans modifier ; la forme juridique ne bascule plus le plan comptable', async () => {
  assert.equal((await appel('GET', '/entreprise', 'caiA')).status, 200);
  assert.equal((await appel('PUT', '/entreprise', 'caiA', { slogan: 'x' })).status, 403);
  assert.equal((await appel('PUT', '/entreprise/logo', 'caiA', { logo: PNG })).status, 403);
  const [avant] = await sql('SELECT plan_referentiel FROM tenants WHERE id = $1', [B]);
  const r = await appel('PUT', '/entreprise', 'dirB', { forme_juridique: 'ASSOC' });
  assert.equal(r.status, 200, r.message);
  const [apres] = await sql('SELECT plan_referentiel, forme_juridique FROM tenants WHERE id = $1', [B]);
  assert.equal(apres.forme_juridique, 'ASSOC');
  assert.equal(apres.plan_referentiel, avant.plan_referentiel, 'le choix du plan relève de NJ CAISSE PRO');
  await appel('PUT', '/entreprise', 'dirB', { forme_juridique: 'SARL' });
});

test('Logo : ajout, remplacement, suppression ; formats refusés ; le journal ne contient pas l\'image', async () => {
  assert.equal((await appel('PUT', '/entreprise/logo', 'dirA', { logo: 'data:image/svg+xml;base64,PHN2Zz4=' })).status, 400, 'SVG refusé');
  assert.equal((await appel('PUT', '/entreprise/logo', 'dirA', { logo: 'pas une image' })).status, 400);
  assert.equal((await appel('PUT', '/entreprise/logo', 'dirA', {})).status, 400);
  let r = await appel('PUT', '/entreprise/logo', 'dirA', { logo: PNG });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.identite.logo_url, PNG);
  r = await appel('PUT', '/entreprise/logo', 'dirA', { logo: PNG });
  r = await appel('DELETE', '/entreprise/logo', 'dirA');
  assert.equal(r.data.identite.logo_url, '');
  const journal = await sql(`SELECT action, nouvelle_valeur::text AS v FROM audit_log WHERE tenant_id = $1 AND action LIKE 'ENTREPRISE_LOGO_%' ORDER BY id`, [A]);
  assert.deepEqual(journal.map((j) => j.action), ['ENTREPRISE_LOGO_AJOUTE', 'ENTREPRISE_LOGO_REMPLACE', 'ENTREPRISE_LOGO_SUPPRIME']);
  assert.ok(journal.every((j) => !j.v.includes('base64')), 'pas d\'image dans le journal');
});

test('Représentant légal : déclaration, correction, changement avec historique ; identité inchangée', async () => {
  assert.equal((await appel('PUT', '/entreprise/representant', 'dirA', { telephone: '1' })).status, 404, 'aucun représentant encore');
  assert.equal((await appel('POST', '/entreprise/representants', 'dirA', { prenoms: 'Sans nom' })).status, 400);
  assert.equal((await appel('POST', '/entreprise/representants', 'dirA', { nom: 'X', email: 'faux' })).status, 400);
  assert.equal((await appel('POST', '/entreprise/representants', 'dirA', { nom: 'X', signature_url: 'data:image/gif;base64,AAAA' })).status, 400);
  let r = await appel('POST', '/entreprise/representants', 'dirA', {
    nom: 'KAMGA', prenoms: 'Jean', fonction: 'Gérant', telephone: '699', email: 'Jean@Kamga.cm', debut: '2020-01-01', signature_url: PNG,
  });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.representant.nom, 'KAMGA');
  assert.equal(r.data.representant.email, 'jean@kamga.cm');
  const identiteAvant = (await sql('SELECT nom, sigle, nui, ville, updated_at FROM tenants WHERE id = $1', [A]))[0];
  // Correction : pas d'historique.
  r = await appel('PUT', '/entreprise/representant', 'dirA', { telephone: '677 00 00 00' });
  assert.equal(r.data.representant.telephone, '677 00 00 00');
  assert.equal(r.data.historique_representants.length, 0);
  // Prise de fonction antérieure ou égale : refus.
  assert.equal((await appel('POST', '/entreprise/representants', 'dirA', { nom: 'NGO', debut: '2020-01-01' })).status, 400);
  r = await appel('POST', '/entreprise/representants', 'dirA', { nom: 'NGO', prenoms: 'Marie', fonction: 'Directrice générale', debut: '2026-06-01' });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.representant.nom, 'NGO');
  assert.equal(r.data.historique_representants.length, 1);
  assert.equal(r.data.historique_representants[0].fin, '2026-05-31', 'clos la veille');
  const t = (await sql('SELECT nom, sigle, nui, ville, dirigeant_nom, directeur_nom FROM tenants WHERE id = $1', [A]))[0];
  assert.deepEqual([t.nom, t.sigle, t.nui, t.ville], [identiteAvant.nom, identiteAvant.sigle, identiteAvant.nui, identiteAvant.ville], 'identité inchangée');
  assert.equal(t.dirigeant_nom, 'Marie NGO', 'nom recopié (compatibilité)');
  assert.notEqual(t.directeur_nom, 'Marie NGO', '065 : le directeur signataire de la caisse n\'est pas écrasé');
  const [{ n }] = await sql('SELECT COUNT(*)::int AS n FROM entreprise_representants WHERE tenant_id = $1 AND fin IS NULL', [A]);
  assert.equal(n, 1, 'un seul représentant en fonction');
});

test('Scénario 8 — isolation : chacun ne voit et ne modifie que son entreprise', async () => {
  // Un utilisateur de client : l'en-tête X-Tenant-Id est ignoré.
  let r = await appel('GET', '/entreprise', 'dirB', undefined, { 'X-Tenant-Id': A });
  assert.equal(r.data.identite.id, B);
  r = await appel('PUT', '/entreprise', 'dirB', { slogan: `B ${sfx}` }, { 'X-Tenant-Id': A });
  assert.equal(r.status, 200);
  assert.notEqual((await sql('SELECT slogan FROM tenants WHERE id = $1', [A]))[0].slogan, `B ${sfx}`);
  // Comptable du cabinet : seulement les clients qui lui sont affectés.
  assert.equal((await appel('GET', '/entreprise', 'cab', undefined, { 'X-Tenant-Id': A })).status, 403);
  assert.equal((await appel('GET', '/entreprise', 'cab', undefined, { 'X-Tenant-Id': B })).status, 200);
  // super_admin : doit choisir un client.
  assert.equal((await appel('GET', '/entreprise', 'adm')).status, 400);
  assert.equal((await appel('GET', '/entreprise', 'adm', undefined, { 'X-Tenant-Id': A })).data.identite.id, A);
});

test('Migration 064 : reprise du dirigeant existant, puis rejouable sans rien en double', async () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '064_entreprise_configuration.sql'), 'utf8');
  const jouer = async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(migration);
      await client.query('COMMIT');
    } finally { client.release(); }
  };
  const compter = async () => (await sql(`SELECT (SELECT COUNT(*) FROM entreprise_representants)::int AS r,
    (SELECT COUNT(*) FROM role_permissions WHERE permission_code LIKE 'entreprise.%')::int AS p,
    (SELECT COUNT(*) FROM user_permissions WHERE permission_code LIKE 'entreprise.%')::int AS u,
    (SELECT COUNT(*) FROM permissions WHERE module = 'entreprise')::int AS c`))[0];
  await jouer();
  // B avait un dirigeant (ancien champ) et aucun représentant : il est repris.
  const [rep] = await sql('SELECT nom, fonction, origine, fin FROM entreprise_representants WHERE tenant_id = $1', [B]);
  assert.deepEqual([rep.nom, rep.fonction, rep.origine, rep.fin], ['Paul MBARGA', 'Dirigeant', 'migration', null]);
  const avant = await compter();
  await jouer();
  assert.deepEqual(await compter(), avant, 'rejouée : aucune ligne en plus');
});
