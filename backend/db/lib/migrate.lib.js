// db/lib/migrate.lib.js
// ============================================================================
//  Logique de migration réutilisable : appelée aussi bien par le CLI
//  (db/migrate.js) que par l'API HTTP (GET /api/admin/setup).
//
//  CONTRAT IMPORTANT — ce module ne doit JAMAIS :
//    • fermer le pool (close() / pool.end()) — cela couperait les connexions
//      du serveur Express qui partage ce même pool ;
//    • appeler process.exit() — cela tuerait le serveur au milieu d'une requête.
//  Il emprunte un client, le relâche (release, pas end), et retourne un rapport.
//  Les décisions d'affichage et de sortie appartiennent à l'appelant.
// ============================================================================
const fs   = require('fs');
const path = require('path');
const { pool } = require('../../src/config/database');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const SCHEMA_FILE    = path.join(__dirname, '..', 'schema.sql');

/** Migrations disponibles sur disque, dans l'ordre lexicographique (001, 002, …). */
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

const appliedVersions = async (client) => {
  const { rows } = await client.query('SELECT version FROM schema_migrations');
  return new Set(rows.map((r) => r.version));
};

/** Exécute un fichier SQL dans sa propre transaction : tout ou rien. */
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
    await client.query('ROLLBACK').catch(() => {});
    // Sans le nom du fichier, l'erreur Postgres brute est inexploitable.
    err.message = `${label || 'schema.sql'} : ${err.message}`;
    throw err;
  }
};

/**
 * Applique les migrations non encore jouées.
 *
 * @param {object}   [opts]
 * @param {boolean}  [opts.withSchema=false] applique schema.sql au préalable
 * @param {object}   [opts.client]           client déjà emprunté (verrou partagé)
 * @param {Function} [opts.onProgress]       (texte) => void, pour le rendu CLI
 * @returns {Promise<{schema_applique: boolean, appliquees: string[],
 *                    deja_appliquees: number, total: number}>}
 */
const runMigrations = async ({
  withSchema = false,
  client     = null,
  onProgress = () => {},
} = {}) => {
  const c = client || (await pool.connect());
  try {
    await ensureTable(c);
    const deja  = await appliedVersions(c);
    const files = listMigrations();

    const rapport = {
      schema_applique: false,
      appliquees:      [],
      deja_appliquees: files.filter((f) => deja.has(f)).length,
      total:           files.length,
    };

    if (withSchema) {
      onProgress('schema.sql');
      await runFile(c, null, fs.readFileSync(SCHEMA_FILE, 'utf8'));
      rapport.schema_applique = true;
    }

    for (const file of files.filter((f) => !deja.has(f))) {
      onProgress(file);
      await runFile(c, file, fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
      rapport.appliquees.push(file);
    }

    return rapport;
  } finally {
    if (!client) c.release(); // release ≠ end : la connexion retourne au pool
  }
};

/** État des migrations, sans rien appliquer. */
const migrationStatus = async ({ client = null } = {}) => {
  const c = client || (await pool.connect());
  try {
    await ensureTable(c);
    const deja  = await appliedVersions(c);
    const files = listMigrations();
    return {
      migrations:      files.map((version) => ({ version, appliquee: deja.has(version) })),
      deja_appliquees: files.filter((f) => deja.has(f)).length,
      total:           files.length,
    };
  } finally {
    if (!client) c.release();
  }
};

module.exports = { runMigrations, migrationStatus, listMigrations, MIGRATIONS_DIR, SCHEMA_FILE };
