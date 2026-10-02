#!/usr/bin/env node
// backend/tools/check-drift.js
// ============================================================================
//  Détecte la dérive entre les modèles Sequelize (src/models/) et le schéma
//  réellement présent en base.
//
//      npm run db:check-drift
//
//  Raison d'être : les migrations de schéma vivent dans db/migrations/*.sql,
//  les modèles dans src/models/. Rien ne relie mécaniquement les deux. Ajouter
//  un attribut à un modèle sans écrire la migration correspondante passe la
//  revue de code, passe le démarrage du serveur — et casse en production au
//  premier SELECT, avec un « column "x" does not exist » loin de sa cause.
//
//  C'est exactement ce qui s'est produit avec tenants.sigle et
//  rubriques.code_comptable (cf. migrations/README.md).
//
//  Sort en code 1 si un modèle référence une colonne absente de la base.
//  Les colonnes présentes en base mais absentes des modèles ne sont qu'un
//  avertissement : c'est le cas normal des tables gérées en SQL brut.
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { pool, close, describeTarget } = require('../src/config/database');

const main = async () => {
  const db = require('../src/models');
  console.log(`\n[Drift] Cible : ${describeTarget()}\n`);

  const { rows } = await pool.query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'`
  );

  const enBase = new Map();
  for (const { table_name, column_name } of rows) {
    if (!enBase.has(table_name)) enBase.set(table_name, new Set());
    enBase.get(table_name).add(column_name);
  }

  const manquantes = [];
  const tablesAbsentes = [];
  let modelesVerifies = 0;

  for (const nom of Object.keys(db)) {
    const modele = db[nom];
    if (!modele || typeof modele.getTableName !== 'function') continue; // sequelize, Sequelize

    const table = String(modele.getTableName());
    const colonnes = enBase.get(table);

    if (!colonnes) {
      tablesAbsentes.push(`${nom} → table "${table}" absente de la base`);
      continue;
    }
    modelesVerifies += 1;

    for (const [attribut, def] of Object.entries(modele.rawAttributes)) {
      // `field` porte le nom réel de la colonne quand il diffère de l'attribut.
      const colonne = def.field || attribut;
      if (!colonnes.has(colonne)) {
        manquantes.push(`${nom} (${table}) → colonne "${colonne}" absente`);
      }
    }
  }

  if (tablesAbsentes.length) {
    console.log('  Tables absentes de la base :');
    tablesAbsentes.forEach((m) => console.log(`  · ${m}`));
    console.log('');
  }

  if (manquantes.length === 0) {
    console.log(`  ✓ ${modelesVerifies} modèle(s) vérifié(s) — aucune colonne manquante.\n`);
    return 0;
  }

  console.log('  ✗ Colonnes déclarées dans un modèle mais absentes de la base :\n');
  manquantes.forEach((m) => console.log(`      ${m}`));
  console.log(
    '\n  Ces attributs feront échouer le premier SELECT du modèle concerné.\n' +
    '  Écrivez la migration correspondante dans db/migrations/ (numérotée à la\n' +
    '  suite, idempotente), puis rejouez : npm run db:migrate\n'
  );
  return 1;
};

main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => {
    console.error('[Drift] ÉCHEC :', err.message);
    process.exitCode = 1;
  })
  .finally(() => close());
