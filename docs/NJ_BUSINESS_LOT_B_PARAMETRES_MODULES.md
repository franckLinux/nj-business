# NJ BUSINESS — Lot B : client sans module et paramètres propres à la caisse

**Date :** 17/11/2026 · **Migration :** 065 · **Service Worker :** v64 · **Branche :** `module/commercial`
**Référence :** `docs/AUDIT_AUTH_ENTREPRISE_UTILISATEURS.md`, lot B. Il fait suite au lot A, la configuration centrale de l'entreprise (064).

## 1. Ce qui change pour l'utilisateur

- **Création d'un client (cabinet, « Nouveau client ») :**
  - on saisit le nom, l'identifiant et la devise, puis on **coche les modules à activer** ;
  - NJ CAISSE PRO est coché par défaut, mais on peut tout décocher : le client est alors créé **sans module**, et sa configuration d'entreprise est accessible ;
  - les noms du caissier et du directeur ne se saisissent plus à cette étape : ils vont dans les paramètres de la caisse.
- **Activation de la caisse**, à la création ou plus tard (Plateforme → Modules) : elle prépare ses données de départ.
  - Rubriques et journaux par défaut.
  - Plan comptable, initialisé avec le référentiel que suggère la forme juridique, par exemple le SYCEBNL pour une ONG.
- **Caisse → Configuration → Entité**, devenu « Entité et paramètres de la caisse » :
  - **Plan comptable de la caisse :** deux cartes, SYSCOHADA révisé et SYCEBNL.
    - Elles indiquent le plan « En place » et le plan « Suggéré » par la forme juridique.
    - « Choisir ce plan… » ouvre l'aperçu chiffré et demande une confirmation.
    - Si le plan diffère de la suggestion, un écart est signalé, sans blocage.
  - **Signataires et exercice :** caissier(ère), directeur / visa, début et fin d'exercice.
    - Ce sont les noms imprimés sur les bons et états de caisse.
    - Sans directeur saisi, les documents portent le nom du représentant légal.
  - **Périodicité du budget :** inchangée.

## 2. Règles de gestion

1. **Aucun module n'est imposé.** La caisse n'est plus activée d'office à la création (`modules.par_defaut = false`).
   - Les modules cochés sont activés **dans la même transaction** que la création.
   - Un module inconnu ou encore en préparation annule tout : jamais de client à moitié créé.
2. **Chaque module prépare ses données à son activation**, plus à la création du client. Pour la caisse :
   - rubriques et journaux par défaut, **seulement si le client n'en a aucun** ;
   - plan comptable, initialisé seulement s'il n'existe pas.

   Une **réactivation** retrouve donc les données telles qu'elles étaient : journal renommé, journal supprimé, plan et signataires. Rien n'est recréé ni perdu.
3. **Le plan comptable se choisit dans la caisse** (votre décision n° 2).
   - La forme juridique le **suggère** seulement.
   - Modifier la forme juridique, par la configuration de l'entreprise ou par l'ancienne route `PUT /config`, ne change plus le plan.
   - Le changement de plan reste non destructif : comptes sortants archivés, comptes utilisés et comptes ajoutés conservés, retour possible.
4. **Le directeur signataire appartient à la caisse.** Le changement de représentant légal (lot A) ne l'écrase plus. Les impressions utilisent le directeur saisi, et à défaut le représentant légal.
5. **Routes `/api/caisse/…`** : elles relèvent du module NJ CAISSE PRO et sont refusées s'il n'est pas activé. La configuration de l'entreprise, elle, reste toujours ouverte.

**Ce qui n'a pas changé de place :** les réglages restent dans la table `tenants`. Aucune donnée n'a été déplacée.
- **Colonnes concernées :** `plan_referentiel`, `caissier_nom`, `directeur_nom`, `exercice_debut`, `exercice_fin`.
- **Pourquoi :** les déplacer aurait obligé à modifier des dizaines de requêtes de la caisse (rapports, passerelle, impressions), pour un risque élevé et sans gain.
- **Ce qui garantit la séparation :** seul le service `caisse_parametres` expose et modifie ces colonnes, sous des routes du module caisse.

C'est un écart assumé par rapport à l'audit, qui prévoyait une table `caisse_parametres`.

## 3. Création des clients : tous les chemins

| Chemin | Avant | Maintenant |
|---|---|---|
| Nouveau client (cabinet) | caisse imposée et préparée | modules cochés (zéro, un ou plusieurs) |
| Espace de démonstration (prospect) | caisse via le déclencheur | caisse activée explicitement (même résultat) |
| Conversion d'un prospect en client | caisse via le déclencheur | caisse activée explicitement (même résultat) |
| Démo NJ COMMERCIAL (`tools/demo-commercial.js`) | caisse via le déclencheur, non préparée | caisse et commercial activés explicitement ; la caisse de démo est désormais préparée |

Les clients existants ne sont pas touchés : ceux qui ont la caisse la gardent, avec toutes leurs données.

## 4. API

| Route | Droit | Rôle |
|---|---|---|
| `POST /api/tenants` `{ nom, slug, devise, modules: [...] }` | super_admin | création ; `modules` facultatif, liste vide = aucun module |
| `GET /api/caisse/parametres` | `config.view` ou `plan_comptable.view` | plan (en place, suggéré, écart), signataires, exercice |
| `PUT /api/caisse/parametres` | `config.edit` | signataires et exercice ; un champ absent n'est pas modifié |
| `GET /api/caisse/parametres/plan?referentiel=X` | `config.edit` | aperçu d'un changement de plan, sans aucune écriture |
| `POST /api/caisse/parametres/plan` `{ referentiel, confirmer: true }` | `config.edit` | choix du plan |

Toutes les modifications sont inscrites au journal d'audit :
- `CREATION_CLIENT`, avec la liste des modules ;
- `MODULE_ACTIVATION` ;
- `CAISSE_PARAMETRES` ;
- bascule de plan, tracée dans `plan_bascules`.

## 5. Migration 065

- `modules` (ligne `caisse`) : `par_defaut` passe à `false`, et `/caisse` est ajouté aux préfixes de routes du module.
- Aucune autre donnée n'est modifiée.
- La migration est idempotente et contient un contrôle bloquant.
- Retour arrière : `db/migrations-retour-arriere/065_retour_arriere.sql`. Il a été testé sur une copie de la base : appliquer, retour arrière, puis appliquer à nouveau.

## 6. Fichiers

**Backend, nouveaux fichiers :**
- `db/migrations/065_creation_client_sans_module.sql`
- `db/migrations-retour-arriere/065_retour_arriere.sql`
- `src/services/caisse_parametres.service.js`
- `src/controllers/caisse_parametres.controller.js`
- `tests/caisse-parametres.test.js`

**Backend, fichiers modifiés :**
- `src/services/modules.service.js` (préparation de la caisse, activation à la création)
- `src/controllers/tenants.controller.js`
- `src/validators/tenants.validator.js`
- `src/services/prospects.service.js`
- `src/services/commercial.service.js`
- `src/controllers/journaux.controller.js`
- `src/controllers/config.controller.js` (plus de bascule automatique)
- `src/controllers/journal.controller.js` et `rapport.controller.js` (directeur à défaut)
- `src/services/entreprise.service.js` (correctif de date et signataire préservé)
- `src/routes/index.js`
- `tools/demo-commercial.js`
- `tests/{modules, suppression-client, entreprise}.test.js`

**Frontend :**
- `src/components/config/EntiteTab.jsx`
- `src/components/config/BasculePlanModal.jsx`
- `src/pages/TenantsPage.jsx`
- `public/sw.js` (v64)
- `dist/`

## 7. Tests

**Backend : 24 suites, 200 tests, tous passent**, sur une base PostgreSQL 16 jetable (jamais la production).

La nouvelle suite `caisse-parametres` (7 tests) couvre :
- le **scénario 1**, client créé sans module : aucune donnée de caisse, configuration de l'entreprise accessible, caisse fermée ;
- la création avec modules ;
- le refus d'un module invalide, sans aucun reste de client à moitié créé ;
- le **scénario 2**, activation de la caisse : préparation, plan suggéré par la forme juridique, paramètres propres ;
- le choix du plan dans la caisse : droits, aperçu sans écriture, confirmation exigée, écart signalé, forme juridique sans effet ;
- les signataires et l'exercice : contrôles, journal d'audit, signataire non écrasé par le changement de représentant ;
- le **scénario 7**, désactivation puis réactivation : données et réglages intacts, rien en double ;
- la migration rejouable.

**Correctif :** la date de création de l'entreprise (lot A) et les dates d'exercice sont désormais restituées sans décalage de fuseau horaire. C'est vérifié en fuseau Africa/Lagos.

**Navigateur :**
- formulaire « Nouveau client » avec les modules à cocher ;
- client créé sans module ;
- paramètres de la caisse ;
- fenêtre de choix du plan avec son aperçu.

Le script de démonstration NJ COMMERCIAL a été exécuté en entier.

## 8. Déploiement

1. **Sauvegarder la base**, comme pour le lot A.
2. Mettre le code à jour, puis redémarrer : la migration 065 est jouée au démarrage.
3. Ctrl+Maj+R (cache v64).
4. Vérifier, dans Caisse → Configuration → Entité, le plan en place et les signataires.

## 9. Points restant à traiter

- **Périodicités trimestrielle, semestrielle et annuelle du budget :** lot à part, après le lot E, comme vous l'avez décidé.
- **Lot C :** utilisateurs par module (`user_modules`) et reprise des utilisateurs existants. Avant ce lot, lancer en production la requête d'inventaire, en lecture seule, du document d'audit.
- **Dates d'exercice :** elles sont enregistrées, mais aucun traitement de la caisse ne les utilise encore.
