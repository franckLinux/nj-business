-- ============================================================================
-- 087 — NJ FINANCE : missions ; règlement par un tiers payeur (27/11/2026).
--
-- Décisions de Franck :
--  · Missions pour les PME comme pour les ONG ; le DIRECTEUR approuve l'ordre de
--    mission ; frais prévus en saisie libre ; l'avance passe en compte 42x
--    (avance au personnel), soldé à la clôture par les charges justifiées.
--  · Une facture fournisseur peut être réglée par un tiers payeur (bailleur,
--    associé, maison mère…) : règlement hors caisse validé par le directeur,
--    D 401 / C compte du tiers payeur.
--
-- Circuit d'une mission : brouillon → soumise → approuvee (avance) →
-- a_controler (dépenses réelles + rapport) → justifiee (régularisation :
-- reliquat reversé ou complément payé) → cloturee (écriture D 6x / C 42x).
-- rejetee | annulee. Additive et idempotente. Retour arrière : 087_retour_arriere.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS fin_missions_parametres (
  tenant_id      UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  compte_avance  TEXT NOT NULL DEFAULT '' CHECK (compte_avance = '' OR compte_avance ~ '^4'),
  compte_charge  TEXT NOT NULL DEFAULT '' CHECK (compte_charge = '' OR compte_charge ~ '^6'),
  modifie_par    UUID REFERENCES users(id) ON DELETE SET NULL,
  modifie_le     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fin_missions (
  id                 BIGSERIAL     PRIMARY KEY,
  tenant_id          UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  numero             TEXT,
  missionnaire_id    UUID          REFERENCES users(id) ON DELETE SET NULL,
  missionnaire_nom   TEXT          NOT NULL CHECK (btrim(missionnaire_nom) <> '' AND length(missionnaire_nom) <= 150),
  fonction           TEXT          NOT NULL DEFAULT '' CHECK (length(fonction) <= 150),
  objet              TEXT          NOT NULL CHECK (btrim(objet) <> '' AND length(objet) <= 500),
  destination        TEXT          NOT NULL CHECK (btrim(destination) <> '' AND length(destination) <= 200),
  date_depart        DATE          NOT NULL,
  date_retour        DATE          NOT NULL,
  transport          TEXT          NOT NULL DEFAULT '' CHECK (length(transport) <= 150),
  activite_id        INTEGER       REFERENCES activites(id),
  statut             TEXT          NOT NULL DEFAULT 'brouillon'
                       CHECK (statut IN ('brouillon', 'soumise', 'approuvee', 'a_controler', 'justifiee', 'cloturee', 'rejetee', 'annulee')),
  cree_par           UUID          REFERENCES users(id) ON DELETE SET NULL,
  cree_le            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  soumise_le         TIMESTAMPTZ,
  approuve_par       UUID          REFERENCES users(id) ON DELETE SET NULL,
  approuve_le        TIMESTAMPTZ,
  compte_avance      TEXT          NOT NULL DEFAULT '',
  motif              TEXT          NOT NULL DEFAULT '' CHECK (length(motif) <= 500),
  rapport            TEXT          NOT NULL DEFAULT '' CHECK (length(rapport) <= 8000),
  justif_soumise_par UUID          REFERENCES users(id) ON DELETE SET NULL,
  justif_soumise_le  TIMESTAMPTZ,
  controle_par       UUID          REFERENCES users(id) ON DELETE SET NULL,
  controle_le        TIMESTAMPTZ,
  cloture_le         TIMESTAMPTZ,
  CHECK (date_retour >= date_depart),
  CHECK (statut IN ('brouillon', 'soumise', 'rejetee', 'annulee') OR (approuve_par IS NOT NULL AND numero IS NOT NULL AND compte_avance <> '')),
  CHECK (statut NOT IN ('rejetee', 'annulee') OR btrim(motif) <> ''),
  -- Personne ne contrôle la justification qu'il a lui-même présentée.
  CHECK (controle_par IS NULL OR justif_soumise_par IS NULL OR controle_par <> justif_soumise_par)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_missions_numero ON fin_missions (tenant_id, numero) WHERE numero IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fin_missions ON fin_missions (tenant_id, statut, id DESC);

-- Frais prévus (saisie libre) : quantité × jours × prix unitaire.
CREATE TABLE IF NOT EXISTS fin_mission_frais (
  id             BIGSERIAL     PRIMARY KEY,
  mission_id     BIGINT        NOT NULL REFERENCES fin_missions(id) ON DELETE CASCADE,
  ordre          INTEGER       NOT NULL DEFAULT 0,
  nature         TEXT          NOT NULL CHECK (nature IN ('transport', 'hebergement', 'restauration', 'perdiem', 'autre')),
  designation    TEXT          NOT NULL CHECK (btrim(designation) <> '' AND length(designation) <= 300),
  quantite       NUMERIC(12,2) NOT NULL DEFAULT 1 CHECK (quantite > 0),
  jours          NUMERIC(8,2)  CHECK (jours IS NULL OR jours > 0),
  prix_unitaire  NUMERIC(15,2) NOT NULL CHECK (prix_unitaire >= 0),
  montant        NUMERIC(15,2) NOT NULL CHECK (montant >= 0)
);
CREATE INDEX IF NOT EXISTS idx_fin_mission_frais ON fin_mission_frais (mission_id);

-- Dépenses réelles, chacune avec sa pièce (stockage privé).
CREATE TABLE IF NOT EXISTS fin_mission_depenses (
  id              BIGSERIAL     PRIMARY KEY,
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mission_id      BIGINT        NOT NULL REFERENCES fin_missions(id) ON DELETE CASCADE,
  nature          TEXT          NOT NULL CHECK (nature IN ('transport', 'hebergement', 'restauration', 'perdiem', 'autre')),
  date_depense    DATE          NOT NULL,
  designation     TEXT          NOT NULL CHECK (btrim(designation) <> '' AND length(designation) <= 300),
  montant         NUMERIC(15,2) NOT NULL CHECK (montant > 0),
  compte          TEXT          NOT NULL DEFAULT '' CHECK (compte = '' OR compte ~ '^6'),
  fichier_chemin  TEXT,
  fichier_nom     TEXT          NOT NULL DEFAULT '' CHECK (length(fichier_nom) <= 200),
  mime            TEXT          NOT NULL DEFAULT '',
  sha256          TEXT          NOT NULL DEFAULT '',
  declare_par     UUID          REFERENCES users(id) ON DELETE SET NULL,
  declare_le      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fin_mission_depenses ON fin_mission_depenses (mission_id);

-- Mouvements de caisse de la mission : avance et complément (sorties), reliquat (entrée).
CREATE TABLE IF NOT EXISTS fin_mission_mouvements (
  id          BIGSERIAL   PRIMARY KEY,
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mission_id  BIGINT      NOT NULL REFERENCES fin_missions(id),
  journal_id  BIGINT      NOT NULL UNIQUE REFERENCES journal(id),
  sens        TEXT        NOT NULL CHECK (sens IN ('avance', 'complement', 'reliquat')),
  cree_par    UUID        REFERENCES users(id) ON DELETE SET NULL,
  cree_le     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fin_mission_mouvements ON fin_mission_mouvements (mission_id);

-- Chiffres d'une mission : prévu, versé net (sorties − entrées non annulées), dépenses.
CREATE OR REPLACE FUNCTION fin_mission_chiffres(p_id BIGINT)
RETURNS TABLE (prevu NUMERIC, verse NUMERIC, reverse NUMERIC, depenses NUMERIC)
LANGUAGE sql STABLE AS $$
  SELECT (SELECT coalesce(sum(montant), 0) FROM fin_mission_frais WHERE mission_id = p_id),
         (SELECT coalesce(sum(j.sortie), 0) FROM fin_mission_mouvements m JOIN journal j ON j.id = m.journal_id
           WHERE m.mission_id = p_id AND m.sens IN ('avance', 'complement') AND NOT coalesce(j.annule, false)),
         (SELECT coalesce(sum(j.entree), 0) FROM fin_mission_mouvements m JOIN journal j ON j.id = m.journal_id
           WHERE m.mission_id = p_id AND m.sens = 'reliquat' AND NOT coalesce(j.annule, false)),
         (SELECT coalesce(sum(montant), 0) FROM fin_mission_depenses WHERE mission_id = p_id)
$$;

-- Seul le rôle directeur approuve un ordre de mission (contrôle en base).
CREATE OR REPLACE FUNCTION fin_mission_controle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE r TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.approuve_par IS DISTINCT FROM OLD.approuve_par AND NEW.approuve_par IS NOT NULL THEN
    SELECT role INTO r FROM users WHERE id = NEW.approuve_par AND tenant_id = NEW.tenant_id;
    IF r IS DISTINCT FROM 'directeur' THEN
      RAISE EXCEPTION 'DIRECTEUR_SEUL: seul le directeur approuve un ordre de mission.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.statut = 'cloturee' THEN
    RAISE EXCEPTION 'MISSION_CLOTUREE: une mission clôturée ne se modifie plus.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_fin_mission_controle ON fin_missions;
CREATE TRIGGER trg_fin_mission_controle BEFORE UPDATE ON fin_missions FOR EACH ROW EXECUTE FUNCTION fin_mission_controle();

-- Un mouvement de mission respecte le circuit et les plafonds.
CREATE OR REPLACE FUNCTION fin_mission_mouvement_controle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE m RECORD; j RECORD; c RECORD;
BEGIN
  IF current_setting('app.journal_maintenance', true) = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN RETURN OLD; END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'LIEN_INTANGIBLE: le lien d''un mouvement à une mission ne se modifie pas ; annulez le mouvement en caisse.' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('fin_mission:' || NEW.mission_id));
  SELECT * INTO m FROM fin_missions WHERE id = NEW.mission_id;
  SELECT id, tenant_id, entree, sortie, annulation_de_id INTO j FROM journal WHERE id = NEW.journal_id;
  IF m.id IS NULL OR j.id IS NULL OR m.tenant_id <> NEW.tenant_id OR j.tenant_id <> NEW.tenant_id OR j.annulation_de_id IS NOT NULL THEN
    RAISE EXCEPTION 'LIEN_INVALIDE: mission ou mouvement introuvable pour ce client.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO c FROM fin_mission_chiffres(m.id);
  IF NEW.sens = 'avance' THEN
    IF m.statut NOT IN ('approuvee', 'a_controler') OR coalesce(j.sortie, 0) <= 0 THEN
      RAISE EXCEPTION 'AVANCE_IMPOSSIBLE: l''avance se verse en sortie, sur une mission approuvée.' USING ERRCODE = 'check_violation';
    END IF;
    IF c.verse + j.sortie > c.prevu THEN
      RAISE EXCEPTION 'AVANCE_DEPASSE: l''avance ne dépasse pas les frais prévus (reste % FCFA).', greatest(c.prevu - c.verse, 0) USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.sens = 'complement' THEN
    IF m.statut <> 'justifiee' OR coalesce(j.sortie, 0) <= 0 OR c.verse - c.reverse + j.sortie > c.depenses THEN
      RAISE EXCEPTION 'COMPLEMENT_IMPOSSIBLE: le complément ne dépasse pas les dépenses justifiées non couvertes (% FCFA).',
        greatest(c.depenses - c.verse + c.reverse, 0) USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF m.statut <> 'justifiee' OR coalesce(j.entree, 0) <= 0 OR c.verse - c.reverse - j.entree < c.depenses THEN
      RAISE EXCEPTION 'RELIQUAT_IMPOSSIBLE: le reliquat à reverser est de % FCFA.', greatest(c.verse - c.reverse - c.depenses, 0) USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_fin_mission_mouvement ON fin_mission_mouvements;
CREATE TRIGGER trg_fin_mission_mouvement BEFORE INSERT OR UPDATE OR DELETE ON fin_mission_mouvements
  FOR EACH ROW EXECUTE FUNCTION fin_mission_mouvement_controle();

-- Écriture de clôture d'une mission (D charges / C avance au personnel).
ALTER TABLE fin_ecritures DROP CONSTRAINT IF EXISTS fin_ecritures_origine_type_check;
ALTER TABLE fin_ecritures ADD CONSTRAINT fin_ecritures_origine_type_check
  CHECK (origine_type IN ('manuelle', 'extourne', 'journal', 'fin_facture', 'com_ff', 'fin_reglement_hc', 'fin_mission',
                          'immo_dotation', 'immo_sortie', 'stock_variation', 'an'));

-- ── Tiers payeur (achats) ───────────────────────────────────────────────────
ALTER TABLE fin_reglements_hors_caisse ADD COLUMN IF NOT EXISTS nature TEXT NOT NULL DEFAULT 'hors_caisse';
ALTER TABLE fin_reglements_hors_caisse ADD COLUMN IF NOT EXISTS reference TEXT NOT NULL DEFAULT '';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_fin_hc_nature') THEN
    ALTER TABLE fin_reglements_hors_caisse ADD CONSTRAINT chk_fin_hc_nature CHECK (
      nature IN ('hors_caisse', 'tiers_payeur') AND length(reference) <= 100
      AND (nature <> 'tiers_payeur' OR (tiers_id IS NOT NULL AND facture_type IN ('fin', 'com_ff'))));
  END IF;
END $$;

-- ── Droits ──────────────────────────────────────────────────────────────────
INSERT INTO permissions(code, nom, module, description) VALUES
  ('finance.missions.voir',     'Voir les missions',      'finance', 'Ordres de mission, avances, justifications et rapports'),
  ('finance.missions.demander', 'Demander une mission',   'finance', 'Établir un ordre de mission, déclarer les dépenses et le rapport')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, p.code FROM roles r
  CROSS JOIN (VALUES ('finance.missions.voir'), ('finance.missions.demander')) AS p(code)
 WHERE r.code IN ('directeur', 'auditeur', 'comptable_cabinet', 'caissier') AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;

-- Chefs de projet et responsables d'activité (profils créés par l'équipe des projets) :
-- ils partent en mission et présentent leur justification. Pas le rôle « collaborateur »
-- en général : un collaborateur du seul NJ COMMERCIAL n'entre pas dans NJ FINANCE.
INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, p.code FROM roles r
  CROSS JOIN (VALUES ('finance.missions.voir'), ('finance.missions.demander')) AS p(code)
 WHERE r.code IN ('CHEF_PROJET', 'RESP_ACTIVITE') AND r.tenant_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO tenant_permissions(tenant_id, permission_code)
SELECT DISTINCT tp.tenant_id, p.code FROM tenant_permissions tp
  CROSS JOIN (VALUES ('finance.missions.voir'), ('finance.missions.demander')) AS p(code)
 WHERE tp.permission_code = 'journal.view'
ON CONFLICT DO NOTHING;
