const CACHE = 'purchase-tracker-v1';
const ASSETS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('/api/')) {
    // API 请求：网络优先，失败用缓存
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
  } else {
    // 静态资源：缓存优先
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request))
    );
  }
});
