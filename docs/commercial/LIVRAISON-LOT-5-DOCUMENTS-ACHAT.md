# NJ COMMERCIAL — Lot 5 : documents d'achat

02/11/2026 · branche `module/commercial` · migration 058 · frontend v50.

## Ce qui est livré

**Menu Traitements → Achats**, trois nouveaux écrans :

- **Réceptions**
  - Onglet « À recevoir » : les bons de commande émis pas encore soldés. Le menu affiche un badge.
  - Onglet « Réceptions » : la liste des réceptions.
  - Une réception constate ce que le fournisseur a livré sur un bon : le n° et la date de son bon de livraison, puis les quantités reçues, préremplies avec le reste à recevoir.
  - Elle peut être partielle ; un même bon peut avoir plusieurs réceptions.
  - Le bon de livraison scanné se joint en pièce justificative.
- **Retours fournisseurs** : ils se créent depuis la fiche d'une réception validée (« Retour au fournisseur »), avec un motif obligatoire.
- **Factures fournisseurs**
  - Onglet « À facturer » : les fournisseurs qui ont des réceptions validées non facturées.
  - Onglets « Factures » et « Avoirs ».
  - Un avoir se saisit depuis une facture validée et peut être rattaché à un retour.

**Menu Contrôles → Validation des achats** : les réceptions, retours et factures soumis, avec un badge.

**Fiche du bon de commande** :
- bouton « Réceptionner » ;
- bloc « Réception » : reçu sur commandé par ligne, et la liste des réceptions.

## Règles

**Circuit.** Il est le même que pour le stock : brouillon → à valider → validé → annulé (avec un motif).
- La personne qui saisit ne valide pas. Seule exception : l'auto-validation activée dans Société, qui couvre le stock et les documents d'achat.
- Un document validé est intangible ; les déclencheurs de la base l'imposent.

| Document | Effet à la validation | Garde-fous |
| --- | --- | --- |
| Réception | Entrée en stock (« Réception fournisseur ») au prix net HT du bon, ramené à l'unité de stock | Jamais au-delà du reste à recevoir sans motif d'excédent ; le bon doit être encore émis ; décimales de l'unité respectées |
| Retour fournisseur | Sortie au coût de la réception d'origine (pas au CMUP du moment) ; en FIFO, le lot de cette réception part en premier | Jamais plus que le reçu non encore retourné ; stock suffisant |
| Facture | Bon à payer ; rapprochement figé | Rapprochement ligne par ligne avec la commande et la réception : un écart de quantité (plus facturé que reçu) ou de prix (au-delà de la tolérance de Société, 10 % par défaut) exige un motif ; un même n° de facture du fournisseur n'est enregistré qu'une fois |
| Avoir | Déduit du net à payer de la facture | Jamais plus que la quantité facturée (moins les avoirs déjà faits), ni à un prix supérieur |

**Enchaînement des annulations.** On ne casse pas la chaîne commande → réception → facture :
- un bon qui a des réceptions ne s'annule plus et ne se révise plus ;
- une réception qui a un retour ou une facture ne s'annule pas ;
- un retour couvert par un avoir ne s'annule pas ;
- une facture qui a un avoir ne s'annule pas ;
- dans chaque cas, on annule d'abord le document qui suit.

**Annulation d'une réception :**
- ses mouvements restent visibles, marqués annulés, et la valorisation est recalculée ;
- elle est refusée si un stock devenait négatif.

**Règlements :** ils se saisissent dans NJ CAISSE PRO (décision n° 4). La fiche d'une facture validée le rappelle. Aucune écriture comptable n'est générée.

## Permissions (une par fonction)

| Permission | Libellé |
| --- | --- |
| `com.receptions.saisir` | Saisir les réceptions |
| `com.receptions.valider` | Valider ou renvoyer les réceptions |
| `com.receptions.annuler` | Annuler les réceptions validées (et les retours) |
| `com.retours_fourn.saisir` | Saisir les retours fournisseurs |
| `com.retours_fourn.valider` | Valider ou renvoyer les retours fournisseurs |
| `com.factures_fourn.voir` | Consulter les factures fournisseurs |
| `com.factures_fourn.saisir` | Saisir les factures et avoirs fournisseurs |
| `com.factures_fourn.valider` | Valider ou renvoyer les factures fournisseurs |
| `com.factures_fourn.annuler` | Annuler les factures et avoirs validés |

**Où les trouver :** dans les écrans de permissions, bloc « NJ COMMERCIAL — Achats ». Dans NJ COMMERCIAL → Utilisateurs et rôles, nouvel onglet « Réceptions et factures ».

**Profils (existants et nouveaux clients) :**
- Directeur : tout.
- Magasinier : saisit réceptions et retours.
- Gestionnaire de stock : saisit, valide et annule réceptions et retours.
- Gestionnaire des achats (GAS) : saisit réceptions, retours et factures.
- Responsable des achats : valide et annule réceptions, retours et factures.

## Exemple vérifié par les tests

Bon de 10 cartons de 12 pièces à 3 600 FCFA le carton. Stock d'ouverture : 100 pièces à 250.

| Opération | Stock | Valeur |
| --- | --- | --- |
| Réception de 6 cartons (300 la pièce) | 172 | 46 600 |
| Réception de 5 cartons, dont 1 en excédent motivé | 232 | 64 600 |
| Retour de 2 cartons, au coût de la réception (300), pas au CMUP | 208 | 57 400 |

**Facture :**
- 4 cartons à 3 600, conformes ;
- 5 cartons à 4 000 : écart de prix de +11,11 %, au-delà de la tolérance, motif exigé.
- Totaux : HT 34 400, TVA 6 622, TTC 41 022.

**Avoir :** 2 cartons, soit 8 586 TTC. Net à payer : 32 436.

## Migration 058 (`db/migrations/058_commercial_documents_achat.sql`)

| Objet | Effet |
| --- | --- |
| `com_receptions`, `com_reception_lignes` | Réceptions et leurs lignes (référence à la ligne du bon, unité, coefficient, prix net) |
| `com_retours_fournisseurs`, `com_retour_fourn_lignes` | Retours (référence à la ligne de réception) |
| `com_factures_fournisseurs`, `com_facture_fourn_lignes` | Factures et avoirs ; rapprochement figé à la validation |
| Déclencheurs | Document validé intangible ; lignes figées ; même client partout |
| `com_compteurs` | Préfixes REC, RFO, FFO, AVF |
| `com_documents` | Pièces des réceptions, retours et factures |
| Permissions | 9 nouvelles, attribuées comme ci-dessus ; plafonds des clients complétés |

- **Nature :** additive et rejouable. Aucune donnée existante n'est modifiée, et les données de NJ CAISSE PRO ne sont pas touchées.
- **Retour arrière** (`058_retour_arriere.sql`) : il refuse de s'exécuter dès qu'un document d'achat a été validé.

## Autres changements

- **Moteur de stock :** le retour fournisseur est valorisé au coût de la réception liée. Le journal des mouvements affiche les numéros REC et RFO, avec un lien vers le document.
- **Bons de commande :** annulation et révision bloquées dès qu'une réception existe.
- **Tableau de bord sur téléphone :** le graphique mensuel des bons émis débordait dès qu'il contenait des données (défaut antérieur) ; corrigé.

## Tests

- **`tests/commercial-achats-docs.test.js`** : 6 tests. Ils couvrent :
  - la réception partielle, puis le solde avec excédent motivé ;
  - le retour au coût d'origine ;
  - la facture rapprochée, le refus des doublons et l'écart de quantité ;
  - l'avoir plafonné ;
  - les verrous d'annulation ;
  - les permissions, l'intangibilité et l'isolation entre clients.
- **Suite complète :** 159 tests, tous passés.
- **Parcours dans le navigateur, lot 5 :** 21 contrôles, tous passés. Le magasinier réceptionne 6 sur 10 ; le directeur valide depuis la file ; le bon passe à « Reçu en partie » ; le magasinier retourne 1 ; le gestionnaire des achats facture le reçu net (5) ; le responsable valide (rapprochement conforme) ; un avoir est saisi puis validé et le net à payer apparaît. Le téléphone et les permissions sont vérifiés.
- **Parcours de non-régression :** paramétrage 24, demandes 21, bons 34, lots 1-2 24, lot 3 14, permissions 12, stock 26/27. L'écart au stock vient des données du client de test, pas du code : après plusieurs passages, annuler l'entrée rendrait le stock négatif, et l'application refuse l'annulation comme prévu.

## Déploiement

1. Backend : remplacer `src/` sur le serveur, puis lancer `node db/migrate.js` (migration 058 ; la 057 aussi si elle n'est pas encore passée).
2. Frontend : déployer `dist-nj-business-v50.zip`.
3. Redémarrer l'application, puis demander à chacun de se reconnecter : les droits sont chargés à la connexion.

## Suite

Lot 6 (ventes : devis, commande client, préparation, livraison, facture et avoir client), puis lots 7 et 8 (états et exports).
