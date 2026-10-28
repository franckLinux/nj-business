-- ============================================================================
-- 051 — NJ COMMERCIAL, livraison B : demandes d'achat et circuit d'autorisation
--
--  Statuts d'une demande :
--    brouillon → examen_achats → [examen_direction] → approuvee
--                     ↘ a_corriger (renvoi) → brouillon modifiable → resoumise
--                     ↘ rejetee (fin)            annulee (par l'auteur ou un valideur)
--  La direction n'intervient qu'au-delà du seuil du client (com_parametres).
--
--  Garde-fous en base :
--    • numéros DA uniques par client, attribués sous verrou (com_compteurs) ;
--    • com_decisions en AJOUT SEUL : ni modification ni suppression ;
--    • lignes et pièces rattachées au même client que leur demande.
--
--  PUREMENT ADDITIVE : aucune table existante n'est modifiée.
--  Idempotente. Retour arrière : migrations-retour-arriere/051_retour_arriere.sql
-- ============================================================================

ALTER TABLE com_parametres ADD COLUMN IF NOT EXISTS services TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS com_compteurs (
  tenant_id  UUID     NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type       TEXT     NOT NULL CHECK (type IN ('DA', 'BC')),
  annee      INTEGER  NOT NULL CHECK (annee BETWEEN 2000 AND 2999),
  dernier    INTEGER  NOT NULL DEFAULT 0 CHECK (dernier >= 0),
  PRIMARY KEY (tenant_id, type, annee)
);

CREATE TABLE IF NOT EXISTS com_demandes (
  id                     BIGSERIAL      PRIMARY KEY,
  tenant_id              UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  numero                 TEXT           NOT NULL,
  date_demande           DATE           NOT NULL DEFAULT CURRENT_DATE,
  demandeur_id           UUID           NOT NULL REFERENCES users(id),
  service                TEXT           NOT NULL DEFAULT '' CHECK (length(service) <= 120),
  magasin_id             BIGINT         NOT NULL REFERENCES com_magasins(id),
  motif                  TEXT           NOT NULL DEFAULT '' CHECK (length(motif) <= 2000),
  priorite               TEXT           NOT NULL DEFAULT 'normale' CHECK (priorite IN ('basse', 'normale', 'haute', 'urgente')),
  fournisseur_propose_id BIGINT         REFERENCES registre_tiers(id),
  commentaire            TEXT           NOT NULL DEFAULT '' CHECK (length(commentaire) <= 2000),
  justification_stock    TEXT           NOT NULL DEFAULT '' CHECK (length(justification_stock) <= 1000),
  statut                 TEXT           NOT NULL DEFAULT 'brouillon'
                         CHECK (statut IN ('brouillon', 'examen_achats', 'examen_direction', 'approuvee', 'a_corriger', 'rejetee', 'annulee')),
  montant_estime         NUMERIC(18,2)  NOT NULL DEFAULT 0 CHECK (montant_estime >= 0),
  montant_incomplet      BOOLEAN        NOT NULL DEFAULT false,
  direction_requise      BOOLEAN        NOT NULL DEFAULT false,
  seuil_applique         NUMERIC(18,2),
  nb_soumissions         INTEGER        NOT NULL DEFAULT 0,
  soumise_le             TIMESTAMPTZ,
  decidee_le             TIMESTAMPTZ,
  cree_le                TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  modifie_le             TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_com_demandes_numero ON com_demandes (tenant_id, numero);
CREATE INDEX IF NOT EXISTS idx_com_demandes_statut ON com_demandes (tenant_id, statut, cree_le DESC);
CREATE INDEX IF NOT EXISTS idx_com_demandes_demandeur ON com_demandes (demandeur_id);

CREATE TABLE IF NOT EXISTS com_demande_lignes (
  id                BIGSERIAL      PRIMARY KEY,
  demande_id        BIGINT         NOT NULL REFERENCES com_demandes(id) ON DELETE CASCADE,
  tenant_id         UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ordre             INTEGER        NOT NULL DEFAULT 0,
  article_id        BIGINT         NOT NULL REFERENCES com_articles(id),
  quantite          NUMERIC(18,3)  NOT NULL CHECK (quantite > 0),
  unite             TEXT           NOT NULL,
  fournisseur_id    BIGINT         REFERENCES registre_tiers(id),
  prix_estime       NUMERIC(18,2)  CHECK (prix_estime IS NULL OR prix_estime >= 0),
  commentaire       TEXT           NOT NULL DEFAULT '' CHECK (length(commentaire) <= 500),
  -- Stock tel qu'il était au moment de la soumission (traçabilité) :
  -- { suivi, disponible, a_approvisionner, au }
  stock_constate    JSONB
);
CREATE INDEX IF NOT EXISTS idx_com_demande_lignes_demande ON com_demande_lignes (demande_id);
CREATE INDEX IF NOT EXISTS idx_com_demande_lignes_article ON com_demande_lignes (article_id);

CREATE TABLE IF NOT EXISTS com_decisions (
  id            BIGSERIAL     PRIMARY KEY,
  tenant_id     UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  demande_id    BIGINT        NOT NULL REFERENCES com_demandes(id) ON DELETE CASCADE,
  etape         TEXT          NOT NULL CHECK (etape IN ('demandeur', 'achats', 'direction', 'achats_direction', 'valideur')),
  decision      TEXT          NOT NULL CHECK (decision IN ('soumise', 'approuvee', 'renvoyee', 'rejetee', 'annulee')),
  par           UUID          REFERENCES users(id) ON DELETE SET NULL,
  par_nom       TEXT          NOT NULL DEFAULT '',
  le            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  commentaire   TEXT          NOT NULL DEFAULT '' CHECK (length(commentaire) <= 2000),
  statut_avant  TEXT          NOT NULL,
  statut_apres  TEXT          NOT NULL,
  montant       NUMERIC(18,2)
);
CREATE INDEX IF NOT EXISTS idx_com_decisions_demande ON com_decisions (demande_id, le);

-- Historique des autorisations : jamais modifié ni effacé (sauf suppression
-- du client entier, en cascade, réservée à un client vide).
CREATE OR REPLACE FUNCTION com_decisions_intangibles() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM com_demandes WHERE id = OLD.demande_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'DECISION_INTANGIBLE: l''historique des autorisations ne se modifie pas.' USING ERRCODE = 'check_violation';
END $$;
DROP TRIGGER IF EXISTS trg_com_decisions_intangibles ON com_decisions;
CREATE TRIGGER trg_com_decisions_intangibles BEFORE UPDATE OR DELETE ON com_decisions
  FOR EACH ROW EXECUTE FUNCTION com_decisions_intangibles();

-- Une demande soumise une fois ne disparaît plus : on l'annule.
CREATE OR REPLACE FUNCTION com_demandes_proteger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN RETURN OLD; END IF;
  IF OLD.nb_soumissions > 0 THEN
    RAISE EXCEPTION 'DEMANDE_INTANGIBLE: une demande déjà soumise ne se supprime pas, elle s''annule.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_com_demandes_proteger ON com_demandes;
CREATE TRIGGER trg_com_demandes_proteger BEFORE DELETE ON com_demandes
  FOR EACH ROW EXECUTE FUNCTION com_demandes_proteger();

-- Pièces jointes du module (justificatifs des demandes ; proformas en livraison C).
CREATE TABLE IF NOT EXISTS com_documents (
  id           BIGSERIAL    PRIMARY KEY,
  tenant_id    UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  objet_type   TEXT         NOT NULL CHECK (objet_type IN ('demande', 'bon_commande')),
  objet_id     BIGINT       NOT NULL,
  categorie    TEXT         NOT NULL DEFAULT 'justificatif' CHECK (categorie IN ('justificatif', 'proforma')),
  nom          TEXT         NOT NULL,
  mime         TEXT         NOT NULL,
  taille       BIGINT       NOT NULL CHECK (taille > 0),
  sha256       TEXT         NOT NULL,
  chemin       TEXT         NOT NULL,
  ajoute_par   UUID         REFERENCES users(id) ON DELETE SET NULL,
  ajoute_le    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  retire       BOOLEAN      NOT NULL DEFAULT false,
  retire_par   UUID         REFERENCES users(id) ON DELETE SET NULL,
  retire_le    TIMESTAMPTZ,
  motif_retrait TEXT        NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_com_documents_objet ON com_documents (tenant_id, objet_type, objet_id);

-- Même client partout (complète com_meme_client de la 050).
CREATE OR REPLACE FUNCTION com_meme_client_b() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ok BOOLEAN := true;
BEGIN
  IF TG_TABLE_NAME = 'com_demandes' THEN
    ok := EXISTS (SELECT 1 FROM com_magasins WHERE id = NEW.magasin_id AND tenant_id = NEW.tenant_id)
      AND EXISTS (SELECT 1 FROM users WHERE id = NEW.demandeur_id AND (tenant_id = NEW.tenant_id OR tenant_id IS NULL))
      AND (NEW.fournisseur_propose_id IS NULL OR EXISTS (SELECT 1 FROM registre_tiers WHERE id = NEW.fournisseur_propose_id AND tenant_id = NEW.tenant_id));
  ELSIF TG_TABLE_NAME = 'com_demande_lignes' THEN
    ok := EXISTS (SELECT 1 FROM com_demandes WHERE id = NEW.demande_id AND tenant_id = NEW.tenant_id)
      AND EXISTS (SELECT 1 FROM com_articles WHERE id = NEW.article_id AND tenant_id = NEW.tenant_id)
      AND (NEW.fournisseur_id IS NULL OR EXISTS (SELECT 1 FROM registre_tiers WHERE id = NEW.fournisseur_id AND tenant_id = NEW.tenant_id));
  ELSIF TG_TABLE_NAME IN ('com_decisions') THEN
    ok := EXISTS (SELECT 1 FROM com_demandes WHERE id = NEW.demande_id AND tenant_id = NEW.tenant_id);
  ELSIF TG_TABLE_NAME = 'com_documents' AND NEW.objet_type = 'demande' THEN
    ok := EXISTS (SELECT 1 FROM com_demandes WHERE id = NEW.objet_id AND tenant_id = NEW.tenant_id);
  END IF;
  IF NOT ok THEN
    RAISE EXCEPTION 'Référence d''un autre client refusée (%).', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['com_demandes', 'com_demande_lignes', 'com_decisions', 'com_documents'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_meme_client ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_meme_client BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION com_meme_client_b()', t, t);
  END LOOP;
END $$;
