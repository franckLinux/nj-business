'use strict';

// ============================================================================
//  NO-OP — contenu déplacé vers db/migrations/011_identite_tenant_code_comptable.sql
// ============================================================================
//  Cette migration ajoutait rubriques.code_comptable et les colonnes d'identité
//  légale de tenants (sigle, nui, registre_commerce, dirigeant_nom, ...).
//
//  Elle n'a jamais été jouée en production : le déploiement passe par
//  `runSetup()` — CLI `npm run db:setup` comme GET /api/admin/setup — qui
//  n'exécute que les fichiers .sql de db/migrations/. sequelize-cli n'est
//  lancé nulle part dans la chaîne de déploiement.
//
//  Sur une base fraîchement provisionnée, les modèles Sequelize déclarant ces
//  colonnes échouaient donc dès le premier SELECT :
//      column "sigle" does not exist / column "code_comptable" does not exist
//
//  Le contenu vit désormais dans db/migrations/011_*.sql, dans le chemin
//  réellement exécuté. Vider cette migration plutôt que la supprimer évite de
//  casser une base de développement où SequelizeMeta en garde la trace.
//
//  → Toute nouvelle évolution de schéma s'écrit en SQL dans db/migrations/,
//    jamais ici. Voir migrations/README.md.
// ============================================================================
module.exports = {
  async up() {},
  async down() {},
};
