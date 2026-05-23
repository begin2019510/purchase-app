// Service Worker - 离线缓存 + 推送通知
const CACHE = 'purchase-cache-v17';
const ASSETS = ['/', '/index.html', '/style.css', '/app.js', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    ))
  );
});

self.addEventListener('fetch', e => {
  // 跳过 API 请求和非 GET 请求
  if (e.request.url.includes('/api/') || e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
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
      // 如果已打开则聚焦
      for (const client of clientList) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      // 否则打开新窗口
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
