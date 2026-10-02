// =====================================================================
// NJ Caisse Pro — Service Worker (PWA)
// Même stratégie que l'ancien frontend/legacy/sw.js (cache-first pour les
// assets statiques, network-first pour les GET API), mais sans liste figée
// de fichiers : le build Vite produit des noms de bundle hashés à chaque
// build, donc les assets statiques sont mis en cache à la volée dès qu'ils
// sont récupérés avec succès (cacheFirstStatic), plutôt que pré-listés.
// =====================================================================

const CACHE_STATIC  = 'nj-caisse-pro-static-v2';
const CACHE_DYNAMIC = 'nj-caisse-pro-dynamic-v2';

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

  event.respondWith(cacheFirstStatic(event.request));
});

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
