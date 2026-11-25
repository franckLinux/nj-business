-- ============================================================================
-- Retour arrière de la migration 078 (clients et fournisseurs, lot F4).
-- À jouer À LA MAIN, après être revenu au code d'avant la 078 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/078_retour_arriere.sql
-- Supprime les conditions financières (délai, mode de règlement, observations).
-- Le registre des tiers (identité, compte auxiliaire) n'est pas touché.
-- ============================================================================
BEGIN;
DROP TABLE IF EXISTS fin_tiers;
DROP FUNCTION IF EXISTS fin_tiers_controle();
DELETE FROM permissions WHERE code IN ('finance.tiers.voir', 'finance.tiers.gerer');
DELETE FROM schema_migrations WHERE version LIKE '078_%';
COMMIT;
