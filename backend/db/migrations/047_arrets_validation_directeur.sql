-- ============================================================================
-- 047 — Arrêtés de caisse : qui arrête, qui valide (décision du 26/10/2026)
--
--  • Le DIRECTEUR arrête la caisse ET valide l'arrêté (il peut valider son
--    propre arrêt : la règle « celui qui arrête ne valide pas » de la 046 est
--    retirée dans le code).
--  • Le COMPTABLE (code auditeur) et le comptable cabinet peuvent arrêter la
--    caisse (journaux.arreter), mais pas valider l'arrêté. Ils peuvent toujours
--    préparer le contrôle (solde constaté, PV scanné) avec controle.saisir.
--    (Revient sur la 015, où le comptable cabinet n'arrêtait plus les caisses.)
--  • Nouvelle permission arrets.valider : valider un arrêté sur PV scanné, ou
--    annuler cette validation (motif obligatoire). Directeur uniquement.
--
-- Les profils métier créés à partir du directeur ne reçoivent pas
-- arrets.valider automatiquement : à cocher dans Configuration → Rôles.
-- Idempotente.
-- ============================================================================

INSERT INTO permissions(code, nom, module, description) VALUES
  ('arrets.valider', 'Valider les arrêtés de caisse', 'controle',
   'Valider l''arrêté de caisse d''un journal sur PV scanné, ou annuler cette validation (motif obligatoire, tracé)')
ON CONFLICT (code) DO NOTHING;

-- Directeur : validation des arrêtés.
INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, 'arrets.valider' FROM roles r
 WHERE r.code = 'directeur' AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;

-- Comptable et comptable cabinet : arrêt de caisse.
INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, 'journaux.arreter' FROM roles r
 WHERE r.code IN ('auditeur', 'comptable_cabinet') AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;

-- Le comptable perd la validation : rien à retirer (la 046 la portait par
-- controle.saisir, que la route n'exige plus pour valider).

-- Clients ayant un plafond configuré : les nouveaux codes y sont ajoutés
-- (sinon le plafond les bloquerait).
INSERT INTO tenant_permissions(tenant_id, permission_code)
SELECT DISTINCT tp.tenant_id, v.code
  FROM tenant_permissions tp
 CROSS JOIN (VALUES ('arrets.valider'), ('journaux.arreter')) AS v(code)
ON CONFLICT DO NOTHING;
