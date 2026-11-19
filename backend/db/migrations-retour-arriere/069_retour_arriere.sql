-- ============================================================================
-- Retour arrière de la migration 069 (suivi de la caisse des projets, lot P1).
-- À jouer À LA MAIN, après être revenu au code d'avant la 069 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/069_retour_arriere.sql
-- Les écritures du journal ne sont PAS touchées : seuls les liens écriture ↔
-- projet, les budgets de projet, les désignations et les natures de recette
-- sont supprimés. Les activités et projets eux-mêmes restent en place.
-- ============================================================================
BEGIN;
UPDATE modules SET prefixes_api = array_remove(prefixes_api, '/projets'), updated_at = NOW() WHERE code = 'caisse';

DELETE FROM tenant_permissions WHERE permission_code IN
  ('projets.voir', 'projets.gerer', 'budgets_projet.valider', 'justificatifs.valider', 'justificatifs.annuler');
DELETE FROM user_permissions WHERE permission_code IN
  ('projets.voir', 'projets.gerer', 'budgets_projet.valider', 'justificatifs.valider', 'justificatifs.annuler');
DELETE FROM role_permissions WHERE permission_code IN
  ('projets.voir', 'projets.gerer', 'budgets_projet.valider', 'justificatifs.valider', 'justificatifs.annuler');
DELETE FROM permissions WHERE code IN
  ('projets.voir', 'projets.gerer', 'budgets_projet.valider', 'justificatifs.valider', 'justificatifs.annuler');

DROP TABLE IF EXISTS projet_budget_lignes;
DROP TABLE IF EXISTS projet_budgets;
DROP TABLE IF EXISTS journal_imputations_projet;
DROP FUNCTION IF EXISTS projet_budget_ligne_proteger();
DROP FUNCTION IF EXISTS projet_budget_proteger();
DROP FUNCTION IF EXISTS imputation_projet_controle();

DROP TRIGGER IF EXISTS trg_activites_projet_coherence ON activites;
DROP FUNCTION IF EXISTS activites_projet_coherence();
DROP INDEX IF EXISTS idx_activites_projet;
ALTER TABLE activites DROP COLUMN IF EXISTS responsable_id;
ALTER TABLE activites DROP COLUMN IF EXISTS chef_projet_id;
ALTER TABLE activites DROP COLUMN IF EXISTS projet_id;

ALTER TABLE rubriques DROP CONSTRAINT IF EXISTS chk_rubriques_nature_recette;
ALTER TABLE rubriques DROP COLUMN IF EXISTS nature_recette;
DROP FUNCTION IF EXISTS nature_recette_affectee(TEXT);
DROP FUNCTION IF EXISTS tenant_est_ong(UUID);

DELETE FROM schema_migrations WHERE version LIKE '069_%';
COMMIT;
