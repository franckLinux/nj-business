-- ============================================================================
-- 060 — Plan comptable SYCEBNL pour les associations et ONG (09/11/2026)
--
-- Règle : la forme juridique de l'entité décide du référentiel comptable.
--   • Association (ASSOC) ou ONG  → SYCEBNL (entités à but non lucratif) ;
--   • toute autre forme (ou aucune) → SYSCOHADA révisé (défaut, inchangé).
-- Le plan du client (plan_comptable_client, migration 019) reste LE plan lu
-- par toute l'application (rubriques, passerelle, autocomplétion) : on ne
-- change que son CONTENU. Les comptes additifs du client restent possibles
-- dans les deux référentiels.
--
--  1. plan_referentiel_comptes : référentiel SYCEBNL embarqué (585 comptes,
--     dont 124 propres aux EBNL — db/data/plan-comptable-sycebnl.js). Le
--     modèle SYSCOHADA versionné (018/020) n'est pas touché.
--  2. tenants.plan_referentiel ('SYSCOHADA' | 'SYCEBNL'), plan_comptable_client
--     .referentiel (référentiel d'origine d'un compte « modele »),
--     .statut_avant_bascule (statut à restaurer si l'on revient en arrière).
--  3. plan_referentiel_de_forme(forme) : la règle ci-dessus, en un seul endroit.
--  4. plan_client_basculer(tenant, cible, user, simuler) : bascule ATOMIQUE et
--     RÉVERSIBLE du plan d'un client. Rien n'est supprimé :
--       - comptes du référentiel cible absents → ajoutés ;
--       - comptes de même numéro issus de l'ancien référentiel → libellé du
--         nouveau (sauf si le client l'avait personnalisé) ;
--       - comptes de l'ancien référentiel absents du nouveau → ARCHIVÉS, sauf
--         s'ils sont UTILISÉS (rubrique, équivalence, journal, virements) :
--         ils restent alors actifs et sont signalés ;
--       - comptes additifs du client → jamais touchés.
--     simuler = true renvoie l'aperçu sans rien écrire. Journal : plan_bascules
--     + audit_log.
--  5. plan_client_initialiser() : un client SYCEBNL est initialisé depuis le
--     référentiel SYCEBNL (le SYSCOHADA reste le cas général).
--  6. Aucun client existant n'est basculé d'office : l'écran Entité / Plan
--     comptable propose la bascule (aperçu puis confirmation).
-- Idempotente.
-- ============================================================================

-- ── 1. Référentiel SYCEBNL ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plan_referentiel_comptes (
    referentiel TEXT    NOT NULL CHECK (referentiel IN ('SYCEBNL')),
    compte      TEXT    NOT NULL CHECK (btrim(compte) <> ''),
    intitule    TEXT    NOT NULL CHECK (btrim(intitule) <> ''),
    classe      INTEGER,
    nature      TEXT,
    specifique  BOOLEAN NOT NULL DEFAULT false,   -- propre aux EBNL (absent ou différent en SYSCOHADA)
    actif       BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (referentiel, compte)
);

INSERT INTO plan_referentiel_comptes (referentiel, compte, intitule, classe, nature, specifique)
SELECT 'SYCEBNL', v.compte, v.intitule, v.classe, v.nature, v.specifique
  FROM (VALUES
    ('10', 'Dotation', 1, 'passif', true),
    ('101', 'Dotation non consomptible sans droit de reprise', 1, 'passif', true),
    ('1011', 'Dotation non consomptible sans droit de reprise, en numéraire', 1, 'passif', true),
    ('1015', 'Dotation non consomptible sans droit de reprise, en nature', 1, 'passif', true),
    ('102', 'Dotation non consomptible avec droit de reprise', 1, 'passif', true),
    ('1021', 'Dotation non consomptible avec droit de reprise, en numéraire', 1, 'passif', true),
    ('1025', 'Dotation non consomptible avec droit de reprise, en nature', 1, 'passif', true),
    ('103', 'Droit d''entrée', 1, 'passif', true),
    ('104', 'Dotation consomptible', 1, 'passif', true),
    ('1041', 'Dotation consomptible', 1, 'passif', true),
    ('1049', 'Dotation consomptible inscrite au compte de résultat', 1, 'passif', true),
    ('106', 'Écarts de réévaluation', 1, 'passif', true),
    ('11', 'Réserves', 1, 'passif', true),
    ('112', 'Réserves statutaires ou contractuelles', 1, 'passif', true),
    ('118', 'Autres réserves', 1, 'passif', true),
    ('12', 'Report à nouveau', 1, 'passif', true),
    ('121', 'Report à nouveau des excédents', 1, 'passif', true),
    ('129', 'Report à nouveau des déficits', 1, 'passif', true),
    ('13', 'Résultat net de l''exercice', 1, 'passif', true),
    ('131', 'Excédent de l''exercice', 1, 'passif', true),
    ('139', 'Déficit de l''exercice', 1, 'passif', true),
    ('14', 'Subventions d''investissement', 1, 'passif', true),
    ('141', 'Subventions d''équipement', 1, 'passif', true),
    ('148', 'Autres subventions d''investissement', 1, 'passif', true),
    ('15', 'Provisions réglementées et fonds assimilés', 1, 'passif', true),
    ('154', 'Provisions spéciales de réévaluation', 1, 'passif', true),
    ('158', 'Autres provisions réglementées et fonds assimilés', 1, 'passif', true),
    ('16', 'Fonds affectés', 1, 'passif', true),
    ('161', 'Fonds projet de développement — avances de fonds à justifier', 1, 'passif', true),
    ('162', 'Fonds affectés aux investissements du projet de développement — bailleurs de fonds', 1, 'passif', true),
    ('163', 'Fonds affectés aux investissements du projet de développement — État', 1, 'passif', true),
    ('164', 'Fonds affectés aux investissements des autres organismes de financement assimilés', 1, 'passif', true),
    ('165', 'Fonds affectés à un projet spécifique', 1, 'passif', true),
    ('167', 'Fonds provenant de dons et legs d''immobilisations', 1, 'passif', true),
    ('168', 'Autres fonds affectés', 1, 'passif', true),
    ('169', 'Fonds affectés à recevoir', 1, 'passif', true),
    ('17', 'Fonds reportés liés aux legs et donations', 1, 'passif', true),
    ('171', 'Donation temporaire d''usufruit', 1, 'passif', true),
    ('172', 'Legs non encore reçus d''immobilisations destinées à la vente', 1, 'passif', true),
    ('178', 'Autres fonds reportés', 1, 'passif', true),
    ('18', 'Emprunts et dettes assimilées', 1, 'passif', true),
    ('181', 'Emprunts obligataires', 1, 'passif', true),
    ('182', 'Emprunts et dettes auprès des établissements de crédit', 1, 'passif', true),
    ('183', 'Avances reçues de l''État', 1, 'passif', true),
    ('185', 'Dépôts et cautionnements reçus', 1, 'passif', true),
    ('186', 'Intérêts courus', 1, 'passif', true),
    ('187', 'Dettes de location-acquisition', 1, 'passif', true),
    ('188', 'Autres emprunts et dettes', 1, 'passif', true),
    ('19', 'Provisions pour risques et charges', 1, 'passif', true),
    ('191', 'Provisions pour litiges', 1, 'passif', true),
    ('192', 'Provisions pour charges sur donations et legs', 1, 'passif', true),
    ('196', 'Provisions pour pensions et obligations similaires', 1, 'passif', true),
    ('198', 'Autres provisions pour risques et charges', 1, 'passif', true),
    ('21', 'Immobilisations incorporelles', 2, 'actif', false),
    ('211', 'Frais de développement', 2, 'actif', false),
    ('212', 'Brevets, licences, concessions et droits similaires', 2, 'actif', false),
    ('213', 'Logiciels et sites internet', 2, 'actif', false),
    ('2131', 'Logiciels', 2, 'actif', false),
    ('2132', 'Sites internet', 2, 'actif', false),
    ('214', 'Marques', 2, 'actif', false),
    ('215', 'Fonds commercial', 2, 'actif', false),
    ('216', 'Droit au bail', 2, 'actif', false),
    ('217', 'Investissements de création', 2, 'actif', false),
    ('218', 'Autres droits et valeurs incorporels', 2, 'actif', false),
    ('219', 'Immobilisations incorporelles en cours', 2, 'actif', false),
    ('22', 'Terrains', 2, 'actif', false),
    ('221', 'Terrains agricoles et forestiers', 2, 'actif', false),
    ('222', 'Terrains nus', 2, 'actif', false),
    ('223', 'Terrains bâtis', 2, 'actif', false),
    ('224', 'Travaux de mise en valeur des terrains', 2, 'actif', false),
    ('225', 'Terrains de gisement', 2, 'actif', false),
    ('226', 'Terrains aménagés', 2, 'actif', false),
    ('227', 'Terrains mis en concession', 2, 'actif', false),
    ('228', 'Autres terrains', 2, 'actif', false),
    ('229', 'Aménagements de terrains en cours', 2, 'actif', false),
    ('23', 'Bâtiments, installations techniques et agencements', 2, 'actif', false),
    ('231', 'Bâtiments industriels, agricoles, administratifs et commerciaux sur sol propre', 2, 'actif', false),
    ('232', 'Bâtiments industriels, agricoles, administratifs et commerciaux sur sol d''autrui', 2, 'actif', false),
    ('233', 'Ouvrages d''infrastructure', 2, 'actif', false),
    ('234', 'Installations techniques', 2, 'actif', false),
    ('235', 'Aménagements de bureaux', 2, 'actif', false),
    ('237', 'Bâtiments industriels, agricoles et commerciaux mis en concession', 2, 'actif', false),
    ('238', 'Autres installations et agencements', 2, 'actif', false),
    ('239', 'Bâtiments et installations en cours', 2, 'actif', false),
    ('24', 'Matériel, mobilier et actifs biologiques', 2, 'actif', false),
    ('241', 'Matériel et outillage industriel et commercial', 2, 'actif', false),
    ('242', 'Matériel et outillage agricole', 2, 'actif', false),
    ('243', 'Matériel d''emballage récupérable et identifiable', 2, 'actif', false),
    ('244', 'Matériel et mobilier', 2, 'actif', false),
    ('2441', 'Matériel de bureau', 2, 'actif', false),
    ('2442', 'Matériel informatique', 2, 'actif', false),
    ('2443', 'Matériel bureautique', 2, 'actif', false),
    ('2444', 'Mobilier de bureau', 2, 'actif', false),
    ('2447', 'Matériel et mobilier des logements du personnel', 2, 'actif', false),
    ('245', 'Matériel de transport', 2, 'actif', false),
    ('2451', 'Matériel automobile', 2, 'actif', false),
    ('2452', 'Matériel ferroviaire', 2, 'actif', false),
    ('2453', 'Matériel fluvial et lagunaire', 2, 'actif', false),
    ('2454', 'Matériel naval', 2, 'actif', false),
    ('2455', 'Matériel aérien', 2, 'actif', false),
    ('2458', 'Autres matériels de transport', 2, 'actif', false),
    ('246', 'Actifs biologiques', 2, 'actif', false),
    ('2461', 'Plantations agricoles', 2, 'actif', false),
    ('2462', 'Animaux de production', 2, 'actif', false),
    ('247', 'Agencements et aménagements du matériel', 2, 'actif', false),
    ('248', 'Autres matériels', 2, 'actif', false),
    ('249', 'Matériel en cours', 2, 'actif', false),
    ('25', 'Avances et acomptes versés sur immobilisations', 2, 'actif', false),
    ('251', 'Avances et acomptes versés sur immobilisations incorporelles', 2, 'actif', false),
    ('252', 'Avances et acomptes versés sur immobilisations corporelles', 2, 'actif', false),
    ('26', 'Titres de participation', 2, 'actif', false),
    ('261', 'Titres de participation dans des sociétés sous contrôle exclusif', 2, 'actif', false),
    ('262', 'Titres de participation dans des sociétés sous contrôle conjoint', 2, 'actif', false),
    ('263', 'Titres de participation dans des sociétés conférant une influence notable', 2, 'actif', false),
    ('265', 'Participations dans des organismes professionnels', 2, 'actif', false),
    ('266', 'Parts dans des groupements d''intérêt économique (GIE)', 2, 'actif', false),
    ('268', 'Autres titres de participation', 2, 'actif', false),
    ('27', 'Autres immobilisations financières', 2, 'actif', false),
    ('271', 'Prêts et créances non commerciales', 2, 'actif', false),
    ('272', 'Prêts au personnel', 2, 'actif', false),
    ('273', 'Créances sur l''État', 2, 'actif', false),
    ('274', 'Titres immobilisés', 2, 'actif', false),
    ('275', 'Dépôts et cautionnements versés', 2, 'actif', false),
    ('2751', 'Dépôts pour loyers d''avance', 2, 'actif', false),
    ('2752', 'Dépôts pour eau, gaz, électricité', 2, 'actif', false),
    ('2753', 'Dépôts pour téléphone', 2, 'actif', false),
    ('2758', 'Autres dépôts et cautionnements', 2, 'actif', false),
    ('276', 'Intérêts courus sur immobilisations financières', 2, 'actif', false),
    ('277', 'Créances de location acquisition', 2, 'actif', false),
    ('278', 'Immobilisations financières diverses', 2, 'actif', false),
    ('28', 'Amortissements', 2, 'actif', false),
    ('281', 'Amortissements des immobilisations incorporelles', 2, 'actif', false),
    ('282', 'Amortissements des terrains', 2, 'actif', false),
    ('283', 'Amortissements des bâtiments, installations techniques et agencements', 2, 'actif', false),
    ('284', 'Amortissements du matériel, mobilier et actifs biologiques', 2, 'actif', false),
    ('29', 'Dépréciations des immobilisations', 2, 'actif', false),
    ('291', 'Dépréciations des immobilisations incorporelles', 2, 'actif', false),
    ('292', 'Dépréciations des terrains', 2, 'actif', false),
    ('293', 'Dépréciations des bâtiments, installations techniques et agencements', 2, 'actif', false),
    ('294', 'Dépréciations du matériel, mobilier et actifs biologiques', 2, 'actif', false),
    ('295', 'Dépréciations des avances et acomptes versés sur immobilisations', 2, 'actif', false),
    ('296', 'Dépréciations des titres de participation', 2, 'actif', false),
    ('297', 'Dépréciations des autres immobilisations financières', 2, 'actif', false),
    ('31', 'Marchandises', 3, 'actif', false),
    ('311', 'Marchandises A', 3, 'actif', false),
    ('312', 'Marchandises B', 3, 'actif', false),
    ('318', 'Marchandises hors activités ordinaires', 3, 'actif', false),
    ('32', 'Matières premières et fournitures liées', 3, 'actif', false),
    ('321', 'Matières premières', 3, 'actif', false),
    ('322', 'Fournitures liées', 3, 'actif', false),
    ('33', 'Autres approvisionnements', 3, 'actif', false),
    ('331', 'Matières consommables', 3, 'actif', false),
    ('332', 'Fournitures d''atelier et d''usine', 3, 'actif', false),
    ('333', 'Fournitures de magasin', 3, 'actif', false),
    ('334', 'Fournitures de bureau', 3, 'actif', false),
    ('335', 'Emballages', 3, 'actif', false),
    ('3351', 'Emballages perdus', 3, 'actif', false),
    ('3352', 'Emballages récupérables non identifiables', 3, 'actif', false),
    ('3353', 'Emballages à usage mixte', 3, 'actif', false),
    ('338', 'Autres matières', 3, 'actif', false),
    ('34', 'Produits en cours', 3, 'actif', false),
    ('341', 'Produits en cours', 3, 'actif', false),
    ('342', 'Travaux en cours', 3, 'actif', false),
    ('35', 'Services en cours', 3, 'actif', false),
    ('351', 'Études en cours', 3, 'actif', false),
    ('352', 'Prestations de services en cours', 3, 'actif', false),
    ('36', 'Produits finis', 3, 'actif', false),
    ('361', 'Produits finis A', 3, 'actif', false),
    ('362', 'Produits finis B', 3, 'actif', false),
    ('37', 'Produits intermédiaires et résiduels', 3, 'actif', false),
    ('371', 'Produits intermédiaires', 3, 'actif', false),
    ('372', 'Produits résiduels (déchets et rebuts)', 3, 'actif', false),
    ('38', 'Stocks en cours de route, en consignation ou en dépôt', 3, 'actif', false),
    ('381', 'Marchandises en cours de route', 3, 'actif', false),
    ('382', 'Matières premières et fournitures liées en cours de route', 3, 'actif', false),
    ('383', 'Autres approvisionnements en cours de route', 3, 'actif', false),
    ('386', 'Stocks en consignation ou en dépôt', 3, 'actif', false),
    ('388', 'Stock provenant d''immobilisations mises hors service ou au rebut', 3, 'actif', false),
    ('39', 'Dépréciations des stocks', 3, 'actif', false),
    ('391', 'Dépréciations des stocks de marchandises', 3, 'actif', false),
    ('392', 'Dépréciations des stocks de matières premières et fournitures liées', 3, 'actif', false),
    ('393', 'Dépréciations des stocks d''autres approvisionnements', 3, 'actif', false),
    ('394', 'Dépréciations des productions en cours', 3, 'actif', false),
    ('395', 'Dépréciations des services en cours', 3, 'actif', false),
    ('396', 'Dépréciations des stocks de produits finis', 3, 'actif', false),
    ('397', 'Dépréciations des stocks de produits intermédiaires et résiduels', 3, 'actif', false),
    ('398', 'Dépréciations des stocks en cours de route, en consignation ou en dépôt', 3, 'actif', false),
    ('40', 'Fournisseurs et comptes rattachés', 4, 'passif', false),
    ('401', 'Fournisseurs, dettes en compte', 4, 'passif', false),
    ('402', 'Fournisseurs, effets à payer', 4, 'passif', false),
    ('408', 'Fournisseurs, factures non parvenues', 4, 'passif', false),
    ('409', 'Fournisseurs débiteurs', 4, 'actif', false),
    ('4091', 'Fournisseurs, avances et acomptes versés', 4, 'actif', false),
    ('4092', 'Fournisseurs, rabais, remises et ristournes à obtenir', 4, 'actif', false),
    ('4093', 'Fournisseurs, créances pour emballages et matériels à rendre', 4, 'actif', false),
    ('4098', 'Rabais, remises, ristournes et autres avoirs à obtenir', 4, 'actif', false),
    ('41', 'Adhérents, clients-usagers et comptes rattachés', 4, 'actif', true),
    ('411', 'Adhérents', 4, 'actif', true),
    ('412', 'Clients-usagers', 4, 'actif', true),
    ('416', 'Créances adhérents, clients-usagers litigieuses ou douteuses', 4, 'actif', true),
    ('42', 'Personnel', 4, 'passif', false),
    ('421', 'Personnel, avances et acomptes', 4, 'actif', false),
    ('422', 'Personnel, rémunérations dues', 4, 'passif', false),
    ('423', 'Personnel, oppositions et saisies-arrêts', 4, 'passif', false),
    ('424', 'Personnel, œuvres sociales internes', 4, 'passif', false),
    ('425', 'Représentants du personnel', 4, 'passif', false),
    ('426', 'Personnel, participation aux bénéfices', 4, 'passif', false),
    ('427', 'Personnel, dépôts', 4, 'passif', false),
    ('428', 'Personnel, charges à payer et produits à recevoir', 4, 'passif', false),
    ('43', 'Organismes sociaux', 4, 'passif', false),
    ('431', 'Sécurité sociale', 4, 'passif', false),
    ('432', 'Caisses de retraite complémentaire', 4, 'passif', false),
    ('433', 'Autres organismes sociaux', 4, 'passif', false),
    ('438', 'Organismes sociaux, charges à payer et produits à recevoir', 4, 'passif', false),
    ('44', 'État et collectivités publiques', 4, 'passif', false),
    ('441', 'État, impôt sur les bénéfices', 4, 'passif', false),
    ('442', 'État, autres impôts et taxes', 4, 'passif', false),
    ('443', 'État, TVA facturée', 4, 'passif', false),
    ('4431', 'TVA facturée sur ventes', 4, 'passif', false),
    ('4432', 'TVA facturée sur prestations de services', 4, 'passif', false),
    ('4433', 'TVA facturée sur travaux', 4, 'passif', false),
    ('4434', 'TVA facturée sur production livrée à soi-même', 4, 'passif', false),
    ('444', 'État, TVA due ou crédit de TVA', 4, 'passif', false),
    ('4441', 'État, TVA due', 4, 'passif', false),
    ('4449', 'État, crédit de TVA à reporter', 4, 'actif', false),
    ('445', 'État, TVA récupérable', 4, 'actif', false),
    ('4451', 'TVA récupérable sur immobilisations', 4, 'actif', false),
    ('4452', 'TVA récupérable sur achats', 4, 'actif', false),
    ('4453', 'TVA récupérable sur transport', 4, 'actif', false),
    ('4454', 'TVA récupérable sur services extérieurs et autres charges', 4, 'actif', false),
    ('4455', 'TVA récupérable sur factures non parvenues', 4, 'actif', false),
    ('446', 'État, autres taxes sur le chiffre d''affaires', 4, 'passif', false),
    ('447', 'État, impôts retenus à la source', 4, 'passif', false),
    ('448', 'État, charges à payer et produits à recevoir', 4, 'passif', false),
    ('449', 'État, créances et dettes diverses', 4, 'passif', false),
    ('45', 'Fondateurs, apporteurs et comptes courants', 4, 'passif', true),
    ('451', 'Associations et assimilées', 4, 'passif', true),
    ('457', 'Mécènes, bénévoles et assimilés', 4, 'passif', true),
    ('46', 'Bailleurs, fonds d''administration', 4, 'passif', true),
    ('462', 'Bailleurs — projet de développement, fonds d''administration', 4, 'passif', true),
    ('463', 'État — projet de développement, fonds d''administration', 4, 'passif', true),
    ('464', 'Autres tiers ou organismes de financement assimilés — fonds d''administration', 4, 'passif', true),
    ('469', 'Fonds d''administration à recevoir', 4, 'actif', true),
    ('4692', 'Bailleurs — fonds d''administration à recevoir', 4, 'actif', true),
    ('47', 'Débiteurs et créditeurs divers', 4, 'actif', false),
    ('471', 'Comptes d''attente', 4, 'actif', false),
    ('472', 'Versements restant à effectuer sur titres non libérés', 4, 'passif', false),
    ('473', 'Comptes de répartition périodique des charges et des produits', 4, 'actif', false),
    ('475', 'Générosités financières à recevoir', 4, 'actif', true),
    ('476', 'Charges constatées d''avance', 4, 'actif', false),
    ('477', 'Produits constatés d''avance', 4, 'passif', false),
    ('478', 'Écarts de conversion — Actif', 4, 'actif', false),
    ('479', 'Écarts de conversion — Passif', 4, 'passif', false),
    ('48', 'Créances et dettes hors activités ordinaires (HAO)', 4, 'passif', false),
    ('481', 'Fournisseurs d''investissements', 4, 'passif', false),
    ('482', 'Fournisseurs d''investissements, effets à payer', 4, 'passif', false),
    ('483', 'Dettes sur acquisition de titres de placement', 4, 'passif', false),
    ('484', 'Autres dettes hors activités ordinaires', 4, 'passif', false),
    ('485', 'Créances sur cessions d''immobilisations', 4, 'actif', false),
    ('486', 'Créances sur cessions de titres de placement', 4, 'actif', false),
    ('488', 'Autres créances hors activités ordinaires', 4, 'actif', false),
    ('49', 'Dépréciations et provisions pour risques à court terme', 4, 'passif', false),
    ('490', 'Dépréciations des comptes fournisseurs', 4, 'passif', false),
    ('491', 'Dépréciations des comptes clients', 4, 'passif', false),
    ('492', 'Dépréciations des comptes personnel', 4, 'passif', false),
    ('493', 'Dépréciations des comptes organismes sociaux', 4, 'passif', false),
    ('494', 'Dépréciations des comptes État et collectivités publiques', 4, 'passif', false),
    ('495', 'Dépréciations des comptes organismes internationaux', 4, 'passif', false),
    ('496', 'Dépréciations des comptes associés et groupe', 4, 'passif', false),
    ('497', 'Dépréciations des comptes débiteurs et créditeurs divers', 4, 'passif', false),
    ('498', 'Dépréciations des comptes de créances HAO', 4, 'passif', false),
    ('499', 'Provisions pour risques à court terme', 4, 'passif', false),
    ('50', 'Titres de placement', 5, 'tresorerie', false),
    ('501', 'Titres du Trésor et bons de caisse à court terme', 5, 'tresorerie', false),
    ('502', 'Actions', 5, 'tresorerie', false),
    ('503', 'Obligations', 5, 'tresorerie', false),
    ('504', 'Bons de souscription', 5, 'tresorerie', false),
    ('505', 'Titres négociables hors région', 5, 'tresorerie', false),
    ('506', 'Intérêts courus sur titres de placement', 5, 'tresorerie', false),
    ('508', 'Autres valeurs assimilées', 5, 'tresorerie', false),
    ('51', 'Valeurs à encaisser', 5, 'tresorerie', false),
    ('511', 'Effets à encaisser', 5, 'tresorerie', false),
    ('512', 'Effets à l''encaissement', 5, 'tresorerie', false),
    ('513', 'Chèques à encaisser', 5, 'tresorerie', false),
    ('514', 'Chèques à l''encaissement', 5, 'tresorerie', false),
    ('515', 'Cartes de crédit à encaisser', 5, 'tresorerie', false),
    ('516', 'Coupons échus', 5, 'tresorerie', false),
    ('518', 'Autres valeurs à l''encaissement', 5, 'tresorerie', false),
    ('52', 'Banques', 5, 'tresorerie', false),
    ('521', 'Banques locales', 5, 'tresorerie', false),
    ('522', 'Banques autres États de la région', 5, 'tresorerie', false),
    ('523', 'Banques autres États de la zone monétaire', 5, 'tresorerie', false),
    ('524', 'Banques hors zone monétaire', 5, 'tresorerie', false),
    ('526', 'Banques, intérêts courus', 5, 'tresorerie', false),
    ('53', 'Établissements financiers et assimilés', 5, 'tresorerie', false),
    ('531', 'Chèques postaux', 5, 'tresorerie', false),
    ('532', 'Trésor', 5, 'tresorerie', false),
    ('533', 'Sociétés de gestion et d''intermédiation (SGI)', 5, 'tresorerie', false),
    ('538', 'Autres organismes financiers', 5, 'tresorerie', false),
    ('54', 'Instruments de trésorerie', 5, 'tresorerie', false),
    ('541', 'Options de taux d''intérêt', 5, 'tresorerie', false),
    ('542', 'Options de taux de change', 5, 'tresorerie', false),
    ('543', 'Instruments de marchés à terme', 5, 'tresorerie', false),
    ('544', 'Avoirs d''or et autres métaux précieux', 5, 'tresorerie', false),
    ('55', 'Instruments de monnaie électronique', 5, 'tresorerie', false),
    ('551', 'Porte-monnaie électronique', 5, 'tresorerie', false),
    ('552', 'Monnaie électronique — opérateurs de téléphonie (mobile money)', 5, 'tresorerie', false),
    ('558', 'Autres instruments de monnaie électronique', 5, 'tresorerie', false),
    ('56', 'Banques, crédits de trésorerie et d''escompte', 5, 'tresorerie', false),
    ('561', 'Crédits de trésorerie', 5, 'tresorerie', false),
    ('564', 'Escompte de crédits de campagne', 5, 'tresorerie', false),
    ('565', 'Escompte de crédits ordinaires', 5, 'tresorerie', false),
    ('566', 'Banques, crédits de trésorerie, intérêts courus', 5, 'tresorerie', false),
    ('57', 'Caisse', 5, 'tresorerie', false),
    ('571', 'Caisse siège social', 5, 'tresorerie', false),
    ('5711', 'Caisse siège social en unité monétaire légale', 5, 'tresorerie', false),
    ('5712', 'Caisse siège social en devises', 5, 'tresorerie', false),
    ('572', 'Caisse succursale A', 5, 'tresorerie', false),
    ('573', 'Caisse succursale B', 5, 'tresorerie', false),
    ('578', 'Autres caisses', 5, 'tresorerie', false),
    ('58', 'Régies d''avances, accréditifs et virements internes', 5, 'tresorerie', false),
    ('581', 'Régies d''avances', 5, 'tresorerie', false),
    ('582', 'Accréditifs', 5, 'tresorerie', false),
    ('585', 'Virements de fonds', 5, 'tresorerie', false),
    ('588', 'Autres virements internes', 5, 'tresorerie', false),
    ('59', 'Dépréciations et provisions pour risques à court terme (trésorerie)', 5, 'tresorerie', false),
    ('591', 'Dépréciations des titres de placement', 5, 'tresorerie', false),
    ('592', 'Dépréciations des comptes banques', 5, 'tresorerie', false),
    ('593', 'Dépréciations des comptes établissements financiers et assimilés', 5, 'tresorerie', false),
    ('594', 'Dépréciations des comptes d''instruments de trésorerie', 5, 'tresorerie', false),
    ('599', 'Provisions pour risques à caractère financier', 5, 'tresorerie', false),
    ('60', 'Achats et variations de stocks', 6, 'charge', false),
    ('601', 'Achats de marchandises', 6, 'charge', false),
    ('6011', 'Achats de marchandises dans la région', 6, 'charge', false),
    ('6012', 'Achats de marchandises hors région', 6, 'charge', false),
    ('602', 'Achats de matières premières et fournitures liées', 6, 'charge', false),
    ('603', 'Variations des stocks de biens achetés', 6, 'charge', false),
    ('6031', 'Variations des stocks de marchandises', 6, 'charge', false),
    ('6032', 'Variations des stocks de matières premières et fournitures liées', 6, 'charge', false),
    ('6033', 'Variations des stocks d''autres approvisionnements', 6, 'charge', false),
    ('604', 'Achats stockés de matières et fournitures consommables', 6, 'charge', false),
    ('605', 'Autres achats', 6, 'charge', false),
    ('6051', 'Fournitures non stockables — Eau', 6, 'charge', false),
    ('6052', 'Fournitures non stockables — Électricité', 6, 'charge', false),
    ('6053', 'Fournitures non stockables — Autres énergies', 6, 'charge', false),
    ('6054', 'Fournitures d''entretien non stockables', 6, 'charge', false),
    ('6055', 'Fournitures de bureau non stockables', 6, 'charge', false),
    ('6056', 'Achats de petit matériel et outillage', 6, 'charge', false),
    ('6057', 'Achats d''études et prestations de services', 6, 'charge', false),
    ('6058', 'Achats de travaux, matériels et équipements', 6, 'charge', false),
    ('608', 'Achats d''emballages', 6, 'charge', false),
    ('6081', 'Emballages perdus', 6, 'charge', false),
    ('6082', 'Emballages récupérables non identifiables', 6, 'charge', false),
    ('6083', 'Emballages à usage mixte', 6, 'charge', false),
    ('609', 'Rabais, remises et ristournes obtenus sur achats', 6, 'charge', false),
    ('61', 'Transports', 6, 'charge', false),
    ('611', 'Transports sur achats', 6, 'charge', false),
    ('612', 'Transports sur ventes', 6, 'charge', false),
    ('613', 'Transports pour le compte de tiers', 6, 'charge', false),
    ('614', 'Transports du personnel', 6, 'charge', false),
    ('616', 'Transports de plis', 6, 'charge', false),
    ('618', 'Autres frais de transport', 6, 'charge', false),
    ('62', 'Services extérieurs A', 6, 'charge', false),
    ('621', 'Sous-traitance générale', 6, 'charge', false),
    ('622', 'Locations et charges locatives', 6, 'charge', false),
    ('6221', 'Locations de terrains', 6, 'charge', false),
    ('6222', 'Locations de bâtiments', 6, 'charge', false),
    ('6223', 'Locations de matériels et outillages', 6, 'charge', false),
    ('6224', 'Malis sur emballages', 6, 'charge', false),
    ('6228', 'Autres locations et charges locatives', 6, 'charge', false),
    ('623', 'Redevances de location acquisition', 6, 'charge', false),
    ('624', 'Entretien, réparations et maintenance', 6, 'charge', false),
    ('6241', 'Entretien et réparations des biens immobiliers', 6, 'charge', false),
    ('6242', 'Entretien et réparations des biens mobiliers', 6, 'charge', false),
    ('6243', 'Maintenance', 6, 'charge', false),
    ('625', 'Primes d''assurance', 6, 'charge', false),
    ('6251', 'Assurances multirisques', 6, 'charge', false),
    ('6252', 'Assurances matériel de transport', 6, 'charge', false),
    ('6253', 'Assurances risques d''exploitation', 6, 'charge', false),
    ('6254', 'Assurances responsabilité du producteur', 6, 'charge', false),
    ('6255', 'Assurances insolvabilité clients', 6, 'charge', false),
    ('626', 'Études, recherches et documentation', 6, 'charge', false),
    ('627', 'Publicité, publications, relations publiques', 6, 'charge', false),
    ('628', 'Frais de télécommunications', 6, 'charge', false),
    ('6281', 'Frais de téléphone', 6, 'charge', false),
    ('6282', 'Frais d''internet', 6, 'charge', false),
    ('6283', 'Frais de télex et de fax', 6, 'charge', false),
    ('63', 'Services extérieurs B', 6, 'charge', false),
    ('631', 'Frais bancaires', 6, 'charge', false),
    ('6311', 'Frais sur titres (achat, vente, garde)', 6, 'charge', false),
    ('6312', 'Frais sur effets', 6, 'charge', false),
    ('6315', 'Commissions et frais sur virements', 6, 'charge', false),
    ('632', 'Rémunérations d''intermédiaires et de conseils', 6, 'charge', false),
    ('6321', 'Commissions et courtages sur achats', 6, 'charge', false),
    ('6322', 'Commissions et courtages sur ventes', 6, 'charge', false),
    ('6324', 'Honoraires', 6, 'charge', false),
    ('6325', 'Frais d''actes et de contentieux', 6, 'charge', false),
    ('633', 'Frais de formation du personnel', 6, 'charge', false),
    ('634', 'Redevances pour brevets, licences, logiciels et droits similaires', 6, 'charge', false),
    ('635', 'Cotisations', 6, 'charge', false),
    ('636', 'Frais de recherche de fonds', 6, 'charge', true),
    ('637', 'Rémunérations de personnel extérieur', 6, 'charge', false),
    ('638', 'Autres charges externes', 6, 'charge', false),
    ('6381', 'Frais de recrutement du personnel', 6, 'charge', false),
    ('6382', 'Frais de déménagement', 6, 'charge', false),
    ('6383', 'Réceptions', 6, 'charge', false),
    ('6384', 'Missions', 6, 'charge', false),
    ('6385', 'Réceptions et frais de représentation', 6, 'charge', false),
    ('64', 'Impôts et taxes', 6, 'charge', false),
    ('641', 'Impôts et taxes directs', 6, 'charge', false),
    ('6411', 'Impôts fonciers et taxes annexes', 6, 'charge', false),
    ('6412', 'Patentes, licences et taxes annexes', 6, 'charge', false),
    ('6413', 'Taxes sur appointements et salaires', 6, 'charge', false),
    ('6414', 'Taxes d''apprentissage', 6, 'charge', false),
    ('6415', 'Formation professionnelle continue', 6, 'charge', false),
    ('645', 'Impôts et taxes indirects', 6, 'charge', false),
    ('646', 'Droits d''enregistrement', 6, 'charge', false),
    ('6461', 'Droits de mutation', 6, 'charge', false),
    ('6462', 'Droits de timbre', 6, 'charge', false),
    ('6463', 'Taxes sur les véhicules de société', 6, 'charge', false),
    ('647', 'Pénalités et amendes fiscales', 6, 'charge', false),
    ('648', 'Autres impôts et taxes', 6, 'charge', false),
    ('65', 'Autres charges', 6, 'charge', false),
    ('651', 'Pertes sur créances clients et autres débiteurs', 6, 'charge', false),
    ('652', 'Subventions versées par l''entité', 6, 'charge', true),
    ('653', 'Quote-part de résultat annulée sur exécution partielle de contrats pluri-exercices', 6, 'charge', false),
    ('654', 'Dons en nature courants à distribuer', 6, 'charge', true),
    ('658', 'Charges diverses', 6, 'charge', false),
    ('659', 'Charges pour dépréciations et provisions pour risques à court terme', 6, 'charge', false),
    ('66', 'Charges de personnel', 6, 'charge', false),
    ('661', 'Rémunérations directes versées au personnel national', 6, 'charge', false),
    ('6611', 'Appointements, salaires et commissions', 6, 'charge', false),
    ('6612', 'Primes et gratifications', 6, 'charge', false),
    ('6613', 'Congés payés', 6, 'charge', false),
    ('6614', 'Indemnités de préavis, de licenciement et de recherche d''embauche', 6, 'charge', false),
    ('6615', 'Indemnités de maladie versées aux travailleurs', 6, 'charge', false),
    ('662', 'Rémunérations directes versées au personnel non national', 6, 'charge', false),
    ('663', 'Indemnités forfaitaires versées au personnel', 6, 'charge', false),
    ('6631', 'Indemnités de logement', 6, 'charge', false),
    ('6632', 'Indemnités de représentation', 6, 'charge', false),
    ('6633', 'Indemnités d''expatriation', 6, 'charge', false),
    ('664', 'Charges sociales', 6, 'charge', false),
    ('6641', 'Charges sociales sur rémunération du personnel national', 6, 'charge', false),
    ('6642', 'Charges sociales sur rémunération du personnel non national', 6, 'charge', false),
    ('666', 'Rémunération et charges sociales de l''exploitant individuel', 6, 'charge', false),
    ('667', 'Rémunération transférée de personnel extérieur', 6, 'charge', false),
    ('668', 'Autres charges sociales', 6, 'charge', false),
    ('67', 'Frais financiers et charges assimilées', 6, 'charge', false),
    ('671', 'Intérêts des emprunts', 6, 'charge', false),
    ('672', 'Intérêts dans loyers de location acquisition', 6, 'charge', false),
    ('673', 'Escomptes accordés', 6, 'charge', false),
    ('674', 'Autres intérêts', 6, 'charge', false),
    ('6741', 'Intérêts sur emprunts et dettes auprès des établissements de crédit', 6, 'charge', false),
    ('6742', 'Intérêts sur comptes courants d''associés', 6, 'charge', false),
    ('675', 'Escomptes des effets de commerce', 6, 'charge', false),
    ('676', 'Pertes de change', 6, 'charge', false),
    ('677', 'Pertes sur titres de placement', 6, 'charge', false),
    ('678', 'Pertes sur risques financiers', 6, 'charge', false),
    ('679', 'Charges pour dépréciations et provisions financières', 6, 'charge', false),
    ('68', 'Dotations aux amortissements', 6, 'charge', false),
    ('681', 'Dotations aux amortissements d''exploitation', 6, 'charge', false),
    ('6812', 'Dotations aux amortissements des immobilisations incorporelles', 6, 'charge', false),
    ('6813', 'Dotations aux amortissements des immobilisations corporelles', 6, 'charge', false),
    ('687', 'Dotations aux amortissements à caractère financier', 6, 'charge', false),
    ('69', 'Dotations aux provisions et aux dépréciations', 6, 'charge', false),
    ('691', 'Dotations aux provisions et dépréciations d''exploitation', 6, 'charge', false),
    ('6911', 'Dotations aux provisions pour risques et charges', 6, 'charge', false),
    ('6913', 'Dotations aux dépréciations des immobilisations', 6, 'charge', false),
    ('6914', 'Dotations aux dépréciations des stocks', 6, 'charge', false),
    ('6915', 'Dotations aux dépréciations des comptes de tiers', 6, 'charge', false),
    ('697', 'Dotations aux provisions et dépréciations financières', 6, 'charge', false),
    ('70', 'Revenus', 7, 'produit', true),
    ('701', 'Cotisations des adhérents', 7, 'produit', true),
    ('702', 'Quote-part de fonds d''administration transférés', 7, 'produit', true),
    ('703', 'Quote-part de dotation consomptible transférée', 7, 'produit', true),
    ('704', 'Revenus liés à la générosité', 7, 'produit', true),
    ('7041', 'Dons', 7, 'produit', true),
    ('7042', 'Legs', 7, 'produit', true),
    ('7043', 'Deniers du culte', 7, 'produit', true),
    ('7044', 'Zakat, dîme, quête et assimilés', 7, 'produit', true),
    ('7045', 'Célébrations', 7, 'produit', true),
    ('7046', 'Mécénats', 7, 'produit', true),
    ('7047', 'Parrainages', 7, 'produit', true),
    ('7048', 'Autres revenus liés à la générosité', 7, 'produit', true),
    ('705', 'Ventes de marchandises, services et produits finis', 7, 'produit', true),
    ('706', 'Revenus des manifestations', 7, 'produit', true),
    ('707', 'Produits accessoires', 7, 'produit', true),
    ('708', 'Autres revenus', 7, 'produit', true),
    ('71', 'Subventions d''exploitation', 7, 'produit', true),
    ('711', 'Subventions d''exploitation versées par l''État et les collectivités publiques', 7, 'produit', true),
    ('713', 'Subventions d''exploitation versées par les organismes nationaux et internationaux', 7, 'produit', true),
    ('718', 'Autres subventions d''exploitation', 7, 'produit', true),
    ('72', 'Production immobilisée', 7, 'produit', false),
    ('721', 'Immobilisations incorporelles', 7, 'produit', false),
    ('722', 'Immobilisations corporelles', 7, 'produit', false),
    ('726', 'Immobilisations financières', 7, 'produit', false),
    ('73', 'Variations des stocks de biens et de services produits', 7, 'produit', false),
    ('734', 'Variations des stocks de produits en cours', 7, 'produit', false),
    ('735', 'Variations des en-cours de services', 7, 'produit', false),
    ('736', 'Variations des stocks de produits finis', 7, 'produit', false),
    ('737', 'Variations des stocks de produits intermédiaires et résiduels', 7, 'produit', false),
    ('75', 'Autres produits', 7, 'produit', true),
    ('751', 'Profits sur créances adhérents, clients-usagers et autres débiteurs', 7, 'produit', true),
    ('752', 'Contribution du fondateur', 7, 'produit', true),
    ('754', 'Dons en nature courants', 7, 'produit', true),
    ('758', 'Produits divers', 7, 'produit', true),
    ('77', 'Revenus financiers et produits assimilés', 7, 'produit', false),
    ('771', 'Intérêts de prêts', 7, 'produit', false),
    ('772', 'Revenus de participations', 7, 'produit', false),
    ('773', 'Escomptes obtenus', 7, 'produit', false),
    ('774', 'Revenus de titres de placement', 7, 'produit', false),
    ('776', 'Gains de change', 7, 'produit', false),
    ('777', 'Gains sur cessions de titres de placement', 7, 'produit', false),
    ('778', 'Gains sur risques financiers', 7, 'produit', false),
    ('779', 'Reprises de charges pour dépréciations et provisions financières', 7, 'produit', false),
    ('78', 'Transferts de charges', 7, 'produit', false),
    ('781', 'Transferts de charges d''exploitation', 7, 'produit', false),
    ('787', 'Transferts de charges financières', 7, 'produit', false),
    ('79', 'Reprises de provisions, de dépréciations et autres', 7, 'produit', true),
    ('791', 'Reprises de provisions et dépréciations d''exploitation', 7, 'produit', true),
    ('792', 'Reprises de fonds affectés et provenant de legs d''immobilisations', 7, 'produit', true),
    ('7925', 'Reprises de fonds affectés à un projet spécifique', 7, 'produit', true),
    ('797', 'Reprises de provisions et dépréciations financières', 7, 'produit', true),
    ('798', 'Reprises d''amortissements', 7, 'produit', true),
    ('799', 'Reprises de subventions d''investissement', 7, 'produit', true),
    ('81', 'Valeurs comptables des cessions d''immobilisations', 8, 'hors_activites_ordinaires', false),
    ('811', 'Immobilisations incorporelles', 8, 'hors_activites_ordinaires', false),
    ('812', 'Immobilisations corporelles', 8, 'hors_activites_ordinaires', false),
    ('816', 'Immobilisations financières', 8, 'hors_activites_ordinaires', false),
    ('82', 'Produits des cessions d''immobilisations', 8, 'hors_activites_ordinaires', false),
    ('821', 'Immobilisations incorporelles', 8, 'hors_activites_ordinaires', false),
    ('822', 'Immobilisations corporelles', 8, 'hors_activites_ordinaires', false),
    ('826', 'Immobilisations financières', 8, 'hors_activites_ordinaires', false),
    ('83', 'Charges hors activités ordinaires', 8, 'hors_activites_ordinaires', false),
    ('831', 'Charges HAO constatées', 8, 'hors_activites_ordinaires', false),
    ('834', 'Pertes sur créances HAO', 8, 'hors_activites_ordinaires', false),
    ('835', 'Dons et libéralités accordés', 8, 'hors_activites_ordinaires', false),
    ('836', 'Abandons de créances consentis', 8, 'hors_activites_ordinaires', false),
    ('839', 'Charges pour provisions et dépréciations HAO', 8, 'hors_activites_ordinaires', false),
    ('84', 'Produits hors activités ordinaires', 8, 'hors_activites_ordinaires', false),
    ('841', 'Produits HAO constatés', 8, 'hors_activites_ordinaires', false),
    ('842', 'Contributions volontaires en nature', 8, 'hors_activites_ordinaires', true),
    ('843', 'Contributions volontaires en numéraire', 8, 'hors_activites_ordinaires', true),
    ('845', 'Dons et libéralités obtenus', 8, 'hors_activites_ordinaires', false),
    ('846', 'Abandons de créances obtenus', 8, 'hors_activites_ordinaires', false),
    ('848', 'Transferts de charges HAO', 8, 'hors_activites_ordinaires', false),
    ('849', 'Reprises de provisions et dépréciations HAO', 8, 'hors_activites_ordinaires', false),
    ('85', 'Dotations hors activités ordinaires', 8, 'hors_activites_ordinaires', false),
    ('851', 'Dotations aux provisions réglementées', 8, 'hors_activites_ordinaires', false),
    ('852', 'Dotations aux amortissements HAO', 8, 'hors_activites_ordinaires', false),
    ('853', 'Dotations aux provisions pour risques et charges HAO', 8, 'hors_activites_ordinaires', false),
    ('854', 'Dotations aux dépréciations HAO', 8, 'hors_activites_ordinaires', false),
    ('858', 'Autres dotations HAO', 8, 'hors_activites_ordinaires', false),
    ('86', 'Reprises hors activités ordinaires', 8, 'hors_activites_ordinaires', false),
    ('861', 'Reprises de provisions réglementées', 8, 'hors_activites_ordinaires', false),
    ('862', 'Reprises d''amortissements HAO', 8, 'hors_activites_ordinaires', false),
    ('863', 'Reprises de provisions pour risques et charges HAO', 8, 'hors_activites_ordinaires', false),
    ('865', 'Reprises de dépréciations HAO', 8, 'hors_activites_ordinaires', false),
    ('87', 'Participation des travailleurs', 8, 'hors_activites_ordinaires', false),
    ('871', 'Participation légale aux bénéfices', 8, 'hors_activites_ordinaires', false),
    ('878', 'Autres participations', 8, 'hors_activites_ordinaires', false),
    ('88', 'Subventions d''équilibre', 8, 'hors_activites_ordinaires', true),
    ('881', 'Subventions d''équilibre — État', 8, 'hors_activites_ordinaires', true),
    ('884', 'Subventions d''équilibre — collectivités publiques', 8, 'hors_activites_ordinaires', true),
    ('888', 'Autres subventions d''équilibre', 8, 'hors_activites_ordinaires', true),
    ('89', 'Impôts sur le résultat', 8, 'hors_activites_ordinaires', false),
    ('891', 'Impôts sur les bénéfices de l''exercice', 8, 'hors_activites_ordinaires', false),
    ('892', 'Rappel d''impôts sur résultats antérieurs', 8, 'hors_activites_ordinaires', false),
    ('895', 'Impôt minimum forfaitaire (IMF)', 8, 'hors_activites_ordinaires', false),
    ('899', 'Dégrèvements et annulations d''impôts sur résultats antérieurs', 8, 'hors_activites_ordinaires', false),
    ('90', 'Emplois des contributions volontaires en nature', 9, NULL::text, true),
    ('900', 'Secours en nature', 9, NULL::text, true),
    ('901', 'Mises à disposition gratuite de biens', 9, NULL::text, true),
    ('902', 'Prestations en nature', 9, NULL::text, true),
    ('904', 'Personnel bénévole', 9, NULL::text, true),
    ('91', 'Contributions volontaires en nature', 9, NULL::text, true),
    ('910', 'Dons en nature', 9, NULL::text, true),
    ('911', 'Prestations en nature reçues', 9, NULL::text, true),
    ('914', 'Bénévolat', 9, NULL::text, true),
    ('93', 'Comptes de reclassements', 9, NULL::text, true),
    ('94', 'Comptes de coûts', 9, NULL::text, true),
    ('95', 'Comptes de stocks (comptabilité analytique)', 9, NULL::text, true),
    ('96', 'Comptes d''écarts sur coûts préétablis', 9, NULL::text, true),
    ('98', 'Comptes de résultats analytiques', 9, NULL::text, true),
    ('99', 'Comptes de liaisons internes', 9, NULL::text, true)
  ) AS v(compte, intitule, classe, nature, specifique)
ON CONFLICT (referentiel, compte) DO NOTHING;

-- ── 2. Colonnes ────────────────────────────────────────────────────────────
ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS plan_referentiel TEXT NOT NULL DEFAULT 'SYSCOHADA';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tenants_plan_referentiel') THEN
    ALTER TABLE tenants ADD CONSTRAINT ck_tenants_plan_referentiel
      CHECK (plan_referentiel IN ('SYSCOHADA', 'SYCEBNL'));
  END IF;
END $$;

ALTER TABLE plan_comptable_client
    ADD COLUMN IF NOT EXISTS referentiel          TEXT NOT NULL DEFAULT 'SYSCOHADA',
    ADD COLUMN IF NOT EXISTS statut_avant_bascule TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_pcc_referentiel') THEN
    ALTER TABLE plan_comptable_client ADD CONSTRAINT ck_pcc_referentiel
      CHECK (referentiel IN ('SYSCOHADA', 'SYCEBNL'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS plan_bascules (
    id          BIGSERIAL PRIMARY KEY,
    tenant_id   UUID  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    de          TEXT  NOT NULL,
    vers        TEXT  NOT NULL,
    user_id     UUID  REFERENCES users(id) ON DELETE SET NULL,
    resume      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_plan_bascules_tenant ON plan_bascules (tenant_id, created_at DESC);

-- ── 3. Règle forme juridique → référentiel ────────────────────────────────
CREATE OR REPLACE FUNCTION plan_referentiel_de_forme(p_forme TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN upper(btrim(coalesce(p_forme, ''))) IN ('ASSOC', 'ONG') THEN 'SYCEBNL' ELSE 'SYSCOHADA' END;
$$;

-- Comptes d'un référentiel, sous une forme commune.
--   SYSCOHADA : instantané de la version publiée du modèle (020), hors archivés.
--   SYCEBNL   : référentiel embarqué ci-dessus.
CREATE OR REPLACE FUNCTION plan_referentiel_source(p_ref TEXT)
RETURNS TABLE (compte TEXT, intitule TEXT, description TEXT, classe INTEGER, nature TEXT,
               statut TEXT, modele_compte_id BIGINT, modele_version_id INTEGER)
LANGUAGE sql STABLE AS $$
  SELECT s.compte, s.intitule, s.description, s.classe, s.nature, s.statut, s.compte_id, s.version_id
    FROM plan_modele_version_comptes s
   WHERE p_ref = 'SYSCOHADA'
     AND s.version_id = (SELECT id FROM plan_modele_versions WHERE statut = 'publiee' LIMIT 1)
     AND s.statut <> 'archive'
  UNION ALL
  SELECT r.compte, r.intitule, '', r.classe, r.nature, 'actif', NULL::bigint, NULL::integer
    FROM plan_referentiel_comptes r
   WHERE p_ref = 'SYCEBNL' AND r.referentiel = 'SYCEBNL' AND r.actif;
$$;

-- ── 5. Initialisation d'un client (remplace la version de la 020) ──────────
CREATE OR REPLACE FUNCTION plan_client_initialiser(
  p_tenant  UUID,
  p_version INTEGER DEFAULT NULL,
  p_user    UUID    DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  v_ref     TEXT;
  v_version INTEGER;
  v_nb      INTEGER;
  v_custom  INTEGER;
BEGIN
  SELECT plan_referentiel INTO v_ref FROM tenants WHERE id = p_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client % introuvable.', p_tenant;
  END IF;

  IF EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant AND plan_initialise_le IS NOT NULL)
     OR EXISTS (SELECT 1 FROM plan_comptable_client WHERE tenant_id = p_tenant) THEN
    RETURN 0;
  END IF;

  IF v_ref = 'SYCEBNL' THEN
    IF NOT EXISTS (SELECT 1 FROM plan_referentiel_comptes WHERE referentiel = 'SYCEBNL' AND actif) THEN
      RAISE EXCEPTION 'Référentiel SYCEBNL absent : appliquez la migration 060.';
    END IF;
    INSERT INTO plan_comptable_client
           (tenant_id, compte, intitule, classe, nature, origine, referentiel, statut, created_by)
    SELECT p_tenant, r.compte, r.intitule, r.classe, r.nature, 'modele', 'SYCEBNL', 'actif', p_user
      FROM plan_referentiel_comptes r
     WHERE r.referentiel = 'SYCEBNL' AND r.actif;
    GET DIAGNOSTICS v_nb = ROW_COUNT;
    v_version := (SELECT id FROM plan_modele_versions WHERE statut = 'publiee' LIMIT 1);
  ELSE
    v_version := COALESCE(p_version,
                          (SELECT id FROM plan_modele_versions WHERE statut = 'publiee' LIMIT 1));
    IF v_version IS NULL THEN
      RAISE EXCEPTION 'Aucune version publiée du modèle de plan comptable.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM plan_modele_versions WHERE id = v_version AND statut <> 'brouillon') THEN
      RAISE EXCEPTION 'Version % du modèle introuvable ou non publiée.', v_version;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM plan_modele_version_comptes WHERE version_id = v_version) THEN
      RAISE EXCEPTION 'La version % du modèle ne contient aucun compte.', v_version;
    END IF;
    INSERT INTO plan_comptable_client
           (tenant_id, compte, intitule, description, classe, nature,
            origine, referentiel, modele_compte_id, modele_version_id, statut, created_by)
    SELECT p_tenant, s.compte, s.intitule, s.description, s.classe, s.nature,
           'modele', 'SYSCOHADA', s.compte_id, v_version, s.statut, p_user
      FROM plan_modele_version_comptes s
     WHERE s.version_id = v_version
       AND s.statut <> 'archive';
    GET DIAGNOSTICS v_nb = ROW_COUNT;
  END IF;

  -- Anciens comptes « custom » ajoutés par un utilisateur de CE client.
  INSERT INTO plan_comptable_client
         (tenant_id, compte, intitule, classe, nature, origine, referentiel, statut, created_by, created_at)
  SELECT p_tenant, m.compte, m.intitule, m.classe, m.nature, 'client', COALESCE(v_ref, 'SYSCOHADA'),
         CASE WHEN m.actif THEN 'actif' ELSE 'inactif' END, m.created_by, m.created_at
    FROM plan_comptable_syscohada m
    JOIN users u ON u.id = m.created_by AND u.tenant_id = p_tenant
   WHERE m.source = 'custom'
  ON CONFLICT (tenant_id, lower(btrim(compte))) DO NOTHING;
  GET DIAGNOSTICS v_custom = ROW_COUNT;

  UPDATE plan_comptable_client c
     SET parent_id = (
           SELECT q.id FROM plan_comptable_client q
            WHERE q.tenant_id = c.tenant_id
              AND length(q.compte) < length(c.compte)
              AND c.compte LIKE q.compte || '%'
            ORDER BY length(q.compte) DESC
            LIMIT 1)
   WHERE c.tenant_id = p_tenant;

  UPDATE tenants
     SET plan_modele_version_id = v_version,
         plan_initialise_le     = NOW(),
         plan_derniere_modif    = NOW()
   WHERE id = p_tenant;

  INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, nouvelle_valeur)
  VALUES (p_tenant, p_user, 'INIT_PLAN_COMPTABLE', 'plan_comptable_client', p_tenant::text,
          jsonb_build_object('referentiel', COALESCE(v_ref, 'SYSCOHADA'), 'version_id', v_version,
                             'comptes_modele', v_nb, 'comptes_client_repris', v_custom));

  RETURN v_nb + v_custom;
END $$;

-- ── 4. Bascule du plan d'un client ─────────────────────────────────────────
-- Renvoie un JSON :
--   { de, vers, simulation, initialisation, ajoutes, renommes, reactives,
--     archives, conserves_utilises: [{compte, intitule}],
--     renommes_utilises: [{compte, avant, apres}], additifs_conserves, inchanges }
CREATE OR REPLACE FUNCTION plan_client_basculer(
  p_tenant  UUID,
  p_cible   TEXT,
  p_user    UUID    DEFAULT NULL,
  p_simuler BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  v_de        TEXT;
  v_init      TIMESTAMPTZ;
  v_ajoutes   INTEGER := 0;
  v_renommes  INTEGER := 0;
  v_reactives INTEGER := 0;
  v_archives  INTEGER := 0;
  v_additifs  INTEGER := 0;
  v_inchanges INTEGER := 0;
  v_conserves JSONB   := '[]'::jsonb;
  v_ren_util  JSONB   := '[]'::jsonb;
  v_res       JSONB;
  v_n         INTEGER;
BEGIN
  IF p_cible NOT IN ('SYSCOHADA', 'SYCEBNL') THEN
    RAISE EXCEPTION 'Référentiel inconnu : %.', p_cible USING ERRCODE = 'check_violation';
  END IF;

  SELECT plan_referentiel, plan_initialise_le INTO v_de, v_init
    FROM tenants WHERE id = p_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client % introuvable.', p_tenant;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM plan_referentiel_source(p_cible)) THEN
    RAISE EXCEPTION 'Le référentiel % ne contient aucun compte publié.', p_cible;
  END IF;

  -- Client sans plan propre : il suffit de fixer le référentiel puis d'initialiser.
  IF v_init IS NULL AND NOT EXISTS (SELECT 1 FROM plan_comptable_client WHERE tenant_id = p_tenant) THEN
    SELECT COUNT(*) INTO v_n FROM plan_referentiel_source(p_cible);
    IF NOT p_simuler THEN
      UPDATE tenants SET plan_referentiel = p_cible WHERE id = p_tenant;
      v_n := plan_client_initialiser(p_tenant, NULL, p_user);
    END IF;
    v_res := jsonb_build_object('de', v_de, 'vers', p_cible, 'simulation', p_simuler,
               'initialisation', true, 'ajoutes', v_n, 'renommes', 0, 'reactives', 0, 'archives', 0,
               'conserves_utilises', '[]'::jsonb, 'renommes_utilises', '[]'::jsonb, 'additifs_conserves', 0, 'inchanges', 0);
    IF NOT p_simuler THEN
      INSERT INTO plan_bascules (tenant_id, de, vers, user_id, resume) VALUES (p_tenant, v_de, p_cible, p_user, v_res);
    END IF;
    RETURN v_res;
  END IF;

  -- ── Aperçu (toujours calculé) ──
  CREATE TEMP TABLE IF NOT EXISTS _bascule_src (compte TEXT, cle TEXT, intitule TEXT, description TEXT, classe INTEGER,
      nature TEXT, statut TEXT, modele_compte_id BIGINT, modele_version_id INTEGER) ON COMMIT DROP;
  TRUNCATE _bascule_src;
  INSERT INTO _bascule_src
  SELECT s.compte, lower(btrim(s.compte)), s.intitule, s.description, s.classe, s.nature, s.statut,
         s.modele_compte_id, s.modele_version_id
    FROM plan_referentiel_source(p_cible) s;

  -- a) à ajouter : numéro absent du plan du client
  SELECT COUNT(*) INTO v_ajoutes FROM _bascule_src s
   WHERE NOT EXISTS (SELECT 1 FROM plan_comptable_client c
                      WHERE c.tenant_id = p_tenant AND lower(btrim(c.compte)) = s.cle);
  -- b) même numéro, compte du modèle : libellé repris (sauf personnalisé)
  SELECT COUNT(*) FILTER (WHERE NOT c.personnalise AND c.intitule IS DISTINCT FROM s.intitule),
         COUNT(*) FILTER (WHERE c.statut = 'archive' AND c.statut_avant_bascule IS NOT NULL),
         COUNT(*) FILTER (WHERE (c.personnalise OR c.intitule IS NOT DISTINCT FROM s.intitule)
                            AND NOT (c.statut = 'archive' AND c.statut_avant_bascule IS NOT NULL))
    INTO v_renommes, v_reactives, v_inchanges
    FROM _bascule_src s
    JOIN plan_comptable_client c ON c.tenant_id = p_tenant AND lower(btrim(c.compte)) = s.cle
   WHERE c.origine = 'modele';
  -- b') parmi eux, comptes UTILISÉS dont le libellé change : signalés à l'aperçu
  SELECT COALESCE(jsonb_agg(jsonb_build_object('compte', c.compte, 'avant', c.intitule, 'apres', s.intitule) ORDER BY c.compte), '[]'::jsonb)
    INTO v_ren_util
    FROM _bascule_src s
    JOIN plan_comptable_client c ON c.tenant_id = p_tenant AND lower(btrim(c.compte)) = s.cle
   WHERE c.origine = 'modele' AND NOT c.personnalise AND c.intitule IS DISTINCT FROM s.intitule
     AND plan_client_est_utilise(p_tenant, c.compte);
  -- c) comptes additifs du client de même numéro : conservés tels quels
  SELECT COUNT(*) INTO v_additifs FROM plan_comptable_client c
   WHERE c.tenant_id = p_tenant AND c.origine = 'client';
  -- d) comptes du modèle absents du référentiel cible : archivés sauf utilisés
  SELECT COUNT(*) FILTER (WHERE NOT plan_client_est_utilise(p_tenant, c.compte)),
         COALESCE(jsonb_agg(jsonb_build_object('compte', c.compte, 'intitule', c.intitule) ORDER BY c.compte)
                  FILTER (WHERE plan_client_est_utilise(p_tenant, c.compte)), '[]'::jsonb)
    INTO v_archives, v_conserves
    FROM plan_comptable_client c
   WHERE c.tenant_id = p_tenant AND c.origine = 'modele' AND c.statut <> 'archive'
     AND NOT EXISTS (SELECT 1 FROM _bascule_src s WHERE s.cle = lower(btrim(c.compte)));

  v_res := jsonb_build_object('de', v_de, 'vers', p_cible, 'simulation', p_simuler, 'initialisation', false,
             'ajoutes', v_ajoutes, 'renommes', v_renommes, 'reactives', v_reactives, 'archives', v_archives,
             'conserves_utilises', v_conserves, 'renommes_utilises', v_ren_util,
             'additifs_conserves', v_additifs, 'inchanges', v_inchanges);

  IF p_simuler THEN
    RETURN v_res;
  END IF;

  -- ── Application ──
  -- d) archivage d'abord (le trigger 019 autorise le changement de statut).
  UPDATE plan_comptable_client c
     SET statut_avant_bascule = c.statut, statut = 'archive'
   WHERE c.tenant_id = p_tenant AND c.origine = 'modele' AND c.statut <> 'archive'
     AND NOT EXISTS (SELECT 1 FROM _bascule_src s WHERE s.cle = lower(btrim(c.compte)))
     AND NOT plan_client_est_utilise(p_tenant, c.compte);

  -- b) comptes du modèle de même numéro : rattachés au nouveau référentiel.
  UPDATE plan_comptable_client c
     SET intitule          = CASE WHEN c.personnalise THEN c.intitule ELSE s.intitule END,
         description       = CASE WHEN c.personnalise THEN c.description ELSE COALESCE(s.description, '') END,
         classe            = COALESCE(s.classe, c.classe),
         nature            = COALESCE(s.nature, c.nature),
         referentiel       = p_cible,
         modele_compte_id  = s.modele_compte_id,
         modele_version_id = s.modele_version_id,
         statut            = CASE WHEN c.statut = 'archive' AND c.statut_avant_bascule IS NOT NULL
                                  THEN c.statut_avant_bascule ELSE c.statut END,
         statut_avant_bascule = NULL
    FROM _bascule_src s
   WHERE c.tenant_id = p_tenant AND c.origine = 'modele' AND lower(btrim(c.compte)) = s.cle;

  -- a) ajouts.
  INSERT INTO plan_comptable_client
         (tenant_id, compte, intitule, description, classe, nature, origine, referentiel,
          modele_compte_id, modele_version_id, statut, created_by)
  SELECT p_tenant, s.compte, s.intitule, COALESCE(s.description, ''), s.classe, s.nature, 'modele', p_cible,
         s.modele_compte_id, s.modele_version_id, s.statut, p_user
    FROM _bascule_src s
   WHERE NOT EXISTS (SELECT 1 FROM plan_comptable_client c
                      WHERE c.tenant_id = p_tenant AND lower(btrim(c.compte)) = s.cle);

  -- Parents recalculés dans le plan du client.
  UPDATE plan_comptable_client c
     SET parent_id = (
           SELECT q.id FROM plan_comptable_client q
            WHERE q.tenant_id = c.tenant_id
              AND length(q.compte) < length(c.compte)
              AND c.compte LIKE q.compte || '%'
            ORDER BY length(q.compte) DESC
            LIMIT 1)
   WHERE c.tenant_id = p_tenant;

  UPDATE tenants
     SET plan_referentiel    = p_cible,
         plan_derniere_modif = NOW(),
         plan_modele_version_id = CASE WHEN p_cible = 'SYSCOHADA'
                                       THEN (SELECT id FROM plan_modele_versions WHERE statut = 'publiee' LIMIT 1)
                                       ELSE plan_modele_version_id END
   WHERE id = p_tenant;

  INSERT INTO plan_bascules (tenant_id, de, vers, user_id, resume) VALUES (p_tenant, v_de, p_cible, p_user, v_res);
  INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, ancienne_valeur, nouvelle_valeur)
  VALUES (p_tenant, p_user, 'BASCULE_REFERENTIEL', 'plan_comptable_client', p_tenant::text,
          jsonb_build_object('referentiel', v_de), v_res);

  RETURN v_res;
END $$;
