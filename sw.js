// Service Worker - 离线缓存 + 推送通知
// 策略：HTML/JS 始终 network-first（自动更新），其他资源 cache-first
const CACHE = 'purchase-cache-v33';
const STATIC_ASSETS = ['/manifest.json', '/icon-192.png', '/icon-512.png', '/help'];

self.addEventListener('install', e => {
  // 只预缓存不会变的静态资源，HTML/JS 不预缓存
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    ))
  );
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', e => {
  // 跳过 API 请求和非 GET 请求
  if (e.request.url.includes('/api/') || e.request.method !== 'GET') return;

  const url = new URL(e.request.url);
  const isHTMLorJS = url.pathname === '/' || url.pathname.endsWith('.html') || url.pathname.endsWith('.js') || url.pathname.endsWith('.css');

  if (isHTMLorJS) {
    // HTML/JS/CSS: network-first（联网用最新，断网用缓存）
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
  } else {
    // 图片/字体等静态资源: cache-first
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        });
      })
    );
  }
});

// ===== 推送通知 =====
self.addEventListener('push', e => {
  let data = {};
  if (e.data) {
    try { data = e.data.json(); } catch { data = { body: e.data.text() }; }
  }

  const title = data.title || '📦 采购管家';
  const options = {
    body: data.body || '该记账了 💰',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200, 100, 200],
    tag: data.tag || 'reminder',
    requireInteraction: true,
    data: { url: data.url || '/' },
    actions: [
      { action: 'open', title: '📝 去记账' },
      { action: 'dismiss', title: '知道了' },
    ],
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';

  if (e.action === 'dismiss') return;

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

// ===== 后台同步（预留） =====
self.addEventListener('sync', e => {
  if (e.tag === 'daily-reminder') {
    e.waitUntil(
      self.registration.showNotification('📦 采购管家', {
        body: '该记账了 💰',
        icon: '/icon-192.png',
        tag: 'daily-reminder',
      })
    );
  }
});
