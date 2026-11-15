-- ============================================================================
-- Retour arrière de la migration 062 (types de gestion ; taxes à la saisie).
-- À jouer À LA MAIN, après être revenu au code d'avant la 062 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/062_retour_arriere.sql
--  • les taxes archivées sont remises sur les familles et articles (seulement
--    là où aucune taxe n'a été ressaisie entre-temps) ;
--  • les types de gestion attribués sont supprimés : les personnes gardent
--    leur rôle, leur profil et leurs exceptions individuelles. Les droits
--    qu'elles tenaient d'un type de gestion sont à redonner par profil.
-- ============================================================================
BEGIN;
UPDATE com_familles f SET taxe_achat_id = a.taxe_achat_id, taxe_vente_id = a.taxe_vente_id
  FROM com_taxes_fiches_062 a
 WHERE a.objet = 'famille' AND a.objet_id = f.id AND f.taxe_achat_id IS NULL AND f.taxe_vente_id IS NULL;
UPDATE com_articles x SET taxe_id = a.taxe_achat_id, taxe_vente_id = a.taxe_vente_id
  FROM com_taxes_fiches_062 a
 WHERE a.objet = 'article' AND a.objet_id = x.id AND x.taxe_id IS NULL AND x.taxe_vente_id IS NULL;
DROP TABLE IF EXISTS com_taxes_fiches_062;

DROP TABLE IF EXISTS com_utilisateur_types_gestion, com_type_gestion_permissions_client, com_types_gestion_client,
                     com_type_gestion_permissions_defaut, com_types_gestion;
DROP FUNCTION IF EXISTS com_meme_client_g();
DELETE FROM schema_migrations WHERE version LIKE '062_%';
COMMIT;
