-- ============================================================
--  CaissePro v2 — Schéma PostgreSQL Multi-Tenant
--  Cabinet Expert-Comptable CEMAC
--  PostgreSQL 14+ auto-hébergé — isolation multi-tenant applicative
-- ============================================================

-- Extension UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TENANTS (entités clientes du cabinet)
-- ============================================================
CREATE TABLE IF NOT EXISTS tenants (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug          TEXT NOT NULL UNIQUE,           -- identifiant URL ex: "client-abc"
    nom           TEXT NOT NULL,
    logo_url      TEXT,
    devise        TEXT NOT NULL DEFAULT 'FCFA',
    exercice_debut DATE,
    exercice_fin  DATE,
    caissier_nom  TEXT,
    directeur_nom TEXT,
    actif         BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- UTILISATEURS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL = super admin cabinet
    username      TEXT NOT NULL,
    email         TEXT,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('super_admin','comptable_cabinet','directeur','caissier','auditeur')),
    actif         BOOLEAN NOT NULL DEFAULT true,
    derniere_connexion TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, username)
);

-- ============================================================
-- RUBRIQUES DYNAMIQUES (remplace les constantes codées en dur)
-- ============================================================
CREATE TABLE IF NOT EXISTS rubriques (
    id            SERIAL PRIMARY KEY,
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    code          TEXT NOT NULL,
    intitule      TEXT NOT NULL,
    type          TEXT NOT NULL CHECK (type IN ('entree','depense')),
    est_virement_interne BOOLEAN NOT NULL DEFAULT false,  -- SCOM/SOMC exclut du budget
    actif         BOOLEAN NOT NULL DEFAULT true,
    ordre         INTEGER DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, code)
);

-- ============================================================
-- JOURNAL DES MOUVEMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS journal (
    id            BIGSERIAL PRIMARY KEY,
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    date          DATE NOT NULL,
    mois          TEXT NOT NULL,
    annee         INTEGER NOT NULL,
    type_caisse   TEXT NOT NULL CHECK (type_caisse IN ('especes','om')),
    rubrique_code TEXT NOT NULL,
    intitule      TEXT NOT NULL,
    objet         TEXT DEFAULT '',
    beneficiaire  TEXT DEFAULT '',
    piece_identite TEXT DEFAULT '',
    telephone     TEXT DEFAULT '',
    entree        NUMERIC(15,2) DEFAULT 0,
    sortie        NUMERIC(15,2) DEFAULT 0,
    exporte_sage  BOOLEAN DEFAULT false,
    created_by    UUID REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_journal_tenant_mois ON journal(tenant_id, mois, annee);
CREATE INDEX IF NOT EXISTS idx_journal_export ON journal(tenant_id, exporte_sage);

-- ============================================================
-- RAN — REPORT À NOUVEAU
-- ============================================================
CREATE TABLE IF NOT EXISTS ran (
    id            SERIAL PRIMARY KEY,
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    mois          TEXT NOT NULL,
    annee         INTEGER NOT NULL,
    type_caisse   TEXT NOT NULL CHECK (type_caisse IN ('especes','om')),
    montant       NUMERIC(15,2) DEFAULT 0,
    UNIQUE(tenant_id, mois, annee, type_caisse)
);

-- ============================================================
-- BUDGET & DOTATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS budget (
    id            SERIAL PRIMARY KEY,
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    mois          TEXT NOT NULL,
    annee         INTEGER NOT NULL,
    rubrique_code TEXT NOT NULL,
    intitule      TEXT NOT NULL,
    montant       NUMERIC(15,2) DEFAULT 0,
    mois_applic   TEXT DEFAULT '',
    annee_applic  INTEGER DEFAULT 0,
    UNIQUE(tenant_id, mois, annee, rubrique_code)
);

-- ============================================================
-- VALIDATION BUDGET
-- ============================================================
CREATE TABLE IF NOT EXISTS budget_validation (
    id            SERIAL PRIMARY KEY,
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    mois          TEXT NOT NULL,
    annee         INTEGER NOT NULL,
    statut        TEXT NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente','valide','rejete')),
    commentaire   TEXT DEFAULT '',
    validated_by  UUID REFERENCES users(id),
    validated_at  TIMESTAMPTZ,
    UNIQUE(tenant_id, mois, annee)
);

-- ============================================================
-- DÉPENSES EN ATTENTE (saisies libres caissière)
-- ============================================================
CREATE TABLE IF NOT EXISTS depenses_attente (
    id            SERIAL PRIMARY KEY,
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    mois          TEXT NOT NULL,
    annee         INTEGER NOT NULL,
    rubrique_code TEXT NOT NULL,
    intitule      TEXT NOT NULL,
    montant       NUMERIC(15,2) DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- RESSOURCES EN ATTENTE (entrées manuelles demande de fonds)
-- ============================================================
CREATE TABLE IF NOT EXISTS ressources_attente (
    id            SERIAL PRIMARY KEY,
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    mois          TEXT NOT NULL,
    annee         INTEGER NOT NULL,
    rubrique_code TEXT NOT NULL,
    intitule      TEXT NOT NULL,
    montant       NUMERIC(15,2) DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- GESTION BANCAIRE
-- ============================================================
CREATE TABLE IF NOT EXISTS banque (
    id            SERIAL PRIMARY KEY,
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    mois          TEXT NOT NULL,
    annee         INTEGER NOT NULL,
    solde_initial NUMERIC(15,2) DEFAULT 0,
    fonds_recus   NUMERIC(15,2) DEFAULT 0,
    solde_final   NUMERIC(15,2) DEFAULT 0,
    UNIQUE(tenant_id, mois, annee)
);

-- ============================================================
-- ÉQUIVALENCES SAGE i7 (mapping rubrique → plan comptable)
-- ============================================================
CREATE TABLE IF NOT EXISTS sage_equivalences (
    id              SERIAL PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    rubrique_code   TEXT NOT NULL,
    sens            TEXT NOT NULL CHECK (sens IN ('entree','sortie')),
    journal_sage    TEXT NOT NULL,   -- ex: CA, BQ, OD
    compte_debit    TEXT NOT NULL,   -- ex: 4111
    compte_credit   TEXT NOT NULL,   -- ex: 7111
    libelle_compta  TEXT NOT NULL,
    taux_tva        NUMERIC(5,2) DEFAULT 0,
    compte_tva      TEXT DEFAULT '',
    actif           BOOLEAN NOT NULL DEFAULT true,
    version         INTEGER NOT NULL DEFAULT 1,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, rubrique_code, sens, actif)  -- une seule ligne active par rubrique+sens
);

-- ============================================================
-- EXPORTS SAGE i7 (archivage des fichiers générés)
-- ============================================================
CREATE TABLE IF NOT EXISTS exports_sage (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    periode_debut   DATE NOT NULL,
    periode_fin     DATE NOT NULL,
    type_caisse     TEXT,                        -- NULL = les deux
    journal_sage    TEXT,
    nb_ecritures    INTEGER DEFAULT 0,
    checksum        TEXT,
    fichier_ecr     TEXT,                        -- path serveur ou URL
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- JOURNAL D'AUDIT (immuable)
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id              BIGSERIAL PRIMARY KEY,
    tenant_id       UUID REFERENCES tenants(id),
    user_id         UUID REFERENCES users(id),
    action          TEXT NOT NULL,               -- ex: CREATE_MOUVEMENT, DELETE_USER
    entite          TEXT NOT NULL,               -- ex: journal, budget, users
    entite_id       TEXT,
    ancienne_valeur JSONB,
    nouvelle_valeur JSONB,
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log(tenant_id, created_at DESC);

-- ============================================================
-- REFRESH TOKENS
-- ============================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked     BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TRIGGER updated_at automatique
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_tenants_updated_at
    BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER trg_journal_updated_at
    BEFORE UPDATE ON journal FOR EACH ROW EXECUTE FUNCTION update_updated_at();
