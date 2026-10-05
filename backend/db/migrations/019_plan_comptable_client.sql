-- ── 019 — Plan comptable PAR CLIENT (réforme, étape 2) ────────────────────
-- AJOUTS UNIQUEMENT. L'application continue de lire le plan global
-- (plan_comptable_syscohada) tant que l'étape 3 (bascule de lecture) n'est
-- pas déployée : cette migration ne change aucun écran.
--
--  1. plan_comptable_client : le plan propre à chaque client, copié du modèle.
--     - identifiant interne propre (id), jamais réutilisé ni modifié ;
--     - numéro unique PAR client ;
--     - parent obligatoirement dans le MÊME client (clé étrangère composite) ;
--     - origine 'modele' (copié du modèle) ou 'client' (ajouté par le client) ;
--     - lien vers le compte et la version du modèle d'origine (synchronisation).
--  2. Protections en base (et pas seulement dans l'API) :
--     - un compte UTILISÉ (cité par une rubrique du client) ne peut être ni
--       supprimé physiquement, ni changer de numéro → trigger ;
--  3. tenants : version du modèle utilisée, date d'initialisation, dernière
--     synchronisation, dernière modification du plan.
--  4. plan_client_initialiser(tenant) : copie du modèle dans le périmètre du
--     client. Une fonction PostgreSQL s'exécute en un bloc : une erreur annule
--     TOUT (aucun plan partiellement créé). Idempotente : sans effet sur un
--     client déjà initialisé.
--  5. Initialisation des clients existants.
-- Journalisation : table audit_log existante (entite = 'plan_comptable_client').

-- ── 1. Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plan_comptable_client (
    id                BIGSERIAL PRIMARY KEY,
    tenant_id         UUID    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    compte            TEXT    NOT NULL CHECK (btrim(compte) <> ''),
    intitule          TEXT    NOT NULL CHECK (btrim(intitule) <> ''),
    description       TEXT    NOT NULL DEFAULT '',
    classe            INTEGER,
    nature            TEXT,
    parent_id         BIGINT,
    origine           TEXT    NOT NULL DEFAULT 'client' CHECK (origine IN ('modele','client')),
    modele_compte_id  BIGINT  REFERENCES plan_comptable_syscohada(id),
    modele_version_id INTEGER REFERENCES plan_modele_versions(id),
    personnalise      BOOLEAN NOT NULL DEFAULT false,   -- compte du modèle modifié par le client
    statut            TEXT    NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif','inactif','archive')),
    created_by        UUID REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_pcc_tenant_id UNIQUE (tenant_id, id)
);

-- Numéro unique par client (insensible à la casse et aux espaces).
CREATE UNIQUE INDEX IF NOT EXISTS uq_pcc_tenant_compte
    ON plan_comptable_client (tenant_id, lower(btrim(compte)));
CREATE INDEX IF NOT EXISTS idx_pcc_tenant_classe ON plan_comptable_client (tenant_id, classe);
CREATE INDEX IF NOT EXISTS idx_pcc_modele        ON plan_comptable_client (modele_compte_id);

-- Le parent appartient forcément au même client.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pcc_parent_meme_client') THEN
    ALTER TABLE plan_comptable_client
      ADD CONSTRAINT fk_pcc_parent_meme_client
      FOREIGN KEY (tenant_id, parent_id) REFERENCES plan_comptable_client (tenant_id, id);
  END IF;
END $$;

-- ── 2. Protection des comptes utilisés ─────────────────────────────────────
-- « Utilisé » = cité par une rubrique du même client (seul lien existant
-- aujourd'hui entre l'activité et le plan comptable).
CREATE OR REPLACE FUNCTION plan_client_est_utilise(p_tenant UUID, p_compte TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM rubriques r
     WHERE r.tenant_id = p_tenant
       AND lower(btrim(coalesce(r.code_comptable, ''))) = lower(btrim(p_compte))
  );
$$;

CREATE OR REPLACE FUNCTION plan_client_proteger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Suppression du client lui-même (cascade) : tout part, rien à protéger.
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
      RETURN OLD;
    END IF;
    IF plan_client_est_utilise(OLD.tenant_id, OLD.compte) THEN
      RAISE EXCEPTION 'Compte % utilisé : suppression interdite (désactivez-le ou archivez-le).', OLD.compte
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  -- UPDATE
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id THEN
    RAISE EXCEPTION 'L''identifiant et le client d''un compte ne peuvent pas être modifiés.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF lower(btrim(NEW.compte)) <> lower(btrim(OLD.compte))
     AND plan_client_est_utilise(OLD.tenant_id, OLD.compte) THEN
    RAISE EXCEPTION 'Compte % utilisé : son numéro ne peut pas être modifié.', OLD.compte
      USING ERRCODE = 'restrict_violation';
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pcc_proteger ON plan_comptable_client;
CREATE TRIGGER trg_pcc_proteger
  BEFORE UPDATE OR DELETE ON plan_comptable_client
  FOR EACH ROW EXECUTE FUNCTION plan_client_proteger();

-- ── 3. Suivi sur la fiche client ───────────────────────────────────────────
ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS plan_modele_version_id INTEGER REFERENCES plan_modele_versions(id),
    ADD COLUMN IF NOT EXISTS plan_initialise_le     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS plan_derniere_synchro  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS plan_derniere_modif    TIMESTAMPTZ;

-- ── 4. Initialisation d'un client ──────────────────────────────────────────
-- Renvoie le nombre de comptes créés (0 si le client était déjà initialisé).
CREATE OR REPLACE FUNCTION plan_client_initialiser(
  p_tenant  UUID,
  p_version INTEGER DEFAULT NULL,
  p_user    UUID    DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  v_version INTEGER;
  v_nb      INTEGER;
  v_custom  INTEGER;
BEGIN
  -- Verrou sur la ligne du client : deux initialisations simultanées
  -- ne peuvent pas s'entrelacer.
  PERFORM 1 FROM tenants WHERE id = p_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client % introuvable.', p_tenant;
  END IF;

  IF EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant AND plan_initialise_le IS NOT NULL)
     OR EXISTS (SELECT 1 FROM plan_comptable_client WHERE tenant_id = p_tenant) THEN
    RETURN 0;
  END IF;

  v_version := COALESCE(p_version,
                        (SELECT id FROM plan_modele_versions WHERE statut = 'publiee' LIMIT 1));
  IF v_version IS NULL THEN
    RAISE EXCEPTION 'Aucune version publiée du modèle de plan comptable.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM plan_modele_versions WHERE id = v_version AND statut <> 'brouillon') THEN
    RAISE EXCEPTION 'Version % du modèle introuvable ou non publiée.', v_version;
  END IF;

  -- a) Comptes du modèle (les comptes archivés du modèle ne sont pas copiés).
  INSERT INTO plan_comptable_client
         (tenant_id, compte, intitule, description, classe, nature,
          origine, modele_compte_id, modele_version_id, statut, created_by)
  SELECT p_tenant, m.compte, m.intitule, m.description, m.classe, m.nature,
         'modele', m.id, v_version,
         CASE WHEN m.actif THEN 'actif' ELSE 'inactif' END, p_user
    FROM plan_comptable_syscohada m
   WHERE m.version_id = v_version
     AND m.statut <> 'archive';
  GET DIAGNOSTICS v_nb = ROW_COUNT;

  -- b) Anciens comptes « custom » ajoutés par un utilisateur de CE client
  --    dans le plan global : ils deviennent des comptes propres au client.
  INSERT INTO plan_comptable_client
         (tenant_id, compte, intitule, classe, nature, origine, statut, created_by, created_at)
  SELECT p_tenant, m.compte, m.intitule, m.classe, m.nature, 'client',
         CASE WHEN m.actif THEN 'actif' ELSE 'inactif' END, m.created_by, m.created_at
    FROM plan_comptable_syscohada m
    JOIN users u ON u.id = m.created_by AND u.tenant_id = p_tenant
   WHERE m.source = 'custom'
  ON CONFLICT (tenant_id, lower(btrim(compte))) DO NOTHING;
  GET DIAGNOSTICS v_custom = ROW_COUNT;

  -- c) Parents : plus long préfixe existant DANS LE PLAN DU CLIENT.
  UPDATE plan_comptable_client c
     SET parent_id = (
           SELECT q.id FROM plan_comptable_client q
            WHERE q.tenant_id = c.tenant_id
              AND length(q.compte) < length(c.compte)
              AND c.compte LIKE q.compte || '%'
            ORDER BY length(q.compte) DESC
            LIMIT 1)
   WHERE c.tenant_id = p_tenant;

  UPDATE tenants
     SET plan_modele_version_id = v_version,
         plan_initialise_le     = NOW(),
         plan_derniere_modif    = NOW()
   WHERE id = p_tenant;

  INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, nouvelle_valeur)
  VALUES (p_tenant, p_user, 'INIT_PLAN_COMPTABLE', 'plan_comptable_client', p_tenant::text,
          jsonb_build_object('version_id', v_version,
                             'comptes_modele', v_nb,
                             'comptes_client_repris', v_custom));

  RETURN v_nb + v_custom;
END $$;

-- ── 5. Clients existants ───────────────────────────────────────────────────
-- Dans la transaction de la migration : si un seul client échoue, rien n'est
-- conservé et la migration est rejouée au prochain démarrage.
SELECT t.id, plan_client_initialiser(t.id) AS comptes_crees
  FROM tenants t
 WHERE t.plan_initialise_le IS NULL;
