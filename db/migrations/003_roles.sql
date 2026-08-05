-- ── Rôles personnalisés ───────────────────────────────────────────────────
-- Permet de créer des profils de rôle (ex: Caissière, Auditeur interne…)
-- avec un ensemble de permissions associées, par tenant ou globalement.

CREATE TABLE IF NOT EXISTS roles (
  id          SERIAL PRIMARY KEY,
  nom         TEXT NOT NULL,
  code        TEXT NOT NULL,
  description TEXT DEFAULT '',
  couleur     TEXT DEFAULT '#6366f1',
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(code, tenant_id)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id         INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code TEXT    NOT NULL,
  PRIMARY KEY(role_id, permission_code)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);
