/* =========================================================
   sw.js — サービスワーカー
   ・初回アクセス後は オフラインでも あそべる
   ・更新は「ネット優先→だめならキャッシュ」で 反映する
   ========================================================= */
const CACHE = 'gelpiyo-park-v5';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/util.js',
  './js/data.js',
  './js/piyodata.js',
  './js/piyo.js',
  './js/hex.js',
  './js/state.js',
  './js/ui.js',
  './js/parkscene.js',
  './js/park.js',
  './js/squad.js',
  './js/gacha.js',
  './js/battle.js',
  './js/worldmap.js',
  './js/main.js',
  './assets/icon.svg',
  './assets/icon-maskable.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
