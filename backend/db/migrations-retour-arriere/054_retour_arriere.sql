-- ============================================================================
-- Retour arrière de la migration 054 (NJ COMMERCIAL — agences, familles).
-- À jouer À LA MAIN, après être revenu au code d'avant la 054 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/054_retour_arriere.sql
-- S'ARRÊTE sans rien toucher si un client a créé une deuxième agence ou choisi
-- une taxe de vente (ces choix seraient perdus). Aucune donnée de caisse touchée.
-- ============================================================================
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT tenant_id FROM com_agences GROUP BY tenant_id HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Un client a plusieurs agences : retour arrière refusé (organisation saisie à conserver).';
  END IF;
  IF EXISTS (SELECT 1 FROM com_articles WHERE taxe_vente_id IS NOT NULL) OR EXISTS (SELECT 1 FROM com_familles WHERE taxe_vente_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Des taxes de vente ont été choisies : retour arrière refusé.';
  END IF;
END $$;
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['com_agences', 'com_magasins', 'com_familles', 'com_articles', 'com_utilisateur_agences'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_meme_client_d ON %I', t, t);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS com_meme_client_d();
DROP TABLE IF EXISTS com_utilisateur_agences;
ALTER TABLE com_articles DROP CONSTRAINT IF EXISTS com_articles_methode_check;
ALTER TABLE com_articles DROP COLUMN IF EXISTS methode_valorisation, DROP COLUMN IF EXISTS suivi_stock, DROP COLUMN IF EXISTS taxe_vente_id;
ALTER TABLE com_familles DROP CONSTRAINT IF EXISTS com_familles_methode_check;
ALTER TABLE com_familles DROP COLUMN IF EXISTS methode_valorisation, DROP COLUMN IF EXISTS suivi_stock,
  DROP COLUMN IF EXISTS taxe_vente_id, DROP COLUMN IF EXISTS taxe_achat_id;
ALTER TABLE com_taxes DROP CONSTRAINT IF EXISTS com_taxes_usage_check;
ALTER TABLE com_taxes DROP COLUMN IF EXISTS usage;
ALTER TABLE com_magasins DROP COLUMN IF EXISTS agence_id;
DROP TABLE IF EXISTS com_agences;
DELETE FROM schema_migrations WHERE version LIKE '054_%';
COMMIT;
