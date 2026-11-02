-- ============================================================================
-- Retour arrière de la migration 055 (NJ COMMERCIAL — unités et conversions).
-- À jouer À LA MAIN, après être revenu au code d'avant la 055 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/055_retour_arriere.sql
-- S'ARRÊTE sans rien toucher dès qu'une conversion réelle existe (coefficient
-- différent de 1 sur un article ou une ligne de document) : ces quantités
-- deviendraient fausses sans leur coefficient. Aucune donnée de caisse touchée.
-- ============================================================================
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM com_article_unites WHERE coefficient <> 1)
     OR EXISTS (SELECT 1 FROM com_demande_lignes WHERE coefficient <> 1)
     OR EXISTS (SELECT 1 FROM com_bc_lignes WHERE coefficient <> 1) THEN
    RAISE EXCEPTION 'Des conversions d''unités sont utilisées : retour arrière refusé.';
  END IF;
END $$;
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['com_article_unites', 'com_articles', 'com_familles', 'com_demande_lignes', 'com_bc_lignes'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_meme_client_e ON %I', t, t);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS com_meme_client_e();
ALTER TABLE com_bc_lignes DISABLE TRIGGER USER;
ALTER TABLE com_bc_lignes DROP COLUMN IF EXISTS coefficient, DROP COLUMN IF EXISTS unite_id;
ALTER TABLE com_bc_lignes ENABLE TRIGGER USER;
ALTER TABLE com_demande_lignes DROP COLUMN IF EXISTS coefficient, DROP COLUMN IF EXISTS unite_id;
ALTER TABLE com_familles DROP COLUMN IF EXISTS coef_vente, DROP COLUMN IF EXISTS unite_vente_id, DROP COLUMN IF EXISTS coef_achat,
  DROP COLUMN IF EXISTS unite_achat_id, DROP COLUMN IF EXISTS unite_stock_id;
DROP TABLE IF EXISTS com_article_unites;
ALTER TABLE com_articles DROP COLUMN IF EXISTS prix_vente_indicatif, DROP COLUMN IF EXISTS unite_vente_id,
  DROP COLUMN IF EXISTS unite_achat_id, DROP COLUMN IF EXISTS unite_stock_id;
DROP TABLE IF EXISTS com_unites;
DELETE FROM schema_migrations WHERE version LIKE '055_%';
COMMIT;
