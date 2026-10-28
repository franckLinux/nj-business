-- ── 040 — Budget hebdomadaire au choix (octobre 2026) ──────────────────────
--  Réforme « Budget hebdomadaire » (fiche du 19/10/2026) : un client qui reçoit
--  ses fonds chaque semaine prévoit, fait valider et demande ses fonds SEMAINE
--  par semaine. Les autres restent au mensuel, sans aucun changement.
--
--  Semaines : lundi → dimanche, coupées aux bornes du mois, numérotées 1 à 6 ;
--  un morceau de moins de 3 jours en début ou fin de mois est rattaché à la
--  semaine voisine (calcul unique : services/budget_hebdo.service.js).
--
--  1. tenant_periodicites : historique du réglage, effet au 1er d'un mois.
--  2. Colonne `semaine` (NULL = mensuel) sur les tables du cycle budgétaire ;
--     les lignes existantes restent mensuelles, telles quelles.
--  3. Unicités refaites avec la semaine (COALESCE(semaine, 0)).
--  4. Interdiction de mélanger lignes mensuelles et hebdomadaires dans un mois.
--  5. Nouveau motif de mise en attente : semaine_non_validee.
-- Idempotente.

-- ── 1. Réglage de périodicité, avec historique ──────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_periodicites (
  id           SERIAL PRIMARY KEY,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  a_partir_de  DATE NOT NULL CHECK (EXTRACT(DAY FROM a_partir_de) = 1),
  periodicite  TEXT NOT NULL CHECK (periodicite IN ('mensuel', 'hebdomadaire')),
  defini_par   UUID REFERENCES users(id) ON DELETE SET NULL,
  defini_le    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, a_partir_de)
);

-- ── 2. Colonne semaine ──────────────────────────────────────────────────────
ALTER TABLE budget             ADD COLUMN IF NOT EXISTS semaine SMALLINT;
ALTER TABLE budget_validation  ADD COLUMN IF NOT EXISTS semaine SMALLINT;
ALTER TABLE budget_caisse      ADD COLUMN IF NOT EXISTS semaine SMALLINT;
ALTER TABLE depenses_attente   ADD COLUMN IF NOT EXISTS semaine SMALLINT;
ALTER TABLE ressources_attente ADD COLUMN IF NOT EXISTS semaine SMALLINT;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['budget','budget_validation','budget_caisse','depenses_attente','ressources_attente'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_' || t || '_semaine') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (semaine IS NULL OR semaine BETWEEN 1 AND 6)', t, 'ck_' || t || '_semaine');
    END IF;
  END LOOP;
END $$;

-- ── 3. Unicités avec la semaine ─────────────────────────────────────────────
-- Les anciennes contraintes UNIQUE (sans semaine) empêcheraient d'avoir les
-- 4 à 6 semaines d'un même mois : elles sont remplacées.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass::text AS tbl
      FROM pg_constraint c
     WHERE c.contype = 'u'
       AND c.conrelid::regclass::text IN ('budget','budget_validation','budget_caisse','depenses_attente','ressources_attente')
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;
DROP INDEX IF EXISTS uq_dep_attente;
DROP INDEX IF EXISTS uq_res_attente;

CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_periode
  ON budget (tenant_id, mois, annee, COALESCE(semaine, 0), rubrique_code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_validation_periode
  ON budget_validation (tenant_id, mois, annee, COALESCE(semaine, 0));
CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_caisse_periode
  ON budget_caisse (tenant_id, journal_id, mois, annee, COALESCE(semaine, 0));
CREATE UNIQUE INDEX IF NOT EXISTS uq_dep_attente_periode
  ON depenses_attente (tenant_id, mois, annee, COALESCE(semaine, 0), rubrique_code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_res_attente_periode
  ON ressources_attente (tenant_id, mois, annee, COALESCE(semaine, 0), rubrique_code);

-- ── 4. Pas de mélange mensuel / hebdomadaire dans un même mois ─────────────
CREATE OR REPLACE FUNCTION budget_periode_homogene() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE autre BOOLEAN;
BEGIN
  EXECUTE format(
    'SELECT EXISTS (SELECT 1 FROM %I WHERE tenant_id = $1 AND mois = $2 AND annee = $3
                     AND (semaine IS NULL) <> ($4 IS NULL) AND id <> $5)', TG_TABLE_NAME)
    INTO autre USING NEW.tenant_id, NEW.mois, NEW.annee, NEW.semaine, NEW.id;
  IF autre THEN
    RAISE EXCEPTION 'Le budget de % % mélangerait des lignes mensuelles et hebdomadaires.', NEW.mois, NEW.annee
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_budget_homogene ON budget;
CREATE TRIGGER trg_budget_homogene BEFORE INSERT OR UPDATE OF semaine, mois, annee ON budget
  FOR EACH ROW EXECUTE FUNCTION budget_periode_homogene();
DROP TRIGGER IF EXISTS trg_budget_validation_homogene ON budget_validation;
CREATE TRIGGER trg_budget_validation_homogene BEFORE INSERT OR UPDATE OF semaine, mois, annee ON budget_validation
  FOR EACH ROW EXECUTE FUNCTION budget_periode_homogene();

-- ── 5. Motif de mise en attente ─────────────────────────────────────────────
ALTER TABLE mouvements_attente DROP CONSTRAINT IF EXISTS chk_mvt_attente_motif;
ALTER TABLE mouvements_attente ADD CONSTRAINT chk_mvt_attente_motif
  CHECK (motif_attente IN ('mois_non_valide','semaine_non_validee','rubrique_non_approuvee','depassement_journal','depassement_rubrique'));
