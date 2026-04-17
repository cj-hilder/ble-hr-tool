const CACHE_NAME = 'hr-pacer-v1.2.139';
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
    '/about.html',
    '/README.md',
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

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    event.respondWith(
        caches.match(event.request).then(response => {
            // 1. Direct Match: If the request is in the cache as-is, return it.
            if (response) return response;

            // 2. Extension Logic: Handle the mismatch between /about and /about.html
            if (url.origin === location.origin) {
                // Case A: User asked for /about, but we only have /about.html in cache
                if (!url.pathname.endsWith('.html') && url.pathname !== '/') {
                    return caches.match(url.pathname + '.html');
                }
                
                // Case B: User asked for /about.html, but we only have /about in cache
                if (url.pathname.endsWith('.html')) {
                    const cleanPath = url.pathname.slice(0, -5); // Strips '.html'
                    return caches.match(cleanPath);
                }
            }

            // 3. Fallback to Network
            return fetch(event.request);
        })
    );
});


