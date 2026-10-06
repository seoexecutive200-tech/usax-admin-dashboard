// Cleanup instead of more structure: finds duplicate tasks, tasks that keep slipping or went stale, and goals nobody has touched —
// then offers Keep / Drop / Someday (tasks) and Keep / Pause / Redesign / Archive (goals). Nothing changes until you choose.
import { store } from './store.js';
import * as T from './trackers.js';
import { dayKey, addDays, nowISO } from './util.js';

const DAY = 86400000;
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const fresh = (r) => r.reviewedAt && Date.now() - +new Date(r.reviewedAt) < 30 * DAY; // you said "keep" recently
const openTasks = () => store.all('tasks').filter((t) => t.status !== 'done');
export function scan(now = new Date()) {
  const tasks = openTasks(); const groups = new Map();
  for (const t of tasks) { const k = norm(t.title); if (k) (groups.get(k) || groups.set(k, []).get(k)).push(t); }
  const duplicates = [...groups.values()].filter((g) => g.length > 1);
  const dupIds = new Set(duplicates.flat().map((t) => t.id));
  const staleTasks = tasks.filter((t) => !dupIds.has(t.id) && !t.someday && !fresh(t) && (((t.rescheduleCount || 0) >= 3) || (+now - +new Date(t.createdAt) > 30 * DAY && (!t.due || +now - +new Date(t.due) > 14 * DAY))))
    .map((t) => ({ t, why: (t.rescheduleCount || 0) >= 3 ? `Moved ${t.rescheduleCount} times` : t.due ? `Overdue since ${dayKey(t.due)}` : 'Open for over 30 days with no date' }));
  const goals = [];
  for (const t of T.allTrackers()) { const f = T.primaryField(t); if (!f || f.target?.period !== 'goal' || t.paused || fresh(t)) continue; const last = T.entriesOf(t.id)[0]; const idle = (+now - +new Date(last?.ts || t.createdAt)) / DAY; if (idle >= 21) goals.push({ kind: 'trackers', id: t.id, name: t.name, idle: Math.round(idle) }); }
  for (const g of store.all('goals').filter((x) => x.status === 'active' && !fresh(x))) { const idle = (+now - +new Date(g.updatedAt || g.createdAt)) / DAY; if (idle >= 30) goals.push({ kind: 'goals', id: g.id, name: g.title, idle: Math.round(idle) }); }
  return { duplicates, staleTasks, goals, total: duplicates.length + staleTasks.length + goals.length };
}
const snapshot = (name, rec) => ({ name, rec: JSON.parse(JSON.stringify(rec)) });
/** Each returns a function that undoes it. */
export async function keepTask(id) { const p = snapshot('tasks', store.get('tasks', id)); await store.save('tasks', { id, reviewedAt: nowISO() }); return () => store.restore(p.name, p.rec); }
export async function dropTask(id) { const p = snapshot('tasks', store.get('tasks', id)); await store.remove('tasks', id); return () => store.restore(p.name, p.rec); }
export async function somedayTask(id) { const p = snapshot('tasks', store.get('tasks', id)); await store.save('tasks', { id, due: '', someday: true, reviewedAt: nowISO() }); return () => store.restore(p.name, p.rec); }
export async function mergeDuplicates(ids) {
  const recs = ids.map((i) => store.get('tasks', i)).filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); const snaps = recs.slice(1).map((r) => snapshot('tasks', r));
  for (const r of recs.slice(1)) await store.remove('tasks', r.id);
  return async () => { for (const s of snaps) await store.restore(s.name, s.rec); };
}
export async function goalAction(kind, id, action) {
  const rec = store.get(kind, id); if (!rec) return () => {}; const p = snapshot(kind, rec);
  if (action === 'keep') await store.save(kind, { id, reviewedAt: nowISO() });
  else if (action === 'pause') await store.save(kind, kind === 'trackers' ? { id, paused: true, pinned: false } : { id, status: 'paused' });
  else if (action === 'archive') await store.save(kind, kind === 'trackers' ? { id, archived: true } : { id, status: 'archived' });
  return () => store.restore(p.name, p.rec);
}
// ---- coming back after time away ----
export function lastActive() {
  const ts = [...store.all('logs').map((l) => l.ts), ...store.all('entries').map((e) => e.ts), ...store.all('checkins').filter((c) => c.status === 'answered').map((c) => c.ts), ...store.all('tasks').filter((t) => t.status === 'done').map((t) => t.updatedAt)].filter(Boolean).map((x) => +new Date(x));
  return ts.length ? Math.max(...ts) : 0;
}
export const daysAway = () => { const l = lastActive(); return l ? Math.floor((Date.now() - l) / DAY) : 0; };
export const overdueTasks = (now = new Date()) => openTasks().filter((t) => t.due && dayKey(t.due) < dayKey(now));
/** Fresh start: overdue tasks go to "Someday" — not deleted, not shamed. Returns an undo. */
export async function freshStart() {
  const list = overdueTasks(); const snaps = list.map((t) => snapshot('tasks', t));
  for (const t of list) await store.save('tasks', { id: t.id, due: '', someday: true });
  return { count: list.length, undo: async () => { for (const s of snaps) await store.restore(s.name, s.rec); } };
}
export const _ = addDays;
