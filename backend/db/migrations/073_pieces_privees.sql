-- ============================================================================
-- 073 — Pièces justificatives privées (audit sécurité du 20/11/2026, S36)
--
-- Les pièces jointes aux écritures étaient servies en statique sur /uploads/… :
-- quiconque connaissait le lien pouvait télécharger une facture ou un reçu sans
-- être connecté. Désormais le dossier n'est plus exposé ; une pièce ne sort que
-- par GET /api/pieces/fichier/:id (jeton valide, même client, pieces.view).
--
-- Les fichiers restent où ils sont sur le disque (aucun déplacement) : seule
-- l'adresse enregistrée en base change. Aucune donnée de caisse n'est touchée.
-- Idempotent : rejouer la migration ne modifie plus rien.
-- Retour arrière : db/migrations-retour-arriere/073_retour_arriere.sql
-- ============================================================================
UPDATE pieces_jointes
   SET storage_url = '/api/pieces/fichier/' || id
 WHERE storage_url IS DISTINCT FROM '/api/pieces/fichier/' || id;
