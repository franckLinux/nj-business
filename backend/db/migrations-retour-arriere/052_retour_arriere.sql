-- ============================================================================
-- Retour arrière de la migration 052 (NJ COMMERCIAL — bons de commande).
-- À jouer À LA MAIN, après être revenu au code d'avant la 052 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/052_retour_arriere.sql
-- S'ARRÊTE sans rien toucher si un bon de commande a été émis (document officiel
-- à conserver). Aucune donnée de caisse touchée.
-- ============================================================================
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM com_bons_commande WHERE statut <> 'brouillon') THEN
    RAISE EXCEPTION 'Des bons de commande ont été émis : retour arrière refusé (documents officiels à conserver).';
  END IF;
  IF EXISTS (SELECT 1 FROM com_decisions WHERE etape = 'gestionnaire') THEN
    RAISE EXCEPTION 'Des revalidations figurent dans l''historique des autorisations : retour arrière refusé.';
  END IF;
END $$;
DELETE FROM com_documents WHERE objet_type = 'bon_commande';
DROP TRIGGER IF EXISTS trg_com_documents_meme_client_c ON com_documents;
DROP TABLE IF EXISTS com_bc_lignes, com_bons_commande;
DROP FUNCTION IF EXISTS com_bc_proteger();
DROP FUNCTION IF EXISTS com_bc_lignes_proteger();
DROP FUNCTION IF EXISTS com_meme_client_c();
ALTER TABLE com_decisions DROP CONSTRAINT IF EXISTS com_decisions_etape_check;
ALTER TABLE com_decisions ADD CONSTRAINT com_decisions_etape_check
  CHECK (etape IN ('demandeur', 'achats', 'direction', 'achats_direction', 'valideur'));
DELETE FROM schema_migrations WHERE version LIKE '052_%';
COMMIT;
