-- ============================================================================
-- Retour arrière de la migration 070 (justificatifs des projets, lot P3).
-- À jouer À LA MAIN, après être revenu au code d'avant la 070 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/070_retour_arriere.sql
-- ATTENTION : supprime l'enregistrement des justificatifs. Les fichiers déposés
-- restent sur le disque (PV_DIR/<client>/justificatifs/…) : à archiver à part.
-- Les écritures du journal ne sont pas touchées.
-- ============================================================================
BEGIN;
DROP TABLE IF EXISTS projet_justificatifs;
DROP FUNCTION IF EXISTS projet_justificatif_proteger();
DELETE FROM schema_migrations WHERE version LIKE '070_%';
COMMIT;
