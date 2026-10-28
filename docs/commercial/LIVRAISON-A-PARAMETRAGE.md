# NJ COMMERCIAL — Livraison A : paramétrage des achats

28/10/2026 · branche `module/commercial` · conception : document « NJ COMMERCIAL — Achats : diagnostic et conception ».

## Ce qui est livré

- Module **NJ COMMERCIAL** opérationnel, activé **client par client** (Administration plateforme → fiche client → Modules).
- Écrans : Démarrage, Société, Magasins, Familles d'articles (avec fournisseurs), Articles (suivi comptable, fournisseurs, magasins, stock d'ouverture), Fournisseurs, Clients, Taxes, Utilisateurs et rôles.
- Rôle de base **Collaborateur** : utilisateur sans aucun droit de caisse (demandeur, magasinier).
- À l'activation du module chez un client, trois profils métier sont créés : Demandeur achats, Gestionnaire des achats (GAS), Responsable des achats. Le directeur a tous les droits du module.

Pas encore livré (livraisons B et C) : demandes d'achat, circuit d'autorisation et notifications, bons de commande, PDF, QR code, proformas.

## Migration 050 (`db/migrations/050_commercial_parametrage.sql`)

| Objet | Effet |
| --- | --- |
| 11 tables `com_*` | Paramètres, magasins, familles, liens famille-fournisseur, extension achats des tiers, coordonnées bancaires, taxes, articles, liens article-fournisseur et article-magasin, mouvements de stock |
| `com_meme_client()` + déclencheurs | La base refuse tout lien entre deux clients |
| `users_role_check`, contrainte `roles_autorises` | Élargies à `collaborateur` (aucune valeur existante n'est refusée) |
| `roles` | Rôle système `collaborateur` |
| `permissions` / `role_permissions` | 17 permissions `com.*` ; directeur : toutes ; comptable : consultation ; collaborateur : demandeur |
| `modules` | `commercial` → opérationnel, préfixe d'API `/commercial` |

Aucune table de NJ CAISSE PRO n'est modifiée ni vidée. Migration rejouable sans effet.

Retour arrière : `db/migrations-retour-arriere/050_retour_arriere.sql`. Il refuse de s'exécuter tant qu'un utilisateur a le rôle collaborateur.

## Règles appliquées par le serveur

- Codes et références uniques par client, sans tenir compte de la casse.
- Article : famille et suivi comptable (oui/non) obligatoires. Un article qui a du stock ou figure dans un document ne se supprime pas, il se désactive.
- Stock calculé uniquement à partir des mouvements. Sans mouvement : « non suivi », jamais 0. Seul le stock d'ouverture peut être saisi ; il reste corrigeable tant qu'aucun autre mouvement n'existe.
- Fournisseurs et clients : registre des tiers commun avec la caisse. Les coordonnées bancaires ne sont visibles et modifiables qu'avec `com.tiers.banque`, et le journal d'audit ne garde que les 4 derniers caractères du RIB.
- Un client qui a des articles ou du stock ne peut plus être supprimé depuis l'Administration plateforme.
- Toute création ou modification est tracée dans `audit_log` (entité `commercial`).

## Tests

- `tests/commercial-parametrage.test.js` : 12 tests (droits, isolation entre clients, doublons, suivi comptable, stock, banque, audit, activation et profils).
- Suite complète : 97 tests sur 97.
- Trois attentes anciennes ont été mises à jour, car les changements sont voulus : NJ COMMERCIAL est maintenant opérationnel, le rôle collaborateur fait partie de « tous les rôles », et le test « module en préparation » utilise NJ DSF.
- Parcours réel dans le navigateur (directeur, demandeur, téléphone, retour à la caisse) : 24 contrôles sur 24, aucune erreur JavaScript.

## Déploiement

1. Backend : déployer, puis `node db/migrate.js` (applique la 050), puis redémarrer.
2. Frontend : `frontend/dist` (v42) dans `public_html`.
3. Administration plateforme → client → Modules → activer NJ COMMERCIAL (motif), d'abord sur un client de test.
