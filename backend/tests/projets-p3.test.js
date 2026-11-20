// tests/projets-p3.test.js — Justificatifs, archives et bilan des projets (lot P3, migration 070).
//
// Lance le VRAI serveur (index.js) sur une base de TEST, puis appelle l'API.
//   TEST_DATABASE_URL=postgres://…/base_de_test  npm run test:projets
// La base doit être migrée jusqu'à 070. Les fichiers vont dans un dossier temporaire.
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
const PV_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nj-justif-'));
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
const deposer = (qui, extra) => appel('POST', `/projets/${S.projet}/justificatifs`, qui, {
  activite_id: S.act1, date_piece: jour, montant: 100000, libelle: 'Achat de tuyaux', fournisseur: 'Quincaillerie du Centre', fichier, ...extra,
});
const bilanAct1 = async (qui = 'dir') => {
  const b = await appel('GET', '/projets/bilan', qui);
  return [...b.data.validees, ...b.data.en_attente].find((l) => l.activite_id === S.act1);
};

before(async () => {
  [{ id: C.tenant }] = await sql(`INSERT INTO tenants (slug, nom, forme_juridique, initialise_le) VALUES ($1, $2, 'ASSOC', NOW()) RETURNING id`,
    [`proj3-${sfx}`, `PROJ3 ${sfx}`]);
  await sql(`INSERT INTO rubriques (tenant_id, code, intitule, type, nature_recette) VALUES
             ($1, 'SUB', 'SUBVENTION', 'entree', 'subvention'), ($1, 'REMB', 'REMBOURSEMENT AVANCE', 'entree', NULL),
             ($1, 'D1', 'FRAIS ACTIVITES', 'depense', NULL)`, [C.tenant]);
  [{ id: C.journal }] = await sql(`INSERT INTO journaux (tenant_id, code, nom, type, date_ouverture)
                                   VALUES ($1, 'BQ1', 'Banque', 'banque', CURRENT_DATE - 40) RETURNING id`, [C.tenant]);
  for (const [qui, role] of [['dir', 'directeur'], ['cpt', 'auditeur'], ['cai', 'caissier'], ['chef', 'caissier'], ['resp', 'caissier'], ['autre', 'caissier']]) {
    const username = `${qui}-p3-${sfx}`;
    const [u] = await sql(`INSERT INTO users (tenant_id, username, email, password_hash, role, actif)
                            VALUES ($1, $2, $3, 'x', $4, true) RETURNING id`, [C.tenant, username, `${username}@test.cm`, role]);
    C.u[qui] = { id: u.id, token: jwt.sign({ sub: u.id, username, role, tenantId: C.tenant }, SECRET, { expiresIn: '1h' }) };
  }
  [{ id: S.projet }] = await sql(`INSERT INTO activites (tenant_id, nom, type, chef_projet_id) VALUES ($1, 'Projet Écoles', 'projet', $2) RETURNING id`, [C.tenant, C.u.chef.id]);
  [{ id: S.act1 }] = await sql(`INSERT INTO activites (tenant_id, nom, type, projet_id, responsable_id) VALUES ($1, 'Construction', 'activite', $2, $3) RETURNING id`, [C.tenant, S.projet, C.u.resp.id]);
  [{ id: S.act2 }] = await sql(`INSERT INTO activites (tenant_id, nom, type, projet_id) VALUES ($1, 'Fournitures', 'activite', $2) RETURNING id`, [C.tenant, S.projet]);
  const [b] = await sql(`INSERT INTO projet_budgets (tenant_id, projet_id) VALUES ($1, $2) RETURNING id`, [C.tenant, S.projet]);
  await sql(`INSERT INTO projet_budget_lignes (tenant_id, budget_id, activite_id, montant) VALUES ($1, $2, $3, 2000000), ($1, $2, $4, 500000)`,
    [C.tenant, b.id, S.act1, S.act2]);
  await sql(`UPDATE projet_budgets SET statut = 'soumis' WHERE id = $1`, [b.id]);
  await sql(`UPDATE projet_budgets SET statut = 'valide', decide_par = $2, decide_le = NOW() WHERE id = $1`, [b.id, C.u.dir.id]);

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
  // Financement puis remise de 1 000 000 au responsable de « Construction ».
  assert.equal((await saisie({ rubrique_code: 'SUB', entree: 2500000, projet_id: S.projet })).status, 201);
  const r = await saisie({ rubrique_code: 'D1', sortie: 1000000, activite_id: S.act1, beneficiaire: 'Resp' });
  assert.equal(r.status, 201, r.message);
  S.remise = r.data.id;
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

test('Avant tout justificatif : activité en attente de justification pour tout le montant remis', async () => {
  const l = await bilanAct1();
  assert.equal(l.statut, 'en_attente');
  assert.equal(l.alloue, 1000000);
  assert.equal(l.en_attente, 1000000);
  assert.equal(l.responsable_nom, `resp-p3-${sfx}`);
});

test('Dépôt : pièce scannée obligatoire, contrôlée ; seulement sur ses activités', async () => {
  assert.equal((await deposer('resp', { fichier: undefined })).code, 'FICHIER_REQUIS');
  const faux = await deposer('resp', { fichier: { nom_fichier: 'x.pdf', data_base64: Buffer.from('pas un pdf').toString('base64') } });
  assert.equal(faux.code, 'FICHIER_INVALIDE');
  assert.doesNotMatch(faux.message, /PV/);
  assert.equal((await deposer('resp', { montant: 0 })).code, 'MONTANT_INVALIDE');
  assert.equal((await deposer('resp', { libelle: ' ' })).code, 'CHAMP_REQUIS');
  assert.equal((await deposer('resp', { activite_id: S.act2 })).status, 403);   // pas son activité
  assert.equal((await deposer('autre')).status, 404);                           // hors périmètre
  const ok = await deposer('resp', { montant: 300000, remise_id: S.remise, numero_piece: 'FAC-118' });
  assert.equal(ok.status, 201, ok.message);
  S.p1 = ok.data.id;
  // Le chef de projet est prévenu.
  const [{ nb }] = await sql(`SELECT COUNT(*)::int AS nb FROM notifications WHERE destinataire_id = $1 AND type = 'projet_justificatif'`, [C.u.chef.id]);
  assert.equal(nb, 1);
  // Fichier rangé dans le stockage privé.
  const [row] = await sql('SELECT fichier_path, fichier_mime, fichier_sha256 FROM projet_justificatifs WHERE id = $1', [S.p1]);
  assert.equal(row.fichier_mime, 'application/pdf');
  assert.ok(fs.existsSync(path.join(PV_DIR, row.fichier_path)));
  assert.match(row.fichier_path, /justificatifs/);
});

test('Fichier : lisible par le périmètre, jamais au-dehors', async () => {
  const r = await fetch(`${BASE}/projets/${S.projet}/justificatifs/${S.p1}/fichier`, { headers: { Authorization: `Bearer ${C.u.resp.token}` } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.match(Buffer.from(await r.arrayBuffer()).toString('latin1'), /^%PDF-/);
  const refus = await fetch(`${BASE}/projets/${S.projet}/justificatifs/${S.p1}/fichier`, { headers: { Authorization: `Bearer ${C.u.autre.token}` } });
  assert.equal(refus.status, 404);
});

test('Contrôle : chef de projet ou comptable, jamais ses propres pièces', async () => {
  // Le responsable ne contrôle pas.
  assert.equal((await appel('POST', `/projets/${S.projet}/justificatifs/${S.p1}/valider`, 'resp')).status, 403);
  // Le directeur n'a pas ce rôle (décision D2).
  assert.equal((await appel('POST', `/projets/${S.projet}/justificatifs/${S.p1}/valider`, 'dir')).status, 403);
  // Le chef dépose lui-même une pièce : il ne peut pas la valider, le comptable si.
  const p2 = await deposer('chef', { montant: 200000, libelle: 'Transport ciment' });
  assert.equal(p2.status, 201, p2.message);
  S.p2 = p2.data.id;
  const auto = await appel('POST', `/projets/${S.projet}/justificatifs/${S.p2}/valider`, 'chef');
  assert.equal(auto.status, 403);
  assert.equal(auto.code, 'AUTO_VALIDATION');
  // File « à contrôler » : le chef voit la pièce du responsable, pas la sienne ; le comptable voit les deux.
  assert.deepEqual((await appel('GET', '/projets/controle/justificatifs', 'chef')).data.map((j) => j.id), [S.p1]);
  assert.equal((await appel('GET', '/projets/controle/justificatifs', 'cpt')).data.length, 2);
  assert.equal((await appel('GET', '/projets/acces', 'cpt')).data.justificatifs_a_controler, 2);
  assert.equal((await appel('POST', `/projets/${S.projet}/justificatifs/${S.p2}/valider`, 'cpt')).status, 200);
  assert.equal((await appel('POST', `/projets/${S.projet}/justificatifs/${S.p1}/valider`, 'chef')).status, 200);
  // Le responsable est prévenu de la décision.
  const [{ nb }] = await sql(`SELECT COUNT(*)::int AS nb FROM notifications WHERE destinataire_id = $1 AND type = 'projet_justificatif'`, [C.u.resp.id]);
  assert.equal(nb, 1);
  // Garde-fou en base : jamais d'auto-validation.
  const [{ id: p3 }] = await sql(`INSERT INTO projet_justificatifs (tenant_id, projet_id, activite_id, date_piece, montant, libelle, depose_par)
                                  VALUES ($1, $2, $3, CURRENT_DATE, 1, 'Test', $4) RETURNING id`, [C.tenant, S.projet, S.act1, C.u.cpt.id]);
  await assert.rejects(sql(`UPDATE projet_justificatifs SET statut = 'valide', decide_par = $2, decide_le = NOW() WHERE id = $1`, [p3, C.u.cpt.id]));
  await sql('DELETE FROM projet_justificatifs WHERE id = $1', [p3]);
});

test('Pièce validée : figée, ni modifiable ni supprimable', async () => {
  const r = await appel('DELETE', `/projets/${S.projet}/justificatifs/${S.p1}`, 'resp');
  assert.equal(r.status, 409);
  await assert.rejects(sql('DELETE FROM projet_justificatifs WHERE id = $1', [S.p1]), /JUSTIFICATIF_INTANGIBLE/);
  await assert.rejects(sql('UPDATE projet_justificatifs SET montant = 1 WHERE id = $1', [S.p1]), /JUSTIFICATIF_INTANGIBLE/);
  // Une pièce encore « déposée » se retire par son auteur.
  const p = await deposer('resp', { montant: 5000, libelle: 'Erreur de dépôt' });
  assert.equal((await appel('DELETE', `/projets/${S.projet}/justificatifs/${p.data.id}`, 'resp')).status, 200);
});

test('Rejet motivé ; le responsable dépose une pièce corrigée', async () => {
  const p = await deposer('resp', { montant: 150000, libelle: 'Main-d\'œuvre' });
  assert.equal((await appel('POST', `/projets/${S.projet}/justificatifs/${p.data.id}/rejeter`, 'chef', {})).code, 'MOTIF_REQUIS');
  assert.equal((await appel('POST', `/projets/${S.projet}/justificatifs/${p.data.id}/rejeter`, 'chef', { motif: 'Pièce illisible' })).status, 200);
  const liste = await appel('GET', `/projets/${S.projet}/justificatifs?statut=rejete`, 'resp');
  assert.equal(liste.data.length, 1);
  assert.equal(liste.data[0].motif_rejet, 'Pièce illisible');
  // Rejetée : ne compte pas.
  assert.equal((await bilanAct1()).justifie, 500000);
});

test('Annulation d\'une pièce validée : directeur seulement, motif obligatoire', async () => {
  assert.equal((await appel('POST', `/projets/${S.projet}/justificatifs/${S.p2}/annuler`, 'chef', { motif: 'x' })).status, 403);
  assert.equal((await appel('POST', `/projets/${S.projet}/justificatifs/${S.p2}/annuler`, 'dir', {})).code, 'MOTIF_REQUIS');
  assert.equal((await appel('POST', `/projets/${S.projet}/justificatifs/${S.p2}/annuler`, 'dir', { motif: 'Facture en double' })).status, 200);
  const l = await bilanAct1();
  assert.equal(l.justifie, 300000);
  assert.equal(l.en_attente, 700000);
});

test('Bilan : remboursement du reliquat et justification complète → activité validée', async () => {
  // Le responsable rend 100 000 (entrée de journal sur l'activité).
  assert.equal((await saisie({ rubrique_code: 'REMB', entree: 100000, activite_id: S.act1 })).status, 201);
  let l = await bilanAct1();
  assert.equal(l.rembourse, 100000);
  assert.equal(l.en_attente, 600000);
  assert.equal(l.statut, 'en_attente');
  const p = await deposer('resp', { montant: 600000, libelle: 'Matériaux, solde' });
  l = await bilanAct1();
  assert.equal(l.a_controler, 600000);
  assert.equal(l.statut, 'en_attente');
  assert.equal((await appel('POST', `/projets/${S.projet}/justificatifs/${p.data.id}/valider`, 'cpt')).status, 200);
  l = await bilanAct1();
  assert.equal(l.statut, 'validee');
  assert.equal(l.en_attente, 0);
  const b = await appel('GET', '/projets/bilan', 'dir');
  assert.equal(b.data.totaux.nb_validees, 1);
  assert.equal(b.data.totaux.justifie, 900000);
  // La fiche projet porte les mêmes chiffres.
  const d = await appel('GET', `/projets/${S.projet}`, 'dir');
  assert.equal(d.data.chiffres.justifie, 900000);
  assert.equal(d.data.activites.find((a) => a.id === S.act1).statut_justification, 'validee');
});

test('Bilan et archives du responsable : ses activités seulement', async () => {
  // Une remise sur l'autre activité, pour qu'elle figure au bilan de la direction.
  const r = await saisie({ rubrique_code: 'D1', sortie: 50000, activite_id: S.act2 });
  assert.equal(r.status, 201, r.message);
  const dir = await appel('GET', '/projets/bilan', 'dir');
  assert.equal(dir.data.en_attente.length, 1);
  assert.equal(dir.data.en_attente[0].activite_id, S.act2);
  const resp = await appel('GET', '/projets/bilan', 'resp');
  assert.equal(resp.data.en_attente.length, 0);
  assert.deepEqual(resp.data.validees.map((l) => l.activite_id), [S.act1]);
  const arch = await appel('GET', `/projets/${S.projet}/justificatifs`, 'resp');
  assert.ok(arch.data.every((j) => j.activite_id === S.act1));
  assert.equal((await appel('GET', '/projets/bilan', 'autre')).data.validees.length, 0);
});
