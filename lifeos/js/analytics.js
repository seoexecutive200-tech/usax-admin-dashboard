// Deterministic local analytics: baselines, deviations, capacity, load, readiness, patterns.
// The LLM never does this arithmetic.
import { store } from './store.js';
import {
  dayKey, parseKey, addDays, startOfDay, mean, sum, round, clamp, isNum, hoursUntil, daysBetween,
  addMinutes, inQuietHours,
} from './util.js';

export const SCALE_TYPES = ['mood', 'energy', 'stress', 'focus'];
export const SUM_TYPES = ['water', 'workout', 'steps', 'outdoor', 'caffeine', 'screen'];
export const METRIC_LABEL = {
  sleep: 'Sleep', mood: 'Mood', energy: 'Energy', stress: 'Stress', focus: 'Focus', water: 'Hydration',
  workout: 'Movement', outdoor: 'Outdoor time', steps: 'Steps',
};

// ---- per-day index (memoised on store version) ----
let cacheVer = -1; let byDay = new Map();
function index() {
  if (cacheVer === store.version()) return byDay;
  byDay = new Map();
  for (const l of store.all('logs')) {
    const k = dayKey(l.ts);
    if (!byDay.has(k)) byDay.set(k, {});
    const d = byDay.get(k);
    (d[l.type] ||= []).push(l);
  }
  cacheVer = store.version();
  return byDay;
}

export function dailyValue(type, key) {
  const d = index().get(key);
  const list = d?.[type];
  if (!list?.length) return null;
  const vals = list.map((l) => l.value).filter(isNum);
  if (!vals.length) return list.length; // count-style logs (meals)
  if (type === 'sleep') return vals[vals.length - 1];
  if (SUM_TYPES.includes(type)) return sum(vals);
  return mean(vals);
}
export const logsOnDay = (key) => index().get(key) || {};

export function series(type, days, end = new Date()) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const k = dayKey(addDays(end, -i));
    out.push({ key: k, value: dailyValue(type, k) });
  }
  return out;
}
function floorKey() {
  const b = store.settings().baselineStart;
  return b || '0000-00-00';
}
export function baseline(type, days, end = new Date()) {
  const f = floorKey();
  return mean(series(type, days, end).filter((p) => p.key >= f).map((p) => p.value));
}
export const sampleCount = (type, days, end = new Date()) =>
  series(type, days, end).filter((p) => isNum(p.value)).length;

export function totalDaysWithData() {
  return index().size;
}
export function lastLogDate() {
  let max = null;
  for (const l of store.all('logs')) if (!max || l.ts > max) max = l.ts;
  return max ? new Date(max) : null;
}
export function gapDays(now = new Date()) {
  if (store.all('logs').length < 5) return 0;
  const last = lastLogDate();
  return last ? Math.max(0, daysBetween(last, now)) : 0;
}

export function trend(points) {
  const v = points.map((p) => p.value).filter(isNum);
  if (v.length < 4) return { dir: 'unknown', delta: 0 };
  const h = Math.floor(v.length / 2);
  const a = mean(v.slice(0, h)); const b = mean(v.slice(h));
  const delta = b - a;
  const range = Math.max(0.5, Math.abs(a) * 0.05);
  return { dir: Math.abs(delta) < range ? 'steady' : delta > 0 ? 'up' : 'down', delta };
}

// ---- schedule load ----
const IMPORTANCE_W = { low: 0.6, normal: 1, high: 1.6 };
const TYPE_W = { meeting: 1.1, video_call: 1.1, deadline: 1.3, travel: 1.2, appointment: 1.0, workout: 0.6, social: 0.7, task: 0.8, reminder: 0.2, other: 1 };
export const activeEvents = () => store.all('events').filter((e) => e.status !== 'skipped' && e.status !== 'dismissed' && e.aiState !== 'suggested');
export function eventsOnDay(key) {
  return activeEvents().filter((e) => dayKey(e.start) === key)
    .sort((a, b) => a.start.localeCompare(b.start));
}
export const eventMinutes = (e) => Math.max(0, (new Date(e.end || e.start) - new Date(e.start)) / 60000);

export function loadForDay(key) {
  let weighted = 0;
  for (const e of eventsOnDay(key)) {
    const mins = e.end ? eventMinutes(e) : 30;
    weighted += mins * (IMPORTANCE_W[e.importance] ?? 1) * (TYPE_W[e.type] ?? 1) * (e.type === 'reminder' ? 0.2 : 1);
  }
  const tasksDue = store.all('tasks').filter((t) => t.due && dayKey(t.due) === key && t.status !== 'done').length;
  weighted += tasksDue * 20;
  return clamp(weighted / (8 * 60), 0, 1.3);
}
export function loadLevel(v) {
  return v < 0.3 ? 'light' : v < 0.6 ? 'moderate' : v < 0.9 ? 'heavy' : 'peak';
}
export function futureLoad(days = 7, from = new Date()) {
  return Array.from({ length: days }, (_, i) => {
    const d = addDays(startOfDay(from), i); const key = dayKey(d);
    const value = loadForDay(key);
    return { key, date: d, value, level: loadLevel(value), count: eventsOnDay(key).length };
  });
}
export function conflicts(from = new Date(), days = 7) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const evs = eventsOnDay(dayKey(addDays(from, i))).filter((e) => e.end && e.type !== 'reminder');
    for (let a = 0; a < evs.length; a++) for (let b = a + 1; b < evs.length; b++) {
      if (new Date(evs[b].start) < new Date(evs[a].end)) out.push([evs[a], evs[b]]);
    }
  }
  return out;
}

// ---- current state & capacity ----
export function currentState(now = new Date()) {
  const k = dayKey(now);
  const val = (t) => dailyValue(t, k);
  return {
    sleepHours: val('sleep'), energy: val('energy'), mood: val('mood'), stress: val('stress'), focus: val('focus'),
    water: val('water'), workout: val('workout'),
  };
}
export function capacity(now = new Date()) {
  const k = dayKey(now); const s = currentState(now);
  const sleepBase = baseline('sleep', 30, now) ?? 7.2;
  const energyBase = baseline('energy', 30, now) ?? 6;
  const stressBase = baseline('stress', 30, now) ?? 5;
  const moodBase = baseline('mood', 30, now) ?? 6;
  const lastSleep = s.sleepHours ?? dailyValue('sleep', dayKey(addDays(now, -1))) ?? sleepBase;
  const sleepQ = (store.all('logs').filter((l) => l.type === 'sleep' && dayKey(l.ts) === k).pop()?.meta?.quality) ?? null;
  const energy = s.energy ?? energyBase;
  const stress = s.stress ?? stressBase;
  const mood = s.mood ?? moodBase;
  const load = loadForDay(k);
  const physical = clamp(0.5 * clamp(lastSleep / sleepBase, 0, 1.1) + 0.5 * (energy / 10) + (sleepQ ? (sleepQ - 3) * 0.02 : 0), 0, 1);
  const mental = clamp(1 - 0.6 * (stress / 10) - 0.4 * clamp(load, 0, 1), 0, 1);
  const emotional = clamp(mood / 10, 0, 1);
  const timeFree = clamp(1 - load, 0, 1);
  const usableTime = Math.min(timeFree, physical + 0.15, mental + 0.15); // free time is not usable capacity
  const overall = clamp(0.3 * physical + 0.3 * mental + 0.15 * emotional + 0.25 * usableTime, 0, 1);
  const estimated = { energy: s.energy == null, stress: s.stress == null, sleep: s.sleepHours == null };
  return {
    physical, mental, emotional, time: timeFree, usableTime, overall, load, estimated,
    label: overall >= 0.7 ? 'Good' : overall >= 0.5 ? 'Fair' : 'Low',
    energy, stress, mood, lastSleep, sleepBase,
    mentalLoadLabel: mental >= 0.65 ? 'Low' : mental >= 0.4 ? 'Moderate' : 'High',
    mentalLoadPips: Math.round((1 - mental) * 6),
    recovery: physical, recoveryLabel: physical >= 0.75 ? 'Good' : physical >= 0.55 ? 'Fair' : 'Low',
    lowCapacity: overall < 0.45,
  };
}
export function glanceHeadline(c) {
  if (c.lowCapacity) return 'Today may need a gentler pace.';
  if (c.overall >= 0.7) return "You're doing well.";
  if (c.overall >= 0.55) return "You're doing fairly well.";
  return 'You have a bit less in the tank today.';
}

// ---- event readiness (a composite app summary, not a probability) ----
function hourEnergyProfile() {
  const buckets = Array.from({ length: 24 }, () => []);
  for (const l of store.all('logs')) if (l.type === 'energy' && isNum(l.value)) buckets[new Date(l.ts).getHours()].push(l.value);
  const n = buckets.reduce((s, b) => s + b.length, 0);
  return { n, hours: buckets.map((b) => (b.length >= 2 ? mean(b) : null)) };
}
export function energyAt(date) {
  const p = hourEnergyProfile(); const h = date.getHours();
  const heur = [10, 11, 15, 16].includes(h) ? 6.8 : [12, 13, 14].includes(h) ? 5.8 : h >= 20 || h < 7 ? 4.5 : 6.2;
  return p.n >= 15 && p.hours[h] != null ? p.hours[h] : (baseline('energy', 30) ?? heur) * (heur / 6.2);
}
export function prepRatio(ev) {
  const list = ev.checklist || [];
  if (list.length) return list.filter((c) => c.done).length / list.length;
  if (!ev.prepRequired) return 0.8;
  return { ready: 1, in_progress: 0.5, none: 0.15 }[ev.prepStatus || 'none'] ?? 0.15;
}
export function readiness(ev, now = new Date()) {
  const start = new Date(ev.start);
  const hrs = Math.max(0, hoursUntil(start, now));
  const prep = prepRatio(ev);
  const sleepBase = baseline('sleep', 30) ?? 7.2;
  const lastSleep = dailyValue('sleep', dayKey(now)) ?? dailyValue('sleep', dayKey(addDays(now, -1))) ?? sleepBase;
  const sleepAdj = clamp((lastSleep - sleepBase) * 0.04, -0.15, 0.05);
  const energy = clamp(energyAt(start) / 10 + sleepAdj, 0, 1);
  const dk = dayKey(start); const prevK = dayKey(addDays(start, -1));
  let space = 1 - 0.8 * (loadForDay(dk) + loadForDay(prevK)) / 2;
  if (hrs < 12 && prep < 0.6) space -= 0.2;
  space = clamp(space, 0, 1);
  const stress3 = mean([0, 1, 2].map((i) => dailyValue('stress', dayKey(addDays(now, -i))))) ?? baseline('stress', 30) ?? 5;
  const mental = clamp(1 - 0.6 * (stress3 / 10) - 0.4 * clamp(loadForDay(dk), 0, 1), 0, 1);
  const overall = clamp(0.35 * prep + 0.2 * energy + 0.2 * space + 0.25 * mental, 0, 1);
  const n = totalDaysWithData();
  const confidence = n >= 21 ? 'High' : n >= 7 ? 'Moderate' : 'Low';
  const parts = { preparation: prep, energy, space, mental };
  const weakest = Object.entries(parts).sort((a, b) => a[1] - b[1])[0][0];
  return { overall, parts, confidence, weakest, hoursLeft: hrs, lastSleep, sleepBase, stress3 };
}
export function readinessLabel(v) { return v >= 0.75 ? 'Well prepared' : v >= 0.55 ? 'On track' : 'Needs attention'; }

export function bestPrepWindow(ev, now = new Date()) {
  const start = new Date(ev.start);
  let t = new Date(Math.ceil(addMinutes(now, 15).getTime() / 1800000) * 1800000);
  const evs = activeEvents().filter((e) => e.id !== ev.id && e.end);
  const busy = (a, b) => evs.some((e) => new Date(e.start) < b && new Date(e.end) > a);
  let best = null;
  while (t < addMinutes(start, -45)) {
    const end = addMinutes(t, 45);
    if (!busy(t, end) && !inQuietHours(t, store.settings().quietHours) && end <= start) {
      const score = energyAt(t) - (hoursUntil(start, t) > 48 ? 1 : 0) - (hoursUntil(start, t) < 1.5 ? 1.5 : 0);
      if (!best || score > best.score) best = { start: new Date(t), end, score };
    }
    t = addMinutes(t, 30);
  }
  if (!best) return null;
  return { ...best, reason: hourEnergyProfile().n >= 15 ? 'Matches the hours your energy is usually highest and your calendar is free.' : 'A free slot with typically good energy hours. This improves as you log energy.' };
}
export function nextImportantEvent(now = new Date()) {
  return activeEvents().filter((e) => new Date(e.start) > now && (e.importance === 'high' || e.prepRequired) && e.status !== 'completed')
    .sort((a, b) => a.start.localeCompare(b.start))[0] || null;
}

// ---- patterns / correlations (always with n + confidence; never causal) ----
const PAIRS = [
  { id: 'sleep_energy', a: 'sleep', b: 'energy', lag: 0, mode: 'median', unit: 'h', thr: 0.5,
    text: (lo, hi, d) => `Energy tends to be ${d > 0 ? 'higher' : 'lower'} on days with ${d > 0 ? 'more' : 'less'} sleep (${round(hi.a, 1)}h vs ${round(lo.a, 1)}h).` },
  { id: 'stress_sleep', a: 'stress', b: 'sleep', lag: 1, mode: 'median', thr: 0.4,
    text: (lo, hi, d) => `Higher-stress days tend to coincide with ${d < 0 ? 'shorter' : 'longer'} sleep that night (${round(hi.b, 1)}h vs ${round(lo.b, 1)}h).` },
  { id: 'workout_mood', a: 'workout', b: 'mood', lag: 0, mode: 'binary', thr: 0.5,
    text: (lo, hi, d) => `Mood tends to be ${d > 0 ? 'higher' : 'lower'} on days with movement logged (${round(hi.b, 1)} vs ${round(lo.b, 1)}).` },
  { id: 'workout_sleep', a: 'workout', b: 'sleep', lag: 0, mode: 'binary', thr: 0.35,
    text: (lo, hi, d) => `Sleep tends to be ${d > 0 ? 'longer' : 'shorter'} after days with movement (${round(hi.b, 1)}h vs ${round(lo.b, 1)}h).` },
  { id: 'water_energy', a: 'water', b: 'energy', lag: 0, mode: 'median', thr: 0.5,
    text: (lo, hi, d) => `Energy tends to be ${d > 0 ? 'higher' : 'lower'} on higher-hydration days (${round(hi.b, 1)} vs ${round(lo.b, 1)}).` },
  { id: 'outdoor_mood', a: 'outdoor', b: 'mood', lag: 0, mode: 'binary', thr: 0.5,
    text: (lo, hi, d) => `Mood tends to be ${d > 0 ? 'higher' : 'lower'} on days with outdoor time (${round(hi.b, 1)} vs ${round(lo.b, 1)}).` },
  { id: 'load_stress', a: 'load', b: 'stress', lag: 0, mode: 'median', thr: 0.6,
    text: (lo, hi, d) => `Stress tends to be ${d > 0 ? 'higher' : 'lower'} on heavier schedule days (${round(hi.b, 1)} vs ${round(lo.b, 1)}).` },
];
const valFor = (type, key) => (type === 'load' ? (eventsOnDay(key).length ? loadForDay(key) : null) : dailyValue(type, key));

export function patterns(days = 60) {
  const f = floorKey(); const out = [];
  for (const P of PAIRS) {
    const rows = [];
    for (let i = 0; i < days; i++) {
      const k = dayKey(addDays(new Date(), -i)); if (k < f) continue;
      const a = valFor(P.a, k); const b = valFor(P.b, dayKey(addDays(parseKey(k), P.lag)));
      if (isNum(a) && isNum(b)) rows.push({ a, b });
      else if (P.mode === 'binary' && isNum(b) && P.a !== 'load' && a == null) rows.push({ a: 0, b });
    }
    if (rows.length < 6) continue;
    let lo; let hi;
    if (P.mode === 'binary') { lo = rows.filter((r) => r.a <= 0); hi = rows.filter((r) => r.a > 0); }
    else {
      const sorted = rows.map((r) => r.a).sort((x, y) => x - y); const med = sorted[Math.floor(sorted.length / 2)];
      lo = rows.filter((r) => r.a < med); hi = rows.filter((r) => r.a >= med);
    }
    if (lo.length < 3 || hi.length < 3) continue;
    const L = { a: mean(lo.map((r) => r.a)), b: mean(lo.map((r) => r.b)) };
    const H = { a: mean(hi.map((r) => r.a)), b: mean(hi.map((r) => r.b)) };
    const d = H.b - L.b;
    if (Math.abs(d) < P.thr) continue;
    const n = rows.length;
    const conf = n >= 20 && Math.abs(d) >= P.thr * 1.8 ? 'High' : n >= 12 ? 'Moderate' : 'Low';
    out.push({
      id: P.id, text: P.text(L, H, d), n, confidence: conf,
      confValue: conf === 'High' ? 0.85 : conf === 'Moderate' ? 0.65 : 0.4, diff: d,
    });
  }
  return out.sort((a, b) => b.confValue - a.confValue || b.n - a.n);
}

// ---- comparisons ----
export function rangeStats(days, endOffset = 0) {
  const end = addDays(new Date(), -endOffset);
  const stats = {};
  for (const t of ['sleep', 'mood', 'energy', 'stress', 'focus', 'water', 'workout']) {
    const pts = series(t, days, end);
    stats[t] = { avg: mean(pts.map((p) => p.value)), n: pts.filter((p) => isNum(p.value)).length, points: pts };
  }
  const keys = Array.from({ length: days }, (_, i) => dayKey(addDays(end, -i)));
  const logged = keys.filter((k) => index().has(k)).length;
  const loads = keys.map((k) => loadForDay(k));
  stats.load = { avg: mean(loads), points: keys.reverse().map((k, i) => ({ key: k, value: loads[days - 1 - i] })) };
  stats.logged = logged; stats.days = days;
  return stats;
}
export function compare(days) {
  const cur = rangeStats(days, 0); const prev = rangeStats(days, days);
  const rows = ['sleep', 'mood', 'energy', 'stress', 'focus', 'water', 'workout'].map((t) => {
    const a = cur[t].avg; const b = prev[t].avg;
    const delta = isNum(a) && isNum(b) ? a - b : null;
    const good = t === 'stress' ? -delta : delta;
    const scale = t === 'sleep' ? 0.4 : t === 'water' ? 250 : t === 'workout' ? 10 : 0.5;
    return { type: t, cur: a, prev: b, delta, goodness: isNum(good) ? good / scale : null };
  });
  const scored = rows.filter((r) => isNum(r.goodness) && ['sleep', 'mood', 'energy', 'stress', 'focus'].includes(r.type));
  const improvement = scored.filter((r) => r.goodness > 0.6).sort((a, b) => b.goodness - a.goodness)[0] || null;
  const pressure = scored.filter((r) => r.goodness < -0.6).sort((a, b) => a.goodness - b.goodness)[0] || null;
  return { cur, prev, rows, improvement, pressure };
}

// ---- goals ----
export function goalProgress(goal) {
  if (!goal.metric || !isNum(goal.target)) return null;
  const week = Array.from({ length: 7 }, (_, i) => dayKey(addDays(new Date(), -i)));
  const vals = week.map((k) => dailyValue(goal.metric, k));
  let current; let pct;
  if (goal.metric === 'workout') { current = vals.filter((v) => v > 0).length; pct = current / goal.target; }
  else { current = mean(vals); pct = current == null ? 0 : current / goal.target; }
  return { current, pct: clamp(pct, 0, 1.5), unit: goal.metric === 'workout' ? 'days this week' : goal.metric === 'sleep' ? 'h avg' : goal.metric === 'water' ? 'ml avg' : '' };
}

// ---- friction / life change ----
export function frictionItems() {
  const since = addDays(new Date(), -30).toISOString();
  const groups = {};
  for (const e of store.all('events')) {
    if (e.start < since) continue;
    const key = e.title.trim().toLowerCase();
    groups[key] = groups[key] || { title: e.title, count: 0 };
    groups[key].count += (e.rescheduleCount || 0) + (e.status === 'skipped' ? 1 : 0);
  }
  for (const t of store.all('tasks')) {
    const key = t.title.trim().toLowerCase();
    groups[key] = groups[key] || { title: t.title, count: 0 };
    groups[key].count += t.rescheduleCount || 0;
  }
  return Object.values(groups).filter((g) => g.count >= 3);
}
export function lifeChange() {
  if (totalDaysWithData() < 14) return null;
  const s7 = baseline('sleep', 7); const s30 = baseline('sleep', 30);
  if (isNum(s7) && isNum(s30) && sampleCount('sleep', 7) >= 4 && Math.abs(s7 - s30) >= 1.2) {
    return { metric: 'sleep', detail: `Your sleep over the last week (${round(s7, 1)}h) differs a lot from your 30-day average (${round(s30, 1)}h).` };
  }
  const st7 = baseline('stress', 7); const st30 = baseline('stress', 30);
  if (isNum(st7) && isNum(st30) && sampleCount('stress', 7) >= 4 && Math.abs(st7 - st30) >= 2) {
    return { metric: 'stress', detail: `Your stress over the last week (${round(st7, 1)}/10) differs a lot from your 30-day average (${round(st30, 1)}/10).` };
  }
  return null;
}

// ---- experiments ----
export function experimentResult(exp) {
  const start = new Date(exp.start); const end = exp.end ? new Date(exp.end) : new Date();
  const days = Math.max(1, daysBetween(start, end));
  const during = []; const before = [];
  for (let i = 0; i <= days; i++) during.push(dailyValue(exp.metric, dayKey(addDays(start, i))));
  for (let i = 1; i <= Math.max(7, days); i++) before.push(dailyValue(exp.metric, dayKey(addDays(start, -i))));
  const a = mean(before); const b = mean(during);
  const nA = before.filter(isNum).length; const nB = during.filter(isNum).length;
  const diff = isNum(a) && isNum(b) ? b - a : null;
  const conf = nA >= 5 && nB >= 5 ? 'Moderate' : 'Low';
  return { before: a, during: b, nBefore: nA, nDuring: nB, diff, confidence: conf };
}

export function financeSummary(monthKey = dayKey().slice(0, 7)) {
  const f = store.all('finance');
  const income = sum(f.filter((r) => r.kind === 'income' && (r.recurring || r.date?.startsWith(monthKey))).map((r) => r.amount));
  const obligations = sum(f.filter((r) => r.kind === 'obligation').map((r) => r.amount));
  const spent = sum(f.filter((r) => r.kind === 'expense' && r.date?.startsWith(monthKey)).map((r) => r.amount));
  const buffer = sum(f.filter((r) => r.kind === 'buffer').map((r) => r.amount));
  const goals = f.filter((r) => r.kind === 'goal');
  const discretionary = income - obligations - spent;
  return { income, obligations, spent, buffer, goals, discretionary, hasData: f.length > 0 };
}
