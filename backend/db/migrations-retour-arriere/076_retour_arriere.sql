-- ============================================================================
-- Retour arrière de la migration 076 (module NJ COMPTABILITÉ).
-- À jouer À LA MAIN, après être revenu au code d'avant la 076 :
--   psql "$DATABASE_URL" -f db/migrations-retour-arriere/076_retour_arriere.sql
-- Rend les permissions finance.* de la 075 (mêmes attributions) et remet la
-- carte NJ COMPTABILITÉ « en préparation ». Les écritures ne sont pas touchées.
-- ============================================================================
BEGIN;
INSERT INTO permissions(code, nom, module, description) VALUES
  ('finance.ecritures.voir',      'Voir les écritures et les états comptables', 'finance', 'Consulter les écritures, les journaux comptables, le grand livre et la balance'),
  ('finance.ecritures.saisir',    'Saisir des opérations diverses',             'finance', 'Créer, modifier et supprimer des écritures au brouillard (OD, à-nouveaux)'),
  ('finance.ecritures.valider',   'Valider et extourner les écritures',         'finance', 'Valider une écriture (jamais la sienne) et passer l''extourne d''une écriture validée'),
  ('finance.config.comptabilite', 'Paramétrer la comptabilité',                 'finance', 'Créer les exercices et les journaux comptables'),
  ('finance.periodes.verrouiller','Verrouiller et rouvrir les périodes',        'finance', 'Verrouiller une période (plus aucune saisie) ou la rouvrir')
ON CONFLICT (code) DO NOTHING;
CREATE TEMP TABLE _corr (ancien TEXT, nouveau TEXT) ON COMMIT DROP;
INSERT INTO _corr VALUES
  ('finance.ecritures.voir', 'compta.ecritures.voir'), ('finance.ecritures.saisir', 'compta.ecritures.saisir'),
  ('finance.ecritures.valider', 'compta.ecritures.valider'), ('finance.config.comptabilite', 'compta.parametrage'),
  ('finance.periodes.verrouiller', 'compta.periodes.verrouiller');
INSERT INTO role_permissions(role_id, permission_code)
SELECT rp.role_id, c.ancien FROM role_permissions rp JOIN _corr c ON c.nouveau = rp.permission_code ON CONFLICT DO NOTHING;
INSERT INTO tenant_permissions(tenant_id, permission_code)
SELECT tp.tenant_id, c.ancien FROM tenant_permissions tp JOIN _corr c ON c.nouveau = tp.permission_code ON CONFLICT DO NOTHING;
INSERT INTO user_permissions(user_id, permission_code, effet)
SELECT up.user_id, c.ancien, up.effet FROM user_permissions up JOIN _corr c ON c.nouveau = up.permission_code ON CONFLICT DO NOTHING;
DELETE FROM permissions WHERE code IN (SELECT nouveau FROM _corr);
UPDATE tenant_modules SET actif = false, modifie_le = NOW(), motif = 'Retour arrière 076' WHERE module_code = 'comptabilite' AND actif;
UPDATE modules SET nom = 'NJ COMPTABILITÉ', description = 'Écritures, balance, états financiers SYSCOHADA',
       statut = 'en_preparation', route_accueil = '/', prefixes_api = '{}', updated_at = NOW()
 WHERE code = 'comptabilite';
UPDATE modules SET description = 'Gestion financière : caisse, gestion d''activité, contrôle comptable et états financiers', updated_at = NOW()
 WHERE code = 'caisse';
DELETE FROM schema_migrations WHERE version LIKE '076_%';
COMMIT;
