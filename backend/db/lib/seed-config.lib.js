// db/lib/seed-config.lib.js
// ============================================================================
//  Chargement de la configuration métier d'un ou plusieurs tenants :
//  identité du client, journaux, rubriques.
//
//  Les données proviennent des fichiers db/data/config-*.js, produits par
//  `npm run config:export` depuis une base de référence. Chaque fichier décrit
//  un tenant ; tous ceux présents sont appliqués.
//
//  Même contrat que les autres modules de db/lib/ : ni close(), ni process.exit().
//
//  ── Politique d'écrasement ────────────────────────────────────────────────
//  Par défaut, RIEN de ce qui existe déjà n'est modifié (ON CONFLICT DO NOTHING).
//  C'est un amorçage, pas une synchronisation : l'endpoint HTTP est joignable
//  par simple URL, il ne doit jamais pouvoir réécrire en silence l'intitulé
//  d'une rubrique qu'un comptable a corrigé en production.
//
//  Passer `force: true` (CLI `--force`, HTTP `&config_force=1`) bascule en
//  ON CONFLICT DO UPDATE, pour propager délibérément une évolution du
//  référentiel. À faire en connaissance de cause.
// ============================================================================
const fs   = require('fs');
const path = require('path');
const { pool } = require('../../src/config/database');

const DATA_DIR = path.join(__dirname, '..', 'data');

/** Fichiers de configuration présents, triés pour un ordre d'application stable. */
const listerFichiers = () => {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs
    .readdirSync(DATA_DIR)
    .filter((f) => /^config-.+\.js$/.test(f))
    .sort();
};

/** Colonnes réellement présentes en base — garde-fou contre une dérive de schéma. */
const colonnesDe = async (c, table) => {
  const { rows } = await c.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  return new Set(rows.map((r) => r.column_name));
};

/**
 * Construit un UPSERT à partir d'un objet, en n'gardant que les clés qui
 * correspondent à une colonne existante. Les identifiants sont donc toujours
 * issus du catalogue Postgres, jamais de la donnée entrante.
 */
const construireUpsert = (table, ligne, colonnes, conflitSur, force, extra = {}) => {
  const donnees = { ...ligne, ...extra };
  const cles = Object.keys(donnees).filter((k) => colonnes.has(k));
  const valeurs = cles.map((k) => donnees[k]);
  const champs = cles.map((k) => `"${k}"`).join(', ');
  const params = cles.map((_, i) => `$${i + 1}`).join(', ');

  // Les clés de conflit ne se mettent jamais à jour elles-mêmes.
  const majs = cles
    .filter((k) => !conflitSur.includes(k))
    .map((k) => `"${k}" = EXCLUDED."${k}"`);

  const action =
    force && majs.length > 0 ? `DO UPDATE SET ${majs.join(', ')}` : 'DO NOTHING';

  const cible = conflitSur.map((k) => `"${k}"`).join(', ');

  return {
    sql: `INSERT INTO ${table} (${champs}) VALUES (${params})
          ON CONFLICT (${cible}) ${action}
          RETURNING (xmax = 0) AS insere`,
    valeurs,
  };
};

/** Applique un fichier de configuration. Suppose une transaction ouverte. */
const appliquerFichier = async (c, config, force) => {
  const { tenant, journaux = [], rubriques = [] } = config;
  if (!tenant?.slug) throw new Error('Configuration invalide : `tenant.slug` manquant.');

  const colTenants   = await colonnesDe(c, 'tenants');
  const colJournaux  = await colonnesDe(c, 'journaux');
  const colRubriques = await colonnesDe(c, 'rubriques');

  // ── Tenant ──────────────────────────────────────────────────────────────
  const upTenant = construireUpsert('tenants', tenant, colTenants, ['slug'], force);
  const { rows: rTenant } = await c.query(upTenant.sql, upTenant.valeurs);

  // DO NOTHING ne renvoie rien quand la ligne existait : on relit l'id.
  const { rows: idRows } = await c.query('SELECT id FROM tenants WHERE slug = $1', [tenant.slug]);
  if (!idRows.length) throw new Error(`Tenant « ${tenant.slug} » introuvable après insertion.`);
  const tenantId = idRows[0].id;

  const actionTenant = rTenant.length === 0 ? 'inchange' : rTenant[0].insere ? 'cree' : 'maj';

  // ── Journaux et rubriques ───────────────────────────────────────────────
  const appliquerLot = async (table, lignes, colonnes) => {
    let crees = 0;
    let majs = 0;
    let inchanges = 0;
    for (const ligne of lignes) {
      const up = construireUpsert(table, ligne, colonnes, ['tenant_id', 'code'], force, {
        tenant_id: tenantId,
      });
      const { rows } = await c.query(up.sql, up.valeurs);
      if (rows.length === 0) inchanges += 1;
      else if (rows[0].insere) crees += 1;
      else majs += 1;
    }
    return { total: lignes.length, crees, majs, inchanges };
  };

  return {
    tenant:    { slug: tenant.slug, nom: tenant.nom, action: actionTenant },
    journaux:  await appliquerLot('journaux', journaux, colJournaux),
    rubriques: await appliquerLot('rubriques', rubriques, colRubriques),
  };
};

/**
 * Charge toutes les configurations disponibles.
 *
 * @param {object}   [opts]
 * @param {object}   [opts.client]       client déjà emprunté (verrou partagé)
 * @param {boolean}  [opts.force=false]  écrase les lignes existantes
 * @param {string}   [opts.slug]         n'applique que ce tenant
 * @returns {Promise<object>} rapport par fichier
 */
const seedConfig = async ({ client = null, force = false, slug = null } = {}) => {
  let fichiers = listerFichiers();
  if (slug) fichiers = fichiers.filter((f) => f === `config-${slug}.js`);

  if (fichiers.length === 0) {
    return {
      fichiers: 0,
      note: slug
        ? `Aucun fichier db/data/config-${slug}.js.`
        : 'Aucun fichier db/data/config-*.js — rien à charger. ' +
          'Générez-en un avec : npm run config:export',
      tenants: [],
    };
  }

  const c = client || (await pool.connect());
  const tenants = [];
  try {
    await c.query('BEGIN');
    for (const fichier of fichiers) {
      // require() met en cache : sans invalidation, deux appels successifs dans
      // le même processus (CLI puis endpoint) reliraient une version périmée.
      const chemin = path.join(DATA_DIR, fichier);
      delete require.cache[require.resolve(chemin)];
      tenants.push({ fichier, ...(await appliquerFichier(c, require(chemin), force)) });
    }
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (!client) c.release();
  }

  return { fichiers: fichiers.length, mode: force ? 'ecrasement' : 'preservation', tenants };
};

/** État de la configuration en base, sans rien écrire. */
const configStatus = async ({ client = null } = {}) => {
  const c = client || (await pool.connect());
  try {
    const { rows } = await c.query(`
      SELECT t.slug, t.nom, t.actif,
             (SELECT COUNT(*)::int FROM journaux  j WHERE j.tenant_id = t.id) AS journaux,
             (SELECT COUNT(*)::int FROM rubriques r WHERE r.tenant_id = t.id) AS rubriques
      FROM tenants t ORDER BY t.created_at
    `);
    return { fichiers_disponibles: listerFichiers(), tenants_en_base: rows };
  } finally {
    if (!client) c.release();
  }
};

module.exports = { seedConfig, configStatus, listerFichiers };
