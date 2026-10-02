-- ── 013 : séparation ajout / désactivation dans le plan comptable ─────────
-- Le plan comptable est COMMUN à tous les clients : désactiver un compte
-- additif l'enlève pour tout le monde. La caissière reçoit désormais par
-- défaut `plan_comptable.edit` (ajouter un compte) et `journal.ran` ; la
-- désactivation passe sous un code distinct, réservé à l'encadrement.

INSERT INTO permissions(code, nom, module, description) VALUES
  ('plan_comptable.delete', 'Désactiver un compte additif', 'plan_comptable',
   'Désactiver un compte personnalisé du plan comptable (commun à tous les clients)')
ON CONFLICT (code) DO NOTHING;

UPDATE permissions SET description = 'Ajouter des comptes additifs au plan comptable'
 WHERE code = 'plan_comptable.edit';

-- Conserver le comportement actuel : qui pouvait désactiver (via
-- plan_comptable.edit) le peut toujours, sur chaque niveau d'attribution.
INSERT INTO tenant_permissions(tenant_id, permission_code)
  SELECT tenant_id, 'plan_comptable.delete' FROM tenant_permissions
   WHERE permission_code = 'plan_comptable.edit'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id, permission_code)
  SELECT role_id, 'plan_comptable.delete' FROM role_permissions
   WHERE permission_code = 'plan_comptable.edit'
ON CONFLICT DO NOTHING;

INSERT INTO user_permissions(user_id, permission_code)
  SELECT user_id, 'plan_comptable.delete' FROM user_permissions
   WHERE permission_code = 'plan_comptable.edit'
ON CONFLICT DO NOTHING;
