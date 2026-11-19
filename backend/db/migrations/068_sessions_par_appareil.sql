-- ============================================================================
-- 068 — NJ BUSINESS : une session par TYPE d'appareil (19/11/2026)
--
--  Demande de Franck : pouvoir être connecté en même temps sur son ordinateur
--  ET sur son téléphone. La règle devient : une session active par compte et
--  par type d'appareil (« ordinateur », « mobile » = téléphone ou tablette).
--  Un deuxième ordinateur (ou un deuxième téléphone) reste refusé, avec le
--  remplacement explicite du lot D.
--
--  Réglage plateforme sessions.par_type_appareil (true par défaut) : à false,
--  retour à une seule session par compte (contrôlée par le serveur, sous verrou).
--  Additive et idempotente. Retour arrière : migrations-retour-arriere/068_retour_arriere.sql
-- ============================================================================

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS type_appareil TEXT NOT NULL DEFAULT 'ordinateur';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sessions_type_appareil') THEN
    ALTER TABLE sessions ADD CONSTRAINT ck_sessions_type_appareil CHECK (type_appareil IN ('ordinateur', 'mobile'));
  END IF;
END $$;

-- Sessions existantes : type déduit de l'appareil enregistré.
UPDATE sessions SET type_appareil = 'mobile'
 WHERE type_appareil = 'ordinateur' AND (appareil ILIKE '%Android%' OR appareil ILIKE '%iPhone%' OR appareil ILIKE '%iPad%');

-- Une session active par compte ET par type d'appareil (garantie par la base).
DROP INDEX IF EXISTS uq_sessions_une_active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sessions_active_par_type ON sessions (user_id, type_appareil) WHERE statut = 'active';

UPDATE plateforme_reglages SET valeur = valeur || '{"par_type_appareil": true}'::jsonb
 WHERE cle = 'sessions' AND NOT (valeur ? 'par_type_appareil');
