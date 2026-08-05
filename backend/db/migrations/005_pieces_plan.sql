-- ============================================================
--  Migration : Plan comptable (ajout de comptes, n° sans limite)
--              + Pièces justificatives (types & fichiers joints)
--  Idempotente — peut être exécutée plusieurs fois sans risque.
-- ============================================================

-- ============================================================
-- 1. PLAN COMPTABLE SYSCOHADA
--    Référentiel + comptes personnalisés du cabinet.
--    `compte` en TEXT => AUCUNE limite de taille sur le numéro.
-- ============================================================
CREATE TABLE IF NOT EXISTS plan_comptable_syscohada (
    id          BIGSERIAL PRIMARY KEY,
    compte      TEXT NOT NULL,
    intitule    TEXT NOT NULL,
    classe      INTEGER,
    nature      TEXT,
    source      TEXT NOT NULL DEFAULT 'syscohada',   -- 'syscohada' | 'custom'
    actif       BOOLEAN NOT NULL DEFAULT true,
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Si la table préexistait avec un VARCHAR(n) sur le numéro de compte,
-- on lève toute limite de longueur en passant en TEXT.
ALTER TABLE plan_comptable_syscohada
    ALTER COLUMN compte   TYPE TEXT,
    ALTER COLUMN intitule TYPE TEXT;

-- Colonnes ajoutées si la table préexistait sans elles.
ALTER TABLE plan_comptable_syscohada
    ADD COLUMN IF NOT EXISTS source     TEXT NOT NULL DEFAULT 'syscohada',
    ADD COLUMN IF NOT EXISTS actif      BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS created_by UUID,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Unicité du numéro de compte (insensible à la casse / espaces superflus).
CREATE UNIQUE INDEX IF NOT EXISTS uq_pcs_compte
    ON plan_comptable_syscohada (lower(btrim(compte)));

CREATE INDEX IF NOT EXISTS idx_pcs_classe
    ON plan_comptable_syscohada (classe) WHERE actif = true;

-- ============================================================
-- 2. PIÈCES JUSTIFICATIVES — TYPES ATTENDUS PAR RUBRIQUE
--    (c'est l'absence de cette table qui empêchait l'affichage
--     de l'annotation pièces après sélection d'une rubrique)
-- ============================================================
CREATE TABLE IF NOT EXISTS pieces_justificatives_types (
    id             SERIAL PRIMARY KEY,
    tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    rubrique_code  TEXT NOT NULL,
    intitule_piece TEXT NOT NULL,
    description    TEXT DEFAULT '',
    obligatoire    BOOLEAN NOT NULL DEFAULT false,
    ordre          INTEGER DEFAULT 0,
    actif          BOOLEAN NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pjt_tenant_rubrique
    ON pieces_justificatives_types (tenant_id, rubrique_code) WHERE actif = true;

-- ============================================================
-- 3. PIÈCES JOINTES (fichiers uploadés rattachés à un mouvement)
-- ============================================================
CREATE TABLE IF NOT EXISTS pieces_jointes (
    id             BIGSERIAL PRIMARY KEY,
    tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    journal_id_mvt BIGINT NOT NULL REFERENCES journal(id) ON DELETE CASCADE,
    nom_fichier    TEXT NOT NULL,
    storage_path   TEXT NOT NULL,
    storage_url    TEXT NOT NULL,
    type_mime      TEXT,
    taille_octets  BIGINT,
    uploaded_by    UUID REFERENCES users(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pj_tenant_mvt
    ON pieces_jointes (tenant_id, journal_id_mvt);
