-- ============================================================================
--  011 — Identité légale du tenant + code comptable des rubriques
-- ============================================================================
--  ORIGINE : ces colonnes n'existaient que dans la migration sequelize-cli
--  migrations/20260806000001-formalise-colonnes-rubriques-tenants.js, jamais
--  jouée en production — `runSetup()` (CLI comme HTTP) n'exécute QUE les
--  fichiers .sql de ce dossier. Conséquence sur toute base fraîchement
--  déployée, vérifiée sur PostgreSQL 14 :
--
--      Tenant.findAll()    → ERREUR : column "sigle" does not exist
--      Rubrique.findAll()  → ERREUR : column "code_comptable" does not exist
--
--  soit les écrans Configuration et Rubriques en 500 dès la première ouverture.
--  Le seed de configuration, lui, ne signalait rien : seed-config.lib.js filtre
--  les clés sur les colonnes réellement présentes, si bien que l'identité légale
--  du cabinet (NUI, registre de commerce, sigle) et les codes comptables des
--  rubriques étaient écartés en silence, l'étape rapportant « ok ».
--
--  Cette migration porte ce contenu dans le chemin d'exécution réel. La
--  migration Sequelize correspondante est devenue un no-op documenté.
--
--  Idempotente (ADD COLUMN IF NOT EXISTS) : sans effet sur une base de
--  développement qui possède déjà ces colonnes.
-- ============================================================================

-- Code comptable SYSCOHADA porté par la rubrique (ex. 6015, 6181, 6053).
ALTER TABLE rubriques ADD COLUMN IF NOT EXISTS code_comptable TEXT DEFAULT '';

-- Identité légale et administrative du tenant, telle qu'elle figure sur les
-- états imprimés (compte d'emploi, arrêté de caisse, export SAGE).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS caissier_nom      TEXT DEFAULT '';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS directeur_nom     TEXT DEFAULT '';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS exercice_debut    DATE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS exercice_fin      DATE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS sigle             TEXT DEFAULT '';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS forme_juridique   TEXT DEFAULT '';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS adresse           TEXT DEFAULT '';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS registre_commerce TEXT DEFAULT '';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS boite_postale     TEXT DEFAULT '';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS nui               TEXT DEFAULT '';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS activite          TEXT DEFAULT '';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS dirigeant_nom     TEXT DEFAULT '';

-- Reprise : `dirigeant_nom` succède à `directeur_nom` sur les états imprimés.
-- On ne recopie que si la cible est vide, pour ne jamais écraser une saisie.
UPDATE tenants
   SET dirigeant_nom = directeur_nom
 WHERE COALESCE(dirigeant_nom, '') = ''
   AND COALESCE(directeur_nom, '') <> '';
