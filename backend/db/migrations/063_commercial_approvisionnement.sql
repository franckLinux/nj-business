-- ============================================================================
-- 063 — NJ COMMERCIAL, lot 8 : circuit d'approvisionnement complet (12/11/2026)
--
--  A. Demande d'achat (expression de besoin)
--     • trois quantités par ligne : besoin exprimé (quantite_besoin), quantité
--       soumise (quantite_demandee) et quantité approuvée (quantite, colonne
--       historique : c'est elle que les bons de commande consomment) ;
--     • une ligne approuvée peut valoir 0 (article non retenu par le valideur) ;
--     • stock de sécurité = seuil d'alerte de l'article (décision du 12/11/2026) ;
--       quantité théorique = max(0, sécurité − (stock disponible − demandée)) ;
--     • com_decisions.details garde les quantités et fournisseurs fixés à la décision.
--  B. Fournisseur : délai habituel de livraison (nombre + jours calendaires / ouvrés).
--  C. Article : poids unitaire (kg par unité de stock), pour répartir des frais au poids.
--  D. Consultations (demandes de proforma) : fournisseurs consultés, lien individuel,
--     offres versionnées et intangibles, choix par article, bons générés.
--  E. Bons de commande : lien vers la consultation ; envoi au fournisseur tracé.
--  F. Frais accessoires d'achat (transport, douane, transit…) répartis sur les lignes
--     d'un bon et incorporés au coût d'entrée en stock (cout_frais du mouvement de
--     réception) ; le rejeu CMUP / FIFO existant recalcule tout le reste.
--  G. Droits : consultations, frais ; la facture fournisseur passe au COMPTABLE
--     (profil « Comptable (achats) », rôle système « Comptable ») ; le responsable et
--     le gestionnaire des achats ne la saisissent ni ne la valident plus.
--
--  Aucune donnée de caisse touchée. Idempotente.
--  Retour arrière : migrations-retour-arriere/063_retour_arriere.sql
-- ============================================================================

-- ── A. Demandes ────────────────────────────────────────────────────────────
ALTER TABLE com_demande_lignes ADD COLUMN IF NOT EXISTS quantite_besoin   NUMERIC(18,3);
ALTER TABLE com_demande_lignes ADD COLUMN IF NOT EXISTS quantite_demandee NUMERIC(18,3);
UPDATE com_demande_lignes SET quantite_besoin = quantite WHERE quantite_besoin IS NULL;
UPDATE com_demande_lignes SET quantite_demandee = quantite WHERE quantite_demandee IS NULL;
ALTER TABLE com_demande_lignes ALTER COLUMN quantite_besoin SET NOT NULL;
ALTER TABLE com_demande_lignes ALTER COLUMN quantite_demandee SET NOT NULL;
DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'com_demande_lignes'::regclass AND contype = 'c'
            AND pg_get_constraintdef(oid) ~ '\(quantite > ' LOOP
    EXECUTE format('ALTER TABLE com_demande_lignes DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE com_demande_lignes DROP CONSTRAINT IF EXISTS com_demande_lignes_quantites_check;
ALTER TABLE com_demande_lignes ADD CONSTRAINT com_demande_lignes_quantites_check
  CHECK (quantite >= 0 AND quantite_besoin >= 0 AND quantite_demandee > 0);
COMMENT ON COLUMN com_demande_lignes.quantite IS 'Quantité APPROUVÉE (égale à la quantité soumise tant que rien n''est décidé ; 0 = non retenue)';
COMMENT ON COLUMN com_demande_lignes.quantite_besoin IS 'Besoin exprimé par le demandeur (063)';
COMMENT ON COLUMN com_demande_lignes.quantite_demandee IS 'Quantité soumise pour achat (063)';
ALTER TABLE com_decisions ADD COLUMN IF NOT EXISTS details JSONB;

-- ── B. Délai de livraison des fournisseurs ─────────────────────────────────
ALTER TABLE com_tiers ADD COLUMN IF NOT EXISTS delai_livraison_jours SMALLINT;
ALTER TABLE com_tiers DROP CONSTRAINT IF EXISTS com_tiers_delai_check;
ALTER TABLE com_tiers ADD CONSTRAINT com_tiers_delai_check CHECK (delai_livraison_jours IS NULL OR delai_livraison_jours BETWEEN 0 AND 365);
ALTER TABLE com_tiers ADD COLUMN IF NOT EXISTS delai_type TEXT NOT NULL DEFAULT 'calendaires';
ALTER TABLE com_tiers DROP CONSTRAINT IF EXISTS com_tiers_delai_type_check;
ALTER TABLE com_tiers ADD CONSTRAINT com_tiers_delai_type_check CHECK (delai_type IN ('calendaires', 'ouvres'));

-- ── C. Poids des articles ──────────────────────────────────────────────────
ALTER TABLE com_articles ADD COLUMN IF NOT EXISTS poids_kg NUMERIC(18,3);
ALTER TABLE com_articles DROP CONSTRAINT IF EXISTS com_articles_poids_check;
ALTER TABLE com_articles ADD CONSTRAINT com_articles_poids_check CHECK (poids_kg IS NULL OR poids_kg > 0);
COMMENT ON COLUMN com_articles.poids_kg IS 'Poids d''une unité de stock, en kg (063, répartition des frais au poids)';

-- ── Compteurs et pièces jointes ────────────────────────────────────────────
ALTER TABLE com_compteurs DROP CONSTRAINT IF EXISTS com_compteurs_type_check;
ALTER TABLE com_compteurs ADD CONSTRAINT com_compteurs_type_check
  CHECK (type IN ('DA', 'BC', 'ENT', 'SOR', 'TRF', 'INV', 'REC', 'RFO', 'FFO', 'AVF', 'DEV', 'CDC', 'BLC', 'CON', 'FRA'));
ALTER TABLE com_documents DROP CONSTRAINT IF EXISTS com_documents_objet_type_check;
ALTER TABLE com_documents ADD CONSTRAINT com_documents_objet_type_check
  CHECK (objet_type IN ('demande', 'bon_commande', 'stock_doc', 'reception', 'retour_fourn', 'facture_fourn', 'devis', 'commande_client', 'livraison',
                        'offre', 'frais_achat'));

-- ── D. Consultations ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS com_consultations (
  id                   BIGSERIAL    PRIMARY KEY,
  tenant_id            UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  numero               TEXT         NOT NULL,
  demande_id           BIGINT       NOT NULL REFERENCES com_demandes(id),
  statut               TEXT         NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'lancee', 'attribuee', 'annulee')),
  date_limite          DATE         NOT NULL,
  delai_souhaite       TEXT         NOT NULL DEFAULT '' CHECK (length(delai_souhaite) <= 200),
  conditions_reponse   TEXT         NOT NULL DEFAULT '' CHECK (length(conditions_reponse) <= 2000),
  validite_offre_jours SMALLINT     NOT NULL DEFAULT 30 CHECK (validite_offre_jours BETWEEN 1 AND 365),
  derogation_motif     TEXT         NOT NULL DEFAULT '' CHECK (length(derogation_motif) <= 1000),
  observations         TEXT         NOT NULL DEFAULT '' CHECK (length(observations) <= 2000),
  cree_par             UUID         REFERENCES users(id) ON DELETE SET NULL,
  cree_le              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  lancee_par           UUID         REFERENCES users(id) ON DELETE SET NULL,
  lancee_le            TIMESTAMPTZ,
  attribuee_par        UUID         REFERENCES users(id) ON DELETE SET NULL,
  attribuee_le         TIMESTAMPTZ,
  annulee_par          UUID         REFERENCES users(id) ON DELETE SET NULL,
  annulee_le           TIMESTAMPTZ,
  motif_annulation     TEXT         NOT NULL DEFAULT '',
  modifie_le           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, numero)
);
-- Une seule consultation en cours par demande.
CREATE UNIQUE INDEX IF NOT EXISTS uq_com_consultation_en_cours ON com_consultations (demande_id) WHERE statut IN ('brouillon', 'lancee');

CREATE TABLE IF NOT EXISTS com_consultation_lignes (
  id                    BIGSERIAL     PRIMARY KEY,
  consultation_id       BIGINT        NOT NULL REFERENCES com_consultations(id) ON DELETE CASCADE,
  tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ordre                 INTEGER       NOT NULL DEFAULT 0,
  demande_ligne_id      BIGINT        NOT NULL REFERENCES com_demande_lignes(id),
  article_id            BIGINT        NOT NULL REFERENCES com_articles(id),
  reference             TEXT          NOT NULL,
  designation           TEXT          NOT NULL,
  quantite              NUMERIC(18,3) NOT NULL CHECK (quantite > 0),
  unite                 TEXT          NOT NULL,
  unite_id              BIGINT        REFERENCES com_unites(id),
  choix_offre_ligne_id  BIGINT,
  choix_motif           TEXT          NOT NULL DEFAULT '' CHECK (length(choix_motif) <= 500),
  UNIQUE (consultation_id, demande_ligne_id)
);

CREATE TABLE IF NOT EXISTS com_consultation_fournisseurs (
  id               BIGSERIAL    PRIMARY KEY,
  consultation_id  BIGINT       NOT NULL REFERENCES com_consultations(id) ON DELETE CASCADE,
  tenant_id        UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fournisseur_id   BIGINT       NOT NULL REFERENCES registre_tiers(id),
  jeton            TEXT         NOT NULL UNIQUE CHECK (length(jeton) >= 40),
  statut           TEXT         NOT NULL DEFAULT 'a_envoyer'
                   CHECK (statut IN ('a_envoyer', 'envoyee', 'consultee', 'offre_recue', 'sans_reponse', 'refusee')),
  envoi_mode       TEXT         NOT NULL DEFAULT '' CHECK (envoi_mode IN ('', 'email', 'manuel')),
  envoi_destinataire TEXT       NOT NULL DEFAULT '',
  envoye_le        TIMESTAMPTZ,
  envoye_par       UUID         REFERENCES users(id) ON DELETE SET NULL,
  consulte_le      TIMESTAMPTZ,
  nb_consultations INTEGER      NOT NULL DEFAULT 0,
  reponse_le       TIMESTAMPTZ,
  motif_refus      TEXT         NOT NULL DEFAULT '' CHECK (length(motif_refus) <= 1000),
  reouverte        BOOLEAN      NOT NULL DEFAULT false,
  reouverte_par    UUID         REFERENCES users(id) ON DELETE SET NULL,
  reouverte_le     TIMESTAMPTZ,
  motif_reouverture TEXT        NOT NULL DEFAULT '',
  UNIQUE (consultation_id, fournisseur_id)
);

CREATE TABLE IF NOT EXISTS com_offres (
  id                     BIGSERIAL     PRIMARY KEY,
  consultation_fournisseur_id BIGINT   NOT NULL REFERENCES com_consultation_fournisseurs(id) ON DELETE CASCADE,
  tenant_id              UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version                INTEGER       NOT NULL CHECK (version >= 1),
  soumise_le             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  signataire             TEXT          NOT NULL CHECK (length(signataire) BETWEEN 2 AND 150),
  delai_livraison_jours  SMALLINT      CHECK (delai_livraison_jours IS NULL OR delai_livraison_jours BETWEEN 0 AND 365),
  delai_type             TEXT          NOT NULL DEFAULT 'calendaires' CHECK (delai_type IN ('calendaires', 'ouvres')),
  conditions_paiement    TEXT          NOT NULL DEFAULT '' CHECK (length(conditions_paiement) <= 300),
  validite_jours         SMALLINT      CHECK (validite_jours IS NULL OR validite_jours BETWEEN 1 AND 365),
  observations           TEXT          NOT NULL DEFAULT '' CHECK (length(observations) <= 2000),
  total_ht               NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_taxes            NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_ttc              NUMERIC(18,2) NOT NULL DEFAULT 0,
  document_id            BIGINT,
  adresse_ip             TEXT          NOT NULL DEFAULT '',
  actuelle               BOOLEAN       NOT NULL DEFAULT true,
  UNIQUE (consultation_fournisseur_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_com_offre_actuelle ON com_offres (consultation_fournisseur_id) WHERE actuelle;

CREATE TABLE IF NOT EXISTS com_offre_lignes (
  id                     BIGSERIAL     PRIMARY KEY,
  offre_id               BIGINT        NOT NULL REFERENCES com_offres(id) ON DELETE CASCADE,
  consultation_ligne_id  BIGINT        NOT NULL REFERENCES com_consultation_lignes(id) ON DELETE CASCADE,
  disponibilite          TEXT          NOT NULL CHECK (disponibilite IN ('disponible', 'partielle', 'indisponible')),
  quantite_proposee      NUMERIC(18,3) NOT NULL DEFAULT 0 CHECK (quantite_proposee >= 0),
  prix_unitaire          NUMERIC(18,2) CHECK (prix_unitaire IS NULL OR prix_unitaire >= 0),
  taux_taxe              NUMERIC(7,4)  NOT NULL DEFAULT 0 CHECK (taux_taxe BETWEEN 0 AND 100),
  montant_ht             NUMERIC(18,2) NOT NULL DEFAULT 0,
  montant_taxe           NUMERIC(18,2) NOT NULL DEFAULT 0,
  observation            TEXT          NOT NULL DEFAULT '' CHECK (length(observation) <= 500),
  UNIQUE (offre_id, consultation_ligne_id)
);
ALTER TABLE com_consultation_lignes DROP CONSTRAINT IF EXISTS com_consultation_lignes_choix_fk;
ALTER TABLE com_consultation_lignes ADD CONSTRAINT com_consultation_lignes_choix_fk FOREIGN KEY (choix_offre_ligne_id) REFERENCES com_offre_lignes(id);

-- Une offre soumise est intangible : seule la marque « actuelle » change (nouvelle version).
CREATE OR REPLACE FUNCTION com_offres_proteger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'com_offre_lignes' THEN
    IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'OFFRE_INTANGIBLE: une offre soumise ne se modifie pas.'; END IF;
    IF TG_OP = 'DELETE' AND EXISTS (SELECT 1 FROM com_offres o WHERE o.id = OLD.offre_id) THEN
      RAISE EXCEPTION 'OFFRE_INTANGIBLE: une offre soumise ne se supprime pas.';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM com_consultation_fournisseurs cf WHERE cf.id = OLD.consultation_fournisseur_id) THEN
      RAISE EXCEPTION 'OFFRE_INTANGIBLE: une offre soumise ne se supprime pas.';
    END IF;
    RETURN OLD;
  END IF;
  IF (to_jsonb(NEW) - 'actuelle') <> (to_jsonb(OLD) - 'actuelle') THEN
    RAISE EXCEPTION 'OFFRE_INTANGIBLE: une offre soumise ne se modifie pas.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_com_offres_proteger ON com_offres;
CREATE TRIGGER trg_com_offres_proteger BEFORE UPDATE OR DELETE ON com_offres FOR EACH ROW EXECUTE FUNCTION com_offres_proteger();
DROP TRIGGER IF EXISTS trg_com_offre_lignes_proteger ON com_offre_lignes;
CREATE TRIGGER trg_com_offre_lignes_proteger BEFORE UPDATE OR DELETE ON com_offre_lignes FOR EACH ROW EXECUTE FUNCTION com_offres_proteger();

-- ── E. Bons de commande ────────────────────────────────────────────────────
ALTER TABLE com_bons_commande ADD COLUMN IF NOT EXISTS consultation_id BIGINT REFERENCES com_consultations(id);
ALTER TABLE com_bons_commande ADD COLUMN IF NOT EXISTS envoye_le TIMESTAMPTZ;
ALTER TABLE com_bons_commande ADD COLUMN IF NOT EXISTS envoye_par UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE com_bons_commande ADD COLUMN IF NOT EXISTS envoi_mode TEXT NOT NULL DEFAULT '';
ALTER TABLE com_bons_commande ADD COLUMN IF NOT EXISTS envoi_destinataire TEXT NOT NULL DEFAULT '';
ALTER TABLE com_bons_commande DROP CONSTRAINT IF EXISTS com_bons_commande_envoi_check;
ALTER TABLE com_bons_commande ADD CONSTRAINT com_bons_commande_envoi_check CHECK (envoi_mode IN ('', 'email', 'manuel'));
-- Un bon émis reste intangible ; seule la trace de son envoi au fournisseur peut s'y ajouter.
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
  IF OLD.statut = 'emis' AND NEW.statut IN ('annule', 'remplace')
     AND NEW.numero_complet = OLD.numero_complet AND NEW.jeton_verification = OLD.jeton_verification
     AND NEW.pdf_sha256 = OLD.pdf_sha256 AND NEW.pdf_chemin = OLD.pdf_chemin
     AND NEW.total_ttc = OLD.total_ttc AND NEW.total_ht = OLD.total_ht AND NEW.fournisseur_id = OLD.fournisseur_id
     AND NEW.emis_le = OLD.emis_le THEN
    RETURN NEW;
  END IF;
  -- 063 : envoi au fournisseur (date, auteur, mode, destinataire), rien d'autre.
  IF OLD.statut = 'emis' AND NEW.statut = 'emis'
     AND (to_jsonb(NEW) - ARRAY['envoye_le', 'envoye_par', 'envoi_mode', 'envoi_destinataire', 'modifie_le'])
       = (to_jsonb(OLD) - ARRAY['envoye_le', 'envoye_par', 'envoi_mode', 'envoi_destinataire', 'modifie_le']) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'BC_INTANGIBLE: un bon de commande émis ne se modifie pas ; annulez-le ou faites une révision.' USING ERRCODE = 'check_violation';
END $$;

-- ── F. Frais accessoires ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS com_frais_achat (
  id                BIGSERIAL     PRIMARY KEY,
  tenant_id         UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  numero            TEXT          NOT NULL,
  bc_id             BIGINT        NOT NULL REFERENCES com_bons_commande(id),
  rubrique          TEXT          NOT NULL CHECK (rubrique IN ('transport', 'douane', 'transit', 'manutention', 'livraison', 'assurance', 'autre')),
  libelle           TEXT          NOT NULL DEFAULT '' CHECK (length(libelle) <= 200),
  fournisseur_id    BIGINT        REFERENCES registre_tiers(id),
  fournisseur_nom   TEXT          NOT NULL CHECK (length(fournisseur_nom) BETWEEN 1 AND 150),
  reference_piece   TEXT          NOT NULL DEFAULT '' CHECK (length(reference_piece) <= 60),
  date_frais        DATE          NOT NULL,
  montant_ht        NUMERIC(18,2) NOT NULL CHECK (montant_ht > 0),
  montant_taxe      NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (montant_taxe >= 0),
  methode           TEXT          NOT NULL DEFAULT 'valeur' CHECK (methode IN ('quantite', 'valeur', 'poids', 'manuel')),
  statut            TEXT          NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'valide', 'annule')),
  observations      TEXT          NOT NULL DEFAULT '' CHECK (length(observations) <= 1000),
  cree_par          UUID          REFERENCES users(id) ON DELETE SET NULL,
  cree_le           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  valide_par        UUID          REFERENCES users(id) ON DELETE SET NULL,
  valide_le         TIMESTAMPTZ,
  annule_par        UUID          REFERENCES users(id) ON DELETE SET NULL,
  annule_le         TIMESTAMPTZ,
  motif_annulation  TEXT          NOT NULL DEFAULT '',
  modifie_le        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, numero)
);
COMMENT ON COLUMN com_frais_achat.montant_ht IS 'Montant incorporé au coût d''acquisition (hors taxes récupérables)';
COMMENT ON COLUMN com_frais_achat.montant_taxe IS 'Taxe de la pièce de frais : informative, jamais incorporée au coût du stock';
CREATE INDEX IF NOT EXISTS ix_com_frais_bc ON com_frais_achat (bc_id);

CREATE TABLE IF NOT EXISTS com_frais_repartition (
  frais_id     BIGINT        NOT NULL REFERENCES com_frais_achat(id) ON DELETE CASCADE,
  bc_ligne_id  BIGINT        NOT NULL REFERENCES com_bc_lignes(id),
  tenant_id    UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  article_id   BIGINT        NOT NULL REFERENCES com_articles(id),
  base         NUMERIC(18,6) NOT NULL DEFAULT 0,
  montant      NUMERIC(18,2) NOT NULL CHECK (montant >= 0),
  PRIMARY KEY (frais_id, bc_ligne_id)
);

-- Coût d'entrée d'une réception = coût d'achat net + part des frais (par unité de stock).
ALTER TABLE com_stock_mouvements ADD COLUMN IF NOT EXISTS cout_achat NUMERIC(18,6);
ALTER TABLE com_stock_mouvements ADD COLUMN IF NOT EXISTS cout_frais NUMERIC(18,6) NOT NULL DEFAULT 0;
ALTER TABLE com_stock_mouvements DROP CONSTRAINT IF EXISTS com_stock_mouvements_cout_frais_check;
ALTER TABLE com_stock_mouvements ADD CONSTRAINT com_stock_mouvements_cout_frais_check CHECK (cout_frais >= 0);
UPDATE com_stock_mouvements SET cout_achat = cout_unitaire WHERE type = 'reception' AND cout_achat IS NULL AND cout_unitaire IS NOT NULL;
COMMENT ON COLUMN com_stock_mouvements.cout_achat IS 'Réception : coût d''achat net par unité de stock (063) ; cout_unitaire = cout_achat + cout_frais';
COMMENT ON COLUMN com_stock_mouvements.cout_frais IS 'Réception : frais accessoires incorporés par unité de stock (063)';

-- ── G. Droits ──────────────────────────────────────────────────────────────
INSERT INTO permissions (code, nom, module, description) VALUES
  ('com.consultations.gerer',      'Consulter les fournisseurs (proformas)', 'commercial', 'Demandes de proforma, offres, comparaison, choix par article, bons générés'),
  ('com.consultations.derogation', 'Déroger au minimum de trois fournisseurs', 'commercial', 'Consultation à moins de trois fournisseurs, motif obligatoire'),
  ('com.frais.saisir',             'Saisir les frais accessoires d''achat',   'commercial', 'Transport, douane, transit… rattachés à un bon de commande'),
  ('com.frais.valider',            'Valider les frais accessoires d''achat',  'commercial', 'La validation incorpore les frais au coût du stock')
ON CONFLICT (code) DO NOTHING;

-- Trace des changements de droits (retour arrière).
CREATE TABLE IF NOT EXISTS com_droits_063 (
  role_id          BIGINT       NOT NULL,
  permission_code  VARCHAR(100) NOT NULL,
  operation        TEXT         NOT NULL CHECK (operation IN ('ajout', 'retrait')),
  PRIMARY KEY (role_id, permission_code, operation)
);

DO $$
DECLARE ra RECORD; rb RECORD; rc RECORD; rid BIGINT;
BEGIN
  -- Directeur (rôle système) : tout le nouveau.
  INSERT INTO role_permissions (role_id, permission_code)
  SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
   WHERE r.code = 'directeur' AND r.tenant_id IS NULL AND r.is_system
     AND p.code IN ('com.consultations.gerer', 'com.consultations.derogation', 'com.frais.saisir', 'com.frais.valider')
  ON CONFLICT DO NOTHING;
  -- Comptable (rôle système « auditeur ») : factures fournisseurs et frais.
  FOR ra IN SELECT id FROM roles WHERE code = 'auditeur' AND tenant_id IS NULL AND is_system LOOP
    INSERT INTO com_droits_063 (role_id, permission_code, operation)
    SELECT ra.id, c, 'ajout' FROM unnest(ARRAY['com.factures_fourn.voir', 'com.factures_fourn.saisir', 'com.factures_fourn.valider',
      'com.factures_fourn.annuler', 'com.frais.saisir', 'com.frais.valider']) c
     WHERE NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = ra.id AND rp.permission_code = c)
    ON CONFLICT DO NOTHING;
    INSERT INTO role_permissions (role_id, permission_code)
    SELECT ra.id, c FROM unnest(ARRAY['com.factures_fourn.voir', 'com.factures_fourn.saisir', 'com.factures_fourn.valider',
      'com.factures_fourn.annuler', 'com.frais.saisir', 'com.frais.valider']) c ON CONFLICT DO NOTHING;
  END LOOP;
  -- Profils métier des clients.
  FOR rb IN SELECT id, code, tenant_id FROM roles WHERE tenant_id IS NOT NULL AND code IN ('achats_responsable', 'achats_gestionnaire') LOOP
    IF rb.code = 'achats_responsable' THEN
      INSERT INTO com_droits_063 (role_id, permission_code, operation)
      SELECT rb.id, c, 'ajout' FROM unnest(ARRAY['com.consultations.gerer', 'com.consultations.derogation', 'com.frais.saisir']) c
       WHERE NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = rb.id AND rp.permission_code = c) ON CONFLICT DO NOTHING;
      INSERT INTO role_permissions (role_id, permission_code)
      SELECT rb.id, c FROM unnest(ARRAY['com.consultations.gerer', 'com.consultations.derogation', 'com.frais.saisir']) c ON CONFLICT DO NOTHING;
      INSERT INTO com_droits_063 (role_id, permission_code, operation)
      SELECT rb.id, permission_code, 'retrait' FROM role_permissions
       WHERE role_id = rb.id AND permission_code IN ('com.factures_fourn.saisir', 'com.factures_fourn.valider', 'com.factures_fourn.annuler') ON CONFLICT DO NOTHING;
      DELETE FROM role_permissions WHERE role_id = rb.id AND permission_code IN ('com.factures_fourn.saisir', 'com.factures_fourn.valider', 'com.factures_fourn.annuler');
    ELSE
      INSERT INTO com_droits_063 (role_id, permission_code, operation)
      SELECT rb.id, 'com.frais.saisir', 'ajout' WHERE NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id = rb.id AND permission_code = 'com.frais.saisir')
      ON CONFLICT DO NOTHING;
      INSERT INTO role_permissions (role_id, permission_code) VALUES (rb.id, 'com.frais.saisir') ON CONFLICT DO NOTHING;
      INSERT INTO com_droits_063 (role_id, permission_code, operation)
      SELECT rb.id, permission_code, 'retrait' FROM role_permissions
       WHERE role_id = rb.id AND permission_code IN ('com.factures_fourn.saisir', 'com.factures_fourn.valider', 'com.factures_fourn.annuler') ON CONFLICT DO NOTHING;
      DELETE FROM role_permissions WHERE role_id = rb.id AND permission_code IN ('com.factures_fourn.saisir', 'com.factures_fourn.valider', 'com.factures_fourn.annuler');
    END IF;
  END LOOP;
  -- Nouveau profil « Comptable (achats) » pour chaque client qui a déjà les profils achats.
  FOR rc IN SELECT DISTINCT tenant_id FROM roles WHERE tenant_id IS NOT NULL AND code = 'achats_responsable' LOOP
    SELECT id INTO rid FROM roles WHERE tenant_id = rc.tenant_id AND code = 'achats_comptable';
    IF rid IS NULL THEN
      INSERT INTO roles (nom, code, description, couleur, tenant_id, is_system)
      VALUES ('Comptable (achats)', 'achats_comptable', 'Saisit, contrôle et valide les factures fournisseurs ; enregistre les frais d''achat', '#b45309', rc.tenant_id, false)
      RETURNING id INTO rid;
      INSERT INTO role_permissions (role_id, permission_code)
      SELECT rid, p.code FROM permissions p WHERE p.code IN ('com.articles.voir', 'com.tiers.voir', 'com.da.voir_tout', 'com.tableau_bord.voir',
        'com.stock.voir', 'com.stock.valorisation', 'com.factures_fourn.voir', 'com.factures_fourn.saisir', 'com.factures_fourn.valider',
        'com.factures_fourn.annuler', 'com.frais.saisir', 'com.frais.valider')
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END $$;

-- Plafonds : un client dont le plafond ouvre déjà NJ COMMERCIAL reçoit les nouvelles permissions.
INSERT INTO tenant_permissions (tenant_id, permission_code)
SELECT DISTINCT tp.tenant_id, p.code
  FROM tenant_permissions tp JOIN permissions pc ON pc.code = tp.permission_code AND pc.module = 'commercial'
 CROSS JOIN permissions p
 WHERE p.code IN ('com.consultations.gerer', 'com.consultations.derogation', 'com.frais.saisir', 'com.frais.valider')
ON CONFLICT DO NOTHING;

-- Types de gestion (062) : la facture fournisseur sort du type « achats » ; les frais y entrent.
DO $$
BEGIN
  IF to_regclass('public.com_type_gestion_permissions_defaut') IS NOT NULL THEN
    DELETE FROM com_type_gestion_permissions_defaut WHERE type_code = 'achats' AND permission_code = 'com.factures_fourn.saisir';
    INSERT INTO com_type_gestion_permissions_defaut (type_code, permission_code) VALUES ('achats', 'com.frais.saisir') ON CONFLICT DO NOTHING;
  END IF;
END $$;
