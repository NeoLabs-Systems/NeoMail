/* NeoMail — Service Worker (caching disabled, push notifications retained) */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e =>
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
);

/* ── Push Notifications ───────────────────────────── */
self.addEventListener('push', e => {
  let data = { title: 'NeoMail', body: 'New email received' };
  try { data = e.data.json(); } catch (_) {}
  e.waitUntil(
    self.registration.showNotification(data.title || 'NeoMail', {
      body: data.body || '',
      icon: '/icon.svg',
      badge: '/icon.svg',
      tag: 'mailneo-mail',
      renotify: true,
      data: { url: data.url || '/app' }
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/app';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes('/app'));
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});
