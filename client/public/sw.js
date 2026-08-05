/* Service Worker：Web Push 来单通知（最稳定通知层） */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let body = '新订单';
  try {
    body = event.data ? event.data.text() : body;
  } catch {
    /* ignore */
  }
  event.waitUntil(
    self.registration.showNotification('AI文创 · 新订单', {
      body,
      tag: 'new-order',
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      for (const c of cs) {
        if ('focus' in c) return c.focus();
      }
      return self.clients.openWindow('/#/staff');
    })
  );
});
