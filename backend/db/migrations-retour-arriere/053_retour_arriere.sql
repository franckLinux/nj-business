-- Retour arrière de la 053 : retire du plafond les seules permissions com.*
-- que la 053 y a ajoutées (tracées dans com_acces_053). Le changement de règle
-- des profils (permission.service.js) se défait en redéployant le code précédent.
DO $$
BEGIN
  IF to_regclass('public.com_acces_053') IS NULL THEN RETURN; END IF;
  DELETE FROM tenant_permissions tp USING com_acces_053 a
   WHERE tp.tenant_id = a.tenant_id AND tp.permission_code = a.permission_code;
  DROP TABLE com_acces_053;
END $$;
