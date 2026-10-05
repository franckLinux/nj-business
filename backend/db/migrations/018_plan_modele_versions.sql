-- ── 018 — Plan comptable : modèle global versionné (réforme, étape 1) ──────
-- AJOUTS UNIQUEMENT : aucune table, colonne ni ligne supprimée ou renommée.
-- L'application continue de lire plan_comptable_syscohada et sa colonne
-- `actif` exactement comme avant ; les nouvelles colonnes ne sont utilisées
-- que par les étapes suivantes de la réforme.
--
--  1. plan_modele_versions : versions du modèle global. Les comptes du
--     référentiel déjà chargés deviennent la version 1 (« SYSCOHADA révisé »).
--  2. plan_comptable_syscohada reçoit :
--       version_id     → version du modèle à laquelle le compte appartient
--                        (NULL pour un compte 'custom' : il sera rattaché à
--                        son client à l'étape 2) ;
--       parent_compte  → compte parent, déduit du numéro (6251 → 625 → 62) ;
--       statut         → actif | inactif | archive (actif reste la colonne lue
--                        par l'application ; statut la complète) ;
--       description, updated_at.
--  3. plan_modele_historique : journal des modifications du modèle.
--  4. plan_modele_recalculer() : recalcule parent/version/statut. Appelée ici
--     et après chaque chargement du référentiel (db/lib/seed-plan.lib.js).
-- Idempotente.

-- ── 1. Versions du modèle ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plan_modele_versions (
    id           SERIAL PRIMARY KEY,
    code         TEXT        NOT NULL UNIQUE,          -- ex. SYSCOHADA-2018-V1
    libelle      TEXT        NOT NULL,
    referentiel  TEXT        NOT NULL DEFAULT 'SYSCOHADA révisé (AUDCIF)',
    statut       TEXT        NOT NULL DEFAULT 'brouillon'
                 CHECK (statut IN ('brouillon','publiee','archivee')),
    notes        TEXT        NOT NULL DEFAULT '',
    publiee_le   TIMESTAMPTZ,
    created_by   UUID REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Une seule version publiée « courante » à la fois.
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_modele_version_publiee
    ON plan_modele_versions ((true)) WHERE statut = 'publiee';

INSERT INTO plan_modele_versions (code, libelle, statut, notes, publiee_le)
VALUES ('SYSCOHADA-2018-V1', 'SYSCOHADA révisé — version initiale', 'publiee',
        'Référentiel chargé avant la réforme du plan comptable (626 comptes à la création).',
        NOW())
ON CONFLICT (code) DO NOTHING;

-- ── 2. Colonnes complémentaires du modèle ──────────────────────────────────
ALTER TABLE plan_comptable_syscohada
    ADD COLUMN IF NOT EXISTS version_id    INTEGER REFERENCES plan_modele_versions(id),
    ADD COLUMN IF NOT EXISTS parent_compte TEXT,
    ADD COLUMN IF NOT EXISTS statut        TEXT NOT NULL DEFAULT 'actif',
    ADD COLUMN IF NOT EXISTS description   TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_pcs_statut') THEN
    ALTER TABLE plan_comptable_syscohada
      ADD CONSTRAINT ck_pcs_statut CHECK (statut IN ('actif','inactif','archive'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pcs_parent  ON plan_comptable_syscohada (parent_compte);
CREATE INDEX IF NOT EXISTS idx_pcs_version ON plan_comptable_syscohada (version_id);

-- ── 3. Historique des modifications du modèle ─────────────────────────────
CREATE TABLE IF NOT EXISTS plan_modele_historique (
    id              BIGSERIAL PRIMARY KEY,
    version_id      INTEGER REFERENCES plan_modele_versions(id),
    compte_id       BIGINT  REFERENCES plan_comptable_syscohada(id),
    compte          TEXT,
    action          TEXT    NOT NULL,      -- CREATION_VERSION, AJOUT, MODIF_LIBELLE, ARCHIVAGE…
    ancienne_valeur JSONB,
    nouvelle_valeur JSONB,
    user_id         UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pmh_compte  ON plan_modele_historique (compte_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pmh_version ON plan_modele_historique (version_id, created_at DESC);

-- ── 4. Recalcul parent / version / statut ──────────────────────────────────
CREATE OR REPLACE FUNCTION plan_modele_recalculer() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_id INTEGER;
BEGIN
  SELECT id INTO v_id FROM plan_modele_versions WHERE statut = 'publiee' LIMIT 1;

  -- Les comptes du référentiel sans version rejoignent la version publiée.
  UPDATE plan_comptable_syscohada
     SET version_id = v_id
   WHERE source = 'syscohada' AND version_id IS NULL AND v_id IS NOT NULL;

  -- Parent = plus long préfixe strict du numéro qui existe dans le plan.
  UPDATE plan_comptable_syscohada p
     SET parent_compte = x.parent
    FROM (
      SELECT c.id,
             (SELECT q.compte
                FROM plan_comptable_syscohada q
               WHERE length(q.compte) < length(c.compte)
                 AND c.compte LIKE q.compte || '%'
               ORDER BY length(q.compte) DESC
               LIMIT 1) AS parent
        FROM plan_comptable_syscohada c
    ) x
   WHERE p.id = x.id
     AND p.parent_compte IS DISTINCT FROM x.parent;

  -- statut suit `actif` (colonne lue par l'application) ; un compte archivé
  -- reste archivé tant qu'il est inactif.
  UPDATE plan_comptable_syscohada
     SET statut = CASE WHEN actif THEN 'actif'
                       WHEN statut = 'archive' THEN 'archive'
                       ELSE 'inactif' END
   WHERE statut IS DISTINCT FROM CASE WHEN actif THEN 'actif'
                                      WHEN statut = 'archive' THEN 'archive'
                                      ELSE 'inactif' END;
END $$;

SELECT plan_modele_recalculer();

-- Trace de la création de la version 1 (une seule fois).
INSERT INTO plan_modele_historique (version_id, action, nouvelle_valeur)
SELECT v.id, 'CREATION_VERSION',
       jsonb_build_object('code', v.code,
                          'nb_comptes', (SELECT COUNT(*) FROM plan_comptable_syscohada WHERE version_id = v.id))
  FROM plan_modele_versions v
 WHERE v.code = 'SYSCOHADA-2018-V1'
   AND NOT EXISTS (SELECT 1 FROM plan_modele_historique h
                    WHERE h.version_id = v.id AND h.action = 'CREATION_VERSION');
