// tests/projets-demandes.test.js — Gestion des activités simplifiée (083).
//
// Lance le VRAI serveur (index.js) sur une base de TEST, puis appelle l'API.
//   TEST_DATABASE_URL=postgres://…/base_de_test  node --test tests/projets-demandes.test.js
//
// Couvre : la demande de fonds du responsable (lignes × quantité × jours × prix) ;
// validation par le chef de projet PUIS par le directeur (personne d'autre) ;
// renvoi et rejet avec motif ; décaissement par la caisse ou la banque plafonné à
// l'approuvé ; dépenses déclarées avec pièce, plafonnées aux fonds reçus ;
// contrôle par le comptable (jamais ses propres déclarations) ; reliquat reversé
// en banque ; rapport financier (provisoire tant que des dépenses attendent) et
// PDF ; contre-passation du décaissement ; une PME n'y a pas accès ; isolement.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const DB = process.env.TEST_DATABASE_URL;
if (!DB) {
  console.error('TEST_DATABASE_URL absent : test ignoré (ne jamais viser la base de production).');
  process.exit(0);
}
const SECRET = 'test-secret-' + crypto.randomBytes(16).toString('hex');
const PORT = 5800 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}/api`;
const sfx = crypto.randomBytes(3).toString('hex');
const PV_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nj-df-'));
const pool = new Pool({ connectionString: DB });
let serveur;
const C = { ong: { u: {} }, pme: { u: {} } };
const S = {};

const sql = async (texte, params = []) => (await pool.query(texte, params)).rows;
const appel = async (methode, url, qui, corps, client = 'ong') => {
  const r = await fetch(BASE + url, {
    method: methode,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${C[client].u[qui].token}` },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.data ?? j, message: j.message ?? j.error, code: j.code ?? j.data?.code };
};
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n').toString('base64');
const piece = { nom_fichier: 'recu.pdf', data_base64: PDF };
const jour = new Date().toISOString().slice(0, 10);
const demande = (extra = {}) => ({
  activite_id: S.atelier, objet: 'Atelier de formation des relais', date_besoin: jour,
  lignes: [{ designation: 'Pause café', quantite: 20, jours: 2, prix_unitaire: 1500 }, { designation: 'Salle', quantite: 1, prix_unitaire: 40000 }],
  ...extra,
});

const creerClient = async (cle, forme) => {
  const c = C[cle];
  [{ id: c.tenant }] = await sql(`INSERT INTO tenants (slug, nom, forme_juridique, initialise_le) VALUES ($1, $2, $3, NOW()) RETURNING id`,
    [`df-${cle}-${sfx}`, `DEMANDES ${cle} ${sfx}`, forme]);
  for (const [qui, role] of [['dir', 'directeur'], ['cpt', 'auditeur'], ['cai', 'caissier'], ['chef', 'collaborateur'], ['resp', 'collaborateur']]) {
    const username = `${qui}-df-${cle}-${sfx}`;
    const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif) VALUES ($1, $2, $3, 'x', $4, true) RETURNING id`,
      [c.tenant, username, `${username}@test.cm`, role]);
    c.u[qui] = { id: u.id, token: jwt.sign({ sub: u.id, username, role, tenantId: c.tenant }, SECRET, { expiresIn: '1h' }) };
  }
};

before(async () => {
  await creerClient('ong', 'ONG');
  await creerClient('pme', 'SARL');
  const t = C.ong.tenant;
  await sql(`INSERT INTO rubriques (tenant_id, code, intitule, type) VALUES
             ($1, 'DOT', 'DOTATION', 'entree'), ($1, 'ACT', 'FRAIS DES ACTIVITES', 'depense'), ($1, 'REV', 'REVERSEMENT RELIQUAT', 'entree')`, [t]);
  [{ id: S.caisse }] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type, date_ouverture) VALUES ($1, 'CA1', 'Caisse', 'caisse', CURRENT_DATE - 40) RETURNING id`, [t]);
  [{ id: S.banque }] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type, date_ouverture) VALUES ($1, 'BQ1', 'Banque', 'banque', CURRENT_DATE - 40) RETURNING id`, [t]);
  [{ id: S.projet }] = await sql(`INSERT INTO activites (tenant_id, nom, type, chef_projet_id) VALUES ($1, 'Santé communautaire', 'projet', $2) RETURNING id`, [t, C.ong.u.chef.id]);
  [{ id: S.atelier }] = await sql(`INSERT INTO activites (tenant_id, nom, type, projet_id, responsable_id) VALUES ($1, 'Formation des relais', 'activite', $2, $3) RETURNING id`, [t, S.projet, C.ong.u.resp.id]);
  [{ id: S.autre }] = await sql(`INSERT INTO activites (tenant_id, nom, type, projet_id) VALUES ($1, 'Sensibilisation', 'activite', $2) RETURNING id`, [t, S.projet]);
  serveur = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: DB, JWT_SECRET: SECRET, PORT: String(PORT), NODE_ENV: 'test', SMTP_HOST: '', RATE_LIMIT_MAX: '100000', PV_DIR },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = (d) => process.env.DEBUG_TEST && process.stderr.write(d);
  serveur.stdout.on('data', log); serveur.stderr.on('data', log);
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* démarrage */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const MOIS = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
  const d = new Date();
  for (const j of [S.caisse, S.banque]) {
    const r = await appel('POST', '/journal', 'cai', { date: jour, mois: MOIS[d.getMonth()], annee: d.getFullYear(), journal_id: j,
      rubrique_code: 'DOT', intitule: 'Dotation', entree: 500000, sortie: 0 });
    assert.equal(r.status, 201, r.message);
  }
});
after(async () => {
  serveur?.kill();
  const cx = await pool.connect();
  try {
    await cx.query('BEGIN');
    await cx.query("SET LOCAL app.journal_maintenance = 'on'");
    const ids = [C.ong.tenant, C.pme.tenant].filter(Boolean);
    await cx.query('DELETE FROM audit_log WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [ids]);
    await cx.query('COMMIT');
  } catch (e) {
    await cx.query('ROLLBACK');
    console.error('Nettoyage de la base de test incomplet :', e.message);
  } finally {
    cx.release();
  }
  fs.rmSync(PV_DIR, { recursive: true, force: true });
  await pool.end();
});

test('Demande : seul le responsable (ou le chef) la fait ; total = quantité × jours × prix', async () => {
  const ctx = await appel('GET', '/projets/demandes/contexte', 'resp');
  assert.equal(ctx.status, 200, ctx.message);
  assert.deepEqual(ctx.data.activites.map((a) => a.id), [S.atelier], 'seulement son activité');
  assert.equal((await appel('POST', '/projets/demandes', 'cai', demande())).status, 403, 'la caissière ne demande pas');
  assert.equal((await appel('POST', '/projets/demandes', 'resp', demande({ activite_id: S.autre }))).status, 403, 'pas son activité');
  const r = await appel('POST', '/projets/demandes', 'resp', demande());
  assert.equal(r.status, 201, r.message);
  S.d1 = r.data.id;
  const d = (await appel('GET', `/projets/demandes/${S.d1}`, 'resp')).data;
  assert.equal(d.demande.total, 20 * 2 * 1500 + 40000);
  assert.equal(d.demande.statut, 'brouillon');
  assert.equal(d.lignes.length, 2);
  assert.equal((await appel('GET', '/projets/demandes', 'dir', undefined, 'pme')).status, 403, 'réservé aux ONG');
});

test('Circuit : chef de projet puis directeur ; renvoi avec motif', async () => {
  const s = await appel('POST', `/projets/demandes/${S.d1}/soumettre`, 'resp');
  assert.equal(s.status, 200, s.message);
  assert.equal(s.data.statut, 'soumise');
  assert.match(s.data.numero, /^DF-\d{4}-00001$/);
  assert.equal((await appel('POST', `/projets/demandes/${S.d1}/valider`, 'dir')).status, 403, 'le directeur attend le chef');
  assert.equal((await appel('PUT', `/projets/demandes/${S.d1}`, 'resp', demande())).status, 409, 'soumise : intangible');
  const renvoi = await appel('POST', `/projets/demandes/${S.d1}/renvoyer`, 'chef', { motif: 'Réduire la pause café' });
  assert.equal(renvoi.data.statut, 'brouillon');
  const m = await appel('PUT', `/projets/demandes/${S.d1}`, 'resp', demande({ soumettre: true,
    lignes: [{ designation: 'Pause café', quantite: 20, jours: 2, prix_unitaire: 1000 }, { designation: 'Salle', quantite: 1, prix_unitaire: 40000 }] }));
  assert.equal(m.status, 200, m.message);
  assert.equal(m.data.numero.endsWith('00001'), true, 'numéro conservé');
  assert.equal((await appel('POST', `/projets/demandes/${S.d1}/valider`, 'chef')).data.statut, 'validee_chef');
  assert.equal((await appel('POST', `/projets/demandes/${S.d1}/valider`, 'chef')).status, 403, 'le chef n\'approuve pas');
  const a = await appel('POST', `/projets/demandes/${S.d1}/valider`, 'dir');
  assert.equal(a.data.statut, 'approuvee');
  const liste = (await appel('GET', '/projets/demandes?vue=a_decaisser', 'cai')).data;
  assert.equal(liste.demandes[0].etat, 'À décaisser');
  assert.equal(liste.demandes[0].total, 80000);
  // Rejet définitif d'une autre demande, motif obligatoire.
  const d2 = await appel('POST', '/projets/demandes', 'resp', demande({ soumettre: true, objet: 'Deuxième' }));
  assert.equal((await appel('POST', `/projets/demandes/${d2.data.id}/rejeter`, 'chef', { motif: '' })).status, 400);
  assert.equal((await appel('POST', `/projets/demandes/${d2.data.id}/rejeter`, 'chef', { motif: 'Hors budget du bailleur' })).data.statut, 'rejetee');
});

test('Décaissement : par la caisse, plafonné à l\'approuvé, hors budget de fonctionnement', async () => {
  assert.equal((await appel('POST', `/projets/demandes/${S.d1}/decaisser`, 'resp', { journal_id: S.caisse, rubrique_code: 'ACT' })).status, 403);
  const trop = await appel('POST', `/projets/demandes/${S.d1}/decaisser`, 'cai', { journal_id: S.caisse, rubrique_code: 'ACT', montant: 90000 });
  assert.equal(trop.status, 409);
  const r = await appel('POST', `/projets/demandes/${S.d1}/decaisser`, 'cai', { journal_id: S.caisse, rubrique_code: 'ACT', montant: 50000 });
  assert.equal(r.status, 201, r.message);
  S.sortie1 = r.data.journal_id;
  const [j] = await sql('SELECT sortie, activite_id FROM journal WHERE id = $1', [S.sortie1]);
  assert.deepEqual([Number(j.sortie), j.activite_id], [50000, S.atelier]);
  // Directement par la saisie de caisse : dépassement refusé en base.
  const MOIS = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
  const dd = new Date();
  const direct = await appel('POST', '/journal', 'cai', { date: jour, mois: MOIS[dd.getMonth()], annee: dd.getFullYear(), journal_id: S.caisse,
    rubrique_code: 'ACT', intitule: 'X', entree: 0, sortie: 40000, demande_fonds_id: S.d1 });
  assert.equal(direct.status, 409, direct.message);
  assert.match(direct.message, /reste 30/);
  const r2 = await appel('POST', `/projets/demandes/${S.d1}/decaisser`, 'cai', { journal_id: S.caisse, rubrique_code: 'ACT' });
  assert.equal(r2.status, 201, r2.message);
  assert.equal(r2.data.montant, 30000, 'le reste par défaut');
  const d = (await appel('GET', `/projets/demandes/${S.d1}`, 'resp')).data;
  assert.equal(d.demande.decaisse, 80000);
  assert.equal(d.demande.etat, 'À justifier');
  assert.equal(d.mouvements.length, 2);
});

test('Dépenses : pièce obligatoire, plafonnées aux fonds reçus ; contrôle par le comptable seul', async () => {
  const sans = await appel('POST', `/projets/demandes/${S.d1}/depenses`, 'resp', { date_depense: jour, designation: 'Café', montant: 10000 });
  assert.equal(sans.status, 400);
  const trop = await appel('POST', `/projets/demandes/${S.d1}/depenses`, 'resp', { date_depense: jour, designation: 'Tout', montant: 90000, ...piece });
  assert.equal(trop.status, 409);
  const ok1 = await appel('POST', `/projets/demandes/${S.d1}/depenses`, 'resp', { date_depense: jour, designation: 'Pause café', beneficiaire: 'Traiteur Mama', montant: 38000, ...piece });
  assert.equal(ok1.status, 201, ok1.message);
  const ok2 = await appel('POST', `/projets/demandes/${S.d1}/depenses`, 'resp', { date_depense: jour, designation: 'Location salle', montant: 40000, ...piece });
  assert.equal(ok2.status, 201, ok2.message);
  S.dep1 = ok1.data.id; S.dep2 = ok2.data.id;
  const liste = (await appel('GET', '/projets/depenses?vue=a_controler', 'cpt')).data;
  assert.equal(liste.depenses.length, 2);
  assert.equal((await appel('POST', `/projets/depenses/${S.dep1}/controler`, 'chef', { decision: 'valider' })).status, 403, 'le chef ne contrôle pas');
  assert.equal((await appel('POST', `/projets/depenses/${S.dep1}/controler`, 'cpt', { decision: 'valider' })).data.statut, 'validee');
  assert.equal((await appel('POST', `/projets/depenses/${S.dep1}/controler`, 'cpt', { decision: 'rejeter', motif: 'x' })).status, 409, 'déjà contrôlée');
  const f = await fetch(`${BASE}/projets/depenses/${S.dep1}/fichier`, { headers: { Authorization: `Bearer ${C.ong.u.cpt.token}` } });
  assert.equal(f.status, 200);
  assert.equal(f.headers.get('content-type'), 'application/pdf');
});

test('Rapport financier : provisoire tant qu\'une dépense attend ; reliquat reversé en banque', async () => {
  let r = (await appel('GET', `/projets/rapport-financier?projet_id=${S.projet}`, 'dir')).data;
  const p = r.projets[0];
  assert.equal(p.provisoire, true);
  const a = p.activites.find((x) => x.id === S.atelier);
  assert.deepEqual([a.approuve, a.decaisse, a.depenses_validees, a.depenses_attente, a.reste_a_justifier], [80000, 80000, 38000, 40000, 2000]);
  assert.equal(p.financements_recus, 0);
  // Reliquat : 80 000 − 78 000 = 2 000, reversé à la banque.
  const trop = await appel('POST', `/projets/demandes/${S.d1}/reverser`, 'cai', { journal_id: S.banque, rubrique_code: 'REV', montant: 5000 });
  assert.equal(trop.status, 409);
  const mauvaise = await appel('POST', `/projets/demandes/${S.d1}/reverser`, 'cai', { journal_id: S.banque, rubrique_code: 'ACT' });
  assert.equal(mauvaise.status, 400, 'rubrique d\'entrée exigée');
  const rev = await appel('POST', `/projets/demandes/${S.d1}/reverser`, 'cai', { journal_id: S.banque, rubrique_code: 'REV' });
  assert.equal(rev.status, 201, rev.message);
  assert.equal(rev.data.montant, 2000);
  assert.equal((await appel('POST', `/projets/depenses/${S.dep2}/controler`, 'cpt', { decision: 'valider' })).status, 200);
  r = (await appel('GET', `/projets/rapport-financier?projet_id=${S.projet}`, 'chef')).data;
  assert.equal(r.projets[0].provisoire, false);
  assert.equal(r.projets[0].totaux.reste_a_justifier, 0);
  assert.equal(r.projets[0].depenses.length, 2);
  const d = (await appel('GET', `/projets/demandes/${S.d1}`, 'resp')).data;
  assert.equal(d.demande.etat, 'Justifiée');
  const pdf = await fetch(`${BASE}/projets/rapport-financier/pdf?projet_id=${S.projet}`, { headers: { Authorization: `Bearer ${C.ong.u.dir.token}` } });
  assert.equal(pdf.status, 200);
  assert.equal((await pdf.arrayBuffer()).byteLength > 1000, true);
  // Le responsable ne voit que son projet ; la caissière n'a pas le rapport de tous.
  assert.equal((await appel('GET', '/projets/rapport-financier', 'resp')).data.projets.length, 1);
});

test('Contre-passation du décaissement : il ne compte plus ; annulation par le directeur seulement', async () => {
  const d3 = await appel('POST', '/projets/demandes', 'chef', demande({ soumettre: true, objet: 'Par le chef' }));
  assert.equal(d3.data.statut, 'validee_chef', 'le chef demandeur : étape du chef acquise');
  assert.equal((await appel('POST', `/projets/demandes/${d3.data.id}/valider`, 'dir')).status, 200);
  const r = await appel('POST', `/projets/demandes/${d3.data.id}/decaisser`, 'cai', { journal_id: S.caisse, rubrique_code: 'ACT', montant: 10000 });
  assert.equal(r.status, 201, r.message);
  assert.equal((await appel('POST', `/projets/demandes/${d3.data.id}/annuler`, 'dir', { motif: 'Erreur' })).status, 409, 'fonds décaissés');
  const cx = await pool.connect();
  try {
    await cx.query('BEGIN');
    await cx.query("SET LOCAL app.journal_maintenance = 'on'");
    const [{ id }] = (await cx.query(`INSERT INTO journal (tenant_id, date, mois, annee, type_caisse, rubrique_code, intitule, entree, sortie, journal_id, activite_id, annulation_de_id)
       SELECT tenant_id, date, mois, annee, type_caisse, rubrique_code, 'Annulation', 0, -sortie, journal_id, activite_id, id FROM journal WHERE id = $1 RETURNING id`, [r.data.journal_id])).rows;
    await cx.query('UPDATE journal SET annule = true, annule_par_id = $2 WHERE id = $1', [r.data.journal_id, id]);
    await cx.query('COMMIT');
  } finally { cx.release(); }
  const d = (await appel('GET', `/projets/demandes/${d3.data.id}`, 'chef')).data;
  assert.equal(d.demande.decaisse, 0);
  assert.equal((await appel('POST', `/projets/demandes/${d3.data.id}/annuler`, 'chef', { motif: 'Plus utile' })).status, 403);
  assert.equal((await appel('POST', `/projets/demandes/${d3.data.id}/annuler`, 'dir', { motif: 'Plus utile' })).data.statut, 'annulee');
});
