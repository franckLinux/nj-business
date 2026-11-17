# NJ BUSINESS — Lot C : utilisateurs par module

**Date :** 17/11/2026 · **Migration :** 066 · **Service Worker :** v65 · **Branche :** `module/commercial`
**Référence :** `docs/AUDIT_AUTH_ENTREPRISE_UTILISATEURS.md`, lot C. Il suit les lots A (configuration de l'entreprise) et B (client sans module, paramètres de la caisse).

## 1. Ce qui change pour l'utilisateur

**NJ CAISSE PRO, Configuration → Utilisateurs.** La liste devient « Utilisateurs de NJ CAISSE PRO » et ne montre que les acteurs de la caisse.
- **En tête :** le nombre d'utilisateurs, d'actifs et de désactivés, et le nombre de comptes « sans module », s'il y en a.
- **Par personne :**
  - **profil propre à la caisse** (facultatif). Par défaut, c'est « selon le compte », c'est-à-dire le rôle et le profil métier, comme avant ;
  - bouton 🚪 **Retirer de NJ CAISSE PRO**, avec un motif obligatoire.
- **« Autres comptes de l'entreprise »** : les comptes qui n'ont pas accès à la caisse, avec leurs modules. Le bouton « + Ajouter à NJ CAISSE PRO » les rattache, avec un profil au choix.
- **« + Nouvel utilisateur »** crée un compte rattaché à la caisse **seulement**.

**NJ COMMERCIAL, Configuration → Utilisateurs.** Même principe pour les acteurs du commercial : responsable des achats, magasinier, vendeur…
- Le bouton **« + Nouvel utilisateur »** est maintenant dans le module : un compte créé ici n'a pas accès à la caisse.
- La page garde les droits et les types de gestion.
- Chaque ligne a un sélecteur de profil du commercial et un bouton **Retirer**.
- La section « Autres comptes » sert à rattacher un compte existant.

**Administration plateforme (super_admin) → « Utilisateurs par module ».**
- **Mode du contrôle :**
  - **observation**, le mode de départ : rien n'est refusé ;
  - **application** : chacun n'entre que dans les modules auxquels il est rattaché.

  On passe de l'un à l'autre par un bouton, après confirmation.
- **Date et bilan de la reprise** des comptes existants.
- **Écarts** : les personnes qui ont des droits dans un module sans y être rattachées. Elles les perdraient en mode application.
- **Répartition par client** : nombre de comptes, comptes par module, comptes sans module. Les clients à examiner sont présentés en premier, avec une recherche.
- **« Reprendre les comptes sans module »** rattache, d'après leurs droits, les comptes qui n'ont encore aucun module.

## 2. Règles de gestion

1. **Chaque module a ses utilisateurs** (`user_modules`). Un compte peut appartenir à plusieurs modules. Un compte créé dans un module n'est rattaché qu'à ce module.
2. **Profil propre au module** (facultatif) : pour ce module, il remplace le profil métier du compte ; les autres modules ne changent pas.

   Exemple : un caissier reçoit le profil « Magasinier » dans le commercial. Il garde sa caisse et obtient les droits de magasinier dans le commercial.
3. **Retirer n'est jamais supprimer :**
   - le rattachement est seulement désactivé, avec son motif et son auteur ;
   - le compte, ses autres modules et son historique restent intacts ;
   - on ne peut pas se retirer soi-même.
4. **Reprise des comptes existants** : elle a lieu une seule fois, au premier démarrage après la migration.
   - Chaque compte est rattaché aux modules **où il a des droits aujourd'hui** (rôle, profil, types de gestion, exceptions, plafond du client), parmi les modules que possède son client.
   - **Aucun droit n'est ajouté ni retiré.**
   - Un compte qui n'a de droit dans aucun module reste « sans module » et apparaît dans « Autres comptes ».
   - La reprise ne recommence jamais d'elle-même.
5. **Contrôle en deux temps :**
   - **Observation, le mode par défaut :** les droits restent ceux d'avant. Les listes et le rapport montrent la répartition et les écarts.
   - **Application :**
     - une personne d'un client ne garde les droits d'un module que si elle y est rattachée ;
     - une route d'un module lui est refusée sinon (code `MODULE_NON_AUTORISE`) ;
     - la carte du module disparaît de son accueil.

   Le passage d'un mode à l'autre est tracé dans le journal d'audit.
6. **Le socle reste ouvert** à tout compte du client, quel que soit le module : configuration de l'entreprise (`entreprise.*`), gestion des utilisateurs (`users.*`) et rôles.
7. **Comptes du cabinet** (super_admin, comptable du cabinet) : non concernés. Ils passent par les affectations de clients.
8. **Isolation entre clients :** un compte ne peut être rattaché qu'à un module de son propre client, et un profil ne peut venir que de ce client. Le serveur le contrôle, et la base le refuse aussi, par un déclencheur.

## 3. Base de données (migration 066)

- **`user_modules`** :
  - colonnes : `user_id`, `module_code`, `tenant_id`, `actif`, `role_id` (profil du module, facultatif), `origine` (`migration`, `manuel`, `creation`), `affecte_par`, `affecte_le`, `modifie_par`, `modifie_le`, `motif` ;
  - clé : (`user_id`, `module_code`) ;
  - déclencheur de cohérence : le compte et le profil appartiennent au client de la ligne.
- **`plateforme_reglages`** contient :
  - `acces_modules_utilisateurs` : `"observer"` au départ ;
  - `reprise_utilisateurs_066` : date et bilan de la reprise.
- La migration est additive et idempotente.
- Retour arrière : `db/migrations-retour-arriere/066_retour_arriere.sql`. Il a été testé sur une copie de la base : appliquer, retour arrière, puis appliquer à nouveau.

## 4. API

| Route | Droit | Rôle |
|---|---|---|
| `GET /api/modules/:code/utilisateurs` | `users.view` (commercial : aussi `com.parametrage.modifier`) | membres, autres comptes, résumé, profils du module, mode |
| `POST /api/modules/:code/utilisateurs` `{ user_id, role_id? }` | `users.edit` | rattacher un compte, ou le rattacher à nouveau |
| `PUT /api/modules/:code/utilisateurs/:userId` `{ role_id }` | `users.edit` | profil propre au module (`null` : selon le compte) |
| `DELETE /api/modules/:code/utilisateurs/:userId` `{ motif }` | `users.edit` | retirer du module |
| `POST /api/users` `{ …, modules: [...] }` | `users.create` | création d'un compte rattaché au(x) module(s) indiqué(s), qui doivent être activés pour le client |
| `GET /api/plateforme/utilisateurs-modules` | super_admin | répartition, écarts, mode, reprise |
| `PUT /api/plateforme/utilisateurs-modules/mode` `{ mode }` | super_admin | `observer` ou `appliquer` |
| `POST /api/plateforme/utilisateurs-modules/reprise` | super_admin | reprise des comptes sans aucun module |

`GET /api/auth/me` indique pour chaque module `membre` : `true` ou `false` en mode application, `null` en observation.

Ces opérations sont inscrites au journal d'audit : `MODULE_UTILISATEUR_AJOUTE`, `MODULE_UTILISATEUR_PROFIL`, `MODULE_UTILISATEUR_RETIRE`, `ACCES_MODULES_MODE`.

## 5. Fichiers

**Backend, nouveaux fichiers :**
- `db/migrations/066_utilisateurs_modules.sql`
- `db/migrations-retour-arriere/066_retour_arriere.sql`
- `src/services/utilisateurs_modules.service.js`
- `src/controllers/utilisateurs_modules.controller.js`
- `tests/utilisateurs-modules.test.js`

**Backend, fichiers modifiés :**
- `src/services/permission.service.js` (profil du module, filtre en mode application)
- `src/services/modules.service.js` (`membre` dans la session)
- `src/middleware/tenant.js` (refus `MODULE_NON_AUTORISE`)
- `src/controllers/auth.controller.js`
- `src/controllers/users.controller.js` (`modules` à la création)
- `src/services/prospects.service.js`
- `src/routes/index.js`
- `index.js` (reprise au démarrage)
- `tools/demo-commercial.js` : rattachement des comptes de démonstration. J'ai aussi corrigé une erreur passée sous silence : le nom commercial de la démo, qui doit être lu dans l'identité centrale.

**Frontend, nouveaux fichiers :**
- `src/components/UtilisateursModule.jsx`
- `src/components/RepartitionUtilisateurs.jsx`
- `src/styles/utilisateurs-module.css`

**Frontend, fichiers modifiés :**
- `src/components/config/UsersTab.jsx`
- `src/pages/commercial/UtilisateursPage.jsx`
- `src/pages/PlateformePage.jsx`
- `src/lib/api.js` (corps sur `DELETE`, `MODULE_NON_AUTORISE`)
- `src/lib/modules.js`
- `public/sw.js` (v65)
- `dist/`

## 6. Tests

**Backend : 25 suites, 208 tests, tous passent**, sur une base PostgreSQL 16 jetable (jamais la production).

La nouvelle suite `utilisateurs-modules` (7 tests) couvre :
- le **scénario 4**, reprise des comptes existants :
  - directeur rattaché à la caisse et au commercial, caissier à la caisse, responsable des achats et collaborateur au commercial ;
  - client sans commercial : caisse seulement ;
  - compte sans droit : « à affecter » ;
  - reprise rejouée sans effet ;
  - **droits strictement identiques** en observation ;
- les listes par module : membres seulement, résumé, profils du module, module non activé, droits de consultation ;
- le **scénario 3** :
  - un responsable des achats, un vendeur et un magasinier créés depuis le commercial sont visibles dans le commercial ;
  - aucun accès à la caisse : la carte de la caisse est absente et ses routes sont refusées avec 403 ;
  - un module non activé est refusé à la création ;
- l'ajout d'un compte existant avec un profil du module :
  - les droits du profil sont obtenus et la caisse est conservée ;
  - un profil d'un autre client est refusé ;
  - le retrait exige un motif, n'est pas possible sur soi-même, et la ligne est conservée et désactivée ;
  - le journal d'audit est rempli ;
- le mode observation :
  - rien n'est refusé ;
  - un écart est signalé puis corrigé ;
  - un compte qui n'est pas super_admin ne peut pas changer de mode, et un mode invalide est refusé ;
  - le socle est conservé en mode application ;
- le **scénario 8**, isolation : listes limitées au client, rattachement croisé refusé par l'API (404) et par la base ;
- la migration rejouable.

**Navigateur**, sur le compte de démonstration :
- Utilisateurs de NJ CAISSE PRO ;
- Utilisateurs de NJ COMMERCIAL, avec ses 9 personnes et leurs profils ;
- écran d'administration : mode, reprise, répartition et recherche.

## 7. Déploiement

1. **Sauvegarder la base.**
2. Mettre le code à jour, puis redémarrer. La 066 est jouée, puis la reprise s'exécute une fois ; le journal du serveur en affiche le bilan.
3. Ctrl+Maj+R (cache v65).
4. **Vérifier**, dans Administration plateforme → « Utilisateurs par module », la répartition et les écarts. Rattacher au besoin les comptes concernés depuis l'écran Utilisateurs de chaque module.
5. Quand tout est juste, cliquer sur **« Appliquer le contrôle »**. Le retour à l'observation reste possible à tout moment.

## 8. Points restant à traiter

- **Lot D : sessions** (une seule session active par compte, remplacement sécurisé, expiration, révocation).
- **Lot E : parcours de connexion**, l'accueil pour tous (décision n° 4) et la vérification de l'ensemble des scénarios.
- Les comptes créés par l'ancienne interface, si un navigateur a gardé une version en cache, n'ont aucun module. Ils apparaissent en « sans module » et se rattachent en un clic.
