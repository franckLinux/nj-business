-- ============================================================================
-- 069 — Suivi de la caisse des projets (ONG et associations) — lot P1
--      (décisions du 19/11/2026, dossier NJ_BUSINESS_PROJETS_FINANCEMENTS_CONCEPTION)
--
-- Réservé aux clients dont la forme juridique est ONG ou ASSOC (mêmes codes
-- que la règle SYCEBNL de la 060). Les autres clients (PME) gardent NJ CAISSE
-- PRO à l'identique : les colonnes ajoutées ici restent vides pour eux.
--
-- 1. rubriques.nature_recette : nature d'une rubrique d'ENTRÉE. Les natures
--    « affectées » (financement de projet, subvention, don affecté,
--    contribution d'un partenaire, financement complémentaire) rendent le
--    choix du projet OBLIGATOIRE à la saisie du journal.
-- 2. activites : projet_id (activité d'un projet), chef_projet_id (sur le
--    projet), responsable_id (sur l'activité). Deux niveaux seulement.
--    Les lignes existantes ne changent pas.
-- 3. journal_imputations_projet : le LIEN entre une écriture d'entrée et le
--    projet bénéficiaire. Aucun montant : le financement reçu se relit
--    toujours dans le journal. Une écriture = un projet au plus. Lien figé :
--    une erreur se corrige par contre-passation puis nouvelle saisie.
-- 4. projet_budgets / projet_budget_lignes : budget du projet par activité,
--    chargé par le chef de projet, validé par le directeur. Une seule version
--    en vigueur par projet ; un budget validé est figé.
-- 5. Permissions du menu Projets (dans NJ CAISSE PRO).
-- 6. Préfixe /projets rattaché au module caisse.
--
-- Additive et idempotente. Aucune donnée de caisse n'est modifiée.
-- Retour arrière : db/migrations-retour-arriere/069_retour_arriere.sql
-- ============================================================================

-- ── 0. Forme juridique → client « ONG / association » ───────────────────────
CREATE OR REPLACE FUNCTION tenant_est_ong(p_tenant UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT upper(btrim(coalesce(forme_juridique, ''))) IN ('ONG', 'ASSOC')
                     FROM tenants WHERE id = p_tenant), false);
$$;

-- ── 1. Nature des recettes ──────────────────────────────────────────────────
ALTER TABLE rubriques ADD COLUMN IF NOT EXISTS nature_recette TEXT;
ALTER TABLE rubriques DROP CONSTRAINT IF EXISTS chk_rubriques_nature_recette;
ALTER TABLE rubriques ADD CONSTRAINT chk_rubriques_nature_recette CHECK (
  nature_recette IS NULL OR (type = 'entree' AND nature_recette IN (
    'financement_projet', 'subvention', 'don_affecte', 'contribution_partenaire',
    'financement_complementaire', 'fonctionnement', 'cotisations', 'autres')));

CREATE OR REPLACE FUNCTION nature_recette_affectee(p_nature TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(p_nature, '') IN ('financement_projet', 'subvention', 'don_affecte',
                                    'contribution_partenaire', 'financement_complementaire');
$$;

-- ── 2. Projets et activités ─────────────────────────────────────────────────
ALTER TABLE activites ADD COLUMN IF NOT EXISTS projet_id      INTEGER REFERENCES activites(id);
ALTER TABLE activites ADD COLUMN IF NOT EXISTS chef_projet_id UUID    REFERENCES users(id)     ON DELETE SET NULL;
ALTER TABLE activites ADD COLUMN IF NOT EXISTS responsable_id UUID    REFERENCES users(id)     ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_activites_projet ON activites (tenant_id, projet_id) WHERE projet_id IS NOT NULL;

-- Cohérence : une activité de projet est de type « activite » et pointe vers un
-- projet du MÊME client ; le chef de projet n'existe que sur un projet ; les
-- personnes désignées appartiennent au client.
CREATE OR REPLACE FUNCTION activites_projet_coherence() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE p RECORD;
BEGIN
  IF NEW.projet_id IS NOT NULL THEN
    IF NEW.type <> 'activite' THEN
      RAISE EXCEPTION 'PROJET_INCOHERENT: seule une activité peut appartenir à un projet.' USING ERRCODE = 'check_violation';
    END IF;
    SELECT id, tenant_id, type INTO p FROM activites WHERE id = NEW.projet_id;
    IF p.id IS NULL OR p.tenant_id <> NEW.tenant_id OR p.type <> 'projet' THEN
      RAISE EXCEPTION 'PROJET_INCOHERENT: le projet de rattachement est introuvable pour ce client.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.chef_projet_id IS NOT NULL AND NEW.type <> 'projet' THEN
    RAISE EXCEPTION 'PROJET_INCOHERENT: un chef de projet se désigne sur un projet.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.chef_projet_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.chef_projet_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'PROJET_INCOHERENT: le chef de projet n''appartient pas à ce client.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.responsable_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.responsable_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'PROJET_INCOHERENT: le responsable d''activité n''appartient pas à ce client.' USING ERRCODE = 'check_violation';
  END IF;
  -- Un projet qui a des activités ne change pas de type.
  IF TG_OP = 'UPDATE' AND OLD.type = 'projet' AND NEW.type <> 'projet'
     AND EXISTS (SELECT 1 FROM activites WHERE projet_id = NEW.id) THEN
    RAISE EXCEPTION 'PROJET_INCOHERENT: ce projet a des activités, il reste un projet.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_activites_projet_coherence ON activites;
CREATE TRIGGER trg_activites_projet_coherence BEFORE INSERT OR UPDATE ON activites
  FOR EACH ROW EXECUTE FUNCTION activites_projet_coherence();

-- ── 3. Lien écriture d'entrée ↔ projet ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS journal_imputations_projet (
  id                     BIGSERIAL   PRIMARY KEY,
  tenant_id              UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  journal_id             BIGINT      NOT NULL UNIQUE REFERENCES journal(id),
  projet_id              INTEGER     NOT NULL REFERENCES activites(id),
  nature_recette         TEXT        NOT NULL,
  reference_financement  TEXT        NOT NULL DEFAULT '' CHECK (length(reference_financement) <= 120),
  impute_par             UUID        REFERENCES users(id) ON DELETE SET NULL,
  impute_le              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_imputations_projet ON journal_imputations_projet (tenant_id, projet_id);

CREATE OR REPLACE FUNCTION imputation_projet_controle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE j RECORD; p RECORD;
BEGIN
  IF current_setting('app.journal_maintenance', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'IMPUTATION_INTANGIBLE: le projet d''une écriture ne se modifie pas ; annulez l''écriture puis ressaisissez-la.'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT id, tenant_id, entree, annulation_de_id INTO j FROM journal WHERE id = NEW.journal_id;
  IF j.id IS NULL OR j.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'IMPUTATION_INVALIDE: écriture introuvable pour ce client.' USING ERRCODE = 'check_violation';
  END IF;
  IF j.annulation_de_id IS NOT NULL OR coalesce(j.entree, 0) <= 0 THEN
    RAISE EXCEPTION 'IMPUTATION_INVALIDE: seule une entrée (hors contre-passation) se rattache à un projet.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT id, tenant_id, type INTO p FROM activites WHERE id = NEW.projet_id;
  IF p.id IS NULL OR p.tenant_id <> NEW.tenant_id OR p.type <> 'projet' THEN
    RAISE EXCEPTION 'IMPUTATION_INVALIDE: projet introuvable pour ce client.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT tenant_est_ong(NEW.tenant_id) THEN
    RAISE EXCEPTION 'IMPUTATION_INVALIDE: le suivi des projets est réservé aux ONG et associations.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_imputation_projet_controle ON journal_imputations_projet;
CREATE TRIGGER trg_imputation_projet_controle BEFORE INSERT OR UPDATE OR DELETE ON journal_imputations_projet
  FOR EACH ROW EXECUTE FUNCTION imputation_projet_controle();

-- ── 4. Budget du projet ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projet_budgets (
  id           BIGSERIAL   PRIMARY KEY,
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  projet_id    INTEGER     NOT NULL REFERENCES activites(id),
  version      INTEGER     NOT NULL DEFAULT 1,
  statut       TEXT        NOT NULL DEFAULT 'brouillon'
                           CHECK (statut IN ('brouillon', 'soumis', 'valide', 'rejete', 'remplace')),
  commentaire  TEXT        NOT NULL DEFAULT '' CHECK (length(commentaire) <= 2000),
  motif_rejet  TEXT        NOT NULL DEFAULT '' CHECK (length(motif_rejet) <= 2000),
  cree_par     UUID        REFERENCES users(id) ON DELETE SET NULL,
  cree_le      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  soumis_par   UUID        REFERENCES users(id) ON DELETE SET NULL,
  soumis_le    TIMESTAMPTZ,
  decide_par   UUID        REFERENCES users(id) ON DELETE SET NULL,
  decide_le    TIMESTAMPTZ,
  UNIQUE (projet_id, version)
);
-- Au plus UN budget en vigueur et UN budget en préparation par projet.
CREATE UNIQUE INDEX IF NOT EXISTS uq_projet_budget_valide  ON projet_budgets (projet_id) WHERE statut = 'valide';
CREATE UNIQUE INDEX IF NOT EXISTS uq_projet_budget_ouvert  ON projet_budgets (projet_id) WHERE statut IN ('brouillon', 'soumis');
CREATE INDEX IF NOT EXISTS idx_projet_budgets_tenant ON projet_budgets (tenant_id, statut);

CREATE TABLE IF NOT EXISTS projet_budget_lignes (
  id           BIGSERIAL     PRIMARY KEY,
  tenant_id    UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  budget_id    BIGINT        NOT NULL REFERENCES projet_budgets(id) ON DELETE CASCADE,
  activite_id  INTEGER       NOT NULL REFERENCES activites(id),
  montant      NUMERIC(15,2) NOT NULL CHECK (montant >= 0),
  UNIQUE (budget_id, activite_id)
);
CREATE INDEX IF NOT EXISTS idx_projet_budget_lignes_activite ON projet_budget_lignes (activite_id);

-- Un budget sorti du brouillon est figé : ses lignes ne bougent plus, il ne se
-- supprime plus ; seul son statut avance (soumis → validé / rejeté ;
-- validé → remplacé quand un nouveau budget est validé).
CREATE OR REPLACE FUNCTION projet_budget_proteger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.journal_maintenance', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.statut <> 'brouillon' THEN
      RAISE EXCEPTION 'BUDGET_FIGE: un budget soumis ou validé ne se supprime pas.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NOT tenant_est_ong(NEW.tenant_id) THEN
    RAISE EXCEPTION 'BUDGET_INVALIDE: le suivi des projets est réservé aux ONG et associations.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM activites WHERE id = NEW.projet_id AND tenant_id = NEW.tenant_id AND type = 'projet') THEN
    RAISE EXCEPTION 'BUDGET_INVALIDE: projet introuvable pour ce client.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.projet_id <> OLD.projet_id OR NEW.version <> OLD.version THEN
      RAISE EXCEPTION 'BUDGET_FIGE: le projet et la version d''un budget ne changent pas.' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT ((OLD.statut = NEW.statut)
         OR (OLD.statut = 'brouillon' AND NEW.statut = 'soumis')
         OR (OLD.statut = 'soumis'    AND NEW.statut IN ('valide', 'rejete', 'brouillon'))
         OR (OLD.statut = 'rejete'    AND NEW.statut = 'brouillon')
         OR (OLD.statut = 'valide'    AND NEW.statut = 'remplace')) THEN
      RAISE EXCEPTION 'BUDGET_FIGE: passage de « % » à « % » impossible.', OLD.statut, NEW.statut USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.statut IN ('valide', 'remplace') AND NEW.statut = OLD.statut
       AND (NEW.commentaire IS DISTINCT FROM OLD.commentaire OR NEW.decide_par IS DISTINCT FROM OLD.decide_par
            OR NEW.decide_le IS DISTINCT FROM OLD.decide_le) THEN
      RAISE EXCEPTION 'BUDGET_FIGE: un budget validé ne se modifie pas.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_projet_budget_proteger ON projet_budgets;
CREATE TRIGGER trg_projet_budget_proteger BEFORE INSERT OR UPDATE OR DELETE ON projet_budgets
  FOR EACH ROW EXECUTE FUNCTION projet_budget_proteger();

CREATE OR REPLACE FUNCTION projet_budget_ligne_proteger() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE b RECORD; a RECORD;
BEGIN
  IF current_setting('app.journal_maintenance', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT id, tenant_id, projet_id, statut INTO b FROM projet_budgets WHERE id = COALESCE(NEW.budget_id, OLD.budget_id);
  -- Suppression en cascade d'un brouillon : le budget n'existe déjà plus.
  IF b.id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF b.statut <> 'brouillon' THEN
    RAISE EXCEPTION 'BUDGET_FIGE: les lignes d''un budget soumis ou validé ne se modifient pas.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  SELECT id, tenant_id, projet_id INTO a FROM activites WHERE id = NEW.activite_id;
  IF a.id IS NULL OR a.tenant_id <> b.tenant_id OR a.projet_id IS DISTINCT FROM b.projet_id OR NEW.tenant_id <> b.tenant_id THEN
    RAISE EXCEPTION 'BUDGET_INVALIDE: cette activité n''appartient pas au projet du budget.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_projet_budget_ligne_proteger ON projet_budget_lignes;
CREATE TRIGGER trg_projet_budget_ligne_proteger BEFORE INSERT OR UPDATE OR DELETE ON projet_budget_lignes
  FOR EACH ROW EXECUTE FUNCTION projet_budget_ligne_proteger();

-- ── 5. Permissions (menu Projets, dans NJ CAISSE PRO) ───────────────────────
-- Le chef de projet et le responsable d'activité n'ont pas de rôle propre :
-- leur DÉSIGNATION sur un projet ou une activité leur ouvre ce projet ou
-- cette activité (contrôle par l'API). Les permissions ci-dessous servent à
-- la direction et au comptable.
INSERT INTO permissions(code, nom, module, description) VALUES
  ('projets.voir',            'Voir tous les projets',          'projets',
   'Consulter tous les projets, leurs financements, l''argent alloué et le bilan'),
  ('projets.gerer',           'Gérer les projets',              'projets',
   'Créer les projets et leurs activités, désigner chefs de projet et responsables d''activité'),
  ('budgets_projet.valider',  'Valider les budgets de projet',  'projets',
   'Valider ou rejeter le budget soumis par le chef de projet'),
  ('justificatifs.valider',   'Valider les justificatifs',      'projets',
   'Valider ou rejeter les justificatifs déposés par les responsables d''activité (jamais les siens)'),
  ('justificatifs.annuler',   'Annuler un justificatif validé', 'projets',
   'Annuler un justificatif déjà validé, motif obligatoire (tracé)')
ON CONFLICT (code) DO NOTHING;

-- Directeur : tout, sauf la validation des justificatifs (chef de projet ou comptable).
INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, v.code FROM roles r
 CROSS JOIN (VALUES ('projets.voir'), ('projets.gerer'), ('budgets_projet.valider'), ('justificatifs.annuler')) AS v(code)
 WHERE r.code = 'directeur' AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;
-- Comptable (code auditeur) et comptable cabinet : consultation et validation des justificatifs.
INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, v.code FROM roles r
 CROSS JOIN (VALUES ('projets.voir'), ('justificatifs.valider')) AS v(code)
 WHERE r.code IN ('auditeur', 'comptable_cabinet') AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;

-- Clients ayant un plafond configuré : nouveaux codes ouverts là où le journal l'est.
INSERT INTO tenant_permissions(tenant_id, permission_code)
SELECT DISTINCT tp.tenant_id, v.code FROM tenant_permissions tp
 CROSS JOIN (VALUES ('projets.voir'), ('projets.gerer'), ('budgets_projet.valider'),
                    ('justificatifs.valider'), ('justificatifs.annuler')) AS v(code)
 WHERE tp.permission_code = 'journal.view'
ON CONFLICT DO NOTHING;

-- ── 6. Les routes /projets relèvent du module caisse ────────────────────────
UPDATE modules SET prefixes_api = array_append(prefixes_api, '/projets'), updated_at = NOW()
 WHERE code = 'caisse' AND NOT ('/projets' = ANY (prefixes_api));
