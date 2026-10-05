// Focus timer: turn focus mode on when you need to concentrate, off when you're done. The running session lives on this device
// (localStorage) so it survives reloads; finished sessions are saved as records (they sync) and, optionally, into a "Focus time" tracker.
import { store } from './store.js';
import * as T from './trackers.js';
import { execute } from './actions.js';
import { lsGet, lsSet, lsDel, safeJSON, uid, dayKey, round } from './util.js';

const KEY = 'lifeos.focus2';
let st = safeJSON(lsGet(KEY), null);
const listeners = new Set();
export const onFocus = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const persist = () => { if (st) lsSet(KEY, JSON.stringify(st)); else lsDel(KEY); listeners.forEach((f) => { try { f(); } catch { /* ignore */ } }); document.dispatchEvent(new Event('lifeos:focus')); };

export const active = () => st;
export const isPaused = () => !!st?.pausedAt;
export const elapsedMs = (now = Date.now()) => (st ? Math.max(0, (st.pausedAt ?? now) - st.startedAt - st.pausedTotal) : 0);
export const remainingMs = (now = Date.now()) => (st?.planned ? Math.max(0, st.planned * 60000 - elapsedMs(now)) : null);
/** When the running session will end (ms), or null for open-ended or paused sessions. */
export const endsAt = (now = Date.now()) => (st?.planned && !st.pausedAt ? now + remainingMs(now) : null);
export const fmtClock = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(x).padStart(2, '0')}`; };

export function start({ label = '', minutes = 0, quiet = true, track = true, taskId = null } = {}) {
  if (st) return st;
  const planned = Number(minutes) > 0 ? Math.min(600, Math.round(Number(minutes))) : 0;
  st = { id: uid('foc'), label: String(label).replace(/\s+/g, ' ').trim().slice(0, 80), startedAt: Date.now(), pausedAt: null, pausedTotal: 0, planned, quiet: !!quiet, track: !!track, taskId };
  persist(); return st;
}
export function pause() { if (st && !st.pausedAt) { st.pausedAt = Date.now(); persist(); } }
export function resume() { if (st?.pausedAt) { st.pausedTotal += Date.now() - st.pausedAt; st.pausedAt = null; persist(); } }
export function extend(min) { if (st) { st.planned = (st.planned || Math.ceil(elapsedMs() / 60000)) + min; persist(); } }

export const sessions = () => store.all('activities').filter((a) => a.kind === 'focus').sort((a, b) => b.start.localeCompare(a.start));
export function todaySummary(key = dayKey()) { const s = sessions().filter((x) => dayKey(x.start) === key); return { count: s.length, minutes: s.reduce((n, x) => n + (x.minutes || 0), 0) }; }

/** Finds (or, when asked, creates) the "Focus time" tracker. */
export async function focusTracker(create = false) {
  let t = T.allTrackers().find((x) => x.name === 'Focus time');
  if (!t && create) {
    const spec = T.normalizeTracker({ name: 'Focus time', icon: 'brain', color: 'blue', description: 'Time spent in focus sessions', keywords: ['focus', 'deep work'], pinned: false, fields: [{ label: 'Time', type: 'duration', agg: 'sum' }, { label: 'On', type: 'text' }] }).spec;
    t = await store.save('trackers', { ...spec, order: store.all('trackers').length });
  }
  return t || null;
}

/** Ends the session and records it. completed = reached the planned time. Sessions under a minute are discarded unless completed. */
export async function finish({ completed = false } = {}) {
  if (!st) return null; const s = st;
  const ms = s.planned ? Math.min(elapsedMs(), s.planned * 60000) : elapsedMs(); const minutes = Math.round(ms / 60000);
  st = null; persist();
  if (minutes < 1 && !completed) return null;
  const startISO = new Date(s.startedAt).toISOString(); const endISO = new Date(s.startedAt + s.pausedTotal + ms).toISOString();
  const rec = await store.save('activities', { kind: 'focus', category: 'focus', enabled: false, label: s.label, start: startISO, end: endISO, minutes: Math.max(minutes, completed ? s.planned : 0), planned: s.planned, completed: !!completed, taskId: s.taskId || null });
  if (s.track) {
    try {
      const t = await focusTracker(true); const tf = t.fields.find((f) => f.type === 'duration'); const lf = t.fields.find((f) => f.type === 'text');
      await execute({ type: 'create_entry', payload: { trackerId: t.id, values: { [tf.id]: rec.minutes, ...(lf && s.label ? { [lf.id]: s.label } : {}) }, ts: endISO, source: 'focus' } }, { origin: 'user' });
    } catch { /* the session is saved either way */ }
  }
  return { ...rec, session: s };
}
/** Called on a timer and at startup: if a planned session has run its course (even while the app was closed), record it. */
export async function reconcile() {
  if (st && st.planned && !st.pausedAt && remainingMs() <= 0) return finish({ completed: true });
  return null;
}
export const minutesLabel = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${round(m, 0)} min`);
