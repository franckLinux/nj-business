-- ============================================================================
-- Retour arrière de la migration 073 (pièces justificatives privées).
-- À jouer À LA MAIN, après être revenu au code d'avant la 073 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/073_retour_arriere.sql
-- Rétablit les adresses publiques /uploads/<chemin> (le code d'avant la 073
-- sert de nouveau le dossier en statique : les pièces redeviennent publiques).
-- ============================================================================
BEGIN;
UPDATE pieces_jointes
   SET storage_url = '/uploads/' || storage_path
 WHERE storage_url = '/api/pieces/fichier/' || id;
DELETE FROM schema_migrations WHERE version LIKE '073_%';
COMMIT;
