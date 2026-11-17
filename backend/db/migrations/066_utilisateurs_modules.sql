-- ============================================================================
-- 066 — NJ BUSINESS : utilisateurs par module (lot C, 17/11/2026)
--
--  1. user_modules : la personne X travaille dans le module M (NJ CAISSE PRO,
--     NJ COMMERCIAL…), avec, au besoin, un profil propre à ce module (role_id).
--     Retirer quelqu'un d'un module = actif false (jamais de suppression : son
--     historique et ses écritures restent intacts).
--  2. plateforme_reglages : réglages de la plateforme. Ici, le contrôle d'accès
--     par module, en mode « observer » au départ (on mesure, on ne bloque rien)
--     puis « appliquer » quand le super_admin a vérifié la répartition.
--  3. La REPRISE des comptes existants n'est pas faite en SQL : elle est faite
--     une fois, au démarrage du serveur, par le service utilisateurs_modules, à
--     partir des droits EFFECTIFS de chacun (rôle, profil, types de gestion,
--     exceptions, plafond). Aucun droit n'est ajouté ni retiré.
--
--  Additive et idempotente. Aucune donnée de caisse n'est touchée.
--  Retour arrière : migrations-retour-arriere/066_retour_arriere.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_modules (
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_code  TEXT        NOT NULL REFERENCES modules(code),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actif        BOOLEAN     NOT NULL DEFAULT TRUE,
  -- Profil propre au module (facultatif). NULL : le rôle du compte et son
  -- profil métier s'appliquent, comme avant la 066.
  role_id      INTEGER     REFERENCES roles(id) ON DELETE SET NULL,
  origine      TEXT        NOT NULL DEFAULT 'manuel' CHECK (origine IN ('migration', 'manuel', 'creation')),
  affecte_par  UUID        REFERENCES users(id) ON DELETE SET NULL,
  affecte_le   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  modifie_par  UUID        REFERENCES users(id) ON DELETE SET NULL,
  modifie_le   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  motif        TEXT        CHECK (motif IS NULL OR length(motif) <= 500),
  PRIMARY KEY (user_id, module_code)
);
CREATE INDEX IF NOT EXISTS ix_user_modules_tenant ON user_modules (tenant_id, module_code) WHERE actif;

-- Cohérence : la personne et le profil appartiennent au client de la ligne.
CREATE OR REPLACE FUNCTION user_modules_coherence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'user_modules : la personne n''appartient pas à ce client';
  END IF;
  IF NEW.role_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM roles WHERE id = NEW.role_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'user_modules : profil introuvable pour ce client';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_user_modules_coherence ON user_modules;
CREATE TRIGGER trg_user_modules_coherence BEFORE INSERT OR UPDATE ON user_modules
  FOR EACH ROW EXECUTE FUNCTION user_modules_coherence();

CREATE TABLE IF NOT EXISTS plateforme_reglages (
  cle         TEXT PRIMARY KEY,
  valeur      JSONB       NOT NULL,
  modifie_par UUID        REFERENCES users(id) ON DELETE SET NULL,
  modifie_le  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO plateforme_reglages (cle, valeur)
VALUES ('acces_modules_utilisateurs', '"observer"')
ON CONFLICT (cle) DO NOTHING;

-- Contrôle (bloquant).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM plateforme_reglages WHERE cle = 'acces_modules_utilisateurs'
                    AND valeur IN ('"observer"'::jsonb, '"appliquer"'::jsonb)) THEN
    RAISE EXCEPTION '066 : réglage du contrôle d''accès absent ou invalide';
  END IF;
END $$;
