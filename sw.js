const CACHE_NAME = 'hr-pacer-v1.2.141';
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
    '/marked.min.js',
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
    // Skip cross-origin requests (like Google Fonts or APIs) to avoid security errors
    if (!event.request.url.startsWith(registration.scope)) return;

    event.respondWith(
        caches.match(event.request).then(response => {
            // 1. If it's in the cache, return it immediately
            if (response) return response;

            // 2. Cloudflare Pretty URL fallback
            // If /about fails, try /about.html (and vice versa)
            const url = new URL(event.request.url);
            let alternatePath = null;

            if (url.pathname.endsWith('.html')) {
                alternatePath = url.pathname.replace('.html', '');
            } else if (url.pathname !== '/' && !url.pathname.includes('.')) {
                alternatePath = url.pathname + '.html';
            }

            if (alternatePath) {
                return caches.match(alternatePath).then(altResponse => {
                    return altResponse || fetch(event.request);
                });
            }

            // 3. Last resort: Network
            return fetch(event.request);
        }).catch(() => {
            // Generic fallback for total failure
            return caches.match('/');
        })
    );
});
