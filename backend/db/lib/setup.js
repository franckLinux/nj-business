// db/lib/setup.js
// ============================================================================
//  Orchestrateur d'initialisation : schéma → migrations → plan comptable → admin.
//  Utilisé par le CLI (`npm run db:setup`) et par GET /api/admin/setup.
//
//  Toutes les étapes s'exécutent sur UN SEUL client, protégé par un verrou
//  consultatif PostgreSQL. C'est indispensable ici : l'endpoint est un GET, donc
//  susceptible d'être préfetché par un navigateur, rejoué par un antivirus ou
//  relancé impatiemment par un humain. Deux setups concurrents se marcheraient
//  dessus au milieu des migrations.
// ============================================================================
const { pool, describeTarget } = require('../../src/config/database');
const { runMigrations, migrationStatus }        = require('./migrate.lib');
const { seedPlanComptable, planComptableStatus } = require('./seed-plan.lib');
const { seedAdmin }                              = require('./seed-admin.lib');

// Clé arbitraire mais stable : deux processus CaissePro sur la même base
// doivent choisir le même entier pour que le verrou ait un sens.
const LOCK_KEY = 8410231;

/**
 * Enchaîne les étapes d'initialisation et retourne un rapport détaillé.
 * Ne lève pas en cas d'échec d'une étape : l'erreur est capturée dans le
 * rapport, ce qui permet de voir DEPUIS LE NAVIGATEUR quelle étape a lâché.
 *
 * @param {object}   [opts]
 * @param {boolean}  [opts.withSchema=true]  applique schema.sql (idempotent)
 * @param {boolean}  [opts.prune=false]      désactive les comptes obsolètes
 * @param {boolean}  [opts.resetAdmin=false] réinitialise le mot de passe admin
 * @param {Function} [opts.onProgress]       (étape, texte) => void, rendu CLI
 * @returns {Promise<{ok: boolean, cible: string, steps: object[], duree_ms: number}>}
 */
const runSetup = async ({
  withSchema = true,
  prune      = false,
  resetAdmin = false,
  onProgress = () => {},
} = {}) => {
  const debut  = Date.now();
  const steps  = [];
  const client = await pool.connect();

  const etape = async (nom, fn) => {
    const t = Date.now();
    onProgress(nom, 'début');
    try {
      const detail = await fn();
      steps.push({ etape: nom, statut: 'ok', detail, duree_ms: Date.now() - t });
      onProgress(nom, 'ok');
      return true;
    } catch (err) {
      steps.push({ etape: nom, statut: 'echec', error: err.message, duree_ms: Date.now() - t });
      onProgress(nom, `échec : ${err.message}`);
      return false;
    }
  };

  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS acquis', [LOCK_KEY]);
    if (!rows[0].acquis) {
      const err = new Error('Une initialisation est déjà en cours sur cette base.');
      err.code = 'SETUP_LOCKED';
      throw err;
    }

    try {
      let ok = await etape('migrations', () =>
        runMigrations({ withSchema, client, onProgress: (f) => onProgress('migrations', f) })
      );
      if (ok) ok = await etape('plan_comptable', () => seedPlanComptable({ client, prune }));
      if (ok) ok = await etape('admin', () => seedAdmin({ client, resetIfExists: resetAdmin }));

      return { ok, cible: describeTarget(), steps, duree_ms: Date.now() - debut };
    } finally {
      // Verrou de session : il survivrait à la fin de la requête si on l'oubliait.
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    }
  } finally {
    client.release();
  }
};

/** État complet de la base, sans rien écrire. */
const getStatus = async () => {
  const client = await pool.connect();
  try {
    return {
      cible:          describeTarget(),
      migrations:     await migrationStatus({ client }),
      plan_comptable: await planComptableStatus({ client }).catch((err) => ({ error: err.message })),
    };
  } finally {
    client.release();
  }
};

module.exports = { runSetup, getStatus, LOCK_KEY };
