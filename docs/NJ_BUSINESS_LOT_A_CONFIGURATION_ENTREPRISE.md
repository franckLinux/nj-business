# NJ BUSINESS — Lot A : configuration centrale de l'entreprise

**Date :** 17/11/2026 · **Migration :** 064 · **Service Worker :** v62 · **Branche :** `module/commercial`
**Référence :** `docs/AUDIT_AUTH_ENTREPRISE_UTILISATEURS.md` (étapes 1 et 2), lot A du plan de migration.

## 1. Ce qui change pour l'utilisateur

- Un nouvel espace, **« Configuration de l'entreprise »**, appartient au socle NJ BUSINESS. On l'ouvre :
  - depuis l'accueil (carte en tête de page) ;
  - depuis l'icône « immeuble » de la barre du haut, à côté de la cloche des notifications, dans la caisse comme dans le Commercial (v63 : retirée du menu latéral) ;
  - depuis la page Société du Commercial.

  **Il fonctionne même quand aucun module n'est activé.**
- L'espace est organisé en trois onglets :
  - **Identité** :
    - raison sociale, nom commercial, sigle, slogan, forme juridique, secteur d'activité, date de création, devise principale ;
    - coordonnées : pays, région, ville, BP, adresse, téléphone, e-mail, site ;
    - **logo**, que l'on peut importer, prévisualiser, remplacer ou supprimer ;
    - aperçu de l'en-tête des documents.
  - **Informations légales** :
    - NIU, RCCM, n° d'immatriculation, n° statistique, agrément, aucun n'étant obligatoire ;
    - jusqu'à 20 **références libres** (CNPS employeur, licence…).
  - **Représentant légal** :
    - nom, prénoms, fonction, téléphone, e-mail, adresse, signature (image facultative) ;
    - « **Enregistrer les corrections** » met à jour la personne en fonction, sans créer d'historique ;
    - « **Changer de représentant légal** » clôt la personne en fonction la veille de la prise de fonction du nouveau représentant, puis la place dans l'historique. L'identité de l'entreprise n'est pas modifiée.
- **Lecture seule** pour qui a seulement le droit de consulter (caissier, comptable…).
- **Caisse, onglet « Entité »** :
  - l'identité y est affichée en lecture, avec le bouton « Modifier la configuration de l'entreprise » ;
  - l'onglet garde ce qui est propre à la caisse : plan comptable et périodicité du budget.
- **Commercial, page « Société »** :
  - l'identité y est affichée en lecture, avec un lien vers la configuration de l'entreprise ;
  - le « mode remplissage » est supprimé ;
  - la page garde les règles du stock.

## 2. Règles de gestion

1. **Une seule source pour l'identité** : la table `tenants`. Aucun module ne la recopie.
   - Le nom commercial quitte `com_parametres` pour la configuration centrale ; la migration recopie la valeur existante.
   - `PUT /commercial/societe` refuse désormais l'identité et le nom commercial, avec le code 409 et un message qui renvoie vers la configuration de l'entreprise.
2. **La forme juridique ne change plus le plan comptable.** Modifier la forme juridique dans la configuration de l'entreprise ne bascule rien.
   - La caisse signale l'écart : « la forme juridique suggère le SYCEBNL ; la caisse applique le SYSCOHADA ».
   - Elle propose de passer au plan suggéré. C'est votre décision n° 2 ; le choix complet du plan arrive au lot B.
3. **Documents anciens.** L'identité est **figée** dans le document (`identite_emetteur`) au moment où il devient définitif :
   - à l'émission d'un bon de commande ;
   - à la validation d'un devis ;
   - à la livraison ;
   - au lancement d'une consultation de fournisseurs.

   Ce document garde cette identité ; les documents futurs prennent la nouvelle. La vérification publique d'un bon de commande montre l'émetteur d'origine. L'identité figée, logo compris, ne circule jamais dans les listes.
4. **Compatibilité caisse.** Le nom du représentant en fonction reste recopié dans `tenants.dirigeant_nom` et `directeur_nom`, que les impressions de la caisse lisent encore. `PUT /config` est gardé pour la compatibilité, mais l'écran ne l'utilise plus.
5. **Traçabilité.** Chaque modification va au journal d'audit :
   - `ENTREPRISE_IDENTITE` et `ENTREPRISE_REFERENCES` ;
   - `ENTREPRISE_LOGO_AJOUTE`, `ENTREPRISE_LOGO_REMPLACE` et `ENTREPRISE_LOGO_SUPPRIME` ;
   - `ENTREPRISE_REPRESENTANT_MODIFIE` et `ENTREPRISE_REPRESENTANT_CHANGE`.

   Le journal ne contient jamais l'image elle-même.

## 3. Droits (migration 064)

Deux nouvelles permissions forment le module de permission « entreprise », rangé dans le groupe **socle**, qui ne dépend plus de la caisse :

| Permission | Attribuée par la migration à… |
|---|---|
| `entreprise.view` | ceux qui avaient `config.view` ou `com.parametrage.voir` : rôles système, profils des clients, exceptions individuelles, plafonds des clients |
| `entreprise.edit` | ceux qui avaient `config.edit`, soit le directeur et les profils qui l'avaient |

**Personne ne gagne un droit de modification qu'il n'avait pas.** Un contrôle bloquant de la migration le vérifie. Les attributions sont tracées dans `entreprise_droits_064`, pour le retour arrière.

## 4. Base de données

- **`tenants`** : ajout de `nom_commercial`, `slogan`, `date_creation`, `region`, `immatriculation`, `numero_statistique`, `agrement`.
- **`entreprise_references`** : nouvelle table des références libres.
- **`entreprise_representants`** : nouvelle table avec historique.
  - Un index unique garantit **un seul représentant en fonction** par entreprise.
  - L'ancien `dirigeant_nom` est repris, avec l'origine « migration ».
- **`identite_emetteur JSONB`** : nouvelle colonne sur `com_bons_commande`, `com_devis`, `com_livraisons` et `com_consultations`.
- La migration est additive et idempotente. Elle ne touche à **aucune donnée de caisse**.
- Retour arrière : `db/migrations-retour-arriere/064_retour_arriere.sql`. Il a été testé sur une copie de la base : appliquer, retour arrière, puis appliquer à nouveau.

## 5. API

| Route | Droit | Rôle |
|---|---|---|
| `GET /api/entreprise` | `entreprise.view` | identité, références, représentant, historique, formes juridiques, devises |
| `PUT /api/entreprise` | `entreprise.edit` | identité et, si fournies, références (la liste remplace l'ancienne) ; un champ absent n'est pas modifié |
| `PUT /api/entreprise/logo` · `DELETE /api/entreprise/logo` | `entreprise.edit` | logo PNG, JPEG ou WebP de 300 Ko au plus ; le SVG est refusé |
| `PUT /api/entreprise/representant` | `entreprise.edit` | correction du représentant en fonction |
| `POST /api/entreprise/representants` | `entreprise.edit` | changement de représentant légal |

Ces routes appartiennent au socle : elles ne sont jamais bloquées par l'activation des modules.
- Pour un utilisateur rattaché à un client, l'entreprise vient toujours de son jeton.
- Pour le cabinet, elle vient de l'en-tête `X-Tenant-Id`, limité aux clients affectés à la personne.

## 6. Fichiers

**Backend, nouveaux fichiers :**
- `db/migrations/064_entreprise_configuration.sql`
- `db/migrations-retour-arriere/064_retour_arriere.sql`
- `src/services/entreprise.service.js`
- `src/controllers/entreprise.controller.js`
- `tests/entreprise.test.js`

**Backend, fichiers modifiés :**
- `src/routes/index.js`
- `src/services/permission.service.js` (groupe « socle »)
- `src/controllers/config.controller.js` (export de `verifierLogo`)
- `src/services/commercial/{bons, ventes, consultations, referentiel}.service.js`
- `tests/commercial-{parametrage, bons, ventes, approvisionnement}.test.js`

**Frontend, nouveaux fichiers :**
- `src/pages/EntreprisePage.jsx`
- `src/lib/images.js`
- `src/styles/entreprise.css`

**Frontend, fichiers modifiés :**
- `src/App.jsx` (route `/entreprise`)
- `src/pages/AccueilPage.jsx`
- `src/components/Sidebar.jsx`
- `src/components/config/EntiteTab.jsx`
- `src/pages/commercial/SocietePage.jsx`
- `src/components/PermModuleGrid.jsx`
- `src/styles/nj-business.css`
- `public/sw.js` (v62)
- `dist/`

## 7. Tests

- **Backend : 23 suites, 193 tests, tous passent**, sur une base PostgreSQL 16 jetable (jamais la production). La nouvelle suite `entreprise` (8 tests) couvre :
  - les permissions reprises sans nouveau droit de modification ;
  - le **scénario 1**, entreprise sans aucun module : configuration accessible et modifiable, modules fermés ;
  - les contrôles de saisie ;
  - la lecture seule du caissier ;
  - le fait que la forme juridique ne bascule plus le plan ;
  - le cycle du logo et le journal sans image ;
  - le représentant légal : correction, changement, historique, identité inchangée, nom recopié pour la caisse ;
  - le **scénario 8**, isolation entre entreprises et affectations du cabinet ;
  - la reprise du dirigeant existant et une migration rejouable.
- **Documents figés :** les suites commerciales vérifient l'identité figée sur le bon émis, le devis validé, la livraison et la consultation lancée. Elles vérifient aussi qu'un bon garde le nom d'origine après un changement de nom et que l'identité figée est absente des listes.
- **Navigateur**, sur des comptes de test :
  - accueil d'une entreprise sans module, avec la carte « Configuration de l'entreprise » ;
  - identité enregistrée et aperçu de l'en-tête ;
  - informations légales et référence libre ;
  - changement de représentant avec historique ;
  - caissier en lecture seule ;
  - téléphone en 390 px, sans défilement horizontal ;
  - onglet Entité de la caisse, avec l'écart entre la forme juridique et le plan signalé.
- **Compilation :** `npm run build` réussi. Le build de production garde son adresse d'API (`VITE_API_URL` de `.env.production`).

## 8. Déploiement

1. Mettre le code à jour depuis GitHub, branche `module/commercial`.
2. **Sauvegarder la base de production.**
3. Redémarrer l'application : la migration 064 est jouée au démarrage.
4. Ctrl+Maj+R pour le cache v62.
5. Vérifier « Configuration de l'entreprise » depuis l'accueil.

## 9. Points restant à traiter (lots suivants)

- **Lot B :** choix du plan comptable et des signataires dans `caisse_parametres`, et création d'un client sans données de caisse (aujourd'hui encore, le déclencheur active la caisse à la création).
- Les impressions de la caisse (bons, journaux) n'affichent pas encore le nom commercial, le slogan ni les nouvelles références. Elles lisent toujours `/config/entete`.
- La signature du représentant est enregistrée, mais pas encore imprimée sur les documents.
