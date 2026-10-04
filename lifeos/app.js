// LifeOS V1 — app shell: boot, routing, onboarding, reminders, service worker.
import { store } from './js/store.js';
import { register, registerActions, initRouter, render, refresh, navigate } from './js/router.js';
import { applyMotion, applyTheme, toast, icon, html, h } from './js/ui.js';
import * as adv from './js/advisor.js';
import { aiReady } from './js/groq.js';
import { gapDays } from './js/analytics.js';
import { syncPatterns } from './js/memory.js';
import today, { setBanners } from './js/screens/today.js';
import plan from './js/screens/plan.js';
import capture from './js/screens/capture.js';
import insights from './js/screens/insights.js';
import you from './js/screens/you.js';
import readiness from './js/screens/readiness.js';
import { showOnboarding } from './js/screens/onboarding.js';
import { isPersistent, setDbName, readAllFrom, DB_NAME } from './js/db.js';
import { detect, dbNameFor } from './js/account.js';
import { startSync, onSyncChange, sync } from './js/sync.js';
import { showAuth } from './js/screens/auth.js';
import { startRoutineLoop, prune as pruneRoutines } from './js/routines.js';

async function boot() {
  // 1. Who is using the app? (signed in / needs to sign in / local-only because the host has no accounts)
  const who = await detect();
  let user = null; let isNew = false; let regName = ''; let legacy = null;
  if (who.state === 'anon') { document.getElementById('boot')?.remove(); const r = await showAuth(); user = r.user; isNew = r.isNew; regName = r.name; }
  else if (who.state === 'user') user = who.user;
  if (user) {
    if (isNew) legacy = await readAllFrom(DB_NAME); // data created before accounts existed on this device
    setDbName(dbNameFor(user)); // every account gets its own local database
  }
  await store.init();
  if (isNew) {
    const hasLegacy = legacy && ['logs', 'events', 'tasks', 'goals', 'memories'].some((n) => (legacy[n] || []).length) && legacy.profiles?.some((p) => p.onboarded);
    if (hasLegacy) { await store.replaceAll(legacy); setTimeout(() => toast('Your existing data on this device was added to your new account.', { duration: 6000 }), 800); }
    if (regName && !store.profile().name) await store.setProfile({ name: regName });
  }
  if (user) {
    window.__account = user;
    await startSync(user.id); // initial pull happens before onboarding so returning users keep their data (offline: resolves quickly)
    onSyncChange(() => { if (sync.status === 'auth') toast('Your session expired — please log in again.', { tone: 'warn', duration: 8000 }); if (document.body.dataset.screen === 'you') refresh(); });
  }
  applyTheme(); applyMotion();
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', applyMotion);
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

  document.getElementById('nav').innerHTML = html(h`
    <button class="nav-btn" data-route="today">${icon('home', 24)}<span>Today</span></button>
    <button class="nav-btn" data-route="plan">${icon('calendar', 24)}<span>Plan</span></button>
    <button class="fab" data-route="capture" aria-label="Capture">${icon('plus', 30)}</button>
    <button class="nav-btn" data-route="insights">${icon('chart', 24)}<span>Insights</span></button>
    <button class="nav-btn" data-route="you">${icon('user', 24)}<span>You</span></button>`);

  [today, plan, capture, insights, you, readiness].forEach((s) => register(s.id, s));
  initRouter({ view: document.getElementById('view'), nav: document.getElementById('nav') });

  if (!store.profile().onboarded) { document.getElementById('boot')?.remove(); await showOnboarding(); }
  if (!location.hash) location.hash = '#/today';
  render(true);

  // don't re-render a screen while the user is typing in it; catch up on blur
  const view = document.getElementById('view'); let verAtFocus = 0;
  view.addEventListener('focusin', (e) => { if (e.target.matches('input:not([type=range]):not([type=checkbox]), textarea')) { document.body.classList.add('typing'); verAtFocus = store.version(); } });
  view.addEventListener('focusout', () => { setTimeout(() => { if (!view.contains(document.activeElement) || !document.activeElement.matches('input,textarea')) { document.body.classList.remove('typing'); if (store.version() !== verAtFocus) refresh(); } }, 120); });

  adv.onAdvisorChange(() => refresh());
  adv.startReminderLoop((b) => { const changed = JSON.stringify(b.map((x) => x.id)) !== JSON.stringify(window.__bn || []); window.__bn = b.map((x) => x.id); setBanners(b); if (changed) refresh(); });
  syncPatterns(); pruneRoutines();
  startRoutineLoop(() => { if (['today', 'plan'].includes(document.body.dataset.screen)) refresh(); }); // work-mode guidance: water, breaks, lunch
  adv.evaluate('app_open');
  window.addEventListener('online', () => { toast('Back online'); refresh(); });
  window.addEventListener('offline', () => { toast('Offline — everything local still works'); refresh(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { adv.notify('resume'); refresh(); } });

  if (!isPersistent()) toast('Private browsing: data won’t persist after closing this tab. Export to keep it.', { duration: 7000, tone: 'warn' });
  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('service-worker.js').catch(() => {});
  document.getElementById('boot')?.remove();
}
boot().catch((e) => {
  console.error('LifeOS failed to start:', e?.message);
  let b = document.getElementById('boot');
  if (!b) { b = document.createElement('div'); b.id = 'boot'; document.body.appendChild(b); }
  b.innerHTML = `<p>LifeOS couldn’t start: ${String(e?.message).replace(/</g, '&lt;')}</p><button class="btn btn-primary" onclick="location.reload()">Reload</button>`;
});
