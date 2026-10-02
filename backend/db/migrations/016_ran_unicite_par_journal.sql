-- ── 016 — RAN : unicité par JOURNAL, plus par type de caisse ──────────────
-- Le schéma d'origine imposait UNIQUE(tenant_id, mois, annee, type_caisse) :
-- un seul RAN « espèces » et un seul RAN « om » par client et par mois.
-- Depuis la 001, le RAN est porté par journal (ran_unique_journal), mais
-- l'ancienne contrainte n'a jamais été retirée : dès qu'un client a DEUX
-- caisses espèces (ou deux journaux OM/MoMo), le RAN de la seconde viole la
-- contrainte → « Erreur serveur » (500) à l'enregistrement.
--
-- Correctif : on retire toute contrainte UNIQUE portant exactement sur
-- (tenant_id, mois, annee, type_caisse), quel que soit son nom, et on la
-- remplace par un index unique PARTIEL réservé aux anciennes lignes sans
-- journal (journal_id IS NULL). Les RAN par journal restent protégés par
-- ran_unique_journal. Idempotente.

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
     WHERE rel.relname = 'ran' AND con.contype = 'u'
       AND (SELECT array_agg(att.attname::text ORDER BY att.attname)
              FROM unnest(con.conkey) k
              JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k)
           = ARRAY['annee','mois','tenant_id','type_caisse']
  LOOP
    EXECUTE format('ALTER TABLE ran DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ran_unique_sans_journal
    ON ran(tenant_id, mois, annee, type_caisse)
    WHERE journal_id IS NULL;

-- Filet de sécurité (déjà créé par la 001 sur les bases à jour).
CREATE UNIQUE INDEX IF NOT EXISTS ran_unique_journal
    ON ran(tenant_id, mois, annee, journal_id)
    WHERE journal_id IS NOT NULL;
