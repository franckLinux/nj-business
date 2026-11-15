# Révision du 09/11/2026 : plan SYCEBNL, compte d'emploi par compte, registre des écarts de caisse

Migrations **060** et **061**, cache du service worker en **v59**. Rien n'est supprimé et aucune donnée existante n'est modifiée au déploiement.

---

## 1. Plan comptable SYCEBNL pour les associations et les ONG

### Règle
| Forme juridique de l'entité | Plan comptable chargé |
|---|---|
| Association (`ASSOC`) ou ONG (`ONG`) | **SYCEBNL** (entités à but non lucratif) |
| Toute autre forme, ou aucune | **SYSCOHADA révisé** (défaut, inchangé) |

La règle existe à un seul endroit : la fonction SQL `plan_referentiel_de_forme()`, reprise par `plan_referentiel.service.js`.

### Fonctionnement
- **Référentiel embarqué** : `db/data/plan-comptable-sycebnl.js` contient 585 comptes, dont 124 propres aux EBNL. Ils sont chargés par la migration 060 dans `plan_referentiel_comptes`.
  - Classe 1 : dotations et fonds affectés.
  - Classes 41, 45 et 46 : adhérents, fondateurs, bailleurs.
  - Classe 70 : cotisations, dons, legs.
  - Classe 71 : subventions.
  - Classes 75 et 79, 842/843 et 88x.
  - Classe 9 : contributions volontaires en nature.
- **Changement de forme juridique** (Configuration → Entité) — *révisé le 09/11 : bascule automatique* : dès qu'une autre forme est choisie, un aperçu s'affiche sous la liste (comptes ajoutés, libellés repris, archivés, réactivés, comptes utilisés dont le libellé change) et le bouton devient « Enregistrer et charger le plan … ». **L'enregistrement charge le plan directement** (plus de fenêtre de confirmation ni de code 409), dans la même transaction que l'entité.
- **Bascule** : elle est faite par la fonction SQL `plan_client_basculer()`, en un bloc :
  - les comptes absents du plan sont ajoutés ;
  - un compte de même numéro reprend le libellé du nouveau référentiel, sauf si le client l'avait personnalisé ;
  - les comptes sortants sont archivés, sauf s'ils sont utilisés (rubrique, équivalence, journal, virements) ;
  - les comptes additifs du client ne sont jamais touchés ;
  - la bascule est réversible : revenir à l'ancienne forme restaure l'ancien plan ;
  - elle est tracée dans `plan_bascules` et `audit_log`.
- **Entités déjà déclarées Association ou ONG avant la 060** : aucune bascule d'office. Un bandeau « Plan à aligner » apparaît dans Entité et dans Plan comptable, avec un bouton qui ouvre le même aperçu.
- **Comptes additifs** : le bouton « + Compte additif » fonctionne comme avant, dans les deux référentiels.
- **NJ COMMERCIAL, client sans caisse** : un changement de forme fait depuis la fiche Société bascule aussi le plan, dans la même transaction.
- **Synchronisation du modèle (plateforme)** : un client sous SYCEBNL est marqué « SYCEBNL » et exclu de la synchronisation SYSCOHADA. Une tentative de synchronisation est refusée avec un message clair.

### Points d'attention
- Le référentiel SYCEBNL a été établi à partir de l'Acte uniforme et du guide d'application OHADA (2023), puis complété des comptes communs du SYSCOHADA. **Faites relire les classes 1, 4, 7 et 9 par le cabinet.** Pour corriger ou ajouter un compte, éditez `plan-comptable-sycebnl.js`, puis lancez `npm run db:plan` ou faites un redémarrage avec AUTO_SETUP. Le chargement ne fait que des ajouts.
- **Comptes utilisés dont le libellé change** (par exemple 701 « Ventes de marchandises » qui devient « Cotisations des adhérents ») : l'aperçu les liste. Il faut ensuite revoir les équivalences de ces rubriques dans le contrôle de régularité formelle.
- **Pistes possibles** :
  - Étendre la règle aux fondations, aux projets de développement, aux syndicats et aux ordres professionnels. Il suffit d'ajouter leurs codes dans `FORMES_EBNL` et dans `plan_referentiel_de_forme()`, et d'ajouter les formes à la liste des formes juridiques.
  - Rendre le référentiel SYCEBNL administrable depuis la plateforme, avec versions et synchronisation, comme le modèle SYSCOHADA.

---

## 2. Compte d'emploi par rubrique ou par compte comptable

- La section **III · Emplois** a deux présentations au choix :
  - **Par rubrique** : le comportement d'avant, avec maintenant le numéro de compte affiché à côté de la rubrique ;
  - **Par compte comptable** : les comptes sont triés par numéro et chacun se déplie pour montrer ses rubriques. Un clic sur une rubrique ouvre son détail.
- Le choix est mémorisé dans le navigateur. **L'export Excel et l'impression suivent la présentation choisie.**
- **Compte d'une rubrique** : c'est `rubriques.code_comptable`, l'équivalence validée par la passerelle.
- **Intitulé du compte** : il est lu dans le plan du client (SYSCOHADA ou SYCEBNL). Si le compte n'existe pas dans le plan, l'intitulé du plus proche compte parent est affiché, par exemple « Autres frais de transport (rattaché au 618) ».
- **Rubriques sans compte** : elles sont regroupées en fin de tableau sous « Sans compte comptable », avec un bandeau d'alerte. Les totaux sont identiques dans les deux présentations.

---

## 3. Registre des écarts de caisse

Nouveau menu : **Contrôle comptable → Écarts de caisse**.

| Étape | Qui | Effet |
|---|---|---|
| **Constat** | Comptable (`controle.saisir`) | Solde théorique comparé au solde compté, cause obligatoire. Une écriture est passée au journal : **ECP** (excédent, entrée) ou **ECN** (manquant, sortie), sur le compte d'attente 471. Le journal rejoint ainsi la caisse réelle. |
| **Affectation** (« où est allé l'écart ») | Comptable | **Manquant** : imputé au caissier (421), imputé à un tiers (471), perte en charge (658) ou en attente d'investigation (471). **Excédent** : produit (758), à restituer (471) ou en attente (471). Le compte est vérifié dans le plan du client, et le reclassement 471 → destination est affiché. |
| **Régularisation** | Comptable | Recouvrement, retenue sur salaire, restitution… avec date, mode et référence. L'écart passe « soldé ». |
| **Annulation** | `controle.reouvrir` | Contre-passation de l'écriture d'écart, avec un motif obligatoire. |

### Origines d'un écart
- **Arrêté de caisse** : dès que le solde constaté est saisi dans Arrêtés & inventaires. Un bouton « Constater au registre → » apparaît dans la fenêtre de l'arrêté.
- **Inventaire validé** : les soldes sont figés à la validation.
- **Comptage ponctuel** : à une date choisie. Le solde théorique est calculé par le serveur.

Le panneau « Écarts détectés à constater » liste les écarts d'arrêtés et d'inventaires qui ne sont pas encore au registre. Pour ces deux origines, les soldes viennent toujours du serveur : aucun montant saisi n'est cru sur parole.

### Garde-fous
- L'écriture d'écart suit les règles du journal :
  - période ouverte : l'écart d'un mois arrêté se passe dans la période suivante, et le message d'erreur l'explique ;
  - ordre chronologique ;
  - caisse jamais négative.
- Elle est **exemptée du contrôle budgétaire**.
- Les rubriques ECP et ECN sont des rubriques système :
  - créées à la première constatation ;
  - absentes des listes de saisie, de budget et d'appel de fonds ;
  - refusées en saisie manuelle au journal (code `RUBRIQUE_ECART_RESERVEE`) ;
  - impossibles à désactiver.
- Un même arrêté ou une même ligne d'inventaire ne peut donner qu'un seul écart actif (index unique).
- Numérotation `ECA-AAAA-NNNN` par client. Chaque action est tracée dans `audit_log`.

### Points d'attention et pistes
- **Écart d'un arrêté** : il est corrigé dans la période suivante, et non dans le mois arrêté, qui reste figé. Pour qu'un écart soit corrigé dans le mois, faites un **comptage** avant l'arrêt. Le solde constaté de l'arrêté sera alors égal au solde arrêté.
- **Remboursement en espèces par le caissier** : c'est une recette normale à saisir au journal. Le registre en garde seulement la trace (mode et référence).
- **Annulation** : le droit `controle.reouvrir` est accordé par défaut au comptable. Pour que le directeur puisse annuler un écart, cochez ce droit dans Configuration → Rôles.
- **Pistes possibles** :
  - Exiger le visa du directeur pour l'imputation au caissier et pour le passage en charge ;
  - Générer automatiquement l'OD de reclassement dans la passerelle et l'export SAGE.

---

## Fichiers

**Backend**
- Nouveaux : `db/migrations/060_plan_sycebnl.sql`, `db/migrations/061_ecarts_caisse.sql`, `db/data/plan-comptable-sycebnl.js`, `src/services/plan_referentiel.service.js`, `src/services/ecarts_caisse.service.js`, `src/controllers/ecarts_caisse.controller.js`.
- Modifiés : `db/lib/seed-plan.lib.js`, `src/controllers/{config,journal,rapport,rubriques}.controller.js`, `src/models/{Tenant,Rubrique}.js`, `src/routes/index.js`, `src/services/{annulation,plan_client,plan_synchro}.service.js`, `src/services/commercial/referentiel.service.js`.

**Frontend**
- Nouveaux : `pages/EcartsCaissePage.jsx`, `components/config/BasculePlanModal.jsx`.
- Modifiés : `App.jsx`, `components/{Layout,Sidebar,PlanSynchroPanel}.jsx`, `components/config/{EntiteTab,PlanComptableTab}.jsx`, `lib/{acces,print}.js`, `pages/{ArretsInventairesPage,CompteEmploiPage}.jsx`, `public/sw.js` (v59).

## Déploiement
1. Copier les fichiers.
2. Redémarrer le backend. Les migrations 060 et 061 s'appliquent au démarrage avec AUTO_SETUP, sinon lancer `npm run db:migrate`.
3. Reconstruire le frontend (`npm run build`) et le déployer.
4. Vider le cache du navigateur (Ctrl+Maj+R, ou désinscrire le service worker).

## Vérifications faites
Les vérifications ont été faites sur une copie locale de PostgreSQL 16 :
- installation neuve et relance (idempotence) ;
- bascule SYSCOHADA → SYCEBNL → SYSCOHADA, avec retour exact à l'état initial ;
- refus sans confirmation, droits d'accès ;
- compte d'emploi dans les deux présentations ;
- cycle complet d'un écart :
  - comptage, arrêté, doublon refusé ;
  - période arrêtée refusée ;
  - affectation (destination incompatible et compte inexistant refusés) ;
  - régularisation et annulation par contre-passation ;
  - rubrique ECN refusée en saisie manuelle ;
- `node --check` sur tous les fichiers backend ;
- build Vite ;
- contrôle visuel des écrans.
