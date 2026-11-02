-- ============================================================================
-- Retour arrière de la migration 056 (NJ COMMERCIAL — moteur de stock).
-- À jouer À LA MAIN, après être revenu au code d'avant la 056 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/056_retour_arriere.sql
-- S'ARRÊTE sans rien toucher dès qu'un document de stock a été validé ou qu'un
-- mouvement autre que le stock d'ouverture existe (le stock réel serait perdu).
-- Aucune donnée de caisse touchée.
-- ============================================================================
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM com_stock_documents WHERE statut IN ('valide', 'annule'))
     OR EXISTS (SELECT 1 FROM com_stock_mouvements WHERE type <> 'stock_initial') THEN
    RAISE EXCEPTION 'Des mouvements de stock ont été validés : retour arrière refusé.';
  END IF;
END $$;
DROP TRIGGER IF EXISTS trg_com_stock_mouvements_proteger ON com_stock_mouvements;
DROP FUNCTION IF EXISTS com_stock_mouvements_proteger();
DROP TABLE IF EXISTS com_stock_consommations, com_stock_lots, com_stock_soldes, com_stock_doc_lignes, com_stock_documents;
DROP FUNCTION IF EXISTS com_stock_documents_proteger();
DROP FUNCTION IF EXISTS com_stock_lignes_proteger();
DROP TRIGGER IF EXISTS trg_com_documents_meme_client_f ON com_documents;
DELETE FROM com_documents WHERE objet_type = 'stock_doc';
ALTER TABLE com_documents DROP CONSTRAINT IF EXISTS com_documents_objet_type_check;
ALTER TABLE com_documents ADD CONSTRAINT com_documents_objet_type_check CHECK (objet_type IN ('demande', 'bon_commande'));
DROP FUNCTION IF EXISTS com_meme_client_f();
ALTER TABLE com_stock_mouvements DROP COLUMN IF EXISTS annule_le, DROP COLUMN IF EXISTS annule, DROP COLUMN IF EXISTS mouvement_lie_id,
  DROP COLUMN IF EXISTS ligne_id, DROP COLUMN IF EXISTS document_id, DROP COLUMN IF EXISTS document_type, DROP COLUMN IF EXISTS valeur,
  DROP COLUMN IF EXISTS cout_unitaire, DROP COLUMN IF EXISTS sens;
ALTER TABLE com_stock_mouvements DROP CONSTRAINT IF EXISTS com_stock_mouvements_type_check;
ALTER TABLE com_stock_mouvements ADD CONSTRAINT com_stock_mouvements_type_check CHECK (type IN ('stock_initial'));
DELETE FROM com_compteurs WHERE type IN ('ENT', 'SOR', 'TRF', 'INV');
ALTER TABLE com_compteurs DROP CONSTRAINT IF EXISTS com_compteurs_type_check;
ALTER TABLE com_compteurs ADD CONSTRAINT com_compteurs_type_check CHECK (type IN ('DA', 'BC'));
ALTER TABLE com_parametres DROP COLUMN IF EXISTS autovalidation_stock, DROP COLUMN IF EXISTS stock_negatif_autorise;
DELETE FROM role_permissions WHERE permission_code IN ('com.stock.voir', 'com.stock.mouvements', 'com.stock.valider');
DELETE FROM tenant_permissions WHERE permission_code IN ('com.stock.voir', 'com.stock.mouvements', 'com.stock.valider');
DELETE FROM roles r WHERE r.code IN ('stock_magasinier', 'stock_gestionnaire') AND NOT EXISTS (SELECT 1 FROM users u WHERE u.custom_role_id = r.id);
DELETE FROM permissions WHERE code IN ('com.stock.voir', 'com.stock.mouvements', 'com.stock.valider');
DELETE FROM schema_migrations WHERE version LIKE '056_%';
COMMIT;
