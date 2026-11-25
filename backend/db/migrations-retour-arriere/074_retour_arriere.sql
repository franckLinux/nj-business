-- ============================================================================
-- Retour arrière de la migration 074 (nom « NJ FINANCE » du module caisse).
-- À jouer À LA MAIN, après être revenu au code d'avant la 074 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/074_retour_arriere.sql
-- Rétablit le nom et la description d'origine (048). Rien d'autre ne change.
-- ============================================================================
BEGIN;
UPDATE modules
   SET nom = 'NJ CAISSE PRO',
       description = 'Trésorerie, budget, demandes de fonds et contrôle comptable',
       updated_at = NOW()
 WHERE code = 'caisse';
DELETE FROM schema_migrations WHERE version LIKE '074_%';
COMMIT;
