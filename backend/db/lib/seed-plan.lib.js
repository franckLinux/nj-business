// db/lib/seed-plan.lib.js
// ============================================================================
//  Chargement du plan comptable SYSCOHADA révisé dans `plan_comptable_syscohada`.
//  Même contrat que migrate.lib.js : ni close(), ni process.exit().
//
//  Garanties (chargement « stable ») :
//    • Idempotent : relançable autant de fois que voulu, même résultat.
//    • Transactionnel : tout ou rien.
//    • Les comptes personnalisés (source = 'custom') créés depuis l'application
//      ne sont JAMAIS écrasés ni désactivés.
//    • Depuis la réforme du plan (étape 6, migration 020) le modèle global est
//      administré depuis l'application : le chargement AJOUTE uniquement les
//      comptes absents. Il ne réécrit plus les libellés et ne réactive plus un
//      compte que l'administrateur a désactivé ou archivé (auparavant, chaque
//      démarrage avec AUTO_SETUP effaçait ces modifications). Les comptes
//      ajoutés restent « non publiés » jusqu'à la prochaine publication.
// ============================================================================
const { pool } = require('../../src/config/database');
const { PLAN_COMPTABLE } = require('../data/plan-comptable-syscohada');

const TABLE = 'plan_comptable_syscohada';

/**
 * Un doublon dans le référentiel ferait échouer l'UPSERT
 * (« ON CONFLICT DO UPDATE cannot affect row a second time »).
 * On le détecte ici avec un message clair plutôt qu'une erreur Postgres opaque.
 */
const ensureReferentielValide = () => {
  const vus = new Set();
  const doublons = [];
  for (const c of PLAN_COMPTABLE) {
    const cle = c.compte.toLowerCase().trim();
    if (vus.has(cle)) doublons.push(c.compte);
    vus.add(cle);
  }
  if (doublons.length > 0) {
    throw new Error(
      `Référentiel invalide — numéro(s) de compte en double : ${doublons.join(', ')}. ` +
      'Corrigez db/data/plan-comptable-syscohada.js.'
    );
  }
};

/** Vérifie que la migration 005 a bien été appliquée. */
const ensureTable = async (client) => {
  const { rows } = await client.query('SELECT to_regclass($1) AS t', [TABLE]);
  if (!rows[0].t) {
    throw new Error(`Table « ${TABLE} » absente. Appliquez d'abord les migrations.`);
  }
  // L'UPSERT s'appuie sur l'index unique d'expression créé par la migration 005.
  const { rows: idx } = await client.query(
    'SELECT 1 FROM pg_indexes WHERE tablename = $1 AND indexname = $2',
    [TABLE, 'uq_pcs_compte']
  );
  if (idx.length === 0) {
    throw new Error(
      'Index unique « uq_pcs_compte » absent : la migration 005_pieces_plan.sql ' +
      "n'a pas été appliquée."
    );
  }
};

/** Répartition actifs/inactifs par source. */
const stats = async (client) => {
  const { rows } = await client.query(`
    SELECT COALESCE(source, 'syscohada') AS source,
           COUNT(*) FILTER (WHERE actif)::int      AS actifs,
           COUNT(*) FILTER (WHERE NOT actif)::int  AS inactifs
    FROM ${TABLE}
    GROUP BY 1 ORDER BY 1
  `);
  return rows;
};

/**
 * Charge / met à jour le référentiel.
 *
 * @param {object}  [opts]
 * @param {object}  [opts.client]       client déjà emprunté (verrou partagé)
 * @param {boolean} [opts.prune=false]  désactive en plus les comptes 'syscohada'
 *                                      absents du référentiel embarqué
 * @returns {Promise<{referentiel: number, crees: number, mis_a_jour: number,
 *                    intacts: number, desactives: number, repartition: object[]}>}
 */
const seedPlanComptable = async ({ client = null, prune = false } = {}) => {
  ensureReferentielValide();

  const c = client || (await pool.connect());
  try {
    await ensureTable(c);
    await c.query('BEGIN');
    try {
      // Envoi du référentiel en un seul aller-retour via UNNEST.
      const comptes   = PLAN_COMPTABLE.map((x) => x.compte);
      const intitules = PLAN_COMPTABLE.map((x) => x.intitule);
      const classes   = PLAN_COMPTABLE.map((x) => x.classe);
      const natures   = PLAN_COMPTABLE.map((x) => x.nature);

      const { rows } = await c.query(
        `
        INSERT INTO ${TABLE} (compte, intitule, classe, nature, source, actif)
        SELECT s.compte, s.intitule, s.classe, s.nature, 'syscohada', true
        FROM UNNEST($1::text[], $2::text[], $3::int[], $4::text[])
             AS s(compte, intitule, classe, nature)
        ON CONFLICT (lower(btrim(compte))) DO NOTHING
        RETURNING true AS insere
        `,
        [comptes, intitules, classes, natures]
      );

      const crees      = rows.length;
      const misAJour   = 0;                                   // plus de réécriture (voir en-tête)
      const intacts    = PLAN_COMPTABLE.length - rows.length; // déjà présents : laissés tels quels

      let desactives = 0;
      if (prune) {
        const { rowCount } = await c.query(
          `UPDATE ${TABLE}
              SET actif = false
            WHERE source = 'syscohada'
              AND actif = true
              AND lower(btrim(compte)) <> ALL (
                    SELECT lower(btrim(x)) FROM UNNEST($1::text[]) AS x)`,
          [comptes]
        );
        desactives = rowCount;
      }

      // Réforme du plan (migration 018) : rattacher les comptes nouvellement
      // chargés à la version publiée du modèle et recalculer leur parent.
      // Sans effet si la 018 n'est pas encore appliquée.
      const { rows: fn } = await c.query(
        "SELECT 1 FROM pg_proc WHERE proname = 'plan_modele_recalculer'"
      );
      if (fn.length > 0) await c.query('SELECT plan_modele_recalculer()');

      await c.query('COMMIT');

      return {
        referentiel: PLAN_COMPTABLE.length,
        crees,
        mis_a_jour:  misAJour,
        intacts,
        desactives,
        repartition: await stats(c),
      };
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {});
      throw err;
    }
  } finally {
    if (!client) c.release();
  }
};

/** État du plan comptable en base, sans rien écrire. */
const planComptableStatus = async ({ client = null } = {}) => {
  const c = client || (await pool.connect());
  try {
    await ensureTable(c);
    const { rows: parClasse } = await c.query(
      `SELECT classe, COUNT(*)::int AS nb FROM ${TABLE}
       WHERE actif GROUP BY classe ORDER BY classe`
    );
    return {
      referentiel: PLAN_COMPTABLE.length,
      repartition: await stats(c),
      par_classe:  parClasse,
    };
  } finally {
    if (!client) c.release();
  }
};

module.exports = { seedPlanComptable, planComptableStatus, ensureReferentielValide, PLAN_COMPTABLE };
