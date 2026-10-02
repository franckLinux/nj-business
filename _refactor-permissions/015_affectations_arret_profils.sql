-- ── 015 — Décisions du 02/10/2026 ──────────────────────────────────────────
--  1. Le comptable cabinet n'accède qu'aux clients qui lui sont AFFECTÉS
--     (table cabinet_affectations, gérée par le super_admin).
--  2. L'arrêt de caisse par l'encadrement est réservé au DIRECTEUR
--     (permission journaux.arreter). Le responsable d'arrêt désigné sur le
--     journal garde la possibilité d'arrêter SON journal.
--  3. Le directeur gère lui-même les profils métier de son client
--     (permission roles.edit).
-- Requiert la 014 (rôles système). Idempotente.

-- ── 1. Affectations comptable ↔ client ────────────────────────────────────
CREATE TABLE IF NOT EXISTS cabinet_affectations (
  user_id    UUID        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  tenant_id  UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_cabinet_affectations_tenant ON cabinet_affectations(tenant_id);
-- Volontairement AUCUNE affectation automatique : après déploiement, un
-- comptable cabinet ne voit plus aucun client tant que le super_admin ne lui
-- en a pas affecté (Configuration → Utilisateurs, sans client sélectionné → 🏢).

-- ── 2 & 3. Nouvelles permissions ──────────────────────────────────────────
INSERT INTO permissions(code, nom, module, description) VALUES
  ('journaux.arreter', 'Arrêter une caisse (encadrement)', 'journaux',
   'Arrêter n''importe quel journal du client, même sans en être le responsable d''arrêt désigné'),
  ('roles.edit',       'Gérer les profils métier',         'roles',
   'Créer, modifier et supprimer les profils métier du client et définir leurs permissions')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, v.code
  FROM roles r
 CROSS JOIN (VALUES ('journaux.arreter'), ('roles.edit')) AS v(code)
 WHERE r.code = 'directeur' AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;

-- Les clients ayant un plafond configuré bloqueraient ces nouveaux codes :
-- on les y ajoute (décision : le directeur de chaque client en bénéficie).
INSERT INTO tenant_permissions(tenant_id, permission_code)
SELECT DISTINCT tp.tenant_id, v.code
  FROM tenant_permissions tp
 CROSS JOIN (VALUES ('journaux.arreter'), ('roles.edit')) AS v(code)
ON CONFLICT DO NOTHING;

-- Un comptable cabinet ne doit plus arrêter les caisses de ses clients : la
-- 014 ne lui avait rien donné de tel, rien à retirer. Les profils métier
-- existants ne reçoivent pas journaux.arreter (droit d'encadrement).
