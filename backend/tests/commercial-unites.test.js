// tests/commercial-unites.test.js — NJ COMMERCIAL, lot 3 (migration 055).
//
//  Unités (décimales), conversions par article (1 carton = 12 pièces), unités
//  proposées par la famille puis modifiables sur l'article, unité d'achat sur
//  la demande et le bon (coefficient copié : l'historique ne bouge pas),
//  encart stock converti, reprise de l'ancien mot d'unité, isolation.
//
//   TEST_DATABASE_URL=postgres://…/base_de_test  node --test tests/commercial-unites.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const DB = process.env.TEST_DATABASE_URL;
if (!DB) {
  console.error('TEST_DATABASE_URL absent : test ignoré (ne jamais viser la base de production).');
  process.exit(0);
}
const SECRET = 'test-secret-' + crypto.randomBytes(16).toString('hex');
const PORT = 8700 + Math.floor(Math.random() * 280);
const BASE = `http://127.0.0.1:${PORT}/api`;
const sfx = crypto.randomBytes(3).toString('hex');
const pool = new Pool({ connectionString: DB });
const U = {};
const R = {};
let serveur;
let A;
let B;

const sql = async (texte, params = []) => (await pool.query(texte, params)).rows;
const appel = async (methode, url, qui, corps) => {
  const r = await fetch(`${BASE}${url}`, {
    method: methode,
    headers: { 'Content-Type': 'application/json', ...(qui ? { Authorization: `Bearer ${U[qui].token}` } : {}) },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const brut = r.headers.get('content-type')?.includes('json') ? await r.json().catch(() => ({})) : {};
  return { status: r.status, data: brut.data ?? brut, message: brut.message || brut.error || brut.data?.error };
};
const binaire = async (url, qui) => {
  const r = await fetch(`${BASE}${url}`, { headers: { Authorization: `Bearer ${U[qui].token}` } });
  return { status: r.status, buffer: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type'), sha: r.headers.get('x-document-sha256') };
};
const creerUtilisateur = async (cle, role, tenant, profil = null) => {
  const username = `${cle}-${sfx}`;
  const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif, custom_role_id)
                          VALUES ($1, $2, $3, $4, $5, true, (SELECT id FROM roles WHERE tenant_id = $1 AND code = $6)) RETURNING id`,
  [tenant, username, `${username}@test.cm`, await bcrypt.hash('x', 4), role, profil]);
  U[cle] = { id: u.id, username, token: jwt.sign({ sub: u.id, username, role, tenantId: tenant }, SECRET, { expiresIn: '1h' }) };
};


const demandeApprouvee = async (qui, magasin, lignes) => {
  const d = (await appel('POST', '/commercial/demandes', qui, { magasin_id: magasin, motif: 'Besoin de fournitures', lignes })).data;
  assert.ok(d?.id, 'demande créée');
  await appel('POST', `/commercial/demandes/${d.id}/soumission`, qui, {});
  const r = await appel('POST', `/commercial/demandes/${d.id}/decision`, 'resp', { decision: 'approuver' });
  assert.equal(r.data.statut, 'approuvee', r.message);
  return r.data;
};

before(async () => {
  [{ id: A }] = await sql('INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id', [`una-${sfx}`, `Unités A ${sfx}`]);
  [{ id: B }] = await sql('INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id', [`unb-${sfx}`, `Unités B ${sfx}`]);
  await creerUtilisateur('adm', 'super_admin', null);
  serveur = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: DB, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test', SMTP_HOST: '',
      RATE_LIMIT_MAX: '100000', MODULES_CONTROLE: 'appliquer', APP_URL: 'https://app.nj-business.test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = (d) => process.env.DEBUG_TEST && process.stderr.write(d);
  serveur.stdout.on('data', log); serveur.stderr.on('data', log);
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* démarrage */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  for (const t of [A, B]) assert.equal((await appel('PUT', `/plateforme/clients/${t}/modules/commercial`, 'adm', { actif: true, motif: 'Tests unités' })).status, 200);
  await creerUtilisateur('dir', 'directeur', A);
  await creerUtilisateur('resp', 'collaborateur', A, 'achats_responsable');
  await creerUtilisateur('demA', 'collaborateur', A, 'achats_demandeur');
  await creerUtilisateur('gasA', 'collaborateur', A, 'achats_gestionnaire');
  await creerUtilisateur('dirB', 'directeur', B);
  R.tva = (await appel('POST', '/commercial/taxes', 'dir', { code: 'TVA', intitule: 'TVA', taux: '19,25' })).data.id;
  R.tvaV = (await appel('POST', '/commercial/taxes', 'dir', { code: 'TVAV', intitule: 'TVA ventes', taux: '19,25', usage: 'vente' })).data.id;
  R.prec = (await appel('POST', '/commercial/taxes', 'dir', { code: 'PRECA', intitule: 'Précompte achats', taux: '2', type: 'precompte', usage: 'achat' })).data.id;
  R.fou = (await appel('POST', '/commercial/tiers', 'dir', { type: 'fournisseur', nom: 'Bureau Plus' })).data.id;
});

after(async () => {
  serveur?.kill();
  for (const t of [A, B]) {
    const c = await pool.connect();   // tout ou rien : un client non supprimé garde ses modules
    try {
      await c.query('BEGIN');
      for (const q of ['DELETE FROM audit_log WHERE tenant_id = $1', 'DELETE FROM tenant_modules WHERE tenant_id = $1', 'DELETE FROM tenants WHERE id = $1']) await c.query(q, [t]);
      await c.query('COMMIT');
    } catch { await c.query('ROLLBACK').catch(() => {}); } finally { c.release(); }
  }
  await sql('DELETE FROM audit_log WHERE user_id = $1', [U.adm.id]).catch(() => {});
  await sql('DELETE FROM users WHERE id = $1', [U.adm.id]).catch(() => {});
  await pool.end();
});


test('Unités : décimales de 0 à 3, code unique', async () => {
  for (const [code, libelle, decimales] of [['pièce', 'Pièce', 0], ['carton', 'Carton de 12', 0], ['kg', 'Kilogramme', 3]]) {
    const r = await appel('POST', '/commercial/unites', 'dir', { code, libelle, decimales });
    assert.equal(r.status, 201, r.message);
    R[code] = r.data.id;
  }
  assert.equal((await appel('POST', '/commercial/unites', 'dir', { code: 'PIÈCE' })).status, 409, 'insensible à la casse');
  assert.equal((await appel('POST', '/commercial/unites', 'dir', { code: 'l', decimales: 4 })).status, 400);
  assert.equal((await appel('POST', '/commercial/unites', 'demA', { code: 'x' })).status, 403);
});

test('Famille : unités proposées ; l\'article les reprend puis s\'en détache', async () => {
  const sans = await appel('POST', '/commercial/familles', 'dir', { code: 'F0', nom: 'Sans stock', unite_achat_id: R.carton, coef_achat: 12 });
  assert.equal(sans.status, 400);
  const f = await appel('POST', '/commercial/familles', 'dir', { code: 'BOI', nom: 'Boissons', unite_stock_id: R['pièce'],
    unite_achat_id: R.carton, coef_achat: 12, unite_vente_id: R['pièce'], fournisseur_ids: [R.fou] });
  assert.equal(f.status, 201, f.message);
  assert.equal(f.data.unite_achat_code, 'carton');
  assert.equal(f.data.coef_achat, 12);
  assert.equal(f.data.coef_vente, 1);
  R.fam = f.data.id;
  const a = await appel('POST', '/commercial/articles', 'dir', { reference: 'EAU', designation: 'Eau minérale 1,5 L', famille_id: R.fam,
    prix_achat_indicatif: 3600, prix_vente_indicatif: 400, suivi_comptable: true });
  assert.equal(a.status, 201, a.message);
  assert.equal(a.data.unite, 'pièce', 'mot affiché = unité de stock');
  assert.equal(a.data.unite_achat_code, 'carton');
  assert.equal(a.data.coef_achat, 12);
  assert.equal(a.data.unite_vente_code, 'pièce');
  assert.deepEqual(a.data.unites.map((u) => [u.code, u.coefficient]), [['pièce', 1], ['carton', 12]]);
  assert.equal(a.data.prix_vente_indicatif, 400);
  R.eau = a.data.id;
  // La famille change : l'article garde 12.
  assert.equal((await appel('PUT', `/commercial/familles/${R.fam}`, 'dir', { coef_achat: 24 })).status, 200);
  assert.equal((await appel('GET', `/commercial/articles/${R.eau}`, 'dir')).data.coef_achat, 12);
  // Même unité à l'achat et à la vente : un seul coefficient.
  const conflit = await appel('PUT', `/commercial/articles/${R.eau}`, 'dir', { unite_vente_id: R.carton, coef_vente: 6 });
  assert.equal(conflit.status, 400);
  // Unité d'achat sans coefficient : refusée.
  assert.equal((await appel('PUT', `/commercial/articles/${R.eau}`, 'dir', { unite_achat_id: R.kg })).status, 400);
});

test('Ancien écran : `unite: "sac"` crée l\'unité et la reprend en stock, achat et vente', async () => {
  const a = await appel('POST', '/commercial/articles', 'dir', { reference: 'CIM', designation: 'Ciment', famille_id: R.fam, unite: 'sac', suivi_comptable: false });
  assert.equal(a.status, 201, a.message);
  assert.equal(a.data.unite_stock_code, 'sac');
  assert.equal(a.data.unite_achat_code, 'sac');
  assert.equal(a.data.coef_achat, 1);
});

test('Demande : 10 cartons = 120 pièces face au stock ; prix au carton ; décimales et unités contrôlées', async () => {
  const mag = (await appel('POST', '/commercial/magasins', 'dir', { code: 'CEN', nom: 'Central' })).data.id;
  R.mag = mag;
  assert.equal((await appel('PUT', '/commercial/stock/initial', 'dir', { article_id: R.eau, magasin_id: mag, quantite: 100, date_mouvement: '2026-10-01' })).status, 200);
  const d = await appel('POST', '/commercial/demandes', 'dir', { magasin_id: mag, motif: 'Réassort boissons', lignes: [{ article_id: R.eau, quantite: 10 }] });
  assert.equal(d.status, 201, d.message);
  const l = d.data.lignes[0];
  assert.equal(l.unite, 'carton', 'unité d\'achat par défaut');
  assert.equal(l.coefficient, 12);
  assert.equal(l.quantite_stock, 120);
  assert.equal(l.prix_estime, 3600, 'prix au carton');
  assert.equal(l.stock_actuel.disponible, 100);
  assert.equal(l.stock_actuel.a_approvisionner, 20);
  R.dem = d.data.id;
  // En pièces : prix converti (3600 / 12).
  const p = await appel('PUT', `/commercial/demandes/${R.dem}`, 'dir', { lignes: [{ article_id: R.eau, quantite: 30, unite_id: R['pièce'] }] });
  assert.equal(p.status, 200, p.message);
  assert.equal(p.data.lignes[0].prix_estime, 300);
  assert.equal(p.data.lignes[0].stock_actuel.couvert, true);
  // Décimale sur une unité entière, unité étrangère à l'article : refusées.
  assert.equal((await appel('PUT', `/commercial/demandes/${R.dem}`, 'dir', { lignes: [{ article_id: R.eau, quantite: 1.5 }] })).status, 400);
  const kg = await appel('PUT', `/commercial/demandes/${R.dem}`, 'dir', { lignes: [{ article_id: R.eau, quantite: 1, unite_id: R.kg }] });
  assert.equal(kg.status, 400);
  assert.match(kg.message, /ne se compte pas/);
  assert.equal((await appel('PUT', `/commercial/demandes/${R.dem}`, 'dir', { lignes: [{ article_id: R.eau, quantite: 10 }] })).status, 200);
});

test('Bon de commande : l\'unité et le coefficient de la demande sont copiés et ne bougent plus', async () => {
  await appel('POST', `/commercial/demandes/${R.dem}/soumission`, 'dir', {});
  const ap = await appel('POST', `/commercial/demandes/${R.dem}/decision`, 'resp', { decision: 'approuver' });
  assert.equal(ap.data.statut, 'approuvee', ap.message);
  const prop = (await appel('GET', `/commercial/bons-commande/proposition/${R.dem}`, 'resp')).data;
  assert.equal(prop.lignes[0].unite, 'carton');
  assert.equal(prop.lignes[0].coefficient, 12);
  const bc = await appel('POST', '/commercial/bons-commande', 'resp', { demande_id: R.dem, fournisseur_id: R.fou,
    lignes: [{ demande_ligne_id: prop.lignes[0].demande_ligne_id, quantite: 10, prix_unitaire: 3600 }] });
  assert.equal(bc.status, 201, bc.message);
  assert.equal(bc.data.lignes[0].unite, 'carton');
  assert.equal(bc.data.lignes[0].quantite_stock, 120);
  assert.equal(bc.data.total_ht, 36000);
  // Décimale refusée sur le bon aussi.
  assert.equal((await appel('PUT', `/commercial/bons-commande/${bc.data.id}`, 'resp', {
    lignes: [{ demande_ligne_id: prop.lignes[0].demande_ligne_id, quantite: 2.5, prix_unitaire: 3600 }] })).status, 400);
  // Le coefficient de l'article change : demande et bon gardent 12.
  assert.equal((await appel('PUT', `/commercial/articles/${R.eau}`, 'dir', { coef_achat: 6 })).status, 200);
  assert.equal((await appel('GET', `/commercial/bons-commande/${bc.data.id}`, 'resp')).data.lignes[0].quantite_stock, 120);
  assert.equal((await appel('GET', `/commercial/demandes/${R.dem}`, 'dir')).data.lignes[0].coefficient, 12);
  // Le PDF d'aperçu affiche l'unité du document.
  const pdf = await binaire(`/commercial/bons-commande/${bc.data.id}/pdf`, 'resp');
  assert.equal(pdf.status, 200);
});

test('Unité de stock figée dès qu\'il y a du stock ; décimales d\'une unité utilisée qui ne baissent pas', async () => {
  const r = await appel('PUT', `/commercial/articles/${R.eau}`, 'dir', { unite_stock_id: R.kg });
  assert.equal(r.status, 409);
  assert.match(r.message, /unité de stock ne change plus/);
  assert.equal((await appel('PUT', `/commercial/unites/${R.kg}`, 'dir', { decimales: 2 })).status, 200, 'kg non utilisé');
  assert.equal((await appel('PUT', `/commercial/unites/${R.carton}`, 'dir', { decimales: 3 })).status, 200, 'augmenter : toujours permis');
  const baisse = await appel('PUT', `/commercial/unites/${R.carton}`, 'dir', { decimales: 0 });
  assert.equal(baisse.status, 409);
  // Renommer une unité de stock renomme le mot affiché sur ses articles.
  assert.equal((await appel('PUT', `/commercial/unites/${R['pièce']}`, 'dir', { code: 'pce' })).status, 200);
  assert.equal((await appel('GET', `/commercial/articles/${R.eau}`, 'dir')).data.unite, 'pce');
});

test('Isolation : une unité d\'un autre client est refusée', async () => {
  const ub = await appel('POST', '/commercial/unites', 'dirB', { code: 'bidon' });
  assert.equal(ub.status, 201, ub.message);
  assert.equal((await appel('PUT', `/commercial/articles/${R.eau}`, 'dir', { unite_vente_id: ub.data.id, coef_vente: 2 })).status, 400);
  assert.equal((await appel('PUT', `/commercial/unites/${ub.data.id}`, 'dir', { libelle: 'pirate' })).status, 404);
});
