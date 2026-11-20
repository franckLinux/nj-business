-- ============================================================================
-- Retour arrière de la migration 072 (ligne budgétaire par unité).
-- À jouer À LA MAIN, après être revenu au code d'avant la 072 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/072_retour_arriere.sql
-- Les lignes gardent leur montant (elles redeviennent des forfaits) ; seuls le
-- détail quantité × jours × prix et les quantités réalisées disparaissent.
-- ============================================================================
BEGIN;
SET LOCAL app.journal_maintenance = 'on';
CREATE OR REPLACE FUNCTION projet_justificatif_poste_fige() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.journal_maintenance', true) = 'on' THEN RETURN NEW; END IF;
  IF OLD.statut <> 'depose' AND (NEW.poste_cle IS DISTINCT FROM OLD.poste_cle OR NEW.poste_libelle <> OLD.poste_libelle) THEN
    RAISE EXCEPTION 'JUSTIFICATIF_INTANGIBLE: un justificatif contrôlé ne se modifie pas.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
ALTER TABLE projet_justificatifs DROP CONSTRAINT IF EXISTS projet_justificatifs_realise_chk;
ALTER TABLE projet_justificatifs DROP COLUMN IF EXISTS jours_realises;
ALTER TABLE projet_justificatifs DROP COLUMN IF EXISTS quantite_realisee;
ALTER TABLE projet_budget_postes DROP CONSTRAINT IF EXISTS projet_budget_postes_mode_chk;
ALTER TABLE projet_budget_postes DROP COLUMN IF EXISTS prix_unitaire;
ALTER TABLE projet_budget_postes DROP COLUMN IF EXISTS jours;
ALTER TABLE projet_budget_postes DROP COLUMN IF EXISTS quantite;
ALTER TABLE projet_budget_postes DROP COLUMN IF EXISTS unite;
ALTER TABLE projet_budget_postes DROP COLUMN IF EXISTS mode;
DELETE FROM schema_migrations WHERE version LIKE '072_%';
COMMIT;
