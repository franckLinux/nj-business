-- ============================================================================
-- Retour arrière de la migration 086 (ordres de décaissement). À jouer À LA MAIN :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/086_retour_arriere.sql
-- Les mouvements de caisse déjà écrits restent (ils sont au journal) ; on remet
-- le contrôle de 083 : la caisse décaisse de nouveau sans ordre.
-- ============================================================================
BEGIN;
DROP TRIGGER IF EXISTS trg_projet_ordre_controle ON projet_ordres_decaissement;
DROP FUNCTION IF EXISTS projet_ordre_controle();
ALTER TABLE projet_demande_mouvements DROP COLUMN IF EXISTS ordre_id;
DROP TABLE IF EXISTS projet_ordres_decaissement;
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
ALTER TABLE password_resets DROP CONSTRAINT IF EXISTS chk_password_resets_nature;
ALTER TABLE password_resets DROP COLUMN IF EXISTS nature;
DELETE FROM schema_migrations WHERE version LIKE '086_%';
COMMIT;
