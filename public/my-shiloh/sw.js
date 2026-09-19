'use strict';

const SHELL_CACHE = 'my-shiloh-shell-v4';
const STATIC_CACHE = 'my-shiloh-static-v4';
const SHELL = [
  '/my-shiloh/offline.html',
  '/my-shiloh/manifest.webmanifest',
  '/my-shiloh/assets/app.css',
  '/my-shiloh/assets/app.js',
  '/my-shiloh/assets/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
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
