-- ============================================================
--  Migration 008 : budget_caisse + demandes_depassement (+ users.email)
--  Tables créées directement avec tenant_id/UUID.
--  Idempotente : si une version héritée en INTEGER existe, elle est
--  recréée au bon type ; sinon la migration ne fait rien.
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT DEFAULT '';

DO $$
BEGIN
  IF COALESCE((SELECT data_type FROM information_schema.columns
               WHERE table_name='budget_caisse' AND column_name='tenant_id'), 'absent') <> 'uuid' THEN
    DROP TABLE IF EXISTS budget_caisse CASCADE;
    CREATE TABLE budget_caisse (
      id         SERIAL PRIMARY KEY,
      tenant_id  UUID    NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
      journal_id INTEGER NOT NULL REFERENCES journaux(id) ON DELETE CASCADE,
      mois       TEXT    NOT NULL,
      annee      INTEGER NOT NULL,
      montant    NUMERIC(15,2) NOT NULL DEFAULT 0,
      set_par    UUID REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, journal_id, mois, annee)
    );
  END IF;

  IF COALESCE((SELECT data_type FROM information_schema.columns
               WHERE table_name='demandes_depassement' AND column_name='tenant_id'), 'absent') <> 'uuid' THEN
    DROP TABLE IF EXISTS demandes_depassement CASCADE;
    CREATE TABLE demandes_depassement (
      id                SERIAL PRIMARY KEY,
      tenant_id         UUID    NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
      journal_id        INTEGER NOT NULL REFERENCES journaux(id) ON DELETE CASCADE,
      mois              TEXT    NOT NULL,
      annee             INTEGER NOT NULL,
      date_mvt          DATE    NOT NULL,
      rubrique_code     TEXT    NOT NULL,
      intitule          TEXT    NOT NULL,
      objet             TEXT    DEFAULT '',
      beneficiaire      TEXT    DEFAULT '',
      piece_identite    TEXT    DEFAULT '',
      telephone         TEXT    DEFAULT '',
      sortie            NUMERIC(15,2) NOT NULL DEFAULT 0,
      budget_montant    NUMERIC(15,2) NOT NULL DEFAULT 0,
      sorties_actuelles NUMERIC(15,2) NOT NULL DEFAULT 0,
      depassement       NUMERIC(15,2) NOT NULL DEFAULT 0,
      statut            TEXT NOT NULL DEFAULT 'en_attente',
      demande_par       UUID REFERENCES users(id),
      demandeur_nom     TEXT DEFAULT '',
      valide_par        UUID REFERENCES users(id),
      valide_le         TIMESTAMPTZ,
      commentaire_dir   TEXT DEFAULT '',
      created_at        TIMESTAMPTZ DEFAULT NOW()
    );
  END IF;
END $$;

-- Distingue dépassement de budget journal (caisse) vs dotation rubrique.
ALTER TABLE demandes_depassement
  ADD COLUMN IF NOT EXISTS type_depassement TEXT NOT NULL DEFAULT 'journal';
