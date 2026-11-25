-- ============================================================================
-- Retour arrière de la migration 080 (achats, lot F6).
-- À jouer À LA MAIN, après être revenu au code d'avant la 080 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/080_retour_arriere.sql
-- Supprime les factures fournisseurs saisies dans NJ FINANCE, les imputations
-- des factures de NJ COMMERCIAL, les affectations de règlements et les
-- écritures d'achat (et leurs extournes). Le journal de caisse et les factures
-- de NJ COMMERCIAL ne sont pas touchés. Les écritures de caisse qui portaient
-- un règlement (compte 401) seront refaites au prochain passage du générateur.
-- ============================================================================
BEGIN;
SET LOCAL app.finance_maintenance = 'on';
DELETE FROM fin_ecritures
 WHERE origine_type IN ('fin_facture', 'com_ff')
    OR (origine_type = 'extourne' AND extourne_de_id IN (SELECT id FROM fin_ecritures WHERE origine_type IN ('fin_facture', 'com_ff')));
DROP TABLE IF EXISTS fin_reglement_affectations;
DROP TABLE IF EXISTS fin_imputations_externes;
DROP TABLE IF EXISTS fin_facture_lignes;
DROP TABLE IF EXISTS fin_factures;
DROP FUNCTION IF EXISTS fin_facture_reste(TEXT, BIGINT);
DROP FUNCTION IF EXISTS fin_factures_controle();
DROP FUNCTION IF EXISTS fin_facture_lignes_controle();
DROP FUNCTION IF EXISTS fin_imputations_controle();
DROP FUNCTION IF EXISTS fin_affectations_controle();
CREATE OR REPLACE FUNCTION plan_client_est_utilise(p_tenant UUID, p_compte TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM rubriques r WHERE r.tenant_id = p_tenant AND lower(btrim(coalesce(r.code_comptable, ''))) = lower(btrim(p_compte)))
      OR EXISTS (SELECT 1 FROM equivalences_comptables e WHERE e.tenant_id = p_tenant AND e.statut IN ('valide', 'brouillon') AND lower(btrim(e.compte)) = lower(btrim(p_compte)))
      OR EXISTS (SELECT 1 FROM journaux j WHERE j.tenant_id = p_tenant AND lower(btrim(j.compte_tresorerie)) = lower(btrim(p_compte)))
      OR EXISTS (SELECT 1 FROM tenants t WHERE t.id = p_tenant AND lower(btrim(t.compte_virements)) = lower(btrim(p_compte)))
      OR EXISTS (SELECT 1 FROM fin_ecriture_lignes l WHERE l.tenant_id = p_tenant AND lower(btrim(l.compte)) = lower(btrim(p_compte)))
      OR EXISTS (SELECT 1 FROM fin_categories c WHERE c.tenant_id = p_tenant AND lower(btrim(c.compte_defaut)) = lower(btrim(p_compte)))
      OR EXISTS (SELECT 1 FROM fin_familles f WHERE f.tenant_id = p_tenant AND lower(btrim(p_compte)) IN (lower(btrim(f.compte_produit)), lower(btrim(f.compte_charge))))
      OR EXISTS (SELECT 1 FROM fin_prestations p WHERE p.tenant_id = p_tenant AND lower(btrim(p_compte)) IN (lower(btrim(p.compte_produit)), lower(btrim(p.compte_charge))))
      OR EXISTS (SELECT 1 FROM fin_taxes_comptes x WHERE x.tenant_id = p_tenant AND lower(btrim(p_compte)) IN (lower(btrim(x.compte_collecte)), lower(btrim(x.compte_deductible)), lower(btrim(x.compte_deductible_immo))));
$$;
DELETE FROM permissions WHERE code IN ('finance.achats.voir', 'finance.achats.saisir', 'finance.achats.valider', 'finance.reglements.affecter');
DELETE FROM schema_migrations WHERE version LIKE '080_%';
COMMIT;
