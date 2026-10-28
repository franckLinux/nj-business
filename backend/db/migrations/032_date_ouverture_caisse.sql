-- ── 032 — Jour d'ouverture des caisses (octobre 2026) ─────────────────────
--  À l'initialisation, le directeur choisit le JOUR d'ouverture (et non plus
--  seulement le mois) : le solde d'ouverture (RAN) est celui de ce jour, et
--  aucune opération de la caisse ne peut être datée avant.
--  NULL = caisse ouverte avant cette évolution : aucune contrainte de date.
-- Idempotente.

ALTER TABLE journaux ADD COLUMN IF NOT EXISTS date_ouverture DATE;
