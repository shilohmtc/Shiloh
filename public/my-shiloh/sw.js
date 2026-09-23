'use strict';

const ASSET_VERSION = '20260923-native-booking-v1';
const SHELL_CACHE = 'my-shiloh-shell-v21';
const STATIC_CACHE = 'my-shiloh-static-v21';
const SHELL = [
  '/my-shiloh/offline.html',
  '/my-shiloh/manifest.webmanifest',
  `/my-shiloh/assets/app.css?v=${ASSET_VERSION}`,
  `/my-shiloh/assets/app.js?v=${ASSET_VERSION}`,
  '/my-shiloh/assets/icon-192.png',
  '/my-shiloh/assets/icon-512.png',
  '/my-shiloh/assets/icon-maskable-512.png',
  '/my-shiloh/assets/apple-touch-icon-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL)),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== STATIC_CACHE)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

async function pendingNotifications() {
  const subscription = await self.registration.pushManager.getSubscription();
  if (!subscription?.endpoint) return [];
  const response = await fetch('/my-shiloh/api/push/pending', {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  if (!response.ok) return [];
  const data = await response.json().catch(() => ({}));
  return Array.isArray(data.notifications) ? data.notifications : [];
}

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let notifications = [];
    try { notifications = await pendingNotifications(); } catch (_) {}
    if (!notifications.length) {
      await self.registration.showNotification('My Shiloh', {
        body: 'There’s a new update for you in My Shiloh.',
        icon: '/my-shiloh/assets/icon-192.png',
        badge: '/my-shiloh/assets/icon-192.png',
        tag: 'my-shiloh-generic-update',
        data: { url: '/my-shiloh/' },
      });
      return;
    }
    for (const notification of notifications) {
      await self.registration.showNotification(String(notification.title || 'My Shiloh'), {
        body: String(notification.body || ''),
        icon: '/my-shiloh/assets/icon-192.png',
        badge: '/my-shiloh/assets/icon-192.png',
        tag: `my-shiloh-${notification.id}`,
        data: { url: String(notification.targetPath || '/my-shiloh/') },
      });
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = String(event.notification.data?.url || '/my-shiloh/');
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => {
      try { return new URL(client.url).origin === self.location.origin; } catch (_) { return false; }
    });
    if (existing) {
      if (typeof existing.navigate === 'function') await existing.navigate(target);
      await existing.focus();
      return;
    }
    await self.clients.openWindow(target);
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith('/my-shiloh/')) return;

  // Authentication and personal client APIs are always network-only. This
  // service worker never persists session, appointment, form, payment or profile responses.
  if (url.pathname.startsWith('/my-shiloh/auth/')
      || url.pathname.startsWith('/my-shiloh/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/my-shiloh/offline.html')),
    );
    return;
  }

  if (url.pathname === '/my-shiloh/assets/app.css'
      || url.pathname === '/my-shiloh/assets/app.js'
      || url.pathname === '/my-shiloh/assets/booking.js') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (!response || response.status !== 200) return response;
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  if (url.pathname.startsWith('/my-shiloh/assets/')
      || url.pathname.endsWith('/manifest.webmanifest')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (!response || response.status !== 200) return response;
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          return response;
        });
      }),
    );
  }
});
