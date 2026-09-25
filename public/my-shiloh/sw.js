'use strict';

const ASSET_VERSION = '20260925-home-screen-badge-v1';
const SHELL_CACHE = 'my-shiloh-shell-v22';
const STATIC_CACHE = 'my-shiloh-static-v22';
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

const BADGE_DB_NAME = 'my-shiloh-badge-v1';
const BADGE_STORE = 'state';
const BADGE_KEY = 'unread-count';

function openBadgeDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BADGE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(BADGE_STORE)) {
        request.result.createObjectStore(BADGE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function mutateBadgeCount(delta = 0, reset = false) {
  const db = await openBadgeDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(BADGE_STORE, 'readwrite');
      const store = transaction.objectStore(BADGE_STORE);
      const request = store.get(BADGE_KEY);
      let next = 0;
      request.onsuccess = () => {
        const current = Math.max(0, Number(request.result) || 0);
        next = reset ? 0 : Math.max(0, current + Math.max(0, Number(delta) || 0));
        store.put(next, BADGE_KEY);
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve(next);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

async function applyHomeScreenBadge(count) {
  const value = Math.max(0, Number(count) || 0);
  try {
    if (value > 0 && 'setAppBadge' in self.navigator) {
      await self.navigator.setAppBadge(value);
    } else if (value === 0 && 'clearAppBadge' in self.navigator) {
      await self.navigator.clearAppBadge();
    }
  } catch (_) {}
}

async function incrementHomeScreenBadge(amount = 1) {
  try {
    const count = await mutateBadgeCount(amount, false);
    await applyHomeScreenBadge(count);
  } catch (_) {}
}

async function clearHomeScreenBadge() {
  try { await mutateBadgeCount(0, true); } catch (_) {}
  await applyHomeScreenBadge(0);
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CLEAR_APP_BADGE') event.waitUntil(clearHomeScreenBadge());
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
      await incrementHomeScreenBadge(1);
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
    await incrementHomeScreenBadge(notifications.length);
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
