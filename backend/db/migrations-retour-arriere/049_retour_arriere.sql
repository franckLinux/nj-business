-- ============================================================================
-- Retour arrière de la migration 049 (catalogue des modules).
-- Remet le catalogue de la 048. Ne touche à aucune autre table.
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/049_retour_arriere.sql
-- ============================================================================
BEGIN;
-- Les nouveaux modules ne sont retirés que s'ils n'ont jamais été activés.
DELETE FROM tenant_modules WHERE module_code IN ('cg', 'dsf', 'revis') AND NOT actif;
DELETE FROM modules m WHERE m.code IN ('cg', 'dsf', 'revis')
   AND NOT EXISTS (SELECT 1 FROM tenant_modules tm WHERE tm.module_code = m.code);
UPDATE modules SET nom = 'NJ COMMERCIAL', description = 'Ventes, achats, facturation et point de vente' WHERE code = 'commercial';
UPDATE modules SET statut = 'en_preparation', description = 'Articles, dépôts, mouvements et inventaires' WHERE code = 'stock' AND statut = 'retire';
UPDATE modules SET ordre = 50 WHERE code = 'rh';
DELETE FROM schema_migrations WHERE version LIKE '049_%';
COMMIT;
