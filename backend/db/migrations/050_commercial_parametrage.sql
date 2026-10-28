-- ============================================================================
-- 050 — NJ COMMERCIAL, livraison A : paramétrage des achats (28/10/2026)
--
--  Conception : document « NJ COMMERCIAL — Achats : diagnostic et conception ».
--
--  PUREMENT ADDITIVE pour NJ CAISSE PRO : aucune table de caisse n'est
--  modifiée, vidée ou supprimée. Les nouvelles tables portent le préfixe com_.
--  Deux règles existantes sont ÉLARGIES (jamais restreintes) pour accueillir le
--  rôle de base « collaborateur » (utilisateur sans aucun droit de caisse) :
--    • users_role_check            : + 'collaborateur'
--    • tenants.roles_autorises     : + 'collaborateur'
--
--  Réutilisé (non dupliqué) : identité de la société (tenants), fournisseurs et
--  clients (registre_tiers), utilisateurs, droits, notifications, audit_log.
--
--  Idempotente. Retour arrière : migrations-retour-arriere/050_retour_arriere.sql
-- ============================================================================

-- ── Rôle de base « collaborateur » ─────────────────────────────────────────
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role = ANY (ARRAY[
  'super_admin', 'comptable_cabinet', 'directeur', 'caissier', 'auditeur', 'commercial', 'collaborateur']));

DO $$
DECLARE c TEXT;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'tenants'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%roles_autorises%';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE tenants DROP CONSTRAINT %I', c); END IF;
END $$;
ALTER TABLE tenants ADD CONSTRAINT tenants_roles_autorises_check CHECK (
  roles_autorises IS NULL OR (cardinality(roles_autorises) > 0
  AND roles_autorises <@ ARRAY['directeur', 'caissier', 'auditeur', 'collaborateur']));

INSERT INTO roles (nom, code, description, couleur, tenant_id, is_system)
SELECT 'Collaborateur', 'collaborateur',
       'Utilisateur des modules de gestion, sans accès à la caisse (demandeur, magasinier…)', '#0f766e', NULL, true
 WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = 'collaborateur' AND tenant_id IS NULL);

-- ── Paramètres du module par client ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS com_parametres (
  tenant_id                 UUID          PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  nom_commercial            TEXT          NOT NULL DEFAULT '' CHECK (length(nom_commercial) <= 150),
  mentions_documents        TEXT          NOT NULL DEFAULT '' CHECK (length(mentions_documents) <= 1000),
  prefixe_da                TEXT          NOT NULL DEFAULT 'DA' CHECK (prefixe_da ~ '^[A-Z0-9]{1,6}$'),
  prefixe_bc                TEXT          NOT NULL DEFAULT 'BC' CHECK (prefixe_bc ~ '^[A-Z0-9]{1,6}$'),
  bloquer_si_stock_suffisant BOOLEAN      NOT NULL DEFAULT false,
  proforma_obligatoire      BOOLEAN       NOT NULL DEFAULT false,
  seuil_direction           NUMERIC(18,2) DEFAULT 500000 CHECK (seuil_direction IS NULL OR seuil_direction >= 0),
  tolerance_ecart_pct       NUMERIC(5,2)  NOT NULL DEFAULT 10 CHECK (tolerance_ecart_pct BETWEEN 0 AND 100),
  modifie_par               UUID          REFERENCES users(id) ON DELETE SET NULL,
  modifie_le                TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── Magasins ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS com_magasins (
  id              BIGSERIAL    PRIMARY KEY,
  tenant_id       UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code            TEXT         NOT NULL CHECK (code ~ '^[A-Za-z0-9_.-]{1,20}$'),
  nom             TEXT         NOT NULL CHECK (btrim(nom) <> '' AND length(nom) <= 120),
  description     TEXT         NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  localisation    TEXT         NOT NULL DEFAULT '' CHECK (length(localisation) <= 300),
  responsable_id  UUID         REFERENCES users(id) ON DELETE SET NULL,
  actif           BOOLEAN      NOT NULL DEFAULT true,
  cree_par        UUID         REFERENCES users(id) ON DELETE SET NULL,
  cree_le         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  modifie_le      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_com_magasins_code ON com_magasins (tenant_id, upper(code));

-- ── Familles d'articles ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS com_familles (
  id              BIGSERIAL    PRIMARY KEY,
  tenant_id       UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code            TEXT         NOT NULL CHECK (code ~ '^[A-Za-z0-9_.-]{1,20}$'),
  nom             TEXT         NOT NULL CHECK (btrim(nom) <> '' AND length(nom) <= 120),
  description     TEXT         NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  actif           BOOLEAN      NOT NULL DEFAULT true,
  cree_par        UUID         REFERENCES users(id) ON DELETE SET NULL,
  cree_le         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  modifie_le      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_com_familles_code ON com_familles (tenant_id, upper(code));

-- ── Extension achats du registre des tiers (fournisseurs / clients) ─────────
CREATE TABLE IF NOT EXISTS com_tiers (
  tiers_id            BIGINT       PRIMARY KEY REFERENCES registre_tiers(id) ON DELETE CASCADE,
  tenant_id           UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code                TEXT         NOT NULL DEFAULT '' CHECK (code = '' OR code ~ '^[A-Za-z0-9_.-]{1,20}$'),
  nom_commercial      TEXT         NOT NULL DEFAULT '' CHECK (length(nom_commercial) <= 150),
  ville               TEXT         NOT NULL DEFAULT '' CHECK (length(ville) <= 80),
  pays                TEXT         NOT NULL DEFAULT '' CHECK (length(pays) <= 80),
  contact_nom         TEXT         NOT NULL DEFAULT '' CHECK (length(contact_nom) <= 120),
  contact_telephone   TEXT         NOT NULL DEFAULT '' CHECK (length(contact_telephone) <= 40),
  contact_email       TEXT         NOT NULL DEFAULT '' CHECK (length(contact_email) <= 150),
  conditions_paiement TEXT         NOT NULL DEFAULT '' CHECK (length(conditions_paiement) <= 300),
  modifie_par         UUID         REFERENCES users(id) ON DELETE SET NULL,
  modifie_le          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_com_tiers_code ON com_tiers (tenant_id, upper(code)) WHERE code <> '';

-- Coordonnées bancaires : table séparée, permission dédiée (com.tiers.banque).
CREATE TABLE IF NOT EXISTS com_tiers_banque (
  tiers_id     BIGINT       PRIMARY KEY REFERENCES registre_tiers(id) ON DELETE CASCADE,
  tenant_id    UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  banque       TEXT         NOT NULL DEFAULT '' CHECK (length(banque) <= 120),
  titulaire    TEXT         NOT NULL DEFAULT '' CHECK (length(titulaire) <= 150),
  rib_iban     TEXT         NOT NULL DEFAULT '' CHECK (length(rib_iban) <= 60),
  swift        TEXT         NOT NULL DEFAULT '' CHECK (length(swift) <= 20),
  modifie_par  UUID         REFERENCES users(id) ON DELETE SET NULL,
  modifie_le   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS com_famille_fournisseurs (
  famille_id  BIGINT  NOT NULL REFERENCES com_familles(id) ON DELETE CASCADE,
  tiers_id    BIGINT  NOT NULL REFERENCES registre_tiers(id) ON DELETE CASCADE,
  tenant_id   UUID    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  PRIMARY KEY (famille_id, tiers_id)
);

-- ── Taxes ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS com_taxes (
  id            BIGSERIAL     PRIMARY KEY,
  tenant_id     UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code          TEXT          NOT NULL CHECK (code ~ '^[A-Za-z0-9_.-]{1,20}$'),
  intitule      TEXT          NOT NULL CHECK (btrim(intitule) <> '' AND length(intitule) <= 120),
  taux          NUMERIC(7,4)  NOT NULL CHECK (taux >= 0 AND taux <= 100),
  type          TEXT          NOT NULL DEFAULT 'tva' CHECK (type IN ('tva', 'precompte', 'autre')),
  description   TEXT          NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  debut         DATE,
  fin           DATE,
  actif         BOOLEAN       NOT NULL DEFAULT true,
  cree_par      UUID          REFERENCES users(id) ON DELETE SET NULL,
  cree_le       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  modifie_le    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CHECK (fin IS NULL OR debut IS NULL OR fin >= debut)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_com_taxes_code ON com_taxes (tenant_id, upper(code));

-- ── Articles ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS com_articles (
  id                    BIGSERIAL     PRIMARY KEY,
  tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reference             TEXT          NOT NULL CHECK (reference ~ '^[A-Za-z0-9_./-]{1,30}$'),
  designation           TEXT          NOT NULL CHECK (btrim(designation) <> '' AND length(designation) <= 200),
  description           TEXT          NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  famille_id            BIGINT        NOT NULL REFERENCES com_familles(id),
  unite                 TEXT          NOT NULL DEFAULT 'unité' CHECK (btrim(unite) <> '' AND length(unite) <= 20),
  prix_achat_indicatif  NUMERIC(18,2) CHECK (prix_achat_indicatif IS NULL OR prix_achat_indicatif >= 0),
  taxe_id               BIGINT        REFERENCES com_taxes(id),
  seuil_alerte          NUMERIC(18,3) CHECK (seuil_alerte IS NULL OR seuil_alerte >= 0),
  suivi_comptable       BOOLEAN       NOT NULL,
  actif                 BOOLEAN       NOT NULL DEFAULT true,
  cree_par              UUID          REFERENCES users(id) ON DELETE SET NULL,
  cree_le               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  modifie_par           UUID          REFERENCES users(id) ON DELETE SET NULL,
  modifie_le            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_com_articles_ref ON com_articles (tenant_id, upper(reference));
CREATE INDEX IF NOT EXISTS idx_com_articles_famille ON com_articles (famille_id);

CREATE TABLE IF NOT EXISTS com_article_fournisseurs (
  article_id  BIGINT  NOT NULL REFERENCES com_articles(id) ON DELETE CASCADE,
  tiers_id    BIGINT  NOT NULL REFERENCES registre_tiers(id) ON DELETE CASCADE,
  tenant_id   UUID    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, tiers_id)
);
CREATE TABLE IF NOT EXISTS com_article_magasins (
  article_id  BIGINT  NOT NULL REFERENCES com_articles(id) ON DELETE CASCADE,
  magasin_id  BIGINT  NOT NULL REFERENCES com_magasins(id) ON DELETE CASCADE,
  tenant_id   UUID    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, magasin_id)
);

-- ── Mouvements de stock (phase 1 : stock initial uniquement) ────────────────
CREATE TABLE IF NOT EXISTS com_stock_mouvements (
  id              BIGSERIAL      PRIMARY KEY,
  tenant_id       UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  article_id      BIGINT         NOT NULL REFERENCES com_articles(id),
  magasin_id      BIGINT         NOT NULL REFERENCES com_magasins(id),
  type            TEXT           NOT NULL CHECK (type IN ('stock_initial')),
  quantite        NUMERIC(18,3)  NOT NULL CHECK (quantite >= 0),
  date_mouvement  DATE           NOT NULL,
  piece           TEXT           NOT NULL DEFAULT '' CHECK (length(piece) <= 60),
  observation     TEXT           NOT NULL DEFAULT '' CHECK (length(observation) <= 500),
  cree_par        UUID           REFERENCES users(id) ON DELETE SET NULL,
  cree_le         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  modifie_par     UUID           REFERENCES users(id) ON DELETE SET NULL,
  modifie_le      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_com_stock_initial ON com_stock_mouvements (article_id, magasin_id) WHERE type = 'stock_initial';
CREATE INDEX IF NOT EXISTS idx_com_stock_article ON com_stock_mouvements (tenant_id, article_id, magasin_id);

-- ── Garde-fou : jamais de lien entre deux clients ───────────────────────────
-- Vérifie que chaque objet référencé appartient au même client que la ligne.
CREATE OR REPLACE FUNCTION com_meme_client() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ok BOOLEAN := true;
BEGIN
  IF TG_TABLE_NAME IN ('com_tiers', 'com_tiers_banque') THEN
    ok := EXISTS (SELECT 1 FROM registre_tiers WHERE id = NEW.tiers_id AND tenant_id = NEW.tenant_id);
  ELSIF TG_TABLE_NAME = 'com_famille_fournisseurs' THEN
    ok := EXISTS (SELECT 1 FROM com_familles WHERE id = NEW.famille_id AND tenant_id = NEW.tenant_id)
      AND EXISTS (SELECT 1 FROM registre_tiers WHERE id = NEW.tiers_id AND tenant_id = NEW.tenant_id);
  ELSIF TG_TABLE_NAME = 'com_article_fournisseurs' THEN
    ok := EXISTS (SELECT 1 FROM com_articles WHERE id = NEW.article_id AND tenant_id = NEW.tenant_id)
      AND EXISTS (SELECT 1 FROM registre_tiers WHERE id = NEW.tiers_id AND tenant_id = NEW.tenant_id);
  ELSIF TG_TABLE_NAME = 'com_article_magasins' OR TG_TABLE_NAME = 'com_stock_mouvements' THEN
    ok := EXISTS (SELECT 1 FROM com_articles WHERE id = NEW.article_id AND tenant_id = NEW.tenant_id)
      AND EXISTS (SELECT 1 FROM com_magasins WHERE id = NEW.magasin_id AND tenant_id = NEW.tenant_id);
  ELSIF TG_TABLE_NAME = 'com_articles' THEN
    ok := EXISTS (SELECT 1 FROM com_familles WHERE id = NEW.famille_id AND tenant_id = NEW.tenant_id)
      AND (NEW.taxe_id IS NULL OR EXISTS (SELECT 1 FROM com_taxes WHERE id = NEW.taxe_id AND tenant_id = NEW.tenant_id));
  ELSIF TG_TABLE_NAME = 'com_magasins' THEN
    ok := NEW.responsable_id IS NULL
       OR EXISTS (SELECT 1 FROM users WHERE id = NEW.responsable_id AND tenant_id = NEW.tenant_id);
  END IF;
  IF NOT ok THEN
    RAISE EXCEPTION 'Référence d''un autre client refusée (%).', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['com_tiers', 'com_tiers_banque', 'com_famille_fournisseurs', 'com_article_fournisseurs',
                           'com_article_magasins', 'com_stock_mouvements', 'com_articles', 'com_magasins'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_meme_client ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_meme_client BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION com_meme_client()', t, t);
  END LOOP;
END $$;

-- ── Permissions du module ───────────────────────────────────────────────────
INSERT INTO permissions (code, nom, module, description) VALUES
  ('com.parametrage.voir',     'Voir le paramétrage commercial',        'commercial', 'Société, magasins, familles, taxes, règles'),
  ('com.parametrage.modifier', 'Modifier le paramétrage commercial',    'commercial', 'Société, magasins, familles, taxes, règles'),
  ('com.articles.voir',        'Voir les articles',                     'commercial', 'Catalogue des articles et stock'),
  ('com.articles.modifier',    'Créer et modifier les articles',        'commercial', 'Fiche article, fournisseurs, magasins'),
  ('com.tiers.voir',           'Voir fournisseurs et clients',          'commercial', 'Fiches achats des tiers'),
  ('com.tiers.modifier',       'Créer et modifier fournisseurs et clients', 'commercial', 'Fiches achats des tiers'),
  ('com.tiers.banque',         'Coordonnées bancaires des tiers',       'commercial', 'Voir et modifier banque, RIB / IBAN'),
  ('com.stock.initial',        'Saisir le stock initial',               'commercial', 'Inventaire d''ouverture par magasin'),
  ('com.da.creer',             'Créer ses demandes d''achat',           'commercial', 'Exprimer un besoin d''achat'),
  ('com.da.voir_tout',         'Voir toutes les demandes d''achat',     'commercial', 'Consultation de toutes les demandes'),
  ('com.da.approuver',         'Approuver (étape achats)',              'commercial', 'Examiner les demandes au niveau achats'),
  ('com.da.approuver_direction', 'Approuver (étape direction)',         'commercial', 'Examiner les demandes au-delà du seuil'),
  ('com.bc.preparer',          'Préparer les bons de commande',         'commercial', 'Brouillons de bons de commande'),
  ('com.bc.emettre',           'Émettre les bons de commande',          'commercial', 'Émission officielle (numéro, PDF, QR code)'),
  ('com.bc.annuler',           'Annuler ou réviser un bon de commande', 'commercial', 'Annulation et révision avec motif'),
  ('com.documents.ajouter',    'Joindre proformas et justificatifs',    'commercial', 'Pièces jointes des achats'),
  ('com.tableau_bord.voir',    'Tableau de bord des achats',            'commercial', 'Suivi des demandes et des bons')
ON CONFLICT (code) DO NOTHING;

-- Directeur : tout le module (le serveur interdit toujours l'auto-validation).
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r, permissions p
 WHERE r.code = 'directeur' AND r.tenant_id IS NULL AND r.is_system AND p.module = 'commercial'
ON CONFLICT DO NOTHING;
-- Comptable (auditeur) : consultation.
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r, permissions p
 WHERE r.code = 'auditeur' AND r.tenant_id IS NULL AND r.is_system
   AND p.code IN ('com.parametrage.voir', 'com.articles.voir', 'com.tiers.voir', 'com.da.voir_tout', 'com.tableau_bord.voir')
ON CONFLICT DO NOTHING;
-- Collaborateur sans profil : demandeur.
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r, permissions p
 WHERE r.code = 'collaborateur' AND r.tenant_id IS NULL AND r.is_system
   AND p.code IN ('com.parametrage.voir', 'com.articles.voir', 'com.tiers.voir', 'com.da.creer', 'com.documents.ajouter')
ON CONFLICT DO NOTHING;

-- ── Module NJ COMMERCIAL : opérationnel, activé client par client ───────────
UPDATE modules
   SET statut = 'operationnel', route_accueil = '/commercial', prefixes_api = ARRAY['/commercial'], updated_at = NOW()
 WHERE code = 'commercial';
