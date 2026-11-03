// =====================================================================
// NJ Caisse Pro — Service Worker (PWA)
// Même stratégie que l'ancien frontend/legacy/sw.js (cache-first pour les
// assets statiques, network-first pour les GET API), mais sans liste figée
// de fichiers : le build Vite produit des noms de bundle hashés à chaque
// build, donc les assets statiques sont mis en cache à la volée dès qu'ils
// sont récupérés avec succès (cacheFirstStatic), plutôt que pré-listés.
// =====================================================================

// v5 : la page HTML passe en NETWORK-FIRST. En v4 elle était servie
// cache-first : une fois « / » en cache, le navigateur gardait l'ancien
// index.html — donc l'ancien bundle JS — indéfiniment, et aucun déploiement
// n'apparaissait chez les utilisateurs. Changer de nom de cache purge tout.
const CACHE_STATIC  = 'nj-caisse-pro-static-v54';   // v54 : Société sans documents d'achat ; v53 : Société (remplissage sans caisse, documents d'achat rétablis) et accès sans caisse ; v52 : NJ COMMERCIAL, Société (compléments d'identité, documents d'achat retirés) ; v51 : NJ COMMERCIAL, menu en tiroirs et Configuration à onglets ; v50 : NJ COMMERCIAL lot 5 (réceptions, retours, factures et avoirs fournisseurs) ; v49 : permissions détaillées du stock (une par fonction) ; v48 : NJ COMMERCIAL lot 4 (moteur de stock CMUP/FIFO, entrées, sorties, transferts, inventaires) ; v47 : NJ COMMERCIAL lot 3 (unités et conversions) ; v46 : NJ COMMERCIAL lots 1-2 (menu en 4 rubriques, agences, familles, périmètre) ; v45 : accès à NJ COMMERCIAL (profils par module, accueil explicite) ; v44 : NJ COMMERCIAL, bons de commande, tableau de bord, documents, historique, vérification publique ; v43 : NJ COMMERCIAL, demandes d'achat et autorisations ; v42 : NJ COMMERCIAL, paramétrage des achats ; v41 : catalogue des modules (DSF, REVIS, CG) ; v40 : suppression d'un client (plateforme) ; v39 : passerelle interactive ; v38 : bouton Rafraîchir ; v37 : NJ BUSINESS (accueil, modules, logo)
const CACHE_DYNAMIC = 'nj-caisse-pro-dynamic-v54';

const APP_SHELL = ['/', '/manifest.json'];

const CACHEABLE_API = ['/api/rubriques', '/api/config'];

self.addEventListener('install', (event) => {
  console.log('[SW] Install');
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) =>
      cache.addAll(APP_SHELL).catch((err) => console.warn('[SW] Certains assets non mis en cache :', err))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activate');
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_STATIC && k !== CACHE_DYNAMIC).map((k) => {
          console.log('[SW] Suppression ancien cache :', k);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!url.protocol.startsWith('http')) return;

  if (url.pathname.startsWith('/api/')) {
    if (event.request.method === 'GET') {
      event.respondWith(networkFirstApi(event.request));
    }
    // Mutations (POST/PUT/DELETE/PATCH) : on laisse passer, gérées côté app (syncManager.js).
    return;
  }

  if (event.request.method !== 'GET') return;

  // Page HTML (navigation) : toujours le réseau d'abord, cache si hors ligne.
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(networkFirstPage(event.request));
    return;
  }

  // Ressources d'un autre domaine (polices, CDN…) : pas d'interception.
  if (url.origin !== self.location.origin) return;

  // Bundles Vite hashés (/assets/index-XXXX.js) : immuables → cache-first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirstStatic(event.request));
    return;
  }

  // Le reste (manifest, icônes…) : réseau d'abord, cache en secours.
  event.respondWith(networkFirstPage(event.request));
});

const networkFirstPage = async (request) => {
  try {
    let networkResponse = await fetch(request);
    // Route React (/demande-demo, /activation/…, /prospects…) inconnue du
    // serveur statique : on sert l'application (index.html), qui affiche la page.
    if (request.mode === 'navigate' && networkResponse.status === 404) {
      networkResponse = await fetch('/', { cache: 'no-store' });
    }
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_STATIC);
      cache.put(request.mode === 'navigate' ? '/' : request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    const cached = await caches.match(request.mode === 'navigate' ? '/' : request);
    if (cached) return cached;
    return new Response('Hors ligne', { status: 503 });
  }
};

const networkFirstApi = async (request) => {
  const url = new URL(request.url);
  const isCacheable = CACHEABLE_API.some((p) => url.pathname.startsWith(p));

  try {
    const networkResponse = await fetch(request.clone());
    if (networkResponse.ok && isCacheable) {
      const cache = await caches.open(CACHE_DYNAMIC);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    if (isCacheable) {
      const cached = await caches.match(request);
      if (cached) {
        console.log('[SW] Offline fallback cache :', url.pathname);
        return cached;
      }
    }
    return new Response(
      JSON.stringify({ error: 'Hors ligne. Données non disponibles.', offline: true }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

const cacheFirstStatic = async (request) => {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const networkResponse = await fetch(request.clone());
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_STATIC);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    if (request.destination === 'document') {
      const indexCached = await caches.match('/');
      if (indexCached) return indexCached;
    }
    return new Response('Hors ligne', { status: 503 });
  }
};

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_CACHE') {
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
  }
});
