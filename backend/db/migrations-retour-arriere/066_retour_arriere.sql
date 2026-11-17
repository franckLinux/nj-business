-- ============================================================================
-- Retour arrière de la migration 066 (utilisateurs par module).
-- À jouer À LA MAIN, après être revenu au code d'avant la 066 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/066_retour_arriere.sql
-- Les comptes ne sont pas touchés ; seules les affectations aux modules (et
-- leurs profils propres) et les réglages de la plateforme sont supprimés.
-- ============================================================================
BEGIN;
DROP TABLE IF EXISTS user_modules;
DROP FUNCTION IF EXISTS user_modules_coherence();
DROP TABLE IF EXISTS plateforme_reglages;
DELETE FROM schema_migrations WHERE version LIKE '066_%';
COMMIT;
