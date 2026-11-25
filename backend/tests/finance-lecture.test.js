// tests/finance-lecture.test.js — NJ FINANCE lot F7 : lecture automatique des factures fournisseurs (082).
//
// Lance le VRAI serveur (index.js) sur une base de TEST, puis appelle l'API.
//   TEST_DATABASE_URL=postgres://…/base_de_test  node --test tests/finance-lecture.test.js
// La base doit être migrée jusqu'à 082. Pièces fictives : tests/fixtures/facture-fictive.*
// (PDF numérique généré ici, photo JPEG, PDF scanné).
//
// Couvre : analyse pure (montants, NIU, dates, lignes) ; dépôt refusé (format,
// signature) ; PDF numérique, photo et PDF scanné lus, fournisseur reconnu par son
// NIU (le NIU du client lui-même est écarté) ; pièce déposée deux fois rendue telle
// quelle ; facture créée depuis la lecture → lecture « utilisée », pièce visible
// sur la facture, nouveau dépôt de la même pièce refusé ; brouillon supprimé →
// pièce de nouveau « à vérifier » ; abandon ; droits ; isolement des clients.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const PDFDocument = require('pdfkit');
const { analyser, montantsDe, niusDe, datesDe } = require('../src/services/finance/lecture/analyse_facture');

const DB = process.env.TEST_DATABASE_URL;
if (!DB) {
  console.error('TEST_DATABASE_URL absent : test ignoré (ne jamais viser la base de production).');
  process.exit(0);
}
const SECRET = 'test-secret-' + crypto.randomBytes(16).toString('hex');
const PORT = 7800 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}/api`;
const sfx = crypto.randomBytes(3).toString('hex');
const pool = new Pool({ connectionString: DB });
const STOCKAGE = fs.mkdtempSync(path.join(os.tmpdir(), 'nj-lecture-'));
const FIX = path.join(__dirname, 'fixtures');
let serveur;
const C = { a: { u: {} }, b: { u: {} } };
const F = {};

const sql = async (texte, params = []) => (await pool.query(texte, params)).rows;
const appel = async (methode, url, client, qui, corps) => {
  const r = await fetch(BASE + url, {
    method: methode,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${C[client].u[qui].token}` },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.data ?? j, message: j.message ?? j.error };
};
const deposer = (client, qui, buf, nom) => appel('POST', '/finance/achats/extractions', client, qui,
  { nom_fichier: nom, data_base64: buf.toString('base64') });
const attendreLecture = async (client, id) => {
  for (let i = 0; i < 240; i += 1) {
    const r = await appel('GET', `/finance/achats/extractions/${id}`, client, 'cai');
    if (r.data.statut !== 'en_cours') return r.data;
    await new Promise((ok) => setTimeout(ok, 250));
  }
  throw new Error('lecture trop longue');
};
let pdfEnCache = null;
const pdfNumerique = () => pdfEnCache || (pdfEnCache = new Promise((ok) => {
  const doc = new PDFDocument({ size: 'A4', margin: 50 }); const morceaux = [];
  doc.on('data', (d) => morceaux.push(d)); doc.on('end', () => ok(Buffer.concat(morceaux)));
  doc.font('Helvetica-Bold').fontSize(16).text('PAPETERIE CENTRALE SARL');
  doc.font('Helvetica').fontSize(10).text('BP 1234 Yaoundé — NIU : M012345678901A');
  doc.moveDown().font('Helvetica-Bold').fontSize(14).text('FACTURE N° PC-7781', { align: 'right' });
  doc.font('Helvetica').fontSize(10).text('Date : 05/03/2026', { align: 'right' }).text('Échéance : 04/04/2026', { align: 'right' });
  doc.moveDown().text(`Client : LECTURE A\nNIU client : ${F.niuA}`);
  doc.moveDown().text('Désignation   Qté   P.U.   Montant');
  doc.text('Classeurs à levier 50 1 300 65 000');
  doc.text('Stylos bille bleus 100 150 15 000');
  doc.moveDown().text('Total HT : 80 000 FCFA').text('TVA 19,25 % : 15 400 FCFA').text('Total TTC : 95 400 FCFA');
  doc.end();
}));

const creerClient = async (cle, nui) => {
  const c = C[cle];
  [{ id: c.tenant }] = await sql(`INSERT INTO tenants (slug, nom, forme_juridique, initialise_le, nui) VALUES ($1, $2, 'SARL', NOW(), $3) RETURNING id`,
    [`lec-${cle}-${sfx}`, `LECTURE ${cle} ${sfx}`, nui]);
  await sql('INSERT INTO tenant_modules (tenant_id, module_code, actif) VALUES ($1, \'caisse\', true) ON CONFLICT DO NOTHING', [c.tenant]);
  for (const [qui, role] of [['dir', 'directeur'], ['cpt', 'auditeur'], ['cai', 'caissier'], ['col', 'collaborateur']]) {
    const username = `${qui}-lec-${cle}-${sfx}`;
    const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif) VALUES ($1, $2, $3, 'x', $4, true) RETURNING id`,
      [c.tenant, username, `${username}@test.cm`, role]);
    await sql('INSERT INTO user_modules (user_id, module_code, tenant_id) VALUES ($1, \'caisse\', $2) ON CONFLICT DO NOTHING', [u.id, c.tenant]);
    c.u[qui] = { id: u.id, token: jwt.sign({ sub: u.id, username, role, tenantId: c.tenant }, SECRET, { expiresIn: '1h' }) };
  }
};

before(async () => {
  F.niuA = `P${String(Date.now()).slice(-12)}Z`;
  await creerClient('a', F.niuA);
  await creerClient('b', '');
  [{ id: F.fourn }] = await sql(`INSERT INTO registre_tiers (tenant_id, type, nom, nui) VALUES ($1, 'fournisseur', 'Papeterie Centrale', 'M012345678901A') RETURNING id::text`, [C.a.tenant]);
  serveur = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: DB, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test', SMTP_HOST: '', RATE_LIMIT_MAX: '100000',
      MODULES_CONTROLE: 'appliquer', STORAGE_DIR: STOCKAGE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = (d) => process.env.DEBUG_TEST && process.stderr.write(d);
  serveur.stdout.on('data', log); serveur.stderr.on('data', log);
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* démarrage */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const init = await appel('POST', '/finance/config/initialiser', 'a', 'cpt');
  assert.equal(init.status, 200, init.message);
  const ref = await appel('GET', '/finance/achats/referentiels', 'a', 'cai');
  F.cat = Object.fromEntries(ref.data.categories.map((c) => [c.code, c.id]));
  F.tva = ref.data.taxes.find((t) => t.code === 'TVA').id;
});
after(async () => {
  serveur?.kill();
  const cx = await pool.connect();
  try {
    await cx.query('BEGIN');
    await cx.query("SET LOCAL app.finance_maintenance = 'on'");
    const ids = [C.a.tenant, C.b.tenant].filter(Boolean);
    await cx.query('DELETE FROM fin_extractions WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM fin_ecritures WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM fin_factures WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM audit_log WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM user_modules WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM tenant_modules WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [ids]);
    await cx.query('COMMIT');
  } catch (e) {
    await cx.query('ROLLBACK');
    console.error('Nettoyage de la base de test incomplet :', e.message);
  } finally {
    cx.release();
  }
  await pool.end();
  fs.rmSync(STOCKAGE, { recursive: true, force: true });
});

test('Analyse : montants, pourcentages écartés, NIU (O lu pour 0), dates, lignes découpées', () => {
  assert.deepEqual(montantsDe('TVA 19,25 % : 35 035 FCFA'), [35035]);
  assert.deepEqual(montantsDe('Total : 1.234.567,50'), [1234567.5]);
  assert.deepEqual(niusDe('NIU : M O12345678901 A et P098765432109Z'), ['M012345678901A', 'P098765432109Z']);
  assert.deepEqual(datesDe('Fait le 3 mars 2026, échéance 02/04/2026').map((d) => d.iso), ['2026-03-03', '2026-04-02']);
  const r = analyser('ETS KAMGA\nFacture N° 45/2026\nDate : 31/02/2026\nDate : 01/03/2026\nCiment CPJ 35 10 5 500 55 000\nTotal HT 55 000\nTVA 10 588\nNet à payer 65 588',
    { tiers: [{ id: 9, nom: 'Ets Kamga', nui: '' }] });
  assert.equal(r.fournisseur.valeur.id, '9', 'reconnu par son nom');
  assert.equal(r.fournisseur.confiance, 'moyenne');
  assert.equal(r.reference.valeur, '45/2026');
  assert.equal(r.date_facture.valeur, '2026-03-01', 'le 31 février est écarté');
  assert.deepEqual(r.lignes.valeur, [{ designation: 'Ciment CPJ 35', quantite: 10, prix_unitaire: 5500, montant: 55000 }]);
  assert.equal(r.lignes.confiance, 'haute');
  assert.equal(r.taux_tva.valeur, 19.25);
  const faux = analyser('Facture N° 1\nTotal HT 100 000\nTVA 10 000\nTotal TTC 120 000');
  assert.ok(faux.alertes.some((a) => /ne concordent pas/.test(a)));
  assert.equal(faux.total_ttc.confiance, 'moyenne');
});

test('Dépôt : format et signature contrôlés ; droits', async () => {
  let r = await deposer('a', 'cai', Buffer.from('ceci est un texte'), 'facture.pdf');
  assert.equal(r.status, 415);
  r = await appel('POST', '/finance/achats/extractions', 'a', 'cai', { nom_fichier: 'x.pdf', data_base64: '' });
  assert.equal(r.status, 400);
  r = await deposer('a', 'col', fs.readFileSync(path.join(FIX, 'facture-fictive.jpg')), 'photo.jpg');
  assert.equal(r.status, 403, 'le collaborateur ne dépose pas');
});

test('PDF numérique : lu, fournisseur reconnu par son NIU, NIU du client écarté, totaux concordants', async () => {
  const r = await deposer('a', 'cai', await pdfNumerique(), 'PC-7781.pdf');
  assert.equal(r.status, 202, r.message);
  F.e1 = r.data.id;
  const e = await attendreLecture('a', F.e1);
  assert.equal(e.statut, 'a_verifier', e.message);
  assert.equal(e.moteur, 'texte_pdf');
  assert.equal(e.champs.fournisseur.valeur.id, F.fourn);
  assert.equal(e.champs.fournisseur.confiance, 'haute');
  assert.equal(e.champs.reference.valeur, 'PC-7781');
  assert.equal(e.champs.date_facture.valeur, '2026-03-05');
  assert.equal(e.champs.date_echeance.valeur, '2026-04-04');
  assert.deepEqual([e.champs.total_ht.valeur, e.champs.total_tva.valeur, e.champs.total_ttc.valeur], [80000, 15400, 95400]);
  assert.equal(e.champs.lignes.valeur.length, 2);
  assert.equal(e.champs.lignes.confiance, 'haute');
  assert.equal(e.taxe_proposee.id, F.tva);
  // Même pièce redéposée : rendue telle quelle.
  const bis = await deposer('a', 'cpt', await pdfNumerique(), 'copie.pdf');
  assert.equal(bis.data.deja_deposee, true);
  assert.equal(bis.data.id, F.e1);
  // La pièce s'ouvre (authentifiée), jamais chez un autre client.
  const fichier = await fetch(`${BASE}/finance/achats/extractions/${F.e1}/fichier`, { headers: { Authorization: `Bearer ${C.a.u.cai.token}` } });
  assert.equal(fichier.status, 200);
  assert.equal(fichier.headers.get('content-type'), 'application/pdf');
  assert.equal((await appel('GET', `/finance/achats/extractions/${F.e1}`, 'b', 'cai')).status, 404);
  assert.equal((await fetch(`${BASE}/finance/achats/extractions/${F.e1}/fichier`, { headers: { Authorization: `Bearer ${C.b.u.cai.token}` } })).status, 404);
  assert.equal((await appel('GET', '/finance/achats/extractions', 'b', 'cai')).data.lignes.length, 0);
});

test('Photo et PDF scanné : lus par OCR, une pièce à la fois', async () => {
  const photo = await deposer('a', 'cai', fs.readFileSync(path.join(FIX, 'facture-fictive.jpg')), 'photo.jpg');
  const scan = await deposer('a', 'cai', fs.readFileSync(path.join(FIX, 'facture-fictive-scannee.pdf')), 'scan.pdf');
  assert.equal(photo.status, 202, photo.message);
  assert.equal(scan.status, 202, scan.message);
  for (const [id, moteur] of [[photo.data.id, 'ocr_image'], [scan.data.id, 'ocr_pdf']]) {
    const e = await attendreLecture('a', id);
    assert.equal(e.statut, 'a_verifier', e.message);
    assert.equal(e.moteur, moteur);
    assert.ok(Number(e.confiance_ocr) > 70, `confiance ${e.confiance_ocr}`);
    assert.equal(e.champs.fournisseur.valeur.id, F.fourn);
    assert.equal(e.champs.reference.valeur, 'FA-2026-0412');
    assert.equal(e.champs.total_ttc.valeur, 217035);
    assert.equal(e.champs.lignes.valeur.length, 2);
  }
  F.photo = photo.data.id;
  F.scan = scan.data.id;
  const [p, sc] = await sql('SELECT traite_le FROM fin_extractions WHERE id = ANY($1::bigint[]) ORDER BY id', [[photo.data.id, scan.data.id]]);
  assert.ok(p.traite_le <= sc.traite_le, 'lues dans l\'ordre du dépôt, l\'une après l\'autre');
});

test('Facture créée après vérification : lecture utilisée, pièce sur la facture, redépôt refusé ; brouillon supprimé = pièce à revoir', async () => {
  const e = (await appel('GET', `/finance/achats/extractions/${F.e1}`, 'a', 'cai')).data;
  const corps = {
    extraction_id: F.e1, tiers_id: e.champs.fournisseur.valeur.id, reference: e.champs.reference.valeur,
    date_facture: e.champs.date_facture.valeur, date_echeance: e.champs.date_echeance.valeur, categorie_id: F.cat.FOURN,
    lignes: e.champs.lignes.valeur.map((l) => ({ designation: l.designation, quantite: l.quantite, prix_unitaire: l.prix_unitaire, taxe_id: F.tva })),
  };
  const f = await appel('POST', '/finance/achats', 'a', 'cai', corps);
  assert.equal(f.status, 201, f.message);
  const fiche = (await appel('GET', `/finance/achats/fin/${f.data.id}`, 'a', 'cpt')).data;
  assert.equal(Number(fiche.facture.total_ttc), 95400, 'mêmes totaux que la pièce');
  assert.equal(fiche.piece_lue.id, F.e1);
  assert.equal((await appel('GET', `/finance/achats/extractions/${F.e1}`, 'a', 'cai')).data.statut, 'utilisee');
  // La même lecture ne sert pas deux fois ; la même pièce ne se redépose pas.
  const encore = await appel('POST', '/finance/achats', 'a', 'cai', { ...corps, reference: 'AUTRE-1' });
  assert.equal(encore.status, 409);
  const redepot = await deposer('a', 'cai', await pdfNumerique(), 'encore.pdf');
  assert.equal(redepot.status, 409);
  assert.equal(redepot.data.doublon.id, f.data.id);
  // Brouillon supprimé : la pièce redevient à vérifier.
  assert.equal((await appel('DELETE', `/finance/achats/fin/${f.data.id}`, 'a', 'cai')).status, 200);
  const apres = (await appel('GET', `/finance/achats/extractions/${F.e1}`, 'a', 'cai')).data;
  assert.equal(apres.statut, 'a_verifier');
  assert.equal(apres.facture_id, null);
});

test('Abandon : seule une lecture à vérifier ou en échec ; la pièce abandonnée peut être redéposée', async () => {
  assert.equal((await appel('POST', `/finance/achats/extractions/${F.photo}/abandonner`, 'b', 'cai')).status, 409, 'autre client');
  assert.equal((await appel('POST', `/finance/achats/extractions/${F.photo}/abandonner`, 'a', 'cai')).status, 200);
  assert.equal((await appel('POST', `/finance/achats/extractions/${F.photo}/abandonner`, 'a', 'cai')).status, 409);
  const liste = (await appel('GET', '/finance/achats/extractions', 'a', 'cai')).data;
  assert.equal(liste.compte.a_verifier, 2);
  const r = await deposer('a', 'cai', fs.readFileSync(path.join(FIX, 'facture-fictive.jpg')), 'photo.jpg');
  assert.equal(r.status, 202);
  assert.notEqual(r.data.id, F.photo);
  assert.equal((await attendreLecture('a', r.data.id)).statut, 'a_verifier');
});
