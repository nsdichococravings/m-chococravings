// NSDI ChocoCravings — Service Worker
const CACHE_NAME = 'chococravings-v1';
const OFFLINE_URL = '/offline.html';

// Files to cache immediately on install
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/auth.html',
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
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

  // ── CRITICAL: Never intercept reset-password page ──
  // Supabase recovery tokens in the URL hash must be handled
  // natively by the browser — SW interception causes auto-login redirect
  if (url.pathname.includes('reset-password')) return;

  // For HTML pages — network first, fallback to cache, then offline page
  if (event.request.headers.get('accept').includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then(function(response) {
          // Cache the fresh response
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

  // For other assets (CSS, JS, fonts, images) — cache first, network fallback
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
      icon:    '/icons/icon-192.png',
      badge:   '/icons/icon-96.png',
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
