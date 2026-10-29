-- ============================================================================
-- 052 — NJ COMMERCIAL, livraison C : bons de commande (28/10/2026)
--
--  Un bon de commande naît d'une demande APPROUVÉE, pour UN fournisseur ; une
--  demande peut donner plusieurs bons (fournisseurs différents, livraisons
--  partielles), sans jamais dépasser les quantités approuvées.
--
--  Statuts : brouillon → emis → annule
--                         └→ remplace (par une révision BC-…-R1 émise ensuite)
--
--  Garde-fous en base :
--    • un bon émis (ou annulé, remplacé) n'est plus modifiable : seules les
--      transitions emis → annule / remplace passent, avec leur motif ;
--    • ses lignes sont figées dès l'émission ; les taux de taxe y sont copiés ;
--    • jeton de vérification unique (QR code) ; empreinte SHA-256 du PDF archivé ;
--    • tout lien reste dans le même client.
--
--  PUREMENT ADDITIVE pour NJ CAISSE PRO. Seules deux règles de tables com_ de
--  la 051 sont élargies : étape « gestionnaire » (revalidation) des décisions.
--  Idempotente. Retour arrière : migrations-retour-arriere/052_retour_arriere.sql
-- ============================================================================

-- Revalidation demandée par le gestionnaire des achats (prix ou fournisseur
-- différents de ce qui a été approuvé).
ALTER TABLE com_decisions DROP CONSTRAINT IF EXISTS com_decisions_etape_check;
ALTER TABLE com_decisions ADD CONSTRAINT com_decisions_etape_check
  CHECK (etape IN ('demandeur', 'achats', 'direction', 'achats_direction', 'valideur', 'gestionnaire'));

CREATE TABLE IF NOT EXISTS com_bons_commande (
  id                   BIGSERIAL      PRIMARY KEY,
  tenant_id            UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  numero               TEXT           NOT NULL,              -- BC-2026-0001 (commun aux révisions)
  revision             INTEGER        NOT NULL DEFAULT 0 CHECK (revision >= 0),
  numero_complet       TEXT           NOT NULL,              -- BC-2026-0001 ou BC-2026-0001-R1
  demande_id           BIGINT         NOT NULL REFERENCES com_demandes(id),
  fournisseur_id       BIGINT         NOT NULL REFERENCES registre_tiers(id),
  magasin_id           BIGINT         NOT NULL REFERENCES com_magasins(id),   -- lieu de livraison
  statut               TEXT           NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'emis', 'annule', 'remplace')),
  devise               TEXT           NOT NULL DEFAULT 'FCFA',
  conditions_paiement  TEXT           NOT NULL DEFAULT '' CHECK (length(conditions_paiement) <= 300),
  delai_livraison      TEXT           NOT NULL DEFAULT '' CHECK (length(delai_livraison) <= 200),
  observations         TEXT           NOT NULL DEFAULT '' CHECK (length(observations) <= 2000),
  total_ht             NUMERIC(18,2)  NOT NULL DEFAULT 0,
  total_taxes          NUMERIC(18,2)  NOT NULL DEFAULT 0,
  total_ttc            NUMERIC(18,2)  NOT NULL DEFAULT 0,
  autorisation         TEXT           NOT NULL DEFAULT '',   -- résumé des décisions, figé à l'émission
  remplace_id          BIGINT         REFERENCES com_bons_commande(id),
  jeton_verification   TEXT,
  pdf_chemin           TEXT,
  pdf_sha256           TEXT,
  prepare_par          UUID           REFERENCES users(id) ON DELETE SET NULL,
  emis_par             UUID           REFERENCES users(id) ON DELETE SET NULL,
  emis_par_nom         TEXT           NOT NULL DEFAULT '',
  emis_le              TIMESTAMPTZ,
  motif_annulation     TEXT           NOT NULL DEFAULT '',
  annule_par           UUID           REFERENCES users(id) ON DELETE SET NULL,
  annule_le            TIMESTAMPTZ,
  cree_le              TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  modifie_le           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  CHECK (statut = 'brouillon' OR (jeton_verification IS NOT NULL AND pdf_sha256 IS NOT NULL AND emis_le IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_com_bc_numero ON com_bons_commande (tenant_id, numero_complet);
CREATE UNIQUE INDEX IF NOT EXISTS uq_com_bc_jeton ON com_bons_commande (jeton_verification) WHERE jeton_verification IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_com_bc_demande ON com_bons_commande (demande_id);
CREATE INDEX IF NOT EXISTS idx_com_bc_statut ON com_bons_commande (tenant_id, statut, cree_le DESC);

CREATE TABLE IF NOT EXISTS com_bc_lignes (
  id                BIGSERIAL      PRIMARY KEY,
  bc_id             BIGINT         NOT NULL REFERENCES com_bons_commande(id) ON DELETE CASCADE,
  tenant_id         UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ordre             INTEGER        NOT NULL DEFAULT 0,
  demande_ligne_id  BIGINT         NOT NULL REFERENCES com_demande_lignes(id),
  article_id        BIGINT         NOT NULL REFERENCES com_articles(id),
  reference         TEXT           NOT NULL,
  designation       TEXT           NOT NULL,
  unite             TEXT           NOT NULL,
  quantite          NUMERIC(18,3)  NOT NULL CHECK (quantite > 0),
  prix_unitaire     NUMERIC(18,2)  NOT NULL CHECK (prix_unitaire >= 0),
  remise_pct        NUMERIC(5,2)   NOT NULL DEFAULT 0 CHECK (remise_pct BETWEEN 0 AND 100),
  taxe_id           BIGINT         REFERENCES com_taxes(id),
  taxe_code         TEXT           NOT NULL DEFAULT '',
  taxe_taux         NUMERIC(7,4)   NOT NULL DEFAULT 0 CHECK (taxe_taux BETWEEN 0 AND 100),
  montant_ht        NUMERIC(18,2)  NOT NULL DEFAULT 0,
  montant_taxe      NUMERIC(18,2)  NOT NULL DEFAULT 0,
  montant_ttc       NUMERIC(18,2)  NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_com_bc_lignes_bc ON com_bc_lignes (bc_id);
CREATE INDEX IF NOT EXISTS idx_com_bc_lignes_dl ON com_bc_lignes (demande_ligne_id);

-- ── Intangibilité d'un bon émis ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION com_bc_proteger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN RETURN OLD; END IF;
    IF OLD.statut <> 'brouillon' THEN
      RAISE EXCEPTION 'BC_INTANGIBLE: un bon de commande émis ne se supprime pas, il s''annule.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.statut = 'brouillon' THEN RETURN NEW; END IF;
  -- Émis : seules l'annulation et le remplacement par une révision sont permis,
  -- sans toucher au contenu ni à la preuve (numéro, jeton, PDF, montants).
  IF OLD.statut = 'emis' AND NEW.statut IN ('annule', 'remplace')
     AND NEW.numero_complet = OLD.numero_complet AND NEW.jeton_verification = OLD.jeton_verification
     AND NEW.pdf_sha256 = OLD.pdf_sha256 AND NEW.pdf_chemin = OLD.pdf_chemin
     AND NEW.total_ttc = OLD.total_ttc AND NEW.total_ht = OLD.total_ht AND NEW.fournisseur_id = OLD.fournisseur_id
     AND NEW.emis_le = OLD.emis_le THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'BC_INTANGIBLE: un bon de commande émis ne se modifie pas ; annulez-le ou faites une révision.' USING ERRCODE = 'check_violation';
END $$;
DROP TRIGGER IF EXISTS trg_com_bc_proteger ON com_bons_commande;
CREATE TRIGGER trg_com_bc_proteger BEFORE UPDATE OR DELETE ON com_bons_commande
  FOR EACH ROW EXECUTE FUNCTION com_bc_proteger();

CREATE OR REPLACE FUNCTION com_bc_lignes_proteger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s TEXT;
BEGIN
  SELECT statut INTO s FROM com_bons_commande WHERE id = COALESCE(NEW.bc_id, OLD.bc_id);
  IF s IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;   -- bon supprimé (brouillon / client)
  IF s <> 'brouillon' THEN
    RAISE EXCEPTION 'BC_INTANGIBLE: les lignes d''un bon de commande émis sont figées.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_com_bc_lignes_proteger ON com_bc_lignes;
CREATE TRIGGER trg_com_bc_lignes_proteger BEFORE INSERT OR UPDATE OR DELETE ON com_bc_lignes
  FOR EACH ROW EXECUTE FUNCTION com_bc_lignes_proteger();

-- ── Même client partout ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION com_meme_client_c() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ok BOOLEAN := true;
BEGIN
  IF TG_TABLE_NAME = 'com_bons_commande' THEN
    ok := EXISTS (SELECT 1 FROM com_demandes WHERE id = NEW.demande_id AND tenant_id = NEW.tenant_id)
      AND EXISTS (SELECT 1 FROM registre_tiers WHERE id = NEW.fournisseur_id AND tenant_id = NEW.tenant_id)
      AND EXISTS (SELECT 1 FROM com_magasins WHERE id = NEW.magasin_id AND tenant_id = NEW.tenant_id)
      AND (NEW.remplace_id IS NULL OR EXISTS (SELECT 1 FROM com_bons_commande WHERE id = NEW.remplace_id AND tenant_id = NEW.tenant_id));
  ELSIF TG_TABLE_NAME = 'com_bc_lignes' THEN
    ok := EXISTS (SELECT 1 FROM com_bons_commande WHERE id = NEW.bc_id AND tenant_id = NEW.tenant_id)
      AND EXISTS (SELECT 1 FROM com_demande_lignes WHERE id = NEW.demande_ligne_id AND tenant_id = NEW.tenant_id)
      AND (NEW.taxe_id IS NULL OR EXISTS (SELECT 1 FROM com_taxes WHERE id = NEW.taxe_id AND tenant_id = NEW.tenant_id));
  ELSIF TG_TABLE_NAME = 'com_documents' AND NEW.objet_type = 'bon_commande' THEN
    ok := EXISTS (SELECT 1 FROM com_bons_commande WHERE id = NEW.objet_id AND tenant_id = NEW.tenant_id);
  END IF;
  IF NOT ok THEN
    RAISE EXCEPTION 'Référence d''un autre client refusée (%).', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['com_bons_commande', 'com_bc_lignes'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_meme_client ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_meme_client BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION com_meme_client_c()', t, t);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS trg_com_documents_meme_client_c ON com_documents;
CREATE TRIGGER trg_com_documents_meme_client_c BEFORE INSERT OR UPDATE ON com_documents
  FOR EACH ROW EXECUTE FUNCTION com_meme_client_c();
