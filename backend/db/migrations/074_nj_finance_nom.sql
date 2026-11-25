-- ============================================================================
-- 074 — NJ FINANCE, lot F1 : le module NJ CAISSE PRO s'affiche « NJ FINANCE »
--      (dossier claude/NJ_FINANCE_AUDIT_ARCHITECTURE.md, décisions du 25/11/2026)
--
--  Seuls le NOM et la DESCRIPTION de la carte du module changent. Le code
--  technique reste « caisse » : droits, sessions, user_modules, tenant_modules
--  et préfixes d'API sont inchangés.
--
--  Aucune table, colonne ou contrainte n'est créée, modifiée ou supprimée.
--  Aucune donnée de caisse n'est touchée. Idempotente.
--  Retour arrière : db/migrations-retour-arriere/074_retour_arriere.sql
-- ============================================================================

UPDATE modules
   SET nom = 'NJ FINANCE',
       description = 'Gestion financière : caisse, gestion d''activité, contrôle comptable et états financiers',
       updated_at = NOW()
 WHERE code = 'caisse'
   AND (nom IS DISTINCT FROM 'NJ FINANCE'
        OR description IS DISTINCT FROM 'Gestion financière : caisse, gestion d''activité, contrôle comptable et états financiers');
