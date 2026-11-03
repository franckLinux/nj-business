-- ============================================================================
-- 059 — NJ COMMERCIAL, lot 6 : ventes.
--
--   • Devis : saisi par le commercial ; validé par le responsable commercial, puis
--     par le directeur au-delà du seuil des ventes ou si une remise dépasse le
--     plafond ; PDF « bon pour accord » avec date de validité ; accepté ou refusé
--     par le client.
--   • Commande client : née d'un devis accepté (référence et pièce du client).
--   • Préparation et livraison : un document par expédition (partielle possible) ;
--     préparé, puis validé par une autre personne ; la validation fait sortir le
--     stock (mouvement « livraison », coût CMUP ou FIFO) ; bon de livraison PDF.
--   • Aucune écriture comptable ; la facturation viendra au lot 7.
--
--  PUREMENT ADDITIVE. Idempotente. Retour arrière : migrations-retour-arriere/059_retour_arriere.sql
-- ============================================================================

-- ── Paramètres des ventes (décision 8 : 1 000 000 FCFA et 10 % par défaut) ──
ALTER TABLE com_parametres ADD COLUMN IF NOT EXISTS ventes_seuil_direction NUMERIC(18,2) DEFAULT 1000000;
ALTER TABLE com_parametres ADD COLUMN IF NOT EXISTS ventes_remise_max_pct NUMERIC(5,2) NOT NULL DEFAULT 10;
ALTER TABLE com_parametres ADD COLUMN IF NOT EXISTS devis_validite_jours INTEGER NOT NULL DEFAULT 30;

-- ── Devis ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS com_devis (
  id                 BIGSERIAL     PRIMARY KEY,
  tenant_id          UUID          NOT NULL REFERENCES tenants(id),
  numero             TEXT          NOT NULL,
  client_id          BIGINT        NOT NULL REFERENCES registre_tiers(id),
  date_devis         DATE          NOT NULL,
  date_validite      DATE          NOT NULL,
  objet              TEXT          NOT NULL DEFAULT '' CHECK (length(objet) <= 300),
  conditions_paiement TEXT         NOT NULL DEFAULT '' CHECK (length(conditions_paiement) <= 300),
  delai_livraison    TEXT          NOT NULL DEFAULT '' CHECK (length(delai_livraison) <= 200),
  observations       TEXT          NOT NULL DEFAULT '' CHECK (length(observations) <= 2000),
  devise             TEXT          NOT NULL DEFAULT 'FCFA',
  total_brut         NUMERIC(18,2) NOT NULL DEFAULT 0,      -- avant remises
  total_ht           NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_taxes        NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_ttc          NUMERIC(18,2) NOT NULL DEFAULT 0,
  niveau             TEXT          NOT NULL DEFAULT 'responsable' CHECK (niveau IN ('responsable', 'direction')),
  motif_direction    TEXT          NOT NULL DEFAULT '',
  statut             TEXT          NOT NULL DEFAULT 'brouillon'
                     CHECK (statut IN ('brouillon', 'a_valider', 'a_valider_direction', 'valide', 'accepte', 'refuse', 'annule')),
  cree_par           UUID          REFERENCES users(id) ON DELETE SET NULL,
  cree_le            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  modifie_le         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  soumis_le          TIMESTAMPTZ,
  motif_renvoi       TEXT          NOT NULL DEFAULT '' CHECK (length(motif_renvoi) <= 500),
  valide_resp_par    UUID          REFERENCES users(id) ON DELETE SET NULL,
  valide_resp_le     TIMESTAMPTZ,
  valide_dir_par     UUID          REFERENCES users(id) ON DELETE SET NULL,
  valide_dir_le      TIMESTAMPTZ,
  decision_par       UUID          REFERENCES users(id) ON DELETE SET NULL,
  decision_le        TIMESTAMPTZ,
  motif_refus        TEXT          NOT NULL DEFAULT '' CHECK (length(motif_refus) <= 500),
  annule_par         UUID          REFERENCES users(id) ON DELETE SET NULL,
  annule_le          TIMESTAMPTZ,
  motif_annulation   TEXT          NOT NULL DEFAULT '' CHECK (length(motif_annulation) <= 500),
  CHECK (date_validite >= date_devis)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_com_devis_numero ON com_devis (tenant_id, numero);
CREATE INDEX IF NOT EXISTS idx_com_devis ON com_devis (tenant_id, statut, cree_le DESC);

CREATE TABLE IF NOT EXISTS com_devis_lignes (
  id             BIGSERIAL      PRIMARY KEY,
  devis_id       BIGINT         NOT NULL REFERENCES com_devis(id) ON DELETE CASCADE,
  tenant_id      UUID           NOT NULL REFERENCES tenants(id),
  ordre          INTEGER        NOT NULL DEFAULT 0,
  article_id     BIGINT         NOT NULL REFERENCES com_articles(id),
  reference      TEXT           NOT NULL,
  designation    TEXT           NOT NULL,
  unite_id       BIGINT         REFERENCES com_unites(id),
  unite          TEXT           NOT NULL,
  coefficient    NUMERIC(18,6)  NOT NULL DEFAULT 1 CHECK (coefficient > 0),
  quantite       NUMERIC(18,3)  NOT NULL CHECK (quantite > 0),
  prix_unitaire  NUMERIC(18,2)  NOT NULL CHECK (prix_unitaire >= 0),
  remise_pct     NUMERIC(5,2)   NOT NULL DEFAULT 0 CHECK (remise_pct BETWEEN 0 AND 100),
  taxe_id        BIGINT         REFERENCES com_taxes(id),
  taxe_code      TEXT           NOT NULL DEFAULT '',
  taxe_taux      NUMERIC(7,4)   NOT NULL DEFAULT 0 CHECK (taxe_taux BETWEEN 0 AND 100),
  montant_ht     NUMERIC(18,2)  NOT NULL DEFAULT 0,
  montant_taxe   NUMERIC(18,2)  NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_com_devis_lignes ON com_devis_lignes (devis_id);

-- ── Commandes clients ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS com_commandes_clients (
  id                 BIGSERIAL     PRIMARY KEY,
  tenant_id          UUID          NOT NULL REFERENCES tenants(id),
  numero             TEXT          NOT NULL,
  devis_id           BIGINT        NOT NULL REFERENCES com_devis(id),
  client_id          BIGINT        NOT NULL REFERENCES registre_tiers(id),
  reference_client   TEXT          NOT NULL DEFAULT '' CHECK (length(reference_client) <= 60),
  date_commande      DATE          NOT NULL,
  date_livraison_souhaitee DATE,
  adresse_livraison  TEXT          NOT NULL DEFAULT '' CHECK (length(adresse_livraison) <= 300),
  observations       TEXT          NOT NULL DEFAULT '' CHECK (length(observations) <= 2000),
  devise             TEXT          NOT NULL DEFAULT 'FCFA',
  total_ht           NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_taxes        NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_ttc          NUMERIC(18,2) NOT NULL DEFAULT 0,
  statut             TEXT          NOT NULL DEFAULT 'ouverte' CHECK (statut IN ('ouverte', 'annulee')),
  cree_par           UUID          REFERENCES users(id) ON DELETE SET NULL,
  cree_le            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  annule_par         UUID          REFERENCES users(id) ON DELETE SET NULL,
  annule_le          TIMESTAMPTZ,
  motif_annulation   TEXT          NOT NULL DEFAULT '' CHECK (length(motif_annulation) <= 500)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_com_cdc_numero ON com_commandes_clients (tenant_id, numero);
-- Un devis donne au plus une commande (hors commande annulée).
CREATE UNIQUE INDEX IF NOT EXISTS uq_com_cdc_devis ON com_commandes_clients (devis_id) WHERE statut <> 'annulee';
CREATE INDEX IF NOT EXISTS idx_com_cdc ON com_commandes_clients (tenant_id, statut, cree_le DESC);

CREATE TABLE IF NOT EXISTS com_commande_client_lignes (
  id             BIGSERIAL      PRIMARY KEY,
  commande_id    BIGINT         NOT NULL REFERENCES com_commandes_clients(id) ON DELETE CASCADE,
  tenant_id      UUID           NOT NULL REFERENCES tenants(id),
  ordre          INTEGER        NOT NULL DEFAULT 0,
  devis_ligne_id BIGINT         NOT NULL REFERENCES com_devis_lignes(id),
  article_id     BIGINT         NOT NULL REFERENCES com_articles(id),
  reference      TEXT           NOT NULL,
  designation    TEXT           NOT NULL,
  unite_id       BIGINT         REFERENCES com_unites(id),
  unite          TEXT           NOT NULL,
  coefficient    NUMERIC(18,6)  NOT NULL DEFAULT 1 CHECK (coefficient > 0),
  quantite       NUMERIC(18,3)  NOT NULL CHECK (quantite > 0),
  prix_unitaire  NUMERIC(18,2)  NOT NULL,
  remise_pct     NUMERIC(5,2)   NOT NULL DEFAULT 0,
  taxe_id        BIGINT         REFERENCES com_taxes(id),
  taxe_code      TEXT           NOT NULL DEFAULT '',
  taxe_taux      NUMERIC(7,4)   NOT NULL DEFAULT 0,
  montant_ht     NUMERIC(18,2)  NOT NULL DEFAULT 0,
  montant_taxe   NUMERIC(18,2)  NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_com_cdcl ON com_commande_client_lignes (commande_id);

-- ── Préparations et livraisons ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS com_livraisons (
  id                 BIGSERIAL     PRIMARY KEY,
  tenant_id          UUID          NOT NULL REFERENCES tenants(id),
  numero             TEXT          NOT NULL,
  commande_id        BIGINT        NOT NULL REFERENCES com_commandes_clients(id),
  client_id          BIGINT        NOT NULL REFERENCES registre_tiers(id),
  magasin_id         BIGINT        NOT NULL REFERENCES com_magasins(id),
  date_livraison     DATE          NOT NULL,
  adresse_livraison  TEXT          NOT NULL DEFAULT '' CHECK (length(adresse_livraison) <= 300),
  transporteur       TEXT          NOT NULL DEFAULT '' CHECK (length(transporteur) <= 150),
  observations       TEXT          NOT NULL DEFAULT '' CHECK (length(observations) <= 2000),
  statut             TEXT          NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'preparee', 'livree', 'annule')),
  cree_par           UUID          REFERENCES users(id) ON DELETE SET NULL,
  cree_le            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  modifie_le         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  prepare_par        UUID          REFERENCES users(id) ON DELETE SET NULL,
  prepare_le         TIMESTAMPTZ,
  motif_renvoi       TEXT          NOT NULL DEFAULT '' CHECK (length(motif_renvoi) <= 500),
  livre_par          UUID          REFERENCES users(id) ON DELETE SET NULL,
  livre_le           TIMESTAMPTZ,
  annule_par         UUID          REFERENCES users(id) ON DELETE SET NULL,
  annule_le          TIMESTAMPTZ,
  motif_annulation   TEXT          NOT NULL DEFAULT '' CHECK (length(motif_annulation) <= 500)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_com_livraisons_numero ON com_livraisons (tenant_id, numero);
CREATE INDEX IF NOT EXISTS idx_com_livraisons ON com_livraisons (tenant_id, statut, cree_le DESC);
CREATE INDEX IF NOT EXISTS idx_com_livraisons_cdc ON com_livraisons (commande_id);

CREATE TABLE IF NOT EXISTS com_livraison_lignes (
  id                 BIGSERIAL      PRIMARY KEY,
  livraison_id       BIGINT         NOT NULL REFERENCES com_livraisons(id) ON DELETE CASCADE,
  tenant_id          UUID           NOT NULL REFERENCES tenants(id),
  ordre              INTEGER        NOT NULL DEFAULT 0,
  commande_ligne_id  BIGINT         NOT NULL REFERENCES com_commande_client_lignes(id),
  article_id         BIGINT         NOT NULL REFERENCES com_articles(id),
  unite              TEXT           NOT NULL,
  coefficient        NUMERIC(18,6)  NOT NULL DEFAULT 1 CHECK (coefficient > 0),
  quantite           NUMERIC(18,3)  NOT NULL CHECK (quantite > 0),
  observation        TEXT           NOT NULL DEFAULT '' CHECK (length(observation) <= 500),
  UNIQUE (livraison_id, commande_ligne_id)
);
CREATE INDEX IF NOT EXISTS idx_com_livl_cdcl ON com_livraison_lignes (commande_ligne_id);

-- ── Protections ─────────────────────────────────────────────────────────────
-- Devis : contenu figé dès la soumission ; ne change ensuite que de statut.
CREATE OR REPLACE FUNCTION com_devis_proteger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN RETURN OLD; END IF;
    IF OLD.statut <> 'brouillon' THEN RAISE EXCEPTION 'VENTE_INTANGIBLE: seul un brouillon se supprime ; un devis soumis s''annule.'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.statut IN ('annule', 'refuse', 'accepte') AND NEW.statut = OLD.statut THEN
    RAISE EXCEPTION 'VENTE_INTANGIBLE: devis clos.';
  END IF;
  IF OLD.statut <> 'brouillon' AND NEW.statut <> 'brouillon' AND (NEW.numero <> OLD.numero OR NEW.client_id <> OLD.client_id
      OR NEW.total_ttc <> OLD.total_ttc OR NEW.date_devis <> OLD.date_devis OR NEW.date_validite <> OLD.date_validite) THEN
    RAISE EXCEPTION 'VENTE_INTANGIBLE: un devis soumis ne se modifie plus.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_com_devis_proteger ON com_devis;
CREATE TRIGGER trg_com_devis_proteger BEFORE UPDATE OR DELETE ON com_devis FOR EACH ROW EXECUTE FUNCTION com_devis_proteger();

-- Commande : seule l'annulation (motivée) change une commande ; jamais supprimée.
CREATE OR REPLACE FUNCTION com_cdc_proteger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'VENTE_INTANGIBLE: une commande client ne se supprime pas, elle s''annule.';
  END IF;
  IF OLD.statut = 'annulee' THEN RAISE EXCEPTION 'VENTE_INTANGIBLE: commande annulée.'; END IF;
  IF NEW.numero <> OLD.numero OR NEW.devis_id <> OLD.devis_id OR NEW.client_id <> OLD.client_id OR NEW.total_ttc <> OLD.total_ttc
     OR (NEW.statut = 'annulee' AND length(NEW.motif_annulation) < 3) THEN
    RAISE EXCEPTION 'VENTE_INTANGIBLE: une commande client ne se modifie pas.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_com_cdc_proteger ON com_commandes_clients;
CREATE TRIGGER trg_com_cdc_proteger BEFORE UPDATE OR DELETE ON com_commandes_clients FOR EACH ROW EXECUTE FUNCTION com_cdc_proteger();

-- Livraison : livrée = intangible, sauf annulation motivée.
CREATE OR REPLACE FUNCTION com_livraison_proteger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN RETURN OLD; END IF;
    IF OLD.statut <> 'brouillon' THEN RAISE EXCEPTION 'VENTE_INTANGIBLE: seul un brouillon se supprime.'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.statut = 'annule' THEN RAISE EXCEPTION 'VENTE_INTANGIBLE: livraison annulée.'; END IF;
  IF OLD.statut = 'livree' AND (NEW.statut <> 'annule' OR NEW.numero <> OLD.numero OR NEW.livre_le IS DISTINCT FROM OLD.livre_le
      OR length(NEW.motif_annulation) < 3) THEN
    RAISE EXCEPTION 'VENTE_INTANGIBLE: une livraison validée ne s''annule qu''avec un motif.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_com_livraison_proteger ON com_livraisons;
CREATE TRIGGER trg_com_livraison_proteger BEFORE UPDATE OR DELETE ON com_livraisons FOR EACH ROW EXECUTE FUNCTION com_livraison_proteger();

-- Lignes : devis en brouillon, commande jamais (copie figée), livraison avant validation.
CREATE OR REPLACE FUNCTION com_lignes_vente_proteger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s TEXT;
BEGIN
  IF TG_TABLE_NAME = 'com_devis_lignes' THEN
    SELECT statut INTO s FROM com_devis WHERE id = COALESCE(NEW.devis_id, OLD.devis_id);
    IF s IS NOT NULL AND s <> 'brouillon' THEN RAISE EXCEPTION 'VENTE_INTANGIBLE: les lignes d''un devis soumis sont figées.'; END IF;
  ELSIF TG_TABLE_NAME = 'com_commande_client_lignes' THEN
    IF TG_OP <> 'INSERT' AND EXISTS (SELECT 1 FROM com_commandes_clients WHERE id = OLD.commande_id) THEN
      RAISE EXCEPTION 'VENTE_INTANGIBLE: les lignes d''une commande client sont figées.';
    END IF;
  ELSE
    SELECT statut INTO s FROM com_livraisons WHERE id = COALESCE(NEW.livraison_id, OLD.livraison_id);
    IF s IS NOT NULL AND s NOT IN ('brouillon', 'preparee') THEN RAISE EXCEPTION 'VENTE_INTANGIBLE: les lignes d''une livraison validée sont figées.'; END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['com_devis_lignes', 'com_commande_client_lignes', 'com_livraison_lignes'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_proteger ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_proteger BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION com_lignes_vente_proteger()', t, t);
  END LOOP;
END $$;

-- ── Pièces, numérotation ────────────────────────────────────────────────────
ALTER TABLE com_documents DROP CONSTRAINT IF EXISTS com_documents_objet_type_check;
ALTER TABLE com_documents ADD CONSTRAINT com_documents_objet_type_check
  CHECK (objet_type IN ('demande', 'bon_commande', 'stock_doc', 'reception', 'retour_fourn', 'facture_fourn', 'devis', 'commande_client', 'livraison'));
ALTER TABLE com_compteurs DROP CONSTRAINT IF EXISTS com_compteurs_type_check;
ALTER TABLE com_compteurs ADD CONSTRAINT com_compteurs_type_check
  CHECK (type IN ('DA', 'BC', 'ENT', 'SOR', 'TRF', 'INV', 'REC', 'RFO', 'FFO', 'AVF', 'DEV', 'CDC', 'BLC'));

-- ── Même client partout ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION com_meme_client_ventes() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ok BOOLEAN := true;
BEGIN
  IF TG_TABLE_NAME = 'com_devis' THEN
    ok := EXISTS (SELECT 1 FROM registre_tiers WHERE id = NEW.client_id AND tenant_id = NEW.tenant_id);
  ELSIF TG_TABLE_NAME = 'com_devis_lignes' THEN
    ok := EXISTS (SELECT 1 FROM com_devis WHERE id = NEW.devis_id AND tenant_id = NEW.tenant_id)
      AND EXISTS (SELECT 1 FROM com_articles WHERE id = NEW.article_id AND tenant_id = NEW.tenant_id)
      AND (NEW.taxe_id IS NULL OR EXISTS (SELECT 1 FROM com_taxes WHERE id = NEW.taxe_id AND tenant_id = NEW.tenant_id))
      AND (NEW.unite_id IS NULL OR EXISTS (SELECT 1 FROM com_unites WHERE id = NEW.unite_id AND tenant_id = NEW.tenant_id));
  ELSIF TG_TABLE_NAME = 'com_commandes_clients' THEN
    ok := EXISTS (SELECT 1 FROM com_devis WHERE id = NEW.devis_id AND tenant_id = NEW.tenant_id AND client_id = NEW.client_id);
  ELSIF TG_TABLE_NAME = 'com_commande_client_lignes' THEN
    ok := EXISTS (SELECT 1 FROM com_commandes_clients WHERE id = NEW.commande_id AND tenant_id = NEW.tenant_id)
      AND EXISTS (SELECT 1 FROM com_devis_lignes WHERE id = NEW.devis_ligne_id AND tenant_id = NEW.tenant_id);
  ELSIF TG_TABLE_NAME = 'com_livraisons' THEN
    ok := EXISTS (SELECT 1 FROM com_commandes_clients WHERE id = NEW.commande_id AND tenant_id = NEW.tenant_id AND client_id = NEW.client_id)
      AND EXISTS (SELECT 1 FROM com_magasins WHERE id = NEW.magasin_id AND tenant_id = NEW.tenant_id);
  ELSIF TG_TABLE_NAME = 'com_livraison_lignes' THEN
    ok := EXISTS (SELECT 1 FROM com_livraisons WHERE id = NEW.livraison_id AND tenant_id = NEW.tenant_id)
      AND EXISTS (SELECT 1 FROM com_commande_client_lignes WHERE id = NEW.commande_ligne_id AND tenant_id = NEW.tenant_id);
  ELSIF TG_TABLE_NAME = 'com_documents' THEN
    ok := CASE NEW.objet_type
      WHEN 'devis' THEN EXISTS (SELECT 1 FROM com_devis WHERE id = NEW.objet_id AND tenant_id = NEW.tenant_id)
      WHEN 'commande_client' THEN EXISTS (SELECT 1 FROM com_commandes_clients WHERE id = NEW.objet_id AND tenant_id = NEW.tenant_id)
      WHEN 'livraison' THEN EXISTS (SELECT 1 FROM com_livraisons WHERE id = NEW.objet_id AND tenant_id = NEW.tenant_id)
      ELSE true END;
  END IF;
  IF NOT ok THEN
    RAISE EXCEPTION 'Référence d''un autre client refusée (%).', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['com_devis', 'com_devis_lignes', 'com_commandes_clients', 'com_commande_client_lignes', 'com_livraisons',
                           'com_livraison_lignes', 'com_documents'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_meme_client_v ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_meme_client_v BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION com_meme_client_ventes()', t, t);
  END LOOP;
END $$;

-- ── Permissions : une par fonction ─────────────────────────────────────────
INSERT INTO permissions (code, nom, module, description) VALUES
  ('com.ventes.voir',             'Consulter les ventes',                       'commercial', 'Devis, commandes clients et livraisons'),
  ('com.ventes.devis',            'Saisir les devis',                           'commercial', 'Devis et proformas ; soumission pour validation'),
  ('com.ventes.valider',          'Valider les devis (responsable commercial)', 'commercial', 'Première validation de tout devis ; jamais par son auteur'),
  ('com.ventes.valider_direction','Valider les devis (direction)',              'commercial', 'Au-delà du seuil des ventes ou si une remise dépasse le plafond'),
  ('com.ventes.commandes',        'Enregistrer les commandes clients',          'commercial', 'Acceptation ou refus du devis par le client, référence et pièce du client'),
  ('com.ventes.preparer',         'Préparer les livraisons',                    'commercial', 'Bon de préparation : quantités prélevées au magasin'),
  ('com.ventes.livrer',           'Valider les livraisons',                     'commercial', 'La validation fait sortir le stock ; jamais par le préparateur'),
  ('com.ventes.annuler',          'Annuler devis, commandes et livraisons',     'commercial', 'Annulation motivée ; une livraison annulée rentre en stock')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE r.code = 'directeur' AND r.tenant_id IS NULL AND r.is_system AND p.code LIKE 'com.ventes.%'
ON CONFLICT DO NOTHING;

-- Profils existants (clients où NJ COMMERCIAL est activé) et nouveaux profils des ventes.
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, c FROM roles r CROSS JOIN LATERAL unnest(CASE r.code
    WHEN 'stock_magasinier'   THEN ARRAY['com.ventes.voir', 'com.ventes.preparer']
    WHEN 'stock_gestionnaire' THEN ARRAY['com.ventes.voir', 'com.ventes.preparer', 'com.ventes.livrer']
    ELSE ARRAY[]::TEXT[] END) c
 WHERE r.tenant_id IS NOT NULL AND r.code IN ('stock_magasinier', 'stock_gestionnaire')
ON CONFLICT DO NOTHING;
DO $$
DECLARE t UUID; rid BIGINT;
BEGIN
  IF to_regclass('public.tenant_modules') IS NULL THEN RETURN; END IF;
  FOR t IN SELECT tenant_id FROM tenant_modules WHERE module_code = 'commercial' AND actif LOOP
    IF NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id = t AND code = 'ventes_commercial') THEN
      INSERT INTO roles (nom, code, description, couleur, tenant_id, is_system)
      VALUES ('Commercial (ventes)', 'ventes_commercial', 'Établit les devis et enregistre les commandes des clients', '#0891b2', t, false) RETURNING id INTO rid;
      INSERT INTO role_permissions (role_id, permission_code)
      SELECT rid, c FROM unnest(ARRAY['com.articles.voir', 'com.tiers.voir', 'com.stock.voir', 'com.ventes.voir', 'com.ventes.devis', 'com.ventes.commandes']) c
      ON CONFLICT DO NOTHING;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id = t AND code = 'ventes_responsable') THEN
      INSERT INTO roles (nom, code, description, couleur, tenant_id, is_system)
      VALUES ('Responsable commercial', 'ventes_responsable', 'Valide les devis, suit les commandes et livraisons, annule', '#0e7490', t, false) RETURNING id INTO rid;
      INSERT INTO role_permissions (role_id, permission_code)
      SELECT rid, c FROM unnest(ARRAY['com.articles.voir', 'com.tiers.voir', 'com.stock.voir', 'com.ventes.voir', 'com.ventes.devis',
                                      'com.ventes.valider', 'com.ventes.commandes', 'com.ventes.livrer', 'com.ventes.annuler', 'com.tableau_bord.voir']) c
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END $$;

INSERT INTO tenant_permissions (tenant_id, permission_code)
SELECT DISTINCT tp.tenant_id, p.code FROM tenant_permissions tp JOIN permissions pc ON pc.code = tp.permission_code AND pc.module = 'commercial'
 CROSS JOIN permissions p WHERE p.code LIKE 'com.ventes.%'
ON CONFLICT DO NOTHING;
