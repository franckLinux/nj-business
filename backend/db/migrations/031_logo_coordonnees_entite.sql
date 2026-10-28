-- ── 031 — Logo et coordonnées de l'entité sur les documents (octobre 2026) ──
--  Le logo est stocké dans tenants.logo_url (colonne existante) sous forme de
--  data URL d'image (PNG/JPEG/WebP, redimensionnée côté navigateur, ≤ 300 Ko) :
--  aucune dépendance au stockage de fichiers, et les fenêtres d'impression
--  l'affichent même hors ligne.
--  Nouvelles coordonnées imprimées sur les documents clés.
-- Idempotente.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS telephone TEXT DEFAULT '';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email     TEXT DEFAULT '';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS site_web  TEXT DEFAULT '';
