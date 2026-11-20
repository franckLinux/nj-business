# NJ CAISSE PRO — Projets des ONG et associations — Lot P3
## Justificatifs, archives et bilan des activités

*20/11/2026 — migration 070, Service Worker v73 — branche `module/commercial`.*
*Lots précédents : `NJ_BUSINESS_PROJETS_LOT_P1.md`, `NJ_BUSINESS_PROJETS_LOT_P2.md`.*

---

## 1. Ce que livre le lot

| Élément | Résultat |
|---|---|
| **Dépôt** | Le responsable de l'activité (ou le chef du projet, la direction) dépose une pièce : activité, remise de fonds concernée (facultatif), objet, date, montant, fournisseur, n° de facture, **pièce scannée obligatoire** (PDF, JPG, PNG, WEBP, 5 Mo ; appareil photo sur téléphone). Le type réel du fichier est vérifié. Le chef de projet est prévenu. |
| **Contrôle** | Par le **chef de ce projet** ou le **comptable** — jamais par la personne qui a déposé (refus de l'API **et** contrainte en base). Valider, ou rejeter avec un motif ; le déposant est prévenu. File « Justificatifs à contrôler » qui regroupe tous les projets du contrôleur. |
| **Annulation** | Une pièce validée ne se modifie ni ne se supprime (garde-fou en base). Seul le **directeur** l'annule, motif obligatoire ; elle reste archivée, barrée, et n'est plus comptée. Une pièce encore « à contrôler » peut être retirée par son auteur. |
| **Archives** | Onglet « Justificatifs » de chaque projet : toutes les pièces, filtres par activité et statut, recherche, ouverture de la pièce scannée. Fichiers rangés dans le stockage **privé** (`PV_DIR/<client>/justificatifs/…`), servis par une route authentifiée, jamais par `/uploads`. |
| **Bilan** | Page « Bilan des activités » : **en attente de justification** (montant, part déjà déposée, avancement, nombre de jours depuis la dernière remise) et **activités validées**. Filtre par projet, export Excel et PDF (A4 paysage, en-tête de l'entité). |
| **Chiffres** | Par activité : remis (sorties du journal), justifié (pièces validées), remboursé (entrées du journal sur l'activité — reliquat rendu), **en attente = remis − justifié − remboursé**. Repris sur la fiche projet (cartes « Justifié » et « En attente de justification », colonne « Justification ») et sur le tableau de bord. |
| **Navigation** | Dans l'espace Projets : Tableau de bord & projets · Justificatifs à contrôler (pastille) · Bilan des activités. La pastille du menu « Projets » additionne budgets à valider et pièces à contrôler. |

Une activité est **validée** quand tout l'argent remis à son responsable est justifié par des pièces validées ou remboursé.

## 2. Qui fait quoi

| | Directeur | Comptable | Chef de projet | Responsable d'activité |
|---|:-:|:-:|:-:|:-:|
| Déposer | ✅ | ❌ | ✅ ses projets | ✅ ses activités |
| Valider / rejeter | ❌ | ✅ | ✅ ses projets | ❌ |
| Ses propres pièces | — | jamais | jamais | jamais |
| Annuler une pièce validée | ✅ | ❌ | ❌ | ❌ |
| Archives et bilan | ✅ tout | ✅ tout | ✅ ses projets | ✅ ses activités |

## 3. Fichiers

| Fichier | Rôle |
|---|---|
| `backend/db/migrations/070_projets_justificatifs.sql` (+ retour arrière) | Table `projet_justificatifs`, garde-fous |
| `backend/src/services/projets_justificatifs.service.js` | Dépôt, contrôle, annulation, fichier, file à contrôler, bilan |
| `backend/src/services/projets_gestion.service.js` | Chiffres de justification par activité |
| `backend/src/controllers/projets.controller.js`, `routes/index.js` | 9 routes nouvelles |
| `frontend/src/components/projets/Justificatifs.jsx`, `ProjetsNav.jsx` | Dépôt, tableau des pièces, navigation |
| `frontend/src/pages/ProjetsAControlerPage.jsx`, `ProjetsBilanPage.jsx` | File de contrôle, bilan |
| `frontend/src/lib/print.js` | `printBilanProjets` |
| `backend/tests/projets-p3.test.js` | 9 scénarios |

## 4. Vérifications

- Projets P1 + P2 + P3 : **39 / 39**. Suite complète : **265 / 265**.
- Migration rejouée deux fois, retour arrière puis nouvelle application : sans erreur.
- Parcours dans le navigateur (v73) : dépôt d'une facture PDF par le responsable sur téléphone ; chef de projet — file « à contrôler », validation ; directeur — fiche (justifié 450 000, en attente 750 000), bilan et archives.

## 5. Déploiement

1. Sauvegarde de la base.
2. Envoyer le code (backend + `frontend/dist`).
3. `node db/migrate.js` (applique la 070).
4. Vérifier que le dossier privé des PV (`PV_DIR`, par défaut `backend/prive/pv`) est inscriptible : les justificatifs y sont rangés, dans un sous-dossier par client. Il est déjà exclu de Git.
5. Redémarrer le serveur, vider le cache du navigateur (Ctrl+Maj+R).
