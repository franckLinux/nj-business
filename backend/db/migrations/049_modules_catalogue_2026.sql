-- ============================================================================
-- 049 — NJ BUSINESS : nouveau catalogue des modules (28/10/2026)
--
--  Demande : NJ COMMERCIAL (achats, ventes ET stock), NJ DSF, NJ REVIS,
--  NJ CG (contrôle de gestion), en plus des modules existants.
--
--    • NJ COMMERCIAL couvre désormais le stock : le module séparé « stock »
--      passe au statut « retire » (il n'a jamais été activable : il était
--      « en préparation », aucun client ne l'utilise). Rien n'est supprimé.
--    • NJ DSF, NJ REVIS, NJ CG sont ajoutés « en préparation » : visibles sur
--      l'accueil comme « bientôt disponibles », non activables tant que leur
--      code n'est pas livré (décision D2 de la 048).
--    • NJ CAISSE PRO, NJ COMPTABILITÉ, NJ RH : inchangés (seul l'ordre
--      d'affichage est revu).
--
--  Aucune table, colonne ou contrainte n'est créée, modifiée ou supprimée.
--  Idempotente. Retour arrière : 049_retour_arriere.sql
-- ============================================================================

UPDATE modules
   SET nom = 'NJ COMMERCIAL',
       description = 'Achats, ventes, facturation et gestion des stocks',
       updated_at = NOW()
 WHERE code = 'commercial';

-- Fusionné dans NJ COMMERCIAL. Garde-fou : on ne retire pas un module qu'un
-- client utiliserait réellement (statut opérationnel + activé).
UPDATE modules
   SET statut = 'retire',
       description = 'Intégré à NJ COMMERCIAL (achats, ventes et stock)',
       updated_at = NOW()
 WHERE code = 'stock'
   AND statut = 'en_preparation'
   AND NOT EXISTS (SELECT 1 FROM tenant_modules tm WHERE tm.module_code = 'stock' AND tm.actif);

INSERT INTO modules (code, nom, description, icone, statut, route_accueil, prefixes_api, par_defaut, ordre) VALUES
  ('cg',    'NJ CG',    'Contrôle de gestion : budgets, tableaux de bord, indicateurs et analyse des écarts',
   'cg',    'en_preparation', '/', '{}', false, 45),
  ('dsf',   'NJ DSF',   'Déclaration Statistique et Fiscale : liasse SYSCOHADA, annexes et contrôles de cohérence',
   'dsf',   'en_preparation', '/', '{}', false, 55),
  ('revis', 'NJ REVIS', 'Révision des comptes : dossier de travail, cycles, feuilles maîtresses et points de révision',
   'revis', 'en_preparation', '/', '{}', false, 60)
ON CONFLICT (code) DO NOTHING;

-- Ordre d'affichage : Caisse, Commercial, Comptabilité, CG, DSF, Revis, RH.
UPDATE modules SET ordre = 70, updated_at = NOW() WHERE code = 'rh' AND ordre <> 70;
