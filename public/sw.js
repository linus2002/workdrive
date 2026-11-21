/* Bishnoi One WorkDrive service worker (hand-written, no build step).
 *
 * - Navigations: network first; offline falls back to the cached app shell (index.html), so every route works.
 * - Install: precaches index.html, the icons and every JS/CSS chunk listed in /.vite/manifest.json.
 * - /assets/*: cache first (Vite gives them content-hashed names, so a cached copy never goes stale).
 * - Google Fonts: stale-while-revalidate.
 * The version comes from the registration URL (?v=<hash of the app's entry script>), so a new deploy installs
 * a new worker with fresh caches; old caches are removed on activate.
 */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const PREFIX = 'workdrive-';
const SHELL = `${PREFIX}shell-${VERSION}`;
const ASSETS = `${PREFIX}assets-${VERSION}`;
const FONTS = `${PREFIX}fonts`;
const MATCH = { ignoreVary: true }; // servers send `Vary: Origin`; module scripts are requested with an Origin header
const SHELL_URLS = ['/', '/manifest.webmanifest', '/logo.png', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

/** The asset URLs index.html references directly (entry script, CSS, preloaded chunks). */
async function shellAssets(html) {
  const urls = new Set();
  for (const m of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) urls.add(m[1]);
  return [...urls];
}

/** All JS/CSS files listed in Vite's build manifest (`build.manifest: true` writes /.vite/manifest.json). */
async function manifestAssets() {
  try {
    const res = await fetch('/.vite/manifest.json', { cache: 'no-cache' });
    if (!res.ok) return [];
    const urls = new Set();
    for (const chunk of Object.values(await res.json())) {
      if (chunk.file && /\.(js|css)$/.test(chunk.file)) urls.add(`/${chunk.file}`);
      for (const css of chunk.css || []) urls.add(`/${css}`);
    }
    return [...urls];
  } catch {
    return []; // no manifest (or not served): chunks are still cached as they're first used
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    const res = await fetch('/index.html', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`index.html: ${res.status}`);
    const html = await res.clone().text();
    await shell.put('/index.html', res);
    await Promise.all(SHELL_URLS.map((u) => shell.add(new Request(u, { cache: 'no-cache' })).catch(() => {})));
    const assets = await caches.open(ASSETS);
    await assets.addAll(await shellAssets(html));
    // Every other JS/CSS chunk from Vite's build manifest, so screens never opened in this build still work offline.
    const all = await manifestAssets();
    await Promise.all(all.map((u) => assets.match(u, MATCH).then((hit) => hit || assets.add(new Request(u, { cache: 'no-cache' }))).catch(() => {})));
  })());
  // No skipWaiting here: the page decides (it asks the user, or activates silently on a fresh load).
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, ASSETS, FONTS]);
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith(PREFIX) && !keep.has(n)).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'SKIP_WAITING') self.skipWaiting();
  if (msg.type === 'CACHE_URLS' && Array.isArray(msg.urls)) {
    // Chunks the page already loaded before this worker controlled it (lazy routes, vendor chunks).
    event.waitUntil(caches.open(ASSETS).then((c) => Promise.all(msg.urls
      .filter((u) => { try { const x = new URL(u, self.location.origin); return x.origin === self.location.origin && x.pathname.startsWith('/assets/'); } catch { return false; } })
      .map((u) => c.match(u, MATCH).then((hit) => hit || c.add(u)).catch(() => {})))));
  }
});

async function networkFirstPage(request) {
  const shell = await caches.open(SHELL);
  try {
    const res = await fetch(request);
    // Every route serves the same index.html; keep the latest copy for offline use.
    if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) shell.put('/index.html', res.clone());
    return res;
  } catch {
    return (await shell.match('/index.html', MATCH)) || (await shell.match('/', MATCH)) || Response.error();
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, MATCH);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, MATCH);
  const net = fetch(request).then((res) => { if (res.ok || res.type === 'opaque') cache.put(request, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate') { event.respondWith(networkFirstPage(request)); return; }
    if (url.pathname.startsWith('/assets/')) { event.respondWith(cacheFirst(request, ASSETS)); return; }
    if (SHELL_URLS.includes(url.pathname)) {
      event.respondWith(caches.open(SHELL).then((c) => c.match(url.pathname, MATCH)).then((hit) => hit || fetch(request)));
    }
    return; // anything else (blob:, data, other files) goes straight to the network
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request, FONTS));
  }
});
