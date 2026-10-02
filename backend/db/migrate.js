#!/usr/bin/env node
// db/migrate.js — Runner de migrations (interface en ligne de commande)
//
//   node db/migrate.js            → applique les migrations non encore jouées
//   node db/migrate.js --status   → liste l'état sans rien appliquer
//   node db/migrate.js --schema   → (ré)applique db/schema.sql avant les migrations
//
// La logique vit dans db/lib/migrate.lib.js, partagée avec GET /api/admin/setup.
// Ce fichier ne fait que : charger .env, lire argv, afficher, fermer le pool.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { close, describeTarget } = require('../src/config/database');
const { runMigrations, migrationStatus } = require('./lib/migrate.lib');

const main = async () => {
  const args = process.argv.slice(2);
  console.log(`[Migrate] Cible : ${describeTarget()}`);

  if (args.includes('--status')) {
    const { migrations, deja_appliquees, total } = await migrationStatus();
    migrations.forEach((m) => console.log(`  ${m.appliquee ? '✓' : '·'} ${m.version}`));
    console.log(`[Migrate] ${deja_appliquees}/${total} migration(s) appliquée(s).`);
    return;
  }

  const rapport = await runMigrations({
    withSchema: args.includes('--schema'),
    onProgress: (fichier) => console.log(`[Migrate] → ${fichier}`),
  });

  if (rapport.schema_applique) console.log('[Migrate] schema.sql ✓');
  if (rapport.appliquees.length === 0) {
    console.log('[Migrate] Base à jour, rien à appliquer.');
  } else {
    console.log(`[Migrate] ${rapport.appliquees.length} migration(s) appliquée(s) ✓`);
  }
};

main()
  .catch((err) => {
    console.error('[Migrate] ÉCHEC :', err.message);
    process.exitCode = 1;
  })
  .finally(() => close());
