// sw.js - cozyfiles service worker (conservative, offline-capable).
//
// Strategy:
//   - navigations  -> network-first, fall back to cached index.html so the
//     desktop still boots offline and the user is never trapped on stale HTML.
//   - same-origin static GETs -> cache-first with a background network fallback
//     (and the response is cached on the way through for next time).
//   - everything else (cross-origin: fonts, spotify, microlink, guestbook) is
//     left to the network untouched.
//
// All precache URLs are RELATIVE because the site is served from a project
// subpath (optimummeans.github.io/cozyfiles/). A leading "/" would resolve to
// the GitHub Pages domain root and 404. The SW scope is its own directory.

const CACHE = 'cozyfiles-v1';

// Core app shell: the document, every stylesheet linked in index.html, every
// JS module reachable from main.js, and the key static assets the desktop
// needs to render offline. Resolved relative to the SW location.
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',

  // styles (mirrors the <link> order in index.html)
  './css/tokens.css',
  './css/reset.css',
  './css/gate.css',
  './css/desktop.css',
  './css/window.css',
  './css/apps.css',
  './css/apps/files.css',
  './css/apps/about.css',
  './css/apps/contact.css',
  './css/apps/paint.css',
  './css/apps/settings.css',
  './css/apps/plugin.css',
  './css/apps/deck.css',
  './css/apps/studio-session.css',
  './css/apps/terminal.css',
  './css/apps/guestbook.css',
  './css/apps/notepad.css',
  './css/apps/recycle.css',

  // core JS modules
  './js/main.js',
  './js/gate.js',
  './js/desktop.js',
  './js/window-manager.js',
  './js/daw-components.js',
  './js/album-art.js',
  './js/spotify-meta.js',
  './js/manifesto.js',

  // app modules (self-register on import)
  './js/apps/files.js',
  './js/apps/about.js',
  './js/apps/contact.js',
  './js/apps/paint.js',
  './js/apps/settings.js',
  './js/apps/deck.js',
  './js/apps/studio-session.js',
  './js/apps/daw-engine.js',
  './js/apps/plugin-ui.js',
  './js/apps/eggs/terminal.js',
  './js/apps/eggs/guestbook.js',
  './js/apps/eggs/notepad.js',
  './js/apps/eggs/recycle.js',
  './js/apps/eggs/secrets.js',
  './js/apps/eggs/konami.js',

  // key assets + data
  './assets/icons/favicon.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/gate-logo.webp',
  './assets/logo-main.png',
  './assets/glyph-mask.png',
  './assets/wallpaper/cubes.svg',
  './assets/wallpaper/session-grid.svg',
  './data/portfolio.json',
];

// Install: precache the shell. addAll is atomic (any 404 fails the install),
// so cache items individually to stay resilient if one asset is missing.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(
      PRECACHE_URLS.map((url) =>
        cache.add(new Request(url, { cache: 'reload' })).catch(() => {
          // A single missing asset must not break the whole install.
        })
      )
    );
    await self.skipWaiting();
  })());
});

// Activate: drop caches from previous versions, then take control now.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// Put a fresh response in the cache without blocking the response we return.
function cachePut(request, response) {
  if (response && response.ok && response.type === 'basic') {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET. Leave POST/PUT (guestbook, etc.) to the network.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cross-origin (fonts, spotify, microlink, scdn, opendaw): do not touch.
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first so HTML updates propagate; fall back to the
  // cached shell offline so the desktop still boots.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        return cachePut(request, fresh);
      } catch {
        const cache = await caches.open(CACHE);
        return (
          (await cache.match(request)) ||
          (await cache.match('./index.html')) ||
          (await cache.match('./')) ||
          Response.error()
        );
      }
    })());
    return;
  }

  // Other same-origin static GETs: cache-first, network fallback (and cache it).
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const fresh = await fetch(request);
      return cachePut(request, fresh);
    } catch {
      return Response.error();
    }
  })());
});
