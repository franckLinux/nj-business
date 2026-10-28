-- ============================================================================
-- 041 — Menu « Contrôle comptable » (décision du 21/10/2026)
--
-- La passerelle comptable quitte la page Configuration pour un menu dédié,
-- « Contrôle comptable », qui accueillera aussi les futurs contrôles.
-- Accès par une permission propre : controle.view, accordée par défaut au
-- comptable du cabinet, au directeur et à l'auditeur (contrôleur).
-- La caissière et les profils de saisie ne l'ont pas. Un administrateur peut
-- l'accorder à n'importe quel profil depuis l'écran Permissions / Rôles.
-- Idempotente : peut être rejouée sans effet de bord.
-- ============================================================================

INSERT INTO permissions(code, nom, module, description) VALUES
  ('controle.view', 'Accéder au contrôle comptable', 'controle',
   'Voir le menu « Contrôle comptable » (passerelle comptable et contrôles)')
ON CONFLICT (code) DO NOTHING;

-- Rôles système : comptable du cabinet, directeur, auditeur / contrôleur.
INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, 'controle.view' FROM roles r
 WHERE r.code IN ('comptable_cabinet', 'directeur', 'auditeur')
   AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;

-- Clients avec plafond : le menu est ouvert là où la passerelle l'était déjà
-- (sinon le plafond masquerait le nouveau menu au directeur de ces clients).
INSERT INTO tenant_permissions(tenant_id, permission_code)
SELECT DISTINCT tp.tenant_id, 'controle.view' FROM tenant_permissions tp
 WHERE tp.permission_code = 'passerelle.view'
ON CONFLICT DO NOTHING;
