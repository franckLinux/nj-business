// tests/projets-p4.test.js — Remise globale, lignes budgétaires, blocage du dépassement (lot P4, migration 071).
//
// Lance le VRAI serveur (index.js) sur une base de TEST, puis appelle l'API.
//   TEST_DATABASE_URL=postgres://…/base_de_test  npm run test:projets
// La base doit être migrée jusqu'à 071. Les fichiers vont dans un dossier temporaire.
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
const PORT = 5400 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}/api`;
const sfx = crypto.randomBytes(3).toString('hex');
const PV_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nj-p4-'));
const pool = new Pool({ connectionString: DB });
let serveur;
const C = { u: {} };
const S = {};

const sql = async (texte, params = []) => (await pool.query(texte, params)).rows;
const appel = async (methode, url, qui, corps) => {
  const r = await fetch(BASE + url, {
    method: methode,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${C.u[qui].token}` },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.data ?? j, message: j.message ?? j.error, code: j.code ?? j.data?.code };
};
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n').toString('base64');
const fichier = { nom_fichier: 'facture.pdf', data_base64: PDF };
const MOIS = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
const auj = new Date();
const jour = auj.toISOString().slice(0, 10);
const saisie = (extra) => appel('POST', '/journal', 'cai', {
  date: jour, mois: MOIS[auj.getMonth()], annee: auj.getFullYear(), journal_id: C.journal, intitule: 'Test', entree: 0, sortie: 0, ...extra,
});
before(async () => {
  [{ id: C.tenant }] = await sql(`INSERT INTO tenants (slug, nom, forme_juridique, initialise_le) VALUES ($1, $2, 'ONG', NOW()) RETURNING id`,
    [`proj4-${sfx}`, `PROJ4 ${sfx}`]);
  await sql(`INSERT INTO rubriques (tenant_id, code, intitule, type, nature_recette) VALUES
             ($1, 'SUB', 'SUBVENTION', 'entree', 'subvention'), ($1, 'D1', 'FRAIS ACTIVITES', 'depense', NULL)`, [C.tenant]);
  [{ id: C.journal }] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type, date_ouverture)
                                   VALUES ($1, 'BQ1', 'Banque', 'banque', CURRENT_DATE - 40) RETURNING id`, [C.tenant]);
  for (const [qui, role] of [['dir', 'directeur'], ['cpt', 'auditeur'], ['cai', 'caissier'], ['chef', 'caissier'], ['resp', 'caissier']]) {
    const username = `${qui}-p4-${sfx}`;
    const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif)
                            VALUES ($1, $2, $3, 'x', $4, true) RETURNING id`, [C.tenant, username, `${username}@test.cm`, role]);
    C.u[qui] = { id: u.id, token: jwt.sign({ sub: u.id, username, role, tenantId: C.tenant }, SECRET, { expiresIn: '1h' }) };
  }
  [{ id: S.projet }] = await sql(`INSERT INTO activites (tenant_id, nom, type, chef_projet_id) VALUES ($1, 'Séminaire', 'projet', $2) RETURNING id`, [C.tenant, C.u.chef.id]);
  [{ id: S.atelier }] = await sql(`INSERT INTO activites (tenant_id, nom, type, projet_id, responsable_id) VALUES ($1, 'Atelier', 'activite', $2, $3) RETURNING id`, [C.tenant, S.projet, C.u.resp.id]);
  [{ id: S.transport }] = await sql(`INSERT INTO activites (tenant_id, nom, type, projet_id, responsable_id) VALUES ($1, 'Transport', 'activite', $2, $3) RETURNING id`, [C.tenant, S.projet, C.u.resp.id]);
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
  assert.equal((await saisie({ rubrique_code: 'SUB', entree: 1000000, projet_id: S.projet })).status, 201);
});
after(async () => {
  serveur?.kill();
  const cx = await pool.connect();
  try {
    await cx.query('BEGIN');
    await cx.query("SET LOCAL app.journal_maintenance = 'on'");
    await cx.query('DELETE FROM audit_log WHERE tenant_id = $1', [C.tenant]);
    await cx.query('DELETE FROM tenant_modules WHERE tenant_id = $1', [C.tenant]);
    await cx.query('DELETE FROM tenants WHERE id = $1', [C.tenant]);
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

const detail = async (qui = 'dir') => (await appel('GET', `/projets/${S.projet}`, qui)).data;
const act = (d, id) => d.activites.find((a) => a.id === id);
const poste = (d, lib) => act(d, S.atelier).postes.find((p) => p.libelle === lib);
const deposerP4 = (extra) => appel('POST', `/projets/${S.projet}/justificatifs`, 'resp', {
  date_piece: jour, libelle: 'Pièce', fichier, ...extra,
});

test('Budget : une activité se détaille en lignes ; son montant est leur somme', async () => {
  const b = await appel('POST', `/projets/${S.projet}/budgets`, 'chef');
  assert.equal(b.status, 201, b.message);
  S.b1 = b.data.id;
  const lignes = [
    { activite_id: S.atelier, montant: 999, postes: [
      { libelle: 'Pause café', montant: 75000 }, { libelle: 'Déjeuner', montant: 100000 }, { libelle: 'Logistique', montant: 50000 }] },
    { activite_id: S.transport, montant: 250000 },
  ];
  assert.equal((await appel('PUT', `/projets/${S.projet}/budgets/${S.b1}`, 'chef', { lignes })).status, 200);
  // Ligne sans libellé : refusée.
  const bad = await appel('PUT', `/projets/${S.projet}/budgets/${S.b1}`, 'chef', { lignes: [{ activite_id: S.atelier, postes: [{ libelle: ' ', montant: 1 }] }] });
  assert.equal(bad.code, 'LIGNES_INVALIDES');
  assert.equal((await appel('POST', `/projets/${S.projet}/budgets/${S.b1}/soumettre`, 'chef')).status, 200);
  assert.equal((await appel('POST', `/projets/${S.projet}/budgets/${S.b1}/valider`, 'dir')).status, 200);
  const d = await detail();
  const l = d.budgets[0].lignes.find((x) => x.activite_id === S.atelier);
  assert.equal(l.montant, 225000);
  assert.deepEqual(l.postes.map((p) => p.libelle), ['Pause café', 'Déjeuner', 'Logistique']);
  assert.equal(d.chiffres.budget_valide, 475000);
  assert.equal(poste(d, 'Logistique').budget, 50000);
  S.cleLog = poste(d, 'Logistique').cle;
  S.cleCafe = poste(d, 'Pause café').cle;
});

test('Remise de fonds : globale au projet ou à une activité', async () => {
  const g = await saisie({ rubrique_code: 'D1', sortie: 300000, activite_id: S.projet, beneficiaire: 'Chef de projet' });
  assert.equal(g.status, 201, g.message);
  assert.equal(g.data.projet.global, true);
  const a = await saisie({ rubrique_code: 'D1', sortie: 50000, activite_id: S.atelier });
  assert.equal(a.status, 201, a.message);
  // Budget total 475 000 : 350 000 remis, 125 000 restent.
  const trop = await saisie({ rubrique_code: 'D1', sortie: 130000, activite_id: S.projet });
  assert.equal(trop.code, 'DEPASSEMENT_BUDGET_PROJET');
  const d = await detail();
  assert.equal(d.remise_globale.alloue, 300000);
  assert.equal(d.chiffres.alloue, 350000);
  assert.equal(d.budget_reste_a_allouer, 125000);
  assert.ok(d.remises.some((r) => r.globale && r.sortie === 300000));
  // Hors budget de fonctionnement, global compris.
  const cc = await appel('GET', `/journal/controle-context?journal_id=${C.journal}&mois=${MOIS[auj.getMonth()]}&annee=${auj.getFullYear()}`, 'cai');
  assert.equal(cc.data.sorties_by_rubrique.D1 || 0, 0);
});

test('Justificatif : ligne budgétaire obligatoire quand l\'activité en a ; dépassement bloqué', async () => {
  assert.equal((await deposerP4({ activite_id: S.atelier, montant: 10000 })).code, 'LIGNE_REQUISE');
  const ok = await deposerP4({ activite_id: S.atelier, poste_cle: S.cleLog, montant: 45000, libelle: 'Location salle' });
  assert.equal(ok.status, 201, ok.message);
  S.pLog = ok.data.id;
  const trop = await deposerP4({ activite_id: S.atelier, poste_cle: S.cleLog, montant: 10000 });
  assert.equal(trop.status, 409);
  assert.equal(trop.code, 'DEPASSEMENT_LIGNE');
  assert.match(trop.message, /Logistique/);
  // Activité sans lignes : plafond de l'activité.
  assert.equal((await deposerP4({ activite_id: S.transport, montant: 260000 })).code, 'DEPASSEMENT_LIGNE');
  const t = await deposerP4({ activite_id: S.transport, montant: 200000, libelle: 'Billets de car' });
  assert.equal(t.status, 201, t.message);
  S.pTrans = t.data.id;
  const [row] = await sql('SELECT poste_libelle FROM projet_justificatifs WHERE id = $1', [S.pLog]);
  assert.equal(row.poste_libelle, 'Logistique');
});

test('Consommation lisible : utilisé = justifié, rapporté au remis', async () => {
  assert.equal((await appel('POST', `/projets/${S.projet}/justificatifs/${S.pLog}/valider`, 'cpt')).status, 200);
  assert.equal((await appel('POST', `/projets/${S.projet}/justificatifs/${S.pTrans}/valider`, 'cpt')).status, 200);
  const d = await detail();
  const at = act(d, S.atelier);
  assert.equal(at.alloue, 50000);
  assert.equal(at.justifie, 45000);
  assert.equal(at.taux_utilisation, 90);
  assert.equal(at.en_attente, 5000);
  assert.equal(at.statut_justification, 'en_attente');
  assert.equal(poste(d, 'Logistique').justifie, 45000);
  assert.equal(poste(d, 'Logistique').reste, 5000);
  // Transport : rien remis en direct, dépense justifiée sur la remise globale.
  const tr = act(d, S.transport);
  assert.equal(tr.statut_justification, 'sur_global');
  assert.equal(d.remise_globale.justifie, 200000);
  assert.equal(d.remise_globale.en_attente, 100000);
  assert.equal(d.chiffres.en_attente, 105000);
});

test('Bilan : la remise globale a sa ligne, au nom du chef de projet', async () => {
  const b = await appel('GET', '/projets/bilan', 'dir');
  const g = b.data.en_attente.find((l) => l.globale);
  assert.equal(g.alloue, 300000);
  assert.equal(g.en_attente, 100000);
  assert.equal(g.responsable_nom, `chef-p4-${sfx}`);
  assert.equal(b.data.en_attente.find((l) => l.activite_id === S.atelier).en_attente, 5000);
  assert.ok(b.data.validees.find((l) => l.activite_id === S.transport).sur_global);
  assert.equal(b.data.totaux.en_attente, 105000);
  assert.equal(b.data.totaux.justifie, 245000);
  // Le responsable ne voit pas la remise globale.
  const r = await appel('GET', '/projets/bilan', 'resp');
  assert.ok(![...r.data.en_attente, ...r.data.validees].some((l) => l.globale));
});

test('Révision : les lignes gardent leur clé ; jamais sous ce qui est justifié', async () => {
  const b = await appel('POST', `/projets/${S.projet}/budgets`, 'chef');
  assert.equal(b.status, 201, b.message);
  const d0 = await detail('chef');
  const brouillon = d0.budgets.find((x) => x.id === b.data.id);
  const l0 = brouillon.lignes.find((x) => x.activite_id === S.atelier);
  assert.equal(l0.postes.find((p) => p.libelle === 'Logistique').cle, S.cleLog);
  const postes = (log) => l0.postes.map((p) => ({ cle: p.cle, libelle: p.libelle, montant: p.libelle === 'Logistique' ? log : p.montant }));
  await appel('PUT', `/projets/${S.projet}/budgets/${b.data.id}`, 'chef', { lignes: [{ activite_id: S.atelier, postes: postes(40000) }, { activite_id: S.transport, montant: 250000 }] });
  const refus = await appel('POST', `/projets/${S.projet}/budgets/${b.data.id}/soumettre`, 'chef');
  assert.equal(refus.code, 'BUDGET_SOUS_JUSTIFIE');
  await appel('PUT', `/projets/${S.projet}/budgets/${b.data.id}`, 'chef', { lignes: [{ activite_id: S.atelier, postes: postes(70000) }, { activite_id: S.transport, montant: 250000 }] });
  assert.equal((await appel('POST', `/projets/${S.projet}/budgets/${b.data.id}/soumettre`, 'chef')).status, 200);
  assert.equal((await appel('POST', `/projets/${S.projet}/budgets/${b.data.id}/valider`, 'dir')).status, 200);
  // La pièce validée reste sur sa ligne ; il y a désormais de la place.
  const d = await detail();
  assert.equal(poste(d, 'Logistique').budget, 70000);
  assert.equal(poste(d, 'Logistique').justifie, 45000);
  assert.equal((await deposerP4({ activite_id: S.atelier, poste_cle: S.cleLog, montant: 20000 })).status, 201);
});

test('Lignes figées en base une fois le budget soumis', async () => {
  const [p] = await sql(`SELECT po.id FROM projet_budget_postes po JOIN projet_budgets b ON b.id = po.budget_id WHERE b.projet_id = $1 AND b.statut = 'valide' LIMIT 1`, [S.projet]);
  await assert.rejects(sql('UPDATE projet_budget_postes SET montant = 1 WHERE id = $1', [p.id]), /BUDGET_FIGE/);
});

// ── Suppression (20/11/2026) ────────────────────────────────────────────────
test('Suppression : refusée dès que de l\'argent a touché le projet ou l\'activité', async () => {
  const r = await appel('DELETE', `/projets/${S.projet}`, 'dir');
  assert.equal(r.status, 409);
  assert.equal(r.code, 'PROJET_UTILISE');
  assert.match(r.message, /Clôturez-le/);
  // Le chef de projet ne supprime pas un projet (direction seulement).
  assert.equal((await appel('DELETE', `/projets/${S.projet}`, 'chef')).status, 403);
  // Activité avec remise : refusée.
  assert.equal((await appel('DELETE', `/projets/${S.projet}/activites/${S.atelier}`, 'chef')).code, 'ACTIVITE_UTILISEE');
});

test('Suppression : un projet sans mouvement part avec ses activités et ses budgets, même validé', async () => {
  const p = await appel('POST', '/projets', 'dir', { nom: 'Projet de test à supprimer', chef_projet_id: C.u.chef.id });
  assert.equal(p.status, 201, p.message);
  const a1 = await appel('POST', `/projets/${p.data.id}/activites`, 'chef', { nom: 'Activité test 1' });
  const a2 = await appel('POST', `/projets/${p.data.id}/activites`, 'chef', { nom: 'Activité test 2' });
  const b = await appel('POST', `/projets/${p.data.id}/budgets`, 'chef');
  await appel('PUT', `/projets/${p.data.id}/budgets/${b.data.id}`, 'chef', { lignes: [
    { activite_id: a1.data.id, postes: [{ libelle: 'Ligne A', montant: 1000 }] }, { activite_id: a2.data.id, montant: 2000 }] });
  // Activité présente seulement dans un brouillon : supprimable.
  const a3 = await appel('POST', `/projets/${p.data.id}/activites`, 'chef', { nom: 'Activité test 3' });
  assert.equal((await appel('DELETE', `/projets/${p.data.id}/activites/${a3.data.id}`, 'chef')).status, 200);
  assert.equal((await appel('POST', `/projets/${p.data.id}/budgets/${b.data.id}/soumettre`, 'chef')).status, 200);
  assert.equal((await appel('POST', `/projets/${p.data.id}/budgets/${b.data.id}/valider`, 'dir')).status, 200);
  // Activité dans un budget validé : refusée (désactiver).
  assert.equal((await appel('DELETE', `/projets/${p.data.id}/activites/${a2.data.id}`, 'chef')).code, 'ACTIVITE_AU_BUDGET');
  // Le projet entier, lui, se supprime : aucun argent ne l'a touché.
  const del = await appel('DELETE', `/projets/${p.data.id}`, 'dir');
  assert.equal(del.status, 200, del.message);
  const [{ n }] = await sql(`SELECT (SELECT COUNT(*) FROM activites WHERE id = $1 OR projet_id = $1)
                                  + (SELECT COUNT(*) FROM projet_budgets WHERE projet_id = $1) AS n`, [p.data.id]);
  assert.equal(Number(n), 0);
  const [log] = await sql(`SELECT action, ancienne_valeur FROM audit_log WHERE tenant_id = $1 AND entite = 'projets' AND entite_id = $2`, [C.tenant, String(p.data.id)]);
  assert.equal(log.action, 'DELETE_PROJET');
  assert.equal(log.ancienne_valeur.nom, 'Projet de test à supprimer');
  // Les garde-fous restent actifs hors de cette transaction.
  const [bv] = await sql(`SELECT id FROM projet_budgets WHERE projet_id = $1 AND statut = 'valide'`, [S.projet]);
  await assert.rejects(sql('DELETE FROM projet_budgets WHERE id = $1', [bv.id]), /BUDGET_FIGE/);
});
