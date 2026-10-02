# CaissePro v2 — Frontend

Projet **autonome** React 18 + Vite : son propre `package.json`, ses propres
`node_modules`. Issu d'une migration progressive depuis une SPA vanilla
(`legacy/`, supprimée une fois le portage terminé — voir `MIGRATION.md` pour
l'historique page par page).

## Installation

```bash
cd frontend
npm install
```

## Développement

```bash
npm run dev       # serveur Vite → http://localhost:5173
```

En dev, les appels `/api/*` doivent atteindre le backend Express — démarrez-le
séparément (voir [`../backend/README.md`](../backend/README.md)), par défaut
sur `http://localhost:3000`.

## Build de production

```bash
npm run build      # écrit dist/
```

`dist/` est **volontairement versionné dans Git** : l'hébergement (PlanetHoster
/ Passenger) ne build rien côté serveur. Le backend sert ce dossier à la
racine `/` — pensez à lancer `npm run build` ici avant chaque déploiement,
puis `npm run deploy:check` depuis `../backend`.

Si le backend est déployé sur un **domaine séparé** (pas le cas par défaut),
copier [`.env.example`](.env.example) en `.env.production` et renseigner
`VITE_API_URL` avant de builder — voir
[`../backend/README.md`](../backend/README.md#frontend-et-backend-sur-deux-domainessous-domaines-distincts).

## Structure

```
frontend/
├── src/                    ← React + Vite, servi à la racine /
│   ├── lib/                ← api.js, format.js, idb.js, syncManager.js, print.js
│   ├── context/             ← AppContext (session, période), ToastContext
│   ├── components/          ← Layout, Sidebar, Topbar, NavGroup, PwaBootstrap, …
│   ├── styles/               ← app.css (source unique du style), sidebar.css
│   └── pages/                ← LoginPage, DashboardPage, …
├── public/                  ← manifest.json, sw.js, icons/ (copiés dans dist/ au build)
├── dist/                    ← Build — versionné, ne pas éditer à la main
└── MIGRATION.md             ← Historique du portage, page par page (terminé)
```
