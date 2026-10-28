// tests/controle-ajustement.test.js — Ajustement du contrôle comptable (migration 044).
//
//  • la caissière ajoute des rubriques, sans droit comptable ;
//  • à la saisie E/S, le tiers du registre (NUI, nom, téléphone, compte tiers)
//    est retrouvé automatiquement ;
//  • profil « Comptable » (ex-Auditeur) : corrige le code comptable d'une
//    opération et saisit l'observation à la main ;
//  • la passerelle (simulation) utilise le compte corrigé tant que l'opération
//    n'est pas transmise ; après transmission, la correction est refusée.
//
// Lance le VRAI serveur (index.js) sur une base de TEST, puis appelle l'API.
//   TEST_DATABASE_URL=postgres://…/base_de_test  npm run test:controle-ajustement
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
const MOIS = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
const auj = new Date();
const JOUR = auj.toISOString().slice(0, 10);
const M = MOIS[auj.getMonth()];
const AN = auj.getFullYear();
const DU = `${JOUR.slice(0, 8)}01`;
let serveur;
let TENANT;
let CS1;
const U = {};
const T = {};   // tiers du registre
const P = {};   // opérations

const sql = async (texte, params = []) => (await pool.query(texte, params)).rows;
const appel = async (methode, url, qui, corps) => {
  const r = await fetch(BASE + url, {
    method: methode,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${U[qui].token}` },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.data ?? j, message: j.message ?? j.error, avertissement: (j.data ?? j).avertissement };
};
const creerUtilisateur = async (cle, role) => {
  const username = `${cle}-${sfx}`;
  const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif)
                          VALUES ($1, $2, $3, 'x', $4, true) RETURNING id`, [TENANT, username, `${username}@test.cm`, role]);
  U[cle] = { id: u.id, token: jwt.sign({ sub: u.id, username, role, tenantId: TENANT }, SECRET, { expiresIn: '1h' }) };
};
const saisie = (corps) => appel('POST', '/journal', 'cai', {
  date: JOUR, mois: M, annee: AN, journal_id: CS1, intitule: 'Test', entree: 0, sortie: 0, ...corps,
});
const liste = async (qui = 'cpt') => (await appel('GET', `/controle/pieces?du=${DU}&au=${JOUR}`, qui)).data;
const ligne = async (id, qui) => (await liste(qui)).lignes.find((l) => l.id === id);
const simulation = async () => (await appel('GET', `/passerelle/simulation?mois=${M}&annee=${AN}`, 'cpt')).data;

before(async () => {
  [{ id: TENANT }] = await sql(`INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id`, [`ajc-${sfx}`, `AJC ${sfx}`]);
  await sql(`INSERT INTO rubriques (tenant_id, code, intitule, type, code_comptable, est_virement_interne) VALUES
               ($1, 'E1', 'VENTES', 'entree', '701', false),
               ($1, 'D1', 'FOURNITURES', 'depense', '6055', false),
               ($1, 'VIR', 'VIREMENT', 'entree', '', true)`, [TENANT]);
  for (const [code, compte] of [['E1', '701'], ['D1', '6055']]) {
    const [r] = await sql('SELECT id FROM rubriques WHERE tenant_id = $1 AND code = $2', [TENANT, code]);
    await sql(`INSERT INTO equivalences_comptables (tenant_id, rubrique_id, compte, statut) VALUES ($1, $2, $3, 'valide')`, [TENANT, r.id, compte]);
  }
  [{ id: CS1 }] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type, compte_tresorerie, date_ouverture)
                             VALUES ($1, 'CS1', 'Caisse', 'caisse', '571', CURRENT_DATE - 40) RETURNING id`, [TENANT]);
  await creerUtilisateur('dir', 'directeur');
  await creerUtilisateur('cai', 'caissier');
  await creerUtilisateur('cpt', 'auditeur');   // profil « Comptable » (code technique inchangé)
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
  await sql('DELETE FROM controles_pieces WHERE tenant_id = $1', [TENANT]).catch(() => {});
  await sql('DELETE FROM journal WHERE tenant_id = $1 AND annulation_de_id IS NOT NULL', [TENANT]).catch(() => {});
  await sql('DELETE FROM journal WHERE tenant_id = $1', [TENANT]).catch(() => {});
  await sql('DELETE FROM tenants WHERE id = $1', [TENANT]).catch(() => {});
  await pool.end();
});

test('Profil « Comptable » (ex-Auditeur) : libellé et droits du contrôle, rien de plus', async () => {
  const [r] = await sql(`SELECT nom FROM roles WHERE code = 'auditeur' AND tenant_id IS NULL AND is_system`);
  assert.equal(r.nom, 'Comptable');
  const me = (await appel('GET', '/auth/me', 'cpt')).data;
  const perms = me.permissions || me.user?.permissions || [];
  if (perms.length) {
    for (const p of ['controle.view', 'controle.saisir', 'controle.compte', 'journal.view', 'rapport.view']) assert.ok(perms.includes(p), p);
    for (const p of ['journal.create', 'rubriques.edit', 'passerelle.valider']) assert.ok(!perms.includes(p), `${p} non accordé`);
  }
  // Le comptable ne saisit pas en caisse.
  assert.equal((await appel('POST', '/journal', 'cpt', {
    date: JOUR, mois: M, annee: AN, journal_id: CS1, rubrique_code: 'E1', intitule: 'X', entree: 100, sortie: 0 })).status, 403);
  // Les autres profils gardent leurs droits : le caissier n'accède pas au contrôle.
  assert.equal((await appel('GET', `/controle/pieces?du=${DU}&au=${JOUR}`, 'cai')).status, 403);
  assert.equal((await appel('GET', `/controle/pieces?du=${DU}&au=${JOUR}`, 'dir')).status, 200);
});

test('La caissière ajoute une rubrique, sans code comptable ni virement interne', async () => {
  let r = await appel('POST', '/rubriques', 'cai', { code: 'trx', intitule: 'TRANSPORT EXCEPTIONNEL', type: 'depense', code_comptable: '6181', est_virement_interne: true });
  assert.equal(r.status, 201, r.message);
  assert.equal(r.data.code, 'TRX');
  assert.equal(r.data.code_comptable, '', 'le compte relève du comptable');
  assert.equal(r.data.est_virement_interne, false);
  assert.match(r.data.message, /comptable/);
  // Ni modification ni suppression : pas de droit « Gérer les rubriques ».
  assert.equal((await appel('PUT', `/rubriques/${r.data.id}`, 'cai', { intitule: 'X', code_comptable: '6181' })).status, 403);
  assert.equal((await appel('DELETE', `/rubriques/${r.data.id}`, 'cai')).status, 403);
  // Le directeur garde la création complète.
  r = await appel('POST', '/rubriques', 'dir', { code: 'LOY', intitule: 'LOYER', type: 'depense', code_comptable: '6222' });
  assert.equal(r.status, 201, r.message);
  assert.equal(r.data.code_comptable, '6222');
  // Le comptable (lecture des rubriques) ne crée pas de rubrique.
  assert.equal((await appel('POST', '/rubriques', 'cpt', { code: 'Z', intitule: 'Z', type: 'depense' })).status, 403);
});

test('Registre : compte tiers de classe 4, rattaché à un collectif du plan, unique', async () => {
  let r = await appel('POST', '/registre-tiers', 'cpt', { type: 'fournisseur', nom: 'PAPETERIE DU CENTRE', nui: 'M050000123456P', telephone: '699111111', compte_tiers: '401 papcen' });
  assert.equal(r.status, 201, r.message);
  assert.equal(r.data.tiers.compte_tiers, '401PAPCEN', 'normalisé');
  T.pap = r.data.tiers.id;
  r = await appel('POST', '/registre-tiers', 'cpt', { type: 'client', nom: 'CLIENT ALPHA', telephone: '677000000' });
  assert.equal(r.status, 201, r.message);
  T.alpha = r.data.tiers.id;
  assert.equal((await appel('POST', '/registre-tiers', 'cpt', { nom: 'X1', compte_tiers: '601ABC' })).status, 400, 'classe 6 refusée');
  r = await appel('POST', '/registre-tiers', 'cpt', { nom: 'X2', compte_tiers: '400ABC' });
  assert.equal(r.status, 400, 'collectif absent du plan');
  assert.match(r.message, /collectif 400/);
  r = await appel('POST', '/registre-tiers', 'cpt', { nom: 'X3', compte_tiers: '401PAPCEN' });
  assert.equal(r.status, 409);
  assert.match(r.message, /PAPETERIE DU CENTRE/);
});

test('Saisie E/S : le tiers et son compte tiers se remplissent automatiquement', async () => {
  // Aide à la saisie, ouverte à la caissière (lecture seule, champs utiles).
  let r = await appel('GET', '/registre-tiers/saisie?sens=sortie', 'cai');
  assert.equal(r.status, 200, r.message);
  const pap = r.data.find((t) => t.id === T.pap);
  assert.equal(pap.compte_effectif, '401PAPCEN');
  assert.equal(pap.telephone, '699111111');
  assert.ok(!r.data.some((t) => t.id === T.alpha), 'un client n\'est pas proposé pour une sortie');
  r = await appel('GET', '/registre-tiers/saisie?sens=entree', 'cai');
  assert.equal(r.data.find((t) => t.id === T.alpha).compte_effectif, '411', 'collectif client par défaut');
  assert.equal((await appel('GET', '/registre-tiers', 'cai')).status, 403, 'le registre complet reste au contrôle');

  // 1. Tiers choisi à la saisie : bénéficiaire et téléphone complétés par la base.
  r = await saisie({ rubrique_code: 'E1', intitule: 'Vente comptoir', entree: 500000, tiers_id: T.alpha });
  assert.equal(r.status, 201, r.message);
  P.parNom = Number(r.data.id);
  let [j] = await sql('SELECT tiers_id, beneficiaire, telephone FROM journal WHERE id = $1', [P.parNom]);
  assert.equal(Number(j.tiers_id), T.alpha);
  assert.equal(j.beneficiaire, 'CLIENT ALPHA'); assert.equal(j.telephone, '677000000');
  // 2. Nom seul, identique et unique (casse et espaces ignorés) : tiers retrouvé.
  r = await saisie({ rubrique_code: 'E1', intitule: 'Vente', entree: 80000, beneficiaire: '  client   alpha ' });
  assert.equal(r.status, 201, r.message);
  [j] = await sql('SELECT tiers_id FROM journal WHERE id = $1', [r.data.id]);
  assert.equal(Number(j.tiers_id), T.alpha);
  // 3. NUI seul (espaces, minuscules) : tiers retrouvé, nom et téléphone complétés.
  r = await saisie({ rubrique_code: 'E1', intitule: 'Remboursement trop-perçu', entree: 1000, nui: 'm0500 0012 3456p' });
  assert.equal(r.status, 201, r.message);
  [j] = await sql('SELECT tiers_id, beneficiaire, telephone FROM journal WHERE id = $1', [r.data.id]);
  assert.equal(Number(j.tiers_id), T.pap); assert.equal(j.beneficiaire, 'PAPETERIE DU CENTRE'); assert.equal(j.telephone, '699111111');
  // Sorties validées (hors contrôle budgétaire, sans objet ici) : même rattachement par la base.
  const sortie = async (montant, intitule, nui) => Number((await sql(
    `INSERT INTO journal (tenant_id, date, mois, annee, journal_id, type_caisse, rubrique_code, intitule, nui, sortie, created_by)
     VALUES ($1, $2, $3, $4, $5, 'especes', 'D1', $6, $7, $8, $9) RETURNING id`, [TENANT, JOUR, M, AN, CS1, intitule, nui, montant, U.cai.id]))[0].id);
  P.choisi = await sortie(15000, 'Ramettes', 'M050000123456P');
  P.parNui = await sortie(2000, 'Stylos', 'M050000123456P');
  [j] = await sql('SELECT tiers_id, beneficiaire FROM journal WHERE id = $1', [P.choisi]);
  assert.equal(Number(j.tiers_id), T.pap); assert.equal(j.beneficiaire, 'PAPETERIE DU CENTRE');
  // 4. Inconnu : aucun rattachement inventé.
  r = await saisie({ rubrique_code: 'E1', intitule: 'Divers', entree: 3000, beneficiaire: 'PASSANT INCONNU' });
  assert.equal(r.status, 201, r.message);
  P.inconnu = Number(r.data.id);
  [j] = await sql('SELECT tiers_id FROM journal WHERE id = $1', [P.inconnu]);
  assert.equal(j.tiers_id, null);
  // Tiers d'un autre client ou inexistant : refusé.
  assert.equal((await saisie({ rubrique_code: 'E1', entree: 10, tiers_id: 999999999 })).status, 400);
  // Correction du bénéficiaire par la caissière : ré-identification.
  r = await appel('PUT', `/journal/${P.inconnu}`, 'cai', { beneficiaire: 'Client Alpha' });
  assert.equal(r.status, 200, r.message);
  [j] = await sql('SELECT tiers_id FROM journal WHERE id = $1', [P.inconnu]);
  assert.equal(Number(j.tiers_id), T.alpha);
  r = await appel('PUT', `/journal/${P.inconnu}`, 'cai', { beneficiaire: 'PASSANT INCONNU' });
  [j] = await sql('SELECT tiers_id FROM journal WHERE id = $1', [P.inconnu]);
  assert.equal(j.tiers_id, null);

  // Le contrôle affiche le compte tiers du registre (ou le collectif).
  const d = await liste();
  assert.equal(d.lignes.find((l) => l.id === P.choisi).compte_tiers, '401PAPCEN');
  assert.equal(d.lignes.find((l) => l.id === P.choisi).compte_tiers_source, 'registre');
  const nom = d.lignes.find((l) => l.id === P.parNom);
  assert.equal(nom.compte_tiers, '411'); assert.equal(nom.compte_tiers_source, 'collectif');
  assert.equal(d.lignes.find((l) => l.id === P.inconnu).compte_tiers, '');
});

test('Correction du code comptable : réservée au comptable, conforme au plan, sans toucher l\'écriture', async () => {
  let l = await ligne(P.choisi);
  assert.equal(l.compte, '6055'); assert.equal(l.compte_etat, 'valide');
  // Le directeur observe mais ne corrige pas l'imputation.
  let r = await appel('PUT', `/controle/pieces/${P.choisi}`, 'dir', { compte_corrige: '6056', observation: '' });
  assert.equal(r.status, 403);
  r = await appel('PUT', `/controle/pieces/${P.choisi}`, 'cai', { compte_corrige: '6056' });
  assert.equal(r.status, 403);
  // Règles du plan : inexistant, regroupement, sens contraire.
  assert.equal((await appel('PUT', `/controle/pieces/${P.choisi}`, 'cpt', { compte_corrige: '6099999' })).status, 400);
  r = await appel('PUT', `/controle/pieces/${P.choisi}`, 'cpt', { compte_corrige: '605' });
  assert.equal(r.status, 400); assert.match(r.message, /regroupement/);
  r = await appel('PUT', `/controle/pieces/${P.choisi}`, 'cpt', { compte_corrige: '7011' });
  assert.equal(r.status, 400); assert.match(r.message, /produit/);
  // Correction acceptée.
  r = await appel('PUT', `/controle/pieces/${P.choisi}`, 'cpt', { compte_corrige: '6056' });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.piece.compte, '6056');
  assert.equal(r.data.piece.compte_etat, 'corrige');
  assert.equal(r.data.piece.compte_rubrique, '6055');
  assert.ok(r.data.piece.compte_corrige_par);
  assert.equal(r.data.piece.observation, '', 'aucune observation générée automatiquement');
  // Persistance (relecture) et écriture d'origine intacte.
  l = await ligne(P.choisi);
  assert.equal(l.compte, '6056');
  const [j] = await sql('SELECT rubrique_code, sortie, date::text AS date, exporte_sage FROM journal WHERE id = $1', [P.choisi]);
  assert.equal(j.rubrique_code, 'D1'); assert.equal(parseFloat(j.sortie), 15000); assert.equal(j.date, JOUR); assert.equal(j.exporte_sage, false);
  const [a] = await sql(`SELECT COUNT(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND action = 'CONTROLE_COMPTE_CORRIGE'`, [TENANT]);
  assert.equal(a.n, 1);
  // Classe inhabituelle : acceptée avec avertissement.
  r = await appel('PUT', `/controle/pieces/${P.parNui}`, 'cpt', { compte_corrige: '421' });
  assert.equal(r.status, 200, r.message);
  assert.ok(r.data.avertissement, 'avertissement attendu (classe 4)');
  r = await appel('PUT', `/controle/pieces/${P.parNui}`, 'cpt', { compte_corrige: '' });
  assert.equal(r.status, 200, r.message);
  // Le directeur, sans le droit, enregistre son observation : le compte corrigé est conservé.
  r = await appel('PUT', `/controle/pieces/${P.choisi}`, 'dir', { observation: 'Petit matériel et non fournitures.', compte_corrige: '6056' });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.piece.compte, '6056');
});

test('Observation : saisie manuelle par le comptable, enregistrée et modifiable', async () => {
  let r = await appel('PUT', `/controle/pieces/${P.parNom}`, 'cpt', { observation: 'Encaissement à rapprocher de la facture client n° 12.', statut: 'en_cours' });
  assert.equal(r.status, 200, r.message);
  r = await appel('PUT', `/controle/pieces/${P.parNom}`, 'cpt', { observation: 'Rapproché.', statut: 'controle' });
  assert.equal(r.status, 200, r.message);
  const l = await ligne(P.parNom);
  assert.equal(l.observation, 'Rapproché.');
  assert.equal(l.statut, 'controle');
  // Opération sans observation : reste vide (rien n'est déduit du tiers, du compte ou du montant).
  assert.equal((await ligne(P.inconnu)).observation, '');
});

test('Passerelle : la simulation reprend le compte corrigé ; transmise, l\'opération ne se corrige plus', async () => {
  let s = await simulation();
  const comptes = s.balance.map((b) => b.compte);
  assert.ok(comptes.includes('6056'), 'compte corrigé imputé');
  const b6055 = s.balance.find((b) => b.compte === '6055');
  // 6055 ne porte plus que les opérations non corrigées.
  const att = (await liste()).lignes.filter((x) => x.compte === '6055').reduce((t, x) => t + x.debit, 0);
  assert.equal(b6055 ? b6055.debit : 0, att);
  assert.ok(s.controles.some((c) => c.code === 'corrections'));
  assert.equal(s.totaux.debit, s.totaux.credit);
  // Simple consultation : rien n'est exporté.
  const [n] = await sql('SELECT COUNT(*)::int AS n FROM journal WHERE tenant_id = $1 AND exporte_sage', [TENANT]);
  assert.equal(n.n, 0);
  // Rétablir le compte de la rubrique.
  let r = await appel('PUT', `/controle/pieces/${P.choisi}`, 'cpt', { compte_corrige: '' });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.piece.compte, '6055'); assert.equal(r.data.piece.compte_etat, 'valide');
  r = await appel('PUT', `/controle/pieces/${P.choisi}`, 'cpt', { compte_corrige: '6056' });
  assert.equal(r.status, 200);
  // Transmise (export) : correction refusée, contre-passation indiquée.
  await sql('UPDATE journal SET exporte_sage = true WHERE id = $1', [P.choisi]);
  r = await appel('PUT', `/controle/pieces/${P.choisi}`, 'cpt', { compte_corrige: '6055' });
  assert.equal(r.status, 409); assert.match(r.message, /contre-passation/);
  // L'observation reste possible sur une opération transmise.
  r = await appel('PUT', `/controle/pieces/${P.choisi}`, 'cpt', { observation: 'Vu après export.', compte_corrige: '6056' });
  assert.equal(r.status, 200, r.message);
  s = await simulation();
  assert.ok(s.controles.some((c) => c.code === 'exportees'));
  // Virement interne : compte des virements, non corrigeable ici.
  r = await saisie({ rubrique_code: 'VIR', intitule: 'Virement', entree: 1000 });
  assert.equal(r.status, 201, r.message);
  assert.equal((await appel('PUT', `/controle/pieces/${r.data.id}`, 'cpt', { compte_corrige: '6056' })).status, 409);
});
