const CACHE_NAME = 'hr-pacer-v1.2.160';
const ASSETS = [
    '/',
    '/index.html',
    '/utils.js',
    '/app.js',
    '/style.css',
    '/settings.js',
    '/summary.js',
    '/summary.css',
    '/history.html',
    '/history.js',
    '/history.css',
    '/manifest.json',
    '/icon.png',
    '/quick_start_guide.html',
    '/battery_settings_guide. html',
    '/about.html',
    '/marked.min.js',
    '/README.md',
];

// Install: pre-cache assets, but don't crash if one fails
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(ASSETS).catch(err => console.warn('Partial cache install:', err));
        })
    );
    self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch: NETWORK FIRST, fallback to cache
self.addEventListener('fetch', event => {
    // Skip cross-origin (like Google Fonts or CDNs) and non-GET requests
    if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then(networkResponse => {
                // If network succeeds, save a copy to the cache for later offline use
                const responseClone = networkResponse.clone();
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, responseClone);
                });
                return networkResponse;
            })
            .catch(() => {
                // If network fails (offline), return the cached version
                return caches.match(event.request).then(cachedResponse => {
                    if (cachedResponse) {
                        return cachedResponse;
                    }
                    // Last resort: if they are offline and navigating to a missing page, show the home screen
                    if (event.request.mode === 'navigate') {
                        return caches.match('/');
                    }
                });
            })
    );
});