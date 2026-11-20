// tests/projets-p5.test.js — Ligne budgétaire par unité : quantité × jours × prix unitaire,
// quantité réalisée sur les justificatifs (migration 072).
//
// Lance le VRAI serveur (index.js) sur une base de TEST, puis appelle l API.
// La base doit être migrée jusqu à 072.
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
const PV_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nj-p5-'));
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
    [`proj5-${sfx}`, `PROJ5 ${sfx}`]);
  await sql(`INSERT INTO rubriques (tenant_id, code, intitule, type, nature_recette) VALUES
             ($1, 'SUB', 'SUBVENTION', 'entree', 'subvention'), ($1, 'D1', 'FRAIS ACTIVITES', 'depense', NULL)`, [C.tenant]);
  [{ id: C.journal }] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type, date_ouverture)
                                   VALUES ($1, 'BQ1', 'Banque', 'banque', CURRENT_DATE - 40) RETURNING id`, [C.tenant]);
  for (const [qui, role] of [['dir', 'directeur'], ['cpt', 'auditeur'], ['cai', 'caissier'], ['chef', 'caissier'], ['resp', 'caissier']]) {
    const username = `${qui}-p5-${sfx}`;
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
const deposerP5 = (extra) => appel('POST', `/projets/${S.projet}/justificatifs`, 'resp', {
  date_piece: jour, libelle: 'Pièce', fichier, ...extra,
});

const budgetPut = (lignes) => appel('PUT', `/projets/${S.projet}/budgets/${S.b1}`, 'chef', { lignes });

test('Budget : ligne par unité = quantité × jours × prix unitaire (le montant envoyé est ignoré)', async () => {
  const b = await appel('POST', `/projets/${S.projet}/budgets`, 'chef');
  assert.equal(b.status, 201, b.message);
  S.b1 = b.data.id;
  const r = await budgetPut([
    { activite_id: S.atelier, postes: [
      { libelle: 'Déjeuner', mode: 'unite', unite: 'participant', quantite: 25, jours: 3, prix_unitaire: 2500, montant: 1 },
      { libelle: 'Salle', montant: 60000 },
      { libelle: 'Kits', mode: 'unite', unite: 'kit', quantite: '1,5', jours: '', prix_unitaire: '0,33' }] },
    { activite_id: S.transport, montant: 100000 },
  ]);
  assert.equal(r.status, 200, r.message);
  // Quantité nulle ou prix négatif : refusés.
  for (const p of [{ quantite: 0, jours: 1, prix_unitaire: 10 }, { quantite: 2, jours: 0, prix_unitaire: 10 }, { quantite: 2, jours: 1, prix_unitaire: -1 }]) {
    const bad = await appel('PUT', `/projets/${S.projet}/budgets/${S.b1}`, 'chef', { lignes: [{ activite_id: S.atelier, postes: [{ libelle: 'X', mode: 'unite', ...p }] }] });
    assert.equal(bad.code, 'LIGNES_INVALIDES');
  }
  let d = await detail('chef');
  const l = d.budgets[0].lignes.find((x) => x.activite_id === S.atelier);
  const dej = l.postes.find((p) => p.libelle === 'Déjeuner');
  assert.deepEqual([dej.mode, dej.unite, dej.quantite, dej.jours, dej.prix_unitaire, dej.montant], ['unite', 'participant', 25, 3, 2500, 187500]);
  assert.equal(l.postes.find((p) => p.libelle === 'Kits').montant, 0.5);   // 1,5 × 1 jour × 0,33 = 0,495 → 0,50
  assert.equal(l.postes.find((p) => p.libelle === 'Salle').mode, 'forfait');
  assert.equal(l.montant, 247500.5);
  assert.equal((await appel('POST', `/projets/${S.projet}/budgets/${S.b1}/soumettre`, 'chef')).status, 200);
  assert.equal((await appel('POST', `/projets/${S.projet}/budgets/${S.b1}/valider`, 'dir')).status, 200);
  d = await detail();
  const pd = poste(d, 'Déjeuner');
  assert.equal(pd.prevu_unites, 75);
  assert.equal(pd.realise_unites, 0);
  S.cleDej = pd.cle;
  S.cleSalle = poste(d, 'Salle').cle;
});

test('La base refuse un montant différent du produit', async () => {
  const cx = await pool.connect();
  try {
    await cx.query('BEGIN');
    await cx.query("SET LOCAL app.journal_maintenance = 'on'");
    await assert.rejects(cx.query("UPDATE projet_budget_postes SET montant = montant + 1 WHERE cle = $1", [S.cleDej]), /projet_budget_postes_mode_chk/);
  } finally {
    await cx.query('ROLLBACK');
    cx.release();
  }
});

test('Justificatif : quantité réalisée obligatoire sur une ligne par unité, comparée au prévu', async () => {
  assert.equal((await saisie({ rubrique_code: 'D1', sortie: 200000, activite_id: S.atelier })).status, 201);
  const sans = await deposerP5({ activite_id: S.atelier, poste_cle: S.cleDej, montant: 55000 });
  assert.equal(sans.code, 'QUANTITE_REQUISE');
  const j1 = await deposerP5({ activite_id: S.atelier, poste_cle: S.cleDej, montant: 55000, quantite_realisee: 22 });
  assert.equal(j1.status, 201, j1.message);
  const j2 = await deposerP5({ activite_id: S.atelier, poste_cle: S.cleDej, montant: 110000, quantite_realisee: '22', jours_realises: 2 });
  assert.equal(j2.status, 201, j2.message);
  // Le plafond reste le montant de la ligne (187 500 − 165 000 = 22 500).
  const trop = await deposerP5({ activite_id: S.atelier, poste_cle: S.cleDej, montant: 30000, quantite_realisee: 10 });
  assert.equal(trop.code, 'DEPASSEMENT_LIGNE');
  // Ligne au forfait : pas de quantité demandée, rien n'est enregistré.
  const f = await deposerP5({ activite_id: S.atelier, poste_cle: S.cleSalle, montant: 60000, quantite_realisee: 5 });
  assert.equal(f.status, 201, f.message);
  const [rf] = await sql('SELECT quantite_realisee FROM projet_justificatifs WHERE id = $1', [f.data.id]);
  assert.equal(rf.quantite_realisee, null);

  for (const j of [j1, j2]) assert.equal((await appel('POST', `/projets/${S.projet}/justificatifs/${j.data.id}/valider`, 'cpt')).status, 200);
  const pd = poste(await detail(), 'Déjeuner');
  assert.equal(pd.realise_unites, 66);   // 22 × 1 + 22 × 2
  assert.equal(pd.prevu_unites, 75);
  assert.equal(pd.justifie, 165000);
  const liste = await appel('GET', `/projets/${S.projet}/justificatifs`, 'chef');
  const vu = (liste.data.justificatifs || liste.data).find((x) => x.id === j2.data.id);
  assert.deepEqual([vu.quantite_realisee, vu.jours_realises], [22, 2]);
  // Justificatif contrôlé : quantité figée.
  await assert.rejects(sql('UPDATE projet_justificatifs SET quantite_realisee = 1 WHERE id = $1', [j1.data.id]), /JUSTIFICATIF_INTANGIBLE/);
});

test('Révision : le détail par unité est recopié avec la même clé', async () => {
  const r = await appel('POST', `/projets/${S.projet}/budgets`, 'chef');
  assert.equal(r.status, 201, r.message);
  const d = await detail('chef');
  const br = d.budgets.find((b) => b.id === r.data.id);
  const dej = br.lignes.find((x) => x.activite_id === S.atelier).postes.find((p) => p.libelle === 'Déjeuner');
  assert.deepEqual([dej.cle, dej.mode, dej.quantite, dej.jours, dej.prix_unitaire], [S.cleDej, 'unite', 25, 3, 2500]);
});
