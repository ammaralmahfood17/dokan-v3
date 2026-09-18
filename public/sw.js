// Dokan Service Worker — Precache build assets + RSC caching + Push + Offline-first
// M6: single source of truth for cache versioning — bump CACHE_VERSION on every
// SW change so old caches are evicted by activate() (matched by prefix).
const CACHE_VERSION = 'v7';
const CACHE_SHELL = `dokan-shell-${CACHE_VERSION}`;
const CACHE_IMAGES = `dokan-images-${CACHE_VERSION}`;
const CACHE_STATIC = `dokan-static-${CACHE_VERSION}`;
const CACHE_PAGES = `dokan-pages-${CACHE_VERSION}`;

// M6: cap on the runtime caches (images/pages grow unbounded on iOS's stricter
// storage quota). LRU-ish: evict oldest entries past the cap.
const MAX_CACHE_ENTRIES = 120;

const SHELL_ASSETS = [
  '/',
  '/offline.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
];

/* ========== INSTALL ========== */
self.addEventListener('install', (event) => {
  // M6: take over as soon as the new SW is installed instead of waiting for
  // all tabs to close. The app-side (service-worker-register.tsx) prompts the
  // user to reload — we never reload pages ourselves.
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      // 1. Cache the static shell
      try {
        const cache = await caches.open(CACHE_SHELL);
        await cache.addAll(SHELL_ASSETS);
      } catch (e) {}

      // 2. Precache Next.js build assets discovered from the home page HTML.
      //    This makes the app fully offline after the first visit (no dep on serwist).
      try {
        const res = await fetch('/');
        const html = await res.text();
        const assetUrls = [
          ...html.matchAll(/\/_next\/static\/[^"']+\.(?:js|css)/g),
        ].map((m) => m[0]);
        const unique = [...new Set(assetUrls)];
        if (unique.length) {
          const staticCache = await caches.open(CACHE_STATIC);
          await Promise.allSettled(
            unique.map((u) =>
              fetch(u).then((r) => {
                if (r.ok) staticCache.put(u, r);
              })
            )
          );
        }
      } catch (e) {}
    })()
  );
});

/* ========== ACTIVATE ========== */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((k) => {
          // M6: evict anything not under the current versioned prefixes.
          if (
            k === CACHE_SHELL ||
            k === CACHE_IMAGES ||
            k === CACHE_STATIC ||
            k === CACHE_PAGES
          ) return;
          return caches.delete(k);
        })
      )
    )
  );
  self.clients.claim();
});

/* ========== PUSH NOTIFICATIONS ========== */
self.addEventListener('push', (event) => {
  const data = event.data?.json();
  if (!data) return;

  const { title, body, url, tag } = data;

  const options = {
    body: body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [200, 100, 200],
    tag: tag || 'dokan-order',
    renotify: true,
    data: { url: url || '/' },
    silent: false,
  };

  event.waitUntil(
    self.registration.showNotification(title || 'دكان', options)
  );
});

/* Open the app when user clicks the notification */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || '/dashboard/kitchen';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (let i = 0; i < clients.length; i++) {
        const client = clients[i];
        if (client.url.indexOf(self.location.host) !== -1 && 'focus' in client) {
          client.focus();
          client.navigate(urlToOpen);
          return;
        }
      }
      return self.clients.openWindow(urlToOpen);
    })
  );
});

/* ========== MESSAGE HANDLER ========== */
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* ========== FETCH — CACHING STRATEGIES ========== */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Skip non-GET and Supabase requests
  if (event.request.method !== 'GET' || url.hostname.includes('supabase')) {
    return;
  }

  // API routes: network-first (fresh data), fall back to cache if available
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(event.request, CACHE_PAGES));
    return;
  }

  // 2. Image caching (icons, storage images, etc.)
  if (url.pathname.match(/\.(png|jpg|jpeg|gif|svg|webp|avif|ico)(\?.*)?$/i)) {
    event.respondWith(cacheFirst(event.request, CACHE_IMAGES));
    return;
  }

  // 3. Next.js static chunks (_next/static/) — cache-first, never stale
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(event.request, CACHE_STATIC));
    return;
  }

  // 4. RSC payloads (?_rsc=...) — network-first so client navigations work offline
  if (url.searchParams.has('_rsc')) {
    event.respondWith(networkFirst(event.request, CACHE_PAGES));
    return;
  }

  // 5. Navigation requests — network first with offline fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request, CACHE_SHELL));
    return;
  }

  // 6. Everything else — stale-while-revalidate
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_SHELL).then((cache) => {
            cache.put(event.request, clone);
            trimCache(cache, MAX_CACHE_ENTRIES);
          });
        }
        return response;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

/** M6: LRU-ish trim — keep the most recent MAX_CACHE_ENTRIES in a cache. */
async function trimCache(cache, maxEntries) {
  try {
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    // keys() returns insertion order; delete the oldest first.
    const excess = keys.length - maxEntries;
    await Promise.all(
      keys.slice(0, excess).map((k) => cache.delete(k))
    );
  } catch (e) {}
}

/** Cache-first: serve from cache, fall back to network, store response */
function cacheFirst(request, cacheName) {
  return caches.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request).then((response) => {
      if (response.ok && response.type === 'basic') {
        const clone = response.clone();
        caches.open(cacheName).then((cache) => {
          cache.put(request, clone);
          trimCache(cache, MAX_CACHE_ENTRIES);
        });
      }
      return response;
    }).catch(() => {
      if (cacheName === CACHE_IMAGES) {
        return new Response('', { status: 200, headers: { 'Content-Type': 'image/png' } });
      }
      return caches.match('/offline.html');
    });
  });
}

/** Network-first: try network, fall back to cache, then offline page */
function networkFirst(request, cacheName) {
  return fetch(request).then((response) => {
    if (response.ok && response.type === 'basic') {
      const clone = response.clone();
      caches.open(cacheName).then((cache) => {
        cache.put(request, clone);
        trimCache(cache, MAX_CACHE_ENTRIES);
      });
    }
    return response;
  }).catch(() => {
    return caches.match(request).then((cached) => {
      if (cached) return cached;
      return caches.match('/offline.html');
    });
  });
}

/* ==========================================================================
   FIX-W-002: Background Sync — orders submitted while offline are queued
   in IndexedDB and retried when connectivity returns (Chromium only —
   Safari/Firefox lack the API; the client-side retry button covers them).
   ========================================================================== */
const PENDING_DB = 'dokan-pending-orders';
const PENDING_STORE = 'orders';

function openPendingDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PENDING_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(PENDING_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function submitPendingOrders() {
  const db = await openPendingDb();
  const tx = db.transaction(PENDING_STORE, 'readwrite');
  const store = tx.objectStore(PENDING_STORE);
  const all = await new Promise((resolve) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
  });

  for (const order of all) {
    try {
      const res = await fetch('/api/public/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order.payload),
      });
      if (res.ok) {
        store.delete(order.id);
      } else {
        // Permanent failure (4xx) — drop it; the customer saw the error
        if (res.status >= 400 && res.status < 500) store.delete(order.id);
      }
    } catch {
      // still offline — leave in queue, sync will retry
    }
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'submit-pending-order') {
    event.waitUntil(submitPendingOrders());
  }
});
