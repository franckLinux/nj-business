-- ============================================================================
-- 061 — Registre des écarts de caisse (09/11/2026)
--
-- Contrôle comptable → « Écarts de caisse ».
--
-- Le comptable CONSTATE un écart entre le solde théorique d'un journal et le
-- solde réellement compté (arrêté de caisse, inventaire validé, ou comptage
-- ponctuel), puis en décide la DESTINATION :
--   écart négatif (manquant) : imputé au caissier, à un tiers, perte (charge)
--                              ou en attente d'investigation ;
--   écart positif (excédent) : produit, à restituer à un tiers identifié, ou
--                              en attente d'investigation.
--
-- 1. rubriques.est_ecart_caisse : deux rubriques SYSTÈME par client, créées à
--    la demande par l'application :
--      ECP « ÉCART DE CAISSE — EXCÉDENT »  (entrée)
--      ECN « ÉCART DE CAISSE — MANQUANT »  (dépense)
--    compte comptable par défaut 471 (comptes d'attente), modifiable par la
--    passerelle. Elles ne se choisissent pas à la saisie du journal : seule
--    la constatation d'un écart les utilise (contrôle côté serveur).
-- 2. ecarts_caisse : le registre. Chaque constat passe UNE écriture dans le
--    journal (rubrique ECP ou ECN) pour que le solde du journal rejoigne le
--    solde compté. L'écriture suit les règles de toute écriture : période
--    ouverte, ordre chronologique, caisse jamais négative. Elle est exemptée
--    du contrôle budgétaire (un écart n'est pas une dépense prévue).
--    Destination : code + compte (reclassement 471 → compte de destination à
--    passer en comptabilité), responsable / tiers, suivi du recouvrement.
--    Statuts : constate → affecte (destination à suivre : recouvrement,
--    restitution, investigation) → solde ; ou annule (contre-passation de
--    l'écriture, motif obligatoire).
-- 3. Droits : aucune nouvelle permission. Lecture controle.view ; constat,
--    affectation, régularisation controle.saisir ; annulation
--    controle.reouvrir (mêmes profils que les arrêtés & inventaires, 046).
-- Idempotente.
-- ============================================================================

-- ── 1. Rubriques système des écarts ─────────────────────────────────────────
ALTER TABLE rubriques ADD COLUMN IF NOT EXISTS est_ecart_caisse BOOLEAN NOT NULL DEFAULT false;

-- ── 2. Registre ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ecarts_caisse (
  id                 BIGSERIAL     PRIMARY KEY,
  tenant_id          UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  numero             TEXT          NOT NULL,                       -- ECA-2026-0001
  journal_id         INTEGER       NOT NULL REFERENCES journaux(id) ON DELETE RESTRICT,
  origine            TEXT          NOT NULL CHECK (origine IN ('arret', 'inventaire', 'comptage')),
  origine_id         BIGINT,                                       -- controles_arrets.id | inventaires_lignes.id
  periode_mois       TEXT,                                         -- mois de l'arrêté d'origine (arret)
  periode_annee      INTEGER,
  date_constat       DATE          NOT NULL,
  solde_theorique    NUMERIC(15,2) NOT NULL,
  solde_constate     NUMERIC(15,2) NOT NULL,
  montant            NUMERIC(15,2) NOT NULL CHECK (montant <> 0),  -- constaté − théorique
  sens               TEXT          NOT NULL CHECK (sens IN ('excedent', 'manquant')),
  cause              TEXT          NOT NULL DEFAULT '' CHECK (length(cause) <= 2000),
  -- Écriture passée dans le journal (rubrique ECP / ECN).
  mouvement_id       BIGINT        REFERENCES journal(id) ON DELETE SET NULL,
  date_ecriture      DATE          NOT NULL,
  -- Destination de l'écart.
  statut             TEXT          NOT NULL DEFAULT 'constate'
                                   CHECK (statut IN ('constate', 'affecte', 'solde', 'annule')),
  destination        TEXT          CHECK (destination IN ('caissier', 'tiers', 'charge', 'produit', 'restitution', 'attente')),
  compte_destination TEXT          NOT NULL DEFAULT '',
  compte_attente     TEXT          NOT NULL DEFAULT '',            -- compte de la rubrique au moment du constat
  responsable_nom    TEXT          NOT NULL DEFAULT '' CHECK (length(responsable_nom) <= 200),
  responsable_id     UUID          REFERENCES users(id) ON DELETE SET NULL,
  observation        TEXT          NOT NULL DEFAULT '' CHECK (length(observation) <= 2000),
  -- Régularisation (recouvrement, restitution, issue de l'investigation).
  regularisation_date DATE,
  regularisation_mode TEXT         NOT NULL DEFAULT '' CHECK (length(regularisation_mode) <= 100),
  regularisation_ref  TEXT         NOT NULL DEFAULT '' CHECK (length(regularisation_ref) <= 200),
  regularisation_obs  TEXT         NOT NULL DEFAULT '' CHECK (length(regularisation_obs) <= 1000),
  -- Traçabilité.
  constate_par       UUID          REFERENCES users(id) ON DELETE SET NULL,
  constate_le        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  affecte_par        UUID          REFERENCES users(id) ON DELETE SET NULL,
  affecte_le         TIMESTAMPTZ,
  solde_par          UUID          REFERENCES users(id) ON DELETE SET NULL,
  solde_le           TIMESTAMPTZ,
  annule_par         UUID          REFERENCES users(id) ON DELETE SET NULL,
  annule_le          TIMESTAMPTZ,
  motif_annulation   TEXT          NOT NULL DEFAULT '',
  UNIQUE (tenant_id, numero),
  CONSTRAINT ck_ecart_sens CHECK ((montant > 0 AND sens = 'excedent') OR (montant < 0 AND sens = 'manquant')),
  CONSTRAINT ck_ecart_destination_sens CHECK (
    destination IS NULL
    OR (sens = 'manquant' AND destination IN ('caissier', 'tiers', 'charge', 'attente'))
    OR (sens = 'excedent' AND destination IN ('produit', 'restitution', 'attente')))
);
CREATE INDEX IF NOT EXISTS idx_ecarts_caisse_tenant ON ecarts_caisse (tenant_id, date_constat DESC);
CREATE INDEX IF NOT EXISTS idx_ecarts_caisse_journal ON ecarts_caisse (tenant_id, journal_id);
-- Un même arrêté / une même ligne d'inventaire ne donne qu'un écart actif.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ecarts_caisse_origine
  ON ecarts_caisse (tenant_id, origine, origine_id)
  WHERE origine_id IS NOT NULL AND statut <> 'annule';

-- Le journal appartient au même client (fonction de la 046).
DROP TRIGGER IF EXISTS trg_ecarts_caisse_meme_client ON ecarts_caisse;
CREATE TRIGGER trg_ecarts_caisse_meme_client
  BEFORE INSERT OR UPDATE OF journal_id, tenant_id ON ecarts_caisse
  FOR EACH ROW EXECUTE FUNCTION controle_journal_meme_client();
