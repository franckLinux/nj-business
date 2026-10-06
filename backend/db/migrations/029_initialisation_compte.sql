-- ── 029 — Initialisation guidée d'un compte de démonstration ──────────────
-- Après activation, le prospect (directeur de l'espace) doit définir ses
-- caisses (nombre et nom par type) et leurs soldes d'ouverture (RAN) avant
-- d'utiliser l'application. tenants.initialise_le NULL = initialisation à faire.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS initialise_le TIMESTAMPTZ;

-- Comptes existants : considérés comme initialisés, SAUF les espaces de
-- démonstration encore vierges (aucune écriture, aucun RAN saisi).
UPDATE tenants t SET initialise_le = COALESCE(t.created_at, NOW())
 WHERE t.initialise_le IS NULL
   AND (COALESCE(t.type_compte, 'client') <> 'demo'
        OR EXISTS (SELECT 1 FROM journal j WHERE j.tenant_id = t.id)
        OR EXISTS (SELECT 1 FROM ran r WHERE r.tenant_id = t.id AND r.montant <> 0));
