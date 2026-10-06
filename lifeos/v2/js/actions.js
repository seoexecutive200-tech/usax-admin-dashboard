// Local tool actions. The model may PROPOSE these; nothing runs until validated here, and
// anything beyond a low-risk explicit log needs confirmation (enforced by requiresConfirm).
import { store } from './store.js';
import { addMemory, forget as forgetMem } from './memory.js';
import { addMinutes, clamp, isNum, nowISO, safeJSON, dayKey, fmtDate, fmtTime, addDays } from './util.js';
import { ACTION_TYPES } from './schemas.js';
import * as Audit from './audit.js';

export const LOG_TYPES = ['mood', 'energy', 'stress', 'focus', 'sleep', 'water', 'meal', 'workout', 'outdoor', 'steps', 'caffeine', 'screen', 'note', 'expense', 'income', 'custom'];
export const EVENT_TYPES = ['meeting', 'video_call', 'task', 'deadline', 'appointment', 'social', 'travel', 'workout', 'reminder', 'other'];
const SCALE = ['mood', 'energy', 'stress', 'focus'];
const parseDate = (v, fb = null) => { const d = new Date(v); return isNaN(d) ? fb : d; };
const str = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
const fail = (m) => { throw new Error(m); };

// Only these (and only when the user explicitly typed/commanded them) may execute without a confirm card.
const SILENT_OK = new Set(['create_log', 'add_memory', 'create_entry']);
export function requiresConfirm(action, explicit) {
  if (action.type.startsWith('delete_') || action.type === 'forget_memory') return true;
  return !(explicit && SILENT_OK.has(action.type));
}

const H = {
  async create_log(p) {
    const type = p.logType; if (!LOG_TYPES.includes(type)) fail('Unknown log type');
    let value = p.value === null || p.value === '' || p.value === undefined ? null : Number(p.value);
    if (type !== 'note' && type !== 'meal' && !isNum(value)) fail('A numeric value is needed');
    if (SCALE.includes(type)) value = clamp(Math.round(value), 1, 10);
    if (type === 'sleep') value = clamp(value, 0, 24);
    if (type === 'water') value = clamp(value, 1, 6000);
    const ts = parseDate(p.ts, new Date());
    const log = await store.save('logs', {
      type, value, unit: str(p.unit, 12), detail: str(p.detail, 600), ts: ts.toISOString(),
      meta: p.meta && typeof p.meta === 'object' ? p.meta : {}, source: p.source || 'manual', confidence: p.confidence ?? 1,
    });
    let fin = null;
    if (type === 'expense' || type === 'income') {
      fin = await store.save('finance', { kind: type, amount: value, label: str(p.meta?.label || p.detail, 80), category: str(p.meta?.category || 'general', 40), date: dayKey(ts), logId: log.id });
    }
    return {
      summary: `Logged ${type === 'note' ? 'note' : `${type} ${value ?? ''}`.trim()}`,
      async undo() { await store.remove('logs', log.id); if (fin) await store.remove('finance', fin.id); },
      record: log,
    };
  },
  async update_log(p) {
    const prev = store.get('logs', p.id) || fail('Log not found');
    const patch = pick(p, ['value', 'detail', 'ts']); if ('value' in patch) patch.value = Number(patch.value);
    await store.save('logs', { id: p.id, ...patch });
    return { summary: 'Updated log', undo: () => store.restore('logs', prev) };
  },
  async delete_log(p) {
    const prev = store.get('logs', p.id) || fail('Log not found');
    const fin = store.all('finance').filter((f) => f.logId === p.id);
    await store.remove('logs', p.id); for (const f of fin) await store.remove('finance', f.id);
    return { summary: 'Deleted log', async undo() { await store.restore('logs', prev); for (const f of fin) await store.restore('finance', f); } };
  },
  async create_event(p, ctx) {
    const title = str(p.title, 120) || fail('Event needs a title');
    const start = parseDate(p.start) || fail('Event needs a valid start time');
    const end = parseDate(p.end) || addMinutes(start, Number(p.durationMin) > 0 ? Number(p.durationMin) : 30);
    const ai = ctx.origin === 'ai';
    const ev = await store.save('events', {
      title, type: EVENT_TYPES.includes(p.type) ? p.type : 'other', start: start.toISOString(), end: end.toISOString(),
      timezone: store.profile().timezone, location: str(p.location, 200), notes: str(p.notes, 1000),
      importance: ['low', 'normal', 'high'].includes(p.importance) ? p.importance : 'normal',
      prepRequired: p.prepRequired ?? (p.importance === 'high'), prepStatus: 'none', status: 'scheduled', flex: FLEX.includes(p.flex) ? p.flex : (ai ? 'preferred' : 'fixed'),
      origin: ai ? 'ai' : 'user', aiState: ai ? (p.aiState || 'accepted') : undefined, checklist: [], rescheduleCount: 0,
    });
    return { summary: `Added “${title}” on ${fmtDate(start, { weekday: 'short', day: 'numeric', month: 'short' })} ${fmtTime(start)}`, undo: () => store.remove('events', ev.id), record: ev };
  },
  async update_event(p) {
    const prev = store.get('events', p.id) || fail('Event not found');
    const patch = pick(p, ['title', 'type', 'location', 'notes', 'importance', 'prepRequired', 'prepStatus', 'status', 'flex']);
    if (p.start) {
      const s = parseDate(p.start) || fail('Invalid start'); const dur = new Date(prev.end) - new Date(prev.start);
      patch.start = s.toISOString(); patch.end = (parseDate(p.end) || new Date(s.getTime() + dur)).toISOString();
      if (patch.start !== prev.start) patch.rescheduleCount = (prev.rescheduleCount || 0) + 1;
    }
    await store.save('events', { id: p.id, ...patch });
    return { summary: `Updated “${prev.title}”`, undo: () => store.restore('events', prev) };
  },
  async delete_event(p) {
    const prev = store.get('events', p.id) || fail('Event not found');
    await store.remove('events', p.id);
    return { summary: `Deleted “${prev.title}”`, undo: () => store.restore('events', prev) };
  },
  async create_task(p, ctx) {
    const title = str(p.title, 160) || fail('Task needs a title');
    const due = parseDate(p.due);
    const t = await store.save('tasks', { title, due: due ? due.toISOString() : '', status: 'open', origin: ctx.origin === 'ai' ? 'ai' : 'user', eventId: p.eventId || null, rescheduleCount: 0, flex: FLEX.includes(p.flex) ? p.flex : 'flexible' });
    return { summary: `Added task “${title}”`, undo: () => store.remove('tasks', t.id), record: t };
  },
  async update_task(p) {
    const prev = store.get('tasks', p.id) || fail('Task not found');
    await store.save('tasks', { id: p.id, ...pick(p, ['title', 'status', 'due', 'flex']) });
    return { summary: 'Updated task', undo: () => store.restore('tasks', prev) };
  },
  async reschedule_task(p) {
    const prev = store.get('tasks', p.id) || fail('Task not found');
    const due = parseDate(p.due) || fail('Invalid date');
    await store.save('tasks', { id: p.id, due: due.toISOString(), rescheduleCount: (prev.rescheduleCount || 0) + 1 });
    return { summary: 'Rescheduled task', undo: () => store.restore('tasks', prev) };
  },
  async create_goal(p) {
    const title = str(p.title, 160) || fail('Goal needs a title');
    const metric = ['sleep', 'water', 'workout', 'steps'].includes(p.metric) ? p.metric : null;
    const g = await store.save('goals', { title, metric, target: isNum(Number(p.target)) && Number(p.target) > 0 ? Number(p.target) : null, priority: 'normal', status: 'active', notes: str(p.notes, 400), start: nowISO() });
    return { summary: `Added goal “${title}”`, undo: () => store.remove('goals', g.id), record: g };
  },
  async update_goal(p) {
    const prev = store.get('goals', p.id) || fail('Goal not found');
    await store.save('goals', { id: p.id, ...pick(p, ['title', 'status', 'notes', 'target']) });
    return { summary: 'Updated goal', undo: () => store.restore('goals', prev) };
  },
  async add_memory(p) {
    const kind = p.kind === 'temporary_context' ? 'temporary_context' : p.kind === 'goal' ? 'goal' : 'preference';
    const m = await addMemory({ text: p.text, kind, source: kind === 'goal' ? 'goal' : 'user_explicit', expiresInDays: kind === 'temporary_context' ? Number(p.expiresInDays) || 7 : null });
    if (!m) fail('Nothing to remember');
    return { summary: 'Remembered', undo: () => store.remove('memories', m.id), record: m };
  },
  async update_memory(p) {
    const prev = store.get('memories', p.id) || fail('Memory not found');
    await store.save('memories', { id: p.id, ...pick(p, ['text']), lastConfirmedAt: nowISO() });
    return { summary: 'Updated memory', undo: () => store.restore('memories', prev) };
  },
  async forget_memory(p) {
    const prev = store.get('memories', p.id) || fail('Memory not found');
    await forgetMem(p.id);
    return { summary: 'Forgot memory', undo: () => store.restore('memories', prev) };
  },
  async create_advisor_item(p) {
    const it = await store.save('advisorItems', { message: str(p.message, 600), priority: Number(p.priority) || 5, reason: str(p.reason, 400), decision: 'suggest', source: 'ai', status: 'active', expiresAt: addDays(new Date(), 1).toISOString() });
    return { summary: 'Added advisor note', undo: () => store.remove('advisorItems', it.id) };
  },
  async dismiss_advisor_item(p) {
    const prev = store.get('advisorItems', p.id) || fail('Item not found');
    await store.save('advisorItems', { id: p.id, status: 'dismissed' });
    return { summary: 'Dismissed', undo: () => store.restore('advisorItems', prev) };
  },
  async create_experiment(p) {
    const metric = ['sleep', 'mood', 'energy', 'stress', 'focus', 'water', 'workout'].includes(p.metric) ? p.metric : 'energy';
    const days = clamp(Number(p.durationDays) || 7, 3, 28);
    const e = await store.save('experiments', { hypothesis: str(p.hypothesis, 300) || fail('Hypothesis needed'), intervention: str(p.intervention, 300), metric, start: nowISO(), end: addDays(new Date(), days).toISOString(), status: 'running', measures: [metric] });
    return { summary: 'Started experiment', undo: () => store.remove('experiments', e.id), record: e };
  },
  async finish_experiment(p) {
    const prev = store.get('experiments', p.id) || fail('Experiment not found');
    await store.save('experiments', { id: p.id, status: 'finished', finishedAt: nowISO() });
    return { summary: 'Finished experiment', undo: () => store.restore('experiments', prev) };
  },
  async create_entry(p) {
    const t = store.get('trackers', p.trackerId) || fail('That tracker no longer exists');
    const values = {}; const raw = p.values && typeof p.values === 'object' ? p.values : {};
    for (const f of t.fields) {
      let v = raw[f.id]; if (v === undefined || v === null || v === '') continue;
      if (f.type === 'yesno') v = v === true || v === 'true' || v === 1 || v === 'yes';
      else if (f.type === 'choice') { if (!(f.options || []).includes(v)) continue; }
      else if (f.type === 'text') v = str(v, 400);
      else { v = Number(v); if (!isNum(v)) continue; if (f.type === 'scale' || f.type === 'rating') v = clamp(Math.round(v), 1, f.max || 10); else { if (isNum(f.min)) v = Math.max(f.min, v); if (isNum(f.max)) v = Math.min(f.max, v); } }
      values[f.id] = v;
    }
    if (!Object.keys(values).length) fail('Enter at least one value');
    const ts = parseDate(p.ts, new Date());
    const e = await store.save('entries', { trackerId: t.id, ts: ts.toISOString(), values, note: str(p.note, 400), source: p.source || 'manual', raw: str(p.raw, 300) });
    const { run } = await import('./rules.js'); const fired = await run({ entry: e, trackerId: t.id }).catch(() => []);
    return { summary: `Logged ${t.name}`, undo: () => store.remove('entries', e.id), record: e, fired };
  },
  async update_entry(p) {
    const prev = store.get('entries', p.id) || fail('Entry not found'); const t = store.get('trackers', prev.trackerId) || fail('Tracker not found');
    const values = { ...prev.values };
    for (const f of t.fields) if (p.values && f.id in p.values) { const v = p.values[f.id]; if (v === '' || v === null) delete values[f.id]; else values[f.id] = f.type === 'yesno' ? (v === true || v === 'true') : f.type === 'text' || f.type === 'choice' ? v : Number(v); }
    await store.save('entries', { id: prev.id, values, ...(p.note !== undefined ? { note: str(p.note, 400) } : {}), ...(p.ts ? { ts: parseDate(p.ts, new Date(prev.ts)).toISOString() } : {}) });
    return { summary: 'Updated entry', undo: () => store.restore('entries', prev) };
  },
  async delete_entry(p) {
    const prev = store.get('entries', p.id) || fail('Entry not found');
    await store.remove('entries', p.id);
    return { summary: 'Deleted entry', undo: () => store.restore('entries', prev) };
  },
  async generate_daily_report() { const { generateDaily } = await import('./reports.js'); await generateDaily(dayKey(), { force: true }); return { summary: 'Daily report ready', undo: async () => {} }; },
  async generate_weekly_report() { const { generateWeekly } = await import('./reports.js'); await generateWeekly(undefined, { force: true }); return { summary: 'Weekly report ready', undo: async () => {} }; },
};

export function parsePayload(a) {
  if (a.payload && typeof a.payload === 'object') return a.payload;
  const p = safeJSON(a.payloadJson, null);
  return p && typeof p === 'object' ? p : {};
}
export const FLEX = ['fixed', 'preferred', 'flexible'];
const MOVES = new Set(['update_event', 'reschedule_task', 'update_task']);
export async function execute(action, { origin = 'user', why = '', evidence = [], source = '' } = {}) {
  if (!ACTION_TYPES.includes(action.type) || !H[action.type]) throw new Error('That action is not permitted.');
  const p = parsePayload(action);
  // Fixed items are never moved by the AI — only by you.
  if (origin === 'ai' && MOVES.has(action.type) && (p.start || p.due || p.end)) { const t = store.get(action.type === 'update_event' ? 'events' : 'tasks', p.id); if (t && t.flex === 'fixed') throw new Error(`“${t.title}” is marked Fixed, so I won’t move it.`); }
  const res = await H[action.type](p, { origin });
  if (origin === 'ai' || why) { try { await Audit.record(action, res, { source: source || (origin === 'ai' ? 'ai' : 'suggestion'), why, evidence }); } catch { /* the audit trail must never block an action */ } }
  return res;
}
export function describe(action) {
  const p = parsePayload(action);
  const t = action.type.replace(/_/g, ' ');
  const detail = p.title || p.text || p.hypothesis || (p.logType ? `${p.logType} ${p.value ?? ''}` : '') || '';
  const when = p.start ? ` · ${fmtDate(p.start, { weekday: 'short', day: 'numeric', month: 'short' })} ${fmtTime(p.start)}` : p.due ? ` · due ${fmtDate(p.due, { weekday: 'short', day: 'numeric', month: 'short' })}` : '';
  return { label: t.charAt(0).toUpperCase() + t.slice(1), detail: `${detail}${when}`.trim() };
}
