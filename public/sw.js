/*
 * LUMIN service worker: offline app shell.
 * Same-origin GET requests are served stale-while-revalidate, so the artwork
 * opens offline after one visit. Weather API requests are never cached here;
 * the app keeps its own clearly labelled weather cache in IndexedDB.
 */
const CACHE = 'lumin-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './favicon.svg', './manifest.webmanifest'])).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached || (req.mode === 'navigate' ? cache.match('./index.html') : undefined));
      return cached || network;
    }),
  );
});
