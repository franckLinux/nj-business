-- ============================================================================
-- 086 — Gestion des activités : ordres de décaissement (26/11/2026).
--
-- Décision de Franck : quand le chef de projet initie le décaissement d'une
-- demande de fonds approuvée, le paiement passe EN ATTENTE ; la caissière
-- valide la sortie, et c'est seulement alors que le mouvement de sortie de
-- caisse est écrit, avec impression du bon de sortie : on est sûr que c'est la
-- caissière qui a fait sortir l'argent.
--
-- projet_ordres_decaissement : en_attente → execute (mouvement du journal) |
-- refuse (par la caisse, motif) | annule (par l'initiateur ou le directeur).
-- Un décaissement relié à une demande exige désormais un ordre en attente
-- (contrôle dans projet_demande_mouvement_controle).
-- Additive et idempotente. Retour arrière : 086_retour_arriere.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS projet_ordres_decaissement (
  id             BIGSERIAL     PRIMARY KEY,
  tenant_id      UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  demande_id     BIGINT        NOT NULL REFERENCES projet_demandes_fonds(id) ON DELETE CASCADE,
  montant        NUMERIC(15,2) NOT NULL CHECK (montant > 0),
  beneficiaire   TEXT          NOT NULL DEFAULT '' CHECK (length(beneficiaire) <= 150),
  instructions   TEXT          NOT NULL DEFAULT '' CHECK (length(instructions) <= 300),
  statut         TEXT          NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'execute', 'refuse', 'annule')),
  initie_par     UUID          REFERENCES users(id) ON DELETE SET NULL,
  initie_le      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  traite_par     UUID          REFERENCES users(id) ON DELETE SET NULL,
  traite_le      TIMESTAMPTZ,
  motif          TEXT          NOT NULL DEFAULT '' CHECK (length(motif) <= 300),
  journal_id     BIGINT        UNIQUE REFERENCES journal(id),
  CHECK ((statut = 'execute') = (journal_id IS NOT NULL)),
  CHECK (statut NOT IN ('refuse', 'annule') OR btrim(motif) <> ''),
  -- La caissière qui exécute n'est jamais celle qui a initié.
  CHECK (statut <> 'execute' OR traite_par IS DISTINCT FROM initie_par)
);
CREATE INDEX IF NOT EXISTS idx_ordres_decaissement ON projet_ordres_decaissement (tenant_id, statut, id DESC);
CREATE INDEX IF NOT EXISTS idx_ordres_decaissement_demande ON projet_ordres_decaissement (demande_id);

ALTER TABLE projet_demande_mouvements ADD COLUMN IF NOT EXISTS ordre_id BIGINT REFERENCES projet_ordres_decaissement(id);

-- Un décaissement relié à une demande passe par un ordre en attente, du même montant.
CREATE OR REPLACE FUNCTION projet_demande_mouvement_controle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE d RECORD; j RECORD; c RECORD; o RECORD;
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
    IF NEW.ordre_id IS NULL THEN
      RAISE EXCEPTION 'ORDRE_REQUIS: le décaissement d''une demande de fonds passe par un ordre de décaissement initié par le chef de projet, puis validé par la caisse.' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO o FROM projet_ordres_decaissement WHERE id = NEW.ordre_id;
    IF o.id IS NULL OR o.demande_id <> d.id OR o.statut <> 'en_attente' OR o.montant <> j.sortie THEN
      RAISE EXCEPTION 'ORDRE_INVALIDE: l''ordre de décaissement n''est pas en attente pour ce montant.' USING ERRCODE = 'check_violation';
    END IF;
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


-- Les ordres en attente comptent dans ce qui reste à initier : jamais plus que l'approuvé.
CREATE OR REPLACE FUNCTION projet_ordre_controle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE d RECORD; c RECORD; attente NUMERIC;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.statut <> 'en_attente' THEN
      RAISE EXCEPTION 'ORDRE_INTANGIBLE: un ordre traité ne se modifie plus.' USING ERRCODE = 'check_violation';
    END IF;
    IF (NEW.montant, NEW.demande_id) IS DISTINCT FROM (OLD.montant, OLD.demande_id) THEN
      RAISE EXCEPTION 'ORDRE_INTANGIBLE: montant et demande d''un ordre ne se modifient pas.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('demande_fonds:' || NEW.demande_id));
  SELECT * INTO d FROM projet_demandes_fonds WHERE id = NEW.demande_id;
  IF d.id IS NULL OR d.tenant_id <> NEW.tenant_id OR d.statut <> 'approuvee' THEN
    RAISE EXCEPTION 'DEMANDE_NON_APPROUVEE: la demande n''est pas approuvée.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO c FROM projet_demande_chiffres(d.id);
  SELECT coalesce(sum(montant), 0) INTO attente FROM projet_ordres_decaissement WHERE demande_id = d.id AND statut = 'en_attente';
  IF c.decaisse + attente + NEW.montant > d.total THEN
    RAISE EXCEPTION 'ORDRE_DEPASSE: il reste % FCFA à décaisser sur la demande % (ordres en attente compris).',
      greatest(d.total - c.decaisse - attente, 0), d.numero USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_projet_ordre_controle ON projet_ordres_decaissement;
CREATE TRIGGER trg_projet_ordre_controle BEFORE INSERT OR UPDATE ON projet_ordres_decaissement
  FOR EACH ROW EXECUTE FUNCTION projet_ordre_controle();

-- ── Invitation des membres de l'équipe des projets (26/11/2026) ───────────────
-- Le compte créé reçoit un e-mail « Créez votre mot de passe » (lien unique,
-- valable 72 heures) : même mécanisme que la réinitialisation, d'une autre nature.
ALTER TABLE password_resets ADD COLUMN IF NOT EXISTS nature TEXT NOT NULL DEFAULT 'reinitialisation';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_password_resets_nature') THEN
    ALTER TABLE password_resets ADD CONSTRAINT chk_password_resets_nature CHECK (nature IN ('reinitialisation', 'invitation'));
  END IF;
END $$;
