-- ============================================================================
-- Retour arrière de la migration 071 (lignes budgétaires, lot P4).
-- À jouer À LA MAIN, après être revenu au code d'avant la 071 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/071_retour_arriere.sql
-- Supprime les lignes budgétaires et le rattachement des justificatifs à une
-- ligne. Les montants par activité, les justificatifs et le journal restent.
-- Les remises globales au projet restent des sorties du journal rattachées au
-- projet (elles redeviennent comptées dans le budget de fonctionnement).
-- ============================================================================
BEGIN;
DROP TRIGGER IF EXISTS trg_projet_justificatif_poste_fige ON projet_justificatifs;
DROP FUNCTION IF EXISTS projet_justificatif_poste_fige();
DROP INDEX IF EXISTS idx_justif_poste;
SET LOCAL app.journal_maintenance = 'on';
ALTER TABLE projet_justificatifs DROP COLUMN IF EXISTS poste_libelle;
ALTER TABLE projet_justificatifs DROP COLUMN IF EXISTS poste_cle;
DROP TABLE IF EXISTS projet_budget_postes;
DROP FUNCTION IF EXISTS projet_budget_poste_proteger();
DELETE FROM schema_migrations WHERE version LIKE '071_%';
COMMIT;
