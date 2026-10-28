-- ── 036 — Validation directe sur le formulaire public de demande de démo ──
--  La validation par code se fait sur la page publique « Demander une
--  démonstration » : le commercial autorisé saisit son identifiant et son code
--  personnel, la demande est acceptée immédiatement (prospect créé, attribué,
--  démo ouverte). Les codes, la permission et le journal de la migration 035
--  sont réutilisés tels quels.
--  Les colonnes prospects.demo_validation_demandee_le / _par (035) ne servent
--  plus : conservées (sans effet), aucune suppression de données.
-- Idempotente.

-- Libellé de la demande (entreprise <e-mail>) : une tentative échouée sur le
-- formulaire n'a pas encore de fiche prospect à laquelle se rattacher.
ALTER TABLE prospect_validations ADD COLUMN IF NOT EXISTS prospect_libelle TEXT NOT NULL DEFAULT '';
