-- ============================================================================
-- 054 — NJ COMMERCIAL, lot 2 : agences, magasins rattachés, familles (02/11/2026)
--
--  Organisation : Société → Agences → Magasins.
--    • com_agences : code unique par client, nom, adresse, responsable, statut ;
--      jamais supprimée une fois utilisée (désactivée) ;
--    • chaque magasin est rattaché à UNE agence (agence_id, obligatoire). Les
--      magasins existants sont rattachés à une agence « SIEGE » créée par client.
--
--  Familles et articles :
--    • taxe d'achat et taxe de vente distinctes (la taxe existante de l'article
--      devient sa taxe d'achat ; la taxe de vente reste vide : jamais copiée) ;
--    • suivi en stock (oui / non) et méthode de valorisation (CMUP / FIFO),
--      proposés par la famille, modifiables article par article.
--      Les articles existants sont suivis en stock, en CMUP (aucun mouvement
--      valorisé n'existe encore : rien n'est recalculé).
--    • com_taxes.usage : achat, vente ou les deux (« les deux » pour l'existant).
--
--  Périmètre par agence : com_utilisateur_agences. Une personne sans ligne voit
--  tout le client (comportement actuel) ; avec des lignes, seulement ces agences.
--
--  PUREMENT ADDITIVE ; aucune donnée de caisse touchée. Idempotente.
--  Retour arrière : migrations-retour-arriere/054_retour_arriere.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS com_agences (
  id              BIGSERIAL      PRIMARY KEY,
  tenant_id       UUID           NOT NULL REFERENCES tenants(id),
  code            TEXT           NOT NULL CHECK (code ~ '^[A-Z0-9_.-]{1,20}$'),
  nom             TEXT           NOT NULL CHECK (length(nom) BETWEEN 1 AND 120),
  adresse         TEXT           NOT NULL DEFAULT '' CHECK (length(adresse) <= 300),
  responsable_id  UUID           REFERENCES users(id),
  actif           BOOLEAN        NOT NULL DEFAULT true,
  cree_par        UUID           REFERENCES users(id),
  cree_le         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  modifie_le      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_com_agences_code ON com_agences (tenant_id, upper(code));

-- Agence « SIEGE » pour chaque client qui a déjà des magasins.
INSERT INTO com_agences (tenant_id, code, nom)
SELECT DISTINCT m.tenant_id, 'SIEGE', 'Siège'
  FROM com_magasins m
 WHERE NOT EXISTS (SELECT 1 FROM com_agences a WHERE a.tenant_id = m.tenant_id);

ALTER TABLE com_magasins ADD COLUMN IF NOT EXISTS agence_id BIGINT REFERENCES com_agences(id);
UPDATE com_magasins m
   SET agence_id = (SELECT a.id FROM com_agences a WHERE a.tenant_id = m.tenant_id ORDER BY (a.code = 'SIEGE') DESC, a.id LIMIT 1)
 WHERE m.agence_id IS NULL;
ALTER TABLE com_magasins ALTER COLUMN agence_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS ix_com_magasins_agence ON com_magasins (agence_id);

-- Usage des taxes.
ALTER TABLE com_taxes ADD COLUMN IF NOT EXISTS usage TEXT NOT NULL DEFAULT 'les_deux';
ALTER TABLE com_taxes DROP CONSTRAINT IF EXISTS com_taxes_usage_check;
ALTER TABLE com_taxes ADD CONSTRAINT com_taxes_usage_check CHECK (usage IN ('achat', 'vente', 'les_deux'));

-- Familles : paramètres proposés aux articles.
ALTER TABLE com_familles ADD COLUMN IF NOT EXISTS taxe_achat_id BIGINT REFERENCES com_taxes(id);
ALTER TABLE com_familles ADD COLUMN IF NOT EXISTS taxe_vente_id BIGINT REFERENCES com_taxes(id);
ALTER TABLE com_familles ADD COLUMN IF NOT EXISTS suivi_stock BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE com_familles ADD COLUMN IF NOT EXISTS methode_valorisation TEXT NOT NULL DEFAULT 'cmup';
ALTER TABLE com_familles DROP CONSTRAINT IF EXISTS com_familles_methode_check;
ALTER TABLE com_familles ADD CONSTRAINT com_familles_methode_check CHECK (methode_valorisation IN ('cmup', 'fifo'));

-- Articles : taxe_id existante = taxe d'achat ; ajout taxe de vente, suivi, méthode.
ALTER TABLE com_articles ADD COLUMN IF NOT EXISTS taxe_vente_id BIGINT REFERENCES com_taxes(id);
ALTER TABLE com_articles ADD COLUMN IF NOT EXISTS suivi_stock BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE com_articles ADD COLUMN IF NOT EXISTS methode_valorisation TEXT NOT NULL DEFAULT 'cmup';
ALTER TABLE com_articles DROP CONSTRAINT IF EXISTS com_articles_methode_check;
ALTER TABLE com_articles ADD CONSTRAINT com_articles_methode_check CHECK (methode_valorisation IN ('cmup', 'fifo'));
COMMENT ON COLUMN com_articles.taxe_id IS 'Taxe d''achat (054 : taxe de vente dans taxe_vente_id)';

-- Périmètre par agence.
CREATE TABLE IF NOT EXISTS com_utilisateur_agences (
  user_id    UUID   NOT NULL REFERENCES users(id),
  agence_id  BIGINT NOT NULL REFERENCES com_agences(id),
  tenant_id  UUID   NOT NULL REFERENCES tenants(id),
  PRIMARY KEY (user_id, agence_id)
);

-- Même client partout (nouvelles colonnes et tables).
CREATE OR REPLACE FUNCTION com_meme_client_d() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ok BOOLEAN := true;
BEGIN
  IF TG_TABLE_NAME = 'com_agences' THEN
    ok := NEW.responsable_id IS NULL OR EXISTS (SELECT 1 FROM users WHERE id = NEW.responsable_id AND tenant_id = NEW.tenant_id);
  ELSIF TG_TABLE_NAME = 'com_magasins' THEN
    ok := EXISTS (SELECT 1 FROM com_agences WHERE id = NEW.agence_id AND tenant_id = NEW.tenant_id);
  ELSIF TG_TABLE_NAME = 'com_familles' THEN
    ok := (NEW.taxe_achat_id IS NULL OR EXISTS (SELECT 1 FROM com_taxes WHERE id = NEW.taxe_achat_id AND tenant_id = NEW.tenant_id))
      AND (NEW.taxe_vente_id IS NULL OR EXISTS (SELECT 1 FROM com_taxes WHERE id = NEW.taxe_vente_id AND tenant_id = NEW.tenant_id));
  ELSIF TG_TABLE_NAME = 'com_articles' THEN
    ok := NEW.taxe_vente_id IS NULL OR EXISTS (SELECT 1 FROM com_taxes WHERE id = NEW.taxe_vente_id AND tenant_id = NEW.tenant_id);
  ELSIF TG_TABLE_NAME = 'com_utilisateur_agences' THEN
    ok := EXISTS (SELECT 1 FROM com_agences WHERE id = NEW.agence_id AND tenant_id = NEW.tenant_id)
      AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND tenant_id = NEW.tenant_id);
  END IF;
  IF NOT ok THEN
    RAISE EXCEPTION 'Référence d''un autre client refusée (%).', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['com_agences', 'com_magasins', 'com_familles', 'com_articles', 'com_utilisateur_agences'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_meme_client_d ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_meme_client_d BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION com_meme_client_d()', t, t);
  END LOOP;
END $$;

-- Permission : gérer le périmètre d'agence des utilisateurs relève de
-- com.parametrage.modifier (déjà existante) : aucune nouvelle permission ici.
