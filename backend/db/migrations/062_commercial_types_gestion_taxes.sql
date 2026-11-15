-- ============================================================================
-- 062 — NJ COMMERCIAL : types de gestion des utilisateurs ; taxes choisies à la
--       saisie des opérations, plus sur les familles ni les articles (12/11/2026)
--
--  A. TYPES DE GESTION (achats, ventes, stock)
--     Le type de gestion dit DANS QUEL DOMAINE une personne travaille ; il ne
--     dit rien de son niveau hiérarchique. Les deux notions restent séparées :
--       • rôle système (directeur, collaborateur…) et profil métier
--         (users.custom_role_id) : le niveau, dont les VALIDATIONS
--         (approuver, émettre, valider, annuler) ;
--       • type(s) de gestion (zéro, un ou plusieurs par personne) : les droits
--         FONCTIONNELS du domaine (consulter, saisir, enregistrer).
--     Chaque type ouvre un lot de permissions com.* :
--       • lot PAR DÉFAUT (com_type_gestion_permissions_defaut), le même partout ;
--       • lot PERSONNALISÉ par un client (com_types_gestion_client marque le
--         type comme personnalisé, com_type_gestion_permissions_client porte
--         son contenu, éventuellement vide). Ajouter un type ou une permission
--         au catalogue se fait par une simple ligne : la gestion est évolutive.
--     Résolution (services/permission.service.js) : les permissions des types
--     s'AJOUTENT à la base (rôle / profil), puis les exceptions individuelles
--     (refus compris) et le plafond du client s'appliquent comme avant.
--
--  B. TAXES
--     Les taxes ne se définissent plus sur les familles ni sur les articles :
--     elles se choisissent sur chaque ligne d'opération (bon de commande,
--     facture fournisseur, devis…), où le taux est copié comme avant. Les
--     valeurs actuelles sont ARCHIVÉES dans com_taxes_fiches_062 (retour
--     arrière possible) puis remises à vide. Les colonnes restent en base,
--     sans usage. Aucun document enregistré n'est touché : HT, taxes et TTC
--     des documents passés ne bougent pas.
--
--  Aucune donnée de caisse touchée. Idempotente.
--  Retour arrière : migrations-retour-arriere/062_retour_arriere.sql
-- ============================================================================

-- ── A. Types de gestion ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS com_types_gestion (
  code         TEXT        PRIMARY KEY CHECK (code ~ '^[a-z][a-z_]{1,29}$'),
  libelle      TEXT        NOT NULL CHECK (length(libelle) BETWEEN 1 AND 80),
  description  TEXT        NOT NULL DEFAULT '',
  ordre        SMALLINT    NOT NULL DEFAULT 0,
  actif        BOOLEAN     NOT NULL DEFAULT true
);
COMMENT ON TABLE com_types_gestion IS 'Domaines fonctionnels de NJ COMMERCIAL (062) — distincts du rôle hiérarchique';

INSERT INTO com_types_gestion (code, libelle, description, ordre) VALUES
  ('achats', 'Gestion des achats',
   'Responsable ou agent des achats, gestionnaire des approvisionnements : fournisseurs, demandes, commandes fournisseurs, réceptions, historique des achats.', 1),
  ('ventes', 'Gestion des ventes',
   'Responsable ou agent commercial, caissier-vendeur, responsable de facturation : clients, devis, commandes clients, suivi des opérations de vente.', 2),
  ('stock',  'Gestion de stock',
   'Responsable de stock, magasinier, gestionnaire de magasin : articles et stocks, entrées, sorties, transferts, inventaires, mouvements.', 3)
ON CONFLICT (code) DO UPDATE SET libelle = EXCLUDED.libelle, description = EXCLUDED.description, ordre = EXCLUDED.ordre;

-- Lots par défaut.
CREATE TABLE IF NOT EXISTS com_type_gestion_permissions_defaut (
  type_code        TEXT         NOT NULL REFERENCES com_types_gestion(code) ON DELETE CASCADE,
  permission_code  VARCHAR(100) NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (type_code, permission_code),
  CHECK (permission_code LIKE 'com.%')
);

-- Seules les permissions présentes au catalogue sont reprises (aucune erreur si
-- un lot plus ancien manque) ; validations et annulations restent au rôle.
INSERT INTO com_type_gestion_permissions_defaut (type_code, permission_code)
SELECT v.t, p.code
  FROM (VALUES
    ('achats', 'com.tiers.voir'), ('achats', 'com.articles.voir'), ('achats', 'com.stock.voir'),
    ('achats', 'com.da.creer'), ('achats', 'com.da.voir_tout'), ('achats', 'com.bc.preparer'),
    ('achats', 'com.documents.ajouter'), ('achats', 'com.receptions.saisir'), ('achats', 'com.retours_fourn.saisir'),
    ('achats', 'com.factures_fourn.voir'), ('achats', 'com.factures_fourn.saisir'), ('achats', 'com.tableau_bord.voir'),
    ('ventes', 'com.tiers.voir'), ('ventes', 'com.articles.voir'), ('ventes', 'com.stock.voir'),
    ('ventes', 'com.ventes.voir'), ('ventes', 'com.ventes.devis'), ('ventes', 'com.ventes.commandes'),
    ('stock',  'com.articles.voir'), ('stock', 'com.stock.voir'), ('stock', 'com.stock.entree'),
    ('stock',  'com.stock.sortie'), ('stock', 'com.stock.transfert'), ('stock', 'com.stock.inventaire'),
    ('stock',  'com.stock.journal')
  ) AS v(t, c)
  JOIN permissions p ON p.code = v.c
ON CONFLICT DO NOTHING;

-- Personnalisation par client : le marqueur dit « ce client a choisi son propre
-- lot pour ce type » ; le contenu peut être vide (type sans droit chez lui).
CREATE TABLE IF NOT EXISTS com_types_gestion_client (
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type_code        TEXT        NOT NULL REFERENCES com_types_gestion(code) ON DELETE CASCADE,
  personnalise_par UUID        REFERENCES users(id) ON DELETE SET NULL,
  personnalise_le  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, type_code)
);
CREATE TABLE IF NOT EXISTS com_type_gestion_permissions_client (
  tenant_id        UUID         NOT NULL,
  type_code        TEXT         NOT NULL,
  permission_code  VARCHAR(100) NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (tenant_id, type_code, permission_code),
  FOREIGN KEY (tenant_id, type_code) REFERENCES com_types_gestion_client(tenant_id, type_code) ON DELETE CASCADE,
  CHECK (permission_code LIKE 'com.%')
);

-- Types de gestion de chaque personne (plusieurs possibles).
CREATE TABLE IF NOT EXISTS com_utilisateur_types_gestion (
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type_code    TEXT        NOT NULL REFERENCES com_types_gestion(code) ON DELETE CASCADE,
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  attribue_par UUID        REFERENCES users(id) ON DELETE SET NULL,
  attribue_le  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, type_code)
);
CREATE INDEX IF NOT EXISTS ix_com_utg_tenant ON com_utilisateur_types_gestion (tenant_id);

-- La personne appartient au client de la ligne.
CREATE OR REPLACE FUNCTION com_meme_client_g() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Référence d''un autre client refusée (%).', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_com_utilisateur_types_gestion_meme_client_g ON com_utilisateur_types_gestion;
CREATE TRIGGER trg_com_utilisateur_types_gestion_meme_client_g BEFORE INSERT OR UPDATE ON com_utilisateur_types_gestion
  FOR EACH ROW EXECUTE FUNCTION com_meme_client_g();

-- ── B. Taxes : archivées puis retirées des familles et des articles ─────────
CREATE TABLE IF NOT EXISTS com_taxes_fiches_062 (
  objet          TEXT        NOT NULL CHECK (objet IN ('famille', 'article')),
  objet_id       BIGINT      NOT NULL,
  tenant_id      UUID        NOT NULL,
  taxe_achat_id  BIGINT,
  taxe_vente_id  BIGINT,
  archive_le     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (objet, objet_id)
);
COMMENT ON TABLE com_taxes_fiches_062 IS 'Taxes portées par les familles et articles avant la 062 (pour le retour arrière)';

INSERT INTO com_taxes_fiches_062 (objet, objet_id, tenant_id, taxe_achat_id, taxe_vente_id)
SELECT 'famille', id, tenant_id, taxe_achat_id, taxe_vente_id FROM com_familles
 WHERE taxe_achat_id IS NOT NULL OR taxe_vente_id IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO com_taxes_fiches_062 (objet, objet_id, tenant_id, taxe_achat_id, taxe_vente_id)
SELECT 'article', id, tenant_id, taxe_id, taxe_vente_id FROM com_articles
 WHERE taxe_id IS NOT NULL OR taxe_vente_id IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE com_familles SET taxe_achat_id = NULL, taxe_vente_id = NULL WHERE taxe_achat_id IS NOT NULL OR taxe_vente_id IS NOT NULL;
UPDATE com_articles SET taxe_id = NULL, taxe_vente_id = NULL WHERE taxe_id IS NOT NULL OR taxe_vente_id IS NOT NULL;

COMMENT ON COLUMN com_familles.taxe_achat_id IS 'Sans usage depuis la 062 : la taxe se choisit à la saisie de l''opération';
COMMENT ON COLUMN com_familles.taxe_vente_id IS 'Sans usage depuis la 062 : la taxe se choisit à la saisie de l''opération';
COMMENT ON COLUMN com_articles.taxe_id       IS 'Sans usage depuis la 062 : la taxe se choisit à la saisie de l''opération';
COMMENT ON COLUMN com_articles.taxe_vente_id IS 'Sans usage depuis la 062 : la taxe se choisit à la saisie de l''opération';
