# NJ COMMERCIAL — Lots 1 et 2 : menus, tableau de bord, agences, familles

02/11/2026 · branche `module/commercial` · migration 054 · frontend v46.
Plan de référence : « NJ COMMERCIAL — Achats, Ventes, Stock : audit et architecture » (Claude Doc). Les 8 décisions proposées dans ce plan sont appliquées telles quelles.

## Lot 1 — Menu en quatre rubriques et tableau de bord

- **Menu** :
  - **Tableau de bord** ;
  - **Configuration** : Mise en route, Société, Agences, Magasins, Familles, Articles, Fournisseurs, Clients, Taxes, Utilisateurs et rôles ;
  - **Traitements → Achats** : Expressions de besoin, Bons de commande ;
  - **Contrôles et reporting** : Autorisations d'achat, Documents justificatifs, Historique.
- **Entrées du menu** : une entrée n'apparaît qu'avec sa permission. Les entrées Ventes et Stock n'existent pas encore : aucun lien vide.
- **Entrée du module** : le tableau de bord pour qui le voit, sinon les expressions de besoin, sinon la mise en route.
- **Tableau de bord commercial** : filtres période, agence et magasin, limités au périmètre de la personne. Les chiffres ne portent que sur des documents réels. La section Achats est en place ; les ventes et le stock s'ajouteront à leur lot.
- **Demandes d'achat** : elles s'appellent désormais « Expressions de besoin » dans le menu. Leur numérotation DA ne change pas.

## Lot 2 — Agences, magasins, familles, taxes, périmètre

| Sujet | Ce qui change |
| --- | --- |
| Agences | Nouvel écran : code, nom, adresse, responsable, statut, magasins rattachés. Une agence se désactive (jamais supprimée), seulement quand ses magasins sont inactifs. |
| Magasins | Agence de rattachement obligatoire. Le premier magasin d'un client crée l'agence « SIEGE ». Un magasin qui a déjà servi (stock, demandes, bons) ne change plus d'agence. |
| Familles | Taxe d'achat, taxe de vente, suivi en stock (oui / non), méthode de valorisation (CMUP / FIFO). |
| Articles | À la création, la famille fournit ces paramètres, que l'on peut modifier sur l'article. Modifier la famille ne touche pas les articles existants. La taxe existante devient la taxe d'achat ; la taxe de vente n'est jamais copiée d'office. |
| Taxes | Usage : achats, ventes ou les deux. Une taxe « ventes » est refusée sur un bon de commande ou comme taxe d'achat. Une taxe ne peut pas perdre un usage déjà employé. |
| Stock | Un article non suivi en stock n'accepte pas de stock d'ouverture. Un article qui a du stock reste suivi. |
| Périmètre | Configuration → Utilisateurs et rôles → « Modifier » sur la ligne d'une personne. Sans agence cochée, elle voit tout. Avec des agences cochées, le serveur ne lui laisse que les demandes, bons, stocks, chiffres, documents, historique et notifications des magasins de ces agences. |

Unités et conversions : lot 3, comme prévu dans le plan.

## Migration 054 (`db/migrations/054_commercial_agences_familles.sql`)

| Objet | Effet |
| --- | --- |
| `com_agences` | Nouvelle table ; agence « SIEGE » créée pour chaque client qui a déjà des magasins |
| `com_magasins.agence_id` | Obligatoire ; les magasins existants sont rattachés au SIEGE |
| `com_familles` | `taxe_achat_id`, `taxe_vente_id`, `suivi_stock` (oui), `methode_valorisation` (cmup) |
| `com_articles` | `taxe_vente_id`, `suivi_stock` (oui), `methode_valorisation` (cmup) ; `taxe_id` = taxe d'achat |
| `com_taxes.usage` | `les_deux` pour l'existant |
| `com_utilisateur_agences` | Périmètre par personne |
| Déclencheurs | Même client pour les agences, magasins, taxes des familles et articles, et le périmètre |

La migration est additive et rejouable. Le retour arrière (`054_retour_arriere.sql`) refuse de s'exécuter dès qu'un client a plusieurs agences ou qu'une taxe de vente a été choisie.

## Tests

- **`tests/commercial-agences.test.js`** : 9 tests.
  - Agence SIEGE automatique, puis choix imposé dès qu'il y a deux agences.
  - Désactivation d'une agence bloquée tant qu'un de ses magasins est actif.
  - Familles et héritage par l'article ; usage des taxes ; suivi en stock.
  - Magasin utilisé qui ne change plus d'agence.
  - Périmètre (lecture, saisie, listes, à commander, tableau de bord et filtres, compteur du menu, historique).
  - Taxe de vente refusée sur un bon de commande ; isolation entre clients.
- **Suite complète** : 135 tests, tous passés.
  - Le nettoyage des tests est devenu « tout ou rien » : un client de test qui ne peut pas être supprimé garde ses modules.
- **Parcours dans le navigateur** :
  - lots 1 et 2 : 24 contrôles, dont l'affichage sur téléphone sans débordement ;
  - non-régression : paramétrage 24, demandes 21, bons 33.

## Déploiement

1. Backend : remplacer le dossier `src/` du serveur, puis lancer `node db/migrate.js` (migration 054).
2. Frontend : déployer `dist-nj-business-v46.zip`.
3. Redémarrer l'application.

Ce lot n'ajoute aucune bibliothèque. Si la livraison C n'a pas encore été déployée, lancer aussi `npm install` (pour `pdfkit` et `qrcode`).
