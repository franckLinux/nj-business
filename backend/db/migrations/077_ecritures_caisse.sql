-- ============================================================================
-- 077 — NJ FINANCE, lot F3 : les mouvements de caisse produisent leurs écritures
--
--  Chaque mouvement du journal de caisse (table journal) donne UNE écriture
--  (origine_type = 'journal', origine_id = journal.id), générée par
--  services/comptabilite/generation_caisse.service.js :
--    D trésorerie / C contrepartie pour une entrée, l'inverse pour une sortie ;
--    contrepartie = compte validé de la rubrique (ou compte corrigé par le
--    comptable), compte des virements internes pour un virement.
--  L'écriture est au brouillard tant que l'arrêté de la caisse du mois n'est
--  pas validé, puis validée (par le directeur qui a validé l'arrêté).
--  Si le mouvement change ensuite, l'écriture validée est extournée et
--  remplacée : jamais modifiée.
--
--  1. fin_ecritures.origine_empreinte : empreinte des données de la source au
--     moment de la génération (détecte un mouvement modifié).
--  2. Index pour retrouver vite les mouvements à traiter.
--
--  Le journal de caisse n'est NI lu NI modifié par cette migration.
--  Retour arrière : db/migrations-retour-arriere/077_retour_arriere.sql
-- ============================================================================

ALTER TABLE fin_ecritures ADD COLUMN IF NOT EXISTS origine_empreinte TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_journal_tenant_date ON journal (tenant_id, date);
CREATE INDEX IF NOT EXISTS idx_fin_ecritures_origine ON fin_ecritures (tenant_id, origine_type, origine_id)
  WHERE origine_id IS NOT NULL;
