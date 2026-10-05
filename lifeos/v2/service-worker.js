// LifeOS 2 offline shell. A new version installs quietly and WAITS; the app asks the user, and only then switches over.
// Never touches API calls (Groq or /api) so no personal data lands in a cache.
const VERSION = 'lifeos2-v2.3.0';
// <shell>
const SHELL = ["./","app.js","index.html","js/account.js","js/actions.js","js/advisor.js","js/ai-context.js","js/analytics.js","js/ask-ui.js","js/calendar.js","js/capture-parser.js","js/db.js","js/export-import.js","js/goal-ui.js","js/groq.js","js/memory.js","js/prompts.js","js/push.js","js/reports.js","js/router.js","js/routine-ai.js","js/routine-ui.js","js/routines.js","js/rules-ui.js","js/rules.js","js/schemas.js","js/screens/auth.js","js/screens/capture.js","js/screens/insights.js","js/screens/onboarding.js","js/screens/plan.js","js/screens/readiness.js","js/screens/today.js","js/screens/tracker.js","js/screens/trackers.js","js/screens/you.js","js/seed.js","js/sheets.js","js/store.js","js/sync.js","js/today-layout.js","js/tone.js","js/tour.js","js/tracker-ui.js","js/trackers.js","js/ui.js","js/updates.js","js/util.js","js/whatsnew.js","manifest.json","styles.css","../assets/favicon.png","../assets/logo.webp","../assets/planet.webp","../assets/icon-192.png","../assets/icon-512.png","../assets/icon-maskable-512.png","../assets/apple-touch-icon.png"];
// </shell>

self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL))); }); // no skipWaiting: wait for consent
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('lifeos2-') && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', (e) => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/') || url.pathname.endsWith('/releases.json')) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit; // versioned, consistent shell until the user accepts an update
    try { const res = await fetch(req); if (res.ok && res.type === 'basic') cache.put(req, res.clone()); return res; }
    catch { return req.mode === 'navigate' ? cache.match('index.html') : Response.error(); }
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || './index.html#/today';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) { c.navigate?.(url).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
// ---- background reminders (Web Push) ----
// Always shows a notification (browsers require it); the tag matches the in-app one so an open app never double-notifies.
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  const title = String(d.title || 'LifeOS').slice(0, 80);
  e.waitUntil(self.registration.showNotification(title, { body: String(d.body || '').slice(0, 200), tag: String(d.id || 'lifeos'), icon: '../assets/icon-192.png', badge: '../assets/icon-192.png', data: { url: typeof d.url === 'string' && d.url.startsWith('./') ? d.url : './index.html#/today' } }));
});
// The browser can rotate a subscription; re-register it so reminders keep arriving.
self.addEventListener('pushsubscriptionchange', (e) => e.waitUntil((async () => {
  try {
    const sub = e.newSubscription || await self.registration.pushManager.subscribe(e.oldSubscription?.options || { userVisibleOnly: true });
    await fetch('../api/push', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'lifeos' }, body: JSON.stringify({ action: 'subscribe', subscription: sub.toJSON() }) });
  } catch { /* the app re-subscribes next time it opens */ }
})()));
