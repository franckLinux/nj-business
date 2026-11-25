-- ============================================================================
-- 078 — NJ FINANCE, lot F4 : Clients et fournisseurs
--
--  Le fichier des tiers reste UNIQUE : registre_tiers (043), que NJ COMMERCIAL
--  complète déjà (com_tiers) et dont le compte individuel (compte_tiers, 044)
--  sert de code / compte auxiliaire. NJ FINANCE y ajoute seulement ses
--  conditions financières :
--    fin_tiers : délai de paiement (jours), mode de règlement habituel,
--                observations financières.
--  Les soldes, relevés, créances et dettes se CALCULENT à partir des écritures
--  (comptes 40 et 41 portant le tiers) et du journal de caisse : rien n'est
--  ressaisi.
--
--  Permissions finance.tiers.voir / finance.tiers.gerer.
--  Additive et idempotente. Retour arrière : 078_retour_arriere.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS fin_tiers (
  tiers_id              BIGINT       PRIMARY KEY REFERENCES registre_tiers(id) ON DELETE CASCADE,
  tenant_id             UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  delai_paiement_jours  INTEGER      NOT NULL DEFAULT 30 CHECK (delai_paiement_jours BETWEEN 0 AND 365),
  mode_reglement        TEXT         NOT NULL DEFAULT '' CHECK (mode_reglement IN ('', 'especes', 'cheque', 'virement', 'mobile_money', 'carte', 'compensation')),
  observations          TEXT         NOT NULL DEFAULT '' CHECK (length(observations) <= 2000),
  modifie_par           UUID         REFERENCES users(id) ON DELETE SET NULL,
  modifie_le            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fin_tiers_tenant ON fin_tiers (tenant_id);

CREATE OR REPLACE FUNCTION fin_tiers_controle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM registre_tiers WHERE id = NEW.tiers_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'TIERS_INCOHERENT: ce tiers n''appartient pas à ce client.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_fin_tiers_controle ON fin_tiers;
CREATE TRIGGER trg_fin_tiers_controle BEFORE INSERT OR UPDATE ON fin_tiers
  FOR EACH ROW EXECUTE FUNCTION fin_tiers_controle();

INSERT INTO permissions(code, nom, module, description) VALUES
  ('finance.tiers.voir',  'Voir les clients et fournisseurs', 'finance',
   'Consulter les fiches, relevés de compte, créances clients et dettes fournisseurs'),
  ('finance.tiers.gerer', 'Gérer les clients et fournisseurs', 'finance',
   'Créer et modifier les fiches (identité, compte auxiliaire, conditions de paiement)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, v.code FROM roles r
 CROSS JOIN (VALUES ('finance.tiers.voir'), ('finance.tiers.gerer')) AS v(code)
 WHERE r.code IN ('directeur', 'auditeur', 'comptable_cabinet') AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, 'finance.tiers.voir' FROM roles r
 WHERE r.code = 'caissier' AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;

INSERT INTO tenant_permissions(tenant_id, permission_code)
SELECT DISTINCT tp.tenant_id, v.code FROM tenant_permissions tp
 CROSS JOIN (VALUES ('finance.tiers.voir'), ('finance.tiers.gerer')) AS v(code)
 WHERE tp.permission_code = 'journal.view'
ON CONFLICT DO NOTHING;
