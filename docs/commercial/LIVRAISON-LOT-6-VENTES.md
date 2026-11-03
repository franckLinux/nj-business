# NJ COMMERCIAL — Lot 6 : ventes (devis, commandes clients, livraisons)

Branche `module/commercial` · migration **059** · service worker **v55**.

## Circuit

```
Devis (commercial) ──soumis──▶ responsable commercial ──▶ [direction si seuil ou remise] ──▶ Validé
        │                                                                               │
        └── renvoi motivé ◀──────────────────────────────────────────────────────────────┤
                                                                                        ▼
                          Refusé par le client ◀── réponse du client ──▶ Accepté → Commande client
                                                                                        │
                                       une ou plusieurs préparations / livraisons ◀─────┘
                                       En préparation → Préparée → Livrée (le stock sort)
```

| Étape | Qui (permission) | Règle |
|---|---|---|
| Devis | `com.ventes.devis` | Prix par défaut = prix de vente indicatif, converti dans l'unité choisie ; remise et taxe de vente par ligne ; validité par défaut 30 jours. |
| Validation responsable | `com.ventes.valider` | Jamais l'auteur (sauf auto-validation activée). |
| Validation direction | `com.ventes.valider_direction` | Exigée si TTC > **1 000 000** ou si une remise > **10 %** (paramètres `ventes_seuil_direction`, `ventes_remise_max_pct`). Une personne qui a les deux droits valide les deux niveaux d'un coup. |
| Réponse du client | `com.ventes.commandes` | Acceptation tant que la date de validité n'est pas dépassée ; sinon « Dupliquer ». Refus motivé. |
| Commande client | `com.ventes.commandes` | Copie figée des lignes et prix du devis ; référence et pièce du bon de commande du client. Un devis donne au plus une commande. |
| Préparation | `com.ventes.preparer` | Quantités prélevées au magasin (périmètre de la personne) ; jamais au-delà du reste à livrer ; stock insuffisant refusé. |
| Validation de la livraison | `com.ventes.livrer` | Jamais le préparateur (sauf auto-validation). Écrit les mouvements « Livraison client » au coût du moteur (CMUP du moment ou lots FIFO). Les prestations (sans suivi de stock) ne bougent pas le stock. |
| Annulation | `com.ventes.annuler` | Motivée. Livraison annulée : mouvements neutralisés, la marchandise rentre. Commande : seulement sans livraison active. Devis accepté : on annule la commande. |

## PDF

- **Devis « bon pour accord »** : prix, remises, taxes, montant en lettres, date de validité, zone de signature et cachet du client. Filigrane « PROJET — NON VALABLE » tant qu'il n'est pas validé.
- **Bon de livraison** : sans aucun prix ; commandé, livré, reste ; signatures du magasin, du transporteur et du client. Filigrane tant que la livraison n'est pas validée.
- Pas de QR code ni de page publique pour ces pièces.

## Profils

- **Commercial (ventes)** `ventes_commercial` : consulter, devis, commandes (+ articles, tiers, stock en lecture).
- **Responsable commercial** `ventes_responsable` : + validation des devis, des livraisons, annulation, tableau de bord.
- **Magasinier** : + consulter et préparer les livraisons.
- **Gestionnaire de stock** : + préparer et valider les livraisons.
- **Directeur** : tous les droits, dont la validation de direction.

Les profils sont créés pour les clients où NJ COMMERCIAL est déjà actif (migration) et à toute nouvelle activation.

## Base de données (059, purement additive)

- Tables `com_devis`, `com_devis_lignes`, `com_commandes_clients`, `com_commande_client_lignes`, `com_livraisons`, `com_livraison_lignes`.
- Déclencheurs d'intangibilité (`VENTE_INTANGIBLE`) : devis figé dès la soumission, commande jamais modifiée (annulation motivée seulement), livraison validée intangible sauf annulation motivée ; lignes figées.
- Déclencheur « même client » sur toutes les tables et sur `com_documents`.
- Compteurs `DEV`, `CDC`, `BLC` ; pièces `devis`, `commande_client`, `livraison`.
- `com_parametres` : `ventes_seuil_direction` (1 000 000), `ventes_remise_max_pct` (10), `devis_validite_jours` (30). Valeurs non exposées à l'écran dans ce lot.
- Retour arrière : `db/migrations-retour-arriere/059_retour_arriere.sql` — refuse de s'exécuter si un devis a été soumis, une commande créée ou une livraison validée.

Aucune table existante n'est modifiée hormis les listes autorisées (`com_documents.objet_type`, `com_compteurs.type`) et trois colonnes ajoutées à `com_parametres`. Aucune écriture comptable. La facture client (lot 7) et son règlement dans NJ CAISSE PRO ne sont **pas** livrés ici.

## Écrans

Menu « Ventes » (Devis, Commandes clients, Livraisons avec badge « à livrer ») et « Validation des ventes » dans Validations. Utilisateurs et rôles : onglet « Droits ventes » ; profils métier : bloc « NJ COMMERCIAL — Ventes ».

## Vérifications

- Tests automatiques : `tests/commercial-ventes.test.js` (6 scénarios, valeurs calculées à la main) ; suite complète 166/166.
- Parcours réel dans le navigateur (commercial → responsable → commercial → magasinier → gestionnaire de stock) : 23/23, sans erreur JavaScript, sans défilement horizontal sur téléphone.

## Déploiement

1. Sauvegarde vérifiée de la base.
2. `node db/migrate.js` (applique 059).
3. Redémarrer le backend ; déployer le `dist` v55.
