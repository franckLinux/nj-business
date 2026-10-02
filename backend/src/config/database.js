// src/config/database.js
// Pool de connexions PostgreSQL — CaissePro v2
// Base auto-hébergée : PostgreSQL 14+ (aucun fournisseur tiers).
const { Pool } = require('pg');

// Unique mode de configuration :
//   DATABASE_URL=postgresql://user:pass@localhost:5432/caissepro
if (!process.env.DATABASE_URL) {
  throw new Error(
    "[DB] DATABASE_URL est absente. Renseignez-la dans .env, par ex. :\n" +
    '     DATABASE_URL=postgresql://caissepro:Pass1234@localhost:5432/caissepro'
  );
}

const sslConfig = process.env.PG_SSL === 'true'
  ? { rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false' }
  : false;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig,
  max: parseInt(process.env.PG_POOL_MAX, 10) || 20, // taille max du pool
  idleTimeoutMillis: 30000,      // ferme les connexions inactives après 30s
  connectionTimeoutMillis: 5000,
});

pool.on('connect', () => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[DB] Nouvelle connexion au pool PostgreSQL');
  }
});

pool.on('error', (err) => {
  console.error('[DB] Erreur inattendue sur le pool :', err.message);
});

/**
 * Exécute une requête avec gestion d'erreur centralisée
 * @param {string} text   - Requête SQL paramétrisée
 * @param {Array}  params - Paramètres [$1, $2, ...]
 */
const query = async (text, params) => {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV === 'development' && duration > 500) {
    console.warn(`[DB] Requête lente (${duration}ms) :`, text.substring(0, 80));
  }
  return res;
};

/**
 * Obtenir un client dédié pour les transactions
 * Usage : const client = await getClient(); try { await client.query('BEGIN'); ... } finally { client.release(); }
 */
const getClient = () => pool.connect();

/** Ferme proprement le pool (scripts CLI, arrêt du serveur). */
const close = () => pool.end();

/** Description lisible de la cible, pour les logs (sans mot de passe). */
const describeTarget = () =>
  process.env.DATABASE_URL.replace(/:\/\/([^:]+):[^@]*@/, '://$1:***@');

module.exports = { query, getClient, close, describeTarget, pool };
