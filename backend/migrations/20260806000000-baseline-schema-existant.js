'use strict';

// Le schéma actuel (tenants, users, journal, journaux, budget, ...) a déjà été
// créé par le système de migrations SQL historique (db/schema.sql +
// db/migrations/001 à 010, rejoué via `npm run db:migrate`). Cette migration
// ne recrée donc rien : elle marque le point de départ à partir duquel
// Sequelize devient responsable des futures migrations de schéma.
// Sur une base déjà provisionnée, `npx sequelize-cli db:migrate` ne fera
// qu'initialiser la table SequelizeMeta (no-op sur les données/le schéma).
module.exports = {
  async up() {},
  async down() {},
};
