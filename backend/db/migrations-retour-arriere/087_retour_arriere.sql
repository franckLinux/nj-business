-- ============================================================================
-- Retour arrière de la migration 087 (missions, tiers payeur). À jouer À LA MAIN :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/087_retour_arriere.sql
-- Les mouvements de caisse des missions restent au journal (leur écriture de
-- caisse repasse sur le compte de la rubrique au prochain passage du générateur) ;
-- les écritures de clôture des missions sont supprimées. Les règlements par
-- tiers payeur restent des règlements hors caisse.
-- ============================================================================
BEGIN;
SET LOCAL app.finance_maintenance = 'on';
DELETE FROM fin_ecritures WHERE origine_type = 'extourne' AND extourne_de_id IN (SELECT id FROM fin_ecritures WHERE origine_type = 'fin_mission');
DELETE FROM fin_ecritures WHERE origine_type = 'fin_mission';
ALTER TABLE fin_ecritures DROP CONSTRAINT IF EXISTS fin_ecritures_origine_type_check;
ALTER TABLE fin_ecritures ADD CONSTRAINT fin_ecritures_origine_type_check
  CHECK (origine_type IN ('manuelle', 'extourne', 'journal', 'fin_facture', 'com_ff', 'fin_reglement_hc',
                          'immo_dotation', 'immo_sortie', 'stock_variation', 'an'));
SET LOCAL app.journal_maintenance = 'on';
DROP TABLE IF EXISTS fin_mission_mouvements;
DROP TABLE IF EXISTS fin_mission_depenses;
DROP TABLE IF EXISTS fin_mission_frais;
DROP TABLE IF EXISTS fin_missions;
DROP TABLE IF EXISTS fin_missions_parametres;
DROP FUNCTION IF EXISTS fin_mission_chiffres(BIGINT);
DROP FUNCTION IF EXISTS fin_mission_controle();
DROP FUNCTION IF EXISTS fin_mission_mouvement_controle();
ALTER TABLE fin_reglements_hors_caisse DROP CONSTRAINT IF EXISTS chk_fin_hc_nature;
ALTER TABLE fin_reglements_hors_caisse DROP COLUMN IF EXISTS nature;
ALTER TABLE fin_reglements_hors_caisse DROP COLUMN IF EXISTS reference;
DELETE FROM user_permissions WHERE permission_code IN ('finance.missions.voir', 'finance.missions.demander');
DELETE FROM role_permissions WHERE permission_code IN ('finance.missions.voir', 'finance.missions.demander');
DELETE FROM tenant_permissions WHERE permission_code IN ('finance.missions.voir', 'finance.missions.demander');
DELETE FROM permissions WHERE code IN ('finance.missions.voir', 'finance.missions.demander');
DELETE FROM schema_migrations WHERE version LIKE '087_%';
COMMIT;
