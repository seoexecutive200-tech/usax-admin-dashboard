// Audit trail: what LifeOS (or a suggestion you approved) changed, why, on what evidence — and how to undo it.
// Entries live in settings (so they sync). Creations can be undone any time (the created record is removed); other changes can be undone
// until the app is closed. Undoing is counted: if you keep reversing what LifeOS does, that's a signal to automate less.
import { store } from './store.js';
import { uid, nowISO } from './util.js';

const CAP = 150;
const STORE_OF = { create_log: 'logs', create_event: 'events', create_task: 'tasks', create_goal: 'goals', create_entry: 'entries', add_memory: 'memories', create_advisor_item: 'advisorItems' };
const session = new Map(); // audit id -> undo function (not persisted)
export const list = () => (store.settings().audit || []).slice().sort((a, b) => b.ts.localeCompare(a.ts));

/** Record a change. `res` is what an action handler returned ({ summary, undo, record }). */
export async function record(action, res, { source = 'ai', why = '', evidence = [] } = {}) {
  if (!res) return null;
  const st = STORE_OF[action.type]; const rec = res.record;
  const entry = { id: uid('aud'), ts: nowISO(), source, what: res.summary || action.type.replace(/_/g, ' '), why: String(why || '').slice(0, 300), evidence: evidence.slice(0, 6).map((e) => String(e).slice(0, 160)), inverse: st && rec?.id ? { store: st, id: rec.id } : null, undone: false };
  if (!entry.inverse && typeof res.undo === 'function') session.set(entry.id, res.undo);
  const all = [entry, ...(store.settings().audit || [])].slice(0, CAP);
  await store.setSettings({ audit: all });
  return entry;
}
export const canUndo = (e) => !e.undone && (!!(e.inverse && store.get(e.inverse.store, e.inverse.id)) || session.has(e.id));
export async function undo(id) {
  const all = store.settings().audit || []; const e = all.find((x) => x.id === id); if (!e || e.undone) return false;
  if (e.inverse) { if (store.get(e.inverse.store, e.inverse.id)) await store.remove(e.inverse.store, e.inverse.id); }
  else if (session.has(id)) await session.get(id)(); else return false;
  session.delete(id);
  await store.setSettings({ audit: all.map((x) => (x.id === id ? { ...x, undone: true, undoneAt: nowISO() } : x)) });
  return true;
}
/** How often you reverse what LifeOS did in the last 30 days — a correction-rate signal, not a score. */
export function correctionStats(days = 30) {
  const since = Date.now() - days * 86400000; const rows = list().filter((e) => +new Date(e.ts) >= since);
  const undone = rows.filter((e) => e.undone).length;
  return { total: rows.length, undone, rate: rows.length ? undone / rows.length : 0, high: rows.length >= 4 && undone / rows.length >= 0.4 };
}
