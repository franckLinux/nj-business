# NJ COMMERCIAL — Lot 8 : circuit d'approvisionnement complet

**Date :** 12/11/2026 · **Migration :** 063 (déjà présente dans le dossier) · **Service Worker :** v61 · **Branche :** `module/commercial`

## 0. Point de départ
Le backend du lot 8 (migration 063, services `consultations`, `frais`, `consultation_pdf`, contrôleur `commercial_appro`, routes, suite `commercial-approvisionnement`) avait déjà été écrit dans le dossier, sans écrans. Il a été vérifié (11/11 tests), puis complété : écrans, corrections métier, script de démonstration.

**Règle de calcul retenue :**
- quantité théorique à commander = max(0, quantité demandée + stock de sécurité − quantité en stock) ;
- le stock de sécurité est le **seuil d'alerte** de l'article (décision confirmée) ;
- la formule ci-dessus est celle du code existant, gardée par défaut : la question a été posée et laissée sans réponse.

Exemple : stock 26, sécurité 5, demande 25 → commander 4. Après la sortie des 25, il reste bien 5.

## 1. Fonctionnalités ajoutées
- **Demande d'achat** : menu « Demandes d'achat ».
  - Colonnes : Article · Quantité en stock · Stock de sécurité · Quantité demandée · Stock à commander · Quantité à la soumission.
  - Le stock est lu en direct dans le magasin choisi.
  - La quantité soumise reprend le calcul et reste modifiable (« Reprendre le calcul »).
  - Aucun fournisseur n'est proposé au demandeur.
- **Validation par le responsable des achats** : tableau Article · Stock · Sécurité · Théorique · Demandée · Soumise · Approuvée (modifiable, 0 = non retenu) · Fournisseur proposé.
  - Le bouton **Approuver ▾** propose « Approuver et créer un bon de commande », « Approuver et lancer une demande de proforma » ou « Approuver seulement ».
  - Rejet et renvoi exigent un motif. Les quantités modifiées apparaissent dans l'historique (« 4 soumis → 2 approuvé »).
- **Suivi de l'approvisionnement** sur la demande : soumise · approuvée · commandée · réceptionnée · restant à commander.
  - Statuts : Brouillon, Soumise, En attente de validation (direction), Validée, Rejetée, En cours d'approvisionnement, Partiellement satisfaite, Satisfaite.
- **Consultations des fournisseurs** (menu « Consultations fournisseurs ») :
  - préparation : articles et quantités ≤ reste à commander, 3 fournisseurs au moins (dérogation motivée, permission dédiée), date limite, délai souhaité, validité, conditions ;
  - fiche : statut de chaque fournisseur (à envoyer, envoyée, consultée, offre reçue, sans réponse, refusée), PDF individuel, envoi par e-mail ou « Constater l'envoi » (WhatsApp, main propre), copie du lien personnel, réouverture motivée d'une offre, ajout d'un fournisseur, annulation, historique.
- **Portail fournisseur** (page publique `/offre/<jeton>`, sans compte, utilisable sur téléphone) :
  - le fournisseur répond article par article : disponibilité, quantité si partielle, prix HT, taux de taxe, observation ;
  - il indique aussi le délai, les conditions de paiement, la validité et les observations, et peut joindre une proforma PDF ;
  - il peut aussi décliner la consultation ;
  - une fois soumise, l'offre est fermée et le fournisseur ne voit jamais celles des autres.
- **Comparaison des offres** :
  - synthèse par fournisseur (HT, taxes, TTC, délai, paiement, validité, proforma) ;
  - puis un tableau par article, avec badges « Meilleur prix » et « Meilleur délai » ;
  - raccourcis qui pré-remplissent les choix sans rien enregistrer : le moins cher, le meilleur délai, tout chez un fournisseur ;
  - un choix qui n'est pas le moins-disant doit être justifié ;
  - à la validation, un bon de commande brouillon est créé par fournisseur retenu, lié à la demande.
- **Frais d'achat** (menu « Frais d'achat ») :
  - liste avec les colonnes Rubrique · Nom du fournisseur · Montant · Commande associée ;
  - saisie avec aperçu de la répartition (valeur, quantités, poids, manuelle) ;
  - fiche : validation par le comptable (coût réel intégré, stock revalorisé), annulation motivée, pièces jointes.
- **Bon de commande** :
  - statut de suivi (Validé — à envoyer, Envoyé, Partiellement livré, Livré) ;
  - boutons « Envoyer au fournisseur » (e-mail du PDF) et « Constater l'envoi » ;
  - « + Frais d'achat » ;
  - tableau **coût réel d'acquisition** : prix net + frais par unité.
- **Fiche fournisseur** : délai de livraison habituel (nombre + jours calendaires ou ouvrés).
- **Fiche article** : poids unitaire (pour la répartition au poids) ; le seuil d'alerte est présenté comme stock de sécurité.
- **Utilisateurs** : nouvelles colonnes (consultations, dérogation, saisie et validation des frais) et profil « Comptable (achats) ».

## 2. Fonctionnalités modifiées
- **Facture fournisseur** : saisie par le comptable et validée par une autre personne. Le responsable et le gestionnaire des achats ne la saisissent plus (migration 063).
- **Quantité théorique** : calculée sur la quantité demandée (le besoin), et non plus sur la quantité soumise, côté serveur (`demandes.service.js`).
- **« Stock suffisant »** : un article n'est plus déclaré couvert que si le stock sert la demande **et** reste au niveau de sécurité (serveur et écran).
- **Script de démonstration** :
  - nouveau compte `demo.comptable` ; la facture est saisie par le comptable et validée par le directeur ;
  - un frais de transport validé ;
  - une consultation lancée avec 2 offres sur 3.

## 3. Fichiers
**Backend (modifiés dans ce lot)** : `src/services/commercial/demandes.service.js`, `tools/demo-commercial.js`.

**Backend déjà présent et vérifié** :
- `db/migrations/063_commercial_approvisionnement.sql` et `db/migrations-retour-arriere/063_retour_arriere.sql` ;
- services `consultations`, `consultation_pdf`, `frais`, `bons`, `achats_docs`, `referentiel` ;
- `controllers/commercial_appro.controller.js` et les routes ;
- `tests/commercial-approvisionnement.test.js`.

**Frontend, nouveaux fichiers** : `components/commercial/appro.jsx`, `pages/commercial/ConsultationsPages.jsx`, `pages/commercial/FraisPages.jsx`, `pages/OffreFournisseurPage.jsx`.

**Frontend, fichiers modifiés** : `App.jsx`, `components/commercial/{CommercialLayout.jsx, icones.js, achats.jsx}`, `pages/commercial/{DemandeFormPage, DemandePage, DemandesPage, BonPage, BonsPage, TiersPage, ArticlesPage, UtilisateursPage}.jsx`, `styles/{commercial.css, verification.css}`, `public/sw.js` (v61).

## 4. Base de données (migration 063)
- **Nouvelles tables :** `com_consultations`, `com_consultation_lignes`, `com_consultation_fournisseurs` (jeton de 256 bits), `com_offres` et `com_offre_lignes` (versionnées, intangibles), `com_frais_achat`, `com_frais_repartition`.
- **Colonnes ajoutées :**
  - lignes de demande : `quantite_besoin`, `quantite_demandee` ;
  - décisions : `details` ;
  - fournisseurs : `delai_livraison_jours`, `delai_type` ;
  - articles : `poids_kg` ;
  - bons de commande : `consultation_id` et champs d'envoi ;
  - mouvements de réception : `cout_frais`.
- **Permissions :** `com.consultations.gerer`, `com.consultations.derogation`, `com.frais.saisir`, `com.frais.valider`, plus le profil « Comptable (achats) ».
- **Cohérence :** idempotente ; retour arrière fourni.

## 5. Tests
- **Backend :** 22 suites, **205 tests, tous passent**. Base PostgreSQL 16 jetable, migrations 001 à 063, jamais la production. `commercial-approvisionnement` couvre les 14 scénarios du cahier des charges, de la demande d'achat aux droits et au cloisonnement.
- **Navigateur** (compte de démonstration) :
  - demande à deux articles : stock 26, sécurité 5, demande 25 → à commander 4 ; aucun fournisseur visible ;
  - validation avec une quantité approuvée réduite, puis « Approuver et lancer une demande de proforma » ;
  - consultation de 3 fournisseurs lancée ;
  - offre saisie sur le portail en largeur téléphone, puis lien fermé après soumission ;
  - comparaison, « le moins cher par article », attribution → 2 bons créés ;
  - frais de douane : la répartition au poids est refusée (poids manquants, message clair), celle aux quantités est enregistrée ;
  - bon de commande : coût réel 120 000 + 18 000 = 138 000 FCFA.
- **Compilation :** frontend OK (`vite build`). Script de démonstration exécuté en entier.

## 6. Déploiement
1. Copier les fichiers de l'archive à leur place dans `caisse-pro`.
2. `cd frontend && npm run build`, puis commit.
3. Déployer et redémarrer : la 063 est jouée au démarrage.
4. Ctrl+Maj+R (cache v61).
5. **`APP_URL`** doit être l'adresse publique (`https://nj-business.net`) : les liens des fournisseurs en dépendent. Sans SMTP, utilisez « Constater l'envoi ».
6. Attribuer le profil « Comptable (achats) » à la personne qui saisit les factures fournisseurs.

## 7. Points restant à finaliser
- **Formule de la quantité théorique :** à confirmer (ou à changer).
- **Statuts du bon de commande :** « En attente de validation » n'existe pas comme statut distinct. Un brouillon est contrôlé puis émis par le responsable ; l'émission vaut validation.
- **Envoi par e-mail :** dépend du SMTP du serveur.
- **Relances :** les fournisseurs « sans réponse » ne sont pas relancés automatiquement.
