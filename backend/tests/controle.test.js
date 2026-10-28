// tests/controle.test.js — Contrôle comptable des pièces (migrations 042-044).
// 044 : contrôle comptable seulement (plus de contrôle documentaire) ; le
// profil « auditeur » devient « Comptable » et saisit le contrôle.
//
// Lance le VRAI serveur (index.js) sur une base de TEST, puis appelle l'API.
//   TEST_DATABASE_URL=postgres://…/base_de_test  npm run test:controle
// La base doit être migrée jusqu'à 042. Aucune base n'est utilisée sans
// TEST_DATABASE_URL explicite.
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
const PORT = 5800 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}/api`;
const sfx = crypto.randomBytes(3).toString('hex');
const pool = new Pool({ connectionString: DB });
const AN = new Date().getFullYear() + 1;
const DU = `${AN}-03-01`;
const AU = `${AN}-03-31`;
let serveur;
let TENANT;
let AUTRE;
let CS1;
let BQ1;
const U = {};
const P = {};   // pièces créées

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
const creerUtilisateur = async (cle, role, tenant) => {
  const username = `${cle}-${sfx}`;
  const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif)
                          VALUES ($1, $2, $3, 'x', $4, true) RETURNING id`, [tenant, username, `${username}@test.cm`, role]);
  U[cle] = { id: u.id, token: jwt.sign({ sub: u.id, username, role, tenantId: tenant }, SECRET, { expiresIn: '1h' }) };
};
const piece = async (tenant, journal, jour, rubrique, { entree = 0, sortie = 0, nui = '', benef = '', intitule = 'Pièce', annulationDe = null } = {}) => {
  const [r] = await sql(
    `INSERT INTO journal (tenant_id, date, mois, annee, journal_id, type_caisse, rubrique_code, intitule, beneficiaire, nui, entree, sortie, annulation_de_id)
     VALUES ($1, $2, 'Mars', $3, $4, 'especes', $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [tenant, `${AN}-03-${String(jour).padStart(2, '0')}`, AN, journal, rubrique, intitule, benef, nui, entree, sortie, annulationDe]);
  return Number(r.id);
};
const liste = async (qs = '', qui = 'dir') => (await appel('GET', `/controle/pieces?du=${DU}&au=${AU}${qs}`, qui)).data;
const ligne = (data, id) => data.lignes.find((l) => l.id === id);

before(async () => {
  [{ id: TENANT }] = await sql(`INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id`, [`ctl-${sfx}`, `CTL ${sfx}`]);
  [{ id: AUTRE }] = await sql(`INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id`, [`ctl2-${sfx}`, `CTL2 ${sfx}`]);
  await sql(`INSERT INTO rubriques (tenant_id, code, intitule, type, code_comptable, est_virement_interne) VALUES
               ($1, 'D1', 'FOURNITURES', 'depense', '6055', false),
               ($1, 'D2', 'TRANSPORT', 'depense', '618', false),
               ($1, 'E1', 'VENTES', 'entree', '', false),
               ($1, 'V1', 'VIREMENT CAISSE BANQUE', 'depense', '', true)`, [TENANT]);
  const [d1] = await sql(`SELECT id FROM rubriques WHERE tenant_id = $1 AND code = 'D1'`, [TENANT]);
  await sql(`INSERT INTO equivalences_comptables (tenant_id, rubrique_id, compte, statut) VALUES ($1, $2, '6055', 'valide')`, [TENANT, d1.id]);
  [{ id: CS1 }] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type, compte_tresorerie) VALUES ($1, 'CS1', 'Caisse', 'caisse', '571') RETURNING id`, [TENANT]);
  [{ id: BQ1 }] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type, compte_tresorerie) VALUES ($1, 'BQ1', 'Banque', 'banque', '') RETURNING id`, [TENANT]);
  const [ja] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type) VALUES ($1, 'CS1', 'Caisse', 'caisse') RETURNING id`, [AUTRE]);

  P.ok = await piece(TENANT, CS1, 2, 'D1', { sortie: 15000, nui: 'M050000123456P', benef: 'PAPETERIE DU CENTRE', intitule: 'Ramettes' });
  P.vide = await piece(TENANT, CS1, 3, 'D2', { sortie: 5000, intitule: 'Taxi' });
  P.vente = await piece(TENANT, CS1, 4, 'E1', { entree: 80000, nui: 'P012345678901Q', benef: 'CLIENT A', intitule: 'Vente' });
  P.vir = await piece(TENANT, BQ1, 5, 'V1', { sortie: 100000, intitule: 'Virement' });
  P.homonyme = await piece(TENANT, CS1, 6, 'D1', { sortie: 2000, nui: 'M050000123456P', benef: 'PAPETERIE CENTRALE', intitule: 'Stylos' });
  // Pièce annulée et sa contre-passation : hors contrôle.
  P.annulee = await piece(TENANT, CS1, 7, 'D2', { sortie: 3000, intitule: 'Erreur' });
  const contre = await piece(TENANT, CS1, 7, 'D2', { sortie: -3000, intitule: 'Annulation', annulationDe: P.annulee });
  await sql('UPDATE journal SET annule = true, annule_par_id = $2 WHERE id = $1', [P.annulee, contre]);
  P.autre = await piece(AUTRE, ja.id, 2, 'X', { sortie: 1000 });

  await creerUtilisateur('dir', 'directeur', TENANT);
  await creerUtilisateur('cai', 'caissier', TENANT);
  await creerUtilisateur('aud', 'auditeur', TENANT);
  serveur = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: DB, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test', SMTP_HOST: '', RATE_LIMIT_MAX: '100000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = (x) => process.env.DEBUG_TEST && process.stderr.write(x);
  serveur.stdout.on('data', log); serveur.stderr.on('data', log);
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* démarrage */ }
    await new Promise((r) => setTimeout(r, 250));
  }
});
after(async () => {
  serveur?.kill();
  for (const t of [TENANT, AUTRE]) {
    await sql('DELETE FROM controles_pieces WHERE tenant_id = $1', [t]).catch(() => {});
    await sql('DELETE FROM journal WHERE tenant_id = $1 AND annulation_de_id IS NOT NULL', [t]).catch(() => {});
    await sql('DELETE FROM journal WHERE tenant_id = $1', [t]).catch(() => {});
    await sql('DELETE FROM tenants WHERE id = $1', [t]).catch(() => {});
  }
  await pool.end();
});

test('Permissions : caissier exclu, comptable (ex-auditeur) et directeur en saisie', async () => {
  assert.equal((await appel('GET', `/controle/pieces?du=${DU}&au=${AU}`, 'cai')).status, 403);
  assert.equal((await appel('PUT', `/controle/pieces/${P.ok}`, 'cai', { statut: 'en_cours' })).status, 403);
  assert.equal((await appel('GET', `/controle/pieces?du=${DU}&au=${AU}`, 'aud')).status, 200);
  const r = await appel('PUT', `/controle/pieces/${P.ok}`, 'aud', { statut: 'a_controler' });
  assert.equal(r.status, 200, r.message);
  assert.equal((await appel('GET', '/controle/pieces', 'dir')).status, 400, 'période obligatoire');
});

test('Liste : pièces réelles, comptes, débit/crédit, tiers prérempli, annulations exclues', async () => {
  const d = await liste();
  const ids = d.lignes.map((l) => l.id);
  assert.ok(!ids.includes(P.annulee), 'pièce annulée exclue');
  assert.equal(d.lignes.length, 5, 'ni la contre-passation ni le client voisin');
  assert.ok(!ids.includes(P.autre));

  const ok = ligne(d, P.ok);
  assert.equal(ok.compte, '6055'); assert.equal(ok.compte_etat, 'valide');
  assert.equal(ok.compte_tresorerie, '571');
  assert.equal(ok.debit, 15000); assert.equal(ok.credit, 0);
  assert.equal(ok.tiers_nui, 'M050000123456P'); assert.equal(ok.tiers_nom, 'PAPETERIE DU CENTRE');
  assert.equal(ok.statut, 'a_controler');
  assert.match(ok.reference, /^CS1-\d+$/);

  const vide = ligne(d, P.vide);
  assert.equal(vide.compte, '618'); assert.equal(vide.compte_etat, 'non_valide', 'compte de la rubrique non validé dans la passerelle');
  assert.deepEqual(vide.anomalies.sort(), ['compte_non_valide', 'nom_manquant', 'nui_manquant'].sort(), 'aucune anomalie documentaire');
  assert.ok(ok.anomalies.includes('tiers_hors_registre'), 'NUI absent du registre');
  assert.equal(ok.piece, undefined, 'plus de bloc « pièce justificative »');

  const vente = ligne(d, P.vente);
  assert.equal(vente.credit, 80000); assert.equal(vente.compte, '', 'aucun compte inventé');
  assert.ok(vente.anomalies.includes('compte_manquant'));

  const vir = ligne(d, P.vir);
  assert.equal(vir.compte, '585', 'virement interne : compte des virements');
  assert.ok(!vir.anomalies.includes('nui_manquant'), 'pas de tiers pour un virement interne');
  assert.ok(vir.anomalies.includes('tresorerie_manquante'), 'BQ1 sans compte de trésorerie');

  assert.ok(ligne(d, P.ok).anomalies.includes('tiers_incoherent'), 'même NUI, deux noms');
  assert.ok(ligne(d, P.homonyme).anomalies.includes('tiers_incoherent'));
});

test('Statuts : validation bloquée seulement par tiers non identifié, code manquant ou anomalie bloquante ; « Anomalie » exige une observation', async () => {
  let r = await appel('PUT', `/controle/pieces/${P.vide}`, 'dir', { statut: 'controle' });
  assert.equal(r.status, 409);
  assert.match(r.message, /Tiers non identifié/);
  assert.doesNotMatch(r.message, /NUI manquant/, 'NUI manquant : signalé, non bloquant');
  r = await appel('PUT', `/controle/pieces/${P.vide}`, 'dir', { statut: 'anomalie' });
  assert.equal(r.status, 409);
  r = await appel('PUT', `/controle/pieces/${P.vide}`, 'dir', { statut: 'anomalie', observation: 'Reçu de taxi sans identité du transporteur.' });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.piece.statut, 'anomalie');

  // Saisie du tiers sans statut final → « en cours ».
  r = await appel('PUT', `/controle/pieces/${P.homonyme}`, 'dir', { tiers_nui: 'm050000123456p', tiers_nom: 'PAPETERIE DU CENTRE' });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.piece.statut, 'en_cours');
  assert.equal(r.data.piece.tiers_nui, 'M050000123456P', 'NUI normalisé');
  assert.ok(!r.data.piece.anomalies.includes('tiers_incoherent'), 'incohérence levée par la correction du nom');

  // Tiers hors registre : signalé, non bloquant (décision du 24/10/2026).
  assert.ok(ligne(await liste(), P.ok).anomalies.includes('tiers_hors_registre'));
  assert.ok(ligne(await liste(), P.ok).validable, 'point signalé sans blocage ni observation exigée');
  // Tiers ajouté au registre : plus d'anomalie, puis validation.
  r = await appel('PUT', `/controle/pieces/${P.ok}`, 'dir', { ajouter_registre: true });
  assert.equal(r.status, 200, r.message);
  assert.deepEqual(r.data.piece.anomalies, []);
  assert.ok(r.data.piece.registre, 'fiche créée au registre');
  assert.equal(r.data.piece.registre.verifie, false, 'pas de vérification documentaire');
  r = await appel('PUT', `/controle/pieces/${P.ok}`, 'dir', { statut: 'controle' });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.piece.statut, 'controle');
  assert.ok(r.data.piece.controle_par);

  // Écriture sans compte : validation bloquée (règle 045), même avec une observation.
  r = await appel('PUT', `/controle/pieces/${P.vente}`, 'dir', { statut: 'controle', observation: 'Compte 701 à valider par le cabinet.' });
  assert.equal(r.status, 409);
  assert.match(r.message, /Code comptable manquant/);
  // Le comptable impute l'opération ; les autres points, expliqués, n'empêchent plus la validation.
  r = await appel('PUT', `/controle/pieces/${P.vente}`, 'aud', { compte_corrige: '7011', observation: 'Compte 701 à valider par le cabinet.' });
  assert.equal(r.status, 200, r.message);
  r = await appel('PUT', `/controle/pieces/${P.vente}`, 'dir', { statut: 'controle', observation: 'Compte 701 à valider par le cabinet.' });
  assert.equal(r.status, 200, r.message);

  // Persistance (relecture).
  const d = await liste();
  assert.equal(ligne(d, P.ok).statut, 'controle');
  assert.equal(ligne(d, P.vide).observation, 'Reçu de taxi sans identité du transporteur.');
  assert.equal(ligne(d, P.homonyme).tiers_nom, 'PAPETERIE DU CENTRE');
});

test('Écriture d\'origine intacte, contrôle tracé, isolement entre clients', async () => {
  const [j] = await sql('SELECT nui, beneficiaire, sortie, entree, exporte_sage FROM journal WHERE id = $1', [P.homonyme]);
  assert.equal(j.beneficiaire, 'PAPETERIE CENTRALE', 'le bénéficiaire saisi n\'est jamais modifié');
  assert.equal(parseFloat(j.sortie), 2000);
  assert.equal(j.exporte_sage, false);
  const audit = await sql(`SELECT COUNT(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND action = 'CONTROLE_PIECE'`, [TENANT]);
  assert.ok(audit[0].n >= 4);
  const r = await appel('PUT', `/controle/pieces/${P.autre}`, 'dir', { statut: 'en_cours' });
  assert.equal(r.status, 404, 'pièce d\'un autre client');
  assert.equal((await appel('PUT', `/controle/pieces/${P.annulee}`, 'dir', { statut: 'en_cours' })).status, 409);
});

test('Rapport : filtres journal, statut, anomalies, tiers, recherche, et synthèse', async () => {
  let d = await liste(`&journal_id=${BQ1}`);
  assert.deepEqual(d.lignes.map((l) => l.id), [P.vir]);
  d = await liste('&statut=a_controler');
  assert.deepEqual(d.lignes.map((l) => l.id).sort(), [P.vir].sort());
  d = await liste('&q=ramettes');
  assert.deepEqual(d.lignes.map((l) => l.id), [P.ok], 'recherche par libellé');
  d = await liste('&statut=anomalie');
  assert.deepEqual(d.lignes.map((l) => l.id), [P.vide]);
  d = await liste('&anomalies=0');
  assert.ok(d.lignes.every((l) => l.anomalies.length === 0));
  assert.ok(d.lignes.some((l) => l.id === P.ok));
  d = await liste('&tiers=papeterie');
  assert.deepEqual(d.lignes.map((l) => l.id).sort(), [P.ok, P.homonyme].sort());
  d = await liste('&q=taxi');
  assert.deepEqual(d.lignes.map((l) => l.id), [P.vide]);
  d = await liste();
  assert.equal(d.resume.total, 5);
  assert.equal(d.resume.par_statut.controle, 2);
  assert.equal(d.resume.par_statut.anomalie, 1);
  assert.equal(d.resume.par_statut.en_cours, 1);
  assert.equal(d.resume.par_statut.a_controler, 1);
  assert.equal(d.resume.debit, 15000 + 5000 + 100000 + 2000);
  const t = await appel('GET', '/controle/tiers?q=papet', 'dir');
  assert.equal(t.status, 200);
  assert.ok(t.data.some((x) => x.nui === 'M050000123456P'));
});

test('Aucun contrôle documentaire : champs de pièce justificative ignorés (044)', async () => {
  const r = await appel('PUT', `/controle/pieces/${P.homonyme}`, 'dir', {
    tiers_nui: 'M050000123456P', tiers_nom: 'PAPETERIE DU CENTRE', original_presente: true,
    piece_numero: 'FA-2031', piece_date: `${AN}-03-20`, piece_montant: 15000, piece_ht: 10000, piece_tva: 1000 });
  assert.equal(r.status, 200, r.message);
  for (const k of ['piece_absente', 'ecart_montant', 'piece_posterieure', 'tva_incoherente', 'doublon_piece']) {
    assert.ok(!r.data.piece.anomalies.includes(k), `${k} ne doit plus exister`);
  }
  const [c] = await sql('SELECT piece_numero, piece_montant, original_presente FROM controles_pieces WHERE mouvement_id = $1', [P.homonyme]);
  assert.equal(c.piece_numero, '', 'rien n\'est enregistré sur le justificatif');
  assert.equal(c.piece_montant, null);
  assert.equal(c.original_presente, false);
  const d = await liste();
  assert.ok(!Object.keys(d.anomalies).some((k) => k.startsWith('piece_') || k === 'doublon_piece' || k === 'ecart_montant'));
});

test('Registre des clients / fournisseurs : fiches, NUI unique, nom de référence, reprise des pièces', async () => {
  assert.equal((await appel('GET', '/registre-tiers', 'cai')).status, 403);
  assert.equal((await appel('GET', '/registre-tiers', 'aud')).status, 200);
  assert.equal((await appel('POST', '/registre-tiers', 'cai', { nom: 'X' })).status, 403);
  assert.equal((await appel('POST', '/registre-tiers', 'aud', { nom: 'TIERS DU COMPTABLE' })).status, 201, 'le comptable (044) tient le registre');
  let r = await appel('POST', '/registre-tiers', 'dir', { type: 'client', nom: 'CLIENT A', nui: 'p012345678901q', telephone: '699000000' });
  assert.equal(r.status, 201, r.message);
  const idA = r.data.tiers.id;
  assert.equal(r.data.tiers.nui, 'P012345678901Q');
  assert.equal(r.data.tiers.nb_pieces, 1, 'rattaché à la pièce de vente par son NUI');
  assert.equal((await appel('POST', '/registre-tiers', 'dir', { nom: 'AUTRE', nui: 'P012345678901Q' })).status, 409);
  assert.equal((await appel('POST', '/registre-tiers', 'dir', { nom: '  ' })).status, 400);

  // Le registre fait foi : renommer la fiche crée une anomalie sur la pièce.
  r = await appel('PUT', `/registre-tiers/${idA}`, 'dir', { nom: 'CLIENT ALPHA SARL', verifie: true });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.tiers.verifie, true);
  assert.ok(ligne(await liste(), P.vente).anomalies.includes('nom_different_registre'));
  // Choisir le tiers du registre dans le contrôle reprend son nom.
  // Pièce validée : verrouillée, réouverture motivée par le comptable (045).
  r = await appel('PUT', `/controle/pieces/${P.vente}`, 'dir', { tiers_id: idA, tiers_nom: '', tiers_nui: '' });
  assert.equal(r.status, 409);
  assert.equal((await appel('POST', `/controle/pieces/${P.vente}/reouverture`, 'aud', { motif: 'Rattacher le client du registre' })).status, 200);
  r = await appel('PUT', `/controle/pieces/${P.vente}`, 'dir', { tiers_id: idA, tiers_nom: '', tiers_nui: '' });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.piece.tiers_nom, 'CLIENT ALPHA SARL');
  assert.ok(!r.data.piece.anomalies.includes('nom_different_registre'));

  // Changer l'identité d'un tiers vérifié lève la vérification.
  r = await appel('PUT', `/registre-tiers/${idA}`, 'dir', { nom: 'CLIENT ALPHA' });
  assert.equal(r.data.tiers.verifie, false);

  // Reprise des pièces : rien de nouveau (tous les NUI des pièces sont au registre).
  await piece(TENANT, CS1, 10, 'D2', { sortie: 1500, nui: 'M999999999999Z', benef: 'GARAGE BON PRIX' });
  r = await appel('POST', '/registre-tiers/import-pieces', 'dir');
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.crees, 1);
  const l = (await appel('GET', '/registre-tiers?q=garage', 'dir')).data;
  assert.equal(l.length, 1);
  assert.equal(l[0].type, 'fournisseur');
  assert.equal(l[0].verifie, false, 'repris des pièces : à vérifier');
  assert.equal((await appel('POST', '/registre-tiers/import-pieces', 'dir')).data.crees, 0);
  // Suggestions de saisie : le registre d'abord.
  const sug = (await appel('GET', '/controle/tiers?q=client', 'dir')).data;
  assert.equal(sug[0].source, 'registre');
});
