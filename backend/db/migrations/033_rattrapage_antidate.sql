-- ── 033 — Saisie de rattrapage (écritures antidatées) — octobre 2026 ──────
--  Par défaut, les écritures d'une caisse se saisissent dans l'ordre
--  chronologique. Le directeur peut autoriser une ou plusieurs caissières à
--  saisir « en rattrapage » : une opération datée AVANT la dernière écriture
--  du journal est alors acceptée, et marquée comme telle (journal.rattrapage).
--  Restent toujours interdits : un mois arrêté et une date antérieure à
--  l'ouverture de la caisse.
-- Idempotente.

-- 1. Marquage des écritures antidatées --------------------------------------
ALTER TABLE journal ADD COLUMN IF NOT EXISTS rattrapage BOOLEAN NOT NULL DEFAULT false;

-- 2. Permissions ---------------------------------------------------------------
INSERT INTO permissions(code, nom, module, description) VALUES
  ('journal.rattrapage', 'Saisir en rattrapage (antidater)', 'journal',
   'Enregistrer une opération datée avant la dernière écriture de la caisse (hors mois arrêté)'),
  ('journal.rattrapage_autoriser', 'Autoriser le rattrapage', 'journal',
   'Accorder ou retirer à une caissière le droit de saisir en rattrapage')
ON CONFLICT (code) DO NOTHING;

-- Directeur (rôle système) : peut saisir en rattrapage et l'autoriser.
INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, v.code FROM roles r
 CROSS JOIN (VALUES ('journal.rattrapage'), ('journal.rattrapage_autoriser')) AS v(code)
 WHERE r.code = 'directeur' AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;

-- Profils métier de direction (ceux qui valident les dépenses) : idem.
INSERT INTO role_permissions(role_id, permission_code)
SELECT DISTINCT rp.role_id, v.code FROM role_permissions rp
 CROSS JOIN (VALUES ('journal.rattrapage'), ('journal.rattrapage_autoriser')) AS v(code)
 WHERE rp.permission_code = 'journal.validate'
ON CONFLICT DO NOTHING;

-- Clients avec plafond : les nouveaux codes sont ouverts là où la saisie l'est
-- (sinon l'autorisation accordée par le directeur serait sans effet).
INSERT INTO tenant_permissions(tenant_id, permission_code)
SELECT DISTINCT tp.tenant_id, v.code FROM tenant_permissions tp
 CROSS JOIN (VALUES ('journal.rattrapage'), ('journal.rattrapage_autoriser')) AS v(code)
 WHERE tp.permission_code = 'journal.create'
ON CONFLICT DO NOTHING;
