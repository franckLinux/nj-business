# Migration du frontend vers React + Vite

Migration **progressive**. L'application vanilla d'origine vit dans
`frontend/legacy/`, reste servie sur `/` et pleinement fonctionnelle ; le
frontend React est monté sur `/v2`. Aucune bascule brutale : on porte page par
page, on ne coupe `/` qu'à la fin.

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
npm run dev          # http://localhost:3000/v2
```

## Rendu identique — comment c'est garanti

`frontend/src/main.jsx` importe **directement** `../legacy/css/app.css`.
Il n'y a donc **aucune copie** de la feuille de style : les deux frontends
partagent le même fichier. Une correction CSS profite aux deux, et il est
impossible qu'ils divergent.

Seul `src/styles/sidebar.css` est un extrait — le bloc `<style>` qui était
inline dans `legacy/index.html`. Si vous le modifiez, répercutez-le des deux
côtés jusqu'à la fin de la migration.

Les composants reprennent la structure DOM et les classes CSS nœud par nœud.
Le portage a été validé par comparaison des squelettes DOM (React en rendu
statique vs `legacy/index.html`).

## État

| Page / zone            | Statut  | Composant |
|------------------------|---------|-----------|
| Écran de connexion     | ✅ migré | `pages/LoginPage.jsx` |
| Sidebar + groupes      | ✅ migré | `components/Sidebar.jsx`, `NavGroup.jsx` |
| Topbar + période       | ✅ migré | `components/Topbar.jsx` |
| Tableau de bord        | ✅ migré | `pages/DashboardPage.jsx` |
| Journal de caisse      | ⬜ à faire | `legacy/js/app.js` → `loadJournalPage` (l. 295) |
| Journaux de caisse     | ⬜ à faire | `loadJournauxRecap` (l. 2085) |
| Suivi budgétaire       | ⬜ à faire | `loadBudget` (l. 2342) |
| Prévisions de dépenses | ⬜ à faire | `loadPrevisions` (l. 2886) |
| Demande de fonds       | ⬜ à faire | `loadAppelFonds` (l. 3146) |
| Compte d'emploi        | ⬜ à faire | `loadCompteEmploi` (l. 3371) |
| Configuration (6 onglets) | ⬜ à faire | `loadConfig` (l. 3913) |
| Dépenses en attente    | ⬜ à faire | `loadMouvementsAttentePage` (l. 2552) |
| Clients (Tenants)      | ⬜ à faire | `loadTenants` |
| Permissions            | ⬜ à faire | `loadPermissions` (l. 5337) |
| Modale mouvement       | ⬜ à faire | `saveMouvement` (l. 1376) |
| Impression A4 (journal + récap) | ⬜ à faire | l. 912 et l. 1094 |

### Écarts connus avec l'app vanilla

- **Cloche de notifications** : absente de la topbar React. Le badge et le
  panneau (`toggleNotifications`, `loadNotifications`, l. 2630) restent à porter.
- **Sélecteur de client (tenant)** : le badge est affiché mais n'ouvre pas
  encore la modale de sélection. Un super_admin sans tenant doit passer par `/`.
- **Mode hors ligne** : `idb.js`, `sync.js` et le service worker ne sont pas
  branchés sur React (décision assumée : réintégration en fin de migration).
  Le badge de synchro et le bouton d'installation PWA sont donc absents.

## Porter une page

1. Créer `src/pages/MaPage.jsx`.
2. Reprendre le HTML généré par la fonction `loadXxx` de `legacy/js/app.js`
   en JSX, **en gardant les mêmes classes CSS**.
3. Remplacer les `api.get(...)` par le `api` de `@/lib/api` (même contrat :
   une erreur métier arrive sous la forme `{ error }`).
4. Remplacer `state.mois` / `state.annee` / `state.user` par `useApp()`.
5. Brancher la route dans `src/App.jsx` à la place du `PlaceholderPage`.
6. Comparer visuellement `/` et `/v2` côte à côte.

## Fin de migration

Quand toutes les pages sont portées :

1. Déplacer `legacy/css/app.css`, `legacy/icons/`, `legacy/manifest.json`,
   `legacy/sw.js` dans `frontend/public/` (le dossier `public/` de Vite, dont
   le contenu est copié tel quel dans `dist/`).
2. Passer `base: '/'` dans `vite.config.js` et retirer le `basename="/v2"` du
   `BrowserRouter` dans `main.jsx`.
3. Corriger l'import CSS de `main.jsx` (`../legacy/css/app.css` → le nouvel
   emplacement), puis supprimer `frontend/legacy/`.
4. Dans `backend/server.js` : faire pointer `LEGACY_DIR` et le fallback SPA sur
   `frontend/dist`, et retirer le montage `/v2` devenu redondant.
5. Réintégrer le hors-ligne (`idb.js`, `sync.js`, service worker) — voir les
   écarts connus ci-dessus.
