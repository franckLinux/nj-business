// tests/commercial-approvisionnement.test.js — NJ COMMERCIAL, lot 8 (migration 063).
//
//  Circuit complet : expression de besoin (quantité théorique) → validation (quantités
//  approuvées, fournisseurs proposés) → consultation de trois fournisseurs (liens
//  individuels) → offres en ligne (versions, intangibilité, cloisonnement) → comparaison →
//  attribution par article → plusieurs bons de commande → envoi → réception partielle avec
//  scan du BL → frais accessoires (coût réel, rejeu CMUP) → facture par le comptable →
//  stocks → droits.
//
//   TEST_DATABASE_URL=postgres://…/base_de_test  node --test tests/commercial-approvisionnement.test.js
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
  return { status: r.status, type: r.headers.get('content-type'), data: brut.data ?? brut, message: brut.message || brut.error || brut.data?.error };
};
const creerUtilisateur = async (cle, role, tenant, profil = null) => {
  const username = `${cle}-${sfx}`;
  const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif, custom_role_id)
                          VALUES ($1, $2, $3, $4, $5, true, (SELECT id FROM roles WHERE tenant_id = $1 AND code = $6)) RETURNING id`,
  [tenant, username, `${username}@test.cm`, await bcrypt.hash('x', 4), role, profil]);
  U[cle] = { id: u.id, username, token: jwt.sign({ sub: u.id, username, role, tenantId: tenant }, SECRET, { expiresIn: '1h' }) };
};
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n').toString('base64');
const jeton = (f) => f.lien.split('/offre/')[1];
const ligne = (objet, article) => objet.lignes.find((l) => l.article_id === article);
const proche = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;

before(async () => {
  [{ id: A }] = await sql('INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id', [`apa-${sfx}`, `Appro A ${sfx}`]);
  [{ id: B }] = await sql('INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id', [`apb-${sfx}`, `Appro B ${sfx}`]);
  await creerUtilisateur('adm', 'super_admin', null);
  serveur = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: DB, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test', SMTP_HOST: '',
      RATE_LIMIT_MAX: '100000', PORTAIL_RATE_MAX: '100000', MODULES_CONTROLE: 'appliquer', APP_URL: 'https://app.nj-business.test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = (d) => process.env.DEBUG_TEST && process.stderr.write(d);
  serveur.stdout.on('data', log); serveur.stderr.on('data', log);
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* démarrage */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  for (const t of [A, B]) assert.equal((await appel('PUT', `/plateforme/clients/${t}/modules/commercial`, 'adm', { actif: true, motif: 'Tests approvisionnement' })).status, 200);
  await creerUtilisateur('dir', 'directeur', A);
  await creerUtilisateur('dem', 'collaborateur', A, 'achats_demandeur');
  await creerUtilisateur('resp', 'collaborateur', A, 'achats_responsable');
  await creerUtilisateur('gas', 'collaborateur', A, 'achats_gestionnaire');
  await creerUtilisateur('mag', 'collaborateur', A, 'stock_magasinier');
  await creerUtilisateur('ges', 'collaborateur', A, 'stock_gestionnaire');
  await creerUtilisateur('cpt', 'collaborateur', A, 'achats_comptable');
  await creerUtilisateur('cpt2', 'auditeur', A);
  await creerUtilisateur('dirB', 'directeur', B);
  // Référentiel
  for (const [code, dec] of [['pièce', 0], ['carton', 0], ['sac', 0]]) R[code] = (await appel('POST', '/commercial/unites', 'dir', { code, decimales: dec })).data.id;
  R.tva = (await appel('POST', '/commercial/taxes', 'dir', { code: 'TVA', intitule: 'TVA', taux: '19,25' })).data.id;
  const fou = async (nom, x = {}) => (await appel('POST', '/commercial/tiers', 'dir', { type: 'fournisseur', nom, ...x })).data;
  const f1 = await fou('Sobraga Distribution', { delai_livraison_jours: 5, delai_type: 'ouvres', conditions_paiement: '30 jours' });
  assert.equal(f1.delai_livraison_jours, 5, 'délai de livraison enregistré sur la fiche');
  assert.equal(f1.delai_type, 'ouvres');
  R.f1 = f1.id; R.f2 = (await fou('Agro Plus')).id; R.f3 = (await fou('Négoce Centrale')).id;
  R.transp = (await fou('Trans Express')).id;
  R.cen = (await appel('POST', '/commercial/magasins', 'dir', { code: 'CEN', nom: 'Central' })).data.id;
  R.fam = (await appel('POST', '/commercial/familles', 'dir', { code: 'DIV', nom: 'Divers', unite_stock_id: R['pièce'], fournisseur_ids: [R.f1, R.f2] })).data.id;
  const art = async (reference, designation, x) => {
    const a = await appel('POST', '/commercial/articles', 'dir', { reference, designation, famille_id: R.fam, suivi_comptable: true, ...x });
    assert.equal(a.status, 201, a.message);
    return a.data.id;
  };
  R.eau = await art('EAU', 'Eau minérale 1,5 L', { unite_achat_id: R.carton, coef_achat: 12, seuil_alerte: 24, poids_kg: 1.5, prix_achat_indicatif: 3600 });
  R.cahier = await art('CAH', 'Cahier 200 pages', { prix_achat_indicatif: 500 });
  R.riz = await art('RIZ', 'Riz 50 kg', { unite_stock_id: R.sac, prix_achat_indicatif: 10000 });
  assert.equal((await appel('PUT', '/commercial/stock/initial', 'dir', { article_id: R.eau, magasin_id: R.cen, quantite: 30, cout_unitaire: 250, date_mouvement: '2026-10-01' })).status, 200);
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

test('1-2. Demande d\'achat : aucun fournisseur à l\'expression, quantité théorique calculée', async () => {
  const c = await appel('POST', '/commercial/demandes', 'dem', { magasin_id: R.cen, motif: 'Réassort trimestriel', fournisseur_propose_id: R.f1, lignes: [
    { article_id: R.eau, quantite_besoin: 4, quantite: 4, fournisseur_id: R.f1 },   // 4 cartons = 48 pièces
    { article_id: R.cahier, quantite_besoin: 20, quantite: 20 },
    { article_id: R.riz, quantite_besoin: 10, quantite: 10 },
  ] });
  assert.equal(c.status, 201, c.message);
  const d = c.data;
  assert.equal(d.fournisseur_propose_id, null, 'aucun fournisseur à l\'expression du besoin');
  const eau = ligne(d, R.eau);
  assert.equal(eau.fournisseur_id, null);
  assert.deepEqual(eau.fournisseurs_proposes, [], 'rien n\'est proposé au demandeur');
  // Stock 30 pièces, sécurité 24, demandé 48 : différence = 30 − 48 = −18 ; théorique = 24 − (−18) = 42 pièces = 3,5 cartons.
  assert.equal(eau.stock_actuel.difference, -18);
  assert.equal(eau.stock_actuel.theorique, 42);
  assert.deepEqual([eau.stock_ligne.disponible, eau.stock_ligne.securite, eau.stock_ligne.theorique], [2.5, 2, 3.5]);
  assert.equal(eau.quantite_besoin, 4);
  // Jamais négatif : un stock large ne donne pas de quantité négative.
  assert.equal(ligne(d, R.cahier).stock_ligne.disponible, null, 'pas de stock inventé');
  assert.equal(d.statut_libelle, 'Brouillon');
  const s = await appel('POST', `/commercial/demandes/${d.id}/soumission`, 'dem', {});
  assert.equal(s.status, 200, s.message);
  assert.equal(s.data.statut_libelle, 'Soumise (responsable des achats)');
  assert.equal(ligne(s.data, R.eau).stock_constate.theorique, 42, 'théorique figé à la soumission');
  R.d = s.data;
});

test('3. Validation : quantités approuvées et fournisseurs proposés par le responsable, tracés', async () => {
  const d = R.d;
  assert.equal((await appel('POST', `/commercial/demandes/${d.id}/decision`, 'dem', { decision: 'approuver' })).status, 403, 'pas sur sa propre demande');
  const vue = (await appel('GET', `/commercial/demandes/${d.id}`, 'resp')).data;
  assert.deepEqual(ligne(vue, R.eau).fournisseurs_proposes.map((f) => f.id).sort(), [R.f1, R.f2].sort(), 'le responsable voit les fournisseurs de la famille');
  const r = await appel('POST', `/commercial/demandes/${d.id}/decision`, 'resp', { decision: 'approuver', commentaire: 'Validé avec ajustements', lignes: [
    { id: ligne(d, R.eau).id, quantite: 5, fournisseur_id: R.f1 },
    { id: ligne(d, R.cahier).id, quantite: 20 },
    { id: ligne(d, R.riz).id, quantite: 10 },
  ] });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.statut, 'approuvee');
  const eau = ligne(r.data, R.eau);
  assert.deepEqual([eau.quantite_demandee, eau.quantite_approuvee, eau.fournisseur_id], [4, 5, R.f1]);
  const dec = r.data.decisions.at(-1);
  assert.equal(dec.par_nom, U.resp.username);
  assert.equal(dec.details.find((x) => x.ligne === eau.id).approuvee, 5, 'quantités approuvées gardées dans la décision');
  assert.equal(r.data.etat_appro, 'a_commander');
  assert.equal(r.data.droits.consulter, true);
  R.d = r.data;
});

test('4. Consultation : trois fournisseurs (sinon dérogation motivée), demandes de proforma individualisées', async () => {
  const d = R.d;
  assert.equal((await appel('POST', '/commercial/consultations', 'gas', { demande_id: d.id, date_limite: '2099-12-31', fournisseur_ids: [R.f1, R.f2, R.f3] })).status, 403);
  // Deux fournisseurs : refusé sans motif de dérogation.
  let c = await appel('POST', '/commercial/consultations', 'resp', { demande_id: d.id, date_limite: '2099-12-31', fournisseur_ids: [R.f1, R.f2] });
  assert.equal(c.status, 201, c.message);
  assert.equal((await appel('POST', `/commercial/consultations/${c.data.id}/lancement`, 'resp', { envoyer_emails: false })).status, 400, 'motif de dérogation exigé');
  // Trois fournisseurs : conforme ; délai souhaité et conditions repris dans le PDF.
  c = await appel('PUT', `/commercial/consultations/${c.data.id}`, 'resp', { fournisseur_ids: [R.f1, R.f2, R.f3], delai_souhaite: 'Sous 10 jours',
    conditions_reponse: 'Prix franco magasin central.', validite_offre_jours: 45 });
  assert.equal(c.status, 200, c.message);
  assert.equal(c.data.lignes.length, 3);
  assert.equal(ligne(c.data, R.eau).quantite, 5, 'quantité approuvée restant à commander');
  const l = await appel('POST', `/commercial/consultations/${c.data.id}/lancement`, 'resp', { envoyer_emails: false });
  assert.equal(l.status, 200, l.message);
  assert.equal(l.data.statut, 'lancee');
  assert.ok(l.data.fournisseurs.every((f) => f.statut === 'a_envoyer' && /^https:\/\/app\.nj-business\.test\/offre\/[A-Za-z0-9_-]{43}$/.test(f.lien)));
  assert.equal(new Set(l.data.fournisseurs.map((f) => f.lien)).size, 3, 'un lien par fournisseur');
  const pdf = await fetch(`${BASE}/commercial/consultations/${c.data.id}/fournisseurs/${l.data.fournisseurs[0].id}/pdf`, { headers: { Authorization: `Bearer ${U.resp.token}` } });
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.ok(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString() === '%PDF-');
  for (const f of l.data.fournisseurs) {
    const e = await appel('POST', `/commercial/consultations/${c.data.id}/fournisseurs/${f.id}/envoi`, 'resp', { mode: 'manuel', destinataire: 'WhatsApp au 699000000' });
    assert.equal(e.status, 200, e.message);
  }
  const lu = (await appel('GET', `/commercial/consultations/${c.data.id}`, 'resp')).data;
  assert.ok(lu.fournisseurs.every((f) => f.statut === 'envoyee'));
  R.c = lu;
  R.j = Object.fromEntries(lu.fournisseurs.map((f) => [f.fournisseur_id, jeton(f)]));
  assert.equal((await appel('GET', `/commercial/demandes/${d.id}`, 'resp')).data.etat_appro, 'en_cours', 'en cours d\'approvisionnement');
});

test('5. Portail : offres en ligne, sans compte, cloisonnées, versionnées et intangibles', async () => {
  const lignesDe = async (j) => (await appel('GET', `/offres-fournisseurs/${j}`)).data.lignes;
  const offre = async (fid, prix, x = {}) => {
    const ls = await lignesDe(R.j[fid]);
    const art = Object.fromEntries(R.c.lignes.map((l) => [l.id, l.article_id]));
    return appel('POST', `/offres-fournisseurs/${R.j[fid]}`, null, { signataire: 'Service commercial', conditions_paiement: '30 jours', validite_jours: 45, ...x,
      lignes: ls.map((l) => (prix[art[l.id]] === null ? { consultation_ligne_id: l.id, disponibilite: 'indisponible' }
        : { consultation_ligne_id: l.id, disponibilite: 'disponible', prix_unitaire: prix[art[l.id]], taux_taxe: 19.25 })) });
  };
  const vue = await appel('GET', `/offres-fournisseurs/${R.j[R.f1]}`);
  assert.equal(vue.status, 200);
  assert.equal(vue.data.ouverte, true);
  assert.equal(vue.data.fournisseur, 'Sobraga Distribution');
  assert.equal(vue.data.lignes.length, 3);
  assert.equal((await appel('GET', '/offres-fournisseurs/inconnu')).status, 404);
  assert.equal((await appel('GET', `/offres-fournisseurs/${'x'.repeat(43)}`)).status, 404);
  // Prix HT par unité de la demande (carton pour l'eau).
  let r = await offre(R.f1, { [R.eau]: 3600, [R.cahier]: 500, [R.riz]: 11000 }, { delai_livraison_jours: 5 });
  assert.equal(r.status, 200, r.message);
  assert.equal((await offre(R.f2, { [R.eau]: 3400, [R.cahier]: null, [R.riz]: 10500 }, { delai_livraison_jours: 10 })).status, 200);
  r = await offre(R.f3, { [R.eau]: 3500, [R.cahier]: 450, [R.riz]: 10000 }, { delai_livraison_jours: 3,
    proforma: { nom_fichier: 'proforma-negoce.pdf', data_base64: PDF } });
  assert.equal(r.status, 200, r.message);
  // Offre soumise : plus modifiable sans réouverture.
  assert.equal((await offre(R.f1, { [R.eau]: 3550, [R.cahier]: 500, [R.riz]: 11000 })).status, 409);
  // Cloisonnement : le fournisseur 2 ne voit que sa propre offre.
  const v2 = JSON.stringify((await appel('GET', `/offres-fournisseurs/${R.j[R.f2]}`)).data);
  assert.ok(!v2.includes('3600') && !v2.includes('3500') && !v2.includes('Sobraga'), 'aucune donnée des concurrents');
  // Réouverture motivée → version 2 ; la version 1 reste conservée.
  const cf1 = R.c.fournisseurs.find((f) => f.fournisseur_id === R.f1);
  assert.equal((await appel('POST', `/commercial/consultations/${R.c.id}/fournisseurs/${cf1.id}/reouverture`, 'resp', { motif: 'Erreur de prix signalée par le fournisseur' })).status, 200);
  r = await offre(R.f1, { [R.eau]: 3550, [R.cahier]: 500, [R.riz]: 11000 }, { delai_livraison_jours: 5 });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.version, 2);
  const versions = await sql('SELECT version, actuelle FROM com_offres WHERE consultation_fournisseur_id = $1 ORDER BY version', [cf1.id]);
  assert.deepEqual(versions.map((v) => [v.version, v.actuelle]), [[1, false], [2, true]]);
  await assert.rejects(sql('UPDATE com_offre_lignes SET prix_unitaire = 1 WHERE offre_id IN (SELECT id FROM com_offres WHERE consultation_fournisseur_id = $1)', [cf1.id]), /OFFRE_INTANGIBLE/);
  const lu = (await appel('GET', `/commercial/consultations/${R.c.id}`, 'resp')).data;
  assert.ok(lu.fournisseurs.every((f) => f.statut === 'offre_recue'));
  assert.ok(lu.historique.some((h) => h.action === 'COM_CONSULTATION_OFFRE_RECUE'), 'réception horodatée et tracée');
});

test('6. Comparaison : article par article, meilleur prix et meilleur délai mis en évidence', async () => {
  const r = await appel('GET', `/commercial/consultations/${R.c.id}/comparatif`, 'resp');
  assert.equal(r.status, 200, r.message);
  const eau = r.data.lignes.find((l) => l.article_id === R.eau);
  assert.equal(eau.meilleur_prix, 3400);
  assert.deepEqual(eau.propositions.filter((p) => p.meilleur_prix).map((p) => p.fournisseur_id), [R.f2]);
  assert.deepEqual(eau.propositions.filter((p) => p.meilleur_delai).map((p) => p.fournisseur_id), [R.f3]);
  const f1 = eau.propositions.find((p) => p.fournisseur_id === R.f1);
  assert.deepEqual([f1.prix_unitaire, f1.montant_ht, f1.montant_taxe, f1.delai_livraison_jours, f1.conditions_paiement], [3550, 17750, 3416.88, 5, '30 jours']);
  const cahier = r.data.lignes.find((l) => l.article_id === R.cahier);
  assert.equal(cahier.propositions.find((p) => p.fournisseur_id === R.f2).utilisable, false, 'indisponible');
  assert.equal(r.data.offres.length, 3);
  assert.ok(r.data.offres.every((o) => o.total_ttc > 0));
  // Rien n'est retenu d'office.
  assert.ok(r.data.lignes.every((l) => l.choix_offre_ligne_id === null));
  R.cmp = r.data;
});

test('7-8. Attribution par article (choix motivé) et plusieurs bons de commande', async () => {
  const p = (art, fid) => R.cmp.lignes.find((l) => l.article_id === art).propositions.find((x) => x.fournisseur_id === fid);
  const lig = (art) => R.cmp.lignes.find((l) => l.article_id === art).id;
  const choix = (motifEau) => [
    { consultation_ligne_id: lig(R.eau), offre_ligne_id: p(R.eau, R.f1).offre_ligne_id, motif: motifEau },
    { consultation_ligne_id: lig(R.cahier), offre_ligne_id: p(R.cahier, R.f1).offre_ligne_id, motif: 'Regroupement avec l\'eau' },
    { consultation_ligne_id: lig(R.riz), offre_ligne_id: p(R.riz, R.f3).offre_ligne_id },
  ];
  let r = await appel('POST', `/commercial/consultations/${R.c.id}/attribution`, 'resp', { lignes: choix('') });
  assert.equal(r.status, 400, 'un choix qui n\'est pas le moins-disant se justifie');
  assert.match(r.message, /moins-disant/);
  r = await appel('POST', `/commercial/consultations/${R.c.id}/attribution`, 'resp', { lignes: choix('Fournisseur habituel, livraison fiable') });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.statut, 'attribuee');
  assert.equal(r.data.bons_crees.length, 2, 'un bon par fournisseur retenu');
  const bons = await Promise.all(r.data.bons_crees.map(async (id) => (await appel('GET', `/commercial/bons-commande/${id}`, 'resp')).data));
  const bf1 = bons.find((b) => b.fournisseur_id === R.f1);
  const bf3 = bons.find((b) => b.fournisseur_id === R.f3);
  assert.equal(bf1.lignes.length, 2);
  assert.equal(bf3.lignes.length, 1);
  assert.equal(bf1.consultation_id, R.c.id);
  assert.equal(bf1.demande_id, R.d.id, 'lien avec la demande d\'origine');
  assert.equal(ligne(bf1, R.eau).prix_unitaire, 3550);
  assert.equal(ligne(bf1, R.eau).taxe_code, 'TVA', 'taux de l\'offre rapproché de la taxe du client');
  assert.match(bf1.delai_livraison, /5 jours calendaires/);
  assert.ok(bf1.controles.every((c) => c.ok), JSON.stringify(bf1.controles.filter((c) => !c.ok)));
  // Pas de double attribution, pas de doublon de commande.
  assert.equal((await appel('POST', `/commercial/consultations/${R.c.id}/attribution`, 'resp', { lignes: choix('x'.repeat(10)) })).status, 409);
  assert.equal((await appel('POST', '/commercial/bons-commande', 'gas', { demande_id: R.d.id, fournisseur_id: R.f2,
    lignes: [{ demande_ligne_id: ligne(R.d, R.eau).id, quantite: 1, prix_unitaire: 3400 }] })).status, 409, 'quantité déjà commandée');
  // Émission, puis envoi au fournisseur (envoi constaté ; l'e-mail exige un SMTP).
  for (const b of [bf1, bf3]) assert.equal((await appel('POST', `/commercial/bons-commande/${b.id}/emission`, 'resp')).status, 200);
  let e = await appel('POST', `/commercial/bons-commande/${bf1.id}/envoi`, 'resp', { mode: 'email', destinataire: 'achats@sobraga.test' });
  assert.equal(e.status, 502, 'SMTP absent : erreur claire, rien n\'est marqué');
  e = await appel('POST', `/commercial/bons-commande/${bf1.id}/envoi`, 'resp', { mode: 'manuel', destinataire: 'Remis au livreur' });
  assert.equal(e.status, 200, e.message);
  assert.deepEqual([e.data.suivi, e.data.suivi_libelle], ['envoye', 'Envoyé au fournisseur']);
  assert.equal((await appel('POST', `/commercial/bons-commande/${bf1.id}/envoi`, 'gas', { mode: 'manuel', destinataire: 'x' })).status, 403);
  const d = (await appel('GET', `/commercial/demandes/${R.d.id}`, 'resp')).data;
  assert.deepEqual(ligne(d, R.eau).suivi, { demandee: 4, approuvee: 5, commandee: 5, en_preparation: 0, recue: 0, restante: 0 });
  R.bf1 = bf1; R.bf3 = bf3;
});

test('9-10. Réception partielle avec scan du bon de livraison ; stock sur les quantités validées', async () => {
  const bl = ligne(R.bf1, R.eau);
  const c = await appel('POST', '/commercial/receptions', 'mag', { bc_id: R.bf1.id, bl_numero: 'BL-4471', lignes: [{ bc_ligne_id: bl.id, quantite: 3 }] });
  assert.equal(c.status, 201, c.message);
  const p = await appel('POST', `/commercial/receptions/${c.data.id}/pieces`, 'mag', { nom_fichier: 'bl-4471.pdf', data_base64: PDF });
  assert.equal(p.status, 201, p.message);
  assert.equal((await appel('POST', `/commercial/receptions/${c.data.id}/pieces`, 'mag', { nom_fichier: 'bl.exe', data_base64: Buffer.from('MZ....').toString('base64') })).status, 400, 'format refusé');
  assert.equal((await appel('POST', `/commercial/receptions/${c.data.id}/soumission`, 'mag', {})).status, 200);
  const [{ q: avant }] = await sql('SELECT COALESCE(SUM(sens * quantite), 0)::float AS q FROM com_stock_mouvements WHERE article_id = $1 AND NOT annule', [R.eau]);
  assert.equal(avant, 30, 'rien n\'entre en stock avant validation');
  assert.equal((await appel('POST', `/commercial/receptions/${c.data.id}/validation`, 'ges', {})).status, 200);
  const [{ q }] = await sql('SELECT COALESCE(SUM(sens * quantite), 0)::float AS q FROM com_stock_mouvements WHERE article_id = $1 AND NOT annule', [R.eau]);
  assert.equal(q, 66, '30 + 3 cartons × 12');
  const b = (await appel('GET', `/commercial/bons-commande/${R.bf1.id}`, 'resp')).data;
  assert.equal(b.suivi, 'partiellement_livre');
  assert.equal(b.reception.receptions[0].bl_numero, 'BL-4471');
  const d = (await appel('GET', `/commercial/demandes/${R.d.id}`, 'resp')).data;
  assert.equal(d.etat_appro, 'partielle');
  assert.equal(d.statut_libelle, 'Partiellement satisfaite');
  assert.equal(ligne(d, R.eau).suivi.recue, 3);
  R.rec1 = c.data.id;
});

test('11. Frais accessoires : répartition, coût réel d\'acquisition et revalorisation du stock', async () => {
  assert.equal((await appel('POST', '/commercial/frais', 'mag', { bc_id: R.bf1.id, rubrique: 'transport', fournisseur_id: R.transp, montant_ht: 6000 })).status, 403);
  // Transport 6 000 HT sur le bon F1, au prorata de la valeur : eau 17 750, cahiers 10 000.
  const ap = await appel('POST', '/commercial/frais/apercu', 'gas', { bc_id: R.bf1.id, rubrique: 'transport', montant_ht: 6000, methode: 'valeur' });
  assert.equal(ap.status, 200, ap.message);
  assert.deepEqual(ap.data.map((l) => l.part), [3837.84, 2162.16]);
  const f = await appel('POST', '/commercial/frais', 'gas', { bc_id: R.bf1.id, rubrique: 'transport', fournisseur_id: R.transp, reference_piece: 'FT-88',
    montant_ht: 6000, montant_taxe: 1155, methode: 'valeur' });
  assert.equal(f.status, 201, f.message);
  assert.equal(f.data.fournisseur_nom, 'Trans Express');
  assert.match(f.data.numero, /^FRA-\d{4}-\d{4}$/);
  assert.equal((await appel('POST', `/commercial/frais/${f.data.id}/validation`, 'gas')).status, 403, 'le gestionnaire saisit, ne valide pas');
  const v = await appel('POST', `/commercial/frais/${f.data.id}/validation`, 'cpt');
  assert.equal(v.status, 200, v.message);
  // Validés APRÈS la réception : la réception déjà entrée est revalorisée (rejeu CMUP).
  // Eau : 3 837,84 / 5 cartons = 767,568 par carton = 63,964 par pièce ; achat 3 550 / 12 = 295,833.
  const [m] = await sql("SELECT cout_achat::float, cout_frais::float, cout_unitaire::float FROM com_stock_mouvements WHERE type = 'reception' AND article_id = $1", [R.eau]);
  assert.ok(proche(m.cout_achat, 295.833333) && proche(m.cout_frais, 63.964) && proche(m.cout_unitaire, 359.797333, 0.001), JSON.stringify(m));
  const [s] = await sql('SELECT quantite::float, valeur::float FROM com_stock_soldes WHERE article_id = $1 AND magasin_id = $2', [R.eau, R.cen]);
  assert.ok(proche(s.valeur, 30 * 250 + 36 * 359.797333, 0.05), `valeur ${s.valeur}`);
  // Le reste du bon, reçu ensuite, entre directement avec sa part de frais.
  const c2 = await appel('POST', '/commercial/receptions', 'mag', { bc_id: R.bf1.id, bl_numero: 'BL-4502', lignes: [{ bc_ligne_id: ligne(R.bf1, R.eau).id, quantite: 2 }, { bc_ligne_id: ligne(R.bf1, R.cahier).id, quantite: 20 }] });
  assert.equal(c2.status, 201, c2.message);
  assert.equal((await appel('POST', `/commercial/receptions/${c2.data.id}/soumission`, 'mag', {})).status, 200);
  assert.equal((await appel('POST', `/commercial/receptions/${c2.data.id}/validation`, 'ges', {})).status, 200);
  const m2 = await sql("SELECT cout_frais::float FROM com_stock_mouvements WHERE type = 'reception' AND article_id = $1 ORDER BY id", [R.eau]);
  assert.ok(m2.every((x) => proche(x.cout_frais, 63.964)));
  // Coût réel par article (exemple du cahier des charges : 10 000 + 1 500 = 11 500).
  const fd = await appel('POST', '/commercial/frais', 'gas', { bc_id: R.bf3.id, rubrique: 'douane', fournisseur_nom: 'Transitaire du port', montant_ht: 15000, methode: 'manuel',
    manuel: [{ bc_ligne_id: ligne(R.bf3, R.riz).id, montant: 15000 }] });
  assert.equal(fd.status, 201, fd.message);
  assert.equal((await appel('POST', `/commercial/frais/${fd.data.id}/validation`, 'cpt')).status, 200);
  const couts = (await appel('GET', `/commercial/bons-commande/${R.bf3.id}/couts`, 'cpt')).data;
  const riz = couts.lignes[0];
  assert.deepEqual([riz.prix_net, riz.frais_unitaire, riz.cout_reel_unitaire], [10000, 1500, 11500]);
  const ce = (await appel('GET', `/commercial/bons-commande/${R.bf1.id}/couts`, 'resp')).data;
  assert.ok(proche(ce.lignes.find((l) => l.designation.startsWith('Eau')).cout_reel_unitaire, 4317.568, 0.001));
  assert.equal(ce.total_frais, 6000);
  // Annulation motivée : le coût revient au prix d'achat.
  assert.equal((await appel('POST', `/commercial/frais/${f.data.id}/annulation`, 'cpt', { motif: 'Facture du transporteur refusée' })).status, 200);
  const m3 = await sql("SELECT cout_frais::float, cout_unitaire::float FROM com_stock_mouvements WHERE type = 'reception' AND article_id = $1 ORDER BY id", [R.eau]);
  assert.ok(m3.every((x) => x.cout_frais === 0 && proche(x.cout_unitaire, 295.833333, 0.001)));
  assert.equal((await appel('POST', `/commercial/frais/${f.data.id}/validation`, 'cpt')).status, 409);
  // On rétablit un transport validé pour la suite.
  const f2 = await appel('POST', '/commercial/frais', 'gas', { bc_id: R.bf1.id, rubrique: 'transport', fournisseur_id: R.transp, montant_ht: 6000, methode: 'quantite' });
  assert.equal((await appel('POST', `/commercial/frais/${f2.data.id}/validation`, 'cpt')).status, 200);
  R.ventilation = f2.data.repartition;
});

test('12. Facture fournisseur saisie par le comptable, contrôlée par rapport au bon et à la réception', async () => {
  const lignes = (await appel('GET', `/commercial/factures-fournisseurs/a-facturer/${R.f1}`, 'cpt')).data;
  assert.equal(lignes.length, 3);
  for (const qui of ['resp', 'gas']) {
    assert.equal((await appel('POST', '/commercial/factures-fournisseurs', qui, { fournisseur_id: R.f1, reference_fournisseur: 'X', date_facture: '2026-11-10', lignes: [] })).status, 403, qui);
  }
  const f = await appel('POST', '/commercial/factures-fournisseurs', 'cpt', { fournisseur_id: R.f1, reference_fournisseur: 'FS-2026-0091', date_facture: '2026-11-10',
    lignes: lignes.map((l) => ({ reception_ligne_id: l.id, quantite: l.reste, prix_unitaire: l.prix_unitaire })) });
  assert.equal(f.status, 201, f.message);
  assert.equal(f.data.total_ht, 27750, '5 × 3 550 + 20 × 500');
  assert.ok(f.data.rapprochement.every((x) => !x.alerte_prix && !x.alerte_quantite));
  assert.equal((await appel('POST', `/commercial/factures-fournisseurs/${f.data.id}/pieces`, 'cpt', { nom_fichier: 'facture.pdf', data_base64: PDF })).status, 201, 'scan joint');
  assert.equal((await appel('POST', `/commercial/factures-fournisseurs/${f.data.id}/soumission`, 'cpt', {})).status, 200);
  assert.equal((await appel('POST', `/commercial/factures-fournisseurs/${f.data.id}/validation`, 'resp', {})).status, 403, 'pas le responsable des achats');
  const v = await appel('POST', `/commercial/factures-fournisseurs/${f.data.id}/validation`, 'cpt2', {});
  assert.equal(v.status, 200, v.message);
  assert.equal(v.data.statut, 'valide');
  // Le comptable consulte les bons validés et les réceptions.
  assert.equal((await appel('GET', '/commercial/bons-commande?statut=emis', 'cpt')).status, 200);
  assert.equal((await appel('GET', '/commercial/receptions', 'cpt')).status, 200);
});

test('13. Stocks : quantités réellement reçues et valorisation au coût réel', async () => {
  const [s] = await sql('SELECT quantite::float, valeur::float, cmup::float FROM com_stock_soldes WHERE article_id = $1 AND magasin_id = $2', [R.eau, R.cen]);
  // 30 initiales + 60 reçues (5 cartons), au coût réel : 295,833 + 6 000 × 60/(60+20) / 60 = 295,833 + 75 = 370,833.
  assert.equal(s.quantite, 90);
  assert.ok(proche(s.valeur, 30 * 250 + 60 * 370.833333, 0.05), `valeur ${s.valeur}`);
  const [c] = await sql('SELECT quantite::float FROM com_stock_soldes WHERE article_id = $1', [R.cahier]);
  assert.equal(c.quantite, 20);
  const [{ n }] = await sql("SELECT COUNT(*)::int AS n FROM com_stock_mouvements WHERE article_id = $1 AND type = 'reception'", [R.riz]);
  assert.equal(n, 0, 'le riz commandé mais non reçu n\'est pas en stock');
  const d = (await appel('GET', `/commercial/demandes/${R.d.id}`, 'resp')).data;
  assert.equal(ligne(d, R.eau).suivi.recue, 5);
  assert.equal(d.etat_appro, 'partielle', 'le riz reste à recevoir');
  const b = (await appel('GET', `/commercial/bons-commande/${R.bf1.id}`, 'resp')).data;
  assert.equal(b.suivi, 'livre');
});

test('14. Droits et cloisonnement', async () => {
  assert.equal((await appel('GET', '/commercial/consultations', 'dem')).status, 403, 'le demandeur ne voit pas les consultations');
  assert.equal((await appel('GET', `/commercial/consultations/${R.c.id}`, 'mag')).status, 403);
  assert.equal((await appel('GET', '/commercial/frais', 'dem')).status, 403);
  assert.equal((await appel('GET', `/commercial/consultations/${R.c.id}`, 'dirB')).status, 404, 'autre client');
  assert.equal((await appel('GET', `/commercial/frais?bc_id=${R.bf1.id}`, 'dirB')).data.length, 0);
  // Moins de trois fournisseurs sans la permission de dérogation : refusé même avec un motif.
  await sql("INSERT INTO user_permissions (user_id, permission_code, effet) VALUES ($1, 'com.consultations.gerer', 'grant')", [U.gas.id]);
  const d = (await appel('POST', '/commercial/demandes', 'dem', { magasin_id: R.cen, motif: 'Complément', lignes: [{ article_id: R.cahier, quantite: 5 }] })).data;
  await appel('POST', `/commercial/demandes/${d.id}/soumission`, 'dem', {});
  assert.equal((await appel('POST', `/commercial/demandes/${d.id}/decision`, 'resp', { decision: 'approuver' })).status, 200);
  const c = await appel('POST', '/commercial/consultations', 'gas', { demande_id: d.id, date_limite: '2099-12-31', fournisseur_ids: [R.f1], derogation_motif: 'Fournisseur unique sur ce produit' });
  assert.equal(c.status, 201, c.message);
  assert.equal((await appel('POST', `/commercial/consultations/${c.data.id}/lancement`, 'gas', { envoyer_emails: false })).status, 409, 'dérogation réservée');
  const l = await appel('POST', `/commercial/consultations/${c.data.id}/lancement`, 'resp', { envoyer_emails: false });
  assert.equal(l.status, 200, 'dérogation motivée par qui en a le droit');
  assert.equal((await appel('POST', '/commercial/consultations', 'resp', { demande_id: d.id, date_limite: '2099-12-31', fournisseur_ids: [R.f1, R.f2, R.f3] })).status, 409, 'une consultation en cours par demande');
  // Annulée : le lien ne permet plus de répondre.
  assert.equal((await appel('POST', `/commercial/consultations/${c.data.id}/annulation`, 'resp', { motif: 'Besoin couvert autrement' })).status, 200);
  const j = jeton(l.data.fournisseurs[0]);
  const vue = await appel('GET', `/offres-fournisseurs/${j}`);
  assert.equal(vue.data.ouverte, false);
  assert.equal((await appel('POST', `/offres-fournisseurs/${j}/refus`, null, { motif: 'x' })).status, 409);
  // Consultation attribuée : liens fermés.
  assert.equal((await appel('GET', `/offres-fournisseurs/${R.j[R.f2]}`)).data.ouverte, false);
});
