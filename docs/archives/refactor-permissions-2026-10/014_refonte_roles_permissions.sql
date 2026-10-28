-- ── 014 — Refonte rôles & permissions ──────────────────────────────────────
-- Objectif : une seule source de vérité EN BASE pour les droits.
--
--  1. Les rôles fixes (directeur, caissier, auditeur, comptable_cabinet)
--     deviennent des « rôles système » dans la table roles (tenant_id NULL,
--     is_system = true). Leur jeu de permissions, jusqu'ici codé en dur dans
--     permission.service.js (ROLE_DEFAULTS), est recopié dans role_permissions.
--  2. role_permissions reçoit enfin sa clé étrangère vers permissions(code) :
--     plus de codes orphelins après suppression d'une permission.
--  3. user_permissions devient un jeu d'EXCEPTIONS (effet = grant | deny)
--     appliquées PAR-DESSUS le rôle, au lieu d'un instantané complet qui
--     remplaçait le rôle et figeait la personne (nouvelles permissions jamais
--     reçues, changement de rôle sans effet).
--     Conversion exacte : droits effectifs identiques avant/après.
--
-- Idempotente : chaque étape est protégée (IF NOT EXISTS / ON CONFLICT / garde
-- sur l'existence de la colonne effet).

-- ── 1. Rôles système ───────────────────────────────────────────────────────
ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;

-- Un rôle global (tenant_id NULL) créé à la main portant un code système
-- entrerait en collision : on le renomme plutôt que de l'écraser.
UPDATE roles SET code = code || '_perso_' || id
 WHERE tenant_id IS NULL AND is_system = false
   AND code IN ('directeur','caissier','auditeur','comptable_cabinet');

-- Doublons de rôles globaux (UNIQUE(code, tenant_id) ne joue pas avec NULL).
UPDATE roles r SET code = r.code || '_' || r.id
 WHERE r.tenant_id IS NULL
   AND EXISTS (SELECT 1 FROM roles o WHERE o.tenant_id IS NULL AND o.code = r.code AND o.id < r.id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_code_global ON roles(code) WHERE tenant_id IS NULL;

INSERT INTO roles(nom, code, description, couleur, tenant_id, is_system) VALUES
  ('Directeur',         'directeur',         'Rôle système — encadrement du client',          '#1d4ed8', NULL, true),
  ('Comptable cabinet', 'comptable_cabinet', 'Rôle système — comptable du cabinet',            '#15803d', NULL, true),
  ('Caissier(ère)',     'caissier',          'Rôle système — saisie quotidienne de caisse',    '#be185d', NULL, true),
  ('Auditeur',          'auditeur',          'Rôle système — lecture seule',                    '#b45309', NULL, true)
ON CONFLICT (code) WHERE tenant_id IS NULL DO UPDATE SET is_system = true;

-- ── 2. Intégrité de role_permissions ───────────────────────────────────────
DELETE FROM role_permissions rp
 WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.code = rp.permission_code);

ALTER TABLE role_permissions ALTER COLUMN permission_code TYPE VARCHAR(100);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_role_permissions_permission') THEN
    ALTER TABLE role_permissions
      ADD CONSTRAINT fk_role_permissions_permission
      FOREIGN KEY (permission_code) REFERENCES permissions(code)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Jeu par défaut des rôles système = ancien ROLE_DEFAULTS, à l'identique.
INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, d.code
  FROM (VALUES
    -- directeur
    ('directeur','journal.view'),('directeur','journal.create'),('directeur','journal.edit'),('directeur','journal.delete'),
    ('directeur','journal.validate'),('directeur','journal.ran'),
    ('directeur','budget.view'),('directeur','budget.edit'),('directeur','budget.validate'),
    ('directeur','budget.demande_create'),('directeur','budget.demande_validate'),('directeur','budget.demande_delete'),
    ('directeur','previsions.view'),('directeur','previsions.edit'),
    ('directeur','appel_fonds.view'),('directeur','appel_fonds.create'),('directeur','appel_fonds.validate'),('directeur','appel_fonds.delete'),
    ('directeur','rubriques.view'),('directeur','rubriques.edit'),
    ('directeur','users.view'),('directeur','users.create'),('directeur','users.edit'),('directeur','users.delete'),
    ('directeur','config.view'),('directeur','config.edit'),
    ('directeur','rapport.view'),('directeur','rapport.export'),
    ('directeur','plan_comptable.view'),('directeur','plan_comptable.edit'),('directeur','plan_comptable.delete'),
    ('directeur','journaux.view'),('directeur','journaux.edit'),('directeur','journaux.reouvrir'),
    ('directeur','pieces.view'),('directeur','pieces.edit'),('directeur','pieces.upload'),
    ('directeur','banque.view'),('directeur','banque.edit'),
    -- comptable_cabinet
    ('comptable_cabinet','journal.view'),('comptable_cabinet','journal.create'),('comptable_cabinet','journal.edit'),
    ('comptable_cabinet','journal.delete'),('comptable_cabinet','journal.ran'),
    ('comptable_cabinet','budget.view'),('comptable_cabinet','budget.edit'),
    ('comptable_cabinet','previsions.view'),('comptable_cabinet','previsions.edit'),
    ('comptable_cabinet','appel_fonds.view'),('comptable_cabinet','appel_fonds.create'),
    ('comptable_cabinet','rubriques.view'),('comptable_cabinet','rubriques.edit'),
    ('comptable_cabinet','users.view'),('comptable_cabinet','config.view'),
    ('comptable_cabinet','rapport.view'),('comptable_cabinet','rapport.export'),
    ('comptable_cabinet','plan_comptable.view'),('comptable_cabinet','plan_comptable.edit'),('comptable_cabinet','plan_comptable.delete'),
    ('comptable_cabinet','journaux.view'),
    ('comptable_cabinet','pieces.view'),('comptable_cabinet','pieces.edit'),('comptable_cabinet','pieces.upload'),
    ('comptable_cabinet','banque.view'),('comptable_cabinet','banque.edit'),
    -- caissier
    ('caissier','journal.view'),('caissier','journal.create'),('caissier','journal.edit'),('caissier','journal.ran'),
    ('caissier','budget.view'),('caissier','budget.demande_create'),('caissier','budget.demande_delete'),
    ('caissier','previsions.view'),('caissier','previsions.edit'),
    ('caissier','appel_fonds.view'),('caissier','appel_fonds.create'),
    ('caissier','rubriques.view'),('caissier','users.view'),('caissier','config.view'),('caissier','rapport.view'),
    ('caissier','plan_comptable.view'),('caissier','plan_comptable.edit'),
    ('caissier','journaux.view'),('caissier','pieces.view'),('caissier','pieces.upload'),('caissier','banque.view'),
    -- auditeur
    ('auditeur','journal.view'),('auditeur','budget.view'),('auditeur','previsions.view'),('auditeur','appel_fonds.view'),
    ('auditeur','rubriques.view'),('auditeur','users.view'),('auditeur','config.view'),
    ('auditeur','rapport.view'),('auditeur','rapport.export'),('auditeur','plan_comptable.view'),
    ('auditeur','journaux.view'),('auditeur','pieces.view'),('auditeur','banque.view')
  ) AS d(role_code, code)
  JOIN roles r ON r.code = d.role_code AND r.tenant_id IS NULL AND r.is_system
  JOIN permissions p ON p.code = d.code
ON CONFLICT DO NOTHING;

-- Ancienne règle implicite du service (journal.view ⇒ journaux.view),
-- désormais écrite en base pour les profils créés avant la 012.
INSERT INTO role_permissions(role_id, permission_code)
SELECT rp.role_id, 'journaux.view' FROM role_permissions rp
 WHERE rp.permission_code = 'journal.view'
   AND EXISTS (SELECT 1 FROM permissions WHERE code = 'journaux.view')
ON CONFLICT DO NOTHING;

-- Même règle pour les plafonds clients enregistrés avant la 012.
INSERT INTO tenant_permissions(tenant_id, permission_code)
SELECT tp.tenant_id, 'journaux.view' FROM tenant_permissions tp
 WHERE tp.permission_code = 'journal.view'
   AND EXISTS (SELECT 1 FROM permissions WHERE code = 'journaux.view')
ON CONFLICT DO NOTHING;

-- ── 3. user_permissions : instantané → exceptions grant/deny ───────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'user_permissions' AND column_name = 'effet'
  ) THEN
    ALTER TABLE user_permissions
      ADD COLUMN effet VARCHAR(5) NOT NULL DEFAULT 'grant'
      CHECK (effet IN ('grant','deny'));

    -- L'ancien service ajoutait journaux.view à quiconque avait journal.view,
    -- APRÈS le plafond : on l'écrit dans l'instantané pour ne rien retirer.
    INSERT INTO user_permissions(user_id, permission_code, effet)
    SELECT up.user_id, 'journaux.view', 'grant' FROM user_permissions up
     WHERE up.permission_code = 'journal.view'
       AND EXISTS (SELECT 1 FROM permissions WHERE code = 'journaux.view')
    ON CONFLICT DO NOTHING;

    -- Base de chaque personne ayant un instantané : son profil métier s'il a
    -- au moins une permission, sinon son rôle système (règle inchangée).
    CREATE TEMP TABLE _base ON COMMIT DROP AS
    SELECT u.id AS user_id, rp.permission_code
      FROM users u
      JOIN role_permissions rp ON rp.role_id = u.custom_role_id
     WHERE EXISTS (SELECT 1 FROM user_permissions up WHERE up.user_id = u.id)
    UNION
    SELECT u.id, rp.permission_code
      FROM users u
      JOIN roles r ON r.code = u.role AND r.tenant_id IS NULL AND r.is_system
      JOIN role_permissions rp ON rp.role_id = r.id
     WHERE EXISTS (SELECT 1 FROM user_permissions up WHERE up.user_id = u.id)
       AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = u.custom_role_id);

    -- deny = dans la base mais absent de l'instantané
    INSERT INTO user_permissions(user_id, permission_code, effet)
    SELECT b.user_id, b.permission_code, 'deny'
      FROM _base b
     WHERE NOT EXISTS (SELECT 1 FROM user_permissions up
                        WHERE up.user_id = b.user_id AND up.permission_code = b.permission_code);

    -- grant redondant (déjà dans la base) → supprimé
    DELETE FROM user_permissions up
     USING _base b
     WHERE up.user_id = b.user_id AND up.permission_code = b.permission_code
       AND up.effet = 'grant';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_permissions(user_id);
