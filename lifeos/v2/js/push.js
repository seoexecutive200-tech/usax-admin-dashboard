// Background reminders (Web Push). The app uploads the next ~3 days of reminder times to the server, and a scheduler there
// sends them to this device even when LifeOS is closed. Only titles and short plain text are uploaded — never your entries.
// Routine nudges mirror the local logic (planFor/statusFor/ack); the in-app loop still handles anything shown while the app is open.
import { store } from './store.js';
import { api } from './account.js';
import { dayKey, addDays, lsGet, lsSet, lsDel } from './util.js';
import * as R from './routines.js';
import * as T from './trackers.js';
import * as F from './focus.js';
import * as Tips from './tips.js';
import * as Moments from './moments.js';
import * as CI from './checkins.js';
import * as Tidy from './tidy.js';

const FLAG = 'lifeos.push2'; // per device: this browser has background reminders on
const HORIZON_MS = 70 * 3600 * 1000;
export const state = { supported: false, reason: '', permission: 'default', on: false, available: false, devices: 0, tickAt: null, loaded: false };
let lastSig = ''; let timer = null; let hooked = false; let last = 0;

const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function capability() {
  if (!window.__account) return 'Sign in to turn on background reminders.';
  if (location.protocol === 'file:' || !('serviceWorker' in navigator)) return 'This browser can’t run background reminders here.';
  if (ios() && !standalone()) return 'On iPhone and iPad, first tap Share → Add to Home Screen, then open LifeOS from the home screen.';
  if (!('PushManager' in window) || !('Notification' in window)) return 'This browser doesn’t support background notifications.';
  return '';
}
const b64ToBytes = (b64) => { const p = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'); const raw = atob(p); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
const sameKey = (sub, key) => { try { const a = new Uint8Array(sub.options.applicationServerKey); const b = key; return a.length === b.length && a.every((v, i) => v === b[i]); } catch { return false; } };

/** Reads permission, subscription and server availability. Resolves to true when something changed (so the You screen can redraw). */
export async function refreshStatus() {
  const before = JSON.stringify(state);
  const why = capability(); state.supported = !why; state.reason = why;
  state.permission = 'Notification' in window ? Notification.permission : 'denied';
  state.on = lsGet(FLAG) === '1' && state.permission === 'granted';
  if (state.supported) {
    try { const info = await api('/api/push', { method: 'GET' }); state.available = !!info.available; state.devices = info.devices || 0; state.tickAt = info.tickAt || null; } catch { /* offline: keep the last known state */ }
  } else { state.available = false; }
  state.loaded = true; last = Date.now();
  return before !== JSON.stringify(state);
}
export const statusStale = () => !state.loaded || Date.now() - last > 60000;

async function currentSub(reg) { try { return await reg.pushManager.getSubscription(); } catch { return null; } }
async function ensureSubscription(publicKey) {
  const reg = await navigator.serviceWorker.ready; const key = b64ToBytes(publicKey);
  let sub = await currentSub(reg);
  if (sub && !sameKey(sub, key)) { await sub.unsubscribe().catch(() => {}); sub = null; } // server keys changed
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api('/api/push', { body: { action: 'subscribe', subscription: sub.toJSON() } });
  return sub;
}
export async function enable() {
  await refreshStatus();
  if (!state.supported) throw new Error(state.reason);
  if (!state.available) throw new Error('Background reminders aren’t switched on for this server yet.');
  if (Notification.permission === 'denied') throw new Error('Notifications are blocked for this site. Allow them in your browser or phone settings, then try again.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permission wasn’t granted.');
  const info = await api('/api/push', { method: 'GET' });
  await ensureSubscription(info.publicKey);
  lsSet(FLAG, '1'); await store.setSettings({ notifications: true });
  hook(); await upload(true); await refreshStatus();
}
export async function disable() {
  lsDel(FLAG); lastSig = ''; clearTimeout(timer); timer = null;
  try { const reg = await navigator.serviceWorker.ready; const sub = await currentSub(reg); if (sub) { await api('/api/push', { body: { action: 'unsubscribe', endpoint: sub.endpoint } }).catch(() => {}); await sub.unsubscribe().catch(() => {}); } } catch { /* ignore */ }
  await refreshStatus();
}
export async function sendTest() { return api('/api/push', { body: { action: 'test' } }); }

// ---- the schedule ----
const inQuiet = (at, [from, to]) => {
  const m = at.getHours() * 60 + at.getMinutes(); const f = hm(from); const t = hm(to);
  return f === t ? false : f < t ? m >= f && m < t : m >= f || m < t;
};
const hm = (s) => { const [h, m] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };

export function buildJobs(now = new Date()) {
  const quiet = store.settings().quietHours || ['22:00', '07:00']; const horizon = +now + HORIZON_MS; const jobs = [];
  // A running focus session: schedule its end, and hold other reminders until it's over (they return when the session stops).
  const fz = F.active(); const fzEnd = fz?.planned && !fz.pausedAt ? +now + F.remainingMs(+now) : null; const hold = fz?.quiet && !fz.pausedAt ? (fzEnd ?? +now + 12 * 3600000) : 0;
  const add = (j) => { const at = j.at instanceof Date ? j.at : new Date(j.at); const own = String(j.id).startsWith('focus:'); const long = /^(wb|tidy):/.test(String(j.id)); if (+at <= +now + 20000 || (+at > horizon && !long) || (!own && (inQuiet(at, quiet) || +at < hold))) return; jobs.push({ ...j, at: +at }); };
  if (fz && fzEnd) add({ id: `focus:${fz.id}:end`, at: fzEnd, title: 'Focus complete', body: fz.label ? `Nice work on “${fz.label}”.` : 'Session finished — time for a break.', url: './index.html#/today' });
  for (let i = 0; i < 4; i++) {
    const date = addDays(now, i); const key = dayKey(date);
    for (const r of R.activeRoutines()) {
      if (!R.scheduledOn(r, date)) continue;
      const st = R.statusFor(r, key);
      if (st === 'working') {
        for (const p of R.planFor(r, date)) { const a = R.ackOf(p.key); if (a && a.action !== 'snooze') continue; add({ id: p.key, at: p.at, title: `${r.name}: ${p.title}`, body: p.body, url: './index.html#/today' }); }
      } else if (!st && !r.assume) { // not marked yet: one gentle nudge at the start of the window so the day can be switched on
        add({ id: `${r.id}:${key}:start:0`, at: R.windowOf(r, date).start, title: r.name, body: 'Starting soon — open LifeOS and tap Logged in so I can guide your day.', url: './index.html#/today' });
      }
    }
    { const c = R.checkinConfig(); if (c.on) for (const [kind, time, title] of [['am', c.am, 'Morning check-in'], ['pm', c.pm, 'Evening review']]) { const [hh, mm] = time.split(':').map(Number); const t0 = new Date(date); t0.setHours(hh, mm, 0, 0); add({ id: `ci:${kind}:${key}`, at: t0, title, body: Moments.checkinText(kind, date), url: './index.html#/today' }); } }
    for (const g of Tips.remindersOn(date, R.generalCovered)) add({ id: g.id, at: g.at, title: 'Reminder', body: g.text, url: './index.html#/today' });
    for (const t of T.allTrackers()) for (const rem of t.reminders || []) {
      if (!(rem.days || []).includes(date.getDay()) || !/^\d{1,2}:\d{2}$/.test(rem.time || '')) continue;
      const at = new Date(date); const [h, m] = rem.time.split(':').map(Number); at.setHours(h, m, 0, 0);
      add({ id: `trk:${t.id}:${rem.id}:${key}`, at, title: t.private ? 'Reminder' : t.name, body: t.private ? 'Time for a check-in.' : (rem.text || `Time to log ${t.name.toLowerCase()}`), url: './index.html#/today' });
    }
  }
  // adaptive check-ins that fit the coming days (generic text for personal topics)
  for (const j of CI.pushPlan(now)) add({ ...j, url: './index.html#/today' });
  // gentle nudges: a welcome back after 5 quiet days (replaced the moment you open the app), and a weekly tidy-up
  if (CI.getCx().pushNudges !== false) {
    const last = Tidy.lastActive();
    if (last) { const at = addDays(new Date(last), 5); at.setHours(10, 0, 0, 0); add({ id: `wb:${dayKey(new Date(last))}`, at, title: 'LifeOS', body: 'Welcome back whenever you’re ready — there’s nothing to catch up on.', url: './index.html#/today' }); }
    const n = Tidy.scan(now).total; if (n >= 3) { const sun = addDays(now, (7 - now.getDay()) % 7); sun.setHours(17, 0, 0, 0); add({ id: `tidy:${dayKey(sun)}`, at: sun, title: 'Tidy up', body: `${n} things could use a quick look — duplicates, slipping tasks or quiet goals.`, url: './index.html#/today' }); }
  }
  return jobs.sort((a, b) => a.at - b.at);
}
async function upload(force = false) {
  if (lsGet(FLAG) !== '1' && !force) return;
  if (!window.__account || navigator.onLine === false) return;
  const jobs = buildJobs(); const sig = JSON.stringify(jobs.map((j) => [j.id, j.at, j.title]));
  if (!force && sig === lastSig) return;
  try { await api('/api/push', { body: { action: 'schedule', jobs } }); lastSig = sig; } catch { /* retried on the next change */ }
}
// Not a trailing debounce: a busy store must not postpone the upload forever, so the first change starts a 3 s timer and later ones ride along.
export const schedule = () => { if (!timer) timer = setTimeout(() => { timer = null; upload(); }, 3000); };
function hook() {
  if (hooked) return; hooked = true;
  store.on(() => { if (lsGet(FLAG) === '1') schedule(); });
  document.addEventListener('lifeos:focus', () => { if (lsGet(FLAG) === '1') schedule(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && lsGet(FLAG) === '1') { lastSig = ''; schedule(); } });
  window.addEventListener('online', () => { if (lsGet(FLAG) === '1') schedule(); });
}
/** Called once at startup: re-attaches the subscription if the browser dropped it, then keeps the schedule fresh. */
export async function initPush() {
  if (lsGet(FLAG) !== '1') return;
  if (capability() || !('Notification' in window) || Notification.permission !== 'granted') { if ('Notification' in window && Notification.permission === 'denied') lsDel(FLAG); return; }
  hook();
  try { const info = await api('/api/push', { method: 'GET' }); if (info.available) { await ensureSubscription(info.publicKey); await upload(true); } } catch { schedule(); }
}
