-- ============================================================================
-- Retour arrière de la migration 067 (sessions côté serveur).
-- À jouer À LA MAIN, après être revenu au code d'avant la 067 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/067_retour_arriere.sql
-- L'historique des connexions (table sessions) est perdu ; les comptes ne sont
-- pas touchés. Le journal d'audit garde les connexions et déconnexions.
-- ============================================================================
BEGIN;
DROP TABLE IF EXISTS sessions;
DELETE FROM plateforme_reglages WHERE cle = 'sessions';
DELETE FROM schema_migrations WHERE version LIKE '067_%';
COMMIT;
