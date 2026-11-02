-- ============================================================================
-- 058 — NJ COMMERCIAL, lot 5 : documents d'achat.
--
--   • Réceptions sur bon de commande émis (partielles, plusieurs par bon), avec la
--     pièce de livraison du fournisseur (n° et date du BL) ; à la validation :
--     mouvements « réception » au prix net du bon (hors taxes), en unité de stock.
--   • Retours fournisseurs depuis une réception validée, au coût de la réception
--     d'origine (mouvement lié) ; jamais plus que le reçu non encore retourné.
--   • Factures fournisseurs rapprochées des réceptions (écarts de quantité et de
--     prix affichés, motif exigé au-delà de la tolérance) et avoirs limités à la
--     facture d'origine. Aucune écriture comptable ; règlements dans NJ CAISSE PRO.
--   • Circuit brouillon → à valider → validé → annulé (motivé), comme le stock ;
--     documents validés intangibles (déclencheurs) ; même client partout.
--   • Une permission par fonction.
--
--  PUREMENT ADDITIVE : aucune table existante n'est vidée ni modifiée dans ses données.
--  Idempotente. Retour arrière : migrations-retour-arriere/058_retour_arriere.sql
-- ============================================================================

-- ── Réceptions ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS com_receptions (
  id               BIGSERIAL     PRIMARY KEY,
  tenant_id        UUID          NOT NULL REFERENCES tenants(id),
  numero           TEXT          NOT NULL,
  bc_id            BIGINT        NOT NULL REFERENCES com_bons_commande(id),
  fournisseur_id   BIGINT        NOT NULL REFERENCES registre_tiers(id),
  magasin_id       BIGINT        NOT NULL REFERENCES com_magasins(id),
  date_reception   DATE          NOT NULL,
  bl_numero        TEXT          NOT NULL DEFAULT '' CHECK (length(bl_numero) <= 60),
  bl_date          DATE,
  statut           TEXT          NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'a_valider', 'valide', 'annule')),
  motif_ecart      TEXT          NOT NULL DEFAULT '' CHECK (length(motif_ecart) <= 500),
  observations     TEXT          NOT NULL DEFAULT '' CHECK (length(observations) <= 2000),
  cree_par         UUID          REFERENCES users(id) ON DELETE SET NULL,
  cree_le          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  modifie_le       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  soumis_le        TIMESTAMPTZ,
  motif_renvoi     TEXT          NOT NULL DEFAULT '' CHECK (length(motif_renvoi) <= 500),
  valide_par       UUID          REFERENCES users(id) ON DELETE SET NULL,
  valide_le        TIMESTAMPTZ,
  annule_par       UUID          REFERENCES users(id) ON DELETE SET NULL,
  annule_le        TIMESTAMPTZ,
  motif_annulation TEXT          NOT NULL DEFAULT '' CHECK (length(motif_annulation) <= 500)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_com_receptions_numero ON com_receptions (tenant_id, numero);
CREATE INDEX IF NOT EXISTS idx_com_receptions ON com_receptions (tenant_id, statut, cree_le DESC);
CREATE INDEX IF NOT EXISTS idx_com_receptions_bc ON com_receptions (bc_id);

CREATE TABLE IF NOT EXISTS com_reception_lignes (
  id             BIGSERIAL      PRIMARY KEY,
  reception_id   BIGINT         NOT NULL REFERENCES com_receptions(id) ON DELETE CASCADE,
  tenant_id      UUID           NOT NULL REFERENCES tenants(id),
  ordre          INTEGER        NOT NULL DEFAULT 0,
  bc_ligne_id    BIGINT         NOT NULL REFERENCES com_bc_lignes(id),
  article_id     BIGINT         NOT NULL REFERENCES com_articles(id),
  unite_id       BIGINT         REFERENCES com_unites(id),
  unite          TEXT           NOT NULL,
  coefficient    NUMERIC(18,6)  NOT NULL DEFAULT 1 CHECK (coefficient > 0),
  quantite       NUMERIC(18,3)  NOT NULL CHECK (quantite > 0),
  prix_net       NUMERIC(18,6)  NOT NULL CHECK (prix_net >= 0),      -- prix HT après remise, par unité du bon
  observation    TEXT           NOT NULL DEFAULT '' CHECK (length(observation) <= 500),
  UNIQUE (reception_id, bc_ligne_id)
);
CREATE INDEX IF NOT EXISTS idx_com_reception_lignes_bcl ON com_reception_lignes (bc_ligne_id);

-- ── Retours fournisseurs ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS com_retours_fournisseurs (
  id               BIGSERIAL     PRIMARY KEY,
  tenant_id        UUID          NOT NULL REFERENCES tenants(id),
  numero           TEXT          NOT NULL,
  reception_id     BIGINT        NOT NULL REFERENCES com_receptions(id),
  fournisseur_id   BIGINT        NOT NULL REFERENCES registre_tiers(id),
  magasin_id       BIGINT        NOT NULL REFERENCES com_magasins(id),
  date_retour      DATE          NOT NULL,
  motif            TEXT          NOT NULL DEFAULT '' CHECK (length(motif) <= 500),
  observations     TEXT          NOT NULL DEFAULT '' CHECK (length(observations) <= 2000),
  statut           TEXT          NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'a_valider', 'valide', 'annule')),
  cree_par         UUID          REFERENCES users(id) ON DELETE SET NULL,
  cree_le          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  modifie_le       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  soumis_le        TIMESTAMPTZ,
  motif_renvoi     TEXT          NOT NULL DEFAULT '' CHECK (length(motif_renvoi) <= 500),
  valide_par       UUID          REFERENCES users(id) ON DELETE SET NULL,
  valide_le        TIMESTAMPTZ,
  annule_par       UUID          REFERENCES users(id) ON DELETE SET NULL,
  annule_le        TIMESTAMPTZ,
  motif_annulation TEXT          NOT NULL DEFAULT '' CHECK (length(motif_annulation) <= 500)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_com_retours_fourn_numero ON com_retours_fournisseurs (tenant_id, numero);
CREATE INDEX IF NOT EXISTS idx_com_retours_fourn ON com_retours_fournisseurs (tenant_id, statut, cree_le DESC);

CREATE TABLE IF NOT EXISTS com_retour_fourn_lignes (
  id                  BIGSERIAL      PRIMARY KEY,
  retour_id           BIGINT         NOT NULL REFERENCES com_retours_fournisseurs(id) ON DELETE CASCADE,
  tenant_id           UUID           NOT NULL REFERENCES tenants(id),
  ordre               INTEGER        NOT NULL DEFAULT 0,
  reception_ligne_id  BIGINT         NOT NULL REFERENCES com_reception_lignes(id),
  article_id          BIGINT         NOT NULL REFERENCES com_articles(id),
  unite               TEXT           NOT NULL,
  coefficient         NUMERIC(18,6)  NOT NULL DEFAULT 1 CHECK (coefficient > 0),
  quantite            NUMERIC(18,3)  NOT NULL CHECK (quantite > 0),
  observation         TEXT           NOT NULL DEFAULT '' CHECK (length(observation) <= 500),
  UNIQUE (retour_id, reception_ligne_id)
);

-- ── Factures et avoirs fournisseurs ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS com_factures_fournisseurs (
  id                  BIGSERIAL     PRIMARY KEY,
  tenant_id           UUID          NOT NULL REFERENCES tenants(id),
  type                TEXT          NOT NULL CHECK (type IN ('facture', 'avoir')),
  numero              TEXT          NOT NULL,                      -- numéro interne FFO / AVF
  fournisseur_id      BIGINT        NOT NULL REFERENCES registre_tiers(id),
  reference_fournisseur TEXT        NOT NULL CHECK (length(reference_fournisseur) BETWEEN 1 AND 60),
  date_facture        DATE          NOT NULL,
  date_echeance       DATE,
  facture_origine_id  BIGINT        REFERENCES com_factures_fournisseurs(id),
  retour_id           BIGINT        REFERENCES com_retours_fournisseurs(id),
  devise              TEXT          NOT NULL DEFAULT 'FCFA',
  total_ht            NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_taxes         NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_ttc           NUMERIC(18,2) NOT NULL DEFAULT 0,
  statut              TEXT          NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'a_valider', 'valide', 'annule')),
  motif_ecart         TEXT          NOT NULL DEFAULT '' CHECK (length(motif_ecart) <= 500),
  observations        TEXT          NOT NULL DEFAULT '' CHECK (length(observations) <= 2000),
  cree_par            UUID          REFERENCES users(id) ON DELETE SET NULL,
  cree_le             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  modifie_le          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  soumis_le           TIMESTAMPTZ,
  motif_renvoi        TEXT          NOT NULL DEFAULT '' CHECK (length(motif_renvoi) <= 500),
  valide_par          UUID          REFERENCES users(id) ON DELETE SET NULL,
  valide_le           TIMESTAMPTZ,
  annule_par          UUID          REFERENCES users(id) ON DELETE SET NULL,
  annule_le           TIMESTAMPTZ,
  motif_annulation    TEXT          NOT NULL DEFAULT '' CHECK (length(motif_annulation) <= 500),
  CHECK ((type = 'avoir') = (facture_origine_id IS NOT NULL)),
  CHECK (date_echeance IS NULL OR date_echeance >= date_facture)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_com_ff_numero ON com_factures_fournisseurs (tenant_id, numero);
-- Une même pièce du fournisseur n'est enregistrée qu'une fois (hors pièces annulées).
CREATE UNIQUE INDEX IF NOT EXISTS uq_com_ff_reference ON com_factures_fournisseurs (tenant_id, fournisseur_id, type, upper(reference_fournisseur))
  WHERE statut <> 'annule';
CREATE INDEX IF NOT EXISTS idx_com_ff ON com_factures_fournisseurs (tenant_id, type, statut, cree_le DESC);

CREATE TABLE IF NOT EXISTS com_facture_fourn_lignes (
  id                   BIGSERIAL      PRIMARY KEY,
  facture_id           BIGINT         NOT NULL REFERENCES com_factures_fournisseurs(id) ON DELETE CASCADE,
  tenant_id            UUID           NOT NULL REFERENCES tenants(id),
  ordre                INTEGER        NOT NULL DEFAULT 0,
  reception_ligne_id   BIGINT         REFERENCES com_reception_lignes(id),        -- facture
  facture_ligne_origine_id BIGINT     REFERENCES com_facture_fourn_lignes(id),    -- avoir
  article_id           BIGINT         NOT NULL REFERENCES com_articles(id),
  designation          TEXT           NOT NULL,
  unite                TEXT           NOT NULL,
  quantite             NUMERIC(18,3)  NOT NULL CHECK (quantite > 0),
  prix_unitaire        NUMERIC(18,2)  NOT NULL CHECK (prix_unitaire >= 0),
  remise_pct           NUMERIC(5,2)   NOT NULL DEFAULT 0 CHECK (remise_pct BETWEEN 0 AND 100),
  taxe_id              BIGINT         REFERENCES com_taxes(id),
  taxe_code            TEXT           NOT NULL DEFAULT '',
  taxe_taux            NUMERIC(7,4)   NOT NULL DEFAULT 0 CHECK (taxe_taux BETWEEN 0 AND 100),
  montant_ht           NUMERIC(18,2)  NOT NULL DEFAULT 0,
  montant_taxe         NUMERIC(18,2)  NOT NULL DEFAULT 0,
  -- Rapprochement figé à la validation : ce qui était reçu et commandé ce jour-là.
  quantite_recue       NUMERIC(18,3),
  prix_commande        NUMERIC(18,6),
  CHECK ((reception_ligne_id IS NULL) <> (facture_ligne_origine_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_com_ffl_reception ON com_facture_fourn_lignes (reception_ligne_id);
CREATE INDEX IF NOT EXISTS idx_com_ffl_origine ON com_facture_fourn_lignes (facture_ligne_origine_id);

-- ── Protections : un document validé ne change plus (sauf annulation motivée) ──
CREATE OR REPLACE FUNCTION com_doc_achat_proteger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN RETURN OLD; END IF;
    IF OLD.statut <> 'brouillon' THEN RAISE EXCEPTION 'ACHAT_INTANGIBLE: seul un brouillon se supprime.'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.statut = 'annule' THEN RAISE EXCEPTION 'ACHAT_INTANGIBLE: document annulé.'; END IF;
  IF OLD.statut = 'valide' AND (NEW.statut <> 'annule' OR NEW.numero <> OLD.numero OR NEW.valide_le IS DISTINCT FROM OLD.valide_le
      OR length(NEW.motif_annulation) < 3) THEN
    RAISE EXCEPTION 'ACHAT_INTANGIBLE: un document validé ne s''annule qu''avec un motif.';
  END IF;
  RETURN NEW;
END $$;
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['com_receptions', 'com_retours_fournisseurs', 'com_factures_fournisseurs'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_proteger ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_proteger BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION com_doc_achat_proteger()', t, t);
  END LOOP;
END $$;

-- Lignes : modifiables seulement tant que le document est en brouillon ou à valider.
CREATE OR REPLACE FUNCTION com_lignes_achat_proteger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s TEXT;
BEGIN
  IF TG_TABLE_NAME = 'com_reception_lignes' THEN
    SELECT statut INTO s FROM com_receptions WHERE id = COALESCE(NEW.reception_id, OLD.reception_id);
  ELSIF TG_TABLE_NAME = 'com_retour_fourn_lignes' THEN
    SELECT statut INTO s FROM com_retours_fournisseurs WHERE id = COALESCE(NEW.retour_id, OLD.retour_id);
  ELSE
    SELECT statut INTO s FROM com_factures_fournisseurs WHERE id = COALESCE(NEW.facture_id, OLD.facture_id);
  END IF;
  IF s IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;           -- document supprimé (brouillon / client)
  IF s NOT IN ('brouillon', 'a_valider') THEN
    RAISE EXCEPTION 'ACHAT_INTANGIBLE: les lignes d''un document validé sont figées.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['com_reception_lignes', 'com_retour_fourn_lignes', 'com_facture_fourn_lignes'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_proteger ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_proteger BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION com_lignes_achat_proteger()', t, t);
  END LOOP;
END $$;

-- ── Pièces jointes, numérotation ────────────────────────────────────────────
ALTER TABLE com_documents DROP CONSTRAINT IF EXISTS com_documents_objet_type_check;
ALTER TABLE com_documents ADD CONSTRAINT com_documents_objet_type_check
  CHECK (objet_type IN ('demande', 'bon_commande', 'stock_doc', 'reception', 'retour_fourn', 'facture_fourn'));
ALTER TABLE com_compteurs DROP CONSTRAINT IF EXISTS com_compteurs_type_check;
ALTER TABLE com_compteurs ADD CONSTRAINT com_compteurs_type_check
  CHECK (type IN ('DA', 'BC', 'ENT', 'SOR', 'TRF', 'INV', 'REC', 'RFO', 'FFO', 'AVF'));

-- ── Même client partout (fonction 056 complétée) ────────────────────────────
CREATE OR REPLACE FUNCTION com_meme_client_f() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ok BOOLEAN := true;
BEGIN
  IF TG_TABLE_NAME = 'com_stock_documents' THEN
    ok := EXISTS (SELECT 1 FROM com_magasins WHERE id = NEW.magasin_id AND tenant_id = NEW.tenant_id)
      AND (NEW.magasin_dest_id IS NULL OR EXISTS (SELECT 1 FROM com_magasins WHERE id = NEW.magasin_dest_id AND tenant_id = NEW.tenant_id));
  ELSIF TG_TABLE_NAME = 'com_stock_doc_lignes' THEN
    ok := EXISTS (SELECT 1 FROM com_stock_documents WHERE id = NEW.document_id AND tenant_id = NEW.tenant_id)
      AND EXISTS (SELECT 1 FROM com_articles WHERE id = NEW.article_id AND tenant_id = NEW.tenant_id)
      AND (NEW.unite_id IS NULL OR EXISTS (SELECT 1 FROM com_unites WHERE id = NEW.unite_id AND tenant_id = NEW.tenant_id));
  ELSIF TG_TABLE_NAME = 'com_documents' THEN
    ok := CASE NEW.objet_type
      WHEN 'stock_doc' THEN EXISTS (SELECT 1 FROM com_stock_documents WHERE id = NEW.objet_id AND tenant_id = NEW.tenant_id)
      WHEN 'reception' THEN EXISTS (SELECT 1 FROM com_receptions WHERE id = NEW.objet_id AND tenant_id = NEW.tenant_id)
      WHEN 'retour_fourn' THEN EXISTS (SELECT 1 FROM com_retours_fournisseurs WHERE id = NEW.objet_id AND tenant_id = NEW.tenant_id)
      WHEN 'facture_fourn' THEN EXISTS (SELECT 1 FROM com_factures_fournisseurs WHERE id = NEW.objet_id AND tenant_id = NEW.tenant_id)
      ELSE true END;
  ELSIF TG_TABLE_NAME IN ('com_stock_soldes', 'com_stock_lots') THEN
    ok := EXISTS (SELECT 1 FROM com_articles WHERE id = NEW.article_id AND tenant_id = NEW.tenant_id)
      AND EXISTS (SELECT 1 FROM com_magasins WHERE id = NEW.magasin_id AND tenant_id = NEW.tenant_id);
  ELSIF TG_TABLE_NAME = 'com_receptions' THEN
    ok := EXISTS (SELECT 1 FROM com_bons_commande WHERE id = NEW.bc_id AND tenant_id = NEW.tenant_id)
      AND EXISTS (SELECT 1 FROM com_magasins WHERE id = NEW.magasin_id AND tenant_id = NEW.tenant_id)
      AND EXISTS (SELECT 1 FROM registre_tiers WHERE id = NEW.fournisseur_id AND tenant_id = NEW.tenant_id);
  ELSIF TG_TABLE_NAME = 'com_reception_lignes' THEN
    ok := EXISTS (SELECT 1 FROM com_receptions WHERE id = NEW.reception_id AND tenant_id = NEW.tenant_id)
      AND EXISTS (SELECT 1 FROM com_bc_lignes WHERE id = NEW.bc_ligne_id AND tenant_id = NEW.tenant_id)
      AND EXISTS (SELECT 1 FROM com_articles WHERE id = NEW.article_id AND tenant_id = NEW.tenant_id);
  ELSIF TG_TABLE_NAME = 'com_retours_fournisseurs' THEN
    ok := EXISTS (SELECT 1 FROM com_receptions WHERE id = NEW.reception_id AND tenant_id = NEW.tenant_id)
      AND EXISTS (SELECT 1 FROM com_magasins WHERE id = NEW.magasin_id AND tenant_id = NEW.tenant_id);
  ELSIF TG_TABLE_NAME = 'com_retour_fourn_lignes' THEN
    ok := EXISTS (SELECT 1 FROM com_retours_fournisseurs WHERE id = NEW.retour_id AND tenant_id = NEW.tenant_id)
      AND EXISTS (SELECT 1 FROM com_reception_lignes WHERE id = NEW.reception_ligne_id AND tenant_id = NEW.tenant_id);
  ELSIF TG_TABLE_NAME = 'com_factures_fournisseurs' THEN
    ok := EXISTS (SELECT 1 FROM registre_tiers WHERE id = NEW.fournisseur_id AND tenant_id = NEW.tenant_id)
      AND (NEW.facture_origine_id IS NULL OR EXISTS (SELECT 1 FROM com_factures_fournisseurs WHERE id = NEW.facture_origine_id AND tenant_id = NEW.tenant_id))
      AND (NEW.retour_id IS NULL OR EXISTS (SELECT 1 FROM com_retours_fournisseurs WHERE id = NEW.retour_id AND tenant_id = NEW.tenant_id));
  ELSIF TG_TABLE_NAME = 'com_facture_fourn_lignes' THEN
    ok := EXISTS (SELECT 1 FROM com_factures_fournisseurs WHERE id = NEW.facture_id AND tenant_id = NEW.tenant_id)
      AND EXISTS (SELECT 1 FROM com_articles WHERE id = NEW.article_id AND tenant_id = NEW.tenant_id)
      AND (NEW.reception_ligne_id IS NULL OR EXISTS (SELECT 1 FROM com_reception_lignes WHERE id = NEW.reception_ligne_id AND tenant_id = NEW.tenant_id))
      AND (NEW.taxe_id IS NULL OR EXISTS (SELECT 1 FROM com_taxes WHERE id = NEW.taxe_id AND tenant_id = NEW.tenant_id));
  END IF;
  IF NOT ok THEN
    RAISE EXCEPTION 'Référence d''un autre client refusée (%).', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['com_receptions', 'com_reception_lignes', 'com_retours_fournisseurs', 'com_retour_fourn_lignes',
                           'com_factures_fournisseurs', 'com_facture_fourn_lignes'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_meme_client_f ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_meme_client_f BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION com_meme_client_f()', t, t);
  END LOOP;
END $$;

-- ── Permissions : une par fonction ─────────────────────────────────────────
INSERT INTO permissions (code, nom, module, description) VALUES
  ('com.receptions.saisir',    'Saisir les réceptions',                      'commercial', 'Réception sur bon de commande émis, avec le bon de livraison du fournisseur'),
  ('com.receptions.valider',   'Valider ou renvoyer les réceptions',         'commercial', 'La validation fait entrer la marchandise en stock ; jamais par l''auteur'),
  ('com.receptions.annuler',   'Annuler les réceptions validées',            'commercial', 'Annulation motivée : mouvements conservés, valorisation recalculée'),
  ('com.retours_fourn.saisir', 'Saisir les retours fournisseurs',            'commercial', 'Retour de marchandise reçue, au coût de la réception d''origine'),
  ('com.retours_fourn.valider','Valider ou renvoyer les retours fournisseurs','commercial', 'La validation fait sortir la marchandise du stock'),
  ('com.factures_fourn.voir',  'Consulter les factures fournisseurs',        'commercial', 'Factures, avoirs et rapprochement commande, réception, facture'),
  ('com.factures_fourn.saisir','Saisir les factures et avoirs fournisseurs', 'commercial', 'Depuis les réceptions validées ; avoir limité à la facture d''origine'),
  ('com.factures_fourn.valider','Valider ou renvoyer les factures fournisseurs','commercial', 'Bon à payer ; écarts au-delà de la tolérance motivés'),
  ('com.factures_fourn.annuler','Annuler les factures et avoirs validés',    'commercial', 'Annulation motivée, tracée')
ON CONFLICT (code) DO NOTHING;

-- Directeur (rôle système) : tout le module.
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE r.code = 'directeur' AND r.tenant_id IS NULL AND r.is_system
   AND (p.code LIKE 'com.receptions.%' OR p.code LIKE 'com.retours_fourn.%' OR p.code LIKE 'com.factures_fourn.%')
ON CONFLICT DO NOTHING;

-- Profils existants des clients où NJ COMMERCIAL est activé (mêmes règles qu'à l'activation).
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, c FROM roles r CROSS JOIN LATERAL unnest(CASE r.code
    WHEN 'stock_magasinier'    THEN ARRAY['com.receptions.saisir', 'com.retours_fourn.saisir']
    WHEN 'stock_gestionnaire'  THEN ARRAY['com.receptions.saisir', 'com.receptions.valider', 'com.receptions.annuler',
                                          'com.retours_fourn.saisir', 'com.retours_fourn.valider']
    WHEN 'achats_gestionnaire' THEN ARRAY['com.receptions.saisir', 'com.retours_fourn.saisir', 'com.factures_fourn.voir', 'com.factures_fourn.saisir']
    WHEN 'achats_responsable'  THEN ARRAY['com.receptions.valider', 'com.receptions.annuler', 'com.retours_fourn.valider',
                                          'com.factures_fourn.voir', 'com.factures_fourn.valider', 'com.factures_fourn.annuler']
    ELSE ARRAY[]::TEXT[] END) c
 WHERE r.tenant_id IS NOT NULL AND r.code IN ('stock_magasinier', 'stock_gestionnaire', 'achats_gestionnaire', 'achats_responsable')
ON CONFLICT DO NOTHING;

-- Plafond éventuel des clients qui ont déjà des droits NJ COMMERCIAL.
INSERT INTO tenant_permissions (tenant_id, permission_code)
SELECT DISTINCT tp.tenant_id, p.code FROM tenant_permissions tp JOIN permissions pc ON pc.code = tp.permission_code AND pc.module = 'commercial'
 CROSS JOIN permissions p WHERE p.code LIKE 'com.receptions.%' OR p.code LIKE 'com.retours_fourn.%' OR p.code LIKE 'com.factures_fourn.%'
ON CONFLICT DO NOTHING;
