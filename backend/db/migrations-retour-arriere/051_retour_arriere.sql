-- ============================================================================
-- Retour arrière de la migration 051 (NJ COMMERCIAL — demandes d'achat).
-- À jouer À LA MAIN, après être revenu au code d'avant la 051 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/051_retour_arriere.sql
-- S'ARRÊTE sans rien toucher si une demande a déjà été soumise : l'historique
-- des autorisations ne doit pas disparaître. Aucune donnée de caisse touchée.
-- ============================================================================
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM com_demandes WHERE nb_soumissions > 0) THEN
    RAISE EXCEPTION 'Des demandes d''achat ont été soumises : retour arrière refusé (historique des autorisations à conserver).';
  END IF;
END $$;
DROP TABLE IF EXISTS com_documents, com_decisions, com_demande_lignes, com_demandes, com_compteurs;
DROP FUNCTION IF EXISTS com_decisions_intangibles();
DROP FUNCTION IF EXISTS com_demandes_proteger();
DROP FUNCTION IF EXISTS com_meme_client_b();
ALTER TABLE com_parametres DROP COLUMN IF EXISTS services;
DELETE FROM schema_migrations WHERE version LIKE '051_%';
COMMIT;
