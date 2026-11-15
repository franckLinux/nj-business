// tests/commercial-types-gestion.test.js — NJ COMMERCIAL, migration 062.
//
//  Types de gestion (achats, ventes, stock) distincts du rôle : attribution
//  multiple, droits appliqués par le serveur, refus et plafond prioritaires,
//  personnalisation par client sans droits de validation, isolation ; création
//  rapide d'unités et doublons ; familles (unité de stock obligatoire, achat et
//  vente identiques par défaut) ; taxes choisies sur la ligne d'opération.
//
//   TEST_DATABASE_URL=postgres://…/base_de_test  node --test tests/commercial-types-gestion.test.js
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



const perms = async (qui) => (await appel('GET', '/auth/me', qui)).data;
const codesDe = async (qui) => {
  const u = (await appel('GET', '/commercial/utilisateurs', 'dir')).data.utilisateurs.find((x) => x.id === U[qui].id);
  return u.permissions;
};

before(async () => {
  [{ id: A }] = await sql('INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id', [`tga-${sfx}`, `Types A ${sfx}`]);
  [{ id: B }] = await sql('INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id', [`tgb-${sfx}`, `Types B ${sfx}`]);
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
  for (const t of [A, B]) assert.equal((await appel('PUT', `/plateforme/clients/${t}/modules/commercial`, 'adm', { actif: true, motif: 'Tests types de gestion' })).status, 200);
  await creerUtilisateur('dir', 'directeur', A);
  await creerUtilisateur('agent', 'collaborateur', A);                       // rôle de base, sans profil
  await creerUtilisateur('gas', 'collaborateur', A, 'achats_gestionnaire');  // gère les articles, pas le paramétrage
  await creerUtilisateur('dirB', 'directeur', B);
  R.tva = (await appel('POST', '/commercial/taxes', 'dir', { code: 'TVA', intitule: 'TVA', taux: '19,25' })).data.id;
  R.tvaV = (await appel('POST', '/commercial/taxes', 'dir', { code: 'TVAV', intitule: 'TVA ventes', taux: '19,25', usage: 'vente' })).data.id;
  R.cli = (await appel('POST', '/commercial/tiers', 'dir', { type: 'client', nom: 'Client test' })).data.id;
});

after(async () => {
  serveur?.kill();
  for (const t of [A, B]) {
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

test('Catalogue : trois types de gestion, lots par défaut sans aucun droit de validation', async () => {
  const r = await appel('GET', '/commercial/types-gestion', 'dir');
  assert.equal(r.status, 200, r.message);
  assert.deepEqual(r.data.map((t) => t.code), ['achats', 'ventes', 'stock']);
  for (const t of r.data) {
    assert.ok(t.permissions.length > 0, t.code);
    assert.ok(t.permissions.every((c) => c.startsWith('com.') && !/\.(approuver|approuver_direction|emettre|valider|valider_direction|annuler|livrer)$/.test(c)), `${t.code} sans validation`);
  }
  assert.equal((await appel('GET', '/commercial/types-gestion', 'agent')).status, 403, 'réservé à qui administre le module');
});

test('Attribution : un, puis plusieurs types ; les droits suivent, le rôle ne change pas', async () => {
  let c = await codesDe('agent');
  assert.ok(!c.includes('com.bc.preparer') && !c.includes('com.ventes.devis') && !c.includes('com.stock.entree'), 'rien avant attribution');
  assert.equal((await appel('POST', '/commercial/devis', 'agent', { client_id: R.cli, lignes: [] })).status, 403);

  let r = await appel('PUT', `/commercial/utilisateurs/${U.agent.id}/types-gestion`, 'dir', { types: ['achats'] });
  assert.equal(r.status, 200, r.message);
  c = await codesDe('agent');
  for (const x of ['com.da.creer', 'com.bc.preparer', 'com.receptions.saisir', 'com.frais.saisir']) assert.ok(c.includes(x), x);
  assert.ok(!c.includes('com.da.approuver') && !c.includes('com.bc.emettre'), 'les validations restent au rôle');
  assert.ok(!c.includes('com.factures_fourn.saisir'), '063 : la facture fournisseur relève du comptable');

  r = await appel('PUT', `/commercial/utilisateurs/${U.agent.id}/types-gestion`, 'dir', { types: ['achats', 'ventes', 'stock'] });
  const u = r.data.utilisateurs.find((x) => x.id === U.agent.id);
  assert.deepEqual(u.types_gestion, ['achats', 'ventes', 'stock']);
  assert.equal(u.role, 'collaborateur', 'rôle hiérarchique inchangé');
  for (const x of ['com.ventes.devis', 'com.ventes.commandes', 'com.stock.entree', 'com.stock.inventaire', 'com.stock.journal']) assert.ok(u.permissions.includes(x), x);
  assert.ok(u.permissions_types.includes('com.ventes.devis'), 'origine du droit affichée');
  assert.ok(!u.permissions.includes('com.ventes.valider') && !u.permissions.includes('com.stock.valider'));
  // Le serveur applique ces droits : l'agent saisit maintenant un devis.
  const art = await (async () => {
    const un = (await appel('POST', '/commercial/unites', 'dir', { code: 'pièce' })).data.id;
    const fam = (await appel('POST', '/commercial/familles', 'dir', { code: 'DIV', nom: 'Divers', unite_stock_id: un })).data.id;
    return (await appel('POST', '/commercial/articles', 'dir', { reference: 'ART1', designation: 'Article 1', famille_id: fam, prix_vente_indicatif: 1000, suivi_comptable: false })).data.id;
  })();
  R.art = art;
  const d = await appel('POST', '/commercial/devis', 'agent', { client_id: R.cli, lignes: [{ article_id: art, quantite: 2 }] });
  assert.equal(d.status, 201, d.message);
  // /auth/me renvoie les mêmes droits à l'interface.
  const me = await perms('agent');
  const liste = me.permissions || me.user?.permissions || [];
  assert.ok(liste.includes('com.ventes.devis'), 'droits exposés à l\'interface');

  // Retrait : les droits du type disparaissent.
  r = await appel('PUT', `/commercial/utilisateurs/${U.agent.id}/types-gestion`, 'dir', { types: ['stock'] });
  c = await codesDe('agent');
  assert.ok(!c.includes('com.ventes.devis') && !c.includes('com.bc.preparer') && c.includes('com.stock.entree'));
  const [audit] = await sql("SELECT nouvelle_valeur FROM audit_log WHERE action = 'COM_TYPES_GESTION_UTILISATEUR' AND entite_id = $1 ORDER BY id DESC LIMIT 1", [String(U.agent.id)]);
  assert.deepEqual(audit.nouvelle_valeur.types, ['stock']);
  assert.equal((await appel('PUT', `/commercial/utilisateurs/${U.agent.id}/types-gestion`, 'dir', { types: ['compta'] })).status, 400, 'type inconnu');
});

test('Exception « refus » et plafond du client l\'emportent sur le type de gestion', async () => {
  await sql("INSERT INTO user_permissions (user_id, permission_code, effet) VALUES ($1, 'com.stock.entree', 'deny')", [U.agent.id]);
  assert.ok(!(await codesDe('agent')).includes('com.stock.entree'), 'refus individuel');
  await sql("DELETE FROM user_permissions WHERE user_id = $1", [U.agent.id]);
  await sql("INSERT INTO tenant_permissions (tenant_id, permission_code) SELECT $1, code FROM permissions WHERE code <> 'com.stock.sortie'", [A]);
  const c = await codesDe('agent');
  assert.ok(!c.includes('com.stock.sortie') && c.includes('com.stock.entree'), 'plafond du client');
  await sql('DELETE FROM tenant_permissions WHERE tenant_id = $1', [A]);
});

test('Personnalisation par client : lot choisi, droits de niveau refusés, retour au défaut', async () => {
  let r = await appel('PUT', '/commercial/types-gestion/stock', 'dir', { permissions: ['com.stock.voir', 'com.stock.valider'] });
  assert.equal(r.status, 400);
  assert.match(r.message, /validation ou de paramétrage/);
  r = await appel('PUT', '/commercial/types-gestion/stock', 'dir', { permissions: ['com.articles.voir', 'com.stock.voir', 'com.stock.inventaire'] });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.find((t) => t.code === 'stock').personnalise, true);
  let c = await codesDe('agent');
  assert.ok(c.includes('com.stock.inventaire') && !c.includes('com.stock.entree'), 'lot du client appliqué');
  // Le client B garde le lot par défaut.
  const tb = (await appel('GET', '/commercial/types-gestion', 'dirB')).data.find((t) => t.code === 'stock');
  assert.equal(tb.personnalise, false);
  assert.ok(tb.permissions.includes('com.stock.entree'));
  r = await appel('PUT', '/commercial/types-gestion/stock', 'dir', { defaut: true });
  assert.equal(r.status, 200);
  c = await codesDe('agent');
  assert.ok(c.includes('com.stock.entree'), 'défaut rétabli');
});

test('Isolation : un autre client ne touche ni aux personnes ni aux lots', async () => {
  assert.equal((await appel('PUT', `/commercial/utilisateurs/${U.agent.id}/types-gestion`, 'dirB', { types: ['ventes'] })).status, 404);
  assert.equal((await appel('PUT', `/commercial/utilisateurs/${U.agent.id}/types-gestion`, 'agent', { types: ['ventes'] })).status, 403);
  await assert.rejects(sql("INSERT INTO com_utilisateur_types_gestion (user_id, type_code, tenant_id) VALUES ($1, 'ventes', $2)", [U.agent.id, B]), /autre client/);
});

test('Unités : création rapide ouverte à qui gère les articles ; doublons refusés', async () => {
  const r = await appel('POST', '/commercial/unites', 'gas', { code: 'CARTON', libelle: 'Carton' });
  assert.equal(r.status, 201, r.message);
  assert.equal((await appel('PUT', `/commercial/unites/${r.data.id}`, 'gas', { libelle: 'Carton de 12' })).status, 403, 'modifier reste au paramétrage');
  const dbl = await appel('POST', '/commercial/unites', 'dir', { code: 'carton' });
  assert.equal(dbl.status, 409);
  assert.match(dbl.message, /existe déjà/);
  assert.equal((await appel('POST', '/commercial/unites', 'dir', { code: 'CT', libelle: 'CARTON' })).status, 409, 'même libellé');
  assert.equal((await appel('POST', '/commercial/unites', 'agent', { code: 'SAC' })).status, 403);
  R.carton = r.data.id;
});

test('Familles : unité de stock obligatoire ; achat et vente identiques par défaut, modifiables', async () => {
  const sans = await appel('POST', '/commercial/familles', 'dir', { code: 'X', nom: 'Sans unité' });
  assert.equal(sans.status, 400);
  const sac = (await appel('POST', '/commercial/unites', 'dir', { code: 'SAC' })).data.id;
  const f = await appel('POST', '/commercial/familles', 'dir', { code: 'CIM', nom: 'Ciment', unite_stock_id: sac, taxe_achat_id: R.tva });
  assert.equal(f.status, 201, f.message);
  assert.equal(f.data.unite_achat_id, sac);
  assert.equal(f.data.unite_vente_id, sac);
  assert.equal(f.data.taxe_achat_id, null, 'aucune taxe sur la famille');
  const m = await appel('PUT', `/commercial/familles/${f.data.id}`, 'dir', { unite_achat_id: R.carton, coef_achat: 10 });
  assert.equal(m.status, 200, m.message);
  assert.equal(m.data.unite_achat_id, R.carton);
  assert.equal(m.data.coef_achat, 10);
  assert.equal(m.data.unite_vente_id, sac);
  const a = await appel('POST', '/commercial/articles', 'dir', { reference: 'CIM50', designation: 'Ciment 50 kg', famille_id: f.data.id, suivi_comptable: true });
  assert.equal(a.status, 201, a.message);
  assert.equal(a.data.unite_stock_id, sac);
  assert.equal(a.data.unite_achat_id, R.carton);
  assert.equal(a.data.coef_achat, 10);
  assert.equal(a.data.unite_vente_id, sac);
});

test('Taxes : choisies sur la ligne du devis, jamais reprises de l\'article ; HT / TVA / TTC', async () => {
  const sans = await appel('POST', '/commercial/devis', 'dir', { client_id: R.cli, lignes: [{ article_id: R.art, quantite: 3 }] });
  assert.equal(sans.status, 201, sans.message);
  assert.deepEqual([sans.data.total_ht, sans.data.total_taxes, sans.data.total_ttc], [3000, 0, 3000]);
  const avec = await appel('POST', '/commercial/devis', 'dir', { client_id: R.cli, lignes: [{ article_id: R.art, quantite: 3, taxe_id: R.tvaV }] });
  assert.deepEqual([avec.data.total_ht, avec.data.total_taxes, avec.data.total_ttc], [3000, 578, 3578], '3 000 × 19,25 % = 577,5 → 578');
  assert.equal(avec.data.lignes[0].taxe_code, 'TVAV');
  // Taux figé : la taxe appliquée sur un document ne change plus de taux.
  assert.equal((await appel('PUT', `/commercial/taxes/${R.tvaV}`, 'dir', { taux: 20 })).status, 409);
  const t = (await appel('GET', '/commercial/taxes', 'dir')).data.find((x) => x.id === R.tvaV);
  assert.ok(t.nb_utilisations >= 1);
});
