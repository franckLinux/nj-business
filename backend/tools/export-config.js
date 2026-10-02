#!/usr/bin/env node
// backend/tools/export-config.js
// ============================================================================
//  Exporte la configuration d'un tenant depuis la base courante vers un fichier
//  versionnable : db/data/config-<slug>.js
//
//    npm run config:export                      → exporte le tenant unique
//    node tools/export-config.js --slug=nj      → choisit le tenant à exporter
//    node tools/export-config.js --list         → liste les tenants disponibles
//
//  Ce qui est exporté : l'identité du tenant, ses journaux et ses rubriques —
//  autrement dit le référentiel métier qu'on ne veut pas ressaisir à chaque
//  déploiement.
//
//  Ce qui ne l'est PAS, volontairement :
//    • les utilisateurs — leur `password_hash` est un secret, il n'a rien à
//      faire dans un fichier suivi par git. Le super admin est créé par
//      seed-admin.lib.js, les autres comptes se créent depuis l'application.
//    • les mouvements, budgets, arrêts de caisse — données d'exploitation.
//    • les identifiants techniques (id, tenant_id) et les horodatages : le
//      seed s'appuie sur les clés métier (slug, code), donc les séquences
//      Postgres restent cohérentes sur la base cible.
// ============================================================================
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..'); // backend/
require('dotenv').config({ path: path.join(ROOT, '.env') });

const { pool, close, describeTarget } = require(path.join(ROOT, 'src/config/database'));

const SORTIE_DIR = path.join(ROOT, 'db', 'data');

// Colonnes techniques : recalculées par la base cible, jamais exportées.
const TECHNIQUES = new Set(['id', 'tenant_id', 'created_at', 'updated_at']);
// FK vers users : les UUID locaux n'existent pas sur la base cible.
const FK_USERS   = new Set(['responsable_saisie', 'responsable_arret']);

const nettoyer = (ligne, exclure = TECHNIQUES) =>
  Object.fromEntries(Object.entries(ligne).filter(([k]) => !exclure.has(k)));

/** Sérialise en littéral JS lisible et diffable (une entrée par ligne). */
const versLitteral = (valeur, indent = 0) => {
  const pad = '  '.repeat(indent);
  if (valeur === null || valeur === undefined) return 'null';
  if (typeof valeur === 'string')  return JSON.stringify(valeur);
  if (typeof valeur === 'number' || typeof valeur === 'boolean') return String(valeur);
  if (valeur instanceof Date)      return JSON.stringify(valeur.toISOString());
  if (Array.isArray(valeur)) {
    if (valeur.length === 0) return '[]';
    return `[\n${valeur.map((v) => `${pad}  ${versLitteral(v, indent + 1)}`).join(',\n')}\n${pad}]`;
  }
  const entrees = Object.entries(valeur).map(
    ([k, v]) => `${JSON.stringify(k)}: ${versLitteral(v, indent + 1)}`
  );
  return `{ ${entrees.join(', ')} }`;
};

const main = async () => {
  const args = process.argv.slice(2);
  const slugDemande = (args.find((a) => a.startsWith('--slug=')) || '').split('=')[1];

  console.log(`[Export] Source : ${describeTarget()}`);

  const { rows: tenants } = await pool.query(
    'SELECT * FROM tenants ORDER BY created_at'
  );

  if (args.includes('--list')) {
    tenants.forEach((t) => console.log(`  ${t.slug.padEnd(20)} ${t.nom}`));
    return;
  }

  if (tenants.length === 0) throw new Error('Aucun tenant dans cette base.');

  let tenant;
  if (slugDemande) {
    tenant = tenants.find((t) => t.slug === slugDemande);
    if (!tenant) {
      throw new Error(
        `Aucun tenant de slug « ${slugDemande} ». Disponibles : ${tenants.map((t) => t.slug).join(', ')}`
      );
    }
  } else if (tenants.length === 1) {
    tenant = tenants[0];
  } else {
    throw new Error(
      `${tenants.length} tenants en base — précisez --slug=… parmi : ${tenants.map((t) => t.slug).join(', ')}`
    );
  }

  const { rows: journaux } = await pool.query(
    `SELECT * FROM journaux WHERE tenant_id = $1 ORDER BY ordre, code`, [tenant.id]
  );
  const { rows: rubriques } = await pool.query(
    `SELECT * FROM rubriques WHERE tenant_id = $1 ORDER BY type DESC, ordre, id`, [tenant.id]
  );

  const donnees = {
    tenant:    nettoyer(tenant, new Set(['id', 'created_at', 'updated_at'])),
    journaux:  journaux.map((j)  => nettoyer(j, new Set([...TECHNIQUES, ...FK_USERS]))),
    rubriques: rubriques.map((r) => nettoyer(r)),
  };

  const fichier = path.join(SORTIE_DIR, `config-${tenant.slug}.js`);
  const contenu =
`// backend/db/data/config-${tenant.slug}.js
// ============================================================================
//  Configuration métier du tenant « ${tenant.nom} ».
//  GÉNÉRÉ par \`npm run config:export\` — régénérez-le plutôt que de l'éditer.
//
//  Appliqué par db/lib/seed-config.lib.js :
//    • en CLI   : npm run db:config
//    • en HTTP  : GET /api/admin/setup?token=…&seed_config=1
//
//  L'UPSERT s'appuie sur les clés métier (tenants.slug, puis (tenant_id, code)
//  pour les journaux et les rubriques) : rejouable sans créer de doublon et
//  sans consommer les séquences de la base cible.
//
//  Ne contient AUCUN utilisateur ni mot de passe — voir tools/export-config.js.
// ============================================================================
module.exports = {
  genere_le: ${JSON.stringify(new Date().toISOString())},

  tenant: ${versLitteral(donnees.tenant, 1)},

  journaux: ${versLitteral(donnees.journaux, 1)},

  rubriques: ${versLitteral(donnees.rubriques, 1)},
};
`;

  fs.mkdirSync(SORTIE_DIR, { recursive: true });
  fs.writeFileSync(fichier, contenu, 'utf8');

  console.log(`[Export] Tenant     : ${tenant.nom} (slug « ${tenant.slug} »)`);
  console.log(`[Export] Journaux   : ${journaux.length}`);
  console.log(`[Export] Rubriques  : ${rubriques.length} ` +
    `(${rubriques.filter((r) => r.type === 'entree').length} entrée(s), ` +
    `${rubriques.filter((r) => r.type === 'depense').length} dépense(s))`);
  console.log(`[Export] Écrit      : ${path.relative(ROOT, fichier)}`);
  console.log('\n[Export] Pensez à committer ce fichier pour qu\'il parte en production.');
};

main()
  .catch((err) => {
    console.error('[Export] ÉCHEC :', err.message);
    process.exitCode = 1;
  })
  .finally(() => close());
