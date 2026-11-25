-- ============================================================================
-- 079 — NJ FINANCE, lot F5 : configuration de la facturation
--
--  Référentiels propres à NJ FINANCE (classification FINANCIÈRE ; la gestion
--  opérationnelle des articles, magasins et stocks reste dans NJ COMMERCIAL) :
--   1. fin_categories      : catégories de charges et de produits, compte par
--                            défaut ; une catégorie de charge a un type d'achat
--                            (marchandises / autres achats et charges /
--                            immobilisation).
--   2. fin_familles        : familles de prestations et d'articles (comptes par défaut).
--   3. fin_prestations     : prestations et articles facturables (prix, taxe,
--                            comptes), lien facultatif vers un article de
--                            NJ COMMERCIAL (com_article_id), sans le recopier.
--   4. fin_modes_reglement : modes de règlement, caisse / banque par défaut,
--                            référence obligatoire (chèque, virement…).
--   5. fin_taxes_comptes   : comptes de chaque taxe. Les taxes elles-mêmes
--                            restent dans com_taxes, référentiel UNIQUE partagé
--                            avec NJ COMMERCIAL.
--   6. fin_sequences       : numérotation contrôlée des factures et avoirs,
--                            par type et par année, sans trou (ligne verrouillée).
--  7. Permission finance.config.facturation.
--
--  Additive et idempotente. Retour arrière : 079_retour_arriere.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS fin_categories (
  id              BIGSERIAL    PRIMARY KEY,
  tenant_id       UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code            TEXT         NOT NULL CHECK (code ~ '^[A-Z0-9_]{1,16}$'),
  libelle         TEXT         NOT NULL CHECK (btrim(libelle) <> '' AND length(libelle) <= 120),
  sens            TEXT         NOT NULL CHECK (sens IN ('charge', 'produit')),
  type_achat      TEXT         CHECK (type_achat IN ('marchandises', 'autres', 'immobilisation')),
  compte_defaut   TEXT         NOT NULL CHECK (btrim(compte_defaut) <> ''),
  actif           BOOLEAN      NOT NULL DEFAULT true,
  ordre           INTEGER      NOT NULL DEFAULT 0,
  modifie_par     UUID         REFERENCES users(id) ON DELETE SET NULL,
  modifie_le      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CHECK ((sens = 'charge') = (type_achat IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_categories_code ON fin_categories (tenant_id, code);

CREATE TABLE IF NOT EXISTS fin_familles (
  id              BIGSERIAL    PRIMARY KEY,
  tenant_id       UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code            TEXT         NOT NULL CHECK (code ~ '^[A-Z0-9_]{1,16}$'),
  libelle         TEXT         NOT NULL CHECK (btrim(libelle) <> '' AND length(libelle) <= 120),
  compte_produit  TEXT         NOT NULL DEFAULT '',
  compte_charge   TEXT         NOT NULL DEFAULT '',
  actif           BOOLEAN      NOT NULL DEFAULT true,
  modifie_par     UUID         REFERENCES users(id) ON DELETE SET NULL,
  modifie_le      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_familles_code ON fin_familles (tenant_id, code);

CREATE TABLE IF NOT EXISTS fin_prestations (
  id              BIGSERIAL     PRIMARY KEY,
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code            TEXT          NOT NULL CHECK (code ~ '^[A-Z0-9_.-]{1,20}$'),
  libelle         TEXT          NOT NULL CHECK (btrim(libelle) <> '' AND length(libelle) <= 200),
  type            TEXT          NOT NULL DEFAULT 'prestation' CHECK (type IN ('prestation', 'article')),
  famille_id      BIGINT        REFERENCES fin_familles(id),
  unite           TEXT          NOT NULL DEFAULT '' CHECK (length(unite) <= 20),
  prix_vente      NUMERIC(18,2) CHECK (prix_vente IS NULL OR prix_vente >= 0),
  prix_achat      NUMERIC(18,2) CHECK (prix_achat IS NULL OR prix_achat >= 0),
  taxe_id         BIGINT        REFERENCES com_taxes(id),
  compte_produit  TEXT          NOT NULL DEFAULT '',
  compte_charge   TEXT          NOT NULL DEFAULT '',
  com_article_id  BIGINT        REFERENCES com_articles(id) ON DELETE SET NULL,
  actif           BOOLEAN       NOT NULL DEFAULT true,
  modifie_par     UUID          REFERENCES users(id) ON DELETE SET NULL,
  modifie_le      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_prestations_code ON fin_prestations (tenant_id, code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_prestations_article ON fin_prestations (com_article_id) WHERE com_article_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS fin_modes_reglement (
  id                     BIGSERIAL    PRIMARY KEY,
  tenant_id              UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code                   TEXT         NOT NULL CHECK (code ~ '^[A-Z0-9_]{1,16}$'),
  libelle                TEXT         NOT NULL CHECK (btrim(libelle) <> '' AND length(libelle) <= 80),
  journal_id             INTEGER      REFERENCES journaux(id) ON DELETE SET NULL,
  reference_obligatoire  BOOLEAN      NOT NULL DEFAULT false,
  actif                  BOOLEAN      NOT NULL DEFAULT true,
  ordre                  INTEGER      NOT NULL DEFAULT 0,
  modifie_par            UUID         REFERENCES users(id) ON DELETE SET NULL,
  modifie_le             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_modes_code ON fin_modes_reglement (tenant_id, code);

CREATE TABLE IF NOT EXISTS fin_taxes_comptes (
  taxe_id                  BIGINT       PRIMARY KEY REFERENCES com_taxes(id) ON DELETE CASCADE,
  tenant_id                UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  compte_collecte          TEXT         NOT NULL DEFAULT '',
  compte_deductible        TEXT         NOT NULL DEFAULT '',
  compte_deductible_immo   TEXT         NOT NULL DEFAULT '',
  modifie_par              UUID         REFERENCES users(id) ON DELETE SET NULL,
  modifie_le               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fin_sequences (
  tenant_id      UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type_document  TEXT         NOT NULL CHECK (type_document IN ('facture_client', 'avoir_client', 'facture_fournisseur', 'avoir_fournisseur')),
  annee          INTEGER      NOT NULL CHECK (annee BETWEEN 2000 AND 2100),
  prefixe        TEXT         NOT NULL CHECK (prefixe ~ '^[A-Z0-9-]{1,8}$'),
  prochain       INTEGER      NOT NULL DEFAULT 1 CHECK (prochain >= 1),
  chiffres       INTEGER      NOT NULL DEFAULT 5 CHECK (chiffres BETWEEN 3 AND 8),
  modifie_le     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, type_document, annee)
);

-- Cohérence : les références pointent vers le même client.
CREATE OR REPLACE FUNCTION fin_config_coherence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'fin_prestations' THEN
    IF NEW.famille_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM fin_familles WHERE id = NEW.famille_id AND tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'CONFIG_INCOHERENTE: famille introuvable pour ce client.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.taxe_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM com_taxes WHERE id = NEW.taxe_id AND tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'CONFIG_INCOHERENTE: taxe introuvable pour ce client.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.com_article_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM com_articles WHERE id = NEW.com_article_id AND tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'CONFIG_INCOHERENTE: article de NJ COMMERCIAL introuvable pour ce client.' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF TG_TABLE_NAME = 'fin_modes_reglement' THEN
    IF NEW.journal_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM journaux WHERE id = NEW.journal_id AND tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'CONFIG_INCOHERENTE: caisse ou banque introuvable pour ce client.' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF TG_TABLE_NAME = 'fin_taxes_comptes' THEN
    IF NOT EXISTS (SELECT 1 FROM com_taxes WHERE id = NEW.taxe_id AND tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'CONFIG_INCOHERENTE: taxe introuvable pour ce client.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_fin_prestations_coherence ON fin_prestations;
CREATE TRIGGER trg_fin_prestations_coherence BEFORE INSERT OR UPDATE ON fin_prestations FOR EACH ROW EXECUTE FUNCTION fin_config_coherence();
DROP TRIGGER IF EXISTS trg_fin_modes_coherence ON fin_modes_reglement;
CREATE TRIGGER trg_fin_modes_coherence BEFORE INSERT OR UPDATE ON fin_modes_reglement FOR EACH ROW EXECUTE FUNCTION fin_config_coherence();
DROP TRIGGER IF EXISTS trg_fin_taxes_comptes_coherence ON fin_taxes_comptes;
CREATE TRIGGER trg_fin_taxes_comptes_coherence BEFORE INSERT OR UPDATE ON fin_taxes_comptes FOR EACH ROW EXECUTE FUNCTION fin_config_coherence();

-- Un compte cité par le paramétrage financier reste dans le plan.
CREATE OR REPLACE FUNCTION plan_client_est_utilise(p_tenant UUID, p_compte TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM rubriques r WHERE r.tenant_id = p_tenant AND lower(btrim(coalesce(r.code_comptable, ''))) = lower(btrim(p_compte)))
      OR EXISTS (SELECT 1 FROM equivalences_comptables e WHERE e.tenant_id = p_tenant AND e.statut IN ('valide', 'brouillon') AND lower(btrim(e.compte)) = lower(btrim(p_compte)))
      OR EXISTS (SELECT 1 FROM journaux j WHERE j.tenant_id = p_tenant AND lower(btrim(j.compte_tresorerie)) = lower(btrim(p_compte)))
      OR EXISTS (SELECT 1 FROM tenants t WHERE t.id = p_tenant AND lower(btrim(t.compte_virements)) = lower(btrim(p_compte)))
      OR EXISTS (SELECT 1 FROM fin_ecriture_lignes l WHERE l.tenant_id = p_tenant AND lower(btrim(l.compte)) = lower(btrim(p_compte)))
      OR EXISTS (SELECT 1 FROM fin_categories c WHERE c.tenant_id = p_tenant AND lower(btrim(c.compte_defaut)) = lower(btrim(p_compte)))
      OR EXISTS (SELECT 1 FROM fin_familles f WHERE f.tenant_id = p_tenant AND lower(btrim(p_compte)) IN (lower(btrim(f.compte_produit)), lower(btrim(f.compte_charge))))
      OR EXISTS (SELECT 1 FROM fin_prestations p WHERE p.tenant_id = p_tenant AND lower(btrim(p_compte)) IN (lower(btrim(p.compte_produit)), lower(btrim(p.compte_charge))))
      OR EXISTS (SELECT 1 FROM fin_taxes_comptes x WHERE x.tenant_id = p_tenant AND lower(btrim(p_compte)) IN (lower(btrim(x.compte_collecte)), lower(btrim(x.compte_deductible)), lower(btrim(x.compte_deductible_immo))));
$$;

INSERT INTO permissions(code, nom, module, description) VALUES
  ('finance.config.facturation', 'Paramétrer la facturation', 'finance',
   'Catégories de charges et de produits, prestations et articles, familles, modes de règlement, taxes et numérotation')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, 'finance.config.facturation' FROM roles r
 WHERE r.code IN ('directeur', 'auditeur', 'comptable_cabinet') AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;
INSERT INTO tenant_permissions(tenant_id, permission_code)
SELECT DISTINCT tp.tenant_id, 'finance.config.facturation' FROM tenant_permissions tp WHERE tp.permission_code = 'journal.view'
ON CONFLICT DO NOTHING;
