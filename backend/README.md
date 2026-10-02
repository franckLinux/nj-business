# CaissePro v2 — Backend

> API Express/PostgreSQL — Cabinet Expert-Comptable · Zone CEMAC · Architecture Cloud Multi-Tenant

Ce dossier est un projet **autonome** : ses propres `package.json`, `node_modules`
et `.env`. Il sert aussi le bundle React de [`../frontend`](../frontend) à la
racine `/` — voir « Servir le frontend » plus bas — mais aucune commande
ci-dessous n'a besoin d'être lancée depuis la racine du dépôt.

## Stack technique

| Couche           | Technologie                                  |
|------------------|-----------------------------------------------|
| Backend          | Node.js 18+ · Express 4                       |
| Base de données  | PostgreSQL 14+ (auto-hébergé)                 |
| Auth             | JWT (jsonwebtoken) · bcryptjs                 |
| Stockage         | Disque local (`uploads/`) servi par Express   |
| Sécurité         | Helmet · CORS · Rate limiting                 |

---

## Installation rapide

### 1 — Installer les dépendances

```bash
cd backend
npm install
```

### 2 — Créer le rôle et la base PostgreSQL

Prérequis : **PostgreSQL 14+** installé et le service démarré.

```bash
# Linux / macOS
sudo -u postgres psql -f db/setup-database.sql

# Windows (psql.exe doit être dans le PATH, sinon utiliser le chemin complet,
# p. ex. "C:\Program Files\PostgreSQL\<version>\bin\psql.exe")
psql -U postgres -h localhost -f db/setup-database.sql
```

Le mot de passe du superutilisateur `postgres` vous est demandé une fois. Ce
script crée uniquement le rôle `caissepro` et la base `caissepro` — schéma,
migrations, plan comptable et super admin sont chargés à l'étape 4.

> **Mot de passe `postgres` perdu (Windows) ?**
> Ouvrez PowerShell **en tant qu'administrateur** et lancez `.\tools\reset-pg-password.ps1`.
> Le script bascule temporairement PostgreSQL en authentification `trust`,
> redéfinit le mot de passe, puis **restaure systématiquement** `pg_hba.conf`
> (une sauvegarde horodatée est conservée à côté du fichier d'origine).

### 3 — Configurer l'environnement

```bash
cp .env.example .env
# Éditer .env : DATABASE_URL (ou PG_HOST/PG_DBNAME/PG_USER/PG_PASSWORD)
# En local, laisser PG_SSL=false
```

### 4 — Initialiser la base de données

```bash
npm run db:setup     # schema.sql + migrations + plan comptable + super admin
```

Cette commande est le **même chemin de code** que la route de déploiement
`GET /api/admin/setup` (voir « Déploiement » plus bas) : pas de dérive entre
poste local et production, et pas besoin d'un script séparé par OS.

Ou étape par étape :

```bash
npm run db:schema    # applique db/schema.sql puis les migrations en attente
npm run db:migrate   # applique uniquement les migrations en attente
npm run db:status    # liste l'état des migrations sans rien appliquer
npm run db:plan      # charge le plan comptable SYSCOHADA révisé
npm run db:seed      # (ré)initialise le compte super admin
```

Identifiants par défaut : `admin` / `Admin2026!` (modifiables via
`SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`). **À changer dès la première
connexion.**

### 5 — Plan comptable SYSCOHADA

Le référentiel est versionné avec le code dans
`db/data/plan-comptable-syscohada.js` (626 comptes, classes 1 à 9) et chargé
dans la table `plan_comptable_syscohada` par :

```bash
npm run db:plan
```

Le chargement est **idempotent et transactionnel** : il peut être relancé à
volonté après chaque mise à jour du référentiel. Il crée les comptes manquants,
réaligne l'intitulé / la classe / la nature des comptes existants et les
réactive. Les comptes additifs créés depuis l'application (`source = 'custom'`)
ne sont jamais écrasés ni désactivés.

```bash
npm run db:plan:status
```

affiche l'état en base (nombre de comptes par classe et par source) sans rien
écrire. L'option `--prune` (`node db/seed-plan-comptable.js --prune`) désactive
en plus les comptes `syscohada` retirés du référentiel.

Pour étendre le référentiel : ajouter les lignes `[compte, intitulé, nature?]`
dans `db/data/plan-comptable-syscohada.js` puis relancer `npm run db:plan`. La
classe est déduite du 1er chiffre du numéro de compte, la nature est déduite de
la classe sauf mention explicite.

### 6 — Démarrer

```bash
npm run dev        # développement (nodemon)
npm start          # production
```

L'application sera disponible sur **http://localhost:3000**

### 7 — Servir le frontend

Le backend sert le build React de `../frontend/dist` à la racine `/` (SPA,
fallback `index.html` pour toute route inconnue). `index.js` cherche
`../frontend/dist/index.html` : construisez-le avec `npm run build` **dans
`frontend/`** avant de démarrer le backend. Voir
[`../frontend/README.md`](../frontend/README.md) et `../frontend/MIGRATION.md`
(historique du portage, désormais terminé).

---

## Déploiement (PlanetHoster — Passenger)

L'hébergement mutualisé n'exécute **ni build ni migration** au déploiement.
Deux conséquences structurent la procédure :

1. `frontend/dist` est **versionné** (et volontairement absent du `.gitignore`) :
   le bundle doit être construit en local avant le push.
2. Les migrations et les seeds se déclenchent par une **requête HTTP** protégée
   par un token, faute d'accès shell.

### Configuration du panneau Node.js

| Réglage                   | Valeur                |
|----------------------------|-----------------------|
| Application root          | `caisse-pro/backend`  |
| Application startup file  | `index.js`             |
| Application mode          | `production`          |
| Node.js version           | 18 ou supérieure      |

Pointer la racine sur `backend/` plutôt que sur le dépôt évite d'installer
React, Chart.js et react-router sur le serveur : ils ne servent qu'au build,
déjà fait en local. `index.js` exporte l'app (`module.exports = app`), ce que
Passenger exige. Comme `backend/` est déjà l'app root de Passenger, le `.env`
de production se dépose directement à sa racine (`backend/.env`) — plus besoin
de remonter d'un niveau.

### Avant chaque push

```bash
cd frontend && npm run build
cd ../backend && npm run deploy:check
```

`deploy:check` refuse de valider si le bundle est absent, plus ancien que les
sources, ou exclu par un `.gitignore` — les trois oublis qui ne se voient
qu'une fois en production.

### Variables d'environnement sur le serveur

Créer un `.env` **dans `backend/`** (à côté de `index.js`) à partir de
`.env.example`. `JWT_SECRET` et `SETUP_TOKEN` doivent différer de ceux du poste
de développement. Générer un token :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Initialiser la base à distance

```bash
curl -H "X-Setup-Token: VOTRE_TOKEN" "https://votre-domaine.com/api/admin/setup?seed_config=1"
```

L'endpoint enchaîne schéma → migrations → plan comptable → super admin →
configuration métier, et retourne un rapport JSON détaillant chaque étape et sa
durée. Il est **idempotent** : le relancer ne casse rien.

Sans `&seed_config=1`, la base obtenue est techniquement complète mais
**fonctionnellement vide** : ni client, ni journal, ni rubrique. Les migrations
ne sèment que la table `permissions` ; tout le reste du référentiel métier vit
dans `db/data/config-*.js` (voir « Référentiel métier » ci-dessous).

Pour consulter l'état sans rien écrire :

```bash
curl -H "X-Setup-Token: VOTRE_TOKEN" https://votre-domaine.com/api/admin/setup/status
```

> **Videz `SETUP_TOKEN` une fois le déploiement initial terminé.** L'endpoint
> redevient alors totalement invisible.

### Frontend et backend sur deux domaines/sous-domaines distincts

Par défaut, ce backend sert aussi le build React à la racine `/` (même
domaine, voir « Servir le frontend » plus haut) — aucune configuration
supplémentaire n'est alors nécessaire, le frontend appelle l'API en chemin
relatif.

Si le frontend est déployé ailleurs (autre sous-domaine, hébergement statique
séparé), deux variables doivent pointer l'une vers l'autre :

- Côté backend (`backend/.env`) : `APP_URL=https://votre-frontend.mondomaine.com`
  — utilisée à la fois pour autoriser ce domaine en CORS ([index.js](index.js#L17-L23))
  et pour les liens dans les e-mails.
- Côté frontend, avant `npm run build` : `VITE_API_URL=https://api.mondomaine.com`
  dans `frontend/.env.production` (voir [`../frontend/.env.example`](../frontend/.env.example))
  — Vite l'inline au build, pas au runtime, donc rebuild obligatoire après
  toute modification.

### Référentiel métier (tenant, journaux, rubriques)

Les migrations créent les tables et sèment les 25 permissions, mais le
paramétrage d'un cabinet — le client, ses journaux de caisse et ses rubriques
d'entrée/dépense — est de la donnée applicative, saisie depuis l'écran
Configuration. Pour ne pas la ressaisir à chaque déploiement, on l'exporte
depuis une base de référence vers un fichier versionné :

```bash
npm run config:export
```

Cela écrit `db/data/config-<slug>.js` (identité du client, journaux, rubriques
avec leurs codes comptables). **Committez ce fichier** pour qu'il parte en
production. Il ne contient aucun utilisateur ni mot de passe : les comptes se
créent depuis l'application, et le super admin par `seed-admin`.

Chargement, en local ou à distance :

```bash
npm run db:config                                                       # local
curl -H "X-Setup-Token: …" "https://…/api/admin/setup?seed_config=1"   # distant
```

Le chargement **préserve l'existant** : une rubrique déjà en base n'est jamais
modifiée. C'est délibéré — l'endpoint est joignable par simple URL, il ne doit
pas pouvoir réécrire en silence un intitulé corrigé par un comptable. Pour
propager volontairement une évolution du référentiel, ajoutez `--force` en CLI
ou `&config_force=1` en HTTP.

Déposer plusieurs `config-*.js` dans `db/data/` permet d'amorcer plusieurs
cabinets d'un coup ; chaque fichier est appliqué dans sa propre transaction.

---

## Structure du projet

```
caisse-pro/
├── backend/                     ← Projet Node.js autonome (ce dossier)
│   ├── index.js                 ← Entry point Express (exporté pour Passenger)
│   ├── package.json             ← Dépendances + scripts, propres à backend/
│   ├── .env                     ← Config locale (hors dépôt Git)
│   ├── .env.example
│   │
│   ├── tools/
│   │   ├── reset-pg-password.ps1← Dépannage : mot de passe superutilisateur perdu (Windows)
│   │   ├── export-config.js     ← Exporte le référentiel métier (npm run config:export)
│   │   └── check-deploy.js      ← Vérifications avant déploiement (npm run deploy:check)
│   │
│   ├── db/
│   │   ├── setup-database.sql   ← Création du rôle + de la base (superutilisateur)
│   │   ├── schema.sql           ← Schéma PostgreSQL multi-tenant complet
│   │   ├── migrations/          ← 001_*.sql … appliquées une seule fois
│   │   │
│   │   ├── data/
│   │   │   ├── plan-comptable-syscohada.js  ← 626 comptes, classes 1 à 9
│   │   │   └── config-<slug>.js ← Référentiel métier d'un cabinet (généré)
│   │   │
│   │   ├── lib/                 ← Logique partagée CLI ⇄ API (ne ferme pas le pool)
│   │   │   ├── migrate.lib.js
│   │   │   ├── seed-admin.lib.js
│   │   │   ├── seed-plan.lib.js
│   │   │   ├── seed-config.lib.js  ← Tenant + journaux + rubriques
│   │   │   └── setup.js         ← Orchestrateur + verrou consultatif Postgres
│   │   │
│   │   ├── migrate.js           ← CLI migrations
│   │   ├── seed-admin.js        ← CLI super admin
│   │   ├── seed-plan-comptable.js ← CLI plan comptable
│   │   └── setup.js             ← CLI « tout en un » (npm run db:setup)
│   │
│   ├── uploads/                 ← Pièces jointes (hors dépôt Git)
│   │
│   └── src/
│       ├── config/
│       │   └── database.js         ← Pool pg (PostgreSQL local)
│       ├── middleware/
│       │   ├── auth.js             ← Vérification JWT
│       │   ├── tenant.js           ← Isolation multi-tenant
│       │   └── setupToken.js       ← Garde SETUP_TOKEN (initialisation distante)
│       ├── services/
│       │   └── storage.service.js  ← Écriture/suppression des pièces sur disque
│       ├── routes/
│       │   ├── index.js            ← Tous les routeurs REST (déclaratif)
│       │   └── admin-setup.route.js ← GET /api/admin/setup (déploiement)
│       └── controllers/            ← Un controller par domaine métier
│
└── frontend/                   ← Projet Vite/React autonome — voir frontend/README.md
```

---

## API REST — Endpoints

### Initialisation (déploiement)

Protégées par `SETUP_TOKEN` (en-tête `X-Setup-Token` ou `?token=`), **sans JWT** :
elles servent précisément quand aucun compte n'existe encore.

| Méthode | Route                     | Description                                  |
|---------|---------------------------|----------------------------------------------|
| GET     | /api/admin/setup          | Schéma + migrations + plan comptable + admin |
| GET     | /api/admin/setup/status   | État de la base, sans écriture               |

Options de `/api/admin/setup` :

| Paramètre        | Effet                                                          |
|------------------|----------------------------------------------------------------|
| `&seed_config=1` | Charge `db/data/config-*.js` : tenant, journaux, rubriques      |
| `&config_force=1`| Laisse cette config écraser les lignes existantes               |
| `&prune=1`       | Désactive les comptes SYSCOHADA absents du référentiel          |
| `&reset_admin=1` | Réinitialise le mot de passe du super admin                     |

`&reset_admin=1` et `&config_force=1` sont les deux seules options destructrices,
et toutes deux sont désactivées par défaut : un rejeu accidentel de l'URL de
setup ne peut ni remettre le mot de passe admin à sa valeur de seed, ni écraser
un paramétrage retouché en production.

Sans token valide, ces routes répondent **comme une URL inexistante** : aucun
401, aucun 403, rien qui confirme leur présence. Les tentatives sont
journalisées côté serveur. Débit limité à 10 requêtes par heure.

### Auth
| Méthode | Route                    | Description               |
|---------|--------------------------|---------------------------|
| POST    | /api/auth/login          | Connexion → JWT           |
| GET     | /api/auth/me             | Infos utilisateur courant |
| POST    | /api/auth/change-password| Changer mot de passe      |

### Journal
| Méthode | Route              | Description                    |
|---------|--------------------|--------------------------------|
| GET     | /api/journal       | Liste mouvements + soldes      |
| POST    | /api/journal       | Créer mouvement                |
| PUT     | /api/journal/:id   | Modifier mouvement             |
| DELETE  | /api/journal/:id   | Supprimer (directeur)          |
| GET     | /api/journal/soldes| Soldes espèces + OM            |
| GET     | /api/journal/cumuls| Cumuls par rubrique            |
| GET     | /api/journal/ran   | Report à nouveau               |
| POST    | /api/journal/ran   | Définir RAN                    |

### Budget
| Méthode | Route                            | Description              |
|---------|-----------------------------------|--------------------------|
| GET     | /api/budget                      | Budget + validation      |
| PUT     | /api/budget                      | Définir dotation         |
| DELETE  | /api/budget/:id                  | Supprimer une ligne      |
| POST    | /api/budget/validation           | Valider/rejeter budget   |
| POST    | /api/budget/depenses-attente     | Ajouter dépense attente  |
| DELETE  | /api/budget/depenses-attente/:id | Supprimer dépense attente|

### Rubriques
| Méthode | Route              | Description              |
|---------|--------------------|--------------------------|
| GET     | /api/rubriques     | Liste rubriques du tenant|
| POST    | /api/rubriques     | Créer rubrique           |
| PUT     | /api/rubriques/:id | Modifier rubrique        |
| DELETE  | /api/rubriques/:id | Désactiver rubrique      |

### Gestion
| Méthode | Route                   | Description               |
|---------|-------------------------|---------------------------|
| GET     | /api/users              | Liste utilisateurs        |
| POST    | /api/users              | Créer utilisateur         |
| PUT     | /api/users/:id          | Modifier utilisateur      |
| POST    | /api/users/:id/password | Réinitialiser mot de passe|
| DELETE  | /api/users/:id          | Supprimer utilisateur     |
| GET     | /api/banque             | Données bancaires du mois |
| PUT     | /api/banque             | Mettre à jour banque      |
| GET     | /api/tenants            | Liste clients (admin)     |
| POST    | /api/tenants            | Créer client              |
| GET     | /api/dashboard/stats    | KPIs + tendances          |

---

## Rôles et accès

| Rôle               | Accès                                               |
|--------------------|-------------------------------------------------------|
| `super_admin`      | Accès total · gestion tenants · équivalences SAGE   |
| `comptable_cabinet`| Lecture + exports SAGE + gestion équivalences       |
| `directeur`        | Accès complet son entité · validation budget · users|
| `caissier`         | Saisie journal · consultation                       |
| `auditeur`         | Lecture seule totale                                |

---

## Roadmap (CDC v1.1)

- [x] **P0** — Architecture multi-tenant · Auth JWT · CRUD complet
- [x] **P1** — API REST · Rubriques dynamiques · Dashboard
- [x] **P2** — Mode hors-ligne PWA · Service Worker · IndexedDB (file de sync)
- [ ] **P3** — Module SAGE i7 · Table équivalences · Génération .ecr
- [ ] **P4** — Dashboard Cabinet React multi-clients
- [ ] **P5** — Sécurité avancée · 2FA · Journal audit immuable
- [ ] **P6** — Export SAGE 100 · Notifications email/SMS

---

## Migration depuis l'app R Shiny

Les rubriques codées en dur dans `app_26.r` sont automatiquement seedées
lors de la création d'un tenant via `seedRubriquesDefaut()` dans
`src/controllers/rubriques.controller.js`. Elles peuvent ensuite être
modifiées librement depuis l'interface.

Les mêmes tables PostgreSQL sont compatibles — la migration des données
existantes peut se faire via un script de transformation
`db/migrations/0XX_migrate_from_v1.sql` à créer en Phase P2.
