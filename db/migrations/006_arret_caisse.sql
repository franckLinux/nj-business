-- ── Arrêt de caisse ───────────────────────────────────────────────────────
-- Enregistre l'acte formel d'arrêt par le responsable pour un journal/mois donné

CREATE TABLE IF NOT EXISTS arrets_caisse (
  id          SERIAL PRIMARY KEY,
  tenant_id   UUID        NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  journal_id  INTEGER     NOT NULL REFERENCES journaux(id) ON DELETE CASCADE,
  mois        TEXT        NOT NULL,
  annee       INTEGER     NOT NULL,
  solde_final NUMERIC(15,2) DEFAULT 0,
  arrete_le   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  arrete_par  UUID        REFERENCES users(id),
  commentaire TEXT        DEFAULT '',
  UNIQUE(tenant_id, journal_id, mois, annee)
);

CREATE INDEX IF NOT EXISTS idx_arrets_caisse_journal
  ON arrets_caisse(tenant_id, journal_id, mois, annee);
