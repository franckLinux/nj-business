# NJ COMMERCIAL — Livraison C : bons de commande, vérification, tableau de bord

29/10/2026 · branche `module/commercial` · frontend v44.

## Ce qui est livré

- **Menu Achats** (selon les droits de chacun) : Tableau de bord, Demandes d'achat, Autorisations, **Bons de commande**, **Documents justificatifs**, **Historique**.
- **Bons de commande** :
  - Onglet **À commander** : les demandes approuvées dont une partie n'est encore sur aucun bon. Un compteur s'affiche dans le menu.
  - Bouton **Préparer un bon**, aussi présent sur la fiche de la demande.
- **Préparation** :
  - Choix du fournisseur et du lieu de livraison.
  - Conditions de paiement reprises de la fiche du fournisseur ; délai et observations.
  - Lignes issues de la demande uniquement, avec quantité, prix, remise et taxe. Totaux en direct, recalculés par le serveur.
  - Un avertissement apparaît dès qu'un prix dépasse le prix approuvé augmenté de la tolérance.
- **Fiche du bon** :
  - Liste des contrôles avant émission.
  - Aperçu PDF, filigrané « APERÇU — NON VALABLE ».
  - Émission, annulation avec motif, révision, proforma du fournisseur.
  - Lien de vérification, empreinte SHA-256 du PDF, historique.
- **PDF du bon émis** :
  - En-tête de l'Entité (logo, identité, NUI), blocs Fournisseur et Livraison.
  - Tableau des lignes, totaux HT, taxes et TTC.
  - Montant TTC en lettres (« Arrêté le présent bon de commande à la somme de… »).
  - Conditions, mentions, émetteur et autorisation, cadre « Visa et cachet de l'acheteur ».
  - QR code de vérification, pagination.
  - Le PDF est **archivé tel quel** : il n'est jamais régénéré, et son SHA-256 est enregistré.
- **Page publique `/verifier/<jeton>`** (ouverte par le QR code, sans connexion) :
  - Indique **authentique**, **annulé**, **remplacé** (avec la version en vigueur) ou **non reconnu**.
  - Affiche le numéro, l'émetteur et son NUI, le fournisseur et les dates. **Aucun prix**, aucune ligne.
  - Comparaison du PDF reçu : l'empreinte est calculée dans le navigateur et le fichier n'est envoyé nulle part.
- **Tableau de bord** : chiffres lus en base, jamais d'exemple.
  - À traiter aujourd'hui : à autoriser (achats, direction), renvoyées, à commander.
  - Sur la période : demandes, bons émis et montant, annulés, remplacés, délai moyen d'autorisation.
  - Montant émis par mois, principaux fournisseurs, demandes par statut, par demandeur.
- **Documents justificatifs** : toutes les pièces des demandes et des bons, avec recherche, nature, empreinte et pièces retirées.
- **Historique** : décisions du circuit et opérations tracées (demandes et bons) sur une période.

**Toujours hors périmètre, et affiché comme tel dans l'écran Démarrage** : réception, entrées et sorties de stock, rapprochement des factures fournisseurs, règlements, écritures comptables, ventes.

## Règles

| Règle | Détail |
| --- | --- |
| Origine | Un bon naît d'une demande **approuvée**. Une demande rejetée ne donne jamais de bon. |
| Quantités | Jamais au-delà de ce qui reste à commander (approuvé moins les bons brouillon ou émis). Une demande peut donner plusieurs bons, par exemple un par fournisseur. |
| Conformité | Fournisseur retenu pour la ligne. Prix net ≤ prix approuvé × (1 + tolérance), avec une tolérance de 10 % par défaut (Société). |
| Revalidation | Si le bon sort de l'autorisation, le préparateur demande une revalidation. La demande repasse en examen achats, et éventuellement direction, avec les prix et le fournisseur du bon. Les valideurs sont prévenus. |
| Proforma | Exigée avant l'émission si l'option est cochée dans Société. |
| Émission | `com.bc.emettre` (responsable des achats). Elle n'est possible que si **tous** les contrôles sont conformes. Numéro BC-AAAA-0001 par client et par année, sous verrou. |
| Intangibilité | Un bon émis ne se modifie ni ne se supprime. Un déclencheur en base le garantit (`BC_INTANGIBLE`). |
| Annulation | `com.bc.annuler`, motif obligatoire. Le PDF reste archivé et la vérification affiche « annulé ». |
| Révision | Elle crée un brouillon à partir du bon émis. À son émission, la révision prend le numéro d'origine suivi de `-R1`, `-R2`… et l'original passe en « remplacé ». |
| Taxes | Le code et le taux sont copiés dans chaque ligne. Une taxe utilisée par un bon ne peut plus changer de taux. |
| Demande | Elle ne s'annule plus tant qu'un bon actif en dépend. La fiche et la liste affichent « À commander », « Commandée en partie » ou « Commandée ». |

## Droits (profils créés à l'activation du module)

| Profil | Bons |
| --- | --- |
| Demandeur achats | Aucun accès aux bons. Il est prévenu quand sa demande donne un bon émis. |
| Gestionnaire des achats (GAS) | Prépare, modifie, joint la proforma, demande une revalidation. Ne peut pas émettre. Voit le tableau de bord. |
| Responsable des achats | Prépare, **émet**, annule, révise. Voit le tableau de bord. |

## Migration 052 (`db/migrations/052_commercial_bons_commande.sql`)

| Objet | Effet |
| --- | --- |
| `com_bons_commande` | En-tête, statut, totaux, autorisation, jeton de vérification (unique), chemin et SHA-256 du PDF. Un bon émis porte obligatoirement son jeton, son empreinte et sa date. |
| `com_bc_lignes` | Copie de l'article, de l'unité et de la taxe au moment de la commande, avec les montants. |
| Déclencheurs | Bon émis intangible. Lignes modifiables seulement en brouillon. Même client partout (bons, lignes, pièces). |
| `com_decisions` | Étape `gestionnaire` ajoutée, pour la revalidation. |

Additive et rejouable. Retour arrière : `052_retour_arriere.sql`. Il refuse de s'exécuter dès qu'un bon a été émis ou qu'une revalidation existe.

## Déploiement

1. **Backend** : `npm install` dans le dossier du backend, pour les nouvelles dépendances `pdfkit` et `qrcode`.
2. **Migration** : `node db/migrate.js`, qui applique la migration 052.
3. **Adresse de vérification** : `APP_URL` (première adresse) ou `VERIFICATION_URL` doit être l'adresse publique du frontend, par exemple `https://nj-business.net`.
   - Sans elle, l'émission est bloquée et le contrôle l'indique. Aucun lien fictif n'est jamais imprimé.
   - Option `VERIFICATION_RATE_MAX` : 30 vérifications par minute et par adresse IP par défaut.
4. **Frontend** : `dist` v44. Le service worker renouvelle le cache.
5. Redémarrer l'application (Passenger).

## Tests

- **`tests/commercial-bons.test.js`** : 12 tests.
  - Droits, calculs (60 × 3 500 − 5 % = 199 500 HT, TVA 38 404, TTC 237 904), aperçu, émission et numérotation.
  - Empreinte du PDF servi identique à l'empreinte enregistrée, intangibilité en base, vérification publique sans prix.
  - Revalidation, proforma obligatoire, taux de taxe figé, révision puis annulation, demande non annulable, isolement entre clients.
  - Tableau de bord, documents et historique.
- **Suite complète** : 122 tests, tous passés.
- **Parcours réel dans le navigateur** : 32 contrôles, tous passés.
  - Demandeur sans accès.
  - Le GAS prépare : avertissement de prix, contrôles, aperçu, proforma.
  - Le responsable émet ; empreinte vérifiée.
  - Page publique sur téléphone : authentique, sans prix ; PDF identique puis modifié détecté ; lien inconnu.
  - Révision `-R1`, puis l'original est « remplacé » ; annulation, puis « annulé ».
  - Tableau de bord sans montant inventé, documents, historique.
  - Téléphone sans débordement.
- **Non-régression** : les parcours des livraisons A (24) et B (21) passent toujours.
