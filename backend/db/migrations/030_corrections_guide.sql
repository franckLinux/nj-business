-- ── 030 — Corrections relevées par le guide utilisateur (octobre 2026) ──────
--  C9  : réinitialisation du mot de passe par lien e-mail (jeton à usage unique).
--  C18 : le NUI du tiers saisi sur une écriture est désormais conservé.
-- Idempotente.

CREATE TABLE IF NOT EXISTS password_resets (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expire_le   TIMESTAMPTZ NOT NULL,
  utilise_le  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id);

ALTER TABLE journal            ADD COLUMN IF NOT EXISTS nui TEXT NOT NULL DEFAULT '';
ALTER TABLE mouvements_attente ADD COLUMN IF NOT EXISTS nui TEXT NOT NULL DEFAULT '';
