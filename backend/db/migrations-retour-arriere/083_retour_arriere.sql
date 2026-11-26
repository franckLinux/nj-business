-- ============================================================================
-- Retour arrière de la migration 083 (gestion des activités simplifiée :
-- demandes de fonds, décaissements et reversements reliés, dépenses déclarées).
-- À jouer À LA MAIN, après être revenu au code d'avant la 083 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/083_retour_arriere.sql
-- Les mouvements de caisse et de banque restent au journal (seul leur lien à la
-- demande disparaît). Les pièces des dépenses restent dans le stockage privé,
-- sous <client>/depenses-projets/ : à supprimer à la main si voulu.
-- ============================================================================
BEGIN;
DROP TABLE IF EXISTS projet_depenses;
DROP TABLE IF EXISTS projet_demande_mouvements;
DROP TABLE IF EXISTS projet_demande_lignes;
DROP TABLE IF EXISTS projet_demandes_fonds;
DROP FUNCTION IF EXISTS projet_demande_chiffres(BIGINT);
DROP FUNCTION IF EXISTS projet_demande_controle();
DROP FUNCTION IF EXISTS projet_demande_lignes_controle();
DROP FUNCTION IF EXISTS projet_demande_mouvement_controle();
DROP FUNCTION IF EXISTS projet_depense_controle();
DELETE FROM schema_migrations WHERE version LIKE '083_%';
COMMIT;
