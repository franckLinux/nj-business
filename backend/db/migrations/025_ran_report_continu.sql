-- ── 025 — Continuité comptable des soldes (RAN) ──────────────────────────
-- Règle (décision du 05/10/2026) :
--   * le RAN d'un journal se SAISIT uniquement à l'ouverture de la caisse
--     (premier mois) : c'est le solde d'ouverture ;
--   * pour tous les mois suivants, RAN(M) = solde final(M-1), CALCULÉ à chaque
--     lecture (plus jamais figé en base) : une correction tardive d'un mois
--     passé se répercute sur tous les mois suivants.
-- Les lignes ran enregistrées automatiquement par l'ancien « report » sont
-- conservées (rien n'est supprimé) mais marquées 'report' et ne sont plus lues.
ALTER TABLE ran ADD COLUMN IF NOT EXISTS origine TEXT NOT NULL DEFAULT 'ouverture';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_ran_origine') THEN
    ALTER TABLE ran ADD CONSTRAINT ck_ran_origine CHECK (origine IN ('ouverture','report'));
  END IF;
END $$;

-- Pour chaque journal : la ligne la plus ancienne reste le solde d'ouverture,
-- les suivantes deviennent des reports historiques (ignorés par le calcul).
WITH cle AS (
  SELECT id, journal_id,
         annee * 12 + array_position(ARRAY['Janvier','Fevrier','Mars','Avril','Mai','Juin','Juillet',
                      'Aout','Septembre','Octobre','Novembre','Decembre']::text[], mois) AS k
    FROM ran WHERE journal_id IS NOT NULL
), premier AS (
  SELECT DISTINCT ON (journal_id) journal_id, id FROM cle ORDER BY journal_id, k, id
)
UPDATE ran r SET origine = 'report'
  FROM cle
 WHERE r.id = cle.id
   AND r.origine = 'ouverture'
   AND NOT EXISTS (SELECT 1 FROM premier p WHERE p.id = r.id);
