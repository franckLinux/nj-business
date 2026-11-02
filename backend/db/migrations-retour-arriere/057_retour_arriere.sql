-- ============================================================================
-- Retour arrière de la migration 057 (permissions détaillées du stock).
-- À jouer À LA MAIN, après être revenu au code d'avant la 057 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/057_retour_arriere.sql
-- Recrée « com.stock.mouvements » pour quiconque a au moins une des quatre saisies,
-- puis retire les permissions détaillées. Aucune donnée de stock touchée.
-- ============================================================================
BEGIN;
INSERT INTO permissions (code, nom, module, description) VALUES
  ('com.stock.mouvements', 'Saisir les documents de stock', 'commercial', 'Entrées, sorties, transferts, inventaires (brouillons)')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT DISTINCT role_id, 'com.stock.mouvements' FROM role_permissions
 WHERE permission_code IN ('com.stock.entree', 'com.stock.sortie', 'com.stock.transfert', 'com.stock.inventaire')
ON CONFLICT DO NOTHING;
INSERT INTO user_permissions (user_id, permission_code, effet)
SELECT DISTINCT ON (user_id) user_id, 'com.stock.mouvements', effet FROM user_permissions
 WHERE permission_code IN ('com.stock.entree', 'com.stock.sortie', 'com.stock.transfert', 'com.stock.inventaire')
   AND NOT EXISTS (SELECT 1 FROM user_permissions x WHERE x.user_id = user_permissions.user_id AND x.permission_code = 'com.stock.mouvements')
 ORDER BY user_id, effet DESC;
INSERT INTO tenant_permissions (tenant_id, permission_code)
SELECT DISTINCT tenant_id, 'com.stock.mouvements' FROM tenant_permissions
 WHERE permission_code IN ('com.stock.entree', 'com.stock.sortie', 'com.stock.transfert', 'com.stock.inventaire')
ON CONFLICT DO NOTHING;
DELETE FROM role_permissions   WHERE permission_code IN ('com.stock.entree', 'com.stock.sortie', 'com.stock.transfert', 'com.stock.inventaire', 'com.stock.annuler', 'com.stock.journal', 'com.stock.valorisation');
DELETE FROM user_permissions   WHERE permission_code IN ('com.stock.entree', 'com.stock.sortie', 'com.stock.transfert', 'com.stock.inventaire', 'com.stock.annuler', 'com.stock.journal', 'com.stock.valorisation');
DELETE FROM tenant_permissions WHERE permission_code IN ('com.stock.entree', 'com.stock.sortie', 'com.stock.transfert', 'com.stock.inventaire', 'com.stock.annuler', 'com.stock.journal', 'com.stock.valorisation');
DELETE FROM permissions        WHERE code IN ('com.stock.entree', 'com.stock.sortie', 'com.stock.transfert', 'com.stock.inventaire', 'com.stock.annuler', 'com.stock.journal', 'com.stock.valorisation');
DELETE FROM schema_migrations WHERE version LIKE '057_%';
COMMIT;
