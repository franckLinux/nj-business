-- ============================================================================
-- 070 — Projets des ONG et associations, lot P3 : justificatifs (19/11/2026)
--
-- Le responsable d'activité dépose les pièces qui justifient les fonds remis
-- (sorties de journal vers son activité, 069). Le chef de projet ou le
-- comptable les valide ou les rejette (motif) ; jamais la personne qui les a
-- déposées. Un justificatif validé ne se supprime pas : il s'annule (motif),
-- par le directeur. Les fichiers vivent dans le stockage PRIVÉ (PV_DIR), servis
-- par une route authentifiée, jamais par /uploads.
--
-- Bilan d'une activité (calculé, rien n'est recopié) :
--   alloué    = sorties de journal vers l'activité (hors annulées / contre-passations)
--   remboursé = entrées de journal sur l'activité (reliquat rendu)
--   justifié  = justificatifs VALIDÉS
--   en attente de justification = alloué − justifié − remboursé
--
-- Additive et idempotente. Retour arrière : migrations-retour-arriere/070_retour_arriere.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS projet_justificatifs (
  id                BIGSERIAL     PRIMARY KEY,
  tenant_id         UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  projet_id         INTEGER       NOT NULL REFERENCES activites(id),
  activite_id       INTEGER       NOT NULL REFERENCES activites(id),
  remise_id         BIGINT        REFERENCES journal(id),          -- remise de fonds justifiée (facultatif)
  date_piece        DATE          NOT NULL,
  montant           NUMERIC(15,2) NOT NULL CHECK (montant > 0),
  fournisseur       TEXT          NOT NULL DEFAULT '' CHECK (length(fournisseur) <= 150),
  numero_piece      TEXT          NOT NULL DEFAULT '' CHECK (length(numero_piece) <= 60),
  libelle           TEXT          NOT NULL CHECK (btrim(libelle) <> '' AND length(libelle) <= 300),
  fichier_nom       TEXT,
  fichier_path      TEXT,
  fichier_mime      TEXT,
  fichier_taille    BIGINT,
  fichier_sha256    TEXT,
  statut            TEXT          NOT NULL DEFAULT 'depose'
                                  CHECK (statut IN ('depose', 'valide', 'rejete', 'annule')),
  depose_par        UUID          REFERENCES users(id) ON DELETE SET NULL,
  depose_le         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  decide_par        UUID          REFERENCES users(id) ON DELETE SET NULL,
  decide_le         TIMESTAMPTZ,
  motif_rejet       TEXT          NOT NULL DEFAULT '' CHECK (length(motif_rejet) <= 2000),
  annule_par        UUID          REFERENCES users(id) ON DELETE SET NULL,
  annule_le         TIMESTAMPTZ,
  motif_annulation  TEXT          NOT NULL DEFAULT '' CHECK (length(motif_annulation) <= 2000),
  -- Personne ne valide ses propres pièces (garanti en base).
  CONSTRAINT chk_justif_pas_auto_validation CHECK (decide_par IS NULL OR depose_par IS NULL OR decide_par <> depose_par)
);
CREATE INDEX IF NOT EXISTS idx_justif_activite ON projet_justificatifs (activite_id, statut);
CREATE INDEX IF NOT EXISTS idx_justif_projet   ON projet_justificatifs (tenant_id, projet_id, statut);

CREATE OR REPLACE FUNCTION projet_justificatif_proteger() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE a RECORD; j RECORD;
BEGIN
  IF current_setting('app.journal_maintenance', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.statut <> 'depose' THEN
      RAISE EXCEPTION 'JUSTIFICATIF_INTANGIBLE: un justificatif contrôlé ne se supprime pas (annulation motivée).' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.statut <> 'depose' THEN
      RAISE EXCEPTION 'JUSTIFICATIF_INVALIDE: un justificatif est d''abord déposé.' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT tenant_est_ong(NEW.tenant_id) THEN
      RAISE EXCEPTION 'JUSTIFICATIF_INVALIDE: le suivi des projets est réservé aux ONG et associations.' USING ERRCODE = 'check_violation';
    END IF;
    SELECT id, tenant_id, projet_id INTO a FROM activites WHERE id = NEW.activite_id;
    IF a.id IS NULL OR a.tenant_id <> NEW.tenant_id OR a.projet_id IS DISTINCT FROM NEW.projet_id THEN
      RAISE EXCEPTION 'JUSTIFICATIF_INVALIDE: activité de projet introuvable pour ce client.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.remise_id IS NOT NULL THEN
      SELECT id, tenant_id, activite_id, sortie INTO j FROM journal WHERE id = NEW.remise_id;
      IF j.id IS NULL OR j.tenant_id <> NEW.tenant_id OR j.activite_id IS DISTINCT FROM NEW.activite_id OR coalesce(j.sortie, 0) <= 0 THEN
        RAISE EXCEPTION 'JUSTIFICATIF_INVALIDE: la remise de fonds indiquée n''est pas une sortie de cette activité.' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE : le contenu d'une pièce ne change plus une fois contrôlée ;
  -- seuls les passages de statut autorisés ont lieu.
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.projet_id <> OLD.projet_id OR NEW.depose_par IS DISTINCT FROM OLD.depose_par
     OR NEW.depose_le <> OLD.depose_le THEN
    RAISE EXCEPTION 'JUSTIFICATIF_INTANGIBLE: l''origine d''un justificatif ne change pas.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.statut <> 'depose' AND (
       NEW.activite_id <> OLD.activite_id OR NEW.remise_id IS DISTINCT FROM OLD.remise_id OR NEW.date_piece <> OLD.date_piece
    OR NEW.montant <> OLD.montant OR NEW.fournisseur <> OLD.fournisseur OR NEW.numero_piece <> OLD.numero_piece
    OR NEW.libelle <> OLD.libelle OR NEW.fichier_path IS DISTINCT FROM OLD.fichier_path) THEN
    RAISE EXCEPTION 'JUSTIFICATIF_INTANGIBLE: un justificatif contrôlé ne se modifie pas.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT ((OLD.statut = NEW.statut AND OLD.statut = 'depose')
       OR (OLD.statut = 'depose' AND NEW.statut IN ('valide', 'rejete'))
       OR (OLD.statut = 'valide' AND NEW.statut = 'annule')) THEN
    RAISE EXCEPTION 'JUSTIFICATIF_INTANGIBLE: passage de « % » à « % » impossible.', OLD.statut, NEW.statut USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.statut = 'rejete' AND btrim(NEW.motif_rejet) = '' THEN
    RAISE EXCEPTION 'JUSTIFICATIF_INVALIDE: le motif du rejet est obligatoire.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.statut = 'annule' AND btrim(NEW.motif_annulation) = '' THEN
    RAISE EXCEPTION 'JUSTIFICATIF_INVALIDE: le motif de l''annulation est obligatoire.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.statut IN ('valide', 'rejete') AND NEW.decide_par IS NULL THEN
    RAISE EXCEPTION 'JUSTIFICATIF_INVALIDE: la décision doit être signée.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_projet_justificatif_proteger ON projet_justificatifs;
CREATE TRIGGER trg_projet_justificatif_proteger BEFORE INSERT OR UPDATE OR DELETE ON projet_justificatifs
  FOR EACH ROW EXECUTE FUNCTION projet_justificatif_proteger();
