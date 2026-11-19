-- ============================================================================
-- Retour arrière de la migration 068 (une session par type d'appareil).
-- À jouer À LA MAIN, après être revenu au code d'avant la 068 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/068_retour_arriere.sql
-- Les sessions mobiles actives sont fermées (une seule session par compte à nouveau).
-- ============================================================================
BEGIN;
UPDATE sessions SET statut = 'fermee', terminee_le = NOW(), motif_fin = 'Retour à une session par compte'
 WHERE statut = 'active' AND type_appareil = 'mobile'
   AND user_id IN (SELECT user_id FROM sessions WHERE statut = 'active' GROUP BY user_id HAVING COUNT(*) > 1);
DROP INDEX IF EXISTS uq_sessions_active_par_type;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sessions_une_active ON sessions (user_id) WHERE statut = 'active';
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS ck_sessions_type_appareil;
ALTER TABLE sessions DROP COLUMN IF EXISTS type_appareil;
UPDATE plateforme_reglages SET valeur = valeur - 'par_type_appareil' WHERE cle = 'sessions';
DELETE FROM schema_migrations WHERE version LIKE '068_%';
COMMIT;
