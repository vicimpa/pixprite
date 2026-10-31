// Build-pinned, integrity-checked snapshot. No runtime cache can mix releases.
const RELEASE = 'b59e3930f3e97ac06e85463a70e021a4ec246a42ab489c68149b31cca92d64e7';
const PREFIX = 'pixprite:' + self.registration.scope + ':';
const CACHE = PREFIX + RELEASE;
const scope = self.registration.scope;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const response = await fetch(new URL('precache-' + RELEASE + '.json', scope), {
        cache: 'no-store', integrity: 'sha256-1rF2bg9nKOrx/WuvG59Vs1106q7bioptfKEufsYY1yo=',
      });
      if (!response.ok) throw new Error('Precache manifest unavailable');
      const files = await response.json();
      const cache = await caches.open(CACHE);
      // Sequential writes keep memory bounded; failure rolls back this snapshot only.
      for (const [path, integrity] of files) {
        const request = new Request(new URL(path, scope), { cache: 'reload', integrity });
        const asset = await fetch(request);
        if (!asset.ok || asset.redirected) throw new Error('Precache asset unavailable: ' + path);
        await cache.put(request, asset);
      }
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
  })());
  // Natural activation: every old controlled tab must close before this release takes over.
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys())
      if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    // Do not claim an uncontrolled first-load page: its HTML may be from another deployment.
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || !url.href.startsWith(scope)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Pin navigations to this release, even when the origin has already deployed new HTML.
    const hit = await cache.match(request.mode === 'navigate' ? new URL('index.html', scope) : request);
    return hit || fetch(request);
  })());
});
