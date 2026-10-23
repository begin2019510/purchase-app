// Service Worker - auto-update + push notifications
var CACHE = 'purchase-cache-v114';
var STATIC_ASSETS = ['/manifest.json', '/icon-180.png', '/icon-192.png', '/icon-512.png', '/help', '/js/particles.js'];

self.addEventListener('install', function(e) {
  e.waitUntil(caches.open(CACHE).then(function(c) { return c.addAll(STATIC_ASSETS); }));
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      // 只清理其它版本的缓存，保留当前 CACHE 命名空间
      return Promise.all(keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); }));
    }).then(function() { return clients.claim(); })
    // 静默接管：不强制刷新当前页面，新内容下次打开生效（避免黑屏重载）
  );
});

self.addEventListener('fetch', function(e) {
  if (e.request.url.includes('/api/') || e.request.method !== 'GET') return;

  // 页面导航：网络优先（2.5s 超时回退缓存）——保证每次打开都能拿到最新界面；
  // JS/CSS 用版本号 URL，随新 HTML 自动走网络，不会拿到旧文件。
  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.open(CACHE).then(function(c) {
        var net = fetch(e.request, { cache: 'no-store' }).then(function(res) {
          if (res.ok) { try { c.put(e.request, res.clone()); } catch (x) {} }
          return res;
        });
        var timeout = new Promise(function(resolve) {
          setTimeout(function() { resolve(null); }, 2500);
        });
        return Promise.race([net, timeout]).then(function(r) {
          return r || c.match(e.request) || c.match('/') || net;
        }).catch(function() {
          return c.match(e.request) || c.match('/');
        });
      })
    );
    return;
  }

  // 静态资源（带版本号 URL）：缓存优先 + 后台刷新（SWR）
  e.respondWith(
    caches.open(CACHE).then(function(c) {
      return c.match(e.request).then(function(cached) {
        var network = fetch(e.request, { cache: 'no-store' }).then(function(res) {
          if (res.ok) { try { c.put(e.request, res.clone()); } catch (x) {} }
          return res;
        }).catch(function() { return cached; });
        return cached || network;
      });
    })
  );
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