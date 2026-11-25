-- ============================================================================
-- 082 — NJ FINANCE, lot F7 : lecture automatique des factures fournisseurs
--
-- Décision D7 (25/11/2026) : lecture installée sur le serveur, aucune donnée
-- envoyée à un tiers. Texte des PDF numériques (pdf.js), OCR des photos et des
-- PDF scannés (tesseract.js, français), une facture à la fois, hors du fil
-- principal.
--
-- fin_extractions : une pièce importée (fichier privé + empreinte SHA-256), le
-- texte lu et les champs proposés (JSON, avec un niveau de confiance par champ).
-- Statuts : en_cours → a_verifier (ou echec) → utilisee (une facture brouillon a
-- été créée APRÈS vérification humaine) ou abandonnee. Aucune facture n'est
-- jamais créée sans validation humaine.
--
-- Additive et idempotente. Retour arrière : 082_retour_arriere.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS fin_extractions (
  id              BIGSERIAL     PRIMARY KEY,
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fichier_chemin  TEXT          NOT NULL,                     -- relatif au stockage privé (073)
  fichier_nom     TEXT          NOT NULL CHECK (length(fichier_nom) <= 200),
  mime            TEXT          NOT NULL CHECK (mime IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  taille          INTEGER       NOT NULL CHECK (taille > 0),
  sha256          TEXT          NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  statut          TEXT          NOT NULL DEFAULT 'en_cours'
                                CHECK (statut IN ('en_cours', 'a_verifier', 'echec', 'utilisee', 'abandonnee')),
  moteur          TEXT          NOT NULL DEFAULT '' CHECK (moteur IN ('', 'texte_pdf', 'ocr_image', 'ocr_pdf')),
  texte           TEXT          NOT NULL DEFAULT '',
  confiance_ocr   NUMERIC(5,2),
  champs          JSONB         NOT NULL DEFAULT '{}'::jsonb,
  message         TEXT          NOT NULL DEFAULT '' CHECK (length(message) <= 500),
  facture_id      BIGINT        REFERENCES fin_factures(id) ON DELETE SET NULL,
  cree_par        UUID          REFERENCES users(id) ON DELETE SET NULL,
  cree_le         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  traite_le       TIMESTAMPTZ,
  duree_ms        INTEGER,
  CHECK (statut <> 'utilisee' OR facture_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_fin_extractions ON fin_extractions (tenant_id, cree_le DESC);
CREATE INDEX IF NOT EXISTS idx_fin_extractions_sha ON fin_extractions (tenant_id, sha256);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_extractions_facture ON fin_extractions (facture_id) WHERE facture_id IS NOT NULL;

INSERT INTO permissions(code, nom, module, description) VALUES
  ('finance.achats.importer', 'Importer des factures fournisseurs', 'finance',
   'Déposer une facture (PDF ou photo) pour lecture automatique, puis vérifier les champs proposés avant de créer la facture')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, 'finance.achats.importer' FROM roles r
 WHERE r.code IN ('directeur', 'auditeur', 'comptable_cabinet', 'caissier') AND r.tenant_id IS NULL AND r.is_system
ON CONFLICT DO NOTHING;

INSERT INTO tenant_permissions(tenant_id, permission_code)
SELECT DISTINCT tp.tenant_id, 'finance.achats.importer' FROM tenant_permissions tp WHERE tp.permission_code = 'journal.view'
ON CONFLICT DO NOTHING;
