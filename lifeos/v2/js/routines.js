// Daily routines (e.g. "Office, Mon–Sat 10:00–18:00"): per-day status (Logged in / Day off) and local guidance
// during the active window (water, breaks, lunch, wrap-up). Pure local logic — no AI call, nothing leaves the device.
// Records live in the `activities` store, discriminated by `kind`:  routine | routine_mark | nudge_ack.
import { store } from './store.js';
import { dayKey, addMinutes, addDays, startOfDay, parseKey, lsGet, lsSet, safeJSON } from './util.js';
import * as T from './trackers.js';
import { nudgeText } from './tone.js';
import * as Tips from './tips.js';
import * as Moments from './moments.js';

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first
export const DEFAULT_NUDGES = {
  water: { on: true, every: 60 }, break: { on: true, every: 90, len: 10 }, lunch: { on: true, at: '13:30' },
  eyes: { on: false, every: 30 }, wrap: { on: true },
};
export const officeTemplate = () => ({ name: 'Office', days: [1, 2, 3, 4, 5, 6], start: '10:00', end: '18:00', assume: false, nudges: structuredClone(DEFAULT_NUDGES) });

export const allRoutines = () => store.all('activities').filter((a) => a.kind === 'routine');
export const activeRoutines = () => allRoutines().filter((r) => r.enabled !== false);
const minutes = (hhmm) => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
export const atTime = (date, hhmm) => { const d = startOfDay(date); d.setMinutes(minutes(hhmm)); return d; };
export const scheduledOn = (r, date) => (r.days || []).includes(new Date(date).getDay());
export const windowOf = (r, date) => ({ start: atTime(date, r.start), end: atTime(date, r.end) });
export const fmtHM = (hhmm) => { const d = atTime(new Date(), hhmm); return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };

// ---- per-day status: 'working' | 'off' | 'done'  (null = not marked yet) ----
const markId = (rid, key) => `mark_${rid}_${key}`;
export function statusFor(r, key) {
  const m = store.get('activities', markId(r.id, key));
  if (m?.status) return m.status === 'cleared' ? null : m.status;
  return r.assume && scheduledOn(r, parseKey(key)) ? 'working' : null;
}
export const setStatus = (r, key, status) => store.save('activities', { id: markId(r.id, key), kind: 'routine_mark', routineId: r.id, date: key, status, enabled: false });

// ---- nudges ----
export const ackOf = (key) => store.get('activities', `ack_${key}`);
export const ack = (key, action, extra = {}) => store.save('activities', { id: `ack_${key}`, kind: 'nudge_ack', key, action, enabled: false, at: new Date().toISOString(), ...extra });
const STALE = { water: 45, break: 60, lunch: 90, eyes: 20, wrap: 45, end: 180, custom: 45 };
export const NUDGE_META = {
  water: { icon: 'droplet', title: 'Drink some water', body: 'About a glass (250 ml) keeps energy steady.' },
  break: { icon: 'walk', title: 'Take a short break', body: 'Stand up, stretch, look away from the screen.' },
  lunch: { icon: 'utensils', title: 'Lunch time', body: 'Step away from your desk and eat properly.' },
  eyes: { icon: 'sun', title: 'Rest your eyes', body: 'Look at something 6 m away for 20 seconds.' },
  wrap: { icon: 'clock', title: 'Wrap up soon', body: 'Jot tomorrow’s first task, then close things down.' },
  end: { icon: 'moon', title: 'Workday is over', body: 'Log out for the day — the rest is yours.' },
  custom: { icon: 'bell', title: 'Reminder', body: '' },
};

export function planFor(r, date) {
  const key = dayKey(date); const { start, end } = windowOf(r, date); const n = { ...DEFAULT_NUDGES, ...(r.nudges || {}) };
  const out = []; const add = (type, at, i = 0, extra = {}) => { if (at > start && at <= end) { const m = { ...NUDGE_META[type], ...extra }; out.push({ key: `${r.id}:${key}:${type}:${i}`, type, at, routineId: r.id, ...m, ...nudgeText(type, m) }); } };
  if (n.water?.on) for (let t = +n.water.every, i = 1; t < (end - start) / 60000 - 10; t += +n.water.every, i++) add('water', addMinutes(start, t), i);
  if (n.break?.on) for (let t = +n.break.every, i = 1; t < (end - start) / 60000 - 20; t += +n.break.every, i++) add('break', addMinutes(start, t), i, { len: +n.break.len || 10, title: `Take a ${+n.break.len || 10}-minute break` });
  if (n.eyes?.on) for (let t = +n.eyes.every, i = 1; t < (end - start) / 60000 - 10; t += +n.eyes.every, i++) add('eyes', addMinutes(start, t), i);
  if (n.lunch?.on) add('lunch', atTime(date, n.lunch.at), 0);
  (Array.isArray(n.custom) ? n.custom : []).slice(0, 12).forEach((c, i) => { if (/^\d{1,2}:\d{2}$/.test(c?.at || '') && c.text) add('custom', atTime(date, c.at), i, { title: String(c.text).slice(0, 60), body: '' }); });
  if (n.wrap?.on !== false) add('wrap', addMinutes(end, -30), 0);
  add('end', end, 0);
  return out.sort((a, b) => a.at - b.at);
}

/** Routines the user is working on right now (scheduled today, marked working, inside the window). */
export function activeNow(now = new Date()) {
  const key = dayKey(now);
  return activeRoutines().filter((r) => {
    if (!scheduledOn(r, now) || statusFor(r, key) !== 'working') return false;
    const { start, end } = windowOf(r, now); return now >= addMinutes(start, -30) && now <= addMinutes(end, 120);
  });
}
/** Due, un-actioned nudges (latest per type), with snoozes respected. */
export function dueNudges(now = new Date()) {
  const out = [];
  for (const r of activeNow(now)) {
    const byType = new Map();
    for (const p of planFor(r, now)) {
      if (p.at > now) continue;
      const a = ackOf(p.key);
      if (a && (a.action === 'done' || a.action === 'skip' || a.action === 'break_started')) continue;
      if (a?.action === 'snooze' && new Date(a.until) > now) continue;
      if ((now - p.at) / 60000 > (STALE[p.type] ?? 60) && !(a?.action === 'snooze')) continue;
      byType.set(p.type, { ...p, routine: r, snoozed: a?.action === 'snooze' });
    }
    out.push(...byType.values());
  }
  return out.sort((a, b) => a.at - b.at);
}
export function nextNudge(now = new Date()) {
  let best = null;
  for (const r of activeNow(now)) for (const p of planFor(r, now)) {
    if (p.at <= now || ackOf(p.key)) continue;
    if (!best || p.at < best.at) best = { ...p, routine: r };
  }
  return best;
}
/** A break the user started and has not finished. */
export function activeBreak(now = new Date()) {
  for (const r of activeRoutines()) for (const p of planFor(r, now).filter((x) => x.type === 'break')) {
    const a = ackOf(p.key);
    if (a?.action === 'break_started') { const until = addMinutes(new Date(a.at), a.len || 10); if (until > now) return { ...p, until, routine: r }; }
  }
  return null;
}
export function daySummary(r, key) {
  const acks = store.all('activities').filter((a) => a.kind === 'nudge_ack' && a.key.startsWith(`${r.id}:${key}:`));
  const n = (type, actions) => acks.filter((a) => a.key.split(':')[2] === type && actions.includes(a.action)).length;
  return { water: n('water', ['done']), breaks: n('break', ['done', 'break_started']), lunch: n('lunch', ['done']) };
}
export function prune() {
  const cutoff = addDays(new Date(), -14).toISOString();
  for (const a of store.all('activities')) if ((a.kind === 'nudge_ack' && a.at < cutoff) || (a.kind === 'routine_mark' && a.date < dayKey(addDays(new Date(), -120)))) store.remove('activities', a.id, { silent: true });
}

/** True when a working routine already gives this kind of nudge at that time (so the general reminder would just repeat it). */
export function generalCovered(id, time, date) {
  const type = Tips.ROUTINE_TYPE[id]; if (!type) return false; const key = dayKey(date); const at = atTime(date, time);
  return activeRoutines().some((r) => scheduledOn(r, date) && statusFor(r, key) === 'working' && (r.nudges?.[type]?.on ?? DEFAULT_NUDGES[type]?.on) && at >= windowOf(r, date).start && at <= windowOf(r, date).end);
}
export const checkinConfig = () => { const c = store.settings().checkins || {}; return { on: c.on !== false, am: /^\d{1,2}:\d{2}$/.test(c.am || '') ? c.am : '08:30', pm: /^\d{1,2}:\d{2}$/.test(c.pm || '') ? c.pm : '20:30' }; };
export const inQuietHours = (d = new Date()) => { const [a, b] = store.settings().quietHours || ['22:00', '07:00']; const m = d.getHours() * 60 + d.getMinutes(); const f = minutes(a), t = minutes(b); return f === t ? false : f < t ? m >= f && m < t : m >= f || m < t; };

// ---- notification loop (runs while the app is open or alive in the background) ----
const NOTIFIED = 'lifeos.notifiedNudges';
let lastSig = '';
export async function wasPushed(tag) {
  try { return !!(tag && 'caches' in window && await caches.match(new URL(`__pushed/${encodeURIComponent(tag)}`, document.baseURI), { cacheName: 'pushed-ids' })); } catch { return false; }
}
const focusQuiet = () => { const f = safeJSON(lsGet('lifeos.focus2'), null); return !!(f && f.quiet && !f.pausedAt); };
const REM = 'lifeos.remhist';
export const reminderHistory = () => safeJSON(lsGet(REM), []);
const logReminder = (title, body, result) => { const l = reminderHistory(); l.unshift({ ts: Date.now(), title, body: String(body || '').slice(0, 120), result }); lsSet(REM, JSON.stringify(l.slice(0, 40))); };
export async function notify(title, body, tag) {
  if (focusQuiet() && !String(tag || '').startsWith('focus:')) { logReminder(title, body, 'held during focus'); return; } // reminders stay quiet during a focus session
  if (await wasPushed(tag)) { logReminder(title, body, 'delivered in the background'); return; } // already delivered by the server while the app was closed
  if (!store.settings().notifications || !('Notification' in window) || Notification.permission !== 'granted') { logReminder(title, body, 'not shown — notifications are off'); return; }
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg?.showNotification) await reg.showNotification(title, { body, tag, icon: '../assets/icon-192.png', badge: '../assets/icon-192.png', data: { url: './index.html#/today' } });
    else new Notification(title, { body, tag, icon: '../assets/icon-192.png' });
    logReminder(title, body, 'shown');
  } catch { logReminder(title, body, 'failed to show'); }
}
export function startRoutineLoop(onChange) {
  const tick = () => {
    const now = new Date(); const due = dueNudges(now); const br = activeBreak(now);
    const seen = safeJSON(lsGet(NOTIFIED), {}); let dirty = false;
    for (const d of due) if (!seen[d.key]) {
      seen[d.key] = Date.now(); dirty = true;
      notify(`${d.routine.name}: ${d.title}`, d.body, d.key);
    }
    if (!inQuietHours(now)) for (const g of Tips.dueGeneral(now, generalCovered)) if (!seen[g.id]) { seen[g.id] = Date.now(); dirty = true; notify('Reminder', g.text, g.id); }
    // morning / evening check-in nudges (the question itself waits for you on Today)
    { const c = checkinConfig(); if (c.on && !inQuietHours(now)) for (const [kind, time, title] of [['am', c.am, 'Morning check-in'], ['pm', c.pm, 'Evening review']]) { const [hh, mm] = time.split(':').map(Number); const t0 = new Date(now); t0.setHours(hh, mm, 0, 0); const k = `ci:${kind}:${dayKey(now)}`; const m = (now - t0) / 60000; if (m >= 0 && m <= 45 && !seen[k]) { seen[k] = Date.now(); dirty = true; notify(title, Moments.checkinText(kind, now), k); } } }
    // tracker reminders (user-defined) and rules that depend on the clock (missing / streak / count)
    const trk = T.dueReminders(now);
    for (const d of trk) if (!seen[d.key]) { seen[d.key] = Date.now(); dirty = true; notify(d.tracker.name, d.text, d.key); }
    import('./rules.js').then((m) => m.run({ now })).catch(() => {});
    const prevBreak = safeJSON(lsGet('lifeos.activeBreak'), null);
    if (prevBreak && (!br || br.key !== prevBreak.key)) { notify('Break over', 'Ready to get back to it?', `${prevBreak.key}:end`); lsSet('lifeos.activeBreak', 'null'); }
    if (br) lsSet('lifeos.activeBreak', JSON.stringify({ key: br.key }));
    if (dirty) { const cut = Date.now() - 2 * 86400000; for (const k of Object.keys(seen)) if (seen[k] < cut) delete seen[k]; lsSet(NOTIFIED, JSON.stringify(seen)); }
    const sig = `${due.map((d) => d.key + (d.snoozed ? 's' : '')).join(',')}|${trk.map((d) => d.key).join(',')}|${br?.key || ''}|${activeNow(now).length ? Math.floor(now / 60000) : ''}`;
    if (sig !== lastSig) { lastSig = sig; onChange?.(due); }
  };
  tick(); document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  return setInterval(tick, 30000);
}
