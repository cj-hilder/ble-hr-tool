const CACHE_NAME = 'hr-pacer-v1.2.18';
const ASSETS = [
    './',
    './index.html',
    './app.js',
    './style.css',
    './settings.js',
    './manifest.json',
    './icon.png',
    './about.html',
    './README.md',
    './LICENSE',
];

// Install: pre-cache all static assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

// Activate: delete old caches from previous versions
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch: cache-first, fall back to network
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(cached => cached || fetch(event.request))
    );
});

  
