-- Ajoute la colonne custom_role_id sur users pour lier un rôle métier personnalisé
ALTER TABLE users ADD COLUMN IF NOT EXISTS
  custom_role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL;
