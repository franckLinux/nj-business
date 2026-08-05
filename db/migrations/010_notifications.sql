-- ============================================================
--  Migration 010 : notifications (cloche in-app). Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  destinataire_id UUID NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  type            TEXT NOT NULL,
  titre           TEXT NOT NULL,
  message         TEXT NOT NULL DEFAULT '',
  ref_type        TEXT DEFAULT '',
  ref_id          TEXT DEFAULT '',
  lu              BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_dest
  ON notifications(tenant_id, destinataire_id, lu, created_at DESC);
