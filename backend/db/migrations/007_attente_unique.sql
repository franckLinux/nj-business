-- ============================================================
--  Migration : Contrainte UNIQUE sur (tenant_id, mois, annee, rubrique_code)
--              pour depenses_attente et ressources_attente.
--  Idempotente — peut être exécutée plusieurs fois sans risque.
-- ============================================================

-- 1. Suppression des contraintes si elles existent déjà (idempotence)
ALTER TABLE depenses_attente   DROP CONSTRAINT IF EXISTS uq_dep_attente;
ALTER TABLE ressources_attente DROP CONSTRAINT IF EXISTS uq_res_attente;

-- 2. Déduplication préalable : on garde la ligne au plus grand id
--    pour chaque groupe (tenant_id, mois, annee, rubrique_code).
DELETE FROM depenses_attente a
  USING depenses_attente b
  WHERE a.id < b.id
    AND a.tenant_id    = b.tenant_id
    AND a.mois         = b.mois
    AND a.annee        = b.annee
    AND a.rubrique_code = b.rubrique_code;

DELETE FROM ressources_attente a
  USING ressources_attente b
  WHERE a.id < b.id
    AND a.tenant_id    = b.tenant_id
    AND a.mois         = b.mois
    AND a.annee        = b.annee
    AND a.rubrique_code = b.rubrique_code;

-- 3. Ajout des contraintes UNIQUE
ALTER TABLE depenses_attente
  ADD CONSTRAINT uq_dep_attente
  UNIQUE (tenant_id, mois, annee, rubrique_code);

ALTER TABLE ressources_attente
  ADD CONSTRAINT uq_res_attente
  UNIQUE (tenant_id, mois, annee, rubrique_code);
