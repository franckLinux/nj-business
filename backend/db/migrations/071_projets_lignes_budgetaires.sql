-- ============================================================================
-- 071 — Projets des ONG et associations, lot P4 (20/11/2026)
--
-- 1. Lignes budgétaires d'une activité (facultatives) : dans le budget, une
--    activité peut se détailler en lignes (ex. « Atelier » → pause café,
--    déjeuner, transport). Le montant de l'activité est alors la somme de ses
--    lignes. Chaque ligne porte une CLÉ stable, recopiée d'une version du
--    budget à la suivante : les justificatifs s'y rattachent.
-- 2. Justificatif rattaché à une ligne (poste_cle) quand l'activité en a ;
--    le dépôt est BLOQUÉ s'il dépasse le budget de la ligne (ou de l'activité).
-- 3. Remise de fonds au PROJET (montant global) : aucune colonne nouvelle —
--    la sortie de journal porte l'identifiant du projet (journal.activite_id).
--    Elle est exclue du budget de fonctionnement comme les remises aux activités.
--
-- Additive et idempotente. Retour arrière : migrations-retour-arriere/071_retour_arriere.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS projet_budget_postes (
  id           BIGSERIAL     PRIMARY KEY,
  tenant_id    UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  budget_id    BIGINT        NOT NULL REFERENCES projet_budgets(id) ON DELETE CASCADE,
  activite_id  INTEGER       NOT NULL REFERENCES activites(id),
  cle          UUID          NOT NULL DEFAULT gen_random_uuid(),
  libelle      TEXT          NOT NULL CHECK (btrim(libelle) <> '' AND length(libelle) <= 150),
  montant      NUMERIC(15,2) NOT NULL CHECK (montant >= 0),
  ordre        INTEGER       NOT NULL DEFAULT 0,
  UNIQUE (budget_id, cle)
);
CREATE INDEX IF NOT EXISTS idx_projet_postes_activite ON projet_budget_postes (budget_id, activite_id);
CREATE INDEX IF NOT EXISTS idx_projet_postes_cle ON projet_budget_postes (cle);

-- Mêmes règles que les lignes d'activité (069) : modifiables seulement dans un
-- budget en préparation, et toujours pour une activité du projet du budget.
CREATE OR REPLACE FUNCTION projet_budget_poste_proteger() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE b RECORD; a RECORD;
BEGIN
  IF current_setting('app.journal_maintenance', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT id, tenant_id, projet_id, statut INTO b FROM projet_budgets WHERE id = COALESCE(NEW.budget_id, OLD.budget_id);
  IF b.id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;   -- suppression en cascade d'un brouillon
  IF b.statut <> 'brouillon' THEN
    RAISE EXCEPTION 'BUDGET_FIGE: les lignes d''un budget soumis ou validé ne se modifient pas.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  SELECT id, tenant_id, projet_id INTO a FROM activites WHERE id = NEW.activite_id;
  IF a.id IS NULL OR a.tenant_id <> b.tenant_id OR a.projet_id IS DISTINCT FROM b.projet_id OR NEW.tenant_id <> b.tenant_id THEN
    RAISE EXCEPTION 'BUDGET_INVALIDE: cette ligne n''appartient pas à une activité du projet.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_projet_budget_poste_proteger ON projet_budget_postes;
CREATE TRIGGER trg_projet_budget_poste_proteger BEFORE INSERT OR UPDATE OR DELETE ON projet_budget_postes
  FOR EACH ROW EXECUTE FUNCTION projet_budget_poste_proteger();

-- Justificatif ↔ ligne budgétaire (clé stable + libellé figé au dépôt).
ALTER TABLE projet_justificatifs ADD COLUMN IF NOT EXISTS poste_cle     UUID;
ALTER TABLE projet_justificatifs ADD COLUMN IF NOT EXISTS poste_libelle TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_justif_poste ON projet_justificatifs (poste_cle) WHERE poste_cle IS NOT NULL;

-- La ligne d'un justificatif contrôlé ne change plus (complète la 070).
CREATE OR REPLACE FUNCTION projet_justificatif_poste_fige() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.journal_maintenance', true) = 'on' THEN RETURN NEW; END IF;
  IF OLD.statut <> 'depose' AND (NEW.poste_cle IS DISTINCT FROM OLD.poste_cle OR NEW.poste_libelle <> OLD.poste_libelle) THEN
    RAISE EXCEPTION 'JUSTIFICATIF_INTANGIBLE: un justificatif contrôlé ne se modifie pas.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_projet_justificatif_poste_fige ON projet_justificatifs;
CREATE TRIGGER trg_projet_justificatif_poste_fige BEFORE UPDATE ON projet_justificatifs
  FOR EACH ROW EXECUTE FUNCTION projet_justificatif_poste_fige();
