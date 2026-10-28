-- ── 035 — Ouverture des démonstrations : validation par la Direction ou par code ──
--  Un commercial n'ouvre plus seul une démonstration : il en demande la
--  validation (Super Admin / Direction), OU il la valide directement avec son
--  CODE PERSONNEL s'il détient la permission « prospects.validation_directe ».
--  Aucun nouveau statut : la demande en cours est portée par deux colonnes ;
--  la validation déclenche l'ouverture habituelle (INVITATION_ENVOYEE).
--  Les codes ne sont JAMAIS stockés en clair (HMAC-SHA256 + bcrypt).
-- Idempotente.

-- 1. Demande de validation en cours (sur la fiche prospect) ------------------
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS demo_validation_demandee_le  TIMESTAMPTZ;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS demo_validation_demandee_par UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_prospects_validation_demandee ON prospects (demo_validation_demandee_le)
  WHERE demo_validation_demandee_le IS NOT NULL;

-- 2. Codes personnels de validation directe -------------------------------------
CREATE TABLE IF NOT EXISTS codes_validation_demo (
  id                      SERIAL PRIMARY KEY,
  user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash               TEXT NOT NULL,
  actif                   BOOLEAN NOT NULL DEFAULT true,
  expire_le               TIMESTAMPTZ,
  limite_utilisations     INTEGER CHECK (limite_utilisations IS NULL OR limite_utilisations > 0),
  nb_utilisations         INTEGER NOT NULL DEFAULT 0,
  derniere_utilisation_le TIMESTAMPTZ,
  tentatives_echouees     INTEGER NOT NULL DEFAULT 0,   -- échecs consécutifs (remis à 0 au succès / blocage)
  bloque_jusqu_au         TIMESTAMPTZ,
  revoque_le              TIMESTAMPTZ,
  revoque_par             UUID REFERENCES users(id) ON DELETE SET NULL,
  cree_par                UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Un seul code non révoqué par personne (code PERSONNEL).
CREATE UNIQUE INDEX IF NOT EXISTS uq_code_validation_courant ON codes_validation_demo (user_id) WHERE revoque_le IS NULL;

-- 3. Journal des validations (succès, échecs, demandes, refus) -----------------
CREATE TABLE IF NOT EXISTS prospect_validations (
  id           BIGSERIAL PRIMARY KEY,
  prospect_id  UUID REFERENCES prospects(id) ON DELETE SET NULL,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  username     TEXT NOT NULL DEFAULT '',
  methode      TEXT NOT NULL CHECK (methode IN ('DIRECT_CODE', 'SUPER_ADMIN', 'DEMANDE')),
  resultat     TEXT NOT NULL CHECK (resultat IN ('SUCCESS', 'FAILED', 'REQUESTED', 'REJECTED', 'CANCELLED')),
  motif        TEXT NOT NULL DEFAULT '',
  code_id      INTEGER REFERENCES codes_validation_demo(id) ON DELETE SET NULL,
  ip_address   TEXT NOT NULL DEFAULT '',
  user_agent   TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prospect_validations_user ON prospect_validations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prospect_validations_prospect ON prospect_validations (prospect_id, created_at DESC);

-- 4. Permission dédiée : accordée personne par personne par le Super Admin --------
INSERT INTO permissions(code, nom, module, description) VALUES
  ('prospects.validation_directe', 'Valider une démo avec son code', 'plateforme',
   'Ouvrir directement une démonstration en saisissant son code personnel de validation, sans attendre le Super Admin')
ON CONFLICT (code) DO NOTHING;
