-- ============================================================================
-- 056 — NJ COMMERCIAL, lot 4 : moteur de stock valorisé (02/11/2026)
--
--  Principe : le stock n'est qu'une somme de MOUVEMENTS écrits par des
--  documents VALIDÉS. Chaque mouvement porte son sens, sa quantité en unité de
--  stock, son coût unitaire et sa valeur. La valorisation (CMUP ou FIFO, selon
--  l'article) est recalculée par REJEU déterministe des mouvements d'un article :
--  com_stock_soldes, com_stock_lots et com_stock_consommations ne sont que des
--  caches reconstruits à l'identique, jamais la source.
--
--  • com_stock_mouvements : sens (+1 / −1), coût, valeur, document d'origine,
--    lien de transfert, annulation (le mouvement reste, marqué annulé) ;
--    le stock initial existant devient un mouvement d'entrée « à valoriser »
--    tant que son coût n'est pas saisi.
--  • com_stock_documents / com_stock_doc_lignes : entrées diverses, sorties
--    diverses, transferts, inventaires. Brouillon → à valider → validé → annulé.
--  • Permissions com.stock.voir / com.stock.mouvements / com.stock.valider ;
--    profils « Magasinier » et « Gestionnaire de stock » pour les clients où le
--    module est déjà activé ; paramètres stock négatif et auto-validation.
--
--  PUREMENT ADDITIVE ; aucune donnée de caisse touchée. Idempotente.
--  Retour arrière : migrations-retour-arriere/056_retour_arriere.sql
-- ============================================================================

-- ── Mouvements ──────────────────────────────────────────────────────────────
ALTER TABLE com_stock_mouvements DROP CONSTRAINT IF EXISTS com_stock_mouvements_type_check;
ALTER TABLE com_stock_mouvements ADD CONSTRAINT com_stock_mouvements_type_check CHECK (type IN (
  'stock_initial', 'entree', 'sortie', 'transfert_sortie', 'transfert_entree', 'inventaire_plus', 'inventaire_moins',
  'reception', 'retour_fournisseur', 'livraison', 'retour_client'));
ALTER TABLE com_stock_mouvements ADD COLUMN IF NOT EXISTS sens SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE com_stock_mouvements DROP CONSTRAINT IF EXISTS com_stock_mouvements_sens_check;
ALTER TABLE com_stock_mouvements ADD CONSTRAINT com_stock_mouvements_sens_check CHECK (sens IN (1, -1));
ALTER TABLE com_stock_mouvements ADD COLUMN IF NOT EXISTS cout_unitaire NUMERIC(18,6) CHECK (cout_unitaire IS NULL OR cout_unitaire >= 0);
ALTER TABLE com_stock_mouvements ADD COLUMN IF NOT EXISTS valeur NUMERIC(18,2);
ALTER TABLE com_stock_mouvements ADD COLUMN IF NOT EXISTS document_type TEXT NOT NULL DEFAULT '';
ALTER TABLE com_stock_mouvements ADD COLUMN IF NOT EXISTS document_id BIGINT;
ALTER TABLE com_stock_mouvements ADD COLUMN IF NOT EXISTS ligne_id BIGINT;
ALTER TABLE com_stock_mouvements ADD COLUMN IF NOT EXISTS mouvement_lie_id BIGINT REFERENCES com_stock_mouvements(id);
ALTER TABLE com_stock_mouvements ADD COLUMN IF NOT EXISTS annule BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE com_stock_mouvements ADD COLUMN IF NOT EXISTS annule_le TIMESTAMPTZ;
COMMENT ON COLUMN com_stock_mouvements.quantite IS 'Quantité en unité de stock, toujours positive ; le sens dit entrée (+1) ou sortie (−1)';
COMMENT ON COLUMN com_stock_mouvements.cout_unitaire IS 'Coût par unité de stock ; NULL = à valoriser (stock d''ouverture sans coût)';
CREATE INDEX IF NOT EXISTS idx_com_stock_doc ON com_stock_mouvements (document_type, document_id);

-- Un mouvement validé est intangible : seules la valorisation (rejeu), l'annulation
-- et la correction du stock d'ouverture (tant qu'il est seul) passent.
CREATE OR REPLACE FUNCTION com_stock_mouvements_proteger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'STOCK_INTANGIBLE: un mouvement de stock ne se supprime pas (annulez le document).';
  END IF;
  IF OLD.type <> 'stock_initial' AND (NEW.article_id <> OLD.article_id OR NEW.magasin_id <> OLD.magasin_id OR NEW.type <> OLD.type
      OR NEW.sens <> OLD.sens OR NEW.quantite <> OLD.quantite OR NEW.date_mouvement <> OLD.date_mouvement
      OR NEW.document_type <> OLD.document_type OR NEW.document_id IS DISTINCT FROM OLD.document_id
      OR (OLD.annule AND NOT NEW.annule)) THEN
    RAISE EXCEPTION 'STOCK_INTANGIBLE: un mouvement de stock validé ne se modifie pas.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_com_stock_mouvements_proteger ON com_stock_mouvements;
CREATE TRIGGER trg_com_stock_mouvements_proteger BEFORE UPDATE OR DELETE ON com_stock_mouvements
  FOR EACH ROW EXECUTE FUNCTION com_stock_mouvements_proteger();

-- ── Caches reconstruits par le rejeu ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS com_stock_soldes (
  tenant_id   UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  article_id  BIGINT         NOT NULL REFERENCES com_articles(id),
  magasin_id  BIGINT         NOT NULL REFERENCES com_magasins(id),
  quantite    NUMERIC(18,3)  NOT NULL DEFAULT 0,
  valeur      NUMERIC(18,2)  NOT NULL DEFAULT 0,
  cmup        NUMERIC(18,6),
  a_valoriser BOOLEAN        NOT NULL DEFAULT false,
  dernier_mouvement DATE,
  calcule_le  TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  PRIMARY KEY (article_id, magasin_id)
);
CREATE INDEX IF NOT EXISTS idx_com_stock_soldes_tenant ON com_stock_soldes (tenant_id, magasin_id);

CREATE TABLE IF NOT EXISTS com_stock_lots (
  id                  BIGSERIAL      PRIMARY KEY,
  tenant_id           UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  article_id          BIGINT         NOT NULL REFERENCES com_articles(id),
  magasin_id          BIGINT         NOT NULL REFERENCES com_magasins(id),
  mouvement_id        BIGINT         NOT NULL REFERENCES com_stock_mouvements(id),
  date_entree         DATE           NOT NULL,
  quantite_initiale   NUMERIC(18,3)  NOT NULL,
  quantite_restante   NUMERIC(18,3)  NOT NULL,
  cout_unitaire       NUMERIC(18,6)
);
CREATE INDEX IF NOT EXISTS idx_com_stock_lots ON com_stock_lots (article_id, magasin_id, id);

CREATE TABLE IF NOT EXISTS com_stock_consommations (
  mouvement_id   BIGINT         NOT NULL REFERENCES com_stock_mouvements(id),
  lot_id         BIGINT         NOT NULL REFERENCES com_stock_lots(id) ON DELETE CASCADE,
  tenant_id      UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quantite       NUMERIC(18,3)  NOT NULL,
  cout_unitaire  NUMERIC(18,6),
  PRIMARY KEY (mouvement_id, lot_id)
);

-- ── Documents de stock ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS com_stock_documents (
  id               BIGSERIAL     PRIMARY KEY,
  tenant_id        UUID          NOT NULL REFERENCES tenants(id),
  type             TEXT          NOT NULL CHECK (type IN ('entree', 'sortie', 'transfert', 'inventaire')),
  numero           TEXT          NOT NULL,
  statut           TEXT          NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'a_valider', 'valide', 'annule')),
  date_document    DATE          NOT NULL DEFAULT CURRENT_DATE,
  magasin_id       BIGINT        NOT NULL REFERENCES com_magasins(id),
  magasin_dest_id  BIGINT        REFERENCES com_magasins(id),
  motif            TEXT          NOT NULL DEFAULT '' CHECK (length(motif) <= 500),
  observations     TEXT          NOT NULL DEFAULT '' CHECK (length(observations) <= 2000),
  cree_par         UUID          REFERENCES users(id),
  cree_le          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  modifie_le       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  soumis_le        TIMESTAMPTZ,
  valide_par       UUID          REFERENCES users(id),
  valide_le        TIMESTAMPTZ,
  motif_renvoi     TEXT          NOT NULL DEFAULT '',
  annule_par       UUID          REFERENCES users(id),
  annule_le        TIMESTAMPTZ,
  motif_annulation TEXT          NOT NULL DEFAULT '',
  CHECK ((type = 'transfert') = (magasin_dest_id IS NOT NULL)),
  CHECK (magasin_dest_id IS NULL OR magasin_dest_id <> magasin_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_com_stock_documents_numero ON com_stock_documents (tenant_id, numero);
CREATE INDEX IF NOT EXISTS idx_com_stock_documents ON com_stock_documents (tenant_id, type, statut);

CREATE TABLE IF NOT EXISTS com_stock_doc_lignes (
  id                  BIGSERIAL      PRIMARY KEY,
  document_id         BIGINT         NOT NULL REFERENCES com_stock_documents(id) ON DELETE CASCADE,
  tenant_id           UUID           NOT NULL REFERENCES tenants(id),
  ordre               INTEGER        NOT NULL DEFAULT 0,
  article_id          BIGINT         NOT NULL REFERENCES com_articles(id),
  unite_id            BIGINT         REFERENCES com_unites(id),
  unite               TEXT           NOT NULL DEFAULT '',
  coefficient         NUMERIC(18,6)  NOT NULL DEFAULT 1 CHECK (coefficient > 0),
  quantite            NUMERIC(18,3)  NOT NULL DEFAULT 0 CHECK (quantite >= 0),
  cout_unitaire       NUMERIC(18,6)  CHECK (cout_unitaire IS NULL OR cout_unitaire >= 0),
  quantite_theorique  NUMERIC(18,3),
  quantite_comptee    NUMERIC(18,3)  CHECK (quantite_comptee IS NULL OR quantite_comptee >= 0),
  observation         TEXT           NOT NULL DEFAULT '' CHECK (length(observation) <= 500),
  UNIQUE (document_id, article_id)
);
COMMENT ON COLUMN com_stock_doc_lignes.cout_unitaire IS 'Entrée diverse : coût par unité DU DOCUMENT (converti en unité de stock au mouvement)';
COMMENT ON COLUMN com_stock_doc_lignes.quantite_theorique IS 'Inventaire : stock théorique relevé à la validation (unité de stock)';

-- Un document validé ou annulé ne change plus (sauf passage validé → annulé, motivé).
CREATE OR REPLACE FUNCTION com_stock_documents_proteger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.statut <> 'brouillon' THEN RAISE EXCEPTION 'STOCK_INTANGIBLE: seul un brouillon se supprime.'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.statut = 'annule' THEN RAISE EXCEPTION 'STOCK_INTANGIBLE: document annulé.'; END IF;
  IF OLD.statut = 'valide' AND (NEW.statut <> 'annule' OR NEW.numero <> OLD.numero OR NEW.magasin_id <> OLD.magasin_id
      OR NEW.magasin_dest_id IS DISTINCT FROM OLD.magasin_dest_id OR NEW.date_document <> OLD.date_document
      OR NEW.valide_le IS DISTINCT FROM OLD.valide_le OR length(NEW.motif_annulation) < 3) THEN
    RAISE EXCEPTION 'STOCK_INTANGIBLE: un document validé ne s''annule qu''avec un motif.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_com_stock_documents_proteger ON com_stock_documents;
CREATE TRIGGER trg_com_stock_documents_proteger BEFORE UPDATE OR DELETE ON com_stock_documents
  FOR EACH ROW EXECUTE FUNCTION com_stock_documents_proteger();

CREATE OR REPLACE FUNCTION com_stock_lignes_proteger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st TEXT;
BEGIN
  SELECT statut INTO st FROM com_stock_documents WHERE id = COALESCE(NEW.document_id, OLD.document_id);
  -- Seule la quantité théorique d'un inventaire se relève à la validation (statut encore « à valider »).
  IF st IS NOT NULL AND st NOT IN ('brouillon', 'a_valider') THEN
    RAISE EXCEPTION 'STOCK_INTANGIBLE: les lignes d''un document validé sont figées.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_com_stock_lignes_proteger ON com_stock_doc_lignes;
CREATE TRIGGER trg_com_stock_lignes_proteger BEFORE INSERT OR UPDATE OR DELETE ON com_stock_doc_lignes
  FOR EACH ROW EXECUTE FUNCTION com_stock_lignes_proteger();

-- Pièces justificatives des documents de stock (bon de livraison interne, PV d'inventaire…).
ALTER TABLE com_documents DROP CONSTRAINT IF EXISTS com_documents_objet_type_check;
ALTER TABLE com_documents ADD CONSTRAINT com_documents_objet_type_check CHECK (objet_type IN ('demande', 'bon_commande', 'stock_doc'));

-- Même client partout.
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
    ok := NEW.objet_type <> 'stock_doc' OR EXISTS (SELECT 1 FROM com_stock_documents WHERE id = NEW.objet_id AND tenant_id = NEW.tenant_id);
  ELSIF TG_TABLE_NAME IN ('com_stock_soldes', 'com_stock_lots') THEN
    ok := EXISTS (SELECT 1 FROM com_articles WHERE id = NEW.article_id AND tenant_id = NEW.tenant_id)
      AND EXISTS (SELECT 1 FROM com_magasins WHERE id = NEW.magasin_id AND tenant_id = NEW.tenant_id);
  END IF;
  IF NOT ok THEN
    RAISE EXCEPTION 'Référence d''un autre client refusée (%).', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['com_stock_documents', 'com_stock_doc_lignes', 'com_stock_soldes', 'com_stock_lots', 'com_documents'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_meme_client_f ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_meme_client_f BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION com_meme_client_f()', t, t);
  END LOOP;
END $$;

-- ── Paramètres ──────────────────────────────────────────────────────────────
ALTER TABLE com_parametres ADD COLUMN IF NOT EXISTS stock_negatif_autorise BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE com_parametres ADD COLUMN IF NOT EXISTS autovalidation_stock BOOLEAN NOT NULL DEFAULT false;

-- Numérotation des documents de stock (ENT, SOR, TRF, INV) dans le compteur existant.
ALTER TABLE com_compteurs DROP CONSTRAINT IF EXISTS com_compteurs_type_check;
ALTER TABLE com_compteurs ADD CONSTRAINT com_compteurs_type_check CHECK (type IN ('DA', 'BC', 'ENT', 'SOR', 'TRF', 'INV'));

-- ── Permissions et profils ──────────────────────────────────────────────────
INSERT INTO permissions (code, nom, module, description) VALUES
  ('com.stock.voir',       'Consulter le stock',                 'commercial', 'État du stock, mouvements, valorisation'),
  ('com.stock.mouvements', 'Saisir les documents de stock',      'commercial', 'Entrées, sorties, transferts, inventaires (brouillons)'),
  ('com.stock.valider',    'Valider les documents de stock',     'commercial', 'Validation et annulation : seule la validation fait bouger le stock')
ON CONFLICT (code) DO NOTHING;

-- Directeur (rôle système) : tous les droits du module.
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE r.code = 'directeur' AND r.tenant_id IS NULL AND r.is_system AND p.code IN ('com.stock.voir', 'com.stock.mouvements', 'com.stock.valider')
ON CONFLICT DO NOTHING;
-- Profils achats existants : le gestionnaire et le responsable voient le stock.
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'com.stock.voir' FROM roles r WHERE r.code IN ('achats_gestionnaire', 'achats_responsable') AND r.tenant_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Nouveaux profils pour les clients où NJ COMMERCIAL est déjà activé.
DO $$
DECLARE t UUID; rid BIGINT;
BEGIN
  IF to_regclass('public.tenant_modules') IS NULL THEN RETURN; END IF;
  FOR t IN SELECT tenant_id FROM tenant_modules WHERE module_code = 'commercial' AND actif LOOP
    IF NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id = t AND code = 'stock_magasinier') THEN
      INSERT INTO roles (nom, code, description, couleur, tenant_id, is_system)
      VALUES ('Magasinier', 'stock_magasinier', 'Saisit entrées, sorties, transferts et comptages d''inventaire', '#0d9488', t, false) RETURNING id INTO rid;
      INSERT INTO role_permissions (role_id, permission_code)
      SELECT rid, c FROM unnest(ARRAY['com.articles.voir', 'com.stock.voir', 'com.stock.mouvements']) c ON CONFLICT DO NOTHING;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id = t AND code = 'stock_gestionnaire') THEN
      INSERT INTO roles (nom, code, description, couleur, tenant_id, is_system)
      VALUES ('Gestionnaire de stock', 'stock_gestionnaire', 'Valide les documents de stock, suit la valorisation', '#0f766e', t, false) RETURNING id INTO rid;
      INSERT INTO role_permissions (role_id, permission_code)
      SELECT rid, c FROM unnest(ARRAY['com.parametrage.voir', 'com.articles.voir', 'com.stock.initial', 'com.stock.voir', 'com.stock.mouvements', 'com.stock.valider', 'com.tableau_bord.voir']) c
      ON CONFLICT DO NOTHING;
    END IF;
    -- Plafond éventuel : les nouvelles fonctions du module y entrent (le module est activé).
    IF EXISTS (SELECT 1 FROM tenant_permissions WHERE tenant_id = t)
       AND EXISTS (SELECT 1 FROM tenant_permissions tp JOIN permissions p ON p.code = tp.permission_code WHERE tp.tenant_id = t AND p.module = 'commercial') THEN
      INSERT INTO tenant_permissions (tenant_id, permission_code)
      SELECT t, c FROM unnest(ARRAY['com.stock.voir', 'com.stock.mouvements', 'com.stock.valider']) c ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END $$;

-- ── Reprise de l'existant ───────────────────────────────────────────────────
-- Le stock initial déjà saisi : entrée « à valoriser » (coût NULL), et ses soldes.
UPDATE com_stock_mouvements SET document_type = 'stock_initial' WHERE type = 'stock_initial' AND document_type = '';
INSERT INTO com_stock_soldes (tenant_id, article_id, magasin_id, quantite, valeur, cmup, a_valoriser, dernier_mouvement)
SELECT tenant_id, article_id, magasin_id, SUM(sens * quantite), 0, NULL, bool_or(cout_unitaire IS NULL), MAX(date_mouvement)
  FROM com_stock_mouvements WHERE NOT annule GROUP BY tenant_id, article_id, magasin_id
ON CONFLICT (article_id, magasin_id) DO NOTHING;
INSERT INTO com_stock_lots (tenant_id, article_id, magasin_id, mouvement_id, date_entree, quantite_initiale, quantite_restante, cout_unitaire)
SELECT m.tenant_id, m.article_id, m.magasin_id, m.id, m.date_mouvement, m.quantite, m.quantite, m.cout_unitaire
  FROM com_stock_mouvements m
 WHERE m.type = 'stock_initial' AND NOT EXISTS (SELECT 1 FROM com_stock_lots l WHERE l.mouvement_id = m.id);
