-- ── 021 — Synchronisation modèle → clients (réforme du plan, étape 7) ──────
-- AJOUT UNIQUEMENT : journal des synchronisations. Chaque ligne garde, pour
-- chaque changement appliqué, la valeur AVANT et APRÈS : c'est la base d'une
-- annulation manuelle (ou d'un futur bouton « annuler ») si besoin.
-- Aucune synchronisation n'est automatique : elles sont déclenchées une par
-- une par l'administrateur plateforme après aperçu (API /plan-modele/synchro).

CREATE TABLE IF NOT EXISTS plan_synchronisations (
    id               BIGSERIAL PRIMARY KEY,
    tenant_id        UUID    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    version_source   INTEGER REFERENCES plan_modele_versions(id),
    version_cible    INTEGER NOT NULL REFERENCES plan_modele_versions(id),
    user_id          UUID REFERENCES users(id),
    nb_proposes      INTEGER NOT NULL DEFAULT 0,
    nb_appliques     INTEGER NOT NULL DEFAULT 0,
    nb_conflits      INTEGER NOT NULL DEFAULT 0,
    resume           JSONB   NOT NULL DEFAULT '{}'::jsonb,
    details          JSONB   NOT NULL DEFAULT '[]'::jsonb,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_plan_synchro_tenant ON plan_synchronisations (tenant_id, created_at DESC);
