-- ============================================================================
-- 059 — NJ COMMERCIAL : compléments d'identité de la société.
--
--  L'identité de l'entreprise vient de l'Entité (NJ CAISSE PRO, table tenants).
--  Quand un champ n'y est pas renseigné, l'écran Société du module commercial
--  permet de le saisir ici, SANS écrire dans les données de la caisse. La valeur
--  de la caisse l'emporte toujours dès qu'elle existe.
--
--  PUREMENT ADDITIVE : une colonne ajoutée, aucune donnée existante modifiée.
--  Idempotente. Retour arrière : migrations-retour-arriere/059_retour_arriere.sql
-- ============================================================================
ALTER TABLE com_parametres ADD COLUMN IF NOT EXISTS identite_complement JSONB NOT NULL DEFAULT '{}'::jsonb;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'com_parametres_identite_complement_check') THEN
    ALTER TABLE com_parametres ADD CONSTRAINT com_parametres_identite_complement_check
      CHECK (jsonb_typeof(identite_complement) = 'object' AND length(identite_complement::text) <= 4000);
  END IF;
END $$;
