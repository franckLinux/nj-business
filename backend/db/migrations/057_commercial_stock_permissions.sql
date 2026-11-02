-- ============================================================================
-- 057 — NJ COMMERCIAL : une permission par fonction du stock (lot 4).
--
--  Le lot 4 avait trois droits (voir, mouvements, valider). Chaque écran du stock
--  devient une permission distincte, cochable dans les profils métier, les
--  exceptions par utilisateur et le plafond des clients :
--    com.stock.voir          État du stock (quantités)
--    com.stock.entree        Saisir les entrées en stock
--    com.stock.sortie        Saisir les sorties diverses
--    com.stock.transfert     Saisir les transferts entre magasins
--    com.stock.inventaire    Saisir les inventaires (comptages)
--    com.stock.valider       Valider ou renvoyer les documents de stock
--    com.stock.annuler       Annuler un document de stock validé
--    com.stock.journal       Consulter les mouvements de stock
--    com.stock.valorisation  Voir coûts et valeurs, valorisation du stock
--    com.stock.initial       Saisir le stock d'ouverture (déjà existante)
--
--  AUCUN DROIT N'EST RETIRÉ À PERSONNE : qui avait « mouvements » reçoit les quatre
--  saisies ; « voir » reçoit aussi journal et valorisation (ce qu'il voyait déjà) ;
--  « valider » reçoit aussi annuler. Conversion appliquée aux rôles, aux profils,
--  aux exceptions individuelles (accord comme refus) et aux plafonds des clients ;
--  le code « com.stock.mouvements » remplacé disparaît ensuite du catalogue.
--  Aucune donnée de stock ni de caisse touchée. Rejouable.
--  Exécutée dans une transaction par db/migrate.js (tout ou rien).
--  Retour arrière : migrations-retour-arriere/057_retour_arriere.sql
-- ============================================================================
INSERT INTO permissions (code, nom, module, description) VALUES
  ('com.stock.entree',       'Saisir les entrées en stock',            'commercial', 'Entrées diverses hors bon de commande (don, régularisation), avec leur coût'),
  ('com.stock.sortie',       'Saisir les sorties diverses',            'commercial', 'Consommation interne, casse, perte, échantillon'),
  ('com.stock.transfert',    'Saisir les transferts entre magasins',   'commercial', 'Déplacer de la marchandise d''un magasin à un autre, avec son coût'),
  ('com.stock.inventaire',   'Saisir les inventaires',                 'commercial', 'Comptages physiques ; les écarts ne comptent qu''après validation'),
  ('com.stock.annuler',      'Annuler les documents de stock validés', 'commercial', 'Annulation motivée : mouvements conservés, valorisation recalculée'),
  ('com.stock.journal',      'Consulter les mouvements de stock',      'commercial', 'Journal de toutes les entrées et sorties'),
  ('com.stock.valorisation', 'Voir les coûts et la valorisation',      'commercial', 'Coûts unitaires, valeurs, écran Valorisation du stock')
ON CONFLICT (code) DO NOTHING;

UPDATE permissions SET nom = 'Consulter l''état du stock', description = 'Quantités par article et par magasin, alertes de seuil'
 WHERE code = 'com.stock.voir';
UPDATE permissions SET nom = 'Valider ou renvoyer les documents de stock', description = 'Seule la validation fait bouger le stock ; jamais par l''auteur du document'
 WHERE code = 'com.stock.valider';
UPDATE permissions SET nom = 'Saisir le stock d''ouverture', description = 'Quantité et coût initiaux, depuis la fiche article'
 WHERE code = 'com.stock.initial';

-- Correspondance ancien droit → nouveaux droits (aucun accès perdu).
DROP TABLE IF EXISTS com_stock_conv;
CREATE TEMP TABLE com_stock_conv (ancien TEXT, nouveau TEXT);
INSERT INTO com_stock_conv VALUES
  ('com.stock.mouvements', 'com.stock.entree'), ('com.stock.mouvements', 'com.stock.sortie'),
  ('com.stock.mouvements', 'com.stock.transfert'), ('com.stock.mouvements', 'com.stock.inventaire'),
  ('com.stock.voir', 'com.stock.journal'), ('com.stock.voir', 'com.stock.valorisation'),
  ('com.stock.valider', 'com.stock.annuler');

INSERT INTO role_permissions (role_id, permission_code)
SELECT rp.role_id, c.nouveau FROM role_permissions rp JOIN com_stock_conv c ON c.ancien = rp.permission_code
ON CONFLICT DO NOTHING;

INSERT INTO user_permissions (user_id, permission_code, effet)
SELECT up.user_id, c.nouveau, up.effet FROM user_permissions up JOIN com_stock_conv c ON c.ancien = up.permission_code
 WHERE NOT EXISTS (SELECT 1 FROM user_permissions x WHERE x.user_id = up.user_id AND x.permission_code = c.nouveau);

INSERT INTO tenant_permissions (tenant_id, permission_code)
SELECT tp.tenant_id, c.nouveau FROM tenant_permissions tp JOIN com_stock_conv c ON c.ancien = tp.permission_code
ON CONFLICT DO NOTHING;

-- Le directeur (rôle système) a tout le module.
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE r.code = 'directeur' AND r.tenant_id IS NULL AND r.is_system AND p.code LIKE 'com.stock.%'
ON CONFLICT DO NOTHING;

-- Le code remplacé quitte le catalogue (ses titulaires ont reçu les quatre saisies).
DELETE FROM role_permissions   WHERE permission_code = 'com.stock.mouvements';
DELETE FROM user_permissions   WHERE permission_code = 'com.stock.mouvements';
DELETE FROM tenant_permissions WHERE permission_code = 'com.stock.mouvements';
DELETE FROM permissions        WHERE code = 'com.stock.mouvements';

DROP TABLE com_stock_conv;
