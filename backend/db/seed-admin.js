#!/usr/bin/env node
// db/seed-admin.js — Crée le super admin initial (interface en ligne de commande)
//
//   node db/seed-admin.js   → crée le compte, ou réinitialise son mot de passe
//
// En CLI, le mot de passe est réinitialisé si le compte existe déjà : c'est la
// procédure de secours en cas de mot de passe perdu, et elle suppose un accès
// shell à la machine. L'endpoint HTTP, lui, ne réinitialise rien par défaut.
//
// La logique vit dans db/lib/seed-admin.lib.js.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { close, describeTarget } = require('../src/config/database');
const { seedAdmin } = require('./lib/seed-admin.lib');

const LIBELLES = {
  cree:         'créé',
  reinitialise: 'existant → mot de passe réinitialisé',
  inchange:     'existant → inchangé',
};

const main = async () => {
  console.log(`[Seed] Cible : ${describeTarget()}`);
  const { username, action } = await seedAdmin({ resetIfExists: true });
  console.log(`[Seed] Super admin « ${username} » ${LIBELLES[action]}.`);
  console.log(
    `[Seed] Mot de passe : ${process.env.SEED_ADMIN_PASSWORD || 'Admin2026!'}` +
    '  → à changer dès la première connexion.'
  );
};

main()
  .catch((err) => {
    console.error('[Seed] ÉCHEC :', err.message);
    process.exitCode = 1;
  })
  .finally(() => close());
