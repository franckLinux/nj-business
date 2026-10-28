-- ============================================================================
-- 046 — Validation des arrêtés de caisse et des inventaires (25/10/2026)
--
-- Menu Contrôle comptable → « Arrêtés & inventaires ».
--
-- 1. controles_arrets : validation, par le contrôle comptable, de l'arrêté
--    d'un journal pour un mois. Le PV scanné (signé) est obligatoire : il
--    atteste le solde constaté. Écart = solde constaté − solde arrêté ; un
--    écart non nul exige une observation. Le validateur ne peut pas être la
--    personne qui a arrêté la caisse (séparation des tâches).
--    Un arrêté VALIDÉ ne peut plus être rouvert (trigger ci-dessous) : il faut
--    d'abord annuler la validation (permission controle.reouvrir + motif).
-- 2. inventaires + inventaires_lignes : inventaire des soldes des journaux à
--    une date (comptage de caisse, relevés bancaires / mobile money). Solde
--    théorique calculé par le serveur, solde constaté saisi, PV scanné
--    obligatoire pour valider. Inventaire validé = figé ; la réouverture exige
--    controle.reouvrir et un motif.
--
-- Fichiers PV : stockés HORS du dossier public /uploads (PV_DIR), servis
-- uniquement par l'API authentifiée. Empreinte SHA-256 conservée.
-- Droits (aucune nouvelle permission) : lecture controle.view ; saisie et
-- validation controle.saisir ; annulation / réouverture controle.reouvrir.
-- Aucune de ces actions n'écrit dans le journal, la passerelle ni les exports.
-- Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS controles_arrets (
  id               BIGSERIAL     PRIMARY KEY,
  tenant_id        UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  journal_id       INTEGER       NOT NULL REFERENCES journaux(id) ON DELETE CASCADE,
  mois             TEXT          NOT NULL,
  annee            INTEGER       NOT NULL,
  -- Arrêté contrôlé. SET NULL : si la caisse est rouverte (avant validation),
  -- le contrôle préparé devient caduc et se rattache au prochain arrêté.
  arret_id         INTEGER       REFERENCES arrets_caisse(id) ON DELETE SET NULL,
  solde_arrete     NUMERIC(15,2),
  solde_constate   NUMERIC(15,2),
  observation      TEXT          NOT NULL DEFAULT '' CHECK (length(observation) <= 2000),
  statut           TEXT          NOT NULL DEFAULT 'a_valider' CHECK (statut IN ('a_valider', 'validee')),
  pv_nom           TEXT,
  pv_path          TEXT,
  pv_mime          TEXT,
  pv_taille        BIGINT,
  pv_sha256        TEXT,
  pv_depose_par    UUID          REFERENCES users(id) ON DELETE SET NULL,
  pv_depose_le     TIMESTAMPTZ,
  cree_par         UUID          REFERENCES users(id) ON DELETE SET NULL,
  cree_le          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  modifie_par      UUID          REFERENCES users(id) ON DELETE SET NULL,
  modifie_le       TIMESTAMPTZ,
  valide_par       UUID          REFERENCES users(id) ON DELETE SET NULL,
  valide_le        TIMESTAMPTZ,
  annule_par       UUID          REFERENCES users(id) ON DELETE SET NULL,
  annule_le        TIMESTAMPTZ,
  motif_annulation TEXT          NOT NULL DEFAULT '',
  UNIQUE (tenant_id, journal_id, mois, annee)
);
CREATE INDEX IF NOT EXISTS idx_controles_arrets_periode ON controles_arrets (tenant_id, annee, mois);

-- Un arrêté validé par le contrôle comptable ne se rouvre pas (fail-closed,
-- même si un autre chemin que l'API tentait la suppression).
CREATE OR REPLACE FUNCTION arret_valide_non_supprimable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM controles_arrets WHERE arret_id = OLD.id AND statut = 'validee') THEN
    RAISE EXCEPTION 'Arrêté de caisse validé par le contrôle comptable : annulez d''abord la validation.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_arret_valide_non_supprimable ON arrets_caisse;
CREATE TRIGGER trg_arret_valide_non_supprimable
  BEFORE DELETE ON arrets_caisse
  FOR EACH ROW EXECUTE FUNCTION arret_valide_non_supprimable();

-- Le journal appartient au même client.
CREATE OR REPLACE FUNCTION controle_journal_meme_client() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM journaux WHERE id = NEW.journal_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Le journal % n''appartient pas à ce client.', NEW.journal_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_controles_arrets_meme_client ON controles_arrets;
CREATE TRIGGER trg_controles_arrets_meme_client
  BEFORE INSERT OR UPDATE OF journal_id, tenant_id ON controles_arrets
  FOR EACH ROW EXECUTE FUNCTION controle_journal_meme_client();

-- ── Inventaires ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventaires (
  id                BIGSERIAL    PRIMARY KEY,
  tenant_id         UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  date_inventaire   DATE         NOT NULL,
  libelle           TEXT         NOT NULL DEFAULT '' CHECK (length(libelle) <= 200),
  observation       TEXT         NOT NULL DEFAULT '' CHECK (length(observation) <= 2000),
  statut            TEXT         NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'valide')),
  pv_nom            TEXT,
  pv_path           TEXT,
  pv_mime           TEXT,
  pv_taille         BIGINT,
  pv_sha256         TEXT,
  pv_depose_par     UUID         REFERENCES users(id) ON DELETE SET NULL,
  pv_depose_le      TIMESTAMPTZ,
  cree_par          UUID         REFERENCES users(id) ON DELETE SET NULL,
  cree_le           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  modifie_par       UUID         REFERENCES users(id) ON DELETE SET NULL,
  modifie_le        TIMESTAMPTZ,
  valide_par        UUID         REFERENCES users(id) ON DELETE SET NULL,
  valide_le         TIMESTAMPTZ,
  rouvert_par       UUID         REFERENCES users(id) ON DELETE SET NULL,
  rouvert_le        TIMESTAMPTZ,
  motif_reouverture TEXT         NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_inventaires_tenant ON inventaires (tenant_id, date_inventaire DESC);

CREATE TABLE IF NOT EXISTS inventaires_lignes (
  id               BIGSERIAL     PRIMARY KEY,
  inventaire_id    BIGINT        NOT NULL REFERENCES inventaires(id) ON DELETE CASCADE,
  tenant_id        UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  journal_id       INTEGER       NOT NULL REFERENCES journaux(id) ON DELETE CASCADE,
  -- Figé à la validation (calculé à la lecture tant que l'inventaire est en brouillon).
  solde_theorique  NUMERIC(15,2),
  solde_constate   NUMERIC(15,2),
  observation      TEXT          NOT NULL DEFAULT '' CHECK (length(observation) <= 1000),
  UNIQUE (inventaire_id, journal_id)
);
CREATE INDEX IF NOT EXISTS idx_inventaires_lignes_inv ON inventaires_lignes (inventaire_id);

DROP TRIGGER IF EXISTS trg_inventaires_lignes_meme_client ON inventaires_lignes;
CREATE TRIGGER trg_inventaires_lignes_meme_client
  BEFORE INSERT OR UPDATE OF journal_id, tenant_id ON inventaires_lignes
  FOR EACH ROW EXECUTE FUNCTION controle_journal_meme_client();
