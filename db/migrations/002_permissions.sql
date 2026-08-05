-- ── Système de permissions ────────────────────────────────────────────────

-- Catalogue de toutes les permissions disponibles
CREATE TABLE IF NOT EXISTS permissions (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(100) UNIQUE NOT NULL,
  nom         VARCHAR(200)        NOT NULL,
  module      VARCHAR(50)         NOT NULL,
  description TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Permissions accordées à un tenant (active/désactive des fonctionnalités par client)
CREATE TABLE IF NOT EXISTS tenant_permissions (
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  permission_code VARCHAR(100) NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  granted_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tenant_id, permission_code)
);

-- Permissions accordées à un utilisateur (surcharge les permissions du tenant)
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id         UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_code VARCHAR(100) NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  granted_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, permission_code)
);

-- Seed : permissions par défaut
INSERT INTO permissions(code, nom, module, description) VALUES
  ('journal.view',         'Voir les journaux',             'journal',        'Consulter les mouvements de caisse'),
  ('journal.create',       'Créer un mouvement',            'journal',        'Ajouter un mouvement dans les journaux'),
  ('journal.edit',         'Modifier un mouvement',         'journal',        'Modifier un mouvement existant'),
  ('journal.delete',       'Supprimer un mouvement',        'journal',        'Supprimer un mouvement de caisse'),
  ('journal.validate',     'Valider un mouvement',          'journal',        'Valider ou invalider un mouvement'),
  ('budget.view',          'Voir le suivi budgétaire',      'budget',         'Consulter le tableau de suivi budgétaire'),
  ('budget.edit',          'Modifier le budget',            'budget',         'Modifier les dotations budgétaires'),
  ('previsions.view',      'Voir les prévisions',           'previsions',     'Consulter les prévisions de fonds'),
  ('previsions.edit',      'Saisir les prévisions',         'previsions',     'Saisir les prévisions budgétaires mensuelles'),
  ('appel_fonds.view',     'Voir les appels de fonds',      'appel_fonds',    'Consulter les appels de fonds'),
  ('appel_fonds.create',   'Créer un appel de fonds',       'appel_fonds',    'Créer un nouvel appel de fonds'),
  ('appel_fonds.validate', 'Valider un appel de fonds',     'appel_fonds',    'Approuver ou rejeter un appel de fonds'),
  ('appel_fonds.delete',   'Supprimer un appel de fonds',   'appel_fonds',    'Supprimer un appel de fonds'),
  ('rubriques.view',       'Voir les rubriques',            'rubriques',      'Consulter la liste des rubriques'),
  ('rubriques.edit',       'Gérer les rubriques',           'rubriques',      'Créer, modifier et supprimer des rubriques'),
  ('users.view',           'Voir les utilisateurs',         'users',          'Consulter la liste des utilisateurs'),
  ('users.create',         'Créer un utilisateur',          'users',          'Ajouter un nouvel utilisateur'),
  ('users.edit',           'Modifier un utilisateur',       'users',          'Modifier un utilisateur existant'),
  ('users.delete',         'Supprimer un utilisateur',      'users',          'Supprimer un utilisateur'),
  ('config.view',          'Voir la configuration',         'config',         'Consulter la configuration du cabinet'),
  ('config.edit',          'Modifier la configuration',     'config',         'Modifier les paramètres du cabinet'),
  ('rapport.view',         'Voir les rapports',             'rapport',        'Consulter le compte d''emploi et les synthèses'),
  ('rapport.export',       'Exporter les rapports',         'rapport',        'Exporter les rapports en PDF/Excel'),
  ('plan_comptable.view',  'Voir le plan comptable',        'plan_comptable', 'Consulter le plan comptable SYSCOHADA'),
  ('plan_comptable.edit',  'Gérer le plan comptable',       'plan_comptable', 'Ajouter et supprimer des comptes')
ON CONFLICT (code) DO NOTHING;
