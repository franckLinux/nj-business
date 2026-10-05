-- ── 023 — Prospects, comptes de démonstration (réforme prospects, étapes 1-3) ─
-- AJOUTS UNIQUEMENT.
--  * Un prospect testant l'application reçoit un ESPACE DE DÉMO = un client
--    (tenant) marqué type_compte = 'demo' : l'isolation par tenant_id déjà
--    contrôlée sur toutes les routes s'applique telle quelle.
--  * Expiration contrôlée côté serveur à chaque requête (middleware/auth.js).
--  * Lien d'activation : seul le condensé SHA-256 est stocké.

-- ── Espaces de démo ────────────────────────────────────────────────────────
ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS type_compte                 TEXT NOT NULL DEFAULT 'client',
    ADD COLUMN IF NOT EXISTS demo_expire_le              TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS donnees_conservees_jusqu_au TIMESTAMPTZ;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tenants_type_compte') THEN
    ALTER TABLE tenants ADD CONSTRAINT ck_tenants_type_compte
      CHECK (type_compte IN ('client','demo','demo_archive'));
  END IF;
END $$;

-- ── Prospects ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prospects (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nom_complet       TEXT NOT NULL DEFAULT '',
    entreprise        TEXT NOT NULL DEFAULT '',
    email             TEXT NOT NULL,
    telephone         TEXT NOT NULL DEFAULT '',
    pays              TEXT NOT NULL DEFAULT 'Cameroun',
    ville             TEXT NOT NULL DEFAULT '',
    secteur           TEXT NOT NULL DEFAULT '',
    type_entreprise   TEXT NOT NULL DEFAULT '',
    nb_utilisateurs   INTEGER,
    nb_points_vente   INTEGER,
    besoins           TEXT NOT NULL DEFAULT '',
    forfait_envisage  TEXT NOT NULL DEFAULT '',
    demo_debut        TIMESTAMPTZ NOT NULL,
    demo_fin          TIMESTAMPTZ NOT NULL,
    notes             TEXT NOT NULL DEFAULT '',
    source            TEXT NOT NULL DEFAULT '',
    statut            TEXT NOT NULL DEFAULT 'PROSPECT',
    tenant_id         UUID REFERENCES tenants(id),        -- espace de démo
    user_id           UUID REFERENCES users(id),          -- compte du prospect
    client_tenant_id  UUID REFERENCES tenants(id),        -- espace client après conversion
    rappel_avant_le   TIMESTAMPTZ,
    rappel_jour_le    TIMESTAMPTZ,
    rappel_apres_le   TIMESTAMPTZ,
    created_by        UUID REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_prospect_nom CHECK (btrim(nom_complet) <> '' OR btrim(entreprise) <> ''),
    CONSTRAINT ck_prospect_dates CHECK (demo_fin > demo_debut),
    CONSTRAINT ck_prospect_statut CHECK (statut IN (
      'PROSPECT','INVITATION_ENVOYEE','DEMO_ACTIVE','DEMO_EXPIREE',
      'PAIEMENT_EN_ATTENTE','CLIENT_ACTIF','DEMO_ANNULEE','PROSPECT_ABANDONNE'))
);
-- Un e-mail = un prospect (évite les doublons).
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospects_email ON prospects (lower(btrim(email)));
CREATE INDEX IF NOT EXISTS idx_prospects_statut ON prospects (statut, demo_fin);

-- Historique des statuts (en plus de audit_log).
CREATE TABLE IF NOT EXISTS prospect_historique (
    id             BIGSERIAL PRIMARY KEY,
    prospect_id    UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
    ancien_statut  TEXT,
    nouveau_statut TEXT,
    action         TEXT NOT NULL,
    motif          TEXT NOT NULL DEFAULT '',
    details        JSONB NOT NULL DEFAULT '{}'::jsonb,
    user_id        UUID REFERENCES users(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prospect_historique ON prospect_historique (prospect_id, created_at DESC);

-- Invitations : le lien n'est jamais stocké, seulement son condensé.
CREATE TABLE IF NOT EXISTS prospect_invitations (
    id            BIGSERIAL PRIMARY KEY,
    prospect_id   UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
    token_hash    TEXT NOT NULL UNIQUE,
    expire_le     TIMESTAMPTZ NOT NULL,
    utilise_le    TIMESTAMPTZ,
    annule_le     TIMESTAMPTZ,
    statut_email  TEXT NOT NULL DEFAULT 'en_attente'
                  CHECK (statut_email IN ('en_attente','envoye','non_envoye','adresse_invalide','renvoye')),
    erreur_email  TEXT NOT NULL DEFAULT '',
    envoye_le     TIMESTAMPTZ,
    est_renvoi    BOOLEAN NOT NULL DEFAULT false,
    created_by    UUID REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prospect_invitations ON prospect_invitations (prospect_id, created_at DESC);

-- ── Permission de gestion des prospects (comptable cabinet, sur décision) ──
INSERT INTO permissions(code, nom, module, description) VALUES
  ('prospects.gerer', 'Gérer les prospects', 'plateforme',
   'Créer des prospects, envoyer les accès de démonstration, prolonger, changer le statut')
ON CONFLICT (code) DO NOTHING;
