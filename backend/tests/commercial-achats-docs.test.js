// tests/commercial-achats-docs.test.js — NJ COMMERCIAL, lot 5 (migration 058) : documents d'achat.
//
//  Réception partielle puis solde (excédent motivé), coût au prix net du bon,
//  retour au coût de la réception d'origine, facture rapprochée (écart de prix
//  au-delà de la tolérance motivé), avoir limité à la facture, verrous
//  d'annulation, séparation des tâches, intangibilité, isolation. Valeurs calculées à la main.
//
//   TEST_DATABASE_URL=postgres://…/base_de_test  node --test tests/commercial-achats-docs.test.js
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
  [{ id: A }] = await sql('INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id', [`aca-${sfx}`, `Achats A ${sfx}`]);
  [{ id: B }] = await sql('INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id', [`acb-${sfx}`, `Achats B ${sfx}`]);
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
  for (const t of [A, B]) assert.equal((await appel('PUT', `/plateforme/clients/${t}/modules/commercial`, 'adm', { actif: true, motif: 'Tests achats' })).status, 200);
  await creerUtilisateur('dir', 'directeur', A);
  await creerUtilisateur('resp', 'collaborateur', A, 'achats_responsable');
  await creerUtilisateur('gas', 'collaborateur', A, 'achats_gestionnaire');
  await creerUtilisateur('mag', 'collaborateur', A, 'stock_magasinier');
  await creerUtilisateur('ges', 'collaborateur', A, 'stock_gestionnaire');
  await creerUtilisateur('dirB', 'directeur', B);
  // 063 : la facture fournisseur relève du comptable (profil « Comptable (achats) » ; rôle « Comptable »).
  await creerUtilisateur('cpt', 'collaborateur', A, 'achats_comptable');
  await creerUtilisateur('cpt2', 'auditeur', A);
  for (const [code, decimales] of [['pièce', 0], ['carton', 0]]) {
    R[code] = (await appel('POST', '/commercial/unites', 'dir', { code, libelle: code, decimales })).data.id;
  }
  R.tva = (await appel('POST', '/commercial/taxes', 'dir', { code: 'TVA', intitule: 'TVA', taux: '19,25' })).data.id;
  R.fou = (await appel('POST', '/commercial/tiers', 'dir', { type: 'fournisseur', nom: 'Sobraga' })).data.id;
  R.fam = (await appel('POST', '/commercial/familles', 'dir', { code: 'BOI', nom: 'Boissons', unite_stock_id: R['pièce'], methode_valorisation: 'cmup',
    taxe_achat_id: R.tva, fournisseur_ids: [R.fou] })).data.id;
  const eau = await appel('POST', '/commercial/articles', 'dir', { reference: 'EAU', designation: 'Eau minérale', famille_id: R.fam,
    unite_achat_id: R.carton, coef_achat: 12, prix_achat_indicatif: 3600, suivi_comptable: false });
  assert.equal(eau.status, 201, eau.message);
  R.eau = eau.data.id;
  R.cen = (await appel('POST', '/commercial/magasins', 'dir', { code: 'CEN', nom: 'Central' })).data.id;
  assert.equal((await appel('PUT', '/commercial/stock/initial', 'dir', { article_id: R.eau, magasin_id: R.cen, quantite: 100, cout_unitaire: 250, date_mouvement: '2026-10-01' })).status, 200);
  // Demande approuvée → bon de commande émis : 10 cartons à 3 600.
  const d = (await appel('POST', '/commercial/demandes', 'dir', { magasin_id: R.cen, motif: 'Réassort boissons', lignes: [{ article_id: R.eau, quantite: 10 }] })).data;
  await appel('POST', `/commercial/demandes/${d.id}/soumission`, 'dir', { justification_stock: 'Réserve' });
  assert.equal((await appel('POST', `/commercial/demandes/${d.id}/decision`, 'resp', { decision: 'approuver' })).data.statut, 'approuvee');
  const prop = (await appel('GET', `/commercial/bons-commande/proposition/${d.id}`, 'gas')).data;
  const bc = await appel('POST', '/commercial/bons-commande', 'gas', { demande_id: d.id, fournisseur_id: R.fou,
    lignes: [{ demande_ligne_id: prop.lignes[0].demande_ligne_id, quantite: 10, prix_unitaire: 3600, taxe_id: R.tva }] });
  assert.equal(bc.status, 201, bc.message);
  const em = await appel('POST', `/commercial/bons-commande/${bc.data.id}/emission`, 'resp');
  assert.equal(em.status, 200, em.message);
  R.bc = bc.data.id;
  R.bcl = em.data.lignes[0].id;
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
const proche = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.011, `${msg} : ${a} ≠ ${b}`);
const circuit = async (base, auteur, valideur, corps) => {
  const c = await appel('POST', base, auteur, corps);
  assert.equal(c.status, 201, c.message);
  const s = await appel('POST', `${base}/${c.data.id}/soumission`, auteur, {});
  assert.equal(s.status, 200, s.message);
  if (!valideur) return s.data;
  const v = await appel('POST', `${base}/${c.data.id}/validation`, valideur, {});
  assert.equal(v.status, 200, v.message);
  return v.data;
};

test('Réception partielle : rien ne bouge avant validation ; coût = prix net du bon par pièce', async () => {
  const aRecevoir = (await appel('GET', '/commercial/receptions/a-recevoir', 'mag')).data;
  assert.ok(aRecevoir.some((b) => b.id === R.bc), 'le bon émis est à recevoir');
  const prop = (await appel('GET', `/commercial/receptions/proposition/${R.bc}`, 'mag')).data;
  assert.equal(prop.lignes[0].reste, 10);
  const c = await appel('POST', '/commercial/receptions', 'mag', { bc_id: R.bc, bl_numero: 'BL-778', lignes: [{ bc_ligne_id: R.bcl, quantite: 6 }] });
  assert.equal(c.status, 201, c.message);
  assert.match(c.data.numero, /^REC-\d{4}-\d{4}$/);
  assert.equal(c.data.lignes[0].quantite_stock, 72);
  assert.equal((await appel('PUT', `/commercial/receptions/${c.data.id}`, 'mag', { lignes: [{ bc_ligne_id: R.bcl, quantite: 1.5 }] })).status, 400, 'carton entier');
  assert.equal((await appel('POST', `/commercial/receptions/${c.data.id}/soumission`, 'mag', {})).status, 200);
  assert.equal((await solde(R.eau, R.cen)).quantite, 100, 'stock inchangé avant validation');
  assert.equal((await appel('POST', `/commercial/receptions/${c.data.id}/validation`, 'mag', {})).status, 403, 'le magasinier ne valide pas');
  const v = await appel('POST', `/commercial/receptions/${c.data.id}/validation`, 'resp', {});
  assert.equal(v.status, 200, v.message);
  assert.equal(v.data.mouvements[0].type, 'reception');
  assert.equal(v.data.mouvements[0].cout_unitaire, 300, '3 600 le carton = 300 la pièce, hors taxes');
  const s = await solde(R.eau, R.cen);
  assert.equal(s.quantite, 172);
  assert.equal(s.valeur, 46600);
  R.rec1 = c.data.id; R.rl1 = c.data.lignes[0].id;
  const bon = (await appel('GET', `/commercial/bons-commande/${R.bc}`, 'resp')).data;
  assert.equal(bon.reception.etat, 'partiel');
  assert.equal(bon.reception.par_ligne[R.bcl].recu, 6);
  // Un bon réceptionné ne s'annule plus ni ne se révise.
  const an = await appel('POST', `/commercial/bons-commande/${R.bc}/annulation`, 'resp', { motif: 'Test' });
  assert.equal(an.status, 409);
  assert.match(an.message, /réceptions/);
  assert.equal((await appel('POST', `/commercial/bons-commande/${R.bc}/revision`, 'resp')).status, 409);
});

test('Solde avec excédent : motif exigé ; le bon est alors entièrement reçu', async () => {
  const c = await appel('POST', '/commercial/receptions', 'mag', { bc_id: R.bc, lignes: [{ bc_ligne_id: R.bcl, quantite: 5 }] });
  assert.equal(c.status, 201, c.message);
  const s = await appel('POST', `/commercial/receptions/${c.data.id}/soumission`, 'mag', {});
  assert.equal(s.status, 400);
  assert.match(s.message, /excédent/);
  assert.equal((await appel('POST', `/commercial/receptions/${c.data.id}/soumission`, 'mag', { motif_ecart: 'Carton offert par le fournisseur' })).status, 200);
  assert.equal((await appel('POST', `/commercial/receptions/${c.data.id}/validation`, 'ges', {})).status, 200);
  R.rec2 = c.data.id; R.rl2 = c.data.lignes[0].id;
  assert.equal((await appel('GET', `/commercial/bons-commande/${R.bc}`, 'resp')).data.reception.etat, 'recu');
  assert.ok(!(await appel('GET', '/commercial/receptions/a-recevoir', 'mag')).data.some((b) => b.id === R.bc));
  const st = await solde(R.eau, R.cen);
  assert.equal(st.quantite, 232);
  assert.equal(st.valeur, 64600);
});

test('Retour fournisseur : au coût de la réception, pas au CMUP ; jamais plus que le reçu', async () => {
  const prop = (await appel('GET', `/commercial/retours-fournisseurs/proposition/${R.rec1}`, 'ges')).data;
  assert.equal(prop.lignes[0].disponible, 6);
  const trop = await appel('POST', '/commercial/retours-fournisseurs', 'ges', { reception_id: R.rec1, motif: 'Abîmés', lignes: [{ reception_ligne_id: R.rl1, quantite: 7 }] });
  assert.equal(trop.status, 201);
  assert.equal((await appel('POST', `/commercial/retours-fournisseurs/${trop.data.id}/soumission`, 'ges', {})).status, 400);
  assert.equal((await appel('DELETE', `/commercial/retours-fournisseurs/${trop.data.id}`, 'ges')).status, 200);
  const r = await circuit('/commercial/retours-fournisseurs', 'ges', null, { reception_id: R.rec1, motif: 'Cartons abîmés', lignes: [{ reception_ligne_id: R.rl1, quantite: 2 }] });
  const auto = await appel('POST', `/commercial/retours-fournisseurs/${r.id}/validation`, 'ges', {});
  assert.equal(auto.status, 403, 'l\'auteur ne valide pas');
  const v = await appel('POST', `/commercial/retours-fournisseurs/${r.id}/validation`, 'resp', {});
  assert.equal(v.status, 200, v.message);
  assert.equal(v.data.mouvements[0].type, 'retour_fournisseur');
  assert.equal(v.data.mouvements[0].cout_unitaire, 300, 'coût de la réception d\'origine');
  const s = await solde(R.eau, R.cen);
  assert.equal(s.quantite, 208);
  assert.equal(s.valeur, 57400, '64 600 − 24 × 300');
  proche(s.cmup, 275.961538, 'CMUP recalculé');
  R.ret = r.id;
  // Une réception qui a un retour ne s'annule pas.
  assert.equal((await appel('POST', `/commercial/receptions/${R.rec1}/annulation`, 'resp', { motif: 'Erreur' })).status, 409);
});

test('Facture rapprochée : écart de prix au-delà de la tolérance motivé ; doublon refusé', async () => {
  const fs = (await appel('GET', '/commercial/factures-fournisseurs/a-facturer', 'cpt')).data;
  assert.ok(fs.some((f) => f.id === R.fou));
  const lignes = (await appel('GET', `/commercial/factures-fournisseurs/a-facturer/${R.fou}`, 'cpt')).data;
  assert.deepEqual(lignes.map((l) => l.reste).sort(), [4, 5], 'reçu net : 6 − 2 retournés, puis 5');
  // Ni le gestionnaire ni le responsable des achats ne saisissent la facture.
  for (const qui of ['gas', 'resp']) {
    assert.equal((await appel('POST', '/commercial/factures-fournisseurs', qui, { fournisseur_id: R.fou, reference_fournisseur: 'X', date_facture: '2026-11-02', lignes: [] })).status, 403, qui);
  }
  const c = await appel('POST', '/commercial/factures-fournisseurs', 'cpt', { fournisseur_id: R.fou, reference_fournisseur: 'FA-2026-118', date_facture: '2026-11-02',
    lignes: [{ reception_ligne_id: R.rl1, quantite: 4, prix_unitaire: 3600 }, { reception_ligne_id: R.rl2, quantite: 5, prix_unitaire: 4000 }] });
  assert.equal(c.status, 201, c.message);
  assert.equal(c.data.total_ht, 34400);
  assert.equal(c.data.total_taxes, 6622);
  assert.equal(c.data.total_ttc, 41022);
  const r2 = c.data.rapprochement.find((x) => x.reception_ligne_id === R.rl2);
  assert.equal(r2.ecart_prix_pct, 11.11);
  assert.equal(r2.alerte_prix, true);
  assert.equal(c.data.rapprochement.find((x) => x.reception_ligne_id === R.rl1).alerte_prix, false);
  const s = await appel('POST', `/commercial/factures-fournisseurs/${c.data.id}/soumission`, 'cpt', {});
  assert.equal(s.status, 400);
  assert.match(s.message, /motif/);
  assert.equal((await appel('POST', `/commercial/factures-fournisseurs/${c.data.id}/soumission`, 'cpt', { motif_ecart: 'Hausse tarifaire annoncée' })).status, 200);
  assert.equal((await appel('POST', `/commercial/factures-fournisseurs/${c.data.id}/validation`, 'cpt', {})).status, 403, 'jamais par son auteur');
  assert.equal((await appel('POST', `/commercial/factures-fournisseurs/${c.data.id}/validation`, 'resp', {})).status, 403, 'pas par le responsable des achats');
  const v = await appel('POST', `/commercial/factures-fournisseurs/${c.data.id}/validation`, 'cpt2', {});
  assert.equal(v.status, 200, v.message);
  assert.equal(v.data.statut, 'valide');
  assert.match(v.data.reglement, /NJ FINANCE/);
  R.ff = c.data.id; R.ffl1 = c.data.lignes.find((l) => l.reception_ligne_id === R.rl1).id;
  // Même pièce du fournisseur : refusée.
  const dbl = await appel('POST', '/commercial/factures-fournisseurs', 'cpt', { fournisseur_id: R.fou, reference_fournisseur: 'fa-2026-118', date_facture: '2026-11-02', lignes: [] });
  assert.equal(dbl.status, 409);
  // Facturer encore ce qui l'est déjà : écart de quantité signalé.
  const sur = await appel('POST', '/commercial/factures-fournisseurs', 'cpt', { fournisseur_id: R.fou, reference_fournisseur: 'FA-2026-119', date_facture: '2026-11-02',
    lignes: [{ reception_ligne_id: R.rl1, quantite: 1, prix_unitaire: 3600 }] });
  assert.equal(sur.data.rapprochement[0].alerte_quantite, true);
  assert.equal(sur.data.rapprochement[0].ecart_quantite, 1);
  assert.equal((await appel('DELETE', `/commercial/factures-fournisseurs/${sur.data.id}`, 'cpt')).status, 200);
  // Une réception facturée ne s'annule pas.
  assert.equal((await appel('POST', `/commercial/receptions/${R.rec2}/annulation`, 'resp', { motif: 'Erreur' })).status, 409);
});

test('Avoir : limité à la facture d\'origine ; net à payer', async () => {
  const base = { type: 'avoir', facture_origine_id: R.ff, retour_id: R.ret, reference_fournisseur: 'AV-55', date_facture: '2026-11-02' };
  assert.equal((await appel('POST', '/commercial/factures-fournisseurs', 'cpt', { ...base, lignes: [{ facture_ligne_origine_id: R.ffl1, quantite: 5 }] })).status, 400, 'plus que facturé');
  assert.equal((await appel('POST', '/commercial/factures-fournisseurs', 'cpt', { ...base, lignes: [{ facture_ligne_origine_id: R.ffl1, quantite: 1, prix_unitaire: 5000 }] })).status, 400, 'prix supérieur');
  const av = await circuit('/commercial/factures-fournisseurs', 'cpt', 'cpt2', { ...base, lignes: [{ facture_ligne_origine_id: R.ffl1, quantite: 2 }] });
  assert.match(av.numero, /^AVF-/);
  assert.equal(av.total_ttc, 8586, '2 × 3 600 + 19,25 %');
  const f = (await appel('GET', `/commercial/factures-fournisseurs/${R.ff}`, 'resp')).data;
  assert.equal(f.net_a_payer, 32436);
  assert.equal(f.avoirs.length, 1);
  // Facture avec avoir : ne s'annule pas ; l'avoir d'abord.
  assert.equal((await appel('POST', `/commercial/factures-fournisseurs/${R.ff}/annulation`, 'cpt2', { motif: 'Erreur' })).status, 409);
  // Retour couvert par un avoir : ne s'annule pas.
  assert.equal((await appel('POST', `/commercial/retours-fournisseurs/${R.ret}/annulation`, 'resp', { motif: 'Erreur' })).status, 409);
});

test('Permissions, intangibilité, isolation', async () => {
  assert.equal((await appel('GET', '/commercial/factures-fournisseurs', 'mag')).status, 403, 'le magasinier ne voit pas les factures');
  assert.equal((await appel('POST', '/commercial/factures-fournisseurs', 'mag', { fournisseur_id: R.fou })).status, 403);
  assert.ok((await appel('GET', '/commercial/receptions', 'mag')).data.length >= 2);
  const cpt = (await appel('GET', '/commercial/achats/compteurs', 'resp')).data;
  assert.equal(typeof cpt.factures_a_valider, 'number');
  await assert.rejects(sql("UPDATE com_receptions SET bl_numero = 'X' WHERE id = $1", [R.rec1]), /ACHAT_INTANGIBLE/);
  await assert.rejects(sql('UPDATE com_reception_lignes SET quantite = 1 WHERE reception_id = $1', [R.rec1]), /ACHAT_INTANGIBLE/);
  await assert.rejects(sql('DELETE FROM com_factures_fournisseurs WHERE id = $1', [R.ff]), /ACHAT_INTANGIBLE/);
  assert.equal((await appel('GET', `/commercial/receptions/${R.rec1}`, 'dirB')).status, 404);
  assert.equal((await appel('GET', `/commercial/factures-fournisseurs/${R.ff}`, 'dirB')).status, 404);
  assert.equal((await appel('POST', '/commercial/receptions', 'dirB', { bc_id: R.bc, lignes: [] })).status, 404);
  // Journal du stock : la réception et le retour y figurent avec leur numéro.
  const j = (await appel('GET', `/commercial/stock/mouvements?article_id=${R.eau}`, 'dir')).data;
  assert.ok(j.some((m) => m.type === 'reception' && /^REC-/.test(m.document_numero)));
  assert.ok(j.some((m) => m.type === 'retour_fournisseur' && /^RFO-/.test(m.document_numero)));
});
