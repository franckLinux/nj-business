-- ============================================================================
-- 067 — NJ BUSINESS : sessions côté serveur (lot D, 18/11/2026)
--
--  Une session par connexion, contrôlée par le serveur à chaque requête :
--  le jeton porte l'identifiant de session (sid) ; une session fermée,
--  remplacée, révoquée ou expirée rend son jeton inutilisable immédiatement.
--
--  Règle : UNE session active par compte (index unique partiel). Une deuxième
--  connexion est refusée, sauf remplacement explicite après vérification du
--  mot de passe. Changer de module ne crée pas de session.
--
--  plateforme_reglages 'sessions' : inactivité et durée maximale (minutes).
--  Additive et idempotente. Retour arrière : migrations-retour-arriere/067_retour_arriere.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS sessions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id         UUID        REFERENCES tenants(id) ON DELETE CASCADE,
  statut            TEXT        NOT NULL DEFAULT 'active'
                    CHECK (statut IN ('active', 'fermee', 'expiree', 'remplacee', 'revoquee')),
  cree_le           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  derniere_activite TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expire_le         TIMESTAMPTZ NOT NULL,
  ip                TEXT        CHECK (ip IS NULL OR length(ip) <= 100),
  appareil          TEXT        CHECK (appareil IS NULL OR length(appareil) <= 120),
  navigateur        TEXT        CHECK (navigateur IS NULL OR length(navigateur) <= 400),
  terminee_le       TIMESTAMPTZ,
  terminee_par      UUID        REFERENCES users(id) ON DELETE SET NULL,
  motif_fin         TEXT        CHECK (motif_fin IS NULL OR length(motif_fin) <= 300),
  CHECK ((statut = 'active') = (terminee_le IS NULL))
);
-- Une seule session active par compte : garantie par la base, même si deux
-- connexions arrivent au même instant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sessions_une_active ON sessions (user_id) WHERE statut = 'active';
CREATE INDEX IF NOT EXISTS ix_sessions_tenant_actives ON sessions (tenant_id) WHERE statut = 'active';
CREATE INDEX IF NOT EXISTS ix_sessions_user_date ON sessions (user_id, cree_le DESC);

INSERT INTO plateforme_reglages (cle, valeur)
VALUES ('sessions', '{"inactivite_min": 60, "duree_max_min": 720}')
ON CONFLICT (cle) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM plateforme_reglages WHERE cle = 'sessions') THEN
    RAISE EXCEPTION '067 : réglage des sessions absent';
  END IF;
END $$;
