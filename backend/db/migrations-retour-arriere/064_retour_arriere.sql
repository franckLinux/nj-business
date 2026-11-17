-- ============================================================================
-- Retour arrière de la migration 064 (configuration centrale de l'entreprise).
-- À jouer À LA MAIN, après être revenu au code d'avant la 064 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/064_retour_arriere.sql
--
-- Les droits ajoutés par la 064 (trace entreprise_droits_064) sont retirés ;
-- les permissions entreprise.* sont supprimées du catalogue.
-- Le représentant légal en fonction est recopié dans tenants.dirigeant_nom.
-- Le nom commercial recopié dans tenants reste dans com_parametres (inchangé).
-- ATTENTION : les colonnes d'identité ajoutées (slogan, date de création,
-- région, immatriculation, n° statistique, agrément), les références légales
-- et l'historique des représentants sont perdus.
-- ============================================================================
BEGIN;

UPDATE tenants t SET dirigeant_nom = btrim(concat_ws(' ', NULLIF(r.prenoms, ''), r.nom))
  FROM entreprise_representants r
 WHERE r.tenant_id = t.id AND r.fin IS NULL;

DELETE FROM role_permissions rp USING entreprise_droits_064 d
 WHERE d.cible = 'role' AND rp.role_id::text = d.cle AND rp.permission_code = d.permission_code;
DELETE FROM user_permissions up USING entreprise_droits_064 d
 WHERE d.cible = 'utilisateur' AND up.user_id::text = d.cle AND up.permission_code = d.permission_code;
DELETE FROM tenant_permissions tp USING entreprise_droits_064 d
 WHERE d.cible = 'client' AND tp.tenant_id::text = d.cle AND tp.permission_code = d.permission_code;
-- Restes éventuels (attribués après la migration) puis catalogue.
DELETE FROM role_permissions   WHERE permission_code IN ('entreprise.view', 'entreprise.edit');
DELETE FROM user_permissions   WHERE permission_code IN ('entreprise.view', 'entreprise.edit');
DELETE FROM tenant_permissions WHERE permission_code IN ('entreprise.view', 'entreprise.edit');
DELETE FROM permissions        WHERE code IN ('entreprise.view', 'entreprise.edit');
DROP TABLE IF EXISTS entreprise_droits_064;

DROP TABLE IF EXISTS entreprise_representants;
DROP TABLE IF EXISTS entreprise_references;

ALTER TABLE tenants DROP COLUMN IF EXISTS nom_commercial, DROP COLUMN IF EXISTS slogan, DROP COLUMN IF EXISTS date_creation,
  DROP COLUMN IF EXISTS region, DROP COLUMN IF EXISTS immatriculation, DROP COLUMN IF EXISTS numero_statistique,
  DROP COLUMN IF EXISTS agrement;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['com_bons_commande', 'com_devis', 'com_livraisons', 'com_consultations'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS identite_emetteur', t);
    END IF;
  END LOOP;
END $$;

DELETE FROM schema_migrations WHERE version LIKE '064_%';
COMMIT;
