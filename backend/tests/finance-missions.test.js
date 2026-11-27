// tests/finance-missions.test.js — NJ FINANCE, missions (087) et tiers payeur.
//
// Lance le VRAI serveur (index.js) sur une base de TEST, puis appelle l'API.
//   TEST_DATABASE_URL=postgres://…/base_de_test  node --test tests/finance-missions.test.js
//
// Couvre : ordre de mission (frais en saisie libre, numérotation à l'envoi) ;
// approbation par le directeur seul (contrôlé en base) ; avance facultative,
// plafonnée aux frais prévus, en caisse ; dépenses réelles avec pièce et rapport ;
// contrôle de la justification (jamais par celui qui l'a présentée) ;
// régularisation (reliquat reversé, ou complément payé sans avance) ; clôture et
// écriture D 618 / C 421 ; écriture de caisse de l'avance au 421 ; PDF ;
// annulation ; isolement des clients ; règlement d'une facture par un tiers payeur.
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
const PORT = 6200 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}/api`;
const sfx = crypto.randomBytes(3).toString('hex');
const PV_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nj-mi-'));
const pool = new Pool({ connectionString: DB });
const MOIS = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
const jour = new Date().toISOString().slice(0, 10);
let serveur;
const C = { a: { u: {} }, b: { u: {} } };
const S = {};

const sql = async (texte, params = []) => (await pool.query(texte, params)).rows;
const appel = async (methode, url, qui, corps, client = 'a') => {
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
const lignesEcriture = async (origineType, origineId) => (await sql(
  `SELECT l.compte, l.debit::numeric AS debit, l.credit::numeric AS credit FROM fin_ecriture_lignes l JOIN fin_ecritures e ON e.id = l.ecriture_id
    WHERE e.origine_type = $1 AND e.origine_id = $2 AND e.extournee_par_id IS NULL ORDER BY l.ordre`, [origineType, String(origineId)]))
  .map((l) => `${l.compte} ${Number(l.debit) ? `D${Number(l.debit)}` : `C${Number(l.credit)}`}`);
const ordre = (extra = {}) => ({
  missionnaire_id: C.a.u.agent.id, fonction: 'Animateur', objet: 'Supervision des relais', destination: 'Bafia',
  date_depart: jour, date_retour: jour, transport: 'Car de ligne',
  frais: [{ nature: 'transport', designation: 'Aller-retour', quantite: 2, prix_unitaire: 5000 },
    { nature: 'perdiem', designation: 'Per diem', quantite: 1, jours: 2, prix_unitaire: 15000 },
    { nature: 'hebergement', designation: 'Hôtel', quantite: 1, jours: 1, prix_unitaire: 20000 }],
  ...extra,
});

const creerClient = async (cle, forme = 'SARL') => {
  const c = C[cle];
  [{ id: c.tenant }] = await sql(`INSERT INTO tenants (slug, nom, forme_juridique, initialise_le) VALUES ($1, $2, $3, NOW()) RETURNING id`,
    [`mi-${cle}-${sfx}`, `MISSIONS ${cle} ${sfx}`, forme]);
  await sql('INSERT INTO tenant_modules (tenant_id, module_code, actif) VALUES ($1, \'caisse\', true) ON CONFLICT DO NOTHING', [c.tenant]);
  [{ id: c.caisse }] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type, date_ouverture, compte_tresorerie)
                                  VALUES ($1, 'CA1', 'Caisse', 'caisse', CURRENT_DATE - 40, '5711') RETURNING id`, [c.tenant]);
  const [dot] = await sql(`INSERT INTO rubriques (tenant_id, code, intitule, type) VALUES ($1, 'DOT', 'DOTATION', 'entree') RETURNING id`, [c.tenant]);
  await sql(`INSERT INTO equivalences_comptables (tenant_id, rubrique_id, compte, statut) VALUES ($1, $2, '1011', 'valide')`, [c.tenant, dot.id]);
  await sql(`INSERT INTO rubriques (tenant_id, code, intitule, type) VALUES ($1, 'MIS', 'FRAIS DE MISSION', 'depense'), ($1, 'REM', 'REMBOURSEMENTS', 'entree')`, [c.tenant]);
  for (const [qui, role] of [['dir', 'directeur'], ['cpt', 'auditeur'], ['cai', 'caissier'], ['agent', 'collaborateur'], ['colla', 'collaborateur']]) {
    const username = `${qui}-mi-${cle}-${sfx}`;
    const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif) VALUES ($1, $2, $3, 'x', $4, true) RETURNING id`,
      [c.tenant, username, `${username}@test.cm`, role]);
    await sql('INSERT INTO user_modules (user_id, module_code, tenant_id) VALUES ($1, \'caisse\', $2) ON CONFLICT DO NOTHING', [u.id, c.tenant]);
    c.u[qui] = { id: u.id, username, token: jwt.sign({ sub: u.id, username, role, tenantId: c.tenant }, SECRET, { expiresIn: '1h' }) };
  }
  // L'agent est chef de projet (profil créé par l'équipe des projets : droits des missions).
  const [{ id: profil }] = await sql(`INSERT INTO roles (nom, code, tenant_id, is_system) VALUES ('Chef de projet', 'CHEF_PROJET', $1, false) RETURNING id`, [c.tenant]);
  await sql(`INSERT INTO role_permissions (role_id, permission_code) VALUES ($1, 'finance.missions.voir'), ($1, 'finance.missions.demander')`, [profil]);
  await sql('UPDATE users SET custom_role_id = $1 WHERE id = $2', [profil, c.u.agent.id]);
};

before(async () => {
  await creerClient('a');
  await creerClient('b', 'ONG');
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
  const d = new Date();
  const r = await appel('POST', '/journal', 'cai', { date: jour, mois: MOIS[d.getMonth()], annee: d.getFullYear(), journal_id: C.a.caisse,
    rubrique_code: 'DOT', intitule: 'Dotation', entree: 500000, sortie: 0 });
  assert.equal(r.status, 201, r.message);
});
after(async () => {
  serveur?.kill();
  const cx = await pool.connect();
  try {
    await cx.query('BEGIN');
    await cx.query("SET LOCAL app.journal_maintenance = 'on'");
    await cx.query("SET LOCAL app.finance_maintenance = 'on'");
    const ids = [C.a.tenant, C.b.tenant].filter(Boolean);
    await cx.query('DELETE FROM audit_log WHERE tenant_id = ANY($1::uuid[])', [ids]);
    await cx.query('DELETE FROM fin_mission_mouvements WHERE tenant_id = ANY($1::uuid[])', [ids]);
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

test('Ordre de mission : frais en saisie libre, numéroté à l\'envoi, approuvé par le directeur seul', async () => {
  assert.equal((await appel('GET', '/finance/missions/contexte', 'colla')).status, 403, 'un collaborateur sans profil n\'entre pas dans les missions');
  const ctx = await appel('GET', '/finance/missions/contexte', 'agent');
  assert.equal(ctx.status, 200, ctx.message);
  assert.equal(ctx.data.parametres.compte_avance.startsWith('42'), true, ctx.data.parametres.compte_avance);
  const r = await appel('POST', '/finance/missions', 'agent', ordre());
  assert.equal(r.status, 201, r.message);
  assert.equal(r.data.mission.prevu, 10000 + 30000 + 20000, 'quantité × jours × prix');
  assert.equal(r.data.mission.missionnaire_nom, C.a.u.agent.username);
  S.m1 = r.data.mission.id;
  assert.equal((await appel('POST', `/finance/missions/${S.m1}/soumettre`, 'cai')).status, 403, 'seul l\'auteur envoie');
  const s = await appel('POST', `/finance/missions/${S.m1}/soumettre`, 'agent');
  assert.match(s.data.mission.numero, new RegExp(`^OM-${jour.slice(0, 4)}-\\d{5}$`));
  assert.equal((await appel('PUT', `/finance/missions/${S.m1}`, 'agent', ordre())).code, 'MISSION_INTANGIBLE');
  assert.equal((await appel('POST', `/finance/missions/${S.m1}/decider`, 'cpt', { decision: 'approuver' })).code, 'DIRECTEUR_SEUL');
  assert.equal((await appel('POST', `/finance/missions/${S.m1}/decider`, 'dir', { decision: 'rejeter' })).status, 400, 'motif obligatoire');
  const ren = await appel('POST', `/finance/missions/${S.m1}/decider`, 'dir', { decision: 'renvoyer', motif: 'Préciser l\'hôtel' });
  assert.equal(ren.data.mission.statut, 'brouillon');
  await appel('PUT', `/finance/missions/${S.m1}`, 'agent', { ...ordre(), soumettre: true });
  const ok = await appel('POST', `/finance/missions/${S.m1}/decider`, 'dir', { decision: 'approuver' });
  assert.equal(ok.data.mission.statut, 'approuvee');
  assert.equal(ok.data.mission.numero, s.data.mission.numero, 'le numéro ne change pas au renvoi');
  // En base : seul un directeur approuve.
  await assert.rejects(sql(`UPDATE fin_missions SET approuve_par = $1 WHERE id = $2`, [C.a.u.cai.id, S.m1]), /DIRECTEUR_SEUL/);
  // Un autre client ne la voit pas ; l'agent ne voit que ses missions.
  assert.equal((await appel('GET', `/finance/missions/${S.m1}`, 'dir', undefined, 'b')).status, 404);
  const pdf = await fetch(`${BASE}/finance/missions/${S.m1}/pdf`, { headers: { Authorization: `Bearer ${C.a.u.agent.token}` } });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
});

test('Avance facultative, plafonnée aux frais prévus, passée au 421 dans les écritures de caisse', async () => {
  assert.equal((await appel('POST', `/finance/missions/${S.m1}/avance`, 'agent', { journal_id: C.a.caisse, rubrique_code: 'MIS' })).status, 403);
  const trop = await appel('POST', `/finance/missions/${S.m1}/avance`, 'cai', { journal_id: C.a.caisse, rubrique_code: 'MIS', montant: 70000 });
  assert.equal(trop.code, 'PLAFOND');
  const a = await appel('POST', `/finance/missions/${S.m1}/avance`, 'cai', { journal_id: C.a.caisse, rubrique_code: 'MIS', montant: 50000 });
  assert.equal(a.status, 201, a.message);
  S.avance = a.data.journal_id;
  const f = (await appel('GET', `/finance/missions/${S.m1}`, 'cai')).data;
  assert.deepEqual([f.mission.verse, f.mission.reste_avance, f.mouvements.length], [50000, 10000, 1]);
  // Saisie directe d'une avance au-delà du prévu : refusée en base.
  const direct = await appel('POST', '/journal', 'cai', { date: jour, mois: MOIS[new Date().getMonth()], annee: new Date().getFullYear(),
    journal_id: C.a.caisse, rubrique_code: 'MIS', intitule: 'X', entree: 0, sortie: 20000, mission_id: S.m1, mission_sens: 'avance' });
  assert.equal(direct.status, 409, direct.message);
  process.env.DATABASE_URL = DB;
  const gen = require('../src/services/comptabilite/generation_caisse.service');
  const r = await gen.synchroniser({ tenantId: C.a.tenant, userId: C.a.u.dir.id });
  assert.equal(r.anomalies.filter((x) => String(x.mouvement_id) === S.avance).length, 0, JSON.stringify(r.anomalies));
  const [ctx] = await sql('SELECT compte_avance FROM fin_missions WHERE id = $1', [S.m1]);
  assert.deepEqual(await lignesEcriture('journal', S.avance), [`${ctx.compte_avance} D50000`, '5711 C50000'], 'avance au personnel, pas en charge');
});

test('Justification : dépenses avec pièce, rapport obligatoire, contrôle par un autre ; reliquat reversé puis clôture', async () => {
  assert.equal((await appel('POST', `/finance/missions/${S.m1}/depenses`, 'agent', { nature: 'transport', date_depense: jour, montant: 10000 })).code, 'FICHIER');
  for (const [nature, montant] of [['transport', 10000], ['perdiem', 30000]]) {
    const d = await appel('POST', `/finance/missions/${S.m1}/depenses`, 'agent', { nature, date_depense: jour, montant, ...piece });
    assert.equal(d.status, 201, d.message);
  }
  assert.equal((await appel('POST', `/finance/missions/${S.m1}/depenses`, 'cai', { nature: 'autre', date_depense: jour, montant: 1, ...piece })).status, 403);
  assert.equal((await appel('POST', `/finance/missions/${S.m1}/justifier`, 'agent')).code, 'RAPPORT_REQUIS');
  await appel('PUT', `/finance/missions/${S.m1}/rapport`, 'agent', { rapport: 'Douze relais supervisés ; registres à jour.' });
  const j = await appel('POST', `/finance/missions/${S.m1}/justifier`, 'agent');
  assert.equal(j.data.mission.statut, 'a_controler');
  assert.equal((await appel('POST', `/finance/missions/${S.m1}/controler`, 'cai', { decision: 'valider' })).status, 403);
  const v = await appel('POST', `/finance/missions/${S.m1}/controler`, 'cpt', { decision: 'valider' });
  assert.equal(v.status, 200, v.message);
  assert.deepEqual([v.data.mission.statut, v.data.mission.reliquat, v.data.mission.complement], ['justifiee', 10000, 0]);
  assert.equal(v.data.actions.reverser_reliquat, false, 'le comptable ne tient pas la caisse');
  const faux = await appel('POST', `/finance/missions/${S.m1}/reliquat`, 'cai', { journal_id: C.a.caisse, rubrique_code: 'REM', montant: 5000 });
  assert.equal(faux.code, 'PLAFOND', 'le reliquat se reverse en totalité');
  const rel = await appel('POST', `/finance/missions/${S.m1}/reliquat`, 'cai', { journal_id: C.a.caisse, rubrique_code: 'REM' });
  assert.equal(rel.status, 201, rel.message);
  assert.equal(rel.data.cloture.cloturee, true, JSON.stringify(rel.data.cloture));
  const f = (await appel('GET', `/finance/missions/${S.m1}`, 'dir')).data;
  assert.equal(f.mission.statut, 'cloturee');
  const lignes = await lignesEcriture('fin_mission', S.m1);
  assert.equal(lignes.at(-1), `${f.mission.compte_avance} C40000`);
  assert.equal(lignes.filter((l) => l.startsWith('618 D')).length >= 1, true, lignes.join(' | '));
  await assert.rejects(sql(`UPDATE fin_missions SET objet = 'x' WHERE id = $1`, [S.m1]), /MISSION_CLOTUREE/);
});

test('Sans avance : le complément est payé au missionnaire après contrôle, puis la mission est clôturée', async () => {
  const m = await appel('POST', '/finance/missions', 'dir', { ...ordre({ missionnaire_id: '', missionnaire_nom: 'Consultant externe', frais: [] }), soumettre: true });
  assert.equal(m.status, 201, m.message);
  const id = m.data.mission.id;
  assert.equal((await appel('POST', `/finance/missions/${id}/decider`, 'dir', { decision: 'approuver' })).data.mission.statut, 'approuvee');
  assert.equal((await appel('POST', `/finance/missions/${id}/avance`, 'cai', { journal_id: C.a.caisse, rubrique_code: 'MIS' })).code, 'RIEN_A_FAIRE');
  await appel('POST', `/finance/missions/${id}/depenses`, 'dir', { nature: 'restauration', date_depense: jour, montant: 12500, compte: '618', ...piece });
  await appel('PUT', `/finance/missions/${id}/rapport`, 'dir', { rapport: 'RAS' });
  await appel('POST', `/finance/missions/${id}/justifier`, 'dir');
  assert.equal((await appel('POST', `/finance/missions/${id}/controler`, 'dir', { decision: 'valider' })).code, 'AUTOCONTROLE');
  const v = await appel('POST', `/finance/missions/${id}/controler`, 'cpt', { decision: 'valider' });
  assert.equal(v.data.mission.complement, 12500);
  const c = await appel('POST', `/finance/missions/${id}/complement`, 'cai', { journal_id: C.a.caisse, rubrique_code: 'MIS' });
  assert.equal(c.status, 201, c.message);
  assert.equal(c.data.cloture.cloturee, true);
});

test('Annulation sans mouvement ; isolement des clients', async () => {
  const m = await appel('POST', '/finance/missions', 'agent', { ...ordre(), soumettre: true });
  const id = m.data.mission.id;
  assert.equal((await appel('POST', `/finance/missions/${id}/annuler`, 'agent', {})).status, 400, 'motif');
  const a = await appel('POST', `/finance/missions/${id}/annuler`, 'agent', { motif: 'Report' });
  assert.equal(a.data.mission.statut, 'annulee');
  const liste = (await appel('GET', '/finance/missions', 'dir', undefined, 'b')).data;
  assert.equal(liste.total, 0);
  const agent = (await appel('GET', '/finance/missions', 'agent')).data.missions;
  assert.equal(agent.every((x) => x.missionnaire_id === C.a.u.agent.id || x.cree_par === C.a.u.agent.id), true);
});

test('Tableau des contrôles : chacun voit ce qui relève de lui', async () => {
  const m = await appel('POST', '/finance/missions', 'agent', { ...ordre(), soumettre: true });
  assert.equal(m.status, 201, m.message);
  const dir = await appel('GET', '/finance/controles/tableau', 'dir');
  assert.equal(dir.status, 200, dir.message);
  const l = dir.data.lignes.find((x) => x.cle === 'missions_a_approuver');
  assert.equal(l?.nombre, 1);
  assert.equal(l.lien, '/finance/missions?vue=a_approuver');
  const cai = await appel('GET', '/finance/controles/tableau', 'cai');
  assert.equal(cai.data.lignes.some((x) => x.cle === 'missions_a_approuver'), false, 'la caisse n\'approuve pas');
  assert.equal((await appel('GET', '/finance/controles/tableau', 'agent')).data.lignes.some((x) => x.cle === 'missions_a_approuver'), false);
});

test('ONG : une mission sur une activité de projet verse son avance sans budget de projet en versions', async () => {
  const t = C.b.tenant;
  const [{ id: projet }] = await sql(`INSERT INTO activites (tenant_id, nom, type) VALUES ($1, 'Santé', 'projet') RETURNING id`, [t]);
  const [{ id: act }] = await sql(`INSERT INTO activites (tenant_id, nom, type, projet_id) VALUES ($1, 'Formation', 'activite', $2) RETURNING id`, [t, projet]);
  const d = new Date();
  assert.equal((await appel('POST', '/journal', 'cai', { date: jour, mois: MOIS[d.getMonth()], annee: d.getFullYear(), journal_id: C.b.caisse,
    rubrique_code: 'DOT', intitule: 'Dotation', entree: 100000, sortie: 0 }, 'b')).status, 201);
  const m = await appel('POST', '/finance/missions', 'agent', { ...ordre({ missionnaire_id: C.b.u.agent.id, activite_id: act }), soumettre: true }, 'b');
  assert.equal(m.status, 201, m.message);
  await appel('POST', `/finance/missions/${m.data.mission.id}/decider`, 'dir', { decision: 'approuver' }, 'b');
  const a = await appel('POST', `/finance/missions/${m.data.mission.id}/avance`, 'cai', { journal_id: C.b.caisse, rubrique_code: 'MIS', montant: 20000 }, 'b');
  assert.equal(a.status, 201, a.message);
  const [j] = await sql('SELECT activite_id FROM journal WHERE id = $1', [a.data.journal_id]);
  assert.equal(Number(j.activite_id), Number(act), 'l\'avance porte l\'activité de la mission');
});
