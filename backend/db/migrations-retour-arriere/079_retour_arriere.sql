-- ============================================================================
-- Retour arrière de la migration 079 (configuration de la facturation, lot F5).
-- À jouer À LA MAIN, après être revenu au code d'avant la 079 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/079_retour_arriere.sql
-- Supprime les référentiels de facturation de NJ FINANCE. Les taxes
-- (com_taxes, partagées avec NJ COMMERCIAL) ne sont pas touchées.
-- ============================================================================
BEGIN;
DROP TABLE IF EXISTS fin_sequences;
DROP TABLE IF EXISTS fin_taxes_comptes;
DROP TABLE IF EXISTS fin_modes_reglement;
DROP TABLE IF EXISTS fin_prestations;
DROP TABLE IF EXISTS fin_familles;
DROP TABLE IF EXISTS fin_categories;
DROP FUNCTION IF EXISTS fin_config_coherence();
-- plan_client_est_utilise : définition de la 075.
CREATE OR REPLACE FUNCTION plan_client_est_utilise(p_tenant UUID, p_compte TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM rubriques r WHERE r.tenant_id = p_tenant AND lower(btrim(coalesce(r.code_comptable, ''))) = lower(btrim(p_compte)))
      OR EXISTS (SELECT 1 FROM equivalences_comptables e WHERE e.tenant_id = p_tenant AND e.statut IN ('valide', 'brouillon') AND lower(btrim(e.compte)) = lower(btrim(p_compte)))
      OR EXISTS (SELECT 1 FROM journaux j WHERE j.tenant_id = p_tenant AND lower(btrim(j.compte_tresorerie)) = lower(btrim(p_compte)))
      OR EXISTS (SELECT 1 FROM tenants t WHERE t.id = p_tenant AND lower(btrim(t.compte_virements)) = lower(btrim(p_compte)))
      OR EXISTS (SELECT 1 FROM fin_ecriture_lignes l WHERE l.tenant_id = p_tenant AND lower(btrim(l.compte)) = lower(btrim(p_compte)));
$$;
DELETE FROM permissions WHERE code = 'finance.config.facturation';
DELETE FROM schema_migrations WHERE version LIKE '079_%';
COMMIT;
