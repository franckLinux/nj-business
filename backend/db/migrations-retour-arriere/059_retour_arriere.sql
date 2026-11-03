-- ============================================================================
-- Retour arrière de la migration 059 (lot 6 : ventes).
-- À jouer À LA MAIN, après être revenu au code d'avant la 059 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/059_retour_arriere.sql
-- S'ARRÊTE sans rien toucher dès qu'un devis a été soumis, qu'une commande client
-- existe ou qu'une livraison a été validée (pièces et stock réels seraient perdus).
-- ============================================================================
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM com_devis WHERE statut <> 'brouillon') OR EXISTS (SELECT 1 FROM com_commandes_clients)
     OR EXISTS (SELECT 1 FROM com_stock_mouvements WHERE type = 'livraison') THEN
    RAISE EXCEPTION 'Des documents de vente existent : retour arrière refusé.';
  END IF;
END $$;
DELETE FROM com_documents WHERE objet_type IN ('devis', 'commande_client', 'livraison');
DROP TABLE IF EXISTS com_livraison_lignes, com_livraisons, com_commande_client_lignes, com_commandes_clients, com_devis_lignes, com_devis;
DROP FUNCTION IF EXISTS com_devis_proteger(), com_cdc_proteger(), com_livraison_proteger(), com_lignes_vente_proteger();
DROP TRIGGER IF EXISTS trg_com_documents_meme_client_v ON com_documents;
DROP FUNCTION IF EXISTS com_meme_client_ventes();
ALTER TABLE com_documents DROP CONSTRAINT IF EXISTS com_documents_objet_type_check;
ALTER TABLE com_documents ADD CONSTRAINT com_documents_objet_type_check
  CHECK (objet_type IN ('demande', 'bon_commande', 'stock_doc', 'reception', 'retour_fourn', 'facture_fourn'));
DELETE FROM com_compteurs WHERE type IN ('DEV', 'CDC', 'BLC');
ALTER TABLE com_compteurs DROP CONSTRAINT IF EXISTS com_compteurs_type_check;
ALTER TABLE com_compteurs ADD CONSTRAINT com_compteurs_type_check CHECK (type IN ('DA', 'BC', 'ENT', 'SOR', 'TRF', 'INV', 'REC', 'RFO', 'FFO', 'AVF'));
ALTER TABLE com_parametres DROP COLUMN IF EXISTS ventes_seuil_direction, DROP COLUMN IF EXISTS ventes_remise_max_pct, DROP COLUMN IF EXISTS devis_validite_jours;
DELETE FROM role_permissions   WHERE permission_code LIKE 'com.ventes.%';
DELETE FROM user_permissions   WHERE permission_code LIKE 'com.ventes.%';
DELETE FROM tenant_permissions WHERE permission_code LIKE 'com.ventes.%';
DELETE FROM roles r WHERE r.code IN ('ventes_commercial', 'ventes_responsable') AND NOT EXISTS (SELECT 1 FROM users u WHERE u.custom_role_id = r.id);
DELETE FROM permissions WHERE code LIKE 'com.ventes.%';
DELETE FROM schema_migrations WHERE version LIKE '059_%';
COMMIT;
