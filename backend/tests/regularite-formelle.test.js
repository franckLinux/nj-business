// tests/regularite-formelle.test.js — Contrôle de régularité formelle (migration 045).
//
//  • pièces séparées par journal (filtres journal, période, référence, statut) ;
//  • colonne « Contrôle » : anomalies constatées saisies à la main, modifiables,
//    levées avec motif, tracées ;
//  • « Confirmer la validation » : validateur + date, pas de double validation,
//    blocage selon les règles (anomalie bloquante, écriture sans compte) ;
//  • réouverture contrôlée (permission + motif) ;
//  • aucun effet sur le journal, les arrêtés de caisse ni les exports.
//
//   TEST_DATABASE_URL=postgres://…/base_de_test  npm run test:regularite-formelle
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
const PORT = 6700 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}/api`;
const sfx = crypto.randomBytes(3).toString('hex');
const pool = new Pool({ connectionString: DB });
const AN = new Date().getFullYear() + 2;
const DU = `${AN}-04-01`;
const AU = `${AN}-04-30`;
let serveur;
let TENANT;
let AUTRE;
let CS1;
let BQ1;
const U = {};
const P = {};

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
const creerUtilisateur = async (cle, role, tenant = TENANT) => {
  const username = `${cle}-${sfx}`;
  const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif)
                          VALUES ($1, $2, $3, 'x', $4, true) RETURNING id`, [tenant, username, `${username}@test.cm`, role]);
  U[cle] = { id: u.id, username, token: jwt.sign({ sub: u.id, username, role, tenantId: tenant }, SECRET, { expiresIn: '1h' }) };
};
const piece = async (tenant, journal, jour, rubrique, { entree = 0, sortie = 0, intitule = 'Pièce' } = {}) => {
  const [r] = await sql(
    `INSERT INTO journal (tenant_id, date, mois, annee, journal_id, type_caisse, rubrique_code, intitule, beneficiaire, nui, entree, sortie)
     VALUES ($1, $2, 'Avril', $3, $4, 'especes', $5, $6, 'PAPETERIE DU CENTRE', 'M050000123456P', $7, $8) RETURNING id`,
    [tenant, `${AN}-04-${String(jour).padStart(2, '0')}`, AN, journal, rubrique, intitule, entree, sortie]);
  return Number(r.id);
};
const liste = async (qs = '', qui = 'cpt') => (await appel('GET', `/controle/pieces?du=${DU}&au=${AU}${qs}`, qui)).data;
const ligne = async (id) => (await liste()).lignes.find((l) => l.id === id);

before(async () => {
  [{ id: TENANT }] = await sql(`INSERT INTO tenants (slug, nom, initialise_le, compte_virements) VALUES ($1, $2, NOW(), '585') RETURNING id`, [`rf-${sfx}`, `RF ${sfx}`]);
  [{ id: AUTRE }] = await sql(`INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id`, [`rf2-${sfx}`, `RF2 ${sfx}`]);
  await sql(`INSERT INTO rubriques (tenant_id, code, intitule, type, code_comptable) VALUES
               ($1, 'D1', 'FOURNITURES', 'depense', '6055'), ($1, 'D2', 'DIVERS', 'depense', '')`, [TENANT]);
  const [d1] = await sql(`SELECT id FROM rubriques WHERE tenant_id = $1 AND code = 'D1'`, [TENANT]);
  await sql(`INSERT INTO equivalences_comptables (tenant_id, rubrique_id, compte, statut) VALUES ($1, $2, '6055', 'valide')`, [TENANT, d1.id]);
  await sql(`INSERT INTO registre_tiers (tenant_id, type, nui, nom) VALUES ($1, 'fournisseur', 'M050000123456P', 'PAPETERIE DU CENTRE')`, [TENANT]);
  [{ id: CS1 }] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type, compte_tresorerie) VALUES ($1, 'CS1', 'Caisse', 'caisse', '571') RETURNING id`, [TENANT]);
  [{ id: BQ1 }] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type, compte_tresorerie) VALUES ($1, 'BQ1', 'Banque', 'banque', '521') RETURNING id`, [TENANT]);
  const [ja] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type) VALUES ($1, 'CS1', 'Caisse', 'caisse') RETURNING id`, [AUTRE]);

  P.c1 = await piece(TENANT, CS1, 2, 'D1', { sortie: 15000, intitule: 'Ramettes' });
  P.c2 = await piece(TENANT, CS1, 3, 'D2', { sortie: 5000, intitule: 'Divers sans compte' });
  P.c3 = await piece(TENANT, CS1, 4, 'D1', { sortie: 7000, intitule: 'Classeurs' });
  P.b1 = await piece(TENANT, BQ1, 5, 'D1', { sortie: 90000, intitule: 'Toner (virement banque)' });
  P.autre = await piece(AUTRE, ja.id, 2, 'X', { sortie: 1000 });
  await sql(`INSERT INTO arrets_caisse (tenant_id, journal_id, mois, annee, solde_final) VALUES ($1, $2, 'Avril', $3, 0)`, [TENANT, CS1, AN]).catch(() => {});

  await creerUtilisateur('dir', 'directeur');
  await creerUtilisateur('cai', 'caissier');
  await creerUtilisateur('cpt', 'auditeur');   // profil « Comptable »
  await creerUtilisateur('aut', 'auditeur', AUTRE);
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
  for (const t of [TENANT, AUTRE]) {
    await sql('DELETE FROM controles_anomalies WHERE tenant_id = $1', [t]).catch(() => {});
    await sql('DELETE FROM controles_pieces WHERE tenant_id = $1', [t]).catch(() => {});
    await sql('DELETE FROM arrets_caisse WHERE tenant_id = $1', [t]).catch(() => {});
    await sql('DELETE FROM journal WHERE tenant_id = $1', [t]).catch(() => {});
    await sql('DELETE FROM tenants WHERE id = $1', [t]).catch(() => {});
  }
  await pool.end();
});

test('Pièces séparées par journal, filtres période / référence / statut', async () => {
  let d = await liste(`&journal_id=${CS1}`);
  assert.deepEqual(d.lignes.map((l) => l.id).sort(), [P.c1, P.c2, P.c3].sort());
  assert.ok(d.lignes.every((l) => l.journal_code === 'CS1' && l.journal_id === CS1));
  d = await liste(`&journal_id=${BQ1}`);
  assert.deepEqual(d.lignes.map((l) => l.id), [P.b1], 'la banque ne se mélange pas à la caisse');
  assert.equal(d.lignes[0].compte_tresorerie, '521');
  const ref = d.lignes[0].reference;
  d = await liste(`&ref=${encodeURIComponent(ref.toLowerCase())}`);
  assert.deepEqual(d.lignes.map((l) => l.id), [P.b1], 'filtre par référence');
  d = await liste(`&journal_id=${CS1}&statut=a_controler`);
  assert.equal(d.lignes.length, 3);
  // Données de chaque pièce conservées.
  const c1 = d.lignes.find((l) => l.id === P.c1);
  assert.equal(c1.libelle, 'Ramettes'); assert.equal(c1.tiers_nom, 'PAPETERIE DU CENTRE');
  assert.equal(c1.debit, 15000); assert.equal(c1.compte, '6055'); assert.deepEqual(c1.anomalies, []);
  assert.deepEqual(c1.anomalies_saisies, []); assert.equal(c1.validable, true);
  assert.equal(d.statuts.controle, 'Validée'); assert.equal(d.statuts.anomalie, 'Anomalies constatées');
});

test('Colonne « Contrôle » : saisie, modification et levée des anomalies, tracées', async () => {
  assert.equal((await appel('POST', `/controle/pieces/${P.c3}/anomalies`, 'cai', { libelle: 'X' })).status, 403);
  assert.equal((await appel('POST', `/controle/pieces/${P.c3}/anomalies`, 'cpt', { libelle: '   ' })).status, 400);
  let r = await appel('POST', `/controle/pieces/${P.c3}/anomalies`, 'cpt', { libelle: 'Libellé imprécis', bloquante: false });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.piece.statut, 'anomalie', 'statut « Anomalies constatées »');
  assert.equal(r.data.piece.anomalies_saisies.length, 1);
  const aid = r.data.piece.anomalies_saisies[0].id;
  assert.equal(r.data.piece.anomalies_saisies[0].cree_par, U.cpt.username);
  // Persistance.
  let l = await ligne(P.c3);
  assert.equal(l.anomalies_saisies[0].libelle, 'Libellé imprécis');
  assert.equal(l.statut_libelle, 'Anomalies constatées');
  // Modification.
  r = await appel('PUT', `/controle/anomalies/${aid}`, 'cpt', { libelle: 'Libellé imprécis : préciser le matériel', bloquante: true });
  assert.equal(r.status, 200, r.message);
  l = await ligne(P.c3);
  assert.equal(l.anomalies_saisies[0].libelle, 'Libellé imprécis : préciser le matériel');
  assert.equal(l.anomalies_saisies[0].bloquante, true);
  assert.equal(l.validable, false);
  // Bloquante : validation refusée avec explication.
  r = await appel('POST', `/controle/pieces/${P.c3}/validation`, 'cpt', {});
  assert.equal(r.status, 409); assert.match(r.message, /Anomalie bloquante : Libellé imprécis/);
  // Levée : motif obligatoire, ensuite plus modifiable.
  assert.equal((await appel('POST', `/controle/anomalies/${aid}/levee`, 'cpt', { motif: '' })).status, 400);
  r = await appel('POST', `/controle/anomalies/${aid}/levee`, 'cpt', { motif: 'Libellé complété par la caissière.' });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.piece.statut, 'en_cours');
  assert.equal(r.data.piece.anomalies_saisies[0].statut, 'levee', 'l\'anomalie reste visible');
  assert.equal((await appel('PUT', `/controle/anomalies/${aid}`, 'cpt', { libelle: 'Y' })).status, 409);
  // Isolation : un autre client ne voit ni ne modifie l'anomalie.
  assert.equal((await appel('PUT', `/controle/anomalies/${aid}`, 'aut', { libelle: 'Y' })).status, 404);
  const h = (await appel('GET', `/controle/pieces/${P.c3}/historique`, 'cpt')).data;
  const actions = h.map((x) => x.action);
  for (const a of ['CONTROLE_ANOMALIE_AJOUT', 'CONTROLE_ANOMALIE_MODIF', 'CONTROLE_ANOMALIE_LEVEE']) assert.ok(actions.includes(a), a);
});

test('Confirmer la validation : validateur et date, une seule fois, pièce verrouillée', async () => {
  const avant = await sql('SELECT id, sortie, rubrique_code, exporte_sage FROM journal WHERE tenant_id = $1 ORDER BY id', [TENANT]);
  const [{ n: arrets }] = await sql('SELECT COUNT(*)::int AS n FROM arrets_caisse WHERE tenant_id = $1', [TENANT]);

  let r = await appel('POST', `/controle/pieces/${P.c1}/validation`, 'cai', {});
  assert.equal(r.status, 403);
  r = await appel('POST', `/controle/pieces/${P.c1}/validation`, 'cpt', {});
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.piece.statut, 'controle');
  assert.equal(r.data.piece.statut_libelle, 'Validée');
  assert.equal(r.data.piece.controle_par, U.cpt.username);
  assert.ok(r.data.piece.controle_le);
  // Après actualisation.
  const l = await ligne(P.c1);
  assert.equal(l.statut, 'controle'); assert.equal(l.controle_par, U.cpt.username);
  // Pas de seconde validation.
  r = await appel('POST', `/controle/pieces/${P.c1}/validation`, 'cpt', {});
  assert.equal(r.status, 409); assert.match(r.message, /déjà validée par/);
  // Verrouillée : ni observation, ni anomalie, ni compte.
  assert.equal((await appel('PUT', `/controle/pieces/${P.c1}`, 'cpt', { observation: 'x' })).status, 409);
  assert.equal((await appel('POST', `/controle/pieces/${P.c1}/anomalies`, 'cpt', { libelle: 'x' })).status, 409);

  // Écriture sans compte : bloquée même avec une observation.
  r = await appel('POST', `/controle/pieces/${P.c2}/validation`, 'cpt', { observation: 'Vu' });
  assert.equal(r.status, 409); assert.match(r.message, /Code comptable manquant/);

  // Anomalie non bloquante ouverte : la validation reste possible.
  r = await appel('POST', `/controle/pieces/${P.b1}/anomalies`, 'cpt', { libelle: 'Référence du virement à reporter', bloquante: false });
  assert.equal(r.data.piece.validable, true);
  r = await appel('POST', `/controle/pieces/${P.b1}/validation`, 'dir', {});
  assert.equal(r.status, 200, r.message);

  // Aucun effet sur le journal, les arrêtés ni les exports.
  const apres = await sql('SELECT id, sortie, rubrique_code, exporte_sage FROM journal WHERE tenant_id = $1 ORDER BY id', [TENANT]);
  assert.deepEqual(apres, avant);
  assert.ok(apres.every((x) => x.exporte_sage === false));
  const [{ n: arrets2 }] = await sql('SELECT COUNT(*)::int AS n FROM arrets_caisse WHERE tenant_id = $1', [TENANT]);
  assert.equal(arrets2, arrets);
});

test('Réouverture contrôlée : permission, motif, traçabilité', async () => {
  assert.equal((await appel('POST', `/controle/pieces/${P.c1}/reouverture`, 'dir', { motif: 'x' })).status, 403, 'réservée au comptable');
  assert.equal((await appel('POST', `/controle/pieces/${P.c1}/reouverture`, 'cpt', { motif: ' ' })).status, 400);
  assert.equal((await appel('POST', `/controle/pieces/${P.c3}/reouverture`, 'cpt', { motif: 'x' })).status, 409, 'pièce non validée');
  let r = await appel('POST', `/controle/pieces/${P.c1}/reouverture`, 'cpt', { motif: 'Imputation à revoir' });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.piece.statut, 'en_cours');
  assert.equal(r.data.piece.controle_par, null);
  assert.equal(r.data.piece.reouverture.motif, 'Imputation à revoir');
  assert.equal(r.data.piece.reouverture.par, U.cpt.username);
  // Rouverte avec une anomalie encore ouverte : « Anomalies constatées ».
  r = await appel('POST', `/controle/pieces/${P.b1}/reouverture`, 'cpt', { motif: 'Compléter' });
  assert.equal(r.data.piece.statut, 'anomalie');
  // Modifiable de nouveau, puis revalidable.
  assert.equal((await appel('PUT', `/controle/pieces/${P.c1}`, 'cpt', { observation: 'Revu.' })).status, 200);
  assert.equal((await appel('POST', `/controle/pieces/${P.c1}/validation`, 'cpt', {})).status, 200);
  const h = (await appel('GET', `/controle/pieces/${P.c1}/historique`, 'cpt')).data;
  const actions = h.map((x) => x.action);
  assert.equal(actions.filter((a) => a === 'CONTROLE_VALIDATION').length, 2);
  assert.ok(actions.includes('CONTROLE_REOUVERTURE'));
  assert.ok(h.every((x) => x.par && x.le));
  assert.equal((await appel('GET', `/controle/pieces/${P.autre}/historique`, 'cpt')).status, 404);
});

test('Règles de blocage (24/10/2026) : tiers non identifié bloque ; trésorerie manquante et NUI seulement signalés', async () => {
  const brut = async (journal, jour, benef, nui) => Number((await sql(
    `INSERT INTO journal (tenant_id, date, mois, annee, journal_id, type_caisse, rubrique_code, intitule, beneficiaire, nui, entree, sortie)
     VALUES ($1, $2, 'Avril', $3, $4, 'especes', 'D1', 'Achat', $5, $6, 0, 1000) RETURNING id`,
    [TENANT, `${AN}-04-${String(jour).padStart(2, '0')}`, AN, journal, benef, nui]))[0].id);
  // Tiers non identifié : bloquant, même avec une observation.
  const sansTiers = await brut(CS1, 20, '', '');
  let l = await ligne(sansTiers);
  assert.equal(l.validable, false);
  let r = await appel('POST', `/controle/pieces/${sansTiers}/validation`, 'cpt', { observation: 'Vu' });
  assert.equal(r.status, 409); assert.match(r.message, /Tiers non identifié/);
  // Journal sans compte de trésorerie et tiers sans NUI : signalés, validation possible sans observation.
  const [{ id: om }] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type) VALUES ($1, 'OM1', 'Orange Money', 'om') RETURNING id`, [TENANT]);
  const signale = await brut(om, 21, 'QUINCAILLERIE NOUVELLE', '');
  l = await ligne(signale);
  assert.ok(l.anomalies.includes('tresorerie_manquante')); assert.ok(l.anomalies.includes('nui_manquant'));
  assert.equal(l.validable, true);
  r = await appel('POST', `/controle/pieces/${signale}/validation`, 'cpt', {});
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.piece.statut, 'controle');
});
