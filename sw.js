const CACHE_NAME = 'hr-pacer-v1.2.219';
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

// ─── Alert notifications ───────────────────────────────────────────────────────
// Two message types:
//
// NOTIFY       — single notification (state changes, session end).  Shows once,
//                applies vibration pattern per settings, auto-closes after duration.
//
// NOTIFY_INHALE — repeated notification for the RFB inhale period.  Android ignores
//                custom vibrate patterns, so we re-show the same notification every
//                INHALE_BUZZ_INTERVAL_MS.  Each re-show on the same tag triggers the
//                system default vibration without adding a new shade entry.  Stops
//                automatically after duration ms, or immediately if superseded.
//
// Stale-timer guard: _notifToken increments on every incoming message so that a
// close-timer or buzz-loop from an older notification cannot affect a newer one.
let _notifToken = 0;
const INHALE_BUZZ_INTERVAL_MS = 600;

self.addEventListener('message', event => {
    if (!event.data) return;
    const { type } = event.data;

    if (type === 'NOTIFY') {
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

    } else if (type === 'NOTIFY_INHALE') {
        const { duration } = event.data;
        const token = ++_notifToken;
        const deadline = Date.now() + duration;
        let slot = 0; // alternates 0 → 1 → 0 → 1 …

        event.waitUntil(new Promise(resolve => {
            function buzz() {
                if (_notifToken !== token || Date.now() >= deadline) {
                    // Close both slots and finish.
                    ['hr-inhale-0', 'hr-inhale-1'].forEach(tag =>
                        self.registration.getNotifications({ tag })
                            .then(ns => ns.forEach(n => n.close()))
                    );
                    resolve();
                    return;
                }

                const showTag = `hr-inhale-${slot % 2}`;
                const hideTag = `hr-inhale-${(slot + 1) % 2}`;
                slot++;

                // Show on new slot first (triggers vibration), then close old slot.
                // Showing before closing means no gap in the notification shade.
                self.registration.showNotification('Manawa Pace', {
                    body:               'Inhale',
                    tag:                showTag,
                    requireInteraction: false,
                }).then(() => {
                    self.registration.getNotifications({ tag: hideTag })
                        .then(ns => ns.forEach(n => n.close()));
                    setTimeout(buzz, INHALE_BUZZ_INTERVAL_MS);
                });
            }
            buzz();
        }));
    }
});