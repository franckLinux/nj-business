-- ============================================================================
-- 080 — NJ FINANCE, lot F6 : achats (factures fournisseurs et règlements)
--
--  1. fin_factures / fin_facture_lignes : factures et avoirs reçus HORS
--     NJ COMMERCIAL (prestations, loyers, fournitures, immobilisations…).
--     Brouillon → à valider → validée (numéro interne FFR / AVF, écriture
--     d'achat validée) → éventuellement annulée (extourne). Personne ne valide
--     sa propre facture. Colonne « sens » prête pour les factures clients (F8).
--  2. fin_imputations_externes : imputation comptable d'une facture ou d'un
--     avoir VALIDÉ dans NJ COMMERCIAL (catégorie, compte, activité). Les
--     montants restent dans com_factures_fournisseurs : rien n'est recopié.
--  3. fin_reglement_affectations : un règlement est TOUJOURS un mouvement du
--     journal de caisse (sortie de caisse ou de banque), réparti sur une ou
--     plusieurs factures. Somme ≤ montant de la sortie et ≤ reste à payer.
--     Une sortie annulée en caisse (contre-passation) ne règle plus rien.
--  4. fin_facture_reste() : reste à payer = TTC − avoirs validés − règlements.
--  5. Permissions finance.achats.voir / saisir / valider, finance.reglements.affecter.
--
--  Aucune donnée de caisse ni de NJ COMMERCIAL n'est modifiée.
--  Additive et idempotente. Retour arrière : 080_retour_arriere.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS fin_factures (
  id                  BIGSERIAL      PRIMARY KEY,
  tenant_id           UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sens                TEXT           NOT NULL DEFAULT 'fournisseur' CHECK (sens IN ('fournisseur', 'client')),
  type                TEXT           NOT NULL DEFAULT 'facture' CHECK (type IN ('facture', 'avoir')),
  numero              TEXT,                                            -- attribué à la validation
  tiers_id            BIGINT         NOT NULL REFERENCES registre_tiers(id),
  reference           TEXT           NOT NULL DEFAULT '' CHECK (length(reference) <= 60),
  date_facture        DATE           NOT NULL,
  date_echeance       DATE,
  facture_origine_id  BIGINT         REFERENCES fin_factures(id),
  categorie_id        BIGINT         NOT NULL REFERENCES fin_categories(id),
  activite_id         INTEGER        REFERENCES activites(id),
  objet               TEXT           NOT NULL DEFAULT '' CHECK (length(objet) <= 300),
  observations        TEXT           NOT NULL DEFAULT '' CHECK (length(observations) <= 2000),
  total_ht            NUMERIC(18,2)  NOT NULL DEFAULT 0,
  total_taxes         NUMERIC(18,2)  NOT NULL DEFAULT 0,
  total_ttc           NUMERIC(18,2)  NOT NULL DEFAULT 0,
  compte_tiers        TEXT           NOT NULL DEFAULT '',             -- compte 401 / 481 retenu à la validation
  statut              TEXT           NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'a_valider', 'validee', 'annulee')),
  motif_renvoi        TEXT           NOT NULL DEFAULT '' CHECK (length(motif_renvoi) <= 500),
  motif_annulation    TEXT           NOT NULL DEFAULT '' CHECK (length(motif_annulation) <= 500),
  cree_par            UUID           REFERENCES users(id) ON DELETE SET NULL,
  cree_le             TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  modifie_le          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  soumis_par          UUID           REFERENCES users(id) ON DELETE SET NULL,
  soumis_le           TIMESTAMPTZ,
  valide_par          UUID           REFERENCES users(id) ON DELETE SET NULL,
  valide_le           TIMESTAMPTZ,
  annule_par          UUID           REFERENCES users(id) ON DELETE SET NULL,
  annule_le           TIMESTAMPTZ,
  CHECK ((type = 'avoir') = (facture_origine_id IS NOT NULL)),
  CHECK (date_echeance IS NULL OR date_echeance >= date_facture),
  CHECK (sens <> 'fournisseur' OR btrim(reference) <> ''),
  CHECK (statut NOT IN ('validee', 'annulee') OR numero IS NOT NULL OR (statut = 'annulee' AND valide_le IS NULL)),
  CHECK (valide_par IS NULL OR cree_par IS NULL OR valide_par <> cree_par)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_factures_numero ON fin_factures (tenant_id, numero) WHERE numero IS NOT NULL;
-- Une même pièce du fournisseur n'est enregistrée qu'une fois (hors pièces annulées).
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_factures_reference ON fin_factures (tenant_id, tiers_id, type, upper(btrim(reference)))
  WHERE sens = 'fournisseur' AND statut <> 'annulee';
CREATE INDEX IF NOT EXISTS idx_fin_factures ON fin_factures (tenant_id, sens, statut, date_facture DESC);
CREATE INDEX IF NOT EXISTS idx_fin_factures_tiers ON fin_factures (tenant_id, tiers_id);
CREATE INDEX IF NOT EXISTS idx_fin_factures_origine ON fin_factures (facture_origine_id) WHERE facture_origine_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS fin_facture_lignes (
  id             BIGSERIAL      PRIMARY KEY,
  facture_id     BIGINT         NOT NULL REFERENCES fin_factures(id) ON DELETE CASCADE,
  tenant_id      UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ordre          INTEGER        NOT NULL DEFAULT 0,
  prestation_id  BIGINT         REFERENCES fin_prestations(id),
  designation    TEXT           NOT NULL CHECK (btrim(designation) <> '' AND length(designation) <= 300),
  quantite       NUMERIC(18,3)  NOT NULL CHECK (quantite > 0),
  prix_unitaire  NUMERIC(18,2)  NOT NULL CHECK (prix_unitaire >= 0),
  remise_pct     NUMERIC(5,2)   NOT NULL DEFAULT 0 CHECK (remise_pct BETWEEN 0 AND 100),
  taxe_id        BIGINT         REFERENCES com_taxes(id),
  taxe_taux      NUMERIC(7,4)   NOT NULL DEFAULT 0 CHECK (taxe_taux BETWEEN 0 AND 100),
  compte         TEXT           NOT NULL CHECK (btrim(compte) <> '' AND length(compte) <= 20),
  activite_id    INTEGER        REFERENCES activites(id),
  montant_ht     NUMERIC(18,2)  NOT NULL DEFAULT 0,
  montant_taxe   NUMERIC(18,2)  NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_fin_facture_lignes ON fin_facture_lignes (facture_id, ordre);

CREATE TABLE IF NOT EXISTS fin_imputations_externes (
  id            BIGSERIAL    PRIMARY KEY,
  tenant_id     UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  com_ff_id     BIGINT       NOT NULL UNIQUE REFERENCES com_factures_fournisseurs(id),
  categorie_id  BIGINT       NOT NULL REFERENCES fin_categories(id),
  compte        TEXT         NOT NULL DEFAULT '' CHECK (length(compte) <= 20),   -- '' : compte de chaque article / de la catégorie
  activite_id   INTEGER      REFERENCES activites(id),
  compte_tiers  TEXT         NOT NULL CHECK (btrim(compte_tiers) <> ''),
  impute_par    UUID         REFERENCES users(id) ON DELETE SET NULL,
  impute_le     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fin_imputations_tenant ON fin_imputations_externes (tenant_id);

CREATE TABLE IF NOT EXISTS fin_reglement_affectations (
  id            BIGSERIAL      PRIMARY KEY,
  tenant_id     UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mouvement_id  BIGINT         NOT NULL REFERENCES journal(id),
  facture_type  TEXT           NOT NULL CHECK (facture_type IN ('fin', 'com_ff')),
  facture_id    BIGINT         NOT NULL,
  montant       NUMERIC(18,2)  NOT NULL CHECK (montant > 0),
  cree_par      UUID           REFERENCES users(id) ON DELETE SET NULL,
  cree_le       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  UNIQUE (mouvement_id, facture_type, facture_id)
);
CREATE INDEX IF NOT EXISTS idx_fin_affectations_facture ON fin_reglement_affectations (tenant_id, facture_type, facture_id);

-- ── Reste à payer d'une facture (négatif : avoir à récupérer) ──────────────
CREATE OR REPLACE FUNCTION fin_facture_reste(p_type TEXT, p_id BIGINT) RETURNS NUMERIC
LANGUAGE plpgsql STABLE AS $$
DECLARE ttc NUMERIC; av NUMERIC; reg NUMERIC;
BEGIN
  IF p_type = 'fin' THEN
    SELECT total_ttc INTO ttc FROM fin_factures WHERE id = p_id;
    SELECT coalesce(sum(total_ttc), 0) INTO av FROM fin_factures WHERE facture_origine_id = p_id AND statut = 'validee';
  ELSE
    SELECT total_ttc INTO ttc FROM com_factures_fournisseurs WHERE id = p_id;
    SELECT coalesce(sum(total_ttc), 0) INTO av FROM com_factures_fournisseurs WHERE facture_origine_id = p_id AND statut = 'valide';
  END IF;
  SELECT coalesce(sum(a.montant), 0) INTO reg FROM fin_reglement_affectations a JOIN journal j ON j.id = a.mouvement_id
   WHERE a.facture_type = p_type AND a.facture_id = p_id AND j.annule_par_id IS NULL;
  RETURN coalesce(ttc, 0) - av - reg;
END $$;

-- ── Garde-fous ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fin_factures_controle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE o RECORD;
BEGIN
  IF current_setting('app.finance_maintenance', true) = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.statut NOT IN ('brouillon', 'a_valider') THEN
      RAISE EXCEPTION 'FACTURE_INTANGIBLE: une facture validée ou annulée ne se supprime pas.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM registre_tiers WHERE id = NEW.tiers_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'FACTURE_INCOHERENTE: tiers introuvable pour ce client.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM fin_categories WHERE id = NEW.categorie_id AND tenant_id = NEW.tenant_id
                   AND sens = CASE NEW.sens WHEN 'fournisseur' THEN 'charge' ELSE 'produit' END) THEN
    RAISE EXCEPTION 'FACTURE_INCOHERENTE: catégorie introuvable ou de mauvais sens.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.activite_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM activites WHERE id = NEW.activite_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'FACTURE_INCOHERENTE: activité introuvable pour ce client.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.facture_origine_id IS NOT NULL THEN
    SELECT tenant_id, tiers_id, sens, type INTO o FROM fin_factures WHERE id = NEW.facture_origine_id;
    IF o.tenant_id IS DISTINCT FROM NEW.tenant_id OR o.tiers_id <> NEW.tiers_id OR o.sens <> NEW.sens OR o.type <> 'facture' THEN
      RAISE EXCEPTION 'FACTURE_INCOHERENTE: un avoir se rattache à une facture du même tiers.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.statut IN ('validee', 'annulee') THEN
    -- Une facture validée ne change plus ; seule l'annulation motivée est permise.
    IF OLD.statut = 'annulee' OR NEW.statut <> 'annulee'
       OR (NEW.tiers_id, NEW.type, NEW.numero, NEW.reference, NEW.date_facture, NEW.date_echeance, NEW.categorie_id,
           NEW.activite_id, NEW.total_ht, NEW.total_taxes, NEW.total_ttc, NEW.compte_tiers, NEW.valide_par)
          IS DISTINCT FROM
          (OLD.tiers_id, OLD.type, OLD.numero, OLD.reference, OLD.date_facture, OLD.date_echeance, OLD.categorie_id,
           OLD.activite_id, OLD.total_ht, OLD.total_taxes, OLD.total_ttc, OLD.compte_tiers, OLD.valide_par) THEN
      RAISE EXCEPTION 'FACTURE_INTANGIBLE: une facture validée ne se modifie plus ; annulez-la avec un motif ou passez un avoir.' USING ERRCODE = 'check_violation';
    END IF;
    IF btrim(NEW.motif_annulation) = '' THEN
      RAISE EXCEPTION 'MOTIF_OBLIGATOIRE: indiquez le motif de l''annulation.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.modifie_le := NOW();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_fin_factures_controle ON fin_factures;
CREATE TRIGGER trg_fin_factures_controle BEFORE INSERT OR UPDATE OR DELETE ON fin_factures
  FOR EACH ROW EXECUTE FUNCTION fin_factures_controle();

CREATE OR REPLACE FUNCTION fin_facture_lignes_controle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE f RECORD;
BEGIN
  IF current_setting('app.finance_maintenance', true) = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT tenant_id, statut INTO f FROM fin_factures WHERE id = COALESCE(NEW.facture_id, OLD.facture_id);
  IF f.statut IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;          -- facture supprimée (brouillon)
  IF f.statut <> 'brouillon' THEN
    RAISE EXCEPTION 'FACTURE_INTANGIBLE: les lignes ne se modifient qu''au brouillon.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    IF NEW.tenant_id IS DISTINCT FROM f.tenant_id THEN
      RAISE EXCEPTION 'FACTURE_INCOHERENTE: ligne d''un autre client.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.taxe_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM com_taxes WHERE id = NEW.taxe_id AND tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'FACTURE_INCOHERENTE: taxe introuvable pour ce client.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.prestation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM fin_prestations WHERE id = NEW.prestation_id AND tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'FACTURE_INCOHERENTE: prestation introuvable pour ce client.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.activite_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM activites WHERE id = NEW.activite_id AND tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'FACTURE_INCOHERENTE: activité introuvable pour ce client.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_fin_facture_lignes_controle ON fin_facture_lignes;
CREATE TRIGGER trg_fin_facture_lignes_controle BEFORE INSERT OR UPDATE OR DELETE ON fin_facture_lignes
  FOR EACH ROW EXECUTE FUNCTION fin_facture_lignes_controle();

CREATE OR REPLACE FUNCTION fin_imputations_controle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.finance_maintenance', true) = 'on' THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM com_factures_fournisseurs WHERE id = NEW.com_ff_id AND tenant_id = NEW.tenant_id AND statut = 'valide') THEN
    RAISE EXCEPTION 'IMPUTATION_IMPOSSIBLE: seule une facture validée dans NJ COMMERCIAL s''impute.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM fin_categories WHERE id = NEW.categorie_id AND tenant_id = NEW.tenant_id AND sens = 'charge') THEN
    RAISE EXCEPTION 'IMPUTATION_IMPOSSIBLE: catégorie de charge introuvable.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.activite_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM activites WHERE id = NEW.activite_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'IMPUTATION_IMPOSSIBLE: activité introuvable pour ce client.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_fin_imputations_controle ON fin_imputations_externes;
CREATE TRIGGER trg_fin_imputations_controle BEFORE INSERT OR UPDATE ON fin_imputations_externes
  FOR EACH ROW EXECUTE FUNCTION fin_imputations_controle();

-- Affectation d'une sortie de caisse à une facture fournisseur.
CREATE OR REPLACE FUNCTION fin_affectations_controle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE m RECORD; f_tiers BIGINT; f_ok BOOLEAN; deja NUMERIC; reste NUMERIC;
BEGIN
  IF current_setting('app.finance_maintenance', true) = 'on' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'REGLEMENT_INTANGIBLE: retirez l''affectation puis refaites-la.' USING ERRCODE = 'check_violation';
  END IF;
  -- Un règlement à la fois par client : les plafonds restent exacts sous accès concurrent.
  PERFORM pg_advisory_xact_lock(hashtext('fin_reglements:' || NEW.tenant_id::text));
  SELECT j.tenant_id, coalesce(j.sortie, 0) AS sortie, coalesce(j.entree, 0) AS entree, j.tiers_id, j.annule_par_id, j.annulation_de_id,
         coalesce(r.est_virement_interne, false) AS virement
    INTO m FROM journal j LEFT JOIN rubriques r ON r.tenant_id = j.tenant_id AND r.code = j.rubrique_code
   WHERE j.id = NEW.mouvement_id;
  IF m.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'REGLEMENT_IMPOSSIBLE: mouvement de caisse introuvable pour ce client.' USING ERRCODE = 'check_violation';
  END IF;
  IF m.sortie <= 0 OR m.entree <> 0 OR m.virement THEN
    RAISE EXCEPTION 'REGLEMENT_IMPOSSIBLE: seule une sortie de caisse ou de banque (hors virement interne) règle une facture fournisseur.' USING ERRCODE = 'check_violation';
  END IF;
  IF m.annule_par_id IS NOT NULL OR m.annulation_de_id IS NOT NULL THEN
    RAISE EXCEPTION 'REGLEMENT_IMPOSSIBLE: ce mouvement de caisse est annulé.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.facture_type = 'fin' THEN
    SELECT tiers_id, (tenant_id = NEW.tenant_id AND sens = 'fournisseur' AND type = 'facture' AND statut = 'validee')
      INTO f_tiers, f_ok FROM fin_factures WHERE id = NEW.facture_id;
  ELSE
    SELECT c.fournisseur_id, (c.tenant_id = NEW.tenant_id AND c.type = 'facture' AND c.statut = 'valide'
                              AND EXISTS (SELECT 1 FROM fin_imputations_externes i WHERE i.com_ff_id = c.id))
      INTO f_tiers, f_ok FROM com_factures_fournisseurs c WHERE c.id = NEW.facture_id;
  END IF;
  IF NOT coalesce(f_ok, false) THEN
    RAISE EXCEPTION 'REGLEMENT_IMPOSSIBLE: seule une facture fournisseur validée (et imputée, pour NJ COMMERCIAL) se règle.' USING ERRCODE = 'check_violation';
  END IF;
  IF m.tiers_id IS NOT NULL AND m.tiers_id <> f_tiers THEN
    RAISE EXCEPTION 'REGLEMENT_IMPOSSIBLE: le bénéficiaire du mouvement n''est pas le fournisseur de la facture.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(sum(montant), 0) INTO deja FROM fin_reglement_affectations WHERE mouvement_id = NEW.mouvement_id;
  IF deja + NEW.montant > m.sortie THEN
    RAISE EXCEPTION 'REGLEMENT_DEPASSE: la sortie (%) est déjà affectée pour % ; il reste % à affecter.',
      m.sortie, deja, m.sortie - deja USING ERRCODE = 'check_violation';
  END IF;
  reste := fin_facture_reste(NEW.facture_type, NEW.facture_id);
  IF NEW.montant > reste THEN
    RAISE EXCEPTION 'REGLEMENT_DEPASSE: le reste à payer de la facture est de %.', greatest(reste, 0) USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_fin_affectations_controle ON fin_reglement_affectations;
CREATE TRIGGER trg_fin_affectations_controle BEFORE INSERT OR UPDATE ON fin_reglement_affectations
  FOR EACH ROW EXECUTE FUNCTION fin_affectations_controle();

-- Un compte cité par une facture ou une imputation reste dans le plan.
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
      OR EXISTS (SELECT 1 FROM fin_taxes_comptes x WHERE x.tenant_id = p_tenant AND lower(btrim(p_compte)) IN (lower(btrim(x.compte_collecte)), lower(btrim(x.compte_deductible)), lower(btrim(x.compte_deductible_immo))))
      OR EXISTS (SELECT 1 FROM fin_facture_lignes fl WHERE fl.tenant_id = p_tenant AND lower(btrim(fl.compte)) = lower(btrim(p_compte)))
      OR EXISTS (SELECT 1 FROM fin_imputations_externes ie WHERE ie.tenant_id = p_tenant AND lower(btrim(p_compte)) IN (lower(btrim(ie.compte)), lower(btrim(ie.compte_tiers))));
$$;

-- ── Permissions ─────────────────────────────────────────────────────────────
INSERT INTO permissions(code, nom, module, description) VALUES
  ('finance.achats.voir',    'Voir les achats', 'finance',
   'Consulter les factures fournisseurs (NJ FINANCE et NJ COMMERCIAL), leurs règlements et l''échéancier'),
  ('finance.achats.saisir',  'Saisir les factures fournisseurs', 'finance',
   'Enregistrer et soumettre les factures et avoirs fournisseurs'),
  ('finance.achats.valider', 'Valider les factures fournisseurs', 'finance',
   'Valider (écriture d''achat), renvoyer ou annuler une facture fournisseur saisie par une autre personne ; imputer les factures de NJ COMMERCIAL'),
  ('finance.reglements.affecter', 'Affecter les règlements', 'finance',
   'Relier une sortie de caisse ou de banque aux factures fournisseurs qu''elle règle')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, v.code FROM roles r
 CROSS JOIN (VALUES ('finance.achats.voir'), ('finance.achats.saisir'), ('finance.achats.valider'), ('finance.reglements.affecter')) AS v(code)
 WHERE r.code IN ('directeur', 'auditeur', 'comptable_cabinet') AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, v.code FROM roles r
 CROSS JOIN (VALUES ('finance.achats.voir'), ('finance.achats.saisir'), ('finance.reglements.affecter')) AS v(code)
 WHERE r.code = 'caissier' AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;

INSERT INTO tenant_permissions(tenant_id, permission_code)
SELECT DISTINCT tp.tenant_id, v.code FROM tenant_permissions tp
 CROSS JOIN (VALUES ('finance.achats.voir'), ('finance.achats.saisir'), ('finance.achats.valider'), ('finance.reglements.affecter')) AS v(code)
 WHERE tp.permission_code = 'journal.view'
ON CONFLICT DO NOTHING;
