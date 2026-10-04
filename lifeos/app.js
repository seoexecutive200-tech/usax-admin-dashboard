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
import { isPersistent } from './js/db.js';

async function boot() {
  await store.init();
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
  syncPatterns();
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
  const b = document.getElementById('boot'); if (b) b.innerHTML = `<p>LifeOS couldn’t start: ${String(e.message).replace(/</g, '&lt;')}</p>`;
});
