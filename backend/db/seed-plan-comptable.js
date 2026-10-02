#!/usr/bin/env node
// db/seed-plan-comptable.js — Plan comptable SYSCOHADA (ligne de commande)
//
//   node db/seed-plan-comptable.js            → charge / met à jour
//   node db/seed-plan-comptable.js --status   → état sans rien écrire
//   node db/seed-plan-comptable.js --prune    → désactive en plus les comptes
//                                               'syscohada' absents du référentiel
//
// La logique et ses garanties (idempotence, transaction, respect des comptes
// 'custom') vivent dans db/lib/seed-plan.lib.js.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { close, describeTarget } = require('../src/config/database');
const {
  seedPlanComptable,
  planComptableStatus,
  PLAN_COMPTABLE,
} = require('./lib/seed-plan.lib');

const printRepartition = (rows) => {
  if (rows.length === 0) return console.log('  (table vide)');
  rows.forEach((r) =>
    console.log(
      `  ${r.source.padEnd(10)} ${String(r.actifs).padStart(5)} actif(s)` +
      (r.inactifs ? `, ${r.inactifs} inactif(s)` : '')
    ));
};

const main = async () => {
  const args = process.argv.slice(2);
  console.log(`[Plan] Cible : ${describeTarget()}`);
  console.log(`[Plan] Référentiel embarqué : ${PLAN_COMPTABLE.length} comptes`);

  if (args.includes('--status')) {
    const { repartition, par_classe } = await planComptableStatus();
    console.log('[Plan] État actuel en base :');
    printRepartition(repartition);
    par_classe.forEach((r) => console.log(`  classe ${r.classe ?? '?'} : ${r.nb}`));
    return;
  }

  const prune = args.includes('--prune');
  const r = await seedPlanComptable({ prune });

  console.log(`[Plan] ${r.crees} compte(s) créé(s), ${r.mis_a_jour} mis à jour.`);
  if (r.intacts > 0) {
    console.log(`[Plan] ${r.intacts} compte(s) laissé(s) intact(s) (créés manuellement, source='custom').`);
  }
  if (prune) console.log(`[Plan] ${r.desactives} compte(s) obsolète(s) désactivé(s).`);
  console.log('[Plan] Répartition en base :');
  printRepartition(r.repartition);
};

main()
  .catch((err) => {
    console.error('[Plan] ÉCHEC :', err.message);
    process.exitCode = 1;
  })
  .finally(() => close());
