// Offline support. Pages are fetched network-first (a fresh deploy wins), everything else
// same-origin is served from the cache and refreshed in the background. Hashed build assets
// never change, so a stale copy is always right for them.
const CACHE = 'pixprite-v1';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './manifest.webmanifest', './favicon.svg'])));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req)
      .then(res => { put(new Request('./'), res.clone()); return res; })
      .catch(() => caches.match('./')));
    return;
  }

  e.respondWith(caches.match(req).then(hit => {
    const fresh = fetch(req).then(res => { if (res.ok) put(req, res.clone()); return res; });
    if (hit) { fresh.catch(() => {}); return hit; }
    return fresh;
  }));
});

function put(req, res) {
  void caches.open(CACHE).then(c => c.put(req, res));
}
