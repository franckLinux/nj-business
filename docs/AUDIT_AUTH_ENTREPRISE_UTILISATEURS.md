# NJ BUSINESS — Audit et architecture cible : entreprise, modules, utilisateurs, sessions

**Date :** 17/11/2026 · **Étape :** 1 (audit) et 2 (conception). **Aucune modification de code à ce stade.**
**Base auditée :** branche `module/commercial`, commit `4dcb0d7` (migrations 001 à 063, Service Worker v61).

---

## 1. Résumé

L'existant est plus avancé que ne le suggère la demande. Le catalogue des modules et leur activation par client existent déjà (048-049) : désactiver un module ne supprime rien et chaque changement est tracé. Le contrôle des droits est fait côté serveur, à chaque requête. L'isolation entre clients est solide. Il ne faut donc pas tout reconstruire, mais corriger quatre défauts précis.

| # | Défaut constaté | Gravité |
|---|---|---|
| D1 | **Il n'existe aucune session côté serveur.** Le jeton JWT est valable 8 h et stocké dans le navigateur. Le serveur n'a aucun moyen de le révoquer : la « déconnexion » efface seulement le jeton du navigateur. Un même compte peut donc être ouvert en même temps sur autant d'appareils qu'on veut. | **Élevée** (sécurité) |
| D2 | **Un client ne peut pas exister sans NJ CAISSE PRO.** À la création, un déclencheur active d'office la caisse, et `createTenant` crée les rubriques, les journaux et le plan comptable, qui sont des données de caisse. | Élevée (architecture) |
| D3 | **La configuration de l'entreprise est enfermée dans la caisse.** L'onglet « Entité » est dans la page `/config` de NJ CAISSE PRO, et ses permissions `config.*` sont classées « caisse ». Un utilisateur qui n'a que NJ COMMERCIAL ne peut donc pas la voir. Elle mélange aussi l'identité (raison sociale, NIU, logo) avec des réglages de caisse : noms du caissier et du directeur signataires, exercice, plan comptable déduit de la forme juridique. | Moyenne |
| D4 | **L'accès à un module est déduit, jamais déclaré.** Aujourd'hui :<br>• on accède à la caisse si l'on n'est pas « collaborateur » ;<br>• on accède au Commercial si l'on a au moins une permission `com.*`.<br>Un directeur reçoit tout NJ COMMERCIAL par son rôle système. Il n'y a pas de liste « utilisateurs du module ». Il y a deux écrans d'utilisateurs, celui de la caisse et celui du Commercial, mais tous deux montrent tous les comptes du client. | Moyenne |

Le reste fonctionne et doit être gardé : cloisonnement par `tenant_id` lu dans le jeton, rechargement de l'utilisateur à chaque requête, journal d'audit, limitation des tentatives de connexion (10 par 15 min et par IP), mot de passe oublié avec jeton à usage unique, accueil NJ BUSINESS avec cartes de modules.

---

## 2. Cartographie de l'existant

### 2.1 Données

```
tenants ─────────────┬── tenant_modules (actif, motif, auteur) ── modules (catalogue, statut, préfixes API)
 (identité + réglages │
  de caisse mélangés) ├── users (role système unique, custom_role_id = 1 profil métier)
                      │     ├── user_permissions (exceptions grant / deny)
                      │     ├── com_utilisateur_types_gestion (achats / ventes / stock — 062)
                      │     ├── com_utilisateur_agences (054)
                      │     └── cabinet_affectations (comptables du cabinet → clients)
                      ├── roles (système si tenant_id NULL, sinon profils du client) ── role_permissions
                      ├── tenant_permissions (plafond des droits du client)
                      ├── tenant_periodicites (budget mensuel / hebdomadaire — 040)
                      └── com_parametres (nom_commercial, mentions, préfixes… — doublon partiel de l'identité)
refresh_tokens : table présente, jamais utilisée.
```

**Identité de l'entreprise aujourd'hui** (table `tenants`, migrations 011, 022, 031) :
- présent : nom, sigle, forme juridique, activité, adresse, BP, pays, ville, téléphone, e-mail, site web, devise, NIU, RCCM, nom du dirigeant, logo (data URL de 300 Ko au plus) ;
- absent : nom commercial (il est dans `com_parametres`), slogan, date de création, n° d'immatriculation et n° statistique, agrément, références libres, et le détail du représentant légal (prénoms, fonction, contacts, signature).

### 2.2 Authentification et accès (backend)

| Élément | Fichier | Constat |
|---|---|---|
| Connexion | `controllers/auth.controller.js` | bcrypt, puis JWT `{sub, role, tenantId}` valable 8 h. Rien n'est écrit en base, sauf `derniere_connexion`. |
| Garde | `middleware/auth.js` | Vérifie la signature, puis relit l'utilisateur en base : un compte désactivé est bloqué tout de suite. Aucune notion de session. |
| Client | `middleware/tenant.js` | Le client vient du jeton ; le cabinet le choisit par l'en-tête `X-Tenant-Id`. Le module de la route est contrôlé, mais en mode **observer** par défaut (`MODULES_CONTROLE`). |
| Droits | `services/permission.service.js` | Rôle système et profil, module par module, plus types de gestion, plus `grant`, moins `deny`, plafonné par `tenant_permissions`. |
| Déconnexion | — | **Aucune route.** Le frontend efface `localStorage`. |

### 2.3 Frontend

- Le jeton et l'utilisateur sont stockés dans `localStorage` (`caisse_token`, `caisse_user`).
- La PWA a une **file hors ligne** (`lib/syncManager.js`) : le caissier saisit sans réseau, et la file est envoyée avec le jeton plus tard.
- Après la connexion (`lib/modules.js`), un module ouvre directement ce module ; plusieurs ou aucun ouvrent l'accueil. La route `/` reste celle du tableau de bord de la caisse.
- Configuration :
  - `/config` (caisse) : Entité, Utilisateurs, Journaux, Plan, Rubriques, Pièces, Activités, Rôles ;
  - `/commercial/configuration` : Société, Agences, Magasins, Utilisateurs, Familles, Unités, Articles, Taxes, Tiers.

### 2.4 Dépendances entre NJ CAISSE PRO et le reste

1. La création d'un client crée des données de caisse (D2).
2. Les permissions `config.*`, `users.*` et `roles.*` sont rangées dans le groupe « caisse » (`GROUPE` dans `permission.service.js`). La gestion des utilisateurs et de l'entreprise dépend donc du module caisse.
3. Le plan comptable bascule automatiquement selon la forme juridique, saisie dans l'identité (060). Le réglage de caisse dépend donc d'un champ d'identité.
4. L'en-tête des documents commerciaux (PDF) lit `tenants` : c'est déjà centralisé, tant mieux, mais il le lit **au moment de l'impression**. Un bon de commande réimprimé après un changement de logo porte le nouveau logo.

---

## 3. Risques de régression

| Risque | Parade |
|---|---|
| Bloquer des caissiers en production en changeant le calcul de l'accès aux modules. | Les nouvelles règles passent d'abord en mode **observer**, comme pour la 048 : on journalise les refus qui auraient eu lieu, sans rien refuser. On passe en mode **appliquer** après vérification. |
| Session unique : un caissier ferme son navigateur sans se déconnecter, puis se retrouve bloqué sur un autre poste. | La session expire après une inactivité configurable. Le bouton « Fermer l'autre session » est proposé à la connexion, après saisie du mot de passe. |
| Session unique et **file hors ligne** : si la session est remplacée, les opérations saisies hors ligne sont refusées à la synchronisation. | Ne jamais vider la file : le code `SESSION_REMPLACEE` suspend la synchronisation et demande une reconnexion, puis la file repart. Un test dédié est prévu. |
| Comptes de démonstration partagés (prospect et cabinet sur le même identifiant). | La règle est la même pour tous ; le cabinet utilise ses propres comptes. À confirmer. |
| Le directeur perd NJ COMMERCIAL (il l'a aujourd'hui par son rôle système). | La reprise de l'existant l'affecte au Commercial s'il y a des droits effectifs `com.*`. Rien n'est retiré à la migration. |
| Réimpression de documents anciens avec la nouvelle identité. | On fige l'identité sur chaque document **émis** (instantané JSON). |
| Les 22 suites de tests (205 tests) supposent la caisse active d'office. | Les tests sont adaptés au fil des lots, et tous doivent passer à chaque livraison. |

---

## 4. Architecture cible

### 4.1 Les trois niveaux

```
NIVEAU 1 — SOCLE NJ BUSINESS (toujours accessible, sans module)
  Entreprise : identité, références légales, représentant légal, logo
  Modules activés · Utilisateurs (comptes) · Sessions · Journal d'audit
        │
NIVEAU 2 — PARAMÈTRES DE CHAQUE MODULE
  NJ CAISSE PRO : plan comptable, périodicité budgétaire, journaux, rubriques,
                  pièces, signataires (caissier / directeur), exercice
  NJ COMMERCIAL : agences, magasins, familles, unités, taxes, tiers, achats,
                  ventes, stock, documents (com_parametres)
        │
NIVEAU 3 — UTILISATEURS ET DROITS PAR MODULE
  user_modules : la personne X travaille dans le module M, avec le rôle R
  Les permissions sont calculées module par module, à partir de cette affectation.
```

### 4.2 Modèle de données (on réutilise l'existant ; seulement des ajouts)

| Entité | Choix |
|---|---|
| **A. Entreprise** | On garde la table `tenants`, qui porte déjà l'identité. Ajouts : `nom_commercial`, `slogan`, `date_creation`, `immatriculation`, `numero_statistique`, `agrement`. |
| Références légales libres | Nouvelle table `entreprise_references` (libellé, valeur, ordre). |
| **I. Représentant légal** | Nouvelle table `entreprise_representants` (nom, prénoms, fonction, téléphone, e-mail, adresse, signature, `du`, `au`). Changer de représentant crée une ligne et clôt la précédente, sans toucher à l'identité. `tenants.dirigeant_nom` est repris dans la première ligne. |
| Logo | On le laisse dans `tenants.logo_url`, en data URL de 300 Ko au plus, avec type vérifié. Il n'est servi qu'aux utilisateurs du client. Remplacement et suppression sont tracés dans l'audit. |
| **B. Modules / C. Activation** | Tables `modules` et `tenant_modules` **inchangées**. Le module `caisse` perd `par_defaut`. Le déclencheur ne s'applique plus qu'aux modules cochés à la création. |
| **D. Utilisateurs** | `users` inchangé. `users.role` garde le **niveau dans l'entreprise** : le directeur est l'administrateur de l'espace ; les autres sont des collaborateurs. |
| **E. Affectations** | Nouvelle table `user_modules` : utilisateur, module, rôle du module, actif, affecté par, date, origine (« migration » ou « manuel »). Avoir une ligne active est **nécessaire** pour entrer dans un module, et le serveur le vérifie. |
| **F. Rôles** | Table `roles` existante. On ajoute une colonne `module_code` aux profils, pour que chaque module propose ses propres rôles. Les rôles par défaut : <br>• caisse : directeur, comptable, caissier, responsable financier, contrôleur ;<br>• commercial : les 8 profils déjà créés à l'activation. |
| **G. Sessions** | Nouvelle table `sessions` : id, utilisateur, client, créée le, dernière activité, expire le, IP, appareil / navigateur, statut (`active`, `fermee`, `expiree`, `revoquee`, `remplacee`), fermée par, motif. **Index unique partiel** `(user_id) WHERE statut = 'active'`. |
| **H. Paramètres des modules** | Ils restent dans leurs tables (`tenant_periodicites`, plan client, `com_parametres`…). On y ajoute une table `caisse_parametres` : référentiel du plan, signataires, exercice, inactivité. |
| Documents émis | Colonne `identite_emetteur JSONB`, figée à l'émission, sur les documents commerciaux. |

Le calcul des droits devient : **(rôle du module dans `user_modules`, plus types de gestion, plus `grant`, moins `deny`) ∩ plafond du client ∩ modules activés**. Les permissions du socle (`entreprise.*`, `utilisateurs.*`, `sessions.*`) forment un nouveau groupe « socle », qui ne dépend plus de la caisse.

### 4.3 Sessions

1. **Connexion**, en une transaction :
   - verrou `pg_advisory_xact_lock(hash(user_id))`, pour que deux connexions simultanées ne puissent pas passer toutes les deux ;
   - on cherche une session active non expirée. S'il y en a une : refus 409 `SESSION_ACTIVE` avec le message demandé, l'appareil et l'heure de cette session.
2. **Remplacer l'autre session** : nouvel appel avec `remplacer: true`, identifiant et mot de passe vérifiés à nouveau. L'ancienne session passe en `remplacee`, et l'appareil concerné reçoit 401 `SESSION_REMPLACEE` à sa requête suivante. Le changement est inscrit au journal et le propriétaire est prévenu par e-mail.
3. **Jeton** : JWT court (15 min) contenant `sid`, plus un jeton de rafraîchissement **renouvelé à chaque usage**. On réutilise la table `refresh_tokens`, avec hachage et rattachement à la session. Un jeton de rafraîchissement déjà utilisé qui revient signale un vol : la session est révoquée.
4. **À chaque requête**, `authGuard` vérifie que la session est active et non expirée, et met à jour la dernière activité au plus une fois par minute.
5. **Expiration** après une inactivité réglable par client (30 min par défaut), plus une durée maximale (12 h). Une session expirée ne bloque plus personne.
6. **Déconnexion** :
   - `POST /auth/deconnexion` ferme la session en cours ;
   - « Déconnecter partout » ferme toutes les sessions du compte ;
   - le directeur peut révoquer la session d'un de ses utilisateurs, et le cabinet celle de n'importe qui ;
   - changer ou réinitialiser un mot de passe ferme toutes les sessions.
7. **Changer de module** ou, pour le cabinet, changer de client ne crée **pas** de session : la session porte sur le compte.
8. Toutes les connexions, déconnexions, refus et remplacements sont inscrits au journal d'audit.

### 4.4 Parcours de connexion

Après authentification et création de la session, le serveur renvoie l'entreprise, les modules activés pour elle et, pour chacun, l'accès de la personne avec son rôle dans ce module. L'interface ouvre l'**accueil NJ BUSINESS** :
- une carte par module : nom, icône, description, statut, accès ou motif du refus ;
- l'accès à la configuration de l'entreprise pour qui en a le droit.

On n'est plus jamais envoyé d'office dans la caisse. Pour une personne qui n'a qu'un seul module, l'entrée directe reste possible : voir la question 4.

---

## 5. API

| Méthode et route | Rôle | Nouveau / modifié |
|---|---|---|
| `POST /auth/login` | Crée la session ; 409 `SESSION_ACTIVE` ; option `remplacer` | Modifié |
| `POST /auth/rafraichir` | Renouvelle le jeton d'accès | Nouveau |
| `POST /auth/deconnexion`, `POST /auth/deconnexion-globale` | Ferme la session en cours, ou toutes les sessions du compte | Nouveau |
| `GET /auth/me` | Ajoute `session` et `acces_modules` | Modifié |
| `GET/PUT /entreprise` | Identité et références légales (socle) | Nouveau (reprend `/config`) |
| `PUT/DELETE /entreprise/logo` | Logo | Nouveau |
| `GET/POST /entreprise/representants` | Représentant légal et son historique | Nouveau |
| `GET/PUT /caisse/parametres` | Plan comptable, périodicité, signataires, exercice | Nouveau (repris de `/config`) |
| `GET /modules/:code/utilisateurs` | Utilisateurs d'un module : nombre, actifs, rôle, dernière connexion, droits | Nouveau |
| `POST/PUT/DELETE /modules/:code/utilisateurs/:id` | Affecter, changer le rôle, retirer du module | Nouveau |
| `GET /sessions`, `DELETE /sessions/:id` | Sessions des utilisateurs du client ; révocation | Nouveau |
| `GET/POST /admin/repartition-utilisateurs` | Rapport de reprise et affectation manuelle (cabinet, puis directeur) | Nouveau |
| `POST /tenants` | Création **sans module** ; modules cochés en option | Modifié |
| `PUT /config` | Gardé, en relais vers `/entreprise` et `/caisse/parametres`, pour ne rien casser pendant la transition | Compatibilité |

---

## 6. Plan de migration, par lots

| Lot | Migration | Contenu | Retour arrière |
|---|---|---|---|
| **A** | 064 | Configuration centrale :<br>• colonnes d'identité, références légales et représentants ;<br>• page « Configuration de l'entreprise », ouverte depuis l'accueil ;<br>• permissions du socle ;<br>• identité figée sur les documents émis. | Ajouts seulement ; script 064 |
| **B** | 065 | Séparation des paramètres :<br>• `caisse_parametres` ;<br>• création d'un client sans module, avec les données de caisse créées à l'**activation** de la caisse ;<br>• l'onglet Société du Commercial lit l'identité centrale. | Script 065 ; anciens champs conservés |
| **C** | 066 | Utilisateurs par module :<br>• `user_modules` et rôles par module ;<br>• **reprise automatique** avec rapport ;<br>• écran d'affectation manuelle ;<br>• « Utilisateurs du module » dans chaque module ;<br>• contrôle en mode **observer**, puis **appliquer**. | Script 066 ; aucun droit retiré |
| **D** | 067 | Sessions :<br>• table, verrou, rafraîchissement, expiration, révocation, journal ;<br>• adaptation de la file hors ligne. | Script 067 ; option `SESSIONS_CONTROLE=observer` |
| **E** | — | Parcours de connexion, accueil, tests des 8 scénarios, notes de livraison. | — |

**Règles de reprise des utilisateurs existants (lot C)**, fondées sur leurs droits **effectifs** d'aujourd'hui :
- rôle `directeur`, `caissier` ou `auditeur` → **caisse**, avec le rôle de caisse correspondant ;
- au moins une permission effective `com.*` → **commercial**, avec son profil commercial actuel ;
- `collaborateur` sans aucun droit `com.*`, ou tout autre cas → **« à affecter »** : aucun accès ajouté, et le cas apparaît dans l'écran d'affectation manuelle ;
- comptes du cabinet (`super_admin`, `comptable_cabinet`) : inchangés, ils passent par les affectations aux clients.

**Aucun droit n'est retiré ni ajouté** par la migration : on décrit dans `user_modules` ce que chacun a déjà. Le rapport (`/admin/repartition-utilisateurs`) est vérifié **avant** le passage en mode appliquer.

Inventaire à lancer en production avant le lot C (lecture seule) :

```sql
SELECT t.nom AS client, u.role, (u.custom_role_id IS NOT NULL) AS profil, u.actif, COUNT(*) AS nb
  FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
 GROUP BY 1, 2, 3, 4 ORDER BY 1, 2;
```

---

## 7. Scénarios de validation (les 8 du cahier des charges)

Chaque lot ajoute ses tests d'intégration, sur une base de test et jamais sur la production :

| Scénario | Lot qui le couvre |
|---|---|
| 1. Client sans module | B |
| 2. Paramètres de la caisse | B |
| 3. Utilisateurs du Commercial sans accès à la caisse | C |
| 4. Reprise des utilisateurs existants | C |
| 5. Connexion simultanée : deux connexions lancées **en même temps**, une seule acceptée | D |
| 6. Changement de module sans nouvelle session | D et E |
| 7. Désactivation puis réactivation d'un module | Existe déjà ; à étendre |
| 8. Isolation entre deux entreprises, y compris les sessions et les utilisateurs de module | C et D |

---

## 8. Décisions de Franck (17/11/2026)

1. **Budget :** l'hebdomadaire est gardé ; les périodicités mensuelle, trimestrielle, semestrielle et annuelle sont ajoutées. Ce sera un lot à part, après le lot E.
2. **Plan comptable :** il se choisit dans NJ CAISSE PRO ; la forme juridique ne fait que le suggérer.
3. **Second appareil :** la connexion est bloquée avec le message demandé. On propose ensuite « Fermer l'autre session et me connecter ici », après saisie du mot de passe, et le titulaire reçoit un e-mail d'alerte.
4. **Après la connexion :** tout le monde arrive sur l'accueil NJ BUSINESS, même avec un seul module.
