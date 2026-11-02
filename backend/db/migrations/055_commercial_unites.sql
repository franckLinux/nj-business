-- ============================================================================
-- 055 — NJ COMMERCIAL, lot 3 : unités de mesure et conversions (02/11/2026)
--
--  • com_unites : unités du client (code, libellé, nombre de décimales).
--    Reprise de l'existant : une unité par mot déjà saisi sur les articles
--    (« rame », « unité »…), avec 0 décimale, ou 3 si une quantité décimale
--    existe déjà pour ce mot (rien d'enregistré ne devient invalide).
--  • Article : unité de stock (obligatoire), unité d'achat, unité de vente,
--    prix de vente indicatif. La conversion est portée PAR L'ARTICLE
--    (com_article_unites : 1 carton = 12 pièces s'écrit (carton, 12) ; l'unité
--    de stock vaut toujours 1). Les articles existants reçoivent leur unité
--    actuelle en stock, achat et vente, coefficient 1 : rien ne change.
--  • Famille : unités et coefficients PROPOSÉS aux nouveaux articles.
--  • Lignes de demande et de bon : unité du document et coefficient copiés
--    (l'historique ne bouge jamais si l'article change ensuite). Lignes
--    existantes : coefficient 1, unité retrouvée par son mot.
--
--  PUREMENT ADDITIVE ; aucune donnée de caisse touchée. Idempotente.
--  Retour arrière : migrations-retour-arriere/055_retour_arriere.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS com_unites (
  id          BIGSERIAL    PRIMARY KEY,
  tenant_id   UUID         NOT NULL REFERENCES tenants(id),
  code        TEXT         NOT NULL CHECK (length(code) BETWEEN 1 AND 20),
  libelle     TEXT         NOT NULL CHECK (length(libelle) BETWEEN 1 AND 60),
  decimales   SMALLINT     NOT NULL DEFAULT 0 CHECK (decimales BETWEEN 0 AND 3),
  actif       BOOLEAN      NOT NULL DEFAULT true,
  cree_par    UUID         REFERENCES users(id),
  cree_le     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  modifie_le  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_com_unites_code ON com_unites (tenant_id, lower(code));

-- Reprise : une unité par mot distinct déjà utilisé sur les articles.
INSERT INTO com_unites (tenant_id, code, libelle, decimales)
SELECT a.tenant_id, left(lower(trim(a.unite)), 20), left(trim(a.unite), 60),
       CASE WHEN bool_or(EXISTS (SELECT 1 FROM com_stock_mouvements s WHERE s.article_id = a.id AND s.quantite <> trunc(s.quantite))
                      OR EXISTS (SELECT 1 FROM com_demande_lignes l WHERE l.article_id = a.id AND l.quantite <> trunc(l.quantite))
                      OR EXISTS (SELECT 1 FROM com_bc_lignes l WHERE l.article_id = a.id AND l.quantite <> trunc(l.quantite)))
            THEN 3 ELSE 0 END
  FROM com_articles a
 WHERE trim(a.unite) <> ''
   AND NOT EXISTS (SELECT 1 FROM com_unites u WHERE u.tenant_id = a.tenant_id AND lower(u.code) = left(lower(trim(a.unite)), 20))
 GROUP BY a.tenant_id, left(lower(trim(a.unite)), 20), left(trim(a.unite), 60);
-- (Deux graphies d'un même mot donneraient deux lignes : on garde la première.)
DELETE FROM com_unites u USING com_unites v
 WHERE u.tenant_id = v.tenant_id AND lower(u.code) = lower(v.code) AND u.id > v.id;

-- Articles.
ALTER TABLE com_articles ADD COLUMN IF NOT EXISTS unite_stock_id BIGINT REFERENCES com_unites(id);
ALTER TABLE com_articles ADD COLUMN IF NOT EXISTS unite_achat_id BIGINT REFERENCES com_unites(id);
ALTER TABLE com_articles ADD COLUMN IF NOT EXISTS unite_vente_id BIGINT REFERENCES com_unites(id);
ALTER TABLE com_articles ADD COLUMN IF NOT EXISTS prix_vente_indicatif NUMERIC(18,2) CHECK (prix_vente_indicatif IS NULL OR prix_vente_indicatif >= 0);
UPDATE com_articles a
   SET unite_stock_id = u.id
  FROM com_unites u
 WHERE a.unite_stock_id IS NULL AND u.tenant_id = a.tenant_id AND lower(u.code) = left(lower(trim(a.unite)), 20);
-- Article sans mot d'unité (ne devrait pas exister) : unité « unité ».
INSERT INTO com_unites (tenant_id, code, libelle)
SELECT DISTINCT a.tenant_id, 'unité', 'unité' FROM com_articles a
 WHERE a.unite_stock_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM com_unites u WHERE u.tenant_id = a.tenant_id AND lower(u.code) = 'unité');
UPDATE com_articles a SET unite_stock_id = u.id, unite = u.code
  FROM com_unites u WHERE a.unite_stock_id IS NULL AND u.tenant_id = a.tenant_id AND lower(u.code) = 'unité';
UPDATE com_articles SET unite_achat_id = unite_stock_id WHERE unite_achat_id IS NULL;
UPDATE com_articles SET unite_vente_id = unite_stock_id WHERE unite_vente_id IS NULL;
ALTER TABLE com_articles ALTER COLUMN unite_stock_id SET NOT NULL;
ALTER TABLE com_articles ALTER COLUMN unite_achat_id SET NOT NULL;
ALTER TABLE com_articles ALTER COLUMN unite_vente_id SET NOT NULL;
COMMENT ON COLUMN com_articles.unite IS 'Code de l''unité de stock (recopié de unite_stock_id, pour les documents et l''affichage)';
COMMENT ON COLUMN com_articles.prix_achat_indicatif IS 'Prix d''achat indicatif par unité d''achat';

-- Conversions par article : coefficient = combien d'unités de stock vaut 1 unité.
CREATE TABLE IF NOT EXISTS com_article_unites (
  article_id   BIGINT        NOT NULL REFERENCES com_articles(id) ON DELETE CASCADE,
  unite_id     BIGINT        NOT NULL REFERENCES com_unites(id),
  tenant_id    UUID          NOT NULL REFERENCES tenants(id),
  coefficient  NUMERIC(18,6) NOT NULL CHECK (coefficient > 0),
  PRIMARY KEY (article_id, unite_id)
);
INSERT INTO com_article_unites (article_id, unite_id, tenant_id, coefficient)
SELECT a.id, a.unite_stock_id, a.tenant_id, 1 FROM com_articles a
ON CONFLICT DO NOTHING;

-- Familles : unités proposées aux nouveaux articles.
ALTER TABLE com_familles ADD COLUMN IF NOT EXISTS unite_stock_id BIGINT REFERENCES com_unites(id);
ALTER TABLE com_familles ADD COLUMN IF NOT EXISTS unite_achat_id BIGINT REFERENCES com_unites(id);
ALTER TABLE com_familles ADD COLUMN IF NOT EXISTS coef_achat NUMERIC(18,6) CHECK (coef_achat IS NULL OR coef_achat > 0);
ALTER TABLE com_familles ADD COLUMN IF NOT EXISTS unite_vente_id BIGINT REFERENCES com_unites(id);
ALTER TABLE com_familles ADD COLUMN IF NOT EXISTS coef_vente NUMERIC(18,6) CHECK (coef_vente IS NULL OR coef_vente > 0);

-- Documents : unité et coefficient copiés sur la ligne.
ALTER TABLE com_demande_lignes ADD COLUMN IF NOT EXISTS unite_id BIGINT REFERENCES com_unites(id);
ALTER TABLE com_demande_lignes ADD COLUMN IF NOT EXISTS coefficient NUMERIC(18,6) NOT NULL DEFAULT 1 CHECK (coefficient > 0);
UPDATE com_demande_lignes l SET unite_id = u.id
  FROM com_unites u WHERE l.unite_id IS NULL AND u.tenant_id = l.tenant_id AND lower(u.code) = left(lower(trim(l.unite)), 20);

-- Les lignes d'un bon émis sont protégées par un déclencheur (052) : la reprise
-- ne renseigne que l'unité, sans toucher à rien d'autre, déclencheur suspendu
-- le temps de cette seule mise à jour.
ALTER TABLE com_bc_lignes ADD COLUMN IF NOT EXISTS unite_id BIGINT REFERENCES com_unites(id);
ALTER TABLE com_bc_lignes ADD COLUMN IF NOT EXISTS coefficient NUMERIC(18,6) NOT NULL DEFAULT 1 CHECK (coefficient > 0);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM com_bc_lignes WHERE unite_id IS NULL) THEN
    ALTER TABLE com_bc_lignes DISABLE TRIGGER USER;
    UPDATE com_bc_lignes l SET unite_id = u.id
      FROM com_unites u WHERE l.unite_id IS NULL AND u.tenant_id = l.tenant_id AND lower(u.code) = left(lower(trim(l.unite)), 20);
    ALTER TABLE com_bc_lignes ENABLE TRIGGER USER;
  END IF;
END $$;

-- Même client partout.
CREATE OR REPLACE FUNCTION com_meme_client_e() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ok BOOLEAN := true;
BEGIN
  IF TG_TABLE_NAME = 'com_article_unites' THEN
    ok := EXISTS (SELECT 1 FROM com_articles WHERE id = NEW.article_id AND tenant_id = NEW.tenant_id)
      AND EXISTS (SELECT 1 FROM com_unites WHERE id = NEW.unite_id AND tenant_id = NEW.tenant_id);
  ELSIF TG_TABLE_NAME IN ('com_articles', 'com_familles') THEN
    ok := (NEW.unite_stock_id IS NULL OR EXISTS (SELECT 1 FROM com_unites WHERE id = NEW.unite_stock_id AND tenant_id = NEW.tenant_id))
      AND (NEW.unite_achat_id IS NULL OR EXISTS (SELECT 1 FROM com_unites WHERE id = NEW.unite_achat_id AND tenant_id = NEW.tenant_id))
      AND (NEW.unite_vente_id IS NULL OR EXISTS (SELECT 1 FROM com_unites WHERE id = NEW.unite_vente_id AND tenant_id = NEW.tenant_id));
  ELSIF TG_TABLE_NAME IN ('com_demande_lignes', 'com_bc_lignes') THEN
    ok := NEW.unite_id IS NULL OR EXISTS (SELECT 1 FROM com_unites WHERE id = NEW.unite_id AND tenant_id = NEW.tenant_id);
  END IF;
  IF NOT ok THEN
    RAISE EXCEPTION 'Référence d''un autre client refusée (%).', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['com_article_unites', 'com_articles', 'com_familles', 'com_demande_lignes', 'com_bc_lignes'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_meme_client_e ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_meme_client_e BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION com_meme_client_e()', t, t);
  END LOOP;
END $$;
