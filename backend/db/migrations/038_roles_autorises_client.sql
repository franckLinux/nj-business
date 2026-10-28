-- ── 038 — Rôles autorisés par client (octobre 2026) ────────────────────────
--  Le super_admin choisit, client par client, les rôles attribuables à ses
--  utilisateurs (directeur, caissier, auditeur).
--
--  tenants.roles_autorises :
--    NULL      → valeur par défaut selon le type de compte :
--                  démonstration → directeur + caissier,
--                  client        → tous les rôles ;
--    tableau   → choix explicite du super_admin (prioritaire, y compris
--                pour une démonstration).
--  Le NOMBRE d'utilisateurs n'est plus limité en démonstration (décision du
--  15/10/2026 : 2 rôles, plusieurs utilisateurs).
--  Une conversion démo → client crée un nouvel espace : roles_autorises NULL,
--  donc tous les rôles.
-- Idempotente.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS roles_autorises TEXT[];

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tenants_roles_autorises') THEN
    ALTER TABLE tenants ADD CONSTRAINT ck_tenants_roles_autorises CHECK (
      roles_autorises IS NULL
      OR (cardinality(roles_autorises) > 0
          AND roles_autorises <@ ARRAY['directeur', 'caissier', 'auditeur']::TEXT[])
    );
  END IF;
END $$;
