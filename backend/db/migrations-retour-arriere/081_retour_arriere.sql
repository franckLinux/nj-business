-- ============================================================================
-- Retour arrière de la migration 081 (ventes, proformas, règlements hors caisse).
-- À jouer À LA MAIN, après être revenu au code d'avant la 081 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/081_retour_arriere.sql
-- Supprime les factures, avoirs et proformas CLIENTS, les règlements hors caisse
-- et leurs écritures (et extournes), ainsi que les affectations d'entrées de
-- caisse aux factures clients. Le journal de caisse n'est pas touché : les
-- écritures de caisse concernées sont refaites au passage suivant du générateur.
-- Les factures fournisseurs (080) sont conservées.
-- ============================================================================
BEGIN;
SET LOCAL app.finance_maintenance = 'on';
DELETE FROM fin_ecritures
 WHERE (origine_type = 'extourne' AND extourne_de_id IN (
          SELECT id FROM fin_ecritures WHERE origine_type = 'fin_reglement_hc'
             OR (origine_type = 'fin_facture' AND origine_id IN (SELECT id FROM fin_factures WHERE sens = 'client'))));
DELETE FROM fin_ecritures
 WHERE origine_type = 'fin_reglement_hc'
    OR (origine_type = 'fin_facture' AND origine_id IN (SELECT id FROM fin_factures WHERE sens = 'client'));
DELETE FROM fin_reglement_affectations a USING fin_factures f
 WHERE a.facture_type = 'fin' AND f.id = a.facture_id AND f.sens = 'client';
DROP TABLE IF EXISTS fin_reglements_hors_caisse;
DROP FUNCTION IF EXISTS fin_hors_caisse_controle();
UPDATE fin_factures SET proforma_id = NULL WHERE proforma_id IS NOT NULL;
DELETE FROM fin_factures WHERE sens = 'client' AND facture_origine_id IS NOT NULL;
DELETE FROM fin_factures WHERE sens = 'client';
DROP INDEX IF EXISTS uq_fin_factures_proforma;
ALTER TABLE fin_factures DROP CONSTRAINT IF EXISTS fin_factures_proforma_check;
ALTER TABLE fin_factures DROP CONSTRAINT IF EXISTS fin_factures_conditions_paiement_check;
ALTER TABLE fin_factures DROP COLUMN IF EXISTS proforma_id;
ALTER TABLE fin_factures DROP COLUMN IF EXISTS identite_emetteur;
ALTER TABLE fin_factures DROP COLUMN IF EXISTS conditions_paiement;
ALTER TABLE fin_factures DROP CONSTRAINT IF EXISTS fin_factures_type_check;
ALTER TABLE fin_factures ADD CONSTRAINT fin_factures_type_check CHECK (type IN ('facture', 'avoir'));
ALTER TABLE fin_factures DROP CONSTRAINT IF EXISTS fin_factures_statut_check;
ALTER TABLE fin_factures ADD CONSTRAINT fin_factures_statut_check CHECK (statut IN ('brouillon', 'a_valider', 'validee', 'annulee'));
DELETE FROM fin_sequences WHERE type_document = 'proforma';
ALTER TABLE fin_sequences DROP CONSTRAINT IF EXISTS fin_sequences_type_document_check;
ALTER TABLE fin_sequences ADD CONSTRAINT fin_sequences_type_document_check
  CHECK (type_document IN ('facture_client', 'avoir_client', 'facture_fournisseur', 'avoir_fournisseur'));
ALTER TABLE fin_ecritures DROP CONSTRAINT IF EXISTS fin_ecritures_origine_type_check;
ALTER TABLE fin_ecritures ADD CONSTRAINT fin_ecritures_origine_type_check
  CHECK (origine_type IN ('manuelle', 'extourne', 'journal', 'fin_facture', 'com_ff', 'immo_dotation', 'immo_sortie', 'stock_variation', 'an'));
DROP FUNCTION IF EXISTS fin_facture_reglable(UUID, TEXT, BIGINT);

-- Fonctions de la 080, à l'identique.
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

DELETE FROM permissions WHERE code IN ('finance.ventes.voir', 'finance.ventes.facturer', 'finance.ventes.valider', 'finance.reglements.hors_caisse');
DELETE FROM schema_migrations WHERE version LIKE '081_%';
COMMIT;
