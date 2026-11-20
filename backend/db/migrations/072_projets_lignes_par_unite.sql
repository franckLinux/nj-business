-- ============================================================================
-- 072 — Projets des ONG et associations : ligne budgétaire « par unité » (20/11/2026)
--
-- 1. Une ligne budgétaire se chiffre soit au FORFAIT (montant saisi, comme
--    avant), soit PAR UNITÉ : quantité × nombre de jours × prix unitaire
--    (ex. 25 participants × 3 jours × 2 500 = 187 500). Le montant reste
--    stocké dans « montant » (tous les contrôles existants s'y appuient) ;
--    la base vérifie qu'il est bien égal au produit.
-- 2. Le justificatif d'une ligne par unité porte la quantité et le nombre de
--    jours RÉALISÉS (ex. 22 participants × 1 jour), pour comparer prévu et
--    réalisé. Le plafond du dépôt reste le montant de la ligne.
--
-- Additive et idempotente : les lignes existantes deviennent « forfait ».
-- Retour arrière : migrations-retour-arriere/072_retour_arriere.sql
-- ============================================================================

ALTER TABLE projet_budget_postes ADD COLUMN IF NOT EXISTS mode          TEXT          NOT NULL DEFAULT 'forfait';
ALTER TABLE projet_budget_postes ADD COLUMN IF NOT EXISTS unite         TEXT          NOT NULL DEFAULT '';
ALTER TABLE projet_budget_postes ADD COLUMN IF NOT EXISTS quantite      NUMERIC(15,3);
ALTER TABLE projet_budget_postes ADD COLUMN IF NOT EXISTS jours         NUMERIC(10,2);
ALTER TABLE projet_budget_postes ADD COLUMN IF NOT EXISTS prix_unitaire NUMERIC(15,2);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projet_budget_postes_mode_chk') THEN
    ALTER TABLE projet_budget_postes ADD CONSTRAINT projet_budget_postes_mode_chk CHECK (
      length(unite) <= 40 AND (
        (mode = 'forfait' AND quantite IS NULL AND jours IS NULL AND prix_unitaire IS NULL)
        OR (mode = 'unite' AND quantite > 0 AND jours > 0 AND prix_unitaire >= 0
            AND montant = round(quantite * jours * prix_unitaire, 2))
      ));
  END IF;
END $$;

ALTER TABLE projet_justificatifs ADD COLUMN IF NOT EXISTS quantite_realisee NUMERIC(15,3);
ALTER TABLE projet_justificatifs ADD COLUMN IF NOT EXISTS jours_realises    NUMERIC(10,2);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projet_justificatifs_realise_chk') THEN
    ALTER TABLE projet_justificatifs ADD CONSTRAINT projet_justificatifs_realise_chk CHECK (
      (quantite_realisee IS NULL AND jours_realises IS NULL)
      OR (quantite_realisee >= 0 AND jours_realises > 0));
  END IF;
END $$;

-- La ligne ET la quantité réalisée d'un justificatif contrôlé ne changent plus.
CREATE OR REPLACE FUNCTION projet_justificatif_poste_fige() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.journal_maintenance', true) = 'on' THEN RETURN NEW; END IF;
  IF OLD.statut <> 'depose' AND (NEW.poste_cle IS DISTINCT FROM OLD.poste_cle OR NEW.poste_libelle <> OLD.poste_libelle
      OR NEW.quantite_realisee IS DISTINCT FROM OLD.quantite_realisee OR NEW.jours_realises IS DISTINCT FROM OLD.jours_realises) THEN
    RAISE EXCEPTION 'JUSTIFICATIF_INTANGIBLE: un justificatif contrôlé ne se modifie pas.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
