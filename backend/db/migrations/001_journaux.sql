-- ============================================================
--  Migration : ajout table journaux + colonnes journal_id
--  À exécuter UNE SEULE FOIS sur la base existante
-- ============================================================

-- ============================================================
-- 1. TABLE JOURNAUX (journaux dynamiques multi-caisse)
-- ============================================================
CREATE TABLE IF NOT EXISTS journaux (
    id                  SERIAL PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    code                TEXT NOT NULL,
    nom                 TEXT NOT NULL,
    type                TEXT NOT NULL CHECK (type IN ('caisse','banque','om','momo','carte_prepayee','autre')),
    devise              TEXT NOT NULL DEFAULT 'FCFA',
    responsable_saisie  UUID REFERENCES users(id),
    responsable_arret   UUID REFERENCES users(id),
    ordre               INTEGER DEFAULT 0,
    actif               BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, code)
);

-- ============================================================
-- 2. COLONNE journal_id dans TABLE journal
-- ============================================================
ALTER TABLE journal
    ADD COLUMN IF NOT EXISTS journal_id INTEGER REFERENCES journaux(id);

CREATE INDEX IF NOT EXISTS idx_journal_journal_id
    ON journal(tenant_id, journal_id);

-- ============================================================
-- 3. COLONNE journal_id dans TABLE ran
-- ============================================================
ALTER TABLE ran
    ADD COLUMN IF NOT EXISTS journal_id INTEGER REFERENCES journaux(id);

-- Index unique partiel pour ran liés à un journal spécifique
CREATE UNIQUE INDEX IF NOT EXISTS ran_unique_journal
    ON ran(tenant_id, mois, annee, journal_id)
    WHERE journal_id IS NOT NULL;

-- ============================================================
-- 4. TABLE APPEL_FONDS (prévisions mois suivant)
-- ============================================================
CREATE TABLE IF NOT EXISTS appel_fonds (
    id                      SERIAL PRIMARY KEY,
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    journal_id              INTEGER REFERENCES journaux(id),
    mois_cible              TEXT NOT NULL,
    annee_cible             INTEGER NOT NULL,
    rubrique_code           TEXT NOT NULL,
    intitule                TEXT NOT NULL,
    montant_prevu           NUMERIC(15,2) DEFAULT 0,
    montant_approuve        NUMERIC(15,2) DEFAULT 0,
    statut                  TEXT NOT NULL DEFAULT 'en_attente'
                                CHECK (statut IN ('en_attente','approuve','rejete','partiellement_approuve')),
    justification           TEXT DEFAULT '',
    commentaire_approbation TEXT DEFAULT '',
    created_by              UUID REFERENCES users(id),
    approved_by             UUID REFERENCES users(id),
    approved_at             TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index unique partiel pour appel_fonds sans journal_id
CREATE UNIQUE INDEX IF NOT EXISTS appel_fonds_unique_no_journal
    ON appel_fonds(tenant_id, mois_cible, annee_cible, rubrique_code)
    WHERE journal_id IS NULL;

-- Index unique partiel pour appel_fonds avec journal_id
CREATE UNIQUE INDEX IF NOT EXISTS appel_fonds_unique_with_journal
    ON appel_fonds(tenant_id, mois_cible, annee_cible, rubrique_code, journal_id)
    WHERE journal_id IS NOT NULL;
