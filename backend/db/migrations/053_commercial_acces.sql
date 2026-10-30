-- ============================================================================
-- 053 — NJ COMMERCIAL : accès au module chez les clients (30/10/2026)
--
--  Constat : un client dont le plafond de permissions (tenant_permissions) a
--  été enregistré SANS aucune permission com.* ne peut pas utiliser NJ
--  COMMERCIAL, même module activé : le module reste invisible pour tous ses
--  utilisateurs. Activer le module, c'est l'ouvrir (règle de la 050).
--
--  Correction : pour chaque client où NJ COMMERCIAL est ACTIVÉ, qui a un
--  plafond et dont le plafond ne contient AUCUNE permission com.*, les
--  permissions com.* y sont ajoutées. Un plafond qui en contient déjà au
--  moins une est un choix du cabinet : il n'est pas touché.
--
--  Ajout de lignes seulement, rien n'est supprimé ni modifié. Idempotente.
--  Les droits de chaque personne restent fixés par son rôle et son profil.
--  Retour arrière : migrations-retour-arriere/053_retour_arriere.sql
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.tenant_modules') IS NULL THEN
    RAISE NOTICE '053 : système de modules absent (048), rien à faire.';
    RETURN;
  END IF;

  CREATE TABLE IF NOT EXISTS com_acces_053 (
    tenant_id       UUID NOT NULL,
    permission_code VARCHAR(100) NOT NULL,
    ajoute_le       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, permission_code)
  );
  COMMENT ON TABLE com_acces_053 IS 'Trace des permissions com.* ajoutées au plafond par la migration 053 (pour le retour arrière).';

  WITH cibles AS (
    SELECT tm.tenant_id
      FROM tenant_modules tm
     WHERE tm.module_code = 'commercial' AND tm.actif
       AND EXISTS (SELECT 1 FROM tenant_permissions tp WHERE tp.tenant_id = tm.tenant_id)
       AND NOT EXISTS (SELECT 1 FROM tenant_permissions tp JOIN permissions p ON p.code = tp.permission_code
                        WHERE tp.tenant_id = tm.tenant_id AND p.module = 'commercial')
  ), ajout AS (
    INSERT INTO tenant_permissions (tenant_id, permission_code)
    SELECT c.tenant_id, p.code FROM cibles c CROSS JOIN permissions p WHERE p.module = 'commercial'
    ON CONFLICT DO NOTHING
    RETURNING tenant_id, permission_code
  )
  INSERT INTO com_acces_053 (tenant_id, permission_code) SELECT tenant_id, permission_code FROM ajout
  ON CONFLICT DO NOTHING;
END $$;
