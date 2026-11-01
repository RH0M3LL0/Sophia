/* Service worker: the app opens instantly and works offline.
   - The page shell is served from cache first, then refreshed in the background,
     so a slow or dropped connection can never blank or reload the site.
   - Bump VERSION when you add files to PRECACHE. */
const VERSION = 'v8';
const STATIC_CACHE = `edu-static-${VERSION}`;
const IMAGE_CACHE = `edu-images-${VERSION}`;
const CDN_CACHE = `edu-cdn-${VERSION}`;

// index.html contains all CSS + JS, so these few files are the whole app
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './images/students.png',
  './images/about-page.jpg',
  './images/icon-192.png',
  './images/icon-512.png',
  './images/about-section-bg.png',
  './images/arts-and-crafts.png',
  './images/chemistry.png',
  './images/tech.png',
  './images/geography.png'
];

// Stylesheets from CDNs (icons + fonts); the font files they use are cached on first use
const PRECACHE_CDN = [
  'https://unpkg.com/boxicons@2.1.4/css/boxicons.min.css',
  'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap'
];

// Live data must never come from cache
const NETWORK_ONLY = ['supabase.co', 'opentdb.com'];

const OFFLINE_HTML = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Offline</title><body style="font-family:sans-serif;text-align:center;padding:15vh 20px">' +
  '<h2>You are offline</h2><p>Reconnect once to finish loading the app. After that it works offline.</p>';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const [shell, cdn] = await Promise.all([caches.open(STATIC_CACHE), caches.open(CDN_CACHE)]);
    // one missing file must not break the whole install
    await Promise.all([
      ...PRECACHE.map((u) => shell.add(u).catch(() => null)),
      ...PRECACHE_CDN.map((u) => cdn.add(u).catch(() => null))
    ]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  const keep = [STATIC_CACHE, IMAGE_CACHE, CDN_CACHE];
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (NETWORK_ONLY.some((h) => url.hostname.endsWith(h))) return;

  if (req.mode === 'navigate') return event.respondWith(handleNavigation(event));
  if (req.destination === 'image') return event.respondWith(cacheFirst(req, IMAGE_CACHE, 60));
  if (url.origin !== location.origin) return event.respondWith(cacheFirst(req, CDN_CACHE, 60));
  event.respondWith(staleWhileRevalidate(req));
});

/* Single-page app: every URL is index.html. Serve the cached copy immediately
   (no waiting on a bad network) and refresh it in the background. */
async function handleNavigation(event) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = (await cache.match('./index.html')) || (await cache.match('./'));

  const update = fetchWithTimeout(event.request, 8000)
    .then((res) => {
      if (res && res.ok && !res.redirected) cache.put('./index.html', res.clone());
      return res;
    })
    .catch(() => null);

  if (cached) { event.waitUntil(update); return cached; }
  return (await update) || new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html' } });
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(req);
  const network = fetchWithTimeout(req, 8000)
    .then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; })
    .catch(() => null);
  return cached || (await network) || Response.error();
}

async function cacheFirst(req, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetchWithTimeout(req, 15000);
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(req, res.clone());
      trim(cache, maxEntries);
    }
    return res;
  } catch (err) {
    return Response.error();
  }
}

function fetchWithTimeout(req, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  return fetch(req, { signal: ctl.signal }).finally(() => clearTimeout(timer));
}

async function trim(cache, max) {
  const keys = await cache.keys();
  if (keys.length > max) {
    await cache.delete(keys[0]);
    trim(cache, max);
  }
}

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
