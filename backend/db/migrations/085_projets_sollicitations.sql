-- ============================================================================
-- 085 — Gestion des activités : décaissement et solde de la caisse (26/11/2026).
--
-- Constat de Franck : la caissière pouvait lancer un décaissement sans voir que
-- la caisse n'avait pas l'argent. Décision : quand le solde ne suffit pas, le
-- manque passe par la DEMANDE DE FONDS de Caisse Pro (ligne de « dépenses en
-- attente » de la période en cours), que le directeur valide comme aujourd'hui,
-- avec un mail à chaque étape.
--
-- projet_demande_sollicitations : trace du lien demande de fonds d'activité →
-- ligne de la Demande de fonds de la caisse (période, rubrique, montant).
-- Additive et idempotente. Retour arrière : 085_retour_arriere.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS projet_demande_sollicitations (
  id                  BIGSERIAL     PRIMARY KEY,
  tenant_id           UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  demande_id          BIGINT        NOT NULL REFERENCES projet_demandes_fonds(id) ON DELETE CASCADE,
  journal_id          INTEGER       NOT NULL REFERENCES journaux(id),
  rubrique_code       TEXT          NOT NULL,
  montant             NUMERIC(15,2) NOT NULL CHECK (montant > 0),
  solde_constate      NUMERIC(15,2) NOT NULL,
  mois                TEXT          NOT NULL,
  annee               INTEGER       NOT NULL,
  semaine             SMALLINT      CHECK (semaine IS NULL OR semaine BETWEEN 1 AND 6),
  depense_attente_id  INTEGER       REFERENCES depenses_attente(id) ON DELETE SET NULL,
  demandee_par        UUID          REFERENCES users(id) ON DELETE SET NULL,
  demandee_le         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_demande_sollicitations ON projet_demande_sollicitations (tenant_id, mois, annee, semaine);
CREATE INDEX IF NOT EXISTS idx_demande_sollicitations_demande ON projet_demande_sollicitations (demande_id);
