// tests/finance-achats.test.js — NJ FINANCE lot F6 : achats (080).
//
// Lance le VRAI serveur (index.js) sur une base de TEST, puis appelle l'API.
//   TEST_DATABASE_URL=postgres://…/base_de_test  node --test tests/finance-achats.test.js
// La base doit être migrée jusqu'à 080.
//
// Couvre : droits (le caissier saisit, ne valide pas) ; facture de charges
// (écriture 6 / 445 / 401 avec tiers) ; immobilisation (2 / 4451 / 481) ;
// doublon refusé (NJ FINANCE et NJ COMMERCIAL) ; personne ne valide sa propre
// facture ; règlement partiel par une sortie de caisse (part réglée au 401, pas
// en charge), plafonds (sortie, reste à payer, bon fournisseur) ; avoir limité à
// la facture ; sortie annulée en caisse = règlement caduc ; annulation avec
// extourne ; facture de NJ COMMERCIAL imputée puis annulée ; isolement des clients.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

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
const AN = new Date().getFullYear();
const MOIS = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
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
  return { status: r.status, data: j.data ?? j, message: j.message ?? j.error, brut: j };
};
const lignesEcriture = async (origineType, origineId) => (await sql(
  `SELECT l.compte, l.debit::numeric AS debit, l.credit::numeric AS credit, l.tiers_id::text AS tiers
     FROM fin_ecriture_lignes l JOIN fin_ecritures e ON e.id = l.ecriture_id
    WHERE e.origine_type = $1 AND e.origine_id = $2 AND e.extournee_par_id IS NULL ORDER BY l.ordre`, [origineType, origineId]))
  .map((l) => `${l.compte} ${Number(l.debit) ? `D${Number(l.debit)}` : `C${Number(l.credit)}`}${l.tiers ? ' T' : ''}`);
const mouvement = async ({ date, sortie, tiers = null, annule = null, rubrique = 'ACH' }) => {
  const [r] = await sql(
    `INSERT INTO journal (tenant_id, date, mois, annee, type_caisse, rubrique_code, intitule, entree, sortie, journal_id, tiers_id, annulation_de_id, created_by)
     VALUES ($1, $2, $3, $4, 'especes', $5, 'Paiement fournisseur', 0, $6, $7, $8, $9, $10) RETURNING id`,
    [C.a.tenant, date, MOIS[Number(date.slice(5, 7)) - 1], Number(date.slice(0, 4)), rubrique, sortie, C.a.caisse, tiers, annule, C.a.u.cai.id]);
  return String(r.id);
};
const facture = (extra = {}) => ({
  tiers_id: F.fourn, reference: 'FA-001', date_facture: `${AN}-03-10`, categorie_id: F.cat.FOURN, objet: 'Fournitures de bureau',
  lignes: [{ designation: 'Ramettes et classeurs', quantite: 2, prix_unitaire: 50000, taxe_id: F.tva }], ...extra,
});

const creerClient = async (cle) => {
  const c = C[cle];
  [{ id: c.tenant }] = await sql(`INSERT INTO tenants (slug, nom, forme_juridique, initialise_le) VALUES ($1, $2, 'SARL', NOW()) RETURNING id`,
    [`ach-${cle}-${sfx}`, `ACHATS ${cle} ${sfx}`]);
  await sql('INSERT INTO tenant_modules (tenant_id, module_code, actif) VALUES ($1, \'caisse\', true) ON CONFLICT DO NOTHING', [c.tenant]);
  [{ id: c.caisse }] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type, date_ouverture, compte_tresorerie)
                                  VALUES ($1, 'CA1', 'Caisse', 'caisse', $2, '5711') RETURNING id`, [c.tenant, `${AN}-01-01`]);
  const [r] = await sql(`INSERT INTO rubriques (tenant_id, code, intitule, type) VALUES ($1, 'ACH', 'ACHATS DIVERS', 'depense') RETURNING id`, [c.tenant]);
  await sql(`INSERT INTO equivalences_comptables (tenant_id, rubrique_id, compte, statut) VALUES ($1, $2, '6051', 'valide')`, [c.tenant, r.id]);
  for (const [qui, role] of [['dir', 'directeur'], ['cpt', 'auditeur'], ['cai', 'caissier']]) {
    const username = `${qui}-ach-${cle}-${sfx}`;
    const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif) VALUES ($1, $2, $3, 'x', $4, true) RETURNING id`,
      [c.tenant, username, `${username}@test.cm`, role]);
    await sql('INSERT INTO user_modules (user_id, module_code, tenant_id) VALUES ($1, \'caisse\', $2) ON CONFLICT DO NOTHING', [u.id, c.tenant]);
    c.u[qui] = { id: u.id, token: jwt.sign({ sub: u.id, username, role, tenantId: c.tenant }, SECRET, { expiresIn: '1h' }) };
  }
};

before(async () => {
  await creerClient('a');
  await creerClient('b');
  [{ id: F.fourn }] = await sql(`INSERT INTO registre_tiers (tenant_id, type, nom) VALUES ($1, 'fournisseur', 'Papeterie Centrale') RETURNING id::text`, [C.a.tenant]);
  [{ id: F.autre }] = await sql(`INSERT INTO registre_tiers (tenant_id, type, nom) VALUES ($1, 'fournisseur', 'Garage du Centre') RETURNING id::text`, [C.a.tenant]);
  serveur = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: DB, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test', SMTP_HOST: '', RATE_LIMIT_MAX: '100000', MODULES_CONTROLE: 'appliquer' },
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
  assert.equal(ref.status, 200, ref.message);
  F.cat = Object.fromEntries(ref.data.categories.map((c) => [c.code, c.id]));
  F.tva = ref.data.taxes.find((t) => t.code === 'TVA').id;
});
after(async () => {
  serveur?.kill();
  const cx = await pool.connect();
  try {
    await cx.query('BEGIN');
    await cx.query("SET LOCAL app.finance_maintenance = 'on'");
    await cx.query("SET LOCAL app.journal_maintenance = 'on'");
    const ids = [C.a.tenant, C.b.tenant].filter(Boolean);
    await cx.query('DELETE FROM fin_reglement_affectations WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM fin_imputations_externes WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM fin_ecritures WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM fin_factures WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('UPDATE journal SET annule_par_id = NULL WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM journal WHERE tenant_id = ANY($1::uuid[]) AND annulation_de_id IS NOT NULL', [ids]);
    await cx.query('DELETE FROM journal WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM com_facture_fourn_lignes WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM com_factures_fournisseurs WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM com_articles WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM com_unites WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM com_familles WHERE tenant_id = ANY($1::uuid[])', [ids]);
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
});

test('Saisie : le caissier enregistre, échéance du fournisseur, doublon refusé', async () => {
  const r = await appel('POST', '/finance/achats', 'a', 'cai', facture());
  assert.equal(r.status, 201, r.message);
  F.f1 = r.data.id;
  const d = (await appel('GET', `/finance/achats/fin/${F.f1}`, 'a', 'cai')).data;
  assert.equal(d.facture.statut, 'brouillon');
  assert.equal(Number(d.facture.total_ht), 100000);
  assert.equal(Number(d.facture.total_taxes), 19250);
  assert.equal(Number(d.facture.total_ttc), 119250);
  assert.equal(d.facture.date_echeance, `${AN}-04-09`, 'délai de paiement de 30 jours par défaut');
  assert.equal(d.lignes[0].compte, '6051', 'compte de la catégorie');
  const doublon = await appel('POST', '/finance/achats', 'a', 'cpt', facture({ reference: ' fa-001 ' }));
  assert.equal(doublon.status, 409);
  assert.match(doublon.message, /déjà enregistrée/);
  assert.equal(doublon.data.doublon.id, F.f1);
  // Mauvaise classe de compte pour la catégorie.
  const mauvais = await appel('POST', '/finance/achats', 'a', 'cai', facture({ reference: 'FA-X', lignes: [{ designation: 'X', quantite: 1, prix_unitaire: 10, compte: '2441' }] }));
  assert.equal(mauvais.status, 400);
  assert.equal((await appel('POST', `/finance/achats/fin/${F.f1}/soumettre`, 'a', 'cai')).status, 200);
});

test('Validation : jamais par le caissier ni par l\'auteur ; écriture 6051 / 4452 / 401', async () => {
  assert.equal((await appel('POST', `/finance/achats/fin/${F.f1}/valider`, 'a', 'cai')).status, 403);
  const propre = await appel('POST', '/finance/achats', 'a', 'cpt', facture({ reference: 'FA-002' }));
  assert.equal(propre.status, 201, propre.message);
  const auto = await appel('POST', `/finance/achats/fin/${propre.data.id}/valider`, 'a', 'cpt');
  assert.equal(auto.status, 403);
  assert.match(auto.message, /autre personne/);
  assert.equal((await appel('DELETE', `/finance/achats/fin/${propre.data.id}`, 'a', 'cpt')).status, 200);

  const v = await appel('POST', `/finance/achats/fin/${F.f1}/valider`, 'a', 'dir');
  assert.equal(v.status, 200, v.message);
  assert.equal(v.data.numero, `FFR-${AN}-00001`);
  assert.deepEqual(await lignesEcriture('fin_facture', F.f1), ['6051 D100000', '4452 D19250', '401 C119250 T']);
  const [e] = await sql(`SELECT e.statut, j.code FROM fin_ecritures e JOIN fin_journaux j ON j.id = e.journal_id WHERE origine_type = 'fin_facture' AND origine_id = $1`, [F.f1]);
  assert.deepEqual([e.statut, e.code], ['validee', 'AC']);
  assert.equal((await appel('PUT', `/finance/achats/fin/${F.f1}`, 'a', 'cpt', facture())).status, 409, 'validée : intangible');
  const dettes = await appel('GET', '/finance/dettes', 'a', 'cpt');
  assert.equal(Number(dettes.data.lignes.find((t) => t.id === F.fourn).solde), 119250);
});

test('Immobilisation : 2441 / 4451 / 481', async () => {
  const r = await appel('POST', '/finance/achats', 'a', 'cai', facture({ tiers_id: F.autre, reference: 'IMMO-1', categorie_id: F.cat.IMMO_MAT,
    lignes: [{ designation: 'Photocopieur', quantite: 1, prix_unitaire: 800000, taxe_id: F.tva }] }));
  assert.equal(r.status, 201, r.message);
  assert.equal((await appel('POST', `/finance/achats/fin/${r.data.id}/valider`, 'a', 'cpt')).status, 200);
  assert.deepEqual(await lignesEcriture('fin_facture', r.data.id), ['2441 D800000', '4451 D154000', '481 C954000 T']);
  F.immo = r.data.id;
});

test('Règlement partiel par la caisse : part réglée au 401, le reste en charge ; plafonds', async () => {
  F.m1 = await mouvement({ date: `${AN}-03-15`, sortie: 70000, tiers: F.fourn });
  const dispo = await appel('GET', `/finance/achats/sorties-disponibles?tiers_id=${F.fourn}`, 'a', 'cai');
  assert.ok(dispo.data.some((m) => m.id === F.m1));
  const r = await appel('POST', '/finance/reglements', 'a', 'cai', { mouvement_id: F.m1, affectations: [{ facture_type: 'fin', facture_id: F.f1, montant: 50000 }] });
  assert.equal(r.status, 201, r.message);
  assert.deepEqual(await lignesEcriture('journal', F.m1), ['401 D50000 T', '6051 D20000 T', '5711 C70000']);
  let d = (await appel('GET', `/finance/achats/fin/${F.f1}`, 'a', 'cai')).data;
  assert.equal(Number(d.reste), 69250);
  assert.equal(d.reglements.length, 1);
  // Plafond de la sortie (il reste 20 000 à affecter).
  let trop = await appel('POST', '/finance/reglements', 'a', 'cai', { mouvement_id: F.m1, affectations: [{ facture_type: 'fin', facture_id: F.immo, montant: 30000 }] });
  assert.equal(trop.status, 400, 'le bénéficiaire de la sortie n\'est pas ce fournisseur');
  trop = await appel('POST', '/finance/reglements', 'a', 'cai', { mouvement_id: F.m1, affectations: [{ facture_type: 'fin', facture_id: F.f1, montant: 30000 }] });
  assert.equal(trop.status, 409);
  assert.match(trop.message, /reste 20000/);
  // Plafond du reste à payer.
  const m2 = await mouvement({ date: `${AN}-03-16`, sortie: 900000 });
  trop = await appel('POST', '/finance/reglements', 'a', 'cai', { mouvement_id: m2, affectations: [{ facture_type: 'fin', facture_id: F.f1, montant: 70000 }] });
  assert.equal(trop.status, 409);
  assert.match(trop.message, /69250/);
  const ouvertes = await appel('GET', `/finance/achats/ouvertes?tiers_id=${F.fourn}`, 'a', 'cai');
  assert.equal(Number(ouvertes.data.find((f) => f.id === F.f1).reste), 69250);
});

test('Avoir : limité à la facture, réduit le reste, écriture inverse', async () => {
  const trop = await appel('POST', '/finance/achats', 'a', 'cai', facture({ type: 'avoir', facture_origine_id: F.f1, reference: 'AV-99',
    lignes: [{ designation: 'Retour', quantite: 1, prix_unitaire: 200000, taxe_id: F.tva }] }));
  assert.equal(trop.status, 201);
  const refus = await appel('POST', `/finance/achats/fin/${trop.data.id}/valider`, 'a', 'cpt');
  assert.equal(refus.status, 400);
  assert.match(refus.message, /dépasse/);
  await appel('DELETE', `/finance/achats/fin/${trop.data.id}`, 'a', 'cai');
  const av = await appel('POST', '/finance/achats', 'a', 'cai', facture({ type: 'avoir', facture_origine_id: F.f1, reference: 'AV-01',
    lignes: [{ designation: 'Remise sur classeurs', quantite: 1, prix_unitaire: 10000, taxe_id: F.tva }] }));
  assert.equal(av.status, 201, av.message);
  const v = await appel('POST', `/finance/achats/fin/${av.data.id}/valider`, 'a', 'cpt');
  assert.equal(v.status, 200, v.message);
  assert.equal(v.data.numero, `AVF-${AN}-00001`);
  assert.deepEqual(await lignesEcriture('fin_facture', av.data.id), ['6051 C10000', '4452 C1925', '401 D11925 T']);
  assert.equal(Number((await appel('GET', `/finance/achats/fin/${F.f1}`, 'a', 'cai')).data.reste), 57325);
  F.avoir = av.data.id;
});

test('Sortie annulée en caisse : le règlement tombe, la contre-passation reprend le 401', async () => {
  assert.equal((await appel('POST', `/finance/achats/fin/${F.f1}/annuler`, 'a', 'cpt', { motif: 'Erreur' })).status, 409, 'facture réglée');
  const cx = await pool.connect();
  let annul;
  try {
    await cx.query('BEGIN');
    await cx.query("SET LOCAL app.journal_maintenance = 'on'");
    [{ id: annul }] = (await cx.query(
      `INSERT INTO journal (tenant_id, date, mois, annee, type_caisse, rubrique_code, intitule, entree, sortie, journal_id, tiers_id, annulation_de_id, created_by)
       VALUES ($1, $2, 'Mars', $3, 'especes', 'ACH', 'Annulation', 0, -70000, $4, $5, $6, $7) RETURNING id::text`,
      [C.a.tenant, `${AN}-03-20`, AN, C.a.caisse, F.fourn, F.m1, C.a.u.cai.id])).rows;
    await cx.query('UPDATE journal SET annule_par_id = $1 WHERE id = $2', [annul, F.m1]);
    await cx.query('COMMIT');
  } finally { cx.release(); }
  const d = (await appel('GET', `/finance/achats/fin/${F.f1}`, 'a', 'cpt')).data;
  assert.equal(Number(d.reste), 107325, 'TTC − avoir : la sortie annulée ne règle plus rien');
  assert.ok(d.reglements[0].annule);
  // Nouveau règlement (qui relance le générateur) : la contre-passation est l'inverse exact de la sortie.
  const m3 = await mouvement({ date: `${AN}-03-21`, sortie: 1000, tiers: F.fourn });
  assert.equal((await appel('POST', '/finance/reglements', 'a', 'cai', { mouvement_id: m3, affectations: [{ facture_type: 'fin', facture_id: F.f1, montant: 1000 }] })).status, 201);
  assert.deepEqual(await lignesEcriture('journal', annul), ['5711 D70000', '401 C50000 T', '6051 C20000 T']);
  F.m3 = m3;
});

test('Annulation : avoirs et règlements d\'abord, puis extourne', async () => {
  assert.equal((await appel('POST', `/finance/achats/fin/${F.f1}/annuler`, 'a', 'cpt', { motif: 'Erreur' })).status, 409, 'règlement actif (m3)');
  const d = (await appel('GET', `/finance/achats/fin/${F.f1}`, 'a', 'cpt')).data;
  const actif = d.reglements.find((x) => !x.annule);
  assert.equal((await appel('DELETE', `/finance/reglements/${actif.id}`, 'a', 'cai')).status, 200);
  assert.deepEqual(await lignesEcriture('journal', F.m3), ['6051 D1000 T', '5711 C1000'], 'sortie redevenue une charge');
  let r = await appel('POST', `/finance/achats/fin/${F.f1}/annuler`, 'a', 'cpt', { motif: 'Erreur' });
  assert.equal(r.status, 409, 'avoir validé');
  assert.equal((await appel('POST', `/finance/achats/fin/${F.avoir}/annuler`, 'a', 'cpt', { motif: 'Avoir annulé' })).status, 200);
  assert.equal((await appel('POST', `/finance/achats/fin/${F.f1}/annuler`, 'a', 'cpt', {})).status, 400, 'motif obligatoire');
  r = await appel('POST', `/finance/achats/fin/${F.f1}/annuler`, 'a', 'cpt', { motif: 'Facture refaite par le fournisseur' });
  assert.equal(r.status, 200, r.message);
  assert.ok(r.data.extourne_id);
  assert.deepEqual(await lignesEcriture('fin_facture', F.f1), [], 'écriture extournée');
  // Les écritures de la sortie annulée et de sa contre-passation sont refaites ensemble (plus de 401).
  assert.deepEqual(await lignesEcriture('journal', F.m1), ['6051 D70000 T', '5711 C70000']);
  // La référence redevient libre.
  assert.equal((await appel('POST', '/finance/achats', 'a', 'cai', facture({ reference: 'FA-001' }))).status, 201);
});

test('NJ COMMERCIAL : facture validée lue par référence, imputée, doublon refusé, annulation extournée', async () => {
  const [{ id: fam }] = await sql(`INSERT INTO com_familles (tenant_id, code, nom) VALUES ($1, 'MAR', 'Marchandises') RETURNING id`, [C.a.tenant]);
  const [{ id: unite }] = await sql(`INSERT INTO com_unites (tenant_id, code, libelle, decimales) VALUES ($1, 'U', 'Unité', 0) RETURNING id`, [C.a.tenant]);
  const [{ id: article }] = await sql(`INSERT INTO com_articles (tenant_id, reference, designation, famille_id, suivi_comptable, unite, unite_stock_id, unite_achat_id, unite_vente_id)
                                       VALUES ($1, 'RIZ', 'Riz 50 kg', $2, true, 'U', $3, $3, $3) RETURNING id`, [C.a.tenant, fam, unite]);
  const [{ id: cf }] = await sql(`INSERT INTO com_factures_fournisseurs (tenant_id, type, numero, fournisseur_id, reference_fournisseur, date_facture,
                                    total_ht, total_taxes, total_ttc, statut)
                                  VALUES ($1, 'facture', $2, $3, 'BL-RIZ-7', $4, 200000, 38500, 238500, 'brouillon') RETURNING id::text`,
  [C.a.tenant, `FFO-${sfx}`, F.autre, `${AN}-04-02`]);
  const [{ id: lid }] = await sql(`SELECT nextval(pg_get_serial_sequence('com_facture_fourn_lignes', 'id'))::text AS id`);
  await sql(`INSERT INTO com_facture_fourn_lignes (id, facture_id, tenant_id, facture_ligne_origine_id, article_id, designation, unite, quantite, prix_unitaire,
                                                   taxe_id, taxe_code, taxe_taux, montant_ht, montant_taxe)
             VALUES ($1, $2, $3, $1, $4, 'Riz 50 kg', 'U', 10, 20000, $5, 'TVA', 19.25, 200000, 38500)`, [lid, cf, C.a.tenant, article, F.tva]);
  await sql(`UPDATE com_factures_fournisseurs SET statut = 'valide', valide_le = NOW() WHERE id = $1`, [cf]);

  let liste = await appel('GET', '/finance/achats?origine=com_ff', 'a', 'cpt');
  assert.equal(liste.status, 200, liste.message);
  const ligne = liste.data.factures.find((f) => f.id === cf);
  assert.equal(ligne.etat, 'À imputer');
  assert.equal(liste.data.compteurs.a_imputer, 1);
  const m = await mouvement({ date: `${AN}-04-05`, sortie: 100000, tiers: F.autre });
  assert.equal((await appel('POST', '/finance/reglements', 'a', 'cai', { mouvement_id: m, affectations: [{ facture_type: 'com_ff', facture_id: cf, montant: 100000 }] })).status, 400,
    'non imputée : pas de règlement');
  const doublon = await appel('POST', '/finance/achats', 'a', 'cai', facture({ tiers_id: F.autre, reference: 'bl-riz-7' }));
  assert.equal(doublon.status, 409);
  assert.match(doublon.message, /NJ COMMERCIAL/);
  assert.equal((await appel('POST', `/finance/achats/com_ff/${cf}/imputer`, 'a', 'cai', { categorie_id: F.cat.ACH_MARCH })).status, 403);
  const imp = await appel('POST', `/finance/achats/com_ff/${cf}/imputer`, 'a', 'cpt', { categorie_id: F.cat.ACH_MARCH });
  assert.equal(imp.status, 200, imp.message);
  assert.deepEqual(await lignesEcriture('com_ff', cf), ['6011 D200000', '4452 D38500', '401 C238500 T']);
  assert.equal((await appel('POST', '/finance/reglements', 'a', 'cai', { mouvement_id: m, affectations: [{ facture_type: 'com_ff', facture_id: cf, montant: 100000 }] })).status, 201);
  assert.equal(Number((await appel('GET', `/finance/achats/com_ff/${cf}`, 'a', 'cpt')).data.reste), 138500);
  // Annulée dans NJ COMMERCIAL : écriture extournée, règlement retiré, la sortie redevient une charge.
  await sql(`UPDATE com_factures_fournisseurs SET statut = 'annule', annule_le = NOW(), motif_annulation = 'Erreur de fournisseur' WHERE id = $1`, [cf]);
  liste = await appel('GET', '/finance/achats?origine=com_ff', 'a', 'cpt');
  assert.equal(liste.status, 200, liste.message);
  assert.equal(liste.data.factures.find((f) => f.id === cf).statut, 'annulee');
  assert.deepEqual(await lignesEcriture('com_ff', cf), []);
  assert.deepEqual(await lignesEcriture('journal', m), ['6051 D100000 T', '5711 C100000']);
});

test('Échéancier et isolement des clients', async () => {
  const e = await appel('GET', '/finance/achats/echeancier', 'a', 'cpt');
  assert.equal(e.status, 200, e.message);
  assert.equal(e.data.groupes.length, 6);
  assert.ok(e.data.groupes.flatMap((g) => g.factures).some((f) => f.id === F.immo));
  assert.equal((await appel('GET', `/finance/achats/fin/${F.immo}`, 'b', 'dir')).status, 404);
  assert.equal((await appel('GET', '/finance/achats', 'b', 'dir')).data.total, 0);
  const autre = await appel('POST', '/finance/reglements', 'b', 'dir', { mouvement_id: F.m3, affectations: [{ facture_type: 'fin', facture_id: F.immo, montant: 1 }] });
  assert.equal(autre.status, 400);
});

test('Tiers payeur (087) : la facture est réglée par un tiers, le directeur valide, D 401 / C compte du tiers payeur', async () => {
  const [{ id: bailleur }] = await sql(`INSERT INTO registre_tiers (tenant_id, type, nom) VALUES ($1, 'client', 'Fondation Partenaire') RETURNING id::text`, [C.a.tenant]);
  const r = await appel('POST', '/finance/achats', 'a', 'cai', facture({ reference: 'FA-TP1' }));
  await appel('POST', `/finance/achats/fin/${r.data.id}/soumettre`, 'a', 'cai');
  assert.equal((await appel('POST', `/finance/achats/fin/${r.data.id}/valider`, 'a', 'dir')).status, 200);
  const base = { nature: 'tiers_payeur', facture_type: 'fin', facture_id: r.data.id, date: `${AN}-03-20`, montant: 119250, compte: '458', reference: 'VIR-778' };
  assert.equal((await appel('POST', '/finance/reglements/hors-caisse', 'a', 'cpt', { ...base })).status, 400, 'tiers payeur obligatoire');
  assert.equal((await appel('POST', '/finance/reglements/hors-caisse', 'a', 'cpt', { ...base, tiers_id: F.fourn })).status, 400, 'pas le fournisseur lui-même');
  const p = await appel('POST', '/finance/reglements/hors-caisse', 'a', 'cpt', { ...base, tiers_id: bailleur });
  assert.equal(p.status, 201, p.message);
  const attente = (await appel('GET', '/finance/reglements/hors-caisse', 'a', 'dir')).data;
  assert.equal((attente.lignes || attente).find((h) => h.id === p.data.id).tiers_payeur_nom, 'Fondation Partenaire');
  assert.equal((await appel('POST', `/finance/reglements/hors-caisse/${p.data.id}/decision`, 'a', 'cpt', { decision: 'valider' })).status, 403);
  const v = await appel('POST', `/finance/reglements/hors-caisse/${p.data.id}/decision`, 'a', 'dir', { decision: 'valider' });
  assert.equal(v.status, 200, v.message);
  assert.deepEqual(await lignesEcriture('fin_reglement_hc', p.data.id), ['401 D119250 T', '458 C119250 T']);
  const d = (await appel('GET', `/finance/achats/fin/${r.data.id}`, 'a', 'cpt')).data;
  assert.equal(Number(d.reste), 0);
  assert.equal(d.hors_caisse[0].nature, 'tiers_payeur');
});
