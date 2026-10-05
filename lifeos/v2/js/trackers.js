// User-defined trackers: the generic engine. A tracker is just data (fields, targets, reminders); nothing here knows about
// "sleep" or "water". Everything the app shows for a tracker — logging form, charts, targets, routing, rules — is driven by its spec.
import { store } from './store.js';
import { dayKey, addDays, parseKey, startOfWeek, mean, sum, isNum, round, uid, clamp, fmtTime } from './util.js';
import * as A from './analytics.js';

export const FIELD_TYPES = { number: 'Number', scale: 'Scale (1–10)', duration: 'Duration (min)', rating: 'Rating (1–5)', yesno: 'Yes / No', choice: 'Choice', text: 'Text' };
export const AGGS = { sum: 'Total', avg: 'Average', last: 'Latest', count: 'Count', max: 'Highest', min: 'Lowest' };
export const COLORS = ['blue', 'violet', 'green', 'amber', 'coral', 'pink', 'teal'];
export const COLOR_VAR = { blue: 'var(--blue)', violet: 'var(--violet)', green: 'var(--green)', amber: 'var(--amber)', coral: 'var(--coral)', pink: 'var(--pink)', teal: '#2dd4bf' };
export const ICON_KEYS = ['target', 'droplet', 'moon', 'heart', 'bolt', 'dumbbell', 'walk', 'coffee', 'utensils', 'note', 'brain', 'smile', 'sun', 'wallet', 'clock', 'flag', 'users', 'calendar', 'mountain', 'sparkle'];
const NUMERIC = new Set(['number', 'scale', 'duration', 'rating']);
export const isNumericField = (f) => NUMERIC.has(f.type);
const DEFAULT_AGG = { number: 'avg', scale: 'avg', duration: 'sum', rating: 'avg', yesno: 'count', choice: 'count', text: 'count' };
const str = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const slug = (s) => str(s, 40).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'field';

// ---------- spec validation / normalisation (used for manual, AI-designed and imported trackers) ----------
export function normalizeTracker(raw) {
  const errors = []; const r = raw && typeof raw === 'object' ? raw : {};
  const name = str(r.name, 40); if (!name) errors.push('Give the tracker a name.');
  const used = new Set(); const fields = [];
  for (const f of (Array.isArray(r.fields) ? r.fields : []).slice(0, 12)) {
    const type = FIELD_TYPES[f?.type] ? f.type : 'number'; const label = str(f?.label, 40) || 'Value';
    let id = slug(f?.id || label); let n = 2; while (used.has(id)) id = `${slug(label)}_${n++}`; used.add(id);
    const field = { id, label, type, agg: AGGS[f?.agg] ? f.agg : DEFAULT_AGG[type], unit: str(f?.unit, 12) };
    if (type === 'scale') { field.min = 1; field.max = clamp(Math.round(Number(f?.max)) || 10, 3, 10); }
    else if (type === 'rating') { field.min = 1; field.max = 5; }
    else if (type === 'number' || type === 'duration') { if (isNum(Number(f?.min)) && f?.min !== '' && f?.min != null) field.min = Number(f.min); if (isNum(Number(f?.max)) && f?.max !== '' && f?.max != null && Number(f.max) !== 0) field.max = Number(f.max); }
    if (type === 'choice') { field.options = [...new Set((Array.isArray(f?.options) ? f.options : String(f?.options || '').split(',')).map((o) => str(o, 30)).filter(Boolean))].slice(0, 12); if (field.options.length < 2) errors.push(`“${label}” needs at least two choices.`); }
    const tv = Number(f?.target?.value ?? f?.targetValue);
    if (isNum(tv) && tv > 0 && NUMERIC.has(type) || (isNum(tv) && tv > 0 && (type === 'yesno'))) field.target = { value: tv, period: (f?.target?.period || f?.targetPeriod) === 'week' ? 'week' : 'day', dir: (f?.target?.dir || f?.targetDir) === 'atmost' ? 'atmost' : 'atleast' };
    const q = (Array.isArray(f?.quick) ? f.quick : String(f?.quick || '').split(',')).map(Number).filter((x) => isNum(x) && x > 0).slice(0, 5);
    if (q.length && (type === 'number' || type === 'duration')) field.quick = q;
    fields.push(field);
  }
  if (!fields.length) errors.push('Add at least one thing to record.');
  const reminders = (Array.isArray(r.reminders) ? r.reminders : []).slice(0, 8).map((x) => ({ id: str(x?.id, 20) || uid('rem'), time: /^([01]\d|2[0-3]):[0-5]\d$/.test(x?.time) ? x.time : null, days: [...new Set((Array.isArray(x?.days) && x.days.length ? x.days : [0, 1, 2, 3, 4, 5, 6]).map(Number).filter((d) => d >= 0 && d <= 6))], text: str(x?.text, 80) })).filter((x) => x.time);
  const spec = {
    name, icon: ICON_KEYS.includes(r.icon) ? r.icon : 'target', color: COLORS.includes(r.color) ? r.color : 'blue', description: str(r.description, 200),
    keywords: [...new Set((Array.isArray(r.keywords) ? r.keywords : String(r.keywords || '').split(',')).map((k) => str(k, 30).toLowerCase()).filter(Boolean))].slice(0, 12),
    fields, reminders, pinned: r.pinned !== false, archived: !!r.archived, private: !!r.private, origin: ['user', 'ai', 'template'].includes(r.origin) ? r.origin : 'user',
  };
  return { ok: !errors.length, errors, spec };
}

// ---------- reading ----------
export const allTrackers = () => store.all('trackers').filter((t) => !t.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt.localeCompare(b.createdAt));
export const pinnedTrackers = () => allTrackers().filter((t) => t.pinned);
export const archivedTrackers = () => store.all('trackers').filter((t) => t.archived);
let cacheVer = -1; let byTracker = new Map();
function index() {
  if (cacheVer === store.version()) return byTracker;
  byTracker = new Map();
  for (const e of store.all('entries')) { if (!byTracker.has(e.trackerId)) byTracker.set(e.trackerId, []); byTracker.get(e.trackerId).push(e); }
  for (const l of byTracker.values()) l.sort((a, b) => b.ts.localeCompare(a.ts));
  cacheVer = store.version(); return byTracker;
}
export const entriesOf = (tid) => index().get(tid) || [];
export const entriesOnDay = (tid, key) => entriesOf(tid).filter((e) => dayKey(e.ts) === key);
export const primaryField = (t) => t.fields.find((f) => NUMERIC.has(f.type)) || t.fields.find((f) => f.type === 'yesno') || t.fields[0];

function rawValues(entries, field) {
  return entries.map((e) => e.values?.[field.id]).filter((v) => v !== undefined && v !== null && v !== '');
}
function aggregate(vals, agg, field) {
  if (!vals.length) return null;
  if (agg === 'count') return field.type === 'yesno' ? vals.filter((v) => v === true || v === 1 || v === 'yes').length : vals.length;
  const nums = vals.map((v) => (v === true ? 1 : v === false ? 0 : Number(v))).filter(isNum);
  if (!nums.length) return null;
  return agg === 'sum' ? sum(nums) : agg === 'avg' ? mean(nums) : agg === 'max' ? Math.max(...nums) : agg === 'min' ? Math.min(...nums) : nums[0]; // 'last': entries are newest-first
}
export function dayValue(t, field, key) { return aggregate(rawValues(entriesOnDay(t.id, key), field), field.agg, field); }
export function dayEntriesExist(t, key) { return entriesOnDay(t.id, key).length > 0; }
export function series(t, field, days, end = new Date()) {
  return Array.from({ length: days }, (_, i) => { const k = dayKey(addDays(end, -(days - 1 - i))); return { key: k, value: dayValue(t, field, k) }; });
}
/** Progress toward a field's target: { value, target, pct, dir, period, met }. */
export function progress(t, field, now = new Date()) {
  const tg = field.target; if (!tg) return null;
  let value;
  if (tg.period === 'week') { const ws = startOfWeek(now); const days = Array.from({ length: 7 }, (_, i) => dayKey(addDays(ws, i))); const vals = days.map((k) => dayValue(t, field, k)).filter(isNum); value = vals.length ? (field.agg === 'avg' ? mean(vals) : field.agg === 'max' ? Math.max(...vals) : field.agg === 'min' ? Math.min(...vals) : sum(vals)) : 0; }
  else value = dayValue(t, field, dayKey(now)) ?? 0;
  const pct = clamp(value / tg.value, 0, 1.5);
  return { value, target: tg.value, pct, dir: tg.dir, period: tg.period, met: tg.dir === 'atmost' ? value <= tg.value : value >= tg.value };
}
export function stats(t, field, days = 30) {
  const pts = series(t, field, days).filter((p) => isNum(p.value));
  const vals = pts.map((p) => p.value);
  const all = rawValues(entriesOf(t.id).filter((e) => dayKey(e.ts) >= dayKey(addDays(new Date(), -(days - 1)))), field);
  return { days: pts.length, avg: mean(vals), min: vals.length ? Math.min(...vals) : null, max: vals.length ? Math.max(...vals) : null, total: sum(vals), entries: all.length };
}
export function streak(t, now = new Date()) {
  let n = 0; let d = new Date(now);
  if (!dayEntriesExist(t, dayKey(d))) d = addDays(d, -1); // today may not be logged yet
  while (dayEntriesExist(t, dayKey(d))) { n++; d = addDays(d, -1); }
  return n;
}
export function formatValue(field, v) {
  if (v === null || v === undefined || v === '') return '–';
  if (field.type === 'yesno') return v === true || v === 1 || v === 'yes' ? 'Yes' : 'No';
  if (field.type === 'text' || field.type === 'choice') return String(v);
  const n = Number(v); const out = Math.abs(n) >= 100 ? Math.round(n).toLocaleString() : String(round(n, 1));
  return `${out}${field.unit ? ` ${field.unit}` : field.type === 'duration' ? ' min' : field.type === 'scale' ? `/${field.max || 10}` : field.type === 'rating' ? '/5' : ''}`;
}
export function summaryLine(t, now = new Date()) {
  const f = primaryField(t); if (!f) return '';
  const p = progress(t, f, now); const key = dayKey(now);
  if (p) return `${formatValue({ ...f, unit: '' }, p.value)} / ${formatValue(f, p.target)}${p.period === 'week' ? ' this week' : ''}`;
  const v = dayValue(t, f, key);
  if (v !== null) return `${f.label}: ${formatValue(f, v)} today`;
  const last = entriesOf(t.id)[0]; return last ? `Last: ${formatValue(f, last.values?.[f.id])} · ${dayKey(last.ts) === key ? fmtTime(last.ts) : last.ts.slice(5, 10)}` : 'Nothing logged yet';
}

// ---------- reminders ----------
const lastLoggedToday = (t, now) => entriesOnDay(t.id, dayKey(now)).filter((e) => new Date(e.ts) <= now);
/** Reminders due now (within the last 45 min, not already satisfied by a log since the reminder time). */
export function dueReminders(now = new Date()) {
  const out = [];
  for (const t of allTrackers()) for (const r of t.reminders || []) {
    if (!(r.days || []).includes(now.getDay())) continue;
    const [h, m] = r.time.split(':').map(Number); const at = new Date(now); at.setHours(h, m, 0, 0);
    const mins = (now - at) / 60000; if (mins < 0 || mins > 45) continue;
    if (lastLoggedToday(t, now).some((e) => new Date(e.ts) >= addDays(at, 0) && new Date(e.ts) >= new Date(+at - 30 * 60000))) continue;
    out.push({ key: `trk:${t.id}:${r.id}:${dayKey(now)}`, tracker: t, text: r.text || `Time to log ${t.name.toLowerCase()}`, at });
  }
  return out;
}

// ---------- starter templates (optional: nothing is preloaded) ----------
export const TEMPLATES = [
  { name: 'Water', icon: 'droplet', color: 'teal', description: 'Hydration through the day', keywords: ['water', 'drank', 'glass'], fields: [{ label: 'Amount', type: 'number', unit: 'ml', agg: 'sum', target: { value: 2000, period: 'day', dir: 'atleast' }, quick: [250, 500] }] },
  { name: 'Sleep', icon: 'moon', color: 'violet', description: 'Hours slept and how it felt', keywords: ['sleep', 'slept'], fields: [{ label: 'Hours', type: 'number', unit: 'h', agg: 'last', min: 0, max: 16, target: { value: 7, period: 'day', dir: 'atleast' } }, { label: 'Quality', type: 'rating', agg: 'last' }] },
  { name: 'Mood', icon: 'smile', color: 'amber', description: 'A quick check-in on how you feel', keywords: ['mood', 'feeling'], fields: [{ label: 'Mood', type: 'scale', agg: 'avg' }, { label: 'Note', type: 'text' }] },
  { name: 'Medication', icon: 'heart', color: 'pink', description: 'Did I take it?', keywords: ['medication', 'meds', 'pill', 'tablet'], fields: [{ label: 'Taken', type: 'yesno', agg: 'count' }], reminders: [{ time: '09:00', days: [0, 1, 2, 3, 4, 5, 6], text: 'Take your medication' }] },
  { name: 'Workout', icon: 'dumbbell', color: 'green', description: 'Training sessions', keywords: ['workout', 'gym', 'trained', 'run', 'ran', 'lifted'], fields: [{ label: 'Type', type: 'choice', options: ['Run', 'Strength', 'Yoga', 'Cycle', 'Other'] }, { label: 'Time', type: 'duration', agg: 'sum', target: { value: 150, period: 'week', dir: 'atleast' } }, { label: 'Effort', type: 'scale', agg: 'avg' }] },
  { name: 'Study', icon: 'brain', color: 'blue', description: 'Focused study or deep-work time', keywords: ['study', 'studied', 'revision', 'deep work'], fields: [{ label: 'Time', type: 'duration', agg: 'sum', target: { value: 120, period: 'day', dir: 'atleast' } }, { label: 'Topic', type: 'text' }] },
  { name: 'Caffeine', icon: 'coffee', color: 'coral', description: 'Cups of coffee or tea', keywords: ['coffee', 'tea', 'espresso', 'caffeine'], fields: [{ label: 'Cups', type: 'number', unit: 'cups', agg: 'sum', quick: [1, 2], target: { value: 3, period: 'day', dir: 'atmost' } }] },
  { name: 'Weight', icon: 'target', color: 'blue', description: 'Body weight over time', keywords: ['weight', 'weigh', 'weighed'], fields: [{ label: 'Weight', type: 'number', unit: 'kg', agg: 'last' }] },
  { name: 'Gratitude', icon: 'sparkle', color: 'amber', description: 'One good thing from today', keywords: ['grateful', 'gratitude'], fields: [{ label: 'Entry', type: 'text' }] },
];

// ---------- natural-language routing: which tracker is this sentence about? ----------
const NEG = /\b(no|not|didn'?t|did not|never|skipped|missed|forgot|without)\b/i;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (text, w) => new RegExp(`(^|[^a-z0-9])${esc(w)}(s|es|ed|ing)?([^a-z0-9]|$)`, 'i').test(text);
function numberNear(text, field) {
  const unit = field.unit?.toLowerCase();
  const num = '(\\d+(?:[.,]\\d+)?)';
  let m;
  if (unit && (m = text.match(new RegExp(`${num}\\s*${esc(unit)}\\b`, 'i')))) return Number(m[1].replace(',', '.'));
  if (field.type === 'duration') {
    if ((m = text.match(/(\d+)\s*h(?:ours?|rs?)?\s*(\d+)?\s*(?:m|min)?/i)) && /h/i.test(m[0])) return Number(m[1]) * 60 + Number(m[2] || 0);
    if ((m = text.match(/(\d+(?:\.\d+)?)\s*(?:min|mins|minutes?)/i))) return Number(m[1]);
  }
  const label = field.label.toLowerCase();
  if ((m = text.match(new RegExp(`${esc(label)}\\D{0,12}${num}`, 'i'))) || (m = text.match(new RegExp(`${num}\\s*(?:/\\s*\\d+)?\\s*${esc(label)}`, 'i')))) return Number(m[1].replace(',', '.'));
  return null;
}
/** Returns candidates (best first) for trackers the text is about. */
export function routeText(text, now = new Date()) {
  const lower = text.toLowerCase(); const out = [];
  for (const t of allTrackers()) {
    const names = [t.name.toLowerCase(), ...(t.keywords || [])];
    const nameHit = names.some((n) => hasWord(lower, n));
    const labelHit = t.fields.some((f) => f.label.length > 2 && hasWord(lower, f.label.toLowerCase()) && !['value', 'note', 'amount', 'time'].includes(f.label.toLowerCase()));
    const unitHit = t.fields.some((f) => f.unit && new RegExp(`\\d\\s*${esc(f.unit.toLowerCase())}\\b`).test(lower));
    if (!nameHit && !labelHit && !unitHit) continue;
    const values = {}; let missing = 0; const nums = [...lower.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(',', '.')));
    let usedFallback = false;
    for (const f of t.fields) {
      if (NUMERIC.has(f.type)) {
        let v = numberNear(text, f);
        if (v === null && nums.length && t.fields.filter((x) => NUMERIC.has(x.type)).length === 1) { v = nums[0]; usedFallback = true; }
        if (v === null && (f.type === 'scale' || f.type === 'rating')) { const m = lower.match(/\b(\d{1,2})\s*(?:\/|out of)\s*\d+\b/); if (m) v = Number(m[1]); }
        if (v !== null) values[f.id] = f.type === 'scale' || f.type === 'rating' ? clamp(Math.round(v), 1, f.max || 10) : v; else if (f === primaryField(t)) missing++; // only the main value is required; the rest are optional
      } else if (f.type === 'yesno') values[f.id] = !(NEG.test(text));
      else if (f.type === 'choice') { const o = (f.options || []).find((op) => hasWord(lower, op.toLowerCase())); if (o) values[f.id] = o; }
      else if (f.type === 'text') { const rest = text.replace(/\d+(?:[.,]\d+)?\s*[a-z%/]*/gi, ' ').replace(new RegExp(names.map(esc).join('|'), 'gi'), ' ').replace(/\s+/g, ' ').trim(); if (rest.length > 1) values[f.id] = rest.slice(0, 200); }
    }
    const score = (nameHit ? 0.5 : 0) + (labelHit ? 0.2 : 0) + (unitHit ? 0.3 : 0) + (missing === 0 ? 0.2 : 0) - (usedFallback && !nameHit ? 0.2 : 0);
    const confidence = clamp(0.35 + score, 0, 0.95);
    out.push({ type: 'tracker_entry', trackerId: t.id, values, missing, confidence, source: 'local', needsConfirmation: confidence < 0.8 || missing > 0, summary: `${t.name}: ${t.fields.map((f) => (values[f.id] !== undefined ? formatValue(f, values[f.id]) : null)).filter(Boolean).join(' · ') || '(fill in)'}`, clarification: missing ? `Missing: ${t.fields.filter((f) => NUMERIC.has(f.type) && values[f.id] === undefined).map((f) => f.label).join(', ')}` : '' });
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}

// ---------- generic series (built-in metrics + any tracker field) for Ask / Compare / Rules ----------
const BUILTIN = [['sleep', 'Sleep', 'h'], ['mood', 'Mood', '/10'], ['energy', 'Energy', '/10'], ['stress', 'Stress', '/10'], ['focus', 'Focus', '/10'], ['water', 'Water (built-in)', 'ml'], ['workout', 'Movement', 'min'], ['outdoor', 'Outdoor time', 'min'], ['steps', 'Steps', '']];
export function seriesRefs() {
  const out = []; const classic = store.settings().mode !== 'custom';
  for (const t of allTrackers()) for (const f of t.fields) if (NUMERIC.has(f.type) || f.type === 'yesno') out.push({ ref: `t:${t.id}:${f.id}`, label: t.fields.length > 1 ? `${t.name} · ${f.label}` : t.name, unit: f.unit || '', zero: f.agg === 'sum' || f.agg === 'count' }); // the user's own things first
  if (classic) { const taken = new Set(out.map((o) => o.label.toLowerCase())); for (const [k, label, unit] of BUILTIN) out.push({ ref: `b:${k}`, label: taken.has(label.toLowerCase()) ? `${label} (built-in)` : label, unit, zero: ['water', 'workout', 'outdoor', 'steps'].includes(k) }); }
  return out;
}
export function seriesValues(ref, days, end = new Date()) {
  if (ref.startsWith('b:')) return A.series(ref.slice(2), days, end).map((p) => ({ key: p.key, value: p.value }));
  const [, tid, fid] = ref.split(':'); const t = store.get('trackers', tid); const f = t?.fields.find((x) => x.id === fid);
  return t && f ? series(t, f, days, end) : [];
}
const sd = (a) => { const m = mean(a); return a.length > 1 ? Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1)) : 0; };
/** Compare Y on days with more X vs less X. Always reports n and confidence; never claims causation. */
export function relate(xRef, yRef, { lag = 0, days = 90 } = {}) {
  const refs = seriesRefs(); const X = refs.find((r) => r.ref === xRef); const Y = refs.find((r) => r.ref === yRef);
  if (!X || !Y) return { ok: false, reason: 'unknown series' };
  const xs = seriesValues(xRef, days + lag); const ys = seriesValues(yRef, days + lag);
  const rows = [];
  for (let i = 0; i + lag < xs.length; i++) {
    let x = xs[i].value; const y = ys[i + lag]?.value;
    if (x == null && X.zero) x = 0; if (x == null || y == null || !isNum(x) || !isNum(y)) continue;
    rows.push({ x, y });
  }
  const n = rows.length; if (n < 8) return { ok: true, insufficient: true, n, text: `I don’t know yet — only ${n} day${n === 1 ? '' : 's'} have both. Keep logging and I’ll check again.` };
  const zeros = rows.filter((r) => r.x === 0).length; let lo; let hi; let split;
  if (zeros >= n * 0.25 && zeros <= n * 0.85) { lo = rows.filter((r) => r.x <= 0); hi = rows.filter((r) => r.x > 0); split = 'none vs some'; }
  else { const med = rows.map((r) => r.x).sort((a, b) => a - b)[Math.floor(n / 2)]; lo = rows.filter((r) => r.x < med); hi = rows.filter((r) => r.x >= med); split = 'lower vs higher'; }
  if (lo.length < 3 || hi.length < 3) return { ok: true, insufficient: true, n, text: 'I don’t know yet — the days don’t vary enough to compare.' };
  const my = (g) => mean(g.map((r) => r.y)); const mx = (g) => mean(g.map((r) => r.x));
  const diff = my(hi) - my(lo); const s = sd(rows.map((r) => r.y)) || 1; const effect = Math.abs(diff) / s;
  const confidence = n >= 20 && effect >= 0.8 ? 'High' : n >= 12 && effect >= 0.4 ? 'Moderate' : 'Low';
  const dir = Math.abs(diff) < 0.15 * s ? 'about the same' : diff > 0 ? 'higher' : 'lower';
  const fmt = (v, u) => `${round(v, 1)}${u ? ` ${u}` : ''}`;
  const text = dir === 'about the same'
    ? `${Y.label} looks about the same on days with ${split === 'none vs some' ? 'or without' : 'more or less'} ${X.label.toLowerCase()} (${n} days).`
    : `${Y.label} tends to be ${dir} on days with ${split === 'none vs some' ? '' : 'more '}${X.label.toLowerCase()} — ${fmt(my(hi), Y.unit)} vs ${fmt(my(lo), Y.unit)}${lag ? ` (the next ${lag === 1 ? 'day' : `${lag} days`})` : ''}.`;
  return { ok: true, n, confidence, diff, effect, text, groups: { lo: { n: lo.length, x: mx(lo), y: my(lo) }, hi: { n: hi.length, x: mx(hi), y: my(hi) } }, X, Y };
}
