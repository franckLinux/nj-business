-- ── 034 — Classement des opérations par activité / projet (octobre 2026) ──
--  Le client définit ses secteurs d'activité et ses projets (Configuration →
--  Activités / projets). À la saisie, une opération peut y être rattachée
--  (champ FACULTATIF) ; l'écran « Suivi par activité » totalise ensuite les
--  dépenses et recettes par activité, avec l'enveloppe prévue le cas échéant.
-- Idempotente.

CREATE TABLE IF NOT EXISTS activites (
  id          SERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code        VARCHAR(20)  NOT NULL DEFAULT '',
  nom         VARCHAR(120) NOT NULL,
  type        VARCHAR(10)  NOT NULL DEFAULT 'activite' CHECK (type IN ('activite', 'projet')),
  description TEXT         NOT NULL DEFAULT '',
  budget      NUMERIC(15,2),             -- enveloppe prévue (facultative)
  date_debut  DATE,
  date_fin    DATE,
  actif       BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_activites_nom ON activites (tenant_id, lower(nom));
CREATE INDEX IF NOT EXISTS idx_activites_tenant ON activites (tenant_id, actif);

ALTER TABLE journal            ADD COLUMN IF NOT EXISTS activite_id INTEGER REFERENCES activites(id) ON DELETE SET NULL;
ALTER TABLE mouvements_attente ADD COLUMN IF NOT EXISTS activite_id INTEGER REFERENCES activites(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_journal_activite ON journal (tenant_id, activite_id) WHERE activite_id IS NOT NULL;

-- Permissions -------------------------------------------------------------------
INSERT INTO permissions(code, nom, module, description) VALUES
  ('activites.view', 'Voir les activités / projets', 'activites',
   'Consulter la liste des activités et projets, et classer une opération à la saisie'),
  ('activites.edit', 'Gérer les activités / projets', 'activites',
   'Créer, modifier, désactiver les activités et projets')
ON CONFLICT (code) DO NOTHING;

-- Rôles système : direction et cabinet gèrent ; caissier et auditeur consultent.
INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, v.code FROM roles r
 CROSS JOIN (VALUES ('activites.view'), ('activites.edit')) AS v(code)
 WHERE r.code IN ('directeur', 'comptable_cabinet') AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, 'activites.view' FROM roles r
 WHERE r.code IN ('caissier', 'auditeur') AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;

-- Profils métier : qui saisit ou consulte le journal voit les activités ;
-- qui valide les dépenses les gère.
INSERT INTO role_permissions(role_id, permission_code)
SELECT DISTINCT rp.role_id, 'activites.view' FROM role_permissions rp
 WHERE rp.permission_code IN ('journal.create', 'journal.view')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code)
SELECT DISTINCT rp.role_id, 'activites.edit' FROM role_permissions rp
 WHERE rp.permission_code = 'journal.validate'
ON CONFLICT DO NOTHING;

-- Clients avec plafond : ouverts là où le journal l'est.
INSERT INTO tenant_permissions(tenant_id, permission_code)
SELECT DISTINCT tp.tenant_id, v.code FROM tenant_permissions tp
 CROSS JOIN (VALUES ('activites.view'), ('activites.edit')) AS v(code)
 WHERE tp.permission_code IN ('journal.create', 'journal.view')
ON CONFLICT DO NOTHING;
