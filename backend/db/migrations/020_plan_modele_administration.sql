-- ── 020 — Administration du modèle global (réforme du plan, étape 6) ───────
-- AJOUTS + remplacement de deux fonctions de la 018/019. Aucune donnée
-- supprimée.
--
-- Principe retenu : le modèle « vivant » (plan_comptable_syscohada) est ce que
-- l'administrateur plateforme modifie. Une VERSION publiée est un INSTANTANÉ
-- figé de ce modèle (plan_modele_version_comptes). Les clients sont toujours
-- initialisés — et plus tard synchronisés — à partir d'un instantané publié,
-- jamais à partir de modifications en cours non publiées.
--
--  1. plan_modele_version_comptes : instantané par version. Le numéro d'un
--     compte est unique DANS une version.
--  2. Instantané de la version 1 à partir du modèle actuel.
--  3. plan_modele_recalculer() : ne rattache plus d'office les nouveaux comptes
--     à la version publiée (ils restent « non publiés » jusqu'à la prochaine
--     publication) ; amorce l'instantané si une version publiée n'en a pas
--     (installation neuve : migrations avant chargement du référentiel).
--  4. plan_client_initialiser() : copie depuis l'instantané publié.
-- Idempotente.

-- ── 1. Instantanés ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plan_modele_version_comptes (
    version_id    INTEGER NOT NULL REFERENCES plan_modele_versions(id),
    compte_id     BIGINT  NOT NULL REFERENCES plan_comptable_syscohada(id),
    compte        TEXT    NOT NULL,
    intitule      TEXT    NOT NULL,
    description   TEXT    NOT NULL DEFAULT '',
    classe        INTEGER,
    nature        TEXT,
    parent_compte TEXT,
    statut        TEXT    NOT NULL CHECK (statut IN ('actif','inactif','archive')),
    PRIMARY KEY (version_id, compte_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pmvc_version_compte
    ON plan_modele_version_comptes (version_id, lower(btrim(compte)));

-- ── 2 & 3. Recalcul + amorçage de l'instantané ─────────────────────────────
CREATE OR REPLACE FUNCTION plan_modele_recalculer() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_id INTEGER;
BEGIN
  SELECT id INTO v_id FROM plan_modele_versions WHERE statut = 'publiee' LIMIT 1;

  -- Amorçage : version publiée sans instantané (installation neuve, ou
  -- version 1 créée par la 018 avant l'existence de cette table).
  IF v_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM plan_modele_version_comptes WHERE version_id = v_id)
     AND EXISTS (SELECT 1 FROM plan_comptable_syscohada WHERE source = 'syscohada') THEN
    UPDATE plan_comptable_syscohada SET version_id = v_id
     WHERE source = 'syscohada' AND version_id IS NULL;
  END IF;

  -- Parent = plus long préfixe strict du numéro qui existe dans le modèle.
  -- Uniquement pour les comptes SANS parent : un parent choisi par
  -- l'administrateur plateforme n'est plus jamais recalculé.
  UPDATE plan_comptable_syscohada p
     SET parent_compte = x.parent
    FROM (
      SELECT c.id,
             (SELECT q.compte FROM plan_comptable_syscohada q
               WHERE length(q.compte) < length(c.compte) AND c.compte LIKE q.compte || '%'
               ORDER BY length(q.compte) DESC LIMIT 1) AS parent
        FROM plan_comptable_syscohada c
    ) x
   WHERE p.id = x.id AND p.parent_compte IS NULL AND x.parent IS NOT NULL;

  -- statut suit `actif` (colonne lue par l'application) ; archivé reste archivé.
  UPDATE plan_comptable_syscohada
     SET statut = CASE WHEN actif THEN 'actif' WHEN statut = 'archive' THEN 'archive' ELSE 'inactif' END
   WHERE statut IS DISTINCT FROM CASE WHEN actif THEN 'actif' WHEN statut = 'archive' THEN 'archive' ELSE 'inactif' END;

  IF v_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM plan_modele_version_comptes WHERE version_id = v_id) THEN
    INSERT INTO plan_modele_version_comptes
           (version_id, compte_id, compte, intitule, description, classe, nature, parent_compte, statut)
    SELECT v_id, id, compte, intitule, description, classe, nature, parent_compte, statut
      FROM plan_comptable_syscohada
     WHERE version_id = v_id;
  END IF;
END $$;

SELECT plan_modele_recalculer();

-- ── 4. Initialisation d'un client depuis l'instantané publié ──────────────
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
  IF NOT EXISTS (SELECT 1 FROM plan_modele_version_comptes WHERE version_id = v_version) THEN
    RAISE EXCEPTION 'La version % du modèle ne contient aucun compte.', v_version;
  END IF;

  -- a) Comptes de l'instantané (les comptes archivés ne sont pas copiés).
  INSERT INTO plan_comptable_client
         (tenant_id, compte, intitule, description, classe, nature,
          origine, modele_compte_id, modele_version_id, statut, created_by)
  SELECT p_tenant, s.compte, s.intitule, s.description, s.classe, s.nature,
         'modele', s.compte_id, v_version, s.statut, p_user
    FROM plan_modele_version_comptes s
   WHERE s.version_id = v_version
     AND s.statut <> 'archive';
  GET DIAGNOSTICS v_nb = ROW_COUNT;

  -- b) Anciens comptes « custom » ajoutés par un utilisateur de CE client.
  INSERT INTO plan_comptable_client
         (tenant_id, compte, intitule, classe, nature, origine, statut, created_by, created_at)
  SELECT p_tenant, m.compte, m.intitule, m.classe, m.nature, 'client',
         CASE WHEN m.actif THEN 'actif' ELSE 'inactif' END, m.created_by, m.created_at
    FROM plan_comptable_syscohada m
    JOIN users u ON u.id = m.created_by AND u.tenant_id = p_tenant
   WHERE m.source = 'custom'
  ON CONFLICT (tenant_id, lower(btrim(compte))) DO NOTHING;
  GET DIAGNOSTICS v_custom = ROW_COUNT;

  -- c) Parents dans le plan du client.
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
