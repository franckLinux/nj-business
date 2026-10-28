-- ============================================================================
-- 045 — Contrôle de régularité formelle (décision du 23/10/2026)
--
-- Sous-onglet du Rapport : pièces séparées par journal, colonne « Contrôle »
-- (anomalies constatées saisies à la main par le comptable) et bouton
-- « Confirmer la validation ».
--
-- 1. controles_anomalies : anomalies constatées sur une pièce, saisies à la
--    main. Une anomalie peut être marquée « bloquante » (elle empêche la
--    validation tant qu'elle n'est pas levée). Elle n'est jamais supprimée :
--    on la LÈVE (motif), ce qui garde la trace.
-- 2. controles_pieces : réouverture tracée d'une pièce validée.
-- 3. Permission controle.reouvrir (comptable et comptable du cabinet).
--
-- Statuts (inchangés en base) : a_controler « À contrôler », en_cours
-- « En cours », anomalie « Anomalies constatées », controle « Validée ».
-- La validation ne touche ni le journal, ni l'arrêté de caisse, ni les
-- exports / la passerelle. Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS controles_anomalies (
  id           BIGSERIAL   PRIMARY KEY,
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mouvement_id BIGINT      NOT NULL REFERENCES journal(id) ON DELETE CASCADE,
  libelle      TEXT        NOT NULL CHECK (btrim(libelle) <> '' AND length(libelle) <= 500),
  bloquante    BOOLEAN     NOT NULL DEFAULT false,
  statut       TEXT        NOT NULL DEFAULT 'ouverte' CHECK (statut IN ('ouverte', 'levee')),
  cree_par     UUID        REFERENCES users(id) ON DELETE SET NULL,
  cree_le      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  modifie_par  UUID        REFERENCES users(id) ON DELETE SET NULL,
  modifie_le   TIMESTAMPTZ,
  levee_par    UUID        REFERENCES users(id) ON DELETE SET NULL,
  levee_le     TIMESTAMPTZ,
  motif_levee  TEXT        NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_controles_anomalies_piece ON controles_anomalies (mouvement_id);
CREATE INDEX IF NOT EXISTS idx_controles_anomalies_tenant ON controles_anomalies (tenant_id, statut);

-- La pièce appartient au même client que l'anomalie.
CREATE OR REPLACE FUNCTION controle_anomalie_meme_client() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM journal WHERE id = NEW.mouvement_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'La pièce % n''appartient pas à ce client.', NEW.mouvement_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_controle_anomalie_meme_client ON controles_anomalies;
CREATE TRIGGER trg_controle_anomalie_meme_client
  BEFORE INSERT OR UPDATE OF mouvement_id, tenant_id ON controles_anomalies
  FOR EACH ROW EXECUTE FUNCTION controle_anomalie_meme_client();

-- Dernière réouverture d'une pièce validée (l'historique complet est dans audit_log).
ALTER TABLE controles_pieces ADD COLUMN IF NOT EXISTS rouvert_par     UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE controles_pieces ADD COLUMN IF NOT EXISTS rouvert_le      TIMESTAMPTZ;
ALTER TABLE controles_pieces ADD COLUMN IF NOT EXISTS motif_reouverture TEXT NOT NULL DEFAULT '';

INSERT INTO permissions(code, nom, module, description) VALUES
  ('controle.reouvrir', 'Rouvrir une pièce validée', 'controle',
   'Annuler la validation du contrôle de régularité formelle d''une pièce (motif obligatoire, tracé)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, 'controle.reouvrir' FROM roles r
 WHERE r.code IN ('comptable_cabinet', 'auditeur') AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;

INSERT INTO tenant_permissions(tenant_id, permission_code)
SELECT DISTINCT tp.tenant_id, 'controle.reouvrir' FROM tenant_permissions tp
 WHERE tp.permission_code = 'controle.view'
ON CONFLICT DO NOTHING;
