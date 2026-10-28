-- ============================================================================
-- 042 — Contrôle comptable des pièces (décision du 21/10/2026)
--
-- Menu « Contrôle comptable » → « Contrôle » (avant la passerelle) : le
-- comptable / contrôleur examine les pièces des journaux de caisse, complète
-- ou corrige le tiers (NUI, nom), ajoute une observation et classe la pièce.
--
-- Principe : le contrôle est une COUCHE à part. L'écriture d'origine (table
-- journal : montants, bénéficiaire, NUI saisis par la caissière) n'est JAMAIS
-- modifiée, et la passerelle n'est pas touchée. Une ligne de controles_pieces
-- par pièce contrôlée ; sans ligne, la pièce est « à contrôler ».
-- Les anomalies (NUI, nom, compte…) sont recalculées à chaque lecture ;
-- `anomalies` garde celles constatées au dernier enregistrement (traçabilité).
-- Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS controles_pieces (
  id            BIGSERIAL   PRIMARY KEY,
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mouvement_id  BIGINT      NOT NULL REFERENCES journal(id) ON DELETE CASCADE,
  tiers_nui     TEXT        NOT NULL DEFAULT '',
  tiers_nom     TEXT        NOT NULL DEFAULT '',
  observation   TEXT        NOT NULL DEFAULT '',
  statut        TEXT        NOT NULL DEFAULT 'en_cours'
                            CHECK (statut IN ('a_controler', 'en_cours', 'controle', 'anomalie')),
  anomalies     TEXT[]      NOT NULL DEFAULT '{}',
  modifie_par   UUID        REFERENCES users(id) ON DELETE SET NULL,
  modifie_le    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  controle_par  UUID        REFERENCES users(id) ON DELETE SET NULL,   -- auteur du statut final
  controle_le   TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_controle_mouvement ON controles_pieces (mouvement_id);
CREATE INDEX IF NOT EXISTS idx_controle_tenant_statut ON controles_pieces (tenant_id, statut);

-- La pièce contrôlée doit appartenir au même client que le contrôle.
CREATE OR REPLACE FUNCTION controle_meme_client() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM journal WHERE id = NEW.mouvement_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'La pièce % n''appartient pas à ce client.', NEW.mouvement_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_controle_meme_client ON controles_pieces;
CREATE TRIGGER trg_controle_meme_client
  BEFORE INSERT OR UPDATE OF tenant_id, mouvement_id ON controles_pieces
  FOR EACH ROW EXECUTE FUNCTION controle_meme_client();

-- ── Permission de saisie ─────────────────────────────────────────────────────
-- controle.view (041) : voir le menu et les pièces ; controle.saisir : saisir
-- tiers / observation / statut. Comptable du cabinet et directeur par défaut ;
-- l'auditeur reste en consultation (accordable depuis Permissions / Rôles).
INSERT INTO permissions(code, nom, module, description) VALUES
  ('controle.saisir', 'Saisir le contrôle des pièces', 'controle',
   'Compléter le tiers (NUI, nom), ajouter une observation et classer les pièces contrôlées')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, 'controle.saisir' FROM roles r
 WHERE r.code IN ('comptable_cabinet', 'directeur') AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;

-- Clients avec plafond : ouvert là où le menu Contrôle comptable l'est.
INSERT INTO tenant_permissions(tenant_id, permission_code)
SELECT DISTINCT tp.tenant_id, 'controle.saisir' FROM tenant_permissions tp
 WHERE tp.permission_code = 'controle.view'
ON CONFLICT DO NOTHING;
