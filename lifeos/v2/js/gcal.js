// Google Calendar (and other iCal subscriptions) → your LifeOS schedule. Read-only: events are copied in as normal LifeOS events marked
// origin "google", so Today, Plan, Month, readiness and reminders all see them. The private link stays on the server.
import { store } from './store.js';
import { api } from './account.js';
import { parseKey } from './util.js';

export const state = { feeds: [], last: null, error: '', syncing: false, count: 0, loaded: false };
let timer = null; let hooked = false;
const listeners = new Set(); export const onGcal = (fn) => { listeners.add(fn); return () => listeners.delete(fn); }; const emit = () => listeners.forEach((f) => { try { f(); } catch { /* ignore */ } });

const guessType = (t) => (/\b(meet|call|sync|stand-?up|1:1|interview|review|demo|webinar|zoom|teams)\b/i.test(t) ? 'meeting' : /\b(doctor|dentist|appointment|clinic|checkup|check-up)\b/i.test(t) ? 'appointment' : /\b(deadline|due)\b/i.test(t) ? 'deadline' : 'other');
const localMidnight = (key) => { const d = parseKey(key); d.setHours(0, 0, 0, 0); return d.toISOString(); };
function toRecord(feedId, e) {
  const start = e.allDay ? localMidnight(e.start) : e.start; const end = e.allDay ? localMidnight(e.end) : e.end;
  return { id: `g_${feedId}_${e.id}`, title: e.title, type: guessType(e.title), start, end, allDay: !!e.allDay, location: e.location || '', notes: e.notes || '', origin: 'google', externalFeed: feedId };
}
const FIELDS = ['title', 'start', 'end', 'allDay', 'location', 'notes'];
const same = (a, b) => FIELDS.every((k) => (a[k] ?? '') === (b[k] ?? ''));

export async function listFeeds() {
  if (!window.__account) { state.feeds = []; state.loaded = true; return state.feeds; }
  try { state.feeds = (await api('/api/calendar', { method: 'GET' })).feeds || []; } catch { /* keep what we had */ }
  state.loaded = true; emit(); return state.feeds;
}
/** Pulls events from every connected calendar and reconciles them with the stored copies. */
export async function syncGoogle({ force = false } = {}) {
  if (!window.__account || state.syncing) return; if (!force && state.last && Date.now() - state.last < 4 * 60000) return;
  if (!state.loaded) await listFeeds(); if (!state.feeds.length && !store.all('events').some((e) => e.origin === 'google')) return;
  state.syncing = true; state.error = ''; emit();
  try {
    const now = Date.now(); const from = new Date(now - 14 * 86400000); const to = new Date(now + 90 * 86400000);
    const r = await api(`/api/calendar?events=1&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`, { method: 'GET' });
    const live = new Set((r.feeds || []).map((f) => f.id)); const toSave = []; const toRemove = []; let count = 0;
    for (const f of r.feeds || []) {
      if (!Array.isArray(f.events)) { state.error = f.error || 'Couldn’t read a calendar'; continue; }
      const wanted = new Map(f.events.map((e) => [`g_${f.id}_${e.id}`, toRecord(f.id, e)])); count += wanted.size;
      for (const [id, rec] of wanted) { const cur = store.get('events', id); if (!cur) toSave.push({ ...rec, importance: 'normal', prepRequired: false, prepStatus: 'none', status: 'scheduled', timezone: store.profile().timezone, checklist: [], rescheduleCount: 0 }); else if (!same(cur, rec)) toSave.push({ id, ...rec }); }
      for (const cur of store.all('events')) if (cur.origin === 'google' && cur.externalFeed === f.id && !wanted.has(cur.id) && +new Date(cur.start) >= +from && +new Date(cur.start) <= +to) toRemove.push(cur.id);
    }
    for (const cur of store.all('events')) if (cur.origin === 'google' && !live.has(cur.externalFeed)) toRemove.push(cur.id); // calendar disconnected
    if (toSave.length) await store.saveMany('events', toSave);
    for (const id of toRemove) await store.remove('events', id, { silent: true }); if (toRemove.length) store.emit({ name: 'events', op: 'bulk' });
    state.count = count; state.last = Date.now(); await listFeeds();
  } catch (e) { state.error = e?.network ? 'Offline — showing the last synced events.' : (e?.message || 'Couldn’t sync your calendar.'); }
  state.syncing = false; emit();
}
export async function connect({ name, url }) {
  const r = await api('/api/calendar', { body: { action: 'add', name, url } });
  await listFeeds(); await syncGoogle({ force: true }); return r;
}
export async function disconnect(id) { await api('/api/calendar', { body: { action: 'remove', id } }); await listFeeds(); await syncGoogle({ force: true }); }

export function startGcal() {
  if (hooked) return; hooked = true; listFeeds().then(() => syncGoogle({ force: true }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncGoogle(); }); window.addEventListener('online', () => syncGoogle({ force: true }));
  clearInterval(timer); timer = setInterval(() => syncGoogle(), 20 * 60000);
}
export const googleEventCount = () => store.all('events').filter((e) => e.origin === 'google').length;
