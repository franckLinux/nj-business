// tests/commercial-parametrage.test.js — NJ COMMERCIAL, livraison A (migration 050).
//
//  • module inactif → 403 MODULE_INACTIF ; activation → profils achats créés ;
//  • magasins, familles (plusieurs fournisseurs), taxes, articles (suivi comptable),
//    fournisseurs / clients (registre partagé), stock initial ;
//  • doublons refusés, article utilisé non supprimable, stock « non suivi » sans mouvement ;
//  • droits : caissier refusé, collaborateur en lecture, banque réservée ;
//  • isolation entre deux clients.
//
//   TEST_DATABASE_URL=postgres://…/base_de_test  node --test tests/commercial-parametrage.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
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
const PORT = 8600 + Math.floor(Math.random() * 300);
const sfx = crypto.randomBytes(3).toString('hex');
const pool = new Pool({ connectionString: DB });
const U = {};
let serveur;
let A;
let B;

const sql = async (texte, params = []) => (await pool.query(texte, params)).rows;
const appel = async (methode, url, qui, corps) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api${url}`, {
    method: methode,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${U[qui].token}` },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.data ?? j, message: j.message ?? j.error, code: j.code ?? j.data?.code };
};
const creerUtilisateur = async (cle, role, tenant) => {
  const username = `${cle}-${sfx}`;
  const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif)
                          VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
  [tenant, username, `${username}@test.cm`, await bcrypt.hash('x', 4), role]);
  U[cle] = { id: u.id, username, token: jwt.sign({ sub: u.id, username, role, tenantId: tenant }, SECRET, { expiresIn: '1h' }) };
};

before(async () => {
  [{ id: A }] = await sql('INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id', [`coma-${sfx}`, `Commercial A ${sfx}`]);
  [{ id: B }] = await sql('INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id', [`comb-${sfx}`, `Commercial B ${sfx}`]);
  // B a un plafond de permissions : l'activation doit y ajouter les com.*.
  await sql("INSERT INTO tenant_permissions (tenant_id, permission_code) SELECT $1, code FROM permissions WHERE module = 'journal'", [B]);
  await creerUtilisateur('adm', 'super_admin', null);
  await creerUtilisateur('dirA', 'directeur', A);
  await creerUtilisateur('caiA', 'caissier', A);
  await creerUtilisateur('colA', 'collaborateur', A);
  await creerUtilisateur('dirB', 'directeur', B);
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
    // Tout ou rien : un client que ses données métier empêchent de supprimer garde ses modules.
    const c = await pool.connect();
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

const ids = {};

test('Module inactif : 403 MODULE_INACTIF ; activation : profils achats créés, plafond complété', async () => {
  const r = await appel('GET', '/commercial/magasins', 'dirA');
  assert.equal(r.status, 403);
  assert.equal(r.code, 'MODULE_INACTIF');
  for (const t of [A, B]) {
    const a = await appel('PUT', `/plateforme/clients/${t}/modules/commercial`, 'adm', { actif: true, motif: 'Test achats' });
    assert.equal(a.status, 200, a.message);
  }
  const profils = await sql("SELECT code FROM roles WHERE tenant_id = $1 AND code LIKE 'achats_%' ORDER BY code", [A]);
  assert.deepEqual(profils.map((p) => p.code), ['achats_demandeur', 'achats_gestionnaire', 'achats_responsable']);
  const [{ n }] = await sql("SELECT COUNT(*)::int AS n FROM tenant_permissions WHERE tenant_id = $1 AND permission_code LIKE 'com.%'", [B]);
  const [{ total }] = await sql("SELECT COUNT(*)::int AS total FROM permissions WHERE module = 'commercial'");
  assert.equal(n, total, 'plafond de B complété');
  // Réactivation sans effet de bord : pas de doublon de profils.
  await appel('PUT', `/plateforme/clients/${A}/modules/commercial`, 'adm', { actif: false, motif: 'Test désactivation' });
  await appel('PUT', `/plateforme/clients/${A}/modules/commercial`, 'adm', { actif: true, motif: 'Test réactivation' });
  const [{ m }] = await sql("SELECT COUNT(*)::int AS m FROM roles WHERE tenant_id = $1 AND code LIKE 'achats_%'", [A]);
  assert.equal(m, 3);
});

test('Droits : caissier refusé, collaborateur en lecture seule', async () => {
  assert.equal((await appel('GET', '/commercial/magasins', 'caiA')).status, 403);
  assert.equal((await appel('GET', '/commercial/magasins', 'colA')).status, 200);
  assert.equal((await appel('POST', '/commercial/magasins', 'colA', { code: 'X', nom: 'X' })).status, 403);
  assert.equal((await appel('GET', '/commercial/societe', 'colA')).status, 200);
  assert.equal((await appel('PUT', '/commercial/societe', 'colA', { nom_commercial: 'X' })).status, 403);
});

test('Société : identité reprise de l\'Entité, paramètres du module enregistrés', async () => {
  let r = await appel('GET', '/commercial/societe', 'dirA');
  assert.equal(r.data.identite.raison_sociale, `Commercial A ${sfx}`);
  assert.equal(r.data.parametres.seuil_direction, 500000);
  r = await appel('PUT', '/commercial/societe', 'dirA', { nom_commercial: 'Kamga Distribution', prefixe_bc: 'bck', seuil_direction: '' });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.parametres.prefixe_bc, 'BCK');
  assert.equal(r.data.parametres.seuil_direction, null, 'pas d\'étape direction');
  assert.equal((await appel('PUT', '/commercial/societe', 'dirA', { prefixe_da: 'trop-long!' })).status, 400);
});

test('Magasins : création, code unique sans tenir compte de la casse, désactivation', async () => {
  let r = await appel('POST', '/commercial/magasins', 'dirA', { code: 'mag01', nom: 'Magasin central', localisation: 'Yaoundé', responsable_id: U.colA.id });
  assert.equal(r.status, 201, r.message);
  assert.equal(r.data.code, 'MAG01');
  ids.mag = r.data.id;
  assert.equal((await appel('POST', '/commercial/magasins', 'dirA', { code: 'MAG01', nom: 'Doublon' })).status, 409);
  r = await appel('POST', '/commercial/magasins', 'dirA', { code: 'MAG02', nom: 'Annexe' });
  ids.mag2 = r.data.id;
  assert.equal((await appel('POST', '/commercial/magasins', 'dirA', { code: 'MAG03', nom: 'Autre', responsable_id: U.dirB.id })).status, 400, 'responsable d\'un autre client');
  r = await appel('PUT', `/commercial/magasins/${ids.mag2}`, 'dirA', { actif: false });
  assert.equal(r.data.actif, false);
  assert.equal((await appel('GET', '/commercial/magasins?actifs=1', 'dirA')).data.length, 1);
});

test('Fournisseurs : registre partagé, fiche achats, banque réservée', async () => {
  const noms = ['Bureau Plus', 'Info Services', 'Papeterie du Centre'];
  ids.fou = [];
  for (const [i, nom] of noms.entries()) {
    const r = await appel('POST', '/commercial/tiers', 'dirA', { type: 'fournisseur', nom, code: `F00${i + 1}`, ville: 'Douala',
      contact_nom: 'M. Test', conditions_paiement: '30 jours fin de mois', banque: { banque: 'Afriland', rib_iban: `CM21 1000 2000 300${i}` } });
    assert.equal(r.status, 201, r.message);
    ids.fou.push(r.data.id);
  }
  const [reg] = await sql('SELECT type, nom FROM registre_tiers WHERE id = $1', [ids.fou[0]]);
  assert.equal(reg.nom, 'Bureau Plus', 'créé dans le registre des tiers de la caisse');
  let r = await appel('POST', '/commercial/tiers', 'dirA', { type: 'client', nom: 'Client Alpha', code: 'C001' });
  ids.client = r.data.id;
  assert.equal((await appel('POST', '/commercial/tiers', 'dirA', { type: 'fournisseur', nom: 'Doublon', code: 'f001' })).status, 409);
  assert.equal((await appel('POST', '/commercial/tiers', 'dirA', { type: 'fournisseur', nom: 'Mail', contact_email: 'pas-un-mail' })).status, 400);
  const dir = (await appel('GET', '/commercial/tiers?type=fournisseur', 'dirA')).data.find((t) => t.id === ids.fou[0]);
  assert.equal(dir.rib_iban, 'CM21 1000 2000 3000');
  const col = (await appel('GET', '/commercial/tiers?type=fournisseur', 'colA')).data.find((t) => t.id === ids.fou[0]);
  assert.equal(col.rib_iban, undefined, 'RIB masqué sans permission');
  assert.equal(col.a_banque, true);
  r = await appel('PUT', `/commercial/tiers/${ids.fou[0]}`, 'dirA', { telephone: '699000000', contact_nom: 'Mme Ndi' });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.telephone, '699000000');
  assert.equal(r.data.contact_nom, 'Mme Ndi');
  const [audit] = await sql("SELECT nouvelle_valeur FROM audit_log WHERE action = 'COM_TIERS_BANQUE' AND entite_id = $1", [String(ids.fou[0])]);
  assert.equal(audit.nouvelle_valeur.rib_fin, '…3000', 'trace sans le numéro complet');
});

test('Familles : plusieurs fournisseurs, client refusé, fournisseur d\'un autre client refusé', async () => {
  let r = await appel('POST', '/commercial/familles', 'dirA', { code: 'FOURN', nom: 'Fournitures de bureau', fournisseur_ids: ids.fou });
  assert.equal(r.status, 201, r.message);
  assert.equal(r.data.fournisseurs.length, 3);
  ids.fam = r.data.id;
  r = await appel('POST', '/commercial/familles', 'dirA', { code: 'INFO', nom: 'Matériel informatique', fournisseur_ids: [ids.fou[1]] });
  ids.fam2 = r.data.id;
  assert.equal((await appel('POST', '/commercial/familles', 'dirA', { code: 'X1', nom: 'X', fournisseur_ids: [ids.client] })).status, 400);
  const autre = await appel('POST', '/commercial/tiers', 'dirB', { type: 'fournisseur', nom: 'Fournisseur de B' });
  ids.fouB = autre.data.id;
  assert.equal((await appel('POST', '/commercial/familles', 'dirA', { code: 'X2', nom: 'X', fournisseur_ids: [ids.fouB] })).status, 400);
  // Un fournisseur peut servir plusieurs familles.
  const t = (await appel('GET', '/commercial/tiers?type=fournisseur', 'dirA')).data.find((x) => x.id === ids.fou[1]);
  assert.equal(t.familles.length, 2);
});

test('Taxes : taux contrôlé', async () => {
  let r = await appel('POST', '/commercial/taxes', 'dirA', { code: 'TVA', intitule: 'TVA', taux: '19,25', type: 'tva' });
  assert.equal(r.status, 201, r.message);
  assert.equal(r.data.taux, 19.25);
  ids.tva = r.data.id;
  assert.equal((await appel('POST', '/commercial/taxes', 'dirA', { code: 'BAD', intitule: 'x', taux: 120 })).status, 400);
  assert.equal((await appel('POST', '/commercial/taxes', 'dirA', { code: 'tva', intitule: 'x', taux: 5 })).status, 409);
});

test('Articles : suivi comptable obligatoire, référence unique, filtres', async () => {
  assert.equal((await appel('POST', '/commercial/articles', 'dirA', { reference: 'RAM-A4', designation: 'Rame A4', famille_id: ids.fam })).status, 400, 'suivi comptable non précisé');
  let r = await appel('POST', '/commercial/articles', 'dirA', { reference: 'ram-a4', designation: 'Rame papier A4 80 g', famille_id: ids.fam,
    unite: 'rame', prix_achat_indicatif: 3500, taxe_id: ids.tva, seuil_alerte: 20, suivi_comptable: true, magasin_ids: [ids.mag] });
  assert.equal(r.status, 201, r.message);
  assert.equal(r.data.reference, 'RAM-A4');
  assert.equal(r.data.suivi_comptable, true);
  assert.equal(r.data.fournisseurs_famille.length, 3, 'fournisseurs repris de la famille');
  ids.art = r.data.id;
  r = await appel('POST', '/commercial/articles', 'dirA', { reference: 'SOURIS-01', designation: 'Souris optique', famille_id: ids.fam2,
    suivi_comptable: false, fournisseur_ids: [ids.fou[2]] });
  assert.equal(r.data.suivi_comptable, false);
  ids.art2 = r.data.id;
  assert.equal((await appel('POST', '/commercial/articles', 'dirA', { reference: 'RAM-A4', designation: 'Doublon', famille_id: ids.fam, suivi_comptable: true })).status, 409);
  assert.equal((await appel('GET', '/commercial/articles?suivi=0', 'dirA')).data.length, 1);
  // Filtre fournisseur : par la famille (RAM-A4) ou en direct (SOURIS-01).
  const parFou = (await appel('GET', `/commercial/articles?fournisseur_id=${ids.fou[2]}`, 'dirA')).data.map((a) => a.reference).sort();
  assert.deepEqual(parFou, ['RAM-A4', 'SOURIS-01']);
  assert.equal((await appel('GET', '/commercial/articles?q=souris', 'colA')).data.length, 1, 'recherche par désignation');
});

test('Stock : « non suivi » sans mouvement, stock initial, article utilisé non supprimable', async () => {
  let r = await appel('GET', `/commercial/stock?article_id=${ids.art}&magasin_id=${ids.mag}`, 'colA');
  assert.equal(r.data.magasins[0].suivi, false);
  assert.equal(r.data.magasins[0].quantite, null, 'jamais 0 inventé');
  assert.equal(r.data.reservations_gerees, false);
  assert.equal((await appel('PUT', '/commercial/stock/initial', 'colA', { article_id: ids.art, magasin_id: ids.mag, quantite: 5, date_mouvement: '2026-10-01' })).status, 403);
  r = await appel('PUT', '/commercial/stock/initial', 'dirA', { article_id: ids.art, magasin_id: ids.mag, quantite: '100', date_mouvement: '2026-10-01', piece: 'INV-OUV-01' });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.stock.quantite, 100);
  r = await appel('PUT', '/commercial/stock/initial', 'dirA', { article_id: ids.art, magasin_id: ids.mag, quantite: 96, date_mouvement: '2026-10-01' });
  assert.equal(r.data.stock.quantite, 96, 'correction du stock initial');
  assert.equal((await appel('PUT', '/commercial/stock/initial', 'dirA', { article_id: ids.art, magasin_id: ids.mag2, quantite: 1, date_mouvement: '2026-10-01' })).status, 400, 'magasin désactivé');
  assert.equal((await appel('PUT', '/commercial/stock/initial', 'dirA', { article_id: ids.art, magasin_id: ids.mag, quantite: 1, date_mouvement: '2999-01-01' })).status, 400, 'date future');
  assert.equal((await appel('DELETE', `/commercial/articles/${ids.art}`, 'dirA')).status, 409);
  assert.equal((await appel('DELETE', `/commercial/articles/${ids.art2}`, 'dirA')).status, 200, 'article jamais utilisé');
  r = await appel('GET', `/commercial/articles/${ids.art}`, 'dirA');
  assert.equal(r.data.utilise, true);
  assert.equal(r.data.stock.find((s) => s.magasin_id === ids.mag).quantite, 96);
});

test('Isolation : le client B ne voit ni ne touche les données de A', async () => {
  assert.equal((await appel('GET', '/commercial/magasins', 'dirB')).data.length, 0);
  assert.equal((await appel('GET', '/commercial/articles', 'dirB')).data.length, 0);
  assert.equal((await appel('PUT', `/commercial/magasins/${ids.mag}`, 'dirB', { nom: 'Piraté' })).status, 404);
  assert.equal((await appel('GET', `/commercial/articles/${ids.art}`, 'dirB')).status, 404);
  assert.equal((await appel('GET', `/commercial/stock?article_id=${ids.art}`, 'dirB')).status, 404);
  assert.equal((await appel('PUT', `/commercial/tiers/${ids.fou[0]}`, 'dirB', { nom: 'Piraté' })).status, 404);
  const [m] = await sql('SELECT nom FROM com_magasins WHERE id = $1', [ids.mag]);
  assert.equal(m.nom, 'Magasin central');
});

test('Traçabilité : chaque opération est au journal d\'audit', async () => {
  const actions = (await sql("SELECT DISTINCT action FROM audit_log WHERE tenant_id = $1 AND entite = 'commercial'", [A])).map((r) => r.action);
  for (const a of ['COM_PARAMETRES', 'COM_MAGASIN_CREATION', 'COM_MAGASIN_MODIFICATION', 'COM_FAMILLE_CREATION', 'COM_TAXE_CREATION',
    'COM_ARTICLE_CREATION', 'COM_ARTICLE_SUPPRESSION', 'COM_STOCK_INITIAL', 'COM_STOCK_INITIAL_CORRECTION', 'COM_TIERS_FICHE', 'COM_TIERS_BANQUE']) {
    assert.ok(actions.includes(a), `${a} tracé`);
  }
});

test('Suppression d\'un client : un client qui a des articles ne se supprime plus', async () => {
  await sql('UPDATE tenants SET actif = false WHERE id = $1', [A]);
  const r = await appel('GET', `/plateforme/clients/${A}/suppression`, 'adm');
  assert.equal(r.data.supprimable, false);
  assert.match(r.data.raisons.join(' '), /article/);
});
