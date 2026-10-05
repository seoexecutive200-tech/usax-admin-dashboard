// User-written rules ("if I log under 6 hours twice this week, remind me…"). Rules are plain data; this engine is generic and local.
// A fired rule becomes an advisor item (shown on Today) and, if allowed, a notification. Nothing here calls the AI.
import { store } from './store.js';
import * as T from './trackers.js';
import { dayKey, addDays, isNum, uid, nowISO, round } from './util.js';
import { notify } from './routines.js';

export const KINDS = { threshold: 'A single value crosses a limit', count: 'It happens N times within some days', streak: 'N days in a row', missing: 'Nothing logged' };
export const OPS = { '>': 'above', '>=': 'at least', '<': 'below', '<=': 'at most', '=': 'exactly' };
const cmpOp = (v, op, x) => (op === '>' ? v > x : op === '>=' ? v >= x : op === '<' ? v < x : op === '<=' ? v <= x : v === x);
const str = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export function normalizeRule(raw, trackerId = null) {
  const errors = []; const r = raw && typeof raw === 'object' ? raw : {};
  const tid = trackerId || r.trackerId; const t = store.get('trackers', tid);
  if (!t) errors.push('Pick a tracker for this rule.');
  const kind = KINDS[r.kind] ? r.kind : 'threshold';
  const field = t?.fields.find((f) => f.id === r.field) || null;
  const needsCond = kind === 'threshold';
  if (needsCond && (!field || !OPS[r.op] || !isNum(Number(r.value)) || r.value === '' || r.value == null)) errors.push('Choose what to compare (value, comparison and number).');
  const rule = {
    name: str(r.name, 60) || (t ? `${t.name} rule` : 'Rule'), trackerId: tid, kind, field: field?.id || '', op: OPS[r.op] ? r.op : '', value: isNum(Number(r.value)) && r.value !== '' && r.value != null ? Number(r.value) : null,
    windowDays: Math.round(Math.min(60, Math.max(1, Number(r.windowDays) || 7))), count: Math.round(Math.min(60, Math.max(1, Number(r.count) || 2))), byTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(r.byTime) ? r.byTime : '',
    message: str(r.message, 160), enabled: r.enabled !== false, nl: str(r.nl, 300), origin: ['user', 'ai'].includes(r.origin) ? r.origin : 'user',
  };
  if (!rule.message) errors.push('Write the message you want to see.');
  if (kind === 'missing' && !rule.byTime && !r.windowDays) rule.windowDays = 2;
  return { ok: !errors.length, errors, rule };
}
export const allRules = () => store.all('rules');
export const rulesFor = (tid) => allRules().filter((r) => r.trackerId === tid);

function entryMatches(rule, t, entry) {
  if (!rule.field) return true;
  const f = t.fields.find((x) => x.id === rule.field); if (!f) return false;
  const v = entry.values?.[f.id]; const n = v === true ? 1 : v === false ? 0 : Number(v);
  return isNum(n) && rule.op ? cmpOp(n, rule.op, rule.value) : true;
}
const fill = (msg, rule, t, ctx) => msg.replace(/\{value\}/g, ctx.value ?? '').replace(/\{count\}/g, ctx.count ?? '').replace(/\{tracker\}/g, t.name);

/** Evaluate one rule now. Returns { fired, detail, value?, count? }. `entry` is the entry just saved (for threshold rules). */
export function evaluate(rule, now = new Date(), entry = null) {
  const t = store.get('trackers', rule.trackerId); if (!t || t.archived) return { fired: false };
  const entries = T.entriesOf(t.id);
  if (rule.kind === 'threshold') {
    const e = entry || entries[0]; if (!e || dayKey(e.ts) !== dayKey(now)) return { fired: false };
    if (!entryMatches(rule, t, e)) return { fired: false };
    const f = t.fields.find((x) => x.id === rule.field); const v = e.values?.[f?.id];
    return { fired: true, value: f ? T.formatValue(f, v) : '', detail: f ? `${f.label} ${OPS[rule.op]} ${rule.value} (logged ${T.formatValue(f, v)})` : 'Logged' };
  }
  if (rule.kind === 'count') {
    const since = dayKey(addDays(now, -(rule.windowDays - 1)));
    const n = entries.filter((e) => dayKey(e.ts) >= since && entryMatches(rule, t, e)).length;
    return { fired: n >= rule.count, count: n, detail: `${n} matching entr${n === 1 ? 'y' : 'ies'} in the last ${rule.windowDays} day${rule.windowDays === 1 ? '' : 's'}` };
  }
  if (rule.kind === 'streak') {
    let n = 0; let d = new Date(now);
    const dayOk = (k) => T.entriesOnDay(t.id, k).some((e) => entryMatches(rule, t, e));
    if (!dayOk(dayKey(d))) d = addDays(d, -1);
    while (dayOk(dayKey(d))) { n++; d = addDays(d, -1); }
    return { fired: n >= rule.count, count: n, detail: `${n} day${n === 1 ? '' : 's'} in a row` };
  }
  if (rule.kind === 'missing') {
    if (rule.byTime) { const [h, m] = rule.byTime.split(':').map(Number); const at = new Date(now); at.setHours(h, m, 0, 0); const fired = now >= at && !T.dayEntriesExist(t, dayKey(now)); return { fired, detail: `Nothing logged by ${rule.byTime}` }; }
    const last = entries[0]; const days = last ? Math.floor((now - new Date(last.ts)) / 86400000) : null;
    return { fired: last ? days >= rule.windowDays : T.allTrackers().includes(t) && (now - new Date(t.createdAt)) / 86400000 >= rule.windowDays, count: days ?? rule.windowDays, detail: last ? `Last logged ${days} day${days === 1 ? '' : 's'} ago` : 'Nothing logged yet' };
  }
  return { fired: false };
}

/** Run all enabled rules (optionally only those for one tracker). Creates advisor items + notifications; one per rule per day. */
export async function run({ entry = null, trackerId = null, now = new Date() } = {}) {
  const fired = [];
  for (const rule of allRules()) {
    if (rule.enabled === false || (trackerId && rule.trackerId !== trackerId)) continue;
    if (rule.kind === 'threshold' && !entry) continue; // threshold rules react to a new log
    const key = `rule:${rule.id}:${dayKey(now)}`;
    if (store.all('advisorItems').some((i) => i.key === key)) continue;
    const res = evaluate(rule, now, entry); if (!res.fired) continue;
    const t = store.get('trackers', rule.trackerId); const msg = fill(rule.message, rule, t, res);
    await store.save('advisorItems', {
      key, kind: 'rule', ruleId: rule.id, dayKey: dayKey(now), priority: 1, status: 'active', decision: 'suggest', source: 'rule', message: msg, feedback: null, outcome: null,
      evidence: [{ kind: 'observed', text: res.detail }, { kind: 'unknown', text: `This is your own rule${rule.nl ? `: “${rule.nl}”` : ` “${rule.name}”`}. LifeOS only checks it; it doesn’t judge it.` }],
      confidence: 1, uncertainty: '', primaryAction: '', secondaryOptions: [], proposedActions: [], expiresAt: addDays(now, 1).toISOString(),
    });
    await store.save('rules', { id: rule.id, lastFired: nowISO() });
    notify(`${t.name}`, msg, key);
    fired.push({ rule, msg });
  }
  return fired;
}
export const newId = () => uid('rul');
