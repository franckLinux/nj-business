-- ============================================================================
-- 044 — Ajustement du contrôle comptable (décision du 23/10/2026)
--
-- Séparation des rôles : la caissière saisit, le comptable contrôle.
--
-- 1. Compte tiers : chaque tiers du registre peut porter son compte
--    (401… fournisseur, 411… client). L'écriture de caisse est rattachée au
--    tiers du registre (journal.tiers_id), automatiquement à la saisie :
--    tiers choisi, sinon NUI identique, sinon nom identique et unique.
--    Les champs vides (NUI, bénéficiaire) sont complétés depuis le registre.
-- 2. Correction du code comptable d'une opération par le comptable
--    (controles_pieces.compte_corrige) : l'écriture d'origine n'est jamais
--    modifiée ; la passerelle utilise le compte corrigé tant que l'opération
--    n'est pas transmise. Après transmission : annulation / contre-passation.
-- 3. Profil « Auditeur » → « Comptable » (code technique `auditeur` inchangé
--    pour ne casser ni les comptes existants ni les contraintes) avec les
--    droits du contrôle : consulter, corriger le code comptable, observer.
-- 4. rubriques.create : ajouter une rubrique sans autre droit comptable
--    (accordée à la caissière). Le compte de la rubrique reste l'affaire du
--    comptable (passerelle).
--
-- Aucune donnée supprimée. Les colonnes « pièce en main » de la 043 restent
-- en base mais ne sont plus utilisées par le contrôle (contrôle comptable,
-- pas documentaire). Idempotente.
-- ============================================================================

-- ── 1. Compte tiers ──────────────────────────────────────────────────────────
ALTER TABLE registre_tiers ADD COLUMN IF NOT EXISTS compte_tiers TEXT NOT NULL DEFAULT '';

-- Un compte tiers n'appartient qu'à un seul tiers du client.
CREATE UNIQUE INDEX IF NOT EXISTS uq_registre_tiers_compte
  ON registre_tiers (tenant_id, upper(btrim(compte_tiers))) WHERE btrim(compte_tiers) <> '';

ALTER TABLE journal ADD COLUMN IF NOT EXISTS tiers_id BIGINT REFERENCES registre_tiers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_journal_tiers ON journal (tiers_id) WHERE tiers_id IS NOT NULL;

-- Rattachement automatique de l'écriture au tiers du registre.
CREATE OR REPLACE FUNCTION journal_tiers_auto() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_nui TEXT := upper(regexp_replace(COALESCE(NEW.nui, ''), '\s+', '', 'g'));
  v_nom TEXT := lower(regexp_replace(btrim(COALESCE(NEW.beneficiaire, '')), '\s+', ' ', 'g'));
  v_id  BIGINT;
  f     RECORD;
BEGIN
  -- Bénéficiaire ou NUI corrigé sans nouveau tiers choisi : on ré-identifie.
  IF TG_OP = 'UPDATE' AND NEW.tiers_id IS NOT DISTINCT FROM OLD.tiers_id
     AND (NEW.nui IS DISTINCT FROM OLD.nui OR NEW.beneficiaire IS DISTINCT FROM OLD.beneficiaire) THEN
    NEW.tiers_id := NULL;
  END IF;

  IF NEW.tiers_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM registre_tiers WHERE id = NEW.tiers_id AND tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'Le tiers % n''appartient pas à ce client.', NEW.tiers_id
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF v_nui <> '' THEN
      SELECT id INTO v_id FROM registre_tiers
       WHERE tenant_id = NEW.tenant_id AND actif AND upper(btrim(nui)) = v_nui;
    END IF;
    IF v_id IS NULL AND v_nom <> '' THEN
      -- Par le nom seulement s'il désigne un seul tiers sans NUI contradictoire.
      SELECT min(id) INTO v_id FROM registre_tiers
       WHERE tenant_id = NEW.tenant_id AND actif
         AND lower(regexp_replace(btrim(nom), '\s+', ' ', 'g')) = v_nom
         AND (v_nui = '' OR btrim(nui) = '')
      HAVING count(*) = 1;
    END IF;
    NEW.tiers_id := v_id;
  END IF;

  IF NEW.tiers_id IS NOT NULL THEN
    SELECT nui, nom, telephone INTO f FROM registre_tiers WHERE id = NEW.tiers_id;
    IF btrim(COALESCE(NEW.nui, '')) = '' THEN NEW.nui := f.nui; END IF;
    IF btrim(COALESCE(NEW.beneficiaire, '')) = '' THEN NEW.beneficiaire := f.nom; END IF;
    IF btrim(COALESCE(NEW.telephone, '')) = '' THEN NEW.telephone := f.telephone; END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_journal_tiers_auto ON journal;
CREATE TRIGGER trg_journal_tiers_auto
  BEFORE INSERT OR UPDATE OF tiers_id, nui, beneficiaire ON journal
  FOR EACH ROW EXECUTE FUNCTION journal_tiers_auto();

-- ── 2. Correction du code comptable d'une opération ──────────────────────────
ALTER TABLE controles_pieces ADD COLUMN IF NOT EXISTS compte_corrige    TEXT NOT NULL DEFAULT '';
ALTER TABLE controles_pieces ADD COLUMN IF NOT EXISTS compte_corrige_par UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE controles_pieces ADD COLUMN IF NOT EXISTS compte_corrige_le  TIMESTAMPTZ;

INSERT INTO permissions(code, nom, module, description) VALUES
  ('controle.compte', 'Corriger le code comptable d''une opération', 'controle',
   'Remplacer, pour une opération non encore transmise, le compte de la rubrique par un autre compte du plan')
ON CONFLICT (code) DO NOTHING;

-- ── 3. Profil « Comptable » (ex-« Auditeur ») ───────────────────────────────
UPDATE roles SET nom = 'Comptable',
       description = 'Rôle système — contrôle comptable : consulte, corrige les imputations, observe'
 WHERE code = 'auditeur' AND tenant_id IS NULL AND is_system;

-- Droits du contrôle : consultation (041), saisie du contrôle et des
-- observations, correction du code comptable. Aucun droit de caisse ajouté.
INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, p.code FROM roles r
  JOIN permissions p ON p.code IN ('controle.view', 'controle.saisir', 'controle.compte', 'passerelle.view')
 WHERE r.code = 'auditeur' AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;

-- Le comptable du cabinet corrige aussi les imputations.
INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, 'controle.compte' FROM roles r
 WHERE r.code = 'comptable_cabinet' AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;

-- Clients avec plafond : ouvert là où le contrôle comptable l'est.
INSERT INTO tenant_permissions(tenant_id, permission_code)
SELECT DISTINCT tp.tenant_id, 'controle.compte' FROM tenant_permissions tp
 WHERE tp.permission_code = 'controle.view'
ON CONFLICT DO NOTHING;

-- ── 4. Ajout de rubriques par la caissière ───────────────────────────────────
INSERT INTO permissions(code, nom, module, description) VALUES
  ('rubriques.create', 'Ajouter des rubriques', 'rubriques',
   'Créer une rubrique pour la saisie (sans code comptable ni virement interne : réservés au comptable)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, 'rubriques.create' FROM roles r
 WHERE r.code = 'caissier' AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;

INSERT INTO tenant_permissions(tenant_id, permission_code)
SELECT DISTINCT tp.tenant_id, 'rubriques.create' FROM tenant_permissions tp
 WHERE tp.permission_code = 'rubriques.view'
ON CONFLICT DO NOTHING;
