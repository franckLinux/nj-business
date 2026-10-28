-- ── 039 — Activité / projet obligatoire, personne par personne (octobre 2026)
--  Le directeur peut exiger d'un utilisateur qu'il rattache CHAQUE opération
--  qu'il saisit à une activité / un projet (034). Réglage individuel, comme le
--  rattrapage (033) ; il s'active depuis Configuration → Utilisateurs.
--  Concernées : dépenses et recettes. Exemptées : virements internes (aucune
--  activité) et report à nouveau (saisie distincte). Sans aucune activité
--  active dans le client, la règle reste sans effet (rien à choisir).
--  Le contrôle est fait par l'API (création et modification d'une écriture),
--  l'écran de saisie ne fait que l'annoncer.
-- Idempotente.

ALTER TABLE users ADD COLUMN IF NOT EXISTS activite_obligatoire BOOLEAN NOT NULL DEFAULT false;
