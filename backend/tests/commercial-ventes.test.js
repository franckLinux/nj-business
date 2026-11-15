// tests/commercial-ventes.test.js — NJ COMMERCIAL, lot 6 (migration 059) : ventes.
//
//  Devis (prix par défaut converti dans l'unité, remise, taxe de vente), validation
//  par le responsable puis la direction (seuil des ventes, plafond de remise),
//  séparation des tâches, acceptation → commande, expiration, refus, duplication ;
//  préparation puis livraison partielle (sortie au CMUP), jamais au-delà du reste,
//  stock négatif refusé, annulation qui rentre le stock, intangibilité, isolation.
//  Valeurs calculées à la main.
//
//   TEST_DATABASE_URL=postgres://…/base_de_test  node --test tests/commercial-ventes.test.js
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


before(async () => {
  [{ id: A }] = await sql('INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id', [`vta-${sfx}`, `Ventes A ${sfx}`]);
  [{ id: B }] = await sql('INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id', [`vtb-${sfx}`, `Ventes B ${sfx}`]);
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
  for (const t of [A, B]) assert.equal((await appel('PUT', `/plateforme/clients/${t}/modules/commercial`, 'adm', { actif: true, motif: 'Tests ventes' })).status, 200);
  await creerUtilisateur('dir', 'directeur', A);
  await creerUtilisateur('com', 'collaborateur', A, 'ventes_commercial');
  await creerUtilisateur('resp', 'collaborateur', A, 'ventes_responsable');
  await creerUtilisateur('mag', 'collaborateur', A, 'stock_magasinier');
  await creerUtilisateur('ges', 'collaborateur', A, 'stock_gestionnaire');
  await creerUtilisateur('dirB', 'directeur', B);
  for (const [code, decimales] of [['pièce', 0], ['carton', 0]]) {
    R[code] = (await appel('POST', '/commercial/unites', 'dir', { code, libelle: code, decimales })).data.id;
  }
  R.tva = (await appel('POST', '/commercial/taxes', 'dir', { code: 'TVA', intitule: 'TVA', taux: '19,25' })).data.id;
  R.cli = (await appel('POST', '/commercial/tiers', 'dir', { type: 'client', nom: 'Hôtel du Lac' })).data.id;
  R.fou = (await appel('POST', '/commercial/tiers', 'dir', { type: 'fournisseur', nom: 'Sobraga' })).data.id;
  R.fam = (await appel('POST', '/commercial/familles', 'dir', { code: 'BOI', nom: 'Boissons', unite_stock_id: R['pièce'], methode_valorisation: 'cmup' })).data.id;
  const eau = await appel('POST', '/commercial/articles', 'dir', { reference: 'EAU', designation: 'Eau minérale', famille_id: R.fam,
    unite_vente_id: R.carton, coef_vente: 12, prix_vente_indicatif: 6000, suivi_comptable: false });
  assert.equal(eau.status, 201, eau.message);
  R.eau = eau.data.id;
  const liv = await appel('POST', '/commercial/articles', 'dir', { reference: 'TRANSPORT', designation: 'Transport', famille_id: R.fam,
    suivi_stock: false, prix_vente_indicatif: 5000, suivi_comptable: false });
  assert.equal(liv.status, 201, liv.message);
  R.liv = liv.data.id;
  R.cen = (await appel('POST', '/commercial/magasins', 'dir', { code: 'CEN', nom: 'Central' })).data.id;
  assert.equal((await appel('PUT', '/commercial/stock/initial', 'dir', { article_id: R.eau, magasin_id: R.cen, quantite: 100, cout_unitaire: 250, date_mouvement: '2026-10-01' })).status, 200);
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

const solde = async (article, magasin) => (await appel('GET', `/commercial/stock/etat?magasin_id=${magasin}`, 'dir')).data.find((l) => l.article_id === article);
const devisValide = async (corps, valideur = 'resp') => {
  const c = await appel('POST', '/commercial/devis', 'com', { client_id: R.cli, ...corps });
  assert.equal(c.status, 201, c.message);
  assert.equal((await appel('POST', `/commercial/devis/${c.data.id}/soumission`, 'com')).status, 200);
  const v = await appel('POST', `/commercial/devis/${c.data.id}/validation`, valideur);
  assert.equal(v.status, 200, v.message);
  return v.data;
};

test('Devis : prix par défaut converti, remise, taxe de vente, totaux ; validation par le responsable', async () => {
  const c = await appel('POST', '/commercial/devis', 'com', { client_id: R.cli, objet: 'Approvisionnement bar',
    // 062 : la taxe se choisit sur chaque ligne du devis (l'article n'en porte plus).
    lignes: [{ article_id: R.eau, quantite: 5, remise_pct: 5, taxe_id: R.tva }, { article_id: R.liv, quantite: 1, taxe_id: '' }, { article_id: R.eau, unite_id: R['pièce'], quantite: 6, taxe_id: R.tva }] });
  assert.equal(c.status, 201, c.message);
  const d = c.data;
  assert.match(d.numero, /^DEV-\d{4}-\d{4}$/);
  assert.equal(d.lignes[0].unite, 'carton');
  assert.equal(d.lignes[0].prix_unitaire, 6000);
  assert.equal(d.lignes[2].prix_unitaire, 500, '6 000 le carton de 12 = 500 la pièce');
  assert.equal(d.lignes[1].taxe_code, '', 'transport sans taxe');
  // HT = 28 500 + 5 000 + 3 000 = 36 500 ; TVA = 5 486 + 578 = 6 064 (arrondi par ligne) ; brut = 38 000.
  assert.equal(d.total_brut, 38000);
  assert.equal(d.total_ht, 36500);
  assert.equal(d.total_taxes, 6064);
  assert.equal(d.total_ttc, 42564);
  assert.equal(d.niveau_calcule.niveau, 'responsable');
  const j = new Date(); j.setUTCDate(j.getUTCDate() + 30);
  assert.equal(d.date_validite, j.toISOString().slice(0, 10), 'validité par défaut : 30 jours');
  assert.equal((await appel('PUT', `/commercial/devis/${d.id}`, 'com', { lignes: [{ article_id: R.eau, quantite: 1.5 }] })).status, 400, 'carton entier');
  assert.equal((await appel('POST', `/commercial/devis/${d.id}/soumission`, 'com')).status, 200);
  assert.equal((await appel('PUT', `/commercial/devis/${d.id}`, 'com', { objet: 'X' })).status, 409, 'figé après soumission');
  assert.equal((await appel('POST', `/commercial/devis/${d.id}/validation`, 'com')).status, 403, 'le commercial ne valide pas');
  const v = await appel('POST', `/commercial/devis/${d.id}/validation`, 'resp');
  assert.equal(v.status, 200, v.message);
  assert.equal(v.data.statut, 'valide');
  const p = await binaire(`/commercial/devis/${d.id}/pdf`, 'com');
  assert.equal(p.status, 200);
  assert.equal(p.buffer.subarray(0, 4).toString(), '%PDF');
  // Le responsable ne valide pas son propre devis.
  const own = await appel('POST', '/commercial/devis', 'resp', { client_id: R.cli, lignes: [{ article_id: R.eau, quantite: 1 }] });
  await appel('POST', `/commercial/devis/${own.data.id}/soumission`, 'resp');
  const auto = await appel('POST', `/commercial/devis/${own.data.id}/validation`, 'resp');
  assert.equal(auto.status, 403);
  assert.match(auto.message, /autre valideur/);
  assert.equal((await appel('POST', `/commercial/devis/${own.data.id}/renvoi`, 'dir', { motif: 'Préciser le délai' })).data.statut, 'brouillon');
  assert.equal((await appel('DELETE', `/commercial/devis/${own.data.id}`, 'resp')).status, 200);
  R.devis = d.id;
});

test('Direction : remise au-delà du plafond ou montant au-delà du seuil', async () => {
  const c = await appel('POST', '/commercial/devis', 'com', { client_id: R.cli, lignes: [{ article_id: R.eau, quantite: 2, remise_pct: 15 }] });
  await appel('POST', `/commercial/devis/${c.data.id}/soumission`, 'com');
  const r1 = await appel('POST', `/commercial/devis/${c.data.id}/validation`, 'resp');
  assert.equal(r1.data.statut, 'a_valider_direction');
  assert.match(r1.data.motif_direction, /remise de 15 %/);
  assert.equal((await appel('POST', `/commercial/devis/${c.data.id}/validation`, 'resp')).status, 403, 'le responsable n\'a pas le droit de direction');
  assert.equal((await appel('POST', `/commercial/devis/${c.data.id}/validation`, 'dir')).data.statut, 'valide');
  // 200 cartons = 1 200 000 HT > seuil : le directeur valide les deux niveaux d'un coup.
  const g = await appel('POST', '/commercial/devis', 'com', { client_id: R.cli, lignes: [{ article_id: R.eau, quantite: 200 }] });
  await appel('POST', `/commercial/devis/${g.data.id}/soumission`, 'com');
  assert.equal((await appel('GET', `/commercial/devis/${g.data.id}`, 'com')).data.niveau, 'direction');
  const v = await appel('POST', `/commercial/devis/${g.data.id}/validation`, 'dir');
  assert.equal(v.data.statut, 'valide');
  assert.ok(v.data.valide_resp_par && v.data.valide_dir_par);
  const cpt = (await appel('GET', '/commercial/ventes/compteurs', 'resp')).data;
  assert.equal(typeof cpt.devis_a_valider, 'number');
});

test('Client : acceptation → commande ; expiré, refus, duplication', async () => {
  const sans = await appel('POST', `/commercial/devis/${R.devis}/acceptation`, 'mag', {});
  assert.equal(sans.status, 403);
  const a = await appel('POST', `/commercial/devis/${R.devis}/acceptation`, 'com', { reference_client: 'BC-HDL-0042', date_livraison_souhaitee: '2099-01-01',
    piece: { nom_fichier: 'bc-client.pdf', data_base64: Buffer.from('%PDF-1.4\n% bon de commande du client\n').toString('base64') } });
  assert.equal(a.status, 201, a.message);
  assert.match(a.data.numero, /^CDC-\d{4}-\d{4}$/);
  assert.equal(a.data.total_ttc, 42564);
  assert.equal(a.data.lignes.length, 3);
  assert.equal(a.data.etat_livraison, 'a_livrer');
  assert.equal(a.data.pieces.length, 1);
  assert.equal((await appel('GET', `/commercial/devis/${R.devis}`, 'com')).data.statut, 'accepte');
  assert.equal((await appel('POST', `/commercial/devis/${R.devis}/acceptation`, 'com', {})).status, 409, 'une seule commande');
  R.cmd = a.data.id; R.cl = a.data.lignes;
  // Devis expiré : non acceptable ; dupliqué en nouveau brouillon.
  const e = await devisValide({ lignes: [{ article_id: R.eau, quantite: 1 }] });
  const cx = await pool.connect();
  try {
    await cx.query('SET session_replication_role = replica');
    await cx.query("UPDATE com_devis SET date_devis = '2026-01-01', date_validite = '2026-01-31' WHERE id = $1", [e.id]);
  } finally { await cx.query('RESET session_replication_role'); cx.release(); }
  const lu = (await appel('GET', `/commercial/devis/${e.id}`, 'com')).data;
  assert.equal(lu.expire, true);
  assert.equal(lu.droits.accepter, false);
  const acc = await appel('POST', `/commercial/devis/${e.id}/acceptation`, 'com', {});
  assert.equal(acc.status, 409);
  assert.match(acc.message, /expiré/);
  const dup = await appel('POST', `/commercial/devis/${e.id}/duplication`, 'com');
  assert.equal(dup.status, 201, dup.message);
  assert.equal(dup.data.statut, 'brouillon');
  assert.notEqual(dup.data.numero, e.numero);
  assert.equal((await appel('POST', `/commercial/devis/${e.id}/refus`, 'com', { motif: '' })).status, 400);
  assert.equal((await appel('POST', `/commercial/devis/${e.id}/refus`, 'com', { motif: 'Prix trop élevé' })).data.statut, 'refuse');
});

test('Livraison partielle : préparée, validée par un autre ; sortie au CMUP ; reste et stock contrôlés', async () => {
  const eau = R.cl.find((l) => l.unite === 'carton'); const tr = R.cl.find((l) => l.article_id === R.liv);
  const prop = (await appel('GET', `/commercial/livraisons/proposition/${R.cmd}?magasin_id=${R.cen}`, 'mag')).data;
  assert.equal(prop.lignes.find((l) => l.id === eau.id).disponible, 8.333, '100 pièces = 8,333 cartons');
  const c = await appel('POST', '/commercial/livraisons', 'mag', { commande_id: R.cmd, magasin_id: R.cen, transporteur: 'Camion 12',
    lignes: [{ commande_ligne_id: eau.id, quantite: 3 }, { commande_ligne_id: tr.id, quantite: 1 }] });
  assert.equal(c.status, 201, c.message);
  assert.match(c.data.numero, /^BLC-\d{4}-\d{4}$/);
  assert.equal((await appel('POST', `/commercial/livraisons/${c.data.id}/preparation`, 'mag')).data.statut, 'preparee');
  assert.equal((await solde(R.eau, R.cen)).quantite, 100, 'stock inchangé avant validation');
  assert.equal((await appel('POST', `/commercial/livraisons/${c.data.id}/validation`, 'mag')).status, 403, 'le magasinier ne valide pas');
  const v = await appel('POST', `/commercial/livraisons/${c.data.id}/validation`, 'ges');
  assert.equal(v.status, 200, v.message);
  assert.equal(v.data.statut, 'livree');
  assert.equal(v.data.mouvements.length, 1, 'le transport ne bouge pas le stock');
  assert.equal(v.data.mouvements[0].type, 'livraison');
  assert.equal(v.data.mouvements[0].quantite, 36);
  assert.equal(v.data.mouvements[0].cout_unitaire, 250, 'CMUP du moment');
  const s = await solde(R.eau, R.cen);
  assert.equal(s.quantite, 64);
  assert.equal(s.valeur, 16000);
  const cmd = (await appel('GET', `/commercial/commandes-clients/${R.cmd}`, 'com')).data;
  assert.equal(cmd.etat_livraison, 'partielle');
  assert.equal(cmd.lignes.find((l) => l.id === eau.id).reste, 2);
  const bl = await binaire(`/commercial/livraisons/${c.data.id}/pdf`, 'mag');
  assert.equal(bl.status, 200);
  assert.equal(bl.buffer.subarray(0, 4).toString(), '%PDF');
  // Au-delà du reste : refusé à la préparation.
  const trop = await appel('POST', '/commercial/livraisons', 'ges', { commande_id: R.cmd, magasin_id: R.cen, lignes: [{ commande_ligne_id: eau.id, quantite: 3 }] });
  const pr = await appel('POST', `/commercial/livraisons/${trop.data.id}/preparation`, 'ges');
  assert.equal(pr.status, 400);
  assert.match(pr.message, /il n'en reste que 2/);
  await appel('PUT', `/commercial/livraisons/${trop.data.id}`, 'ges', { lignes: [{ commande_ligne_id: eau.id, quantite: 2 }, { commande_ligne_id: R.cl[2].id, quantite: 6 }] });
  assert.equal((await appel('POST', `/commercial/livraisons/${trop.data.id}/preparation`, 'ges')).status, 200);
  const auto = await appel('POST', `/commercial/livraisons/${trop.data.id}/validation`, 'ges');
  assert.equal(auto.status, 403, 'le préparateur ne valide pas');
  assert.equal((await appel('POST', `/commercial/livraisons/${trop.data.id}/validation`, 'dir')).status, 200);
  assert.equal((await solde(R.eau, R.cen)).quantite, 34, '64 − 24 − 6');
  assert.equal((await appel('GET', `/commercial/commandes-clients/${R.cmd}`, 'com')).data.etat_livraison, 'livree');
  assert.ok(!(await appel('GET', '/commercial/livraisons/a-livrer', 'mag')).data.some((x) => x.id === R.cmd));
  // Annulation motivée : la marchandise rentre ; la commande redevient partielle.
  assert.equal((await appel('POST', `/commercial/livraisons/${trop.data.id}/annulation`, 'dir', { motif: 'X' })).status, 400);
  const an = await appel('POST', `/commercial/livraisons/${trop.data.id}/annulation`, 'dir', { motif: 'Livraison refusée par le client' });
  assert.equal(an.status, 200, an.message);
  assert.equal((await solde(R.eau, R.cen)).quantite, 64);
  assert.equal((await appel('GET', `/commercial/commandes-clients/${R.cmd}`, 'com')).data.etat_livraison, 'partielle');
  // Commande avec une livraison : ne s'annule pas.
  assert.equal((await appel('POST', `/commercial/commandes-clients/${R.cmd}/annulation`, 'dir', { motif: 'Erreur' })).status, 409);
  R.bl = c.data.id;
});

test('Stock négatif refusé ; commande annulée', async () => {
  const d = await devisValide({ lignes: [{ article_id: R.eau, quantite: 10 }] });
  const cmd = (await appel('POST', `/commercial/devis/${d.id}/acceptation`, 'com', {})).data;
  const l = await appel('POST', '/commercial/livraisons', 'mag', { commande_id: cmd.id, magasin_id: R.cen, lignes: [{ commande_ligne_id: cmd.lignes[0].id, quantite: 10 }] });
  const p = await appel('POST', `/commercial/livraisons/${l.data.id}/preparation`, 'mag');
  assert.equal(p.status, 409);
  assert.match(p.message, /Stock insuffisant/);
  assert.equal((await appel('DELETE', `/commercial/livraisons/${l.data.id}`, 'mag')).status, 200);
  const an = await appel('POST', `/commercial/commandes-clients/${cmd.id}/annulation`, 'resp', { motif: 'Le client renonce' });
  assert.equal(an.status, 200, an.message);
  assert.equal(an.data.statut, 'annulee');
});

test('Intangibilité, isolation, journal', async () => {
  await assert.rejects(sql('UPDATE com_devis SET total_ttc = 1 WHERE id = $1', [R.devis]), /VENTE_INTANGIBLE/);
  await assert.rejects(sql('UPDATE com_devis_lignes SET quantite = 1 WHERE devis_id = $1', [R.devis]), /VENTE_INTANGIBLE/);
  await assert.rejects(sql('DELETE FROM com_commandes_clients WHERE id = $1', [R.cmd]), /VENTE_INTANGIBLE/);
  await assert.rejects(sql('UPDATE com_commande_client_lignes SET quantite = 1 WHERE commande_id = $1', [R.cmd]), /VENTE_INTANGIBLE/);
  await assert.rejects(sql("UPDATE com_livraisons SET transporteur = 'X' WHERE id = $1", [R.bl]), /VENTE_INTANGIBLE/);
  assert.equal((await appel('GET', `/commercial/devis/${R.devis}`, 'dirB')).status, 404);
  assert.equal((await appel('GET', `/commercial/commandes-clients/${R.cmd}`, 'dirB')).status, 404);
  assert.equal((await appel('GET', `/commercial/livraisons/${R.bl}`, 'dirB')).status, 404);
  assert.equal((await appel('POST', '/commercial/devis', 'dirB', { client_id: R.cli, lignes: [{ article_id: R.eau, quantite: 1 }] })).status, 400);
  // Le magasinier voit la livraison mais pas les prix des commandes.
  const vue = (await appel('GET', `/commercial/commandes-clients/${R.cmd}`, 'mag')).data;
  assert.equal(vue.total_ttc, null);
  assert.equal(vue.lignes[0].prix_unitaire, null);
  assert.equal((await binaire(`/commercial/devis/${R.devis}/pdf`, 'mag')).status, 403);
  const j = (await appel('GET', `/commercial/stock/mouvements?article_id=${R.eau}`, 'dir')).data;
  assert.ok(j.some((m) => m.type === 'livraison' && /^BLC-/.test(m.document_numero)));
});
