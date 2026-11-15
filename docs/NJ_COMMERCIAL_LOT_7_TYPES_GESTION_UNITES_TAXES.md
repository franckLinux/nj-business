# NJ COMMERCIAL — Lot 7 : types de gestion, familles et unités, taxes à la saisie

**Date :** 12/11/2026 · **Migration :** 062 · **Service Worker :** v60 · **Branche :** `module/commercial`

## 1. Ce qui change

### A. Types de gestion des utilisateurs (achats, ventes, stock)
- Trois types : **Gestion des achats**, **Gestion des ventes**, **Gestion de stock**. Une personne peut en avoir zéro, un ou plusieurs.
- Le type dit **dans quel domaine** la personne travaille. Il ne remplace pas le rôle (directeur, collaborateur…) ni le profil métier (Responsable des achats, Magasinier…), qui fixent le **niveau**.
- Chaque type ouvre un lot de permissions de **consultation et de saisie**. Les **validations** (approuver, émettre, valider, annuler, valider les livraisons) et le paramétrage restent au rôle ou au profil. Le serveur refuse de les mettre dans un type, même personnalisé.
- Résolution des droits (`permission.service.js`) : rôle ou profil **+ types de gestion** + exceptions accordées, **moins** les exceptions refusées, dans la limite du plafond du client. Un refus individuel ou une permission désactivée pour le client l'emporte donc toujours sur le type.
- Gestion évolutive : chaque client peut personnaliser le lot d'un type (avec retour au lot par défaut). Ajouter un type ou une permission à un lot se fait par une ligne en base, sans toucher au code.

| Type | Droits ouverts par défaut |
|---|---|
| Achats | fournisseurs (`com.tiers.voir`), articles, état du stock, créer et suivre les demandes (`com.da.creer`, `com.da.voir_tout`), préparer les bons de commande, joindre les pièces, saisir les réceptions, saisir les retours, consulter et saisir les factures fournisseurs, tableau de bord |
| Ventes | clients (`com.tiers.voir`), articles, état du stock, consulter les ventes, saisir les devis, enregistrer les commandes clients |
| Stock | articles, état du stock, entrées, sorties, transferts, inventaires, journal des mouvements |

Où : **NJ COMMERCIAL → Configuration → Utilisateurs**. On y trouve les cartes des trois types (avec « Voir ou personnaliser les droits »), une colonne « Types de gestion » avec « Modifier », et dans la matrice une coche **bleue** quand un droit vient d'un type (verte s'il vient du rôle, du profil ou d'une exception). La personne voit ses nouveaux droits à sa prochaine connexion, ou en rechargeant la page.

*Pas encore couvert :* le cahier des charges cite « factures clients » et « règlements » pour les ventes. Ces écrans n'existent pas encore. Quand ils seront livrés, il suffira d'ajouter leurs permissions au lot « ventes ».

### B. Familles d'articles : ordre des champs et unités par défaut
- Ordre du formulaire : **1. Nom de la famille**, **2. Unité de stock** (obligatoire, avec un bouton **+**), puis unité d'achat et unité de vente, puis les autres informations (code, statut, description, suivi en stock, méthode de valorisation, fournisseurs).
- L'unité d'achat et l'unité de vente affichent par défaut « **Même que le stock (SAC)** » et suivent l'unité de stock. On peut choisir une autre unité, avec son coefficient (1 carton = 12 pièces).
- Le code est proposé à partir du nom à la création (« Matériaux de construction » → MATERIAUX). Il reste modifiable.
- Côté serveur, l'unité de stock de la famille est désormais **obligatoire**. Si l'achat ou la vente n'est pas renseigné, le serveur y met l'unité de stock (coefficient 1). Les articles créés dans la famille reprennent ces unités, puis restent modifiables article par article.

### C. Taxes retirées des familles et des articles
- Plus aucun champ de taxe sur la fiche famille ni sur la fiche article. Une taxe envoyée par un ancien écran est ignorée.
- La taxe se choisit **à la saisie de l'opération** :
  - **Bon de commande** : taxe par ligne, plus un sélecteur « Taxe de l'opération » avec « Appliquer à toutes les lignes ». Aucune taxe n'est proposée d'office.
  - **Facture fournisseur** : la taxe du bon est proposée sur chaque ligne et reste **modifiable** (nouveau). Une taxe différente doit être active et applicable aux achats.
  - **Devis** : taxe par ligne. La « Taxe de l'opération » est proposée à chaque article ajouté et peut être appliquée à toutes les lignes.
  - Une taxe réservée aux ventes reste refusée à l'achat, et inversement.
- Le système de taxes n'est pas supprimé : l'écran Configuration → Taxes reste en place. Sa colonne affiche maintenant le nombre de **lignes de documents** qui appliquent chaque taxe.
- **Taux figé :** un taux ne peut plus être modifié dès qu'un document l'applique (bons de commande, factures fournisseurs, devis, commandes clients). Avant, seuls les bons de commande étaient vérifiés.
- **Historique intact :** chaque ligne de document garde la taxe et le taux qui y ont été copiés. HT, taxes et TTC des documents déjà enregistrés ne bougent pas.

### D. Création rapide d'une unité
- Un bouton **+** à côté de « Unité de stock » sur la fiche famille et sur la fiche article ouvre une **fenêtre modale au-dessus du formulaire**.
- On y saisit le code, le libellé (facultatif) et les décimales. À l'enregistrement, la liste des unités est relue et la nouvelle unité est **sélectionnée automatiquement**.
- Le formulaire principal n'est **jamais fermé ni vidé**. Échap, Annuler ou un clic hors de la fenêtre ne ferment que la modale : la touche Échap est interceptée avant le tiroir.
- **Doublons :** la modale signale une unité qui existe déjà et désactive le bouton. Le serveur refuse aussi (409) un code ou un libellé qui reprend, sans tenir compte des majuscules, le code ou le libellé d'une autre unité (« CARTON » / « carton »).
- **Droits :** la création d'une unité est ouverte à qui gère le paramétrage **ou** les articles (`com.articles.modifier`). La modification d'une unité existante reste réservée au paramétrage.

## 2. Fichiers modifiés

**Base de données**
- `backend/db/migrations/062_commercial_types_gestion_taxes.sql` *(nouveau)*
- `backend/db/migrations-retour-arriere/062_retour_arriere.sql` *(nouveau)*

**Backend**
- `backend/src/services/permission.service.js` : types de gestion dans la résolution des droits, `getPermissionsTypes`, et repli sans erreur tant que la 062 n'est pas jouée.
- `backend/src/services/commercial/referentiel.service.js` : familles (unité de stock obligatoire, achat et vente par défaut, aucune taxe), articles (aucune taxe, plus d'héritage de taxe), unités (doublons code et libellé), taxes (lignes de documents, taux figé sur tous les documents), types de gestion (`listerTypesGestion`, `definirTypesUtilisateur`, `personnaliserTypeGestion`), liste des utilisateurs avec leurs types.
- `backend/src/services/commercial/bons.service.js` : plus de taxe reprise de l'article ; la taxe vient de la ligne.
- `backend/src/services/commercial/ventes.service.js` : plus de taxe de vente reprise de l'article sur le devis.
- `backend/src/services/commercial/achats_docs.service.js` : taxe modifiable sur la facture fournisseur, avec contrôle (active, usage achat).
- `backend/src/controllers/commercial.controller.js`, `backend/src/routes/commercial.routes.js` : `GET /commercial/types-gestion`, `PUT /commercial/types-gestion/:code`, `PUT /commercial/utilisateurs/:id/types-gestion` (tous sous `com.parametrage.modifier`) ; `POST /commercial/unites` ouvert à `com.parametrage.modifier` **ou** `com.articles.modifier`.
- `backend/tools/demo-commercial.js` : familles sans taxe, taxe choisie sur les lignes de devis, types de gestion attribués aux comptes de démonstration.

**Frontend**
- `frontend/src/components/commercial/ui.jsx` : `UniteRapide` (bouton + et modale) et `TaxeOperation` (taxe de l'opération, appliquée à toutes les lignes).
- `frontend/src/styles/commercial.css` : modale, bouton +, pastilles de types, barre de taxe.
- `frontend/src/pages/commercial/FamillesPage.jsx` : nouvel ordre des champs, unité de stock obligatoire, création rapide, plus de taxes.
- `frontend/src/pages/commercial/ArticlesPage.jsx` : plus de taxes, création rapide d'une unité de stock.
- `frontend/src/pages/commercial/UtilisateursPage.jsx` : types de gestion (cartes, attribution, personnalisation, origine des droits).
- `frontend/src/pages/commercial/BonFormPage.jsx`, `VentesPages.jsx`, `FacturesFournPages.jsx` : taxe choisie à la saisie.
- `frontend/src/pages/commercial/TaxesPage.jsx`, `DemarragePage.jsx` : textes et colonne « Lignes de documents ».
- `frontend/public/sw.js` : cache v60.

**Tests**
- `backend/tests/commercial-types-gestion.test.js` *(nouveau, 8 tests)*.
- Mis à jour pour les nouvelles règles : `commercial-agences`, `commercial-bons`, `commercial-demandes`, `commercial-parametrage`, `commercial-ventes`.

## 3. Base de données (migration 062)
- **Créées :** `com_types_gestion` (catalogue), `com_type_gestion_permissions_defaut` (lots par défaut), `com_types_gestion_client` et `com_type_gestion_permissions_client` (personnalisation par client), `com_utilisateur_types_gestion` (types de chaque personne ; un déclencheur refuse une personne d'un autre client), `com_taxes_fiches_062` (archive des taxes).
- **Modifiées :** les taxes des familles (`taxe_achat_id`, `taxe_vente_id`) et des articles (`taxe_id`, `taxe_vente_id`) sont **archivées** dans `com_taxes_fiches_062`, puis remises à vide. Les colonnes restent en base, sans usage.
- **Non touchés :** les documents (lignes de bons, factures, devis, commandes) et toutes les données de caisse.
- **Sécurité de la migration :** idempotente (rejouée sans effet). Clés `ON DELETE CASCADE` vers le client et l'utilisateur, ce qui ne bloque pas la suppression d'un client.
- **Retour arrière :** `062_retour_arriere.sql` remet les taxes archivées et supprime les tables des types de gestion.

## 4. Vérifications faites
Sur une base PostgreSQL 16 jetable (schéma + migrations 001 à 062), jamais sur la production.

1. **Migration :** des taxes posées sur une famille et un article avant la 062 sont archivées puis vidées. La 062 rejouée ne fait rien. Le retour arrière rétablit les taxes et supprime les tables.
2. **Permissions par catégorie** (`commercial-types-gestion`, 8/8) : trois types sans droit de validation ; attribution d'un puis de trois types ; les droits suivent et le rôle ne change pas ; l'agent peut saisir un devis une fois « ventes » attribué ; retrait du type ; refus individuel et plafond du client prioritaires ; personnalisation (droits de niveau refusés, autre client non touché, retour au défaut) ; isolation entre clients (404, 403, déclencheur).
3. **Familles et articles :** unité de stock obligatoire ; achat et vente identiques par défaut puis modifiables avec coefficient ; reprise par l'article ; aucune taxe enregistrée même si on en envoie une.
4. **Création rapide** (navigateur, compte de démonstration) : nom et description saisis, + → CARTON50 créé ; l'unité est sélectionnée et le nom, la description et le code proposé sont conservés. Échap dans la modale laisse le formulaire ouvert. Le doublon « sac » est signalé. Même chose sur la fiche article (TONNE, 3 décimales).
5. **Taxes à la saisie :** devis sans taxe 3 000 / 0 / 3 000 et avec TVA 3 000 / 578 / 3 578. Lignes de devis et de bon de commande sans taxe d'office, puis taxe appliquée à toutes les lignes. Facture fournisseur : taxe du bon proposée et modifiable, totaux recalculés. Taux figé dès le premier devis.
6. **Non-régression :** les 21 suites de `backend/tests` passent (commercial, caisse, passerelle, contrôle, budget hebdomadaire, suppression de client, validation directe…). Le frontend compile (`vite build`). Le script de démonstration NJ COMMERCIAL tourne en entier avec les nouvelles règles.

## 5. Déploiement
1. Appliquer les fichiers (déjà en place dans `caisse-pro`).
2. Sous Windows : `cd frontend && npm run build` (le `dist` est construit en local puis commité), puis commiter.
3. Déployer. La migration 062 est jouée au démarrage, comme les précédentes. Redémarrer le serveur.
4. Vider le cache navigateur (Ctrl+Maj+R, ou désinscrire le Service Worker) : cache v60.
5. Dans chaque client : Configuration → Utilisateurs → attribuer les types de gestion. Vérifier aussi les familles sans unité de stock (pastille « À choisir » dans la liste) : il faudra leur en donner une à leur prochaine modification.

**Points d'attention**
- Après la 062, les articles n'apportent plus de taxe aux documents. Les utilisateurs doivent choisir la taxe sur chaque bon de commande et chaque devis : prévenir les équipes.
- Les clients qui ont un plafond de permissions gardent ce plafond : un type de gestion n'ouvre jamais une permission désactivée pour le client.
