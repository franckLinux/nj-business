// db/lib/seed-admin.lib.js
// ============================================================================
//  Création du super administrateur initial.
//  Même contrat que migrate.lib.js : ni close(), ni process.exit().
// ============================================================================
const bcrypt = require('bcryptjs');
const { pool } = require('../../src/config/database');

/**
 * Crée le super admin s'il n'existe pas.
 *
 * @param {object}  [opts]
 * @param {object}  [opts.client]              client déjà emprunté (verrou partagé)
 * @param {boolean} [opts.resetIfExists=true]  réinitialise le mot de passe si le
 *   compte existe déjà. Le CLI conserve `true` (comportement historique, c'est
 *   la procédure de secours en cas de mot de passe perdu). L'endpoint HTTP passe
 *   `false` : sans cela, quiconque détient le SETUP_TOKEN pourrait rejouer le
 *   setup pour remettre le mot de passe admin à la valeur de SEED_ADMIN_PASSWORD.
 * @returns {Promise<{username: string, action: 'cree'|'reinitialise'|'inchange'}>}
 */
const seedAdmin = async ({ client = null, resetIfExists = true } = {}) => {
  const username = process.env.SEED_ADMIN_USERNAME || 'admin';
  const password = process.env.SEED_ADMIN_PASSWORD || 'Admin2026!';
  const email    = process.env.SEED_ADMIN_EMAIL || '';
  const rounds   = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;

  const c = client || (await pool.connect());
  try {
    const { rows } = await c.query(
      'SELECT id FROM users WHERE username = $1 AND tenant_id IS NULL',
      [username]
    );

    if (rows.length > 0) {
      if (!resetIfExists) return { username, action: 'inchange' };
      await c.query(
        'UPDATE users SET password_hash = $1, actif = true WHERE id = $2',
        [await bcrypt.hash(password, rounds), rows[0].id]
      );
      return { username, action: 'reinitialise' };
    }

    await c.query(
      `INSERT INTO users (tenant_id, username, email, password_hash, role, actif)
       VALUES (NULL, $1, $2, $3, 'super_admin', true)`,
      [username, email, await bcrypt.hash(password, rounds)]
    );
    return { username, action: 'cree' };
  } finally {
    if (!client) c.release();
  }
};

module.exports = { seedAdmin };
