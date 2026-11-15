// tests/commercial-bons.test.js — NJ COMMERCIAL, livraison C (migration 052).
//
//  Bons de commande : préparation depuis une demande approuvée (jamais rejetée),
//  quantités ≤ approuvé, calcul HT / taxes / TTC avec remise, taux figé,
//  revalidation (prix ou fournisseur hors autorisation), proforma obligatoire,
//  émission (numéro, PDF archivé + SHA-256, QR code), intangibilité, annulation,
//  révision, vérification publique (authentique / annulé / remplacé / inconnu),
//  droits, isolation, tableau de bord, documents, historique.
//
//   TEST_DATABASE_URL=postgres://…/base_de_test  node --test tests/commercial-bons.test.js
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
const PORT = 9300 + Math.floor(Math.random() * 300);
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
// Demande approuvée (soumise par dem, approuvée par resp) ; renvoie la demande lue.
// 063 : le demandeur n'indique aucun fournisseur ; le responsable des achats le propose en approuvant.
const demandeApprouvee = async (lignes) => {
  const d = (await appel('POST', '/commercial/demandes', 'dem', { magasin_id: R.mag, motif: 'Besoin de fournitures',
    lignes: lignes.map(({ fournisseur_id, ...l }) => l) })).data;
  await appel('POST', `/commercial/demandes/${d.id}/soumission`, 'dem', {});
  const fournisseurs = d.lignes.map((l) => ({ id: l.id, fournisseur_id: lignes.find((x) => x.article_id === l.article_id)?.fournisseur_id || '' }));
  const r = await appel('POST', `/commercial/demandes/${d.id}/decision`, 'resp', { decision: 'approuver', lignes: fournisseurs });
  assert.equal(r.data.statut, 'approuvee', r.message);
  return r.data;
};
const ligneDe = (d, article) => d.lignes.find((l) => l.article_id === article).id;

before(async () => {
  [{ id: A }] = await sql('INSERT INTO tenants (slug, nom, initialise_le, nui, adresse, ville, pays, telephone) VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7) RETURNING id',
    [`bca-${sfx}`, `Établissements Test ${sfx}`, 'M012345678901A', 'Rue 1.234', 'Yaoundé', 'Cameroun', '+237 699 00 00 00']);
  [{ id: B }] = await sql('INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id', [`bcb-${sfx}`, `Bons B ${sfx}`]);
  await creerUtilisateur('adm', 'super_admin', null);
  serveur = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: DB, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test', SMTP_HOST: '',
      RATE_LIMIT_MAX: '100000', VERIFICATION_RATE_MAX: '100000', MODULES_CONTROLE: 'appliquer', APP_URL: 'https://app.nj-business.test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = (d) => process.env.DEBUG_TEST && process.stderr.write(d);
  serveur.stdout.on('data', log); serveur.stderr.on('data', log);
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* démarrage */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  for (const t of [A, B]) assert.equal((await appel('PUT', `/plateforme/clients/${t}/modules/commercial`, 'adm', { actif: true, motif: 'Tests bons' })).status, 200);
  await creerUtilisateur('dir', 'directeur', A);
  await creerUtilisateur('resp', 'collaborateur', A, 'achats_responsable');
  await creerUtilisateur('gas', 'collaborateur', A, 'achats_gestionnaire');
  await creerUtilisateur('dem', 'collaborateur', A);
  await creerUtilisateur('dirB', 'directeur', B);
  await appel('PUT', '/commercial/societe', 'dir', { nom_commercial: 'Test Distribution', mentions_documents: 'Livraison aux heures ouvrables.', seuil_direction: '' });
  R.mag = (await appel('POST', '/commercial/magasins', 'dir', { code: 'MAG', nom: 'Magasin central', localisation: 'Zone industrielle' })).data.id;
  R.fou = (await appel('POST', '/commercial/tiers', 'dir', { type: 'fournisseur', nom: 'Bureau Plus SARL', ville: 'Douala', conditions_paiement: '30 jours fin de mois' })).data.id;
  R.fou2 = (await appel('POST', '/commercial/tiers', 'dir', { type: 'fournisseur', nom: 'Papeterie Centrale' })).data.id;
  R.tva = (await appel('POST', '/commercial/taxes', 'dir', { code: 'TVA', intitule: 'TVA', taux: '19,25' })).data.id;
  // 062 : l'unité de stock de la famille est obligatoire ; plus de taxe sur l'article.
  R.unite = (await appel('POST', '/commercial/unites', 'dir', { code: 'unité' })).data.id;
  R.fam = (await appel('POST', '/commercial/familles', 'dir', { code: 'FB', nom: 'Fournitures', unite_stock_id: R.unite, fournisseur_ids: [R.fou, R.fou2] })).data.id;
  R.rame = (await appel('POST', '/commercial/articles', 'dir', { reference: 'RAME', designation: 'Rame A4 80 g', famille_id: R.fam, unite: 'rame', prix_achat_indicatif: 3500, suivi_comptable: true })).data.id;
  R.stylo = (await appel('POST', '/commercial/articles', 'dir', { reference: 'STYLO', designation: 'Stylo bille bleu', famille_id: R.fam, prix_achat_indicatif: 150, suivi_comptable: false })).data.id;
  R.agraf = (await appel('POST', '/commercial/articles', 'dir', { reference: 'AGRAF', designation: 'Agrafeuse', famille_id: R.fam, suivi_comptable: true })).data.id;
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

test('Préparation : uniquement depuis une demande approuvée, quantités et droits contrôlés', async () => {
  const d = await demandeApprouvee([{ article_id: R.rame, quantite: 100, fournisseur_id: R.fou }, { article_id: R.stylo, quantite: 50 }]);
  R.d = d;
  assert.equal((await appel('GET', `/commercial/demandes/${d.id}`, 'dem')).data.droits.preparer_bc, false, 'le demandeur ne prépare pas de bon');
  const vueGas = await appel('GET', `/commercial/demandes/${d.id}`, 'gas');
  assert.equal(vueGas.data.droits.preparer_bc, true);
  const prop = await appel('GET', `/commercial/bons-commande/proposition/${d.id}`, 'gas');
  assert.equal(prop.data.lignes.length, 2);
  assert.deepEqual(prop.data.fournisseurs_retenus, [R.fou]);
  assert.equal((await appel('POST', '/commercial/bons-commande', 'dem', { demande_id: d.id })).status, 403, 'le demandeur ne prépare pas');
  let r = await appel('POST', '/commercial/bons-commande', 'gas', { demande_id: d.id, fournisseur_id: R.fou,
    lignes: [{ demande_ligne_id: ligneDe(d, R.rame), quantite: 120, prix_unitaire: 3500 }] });
  assert.equal(r.status, 409, 'au-delà de l\'approuvé');
  assert.match(r.message, /120.*100/);
  // Une demande rejetée ne donne jamais de bon.
  const rej = (await appel('POST', '/commercial/demandes', 'dem', { magasin_id: R.mag, motif: 'Test rejet', lignes: [{ article_id: R.rame, quantite: 1 }] })).data;
  await appel('POST', `/commercial/demandes/${rej.id}/soumission`, 'dem', {});
  await appel('POST', `/commercial/demandes/${rej.id}/decision`, 'resp', { decision: 'rejeter', commentaire: 'Inutile' });
  r = await appel('POST', '/commercial/bons-commande', 'gas', { demande_id: rej.id, fournisseur_id: R.fou, lignes: [{ demande_ligne_id: rej.lignes[0].id, quantite: 1, prix_unitaire: 3500 }] });
  assert.equal(r.status, 409);
  assert.match(r.message, /rejetée/);
});

test('Calculs : HT, remise, taxe, TTC arrondis au franc ; conditions reprises du fournisseur', async () => {
  const d = R.d;
  const r = await appel('POST', '/commercial/bons-commande', 'gas', { demande_id: d.id, fournisseur_id: R.fou, delai_livraison: 'Sous 10 jours',
    lignes: [{ demande_ligne_id: ligneDe(d, R.rame), quantite: 60, prix_unitaire: 3500, remise_pct: 5, taxe_id: R.tva }] });
  assert.equal(r.status, 201, r.message);
  const bc = r.data;
  R.bc = bc.id;
  assert.equal(bc.statut, 'brouillon');
  assert.equal(bc.conditions_paiement, '30 jours fin de mois', 'repris de la fiche fournisseur');
  const l = bc.lignes[0];
  assert.equal(l.montant_ht, 199500, '60 × 3 500 × 0,95');
  assert.equal(l.taxe_code, 'TVA', 'taxe choisie à la saisie de la ligne (062)');
  assert.equal(l.montant_taxe, 38404, '199 500 × 19,25 % = 38 403,75 → 38 404');
  assert.deepEqual([bc.total_ht, bc.total_taxes, bc.total_ttc], [199500, 38404, 237904]);
  assert.ok(bc.controles.every((c) => c.ok), JSON.stringify(bc.controles.filter((c) => !c.ok)));
  // Reste à commander : 40 rames et les stylos.
  const reste = (await appel('GET', `/commercial/bons-commande/proposition/${d.id}`, 'gas')).data.lignes;
  assert.equal(reste.find((x) => x.article_id === R.rame).reste, 40);
});

test('Aperçu PDF filigrané (brouillon) ; émission : numéro, PDF archivé, SHA-256, QR code', async () => {
  const ap = await binaire(`/commercial/bons-commande/${R.bc}/pdf`, 'gas');
  assert.equal(ap.status, 200);
  assert.equal(ap.buffer.subarray(0, 5).toString(), '%PDF-');
  assert.equal(ap.sha, null, 'un aperçu n\'a pas d\'empreinte officielle');
  assert.equal((await appel('POST', `/commercial/bons-commande/${R.bc}/emission`, 'gas')).status, 403, 'le GAS prépare, il n\'émet pas');
  const r = await appel('POST', `/commercial/bons-commande/${R.bc}/emission`, 'resp');
  assert.equal(r.status, 200, r.message);
  const bc = r.data;
  assert.equal(bc.statut, 'emis');
  assert.match(bc.numero_complet, new RegExp(`^BC-${new Date().getFullYear()}-0001$`));
  assert.match(bc.verification_url, /^https:\/\/app\.nj-business\.test\/verifier\/[A-Za-z0-9_-]{43}$/);
  assert.match(bc.autorisation, new RegExp(`autorisée par ${U.resp.username}`));
  const f = await binaire(`/commercial/bons-commande/${R.bc}/pdf`, 'dem');
  assert.equal(f.status, 403, 'le simple demandeur ne voit pas les bons');
  const p = await binaire(`/commercial/bons-commande/${R.bc}/pdf`, 'dir');
  assert.equal(p.status, 200);
  assert.equal(crypto.createHash('sha256').update(p.buffer).digest('hex'), bc.pdf_sha256, 'le fichier servi est celui archivé');
  assert.equal(p.sha, bc.pdf_sha256);
  await fsp.writeFile(path.join(require('node:os').tmpdir(), 'bc-test.pdf'), p.buffer);
  R.jeton = bc.verification_url.split('/').pop();
  R.sha = bc.pdf_sha256;
  R.numero = bc.numero_complet;
});

test('Un bon émis est intangible (API et base)', async () => {
  assert.equal((await appel('PUT', `/commercial/bons-commande/${R.bc}`, 'gas', { observations: 'Modifié' })).status, 409);
  assert.equal((await appel('DELETE', `/commercial/bons-commande/${R.bc}`, 'gas')).status, 409);
  await assert.rejects(sql('UPDATE com_bons_commande SET total_ttc = 1 WHERE id = $1', [R.bc]), /BC_INTANGIBLE/);
  await assert.rejects(sql('UPDATE com_bc_lignes SET quantite = 1 WHERE bc_id = $1', [R.bc]), /BC_INTANGIBLE/);
  await assert.rejects(sql('DELETE FROM com_bons_commande WHERE id = $1', [R.bc]), /BC_INTANGIBLE/);
});

test('Vérification publique : authentique, sans prix ; référence inconnue', async () => {
  let r = await appel('GET', `/verification/bc/${R.jeton}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.etat, 'authentique');
  assert.equal(r.data.numero, R.numero);
  assert.equal(r.data.societe, 'Test Distribution');
  assert.equal(r.data.fournisseur, 'Bureau Plus SARL');
  assert.equal(r.data.pdf_sha256, R.sha);
  assert.equal(r.data.total_ttc, undefined, 'aucun montant publié');
  r = await appel('GET', `/verification/bc/${'x'.repeat(43)}`);
  assert.equal(r.data.etat, 'inconnu');
  r = await appel('GET', '/verification/bc/abc');
  assert.equal(r.data.etat, 'inconnu');
});

test('Revalidation : fournisseur ou prix hors autorisation, puis nouvelle approbation', async () => {
  const d = R.d;
  // 40 rames restantes chez un autre fournisseur que celui retenu, et plus cher que l'approuvé.
  let r = await appel('POST', '/commercial/bons-commande', 'gas', { demande_id: d.id, fournisseur_id: R.fou2,
    lignes: [{ demande_ligne_id: ligneDe(d, R.rame), quantite: 40, prix_unitaire: 4200 }, { demande_ligne_id: ligneDe(d, R.stylo), quantite: 50, prix_unitaire: 150 }] });
  assert.equal(r.status, 201, r.message);
  R.bc2 = r.data.id;
  const ctrl = r.data.controles.find((c) => c.code === 'autorisation');
  assert.equal(ctrl.ok, false);
  assert.match(ctrl.message, /autre fournisseur/);
  assert.match(ctrl.message, /4\s200/);
  assert.equal(r.data.droits.revalider, true);
  assert.equal((await appel('POST', `/commercial/bons-commande/${R.bc2}/emission`, 'resp')).status, 409, 'émission refusée');
  r = await appel('POST', `/commercial/bons-commande/${R.bc2}/revalidation`, 'gas', {});
  assert.equal(r.status, 200, r.message);
  let dem = (await appel('GET', `/commercial/demandes/${d.id}`, 'resp')).data;
  assert.equal(dem.statut, 'examen_achats');
  assert.equal(dem.decisions.at(-1).etape, 'gestionnaire');
  assert.ok((await sql("SELECT 1 FROM notifications WHERE destinataire_id = $1 AND titre LIKE 'Revalidation%'", [U.resp.id])).length);
  assert.equal((await appel('POST', `/commercial/bons-commande/${R.bc2}/emission`, 'resp')).status, 409, 'demande en cours de revalidation');
  r = await appel('POST', `/commercial/demandes/${d.id}/decision`, 'resp', { decision: 'approuver', commentaire: 'Prix accepté' });
  assert.equal(r.data.statut, 'approuvee');
  const bc2 = (await appel('GET', `/commercial/bons-commande/${R.bc2}`, 'resp')).data;
  assert.ok(bc2.controles.every((c) => c.ok), JSON.stringify(bc2.controles.filter((c) => !c.ok)));
  // Le bon déjà émis n'est pas touché par la revalidation.
  const bc1 = (await appel('GET', `/commercial/bons-commande/${R.bc}`, 'resp')).data;
  assert.equal(bc1.statut, 'emis');
  dem = (await appel('GET', `/commercial/demandes/${d.id}`, 'gas')).data;
  assert.equal(dem.etat_commande, 'partielle');
});

test('Proforma obligatoire : émission bloquée sans, possible avec ; fichier contrôlé', async () => {
  await appel('PUT', '/commercial/societe', 'dir', { proforma_obligatoire: true });
  let bc2 = (await appel('GET', `/commercial/bons-commande/${R.bc2}`, 'gas')).data;
  assert.equal(bc2.controles.find((c) => c.code === 'proforma').ok, false);
  assert.equal((await appel('POST', `/commercial/bons-commande/${R.bc2}/emission`, 'resp')).status, 409);
  assert.equal((await appel('POST', `/commercial/bons-commande/${R.bc2}/proformas`, 'gas', { nom_fichier: 'x.pdf', data_base64: Buffer.from('pas un pdf').toString('base64') })).status, 400);
  const pdfMin = Buffer.from('%PDF-1.4\n%proforma\n%%EOF').toString('base64');
  const r = await appel('POST', `/commercial/bons-commande/${R.bc2}/proformas`, 'gas', { nom_fichier: 'proforma-papeterie.pdf', data_base64: pdfMin });
  assert.equal(r.status, 201, r.message);
  assert.equal(r.data.documents[0].categorie, 'proforma');
  bc2 = (await appel('POST', `/commercial/bons-commande/${R.bc2}/emission`, 'dir')).data;
  assert.equal(bc2.statut, 'emis');
  assert.match(bc2.numero_complet, /-0002$/);
  assert.equal((await appel('POST', `/commercial/bons-commande/${R.bc2}/proformas`, 'gas', { nom_fichier: 'p.pdf', data_base64: pdfMin })).status, 409, 'pièces figées après émission');
  await appel('PUT', '/commercial/societe', 'dir', { proforma_obligatoire: false });
  const dem = (await appel('GET', `/commercial/demandes/${R.d.id}`, 'gas')).data;
  assert.equal(dem.etat_commande, 'commandee');
  assert.equal(dem.droits.preparer_bc, false, 'plus rien à commander');
});

test('Taux figé : changer la taxe du référentiel ne touche pas un bon émis', async () => {
  const r = await appel('PUT', `/commercial/taxes/${R.tva}`, 'dir', { taux: 20 });
  assert.equal(r.status, 409, 'un taux repris dans un document ne se modifie plus');
  const [l] = await sql('SELECT taxe_taux FROM com_bc_lignes WHERE bc_id = $1', [R.bc]);
  assert.equal(Number(l.taxe_taux), 19.25);
});

test('Révision puis annulation : vérification « remplacé » puis « annulé »', async () => {
  assert.equal((await appel('POST', `/commercial/bons-commande/${R.bc}/revision`, 'gas')).status, 403, 'la révision demande le droit d\'annuler');
  let r = await appel('POST', `/commercial/bons-commande/${R.bc}/revision`, 'resp');
  assert.equal(r.status, 201, r.message);
  const rev = r.data;
  assert.equal(rev.statut, 'brouillon');
  assert.equal(rev.remplace_numero, R.numero);
  // La révision peut reprendre les 60 rames du bon qu'elle remplace.
  r = await appel('PUT', `/commercial/bons-commande/${rev.id}`, 'resp', { lignes: [{ demande_ligne_id: rev.lignes[0].demande_ligne_id, quantite: 60, prix_unitaire: 3400, remise_pct: 0 }] });
  assert.equal(r.status, 200, r.message);
  assert.equal((await appel('POST', `/commercial/bons-commande/${R.bc}/annulation`, 'resp', { motif: 'test' })).status, 409, 'révision en cours');
  r = await appel('POST', `/commercial/bons-commande/${rev.id}/emission`, 'resp');
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.numero_complet, `${R.numero}-R1`);
  let v = await appel('GET', `/verification/bc/${R.jeton}`);
  assert.equal(v.data.etat, 'remplace');
  assert.equal(v.data.remplace_par, `${R.numero}-R1`);
  const jetonRev = r.data.verification_url.split('/').pop();
  assert.equal((await appel('POST', `/commercial/bons-commande/${rev.id}/annulation`, 'resp', {})).status, 400, 'motif obligatoire');
  r = await appel('POST', `/commercial/bons-commande/${rev.id}/annulation`, 'resp', { motif: 'Fournisseur en rupture' });
  assert.equal(r.data.statut, 'annule');
  v = await appel('GET', `/verification/bc/${jetonRev}`);
  assert.equal(v.data.etat, 'annule');
  assert.ok(v.data.date_annulation);
});

test('Demande avec un bon actif : son annulation est refusée', async () => {
  const d = await demandeApprouvee([{ article_id: R.stylo, quantite: 10, fournisseur_id: R.fou }]);
  await appel('POST', '/commercial/bons-commande', 'gas', { demande_id: d.id, fournisseur_id: R.fou, lignes: [{ demande_ligne_id: d.lignes[0].id, quantite: 10, prix_unitaire: 150 }] });
  const r = await appel('POST', `/commercial/demandes/${d.id}/annulation`, 'resp', { motif: 'Annulation' });
  assert.equal(r.status, 409);
  assert.match(r.message, /bon de commande/);
});

test('Isolation entre clients', async () => {
  assert.equal((await appel('GET', `/commercial/bons-commande/${R.bc}`, 'dirB')).status, 404);
  assert.equal((await binaire(`/commercial/bons-commande/${R.bc}/pdf`, 'dirB')).status, 404);
  assert.equal((await appel('GET', '/commercial/bons-commande', 'dirB')).data.length, 0);
  assert.equal((await appel('POST', '/commercial/bons-commande', 'dirB', { demande_id: R.d.id, fournisseur_id: R.fou, lignes: [] })).status, 404);
});

test('Tableau de bord, documents et historique : chiffres réels', async () => {
  const t = (await appel('GET', '/commercial/tableau-bord', 'dir')).data;
  assert.equal(t.bons.emis, 1, 'BC-0002 seul encore émis (0001 remplacé, R1 annulé)');
  assert.equal(t.bons.remplaces, 1);
  assert.equal(t.bons.annules, 1);
  assert.equal(t.bons.brouillons, 1);
  assert.equal(t.pieces.bons_avec_proforma, 1);
  assert.equal(t.par_fournisseur[0].nom, 'Papeterie Centrale');
  assert.equal(t.par_fournisseur[0].ttc, (await sql("SELECT total_ttc FROM com_bons_commande WHERE id = $1", [R.bc2]))[0].total_ttc * 1);
  assert.ok(t.par_mois.length >= 1);
  assert.equal(t.demandes.par_statut.rejetee.n, 1);
  assert.equal((await appel('GET', '/commercial/tableau-bord', 'dem')).status, 403);
  const docsListe = (await appel('GET', '/commercial/documents?categorie=proforma', 'resp')).data;
  assert.equal(docsListe.length, 1);
  assert.equal(docsListe[0].fournisseur, 'Papeterie Centrale');
  const h = (await appel('GET', '/commercial/historique', 'dir')).data;
  for (const lib of ['Bon émis', 'Revalidation demandée', 'Bon annulé', 'Bon remplacé par une révision', 'Proforma jointe']) {
    assert.ok(h.some((x) => x.libelle === lib), `${lib} dans l'historique`);
  }
});
