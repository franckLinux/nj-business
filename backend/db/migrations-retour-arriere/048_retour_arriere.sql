-- ============================================================================
-- Retour arrière de la migration 048 (NJ BUSINESS — modules).
--
-- À jouer À LA MAIN, uniquement après être revenu au code d'avant la 048
-- (sinon le serveur ne trouve plus les tables et revient au comportement
-- « système de modules non installé » : aucun blocage).
--
-- Ne supprime QUE les objets créés par la 048. Aucune donnée de caisse,
-- aucun client, utilisateur, journal ou historique n'est touché.
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/048_retour_arriere.sql
-- ============================================================================
BEGIN;
DROP TRIGGER IF EXISTS trg_tenant_modules_par_defaut ON tenants;
DROP FUNCTION IF EXISTS tenant_modules_par_defaut();
DROP TABLE IF EXISTS tenant_modules;
DROP TABLE IF EXISTS modules;
DELETE FROM schema_migrations WHERE version LIKE '048_%';
COMMIT;
