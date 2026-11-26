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

// 086 : le chef de projet initie, la caisse valide la sortie (ordre de décaissement).
const ordonner = async (demandeId, corps = {}, qui = 'chef') => {
  const o = await appel('POST', `/projets/demandes/${demandeId}/initier`, qui, corps);
  assert.equal(o.status, 201, o.message);
  return o.data.id;
};

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
  assert.equal((await appel('GET', '/projets/demandes?vue=a_decaisser', 'cai')).data.demandes.length, 0, 'rien tant que le chef n\'a pas initié');
  const aInitier = (await appel('GET', '/projets/demandes?vue=a_initier', 'chef')).data;
  assert.equal(aInitier.demandes[0].etat, 'À décaisser');
  assert.equal(aInitier.demandes[0].total, 80000);
  // Rejet définitif d'une autre demande, motif obligatoire.
  const d2 = await appel('POST', '/projets/demandes', 'resp', demande({ soumettre: true, objet: 'Deuxième' }));
  assert.equal((await appel('POST', `/projets/demandes/${d2.data.id}/rejeter`, 'chef', { motif: '' })).status, 400);
  assert.equal((await appel('POST', `/projets/demandes/${d2.data.id}/rejeter`, 'chef', { motif: 'Hors budget du bailleur' })).data.statut, 'rejetee');
});

test('Décaissement : par la caisse, plafonné à l\'approuvé, hors budget de fonctionnement', async () => {
  assert.equal((await appel('POST', `/projets/demandes/${S.d1}/decaisser`, 'resp', { journal_id: S.caisse, rubrique_code: 'ACT' })).status, 403);
  const seule = await appel('POST', `/projets/demandes/${S.d1}/decaisser`, 'cai', { journal_id: S.caisse, rubrique_code: 'ACT', montant: 50000 });
  assert.equal(seule.code, 'ORDRE_REQUIS', 'la caisse ne décaisse pas sans ordre du chef');
  assert.equal((await appel('POST', `/projets/demandes/${S.d1}/initier`, 'resp', {})).status, 403, 'le responsable n\'initie pas');
  assert.equal((await appel('POST', `/projets/demandes/${S.d1}/initier`, 'chef', { montant: 90000 })).status, 409, 'plafonné à l\'approuvé');
  const o1 = await ordonner(S.d1, { montant: 50000, beneficiaire: 'Relais de Mfou' });
  // En attente : aucun mouvement de caisse encore.
  assert.equal((await sql('SELECT count(*)::int AS n FROM projet_demande_mouvements WHERE demande_id = $1', [S.d1]))[0].n, 0);
  let fiche = (await appel('GET', `/projets/demandes/${S.d1}`, 'cai')).data;
  assert.equal(fiche.demande.etat, 'Sortie à valider par la caisse');
  assert.equal(fiche.demande.reste_a_initier, 30000);
  assert.equal(fiche.actions.decaisser, true);
  assert.equal((await appel('POST', `/projets/demandes/${S.d1}/initier`, 'chef', { montant: 40000 })).status, 409, 'ordres en attente comptés');
  assert.equal((await appel('GET', '/projets/demandes?vue=a_decaisser', 'cai')).data.demandes.length, 1);
  const enAttente = (await appel('GET', '/projets/ordres-decaissement?statut=en_attente', 'cai')).data.ordres;
  assert.equal(enAttente.length, 1);
  assert.equal(enAttente[0].a_moi_de_valider, true);
  const pasEncore = await fetch(`${BASE}/projets/ordres-decaissement/${o1}/bon-de-sortie`, { headers: { Authorization: `Bearer ${C.ong.u.cai.token}` } });
  assert.equal(pasEncore.status, 409, 'pas de bon avant la sortie');
  const r = await appel('POST', `/projets/demandes/${S.d1}/decaisser`, 'cai', { ordre_id: o1, journal_id: S.caisse, rubrique_code: 'ACT', montant: 99 });
  assert.equal(r.status, 201, r.message);
  assert.equal(r.data.montant, 50000, 'montant de l\'ordre, pas celui saisi');
  assert.equal((await appel('POST', `/projets/demandes/${S.d1}/decaisser`, 'cai', { ordre_id: o1, journal_id: S.caisse, rubrique_code: 'ACT' })).code, 'ORDRE_TRAITE');
  const [ord] = await sql('SELECT statut, journal_id, traite_par FROM projet_ordres_decaissement WHERE id = $1', [o1]);
  assert.deepEqual([ord.statut, String(ord.journal_id), ord.traite_par], ['execute', String(r.data.journal_id), C.ong.u.cai.id]);
  const bon = await fetch(`${BASE}/projets/ordres-decaissement/${o1}/bon-de-sortie`, { headers: { Authorization: `Bearer ${C.ong.u.chef.token}` } });
  assert.equal(bon.status, 200);
  assert.equal(bon.headers.get('content-type'), 'application/pdf');
  const bonPdf = Buffer.from(await bon.arrayBuffer());
  if (process.env.DUMP_PDF) fs.writeFileSync(process.env.DUMP_PDF, bonPdf);
  assert.equal(bonPdf.byteLength > 1500, true);
  assert.equal((await fetch(`${BASE}/projets/ordres-decaissement/${o1}/bon-de-sortie`, { headers: { Authorization: `Bearer ${C.pme.u.dir.token}` } })).status, 403, 'autre client');
  S.sortie1 = r.data.journal_id;
  const [j] = await sql('SELECT sortie, activite_id FROM journal WHERE id = $1', [S.sortie1]);
  assert.deepEqual([Number(j.sortie), j.activite_id], [50000, S.atelier]);
  // Directement par la saisie de caisse : dépassement refusé en base.
  const MOIS = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
  const dd = new Date();
  const direct = await appel('POST', '/journal', 'cai', { date: jour, mois: MOIS[dd.getMonth()], annee: dd.getFullYear(), journal_id: S.caisse,
    rubrique_code: 'ACT', intitule: 'X', entree: 0, sortie: 40000, demande_fonds_id: S.d1 });
  assert.equal(direct.status, 409, direct.message);
  assert.equal(direct.code, 'ORDRE_REQUIS', 'pas de sortie directe sans ordre');
  // Refus par la caisse (motif), puis nouvel ordre : retrait par l'initiateur seulement.
  const o2 = await ordonner(S.d1, { montant: 30000 });
  assert.equal((await appel('POST', `/projets/ordres-decaissement/${o2}/refuser`, 'cai', { motif: '' })).status, 400);
  assert.equal((await appel('POST', `/projets/ordres-decaissement/${o2}/refuser`, 'cai', { motif: 'Bénéficiaire absent' })).data.statut, 'refuse');
  const o3 = await ordonner(S.d1, {});
  assert.equal((await appel('POST', `/projets/ordres-decaissement/${o3}/annuler`, 'cai', { motif: 'x' })).status, 403, 'la caisse refuse, elle ne retire pas');
  const direct2 = await appel('POST', '/journal', 'cai', { date: jour, mois: MOIS[dd.getMonth()], annee: dd.getFullYear(), journal_id: S.caisse,
    rubrique_code: 'ACT', intitule: 'X', entree: 0, sortie: 20000, demande_fonds_id: S.d1, ordre_decaissement_id: o3 });
  assert.equal(direct2.code, 'ORDRE_MONTANT', 'le montant de l\'ordre exactement');
  const r2 = await appel('POST', `/projets/demandes/${S.d1}/decaisser`, 'cai', { ordre_id: o3, journal_id: S.caisse, rubrique_code: 'ACT' });
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
  const od = await ordonner(d3.data.id, { montant: 10000 });
  const r = await appel('POST', `/projets/demandes/${d3.data.id}/decaisser`, 'cai', { ordre_id: od, journal_id: S.caisse, rubrique_code: 'ACT' });
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

test('Solde insuffisant : décaissement refusé, manque porté à la Demande de fonds de la caisse ; notifications', async () => {
  const gros = await appel('POST', '/projets/demandes', 'resp', demande({ soumettre: true, objet: 'Grosse campagne',
    lignes: [{ designation: 'Logistique', quantite: 1, prix_unitaire: 900000 }] }));
  assert.equal(gros.status, 201, gros.message);
  // Le chef de projet a été prévenu dans l'application (le mail suit son canal).
  await new Promise((r) => setTimeout(r, 400));
  const [{ n: notifChef }] = await sql(`SELECT count(*)::int AS n FROM notifications WHERE destinataire_id = $1 AND ref_type = 'demande_fonds' AND ref_id = $2`,
    [C.ong.u.chef.id, gros.data.id]);
  assert.equal(notifChef, 1);
  assert.equal((await appel('POST', `/projets/demandes/${gros.data.id}/valider`, 'chef')).status, 200);
  assert.equal((await appel('POST', `/projets/demandes/${gros.data.id}/valider`, 'dir')).status, 200);
  const ctx = (await appel('GET', '/projets/demandes/contexte', 'cai')).data;
  const caisse = ctx.journaux.find((j) => j.id === String(S.caisse));
  assert.ok(caisse.solde > 0 && caisse.solde < 900000, `solde affiché : ${caisse.solde}`);
  const og = await ordonner(gros.data.id);
  await new Promise((r) => setTimeout(r, 400));
  const [{ n: notifCaisse }] = await sql(`SELECT count(*)::int AS n FROM notifications WHERE destinataire_id = $1 AND type = 'demande_fonds_ordre' AND ref_id = $2`, [C.ong.u.cai.id, gros.data.id]);
  assert.equal(notifCaisse, 1, 'la caisse est prévenue de la sortie à valider');
  const refus = await appel('POST', `/projets/demandes/${gros.data.id}/decaisser`, 'cai', { ordre_id: og, journal_id: S.caisse, rubrique_code: 'ACT' });
  assert.equal(refus.status, 409);
  assert.equal(refus.code, 'SOLDE_INSUFFISANT');
  assert.match(refus.message, /il manque/);
  const s = await appel('POST', `/projets/demandes/${gros.data.id}/solliciter`, 'cai', { journal_id: S.caisse, rubrique_code: 'ACT' });
  assert.equal(s.status, 201, s.message);
  assert.equal(s.data.manque, Math.round((900000 - caisse.solde) * 100) / 100);
  const [ligne] = await sql(`SELECT montant, intitule FROM depenses_attente WHERE tenant_id = $1 AND rubrique_code = 'ACT'`, [C.ong.tenant]);
  assert.equal(Number(ligne.montant), s.data.manque);
  assert.match(ligne.intitule, /Réappro\. caisse/);
  const fiche = (await appel('GET', `/projets/demandes/${gros.data.id}`, 'cai')).data;
  assert.equal(fiche.sollicitations.length, 1);
  assert.equal(fiche.sollicitations[0].statut_demande_fonds, 'en_attente');
  await new Promise((r) => setTimeout(r, 400));
  const [{ n: notifDir }] = await sql(`SELECT count(*)::int AS n FROM notifications WHERE destinataire_id = $1 AND type = 'demande_fonds_sollicitation'`, [C.ong.u.dir.id]);
  assert.equal(notifDir, 1, 'directeur prévenu du réapprovisionnement');
  // La banque n'est pas concernée par le contrôle du solde (découvert possible) ni par la sollicitation.
  assert.equal((await appel('POST', `/projets/demandes/${gros.data.id}/solliciter`, 'cai', { journal_id: S.banque, rubrique_code: 'ACT' })).status, 400);
});

test('Équipe des projets : créer un chef de projet et un responsable d\'activité (ONG seulement)', async () => {
  assert.equal((await appel('POST', '/projets/equipe', 'dir', { fonction: 'chef_projet', username: `x-${sfx}`, password: 'MotDePasse1' }, 'pme')).status, 403, 'PME');
  assert.equal((await appel('POST', '/projets/equipe', 'cai', { fonction: 'chef_projet', username: `x-${sfx}`, password: 'MotDePasse1' })).status, 403, 'caissière');
  assert.equal((await appel('POST', '/projets/equipe', 'dir', { fonction: 'chef_projet', username: `x-${sfx}`, password: 'court' })).status, 400);
  const [{ id: p2 }] = await sql(`INSERT INTO activites (tenant_id, nom, type) VALUES ($1, 'Eau potable', 'projet') RETURNING id`, [C.ong.tenant]);
  const [{ id: a2 }] = await sql(`INSERT INTO activites (tenant_id, nom, type, projet_id) VALUES ($1, 'Forage de Mfou', 'activite', $2) RETURNING id`, [C.ong.tenant, p2]);
  const chef = await appel('POST', '/projets/equipe', 'dir', { fonction: 'chef_projet', username: `chef2-${sfx}`, email: `chef2-${sfx}@test.cm`, password: 'MotDePasse1', projet_id: p2 });
  assert.equal(chef.status, 201, chef.message);
  const resp = await appel('POST', '/projets/equipe', 'dir', { fonction: 'responsable_activite', username: `resp2-${sfx}`, password: 'MotDePasse1', activite_id: a2 });
  assert.equal(resp.status, 201, resp.message);
  assert.equal((await appel('POST', '/projets/equipe', 'dir', { fonction: 'chef_projet', username: `chef2-${sfx}`, password: 'MotDePasse1' })).status, 409);
  const [u] = await sql(`SELECT u.role, r.nom, r.tenant_id FROM users u JOIN roles r ON r.id = u.custom_role_id WHERE u.id = $1`, [chef.data.id]);
  assert.deepEqual([u.role, u.nom, u.tenant_id], ['collaborateur', 'Chef de projet', C.ong.tenant]);
  const [{ chef_projet_id: cp }] = await sql('SELECT chef_projet_id FROM activites WHERE id = $1', [p2]);
  assert.equal(cp, chef.data.id);
  const [{ n }] = await sql(`SELECT count(*)::int AS n FROM user_modules WHERE user_id = $1 AND module_code = 'caisse' AND actif`, [resp.data.id]);
  assert.equal(n, 1, 'rattaché à NJ FINANCE');
  // Le responsable créé peut aussitôt demander des fonds pour son activité.
  C.ong.u.resp2 = { token: jwt.sign({ sub: resp.data.id, username: `resp2-${sfx}`, role: 'collaborateur', tenantId: C.ong.tenant }, SECRET, { expiresIn: '1h' }) };
  const ctx = (await appel('GET', '/projets/demandes/contexte', 'resp2')).data;
  assert.deepEqual(ctx.activites.map((x) => x.id), [a2]);
  const equipe = (await appel('GET', '/projets/equipe', 'dir')).data;
  assert.ok(equipe.some((x) => x.username === `chef2-${sfx}` && x.fonction === 'chef_projet' && x.projets.length === 1));
});

test('Équipe des projets : invitation par e-mail pour créer son mot de passe', async () => {
  const sansMail = await appel('POST', '/projets/equipe', 'dir', { fonction: 'responsable_activite', username: `resp3-${sfx}` });
  assert.equal(sansMail.code, 'EMAIL_REQUIS');
  const r = await appel('POST', '/projets/equipe', 'dir', { fonction: 'responsable_activite', username: `resp3-${sfx}`, email: `resp3-${sfx}@test.cm` });
  assert.equal(r.status, 201, r.message);
  assert.ok(r.data.invitation && r.data.invitation.email === `resp3-${sfx}@test.cm`, 'résultat de l\'envoi rendu');
  const [inv] = await sql(`SELECT nature, expire_le > NOW() + INTERVAL '71 hours' AS long FROM password_resets WHERE user_id = $1 AND utilise_le IS NULL`, [r.data.id]);
  assert.deepEqual([inv.nature, inv.long], ['invitation', true], 'lien de 72 heures');
  // Renvoyer : l'ancien lien tombe, un seul reste valable.
  assert.equal((await appel('POST', `/projets/equipe/${r.data.id}/invitation`, 'cai')).status, 403);
  assert.equal((await appel('POST', `/projets/equipe/${C.ong.u.cai.id}/invitation`, 'dir')).status, 404, 'hors équipe');
  assert.equal((await appel('POST', `/projets/equipe/${r.data.id}/invitation`, 'dir')).status, 200);
  const liens = await sql('SELECT id FROM password_resets WHERE user_id = $1 AND utilise_le IS NULL', [r.data.id]);
  assert.equal(liens.length, 1);
  // Le membre ouvre le lien et choisit son mot de passe, puis se connecte.
  const jeton = crypto.randomBytes(24).toString('base64url');
  await sql('UPDATE password_resets SET token_hash = $2 WHERE id = $1', [liens[0].id, crypto.createHash('sha256').update(jeton).digest('hex')]);
  const v0 = await (await fetch(`${BASE}/auth/reinitialisation/${jeton}`)).json();
  const v = v0.data ?? v0;
  assert.deepEqual([v.identifiant, v.invitation], [`resp3-${sfx}`, true]);
  const choix = await fetch(`${BASE}/auth/reinitialisation/${jeton}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mot_de_passe: 'Bienvenue2026' }) });
  assert.equal(choix.status, 200);
  const login = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: `resp3-${sfx}`, password: 'Bienvenue2026' }) });
  assert.equal(login.status, 200, 'connexion avec le mot de passe choisi');
});
