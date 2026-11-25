-- ============================================================================
-- Retour arrière de la migration 075 (socle comptable NJ FINANCE, lot F2).
-- À jouer À LA MAIN, après être revenu au code d'avant la 075 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/075_retour_arriere.sql
-- ATTENTION : supprime les exercices, périodes, journaux comptables et TOUTES
-- les écritures comptables saisies depuis la 075. Faire une sauvegarde avant.
-- Les données de caisse (journal, ran, arrêts…) ne sont pas touchées.
-- ============================================================================
BEGIN;
SET LOCAL app.finance_maintenance = 'on';
DROP TABLE IF EXISTS fin_ecriture_lignes;
DROP TABLE IF EXISTS fin_ecritures;
DROP TABLE IF EXISTS fin_journaux;
DROP TABLE IF EXISTS fin_periodes;
DROP TABLE IF EXISTS fin_exercices;
DROP FUNCTION IF EXISTS fin_ecritures_controle();
DROP FUNCTION IF EXISTS fin_lignes_controle();
DROP FUNCTION IF EXISTS fin_periodes_controle();
DROP FUNCTION IF EXISTS fin_journaux_controle();
DROP FUNCTION IF EXISTS fin_exercices_controle();
DROP FUNCTION IF EXISTS fin_compte_anomalie(UUID, TEXT);
-- plan_client_est_utilise : définition de la 037.
CREATE OR REPLACE FUNCTION plan_client_est_utilise(p_tenant UUID, p_compte TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM rubriques r
     WHERE r.tenant_id = p_tenant
       AND lower(btrim(coalesce(r.code_comptable, ''))) = lower(btrim(p_compte))
  ) OR EXISTS (
    SELECT 1 FROM equivalences_comptables e
     WHERE e.tenant_id = p_tenant AND e.statut IN ('valide', 'brouillon')
       AND lower(btrim(e.compte)) = lower(btrim(p_compte))
  ) OR EXISTS (
    SELECT 1 FROM journaux j
     WHERE j.tenant_id = p_tenant
       AND lower(btrim(j.compte_tresorerie)) = lower(btrim(p_compte))
  ) OR EXISTS (
    SELECT 1 FROM tenants t
     WHERE t.id = p_tenant
       AND lower(btrim(t.compte_virements)) = lower(btrim(p_compte))
  );
$$;
DELETE FROM user_permissions   WHERE permission_code LIKE 'finance.%';
DELETE FROM tenant_permissions WHERE permission_code LIKE 'finance.%';
DELETE FROM role_permissions   WHERE permission_code LIKE 'finance.%';
DELETE FROM permissions        WHERE code LIKE 'finance.%';
UPDATE modules SET prefixes_api = array_remove(prefixes_api, '/finance'), updated_at = NOW() WHERE code = 'caisse';
DELETE FROM schema_migrations WHERE version LIKE '075_%';
COMMIT;
