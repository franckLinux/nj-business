-- ── 037 — Passerelle comptable, lot 1 : paramétrage (octobre 2026) ─────────
--  Réforme « Passerelle comptable » (CDC M06) : chaque mouvement de caisse
--  deviendra une écriture équilibrée exportable (CSV puis SAGE i7). Ce lot
--  pose UNIQUEMENT le paramétrage ; aucune écriture n'est encore générée.
--
--  1. journaux : compte de trésorerie (classe 5) et code journal comptable.
--  2. tenants  : compte des virements internes (585 par défaut), format
--                d'export (csv | sage_i7), gabarit d'export (JSON, lot 3).
--  3. equivalences_comptables : correspondance rubrique → compte, VERSIONNÉE.
--       brouillon : proposée (directeur ou cabinet) — au plus une par rubrique ;
--       valide    : en vigueur — au plus une par rubrique ;
--       archive   : ancienne version validée (conservée pour l'historique) ;
--       rejete    : proposition refusée par le cabinet (motif conservé).
--     À la validation, rubriques.code_comptable reçoit le compte validé :
--     les écrans existants restent cohérents.
--  4. plan_client_est_utilise() : un compte cité par une équivalence, un
--     journal ou le compte des virements est « utilisé » → ni supprimable ni
--     renumérotable (trigger de la 019).
--  5. Permissions passerelle.* (décision du 13/10/2026 : le cabinet valide,
--     le directeur propose ; cabinet ET directeur pourront exporter).
--
--  L'ancienne table sage_equivalences (schema.sql) n'a jamais été utilisée :
--  elle est laissée en place, sans lecture ni écriture. Sa contrainte
--  UNIQUE(tenant_id, rubrique_code, sens, actif) interdisait l'historique.
-- Idempotente.

-- ── 1. Journaux ──────────────────────────────────────────────────────────────
ALTER TABLE journaux ADD COLUMN IF NOT EXISTS compte_tresorerie   TEXT NOT NULL DEFAULT '';
ALTER TABLE journaux ADD COLUMN IF NOT EXISTS code_journal_compta TEXT NOT NULL DEFAULT '';

-- ── 2. Paramètres du client ──────────────────────────────────────────────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS compte_virements TEXT  NOT NULL DEFAULT '585';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS format_export    TEXT  NOT NULL DEFAULT 'csv';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS gabarit_export   JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tenants_format_export') THEN
    ALTER TABLE tenants ADD CONSTRAINT ck_tenants_format_export
      CHECK (format_export IN ('csv', 'sage_i7'));
  END IF;
END $$;

-- ── 3. Équivalences rubrique → compte ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS equivalences_comptables (
  id           BIGSERIAL   PRIMARY KEY,
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rubrique_id  INTEGER     NOT NULL REFERENCES rubriques(id) ON DELETE CASCADE,
  compte       TEXT        NOT NULL CHECK (btrim(compte) <> ''),
  version      INTEGER     NOT NULL DEFAULT 1,
  statut       TEXT        NOT NULL DEFAULT 'brouillon'
                           CHECK (statut IN ('brouillon', 'valide', 'archive', 'rejete')),
  commentaire  TEXT        NOT NULL DEFAULT '',
  motif_rejet  TEXT        NOT NULL DEFAULT '',
  propose_par  UUID        REFERENCES users(id) ON DELETE SET NULL,
  propose_le   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decide_par   UUID        REFERENCES users(id) ON DELETE SET NULL,
  decide_le    TIMESTAMPTZ
);

-- Au plus UNE version en vigueur et UNE proposition en attente par rubrique :
-- garanti en base, pas seulement dans l'API.
CREATE UNIQUE INDEX IF NOT EXISTS uq_equiv_valide
  ON equivalences_comptables (rubrique_id) WHERE statut = 'valide';
CREATE UNIQUE INDEX IF NOT EXISTS uq_equiv_brouillon
  ON equivalences_comptables (rubrique_id) WHERE statut = 'brouillon';
CREATE INDEX IF NOT EXISTS idx_equiv_tenant
  ON equivalences_comptables (tenant_id, statut);

-- La rubrique doit appartenir au même client que l'équivalence.
CREATE OR REPLACE FUNCTION equivalence_meme_client() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM rubriques WHERE id = NEW.rubrique_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'La rubrique % n''appartient pas à ce client.', NEW.rubrique_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_equiv_meme_client ON equivalences_comptables;
CREATE TRIGGER trg_equiv_meme_client
  BEFORE INSERT OR UPDATE OF tenant_id, rubrique_id ON equivalences_comptables
  FOR EACH ROW EXECUTE FUNCTION equivalence_meme_client();

-- ── 4. « Compte utilisé » étendu ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION plan_client_est_utilise(p_tenant UUID, p_compte TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM rubriques r
     WHERE r.tenant_id = p_tenant
       AND lower(btrim(coalesce(r.code_comptable, ''))) = lower(btrim(p_compte))
  ) OR EXISTS (
    SELECT 1 FROM equivalences_comptables e
     WHERE e.tenant_id = p_tenant AND e.statut IN ('valide', 'brouillon')
       AND lower(btrim(e.compte)) = lower(btrim(p_compte))
  ) OR EXISTS (
    SELECT 1 FROM journaux j
     WHERE j.tenant_id = p_tenant
       AND lower(btrim(j.compte_tresorerie)) = lower(btrim(p_compte))
  ) OR EXISTS (
    SELECT 1 FROM tenants t
     WHERE t.id = p_tenant
       AND lower(btrim(t.compte_virements)) = lower(btrim(p_compte))
  );
$$;

-- ── 5. Permissions ──────────────────────────────────────────────────────────
INSERT INTO permissions(code, nom, module, description) VALUES
  ('passerelle.view',     'Voir la passerelle comptable',       'passerelle',
   'Consulter les comptes associés aux rubriques et aux journaux'),
  ('passerelle.proposer', 'Proposer les comptes des rubriques', 'passerelle',
   'Proposer le compte comptable d''une rubrique (validation par le cabinet)'),
  ('passerelle.valider',  'Valider le paramétrage comptable',   'passerelle',
   'Valider ou rejeter les comptes proposés, définir les comptes de trésorerie et le format d''export'),
  ('passerelle.exporter', 'Exporter les écritures',             'passerelle',
   'Générer et télécharger l''export comptable d''un mois arrêté'),
  ('passerelle.forcer',   'Forcer un ré-export',                'passerelle',
   'Ré-exporter une période déjà exportée (motif obligatoire)')
ON CONFLICT (code) DO NOTHING;

-- Rôles système.
INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, v.code FROM roles r
 CROSS JOIN (VALUES ('passerelle.view'), ('passerelle.proposer'), ('passerelle.valider'),
                    ('passerelle.exporter'), ('passerelle.forcer')) AS v(code)
 WHERE r.code = 'comptable_cabinet' AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, v.code FROM roles r
 CROSS JOIN (VALUES ('passerelle.view'), ('passerelle.proposer'), ('passerelle.exporter')) AS v(code)
 WHERE r.code = 'directeur' AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, 'passerelle.view' FROM roles r
 WHERE r.code = 'auditeur' AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;

-- Profils métier : qui gère les rubriques peut proposer leurs comptes.
INSERT INTO role_permissions(role_id, permission_code)
SELECT DISTINCT rp.role_id, v.code FROM role_permissions rp
  JOIN roles r ON r.id = rp.role_id AND NOT r.is_system
 CROSS JOIN (VALUES ('passerelle.view'), ('passerelle.proposer')) AS v(code)
 WHERE rp.permission_code = 'rubriques.edit'
ON CONFLICT DO NOTHING;

-- Clients avec plafond : la passerelle est ouverte là où les rubriques le sont.
INSERT INTO tenant_permissions(tenant_id, permission_code)
SELECT DISTINCT tp.tenant_id, v.code FROM tenant_permissions tp
 CROSS JOIN (VALUES ('passerelle.view'), ('passerelle.proposer'), ('passerelle.valider'),
                    ('passerelle.exporter'), ('passerelle.forcer')) AS v(code)
 WHERE tp.permission_code = 'rubriques.view'
ON CONFLICT DO NOTHING;
