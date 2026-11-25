-- ============================================================================
-- Retour arrière de la migration 077 (écritures générées par la caisse, lot F3).
-- À jouer À LA MAIN, après être revenu au code d'avant la 077 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/077_retour_arriere.sql
-- Supprime les écritures générées depuis le journal de caisse (et leurs
-- extournes). Les écritures saisies à la main et le journal de caisse ne sont
-- pas touchés.
-- ============================================================================
BEGIN;
SET LOCAL app.finance_maintenance = 'on';
-- Écritures générées et leurs extournes, supprimées ensemble (les références
-- croisées sont vérifiées en fin d'instruction).
DELETE FROM fin_ecritures
 WHERE origine_type = 'journal'
    OR (origine_type = 'extourne' AND extourne_de_id IN (SELECT id FROM fin_ecritures WHERE origine_type = 'journal'));
DROP INDEX IF EXISTS idx_fin_ecritures_origine;
DROP INDEX IF EXISTS idx_journal_tenant_date;
ALTER TABLE fin_ecritures DROP COLUMN IF EXISTS origine_empreinte;
DELETE FROM schema_migrations WHERE version LIKE '077_%';
COMMIT;
