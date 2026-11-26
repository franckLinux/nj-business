-- ============================================================================
-- Retour arrière de la migration 084 (lot F10 : tableau des immobilisations).
-- À jouer À LA MAIN, après être revenu au code d'avant la 084 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/084_retour_arriere.sql
-- Supprime le registre des immobilisations et ses catégories. Aucune écriture
-- comptable n'en dépend (les dotations ne sont pas passées par ce lot).
-- ============================================================================
BEGIN;
DROP TABLE IF EXISTS fin_immobilisations;
DROP TABLE IF EXISTS fin_immo_categories;
DROP FUNCTION IF EXISTS fin_immo_controle();
DELETE FROM permissions WHERE code IN ('finance.immos.voir', 'finance.immos.gerer');
DELETE FROM schema_migrations WHERE version LIKE '084_%';
COMMIT;
