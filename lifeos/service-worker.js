// Offline shell. Caches only same-origin static files. API traffic (Groq) is never intercepted or cached,
// so no personal context ever lands in a cache.
const VERSION = 'lifeos-v1.0.0';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'manifest.json', 'assets/icon.svg', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/apple-touch-icon.png',
  'js/util.js', 'js/db.js', 'js/store.js', 'js/router.js', 'js/analytics.js', 'js/groq.js', 'js/prompts.js', 'js/schemas.js', 'js/ai-context.js', 'js/advisor.js',
  'js/capture-parser.js', 'js/calendar.js', 'js/reports.js', 'js/memory.js', 'js/export-import.js', 'js/ui.js', 'js/actions.js', 'js/sheets.js', 'js/seed.js',
  'js/screens/today.js', 'js/screens/plan.js', 'js/screens/capture.js', 'js/screens/insights.js', 'js/screens/you.js', 'js/screens/readiness.js', 'js/screens/onboarding.js',
];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // never touch Groq or other origins
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then((res) => { if (res.ok && res.type === 'basic') cache.put(req, res.clone()); return res; }).catch(() => null);
    if (hit) { net.catch(() => {}); return hit; }               // stale-while-revalidate
    return (await net) || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
  })());
});
