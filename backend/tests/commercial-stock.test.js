// tests/commercial-stock.test.js — NJ COMMERCIAL, lot 4 (migration 056) : moteur de stock.
//
//  CMUP et FIFO calculés à la main, transferts sans nouveau coût, inventaire sans
//  effet avant validation, séparation des tâches, annulation par rejeu,
//  stock négatif refusé, coût du stock d'ouverture, intangibilité, isolation.
//
//   TEST_DATABASE_URL=postgres://…/base_de_test  node --test tests/commercial-stock.test.js
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
  [{ id: A }] = await sql('INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id', [`sta-${sfx}`, `Stock A ${sfx}`]);
  [{ id: B }] = await sql('INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id', [`stb-${sfx}`, `Stock B ${sfx}`]);
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
  for (const t of [A, B]) assert.equal((await appel('PUT', `/plateforme/clients/${t}/modules/commercial`, 'adm', { actif: true, motif: 'Tests stock' })).status, 200);
  await creerUtilisateur('dir', 'directeur', A);
  await creerUtilisateur('mag', 'collaborateur', A, 'stock_magasinier');
  await creerUtilisateur('ges', 'collaborateur', A, 'stock_gestionnaire');
  await creerUtilisateur('dem', 'collaborateur', A, 'achats_demandeur');
  await creerUtilisateur('dirB', 'directeur', B);
  for (const [code, decimales] of [['pièce', 0], ['carton', 0], ['rame', 0]]) {
    R[code] = (await appel('POST', '/commercial/unites', 'dir', { code, libelle: code, decimales })).data.id;
  }
  const fam = async (code, methode) => (await appel('POST', '/commercial/familles', 'dir', { code, nom: code, unite_stock_id: R['pièce'], methode_valorisation: methode })).data.id;
  R.famC = await fam('BOI', 'cmup');
  R.famF = await fam('PAP', 'fifo');
  const art = async (b) => { const r = await appel('POST', '/commercial/articles', 'dir', { suivi_comptable: false, ...b }); assert.equal(r.status, 201, r.message); return r.data; };
  const eau = await art({ reference: 'EAU', designation: 'Eau minérale', famille_id: R.famC, unite_achat_id: R.carton, coef_achat: 12, seuil_alerte: 30 });
  assert.equal(eau.methode_valorisation, 'cmup');
  R.eau = eau.id;
  R.pap = (await art({ reference: 'PAP', designation: 'Papier A4', famille_id: R.famF, unite_stock_id: R.rame, unite_achat_id: R.rame, unite_vente_id: R.rame })).id;
  R.jus = (await art({ reference: 'JUS', designation: 'Jus', famille_id: R.famC })).id;
  R.svc = (await art({ reference: 'SVC', designation: 'Prestation', famille_id: R.famC, suivi_stock: false })).id;
  R.cen = (await appel('POST', '/commercial/magasins', 'dir', { code: 'CEN', nom: 'Central' })).data.id;
  R.anx = (await appel('POST', '/commercial/magasins', 'dir', { code: 'ANX', nom: 'Annexe' })).data.id;
  assert.ok(R.cen && R.anx);
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



const solde = async (article, magasin) => (await appel('GET', `/commercial/stock/etat?magasin_id=${magasin}`, 'dir')).data.find((l) => l.article_id === article);
// Saisit, soumet et fait valider un document ; renvoie la fiche validée.
const circuit = async (auteur, valideur, corps) => {
  const c = await appel('POST', '/commercial/stock/documents', auteur, corps);
  assert.equal(c.status, 201, c.message);
  const s = await appel('POST', `/commercial/stock/documents/${c.data.id}/soumission`, auteur, {});
  assert.equal(s.status, 200, s.message);
  if (!valideur) return s.data;
  const v = await appel('POST', `/commercial/stock/documents/${c.data.id}/validation`, valideur, {});
  assert.equal(v.status, 200, v.message);
  assert.equal(v.data.statut, 'valide');
  return v.data;
};
const proche = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.011, `${msg} : ${a} ≠ ${b}`);

test('Stock d\'ouverture : coût par unité de stock ; sans coût → « à valoriser »', async () => {
  const r = await appel('PUT', '/commercial/stock/initial', 'dir', { article_id: R.eau, magasin_id: R.cen, quantite: 100, cout_unitaire: 250, date_mouvement: '2026-10-01' });
  assert.equal(r.status, 200, r.message);
  const s = await solde(R.eau, R.cen);
  assert.equal(s.quantite, 100);
  assert.equal(s.valeur, 25000);
  assert.equal(s.cmup, 250);
  assert.equal(s.a_valoriser, false);
  assert.equal((await appel('PUT', '/commercial/stock/initial', 'dir', { article_id: R.jus, magasin_id: R.cen, quantite: 10, date_mouvement: '2026-10-01' })).status, 200);
  assert.equal((await solde(R.jus, R.cen)).a_valoriser, true);
  assert.equal((await appel('PUT', '/commercial/stock/initial', 'dir', { article_id: R.svc, magasin_id: R.cen, quantite: 1 })).status, 400, 'non suivi en stock');
});

test('Entrée diverse : rien ne bouge avant validation ; l\'auteur ne valide pas ; CMUP recalculé', async () => {
  const c = await appel('POST', '/commercial/stock/documents', 'mag', { type: 'entree', magasin_id: R.cen, motif: 'Don fournisseur',
    lignes: [{ article_id: R.eau, quantite: 10, unite_id: R.carton, cout_unitaire: 3600 }] });
  assert.equal(c.status, 201, c.message);
  assert.match(c.data.numero, /^ENT-\d{4}-\d{4}$/);
  assert.equal(c.data.lignes[0].quantite_stock, 120, '10 cartons de 12');
  // Coût obligatoire sur une entrée, article non suivi refusé, décimale refusée.
  assert.equal((await appel('PUT', `/commercial/stock/documents/${c.data.id}`, 'mag', { lignes: [{ article_id: R.eau, quantite: 1 }] })).status, 400);
  assert.equal((await appel('PUT', `/commercial/stock/documents/${c.data.id}`, 'mag', { lignes: [{ article_id: R.svc, quantite: 1, cout_unitaire: 5 }] })).status, 400);
  assert.equal((await appel('PUT', `/commercial/stock/documents/${c.data.id}`, 'mag', { lignes: [{ article_id: R.eau, quantite: 1.5, cout_unitaire: 5 }] })).status, 400);
  assert.equal((await appel('POST', `/commercial/stock/documents/${c.data.id}/soumission`, 'mag', {})).status, 200);
  assert.equal((await solde(R.eau, R.cen)).quantite, 100, 'stock inchangé tant que le document n\'est pas validé');
  assert.equal((await appel('POST', `/commercial/stock/documents/${c.data.id}/validation`, 'mag', {})).status, 403, 'magasinier : pas de validation');
  assert.equal((await appel('POST', '/commercial/stock/documents', 'dem', { type: 'entree', magasin_id: R.cen })).status, 403);
  const v = await appel('POST', `/commercial/stock/documents/${c.data.id}/validation`, 'dir', {});
  assert.equal(v.status, 200, v.message);
  assert.equal(v.data.mouvements.length, 1);
  assert.equal(v.data.mouvements[0].quantite, 120);
  assert.equal(v.data.mouvements[0].cout_unitaire, 300, '3600 le carton = 300 la pièce');
  const s = await solde(R.eau, R.cen);
  assert.equal(s.quantite, 220);
  assert.equal(s.valeur, 61000);
  proche(s.cmup, 277.272727, 'CMUP (25 000 + 36 000) / 220');
  R.entree = c.data.id;
  // Validé = intangible.
  assert.equal((await appel('PUT', `/commercial/stock/documents/${c.data.id}`, 'mag', { motif: 'x' })).status, 409);
  assert.equal((await appel('DELETE', `/commercial/stock/documents/${c.data.id}`, 'mag')).status, 409);
});

test('Séparation des tâches : l\'auteur ne valide pas, sauf auto-validation activée', async () => {
  const d = await circuit('dir', null, { type: 'sortie', magasin_id: R.cen, motif: 'Casse', lignes: [{ article_id: R.eau, quantite: 20 }] });
  const refus = await appel('POST', `/commercial/stock/documents/${d.id}/validation`, 'dir', {});
  assert.equal(refus.status, 403);
  assert.match(refus.message, /autre valideur/);
  assert.equal((await appel('GET', `/commercial/stock/documents/${d.id}`, 'dir')).data.droits.auto_validation_interdite, true);
  assert.equal((await appel('PUT', '/commercial/societe', 'dir', { autovalidation_stock: true })).status, 200);
  const v = await appel('POST', `/commercial/stock/documents/${d.id}/validation`, 'dir', {});
  assert.equal(v.status, 200, v.message);
  assert.equal((await appel('PUT', '/commercial/societe', 'dir', { autovalidation_stock: false })).status, 200);
  // Sortie au CMUP : 20 × 277,27 = 5 545,45.
  proche(v.data.mouvements[0].valeur, 5545.45, 'valeur de sortie');
  const s = await solde(R.eau, R.cen);
  assert.equal(s.quantite, 200);
  proche(s.valeur, 55454.55, 'valeur restante');
  // Sortie sans motif : refusée à la soumission.
  const c = await appel('POST', '/commercial/stock/documents', 'mag', { type: 'sortie', magasin_id: R.cen, lignes: [{ article_id: R.eau, quantite: 1 }] });
  assert.equal((await appel('POST', `/commercial/stock/documents/${c.data.id}/soumission`, 'mag', {})).status, 400);
  assert.equal((await appel('DELETE', `/commercial/stock/documents/${c.data.id}`, 'mag')).status, 200, 'un brouillon se supprime');
});

test('Transfert : le coût suit la marchandise, aucun coût d\'acquisition créé', async () => {
  assert.equal((await appel('POST', '/commercial/stock/documents', 'mag', { type: 'transfert', magasin_id: R.cen, magasin_dest_id: R.cen })).status, 400);
  const d = await circuit('mag', 'ges', { type: 'transfert', magasin_id: R.cen, magasin_dest_id: R.anx, lignes: [{ article_id: R.eau, quantite: 50 }] });
  assert.equal(d.mouvements.length, 2);
  const [dep, arr] = d.mouvements;
  assert.equal(dep.type, 'transfert_sortie');
  assert.equal(arr.type, 'transfert_entree');
  assert.equal(arr.cout_unitaire, dep.cout_unitaire, 'même coût unitaire');
  const cen = await solde(R.eau, R.cen); const anx = await solde(R.eau, R.anx);
  assert.equal(cen.quantite, 150);
  assert.equal(anx.quantite, 50);
  proche(anx.cmup, cen.cmup, 'CMUP identique des deux côtés');
  proche(cen.valeur + anx.valeur, 55454.55, 'valeur totale inchangée');
  const val = (await appel('GET', '/commercial/stock/valorisation', 'dir')).data;
  assert.equal(val.magasins.length, 2);
  assert.ok(val.total > 55454);
});

test('Inventaire : écart sans effet avant validation, puis mouvement d\'écart', async () => {
  const liste = (await appel('GET', `/commercial/stock/inventaire/articles?magasin_id=${R.cen}`, 'mag')).data;
  assert.equal(liste.find((a) => a.id === R.eau).theorique, 150);
  assert.ok(!liste.find((a) => a.id === R.svc), 'article non suivi absent');
  const d = await circuit('mag', null, { type: 'inventaire', magasin_id: R.cen, motif: 'Inventaire mensuel', lignes: [{ article_id: R.eau, quantite_comptee: 145 }] });
  assert.equal((await solde(R.eau, R.cen)).quantite, 150, 'l\'écart n\'a pas encore d\'effet');
  const v = await appel('POST', `/commercial/stock/documents/${d.id}/validation`, 'ges', {});
  assert.equal(v.status, 200, v.message);
  assert.equal(v.data.lignes[0].quantite_theorique, 150);
  assert.equal(v.data.mouvements[0].type, 'inventaire_moins');
  assert.equal(v.data.mouvements[0].quantite, 5);
  assert.equal((await solde(R.eau, R.cen)).quantite, 145);
  // Inventaire incomplet : refusé à la soumission.
  const c = await appel('POST', '/commercial/stock/documents', 'mag', { type: 'inventaire', magasin_id: R.cen, lignes: [{ article_id: R.eau }] });
  assert.equal(c.status, 201, c.message);
  assert.equal((await appel('POST', `/commercial/stock/documents/${c.data.id}/soumission`, 'mag', {})).status, 400);
});

test('Stock négatif refusé à la validation ; renvoi motivé', async () => {
  const d = await circuit('mag', null, { type: 'sortie', magasin_id: R.anx, motif: 'Test', lignes: [{ article_id: R.eau, quantite: 1000 }] });
  const v = await appel('POST', `/commercial/stock/documents/${d.id}/validation`, 'ges', {});
  assert.equal(v.status, 409);
  assert.match(v.message, /Stock insuffisant/);
  assert.equal((await appel('POST', `/commercial/stock/documents/${d.id}/renvoi`, 'ges', {})).status, 400, 'motif obligatoire');
  const r = await appel('POST', `/commercial/stock/documents/${d.id}/renvoi`, 'ges', { motif: 'Quantité à revoir' });
  assert.equal(r.data.statut, 'brouillon');
  assert.equal(r.data.motif_renvoi, 'Quantité à revoir');
  assert.equal((await solde(R.eau, R.anx)).quantite, 50);
});

test('FIFO : sortie sur les lots les plus anciens ; annulation qui rendrait le stock négatif refusée', async () => {
  const e1 = await circuit('mag', 'ges', { type: 'entree', magasin_id: R.cen, motif: 'Achat comptant', lignes: [{ article_id: R.pap, quantite: 10, cout_unitaire: 100 }] });
  await circuit('mag', 'ges', { type: 'entree', magasin_id: R.cen, motif: 'Achat comptant', lignes: [{ article_id: R.pap, quantite: 10, cout_unitaire: 130 }] });
  const s = await circuit('mag', 'ges', { type: 'sortie', magasin_id: R.cen, motif: 'Consommation', lignes: [{ article_id: R.pap, quantite: 15 }] });
  assert.equal(s.mouvements[0].valeur, 1650, '10 × 100 + 5 × 130');
  assert.equal(s.mouvements[0].cout_unitaire, 110);
  const sol = await solde(R.pap, R.cen);
  assert.equal(sol.quantite, 5);
  assert.equal(sol.valeur, 650, 'reste 5 × 130');
  const a = await appel('POST', `/commercial/stock/documents/${e1.id}/annulation`, 'ges', { motif: 'Erreur de saisie' });
  assert.equal(a.status, 409);
  assert.match(a.message, /négatif/);
  assert.equal((await solde(R.pap, R.cen)).quantite, 5, 'rien n\'a changé');
});

test('Annulation motivée : mouvements conservés mais annulés, valorisation rejouée', async () => {
  assert.equal((await appel('POST', `/commercial/stock/documents/${R.entree}/annulation`, 'ges', {})).status, 400, 'motif obligatoire');
  const a = await appel('POST', `/commercial/stock/documents/${R.entree}/annulation`, 'ges', { motif: 'Entrée en double' });
  assert.equal(a.status, 200, a.message);
  assert.equal(a.data.statut, 'annule');
  assert.equal(a.data.mouvements[0].annule, true, 'le mouvement reste, marqué annulé');
  // Sans l'entrée à 300 : tout repasse au coût d'ouverture 250 (sortie, transfert, inventaire).
  const cen = await solde(R.eau, R.cen); const anx = await solde(R.eau, R.anx);
  assert.equal(cen.quantite, 25, '100 - 20 - 50 - 5');
  assert.equal(cen.valeur, 6250);
  assert.equal(anx.valeur, 12500, 'l\'arrivée du transfert suit le coût rejoué');
  const journal = (await appel('GET', `/commercial/stock/mouvements?article_id=${R.eau}`, 'dir')).data;
  assert.ok(journal.some((m) => m.annule && m.type === 'entree'));
  assert.ok(journal.every((m) => m.annule || m.type === 'stock_initial' || m.document_numero));
});

test('Stock d\'ouverture : son coût se complète après coup, sa quantité non', async () => {
  await circuit('mag', 'ges', { type: 'entree', magasin_id: R.cen, motif: 'Réassort', lignes: [{ article_id: R.jus, quantite: 10, cout_unitaire: 500 }] });
  const s0 = await solde(R.jus, R.cen);
  assert.equal(s0.a_valoriser, true);
  assert.equal((await appel('PUT', '/commercial/stock/initial', 'dir', { article_id: R.jus, magasin_id: R.cen, quantite: 12, date_mouvement: '2026-10-01' })).status, 409);
  const r = await appel('PUT', '/commercial/stock/initial', 'dir', { article_id: R.jus, magasin_id: R.cen, quantite: 10, cout_unitaire: 400, date_mouvement: '2026-10-01' });
  assert.equal(r.status, 200, r.message);
  const s = await solde(R.jus, R.cen);
  assert.equal(s.a_valoriser, false);
  assert.equal(s.valeur, 9000);
  assert.equal(s.cmup, 450);
});

test('Intangibilité en base, tableau de bord, isolation entre clients', async () => {
  const [m] = await sql("SELECT id FROM com_stock_mouvements WHERE tenant_id = $1 AND type = 'entree' LIMIT 1", [A]);
  await assert.rejects(sql('DELETE FROM com_stock_mouvements WHERE id = $1', [m.id]), /STOCK_INTANGIBLE/);
  await assert.rejects(sql('UPDATE com_stock_mouvements SET quantite = 1 WHERE id = $1', [m.id]), /STOCK_INTANGIBLE/);
  await assert.rejects(sql("UPDATE com_stock_documents SET motif = 'x' WHERE tenant_id = $1 AND statut = 'valide'", [A]), /STOCK_INTANGIBLE/);
  const cpt = (await appel('GET', '/commercial/stock/compteurs', 'ges')).data;
  assert.ok(cpt.sous_seuil >= 1, 'EAU : 25 ≤ seuil 30');
  assert.equal((await appel('GET', `/commercial/stock/documents/${R.entree}`, 'dirB')).status, 404);
  assert.equal((await appel('GET', '/commercial/stock/etat', 'dirB')).data.length, 0);
  assert.equal((await appel('POST', '/commercial/stock/documents', 'dirB', { type: 'entree', magasin_id: R.cen })).status, 400);
  assert.equal((await appel('GET', '/commercial/stock/etat', 'dem')).status, 403);
});
