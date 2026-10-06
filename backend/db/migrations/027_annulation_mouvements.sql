-- ── 027 — Intégrité du journal : numérotation chronologique et annulation ──
-- Décisions du 06/10/2026 :
--   * une écriture enregistrée n'est plus jamais supprimée ni modifiée dans ses
--     montants, sa date, sa rubrique ou sa caisse ;
--   * une erreur se corrige par ANNULATION : écriture de contre-passation
--     (mêmes rubrique et libellé, montants en NÉGATIF) qui neutralise l'écriture
--     fautive, puis nouvelle saisie si besoin ;
--   * la caissière DEMANDE l'annulation (motif), le directeur l'AUTORISE ou la
--     refuse ; le directeur peut aussi annuler directement ;
--   * chaque écriture porte un numéro de séquence par journal, attribué dans
--     l'ordre d'enregistrement, sans trou ni doublon.

-- 1. Colonnes ----------------------------------------------------------------
ALTER TABLE journal
  ADD COLUMN IF NOT EXISTS numero            INTEGER,
  ADD COLUMN IF NOT EXISTS annule            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS annule_par_id     BIGINT REFERENCES journal(id),
  ADD COLUMN IF NOT EXISTS annulation_de_id  BIGINT REFERENCES journal(id),
  ADD COLUMN IF NOT EXISTS motif_annulation  TEXT NOT NULL DEFAULT '';

-- Une écriture ne peut être annulée qu'une fois.
CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_annulation_de ON journal (annulation_de_id) WHERE annulation_de_id IS NOT NULL;

-- 2. Numérotation des écritures existantes (ordre d'enregistrement) ---------
WITH n AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant_id, COALESCE(journal_id, 0) ORDER BY created_at, id) AS rn
    FROM journal WHERE numero IS NULL
)
UPDATE journal j SET numero = n.rn FROM n WHERE j.id = n.id;
CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_numero ON journal (tenant_id, COALESCE(journal_id, 0), numero);

-- 3. Numéro attribué par la base à CHAQUE insertion (quel que soit l'écran) --
--    Verrou par (client, journal) : deux saisies simultanées ne peuvent pas
--    obtenir le même numéro.
CREATE OR REPLACE FUNCTION journal_numeroter() RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('journal_numero:' || NEW.tenant_id::text || ':' || COALESCE(NEW.journal_id, 0)::text));
  SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
    FROM journal WHERE tenant_id = NEW.tenant_id AND COALESCE(journal_id, 0) = COALESCE(NEW.journal_id, 0);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_journal_numeroter ON journal;
CREATE TRIGGER trg_journal_numeroter BEFORE INSERT ON journal FOR EACH ROW EXECUTE FUNCTION journal_numeroter();

-- 4. Écritures intangibles (garde-fou en base, en plus du contrôle applicatif)
--    Maintenance exceptionnelle : SET LOCAL app.journal_maintenance = 'on'.
CREATE OR REPLACE FUNCTION journal_proteger() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.journal_maintenance', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ECRITURE_INTANGIBLE: une écriture de caisse ne se supprime pas, elle s''annule.';
  END IF;
  IF NEW.entree IS DISTINCT FROM OLD.entree OR NEW.sortie IS DISTINCT FROM OLD.sortie
     OR NEW.date IS DISTINCT FROM OLD.date OR NEW.mois IS DISTINCT FROM OLD.mois OR NEW.annee IS DISTINCT FROM OLD.annee
     OR NEW.rubrique_code IS DISTINCT FROM OLD.rubrique_code OR NEW.journal_id IS DISTINCT FROM OLD.journal_id
     OR NEW.type_caisse IS DISTINCT FROM OLD.type_caisse OR NEW.numero IS DISTINCT FROM OLD.numero
     OR NEW.annulation_de_id IS DISTINCT FROM OLD.annulation_de_id
     OR (OLD.annule AND NOT NEW.annule) THEN
    RAISE EXCEPTION 'ECRITURE_INTANGIBLE: montants, date, rubrique et caisse d''une écriture ne se modifient pas ; annulez-la puis ressaisissez.';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_journal_proteger ON journal;
CREATE TRIGGER trg_journal_proteger BEFORE UPDATE OR DELETE ON journal FOR EACH ROW EXECUTE FUNCTION journal_proteger();

-- 5. Demandes d'annulation (caissière → directeur) --------------------------
CREATE TABLE IF NOT EXISTS demandes_annulation (
  id             BIGSERIAL PRIMARY KEY,
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  mouvement_id   BIGINT NOT NULL REFERENCES journal(id),
  motif          TEXT NOT NULL,
  statut         TEXT NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente','approuvee','refusee')),
  demande_par    UUID REFERENCES users(id),
  demande_le     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decide_par     UUID REFERENCES users(id),
  decide_le      TIMESTAMPTZ,
  commentaire    TEXT NOT NULL DEFAULT '',
  annulation_id  BIGINT REFERENCES journal(id)
);
-- Une seule demande en cours par écriture.
CREATE UNIQUE INDEX IF NOT EXISTS uq_demande_annulation_encours ON demandes_annulation (mouvement_id) WHERE statut = 'en_attente';
CREATE INDEX IF NOT EXISTS idx_demandes_annulation ON demandes_annulation (tenant_id, statut, demande_le DESC);

-- 6. Permissions ---------------------------------------------------------------
INSERT INTO permissions(code, nom, module, description) VALUES
  ('journal.annulation_demander', 'Demander l''annulation d''une écriture', 'journal',
   'Demander, avec un motif, l''annulation (contre-passation) d''une écriture saisie par erreur'),
  ('journal.annuler', 'Annuler une écriture', 'journal',
   'Autoriser ou refuser les demandes d''annulation, et annuler directement une écriture (contre-passation)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, v.code FROM roles r
 CROSS JOIN (VALUES ('journal.annulation_demander'), ('journal.annuler')) AS v(code)
 WHERE r.code = 'directeur' AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, 'journal.annulation_demander' FROM roles r
 WHERE r.code = 'caissier' AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;

-- Profils métier qui pouvaient modifier/supprimer : ils peuvent désormais demander l'annulation.
INSERT INTO role_permissions(role_id, permission_code)
SELECT DISTINCT rp.role_id, 'journal.annulation_demander' FROM role_permissions rp
 WHERE rp.permission_code IN ('journal.edit', 'journal.delete', 'journal.create')
ON CONFLICT DO NOTHING;

-- Profils métier qui valident les dépenses (rôle de direction) : ils
-- autorisent aussi les annulations.
INSERT INTO role_permissions(role_id, permission_code)
SELECT DISTINCT rp.role_id, 'journal.annuler' FROM role_permissions rp
 WHERE rp.permission_code = 'journal.validate'
ON CONFLICT DO NOTHING;

-- Clients avec un plafond de permissions : les nouveaux codes y sont ajoutés
-- là où la saisie était permise (sinon ils resteraient invisibles).
INSERT INTO tenant_permissions(tenant_id, permission_code)
SELECT DISTINCT tp.tenant_id, v.code FROM tenant_permissions tp
 CROSS JOIN (VALUES ('journal.annulation_demander'), ('journal.annuler')) AS v(code)
 WHERE tp.permission_code IN ('journal.create', 'journal.validate')
ON CONFLICT DO NOTHING;
