const CACHE = 'festival-shell-v1';
const SHELL = ['/', '/index.html', '/app.js', '/manifest.webmanifest'];
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))));
// Never cache API data or print cards offline: exact/old restriction-sensitive plans must not be silently reused.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/print')) {
    event.respondWith(fetch(event.request).catch(() => new Response(JSON.stringify({ error: 'offline-plan-invalid' }), { status: 503, headers: { 'Content-Type': 'application/json' } })));
    return;
  }
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then((r) => r || caches.match('/index.html'))));
});
