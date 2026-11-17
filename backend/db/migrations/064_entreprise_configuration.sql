-- ============================================================================
-- 064 — NJ BUSINESS : configuration centrale de l'entreprise (lot A, 17/11/2026)
--
--  L'identité de l'entreprise devient une donnée du SOCLE, indépendante des
--  modules : elle se lit et se modifie sans NJ CAISSE PRO ni NJ COMMERCIAL.
--
--  1. tenants : champs d'identité manquants (nom commercial, slogan, date de
--     création, région, références d'immatriculation). La table reste la seule
--     source de l'identité : aucun doublon par module.
--     Le nom commercial saisi dans NJ COMMERCIAL (com_parametres) y est recopié.
--  2. entreprise_references : autres références légales, libres.
--  3. entreprise_representants : représentant légal avec historique. Changer de
--     représentant clôt la ligne en cours sans toucher à l'identité. Reprise de
--     tenants.dirigeant_nom pour les clients existants.
--  4. Permissions du socle : entreprise.view / entreprise.edit, attribuées aux
--     rôles, profils, exceptions et plafonds qui ont aujourd'hui config.view /
--     config.edit (ou com.parametrage.voir pour la lecture). Personne ne gagne
--     un droit de modification qu'il n'avait pas.
--  5. Documents commerciaux : identite_emetteur (JSONB), figée à l'émission ou
--     à la validation, pour qu'un document ancien garde l'identité d'origine.
--
--  Additive et idempotente. Aucune donnée de caisse n'est touchée.
--  Retour arrière : migrations-retour-arriere/064_retour_arriere.sql
-- ============================================================================

-- ── 1. Identité ─────────────────────────────────────────────────────────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS nom_commercial     TEXT NOT NULL DEFAULT '';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS slogan             TEXT NOT NULL DEFAULT '';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS date_creation      DATE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS region             TEXT NOT NULL DEFAULT '';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS immatriculation    TEXT NOT NULL DEFAULT '';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS numero_statistique TEXT NOT NULL DEFAULT '';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS agrement           TEXT NOT NULL DEFAULT '';

DO $$
BEGIN
  IF to_regclass('public.com_parametres') IS NOT NULL THEN
    UPDATE tenants t SET nom_commercial = p.nom_commercial
      FROM com_parametres p
     WHERE p.tenant_id = t.id AND t.nom_commercial = '' AND COALESCE(p.nom_commercial, '') <> '';
  END IF;
END $$;

-- ── 2. Références légales libres ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entreprise_references (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  libelle     TEXT NOT NULL CHECK (length(btrim(libelle)) BETWEEN 1 AND 80),
  valeur      TEXT NOT NULL CHECK (length(btrim(valeur)) BETWEEN 1 AND 120),
  ordre       INTEGER NOT NULL DEFAULT 0,
  modifie_par UUID REFERENCES users(id) ON DELETE SET NULL,
  modifie_le  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_entreprise_references_tenant ON entreprise_references (tenant_id, ordre);

-- ── 3. Représentant légal (historique) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS entreprise_representants (
  id             BIGSERIAL PRIMARY KEY,
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nom            TEXT NOT NULL CHECK (length(btrim(nom)) BETWEEN 1 AND 120),
  prenoms        TEXT NOT NULL DEFAULT '' CHECK (length(prenoms) <= 150),
  fonction       TEXT NOT NULL DEFAULT '' CHECK (length(fonction) <= 120),
  telephone      TEXT NOT NULL DEFAULT '' CHECK (length(telephone) <= 60),
  email          TEXT NOT NULL DEFAULT '' CHECK (length(email) <= 150),
  adresse        TEXT NOT NULL DEFAULT '' CHECK (length(adresse) <= 300),
  -- Image de la signature (data URL PNG / JPEG / WebP), facultative.
  signature_url  TEXT CHECK (signature_url IS NULL OR length(signature_url) <= 220000),
  debut          DATE NOT NULL DEFAULT CURRENT_DATE,
  fin            DATE,
  origine        TEXT NOT NULL DEFAULT 'saisie' CHECK (origine IN ('saisie', 'migration')),
  cree_par       UUID REFERENCES users(id) ON DELETE SET NULL,
  cree_le        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  modifie_par    UUID REFERENCES users(id) ON DELETE SET NULL,
  modifie_le     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (fin IS NULL OR fin >= debut)
);
-- Un seul représentant en fonction par entreprise.
CREATE UNIQUE INDEX IF NOT EXISTS uq_entreprise_representant_en_cours
  ON entreprise_representants (tenant_id) WHERE fin IS NULL;

INSERT INTO entreprise_representants (tenant_id, nom, fonction, debut, origine)
SELECT t.id, btrim(t.dirigeant_nom), 'Dirigeant', COALESCE(t.created_at::date, CURRENT_DATE), 'migration'
  FROM tenants t
 WHERE COALESCE(btrim(t.dirigeant_nom), '') <> ''
   AND NOT EXISTS (SELECT 1 FROM entreprise_representants r WHERE r.tenant_id = t.id);

-- ── 4. Permissions du socle ─────────────────────────────────────────────────
INSERT INTO permissions (code, nom, module, description) VALUES
  ('entreprise.view', 'Voir la configuration de l''entreprise', 'entreprise',
   'Identité, références légales, représentant légal et logo, indépendamment des modules'),
  ('entreprise.edit', 'Modifier la configuration de l''entreprise', 'entreprise',
   'Modifier l''identité, les références légales, le logo et le représentant légal')
ON CONFLICT (code) DO NOTHING;

-- Trace de ce que la migration a attribué (pour le retour arrière).
CREATE TABLE IF NOT EXISTS entreprise_droits_064 (
  cible           TEXT NOT NULL CHECK (cible IN ('role', 'utilisateur', 'client')),
  cle             TEXT NOT NULL,
  permission_code VARCHAR(100) NOT NULL,
  PRIMARY KEY (cible, cle, permission_code)
);

DO $$
BEGIN
  -- Rôles système et profils des clients.
  WITH a AS (
    INSERT INTO role_permissions (role_id, permission_code)
    SELECT DISTINCT rp.role_id, x.cible
      FROM role_permissions rp
      JOIN (VALUES ('config.view', 'entreprise.view'), ('com.parametrage.voir', 'entreprise.view'),
                   ('config.edit', 'entreprise.edit')) AS x(source, cible) ON x.source = rp.permission_code
    ON CONFLICT DO NOTHING
    RETURNING role_id, permission_code
  )
  INSERT INTO entreprise_droits_064 (cible, cle, permission_code)
  SELECT 'role', role_id::text, permission_code FROM a ON CONFLICT DO NOTHING;

  -- Exceptions individuelles : même effet (grant / deny) que l'exception d'origine.
  WITH a AS (
    INSERT INTO user_permissions (user_id, permission_code, effet)
    SELECT DISTINCT ON (up.user_id, x.cible) up.user_id, x.cible, up.effet
      FROM user_permissions up
      JOIN (VALUES ('config.view', 'entreprise.view'), ('config.edit', 'entreprise.edit')) AS x(source, cible)
        ON x.source = up.permission_code
     ORDER BY up.user_id, x.cible, (up.effet = 'deny') DESC
    ON CONFLICT DO NOTHING
    RETURNING user_id, permission_code
  )
  INSERT INTO entreprise_droits_064 (cible, cle, permission_code)
  SELECT 'utilisateur', user_id::text, permission_code FROM a ON CONFLICT DO NOTHING;

  -- Plafond des clients : la fonction suit config.* ou com.parametrage.voir.
  WITH a AS (
    INSERT INTO tenant_permissions (tenant_id, permission_code)
    SELECT DISTINCT tp.tenant_id, x.cible
      FROM tenant_permissions tp
      JOIN (VALUES ('config.view', 'entreprise.view'), ('com.parametrage.voir', 'entreprise.view'),
                   ('config.edit', 'entreprise.edit')) AS x(source, cible) ON x.source = tp.permission_code
    ON CONFLICT DO NOTHING
    RETURNING tenant_id, permission_code
  )
  INSERT INTO entreprise_droits_064 (cible, cle, permission_code)
  SELECT 'client', tenant_id::text, permission_code FROM a ON CONFLICT DO NOTHING;
END $$;

-- ── 5. Identité figée sur les documents commerciaux ─────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['com_bons_commande', 'com_devis', 'com_livraisons', 'com_consultations'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS identite_emetteur JSONB', t);
    END IF;
  END LOOP;
END $$;

-- ── Contrôle (bloquant) ─────────────────────────────────────────────────────
-- Tout rôle qui modifie la configuration doit aussi pouvoir modifier l'entreprise.
DO $$
DECLARE manquants INTEGER;
BEGIN
  SELECT COUNT(*) INTO manquants
    FROM role_permissions rp
   WHERE rp.permission_code = 'config.edit'
     AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.permission_code = 'entreprise.edit');
  IF manquants > 0 THEN
    RAISE EXCEPTION '064 : % rôle(s) avec config.edit sans entreprise.edit', manquants;
  END IF;
END $$;
