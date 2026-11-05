/* Service worker: works offline, but always tries the network first so GitHub updates show up quickly. */
const VER = 'v1';
const CACHE = 'discount-scan-' + VER;
const SHELL = ['./', 'index.html', 'css/style.css', 'js/app.js', 'js/parse.js', 'libs/zxing.min.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'data/stock.json', 'data/discounts.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => { })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const isLib = req.url.includes('/libs/');
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (isLib) { const hit = await cache.match(req); if (hit) return hit; }
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('index.html') : null);
      if (hit) return hit; throw err;
    }
  })());
});
