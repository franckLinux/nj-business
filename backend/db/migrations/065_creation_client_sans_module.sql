-- ============================================================================
-- 065 — NJ BUSINESS : création d'un client sans module ; paramètres de la caisse
--       (lot B, 17/11/2026)
--
--  1. NJ CAISSE PRO n'est plus activé d'office à la création d'un client :
--     modules.par_defaut passe à false. Le déclencheur de la 048 est conservé
--     (il n'active plus que les modules marqués « par défaut », aujourd'hui aucun).
--     Les modules sont choisis à la création ou activés ensuite par le cabinet ;
--     la caisse prépare alors ses données (rubriques, journaux, plan comptable).
--  2. Les paramètres propres à la caisse ont leurs routes /api/caisse/… : elles
--     appartiennent au module NJ CAISSE PRO (bloquées s'il est désactivé).
--
--  Aucun client existant n'est modifié : ceux qui ont la caisse la gardent,
--  avec toutes leurs données. Idempotente.
--  Retour arrière : migrations-retour-arriere/065_retour_arriere.sql
-- ============================================================================

UPDATE modules SET par_defaut = false, updated_at = NOW()
 WHERE code = 'caisse' AND par_defaut;

UPDATE modules SET prefixes_api = array_append(prefixes_api, '/caisse'), updated_at = NOW()
 WHERE code = 'caisse' AND NOT ('/caisse' = ANY (prefixes_api));

-- Contrôle (bloquant) : la caisse n'est plus imposée et ses routes lui appartiennent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM modules WHERE code = 'caisse' AND (par_defaut OR NOT ('/caisse' = ANY (prefixes_api)))) THEN
    RAISE EXCEPTION '065 : le module caisse n''a pas été mis à jour.';
  END IF;
END $$;
