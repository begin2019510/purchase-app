// Service Worker - auto-update + push notifications
var CACHE = 'purchase-cache-v61';
var STATIC_ASSETS = ['/manifest.json', '/icon-192.png', '/icon-512.png', '/help'];

self.addEventListener('install', function(e) {
  e.waitUntil(caches.open(CACHE).then(function(c) { return c.addAll(STATIC_ASSETS); }));
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return true; }).map(function(k) { return caches.delete(k); }));
    }).then(function() { return clients.claim(); }).then(function() {
      return clients.matchAll({ type: 'window' }).then(function(ws) {
        ws.forEach(function(c) { c.postMessage({ type: 'SW_RELOAD' }); });
      });
    })
  );
});

self.addEventListener('fetch', function(e) {
  if (e.request.url.includes('/api/') || e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  var isHTML = url.pathname === '/' || url.pathname.endsWith('.html') || url.pathname.endsWith('.js') || url.pathname.endsWith('.css');
  if (isHTML) {
    e.respondWith(fetch(e.request, { cache: 'no-store' }));
  } else {
    e.respondWith(
      caches.match(e.request).then(function(cached) {
        if (cached) return cached;
        return fetch(e.request).then(function(res) {
          if (res.ok) { var cl = res.clone(); caches.open(CACHE).then(function(c) { c.put(e.request, cl); }); }
          return res;
        });
      })
    );
  }
});

self.addEventListener('push', function(e) {
  var data = {};
  if (e.data) { try { data = e.data.json(); } catch(ex) { data = { body: e.data.text() }; } }
  var title = data.title || '采购管家';
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || '该记账了',
    icon: '/icon-192.png', badge: '/icon-192.png',
    vibrate: [200,100,200,100,200], tag: data.tag || 'reminder',
    requireInteraction: true, data: { url: data.url || '/' },
    actions: [{ action: 'open', title: '去记账' }, { action: 'dismiss', title: '知道了' }]
  }));
});

self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  if (e.action === 'dismiss') return;
  var url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(cls) {
    for (var i = 0; i < cls.length; i++) { if (cls[i].url.includes(self.registration.scope) && 'focus' in cls[i]) return cls[i].focus(); }
    return clients.openWindow(url);
  }));
});

self.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('sync', function(e) {
  if (e.tag === 'daily-reminder') {
    e.waitUntil(self.registration.showNotification('采购管家', { body: '该记账了', icon: '/icon-192.png', tag: 'daily-reminder' }));
  }
});