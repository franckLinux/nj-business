#!/usr/bin/env node
// db/setup.js — Initialisation complète en une commande (ligne de commande)
//
//   node db/setup.js                  → schéma + migrations + plan comptable + admin
//   node db/setup.js --status         → état de la base, sans rien écrire
//   node db/setup.js --reset-admin    → réinitialise en plus le mot de passe admin
//   node db/setup.js --prune          → désactive les comptes SYSCOHADA obsolètes
//   node db/setup.js --config         → charge en plus db/data/config-*.js
//   node db/setup.js --config --force → laisse cette config écraser l'existant
//
// Exactement les mêmes étapes que GET /api/admin/setup, via db/lib/setup.js :
// un seul chemin de code, donc pas de dérive entre local et production.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { close } = require('../src/config/database');
const { runSetup, getStatus } = require('./lib/setup');

const main = async () => {
  const args = process.argv.slice(2);

  if (args.includes('--status')) {
    console.log(JSON.stringify(await getStatus(), null, 2));
    return;
  }

  const rapport = await runSetup({
    prune:       args.includes('--prune'),
    resetAdmin:  args.includes('--reset-admin'),
    withConfig:  args.includes('--config'),
    configForce: args.includes('--force'),
    onProgress:  (etape, texte) => console.log(`[Setup] ${etape} : ${texte}`),
  });

  console.log('');
  for (const s of rapport.steps) {
    const marque = s.statut === 'ok' ? '✓' : '✗';
    console.log(`  ${marque} ${s.etape.padEnd(16)} ${s.statut === 'ok' ? '' : s.error} (${s.duree_ms} ms)`);
    if (s.statut === 'ok') console.log(`      ${JSON.stringify(s.detail)}`);
  }
  console.log(`\n[Setup] ${rapport.ok ? 'Terminé ✓' : 'ÉCHEC ✗'} en ${rapport.duree_ms} ms.`);
  if (!rapport.ok) process.exitCode = 1;
};

main()
  .catch((err) => {
    console.error('[Setup] ÉCHEC :', err.message);
    process.exitCode = 1;
  })
  .finally(() => close());
