-- ============================================================================
-- 075 — NJ FINANCE, lot F2 : socle comptable SYSCOHADA
--      (dossier claude/NJ_FINANCE_AUDIT_ARCHITECTURE.md, sections 3.3 et 3.4)
--
--  1. fin_exercices  : exercices comptables (ouvert / clos), sans chevauchement.
--  2. fin_periodes   : périodes mensuelles (ouverte / verrouillee / cloturee).
--  3. fin_journaux   : journaux COMPTABLES (achats, ventes, trésorerie, OD,
--                      à-nouveaux, inventaire). Un journal de trésorerie peut
--                      pointer vers un journal de caisse existant (journaux).
--  4. fin_ecritures / fin_ecriture_lignes : écritures en partie double.
--       brouillard → validee. À la validation (garanti en base) :
--         · au moins deux lignes, débit = crédit, total > 0 ;
--         · comptes existants, actifs et de détail dans le plan du client ;
--         · tiers obligatoire sur les comptes 40 et 41 ;
--         · période ouverte, exercice ouvert ;
--         · numéro définitif attribué (sans trou, par journal et exercice) ;
--         · une OD manuelle n'est jamais validée par son auteur.
--       Une écriture validée ne se modifie ni ne se supprime : elle se corrige
--       par EXTOURNE (écriture inverse liée, extourne_de_id).
--       Une source (origine_type, origine_id) donne au plus une écriture active.
--  5. plan_client_est_utilise() : un compte mouvementé en écriture n'est plus
--     ni supprimable ni renumérotable.
--  6. Permissions finance.* et préfixe /finance rattaché au module « caisse ».
--
--  Additive et idempotente. Aucune donnée de caisse n'est lue ni modifiée.
--  Retour arrière : db/migrations-retour-arriere/075_retour_arriere.sql
-- ============================================================================

-- ── 1. Exercices ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fin_exercices (
  id           BIGSERIAL    PRIMARY KEY,
  tenant_id    UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code         TEXT         NOT NULL CHECK (code ~ '^[A-Za-z0-9_.-]{1,12}$'),
  date_debut   DATE         NOT NULL,
  date_fin     DATE         NOT NULL,
  statut       TEXT         NOT NULL DEFAULT 'ouvert' CHECK (statut IN ('ouvert', 'cloture')),
  cree_par     UUID         REFERENCES users(id) ON DELETE SET NULL,
  cree_le      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  cloture_par  UUID         REFERENCES users(id) ON DELETE SET NULL,
  cloture_le   TIMESTAMPTZ,
  CHECK (date_fin > date_debut),
  CHECK (date_fin < date_debut + INTERVAL '24 months')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_exercices_code ON fin_exercices (tenant_id, upper(code));
CREATE INDEX IF NOT EXISTS idx_fin_exercices_dates ON fin_exercices (tenant_id, date_debut, date_fin);

CREATE OR REPLACE FUNCTION fin_exercices_controle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM fin_exercices e
              WHERE e.tenant_id = NEW.tenant_id AND e.id <> NEW.id
                AND daterange(e.date_debut, e.date_fin, '[]') && daterange(NEW.date_debut, NEW.date_fin, '[]')) THEN
    RAISE EXCEPTION 'EXERCICE_CHEVAUCHEMENT: cet exercice chevauche un exercice existant.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.date_debut <> OLD.date_debut OR NEW.date_fin <> OLD.date_fin OR NEW.tenant_id <> OLD.tenant_id)
     AND EXISTS (SELECT 1 FROM fin_ecritures WHERE exercice_id = NEW.id) THEN
    RAISE EXCEPTION 'EXERCICE_UTILISE: un exercice qui porte des écritures ne change pas de dates.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- ── 2. Périodes ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fin_periodes (
  id           BIGSERIAL    PRIMARY KEY,
  tenant_id    UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  exercice_id  BIGINT       NOT NULL REFERENCES fin_exercices(id) ON DELETE CASCADE,
  numero       INTEGER      NOT NULL CHECK (numero BETWEEN 1 AND 24),
  date_debut   DATE         NOT NULL,
  date_fin     DATE         NOT NULL,
  statut       TEXT         NOT NULL DEFAULT 'ouverte' CHECK (statut IN ('ouverte', 'verrouillee', 'cloturee')),
  modifie_par  UUID         REFERENCES users(id) ON DELETE SET NULL,
  modifie_le   TIMESTAMPTZ,
  CHECK (date_fin >= date_debut),
  UNIQUE (exercice_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_fin_periodes_dates ON fin_periodes (tenant_id, date_debut, date_fin);

-- ── 3. Journaux comptables ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fin_journaux (
  id                     BIGSERIAL    PRIMARY KEY,
  tenant_id              UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code                   TEXT         NOT NULL CHECK (code ~ '^[A-Z0-9]{1,6}$'),
  intitule               TEXT         NOT NULL CHECK (btrim(intitule) <> '' AND length(intitule) <= 80),
  type                   TEXT         NOT NULL CHECK (type IN ('achats', 'ventes', 'tresorerie', 'od', 'an', 'inventaire')),
  journal_tresorerie_id  INTEGER      REFERENCES journaux(id) ON DELETE SET NULL,
  actif                  BOOLEAN      NOT NULL DEFAULT true,
  cree_par               UUID         REFERENCES users(id) ON DELETE SET NULL,
  cree_le                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CHECK (journal_tresorerie_id IS NULL OR type = 'tresorerie')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_journaux_code ON fin_journaux (tenant_id, code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_journaux_tresorerie ON fin_journaux (journal_tresorerie_id) WHERE journal_tresorerie_id IS NOT NULL;

CREATE OR REPLACE FUNCTION fin_journaux_controle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.journal_tresorerie_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM journaux j WHERE j.id = NEW.journal_tresorerie_id AND j.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'JOURNAL_INCOHERENT: le journal de caisse lié n''appartient pas à ce client.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.code <> OLD.code OR NEW.type <> OLD.type OR NEW.tenant_id <> OLD.tenant_id)
     AND EXISTS (SELECT 1 FROM fin_ecritures WHERE journal_id = NEW.id) THEN
    RAISE EXCEPTION 'JOURNAL_UTILISE: un journal qui porte des écritures garde son code et son type.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- ── 4. Écritures ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fin_ecritures (
  id                BIGSERIAL     PRIMARY KEY,
  tenant_id         UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  exercice_id       BIGINT        NOT NULL REFERENCES fin_exercices(id),
  periode_id        BIGINT        NOT NULL REFERENCES fin_periodes(id),
  journal_id        BIGINT        NOT NULL REFERENCES fin_journaux(id),
  numero            INTEGER,                                         -- attribué à la validation
  date_ecriture     DATE          NOT NULL,
  reference_piece   TEXT          NOT NULL DEFAULT '' CHECK (length(reference_piece) <= 60),
  libelle           TEXT          NOT NULL CHECK (btrim(libelle) <> '' AND length(libelle) <= 300),
  statut            TEXT          NOT NULL DEFAULT 'brouillard' CHECK (statut IN ('brouillard', 'validee')),
  origine_type      TEXT          NOT NULL DEFAULT 'manuelle'
                                  CHECK (origine_type IN ('manuelle', 'extourne', 'journal', 'fin_facture', 'com_ff',
                                                          'immo_dotation', 'immo_sortie', 'stock_variation', 'an')),
  origine_id        BIGINT,
  extourne_de_id    BIGINT        REFERENCES fin_ecritures(id),
  extournee_par_id  BIGINT        REFERENCES fin_ecritures(id),
  motif_extourne    TEXT          NOT NULL DEFAULT '' CHECK (length(motif_extourne) <= 500),
  cree_par          UUID          REFERENCES users(id) ON DELETE SET NULL,
  cree_le           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  modifie_le        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  valide_par        UUID          REFERENCES users(id) ON DELETE SET NULL,
  valide_le         TIMESTAMPTZ,
  CHECK ((statut = 'validee') = (numero IS NOT NULL)),
  CHECK ((origine_type = 'extourne') = (extourne_de_id IS NOT NULL)),
  CHECK (origine_type IN ('manuelle', 'an') OR origine_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_ecritures_numero ON fin_ecritures (tenant_id, journal_id, exercice_id, numero) WHERE numero IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_ecritures_extourne ON fin_ecritures (extourne_de_id) WHERE extourne_de_id IS NOT NULL;
-- Une source → une seule écriture active (non extournée). Les extournes ne comptent pas.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_ecritures_origine ON fin_ecritures (tenant_id, origine_type, origine_id)
  WHERE origine_id IS NOT NULL AND origine_type <> 'extourne' AND extournee_par_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_fin_ecritures_liste ON fin_ecritures (tenant_id, exercice_id, date_ecriture, id);
CREATE INDEX IF NOT EXISTS idx_fin_ecritures_journal ON fin_ecritures (tenant_id, journal_id, date_ecriture);

CREATE TABLE IF NOT EXISTS fin_ecriture_lignes (
  id           BIGSERIAL      PRIMARY KEY,
  tenant_id    UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ecriture_id  BIGINT         NOT NULL REFERENCES fin_ecritures(id) ON DELETE CASCADE,
  ordre        INTEGER        NOT NULL DEFAULT 0,
  compte       TEXT           NOT NULL CHECK (btrim(compte) <> '' AND length(compte) <= 20),
  tiers_id     BIGINT         REFERENCES registre_tiers(id),
  activite_id  INTEGER        REFERENCES activites(id),
  libelle      TEXT           NOT NULL DEFAULT '' CHECK (length(libelle) <= 300),
  debit        NUMERIC(18,2)  NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit       NUMERIC(18,2)  NOT NULL DEFAULT 0 CHECK (credit >= 0),
  echeance     DATE,
  CHECK ((debit > 0) <> (credit > 0))
);
CREATE INDEX IF NOT EXISTS idx_fin_lignes_ecriture ON fin_ecriture_lignes (ecriture_id, ordre);
CREATE INDEX IF NOT EXISTS idx_fin_lignes_compte ON fin_ecriture_lignes (tenant_id, compte);
CREATE INDEX IF NOT EXISTS idx_fin_lignes_tiers ON fin_ecriture_lignes (tenant_id, tiers_id) WHERE tiers_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fin_lignes_activite ON fin_ecriture_lignes (tenant_id, activite_id) WHERE activite_id IS NOT NULL;

-- Compte utilisable en écriture : existant, actif, de détail. Plan du client s'il
-- est initialisé, sinon plan global (même règle que la passerelle). NULL = valide.
CREATE OR REPLACE FUNCTION fin_compte_anomalie(p_tenant UUID, p_compte TEXT) RETURNS TEXT
LANGUAGE plpgsql STABLE AS $$
DECLARE
  c TEXT := btrim(coalesce(p_compte, ''));
  plan_client BOOLEAN;
  v_existe BOOLEAN; v_actif BOOLEAN; v_sous INTEGER;
BEGIN
  IF c = '' THEN RETURN 'compte manquant'; END IF;
  SELECT plan_initialise_le IS NOT NULL INTO plan_client FROM tenants WHERE id = p_tenant;
  IF coalesce(plan_client, false) THEN
    SELECT count(*) > 0, bool_or(statut = 'actif') INTO v_existe, v_actif FROM plan_comptable_client
     WHERE tenant_id = p_tenant AND lower(btrim(compte)) = lower(c);
    SELECT count(*) INTO v_sous FROM plan_comptable_client
     WHERE tenant_id = p_tenant AND statut = 'actif' AND compte LIKE c || '%' AND compte <> c;
  ELSE
    SELECT count(*) > 0, bool_or(actif) INTO v_existe, v_actif FROM plan_comptable_syscohada WHERE lower(btrim(compte)) = lower(c);
    SELECT count(*) INTO v_sous FROM plan_comptable_syscohada WHERE actif AND compte LIKE c || '%' AND compte <> c;
  END IF;
  IF NOT coalesce(v_existe, false) THEN RETURN 'le compte ' || c || ' n''existe pas dans le plan comptable'; END IF;
  IF NOT coalesce(v_actif, false) THEN RETURN 'le compte ' || c || ' est inactif'; END IF;
  IF v_sous > 0 THEN RETURN 'le compte ' || c || ' est un compte de regroupement (choisissez un compte de détail)'; END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION fin_ecritures_controle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  per RECORD; ex RECORD; jr RECORD; chk fin_ecritures%ROWTYPE;
  nb INTEGER; td NUMERIC; tc NUMERIC; l RECORD; anomalie TEXT;
BEGIN
  IF current_setting('app.finance_maintenance', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Suppression du client (cascade) : le client a déjà disparu.
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN RETURN OLD; END IF;
    IF OLD.statut = 'validee' THEN
      RAISE EXCEPTION 'ECRITURE_INTANGIBLE: une écriture validée ne se supprime pas ; passez une extourne.' USING ERRCODE = 'check_violation';
    END IF;
    SELECT statut INTO per FROM fin_periodes WHERE id = OLD.periode_id;
    IF per.statut <> 'ouverte' THEN
      RAISE EXCEPTION 'PERIODE_FERMEE: la période de cette écriture n''est pas ouverte.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.statut = 'validee' THEN
    -- Seuls changements admis : marquer l'écriture comme extournée (une fois),
    -- et la mise à NULL d'un auteur supprimé (ON DELETE SET NULL).
    chk := NEW;
    IF OLD.extournee_par_id IS NULL THEN chk.extournee_par_id := OLD.extournee_par_id; END IF;
    IF NEW.cree_par IS NULL THEN chk.cree_par := OLD.cree_par; END IF;
    IF NEW.valide_par IS NULL THEN chk.valide_par := OLD.valide_par; END IF;
    IF chk IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'ECRITURE_INTANGIBLE: une écriture validée ne se modifie pas ; passez une extourne.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id <> OLD.tenant_id THEN
      RAISE EXCEPTION 'ECRITURE_INCOHERENTE: une écriture ne change pas de client.' USING ERRCODE = 'check_violation';
    END IF;
    SELECT statut INTO per FROM fin_periodes WHERE id = OLD.periode_id;
    IF per.statut <> 'ouverte' THEN
      RAISE EXCEPTION 'PERIODE_FERMEE: la période de cette écriture n''est pas ouverte.' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.statut <> 'brouillard' THEN
    RAISE EXCEPTION 'ECRITURE_INCOHERENTE: une écriture naît au brouillard.' USING ERRCODE = 'check_violation';
  END IF;

  -- Journal du client, actif.
  SELECT id, tenant_id, actif INTO jr FROM fin_journaux WHERE id = NEW.journal_id;
  IF jr.id IS NULL OR jr.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'ECRITURE_INCOHERENTE: journal comptable introuvable pour ce client.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT jr.actif THEN
    RAISE EXCEPTION 'JOURNAL_INACTIF: ce journal comptable est désactivé.' USING ERRCODE = 'check_violation';
  END IF;

  -- Exercice et période déduits de la date.
  SELECT p.id, p.statut, p.exercice_id INTO per FROM fin_periodes p
   WHERE p.tenant_id = NEW.tenant_id AND NEW.date_ecriture BETWEEN p.date_debut AND p.date_fin
   ORDER BY p.date_debut LIMIT 1;
  IF per.id IS NULL THEN
    RAISE EXCEPTION 'EXERCICE_ABSENT: aucun exercice comptable ne couvre la date du %.', to_char(NEW.date_ecriture, 'DD/MM/YYYY') USING ERRCODE = 'check_violation';
  END IF;
  IF per.statut <> 'ouverte' THEN
    RAISE EXCEPTION 'PERIODE_FERMEE: la période du % n''est pas ouverte.', to_char(NEW.date_ecriture, 'DD/MM/YYYY') USING ERRCODE = 'check_violation';
  END IF;
  SELECT id, statut INTO ex FROM fin_exercices WHERE id = per.exercice_id;
  IF ex.statut <> 'ouvert' THEN
    RAISE EXCEPTION 'EXERCICE_CLOS: l''exercice de cette date est clos.' USING ERRCODE = 'check_violation';
  END IF;
  NEW.periode_id := per.id;
  NEW.exercice_id := per.exercice_id;
  NEW.modifie_le := NOW();

  -- Validation.
  IF NEW.statut = 'validee' THEN
    SELECT count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0) INTO nb, td, tc
      FROM fin_ecriture_lignes WHERE ecriture_id = NEW.id;
    IF nb < 2 THEN
      RAISE EXCEPTION 'ECRITURE_INCOMPLETE: une écriture compte au moins deux lignes.' USING ERRCODE = 'check_violation';
    END IF;
    IF td <> tc THEN
      RAISE EXCEPTION 'ECRITURE_DESEQUILIBREE: total débit % ≠ total crédit %.', td, tc USING ERRCODE = 'check_violation';
    END IF;
    IF td <= 0 THEN
      RAISE EXCEPTION 'ECRITURE_INCOMPLETE: l''écriture n''a pas de montant.' USING ERRCODE = 'check_violation';
    END IF;
    FOR l IN SELECT ordre, compte, tiers_id FROM fin_ecriture_lignes WHERE ecriture_id = NEW.id ORDER BY ordre, id LOOP
      anomalie := fin_compte_anomalie(NEW.tenant_id, l.compte);
      IF anomalie IS NOT NULL THEN
        RAISE EXCEPTION 'COMPTE_INVALIDE: ligne % : %.', l.ordre, anomalie USING ERRCODE = 'check_violation';
      END IF;
      IF (btrim(l.compte) LIKE '40%' OR btrim(l.compte) LIKE '41%') AND l.tiers_id IS NULL THEN
        RAISE EXCEPTION 'TIERS_OBLIGATOIRE: ligne % : le compte % exige un tiers (client ou fournisseur).', l.ordre, btrim(l.compte) USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
    IF NEW.valide_par IS NULL THEN
      RAISE EXCEPTION 'ECRITURE_INCOHERENTE: le validateur est obligatoire.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.origine_type = 'manuelle' AND NEW.cree_par IS NOT NULL AND NEW.valide_par = NEW.cree_par THEN
      RAISE EXCEPTION 'AUTO_VALIDATION: personne ne valide sa propre écriture.' USING ERRCODE = 'check_violation';
    END IF;
    -- Numéro définitif, sans trou, par journal et exercice.
    PERFORM pg_advisory_xact_lock(hashtext('fin_ecritures_numero:' || NEW.tenant_id::text || ':' || NEW.journal_id::text || ':' || NEW.exercice_id::text));
    SELECT coalesce(max(numero), 0) + 1 INTO NEW.numero FROM fin_ecritures
     WHERE tenant_id = NEW.tenant_id AND journal_id = NEW.journal_id AND exercice_id = NEW.exercice_id AND numero IS NOT NULL;
    NEW.valide_le := NOW();
  ELSE
    NEW.numero := NULL;
    NEW.valide_par := NULL;
    NEW.valide_le := NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION fin_lignes_controle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE e RECORD; per RECORD; ligne fin_ecriture_lignes%ROWTYPE;
BEGIN
  IF current_setting('app.finance_maintenance', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  ligne := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  SELECT id, tenant_id, statut, periode_id INTO e FROM fin_ecritures WHERE id = ligne.ecriture_id;
  IF e.id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;   -- écriture brouillard supprimée (cascade)
    RAISE EXCEPTION 'ECRITURE_INCOHERENTE: écriture introuvable.' USING ERRCODE = 'check_violation';
  END IF;
  IF e.statut <> 'brouillard' THEN
    RAISE EXCEPTION 'ECRITURE_INTANGIBLE: les lignes d''une écriture validée ne se modifient pas.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT statut INTO per FROM fin_periodes WHERE id = e.periode_id;
  IF per.statut <> 'ouverte' THEN
    RAISE EXCEPTION 'PERIODE_FERMEE: la période de cette écriture n''est pas ouverte.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND NEW.ecriture_id <> OLD.ecriture_id THEN
    RAISE EXCEPTION 'ECRITURE_INCOHERENTE: une ligne ne change pas d''écriture.' USING ERRCODE = 'check_violation';
  END IF;
  NEW.tenant_id := e.tenant_id;
  IF NEW.tiers_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM registre_tiers WHERE id = NEW.tiers_id AND tenant_id = e.tenant_id) THEN
    RAISE EXCEPTION 'ECRITURE_INCOHERENTE: tiers introuvable pour ce client.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.activite_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM activites WHERE id = NEW.activite_id AND tenant_id = e.tenant_id) THEN
    RAISE EXCEPTION 'ECRITURE_INCOHERENTE: activité introuvable pour ce client.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION fin_periodes_controle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE ex RECORD;
BEGIN
  IF current_setting('app.finance_maintenance', true) = 'on' THEN RETURN NEW; END IF;
  SELECT statut INTO ex FROM fin_exercices WHERE id = NEW.exercice_id;
  IF TG_OP = 'UPDATE' AND NEW.statut <> OLD.statut THEN
    IF OLD.statut = 'cloturee' THEN
      RAISE EXCEPTION 'PERIODE_CLOTUREE: une période clôturée ne se rouvre pas.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.statut = 'ouverte' AND ex.statut <> 'ouvert' THEN
      RAISE EXCEPTION 'EXERCICE_CLOS: la période d''un exercice clos ne se rouvre pas.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.date_debut <> OLD.date_debut OR NEW.date_fin <> OLD.date_fin)
     AND EXISTS (SELECT 1 FROM fin_ecritures WHERE periode_id = NEW.id) THEN
    RAISE EXCEPTION 'PERIODE_UTILISEE: une période qui porte des écritures ne change pas de dates.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_fin_exercices_controle ON fin_exercices;
CREATE TRIGGER trg_fin_exercices_controle BEFORE INSERT OR UPDATE ON fin_exercices
  FOR EACH ROW EXECUTE FUNCTION fin_exercices_controle();
DROP TRIGGER IF EXISTS trg_fin_periodes_controle ON fin_periodes;
CREATE TRIGGER trg_fin_periodes_controle BEFORE UPDATE ON fin_periodes
  FOR EACH ROW EXECUTE FUNCTION fin_periodes_controle();
DROP TRIGGER IF EXISTS trg_fin_journaux_controle ON fin_journaux;
CREATE TRIGGER trg_fin_journaux_controle BEFORE INSERT OR UPDATE ON fin_journaux
  FOR EACH ROW EXECUTE FUNCTION fin_journaux_controle();
DROP TRIGGER IF EXISTS trg_fin_ecritures_controle ON fin_ecritures;
CREATE TRIGGER trg_fin_ecritures_controle BEFORE INSERT OR UPDATE OR DELETE ON fin_ecritures
  FOR EACH ROW EXECUTE FUNCTION fin_ecritures_controle();
DROP TRIGGER IF EXISTS trg_fin_lignes_controle ON fin_ecriture_lignes;
CREATE TRIGGER trg_fin_lignes_controle BEFORE INSERT OR UPDATE OR DELETE ON fin_ecriture_lignes
  FOR EACH ROW EXECUTE FUNCTION fin_lignes_controle();

-- ── 5. Un compte mouvementé en écriture reste dans le plan ──────────────────
CREATE OR REPLACE FUNCTION plan_client_est_utilise(p_tenant UUID, p_compte TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM rubriques r
     WHERE r.tenant_id = p_tenant
       AND lower(btrim(coalesce(r.code_comptable, ''))) = lower(btrim(p_compte))
  ) OR EXISTS (
    SELECT 1 FROM equivalences_comptables e
     WHERE e.tenant_id = p_tenant AND e.statut IN ('valide', 'brouillon')
       AND lower(btrim(e.compte)) = lower(btrim(p_compte))
  ) OR EXISTS (
    SELECT 1 FROM journaux j
     WHERE j.tenant_id = p_tenant
       AND lower(btrim(j.compte_tresorerie)) = lower(btrim(p_compte))
  ) OR EXISTS (
    SELECT 1 FROM tenants t
     WHERE t.id = p_tenant
       AND lower(btrim(t.compte_virements)) = lower(btrim(p_compte))
  ) OR EXISTS (
    SELECT 1 FROM fin_ecriture_lignes l
     WHERE l.tenant_id = p_tenant
       AND lower(btrim(l.compte)) = lower(btrim(p_compte))
  );
$$;

-- ── 6. Permissions et préfixe d'API ──────────────────────────────────────────
INSERT INTO permissions(code, nom, module, description) VALUES
  ('finance.ecritures.voir',      'Voir les écritures et les états comptables', 'finance',
   'Consulter les écritures, les journaux comptables, le grand livre et la balance'),
  ('finance.ecritures.saisir',    'Saisir des opérations diverses',             'finance',
   'Créer, modifier et supprimer des écritures au brouillard (OD, à-nouveaux)'),
  ('finance.ecritures.valider',   'Valider et extourner les écritures',         'finance',
   'Valider une écriture (jamais la sienne) et passer l''extourne d''une écriture validée'),
  ('finance.config.comptabilite', 'Paramétrer la comptabilité',                 'finance',
   'Créer les exercices et les journaux comptables'),
  ('finance.periodes.verrouiller','Verrouiller et rouvrir les périodes',        'finance',
   'Verrouiller une période (plus aucune saisie) ou la rouvrir')
ON CONFLICT (code) DO NOTHING;

-- Directeur : consultation, validation, paramétrage et périodes.
INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, v.code FROM roles r
 CROSS JOIN (VALUES ('finance.ecritures.voir'), ('finance.ecritures.valider'),
                    ('finance.config.comptabilite'), ('finance.periodes.verrouiller')) AS v(code)
 WHERE r.code = 'directeur' AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;
-- Comptable (code auditeur) et comptable cabinet : tout.
INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, v.code FROM roles r
 CROSS JOIN (VALUES ('finance.ecritures.voir'), ('finance.ecritures.saisir'), ('finance.ecritures.valider'),
                    ('finance.config.comptabilite'), ('finance.periodes.verrouiller')) AS v(code)
 WHERE r.code IN ('auditeur', 'comptable_cabinet') AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;

-- Clients ayant un plafond configuré : nouveaux codes ouverts là où le contrôle comptable l'est.
INSERT INTO tenant_permissions(tenant_id, permission_code)
SELECT DISTINCT tp.tenant_id, v.code FROM tenant_permissions tp
 CROSS JOIN (VALUES ('finance.ecritures.voir'), ('finance.ecritures.saisir'), ('finance.ecritures.valider'),
                    ('finance.config.comptabilite'), ('finance.periodes.verrouiller')) AS v(code)
 WHERE tp.permission_code = 'controle.view'
ON CONFLICT DO NOTHING;

UPDATE modules SET prefixes_api = array_append(prefixes_api, '/finance'), updated_at = NOW()
 WHERE code = 'caisse' AND NOT ('/finance' = ANY (prefixes_api));
