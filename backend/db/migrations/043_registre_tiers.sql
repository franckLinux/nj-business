-- ============================================================================
-- 043 — Registre des clients / fournisseurs + contrôle « pièce en main »
--       (décision du 22/10/2026)
--
-- 1. registre_tiers : le registre des clients et fournisseurs du client
--    (NUI, nom, RCCM, contacts). Un tiers « vérifié » sert de référence : le
--    contrôle des pièces compare le nom saisi à celui du registre.
-- 2. controles_pieces : références de la pièce justificative examinée
--    (n°, date, montants TTC / HT / TVA), « original présenté » et lien vers
--    le tiers du registre.
-- Toujours une couche à part : la table journal n'est jamais modifiée.
-- Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS registre_tiers (
  id          BIGSERIAL   PRIMARY KEY,
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type        TEXT        NOT NULL DEFAULT 'fournisseur'
                          CHECK (type IN ('fournisseur', 'client', 'mixte')),
  nui         TEXT        NOT NULL DEFAULT '',
  nom         TEXT        NOT NULL CHECK (btrim(nom) <> ''),
  rccm        TEXT        NOT NULL DEFAULT '',
  telephone   TEXT        NOT NULL DEFAULT '',
  email       TEXT        NOT NULL DEFAULT '',
  adresse     TEXT        NOT NULL DEFAULT '',
  notes       TEXT        NOT NULL DEFAULT '',
  verifie     BOOLEAN     NOT NULL DEFAULT false,   -- identité vérifiée sur pièce
  verifie_par UUID        REFERENCES users(id) ON DELETE SET NULL,
  verifie_le  TIMESTAMPTZ,
  actif       BOOLEAN     NOT NULL DEFAULT true,
  cree_par    UUID        REFERENCES users(id) ON DELETE SET NULL,
  cree_le     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  modifie_le  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Un NUI n'identifie qu'un seul tiers par client (NUI vide autorisé : petits
-- fournisseurs informels).
CREATE UNIQUE INDEX IF NOT EXISTS uq_registre_tiers_nui
  ON registre_tiers (tenant_id, upper(btrim(nui))) WHERE btrim(nui) <> '';
CREATE INDEX IF NOT EXISTS idx_registre_tiers_nom ON registre_tiers (tenant_id, lower(nom));

-- ── Pièce justificative examinée ─────────────────────────────────────────────
ALTER TABLE controles_pieces ADD COLUMN IF NOT EXISTS tiers_id          BIGINT REFERENCES registre_tiers(id) ON DELETE SET NULL;
ALTER TABLE controles_pieces ADD COLUMN IF NOT EXISTS piece_numero      TEXT NOT NULL DEFAULT '';
ALTER TABLE controles_pieces ADD COLUMN IF NOT EXISTS piece_date        DATE;
ALTER TABLE controles_pieces ADD COLUMN IF NOT EXISTS piece_montant     NUMERIC(15, 2);   -- TTC / total de la pièce
ALTER TABLE controles_pieces ADD COLUMN IF NOT EXISTS piece_ht          NUMERIC(15, 2);
ALTER TABLE controles_pieces ADD COLUMN IF NOT EXISTS piece_tva         NUMERIC(15, 2);
ALTER TABLE controles_pieces ADD COLUMN IF NOT EXISTS original_presente BOOLEAN NOT NULL DEFAULT false;

-- Recherche des doublons de facture (même tiers, même n°).
CREATE INDEX IF NOT EXISTS idx_controle_piece_numero
  ON controles_pieces (tenant_id, upper(btrim(piece_numero))) WHERE btrim(piece_numero) <> '';

-- Le tiers lié doit appartenir au même client.
CREATE OR REPLACE FUNCTION controle_meme_client() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM journal WHERE id = NEW.mouvement_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'La pièce % n''appartient pas à ce client.', NEW.mouvement_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.tiers_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM registre_tiers WHERE id = NEW.tiers_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Le tiers % n''appartient pas à ce client.', NEW.tiers_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_controle_meme_client ON controles_pieces;
CREATE TRIGGER trg_controle_meme_client
  BEFORE INSERT OR UPDATE OF tenant_id, mouvement_id, tiers_id ON controles_pieces
  FOR EACH ROW EXECUTE FUNCTION controle_meme_client();

-- Permissions : consultation du registre avec controle.view, gestion avec
-- controle.saisir (mêmes profils que le contrôle des pièces). Rien à ajouter.
