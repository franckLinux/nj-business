// tests/arretes-inventaires.test.js — Validation des arrêtés de caisse et des inventaires (migration 046).
//
//  • arrêtés (26/10/2026) : le comptable peut arrêter mais pas valider ; le
//    directeur arrête et valide (y compris son propre arrêt) ; PV scanné
//    obligatoire (contrôlé sur le contenu), solde constaté, écart justifié,
//    pas de double validation ;
//  • un arrêté validé ne se rouvre ni ne se ré-arrête (API + trigger) ;
//    annulation de la validation : controle.reouvrir + motif ;
//  • PV servi uniquement par l'API authentifiée, cloisonné par client ;
//  • inventaires : solde théorique à la date, PV + soldes constatés +
//    observation des écarts pour valider, figé une fois validé, réouverture
//    motivée, suppression du brouillon ;
//  • aucun effet sur le journal.
//
//   TEST_DATABASE_URL=postgres://…/base_de_test  npm run test:arretes-inventaires
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const DB = process.env.TEST_DATABASE_URL;
if (!DB) {
  console.error('TEST_DATABASE_URL absent : test ignoré (ne jamais viser la base de production).');
  process.exit(0);
}
const SECRET = 'test-secret-' + crypto.randomBytes(16).toString('hex');
const PORT = 7100 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}/api`;
const sfx = crypto.randomBytes(3).toString('hex');
const pool = new Pool({ connectionString: DB });
const PV_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-test-'));
const AN = new Date().getFullYear() - 1;   // année passée : dates d'inventaire jamais dans le futur
let serveur;
let TENANT;
let AUTRE;
let CS1;
let BQ1;
const U = {};
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n').toString('base64');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]).toString('base64');

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
const ecriture = (tenant, journal, date, mois, { entree = 0, sortie = 0 } = {}) => sql(
  `INSERT INTO journal (tenant_id, date, mois, annee, journal_id, type_caisse, rubrique_code, intitule, beneficiaire, entree, sortie)
   VALUES ($1, $2, $3, $4, $5, 'especes', 'D1', 'Test', 'X', $6, $7)`, [tenant, date, mois, AN, journal, entree, sortie]);
const arrets = async (qui = 'cpt', mois = 'Mars') => (await appel('GET', `/controle/arrets?mois=${mois}&annee=${AN}`, qui)).data;
const ligne = async (jId, qui = 'cpt', mois = 'Mars') => (await arrets(qui, mois)).lignes.find((l) => l.journal_id === jId);
const P = (extra = {}) => ({ mois: 'Mars', annee: AN, ...extra });

before(async () => {
  [{ id: TENANT }] = await sql('INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id', [`ai-${sfx}`, `AI ${sfx}`]);
  [{ id: AUTRE }] = await sql('INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id', [`ai2-${sfx}`, `AI2 ${sfx}`]);
  [{ id: CS1 }] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type, compte_tresorerie) VALUES ($1, 'CS1', 'Caisse', 'caisse', '571') RETURNING id`, [TENANT]);
  [{ id: BQ1 }] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type, compte_tresorerie) VALUES ($1, 'BQ1', 'Banque', 'banque', '521') RETURNING id`, [TENANT]);
  await sql(`INSERT INTO journaux (tenant_id, code, nom, type) VALUES ($1, 'CS1', 'Caisse', 'caisse')`, [AUTRE]);
  // Caisse : +100 000 le 02/03, −30 000 le 10/03, −5 000 le 25/03 → solde fin mars 65 000.
  await ecriture(TENANT, CS1, `${AN}-03-02`, 'Mars', { entree: 100000 });
  await ecriture(TENANT, CS1, `${AN}-03-10`, 'Mars', { sortie: 30000 });
  await ecriture(TENANT, CS1, `${AN}-03-25`, 'Mars', { sortie: 5000 });
  // Banque : +500 000 en mars.
  await ecriture(TENANT, BQ1, `${AN}-03-05`, 'Mars', { entree: 500000 });

  await creerUtilisateur('dir', 'directeur');
  await creerUtilisateur('cai', 'caissier');
  await creerUtilisateur('cpt', 'auditeur');   // profil « Comptable »
  await creerUtilisateur('aut', 'auditeur', AUTRE);
  serveur = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: DB, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test', SMTP_HOST: '', RATE_LIMIT_MAX: '100000', PV_DIR },
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
    await sql('DELETE FROM inventaires WHERE tenant_id = $1', [t]).catch(() => {});
    await sql('DELETE FROM controles_arrets WHERE tenant_id = $1', [t]).catch(() => {});
    await sql('DELETE FROM arrets_caisse WHERE tenant_id = $1', [t]).catch(() => {});
    await sql('DELETE FROM journal WHERE tenant_id = $1', [t]).catch(() => {});
    await sql('DELETE FROM tenants WHERE id = $1', [t]).catch(() => {});
  }
  await pool.end();
  fs.rmSync(PV_DIR, { recursive: true, force: true });
});

test('Arrêtés : liste du mois, validation impossible tant que la caisse n\'est pas arrêtée', async () => {
  let l = await ligne(CS1);
  assert.equal(l.etat, 'non_arrete');
  assert.equal(l.solde_calcule, 65000, 'solde à arrêter affiché avant l\'arrêt');
  let r = await appel('POST', `/controle/arrets/${CS1}/validation`, 'dir', P({ solde_constate: 65000 }));
  assert.equal(r.status, 409, 'pas d\'arrêté → rien à valider');
  assert.equal((await appel('POST', `/journaux/${CS1}/arreter`, 'cai', { mois: 'Mars', annee: AN })).status, 403, 'la caissière n\'arrête pas');
  r = await appel('POST', `/journaux/${CS1}/arreter`, 'cpt', { mois: 'Mars', annee: AN });
  assert.equal(r.status, 201, `le comptable arrête la caisse : ${r.message}`);
  l = await ligne(CS1);
  assert.equal(l.etat, 'a_valider');
  assert.equal(l.solde_arrete, 65000);
  assert.equal(l.arret.arrete_par, U.cpt.username);
  assert.ok(l.bloquants.includes('PV scanné non joint'));
  assert.equal((await appel('GET', `/controle/arrets?mois=Mars&annee=${AN}`, 'cai')).status, 403, 'la caissière n\'a pas accès');
});

test('Arrêtés : PV contrôlé sur son contenu, solde constaté, écart justifié ; validation par le directeur seul', async () => {
  let r = await appel('POST', `/controle/arrets/${CS1}/validation`, 'dir', P({ solde_constate: 65000 }));
  assert.equal(r.status, 400);
  assert.match(r.message, /PV/);
  r = await appel('POST', `/controle/arrets/${CS1}/pv`, 'cpt', P({ nom_fichier: 'pv.pdf', data_base64: Buffer.from('<script>alert(1)</script>').toString('base64') }));
  assert.equal(r.status, 400, 'un faux PDF est refusé');
  r = await appel('POST', `/controle/arrets/${CS1}/pv`, 'cpt', P({ nom_fichier: '../../PV mars.pdf', data_base64: PDF }));
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.ligne.pv.nom, 'PV mars.pdf', 'nom nettoyé, sans chemin');
  assert.equal(r.data.ligne.pv.mime, 'application/pdf');
  assert.match(r.data.ligne.pv.sha256, /^[0-9a-f]{64}$/);
  // Stocké hors du dossier public.
  const [c] = await sql('SELECT pv_path FROM controles_arrets WHERE tenant_id = $1 AND journal_id = $2', [TENANT, CS1]);
  assert.ok(fs.existsSync(path.join(PV_DIR, c.pv_path)));

  r = await appel('POST', `/controle/arrets/${CS1}/validation`, 'cpt', P({ solde_constate: 65000 }));
  assert.equal(r.status, 403, 'le comptable ne valide pas l\'arrêté');
  r = await appel('POST', `/controle/arrets/${CS1}/validation`, 'dir', P({ solde_constate: 64500 }));
  assert.equal(r.status, 400);
  assert.match(r.message, /observation/);
  r = await appel('PUT', `/controle/arrets/${CS1}`, 'cpt', P({ solde_constate: '64 500', observation: 'Manquant de 500 constaté au comptage' }));
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.ligne.ecart, -500);
  assert.equal(r.data.ligne.validable, true);
  r = await appel('POST', `/controle/arrets/${CS1}/validation`, 'dir', P());
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.ligne.etat, 'validee');
  assert.equal(r.data.ligne.validation.par, U.dir.username);
  r = await appel('POST', `/controle/arrets/${CS1}/validation`, 'dir', P());
  assert.equal(r.status, 409, 'pas de double validation');
  r = await appel('POST', `/controle/arrets/${CS1}/pv`, 'cpt', P({ nom_fichier: 'autre.png', data_base64: PNG }));
  assert.equal(r.status, 409, 'PV figé après validation');
});

test('Arrêté validé : ni réouverture ni nouvel arrêt (API + base) ; annulation motivée', async () => {
  let r = await appel('DELETE', `/journaux/${CS1}/arreter?mois=Mars&annee=${AN}`, 'dir');
  assert.equal(r.status, 409, r.message);
  assert.match(r.message, /a été validé/);
  r = await appel('POST', `/journaux/${CS1}/arreter`, 'dir', { mois: 'Mars', annee: AN });
  assert.equal(r.status, 409, 'pas de ré-arrêt d\'un arrêté validé');
  await assert.rejects(sql('DELETE FROM arrets_caisse WHERE tenant_id = $1 AND journal_id = $2', [TENANT, CS1]), /contrôle comptable/);

  r = await appel('POST', `/controle/arrets/${CS1}/annulation`, 'cpt', P({ motif: 'x' }));
  assert.equal(r.status, 403, 'le comptable n\'annule pas la validation');
  r = await appel('POST', `/controle/arrets/${CS1}/annulation`, 'dir', P({ motif: ' ' }));
  assert.equal(r.status, 400);
  r = await appel('POST', `/controle/arrets/${CS1}/annulation`, 'dir', P({ motif: 'Erreur de comptage, PV refait' }));
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.ligne.etat, 'a_valider');
  assert.equal(r.data.ligne.derniere_annulation.motif, 'Erreur de comptage, PV refait');
  r = await appel('DELETE', `/journaux/${CS1}/arreter?mois=Mars&annee=${AN}`, 'dir');
  assert.equal(r.status, 200, 'après annulation, la caisse se rouvre');
  const l = await ligne(CS1);
  assert.equal(l.etat, 'non_arrete');
  assert.equal(l.caduc, true, 'le contrôle préparé est signalé caduc');
  const audit = await sql(`SELECT action FROM audit_log WHERE tenant_id = $1 AND entite = 'controle_arret' ORDER BY id`, [TENANT]);
  for (const a of ['ARRET_PV_DEPOT', 'ARRET_CONTROLE_SAISIE', 'ARRET_VALIDATION', 'ARRET_VALIDATION_ANNULEE']) {
    assert.ok(audit.some((x) => x.action === a), `audit ${a}`);
  }
});

test('PV : servi par l\'API authentifiée, cloisonné par client', async () => {
  assert.equal((await appel('POST', `/journaux/${BQ1}/arreter`, 'dir', { mois: 'Mars', annee: AN })).status, 201);
  const d = await appel('POST', `/controle/arrets/${BQ1}/pv`, 'cpt', P({ nom_fichier: 'releve.pdf', data_base64: PDF }));
  const id = d.data.ligne.controle_id;
  assert.ok(id);
  const get = (qui) => fetch(`${BASE}/controle/pv/arret/${id}`, { headers: { Authorization: `Bearer ${U[qui].token}` } });
  let r = await get('cpt');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  assert.equal((await get('aut')).status, 404, 'autre client : introuvable');
  assert.equal((await get('cai')).status, 403, 'caissière : refusé');
  assert.equal((await fetch(`${BASE}/controle/pv/arret/${id}`)).status, 401, 'sans jeton : refusé');
  // Le directeur valide son propre arrêt.
  const v = await appel('POST', `/controle/arrets/${BQ1}/validation`, 'dir', P({ solde_constate: 500000 }));
  assert.equal(v.status, 200, v.message);
  assert.equal(v.data.ligne.etat, 'validee');
});

test('Inventaires : solde théorique à la date, conditions de validation, figé, réouverture, suppression', async () => {
  let r = await appel('POST', '/controle/inventaires', 'cpt', { date_inventaire: `${new Date().getFullYear() + 1}-01-01` });
  assert.equal(r.status, 400, 'pas d\'inventaire dans le futur');
  r = await appel('POST', '/controle/inventaires', 'cpt', { date_inventaire: `${AN}-03-15`, libelle: 'Comptage mi-mars', journal_ids: [CS1, BQ1] });
  assert.equal(r.status, 201, r.message);
  const inv = r.data.inventaire;
  const cs = inv.lignes.find((l) => l.journal_id === CS1);
  assert.equal(cs.solde_theorique, 70000, 'mouvements jusqu\'au 15/03 inclus seulement');
  assert.equal(inv.lignes.find((l) => l.journal_id === BQ1).solde_theorique, 500000);
  assert.equal(inv.validable, false);

  r = await appel('POST', `/controle/inventaires/${inv.id}/validation`, 'cpt');
  assert.equal(r.status, 400);
  assert.ok(r.data.details?.bloquants?.length >= 2 || /PV/.test(r.message));
  r = await appel('PUT', `/controle/inventaires/${inv.id}`, 'cpt', { lignes: [{ journal_id: CS1, solde_constate: 69000 }, { journal_id: BQ1, solde_constate: 500000 }] });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.inventaire.lignes.find((l) => l.journal_id === CS1).ecart, -1000);
  r = await appel('POST', `/controle/inventaires/${inv.id}/pv`, 'cpt', { nom_fichier: 'pv-inventaire.jpg', data_base64: PNG });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.inventaire.pv.mime, 'image/png', 'type déduit du contenu, pas de l\'extension');
  r = await appel('POST', `/controle/inventaires/${inv.id}/validation`, 'cpt');
  assert.equal(r.status, 400, 'écart non justifié');
  assert.match(r.message, /CS1/);
  await appel('PUT', `/controle/inventaires/${inv.id}`, 'cpt', { lignes: [{ journal_id: CS1, observation: 'Pièce de 1 000 non comptabilisée' }] });
  r = await appel('POST', `/controle/inventaires/${inv.id}/validation`, 'cpt');
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.inventaire.statut, 'valide');
  assert.equal(r.data.inventaire.totaux.ecart, -1000);

  // Écriture tardive (avant la date d'inventaire) : le théorique validé ne bouge plus.
  await ecriture(TENANT, BQ1, `${AN}-03-06`, 'Mars', { entree: 1 });
  const lu = (await appel('GET', `/controle/inventaires/${inv.id}`, 'cpt')).data;
  assert.equal(lu.lignes.find((l) => l.journal_id === BQ1).solde_theorique, 500000, 'solde théorique figé à la validation');

  r = await appel('PUT', `/controle/inventaires/${inv.id}`, 'cpt', { libelle: 'x' });
  assert.equal(r.status, 409, 'inventaire validé = figé');
  r = await appel('DELETE', `/controle/inventaires/${inv.id}`, 'cpt');
  assert.equal(r.status, 409, 'un inventaire validé ne se supprime pas');
  r = await appel('POST', `/controle/inventaires/${inv.id}/reouverture`, 'dir', { motif: 'x' });
  assert.equal(r.status, 403);
  r = await appel('POST', `/controle/inventaires/${inv.id}/reouverture`, 'cpt', { motif: 'Relevé bancaire corrigé' });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.inventaire.statut, 'brouillon');
  assert.equal(r.data.inventaire.lignes.find((l) => l.journal_id === BQ1).solde_theorique, 500001, 'rouvert : recalcul en direct');
  r = await appel('DELETE', `/controle/inventaires/${inv.id}`, 'cpt');
  assert.equal(r.status, 200, r.message);
  const liste = (await appel('GET', '/controle/inventaires', 'cpt')).data;
  assert.equal(liste.length, 0);
  const audit = await sql(`SELECT action FROM audit_log WHERE tenant_id = $1 AND entite = 'inventaire' ORDER BY id`, [TENANT]);
  assert.deepEqual([...new Set(audit.map((a) => a.action))].sort(),
    ['INVENTAIRE_CREATION', 'INVENTAIRE_MODIF', 'INVENTAIRE_PV_DEPOT', 'INVENTAIRE_REOUVERTURE', 'INVENTAIRE_SUPPRESSION', 'INVENTAIRE_VALIDATION'].sort());
  // Cloisonnement : l'inventaire d'un client n'est pas lisible par un autre.
  const inv2 = (await appel('POST', '/controle/inventaires', 'cpt', { date_inventaire: `${AN}-03-31` })).data.inventaire;
  assert.equal((await appel('GET', `/controle/inventaires/${inv2.id}`, 'aut')).status, 404);
});

test('Aucun effet sur le journal', async () => {
  const [n] = await sql('SELECT COUNT(*)::int AS n, SUM(entree - sortie)::numeric AS s FROM journal WHERE tenant_id = $1', [TENANT]);
  assert.equal(n.n, 5);
  assert.equal(Number(n.s), 565001);
});
