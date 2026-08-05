#!/usr/bin/env node
// db/seed-plan-comptable.js
// ============================================================================
//  Chargement du plan comptable SYSCOHADA révisé dans la table
//  `plan_comptable_syscohada`.
//
//  Utilisation :
//      node db/seed-plan-comptable.js            → charge / met à jour
//      node db/seed-plan-comptable.js --status   → état sans rien écrire
//      node db/seed-plan-comptable.js --prune    → désactive en plus les comptes
//                                                  'syscohada' absents du référentiel
//
//  Garanties (chargement « stable ») :
//    • Idempotent : relançable autant de fois que voulu, même résultat.
//    • Transactionnel : tout ou rien.
//    • Les comptes personnalisés (source = 'custom') créés depuis l'application
//      ne sont JAMAIS écrasés ni désactivés.
//    • Les comptes du référentiel déjà présents sont réactivés (actif = true)
//      et leur intitulé/classe/nature réalignés sur le référentiel.
// ============================================================================
require('dotenv').config();
const { pool, close, describeTarget } = require('../src/config/database');
const { PLAN_COMPTABLE } = require('./data/plan-comptable-syscohada');

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
      `Référentiel invalide — numéro(s) de compte en double : ${doublons.join(', ')}\n` +
      '       Corrigez db/data/plan-comptable-syscohada.js.'
    );
  }
};

/** Vérifie que la migration 005 a bien été appliquée. */
const ensureTable = async (client) => {
  const { rows } = await client.query('SELECT to_regclass($1) AS t', [TABLE]);
  if (!rows[0].t) {
    throw new Error(
      `Table « ${TABLE} » absente. Appliquez d'abord les migrations :\n` +
      '       npm run db:migrate'
    );
  }
  // L'UPSERT s'appuie sur l'index unique d'expression créé par la migration 005.
  const { rows: idx } = await client.query(
    `SELECT 1 FROM pg_indexes WHERE tablename = $1 AND indexname = 'uq_pcs_compte'`,
    [TABLE]
  );
  if (idx.length === 0) {
    throw new Error(
      "Index unique « uq_pcs_compte » absent : la migration 005_pieces_plan.sql\n" +
      '       n\'a pas été appliquée. Lancez : npm run db:migrate'
    );
  }
};

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

const printStats = (rows) => {
  if (rows.length === 0) {
    console.log('  (table vide)');
    return;
  }
  rows.forEach((r) =>
    console.log(`  ${r.source.padEnd(10)} ${String(r.actifs).padStart(5)} actif(s)` +
                (r.inactifs ? `, ${r.inactifs} inactif(s)` : '')));
};

const main = async () => {
  const args       = process.argv.slice(2);
  const statusOnly = args.includes('--status');
  const prune      = args.includes('--prune');

  ensureReferentielValide();
  console.log(`[Plan] Cible : ${describeTarget()}`);
  console.log(`[Plan] Référentiel embarqué : ${PLAN_COMPTABLE.length} comptes`);

  const client = await pool.connect();
  try {
    await ensureTable(client);

    if (statusOnly) {
      console.log('[Plan] État actuel en base :');
      printStats(await stats(client));
      const { rows } = await client.query(
        `SELECT classe, COUNT(*)::int AS nb FROM ${TABLE}
         WHERE actif GROUP BY classe ORDER BY classe`
      );
      rows.forEach((r) => console.log(`  classe ${r.classe ?? '?'} : ${r.nb}`));
      return;
    }

    await client.query('BEGIN');

    // Envoi du référentiel en un seul aller-retour via UNNEST.
    const comptes   = PLAN_COMPTABLE.map((c) => c.compte);
    const intitules = PLAN_COMPTABLE.map((c) => c.intitule);
    const classes   = PLAN_COMPTABLE.map((c) => c.classe);
    const natures   = PLAN_COMPTABLE.map((c) => c.nature);

    const { rows } = await client.query(
      `
      INSERT INTO ${TABLE} (compte, intitule, classe, nature, source, actif)
      SELECT s.compte, s.intitule, s.classe, s.nature, 'syscohada', true
      FROM UNNEST($1::text[], $2::text[], $3::int[], $4::text[])
           AS s(compte, intitule, classe, nature)
      ON CONFLICT (lower(btrim(compte))) DO UPDATE
        SET intitule = EXCLUDED.intitule,
            classe   = EXCLUDED.classe,
            nature   = EXCLUDED.nature,
            actif    = true
        -- un compte créé par l'utilisateur reste sa propriété : on n'y touche pas
        WHERE ${TABLE}.source IS DISTINCT FROM 'custom'
      RETURNING (xmax = 0) AS insere
      `,
      [comptes, intitules, classes, natures]
    );

    const inseres = rows.filter((r) => r.insere).length;
    const majs    = rows.length - inseres;
    const ignores = PLAN_COMPTABLE.length - rows.length; // conflits sur comptes 'custom'

    let desactives = 0;
    if (prune) {
      const { rowCount } = await client.query(
        `UPDATE ${TABLE}
            SET actif = false
          WHERE source = 'syscohada'
            AND actif = true
            AND lower(btrim(compte)) <> ALL (
                  SELECT lower(btrim(c)) FROM UNNEST($1::text[]) AS c)`,
        [comptes]
      );
      desactives = rowCount;
    }

    await client.query('COMMIT');

    console.log(`[Plan] ${inseres} compte(s) créé(s), ${majs} mis à jour.`);
    if (ignores > 0) {
      console.log(`[Plan] ${ignores} compte(s) laissé(s) intact(s) (créés manuellement, source='custom').`);
    }
    if (prune) {
      console.log(`[Plan] ${desactives} compte(s) obsolète(s) désactivé(s).`);
    }
    console.log('[Plan] Répartition en base :');
    printStats(await stats(client));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await close();
  }
};

main().catch((err) => {
  console.error('[Plan] ÉCHEC :', err.message);
  process.exit(1);
});
