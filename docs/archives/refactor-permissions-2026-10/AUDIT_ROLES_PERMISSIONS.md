# NJ Business / CaissePro — Audit & refonte des rôles et permissions

*Audit réalisé le 02/10/2026 sur le code local (`caisse-pro`, branche `reorganisation-monorepo-setup-distant`, avec ses modifications non commitées).*
*Aucun fichier source n'a été modifié : tout est livré dans ce dossier sous forme de patchs à appliquer.*

| Fichier | Rôle |
|---|---|
| `phase1-securite.patch` | Correctifs de sécurité, **sans changement de schéma**. À déployer en premier, dès que possible. |
| `phase2-refonte.patch` | Refonte du modèle : migration `014`, service de permissions 100 % en base, notifications par permission. |
| `014_refonte_roles_permissions.sql` | Copie lisible de la migration (déjà incluse dans le patch phase 2). |
| `permission.service.phase2.js` | Copie lisible du nouveau service (déjà inclus dans le patch phase 2). |
| `phase3-decisions.patch` | Vos décisions du 02/10/2026 : affectations des comptables, arrêt de caisse par le directeur, profils métier gérés par le directeur (migration `015`). |
| `015_affectations_arret_profils.sql` | Copie lisible de la migration 015 (incluse dans le patch phase 3). |

---

## 1. Architecture actuelle

```
Navigateur (React 18 + Vite, PWA, IndexedDB)
  AppContext.can(code)  ←  user.permissions (renvoyé par /auth/login et /auth/me)
        │  Authorization: Bearer <JWT{sub, role, tenantId}>   X-Tenant-Id (cabinet)
        ▼
Express  /api  (backend/src/routes/index.js)
  authGuard ─► tenantGuard ─► requirePermission('module.action') ─► validator ─► contrôleur
                     │                    │
                     │                    └─ permission.service.getEffectivePermissions()
                     └─ req.tenantId          (4 requêtes : user_permissions, users, role_permissions,
                                               tenant_permissions + ROLE_DEFAULTS codé en dur)
        ▼
PostgreSQL (Supabase) — Sequelize + SQL brut (db/migrations/*.sql)
```

### Où vivent les rôles et les permissions aujourd'hui

| Élément | Emplacement | Remarque |
|---|---|---|
| Rôle fixe `users.role` | `models/User.js` (`ROLES`), `users.controller.js` (`ROLES_VALIDES`, `ROLES_LABELS`, `PRIORITE_ROLE`), `UsersTab.jsx` (`ROLES_CREABLES`, `ROLES_LABELS`, `ROLES_COLORS`) | **5 listes** à tenir synchronisées à la main |
| Droits par défaut d'un rôle | `services/permission.service.js` → `ROLE_DEFAULTS` | **En dur dans le code**, invisibles et non modifiables depuis l'appli |
| Profil métier (rôle personnalisé) | tables `roles` + `role_permissions`, `users.custom_role_id` | `role_permissions.permission_code` **sans clé étrangère** |
| Permissions individuelles | `user_permissions` | Instantané complet qui **remplace** le rôle |
| Plafond client | `tenant_permissions` | Intersection (ne peut que retirer) — bon modèle |
| Catalogue | `permissions` (migrations 002, 012, 013) **et** API POST/PUT/DELETE `/permissions` | Deux sources concurrentes |
| Contrôle back | `requirePermission` (fonctionnalités) **+** `requireRole` (admin) **+** listes de rôles en dur dans `arret_caisse.controller.js`, `notification.service.js`, `budget_caisse.controller.js` | 3 mécanismes |
| Contrôle front | `can()` dans `AppContext` (bien) + `role === …` dans `ConfigPage`, `UsersTab`, `PermissionsPage`, `TenantsPage`, `CompteEmploiPage`, `JournauxRecapPage` | Les tests de rôle restants concernent surtout l'identité « cabinet » |

---

## 2. Bugs et problèmes identifiés

### 🔴 Critiques (sécurité)

**C1 — Escalade de privilèges vers `super_admin` par un directeur.**
`PUT /users/:id` est protégé par `users.edit` (que tout directeur possède), et le validateur comme le contrôleur acceptent `role: 'super_admin'`. Seule la modification de *son propre* rôle est bloquée. Un directeur crée donc un second compte, le passe en `super_admin`, et contrôle **toute la plateforme** : liste et (dés)activation des clients, plafonds, permissions de n'importe quel utilisateur, catalogue.
*Correctif (phase 1)* : `rolesAttribuables(req)` — dans un client : `directeur | caissier | auditeur` ; hors client (super_admin seulement) : `comptable_cabinet`. `super_admin` n'est jamais attribuable par l'API.

**C2 — Comptes désactivés, supprimés ou rétrogradés encore actifs jusqu'à 8 h.**
`authGuard` lit `role` et `tenantId` **depuis le JWT** sans vérifier `users.actif`. Désactiver un caissier licencié ne lui coupe pas l'accès ; un directeur rétrogradé garde les droits de directeur (le service retombe sur `ROLE_DEFAULTS[ancien rôle]`). Le front, lui, rafraîchit le rôle via `/auth/me` → l'écran et l'API appliquent **deux règles différentes** (boutons visibles mais 403, ou l'inverse).
*Correctif (phase 1)* : `authGuard` recharge `id, role, tenant_id, actif` en base à chaque requête (1 requête indexée sur la clé primaire). Le JWT ne prouve plus que l'identité.

**C3 — Fuite inter-clients via un « comptable_cabinet » créé dans un client.**
Un directeur peut créer un utilisateur `comptable_cabinet` *rattaché à son client* (`ROLES_VALIDES` le permet). Ce compte passe les `requireRole('super_admin','comptable_cabinet')` : **liste de tous les clients de la plateforme** (`GET /tenants`), permissions de n'importe quel client et de n'importe quel utilisateur.
*Correctif (phase 1)* : `requireCabinet` = `super_admin`, ou `comptable_cabinet` **sans** client. `comptable_cabinet` n'est plus attribuable dans un client. Le front (`isAdmin`) applique la même règle.

**C4 — IDOR sur le profil métier.**
`custom_role_id` est accepté tel quel à la création/modification d'un utilisateur, sans vérifier qu'il appartient au client. Un directeur peut rattacher un profil d'un autre client (ids séquentiels).
*Correctif (phase 1)* : `verifierProfil(id, req.tenantId)`.

**C5 — `tenantGuard` permissif pour tout compte sans client.**
Tout utilisateur avec `tenant_id NULL` (pas seulement le cabinet) pouvait choisir n'importe quel client via `X-Tenant-Id`. Un `X-Tenant-Id` mal formé provoquait une erreur Postgres (500).
*Correctif (phase 1)* : seul un membre du cabinet peut choisir le client ; l'UUID est validé.

### 🟠 Majeurs (logique métier / données)

**M1 — Les permissions individuelles « gèlent » la personne.** `user_permissions` est un instantané complet qui *remplace* le rôle. Conséquences observées dans le code :
- une nouvelle permission (ex. `journal.ran`, `journaux.view`, `plan_comptable.delete`) n'atteint jamais une personne qui a une surcharge → c'est exactement pourquoi `tools/diag-permissions.js` et la règle implicite `journal.view ⇒ journaux.view` ont dû être ajoutés ;
- changer le rôle d'une personne surchargée **ne change rien** à ses droits ;
- le profil métier est ignoré dès qu'il existe une seule surcharge.
*Correctif (phase 2)* : `user_permissions.effet = grant | deny` — des **exceptions** appliquées *par-dessus* le rôle. La modale n'a pas changé : le serveur calcule lui-même les exceptions à partir de la liste cochée.

**M2 — Mise à jour d'utilisateur destructive.** `updateUser` écrit `NULL` pour tout champ absent : `username`/`role` absents → erreur 500 ; `email` et `custom_role_id` absents → **effacés en silence**.
*Correctif (phase 1)* : mise à jour partielle.

**M3 — Les notifications suivent le rôle, l'autorisation suit la permission.** Dépense en attente : validée par `journal.validate`, mais notifiée aux `role = 'directeur'`. Demande de dépassement : validée par `budget.demande_validate`, mais l'e-mail part au **premier** directeur trouvé (`findOne`). Une personne habilitée par profil métier n'est jamais prévenue ; un directeur à qui l'on a retiré la validation l'est quand même.
*Correctif (phase 2)* : `usersAvecPermission(tenantId, code)`.

**M4 — Catalogue modifiable à l'exécution.** `POST /permissions` crée des codes qu'aucune route ne vérifie ; `DELETE /permissions/:code` supprime en cascade les lignes `tenant_permissions`/`user_permissions` mais **pas** `role_permissions` (pas de FK) ni `ROLE_DEFAULTS` → incohérences. `PUT /permissions/:code` sans `nom` → `NULL` → erreur 500.
*Correctif (phase 2)* : catalogue géré par migrations SQL uniquement ; seuls libellé et description restent modifiables (mise à jour partielle) ; FK `role_permissions → permissions(code)`.

**M5 — Doublons de rôles.** Le rôle fixe et le profil métier coexistent sans lien ; rien n'empêche un profil `code = 'caissier'`. Les rôles globaux (`tenant_id NULL`, créés par un super_admin sans client sélectionné) échappent à `UNIQUE(code, tenant_id)` (NULL ≠ NULL) → doublons possibles.
*Correctif (phase 2)* : rôles système en base (`is_system`), index unique partiel sur les rôles globaux, création de profil métier impossible hors client, rôle système non supprimable.

**M6 — Erreurs avalées.** `permissions.controller.js` et `users.controller.js` renvoient 500 **sans journaliser** (contraire à la règle *fail-loud*), et `roles.controller.js` renvoie `err.message` (texte SQL) au client.
*Correctif* : journalisation systématique + message générique.

### 🟡 Mineurs / à décider (non patchés volontairement)

| # | Constat | Proposition |
|---|---|---|
| m1 | `arret_caisse.controller.js` : `isAdmin = ['directeur','super_admin','comptable_cabinet'].includes(role)` — dernière règle fonctionnelle portée par un rôle | ✅ **Traité en phase 3** : permission `journaux.arreter` (directeur) |
| m2 | `reouvrir` : `mois`/`annee` non validés → `undefined` dans le `WHERE` → 500 | Ajouter `arreterRules` sur la route DELETE |
| m3 | `updateMouvement` : pas de contrôle de propriété ni de budget (déjà identifié) | À traiter avec le chantier budget |
| m4 | Front : `isCaissiere = can('previsions.edit')`, `isDirecteur = can('appel_fonds.validate')` — noms trompeurs | Renommer en `peutSaisirPrevisions`, `peutValiderAppel` |
| m5 | `CompteEmploiPage`, `JournauxRecapPage` recalculent `isAdmin` eux-mêmes | Utiliser `isAdmin` du contexte |
| m6 | Libellés de rôles dupliqués back/front | Exposer `GET /roles` système (déjà en base après la 014) et supprimer `ROLES_LABELS` du front |

---

## 3. Nouveau modèle

### Principe : *un rôle de base + des exceptions, sous un plafond*

```
effectives(u, client) =
    super_admin                       → tout (null)
    sinon ( base(u) ∪ grants(u) ) − denies(u)   ∩ plafond(client) [si défini]

base(u) = permissions du profil métier (users.custom_role_id) s'il en porte au moins une,
          sinon celles du rôle système dont code = users.role
```

**Pourquoi pas de table `user_roles` (plusieurs rôles par personne), comme le proposait le modèle générique ?** Pour une caisse, un poste = un profil ; le multi-rôle rend la résolution illisible pour l'utilisateur final (quel rôle l'emporte ?). Les besoins réels (« ce caissier peut aussi exporter ») sont couverts par les exceptions `grant`/`deny`, plus simples à expliquer et à auditer.

### Schéma (après migration 014)

```sql
permissions      (id, code UNIQUE 'module.action', nom, module, description)       -- catalogue, géré par migrations
roles            (id, nom, code, description, couleur,
                  tenant_id NULL = global, is_system BOOLEAN)                       -- rôles système + profils métier
                  UNIQUE(code, tenant_id) ; UNIQUE(code) WHERE tenant_id IS NULL
role_permissions (role_id → roles ON DELETE CASCADE,
                  permission_code → permissions(code) ON DELETE/UPDATE CASCADE)     -- FK ajoutée
users            (…, role 'super_admin|comptable_cabinet|directeur|caissier|auditeur',
                  custom_role_id → roles ON DELETE SET NULL, tenant_id, actif)
user_permissions (user_id, permission_code, effet 'grant'|'deny')                  -- exceptions
tenant_permissions (tenant_id, permission_code)                                      -- plafond (inchangé)
```

`users.role` reste le **type de compte** (identité et périmètre : cabinet ou client). Les **droits** viennent uniquement de la base.

### Convention de nommage (déjà en place, à conserver)

`module.action` en minuscules : `journal.create`, `budget.demande_validate`, `journaux.reouvrir`. Un code = une action précise ; jamais deux routes d'exigences différentes sous le même code (leçon de la 012).

### Ce qui disparaît

`ROLE_DEFAULTS` (code) · la règle implicite `journal.view ⇒ journaux.view` · `POST/DELETE /permissions` · `notifierRole` · les `role = 'directeur'` dans les notifications.

---

## 4. Exemples de code

### Back — vérification de permission (inchangé dans son usage)

```js
// routes/index.js
router.patch('/appel-fonds/:id/statut',
  authGuard, tenantGuard, requirePermission('appel_fonds.validate'),
  updateStatutRules, validate, afCtrl.updateStatut);

// Contrôle dans un service (ex. notifications, règles conditionnelles)
const { userHasPermission } = require('../services/permission.service');
if (!(await userHasPermission({ tenantId: req.tenantId, userId: req.user.id, role: req.user.role }, 'journal.validate'))) {
  return res.status(403).json({ error: 'Permission requise : journal.validate.' });
}
```

Règle : `requireRole` / `requireCabinet` **uniquement** pour l'identité (administration du cabinet) ; toute fonctionnalité métier passe par `requirePermission`.

### Front — `can()` existe déjà ; deux petits utilitaires recommandés

```jsx
// src/lib/permissions.jsx (proposition)
import { useApp } from '@/context/AppContext';

export const useCan = (code) => useApp().can(code);

export function Can({ perm, children, fallback = null }) {
  return useApp().can(perm) ? children : fallback;
}

// Utilisation dans un composant
<Can perm="journal.delete">
  <button className="btn-icon danger" onClick={() => supprimer(m.id)}>✕</button>
</Can>
```

Le front **masque** ; seul le back **interdit**. Chaque bouton conditionné par `can('x')` doit correspondre à une route protégée par `requirePermission('x')`.

---

## 5. Migration 014 — garanties

- **Idempotente** : protégée par `IF NOT EXISTS`, `ON CONFLICT`, et une garde sur l'existence de la colonne `effet` (la conversion des surcharges ne peut jamais s'exécuter deux fois).
- **Conversion exacte** : pour chaque personne ayant une surcharge, `grant = instantané − base`, `deny = base − instantané` ⇒ `(base ∪ grant) − deny = instantané`.
- **Testée** sur PostgreSQL 16 avec les migrations 002→013 réelles et 9 profils (défaut, plafond ancien d'avant la 012, profil métier, profil vide, surcharge, surcharge + profil, comptable cabinet, super_admin, rôles globaux en double) : **droits effectifs identiques** avant/après pour tous ; seule différence : un code orphelin absent du catalogue, supprimé volontairement. Jouée deux fois sans erreur.

---

## 6. Plan d'implémentation

> Rappel de votre séquence : application des fichiers → redémarrage (nodemon) → vidage du cache navigateur (Ctrl+Shift+R / désinscription du SW). Pensez à **incrémenter la version du cache du Service Worker** à chaque phase qui touche le front.

### Étape 0 — Sauvegardes (obligatoire)

```powershell
# Code : commitez d'abord votre travail en cours (135 fichiers modifiés sur la branche actuelle)
git add -A; git commit -m "WIP avant refonte permissions"
git switch -c refonte/permissions

# Base Supabase (chaîne de connexion « Session pooler » ou directe)
pg_dump "$env:DATABASE_URL" -Fc -f "sauvegarde_avant_014_$(Get-Date -f yyyyMMdd_HHmm).dump"
```

### Phase 1 — Sécurité (à déployer immédiatement, sans migration)

```powershell
git apply --check _refactor-permissions/phase1-securite.patch
git apply _refactor-permissions/phase1-securite.patch
cd backend; node --check src/middleware/auth.js; node --check src/controllers/users.controller.js
# photo des droits AVANT la phase 2 (outil ajouté par ce patch)
node tools/snapshot-permissions.js > ../avant_014.json
```

Fichiers touchés : `middleware/auth.js`, `middleware/tenant.js`, `controllers/users.controller.js`, `validators/users.validator.js`, `routes/index.js`, `tools/snapshot-permissions.js` (nouveau), `frontend/src/components/config/UsersTab.jsx`, `frontend/src/context/AppContext.jsx`.

**Après déploiement, vérifier en base** qu'aucun compte n'a déjà exploité C1/C3 :

```sql
SELECT id, username, role, tenant_id, created_at FROM users
 WHERE (role = 'super_admin' AND tenant_id IS NOT NULL)
    OR (role = 'comptable_cabinet' AND tenant_id IS NOT NULL)
    OR (role NOT IN ('super_admin','comptable_cabinet') AND tenant_id IS NULL);
```

Toute ligne renvoyée est anormale : à examiner, puis corriger ou désactiver.

### Phase 2 — Refonte (migration 014)

```powershell
git apply --check _refactor-permissions/phase2-refonte.patch
git apply _refactor-permissions/phase2-refonte.patch
cd backend
npm run db:migrate          # joue 014_refonte_roles_permissions.sql
node tools/snapshot-permissions.js > ../apres_014.json
node tools/snapshot-permissions.js --diff ../avant_014.json ../apres_014.json   # doit afficher ✓
npm run perm:diag           # lecture : base + exceptions de chaque personne
```

⚠️ **Code et migration vont ensemble** : l'ancien code lirait les lignes `deny` comme des autorisations. Déployez le patch phase 2 et `db:migrate` dans la même fenêtre de maintenance, sans servir de trafic entre les deux.

### Phase 3 — Décisions du 02/10/2026 (migration 015)

```powershell
git apply --check _refactor-permissions/phase3-decisions.patch
git apply _refactor-permissions/phase3-decisions.patch
cd backend; npm run db:migrate          # joue 015_affectations_arret_profils.sql
```

| Décision | Mise en œuvre |
|---|---|
| **Le comptable cabinet ne voit que ses clients affectés** | Table `cabinet_affectations(user_id, tenant_id)`. `tenantGuard` refuse (403) un client non affecté ; `GET /tenants` (sélecteur de client, page Clients) ne renvoie que les clients affectés ; lecture des plafonds et des permissions utilisateur limitée aux mêmes clients. Écran : *Configuration → Utilisateurs*, **sans client sélectionné**, bouton 🏢 sur un comptable (super_admin seul). API : `GET/PUT /api/users/:id/affectations`. |
| **Arrêt de caisse : le directeur** | Nouvelle permission `journaux.arreter`, donnée au rôle système *directeur* uniquement. Le **responsable d'arrêt désigné** sur le journal garde le droit d'arrêter *son* journal (règle d'appartenance existante) ; le comptable cabinet ne peut plus arrêter. Super_admin : toujours autorisé. |
| **Le directeur gère ses profils métier** | Nouvelle permission `roles.edit` (rôle système *directeur*). Créer/modifier/supprimer un profil et définir ses permissions passent sous `requirePermission('roles.edit')`. Onglet *🎭 Rôles* visible pour le directeur. **Anti-escalade** : un directeur ne peut mettre dans un profil que des permissions qu'il détient lui-même (et sous le plafond du client) ; la grille ne lui présente que celles-là. Les rôles système restent modifiables par le super_admin seul. |

⚠️ **Avant de déployer la 015** : aucune affectation n'est créée automatiquement (choix volontaire, conforme à la décision). Dès la mise en production, chaque comptable cabinet **ne voit plus aucun client** tant que le super_admin ne les lui a pas affectés. Préparez la liste comptable → clients et saisissez-la juste après la migration.

Si vous préférez l'autre lecture de « qui arrête une caisse » (**uniquement** le directeur, même pas le responsable désigné), c'est une ligne à retirer dans `arret_caisse.controller.js` (`isResponsable ||`) : dites-le-moi.

### Phase 4 — Nettoyage (facultatif, après validation)

1. Ajouter `useCan` / `<Can>` (§4) et remplacer progressivement les `can()` + ternaires.
2. Traiter les mineurs m1→m6.
3. Ajouter un bouton « Revenir aux droits du rôle » dans `PermissionsAssignModal` → `DELETE /api/users/:id/permissions` (route déjà livrée en phase 2).

### Retour arrière

- Phase 1 : `git apply -R _refactor-permissions/phase1-securite.patch` (aucune donnée touchée).
- Phase 2 : `pg_restore` de la sauvegarde **et** `git apply -R` du patch phase 2. La 014 n'a pas de script inverse automatique (la conversion des surcharges n'est pas réversible à l'identique sans la sauvegarde).

---

## 7. Scénarios de test

| # | Scénario | Attendu |
|---|---|---|
| T1 | Directeur : `PUT /users/:id` avec `{"role":"super_admin"}` | 400 « Rôle non attribuable » |
| T2 | Directeur : créer un `comptable_cabinet` | 400 |
| T3 | Super_admin sans client : créer un `comptable_cabinet` | 201, `tenant_id` NULL |
| T4 | Désactiver un caissier connecté, puis il clique sur un menu | 401 → déconnexion automatique |
| T5 | Passer un directeur en caissier pendant sa session | dès la requête suivante : 403 sur `budget.validate`, et menus à jour après rechargement |
| T6 | Directeur : `PUT /users/:id` avec `custom_role_id` d'un autre client | 400 « Profil métier introuvable » |
| T7 | Directeur : `PUT /users/:id` avec seulement `{"email":"x@y.cm"}` | 200, rôle et profil inchangés |
| T8 | Caissier : `GET /tenants` / `X-Tenant-Id` d'un autre client | 403 / ignoré (reste sur son client) |
| T9 | `X-Tenant-Id: abc` (super_admin) | 400 « Identifiant client invalide » |
| T10 | Super_admin : caissier + exception « + rapport.export », puis passage en directeur | il garde `rapport.export` **et** reçoit tous les droits directeur |
| T11 | Ajouter `budget.validate` au rôle système *caissier* (Configuration → Rôles, sans client) | tous les caissiers l'obtiennent, y compris ceux avec exceptions |
| T12 | Profil métier avec `journal.validate`, rôle `caissier` ; un autre caissier met une dépense en attente | la personne au profil reçoit la notification ; un directeur à qui on a retiré `journal.validate` ne la reçoit pas |
| T13 | Demande de dépassement avec 2 directeurs ayant un e-mail | 2 e-mails envoyés |
| T14 | Supprimer le rôle système « directeur » | 404 « rôle système (non supprimable) » |
| T15 | `POST /permissions` ou `DELETE /permissions/:code` | 404 (routes retirées) |
| T16 | `snapshot-permissions --diff avant après` | ✓ identiques |
| T17 | Comptable affecté au client A : sélecteur de client | ne propose que A |
| T18 | Même comptable, `X-Tenant-Id` = client B (non affecté) | 403 « Ce client ne vous est pas affecté » |
| T19 | Comptable sans aucune affectation | liste de clients vide, aucun accès client |
| T20 | Comptable cabinet : arrêter une caisse dont il n'est pas responsable | 403 |
| T21 | Directeur : arrêter n'importe quelle caisse de son client | 201 |
| T22 | Caissier responsable d'arrêt désigné : arrêter **son** journal / un autre journal | 201 / 403 |
| T23 | Directeur : onglet 🎭 Rôles → créer « Caissière senior », lui donner `journal.view` + `journal.create`, l'attribuer à un caissier | OK, le caissier obtient exactement ces droits |
| T24 | Directeur à qui le super_admin a retiré `journal.delete` : mettre `journal.delete` dans un profil (API) | 403 « Vous ne détenez pas : journal.delete » |
| T25 | Directeur : modifier ou supprimer un rôle système, ou un profil d'un autre client | 404 |

## 8. Checklist de mise en production

- [ ] Travail en cours commité, branche dédiée créée
- [ ] `pg_dump` de production fait **et** testé (`pg_restore --list`)
- [ ] `git apply --check` OK pour les deux patchs
- [ ] `node --check` OK sur les fichiers backend modifiés ; `npm run build` OK côté front
- [ ] Requête de détection C1/C3 exécutée, anomalies traitées
- [ ] Version du cache du Service Worker incrémentée
- [ ] Phase 2 : snapshot avant → migrate → snapshot après → `--diff` = ✓
- [ ] T1–T16 passés sur un client de test
- [ ] Phase 3 : affectations comptables → clients saisies juste après la 015 ; T17–T25 passés
- [ ] Logs serveur surveillés 24 h (`[Auth]`, `[Users]`, `[Permissions]`, `[Notif]`)

## 9. Décisions prises (02/10/2026)

1. **Comptable cabinet** → uniquement les clients qui lui sont affectés (phase 3).
2. **Arrêt de caisse** → le directeur (+ le responsable d'arrêt désigné pour son propre journal) (phase 3).
3. **Profils métier** → gérés par le directeur de chaque client, avec garde anti-escalade (phase 3).

**Tests réalisés** : les trois patchs s'appliquent à la suite sur une copie du code actuel ; `node --check` passe sur tout le backend et l'ensemble des routes se charge ; les fichiers React modifiés compilent (esbuild). Sur PostgreSQL 16 (migrations 002→015 réelles), la 014 conserve les droits à l'identique, et la 015 n'ajoute `journaux.arreter` et `roles.edit` qu'aux directeurs ; les deux migrations rejouées sans erreur.
