-- ============================================================================
-- 076 — NJ COMPTABILITÉ devient un module à part entière, relié à NJ FINANCE
--      (décision de Franck du 25/11/2026)
--
--  La comptabilité posée par la 075 (exercices, périodes, journaux comptables,
--  écritures, grand livre, balance) quitte NJ FINANCE pour le module
--  NJ COMPTABILITÉ (code « comptabilite », déjà au catalogue depuis la 048).
--  Les TABLES ne bougent pas : NJ FINANCE continuera d'y écrire les écritures
--  de ses opérations (lots suivants), que le client ait ou non activé
--  NJ COMPTABILITÉ ; ce module en donne l'accès (saisie, validation, états,
--  et plus tard clôture).
--
--  1. Module « comptabilite » : opérationnel, accueil /comptabilite, préfixe
--     d'API /comptabilite. Il reste à activer client par client (plateforme).
--  2. Permissions finance.ecritures.* / finance.config.comptabilite /
--     finance.periodes.verrouiller → compta.* (même attribution : rôles,
--     plafonds des clients, droits individuels), module « comptabilite ».
--  Le préfixe /finance reste au module « caisse » (API de NJ FINANCE à venir).
--
--  Aucune table de données n'est modifiée. Idempotente.
--  Retour arrière : db/migrations-retour-arriere/076_retour_arriere.sql
-- ============================================================================

UPDATE modules
   SET nom = 'NJ COMPTABILITÉ',
       description = 'Écritures, grand livre, balance, états financiers et clôture SYSCOHADA — relié à NJ FINANCE',
       statut = 'operationnel',
       route_accueil = '/comptabilite',
       prefixes_api = ARRAY['/comptabilite'],
       updated_at = NOW()
 WHERE code = 'comptabilite'
   AND (statut <> 'operationnel' OR route_accueil <> '/comptabilite' OR prefixes_api <> ARRAY['/comptabilite']
        OR nom <> 'NJ COMPTABILITÉ');

-- La carte NJ FINANCE ne promet plus les états financiers : ils sont dans NJ COMPTABILITÉ.
UPDATE modules
   SET description = 'Gestion financière : caisse, gestion d''activité, achats, ventes et reporting — relié à NJ COMPTABILITÉ',
       updated_at = NOW()
 WHERE code = 'caisse'
   AND description IS DISTINCT FROM 'Gestion financière : caisse, gestion d''activité, achats, ventes et reporting — relié à NJ COMPTABILITÉ';

INSERT INTO permissions(code, nom, module, description) VALUES
  ('compta.ecritures.voir',      'Voir les écritures et les états comptables', 'comptabilite',
   'Consulter les écritures, les journaux comptables, le grand livre et la balance'),
  ('compta.ecritures.saisir',    'Saisir des opérations diverses',             'comptabilite',
   'Créer, modifier et supprimer des écritures au brouillard (OD, à-nouveaux)'),
  ('compta.ecritures.valider',   'Valider et extourner les écritures',         'comptabilite',
   'Valider une écriture (jamais la sienne) et passer l''extourne d''une écriture validée'),
  ('compta.parametrage',         'Paramétrer la comptabilité',                 'comptabilite',
   'Créer les exercices et les journaux comptables'),
  ('compta.periodes.verrouiller','Verrouiller et rouvrir les périodes',        'comptabilite',
   'Verrouiller une période (plus aucune saisie) ou la rouvrir')
ON CONFLICT (code) DO NOTHING;

CREATE TEMP TABLE IF NOT EXISTS _correspondance_076 (ancien TEXT, nouveau TEXT) ON COMMIT DROP;
TRUNCATE _correspondance_076;
INSERT INTO _correspondance_076 VALUES
  ('finance.ecritures.voir', 'compta.ecritures.voir'),
  ('finance.ecritures.saisir', 'compta.ecritures.saisir'),
  ('finance.ecritures.valider', 'compta.ecritures.valider'),
  ('finance.config.comptabilite', 'compta.parametrage'),
  ('finance.periodes.verrouiller', 'compta.periodes.verrouiller');

INSERT INTO role_permissions(role_id, permission_code)
SELECT rp.role_id, c.nouveau FROM role_permissions rp JOIN _correspondance_076 c ON c.ancien = rp.permission_code
ON CONFLICT DO NOTHING;
INSERT INTO tenant_permissions(tenant_id, permission_code)
SELECT tp.tenant_id, c.nouveau FROM tenant_permissions tp JOIN _correspondance_076 c ON c.ancien = tp.permission_code
ON CONFLICT DO NOTHING;
INSERT INTO user_permissions(user_id, permission_code, effet)
SELECT up.user_id, c.nouveau, up.effet FROM user_permissions up JOIN _correspondance_076 c ON c.ancien = up.permission_code
ON CONFLICT DO NOTHING;

-- Les anciens codes disparaissent (cascade sur les attributions).
DELETE FROM permissions WHERE code IN (SELECT ancien FROM _correspondance_076);
