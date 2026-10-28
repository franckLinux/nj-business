// tests/validation-directe.test.js — Validation directe d'une DEMANDE DE DÉMO
// (formulaire public) par un commercial avec son code personnel (migrations 035-036).
//
// Lance le VRAI serveur (index.js) sur une base de TEST, puis appelle l'API.
//   TEST_DATABASE_URL=postgres://…/base_de_test  npm run test:validation-directe
// La base doit être migrée (node db/migrate.js --schema) et le plan comptable
// chargé (node db/seed-plan-comptable.js). Aucune base n'est utilisée sans
// TEST_DATABASE_URL explicite (jamais la base de production par mégarde).
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
const U = {};
const BON_CODE = 'K7Q2M9';

const sql = async (texte, params = []) => (await pool.query(texte, params)).rows;
const appel = async (methode, url, qui, corps) => {
  const r = await fetch(BASE + url, {
    method: methode,
    headers: { 'Content-Type': 'application/json', ...(qui ? { Authorization: `Bearer ${U[qui].token}` } : {}) },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.data ?? j, message: j.message };
};
const creerUtilisateur = async (cle, role) => {
  const username = `${cle}-${sfx}`;
  const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif)
                          VALUES (NULL, $1, $2, 'x', $3, true) RETURNING id`, [username, `${username}@cabinet.cm`, role]);
  U[cle] = { id: u.id, username, token: jwt.sign({ sub: u.id, username, role, tenantId: null }, SECRET, { expiresIn: '1h' }) };
};
let n = 0;
const formulaire = () => {
  n += 1;
  return {
    nom_complet: `Contact ${n}`, entreprise: `Entreprise ${sfx}-${n}`, email: `demande${n}-${sfx}@prospect.cm`,
    telephone: `6${String(Date.now()).slice(-6)}${String(n).padStart(2, '0')}`, ville: 'Yaoundé', pays: 'Cameroun', consentement: true,
  };
};
const valider = (f, qui, code) => appel('POST', '/demande-demo/validation-directe', null, { ...f, identifiant: U[qui].username, validationCode: code });
const prospectParEmail = async (email) => (await sql('SELECT * FROM prospects WHERE email = $1', [email]))[0];

before(async () => {
  serveur = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: DB, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test',
      SMTP_HOST: '', APP_URL: 'http://localhost:5173', RATE_LIMIT_MAX: '100000', VALIDATION_DIRECTE_RATE_MAX: '40' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = (d) => process.env.DEBUG_TEST && process.stderr.write(d);
  serveur.stdout.on('data', log); serveur.stderr.on('data', log);
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* démarrage */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  await creerUtilisateur('admin', 'super_admin');
  await creerUtilisateur('comA', 'commercial');   // autorisé + code
  await creerUtilisateur('comB', 'commercial');   // code mais sans permission
  await creerUtilisateur('comC', 'commercial');   // autorisé, pour le blocage
});
after(async () => { serveur?.kill(); await pool.end(); });

test('Super Admin : permission et codes personnels (jamais renvoyés, jamais en clair)', async () => {
  for (const c of ['comA', 'comC']) {
    const r = await appel('PUT', `/validation-directe/${U[c].id}/permission`, 'admin', { autorise: true });
    assert.equal(r.status, 200, r.message);
  }
  for (const c of ['comA', 'comB', 'comC']) {
    const r = await appel('POST', `/validation-directe/${U[c].id}/code`, 'admin', { code: BON_CODE });
    assert.equal(r.status, 201, r.message);
    assert.equal(JSON.stringify(r.data).includes(BON_CODE), false);
    assert.equal('code_hash' in r.data, false);
  }
  const liste = await appel('GET', '/validation-directe', 'admin');
  const brut = JSON.stringify(liste.data);
  assert.equal(brut.includes(BON_CODE) || brut.includes('code_hash') || brut.includes('$2'), false);
  assert.equal(liste.data.find((x) => x.id === U.comA.id).permission, true);
  assert.equal(liste.data.find((x) => x.id === U.comB.id).permission, false);
  const [{ fuite }] = await sql(`SELECT COUNT(*)::int AS fuite FROM codes_validation_demo WHERE code_hash LIKE '%' || $1 || '%'`, [BON_CODE]);
  assert.equal(fuite, 0);
});

test('Code trop faible refusé ; gestion des codes fermée aux commerciaux', async () => {
  assert.equal((await appel('POST', `/validation-directe/${U.comB.id}/code`, 'admin', { code: '123456' })).status, 400);
  assert.equal((await appel('GET', '/validation-directe', 'comA')).status, 403);
  assert.equal((await appel('POST', `/validation-directe/${U.comA.id}/code`, 'comA', { code: 'ZZ99XX' })).status, 403);
});

test('Voie normale inchangée : la demande arrive « à traiter », le Super Admin la valide', async () => {
  const f = formulaire();
  const r = await appel('POST', '/demande-demo', null, f);
  assert.equal(r.status, 201);
  const p = await prospectParEmail(f.email);
  assert.equal(p.statut, 'PROSPECT');
  assert.equal(p.demande_traitee, false);
  assert.equal(p.tenant_id, null);
  const v = await appel('POST', `/prospects/${p.id}/invitation`, 'admin');
  assert.equal(v.status, 200, v.message);
  assert.equal((await prospectParEmail(f.email)).statut, 'INVITATION_ENVOYEE');
  const t = await sql("SELECT methode, resultat FROM prospect_validations WHERE prospect_id = $1", [p.id]);
  assert.deepEqual(t.map((x) => `${x.methode}:${x.resultat}`), ['SUPER_ADMIN:SUCCESS']);
});

test('Fiche prospect : le commercial ouvre à nouveau la démo de son prospect librement (comme avant)', async () => {
  const f = formulaire();
  const [p] = await sql(`INSERT INTO prospects (nom_complet, entreprise, email, telephone, statut, demo_debut, demo_fin, commercial_id)
                          VALUES ($1, $2, $3, $4, 'INTERESSE', NOW(), NOW() + INTERVAL '14 days', $5) RETURNING id`,
  [f.nom_complet, f.entreprise, f.email, f.telephone, U.comB.id]);
  const r = await appel('POST', `/prospects/${p.id}/invitation`, 'comB');
  assert.equal(r.status, 200, r.message);
});

test('Commercial autorisé + code correct → demande validée : prospect créé, attribué, démo ouverte', async () => {
  const f = formulaire();
  const r = await valider(f, 'comA', BON_CODE);
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.valide, true);
  const p = await prospectParEmail(f.email);
  assert.equal(p.statut, 'INVITATION_ENVOYEE');
  assert.equal(p.commercial_id, U.comA.id);
  assert.equal(p.demande_traitee, true);
  assert.ok(p.tenant_id);
  const [t] = await sql('SELECT type_compte FROM tenants WHERE id = $1', [p.tenant_id]);
  assert.equal(t.type_compte, 'demo');
  const [{ inv }] = await sql('SELECT COUNT(*)::int AS inv FROM prospect_invitations WHERE prospect_id = $1', [p.id]);
  assert.equal(inv, 1);
  const tr = await sql("SELECT * FROM prospect_validations WHERE prospect_id = $1", [p.id]);
  assert.equal(tr.length, 1);
  assert.equal(tr[0].methode, 'DIRECT_CODE');
  assert.equal(tr[0].resultat, 'SUCCESS');
  assert.equal(tr[0].user_id, U.comA.id);
  assert.ok(tr[0].code_id);
  const [c] = await sql('SELECT nb_utilisations, derniere_utilisation_le FROM codes_validation_demo WHERE id = $1', [tr[0].code_id]);
  assert.equal(c.nb_utilisations, 1);
  assert.ok(c.derniere_utilisation_le);
  const [{ a }] = await sql("SELECT COUNT(*)::int AS a FROM audit_log WHERE action = 'DIRECT_PROSPECT_VALIDATION' AND entite_id = $1", [p.id]);
  assert.equal(a, 1);
  const h = await sql("SELECT action FROM prospect_historique WHERE prospect_id = $1 ORDER BY id", [p.id]);
  assert.ok(h.some((x) => x.action === 'DEMANDE_WEB_VALIDEE_PAR_CODE'));
});

test('Mauvais code, ou identifiant inconnu → même refus, aucun prospect créé', async () => {
  const f = formulaire();
  const r1 = await valider(f, 'comA', 'K7Q2M8');
  assert.equal(r1.status, 400);
  assert.equal(r1.message, 'Identifiant ou code de validation incorrect.');
  const r2 = await appel('POST', '/demande-demo/validation-directe', null, { ...f, identifiant: 'personne-inconnue', validationCode: BON_CODE });
  assert.equal(r2.status, 400);
  assert.equal(r2.message, r1.message, 'aucun indice sur l\'existence du compte');
  assert.equal(await prospectParEmail(f.email), undefined);
  const echecs = await sql("SELECT motif, prospect_libelle FROM prospect_validations WHERE resultat = 'FAILED' AND prospect_libelle LIKE $1", [`%${f.email}%`]);
  assert.deepEqual(echecs.map((x) => x.motif).sort(), ['CODE_INCORRECT', 'IDENTIFIANT_INCONNU']);
  await sql('UPDATE codes_validation_demo SET tentatives_echouees = 0 WHERE user_id = $1', [U.comA.id]);
});

test('Commercial sans permission → accès refusé (même avec le bon code)', async () => {
  const f = formulaire();
  const r = await valider(f, 'comB', BON_CODE);
  assert.equal(r.status, 403);
  assert.equal(await prospectParEmail(f.email), undefined);
});

test('Code expiré → refusé', async () => {
  await sql("UPDATE codes_validation_demo SET expire_le = NOW() - INTERVAL '1 minute' WHERE user_id = $1 AND revoque_le IS NULL", [U.comA.id]);
  const f = formulaire();
  const r = await valider(f, 'comA', BON_CODE);
  assert.equal(r.status, 403);
  assert.equal(await prospectParEmail(f.email), undefined);
  await sql('UPDATE codes_validation_demo SET expire_le = NULL WHERE user_id = $1 AND revoque_le IS NULL', [U.comA.id]);
});

test('Code désactivé puis réactivé', async () => {
  const [c] = await sql('SELECT id FROM codes_validation_demo WHERE user_id = $1 AND revoque_le IS NULL', [U.comA.id]);
  assert.equal((await appel('PATCH', `/validation-directe/codes/${c.id}`, 'admin', { actif: false })).status, 200);
  assert.equal((await valider(formulaire(), 'comA', BON_CODE)).status, 403);
  assert.equal((await appel('PATCH', `/validation-directe/codes/${c.id}`, 'admin', { actif: true })).status, 200);
});

test('Code révoqué → refusé', async () => {
  const [c] = await sql('SELECT id FROM codes_validation_demo WHERE user_id = $1 AND revoque_le IS NULL', [U.comA.id]);
  assert.equal((await appel('POST', `/validation-directe/codes/${c.id}/revoquer`, 'admin')).status, 200);
  const f = formulaire();
  const r = await valider(f, 'comA', BON_CODE);
  assert.equal(r.status, 400);
  assert.equal(await prospectParEmail(f.email), undefined);
  assert.equal((await appel('POST', `/validation-directe/${U.comA.id}/code`, 'admin', { code: BON_CODE })).status, 201);
});

test('Renouvellement périodique : 30 jours par défaut, nouveau code obligatoirement différent, l\'ancien ne marche plus', async () => {
  // Code créé sans durée → expiration automatique à 30 jours
  const [c] = await sql(`SELECT EXTRACT(EPOCH FROM (expire_le - created_at)) / 86400 AS j FROM codes_validation_demo
                          WHERE user_id = $1 AND revoque_le IS NULL`, [U.comA.id]);
  assert.ok(Math.abs(Number(c.j) - 30) < 0.01, `durée ${c.j}`);
  // Le même code est refusé au renouvellement
  const meme = await appel('POST', `/validation-directe/${U.comA.id}/code`, 'admin', { code: BON_CODE });
  assert.equal(meme.status, 400);
  assert.match(meme.message, /différent/);
  // Expiration proche → signalé « à renouveler »
  await sql("UPDATE codes_validation_demo SET expire_le = NOW() + INTERVAL '3 days' WHERE user_id = $1 AND revoque_le IS NULL", [U.comA.id]);
  let m = (await appel('GET', '/validation-directe', 'admin')).data.find((x) => x.id === U.comA.id);
  assert.equal(m.a_renouveler, true);
  assert.equal(m.jours_restants, 3);
  // Le succès rappelle l'expiration au commercial
  const ok = await valider(formulaire(), 'comA', BON_CODE);
  assert.equal(ok.status, 200, ok.message);
  assert.ok(ok.data.code_expire_le);
  // Nouveau code : l'ancien cesse immédiatement de fonctionner
  const NOUVEAU = 'R5WX8NTD';
  assert.equal((await appel('POST', `/validation-directe/${U.comA.id}/code`, 'admin', { code: NOUVEAU, expire_le: new Date(Date.now() + 60 * 864e5).toISOString() })).status, 201);
  assert.equal((await valider(formulaire(), 'comA', BON_CODE)).status, 400);
  assert.equal((await valider(formulaire(), 'comA', NOUVEAU)).status, 200);
  m = (await appel('GET', '/validation-directe', 'admin')).data.find((x) => x.id === U.comA.id);
  assert.equal(m.a_renouveler, false);
  // Retour au code de référence pour la suite (via révocation, puis nouveau code)
  const [cur] = await sql('SELECT id FROM codes_validation_demo WHERE user_id = $1 AND revoque_le IS NULL', [U.comA.id]);
  await appel('POST', `/validation-directe/codes/${cur.id}/revoquer`, 'admin');
  assert.equal((await appel('POST', `/validation-directe/${U.comA.id}/code`, 'admin', { code: BON_CODE })).status, 201);
});

test('Prospect déjà connu (même e-mail) → validation refusée', async () => {
  const f = formulaire();
  assert.equal((await valider(f, 'comA', BON_CODE)).status, 200);
  const r = await valider({ ...f, telephone: '677000999' }, 'comA', BON_CODE);
  assert.equal(r.status, 409);
});

test('Trop de codes faux → blocage 15 min, même le bon code est refusé, déblocage par le Super Admin', async () => {
  const f = formulaire();
  for (let i = 1; i <= 4; i += 1) assert.equal((await valider(f, 'comC', `FAUX0${i}`)).status, 400);
  assert.equal((await valider(f, 'comC', 'FAUX05')).status, 429);
  assert.equal((await valider(f, 'comC', BON_CODE)).status, 429);
  assert.equal(await prospectParEmail(f.email), undefined);
  const liste = await appel('GET', '/validation-directe', 'admin');
  assert.equal(liste.data.find((x) => x.id === U.comC.id).etat_code, 'bloque');
  const [c] = await sql('SELECT id FROM codes_validation_demo WHERE user_id = $1 AND revoque_le IS NULL', [U.comC.id]);
  assert.equal((await appel('POST', `/validation-directe/codes/${c.id}/debloquer`, 'admin')).status, 200);
  assert.equal((await valider(f, 'comC', BON_CODE)).status, 200);
});

test('Robot (champ piège rempli) : rien n\'est créé', async () => {
  const f = formulaire();
  const r = await appel('POST', '/demande-demo/validation-directe', null, { ...f, site_web: 'http://spam', identifiant: U.comA.username, validationCode: BON_CODE });
  assert.equal(r.status, 200);
  assert.equal(await prospectParEmail(f.email), undefined);
});

test('Historique Super Admin : succès et échecs, sans le code', async () => {
  const r = await appel('GET', '/validation-directe/historique?resultat=FAILED', 'admin');
  assert.equal(r.status, 200);
  assert.ok(r.data.length >= 8);
  assert.ok(r.data.every((x) => x.resultat === 'FAILED'));
  assert.ok(r.data.some((x) => x.prospect_libelle));
  assert.equal(JSON.stringify(r.data).includes(BON_CODE), false);
});

test('Essai de 30 jours par défaut (demande web et validation directe)', async () => {
  const f = formulaire();
  assert.equal((await appel('POST', '/demande-demo', null, f)).status, 201);
  const p = await prospectParEmail(f.email);
  const jours = (new Date(p.demo_fin) - new Date(p.demo_debut)) / 864e5;
  assert.ok(Math.abs(jours - 30) < 0.01, `durée ${jours}`);
});

test('Suppression : réservée au Super Admin, motif obligatoire', async () => {
  const f = formulaire();
  await appel('POST', '/demande-demo', null, f);
  const p = await prospectParEmail(f.email);
  assert.equal((await appel('POST', `/prospects/${p.id}/suppression`, 'comA', { motif: 'test' })).status, 403);
  assert.equal((await appel('POST', `/prospects/${p.id}/suppression`, 'admin', { motif: '  ' })).status, 400);
  const r = await appel('POST', `/prospects/${p.id}/suppression`, 'admin', { motif: 'Doublon' });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.espace_demo_ferme, false);
  assert.equal(await prospectParEmail(f.email), undefined);
  assert.equal((await sql('SELECT 1 FROM prospect_historique WHERE prospect_id = $1', [p.id])).length, 0);
  const [a] = await sql("SELECT ancienne_valeur, nouvelle_valeur FROM audit_log WHERE action = 'PROSPECT_SUPPRIME' AND entite_id = $1", [p.id]);
  assert.equal(a.ancienne_valeur.email, f.email);
  assert.equal(a.nouvelle_valeur.motif, 'Doublon');
  assert.equal((await appel('POST', `/prospects/${p.id}/suppression`, 'admin', { motif: 'x' })).status, 404);
});

test('Suppression d\'un prospect avec démo ouverte : espace fermé et anonymisé, e-mail réutilisable', async () => {
  const f = formulaire();
  assert.equal((await valider(f, 'comA', BON_CODE)).status, 200);
  const p = await prospectParEmail(f.email);
  assert.ok(p.tenant_id && p.user_id);
  const r = await appel('POST', `/prospects/${p.id}/suppression`, 'admin', { motif: 'Demande du prospect' });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.espace_demo_ferme, true);
  const [t] = await sql('SELECT actif, nom FROM tenants WHERE id = $1', [p.tenant_id]);
  assert.equal(t.actif, false);
  assert.match(t.nom, /^Démo supprimée/);
  const us = await sql('SELECT actif, email, username FROM users WHERE tenant_id = $1', [p.tenant_id]);
  assert.ok(us.length > 0 && us.every((u) => !u.actif && u.email === null && u.username.startsWith('supprime-')));
  // L'adresse est libre : la même personne peut refaire une demande
  assert.equal((await valider({ ...f, telephone: `6${String(Date.now()).slice(-8)}` }, 'comA', BON_CODE)).status, 200);
  assert.ok(await prospectParEmail(f.email));
});

test('Suppression refusée pour un prospect avec paiement ou devenu client', async () => {
  const f = formulaire();
  await appel('POST', '/demande-demo', null, f);
  const p = await prospectParEmail(f.email);
  await sql(`INSERT INTO paiements (prospect_id, montant, date_paiement, methode) VALUES ($1, 50000, CURRENT_DATE, 'especes')`, [p.id]);
  assert.equal((await appel('POST', `/prospects/${p.id}/suppression`, 'admin', { motif: 'x' })).status, 409);
  await sql('DELETE FROM paiements WHERE prospect_id = $1', [p.id]);
  await sql("UPDATE prospects SET statut = 'CLIENT_ACTIF' WHERE id = $1", [p.id]);
  assert.equal((await appel('POST', `/prospects/${p.id}/suppression`, 'admin', { motif: 'x' })).status, 409);
  assert.ok(await prospectParEmail(f.email));
});

test('Démo : rôles Directeur et Caissier par défaut, utilisateurs illimités ; le Super Admin ajuste les rôles ; conversion = tous les rôles', async () => {
  const f = formulaire();
  assert.equal((await valider(f, 'comA', BON_CODE)).status, 200);
  const p = await prospectParEmail(f.email);
  // Le prospect (directeur de la démo) a activé son accès
  await sql("UPDATE users SET actif = true WHERE id = $1", [p.user_id]);
  await sql("UPDATE prospect_invitations SET utilise_le = NOW() WHERE prospect_id = $1", [p.id]);
  U.dir = { id: p.user_id, token: jwt.sign({ sub: p.user_id, username: f.email, role: 'directeur', tenantId: p.tenant_id }, SECRET, { expiresIn: '1h' }) };
  const nouvel = (role, n) => appel('POST', '/users', 'dir', { username: `${role}${n}-${sfx}`, password: 'Secret123', role });
  let r = await appel('GET', '/users/roles-attribuables', 'dir');
  assert.deepEqual(r.data.roles, ['directeur', 'caissier']);
  // Plusieurs utilisateurs sur les deux rôles de la démo
  for (const [role, n] of [['caissier', 1], ['caissier', 2], ['caissier', 3], ['directeur', 1]]) {
    r = await nouvel(role, n);
    assert.equal(r.status, 201, `${role} ${n} : ${r.message}`);
  }
  const caissiere = (await sql('SELECT id FROM users WHERE username = $1', [`caissier1-${sfx}`]))[0].id;
  r = await nouvel('auditeur', 1);
  assert.equal(r.status, 403, 'auditeur refusé en démo');
  assert.match(r.message, /démonstration/);
  assert.equal((await appel('PUT', `/users/${caissiere}`, 'dir', { role: 'auditeur' })).status, 403, 'pas de passage en auditeur');
  // Le Super Admin ouvre le rôle Auditeur pour cette démo…
  assert.equal((await appel('PUT', `/plateforme/clients/${p.tenant_id}/roles`, 'dir', { roles: ['directeur', 'caissier', 'auditeur'] })).status, 403);
  r = await appel('PUT', `/plateforme/clients/${p.tenant_id}/roles`, 'admin', { roles: ['directeur', 'caissier', 'auditeur'] });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.personnalise, true);
  assert.equal((await nouvel('auditeur', 1)).status, 201);
  // … mais ne peut pas retirer un rôle encore porté par des utilisateurs actifs.
  r = await appel('PUT', `/plateforme/clients/${p.tenant_id}/roles`, 'admin', { roles: ['directeur'] });
  assert.equal(r.status, 409);
  assert.match(r.message, /Caissier/);
  assert.equal((await appel('PUT', `/plateforme/clients/${p.tenant_id}/roles`, 'admin', { roles: ['comptable_cabinet'] })).status, 400);
  // Retour à la valeur par défaut impossible tant qu'un auditeur est actif ; on le désactive.
  const aud = (await sql('SELECT id FROM users WHERE username = $1', [`auditeur1-${sfx}`]))[0].id;
  assert.equal((await appel('PATCH', `/users/${aud}/actif`, 'dir')).status, 200);
  r = await appel('PUT', `/plateforme/clients/${p.tenant_id}/roles`, 'admin', { roles: null });
  assert.equal(r.status, 200, r.message);
  assert.deepEqual(r.data.roles, ['directeur', 'caissier']);
  // Réactiver l'auditeur : refusé, le rôle n'est plus autorisé.
  r = await appel('PATCH', `/users/${aud}/actif`, 'dir');
  assert.equal(r.status, 403);
  assert.match(r.message, /Réactivation impossible/);
  // Paiement reçu puis conversion en client
  const [fo] = await sql(`INSERT INTO forfaits (code, nom, prix, duree_mois) VALUES ($1, 'Standard', 100000, 12) RETURNING id`, [`STD-${sfx}`]);
  await sql(`INSERT INTO paiements (prospect_id, forfait_id, montant, date_paiement, methode, statut)
             VALUES ($1, $2, 100000, CURRENT_DATE, 'especes', 'recu')`, [p.id, fo.id]);
  r = await appel('POST', `/prospects/${p.id}/conversion`, 'admin', { forfait_id: fo.id, confirmation: true });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.compte_transfere, true);
  const [u] = await sql('SELECT tenant_id FROM users WHERE id = $1', [p.user_id]);
  U.dir.token = jwt.sign({ sub: p.user_id, username: f.email, role: 'directeur', tenantId: u.tenant_id }, SECRET, { expiresIn: '1h' });
  assert.deepEqual((await appel('GET', '/users/roles-attribuables', 'dir')).data.roles, ['directeur', 'caissier', 'auditeur', 'collaborateur']);   // collaborateur : 050
  for (const [role, n] of [['caissier', 7], ['caissier', 8], ['auditeur', 7], ['directeur', 7]]) {
    const x = await nouvel(role, n);
    assert.equal(x.status, 201, `${role} après conversion : ${x.message}`);
  }
});

test('Débit limité par appareil : la route finit par refuser', async () => {
  let dernier;
  for (let i = 0; i < 45 && (!dernier || dernier.status !== 429 || !/appareil/.test(dernier.message || '')); i += 1) {
    dernier = await appel('POST', '/demande-demo/validation-directe', null, { ...formulaire(), identifiant: 'x', validationCode: 'ABCDEF' });
  }
  assert.equal(dernier.status, 429);
  assert.match(dernier.message, /appareil/);
});
