-- ── 022 — Administration plateforme & accès support (réforme, étape 8) ─────
-- AJOUTS UNIQUEMENT.
--  1. tenants : coordonnées administratives du client (responsable, e-mail,
--     téléphone, pays, ville) et motif de suspension.
--  2. support_acces : accès TEMPORAIRE du super_admin aux données métier d'un
--     client (caisse, journaux, budget, rapports…). Déclenché explicitement,
--     limité dans le temps, motivé, tracé. Sans accès support actif, le
--     super_admin n'administre plus que la plateforme (voir middleware/tenant.js,
--     variable SUPER_ADMIN_ACCES_METIER).
CREATE TABLE IF NOT EXISTS support_acces (
    id          BIGSERIAL PRIMARY KEY,
    tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    motif       TEXT        NOT NULL CHECK (length(btrim(motif)) >= 10),
    debut       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expire_le   TIMESTAMPTZ NOT NULL,
    revoque_le  TIMESTAMPTZ,
    CHECK (expire_le > debut AND expire_le <= debut + INTERVAL '8 hours')
);
CREATE INDEX IF NOT EXISTS idx_support_actif ON support_acces (user_id, tenant_id, expire_le) WHERE revoque_le IS NULL;

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS contact_nom       TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS contact_email     TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS contact_telephone TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS pays              TEXT DEFAULT 'Cameroun',
    ADD COLUMN IF NOT EXISTS ville             TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS suspension_motif  TEXT DEFAULT '';
