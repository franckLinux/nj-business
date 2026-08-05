-- ============================================================
--  Migration 009 : mouvements_attente (RG-03 / RG-04) + users.canal_notif
--  Idempotente.
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS canal_notif TEXT NOT NULL DEFAULT 'email';
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_canal_notif;
ALTER TABLE users ADD CONSTRAINT chk_users_canal_notif
  CHECK (canal_notif IN ('email','plateforme','les_deux','aucun'));

CREATE TABLE IF NOT EXISTS mouvements_attente (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  mois            TEXT NOT NULL,
  annee           INTEGER NOT NULL,
  journal_id      INTEGER REFERENCES journaux(id),
  type_caisse     TEXT NOT NULL DEFAULT 'especes',
  rubrique_code   TEXT NOT NULL,
  intitule        TEXT NOT NULL,
  objet           TEXT DEFAULT '',
  beneficiaire    TEXT DEFAULT '',
  piece_identite  TEXT DEFAULT '',
  telephone       TEXT DEFAULT '',
  sortie          NUMERIC(15,2) NOT NULL DEFAULT 0,
  motif_attente   TEXT NOT NULL,
  montant_prevu   NUMERIC(15,2) DEFAULT 0,
  cumul_sorties   NUMERIC(15,2) DEFAULT 0,
  statut          TEXT NOT NULL DEFAULT 'en_attente'
                      CHECK (statut IN ('en_attente','approuve','rejete')),
  commentaire_dir TEXT DEFAULT '',
  client_uuid     TEXT,
  created_by      UUID REFERENCES users(id),
  decided_by      UUID REFERENCES users(id),
  decided_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mvt_attente_pending
  ON mouvements_attente(tenant_id, mois, annee, statut);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mvt_attente_client_uuid
  ON mouvements_attente(tenant_id, client_uuid)
  WHERE client_uuid IS NOT NULL;

ALTER TABLE mouvements_attente DROP CONSTRAINT IF EXISTS mouvements_attente_motif_attente_check;
ALTER TABLE mouvements_attente DROP CONSTRAINT IF EXISTS chk_mvt_attente_motif;
ALTER TABLE mouvements_attente ADD CONSTRAINT chk_mvt_attente_motif
  CHECK (motif_attente IN ('mois_non_valide','rubrique_non_approuvee','depassement_journal','depassement_rubrique'));
