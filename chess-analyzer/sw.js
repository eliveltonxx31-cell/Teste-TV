// Service Worker: guarda o app (incluindo o Stockfish WASM) para uso offline.
// Ao publicar uma versão nova, altere CACHE_VERSION para invalidar o cache antigo.

const CACHE_VERSION = 'chess-analyzer-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/analysis-core.js',
  './js/board.js',
  './js/engine.js',
  './js/game.js',
  './js/metrics.js',
  './js/palette.js',
  './js/profiles.js',
  './js/storage.js',
  './js/uci.js',
  './vendor/chess.js/chess.js',
  './vendor/stockfish/stockfish-19-lite-single.js',
  './vendor/stockfish/stockfish-19-lite-single.wasm',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './LICENSES.md',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Cache primeiro (o app é estático e versionado); rede como reserva.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()));
    }),
  );
});
