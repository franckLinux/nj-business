// tests/commercial-agences.test.js — NJ COMMERCIAL, lot 2 (migration 054).
//
//  Société → Agences → Magasins ; familles (unités, — taxes retirées en 062 —, suivi en
//  stock, méthode de valorisation) reprises par l'article puis modifiables ;
//  usage des taxes ; périmètre par agence (lecture, saisie, listes, tableau de
//  bord, notifications) ; isolation entre clients.
//
//   TEST_DATABASE_URL=postgres://…/base_de_test  node --test tests/commercial-agences.test.js
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
const PORT = 9000 + Math.floor(Math.random() * 280);
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
  [{ id: A }] = await sql('INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id', [`aga-${sfx}`, `Agences A ${sfx}`]);
  [{ id: B }] = await sql('INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id', [`agb-${sfx}`, `Agences B ${sfx}`]);
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
  for (const t of [A, B]) assert.equal((await appel('PUT', `/plateforme/clients/${t}/modules/commercial`, 'adm', { actif: true, motif: 'Tests agences' })).status, 200);
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

test('Premier magasin : agence « SIEGE » créée d\'office ; une deuxième agence impose le choix', async () => {
  const m = await appel('POST', '/commercial/magasins', 'dir', { code: 'CEN', nom: 'Magasin central' });
  assert.equal(m.status, 201, m.message);
  assert.equal(m.data.agence_code, 'SIEGE');
  R.siege = m.data.agence_id; R.cen = m.data.id;
  const ag = await appel('POST', '/commercial/agences', 'dir', { code: 'dla', nom: 'Agence de Douala', adresse: 'Akwa' });
  assert.equal(ag.status, 201, ag.message);
  assert.equal(ag.data.code, 'DLA');
  R.dla = ag.data.id;
  const sans = await appel('POST', '/commercial/magasins', 'dir', { code: 'DL1', nom: 'Dépôt Douala' });
  assert.equal(sans.status, 400);
  assert.match(sans.message, /agence de rattachement/);
  const dl1 = await appel('POST', '/commercial/magasins', 'dir', { code: 'DL1', nom: 'Dépôt Douala', agence_id: R.dla });
  assert.equal(dl1.status, 201, dl1.message);
  R.dl1 = dl1.data.id;
  const liste = (await appel('GET', '/commercial/agences', 'dir')).data;
  assert.deepEqual(liste.find((a) => a.id === R.dla).magasins.map((x) => x.code), ['DL1']);
  assert.equal((await appel('POST', '/commercial/agences', 'dir', { code: 'DLA', nom: 'Doublon' })).status, 409);
  assert.equal((await appel('POST', '/commercial/agences', 'demA', { code: 'X', nom: 'Interdit' })).status, 403);
});

test('Agence : désactivation refusée tant qu\'un magasin est actif ; historique conservé', async () => {
  const r = await appel('PUT', `/commercial/agences/${R.dla}`, 'dir', { actif: false });
  assert.equal(r.status, 409);
  assert.match(r.message, /DL1/);
  const a = await sql("SELECT action FROM audit_log WHERE tenant_id = $1 AND action LIKE 'COM_AGENCE_%' ORDER BY id", [A]);
  assert.ok(a.length >= 2, 'créations tracées');
});

test('Familles et articles sans taxe (062) ; l\'article hérite unités, suivi et méthode puis s\'en détache', async () => {
  R.u = (await appel('POST', '/commercial/unites', 'dir', { code: 'unité' })).data.id;
  // Une taxe envoyée par un ancien écran est ignorée : la famille n'en porte plus.
  const f = await appel('POST', '/commercial/familles', 'dir', { code: 'BUR', nom: 'Bureautique', unite_stock_id: R.u, taxe_achat_id: R.prec, taxe_vente_id: R.tvaV,
    suivi_stock: true, methode_valorisation: 'fifo', fournisseur_ids: [R.fou] });
  assert.equal(f.status, 201, f.message);
  assert.equal(f.data.taxe_achat_id, null);
  assert.equal(f.data.taxe_vente_id, null);
  assert.equal(f.data.unite_achat_id, R.u, 'achat = unité de stock par défaut');
  assert.equal(f.data.unite_vente_id, R.u, 'vente = unité de stock par défaut');
  R.fam = f.data.id;
  const a = await appel('POST', '/commercial/articles', 'dir', { reference: 'RAME', designation: 'Rame A4', famille_id: R.fam, unite: 'rame', prix_achat_indicatif: 3500, suivi_comptable: true, taxe_id: R.tva });
  assert.equal(a.status, 201, a.message);
  assert.equal(a.data.taxe_id, null, 'aucune taxe sur l\'article');
  assert.equal(a.data.taxe_vente_id, null);
  assert.equal(a.data.methode_valorisation, 'fifo');
  assert.equal(a.data.suivi_stock, true);
  R.rame = a.data.id;
  const b = await appel('POST', '/commercial/articles', 'dir', { reference: 'STYLO', designation: 'Stylo', famille_id: R.fam, suivi_comptable: false,
    methode_valorisation: 'cmup', suivi_stock: false });
  assert.equal(b.status, 201, b.message);
  assert.equal(b.data.methode_valorisation, 'cmup');
  assert.equal(b.data.unite_stock_id, R.u, 'unité de stock reprise de la famille');
  R.stylo = b.data.id;
  // La famille modifiée ne touche plus les articles existants.
  assert.equal((await appel('PUT', `/commercial/familles/${R.fam}`, 'dir', { methode_valorisation: 'cmup' })).status, 200);
  assert.equal((await appel('GET', `/commercial/articles/${R.rame}`, 'dir')).data.methode_valorisation, 'fifo');
});

test('Usage d\'une taxe : modifiable tant qu\'aucun document ne l\'applique', async () => {
  assert.equal((await appel('PUT', `/commercial/taxes/${R.tvaV}`, 'dir', { usage: 'vente' })).status, 200);
  assert.equal((await appel('PUT', `/commercial/taxes/${R.tva}`, 'dir', { usage: 'achat' })).status, 200);
  const l = (await appel('GET', '/commercial/taxes', 'dir')).data.find((x) => x.id === R.tva);
  assert.equal(l.nb_utilisations, 0);
});

test('Suivi en stock : pas de stock pour un article non suivi ; un article avec stock reste suivi', async () => {
  const s = await appel('PUT', '/commercial/stock/initial', 'dir', { article_id: R.stylo, magasin_id: R.cen, quantite: 10, date_mouvement: '2026-10-01' });
  assert.equal(s.status, 400);
  assert.match(s.message, /pas suivi en stock/);
  assert.equal((await appel('PUT', '/commercial/stock/initial', 'dir', { article_id: R.rame, magasin_id: R.cen, quantite: 120, date_mouvement: '2026-10-01' })).status, 200);
  const r = await appel('PUT', `/commercial/articles/${R.rame}`, 'dir', { suivi_stock: false });
  assert.equal(r.status, 409);
  // Seul le stock d'ouverture (sans coût) existe : la méthode peut encore changer.
  assert.equal((await appel('PUT', `/commercial/articles/${R.rame}`, 'dir', { methode_valorisation: 'cmup' })).status, 200);
});

test('Magasin utilisé : il ne change plus d\'agence', async () => {
  const r = await appel('PUT', `/commercial/magasins/${R.cen}`, 'dir', { agence_id: R.dla });
  assert.equal(r.status, 409);
  assert.match(r.message, /ne change pas d'agence/);
  // Magasin vierge : le changement passe et il est tracé.
  const v = await appel('POST', '/commercial/magasins', 'dir', { code: 'TMP', nom: 'Vierge', agence_id: R.siege });
  assert.equal((await appel('PUT', `/commercial/magasins/${v.data.id}`, 'dir', { agence_id: R.dla })).status, 200);
});

test('Périmètre par agence : lecture, saisie, listes, tableau de bord et notifications', async () => {
  // demA et gasA limités à l'agence de Douala.
  for (const k of ['demA', 'gasA']) {
    const r = await appel('PUT', `/commercial/utilisateurs/${U[k].id}/agences`, 'dir', { agence_ids: [R.dla] });
    assert.equal(r.status, 200, r.message);
  }
  assert.deepEqual((await appel('GET', '/commercial/utilisateurs', 'dir')).data.utilisateurs.find((u) => u.id === U.demA.id).agences, [R.dla]);
  // Le directeur (sans limite) fait une demande au Siège ; demA en fait une à Douala.
  const dSiege = await demandeApprouvee('dir', R.cen, [{ article_id: R.rame, quantite: 5 }]);
  const refus = await appel('POST', '/commercial/demandes', 'demA', { magasin_id: R.cen, motif: 'Hors agence', lignes: [{ article_id: R.rame, quantite: 1 }] });
  assert.equal(refus.status, 403);
  const dDla = await demandeApprouvee('demA', R.dl1, [{ article_id: R.rame, quantite: 3 }]);
  // demA (et gasA, qui voit pourtant « tout ») ne voient que Douala.
  const vues = (await appel('GET', '/commercial/demandes?vue=toutes', 'gasA')).data.map((d) => d.id);
  assert.ok(vues.includes(dDla.id));
  assert.ok(!vues.includes(dSiege.id));
  assert.equal((await appel('GET', `/commercial/demandes/${dSiege.id}`, 'gasA')).status, 404);
  const mags = (await appel('GET', '/commercial/magasins?perimetre=1', 'gasA')).data.map((m) => m.id);
  assert.ok(mags.includes(R.dl1) && !mags.includes(R.cen));
  assert.ok((await appel('GET', '/commercial/magasins', 'gasA')).data.length > mags.length, 'la configuration montre tout');
  const ac = (await appel('GET', '/commercial/bons-commande/a-commander', 'gasA')).data.map((d) => d.id);
  assert.deepEqual(ac, [dDla.id]);
  assert.equal((await appel('GET', `/commercial/bons-commande/proposition/${dSiege.id}`, 'gasA')).status, 404);
  // Tableau de bord : périmètre, puis filtres agence et magasin du directeur.
  const tbG = (await appel('GET', '/commercial/tableau-bord', 'gasA')).data;
  assert.equal(tbG.a_traiter.a_commander, 1);
  const tbD = (await appel('GET', '/commercial/tableau-bord', 'dir')).data;
  assert.equal(tbD.a_traiter.a_commander, 2);
  assert.equal((await appel('GET', `/commercial/tableau-bord?agence_id=${R.siege}`, 'dir')).data.a_traiter.a_commander, 1);
  assert.equal((await appel('GET', `/commercial/tableau-bord?magasin_id=${R.dl1}`, 'dir')).data.a_traiter.a_commander, 1);
  // Compteur du menu.
  assert.equal((await appel('GET', '/commercial/demandes/compteurs', 'gasA')).data.a_commander, 1);
  // Historique : rien du Siège.
  const h = (await appel('GET', '/commercial/historique', 'gasA')).data;
  assert.ok(h.every((x) => x.objet !== dSiege.numero));
  // Retirer le périmètre : tout redevient visible.
  await appel('PUT', `/commercial/utilisateurs/${U.gasA.id}/agences`, 'dir', { agence_ids: [] });
  assert.equal((await appel('GET', `/commercial/demandes/${dSiege.id}`, 'gasA')).status, 200);
});

test('Bon de commande : une taxe réservée aux ventes est refusée sur une ligne d\'achat', async () => {
  const d = await demandeApprouvee('dir', R.cen, [{ article_id: R.rame, quantite: 2 }]);
  const p = (await appel('GET', `/commercial/bons-commande/proposition/${d.id}`, 'resp')).data;
  const l = p.lignes[0];
  const r = await appel('POST', '/commercial/bons-commande', 'resp', { demande_id: d.id, fournisseur_id: R.fou,
    lignes: [{ demande_ligne_id: l.demande_ligne_id, quantite: 1, prix_unitaire: 3500, taxe_id: R.tvaV }] });
  assert.equal(r.status, 400);
  assert.match(r.message, /réservée aux ventes/);
});

test('Isolation : agence, magasin et périmètre d\'un autre client refusés', async () => {
  assert.equal((await appel('POST', '/commercial/magasins', 'dirB', { code: 'BX', nom: 'Chez B', agence_id: R.dla })).status, 400);
  assert.equal((await appel('PUT', `/commercial/agences/${R.dla}`, 'dirB', { nom: 'Pirate' })).status, 404);
  assert.equal((await appel('PUT', `/commercial/utilisateurs/${U.demA.id}/agences`, 'dirB', { agence_ids: [] })).status, 404);
  await assert.rejects(sql('UPDATE com_magasins SET agence_id = (SELECT id FROM com_agences WHERE tenant_id = $1 LIMIT 1) WHERE id = $2', [B, R.cen]).then(async () => {
    // B n'a peut-être aucune agence : on en crée une pour tester le déclencheur.
    throw new Error('pas de déclencheur');
  }).catch(async (e) => {
    if (e.message !== 'pas de déclencheur') throw e;
    const [ag] = await sql("INSERT INTO com_agences (tenant_id, code, nom) VALUES ($1, 'BB', 'B') RETURNING id", [B]);
    await sql('UPDATE com_magasins SET agence_id = $1 WHERE id = $2', [ag.id, R.cen]);
  }), /autre client/);
});
