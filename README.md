# CaissePro v2 — Plateforme SaaS Gestion de Caisse

> Cabinet Expert-Comptable · Zone CEMAC · Architecture Cloud Multi-Tenant

## Stack technique

| Couche       | Technologie                              |
|--------------|------------------------------------------|
| Backend      | Node.js 18+ · Express 4                  |
| Base de données | PostgreSQL 14+ (auto-hébergé)        |
| Auth         | JWT (jsonwebtoken) · bcryptjs            |
| Frontend     | Vanilla JS SPA (`/`) · React 18 + Vite (`/v2`, migration) |
| Stockage     | Disque local (`uploads/`) servi par Express |
| Sécurité     | Helmet · CORS · Rate limiting            |

---

## Installation rapide

### 1 — Cloner et installer

Le dépôt est un **workspace npm** : une seule installation à la racine couvre
`backend/` et `frontend/`, et toutes les commandes se lancent depuis la racine.

```bash
git clone <repo>
cd caisse-pro
npm install
```

### 2 — Installation automatique de la base (Windows)

Prérequis : **PostgreSQL 14+** installé
([téléchargement](https://www.postgresql.org/download/windows/)) et service démarré.

```powershell
.\tools\setup-db.ps1
```

Le script crée le rôle `caissepro` et la base `caissepro`, applique le schéma
et toutes les migrations, puis crée le compte super admin. Le mot de passe du
superutilisateur `postgres` vous est demandé une fois.

> **Mot de passe `postgres` perdu ?**
> Ouvrez PowerShell **en tant qu'administrateur** et lancez `.\tools\reset-pg-password.ps1`.
> Le script bascule temporairement PostgreSQL en authentification `trust`,
> redéfinit le mot de passe, puis **restaure systématiquement** `pg_hba.conf`
> (une sauvegarde horodatée est conservée à côté du fichier d'origine).

### 2 bis — Installation manuelle (Linux / macOS)

```bash
sudo -u postgres psql -f backend/db/setup-database.sql
```

### 3 — Configurer l'environnement
```bash
cp .env.example .env    # à la racine du projet (partagé par backend/ et frontend/)
# Éditer .env : PG_HOST/PG_DBNAME/PG_USER/PG_PASSWORD (ou DATABASE_URL)
# En local, laisser PG_SSL=false
```

### 4 — Initialiser la base de données

Inutile si `setup-db.ps1` a déjà tourné.

```bash
npm run db:setup     # schema.sql + migrations + plan comptable + super admin
```

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
`backend/db/data/plan-comptable-syscohada.js` (626 comptes, classes 1 à 9) et chargé
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
dans `backend/db/data/plan-comptable-syscohada.js` puis relancer `npm run db:plan`. La
classe est déduite du 1er chiffre du numéro de compte, la nature est déduite de
la classe sauf mention explicite.

### 6 — Démarrer
```bash
npm run dev        # développement (nodemon)
npm start          # production
```

L'application sera disponible sur **http://localhost:3000**

### 7 — Frontend React (migration progressive)

L'interface vanilla (`frontend/legacy/`) reste la référence sur `/`. Le frontend
React est monté sur `/v2`. Tout se pilote depuis la racine :

```bash
npm run build      # construit frontend/dist → http://localhost:3000/v2
npm run dev:web    # ou serveur Vite sur http://localhost:5173
```

État du portage page par page : `frontend/MIGRATION.md`.

---

## Déploiement (PlanetHoster — Passenger)

L'hébergement mutualisé n'exécute **ni build ni migration** au déploiement.
Deux conséquences structurent la procédure :

1. `frontend/dist` est **versionné** (et volontairement absent du `.gitignore`) :
   le bundle doit être construit en local avant le push.
2. Les migrations et les seeds se déclenchent par une **requête HTTP** protégée
   par un token, faute d'accès shell.

### Configuration du panneau Node.js

| Réglage                | Valeur                          |
|------------------------|---------------------------------|
| Application root       | `caisse-pro/backend`            |
| Application startup file | `server.js`                   |
| Application mode       | `production`                    |
| Node.js version        | 18 ou supérieure                |

Pointer la racine sur `backend/` plutôt que sur le dépôt évite d'installer
React, Chart.js et react-router sur le serveur : ils ne servent qu'au build,
déjà fait en local. `backend/server.js` exporte l'app (`module.exports = app`),
ce que Passenger exige.

### Avant chaque push

```bash
npm run build && npm run deploy:check
```

`deploy:check` refuse de valider si le bundle est absent, plus ancien que les
sources, ou exclu par `.gitignore` — les trois oublis qui ne se voient qu'une
fois en production.

### Variables d'environnement sur le serveur

Créer un `.env` **à la racine du dépôt** (pas dans `backend/`) à partir de
`.env.example`. `JWT_SECRET` et `SETUP_TOKEN` doivent différer de ceux du poste
de développement. Générer un token :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Initialiser la base à distance

```bash
curl -H "X-Setup-Token: VOTRE_TOKEN" https://votre-domaine.com/api/admin/setup
```

L'endpoint enchaîne schéma → migrations → plan comptable → super admin et
retourne un rapport JSON détaillant chaque étape et sa durée. Il est
**idempotent** : le relancer ne casse rien.

Pour consulter l'état sans rien écrire :

```bash
curl -H "X-Setup-Token: VOTRE_TOKEN" https://votre-domaine.com/api/admin/setup/status
```

> **Videz `SETUP_TOKEN` une fois le déploiement initial terminé.** L'endpoint
> redevient alors totalement invisible.

---

## Structure du projet

```
caisse-pro/
├── package.json                 ← Workspace npm : pilote backend/ et frontend/
├── .env.example                 ← Variables d'environnement (partagées, à la racine)
│
├── tools/
│   ├── setup-db.ps1             ← Installation de la base en une commande (Windows)
│   ├── reset-pg-password.ps1    ← Dépannage : mot de passe superutilisateur perdu
│   └── check-deploy.js          ← Vérifications avant déploiement (npm run deploy:check)
│
├── backend/
│   ├── server.js                ← Entry point Express (exporté pour Passenger)
│   ├── package.json
│   │
│   ├── db/
│   │   ├── setup-database.sql   ← Création du rôle + de la base (superutilisateur)
│   │   ├── schema.sql           ← Schéma PostgreSQL multi-tenant complet
│   │   ├── migrations/          ← 001_*.sql … appliquées une seule fois
│   │   │
│   │   ├── lib/                 ← Logique partagée CLI ⇄ API (ne ferme pas le pool)
│   │   │   ├── migrate.lib.js
│   │   │   ├── seed-admin.lib.js
│   │   │   ├── seed-plan.lib.js
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
│       │   ├── index.js            ← Tous les routeurs REST
│       │   └── admin-setup.route.js ← GET /api/admin/setup (déploiement)
│       └── controllers/
│           ├── auth.controller.js   ← Login / me / change-password
│           ├── journal.controller.js← CRUD mouvements + RAN + soldes
│           ├── budget.controller.js ← Budget + validation + attentes
│           ├── rubriques.controller.js ← Rubriques dynamiques CRUD
│           └── users.controller.js  ← Gestion utilisateurs
│
└── frontend/                   ← Tout ce qui est servi au navigateur
    ├── MIGRATION.md            ← État du portage, page par page
    ├── vite.config.js
    ├── dist/                   ← Build React — VERSIONNÉ (l'hébergeur ne builde pas)
    │
    ├── src/                    ← React + Vite, servi sur /v2
    │   ├── lib/                ← api.js, format.js
    │   ├── context/            ← AppContext (session, période), ToastContext
    │   ├── components/         ← Layout, Sidebar, Topbar, NavGroup
    │   └── pages/              ← LoginPage, DashboardPage, …
    │
    └── legacy/                 ← SPA vanilla, servie sur / (toujours en service)
        ├── index.html
        ├── css/app.css         ← Source unique du style, importée aussi par React
        └── js/app.js
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

Options de `/api/admin/setup` : `&prune=1` (désactive les comptes SYSCOHADA
obsolètes), `&reset_admin=1` (réinitialise le mot de passe du super admin —
volontairement désactivé par défaut).

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
|---------|----------------------------------|--------------------------|
| GET     | /api/budget                      | Budget + validation      |
| PUT     | /api/budget                      | Définir dotation         |
| POST    | /api/budget/validation           | Valider/rejeter budget   |
| POST    | /api/budget/depenses-attente     | Ajouter dépense attente  |
| DELETE  | /api/budget/depenses-attente/:id | Supprimer dépense attente|

### Rubriques
| Méthode | Route              | Description              |
|---------|--------------------|--------------------------|
| GET     | /api/rubriques     | Liste rubriques du tenant|
| POST    | /api/rubriques     | Créer rubrique           |
| PUT     | /api/rubriques/:id | Modifier rubrique        |

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
|--------------------|-----------------------------------------------------|
| `super_admin`      | Accès total · gestion tenants · équivalences SAGE   |
| `comptable_cabinet`| Lecture + exports SAGE + gestion équivalences       |
| `directeur`        | Accès complet son entité · validation budget · users|
| `caissier`         | Saisie journal · consultation                       |
| `auditeur`         | Lecture seule totale                                |

---

## Roadmap (CDC v1.1)

- [x] **P0** — Architecture multi-tenant · Auth JWT · CRUD complet
- [x] **P1** — API REST · Rubriques dynamiques · Dashboard
- [ ] **P2** — Mode hors-ligne PWA · Service Worker · SQLite local
- [ ] **P3** — Module SAGE i7 · Table équivalences · Génération .ecr
- [ ] **P4** — Dashboard Cabinet React multi-clients
- [ ] **P5** — Sécurité avancée · 2FA · Journal audit immuable
- [ ] **P6** — Export SAGE 100 · Notifications email/SMS

---

## Migration depuis l'app R Shiny

Les rubriques codées en dur dans `app_26.r` sont automatiquement seedées
lors de la création d'un tenant via `seedRubriquesDefaut()` dans
`backend/src/controllers/rubriques.controller.js`. Elles peuvent ensuite être
modifiées librement depuis l'interface.

Les mêmes tables PostgreSQL sont compatibles — la migration des données
existantes peut se faire via un script de transformation
`backend/db/migrations/0XX_migrate_from_v1.sql` à créer en Phase P2.
