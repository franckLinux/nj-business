-- ============================================================================
-- 083 — Gestion des activités simplifiée (ONG et associations), 25/11/2026.
--
-- Décisions de Franck :
--   • projets, chef de projet, activités et responsables se déclarent dans la
--     Configuration ;
--   • le responsable d'activité fait une DEMANDE DE FONDS (lignes budgétaires) ;
--     elle est validée par le chef de projet PUIS par le directeur ; validée,
--     elle devient le budget approuvé de la dépense ;
--   • la caissière décaisse (caisse ou banque) dans la limite approuvée ;
--   • le responsable déclare ses DÉPENSES avec pièces ; le comptable les
--     contrôle ; le RELIQUAT non dépensé est reversé en caisse ou en banque ;
--   • le rapport financier se génère à tout moment (dépenses en attente de
--     contrôle signalées).
--
-- Tables : projet_demandes_fonds, projet_demande_lignes, projet_demande_mouvements
-- (lien mouvement du journal ↔ demande : décaissement ou reversement), projet_depenses.
-- Le journal de caisse n'est pas modifié. Les budgets en versions (069-072)
-- restent en place et lisibles.
-- Additive et idempotente. Retour arrière : 083_retour_arriere.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS projet_demandes_fonds (
  id              BIGSERIAL     PRIMARY KEY,
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  numero          TEXT          NOT NULL DEFAULT '',
  projet_id       INTEGER       NOT NULL REFERENCES activites(id),
  activite_id     INTEGER       NOT NULL REFERENCES activites(id),
  objet           TEXT          NOT NULL CHECK (btrim(objet) <> '' AND length(objet) <= 300),
  date_besoin     DATE,
  statut          TEXT          NOT NULL DEFAULT 'brouillon'
                                CHECK (statut IN ('brouillon', 'soumise', 'validee_chef', 'approuvee', 'rejetee', 'annulee')),
  total           NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  demandeur_id    UUID          REFERENCES users(id) ON DELETE SET NULL,
  cree_le         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  soumis_le       TIMESTAMPTZ,
  chef_par        UUID          REFERENCES users(id) ON DELETE SET NULL,
  chef_le         TIMESTAMPTZ,
  directeur_par   UUID          REFERENCES users(id) ON DELETE SET NULL,
  directeur_le    TIMESTAMPTZ,
  motif           TEXT          NOT NULL DEFAULT '' CHECK (length(motif) <= 500),
  annule_par      UUID          REFERENCES users(id) ON DELETE SET NULL,
  annule_le       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_demandes_fonds ON projet_demandes_fonds (tenant_id, statut, id DESC);
CREATE INDEX IF NOT EXISTS idx_demandes_fonds_projet ON projet_demandes_fonds (tenant_id, projet_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_demandes_fonds_numero ON projet_demandes_fonds (tenant_id, numero) WHERE numero <> '';

CREATE TABLE IF NOT EXISTS projet_demande_lignes (
  id             BIGSERIAL     PRIMARY KEY,
  demande_id     BIGINT        NOT NULL REFERENCES projet_demandes_fonds(id) ON DELETE CASCADE,
  tenant_id      UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ordre          INTEGER       NOT NULL DEFAULT 0,
  designation    TEXT          NOT NULL CHECK (btrim(designation) <> '' AND length(designation) <= 300),
  quantite       NUMERIC(15,3) NOT NULL DEFAULT 1 CHECK (quantite > 0),
  jours          NUMERIC(10,2) CHECK (jours IS NULL OR jours > 0),
  prix_unitaire  NUMERIC(15,2) NOT NULL CHECK (prix_unitaire >= 0),
  montant        NUMERIC(15,2) NOT NULL CHECK (montant >= 0)
);
CREATE INDEX IF NOT EXISTS idx_demande_lignes ON projet_demande_lignes (demande_id, ordre);

CREATE TABLE IF NOT EXISTS projet_demande_mouvements (
  id           BIGSERIAL   PRIMARY KEY,
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  demande_id   BIGINT      NOT NULL REFERENCES projet_demandes_fonds(id),
  journal_id   BIGINT      NOT NULL UNIQUE REFERENCES journal(id),
  sens         TEXT        NOT NULL CHECK (sens IN ('decaissement', 'reversement')),
  cree_par     UUID        REFERENCES users(id) ON DELETE SET NULL,
  cree_le      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_demande_mouvements ON projet_demande_mouvements (demande_id);

CREATE TABLE IF NOT EXISTS projet_depenses (
  id              BIGSERIAL     PRIMARY KEY,
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  demande_id      BIGINT        NOT NULL REFERENCES projet_demandes_fonds(id),
  ligne_id        BIGINT        REFERENCES projet_demande_lignes(id) ON DELETE SET NULL,
  date_depense    DATE          NOT NULL,
  designation     TEXT          NOT NULL CHECK (btrim(designation) <> '' AND length(designation) <= 300),
  beneficiaire    TEXT          NOT NULL DEFAULT '' CHECK (length(beneficiaire) <= 200),
  montant         NUMERIC(15,2) NOT NULL CHECK (montant > 0),
  fichier_chemin  TEXT,
  fichier_nom     TEXT          NOT NULL DEFAULT '' CHECK (length(fichier_nom) <= 200),
  mime            TEXT          NOT NULL DEFAULT '',
  sha256          TEXT          NOT NULL DEFAULT '',
  statut          TEXT          NOT NULL DEFAULT 'declaree' CHECK (statut IN ('declaree', 'validee', 'rejetee')),
  declare_par     UUID          REFERENCES users(id) ON DELETE SET NULL,
  declare_le      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  controle_par    UUID          REFERENCES users(id) ON DELETE SET NULL,
  controle_le     TIMESTAMPTZ,
  motif           TEXT          NOT NULL DEFAULT '' CHECK (length(motif) <= 500),
  CONSTRAINT chk_depense_pas_autocontrole CHECK (controle_par IS NULL OR declare_par IS NULL OR controle_par <> declare_par),
  CONSTRAINT chk_depense_motif_rejet CHECK (statut <> 'rejetee' OR btrim(motif) <> '')
);
CREATE INDEX IF NOT EXISTS idx_projet_depenses ON projet_depenses (tenant_id, statut, demande_id);

-- ── Montants d'une demande (décaissé et reversé nets des annulations) ───────
CREATE OR REPLACE FUNCTION projet_demande_chiffres(p_demande BIGINT,
  OUT decaisse NUMERIC, OUT reverse NUMERIC, OUT depenses NUMERIC, OUT depenses_validees NUMERIC)
LANGUAGE sql STABLE AS $$
  SELECT
    coalesce((SELECT sum(j.sortie) FROM projet_demande_mouvements m JOIN journal j ON j.id = m.journal_id
               WHERE m.demande_id = p_demande AND m.sens = 'decaissement' AND NOT coalesce(j.annule, false)), 0),
    coalesce((SELECT sum(j.entree) FROM projet_demande_mouvements m JOIN journal j ON j.id = m.journal_id
               WHERE m.demande_id = p_demande AND m.sens = 'reversement' AND NOT coalesce(j.annule, false)), 0),
    coalesce((SELECT sum(montant) FROM projet_depenses WHERE demande_id = p_demande AND statut <> 'rejetee'), 0),
    coalesce((SELECT sum(montant) FROM projet_depenses WHERE demande_id = p_demande AND statut = 'validee'), 0);
$$;

-- ── Contrôles de la demande ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION projet_demande_controle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE a RECORD; p RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Suppression du client (plateforme) : tout part avec lui.
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN RETURN OLD; END IF;
    IF OLD.statut <> 'brouillon' THEN
      RAISE EXCEPTION 'DEMANDE_INTANGIBLE: seule une demande en brouillon se supprime ; annulez-la sinon.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  SELECT id, tenant_id, projet_id, actif INTO a FROM activites WHERE id = NEW.activite_id;
  IF a.id IS NULL OR a.tenant_id <> NEW.tenant_id OR a.projet_id IS DISTINCT FROM NEW.projet_id THEN
    RAISE EXCEPTION 'DEMANDE_INVALIDE: l''activité n''appartient pas à ce projet.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT tenant_est_ong(NEW.tenant_id) THEN
    RAISE EXCEPTION 'DEMANDE_INVALIDE: la gestion des activités est réservée aux ONG et associations.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.statut IS DISTINCT FROM OLD.statut THEN
    -- Circuit : brouillon → soumise → validee_chef → approuvee ; renvoi au brouillon ; rejet ; annulation.
    IF NOT (
         (OLD.statut = 'brouillon'    AND NEW.statut IN ('soumise', 'validee_chef', 'annulee'))
      OR (OLD.statut = 'soumise'      AND NEW.statut IN ('validee_chef', 'brouillon', 'rejetee', 'annulee'))
      OR (OLD.statut = 'validee_chef' AND NEW.statut IN ('approuvee', 'brouillon', 'rejetee', 'annulee'))
      OR (OLD.statut = 'approuvee'    AND NEW.statut = 'annulee')) THEN
      RAISE EXCEPTION 'DEMANDE_CIRCUIT: passage de « % » à « % » impossible.', OLD.statut, NEW.statut USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.statut = 'validee_chef' AND OLD.statut = 'soumise' THEN
      SELECT chef_projet_id INTO p FROM activites WHERE id = NEW.projet_id;
      IF p.chef_projet_id IS NOT NULL AND NEW.chef_par IS DISTINCT FROM p.chef_projet_id THEN
        RAISE EXCEPTION 'CHEF_SEUL: seul le chef de projet valide la demande à cette étape.' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF NEW.statut = 'approuvee' THEN
      IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.directeur_par AND role = 'directeur') THEN
        RAISE EXCEPTION 'DIRECTEUR_SEUL: seul le directeur approuve une demande de fonds.' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.total <= 0 THEN
        RAISE EXCEPTION 'DEMANDE_INVALIDE: une demande sans montant ne s''approuve pas.' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF NEW.statut = 'annulee' AND OLD.statut = 'approuvee'
       AND (SELECT decaisse FROM projet_demande_chiffres(NEW.id)) > 0 THEN
      RAISE EXCEPTION 'DEMANDE_DECAISSEE: des fonds ont été décaissés ; annulez d''abord la sortie en caisse.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.statut IN ('rejetee', 'annulee') AND btrim(NEW.motif) = '' THEN
      RAISE EXCEPTION 'MOTIF_OBLIGATOIRE: indiquez le motif.' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.statut <> 'brouillon'
        AND (NEW.total, NEW.objet, NEW.activite_id, NEW.projet_id) IS DISTINCT FROM (OLD.total, OLD.objet, OLD.activite_id, OLD.projet_id) THEN
    RAISE EXCEPTION 'DEMANDE_INTANGIBLE: une demande soumise ne se modifie plus ; elle doit être renvoyée au brouillon.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_projet_demande_controle ON projet_demandes_fonds;
CREATE TRIGGER trg_projet_demande_controle BEFORE INSERT OR UPDATE OR DELETE ON projet_demandes_fonds
  FOR EACH ROW EXECUTE FUNCTION projet_demande_controle();

CREATE OR REPLACE FUNCTION projet_demande_lignes_controle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE d RECORD;
BEGIN
  SELECT statut, tenant_id INTO d FROM projet_demandes_fonds WHERE id = COALESCE(NEW.demande_id, OLD.demande_id);
  IF d.statut IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;     -- demande supprimée (cascade)
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN RETURN OLD; END IF;
  IF d.statut <> 'brouillon' THEN
    RAISE EXCEPTION 'DEMANDE_INTANGIBLE: les lignes d''une demande soumise ne se modifient plus.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.tenant_id <> d.tenant_id THEN
    RAISE EXCEPTION 'DEMANDE_INVALIDE: ligne d''un autre client.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_projet_demande_lignes_controle ON projet_demande_lignes;
CREATE TRIGGER trg_projet_demande_lignes_controle BEFORE INSERT OR UPDATE OR DELETE ON projet_demande_lignes
  FOR EACH ROW EXECUTE FUNCTION projet_demande_lignes_controle();

-- ── Décaissement et reversement : un mouvement du journal relié à la demande ─
CREATE OR REPLACE FUNCTION projet_demande_mouvement_controle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE d RECORD; j RECORD; c RECORD;
BEGIN
  IF current_setting('app.journal_maintenance', true) = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN RETURN OLD; END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'LIEN_INTANGIBLE: le lien d''un mouvement à une demande ne se modifie pas ; annulez le mouvement en caisse.' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('demande_fonds:' || NEW.demande_id));
  SELECT * INTO d FROM projet_demandes_fonds WHERE id = NEW.demande_id;
  SELECT id, tenant_id, entree, sortie, activite_id, annulation_de_id INTO j FROM journal WHERE id = NEW.journal_id;
  IF d.id IS NULL OR j.id IS NULL OR d.tenant_id <> NEW.tenant_id OR j.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'LIEN_INVALIDE: demande ou mouvement introuvable pour ce client.' USING ERRCODE = 'check_violation';
  END IF;
  IF d.statut <> 'approuvee' THEN
    RAISE EXCEPTION 'DEMANDE_NON_APPROUVEE: la demande % n''est pas approuvée.', d.numero USING ERRCODE = 'check_violation';
  END IF;
  IF j.annulation_de_id IS NOT NULL OR j.activite_id IS DISTINCT FROM d.activite_id THEN
    RAISE EXCEPTION 'LIEN_INVALIDE: le mouvement doit porter l''activité de la demande.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO c FROM projet_demande_chiffres(d.id);
  IF NEW.sens = 'decaissement' THEN
    IF coalesce(j.sortie, 0) <= 0 THEN
      RAISE EXCEPTION 'LIEN_INVALIDE: un décaissement est une sortie.' USING ERRCODE = 'check_violation';
    END IF;
    -- Le mouvement est déjà au journal mais pas encore relié : c.decaisse ne le compte pas.
    IF c.decaisse + j.sortie > d.total THEN
      RAISE EXCEPTION 'DECAISSEMENT_DEPASSE: il reste % FCFA à décaisser sur la demande %.', d.total - c.decaisse, d.numero USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF coalesce(j.entree, 0) <= 0 THEN
      RAISE EXCEPTION 'LIEN_INVALIDE: un reversement est une entrée.' USING ERRCODE = 'check_violation';
    END IF;
    IF c.reverse + c.depenses + j.entree > c.decaisse THEN
      RAISE EXCEPTION 'REVERSEMENT_DEPASSE: le reliquat de la demande % est de % FCFA.', d.numero, greatest(c.decaisse - c.reverse - c.depenses, 0) USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_projet_demande_mouvement_controle ON projet_demande_mouvements;
CREATE TRIGGER trg_projet_demande_mouvement_controle BEFORE INSERT OR UPDATE OR DELETE ON projet_demande_mouvements
  FOR EACH ROW EXECUTE FUNCTION projet_demande_mouvement_controle();

-- ── Dépenses déclarées ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION projet_depense_controle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE d RECORD; c RECORD; ajout NUMERIC;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN RETURN OLD; END IF;
    IF OLD.statut <> 'declaree' THEN
      RAISE EXCEPTION 'DEPENSE_INTANGIBLE: une dépense contrôlée ne se supprime pas.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.statut <> 'declaree' THEN
      RAISE EXCEPTION 'DEPENSE_INTANGIBLE: une dépense contrôlée ne se modifie plus.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.statut <> 'declaree' THEN RETURN NEW; END IF;    -- décision du comptable
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('demande_fonds:' || NEW.demande_id));
  SELECT * INTO d FROM projet_demandes_fonds WHERE id = NEW.demande_id;
  IF d.id IS NULL OR d.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'DEPENSE_INVALIDE: demande introuvable pour ce client.' USING ERRCODE = 'check_violation';
  END IF;
  IF d.statut <> 'approuvee' THEN
    RAISE EXCEPTION 'DEPENSE_INVALIDE: la demande % n''est pas approuvée.', d.numero USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO c FROM projet_demande_chiffres(d.id);
  ajout := NEW.montant - CASE WHEN TG_OP = 'UPDATE' THEN OLD.montant ELSE 0 END;
  IF c.depenses + c.reverse + ajout > c.decaisse THEN
    RAISE EXCEPTION 'DEPENSES_DEPASSENT: les dépenses déclarées dépasseraient les fonds reçus (reste à justifier : % FCFA).',
      greatest(c.decaisse - c.depenses - c.reverse, 0) USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_projet_depense_controle ON projet_depenses;
CREATE TRIGGER trg_projet_depense_controle BEFORE INSERT OR UPDATE OR DELETE ON projet_depenses
  FOR EACH ROW EXECUTE FUNCTION projet_depense_controle();

