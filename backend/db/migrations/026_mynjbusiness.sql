-- ── 026 — MyNjBusiness : suivi commercial léger ───────────────────────────
-- AJOUTS UNIQUEMENT, sur les tables existantes (aucune table « clients »,
-- aucun second système d'utilisateurs) :
--   * rôle système 'commercial' (compte du cabinet, sans accès aux caisses) ;
--   * prospects : commercial responsable, dernier contact, prochaine action ;
--   * 2 étapes de pipeline : CONTACTE, INTERESSE ;
--   * e-mail facultatif (prospect « terrain » connu par son seul téléphone).

-- 1. Rôle commercial ---------------------------------------------------------
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('super_admin','comptable_cabinet','directeur','caissier','auditeur','commercial'));

INSERT INTO roles(nom, code, description, couleur, tenant_id, is_system) VALUES
  ('Commercial', 'commercial', 'Rôle système — suivi de ses prospects (MyNjBusiness), sans accès aux caisses', '#c2410c', NULL, true)
ON CONFLICT (code) WHERE tenant_id IS NULL DO UPDATE SET is_system = true;

INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, 'prospects.gerer' FROM roles r WHERE r.code = 'commercial' AND r.tenant_id IS NULL
ON CONFLICT DO NOTHING;

-- 2. Suivi commercial sur la fiche prospect existante -------------------------
ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS commercial_id       UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS dernier_contact_le  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS prochaine_action    TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS prochaine_action_le DATE;
CREATE INDEX IF NOT EXISTS idx_prospects_commercial ON prospects (commercial_id, statut);
CREATE INDEX IF NOT EXISTS idx_prospects_relance ON prospects (prochaine_action_le) WHERE prochaine_action_le IS NOT NULL;

ALTER TABLE prospects DROP CONSTRAINT IF EXISTS ck_prospect_statut;
ALTER TABLE prospects ADD CONSTRAINT ck_prospect_statut CHECK (statut IN (
  'PROSPECT','CONTACTE','INTERESSE','INVITATION_ENVOYEE','DEMO_ACTIVE','DEMO_EXPIREE',
  'PAIEMENT_EN_ATTENTE','CLIENT_ACTIF','DEMO_ANNULEE','PROSPECT_ABANDONNE'));

-- 3. E-mail facultatif, toujours unique quand il est renseigné ---------------
ALTER TABLE prospects ALTER COLUMN email DROP NOT NULL;
DROP INDEX IF EXISTS uq_prospects_email;
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospects_email ON prospects (lower(btrim(email)))
  WHERE email IS NOT NULL AND btrim(email) <> '';
CREATE INDEX IF NOT EXISTS idx_prospects_telephone ON prospects (regexp_replace(telephone, '\D', '', 'g'));
