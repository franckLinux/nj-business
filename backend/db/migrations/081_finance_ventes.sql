-- ============================================================================
-- 081 — NJ FINANCE, lot F8 : ventes et facturation, proformas, règlements hors
--        caisse ni banque (décisions de Franck du 25/11/2026)
--
--  1. fin_factures sert aussi aux FACTURES CLIENTS (sens 'client') : facture,
--     avoir, et PROFORMA (type 'proforma' : numérotée PRO-AAAA-…, sans écriture,
--     transformée ensuite en facture — statut 'transformee', lien proforma_id).
--     L'identité de l'émetteur (logo, NIU, RCCM…) est figée à la validation
--     (identite_emetteur), comme les devis de NJ COMMERCIAL.
--  2. Règlement par la caisse ou la banque : une entrée règle une facture
--     client, une sortie une facture fournisseur (fin_reglement_affectations).
--  3. fin_reglements_hors_caisse : règlement sans caisse ni banque (compensation,
--     paiement par un associé, abandon…). Proposé avec un compte de contrepartie
--     et un motif ; SEUL UN DIRECTEUR le valide (contrôle en base) ; il passe
--     alors une écriture d'OD. Jamais un compte de trésorerie (classe 5).
--  4. fin_facture_reste() tient compte de ces règlements.
--  5. Permissions finance.ventes.voir / facturer / valider, finance.reglements.hors_caisse.
--
--  Additive et idempotente. Retour arrière : 081_retour_arriere.sql
-- ============================================================================

ALTER TABLE fin_factures ADD COLUMN IF NOT EXISTS proforma_id BIGINT REFERENCES fin_factures(id);
ALTER TABLE fin_factures ADD COLUMN IF NOT EXISTS identite_emetteur JSONB;
ALTER TABLE fin_factures ADD COLUMN IF NOT EXISTS conditions_paiement TEXT NOT NULL DEFAULT '';
ALTER TABLE fin_factures DROP CONSTRAINT IF EXISTS fin_factures_conditions_paiement_check;
ALTER TABLE fin_factures ADD CONSTRAINT fin_factures_conditions_paiement_check CHECK (length(conditions_paiement) <= 300);
ALTER TABLE fin_factures DROP CONSTRAINT IF EXISTS fin_factures_type_check;
ALTER TABLE fin_factures ADD CONSTRAINT fin_factures_type_check CHECK (type IN ('facture', 'avoir', 'proforma'));
ALTER TABLE fin_factures DROP CONSTRAINT IF EXISTS fin_factures_statut_check;
ALTER TABLE fin_factures ADD CONSTRAINT fin_factures_statut_check CHECK (statut IN ('brouillon', 'a_valider', 'validee', 'annulee', 'transformee'));
ALTER TABLE fin_factures DROP CONSTRAINT IF EXISTS fin_factures_proforma_check;
ALTER TABLE fin_factures ADD CONSTRAINT fin_factures_proforma_check CHECK (type <> 'proforma' OR sens = 'client');
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_factures_proforma ON fin_factures (proforma_id) WHERE proforma_id IS NOT NULL AND statut <> 'annulee';

ALTER TABLE fin_sequences DROP CONSTRAINT IF EXISTS fin_sequences_type_document_check;
ALTER TABLE fin_sequences ADD CONSTRAINT fin_sequences_type_document_check
  CHECK (type_document IN ('facture_client', 'avoir_client', 'proforma', 'facture_fournisseur', 'avoir_fournisseur'));

ALTER TABLE fin_ecritures DROP CONSTRAINT IF EXISTS fin_ecritures_origine_type_check;
ALTER TABLE fin_ecritures ADD CONSTRAINT fin_ecritures_origine_type_check
  CHECK (origine_type IN ('manuelle', 'extourne', 'journal', 'fin_facture', 'com_ff', 'fin_reglement_hc',
                          'immo_dotation', 'immo_sortie', 'stock_variation', 'an'));

-- ── Règlements hors caisse ni banque ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fin_reglements_hors_caisse (
  id               BIGSERIAL      PRIMARY KEY,
  tenant_id        UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  facture_type     TEXT           NOT NULL CHECK (facture_type IN ('fin', 'com_ff')),
  facture_id       BIGINT         NOT NULL,
  date_reglement   DATE           NOT NULL,
  montant          NUMERIC(18,2)  NOT NULL CHECK (montant > 0),
  compte           TEXT           NOT NULL CHECK (btrim(compte) <> '' AND length(compte) <= 20),
  tiers_id         BIGINT         REFERENCES registre_tiers(id),
  motif            TEXT           NOT NULL CHECK (btrim(motif) <> '' AND length(motif) <= 500),
  statut           TEXT           NOT NULL DEFAULT 'propose' CHECK (statut IN ('propose', 'valide', 'rejete', 'annule')),
  propose_par      UUID           REFERENCES users(id) ON DELETE SET NULL,
  propose_le       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  decide_par       UUID           REFERENCES users(id) ON DELETE SET NULL,
  decide_le        TIMESTAMPTZ,
  motif_decision   TEXT           NOT NULL DEFAULT '' CHECK (length(motif_decision) <= 500),
  CHECK (compte !~ '^5'),
  CHECK (statut = 'propose' OR decide_par IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_fin_hc_facture ON fin_reglements_hors_caisse (tenant_id, facture_type, facture_id);
CREATE INDEX IF NOT EXISTS idx_fin_hc_statut ON fin_reglements_hors_caisse (tenant_id, statut);

-- ── Reste à payer (négatif : avoir à rembourser) ────────────────────────────
CREATE OR REPLACE FUNCTION fin_facture_reste(p_type TEXT, p_id BIGINT) RETURNS NUMERIC
LANGUAGE plpgsql STABLE AS $$
DECLARE ttc NUMERIC; av NUMERIC; reg NUMERIC; hc NUMERIC;
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
  SELECT coalesce(sum(montant), 0) INTO hc FROM fin_reglements_hors_caisse
   WHERE facture_type = p_type AND facture_id = p_id AND statut = 'valide';
  RETURN coalesce(ttc, 0) - av - reg - hc;
END $$;

-- Facture réglable : validée, type facture (et imputée pour NJ COMMERCIAL). Renvoie tiers et sens.
CREATE OR REPLACE FUNCTION fin_facture_reglable(p_tenant UUID, p_type TEXT, p_id BIGINT, OUT tiers_id BIGINT, OUT sens TEXT, OUT ok BOOLEAN)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_type = 'fin' THEN
    SELECT f.tiers_id, f.sens, (f.tenant_id = p_tenant AND f.type = 'facture' AND f.statut = 'validee')
      INTO tiers_id, sens, ok FROM fin_factures f WHERE f.id = p_id;
  ELSE
    SELECT c.fournisseur_id, 'fournisseur', (c.tenant_id = p_tenant AND c.type = 'facture' AND c.statut = 'valide'
                                             AND EXISTS (SELECT 1 FROM fin_imputations_externes i WHERE i.com_ff_id = c.id))
      INTO tiers_id, sens, ok FROM com_factures_fournisseurs c WHERE c.id = p_id;
  END IF;
  ok := coalesce(ok, false);
END $$;

-- Affectation d'un mouvement de caisse : une SORTIE règle une facture
-- fournisseur, une ENTRÉE une facture client.
CREATE OR REPLACE FUNCTION fin_affectations_controle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE m RECORD; f RECORD; deja NUMERIC; reste NUMERIC; mt NUMERIC;
BEGIN
  IF current_setting('app.finance_maintenance', true) = 'on' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'REGLEMENT_INTANGIBLE: retirez l''affectation puis refaites-la.' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('fin_reglements:' || NEW.tenant_id::text));
  SELECT j.tenant_id, coalesce(j.sortie, 0) AS sortie, coalesce(j.entree, 0) AS entree, j.tiers_id, j.annule_par_id, j.annulation_de_id,
         coalesce(r.est_virement_interne, false) AS virement
    INTO m FROM journal j LEFT JOIN rubriques r ON r.tenant_id = j.tenant_id AND r.code = j.rubrique_code
   WHERE j.id = NEW.mouvement_id;
  IF m.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'REGLEMENT_IMPOSSIBLE: mouvement de caisse introuvable pour ce client.' USING ERRCODE = 'check_violation';
  END IF;
  IF m.annule_par_id IS NOT NULL OR m.annulation_de_id IS NOT NULL THEN
    RAISE EXCEPTION 'REGLEMENT_IMPOSSIBLE: ce mouvement de caisse est annulé.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO f FROM fin_facture_reglable(NEW.tenant_id, NEW.facture_type, NEW.facture_id);
  IF NOT f.ok THEN
    RAISE EXCEPTION 'REGLEMENT_IMPOSSIBLE: seule une facture validée (et imputée, pour NJ COMMERCIAL) se règle.' USING ERRCODE = 'check_violation';
  END IF;
  IF m.virement THEN
    RAISE EXCEPTION 'REGLEMENT_IMPOSSIBLE: un virement interne ne règle pas de facture.' USING ERRCODE = 'check_violation';
  END IF;
  IF f.sens = 'fournisseur' AND (m.sortie <= 0 OR m.entree <> 0) THEN
    RAISE EXCEPTION 'REGLEMENT_IMPOSSIBLE: une facture fournisseur se règle par une sortie de caisse ou de banque.' USING ERRCODE = 'check_violation';
  END IF;
  IF f.sens = 'client' AND (m.entree <= 0 OR m.sortie <> 0) THEN
    RAISE EXCEPTION 'REGLEMENT_IMPOSSIBLE: une facture client se règle par une entrée de caisse ou de banque.' USING ERRCODE = 'check_violation';
  END IF;
  IF m.tiers_id IS NOT NULL AND m.tiers_id <> f.tiers_id THEN
    RAISE EXCEPTION 'REGLEMENT_IMPOSSIBLE: le tiers du mouvement n''est pas celui de la facture.' USING ERRCODE = 'check_violation';
  END IF;
  mt := CASE WHEN f.sens = 'client' THEN m.entree ELSE m.sortie END;
  SELECT coalesce(sum(montant), 0) INTO deja FROM fin_reglement_affectations WHERE mouvement_id = NEW.mouvement_id;
  IF deja + NEW.montant > mt THEN
    RAISE EXCEPTION 'REGLEMENT_DEPASSE: le mouvement (%) est déjà affecté pour % ; il reste % à affecter.',
      mt, deja, mt - deja USING ERRCODE = 'check_violation';
  END IF;
  reste := fin_facture_reste(NEW.facture_type, NEW.facture_id);
  IF NEW.montant > reste THEN
    RAISE EXCEPTION 'REGLEMENT_DEPASSE: le reste à payer de la facture est de %.', greatest(reste, 0) USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- Factures : proforma transformée ; catégorie du bon sens.
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
  IF NEW.proforma_id IS NOT NULL THEN
    SELECT tenant_id, tiers_id, sens, type INTO o FROM fin_factures WHERE id = NEW.proforma_id;
    IF o.tenant_id IS DISTINCT FROM NEW.tenant_id OR o.sens <> 'client' OR o.type <> 'proforma' OR NEW.type <> 'facture' THEN
      RAISE EXCEPTION 'FACTURE_INCOHERENTE: une facture issue d''une proforma doit concerner la même entité.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.statut IN ('validee', 'annulee', 'transformee') THEN
    -- Validée : intangible ; seule l'annulation motivée est permise, et la
    -- transformation d'une proforma émise en facture.
    IF OLD.statut IN ('annulee', 'transformee')
       OR NOT (NEW.statut = 'annulee' OR (OLD.type = 'proforma' AND NEW.statut = 'transformee'))
       OR (NEW.tiers_id, NEW.type, NEW.numero, NEW.reference, NEW.date_facture, NEW.date_echeance, NEW.categorie_id,
           NEW.activite_id, NEW.total_ht, NEW.total_taxes, NEW.total_ttc, NEW.compte_tiers, NEW.valide_par, NEW.identite_emetteur)
          IS DISTINCT FROM
          (OLD.tiers_id, OLD.type, OLD.numero, OLD.reference, OLD.date_facture, OLD.date_echeance, OLD.categorie_id,
           OLD.activite_id, OLD.total_ht, OLD.total_taxes, OLD.total_ttc, OLD.compte_tiers, OLD.valide_par, OLD.identite_emetteur) THEN
      RAISE EXCEPTION 'FACTURE_INTANGIBLE: une facture validée ne se modifie plus ; annulez-la avec un motif ou passez un avoir.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.statut = 'annulee' AND btrim(NEW.motif_annulation) = '' THEN
      RAISE EXCEPTION 'MOTIF_OBLIGATOIRE: indiquez le motif de l''annulation.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.modifie_le := NOW();
  RETURN NEW;
END $$;

-- Règlements hors caisse : contrôles et décision réservée au directeur.
CREATE OR REPLACE FUNCTION fin_hors_caisse_controle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE f RECORD; reste NUMERIC; a TEXT;
BEGIN
  IF current_setting('app.finance_maintenance', true) = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.statut <> 'propose' THEN
      RAISE EXCEPTION 'REGLEMENT_INTANGIBLE: un règlement décidé ne se supprime pas.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('fin_reglements:' || NEW.tenant_id::text));
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.tenant_id, NEW.facture_type, NEW.facture_id, NEW.date_reglement, NEW.montant, NEW.compte, NEW.tiers_id, NEW.motif, NEW.propose_par)
       IS DISTINCT FROM (OLD.tenant_id, OLD.facture_type, OLD.facture_id, OLD.date_reglement, OLD.montant, OLD.compte, OLD.tiers_id, OLD.motif, OLD.propose_par)
       OR NOT ((OLD.statut = 'propose' AND NEW.statut IN ('valide', 'rejete')) OR (OLD.statut = 'valide' AND NEW.statut = 'annule')) THEN
      RAISE EXCEPTION 'REGLEMENT_INTANGIBLE: seule la décision du directeur change un règlement hors caisse.' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.decide_par AND role = 'directeur') THEN
      RAISE EXCEPTION 'DIRECTEUR_SEUL: seul le directeur valide, rejette ou annule un règlement hors caisse ni banque.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.statut IN ('rejete', 'annule') AND btrim(NEW.motif_decision) = '' THEN
      RAISE EXCEPTION 'MOTIF_OBLIGATOIRE: indiquez le motif.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.statut <> 'valide' THEN RETURN NEW; END IF;
  ELSE
    IF NEW.statut <> 'propose' THEN
      RAISE EXCEPTION 'REGLEMENT_IMPOSSIBLE: un règlement hors caisse est d''abord proposé.' USING ERRCODE = 'check_violation';
    END IF;
    a := fin_compte_anomalie(NEW.tenant_id, NEW.compte);
    IF a IS NOT NULL THEN RAISE EXCEPTION 'REGLEMENT_IMPOSSIBLE: compte %.', a USING ERRCODE = 'check_violation'; END IF;
    IF NEW.compte ~ '^4[01]' AND NEW.tiers_id IS NULL THEN
      RAISE EXCEPTION 'REGLEMENT_IMPOSSIBLE: un compte de tiers (40, 41) exige le tiers concerné.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.tiers_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM registre_tiers WHERE id = NEW.tiers_id AND tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'REGLEMENT_IMPOSSIBLE: tiers introuvable pour ce client.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  SELECT * INTO f FROM fin_facture_reglable(NEW.tenant_id, NEW.facture_type, NEW.facture_id);
  IF NOT f.ok THEN
    RAISE EXCEPTION 'REGLEMENT_IMPOSSIBLE: seule une facture validée (et imputée, pour NJ COMMERCIAL) se règle.' USING ERRCODE = 'check_violation';
  END IF;
  reste := fin_facture_reste(NEW.facture_type, NEW.facture_id);
  IF NEW.montant > reste THEN
    RAISE EXCEPTION 'REGLEMENT_DEPASSE: le reste à payer de la facture est de %.', greatest(reste, 0) USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_fin_hors_caisse_controle ON fin_reglements_hors_caisse;
CREATE TRIGGER trg_fin_hors_caisse_controle BEFORE INSERT OR UPDATE OR DELETE ON fin_reglements_hors_caisse
  FOR EACH ROW EXECUTE FUNCTION fin_hors_caisse_controle();

-- Un compte cité par un règlement hors caisse reste dans le plan.
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
      OR EXISTS (SELECT 1 FROM fin_imputations_externes ie WHERE ie.tenant_id = p_tenant AND lower(btrim(p_compte)) IN (lower(btrim(ie.compte)), lower(btrim(ie.compte_tiers))))
      OR EXISTS (SELECT 1 FROM fin_reglements_hors_caisse h WHERE h.tenant_id = p_tenant AND lower(btrim(h.compte)) = lower(btrim(p_compte)));
$$;

-- ── Permissions ─────────────────────────────────────────────────────────────
INSERT INTO permissions(code, nom, module, description) VALUES
  ('finance.ventes.voir',     'Voir les ventes', 'finance',
   'Consulter les factures, avoirs et proformas clients, leurs règlements et l''échéancier des créances'),
  ('finance.ventes.facturer', 'Établir les factures clients', 'finance',
   'Préparer factures, avoirs et proformas clients ; émettre une proforma et la transformer en facture'),
  ('finance.ventes.valider',  'Valider les factures clients', 'finance',
   'Valider (écriture de vente), renvoyer ou annuler une facture client établie par une autre personne'),
  ('finance.reglements.hors_caisse', 'Proposer un règlement hors caisse', 'finance',
   'Proposer le règlement d''une facture sans caisse ni banque (compte au choix, motif) ; seul le directeur le valide')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, v.code FROM roles r
 CROSS JOIN (VALUES ('finance.ventes.voir'), ('finance.ventes.facturer'), ('finance.ventes.valider'), ('finance.reglements.hors_caisse')) AS v(code)
 WHERE r.code IN ('directeur', 'auditeur', 'comptable_cabinet') AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, v.code FROM roles r
 CROSS JOIN (VALUES ('finance.ventes.voir'), ('finance.ventes.facturer')) AS v(code)
 WHERE r.code = 'caissier' AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;

INSERT INTO tenant_permissions(tenant_id, permission_code)
SELECT DISTINCT tp.tenant_id, v.code FROM tenant_permissions tp
 CROSS JOIN (VALUES ('finance.ventes.voir'), ('finance.ventes.facturer'), ('finance.ventes.valider'), ('finance.reglements.hors_caisse')) AS v(code)
 WHERE tp.permission_code = 'journal.view'
ON CONFLICT DO NOTHING;
