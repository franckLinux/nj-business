-- ── Extension du catalogue de permissions ─────────────────────────────────
-- Objectif : permettre que la permission devienne la règle d'autorisation
-- unique (le rôle fixe ne servant plus que de jeu par défaut).
--
-- Deux manques bloquaient ce basculement :
--
-- 1. Un même code protégeait des routes aux exigences différentes.
--    `journal.edit` couvrait PUT /journal/:id (ouvert) ET POST /journal/ran
--    (réservé directeur/super_admin/comptable_cabinet) ; `budget.edit`
--    couvrait 4 routes dont 3 réservées. Accorder le code aurait donc donné
--    plus que l'action visée → on découpe en codes distincts.
--
-- 2. Des écrans entiers n'avaient aucun code (définition des journaux/caisses,
--    pièces justificatives, banque) : ils étaient gouvernés par le seul rôle
--    fixe et restaient donc hors de portée d'une attribution de permission.
--
-- Non couverts volontairement :
--   - arrêt de caisse : déjà gouverné par une règle d'appartenance
--     (responsable_arret du journal), pas par un rôle — un code de permission
--     y créerait une seconde source de vérité contradictoire. Seule la
--     réouverture, qui est bien une décision d'encadrement, reçoit un code.
--   - dashboard / notifications : nécessaires à tout utilisateur connecté,
--     aucun intérêt à les verrouiller.
--   - tenants / catalogue de permissions / création de profils : administration
--     du cabinet, pas une fonctionnalité client — reste sur super_admin.

INSERT INTO permissions(code, nom, module, description) VALUES
  -- Découpage de journal.edit
  ('journal.ran',              'Saisir le report à nouveau',      'journal',  'Définir le report à nouveau (solde d''ouverture) d''un journal'),

  -- Découpage de budget.edit
  ('budget.validate',          'Valider le budget',               'budget',   'Valider ou dévalider le budget d''un exercice'),
  ('budget.demande_create',    'Demander un budget',              'budget',   'Créer une demande de budget de caisse'),
  ('budget.demande_validate',  'Valider une demande de budget',   'budget',   'Approuver ou rejeter une demande de budget de caisse'),
  ('budget.demande_delete',    'Supprimer une demande de budget', 'budget',   'Supprimer une demande de budget de caisse'),

  -- Définition des journaux / caisses (module absent du catalogue)
  ('journaux.view',            'Voir les journaux définis',       'journaux', 'Consulter la liste des caisses et journaux'),
  ('journaux.edit',            'Gérer les journaux',              'journaux', 'Créer, modifier et supprimer des caisses et journaux'),
  ('journaux.reouvrir',        'Réouvrir un journal arrêté',      'journaux', 'Annuler l''arrêt de caisse d''un journal'),

  -- Pièces justificatives (module absent du catalogue)
  ('pieces.view',              'Voir les pièces justificatives',  'pieces',   'Consulter les pièces et leurs types attendus'),
  ('pieces.edit',              'Gérer les types de pièces',       'pieces',   'Définir les justificatifs attendus par rubrique'),
  ('pieces.upload',            'Joindre une pièce',               'pieces',   'Téléverser et supprimer une pièce sur un mouvement'),

  -- Banque (module absent du catalogue)
  ('banque.view',              'Voir les données bancaires',      'banque',   'Consulter le rapprochement bancaire'),
  ('banque.edit',              'Modifier les données bancaires',  'banque',   'Modifier le rapprochement bancaire')
ON CONFLICT (code) DO NOTHING;
