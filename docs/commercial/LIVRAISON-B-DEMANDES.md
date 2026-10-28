# NJ COMMERCIAL — Livraison B : demandes d'achat et autorisations

28/10/2026 · branche `module/commercial` · frontend v43.

## Ce qui est livré

- **Menu Achats** :
  - **Demandes d'achat** : liste avec filtres (statut, période, recherche), vue « Mes demandes » ou « Toutes ».
  - **Autorisations** : la file des demandes qui attendent une décision, avec un compteur dans le menu.
- **Saisie d'une demande** : magasin, service, priorité, motif, fournisseur proposé et articles.
  - Chaque ligne affiche **en direct le stock du magasin** : couvert, quantité à approvisionner, ou « non suivi ».
  - Les **fournisseurs habituels** viennent de l'article et de sa famille. On peut choisir tout autre fournisseur actif.
- **Fiche d'une demande** : besoin, articles avec le stock figé à la soumission, panneau de décision, pièces justificatives et historique chronologique.
- **Notifications** : dans la cloche, avec un clic qui ouvre la demande, et par e-mail selon le canal de chaque personne (gabarit « NJ COMMERCIAL » avec lien direct). Contenu : numéro, date, demandeur, service, magasin, fournisseur, montant, statut, motif et articles.

Pas encore livré (livraison C) : bons de commande, PDF, QR code de vérification, proformas, tableau de bord des achats, écrans « Documents » et « Historique » transverses.

## Circuit

| Étape | Qui | Effet |
| --- | --- | --- |
| Soumission | Le demandeur | Contrôles (motif, au moins un article, articles actifs). Montant estimé = quantités × prix indicatifs. Stock figé dans chaque ligne. |
| Examen achats | `com.da.approuver` (responsable des achats, directeur) | Approuver : la demande passe en direction si le montant atteint le seuil, sinon elle est approuvée. Renvoyer ou rejeter : motif obligatoire. |
| Examen direction | `com.da.approuver_direction` (directeur) | Seulement au-delà du seuil fixé dans Société (500 000 FCFA par défaut, vide = jamais). |
| Approuvée | — | Le GAS (`com.bc.preparer`) et le demandeur sont prévenus. |

Règles :

- **Personne n'approuve sa propre demande**, même avec le droit.
- **Une seule décision suffit** quand le valideur a les droits achats et direction (cas du directeur seul).
- **Renvoi** : la demande redevient modifiable par son auteur, puis repart au début du circuit.
- **Rejet** : la demande est close. Un nouvel achat demande une nouvelle demande.
- **Annulation** : par l'auteur jusqu'à l'approbation, puis par un valideur.
- **Blocage si le stock couvre le besoin** : seulement si le client l'a activé (Société). Le demandeur peut alors justifier le réapprovisionnement.
- **Le stock n'est jamais modifié** par une demande.

## Migration 051 (`db/migrations/051_commercial_demandes.sql`)

| Objet | Effet |
| --- | --- |
| `com_compteurs` | Numéros DA-AAAA-0001 par client et par année, sous verrou |
| `com_demandes`, `com_demande_lignes` | Demandes, statuts, montant, seuil appliqué, stock constaté (JSON) |
| `com_decisions` | Ajout seul : un déclencheur refuse toute modification et toute suppression |
| `com_documents` | Pièces jointes : type réel contrôlé, SHA-256, retrait tracé et jamais effacé |
| Déclencheurs | Une demande soumise ne se supprime pas (elle s'annule) ; même client partout |
| `com_parametres.services` | Colonne ajoutée, vide par défaut (liste de services, pour plus tard) |

Additive, rejouable. Retour arrière : `051_retour_arriere.sql`. Il refuse de s'exécuter dès qu'une demande a été soumise.

## Pièces justificatives

- **Formats** : PDF, JPG, PNG, WEBP, Word (.docx) ou Excel (.xlsx), 5 Mo au plus. Le format est contrôlé sur le contenu réel du fichier.
- **Stockage** : dossier privé `PV_DIR/<client>/commercial/`. Les fichiers ne sont jamais servis par `/uploads` ; la lecture passe par l'API authentifiée.
- **Retrait** : seulement par la personne qui a joint la pièce, et tant que la demande est modifiable. La pièce est masquée, jamais effacée, et le retrait est tracé.

## Tests

- **`tests/commercial-demandes.test.js`** : 13 tests.
    - Numérotation, stock constaté et fournisseurs proposés.
    - Contrôles de saisie et visibilité.
    - Circuits à une et à deux étapes, et valideur double.
    - Pas d'auto-validation ; renvoi, resoumission et rejet.
    - Blocage configurable sur le stock et annulations.
    - Historique inaltérable.
    - Pièces : faux PDF refusé, téléchargement, retrait.
    - File d'examen et isolation entre clients.
- **Suite complète** : 110 tests sur 110.
- **Parcours réel dans le navigateur** (demande, renvoi, correction, achats, direction, téléphone) : 21 contrôles sur 21, aucune erreur JavaScript. Le parcours de la livraison A a été rejoué : 24 contrôles sur 24.

## Déploiement

1. Backend : `node db/migrate.js` (applique la 051), puis redémarrer.
2. Frontend : `frontend/dist` (v43) dans `public_html`.
3. Pour les e-mails, `APP_URL` du serveur doit être l'adresse publique de l'application : le lien des e-mails s'en sert.
