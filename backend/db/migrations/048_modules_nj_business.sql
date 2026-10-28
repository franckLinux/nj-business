-- ============================================================================
-- 048 — NJ BUSINESS : catalogue des modules et activation par client
--
--  Trois notions distinctes (proposition du 26/10/2026) :
--    1. module DISPONIBLE dans la plateforme  → modules.statut = 'operationnel'
--    2. module ACTIVÉ pour un client          → tenant_modules.actif
--    3. DROITS de l'utilisateur dans le module → permissions existantes (inchangées)
--
--  Migration PUREMENT ADDITIVE : aucune table, colonne, contrainte ou donnée
--  existante n'est modifiée, vidée ou supprimée.
--    • NJ CAISSE PRO est créé « opérationnel » et activé pour TOUS les clients
--      existants (sinon ils perdraient l'accès à la caisse au déploiement) ;
--    • un déclencheur active les modules « par défaut » à chaque création de
--      client, quel que soit le chemin (création manuelle, démo, conversion) ;
--    • désactiver = actif = false : aucune donnée du module n'est supprimée.
--
--  Retour arrière : 048_retour_arriere.sql (ne touche à aucune autre table).
--  Idempotente : rejouable sans effet.
-- ============================================================================

CREATE TABLE IF NOT EXISTS modules (
    code           TEXT PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{1,39}$'),
    nom            TEXT NOT NULL,
    description    TEXT NOT NULL DEFAULT '',
    icone          TEXT NOT NULL DEFAULT '',
    statut         TEXT NOT NULL DEFAULT 'en_preparation'
                   CHECK (statut IN ('operationnel', 'en_preparation', 'retire')),
    route_accueil  TEXT NOT NULL DEFAULT '/',
    -- Préfixes des routes API (sans /api) qui appartiennent au module. Une route
    -- qui n'en relève d'aucun appartient au socle NJ BUSINESS (connexion,
    -- configuration, utilisateurs, notifications…) et n'est jamais bloquée.
    prefixes_api   TEXT[] NOT NULL DEFAULT '{}',
    par_defaut     BOOLEAN NOT NULL DEFAULT false,
    ordre          INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_modules (
    tenant_id    UUID NOT NULL REFERENCES tenants(id),
    module_code  TEXT NOT NULL REFERENCES modules(code),
    actif        BOOLEAN NOT NULL DEFAULT true,
    modifie_par  UUID REFERENCES users(id),
    modifie_le   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    motif        TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (tenant_id, module_code)
);
CREATE INDEX IF NOT EXISTS idx_tenant_modules_actifs ON tenant_modules (tenant_id) WHERE actif;

-- ── Catalogue initial ───────────────────────────────────────────────────────
-- NJ CAISSE PRO : seul module opérationnel. Les autres sont préparés dans le
-- catalogue mais ne peuvent pas être activés tant qu'ils sont en préparation.
INSERT INTO modules (code, nom, description, icone, statut, route_accueil, prefixes_api, par_defaut, ordre) VALUES
  ('caisse', 'NJ CAISSE PRO',
   'Trésorerie, budget, demandes de fonds et contrôle comptable',
   'caisse', 'operationnel', '/',
   ARRAY['/journal', '/journaux', '/mouvements-attente', '/budget', '/budget-caisse', '/appel-fonds',
         '/banque', '/rapport', '/dashboard', '/rubriques', '/activites', '/pieces', '/initialisation',
         '/controle', '/passerelle', '/registre-tiers', '/plan-comptable'],
   true, 10),
  ('commercial',   'NJ COMMERCIAL',   'Ventes, achats, facturation et point de vente', 'commercial',   'en_preparation', '/', '{}', false, 20),
  ('stock',        'NJ STOCK',        'Articles, dépôts, mouvements et inventaires',   'stock',        'en_preparation', '/', '{}', false, 30),
  ('comptabilite', 'NJ COMPTABILITÉ', 'Écritures, balance, états financiers SYSCOHADA', 'comptabilite', 'en_preparation', '/', '{}', false, 40),
  ('rh',           'NJ RH',           'Dossiers salariés et paie',                      'rh',           'en_preparation', '/', '{}', false, 50)
ON CONFLICT (code) DO NOTHING;

-- ── NJ CAISSE PRO activé pour tous les clients existants ────────────────────
INSERT INTO tenant_modules (tenant_id, module_code, actif, motif)
SELECT t.id, 'caisse', true, 'Activation initiale (migration 048)'
  FROM tenants t
ON CONFLICT (tenant_id, module_code) DO NOTHING;

-- ── Modules par défaut à la création d'un client ────────────────────────────
CREATE OR REPLACE FUNCTION tenant_modules_par_defaut() RETURNS trigger AS $$
BEGIN
  INSERT INTO tenant_modules (tenant_id, module_code, actif, motif)
  SELECT NEW.id, m.code, true, 'Module par défaut à la création du client'
    FROM modules m
   WHERE m.par_defaut AND m.statut = 'operationnel'
  ON CONFLICT (tenant_id, module_code) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenant_modules_par_defaut ON tenants;
CREATE TRIGGER trg_tenant_modules_par_defaut
  AFTER INSERT ON tenants
  FOR EACH ROW EXECUTE FUNCTION tenant_modules_par_defaut();

-- ── Contrôle d'intégrité (bloquant) ─────────────────────────────────────────
-- Chaque client existant doit avoir NJ CAISSE PRO activé à la fin de la
-- migration ; sinon la transaction échoue et rien n'est appliqué.
DO $$
DECLARE manquants INTEGER;
BEGIN
  SELECT COUNT(*) INTO manquants
    FROM tenants t
   WHERE NOT EXISTS (SELECT 1 FROM tenant_modules tm
                      WHERE tm.tenant_id = t.id AND tm.module_code = 'caisse');
  IF manquants > 0 THEN
    RAISE EXCEPTION '048 : % client(s) sans NJ CAISSE PRO après migration', manquants;
  END IF;
END $$;
