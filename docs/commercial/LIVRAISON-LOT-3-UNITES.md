# NJ COMMERCIAL — Lot 3 : unités de mesure et conversions

02/11/2026 · branche `module/commercial` · migration 055 · frontend v47.

## Ce qui est livré

- **Configuration → Unités de mesure** (nouvel écran) : code (pièce, carton, kg…), libellé, nombre de décimales (0 à 3), statut.
  - Une unité qui figure déjà sur un document ou porte un stock peut gagner des décimales, jamais en perdre.
  - Renommer une unité de stock renomme le mot affiché sur ses articles.
- **Fiche article → Unités et conversions** :
  - unité de stock (dans laquelle le stock est compté) ;
  - unité d'achat et unité de vente, chacune avec sa conversion (« 1 carton = 12 pièce »).
  - La conversion est propre à chaque article : un carton n'a pas le même contenu partout.
  - L'unité de stock est figée dès que l'article a du stock ou figure sur un document.
- **Famille** : elle peut proposer l'unité de stock, l'unité d'achat et l'unité de vente avec leurs coefficients. Un nouvel article les reprend ; elles restent modifiables sur l'article, et modifier la famille ne change pas les articles existants.
- **Prix** : le prix d'achat indicatif est exprimé par unité d'achat. Nouveau : un prix de vente indicatif par unité de vente.
- **Expression de besoin** :
  - Chaque ligne est saisie dans l'unité d'achat par défaut, ou dans une autre unité de l'article.
  - L'écran affiche la conversion (« 10 carton = 120 pièce »).
  - L'encart stock compare la quantité convertie au stock du magasin.
  - Le prix estimé est ramené à l'unité de la ligne.
- **Bon de commande** : il reprend l'unité et le coefficient de la demande. Le PDF affiche l'unité commandée. La fiche montre aussi la quantité en unité de stock.
- **Historique protégé** : chaque ligne de demande et de bon garde l'unité et le coefficient du jour de sa saisie. Changer plus tard un coefficient ne modifie aucun document passé.
- **Contrôles** :
  - Une quantité doit respecter les décimales de son unité : 1,5 carton est refusé si le carton se compte en entiers.
  - Une unité étrangère à l'article est refusée.

## Formule

```
Quantité en stock = quantité du document × coefficient de son unité
```

Exemple : 10 cartons à 12 pièces = 120 pièces en stock. Le prix suit la même logique : 6 000 FCFA le carton font 500 FCFA la pièce.

## Migration 055 (`db/migrations/055_commercial_unites.sql`)

| Objet | Effet |
| --- | --- |
| `com_unites` | Nouvelle table. Une unité est créée pour chaque mot déjà saisi sur les articles (« rame », « unité »…), avec 0 décimale, ou 3 si une quantité décimale existait déjà. |
| `com_articles` | `unite_stock_id`, `unite_achat_id`, `unite_vente_id` (l'unité actuelle de l'article, partout), `prix_vente_indicatif` |
| `com_article_unites` | Conversions de chaque article ; les articles existants reçoivent un coefficient de 1 |
| `com_familles` | Unités et coefficients proposés |
| `com_demande_lignes`, `com_bc_lignes` | `unite_id` et `coefficient` (1 pour l'existant). L'unité des lignes de bons déjà émis est renseignée sans rien modifier d'autre. |
| Déclencheurs | Même client pour les unités, les conversions et les lignes |

La migration est additive et rejouable. Le retour arrière (`055_retour_arriere.sql`) refuse de s'exécuter dès qu'une conversion réelle (coefficient différent de 1) existe.

Rien ne change pour l'existant : chaque article garde son unité, avec un coefficient de 1.

## Tests

- **`tests/commercial-unites.test.js`** : 7 tests.
  - Unités et décimales ; famille reprise par l'article puis détachée ; ancien écran (`unite: "sac"`).
  - Demande en cartons face au stock en pièces ; prix converti ; décimales et unités contrôlées.
  - Bon de commande qui copie unité et coefficient, inchangés quand l'article change.
  - Unité de stock figée ; décimales qui ne baissent pas ; renommage ; isolation entre clients.
- **Suite complète** : 142 tests, tous passés.
- **Parcours dans le navigateur** :
  - lot 3 : 14 contrôles. Unités, famille au carton de 12, article qui en hérite, stock d'ouverture en pièces, demande de 10 cartons = 120 pièces face à 100 en stock (20 à approvisionner), affichage sur téléphone.
  - non-régression : paramétrage 24, demandes 21, bons 34, lots 1-2 24.

## Déploiement

1. Backend : remplacer le dossier `src/` du serveur, puis lancer `node db/migrate.js` (migration 055 ; la 054 aussi si elle n'est pas encore passée).
2. Frontend : déployer `dist-nj-business-v47.zip`.
3. Redémarrer l'application.

Ce lot n'ajoute aucune bibliothèque.

## Suite

Lot 4, le moteur de stock : mouvements valorisés en CMUP ou FIFO, entrées et sorties diverses, transferts, inventaires, coût du stock d'ouverture. Viendront ensuite les ventes (lot 6), selon l'ordre retenu le 2 novembre.
