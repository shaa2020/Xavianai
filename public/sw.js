// Simple service worker for PWA installation
const CACHE_NAME = 'xavian-care-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Basic core assets to cache
      return cache.addAll(['/', '/index.html']);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      // Return cached version or fetch from network
      return response || fetch(event.request).catch(() => {
        // Fallback for offline if network completely fails
        return caches.match('/');
      });
    })
  );
});
