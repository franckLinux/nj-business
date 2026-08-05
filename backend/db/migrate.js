#!/usr/bin/env node
// db/migrate.js — Runner de migrations unique (PostgreSQL auto-hébergé)
//
//   node db/migrate.js            → applique les migrations non encore jouées
//   node db/migrate.js --status   → liste l'état sans rien appliquer
//   node db/migrate.js --schema   → (ré)applique db/schema.sql avant les migrations
//
// Chaque fichier db/migrations/NNN_*.sql est exécuté une seule fois,
// dans une transaction, et tracé dans la table schema_migrations.
const fs   = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { pool, close, describeTarget } = require('../src/config/database');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const SCHEMA_FILE    = path.join(__dirname, 'schema.sql');

const listMigrations = () =>
  fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

const ensureTable = (client) =>
  client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

const applied = async (client) => {
  const { rows } = await client.query('SELECT version FROM schema_migrations');
  return new Set(rows.map((r) => r.version));
};

const runFile = async (client, label, sql) => {
  await client.query('BEGIN');
  try {
    await client.query(sql);
    if (label) {
      await client.query(
        'INSERT INTO schema_migrations(version) VALUES($1) ON CONFLICT DO NOTHING',
        [label]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
};

const main = async () => {
  const args      = process.argv.slice(2);
  const statusOnly = args.includes('--status');
  const withSchema = args.includes('--schema');

  console.log(`[Migrate] Cible : ${describeTarget()}`);
  const client = await pool.connect();

  try {
    await ensureTable(client);
    const done  = await applied(client);
    const files = listMigrations();

    if (statusOnly) {
      files.forEach((f) => console.log(`  ${done.has(f) ? '✓' : '·'} ${f}`));
      console.log(`[Migrate] ${done.size}/${files.length} migration(s) appliquée(s).`);
      return;
    }

    if (withSchema) {
      console.log('[Migrate] Application de schema.sql…');
      await runFile(client, null, fs.readFileSync(SCHEMA_FILE, 'utf8'));
      console.log('[Migrate] schema.sql ✓');
    }

    const pending = files.filter((f) => !done.has(f));
    if (pending.length === 0) {
      console.log('[Migrate] Base à jour, rien à appliquer.');
      return;
    }

    for (const file of pending) {
      process.stdout.write(`[Migrate] ${file} … `);
      await runFile(client, file, fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
      console.log('✓');
    }
    console.log(`[Migrate] ${pending.length} migration(s) appliquée(s).`);
  } finally {
    client.release();
    await close();
  }
};

main().catch((err) => {
  console.error('[Migrate] ÉCHEC :', err.message);
  process.exit(1);
});
