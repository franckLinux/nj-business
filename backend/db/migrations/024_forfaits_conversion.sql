-- ── 024 — Forfaits, abonnements, paiements, conversion (réforme prospects, étape 4)
-- AJOUTS UNIQUEMENT. Les prix sont saisis plus tard par le super_admin
-- (prix NULL = « à définir ») : aucun forfait n'est imposé ici.

CREATE TABLE IF NOT EXISTS forfaits (
    id               SERIAL PRIMARY KEY,
    code             TEXT NOT NULL UNIQUE,
    nom              TEXT NOT NULL,
    description      TEXT NOT NULL DEFAULT '',
    prix             NUMERIC(14,2) CHECK (prix IS NULL OR prix >= 0),
    devise           TEXT NOT NULL DEFAULT 'FCFA',
    duree_mois       INTEGER NOT NULL DEFAULT 12 CHECK (duree_mois BETWEEN 1 AND 120),
    nb_utilisateurs_max INTEGER CHECK (nb_utilisateurs_max IS NULL OR nb_utilisateurs_max > 0),
    nb_caisses_max   INTEGER CHECK (nb_caisses_max IS NULL OR nb_caisses_max > 0),
    actif            BOOLEAN NOT NULL DEFAULT true,
    ordre            INTEGER NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Abonnement d'un client à un forfait (historique conservé : jamais écrasé).
CREATE TABLE IF NOT EXISTS abonnements (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id),
    prospect_id  UUID REFERENCES prospects(id),
    forfait_id   INTEGER NOT NULL REFERENCES forfaits(id),
    -- Conditions figées au moment de la souscription (le forfait peut changer ensuite).
    forfait_nom  TEXT NOT NULL,
    prix         NUMERIC(14,2),
    devise       TEXT NOT NULL DEFAULT 'FCFA',
    date_debut   DATE NOT NULL,
    date_fin     DATE NOT NULL,
    statut       TEXT NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif','expire','resilie')),
    conditions   TEXT NOT NULL DEFAULT '',
    notes        TEXT NOT NULL DEFAULT '',
    created_by   UUID REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_abonnement_dates CHECK (date_fin > date_debut)
);
CREATE INDEX IF NOT EXISTS idx_abonnements_tenant ON abonnements (tenant_id, date_fin DESC);

CREATE TABLE IF NOT EXISTS paiements (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prospect_id    UUID REFERENCES prospects(id),
    tenant_id      UUID REFERENCES tenants(id),
    abonnement_id  UUID REFERENCES abonnements(id),
    forfait_id     INTEGER REFERENCES forfaits(id),
    montant        NUMERIC(14,2) NOT NULL CHECK (montant >= 0),
    devise         TEXT NOT NULL DEFAULT 'FCFA',
    date_paiement  DATE NOT NULL,
    methode        TEXT NOT NULL CHECK (methode IN
                   ('especes','virement','orange_money','mtn_momo','cheque','carte','autre')),
    reference      TEXT NOT NULL DEFAULT '',
    statut         TEXT NOT NULL DEFAULT 'recu' CHECK (statut IN ('en_attente','recu','annule')),
    notes          TEXT NOT NULL DEFAULT '',
    created_by     UUID REFERENCES users(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_paiement_rattache CHECK (prospect_id IS NOT NULL OR tenant_id IS NOT NULL)
);
-- Une même référence de transaction ne peut pas être saisie deux fois.
CREATE UNIQUE INDEX IF NOT EXISTS uq_paiements_reference
    ON paiements (methode, lower(btrim(reference))) WHERE btrim(reference) <> '' AND statut <> 'annule';
CREATE INDEX IF NOT EXISTS idx_paiements_prospect ON paiements (prospect_id, date_paiement DESC);

-- Demandes reçues par le formulaire public (page « Demander une démo »).
ALTER TABLE prospects
    ADD COLUMN IF NOT EXISTS demande_web_le TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS demande_traitee BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS idx_prospects_demandes ON prospects (demande_traitee) WHERE NOT demande_traitee;
