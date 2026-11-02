// tests/commercial-demandes.test.js — NJ COMMERCIAL, livraison B (migration 051).
//
//  Demandes d'achat : numérotation, stock constaté, fournisseurs proposés, visibilité ;
//  circuit : une ou deux étapes selon le seuil, valideur achats + direction, renvoi,
//  rejet, annulation, pas d'auto-validation, décisions inaltérables ; notifications ;
//  pièces jointes contrôlées ; isolation entre clients ; aucun effet sur le stock.
//
//   TEST_DATABASE_URL=postgres://…/base_de_test  node --test tests/commercial-demandes.test.js
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
const PORT = 8900 + Math.floor(Math.random() * 300);
const sfx = crypto.randomBytes(3).toString('hex');
const pool = new Pool({ connectionString: DB });
const U = {};
const R = {};
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
  const brut = r.headers.get('content-type')?.includes('json') ? await r.json().catch(() => ({})) : {};
  return { status: r.status, data: brut.data ?? brut, message: brut.message || brut.error || brut.data?.error, headers: r.headers };
};
const creerUtilisateur = async (cle, role, tenant, profil = null) => {
  const username = `${cle}-${sfx}`;
  const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif, custom_role_id)
                          VALUES ($1, $2, $3, $4, $5, true, (SELECT id FROM roles WHERE tenant_id = $1 AND code = $6)) RETURNING id`,
  [tenant, username, `${username}@test.cm`, await bcrypt.hash('x', 4), role, profil]);
  U[cle] = { id: u.id, username, token: jwt.sign({ sub: u.id, username, role, tenantId: tenant }, SECRET, { expiresIn: '1h' }) };
};
const notifs = async (cle, id) => (await sql("SELECT titre FROM notifications WHERE destinataire_id = $1 AND ref_type = 'com_demande' AND ref_id = $2",
  [U[cle].id, String(id)])).map((r) => r.titre);
const nouvelle = async (qui, lignes, extra = {}) => {
  const r = await appel('POST', '/commercial/demandes', qui, { magasin_id: R.mag, service: 'Administration', motif: 'Réassort des fournitures', lignes, ...extra });
  assert.equal(r.status, 201, r.message);
  return r.data;
};
const soumettre = (qui, id, corps = {}) => appel('POST', `/commercial/demandes/${id}/soumission`, qui, corps);
const decider = (qui, id, decision, commentaire = '') => appel('POST', `/commercial/demandes/${id}/decision`, qui, { decision, commentaire });

before(async () => {
  [{ id: A }] = await sql('INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id', [`daa-${sfx}`, `Achats A ${sfx}`]);
  [{ id: B }] = await sql('INSERT INTO tenants (slug, nom, initialise_le) VALUES ($1, $2, NOW()) RETURNING id', [`dab-${sfx}`, `Achats B ${sfx}`]);
  await creerUtilisateur('adm', 'super_admin', null);
  serveur = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: DB, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test', SMTP_HOST: '',
      RATE_LIMIT_MAX: '100000', MODULES_CONTROLE: 'appliquer', APP_URL: 'https://app.test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = (d) => process.env.DEBUG_TEST && process.stderr.write(d);
  serveur.stdout.on('data', log); serveur.stderr.on('data', log);
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) break; } catch { /* démarrage */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  for (const t of [A, B]) assert.equal((await appel('PUT', `/plateforme/clients/${t}/modules/commercial`, 'adm', { actif: true, motif: 'Tests achats' })).status, 200);
  await creerUtilisateur('dir', 'directeur', A);
  await creerUtilisateur('resp', 'collaborateur', A, 'achats_responsable');
  await creerUtilisateur('gas', 'collaborateur', A, 'achats_gestionnaire');
  await creerUtilisateur('dem', 'collaborateur', A);
  await creerUtilisateur('dem2', 'collaborateur', A);
  await creerUtilisateur('dirB', 'directeur', B);
  // Référentiels de A.
  R.mag = (await appel('POST', '/commercial/magasins', 'dir', { code: 'MAG', nom: 'Central' })).data.id;
  R.mag2 = (await appel('POST', '/commercial/magasins', 'dir', { code: 'ANX', nom: 'Annexe' })).data.id;
  R.fou = (await appel('POST', '/commercial/tiers', 'dir', { type: 'fournisseur', nom: 'Bureau Plus' })).data.id;
  R.fou2 = (await appel('POST', '/commercial/tiers', 'dir', { type: 'fournisseur', nom: 'Info Services' })).data.id;
  R.fam = (await appel('POST', '/commercial/familles', 'dir', { code: 'FB', nom: 'Fournitures', fournisseur_ids: [R.fou] })).data.id;
  R.rame = (await appel('POST', '/commercial/articles', 'dir', { reference: 'RAME', designation: 'Rame A4', famille_id: R.fam, unite: 'rame', prix_achat_indicatif: 3500, suivi_comptable: true })).data.id;
  R.pc = (await appel('POST', '/commercial/articles', 'dir', { reference: 'PC', designation: 'Ordinateur portable', famille_id: R.fam, prix_achat_indicatif: 450000, suivi_comptable: true, fournisseur_ids: [R.fou2] })).data.id;
  R.stylo = (await appel('POST', '/commercial/articles', 'dir', { reference: 'STYLO', designation: 'Stylo', famille_id: R.fam, suivi_comptable: false })).data.id;
  await appel('PUT', '/commercial/stock/initial', 'dir', { article_id: R.rame, magasin_id: R.mag, quantite: 100, date_mouvement: '2026-10-01' });
  // Référentiels de B.
  const magB = (await appel('POST', '/commercial/magasins', 'dirB', { code: 'MAG', nom: 'B' })).data.id;
  const famB = (await appel('POST', '/commercial/familles', 'dirB', { code: 'FB', nom: 'B' })).data.id;
  R.articleB = (await appel('POST', '/commercial/articles', 'dirB', { reference: 'X', designation: 'X', famille_id: famB, suivi_comptable: true })).data.id;
  R.magB = magB;
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

test('Brouillon : numéro automatique, stock constaté, fournisseurs proposés', async () => {
  const d = await nouvelle('dem', [{ article_id: R.rame, quantite: 120 }, { article_id: R.stylo, quantite: 10 }]);
  assert.match(d.numero, new RegExp(`^DA-${new Date().getFullYear()}-0001$`));
  assert.equal(d.statut, 'brouillon');
  const rame = d.lignes.find((l) => l.article_id === R.rame);
  assert.deepEqual([rame.stock_actuel.suivi, rame.stock_actuel.disponible, rame.stock_actuel.a_approvisionner], [true, 100, 20]);
  assert.deepEqual(rame.fournisseurs_proposes.map((f) => f.id), [R.fou], 'fournisseur de la famille');
  const stylo = d.lignes.find((l) => l.article_id === R.stylo);
  assert.equal(stylo.stock_actuel.suivi, false, 'pas de stock inventé');
  assert.equal(stylo.stock_actuel.disponible, null);
  const d2 = await nouvelle('dem', [{ article_id: R.pc, quantite: 1 }]);
  assert.match(d2.numero, /-0002$/);
  const pc = d2.lignes[0];
  assert.deepEqual(pc.fournisseurs_proposes.map((f) => f.id).sort(), [R.fou, R.fou2].sort(), 'famille + fournisseur propre à l\'article');
  R.d1 = d.id; R.d2 = d2.id;
});

test('Contrôles de saisie et de soumission', async () => {
  assert.equal((await appel('POST', '/commercial/demandes', 'dem', { magasin_id: R.mag, motif: 'x', lignes: [{ article_id: R.rame, quantite: 1 }, { article_id: R.rame, quantite: 2 }] })).status, 400, 'article en double');
  assert.equal((await appel('POST', '/commercial/demandes', 'dem', { magasin_id: R.mag, motif: 'x', lignes: [{ article_id: R.rame, quantite: 0 }] })).status, 400, 'quantité nulle');
  assert.equal((await appel('POST', '/commercial/demandes', 'dem', { magasin_id: R.mag, motif: 'x', lignes: [{ article_id: R.articleB, quantite: 1 }] })).status, 400, 'article d\'un autre client');
  assert.equal((await appel('POST', '/commercial/demandes', 'dem', { magasin_id: R.magB, motif: 'x', lignes: [] })).status, 400, 'magasin d\'un autre client');
  const vide = await nouvelle('dem', [], { motif: '' });
  const r = await soumettre('dem', vide.id);
  assert.equal(r.status, 400);
  assert.match(r.message, /motif.*article/);
  assert.equal((await appel('DELETE', `/commercial/demandes/${vide.id}`, 'dem')).status, 200, 'brouillon jamais soumis supprimable');
  assert.equal((await appel('POST', '/commercial/demandes', 'gas', { magasin_id: R.mag, motif: 'x', lignes: [] })).status, 201, 'le GAS peut aussi demander');
});

test('Visibilité : ses demandes, tout pour qui a le droit, rien pour un autre demandeur', async () => {
  assert.equal((await appel('GET', `/commercial/demandes/${R.d1}`, 'dem2')).status, 404);
  assert.equal((await appel('GET', '/commercial/demandes', 'dem2')).data.filter((d) => d.id === R.d1).length, 0);
  assert.equal((await appel('GET', `/commercial/demandes/${R.d1}`, 'gas')).status, 200);
  assert.equal((await appel('GET', `/commercial/demandes/${R.d1}`, 'dirB')).status, 404, 'autre client');
  assert.equal((await appel('PUT', `/commercial/demandes/${R.d1}`, 'gas', { motif: 'piraté' })).status, 409, 'seul l\'auteur modifie');
});

test('Circuit à une étape : soumission, notification, approbation par les achats', async () => {
  const stockAvant = await sql('SELECT COUNT(*)::int AS n, SUM(quantite) AS q FROM com_stock_mouvements WHERE tenant_id = $1', [A]);
  let r = await soumettre('dem', R.d1);
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.statut, 'examen_achats');
  assert.equal(r.data.montant_estime, 420000, '120 × 3 500 ; stylo sans prix');
  assert.equal(r.data.montant_incomplet, true);
  assert.equal(r.data.direction_requise, false, 'sous le seuil de 500 000');
  const [ligne] = await sql('SELECT stock_constate FROM com_demande_lignes WHERE demande_id = $1 AND article_id = $2', [R.d1, R.rame]);
  assert.equal(ligne.stock_constate.a_approvisionner, 20, 'stock figé à la soumission');
  assert.ok((await notifs('resp', R.d1)).some((t) => /à examiner/.test(t)), 'responsable des achats notifié');
  assert.ok((await notifs('dir', R.d1)).length > 0, 'le directeur a aussi le droit achats');
  assert.equal((await notifs('dem', R.d1)).length, 0, 'jamais l\'auteur');
  assert.equal((await appel('PUT', `/commercial/demandes/${R.d1}`, 'dem', { motif: 'changé' })).status, 409, 'figée pendant l\'examen');
  assert.equal((await decider('gas', R.d1, 'approuver')).status, 403, 'le GAS n\'approuve pas');
  r = await decider('resp', R.d1, 'approuver');
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.statut, 'approuvee');
  assert.ok((await notifs('gas', R.d1)).some((t) => /approuvée/.test(t)), 'GAS prévenu pour le bon de commande');
  assert.ok((await notifs('dem', R.d1)).some((t) => /approuvée/.test(t)), 'demandeur prévenu');
  assert.deepEqual(r.data.decisions.map((x) => x.decision), ['soumise', 'approuvee']);
  assert.equal(r.data.decisions[1].par_nom, U.resp.username);
  const stockApres = await sql('SELECT COUNT(*)::int AS n, SUM(quantite) AS q FROM com_stock_mouvements WHERE tenant_id = $1', [A]);
  assert.deepEqual(stockApres, stockAvant, 'la demande ne touche pas au stock');
});

test('Deux étapes au-delà du seuil (achats puis direction)', async () => {
  const d = await nouvelle('dem', [{ article_id: R.pc, quantite: 2 }]);
  let r = await soumettre('dem', d.id);
  assert.equal(r.data.montant_estime, 900000);
  assert.equal(r.data.direction_requise, true);
  r = await decider('resp', d.id, 'approuver', 'Besoin justifié');
  assert.equal(r.data.statut, 'examen_direction');
  assert.ok((await notifs('dir', d.id)).some((t) => /direction/.test(t)));
  assert.equal((await decider('resp', d.id, 'approuver')).status, 403, 'le responsable n\'a pas le droit direction');
  r = await decider('dir', d.id, 'approuver');
  assert.equal(r.data.statut, 'approuvee');
  assert.deepEqual(r.data.decisions.map((x) => x.etape), ['demandeur', 'achats', 'direction']);
  // Le directeur a les deux droits : une seule décision suffit.
  const d3 = await nouvelle('dem', [{ article_id: R.pc, quantite: 3 }]);
  await soumettre('dem', d3.id);
  r = await decider('dir', d3.id, 'approuver');
  assert.equal(r.data.statut, 'approuvee');
  assert.equal(r.data.decisions.at(-1).etape, 'achats_direction');
});

test('Pas d\'auto-validation, même avec le droit', async () => {
  const d = await nouvelle('resp', [{ article_id: R.rame, quantite: 5 }]);
  await soumettre('resp', d.id);
  const lu = await appel('GET', `/commercial/demandes/${d.id}`, 'resp');
  assert.equal(lu.data.droits.decider, false);
  assert.equal(lu.data.droits.auto_validation_interdite, true);
  const r = await decider('resp', d.id, 'approuver');
  assert.equal(r.status, 403);
  assert.match(r.message, /propre demande/);
  assert.equal((await decider('dir', d.id, 'approuver')).data.statut, 'approuvee', 'un autre valideur peut');
});

test('Renvoi pour correction puis resoumission ; rejet définitif', async () => {
  const d = await nouvelle('dem', [{ article_id: R.rame, quantite: 30 }]);
  await soumettre('dem', d.id);
  assert.equal((await decider('resp', d.id, 'renvoyer')).status, 400, 'motif obligatoire');
  let r = await decider('resp', d.id, 'renvoyer', 'Précisez le service bénéficiaire');
  assert.equal(r.data.statut, 'a_corriger');
  assert.ok((await notifs('dem', d.id)).some((t) => /correction/.test(t)));
  r = await appel('PUT', `/commercial/demandes/${d.id}`, 'dem', { service: 'Comptabilité', lignes: [{ article_id: R.rame, quantite: 25 }] });
  assert.equal(r.status, 200, r.message);
  r = await soumettre('dem', d.id);
  assert.equal(r.data.statut, 'examen_achats');
  assert.equal(r.data.nb_soumissions, 2);
  assert.ok(r.data.historique.some((h) => h.action === 'COM_DA_MODIFICATION'), 'modification tracée');
  assert.equal((await decider('resp', d.id, 'rejeter')).status, 400, 'motif du rejet obligatoire');
  r = await decider('resp', d.id, 'rejeter', 'Stock suffisant au magasin');
  assert.equal(r.data.statut, 'rejetee');
  assert.equal((await soumettre('dem', d.id)).status, 409, 'une demande rejetée est close');
  assert.equal((await appel('PUT', `/commercial/demandes/${d.id}`, 'dem', { motif: 'encore' })).status, 409);
  assert.equal((await decider('dir', d.id, 'approuver')).status, 409);
  assert.deepEqual(r.data.decisions.map((x) => x.decision), ['soumise', 'renvoyee', 'soumise', 'rejetee']);
});

test('Blocage configurable quand le stock couvre déjà le besoin', async () => {
  await appel('PUT', '/commercial/societe', 'dir', { bloquer_si_stock_suffisant: true });
  const d = await nouvelle('dem', [{ article_id: R.rame, quantite: 10 }]);
  let r = await soumettre('dem', d.id);
  assert.equal(r.status, 409);
  assert.match(r.message, /Rame A4/);
  r = await soumettre('dem', d.id, { justification_stock: 'Constitution d\'une réserve pour la clôture' });
  assert.equal(r.status, 200, r.message);
  assert.deepEqual(r.data.stock_couvert, ['Rame A4']);
  await appel('PUT', '/commercial/societe', 'dir', { bloquer_si_stock_suffisant: false });
});

test('Annulation : auteur pendant l\'examen, valideur après approbation, jamais un tiers', async () => {
  const d = await nouvelle('dem', [{ article_id: R.rame, quantite: 3 }]);
  await soumettre('dem', d.id);
  assert.equal((await appel('POST', `/commercial/demandes/${d.id}/annulation`, 'dem2', { motif: 'test' })).status, 404);
  assert.equal((await appel('POST', `/commercial/demandes/${d.id}/annulation`, 'dem', {})).status, 400, 'motif obligatoire');
  let r = await appel('POST', `/commercial/demandes/${d.id}/annulation`, 'dem', { motif: 'Besoin couvert autrement' });
  assert.equal(r.data.statut, 'annulee');
  r = await appel('POST', `/commercial/demandes/${R.d1}/annulation`, 'dem', { motif: 'Je change d\'avis' });
  assert.equal(r.status, 409, 'approuvée : l\'auteur ne peut plus annuler');
  r = await appel('POST', `/commercial/demandes/${R.d1}/annulation`, 'resp', { motif: 'Fournisseur indisponible' });
  assert.equal(r.data.statut, 'annulee');
  assert.ok((await notifs('dem', R.d1)).some((t) => /annulée/.test(t)));
});

test('Historique inaltérable, demande soumise impossible à supprimer', async () => {
  await assert.rejects(sql("UPDATE com_decisions SET commentaire = 'falsifié' WHERE demande_id = $1", [R.d1]), /INTANGIBLE/);
  await assert.rejects(sql('DELETE FROM com_decisions WHERE demande_id = $1', [R.d1]), /INTANGIBLE/);
  await assert.rejects(sql('DELETE FROM com_demandes WHERE id = $1', [R.d1]), /INTANGIBLE/);
  assert.equal((await appel('DELETE', `/commercial/demandes/${R.d1}`, 'dem')).status, 409);
});

test('Pièces justificatives : type réel contrôlé, téléchargement, retrait tracé', async () => {
  const d = await nouvelle('dem', [{ article_id: R.rame, quantite: 4 }]);
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
  let r = await appel('POST', `/commercial/demandes/${d.id}/pieces`, 'dem', { nom_fichier: 'devis.pdf', data_base64: pdf });
  assert.equal(r.status, 201, r.message);
  const piece = r.data.documents[0];
  assert.equal(piece.mime, 'application/pdf');
  assert.equal(piece.sha256.length, 64);
  r = await appel('POST', `/commercial/demandes/${d.id}/pieces`, 'dem', { nom_fichier: 'virus.pdf', data_base64: Buffer.from('MZ\x90\x00 exécutable').toString('base64') });
  assert.equal(r.status, 400, 'faux PDF refusé');
  const dl = await fetch(`http://127.0.0.1:${PORT}/api/commercial/demandes/${d.id}/pieces/${piece.id}`, { headers: { Authorization: `Bearer ${U.dem.token}` } });
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('x-piece-sha256'), piece.sha256);
  const dl2 = await fetch(`http://127.0.0.1:${PORT}/api/commercial/demandes/${d.id}/pieces/${piece.id}`, { headers: { Authorization: `Bearer ${U.dem2.token}` } });
  assert.equal(dl2.status, 404, 'pas pour un autre demandeur');
  assert.equal((await appel('POST', `/commercial/demandes/${d.id}/pieces/${piece.id}/retrait`, 'gas', { motif: 'erreur' })).status, 403);
  r = await appel('POST', `/commercial/demandes/${d.id}/pieces/${piece.id}/retrait`, 'dem', { motif: 'Mauvais devis' });
  assert.equal(r.data.documents[0].retire, true);
  assert.ok(r.data.historique.some((h) => h.action === 'COM_DA_PIECE_RETRAIT'));
});

test('File d\'examen et compteurs', async () => {
  const d = await nouvelle('dem2', [{ article_id: R.rame, quantite: 2 }]);
  await soumettre('dem2', d.id);
  const file = (await appel('GET', '/commercial/demandes?vue=a_examiner', 'resp')).data;
  assert.ok(file.some((x) => x.id === d.id));
  assert.ok(file.every((x) => x.statut === 'examen_achats'));
  assert.equal((await appel('GET', '/commercial/demandes?vue=a_examiner', 'dem')).data.length, 0);
  const c = (await appel('GET', '/commercial/demandes/compteurs', 'resp')).data;
  assert.ok(c.a_examiner >= 1);
  assert.equal((await appel('GET', '/commercial/demandes?q=rame&statut=annulee', 'dem')).data.length, 2);
});

test('Client avec des demandes : suppression du client impossible', async () => {
  await sql('UPDATE tenants SET actif = false WHERE id = $1', [A]);
  const r = await appel('GET', `/plateforme/clients/${A}/suppression`, 'adm');
  assert.match(r.data.raisons.join(' '), /demande\(s\) d'achat/);
});
