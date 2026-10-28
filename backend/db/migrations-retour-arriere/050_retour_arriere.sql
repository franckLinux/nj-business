-- ============================================================================
-- Retour arrière de la migration 050 (NJ COMMERCIAL — paramétrage).
--
-- À jouer À LA MAIN, après être revenu au code d'avant la 050 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/050_retour_arriere.sql
--
-- Supprime UNIQUEMENT les objets créés par la 050 (tables com_, permissions
-- com.*, rôle collaborateur). S'ARRÊTE sans rien toucher si un utilisateur a le
-- rôle « collaborateur » : changez d'abord son rôle.
-- Aucune donnée de caisse n'est concernée.
-- ============================================================================
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE role = 'collaborateur') THEN
    RAISE EXCEPTION 'Des utilisateurs ont le rôle collaborateur : changez leur rôle avant le retour arrière.';
  END IF;
  IF EXISTS (SELECT 1 FROM tenants WHERE 'collaborateur' = ANY (roles_autorises)) THEN
    RAISE EXCEPTION 'Des clients autorisent le rôle collaborateur : retirez-le (Administration plateforme → Rôles) avant le retour arrière.';
  END IF;
END $$;

UPDATE modules SET statut = 'en_preparation', route_accueil = '/', prefixes_api = '{}' WHERE code = 'commercial';
UPDATE tenant_modules SET actif = false, motif = 'Retour arrière 050' WHERE module_code = 'commercial' AND actif;

DROP TABLE IF EXISTS com_stock_mouvements, com_article_magasins, com_article_fournisseurs, com_articles,
                     com_taxes, com_famille_fournisseurs, com_tiers_banque, com_tiers, com_familles,
                     com_magasins, com_parametres;
DROP FUNCTION IF EXISTS com_meme_client();

DELETE FROM user_permissions   WHERE permission_code LIKE 'com.%';
DELETE FROM tenant_permissions WHERE permission_code LIKE 'com.%';
DELETE FROM role_permissions   WHERE permission_code LIKE 'com.%';
DELETE FROM permissions        WHERE code LIKE 'com.%';
DELETE FROM roles WHERE code = 'collaborateur' AND tenant_id IS NULL AND is_system;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role = ANY (ARRAY[
  'super_admin', 'comptable_cabinet', 'directeur', 'caissier', 'auditeur', 'commercial']));
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_roles_autorises_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_roles_autorises_check CHECK (
  roles_autorises IS NULL OR (cardinality(roles_autorises) > 0
  AND roles_autorises <@ ARRAY['directeur', 'caissier', 'auditeur']));

DELETE FROM schema_migrations WHERE version LIKE '050_%';
COMMIT;
