const CACHE_NAME = 'hr-pacer-v1.2.248';
const ASSETS = [
    '/',
    '/index.html',
    '/utils.js',
    '/app.js',
    '/style.css',
    '/settings.js',
    '/summary.js',
    '/summary.css',
    '/history',
    '/history.js',
    '/history.css',
    '/manifest.json',
    '/icon.png',
    '/quick_start_guide',
    '/battery_settings_guide',
    '/about',
    '/marked.min.js',
    '/README.md',
];

// Strip .html to get the canonical cache key, so lookups work regardless of
// whether the server redirects /page.html → /page (e.g. Cloudflare) or serves
// /page.html directly (e.g. Apache/Nginx).
function canonicalPath(pathname) {
    return pathname.endsWith('.html') ? pathname.slice(0, -5) : pathname;
}

// Install: pre-cache assets individually so one failure can't nuke the rest
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache =>
            Promise.all(
                ASSETS.map(url =>
                    cache.add(url).catch(err => console.warn('Failed to cache:', url, err))
                )
            )
        )
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

// Fetch: CACHE FIRST, fallback to network, fallback to home screen
// All reads and writes use the canonical (no-.html) key so there is exactly
// one cache entry per page regardless of which URL form the browser requested.
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
        return;
    }

    const canonical = canonicalPath(new URL(event.request.url).pathname);
    const canonicalUrl = new URL(canonical, self.location.origin).href;
    const canonicalRequest = new Request(canonicalUrl, { credentials: 'same-origin' });

    event.respondWith(
        caches.match(canonicalRequest).then(cached => {
            if (cached) return cached;

            // Not pre-cached — fetch, store, and return
            return fetch(event.request)
                .then(networkResponse => {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(canonicalRequest, responseClone));
                    return networkResponse;
                })
                .catch(() => {
                    if (event.request.mode === 'navigate') return caches.match('/');
                });
        })
    );
});

// ─── Alert notifications ───────────────────────────────────────────────────────
// Handles NOTIFY messages for state changes, session end, and RFB breath-phase
// cues (Inhale / Exhale) when the app is not visible.  Shows a notification for
// `duration` ms then auto-closes.
//
// Stale-timer guard: _notifToken increments on each message so a close-timer
// from an older notification cannot dismiss a newer one.
let _notifToken = 0;

self.addEventListener('message', event => {
    if (!event.data || event.data.type !== 'NOTIFY') return;
    const { text, vibrate, duration, silent } = event.data;
    const token = ++_notifToken;

    event.waitUntil(
        self.registration.showNotification('Manawa Pace', {
            body:               text,
            tag:                'hr-alert',
            vibrate:            vibrate || [],
            silent:             silent  || false,
            requireInteraction: false,
        }).then(() => new Promise(resolve => {
            setTimeout(() => {
                if (_notifToken !== token) { resolve(); return; }
                self.registration.getNotifications({ tag: 'hr-alert' })
                    .then(ns => { ns.forEach(n => n.close()); resolve(); });
            }, Math.max(duration, 0));
        }))
    );
});
