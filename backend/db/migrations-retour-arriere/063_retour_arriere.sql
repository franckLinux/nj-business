-- ============================================================================
-- Retour arrière de la migration 063 (lot 8 : approvisionnement).
-- À jouer À LA MAIN, après être revenu au code d'avant la 063 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/063_retour_arriere.sql
-- S'ARRÊTE sans rien toucher dès qu'une offre a été reçue ou qu'un frais validé existe.
-- Les quantités approuvées à 0 sont remises à la quantité soumise (contrainte d'avant).
-- ============================================================================
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM com_offres) OR EXISTS (SELECT 1 FROM com_frais_achat WHERE statut = 'valide') THEN
    RAISE EXCEPTION 'Des offres fournisseurs ou des frais validés existent : retour arrière refusé.';
  END IF;
END $$;
UPDATE com_stock_mouvements SET cout_frais = 0 WHERE cout_frais <> 0;
ALTER TABLE com_stock_mouvements DROP CONSTRAINT IF EXISTS com_stock_mouvements_cout_frais_check;
ALTER TABLE com_stock_mouvements DROP COLUMN IF EXISTS cout_frais, DROP COLUMN IF EXISTS cout_achat;
DROP TABLE IF EXISTS com_frais_repartition, com_frais_achat;
ALTER TABLE com_bons_commande DROP CONSTRAINT IF EXISTS com_bons_commande_envoi_check;
CREATE OR REPLACE FUNCTION com_bc_proteger() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN RETURN OLD; END IF;
    IF OLD.statut <> 'brouillon' THEN
      RAISE EXCEPTION 'BC_INTANGIBLE: un bon de commande émis ne se supprime pas, il s''annule.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.statut = 'brouillon' THEN RETURN NEW; END IF;
  IF OLD.statut = 'emis' AND NEW.statut IN ('annule', 'remplace')
     AND NEW.numero_complet = OLD.numero_complet AND NEW.jeton_verification = OLD.jeton_verification
     AND NEW.pdf_sha256 = OLD.pdf_sha256 AND NEW.pdf_chemin = OLD.pdf_chemin
     AND NEW.total_ttc = OLD.total_ttc AND NEW.total_ht = OLD.total_ht AND NEW.fournisseur_id = OLD.fournisseur_id
     AND NEW.emis_le = OLD.emis_le THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'BC_INTANGIBLE: un bon de commande émis ne se modifie pas ; annulez-le ou faites une révision.' USING ERRCODE = 'check_violation';
END $f$;
ALTER TABLE com_bons_commande DROP COLUMN IF EXISTS consultation_id, DROP COLUMN IF EXISTS envoye_le, DROP COLUMN IF EXISTS envoye_par,
  DROP COLUMN IF EXISTS envoi_mode, DROP COLUMN IF EXISTS envoi_destinataire;
DROP TABLE IF EXISTS com_offre_lignes, com_offres CASCADE;
DROP TABLE IF EXISTS com_consultation_fournisseurs, com_consultation_lignes, com_consultations CASCADE;
DROP FUNCTION IF EXISTS com_offres_proteger();
DELETE FROM com_documents WHERE objet_type IN ('offre', 'frais_achat');
ALTER TABLE com_documents DROP CONSTRAINT IF EXISTS com_documents_objet_type_check;
ALTER TABLE com_documents ADD CONSTRAINT com_documents_objet_type_check
  CHECK (objet_type IN ('demande', 'bon_commande', 'stock_doc', 'reception', 'retour_fourn', 'facture_fourn', 'devis', 'commande_client', 'livraison'));
DELETE FROM com_compteurs WHERE type IN ('CON', 'FRA');
ALTER TABLE com_compteurs DROP CONSTRAINT IF EXISTS com_compteurs_type_check;
ALTER TABLE com_compteurs ADD CONSTRAINT com_compteurs_type_check CHECK (type IN ('DA', 'BC', 'ENT', 'SOR', 'TRF', 'INV', 'REC', 'RFO', 'FFO', 'AVF', 'DEV', 'CDC', 'BLC'));
ALTER TABLE com_articles DROP CONSTRAINT IF EXISTS com_articles_poids_check;
ALTER TABLE com_articles DROP COLUMN IF EXISTS poids_kg;
ALTER TABLE com_tiers DROP CONSTRAINT IF EXISTS com_tiers_delai_check, DROP CONSTRAINT IF EXISTS com_tiers_delai_type_check;
ALTER TABLE com_tiers DROP COLUMN IF EXISTS delai_livraison_jours, DROP COLUMN IF EXISTS delai_type;
UPDATE com_demande_lignes SET quantite = quantite_demandee WHERE quantite = 0;
ALTER TABLE com_demande_lignes DROP CONSTRAINT IF EXISTS com_demande_lignes_quantites_check;
ALTER TABLE com_demande_lignes ADD CONSTRAINT com_demande_lignes_quantite_check CHECK (quantite > 0);
ALTER TABLE com_demande_lignes DROP COLUMN IF EXISTS quantite_besoin, DROP COLUMN IF EXISTS quantite_demandee;
ALTER TABLE com_decisions DROP COLUMN IF EXISTS details;
-- Droits : retraits rétablis, ajouts retirés, profil comptable supprimé s'il n'est attribué à personne.
INSERT INTO role_permissions (role_id, permission_code) SELECT role_id, permission_code FROM com_droits_063 WHERE operation = 'retrait' ON CONFLICT DO NOTHING;
DELETE FROM role_permissions rp USING com_droits_063 d WHERE d.operation = 'ajout' AND rp.role_id = d.role_id AND rp.permission_code = d.permission_code;
DELETE FROM roles r WHERE r.code = 'achats_comptable' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.custom_role_id = r.id);
DROP TABLE IF EXISTS com_droits_063;
DO $$
BEGIN
  IF to_regclass('public.com_type_gestion_permissions_defaut') IS NOT NULL THEN
    DELETE FROM com_type_gestion_permissions_defaut WHERE permission_code = 'com.frais.saisir';
    INSERT INTO com_type_gestion_permissions_defaut (type_code, permission_code) VALUES ('achats', 'com.factures_fourn.saisir') ON CONFLICT DO NOTHING;
  END IF;
END $$;
DELETE FROM role_permissions   WHERE permission_code IN ('com.consultations.gerer', 'com.consultations.derogation', 'com.frais.saisir', 'com.frais.valider');
DELETE FROM user_permissions   WHERE permission_code IN ('com.consultations.gerer', 'com.consultations.derogation', 'com.frais.saisir', 'com.frais.valider');
DELETE FROM tenant_permissions WHERE permission_code IN ('com.consultations.gerer', 'com.consultations.derogation', 'com.frais.saisir', 'com.frais.valider');
DELETE FROM permissions WHERE code IN ('com.consultations.gerer', 'com.consultations.derogation', 'com.frais.saisir', 'com.frais.valider');
DELETE FROM schema_migrations WHERE version LIKE '063_%';
COMMIT;
