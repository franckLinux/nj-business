-- ── 028 — Bon de caisse : suivi des impressions ───────────────────────────
-- La 1re impression d'une écriture est l'ORIGINAL ; toute impression suivante
-- est un DUPLICATA (numéroté), pour qu'un bon ne circule jamais en deux
-- originaux. Ces colonnes ne sont pas protégées par journal_proteger (027).
ALTER TABLE journal
  ADD COLUMN IF NOT EXISTS nb_impressions          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS derniere_impression_le  TIMESTAMPTZ;
