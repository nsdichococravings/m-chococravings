// NSDI ChocoCravings — Service Worker
const CACHE_NAME = 'chococravings-v51-network';
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
      networkFirst(event).then(function(response) {
        return response || caches.match(OFFLINE_URL);
      })
    );
    return;
  }

  // JS and CSS — network first too. These are your patch files, core
  // scripts, and stylesheets, which change often during active
  // development. Serving a stale cached copy silently (with no error)
  // is exactly what caused updates to not show up. The cached copy is
  // used only when the network fails or is very slow (see networkFirst).
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    event.respondWith(networkFirst(event));
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

// Network first, but don't wait forever. On a weak connection a request can
// hang for a long time before failing, which left the app on a blank screen.
// After NETWORK_WAIT_MS the saved copy is shown if there is one; the network
// request keeps going and refreshes the saved copy for next time. With no
// saved copy, it simply keeps waiting for the network.
var NETWORK_WAIT_MS = 4000;

function networkFirst(event) {
  var request = event.request;
  var network = fetch(request).then(function(response) {
    if (response.ok) {
      var clone = response.clone();
      caches.open(CACHE_NAME).then(function(cache) { return cache.put(request, clone); });
    }
    return response;
  });
  // Keep the worker alive until the background refresh finishes.
  event.waitUntil(network.catch(function() {}));

  return new Promise(function(resolve) {
    var done = false;
    function finish(response) { if (!done) { done = true; resolve(response); } }
    var timer = setTimeout(function() {
      caches.match(request).then(function(cached) { if (cached) finish(cached); });
    }, NETWORK_WAIT_MS);
    network.then(function(response) {
      clearTimeout(timer);
      finish(response);
    }, function() {
      clearTimeout(timer);
      caches.match(request).then(finish);
    });
  });
}

// ── PUSH NOTIFICATIONS ──
// Sent by the send-push Edge Function (order status updates, admin offers).
self.addEventListener('push', function(event) {
  if (!event.data) return;
  var data = {};
  try { data = event.data.json(); } catch (e) { data = { body: event.data.text() }; }
  event.waitUntil(
    self.registration.showNotification(data.title || 'ChocoCravings 🍫', {
      body:     data.body    || 'You have a new update!',
      icon:     '/icons/maskable_icon_x72.png',
      badge:    '/icons/maskable_icon_x48.png',
      vibrate:  [200, 100, 200],
      tag:      data.tag || undefined,
      renotify: !!data.tag,
      data:     { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      for (var i = 0; i < list.length; i++) {
        if (new URL(list[i].url).origin === self.location.origin && 'navigate' in list[i]) {
          return list[i].focus().then(function(c) { return c.navigate(url); });
        }
      }
      return clients.openWindow(url);
    })
  );
});
