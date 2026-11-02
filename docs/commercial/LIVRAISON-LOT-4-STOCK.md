# NJ COMMERCIAL — Lot 4 : moteur de stock

02/11/2026 · branche `module/commercial` · migration 056 · frontend v48.

## Ce qui est livré

**Menu Traitements → Stock**
- **État du stock** : quantité, coût unitaire et valeur par article et par magasin.
  - Filtres par magasin, famille, articles sous le seuil d'alerte et stock sans coût.
  - Un clic sur une ligne ouvre ses mouvements.
- **Entrées en stock**, **Sorties diverses**, **Transferts**, **Inventaires**.
  - Chaque type a sa liste, son formulaire et sa fiche.
  - Numéros par client et par année : ENT-2026-0001, SOR-…, TRF-…, INV-….

**Menu Contrôles**
- **Validation des stocks** : les documents qui attendent un valideur. Le menu affiche un badge.
- **Mouvements de stock** : le journal complet. Les mouvements annulés y restent, marqués « Annulé ».
- **Valorisation du stock** : la valeur par magasin, le total et les lignes sans coût.

**Autres écrans**
- **Fiche article → stock d'ouverture** : nouveau champ « coût unitaire », facultatif. Sans coût, la ligne est « à valoriser ». Ce coût peut être complété plus tard, même après d'autres mouvements.
- **Société → Règles du stock** :
  - stock négatif : refusé par défaut ;
  - auto-validation par l'auteur : interdite par défaut.
- **Tableau de bord** : nouveau bloc Stock (valeur, articles sous le seuil, documents à valider, lignes sans coût).

## Circuit d'un document

```
brouillon ──soumettre──▶ à valider ──valider──▶ validé ──annuler (motif)──▶ annulé
                          │
                          └──renvoyer (motif)──▶ brouillon
```

- **Saisie et soumission** : permission `com.stock.mouvements`.
- **Validation, renvoi, annulation** : permission `com.stock.valider`.
- **Séparation des tâches** : la personne qui a saisi un document ne peut pas le valider. Seule exception, l'auto-validation activée dans Société ; chaque validation reste alors tracée.
- **Validation** : c'est la seule étape qui fait bouger le stock. Enregistrer ou soumettre ne change rien.
- **Pièces justificatives** : PV de casse, feuille de comptage… Elles se joignent tant que le document n'est pas validé.
- **Document validé** : il ne se modifie plus et ne se supprime plus ; il peut seulement être annulé, avec un motif. Les déclencheurs de la base l'imposent.
- **Annulation** :
  - les mouvements restent, marqués annulés, et la valorisation est recalculée ;
  - elle est refusée si un stock devenait négatif, c'est-à-dire si la marchandise a déjà servi.
- **Périmètre** : chaque personne ne voit et ne saisit que les magasins de ses agences. Pour un transfert, cela vaut pour les deux magasins.

## Règles de valorisation

La méthode est celle de l'article, proposée par sa famille : **CMUP** ou **FIFO**. Les coûts sont exprimés par unité de stock.

| Mouvement | Coût retenu |
| --- | --- |
| Stock d'ouverture, entrée diverse | Le coût saisi (une entrée sans coût est refusée ; un stock d'ouverture sans coût est « à valoriser ») |
| Sortie diverse, manquant d'inventaire, départ de transfert | CMUP du moment, ou lots FIFO du plus ancien au plus récent |
| Arrivée de transfert | **Exactement** le coût de sortie du magasin de départ. Un transfert ne crée aucun coût d'achat. |
| Excédent d'inventaire | Le dernier coût connu de l'article dans le magasin |

- **Inventaire** :
  - le stock théorique est relevé **au moment de la validation** ;
  - seul l'écart (compté − théorique) devient un mouvement ;
  - tant que l'inventaire n'est pas validé, il n'a aucun effet.
- **Changement de méthode** : il est refusé dès qu'un mouvement valorisé existe (règle déjà en place depuis le lot 1). Rien n'est recalculé en silence.
- **Recalcul** : la valorisation est rejouée article par article, dans l'ordre des validations, à chaque validation ou annulation. Les soldes, lots FIFO et consommations ne sont que des caches reconstruits à l'identique.
- **Comptabilité** : aucune écriture comptable n'est générée (décision n° 3 de l'architecture).

## Exemple vérifié par les tests (CMUP)

| Opération | Quantité | Valeur | CMUP |
| --- | --- | --- | --- |
| Stock d'ouverture 100 pièces à 250 | 100 | 25 000 | 250 |
| Entrée de 10 cartons de 12 à 3 600 le carton (= 300 la pièce) | 220 | 61 000 | 277,27 |
| Sortie de 20 pièces | 200 | 55 454,55 | 277,27 |
| Transfert de 50 pièces vers l'annexe | 150 + 50 | inchangée | identique des deux côtés |
| Inventaire : 145 comptées pour 150 | 145 | — | — |
| Annulation de l'entrée de 10 cartons | 25 au central | 6 250 | 250 (sortie, transfert et inventaire rejoués) |

En FIFO, 10 rames à 100, puis 10 rames à 130, puis une sortie de 15 rames : la sortie vaut 10 × 100 + 5 × 130 = 1 650, et il reste 5 rames à 130.

## Migration 056 (`db/migrations/056_commercial_stock.sql`)

| Objet | Effet |
| --- | --- |
| `com_stock_mouvements` | Nouveaux types de mouvement. Colonnes ajoutées : sens, coût, valeur, document d'origine, mouvement lié (transfert), annulation. Déclencheur : aucune suppression ; sur un mouvement autre que le stock d'ouverture, seuls le coût, la valeur et le passage à « annulé » peuvent changer. |
| `com_stock_documents`, `com_stock_doc_lignes` | Documents de stock et leurs lignes, avec leurs déclencheurs de protection |
| `com_stock_soldes`, `com_stock_lots`, `com_stock_consommations` | Caches de valorisation |
| `com_parametres` | `stock_negatif_autorise`, `autovalidation_stock` (faux par défaut) |
| `com_compteurs` | Préfixes ENT, SOR, TRF, INV |
| `com_documents` | Pièces jointes de type `stock_doc` |
| Permissions | `com.stock.voir`, `com.stock.mouvements`, `com.stock.valider`. Le directeur reçoit les trois. Gestionnaire et responsable des achats : consultation. Nouveaux profils « Magasinier » et « Gestionnaire de stock » pour les clients qui ont NJ COMMERCIAL. |

- **Reprise de l'existant** : les stocks d'ouverture déjà saisis gardent leur quantité. Sans coût, ils deviennent « à valoriser ».
- **Données de caisse** : aucune n'est touchée.
- **Nature de la migration** : additive et rejouable.
- **Retour arrière** (`056_retour_arriere.sql`) : il refuse de s'exécuter dès qu'un document de stock a été validé.

## Tests

- **`tests/commercial-stock.test.js`** : 10 tests. Ils couvrent :
  - le CMUP et le FIFO, contrôlés avec des valeurs calculées à la main ;
  - le transfert sans nouveau coût ;
  - l'inventaire sans effet avant validation ;
  - la séparation des tâches et l'auto-validation ;
  - le refus du stock négatif et le renvoi motivé ;
  - l'annulation par rejeu, et son refus quand le stock deviendrait négatif ;
  - le coût du stock d'ouverture complété après coup ;
  - l'intangibilité en base, l'isolation entre clients et les permissions.
- **Suite complète** : 152 tests, tous passés.
- **Parcours dans le navigateur** :
  - lot 4 : 27 contrôles. Le magasinier saisit, le directeur valide. Le directeur ne peut pas valider sa propre sortie ; le gestionnaire la lui renvoie. L'inventaire produit un écart. Les écrans de contrôle s'affichent, l'annulation fonctionne, l'écran passe sur téléphone. Aucune erreur JavaScript.
  - non-régression : paramétrage, demandes, bons, lots 1-2, lot 3.

## Déploiement

1. Backend : remplacer le dossier `src/` du serveur, puis lancer `node db/migrate.js` (migration 056).
2. Frontend : déployer `dist-nj-business-v48.zip`.
3. Redémarrer l'application.

Ce lot n'ajoute aucune bibliothèque.

## Limites connues

- **Réservations** : non gérées (stock disponible = stock physique).
- **Réception sur bon de commande, retours fournisseurs** : lot 5.
- **Livraisons aux clients** : lot 6. Le moteur prévoit déjà ces mouvements, mais aucun écran ne les produit encore.
- **Annulation** : elle s'applique au document entier ; il n'y a pas d'annulation partielle d'une ligne.

## Suite

Lot 6 (ventes), puis lot 5 (réceptions, factures fournisseurs, retours et avoirs), selon l'ordre retenu le 2 novembre.

---

## Complément du 02/11/2026 : une permission par fonction (migration 057, frontend v49)

Chaque fonction du stock a maintenant sa propre permission. On la coche dans **Profils métier**, dans les **permissions d'une personne** (exception) ou dans le **plafond d'un client**, au sein d'un nouveau bloc « NJ COMMERCIAL — Stock ». Les permissions de NJ COMMERCIAL sont désormais présentées en trois blocs : Configuration, Achats, Stock.

| Permission | Libellé | Ce qu'elle ouvre |
| --- | --- | --- |
| `com.stock.voir` | Consulter l'état du stock | Écran État du stock (quantités, alertes) |
| `com.stock.initial` | Saisir le stock d'ouverture | Fiche article (quantité et coût initiaux) |
| `com.stock.entree` | Saisir les entrées en stock | Créer, modifier, soumettre une entrée |
| `com.stock.sortie` | Saisir les sorties diverses | Idem pour les sorties |
| `com.stock.transfert` | Saisir les transferts entre magasins | Idem pour les transferts |
| `com.stock.inventaire` | Saisir les inventaires | Idem pour les inventaires, avec la liste des articles à compter |
| `com.stock.valider` | Valider ou renvoyer les documents de stock | Écran Validation des stocks ; jamais pour l'auteur du document |
| `com.stock.annuler` | Annuler les documents de stock validés | Annulation motivée |
| `com.stock.journal` | Consulter les mouvements de stock | Écran Mouvements de stock |
| `com.stock.valorisation` | Voir les coûts et la valorisation | Coûts, valeurs, écran Valorisation, bloc valeur du tableau de bord |

- **Sans « valorisation »**, l'état du stock et les fiches n'affichent que les quantités. Le serveur ne renvoie ni les coûts ni les valeurs.
- **Le menu** n'affiche que les écrans permis. Les listes d'un type de document (entrées, sorties…) sont visibles par la personne qui le saisit, par les valideurs, par les annulateurs et par qui consulte le journal.
- **Aucun droit perdu** à la migration :
  - « Saisir les documents de stock » (`com.stock.mouvements`) est remplacée par les quatre saisies ;
  - « Consulter le stock » donne aussi le journal et la valorisation (ce qu'elle montrait déjà) ;
  - « Valider » donne aussi « Annuler ».
  - La conversion s'applique aux rôles, aux profils, aux exceptions individuelles et aux plafonds des clients.
- **Profils des nouveaux clients** :
  - Magasinier : état, quatre saisies, mouvements, sans valeurs ni validation.
  - Gestionnaire de stock : tout le bloc.
  - Gestionnaire et responsable des achats : état, mouvements, valorisation.
- **Profils Magasinier déjà en place** : ils gardent la valorisation, qu'ils avaient avant la migration. Décochez-la dans Profils métier si nécessaire.
- **NJ COMMERCIAL → Utilisateurs et rôles** : nouvel onglet « Droits stock », une colonne par fonction.
- **Retour arrière** : `057_retour_arriere.sql` recrée `com.stock.mouvements` pour quiconque a au moins une des quatre saisies.

**Tests** : un test ajouté (une personne limitée aux sorties ; un valideur sans droit d'annuler), suite complète 153/153. Parcours navigateur « permissions » 12/12, stock 27/27, lots 1-2 24/24.

**Déploiement** :
1. Remplacer `backend/src` sur le serveur.
2. Lancer `node db/migrate.js` (migration 057).
3. Déployer `dist-nj-business-v49.zip`.
4. Redémarrer, puis demander à chacun de se reconnecter : les droits sont chargés à la connexion.
