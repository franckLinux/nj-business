-- ============================================================================
-- 084 — NJ FINANCE, lot F10 : tableau des immobilisations (26/11/2026).
--
-- Décision de Franck : le lot F10 se limite à un TABLEAU DES IMMOBILISATIONS
-- (le stock reste dans NJ COMMERCIAL ; le lot F9 est annulé).
--   • fin_immo_categories : catégories (compte d'immobilisation, d'amortissement,
--     de dotation, durée par défaut, amortissable ou non — un terrain ne l'est pas).
--   • fin_immobilisations : registre (valeur d'origine, dates d'acquisition et de
--     mise en service, durée, fournisseur, facture d'origine, localisation,
--     responsable) et sortie éventuelle (cession ou mise au rebut, prix).
-- Le plan d'amortissement (linéaire, prorata temporis en jours, année de 360
-- jours) et le tableau par exercice sont CALCULÉS, jamais stockés. Aucune
-- écriture n'est passée ici : les dotations viendront avec la clôture (F11).
--
-- Additive et idempotente. Retour arrière : 084_retour_arriere.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS fin_immo_categories (
  id               BIGSERIAL   PRIMARY KEY,
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code             TEXT        NOT NULL CHECK (code ~ '^[A-Z0-9_]{2,20}$'),
  libelle          TEXT        NOT NULL CHECK (btrim(libelle) <> '' AND length(libelle) <= 120),
  compte_immo      TEXT        NOT NULL CHECK (compte_immo ~ '^2'),
  compte_amort     TEXT        CHECK (compte_amort IS NULL OR compte_amort ~ '^28'),
  compte_dotation  TEXT        CHECK (compte_dotation IS NULL OR compte_dotation ~ '^68'),
  amortissable     BOOLEAN     NOT NULL DEFAULT true,
  duree_defaut     NUMERIC(5,2) CHECK (duree_defaut IS NULL OR (duree_defaut > 0 AND duree_defaut <= 100)),
  actif            BOOLEAN     NOT NULL DEFAULT true,
  ordre            INTEGER     NOT NULL DEFAULT 0,
  modifie_par      UUID        REFERENCES users(id) ON DELETE SET NULL,
  modifie_le       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code),
  CHECK (NOT amortissable OR (compte_amort IS NOT NULL AND compte_dotation IS NOT NULL AND duree_defaut IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS fin_immobilisations (
  id                BIGSERIAL     PRIMARY KEY,
  tenant_id         UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code              TEXT          NOT NULL CHECK (btrim(code) <> '' AND length(code) <= 30),
  designation       TEXT          NOT NULL CHECK (btrim(designation) <> '' AND length(designation) <= 200),
  categorie_id      BIGINT        NOT NULL REFERENCES fin_immo_categories(id),
  compte_immo       TEXT          NOT NULL CHECK (compte_immo ~ '^2'),
  date_acquisition  DATE          NOT NULL,
  date_mise_service DATE          NOT NULL,
  valeur_origine    NUMERIC(15,2) NOT NULL CHECK (valeur_origine > 0),
  amortissable      BOOLEAN       NOT NULL DEFAULT true,
  duree_annees      NUMERIC(5,2)  CHECK (duree_annees IS NULL OR (duree_annees > 0 AND duree_annees <= 100)),
  -- Amortissements déjà pratiqués avant la prise en charge dans NJ FINANCE (reprise d'un bien ancien).
  amort_anterieurs  NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (amort_anterieurs >= 0),
  amort_anterieurs_au DATE,
  fournisseur_id    BIGINT        REFERENCES registre_tiers(id) ON DELETE SET NULL,
  facture_id        BIGINT        REFERENCES fin_factures(id) ON DELETE SET NULL,
  reference_piece   TEXT          NOT NULL DEFAULT '' CHECK (length(reference_piece) <= 60),
  localisation      TEXT          NOT NULL DEFAULT '' CHECK (length(localisation) <= 120),
  responsable       TEXT          NOT NULL DEFAULT '' CHECK (length(responsable) <= 120),
  observations      TEXT          NOT NULL DEFAULT '' CHECK (length(observations) <= 500),
  statut            TEXT          NOT NULL DEFAULT 'en_service' CHECK (statut IN ('en_service', 'cede', 'rebut')),
  date_sortie       DATE,
  prix_cession      NUMERIC(15,2) CHECK (prix_cession IS NULL OR prix_cession >= 0),
  motif_sortie      TEXT          NOT NULL DEFAULT '' CHECK (length(motif_sortie) <= 300),
  cree_par          UUID          REFERENCES users(id) ON DELETE SET NULL,
  cree_le           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  modifie_par       UUID          REFERENCES users(id) ON DELETE SET NULL,
  modifie_le        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code),
  CHECK (date_mise_service >= date_acquisition),
  CHECK (NOT amortissable OR duree_annees IS NOT NULL),
  CHECK (amort_anterieurs <= valeur_origine),
  CHECK (amort_anterieurs = 0 OR amort_anterieurs_au IS NOT NULL),
  CHECK ((statut = 'en_service') = (date_sortie IS NULL)),
  CHECK (statut <> 'cede' OR prix_cession IS NOT NULL),
  CHECK (date_sortie IS NULL OR date_sortie >= date_mise_service)
);
CREATE INDEX IF NOT EXISTS idx_fin_immobilisations ON fin_immobilisations (tenant_id, statut, date_mise_service);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_immo_facture ON fin_immobilisations (facture_id) WHERE facture_id IS NOT NULL;

-- Une immobilisation et sa catégorie appartiennent au même client ; la facture aussi.
CREATE OR REPLACE FUNCTION fin_immo_controle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM fin_immo_categories WHERE id = NEW.categorie_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'IMMO_INVALIDE: catégorie d''un autre client.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.facture_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM fin_factures WHERE id = NEW.facture_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'IMMO_INVALIDE: facture d''un autre client.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.fournisseur_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM registre_tiers WHERE id = NEW.fournisseur_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'IMMO_INVALIDE: fournisseur d''un autre client.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_fin_immo_controle ON fin_immobilisations;
CREATE TRIGGER trg_fin_immo_controle BEFORE INSERT OR UPDATE ON fin_immobilisations
  FOR EACH ROW EXECUTE FUNCTION fin_immo_controle();

INSERT INTO permissions(code, nom, module, description) VALUES
  ('finance.immos.voir',  'Voir les immobilisations',  'finance', 'Registre et tableau des immobilisations, plans d''amortissement'),
  ('finance.immos.gerer', 'Gérer les immobilisations', 'finance', 'Créer, modifier, sortir une immobilisation ; régler les catégories')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, p.code FROM roles r
  CROSS JOIN (VALUES ('finance.immos.voir'), ('finance.immos.gerer')) AS p(code)
 WHERE r.code IN ('directeur', 'auditeur', 'comptable_cabinet') AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;

INSERT INTO tenant_permissions(tenant_id, permission_code)
SELECT DISTINCT tp.tenant_id, p.code FROM tenant_permissions tp
  CROSS JOIN (VALUES ('finance.immos.voir'), ('finance.immos.gerer')) AS p(code)
 WHERE tp.permission_code = 'journal.view'
ON CONFLICT DO NOTHING;
