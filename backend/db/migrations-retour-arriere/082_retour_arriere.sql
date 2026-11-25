-- ============================================================================
-- Retour arrière de la migration 082 (lecture automatique des factures, lot F7).
-- À jouer À LA MAIN, après être revenu au code d'avant la 082 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/082_retour_arriere.sql
-- Supprime les lectures enregistrées. Les factures créées à partir d'une lecture
-- restent (ce sont des factures ordinaires) ; les fichiers déposés restent dans le
-- stockage privé, sous <client>/extractions/ : à supprimer à la main si voulu.
-- ============================================================================
BEGIN;
DROP TABLE IF EXISTS fin_extractions;
DELETE FROM permissions WHERE code = 'finance.achats.importer';
DELETE FROM schema_migrations WHERE version LIKE '082_%';
COMMIT;
