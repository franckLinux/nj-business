-- ============================================================================
-- Retour arrière de la migration 085 (sollicitation de la Demande de fonds
-- depuis une demande de fonds d'activité). À jouer À LA MAIN :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/085_retour_arriere.sql
-- Les lignes ajoutées à la Demande de fonds de la caisse (depenses_attente)
-- restent : ce sont des lignes ordinaires, modifiables dans Caisse Pro.
-- ============================================================================
BEGIN;
DROP TABLE IF EXISTS projet_demande_sollicitations;
DELETE FROM schema_migrations WHERE version LIKE '085_%';
COMMIT;
