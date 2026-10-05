-- ── 017 — RAN : complément de la 016 ──────────────────────────────────────
-- La 016 retire l'ancienne unicité (tenant_id, mois, annee, type_caisse)
-- lorsqu'elle existe comme CONTRAINTE. Sur certaines bases elle a été créée
-- comme simple INDEX UNIQUE (outil d'import, recréation manuelle) : la 016 ne
-- la voit pas et la 2e caisse espèces / OM d'un client reste bloquée (500).
-- On retire ici tout index unique NON partiel portant exactement sur ces
-- quatre colonnes et qui ne soutient pas une contrainte. Idempotente.

DO $$
DECLARE i record;
BEGIN
  FOR i IN
    SELECT ic.relname AS nom
      FROM pg_index ix
      JOIN pg_class ic  ON ic.oid  = ix.indexrelid
      JOIN pg_class tbl ON tbl.oid = ix.indrelid
     WHERE tbl.relname = 'ran'
       AND ix.indisunique
       AND NOT ix.indisprimary
       AND ix.indpred IS NULL                       -- non partiel
       AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = ix.indexrelid)
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
              FROM unnest(ix.indkey::int2[]) k
              JOIN pg_attribute a ON a.attrelid = tbl.oid AND a.attnum = k)
           = ARRAY['annee','mois','tenant_id','type_caisse']
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', i.nom);
  END LOOP;
END $$;

-- Harmonise le type de caisse des RAN déjà liés à un journal avec la règle
-- du serveur (om / momo / carte prépayée → 'om', le reste → 'especes').
UPDATE ran r
   SET type_caisse = CASE WHEN j.type IN ('om','momo','carte_prepayee') THEN 'om' ELSE 'especes' END
  FROM journaux j
 WHERE r.journal_id = j.id
   AND r.type_caisse IS DISTINCT FROM
       (CASE WHEN j.type IN ('om','momo','carte_prepayee') THEN 'om' ELSE 'especes' END);
