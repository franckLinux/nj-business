# Migration du frontend vers React + Vite — historique

Migration **terminée**. L'application était initialement une SPA vanilla
(`frontend/legacy/`) servie sur `/`, portée progressivement vers React/Vite
(d'abord montée en parallèle sur `/v2`). Ce document garde la trace du
portage page par page ; `frontend/legacy/` a été supprimé une fois toutes les
pages migrées et vérifiées, et React sert maintenant seul, à la racine `/`.

## Démarrer

Le dépôt est un workspace npm : tout se lance depuis la **racine**.

```bash
npm install          # une seule fois, couvre backend/ et frontend/
npm run dev:web      # http://localhost:5173 (proxy /api → localhost:3000)
```

En parallèle, `npm run dev` à la racine pour l'API Express.

Pour tester le rendu servi par Express :

```bash
npm run build        # génère frontend/dist
npm run dev          # http://localhost:3000
```

## Rendu — comment la parité avec l'app vanilla a été garantie

Pendant la migration, `frontend/src/main.jsx` importait **directement**
`../legacy/css/app.css` : aucune copie de la feuille de style, les deux
frontends partageaient le même fichier, il était impossible qu'ils divergent.
Une fois `legacy/` supprimé, ce fichier a été copié une seule fois vers
`src/styles/app.css` (voir « Fin de migration » ci-dessous).

Les composants reprennent la structure DOM et les classes CSS nœud par nœud.
Le portage a été validé par comparaison des squelettes DOM (React en rendu
statique vs `legacy/index.html`, avant sa suppression).

## État

| Page / zone            | Statut  | Composant |
|------------------------|---------|-----------|
| Écran de connexion     | ✅ migré | `pages/LoginPage.jsx` |
| Sidebar + groupes      | ✅ migré | `components/Sidebar.jsx`, `NavGroup.jsx` |
| Topbar + période       | ✅ migré | `components/Topbar.jsx` |
| Tableau de bord        | ✅ migré | `pages/DashboardPage.jsx` |
| Journal de caisse      | ✅ migré | `pages/JournalPage.jsx`, `components/MouvementModal.jsx` |
| Journaux de caisse     | ✅ migré | `pages/JournauxRecapPage.jsx` |
| Suivi budgétaire       | ✅ migré (partiel) | `pages/BudgetPage.jsx` |
| Prévisions de dépenses | ✅ migré | `pages/PrevisionsPage.jsx` |
| Demande de fonds       | ✅ migré | `pages/AppelFondsPage.jsx` |
| Compte d'emploi        | ✅ migré | `pages/CompteEmploiPage.jsx` |
| Configuration (6/7 onglets) | ✅ migré | `pages/ConfigPage.jsx` et `components/config/*` |
| Dépenses en attente    | ✅ migré | `pages/AttentePage.jsx` |
| Clients (Tenants)      | ✅ migré | `pages/TenantsPage.jsx` |
| Permissions            | ✅ migré | `pages/PermissionsPage.jsx` |
| Modale mouvement       | ✅ migré | `components/MouvementModal.jsx` |
| Impression A4 (journal, récap, demande de fonds, compte d'emploi) | ✅ migré | `lib/print.js` |
| PWA / mode hors ligne  | ✅ migré | `lib/idb.js`, `lib/syncManager.js`, `public/sw.js`, `components/PwaBootstrap.jsx` |

### Écarts connus avec l'app vanilla

- **PWA / mode hors ligne — service worker reconstruit, pas une reprise
  littérale** : `public/sw.js` a la même stratégie que l'ancien
  `legacy/sw.js` (cache-first statique, network-first API), mais sans liste
  figée de fichiers — les bundles Vite étant hashés à chaque build, les
  assets statiques sont mis en cache à la volée au premier fetch réussi
  plutôt que pré-listés. Écrit initialement scopé à `/v2/` pendant la
  migration progressive, puis re-scopé à `/` lors de la suppression de
  `legacy/`.
- **PWA — icônes** : seule une icône SVG existe dans le projet
  (`legacy/icons/icon.svg`, copiée vers `public/icons/icon.svg`) ; les PNG
  192×192/512×512 référencés par le manifest legacy n'ont jamais existé sur
  disque. Le manifest React déclare un unique icône SVG `"sizes":"any"` —
  fonctionnel pour l'installation sur Chromium/Edge, mais des PNG dédiés
  (notamment `purpose:"maskable"` avec zone de sécurité correcte) amélioreraient
  le rendu de l'icône installée.
- **Pré-contrôle budgétaire hors-ligne — pas de rechargement forcé après
  sauvegarde** : contrairement à `saveMouvement` (legacy, l. 1424) qui relance
  `loadJournalPage()` même hors ligne, le port React se contente de fermer la
  modale sans recharger : notre client API renvoie proprement
  `{ error: 'Connexion au serveur impossible.' }` hors ligne (au lieu de
  rejeter la promesse), et ce message aurait remplacé tout le contenu déjà
  affiché à l'écran — déviation délibérée, documentée dans
  `components/MouvementModal.jsx`.
- **Prévisions de dépenses — bug legacy corrigé** : la page utilisait un
  tableau de mois accentués (`MOIS_LISTE`, l. 2875) différent du `MOIS` global
  sans accent. Comme la valeur choisie est envoyée telle quelle au backend
  (`mois`/`mois_applic`), une prévision saisie pour Février, Août ou Décembre
  était stockée sous une graphie que le reste de l'app (`WHERE mois=$2`,
  comparaison stricte) ne retrouve jamais — invisible partout ailleurs,
  silencieusement. Corrigé dans le port (un seul `MOIS`, comme partout
  ailleurs) — ce bug n'existait que dans l'app vanilla, disparue avec elle.
- **Suivi budgétaire — section non portée** : « Dépassements de budget »
  (`refreshDepassementsBudget`, table `demandes_depassement`) n'est pas
  reprise. Constat fait en portant cette page : le flux qui alimentait cette
  table (`saveMouvement` → `res.require_validation` → `openModalDepassement`)
  n'est plus émis par le backend actuel (`createMouvement`/`updateMouvement`
  ne renvoient que `en_attente`/`refus_modification`) — la section aurait été
  en permanence vide même si elle avait été portée. Code mort à signaler côté
  backend (routes `budget-caisse/demande*` encore présentes, jamais atteintes).

## Fin de migration (fait)

Une fois toutes les pages ci-dessus portées et vérifiées au navigateur, la
bascule finale a été effectuée :

1. `legacy/css/app.css` copié vers `frontend/src/styles/app.css` ;
   `legacy/icons/icon.svg`, `manifest.json`, `sw.js` déjà présents dans
   `frontend/public/` (copiés lors du portage du PWA, lot E) — leur `scope`
   et `start_url`/chemins internes repassés de `/v2/` à `/`.
2. `vite.config.js` : `base` passé de `/v2/` à `/`.
3. `main.jsx` : retiré le `basename="/v2"` du `BrowserRouter`, import CSS
   pointé vers `@/styles/app.css`.
4. `frontend/legacy/` supprimé (`git rm -r`).
5. `backend/index.js` : retiré le montage `LEGACY_DIR` et le préfixe `/v2` ;
   `frontend/dist` est servi statiquement à la racine, avec un fallback SPA
   (`app.get('*', ...)`) pour les routes React inconnues côté serveur.
6. `backend/tools/check-deploy.js` et les `README.md` (racine, backend,
   frontend) mis à jour pour ne plus référencer `/v2` ni `legacy/`.

Vérifié après bascule (Playwright + Edge, build de production servi par
Express) : connexion, navigation entre pages, rechargement direct d'une route
profonde (`/journaux-recap`) via le fallback SPA serveur, service worker actif
avec `scope: "http://localhost:3000/"`.
