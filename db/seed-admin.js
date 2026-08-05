// db/seed-admin.js — Crée le super admin initial
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { getClient, close, describeTarget } = require('../src/config/database');

const USERNAME = process.env.SEED_ADMIN_USERNAME || 'admin';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Admin2026!';
const ROUNDS   = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;

async function seed() {
  console.log(`[Seed] Cible : ${describeTarget()}`);
  const hash   = await bcrypt.hash(PASSWORD, ROUNDS);
  const client = await getClient();

  try {
    const { rows } = await client.query(
      'SELECT id FROM users WHERE username = $1 AND tenant_id IS NULL',
      [USERNAME]
    );

    if (rows.length > 0) {
      await client.query(
        'UPDATE users SET password_hash = $1, actif = true WHERE id = $2',
        [hash, rows[0].id]
      );
      console.log(`[Seed] Super admin « ${USERNAME} » existant → mot de passe réinitialisé.`);
    } else {
      await client.query(
        `INSERT INTO users (tenant_id, username, email, password_hash, role, actif)
         VALUES (NULL, $1, $2, $3, 'super_admin', true)`,
        [USERNAME, process.env.SEED_ADMIN_EMAIL || '', hash]
      );
      console.log(`[Seed] Super admin « ${USERNAME} » créé.`);
    }

    console.log(`[Seed] Mot de passe : ${PASSWORD}  → à changer dès la première connexion.`);
  } finally {
    client.release();
    await close();
  }
}

seed().catch((err) => {
  console.error('[Seed] ÉCHEC :', err.message);
  process.exit(1);
});
