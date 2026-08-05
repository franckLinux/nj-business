// =====================================================================
// NJ Caisse Pro v2 — Service Worker (PWA)
// Stratégie : Cache-first pour assets, Network-first pour API
// =====================================================================

const CACHE_NAME    = 'nj-caisse-pro-v2.4.0';
const CACHE_STATIC  = 'nj-caisse-pro-static-v9';
const CACHE_DYNAMIC = 'nj-caisse-pro-dynamic-v8';

// Assets à mettre en cache immédiatement (App Shell)
const APP_SHELL = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/app.js',
  '/js/idb.js',
  '/js/sync.js',
  '/manifest.json',
  // Chart.js depuis CDN (mis en cache au premier chargement)
];

// URLs API dont les réponses GET sont mises en cache
const CACHEABLE_API = [
  '/api/rubriques',
  '/api/config',
];

// ── INSTALL : mise en cache du shell ─────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Install');
  event.waitUntil(
    caches.open(CACHE_STATIC).then(cache => {
      return cache.addAll(APP_SHELL).catch(err => {
        console.warn('[SW] Certains assets non mis en cache :', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE : nettoyage des vieux caches ─────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_STATIC && k !== CACHE_DYNAMIC)
          .map(k => {
            console.log('[SW] Suppression ancien cache :', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH : interception des requêtes ────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ignorer les requêtes non-HTTP
  if (!url.protocol.startsWith('http')) return;

  // ── Requêtes API ──────────────────────────────────────────────────
  if (url.pathname.startsWith('/api/')) {
    // GET : Network-first avec fallback cache
    if (event.request.method === 'GET') {
      event.respondWith(networkFirstApi(event.request));
    }
    // Mutations (POST/PUT/DELETE/PATCH) : on laisse passer
    // La gestion offline est faite côté app (sync.js)
    return;
  }

  // ── Assets statiques : Cache-first ────────────────────────────────
  event.respondWith(cacheFirstStatic(event.request));
});

// ── Stratégie Network-First pour les GET API ─────────────────────────
const networkFirstApi = async (request) => {
  const url = new URL(request.url);
  const isCacheable = CACHEABLE_API.some(p => url.pathname.startsWith(p));

  try {
    const networkResponse = await fetch(request.clone());
    // Mettre en cache si succès et URL cacheable
    if (networkResponse.ok && isCacheable) {
      const cache = await caches.open(CACHE_DYNAMIC);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    // Réseau indisponible → fallback cache
    if (isCacheable) {
      const cached = await caches.match(request);
      if (cached) {
        console.log('[SW] Offline fallback cache :', url.pathname);
        return cached;
      }
    }
    // Réponse offline générique pour les API non cachées
    return new Response(
      JSON.stringify({ error: 'Hors ligne. Données non disponibles.', offline: true }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// ── Stratégie Cache-First pour les assets statiques ──────────────────
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
    // Fallback pour la navigation (SPA)
    if (request.destination === 'document') {
      const indexCached = await caches.match('/index.html');
      if (indexCached) return indexCached;
    }
    return new Response('Hors ligne', { status: 503 });
  }
};

// ── Message : forcer la mise à jour du cache ──────────────────────────
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data === 'CLEAR_CACHE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  }
});
