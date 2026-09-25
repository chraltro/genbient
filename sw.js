// Offline support: serve the app shell from cache, refresh it in the background.
const CACHE = 'genbient-v19';
const SHELL = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest',
  'js/main.js', 'js/engine.js', 'js/scenes.js', 'js/theory.js', 'js/util.js', 'js/visuals.js', 'js/params.js',
  'js/composer.js', 'js/progressions.js', 'js/touch.js', 'js/conductor.js', 'js/recorder.js', 'js/recorder-worklet.js', 'js/layers/index.js', 'js/layers/base.js', 'js/layers/tonal.js',
  'js/layers/melodic.js', 'js/layers/rhythm.js', 'js/layers/nature.js', 'js/layers/mind.js',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's HTTP cache so a new version never installs old files
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The app's own files: network first (so an update shows up on the next
// open, never a mix of old and new files), cache when offline or slow.
// Fonts never change, so they come straight from the cache.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const own = url.origin === location.origin;
  const font = url.hostname.endsWith('fonts.gstatic.com') || url.hostname.endsWith('fonts.googleapis.com');
  if (!own && !font) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: own });
    if (font && hit) return hit;
    const net = fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    });
    e.waitUntil(net.catch(() => {}));
    if (!hit) return net;
    const slow = new Promise((r) => setTimeout(() => r(hit), 2500));
    return Promise.race([net.catch(() => hit), slow]);
  })());
});
