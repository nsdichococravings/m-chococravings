// NSDI ChocoCravings — Service Worker
const CACHE_NAME = 'chococravings-v2';
const OFFLINE_URL = '/offline.html';

// Files to cache immediately on install
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/auth.html',
  '/offline.html',
  '/manifest.json',
  '/icons/maskable_icon_x48.png',
  '/icons/maskable_icon_x72.png',
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400;1,600&family=DM+Sans:wght@300;400;500;600;700&family=Bebas+Neue&display=swap',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// ── INSTALL: cache core files ──
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(PRECACHE_URLS.filter(url => !url.startsWith('https://')));
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// ── ACTIVATE: clean old caches ──
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ── FETCH: network first, cache fallback ──
self.addEventListener('fetch', function(event) {
  const url = new URL(event.request.url);

  // Skip Supabase API calls — always go to network
  if (url.hostname.includes('supabase.co')) return;

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  var acceptHeader = event.request.headers.get('accept') || '';

  // HTML pages — network first, fallback to cache, then offline page
  if (acceptHeader.includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then(function(response) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(function() {
          return caches.match(event.request)
            .then(cached => cached || caches.match(OFFLINE_URL));
        })
    );
    return;
  }

  // JS and CSS — network first too. These are your patch files, core
  // scripts, and stylesheets, which change often during active
  // development. Serving a stale cached copy silently (with no error)
  // is exactly what caused updates to not show up. Cache is only used
  // as an offline fallback, never preferred over a fresh network copy.
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    event.respondWith(
      fetch(event.request)
        .then(function(response) {
          if (response.ok) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(function() {
          return caches.match(event.request);
        })
    );
    return;
  }

  // Everything else (fonts, images) — cache first is fine, these rarely
  // change and cache-first keeps the app fast and usable offline.
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) return cached;
      return fetch(event.request).then(function(response) {
        if (response.ok) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

// ── PUSH NOTIFICATIONS (future use) ──
self.addEventListener('push', function(event) {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'ChocoCravings 🍫', {
      body:    data.body    || 'You have a new update!',
      icon:    '/icons/maskable_icon_x72.png',
      badge:   '/icons/maskable_icon_x48.png',
      vibrate: [200, 100, 200],
      data:    { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url || '/')
  );
});
