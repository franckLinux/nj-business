-- ============================================================================
-- Retour arrière de la migration 058 (lot 5 : documents d'achat).
-- À jouer À LA MAIN, après être revenu au code d'avant la 058 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/058_retour_arriere.sql
-- S'ARRÊTE sans rien toucher dès qu'une réception, un retour ou une facture a été
-- validé ou annulé (pièces et mouvements de stock réels seraient perdus).
-- ============================================================================
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM com_receptions WHERE statut IN ('valide', 'annule'))
     OR EXISTS (SELECT 1 FROM com_retours_fournisseurs WHERE statut IN ('valide', 'annule'))
     OR EXISTS (SELECT 1 FROM com_factures_fournisseurs WHERE statut IN ('valide', 'annule'))
     OR EXISTS (SELECT 1 FROM com_stock_mouvements WHERE type IN ('reception', 'retour_fournisseur')) THEN
    RAISE EXCEPTION 'Des documents d''achat ont été validés : retour arrière refusé.';
  END IF;
END $$;
DELETE FROM com_documents WHERE objet_type IN ('reception', 'retour_fourn', 'facture_fourn');
DROP TABLE IF EXISTS com_facture_fourn_lignes, com_factures_fournisseurs, com_retour_fourn_lignes, com_retours_fournisseurs,
  com_reception_lignes, com_receptions;
DROP FUNCTION IF EXISTS com_doc_achat_proteger();
DROP FUNCTION IF EXISTS com_lignes_achat_proteger();
ALTER TABLE com_documents DROP CONSTRAINT IF EXISTS com_documents_objet_type_check;
ALTER TABLE com_documents ADD CONSTRAINT com_documents_objet_type_check CHECK (objet_type IN ('demande', 'bon_commande', 'stock_doc'));
DELETE FROM com_compteurs WHERE type IN ('REC', 'RFO', 'FFO', 'AVF');
ALTER TABLE com_compteurs DROP CONSTRAINT IF EXISTS com_compteurs_type_check;
ALTER TABLE com_compteurs ADD CONSTRAINT com_compteurs_type_check CHECK (type IN ('DA', 'BC', 'ENT', 'SOR', 'TRF', 'INV'));
DELETE FROM role_permissions   WHERE permission_code LIKE 'com.receptions.%' OR permission_code LIKE 'com.retours_fourn.%' OR permission_code LIKE 'com.factures_fourn.%';
DELETE FROM user_permissions   WHERE permission_code LIKE 'com.receptions.%' OR permission_code LIKE 'com.retours_fourn.%' OR permission_code LIKE 'com.factures_fourn.%';
DELETE FROM tenant_permissions WHERE permission_code LIKE 'com.receptions.%' OR permission_code LIKE 'com.retours_fourn.%' OR permission_code LIKE 'com.factures_fourn.%';
DELETE FROM permissions        WHERE code LIKE 'com.receptions.%' OR code LIKE 'com.retours_fourn.%' OR code LIKE 'com.factures_fourn.%';
DELETE FROM schema_migrations WHERE version LIKE '058_%';
COMMIT;
-- La fonction com_meme_client_f garde ses branches 058 : sans les tables, elles ne servent plus (sans effet).
