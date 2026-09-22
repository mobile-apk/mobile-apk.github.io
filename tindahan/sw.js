/* Tindahan POS service worker: caches the app shell so everything works offline.
   Bump CACHE whenever you change any file so phones pick up the update. */
const CACHE = 'tindahan-v6';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png', './icons/favicon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  // Cache first, refresh in the background (stale-while-revalidate).
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const refresh = fetch(req)
        .then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => null);
      if (hit) { e.waitUntil(refresh); return hit; }
      const res = await refresh;
      if (res) return res;
      if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      return Response.error();
    })
  );
});
