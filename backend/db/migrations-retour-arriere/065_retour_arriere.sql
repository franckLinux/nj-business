-- ============================================================================
-- Retour arrière de la migration 065 (création d'un client sans module).
-- À jouer À LA MAIN, après être revenu au code d'avant la 065 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/065_retour_arriere.sql
-- NJ CAISSE PRO redevient activé d'office à la création d'un client.
-- Les clients créés sans module depuis la 065 restent tels quels.
-- ============================================================================
BEGIN;
UPDATE modules SET par_defaut = true, updated_at = NOW() WHERE code = 'caisse';
UPDATE modules SET prefixes_api = array_remove(prefixes_api, '/caisse'), updated_at = NOW() WHERE code = 'caisse';
DELETE FROM schema_migrations WHERE version LIKE '065_%';
COMMIT;
