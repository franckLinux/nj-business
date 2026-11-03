-- Retour arrière de la migration 059 : retire les compléments d'identité saisis dans
-- le module commercial (les données de la caisse ne sont pas concernées).
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/059_retour_arriere.sql
BEGIN;
ALTER TABLE com_parametres DROP CONSTRAINT IF EXISTS com_parametres_identite_complement_check;
ALTER TABLE com_parametres DROP COLUMN IF EXISTS identite_complement;
DELETE FROM schema_migrations WHERE version LIKE '059_%';
COMMIT;
