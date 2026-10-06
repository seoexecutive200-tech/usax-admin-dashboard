// LifeOS 2 — app shell: boot, migration from v1, routing, onboarding, reminders, updates.
import { store } from './js/store.js';
import { register, registerActions, initRouter, render, refresh, navigate } from './js/router.js';
import { applyMotion, applyTheme, toast, icon, html, h } from './js/ui.js';
import * as adv from './js/advisor.js';
import { aiReady, initHosted } from './js/groq.js';
import { gapDays } from './js/analytics.js';
import { syncPatterns } from './js/memory.js';
import today, { setBanners } from './js/screens/today.js';
import plan from './js/screens/plan.js';
import capture from './js/screens/capture.js';
import insights from './js/screens/insights.js';
import you from './js/screens/you.js';
import trackers from './js/screens/trackers.js';
import tracker from './js/screens/tracker.js';
import calendar from './js/screens/calendar.js';
import { mountFocusPill } from './js/focus-ui.js';
import { startGcal } from './js/gcal.js';
import './js/ai-setup.js';
import './js/checkin-ui.js';
import { watchUpdates } from './js/updates.js';
import { tourSheet } from './js/tour.js';
import { builderSheet } from './js/tracker-ui.js';
import { lsSet } from './js/util.js';
import readiness from './js/screens/readiness.js';
import { showOnboarding } from './js/screens/onboarding.js';
import { isPersistent, setDbName, readAllFrom, DB_NAME, V1_DB_NAME } from './js/db.js';
import { detect, dbNameFor, v1DbNameFor } from './js/account.js';
import { startSync, onSyncChange, sync } from './js/sync.js';
import { showAuth } from './js/screens/auth.js';
import { startRoutineLoop, prune as pruneRoutines } from './js/routines.js';
import { initPush } from './js/push.js';

async function boot() {
  // 1. Who is using the app? (signed in / needs to sign in / local-only because the host has no accounts)
  const who = await detect();
  let user = null; let isNew = false; let regName = ''; let legacy = null;
  if (who.state === 'anon') { document.getElementById('boot')?.remove(); const r = await showAuth(); user = r.user; isNew = r.isNew; regName = r.name; }
  else if (who.state === 'user') user = who.user;
  if (user) {
    legacy = await readAllFrom(v1DbNameFor(user)) || (isNew ? await readAllFrom(V1_DB_NAME) : null); // read-only copy source: the original LifeOS database
    setDbName(dbNameFor(user)); // every account gets its own local database
  }
  if (!user) legacy = await readAllFrom(V1_DB_NAME); // local-only device: original LifeOS data
  await store.init();
  let migrated = false;
  {
    const hasLegacy = legacy && ['logs', 'events', 'tasks', 'goals', 'memories'].some((n) => (legacy[n] || []).length) && legacy.profiles?.some((p) => p.onboarded);
    // First run of LifeOS 2: COPY the user's original data across (the original database is only read, never changed).
    if (hasLegacy && !store.profile().onboarded) { await store.replaceAll(legacy); migrated = true; await store.setSettings({ introSeen: false }); }
    if (regName && !store.profile().name) await store.setProfile({ name: regName });
  }
  if (user) await initHosted(); // is hosted AI available for this account?
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

  [today, plan, capture, insights, you, readiness, trackers, tracker, calendar].forEach((s) => register(s.id, s));
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
  lsSet('lifeos.v2ok', String(Date.now())); // the original LifeOS may now open this version directly
  watchUpdates();
  if (user) startGcal(); // Google Calendar events, if connected
  mountFocusPill(); // the focus timer pill + finishing sessions that ended while the app was closed
  initPush(); // re-attaches background reminders if they're on for this device
  if (store.settings().mode === 'custom' && !store.all('trackers').length) setTimeout(() => builderSheet(), 700);
  else if (!store.settings().introSeen && store.profile().onboarded) setTimeout(() => tourSheet(), 900);
}
boot().catch((e) => {
  console.error('LifeOS failed to start:', e?.message);
  let b = document.getElementById('boot');
  if (!b) { b = document.createElement('div'); b.id = 'boot'; document.body.appendChild(b); }
  b.innerHTML = `<p>LifeOS 2 couldn’t start: ${String(e?.message).replace(/</g, '&lt;')}</p><p><a href="../index.html" id="goback" style="color:#8ab4ff">Open the original LifeOS</a></p>`; document.getElementById('goback')?.addEventListener('click', () => { try { localStorage.setItem('lifeos.channel', 'v1'); } catch { /* ignore */ } });
});
