// Adaptive check-in engine (spec: "Adaptive Check-In & Data Intelligence"). It does NOT run the 100 check-ins on a schedule: for each moment it
// checks freshness, your own baselines, your plans, your interruption budget and quiet hours, then chooses ONE check-in — or silence.
// Everything you answer is stored as a fact (provenance + timestamp). Calculations are stored separately and labelled. Nothing is invented:
// an empty answer is saved as null/unknown. No diagnosis, ever. Selection and decisions are local and rule-based (free, predictable, private).
import { store } from './store.js';
import * as A from './analytics.js';
import * as F from './focus.js';
import { execute as baseExecute } from './actions.js';
const execute = (a, o) => baseExecute(a, o);
import { CHECKINS, get as getDef } from './checkin-lib.js';
import { addMemory } from './memory.js';
import { dayKey, addDays, fmtTime, lsGet, lsSet, safeJSON, nowISO, isNum, mean, round } from './util.js';

const STORE = 'checkins';
const LS = 'lifeos.cx';
const CAPS = { quiet: 2, balanced: 4, active: 6 };
const MIN_PRIORITY = 25; // below this, silence beats asking
const URGENT = 80; // important-event / safety prompts may ignore budget and the 90-minute gap

// ---------- settings ----------
export const getCx = () => ({ on: true, optin: {}, off: [], sleepH: null, hydrationMl: null, patterns: {}, ...(store.settings().cx || {}) });
export const setCx = (patch) => store.setSettings({ cx: { ...getCx(), ...patch } });
const ls = () => { const s = safeJSON(lsGet(LS), {}); return { shown: s.shown || {}, snooze: s.snooze || {}, cur: s.cur || null, lock: s.lock || 0 }; };
const lsave = (s) => { for (const k of Object.keys(s.shown)) if (k < dayKey(addDays(new Date(), -3))) delete s.shown[k]; for (const k of Object.keys(s.snooze)) if (s.snooze[k] < Date.now()) delete s.snooze[k]; lsSet(LS, JSON.stringify(s)); };
const refKey = (id, ref) => `${id}:${ref?.id || ''}`;

// ---------- facts ----------
const all = () => store.all(STORE);
let ansV = -1; let ansBy = new Map(); // answered check-ins by id, newest first — rebuilt only when the store changes
const answered = (id) => {
  if (ansV !== store.version()) { ansBy = new Map(); for (const r of all().filter((x) => x.status === 'answered').sort((a, b) => b.ts.localeCompare(a.ts))) (ansBy.get(r.checkinId) || ansBy.set(r.checkinId, []).get(r.checkinId)).push(r); ansV = store.version(); }
  return ansBy.get(id) || [];
};
const onDay = (id, key) => answered(id).find((r) => dayKey(r.ts) === key) || null;
const ageMin = (r) => (r ? (Date.now() - +new Date(r.ts)) / 60000 : Infinity);
const ans = (r, k) => (r && r.answers ? r.answers[k] ?? null : null);
const clock = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const gapMin = (from, to) => ((to - from) % 1440 + 1440) % 1440; // minutes from `from` to `to` going forward across midnight
const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// ---------- safety ----------
const SELF_HARM = /\b(kill myself|suicid\w*|end (it all|my life)|self[- ]?harm|hurt myself|harm myself|don'?t want to (live|be alive|be here)|no reason to (live|go on))\b/i;
const ACUTE = /\b(chest pain|pain in (my )?chest|can'?t breathe|trouble breathing|short(ness)? of breath|fainted|passed out|face droop\w*|slurred speech|severe bleeding|worst headache|coughing blood|vomiting blood|heart attack|stroke)\b/i;
export function scanSafety(text) {
  const t = String(text || ''); if (!t) return null;
  if (SELF_HARM.test(t)) return 'self-harm';
  if (ACUTE.test(t)) return 'acute';
  return null;
}
export const SAFETY_TEXT = {
  'self-harm': 'I’m really sorry you’re carrying this. Your safety matters more than any plan or number in this app. If you might act on these thoughts or you’re in immediate danger, call your local emergency number now. You can also reach a crisis line in your country or someone you trust — please don’t go through this alone. I’ll hold off on lifestyle suggestions.',
  acute: 'Some of what you wrote can be a sign of something that needs urgent medical attention, and LifeOS can’t assess it. If it’s happening now or getting worse, call your local emergency number or get medical care right away. I’ll hold off on lifestyle suggestions.',
  severe: 'That sounds strong. LifeOS can track it but can’t tell you what it is. If it’s severe, getting worse, or worries you, please speak to a doctor or a local urgent-care service — and if it feels like an emergency, call your local emergency number.',
};

// ---------- context for triggers ----------
function ctx(now = new Date()) {
  const key = dayKey(now); const hour = now.getHours() + now.getMinutes() / 60; const st = A.currentState(now);
  const evs = A.eventsOnDay(key).filter((e) => !e.allDay && e.type !== 'reminder');
  const tom = A.eventsOnDay(dayKey(addDays(now, 1))).filter((e) => !e.allDay && e.type !== 'reminder');
  const tasks = store.all('tasks').filter((t) => t.status !== 'done' && !t.someday);
  const c = {
    now, key, hour, st, evs, tom, tasks, cx: getCx(), mode: store.settings().advisorMode || 'balanced',
    morning: hour >= 5 && hour < 12, afternoon: hour >= 12 && hour < 18, evening: hour >= 18 && hour < 24,
    dow: now.getDay(), last: (id) => answered(id)[0] || null, today: (id) => onDay(id, key), ans,
    recent: (id, days) => answered(id).filter((r) => +new Date(r.ts) > Date.now() - days * 86400000),
    mins: (d) => (+new Date(d) - +now) / 60000, opt: (f) => !!getCx().optin[f],
    todayTasks: tasks.filter((t) => !t.due || dayKey(t.due) <= key),
    weekMinMove: () => weekMoveMinutes(now),
    sleepTarget: () => getCx().sleepH, base: (t, d) => ({ v: A.baseline(t, d, now), n: A.sampleCount(t, d, now) }),
    focusDone: () => F.sessions().filter((s) => +new Date(s.end || s.start) > Date.now() - 90 * 60000)[0] || null,
  };
  return c;
}
const IMPORTANT = (e) => e.importance === 'high' || ['interview', 'deadline'].includes(e.type) || /interview|presentation|exam|review|pitch|demo|board/i.test(e.title || '');
const evRef = (e) => ({ type: 'event', id: e.id, label: e.title });
const taskRef = (t) => ({ type: 'task', id: t.id, label: t.title });

function weekMoveMinutes(now) {
  const from = +addDays(now, -6); let m = 0;
  for (const l of store.all('logs')) if (l.type === 'workout' && +new Date(l.ts) >= from && isNum(l.value)) m += l.value;
  return m;
}
const weeklyShortfall = (c) => { const t = c.cx.sleepH; if (!isNum(t)) return null; const recs = c.recent(2, 7).filter((r) => ans(r, 'known') === 'Yes' && isNum(ans(r, 'sleptH'))); if (recs.length < 3) return null; return { short: recs.reduce((s, r) => s + (t - ans(r, 'sleptH')), 0), n: recs.length }; };
const bedtimes = (c, days) => c.recent(2, days).map((r) => clock(ans(r, 'bed'))).filter(isNum).map((m) => (m < 720 ? m + 1440 : m)); // after-midnight bed times sort after evening ones
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

// ---------- triggers: each returns 0 (not now) or a priority; { p, ref } to attach an event/task ----------
// Check-ins with no trigger here (e.g. 61 capture, 81 expense, 84 purchase question) are on demand: you start them, or Capture does.
const TRIG = {
  1: (c) => (c.morning && !c.today(1) && !['energy', 'mood', 'stress'].every((t) => lastLogAge(t) < 90) ? 60 : 0), // once per morning; never if you just logged all three
  2: (c) => (c.morning && !c.today(2) ? 40 : 0),
  3: (c) => (c.morning && !c.today(3) ? (c.todayTasks.length >= 4 ? 50 : c.todayTasks.length ? 28 : 0) : 0),
  5: (c) => { if (!c.morning || c.today(5)) return 0; const dense = c.evs.length >= 4 || A.loadForDay(c.key) >= 0.7; const sl = c.today(2), short = isNum(ans(sl, 'sleptH')) && isNum(c.cx.sleepH) && ans(sl, 'sleptH') < c.cx.sleepH - 1; const hiStress = (c.today(1) && ans(c.today(1), 'stress') >= 7); return dense || short || hiStress ? 45 : 0; },
  6: (c) => (c.morning && !c.today(6) && !c.today(21) && A.loadForDay(c.key) >= 0.7 && !c.today(22) ? 30 : 0),
  7: (c) => { const r = c.today(2), t = c.cx.sleepH; return c.morning && !c.today(7) && ans(r, 'known') === 'Yes' && isNum(ans(r, 'sleptH')) && isNum(t) && t - ans(r, 'sleptH') >= 1 ? 55 : 0; },
  8: (c) => { if (!c.opt('body') || !c.morning || c.today(8)) return 0; const prev = c.last(8); const hard = answered(44).some((r) => dayKey(r.ts) === dayKey(addDays(c.now, -1)) && ans(r, 'rpe') >= 8); return (prev && ans(prev, 'course') === 'Ongoing') || hard ? 30 : 0; },
  9: (c) => { const e = [...c.evs, ...c.tom].find((x) => IMPORTANT(x) && c.mins(x.start) > 60 && c.mins(x.start) < 2880 && !prepDone(63, x) && !hasRef(9, x)); return e && c.morning ? { p: 55, ref: evRef(e) } : 0; },
  10: (c) => { if (!c.morning || c.today(10)) return 0; const base = median(Array.from({ length: 28 }, (_, i) => A.eventsOnDay(dayKey(addDays(c.now, -i - 1))).length)); return (base != null && Math.abs(c.evs.length - base) >= 3) || c.evs.some((e) => e.type === 'travel') ? 25 : 0; },
  11: (c) => (c.evening && c.hour < 23 && !c.today(11) && (c.tom.some(IMPORTANT) || c.tom.some((e) => c.mins(e.start) < 1440 && new Date(e.start).getHours() < 9)) ? 35 : 0),
  12: (c) => { const y = onDay(11, dayKey(addDays(c.now, -1))); return c.morning && y && c.today(2) && !c.today(12) ? 40 : 0; },
  14: (c) => { const r = c.today(2); return c.morning && !c.today(14) && ans(r, 'known') === 'Yes' && (c.hour >= 8 || (c.st.energy != null && c.st.energy <= 4)) ? 40 : 0; },
  15: (c) => (c.today(14) && ans(c.today(14), 'rest') <= 4 && !c.today(15) ? 30 : 0),
  16: (c) => (c.afternoon && !c.today(16) && c.st.energy != null && c.st.energy <= 4 && ageMin(c.last(16)) > 14 * 1440 ? 20 : 0),
  17: (c) => { const w = weeklyShortfall(c); return w && w.short >= 5 && !c.recent(17, 6).length ? 35 : 0; },
  18: (c) => { if (!c.morning || c.today(18) || !c.today(2)) return 0; const m = median(bedtimes(c, 30).slice(1)); const now = bedtimes(c, 1)[0]; return m != null && now != null && Math.abs(now - m) >= 90 ? 25 : 0; },
  19: (c) => { const wk = bedtimes(c, 7), mo = bedtimes(c, 30).filter((m) => !wk.includes(m)); if (wk.length < 4 || mo.length < 4 || c.recent(19, 6).length) return 0; return Math.abs(median(wk) - median(mo)) >= 60 ? 25 : 0; },
  20: (c) => { const ch = c.cx.sleepChange; if (!ch) return 0; const d = (+c.now - +new Date(ch)) / 86400000; return d >= 3 && d <= 8 && !answered(20).some((r) => +new Date(r.ts) > +new Date(ch)) ? 40 : 0; },
  21: (c) => { if (c.hour < 11 || c.hour > 20 || c.today(21) && ageMin(c.today(21)) < 240) return 0; const long = c.evs.some((e) => c.mins(e.start) > 0 && c.mins(e.start) < 90) && !c.today(22); return long && ageMin(c.last(21)) > 240 ? 30 : 0; },
  22: (c) => { const r = c.today(21); return r && ans(r, 'ate') === 'Yes' && !c.today(22) && ageMin(r) < 120 ? 32 : 0; },
  30: (c) => { const meals = answered(22).map((r) => clock(ans(r, 'at'))).filter(isNum); if (meals.length < 5) return 0; const usual = median(meals); const e = c.evs.find((x) => IMPORTANT(x) && c.mins(x.start) > 60 && c.mins(x.start) < 480 && Math.abs((new Date(x.start).getHours() * 60 + new Date(x.start).getMinutes()) - usual) < 75 && !hasRef(30, x)); return e ? { p: 38, ref: evRef(e) } : 0; },
  31: (c) => { const afterWorkout = answered(44)[0] && ageMin(answered(44)[0]) < 60; return !c.today(31) && ((c.hour >= 12 && c.hour < 21 && c.st.water == null && ageMin(c.last(31)) > 240) || afterWorkout) ? 24 : 0; },
  32: (c) => { const t = c.cx.hydrationMl; if (!c.opt('hydration') || !isNum(t) || c.hour < 14 || c.today(32)) return 0; const have = c.st.water || 0; return have < t * ((c.hour - 7) / 14) * 0.6 ? 30 : 0; },
  34: (c) => (c.opt('caffeine') && c.morning && !c.today(34) && ageMin(c.last(34)) > 600 && c.hour >= 8 ? 24 : 0),
  35: (c) => (c.opt('caffeine') && c.hour >= 14 && c.hour < 19 && c.today(11) && c.today(34) && !c.today(35) ? 28 : 0),
  37: (c) => { if (!c.opt('meds')) return 0; const items = c.cx.meds || []; return items.some((m) => { const t = clock(m.at); return t != null && c.hour * 60 >= t && c.hour * 60 < t + 90 && !answered(37).some((r) => dayKey(r.ts) === c.key && ans(r, 'item') === m.name); }) ? 50 : 0; },
  40: (c) => (c.opt('hydration') && c.dow === 0 && !c.recent(40, 6).length && answered(32).length >= 3 ? 28 : 0),
  41: (c) => { const goal = T_goal('exercise|workout|movement|walk|run|gym|fitness'); return c.morning && goal && !c.today(41) && !c.evs.some((e) => e.type === 'workout') && !(c.st.workout > 0) ? 35 : 0; },
  43: (c) => { const w = c.evs.find((e) => e.type === 'workout' && c.mins(e.start) > 15 && c.mins(e.start) < 180 && !hasRef(43, e)); return w && ((c.st.energy != null && c.st.energy <= 5) || c.today(1) && ans(c.today(1), 'energy') <= 5) ? { p: 40, ref: evRef(w) } : 0; },
  44: (c) => { const w = c.evs.find((e) => e.type === 'workout' && c.mins(e.end) < -10 && c.mins(e.end) > -240 && !hasRef(44, e)); return w ? { p: 42, ref: evRef(w) } : 0; },
  45: (c) => { const r = answered(44)[0]; return r && ageMin(r) > 15 && ageMin(r) < 90 && ans(r, 'rpe') >= 8 && !c.recent(45, 1).length ? 30 : 0; },
  46: (c) => { const y = answered(44).find((r) => dayKey(r.ts) === dayKey(addDays(c.now, -1)) && ans(r, 'rpe') >= 7); return c.morning && y && !c.today(46) ? 35 : 0; },
  47: (c) => (c.evening && c.hour < 22 && !c.today(47) && T_goal('walk|steps|movement|active') && c.st.workout == null ? 26 : 0),
  48: (c) => (c.dow === 5 && !c.recent(48, 6).length && T_goal('exercise|workout|movement|walk|run|gym') ? 28 : 0),
  49: (c) => { const r = answered(46).concat(answered(43), answered(45)).filter((x) => /pain/i.test(`${ans(x, 'pain')} ${ans(x, 'where')}`) && ans(x, 'pain') !== 'None' && ans(x, 'pain') !== 'No').sort((a, b) => b.ts.localeCompare(a.ts))[0]; return r && ageMin(r) > 600 && ageMin(r) < 4320 && !c.recent(49, 2).length ? 45 : 0; },
  50: (c) => { const n = answered(44).filter((r) => +new Date(r.ts) > Date.now() - 7 * 86400000 && ans(r, 'rpe') >= 7).length; return c.morning && n >= 3 && c.st.energy != null && c.st.energy <= 4 && !c.today(50) ? 32 : 0; },
  51: (c) => (c.hour >= 8 && c.hour < 11 && c.todayTasks.length >= 5 && !c.today(51) ? 40 : 0),
  52: (c) => { const t = c.tasks.find((x) => (x.rescheduleCount || 0) >= 3 && !hasRef(52, x)); return t ? { p: 42, ref: taskRef(t) } : 0; },
  53: (c) => { const s = c.focusDone(); return s && s.completed && !hasRef(53, s) && ageMin({ ts: s.end }) < 45 ? { p: 33, ref: { type: 'focus', id: s.id, label: s.label } } : 0; },
  54: (c) => { const s = c.focusDone(); return s && !s.completed && s.planned && s.minutes < s.planned * 0.7 && !hasRef(54, s) && ageMin({ ts: s.end }) < 45 ? { p: 33, ref: { type: 'focus', id: s.id, label: s.label } } : 0; },
  55: (c) => { const t = c.tasks.find((x) => x.due && c.mins(x.due) < 0 && c.mins(x.due) > -240 && (x.rescheduleCount || 0) < 3 && !hasRef(55, x) && !hasRef(56, x)); return t ? { p: 36, ref: taskRef(t) } : 0; },
  56: (c) => { const t = c.tasks.find((x) => x.due && c.mins(x.due) < -1440 && !hasRef(56, x) && !hasRef(55, x)); return t && c.morning ? { p: 36, ref: taskRef(t) } : 0; },
  58: (c) => (c.hour >= 14 && c.hour < 19 && c.todayTasks.length >= 6 && A.loadForDay(c.key) >= 0.9 && !c.today(58) ? 38 : 0),
  60: (c) => (c.hour >= 17.5 && c.hour < 21 && !c.today(60) && c.todayTasks.length ? 28 : 0),
  63: (c) => { const e = [...c.evs, ...c.tom].find((x) => IMPORTANT(x) && !x.prepStatus?.startsWith?.('done') && !prepDone(63, x) && x.createdAt && +new Date(x.createdAt) > Date.now() - 86400000 && c.mins(x.start) > 120); return e ? { p: 45, ref: evRef(e) } : 0; },
  64: (c) => { const e = [...c.evs, ...A.eventsOnDay(dayKey(addDays(c.now, 2))), ...A.eventsOnDay(dayKey(addDays(c.now, 3))), ...A.eventsOnDay(dayKey(addDays(c.now, 5)))].find((x) => IMPORTANT(x) && c.mins(x.start) > 2880 && c.mins(x.start) < 10080 && !hasRef(64, x, 2)); return e && c.hour >= 9 && c.hour < 20 ? { p: 38, ref: evRef(e) } : 0; },
  65: (c) => { const e = c.tom.find((x) => IMPORTANT(x) && !hasRef(65, x)); const r = e && answered(64).find((a) => a.ref?.id === e.id); return e && c.evening && !(r && ans(r, 'state') === 'Ready') ? { p: 52, ref: evRef(e) } : 0; },
  66: (c) => { const e = c.evs.find((x) => IMPORTANT(x) && c.mins(x.start) > 30 && c.mins(x.start) < 150 && !hasRef(66, x)); return e && store.settings().advisorMode !== 'quiet' ? { p: 85, ref: evRef(e) } : 0; },
  67: (c) => { const e = c.evs.concat(c.tom).find((x) => x.location && !x.allDay && c.mins(x.start) > 60 && c.mins(x.start) < 1440 && IMPORTANT(x) && !hasRef(67, x)); return e ? { p: 40, ref: evRef(e) } : 0; },
  68: (c) => { const evs = [...c.evs, ...c.tom].filter((e) => !e.allDay).sort((a, b) => a.start.localeCompare(b.start)); for (let i = 0; i < evs.length - 1; i++) for (let j = i + 1; j < evs.length; j++) if (evs[j].start < evs[i].end && c.mins(evs[i].start) > 0 && !hasRef(68, evs[i]) && !hasRef(68, evs[j])) return { p: 48, ref: { type: 'event', id: evs[i].id, label: `${evs[i].title} and ${evs[j].title}` } }; return 0; },
  69: (c) => { const t = c.tasks.find((x) => x.due && c.mins(x.due) > 0 && c.mins(x.due) < 2880 && /./.test(x.title) && (x.rescheduleCount || 0) >= 1 && !hasRef(69, x)); return t ? { p: 36, ref: taskRef(t) } : 0; },
  70: (c) => { const e = c.evs.find((x) => IMPORTANT(x) && c.mins(x.end) < -10 && c.mins(x.end) > -240 && !hasRef(70, x)); return c.opt('debrief') && e ? { p: 44, ref: evRef(e) } : 0; },
  71: (c) => (c.hour >= 8 && c.hour < 21 && !c.today(1) && ageMin(c.last(71)) > 360 && lastLogAge('mood') > 360 ? 30 : 0),
  72: (c) => { const r = c.last(1); const s = c.st.stress; const b = c.base('stress', 30); return s != null && b.n >= 5 && s - b.v >= 2.5 && !c.recent(72, 0.25).length && (!r || ageMin(r) > 30) ? 42 : 0; },
  75: (c) => { if (!c.opt('social')) return 0; return c.evening && !c.recent(75, 3).length ? 22 : 0; },
  76: (c) => (c.hour >= 19 && c.hour < 22 && T_goal('family|friends|social|personal') && !c.today(76) ? 24 : 0),
  78: (c) => { const r = c.today(1); return (r && ans(r, 'stress') >= 8 || c.st.stress >= 8) && A.loadForDay(c.key) >= 0.8 && !c.today(78) ? 44 : 0; },
  79: (c) => (c.hour >= 19.5 && c.hour < 22 && !c.recent(79, 3).length && c.today(91) ? 18 : 0),
  80: (c) => { const rs = [...answered(1), ...answered(71), ...answered(72)].filter((r) => +new Date(r.ts) > Date.now() - 7 * 86400000); const days = new Set(rs.filter((r) => ans(r, 'stress') >= 8 || ans(r, 'src')).map((r) => dayKey(r.ts))); const hi = new Set(answered(1).filter((r) => +new Date(r.ts) > Date.now() - 7 * 86400000 && ans(r, 'stress') >= 8).map((r) => dayKey(r.ts))); return hi.size >= 3 && days.size >= 3 && !c.recent(80, 6).length ? 60 : 0; },
  82: (c) => { if (!c.opt('finance')) return 0; const e = A.activeEvents().find((x) => /\b(bill|rent|invoice|emi|premium|tax)\b/i.test(x.title || '') && c.mins(x.start) > -1440 && c.mins(x.start) < 4320 && !hasRef(82, x)); return e ? { p: 44, ref: evRef(e) } : 0; },
  85: (c) => (c.opt('finance') && c.dow === 0 && c.evening && !c.recent(85, 6).length ? 22 : 0),
  88: (c) => { const t = c.tasks.find((x) => (x.rescheduleCount || 0) >= 3 && /\b(pay|renew|form|bank|insurance|book|call|passport|visa|tax|admin|register)\b/i.test(x.title) && !hasRef(88, x)); return t ? { p: 30, ref: taskRef(t) } : 0; },
  90: (c) => (c.opt('finance') && c.dow === 6 && !c.recent(90, 6).length ? 20 : 0),
  91: (c) => (c.hour >= 19.5 && c.hour < 23.5 && !c.today(91) ? 55 : 0),
  92: (c) => { const t = c.tasks.find((x) => x.due && dayKey(x.due) === dayKey(addDays(c.now, -1)) && x.priority === 'high' && !hasRef(92, x)); return c.morning && t ? { p: 28, ref: taskRef(t) } : 0; },
  95: (c) => (c.hour >= 20 && c.hour < 23 && c.todayTasks.length && !c.today(95) ? 38 : 0),
  96: (c) => { const t = c.today(11); const m = clock(ans(t, 'target')); const nowM = Math.floor(c.hour * 60); return m != null && c.todayTasks.length && nowM >= m - 45 && nowM <= m + 30 && !c.today(96) ? 30 : 0; },
  97: (c) => (c.today(91) && !c.today(97) && ageMin(c.today(91)) < 120 ? 26 : 0),
  98: (c) => (c.dow === 0 && c.hour >= 17 && c.hour < 22 && !c.recent(98, 6).length ? 34 : 0),
  99: (c) => { const p = patternCandidates().find((x) => x.tier >= 1 && !x.status); return p ? { p: 30, ref: { type: 'pattern', id: p.id, label: p.label }, detail: p } : 0; },
  100: (c) => (ageMin(c.last(100)) > 30 * 1440 && store.all('memories').length >= 3 ? 25 : 0),
};
const hasRef = (id, o, days = 1) => answered(id).concat(all().filter((r) => r.checkinId === id && r.status === 'dismissed')).some((r) => r.ref?.id === o.id && +new Date(r.ts) > Date.now() - days * 86400000 - 1);
const prepDone = (id, e) => answered(id).some((r) => r.ref?.id === e.id);
const lastLogAge = (type) => { const t = Math.max(0, ...store.all('logs').filter((l) => l.type === type).map((l) => +new Date(l.ts))); return t ? (Date.now() - t) / 60000 : Infinity; };
const T_goal = (rx) => { try { return store.all('trackers').some((t) => new RegExp(rx, 'i').test(`${t.name} ${t.description || ''}`)) || store.all('goals').some((g) => new RegExp(rx, 'i').test(g.title || '')); } catch { return false; } };

// ---------- patterns (check-in 99): associations only, never causes ----------
export const tierOf = (n) => (n >= 20 ? 3 : n >= 10 ? 2 : n >= 5 ? 1 : 0);
export const TIER_TEXT = ['Not enough observations yet — I won’t claim a pattern.', 'Early signal — keep watching.', 'Moderate personal evidence.', 'Stronger personal pattern — still an association, not a cause.'];
export function patternCandidates() {
  const out = []; const st = getCx().patterns || {};
  const daily = (id, k) => { const m = new Map(); for (const r of answered(id)) if (isNum(ans(r, k))) m.set(dayKey(r.ts), ans(r, k)); return m; };
  const rest = daily(14, 'rest');
  // factor from check-in 18 vs restfulness from check-in 14 the same morning
  const factors = new Map();
  for (const r of answered(18)) for (const f of ans(r, 'f') || []) (factors.get(f) || factors.set(f, new Set()).get(f)).add(dayKey(r.ts));
  for (const [f, days] of factors) {
    const withV = [...days].map((d) => rest.get(d)).filter(isNum); const without = [...rest].filter(([d]) => !days.has(d)).map(([, v]) => v);
    if (withV.length < 3 || without.length < 3) continue;
    const mw = mean(withV), mo = mean(without); const exc = withV.filter((v) => (mw < mo ? v >= mo : v <= mo)).length;
    out.push({ id: `rest~${f}`, label: `${f.toLowerCase()} the evening before and how restful sleep felt`, n: withV.length, nOther: without.length, a: round(mw), b: round(mo), exceptions: exc, tier: tierOf(withV.length), window: 'your check-in answers', status: st[`rest~${f}`]?.status || null, text: `On mornings after “${f.toLowerCase()}” you rated restfulness ${round(mw)} on average (${withV.length} mornings) vs ${round(mo)} otherwise (${without.length} mornings); ${exc} exception${exc === 1 ? '' : 's'}.` });
  }
  // late bedtime vs next-morning energy (check-in 2 and 1)
  const bed = new Map(); for (const r of answered(2)) { const m = clock(ans(r, 'bed')); if (m != null) bed.set(dayKey(r.ts), m < 720 ? m + 1440 : m); }
  const en = daily(1, 'energy'); const med = median([...bed.values()]);
  if (med != null && bed.size >= 8) {
    const late = [...bed].filter(([, m]) => m - med >= 45).map(([d]) => en.get(d)).filter(isNum); const rest2 = [...bed].filter(([, m]) => m - med < 45).map(([d]) => en.get(d)).filter(isNum);
    if (late.length >= 3 && rest2.length >= 3) { const mw = mean(late), mo = mean(rest2); const exc = late.filter((v) => (mw < mo ? v >= mo : v <= mo)).length; out.push({ id: 'late~energy', label: 'later-than-usual bedtimes and next-morning energy', n: late.length, nOther: rest2.length, a: round(mw), b: round(mo), exceptions: exc, tier: tierOf(late.length), window: 'your check-in answers', status: st['late~energy']?.status || null, text: `After bedtimes 45+ minutes later than your usual, morning energy averaged ${round(mw)} (${late.length} mornings) vs ${round(mo)} (${rest2.length}); ${exc} exception${exc === 1 ? '' : 's'}.` }); }
  }
  return out.filter((p) => !(p.status === 'no'));
}

// ---------- selection ----------
const shownToday = (s, key) => (s.shown[key] || []).length;
function eligible(def, c, s) {
  const cx = c.cx;
  if (cx.off.includes(def.id)) return null;
  if (def.optin && !cx.optin[def.optin]) return null;
  const fn = TRIG[def.id]; if (!fn) return null;
  let r; try { r = fn(c); } catch { return null; }
  if (!r) return null; if (typeof r === 'number') r = { p: r };
  const ref = r.ref || null;
  if (s.snooze[refKey(def.id, ref)] > Date.now()) return null;
  // freshness: a recent answer to the same question (for the same event/task) is never asked again
  if (def.fresh > 0) { const last = answered(def.id).find((x) => !def.perEvent && !def.perItem ? true : x.ref?.id === ref?.id); if (last && ageMin(last) < def.fresh) return null; }
  let p = r.p;
  // dismissed often → lower priority automatically, and stop after 3 (you can re-enable it in Check-ins)
  const dis = dismissals(def.id, 14); if (dis >= 3 && p < URGENT) return null; if (dis === 2) p *= 0.5; else if (dis === 1) p *= 0.85;
  // ask less as it learns more: three identical answers in a row → this question matters less
  const l3 = answered(def.id).slice(0, 3).map((x) => JSON.stringify(x.answers)); if (l3.length === 3 && new Set(l3).size === 1 && p < URGENT) p *= 0.6;
  return { def, ref, p, detail: r.detail || null };
}
/** What would be eligible at a given moment — no side effects. Used to plan background notifications. */
export function peek(at) { const c = ctx(at); const s = ls(); return CHECKINS.map((d) => eligible(d, c, s)).filter((e) => e && e.p >= MIN_PRIORITY).sort((a, b) => b.p - a.p); }
const NOTE_OK = new Set(['work', 'plan']); // other domains are personal: the notification stays generic
/** Background notifications for check-ins: at most 2 a day, 3+ hours apart, outside quiet hours, never for the morning/evening check-ins (those have their own nudges). */
export function pushPlan(now = new Date()) {
  const cx = getCx(); if (!cx.on || cx.push === false) return []; const mode = store.settings().advisorMode || 'balanced'; const cap = Math.min(2, CAPS[mode] ?? 4); const out = [];
  for (let i = 0; i < 3; i++) {
    const day = addDays(now, i); const cands = [];
    for (let h = 9; h <= 20; h++) {
      const at = new Date(day); at.setHours(h, 0, 0, 0); if (+at <= +now + 60000 || isQuiet(at)) continue;
      const c = ctx(at); const e = peek(at).find((x) => ![1, 91].includes(x.def.id)); if (!e) continue;
      const b = build(e, c); cands.push({ id: e.def.id, p: e.p, at: +at, ref: e.ref, body: NOTE_OK.has(e.def.domain) ? `One quick question: ${b.prompt}`.slice(0, 150) : 'A quick check-in is waiting — one question, about a minute.' });
    }
    const chosen = []; // most valuable first, keeping 3+ hours between them
    for (const c of cands.sort((a, b) => b.p - a.p || a.at - b.at)) { if (chosen.length >= cap) break; if (chosen.some((y) => y.id === c.id || Math.abs(y.at - c.at) < 3 * 3600000)) continue; chosen.push(c); }
    for (const c of chosen) out.push({ id: `cx:${c.id}:${dayKey(new Date(c.at))}${c.ref?.id ? `:${c.ref.id}` : ''}`, at: c.at, title: 'LifeOS check-in', body: c.body });
  }
  return out;
}
export const dismissals = (id, days = 14) => all().filter((r) => r.checkinId === id && r.status === 'dismissed' && +new Date(r.ts) > Date.now() - days * 86400000).length;

/** The one check-in to show right now, or null (silence). Sticky: once chosen it stays until answered/dismissed/snoozed. */
export function current(now = new Date()) {
  const c = ctx(now); const s = ls();
  if (!c.cx.on || F.active() || s.lock > Date.now()) return null;
  const quiet = isQuiet(now);
  if (s.cur && Date.now() - s.cur.ts < 3 * 3600000) { // a question already chosen stays put until you answer, skip or snooze it
    const def = getDef(s.cur.id); const urgentNow = !s.cur.followup && !s.cur.manual && CHECKINS.map((d) => eligible(d, c, s)).some((e) => e && e.p >= URGENT && e.def.id !== s.cur.id); // something urgent (an event starting soon) pre-empts a routine question
    const keep = urgentNow ? null : def && (s.cur.followup || s.cur.manual ? { def, ref: s.cur.ref, p: 50 } : eligible(def, c, s));
    if (keep && (!quiet || keep.p >= URGENT || s.cur.manual)) return build(keep, c);
    s.cur = null; lsave(s);
  }
  const list = CHECKINS.map((d) => eligible(d, c, s)).filter((e) => e && e.p >= MIN_PRIORITY).sort((a, b) => b.p - a.p);
  const top = list[0]; if (!top) return null;
  const urgent = top.p >= URGENT; if (quiet && !urgent) return null;
  const cap = CAPS[c.mode] ?? 4;
  if (!urgent && shownToday(s, c.key) >= cap) return null;
  const lastRes = all().filter((r) => +new Date(r.ts) > Date.now() - 90 * 60000).sort((a, b) => b.ts.localeCompare(a.ts))[0];
  if (!urgent && lastRes && !s.cur && lastRes.checkinId !== top.def.id) return null; // 90 minutes between non-urgent check-ins
  s.cur = { id: top.def.id, ref: top.ref, ts: Date.now() }; (s.shown[c.key] ||= []).push(top.def.id); lsave(s);
  return build(top, c);
}
const isQuiet = (d) => { const [a, b] = store.settings().quietHours || ['22:00', '07:00']; const m = d.getHours() * 60 + d.getMinutes(); const f = clock(a), t = clock(b); return f === t ? false : f < t ? m >= f && m < t : m >= f || m < t; };
function build(e, c) {
  const d = e.def; let prompt = d.prompt; let detail = e.detail || null;
  if (d.id === 99 && !detail) detail = patternCandidates().find((x) => x.id === e.ref?.id) || patternCandidates().find((x) => x.tier >= 1 && !x.status) || null;
  if (d.id === 99 && detail) prompt = `I’ve noticed a possible pattern: ${detail.text} ${TIER_TEXT[detail.tier]} Does that match your experience?`;
  if (d.id === 7) { const r = c.today(2); prompt = `You told me you slept about ${ans(r, 'sleptH')} h — shorter than your target of ${c.cx.sleepH} h. How do you actually feel this morning?`; }
  if (d.id === 17) { const w = weeklyShortfall(c); if (w) prompt = `You’re about ${round(w.short, 1)} h below your sleep target so far this week (calculated from ${w.n} nights you confirmed). Is that intentional or unwanted?`; }
  if (d.id === 72) prompt = `Your stress is ${c.st.stress} today, above your usual ${round(c.base('stress', 30).v)} (30-day average). Do you know what changed?`;
  return { id: d.id, def: d, ref: e.ref, prompt, detail, why: d.when, priority: e.p };
}
export function dismiss(id, ref, { mins = 0 } = {}) {
  const s = ls(); if (s.cur?.id === id) s.cur = null;
  if (mins) s.snooze[refKey(id, ref)] = Date.now() + mins * 60000; lsave(s);
  if (!mins) return store.save(STORE, { checkinId: id, status: 'dismissed', ts: nowISO(), ref: ref || null, provenance: 'user_told' });
}
export const snooze = (id, ref, mins = 120) => dismiss(id, ref, { mins });
/** Start a specific check-in on demand (from the library). */
export function startNow(id, ref = null) { const s = ls(); s.cur = { id, ref, ts: Date.now(), manual: true }; lsave(s); }
/** Follow-up chosen by the advisor: becomes the next (single) question. */
function queue(id, ref = null) { const s = ls(); s.cur = { id, ref, ts: Date.now(), followup: true }; lsave(s); }
export const clearCurrent = () => { const s = ls(); s.cur = null; lsave(s); };

// ---------- answering ----------
export function clean(def, raw) {
  const out = {};
  for (const f of def.fields) {
    let v = raw[f.k]; if (v === '' || v === undefined) v = null;
    if (f.t === 'scale') { v = v == null ? null : Math.min(f.max, Math.max(f.min, Math.round(Number(v)))); if (!isNum(v)) v = null; }
    else if (f.t === 'number') { v = v == null ? null : Number(v); if (!isNum(v) || v < 0) v = null; }
    else if (f.t === 'time') v = /^\d{1,2}:\d{2}$/.test(v || '') ? String(v) : null;
    else if (f.t === 'multi') v = Array.isArray(v) && v.length ? v.filter((x) => f.o.includes(x)) : null;
    else if (f.t === 'choice') v = f.o.includes(v) ? v : null;
    else v = v == null ? null : String(v).trim().slice(0, 600) || null;
    out[f.k] = v;
  }
  return out;
}
const hasData = (a) => Object.values(a).some((v) => v != null && !(Array.isArray(v) && !v.length));

/** Save an answer. Returns { rec, calc, decision, safety }. Nothing is estimated: empty fields stay null. */
export async function submit(id, raw, ref = null) {
  const def = getDef(id); const answers = clean(def, raw);
  if (!hasData(answers)) return { empty: true };
  const text = Object.values(answers).filter((v) => typeof v === 'string').join(' ');
  let safety = scanSafety(text);
  if (!safety && def.safety && isNum(answers.severity) && answers.severity >= 8) safety = 'severe';
  if (!safety && [49].includes(id) && /worse|affecting me/i.test(String(answers.aff))) safety = 'severe';
  if (!safety && id === 46 && answers.pain === 'Unusual pain' && (answers.severity || 0) >= 7) safety = 'severe';
  let rec = await store.save(STORE, { checkinId: id, domain: def.domain, status: 'answered', ts: nowISO(), answers, ref: ref ? { type: ref.type, id: ref.id, label: ref.label } : null, provenance: 'user_told', logIds: [], calc: null, decision: null });
  const s = ls(); if (s.cur?.id === id) s.cur = null; lsave(s);
  rec = await store.save(STORE, { id: rec.id, logIds: await writeThrough(def, rec) });
  const calc = calculate(def, rec); if (calc) rec = await store.save(STORE, { id: rec.id, calc });
  if (safety) { const s2 = ls(); s2.lock = Date.now() + 6 * 3600000; s2.cur = null; lsave(s2); const d = { action: 'safety_escalation', text: SAFETY_TEXT[safety] }; await store.save(STORE, { id: rec.id, decision: { action: d.action }, safety }); return { rec, calc, decision: d, safety }; }
  const decision = await decide(def, rec, calc); await store.save(STORE, { id: rec.id, decision: { action: decision.action } });
  return { rec, calc, decision };
}
async function dropLogs(ids) { for (const lid of ids || []) { for (const f of store.all('finance').filter((x) => x.logId === lid)) await store.remove('finance', f.id, { silent: true }); await store.remove('logs', lid, { silent: true }); } }
export async function updateFact(recId, raw) {
  const rec = store.get(STORE, recId); const def = getDef(rec.checkinId); const answers = clean(def, raw);
  await dropLogs(rec.logIds);
  const r2 = await store.save(STORE, { id: recId, answers, edited: nowISO(), logIds: [] });
  const logIds = await writeThrough(def, r2); const calc = calculate(def, { ...r2, logIds });
  return store.save(STORE, { id: recId, logIds, calc });
}
export async function removeFact(recId) {
  const rec = store.get(STORE, recId); if (!rec) return;
  await dropLogs(rec.logIds);
  await store.remove(STORE, recId);
}

// ---------- what an answer writes into the rest of LifeOS (only what you actually said) ----------
const log = async (logType, value, unit = '', detail = '', ts) => { const r = await execute({ type: 'create_log', payload: { logType, value, unit, detail, ts, source: 'checkin', meta: { checkin: true } } }, { origin: 'user' }); return r?.record?.id || r?.id || null; };
async function writeThrough(def, rec) {
  const a = rec.answers; const ids = []; const push = (x) => { if (x) ids.push(x); };
  try {
    if (def.id === 1) for (const k of ['energy', 'mood', 'stress']) if (isNum(a[k])) push(await log(k, a[k]));
    if (def.id === 71 && isNum(a.mood)) push(await log('mood', a.mood));
    if (def.id === 66) { if (isNum(a.energy)) push(await log('energy', a.energy)); if (isNum(a.stress)) push(await log('stress', a.stress)); }
    if (def.id === 45) { if (isNum(a.energy)) push(await log('energy', a.energy)); if (isNum(a.mood)) push(await log('mood', a.mood)); }
    if (def.id === 7 && isNum(a.energy)) push(await log('energy', a.energy));
    if (def.id === 2 && a.known === 'Yes' && isNum(a.sleptH)) push(await log('sleep', Math.min(24, a.sleptH), 'h')); // time in bed is never written as sleep
    if (def.id === 31 && isNum(a.ml) && a.ml > 0) push(await log('water', Math.min(6000, a.ml), 'ml'));
    if (def.id === 39 && isNum(a.ml) && a.ml > 0) push(await log('water', Math.min(6000, a.ml), 'ml'));
    if (def.id === 34 && isNum(a.mg)) push(await log('caffeine', a.mg, 'mg', a.drink || ''));
    if (def.id === 44 && isNum(a.mins) && a.mins > 0) push(await log('workout', a.mins, 'min', [a.type, a.note].filter(Boolean).join(' — ')));
    if (def.id === 53 && isNum(a.focus)) push(await log('focus', a.focus));
    if (def.id === 21 && a.ate === 'Yes') push(await log('meal', null, '', 'Ate (check-in)'));
    if (def.id === 81 && isNum(a.amount) && a.amount > 0) push(await log('expense', a.amount, '', [a.category, a.note].filter(Boolean).join(' — '), undefined));
    if (def.id === 91 && isNum(a.overall)) push(await log('mood', a.overall, '', a.note || 'Day rating'));
    if (def.id === 79 && a.good) push(await log('note', null, '', `Went well: ${a.good}`));
    if ([94, 93].includes(def.id) && (a.drain || a.helped)) push(await log('note', null, '', `${def.id === 94 ? 'Drained me' : 'Helped my energy'}: ${a.drain || a.helped}`));
    if (def.id === 3) for (const k of ['p1', 'p2', 'p3']) if (a[k]) { const r = await execute({ type: 'create_task', payload: { title: a[k], due: (() => { const d = new Date(); d.setHours(18, 0, 0, 0); return d.toISOString(); })() } }, { origin: 'user' }); void r; }
    if (def.id === 10 && a.ctx && a.ctx !== 'Normal') await addMemory({ text: `Today is not a normal day: ${a.ctx}${a.detail ? ` (${a.detail})` : ''}`, kind: 'temporary_context', source: 'user_explicit', confidence: 1, expiresInDays: isNum(a.days) && a.days > 0 ? Math.min(30, Math.ceil(a.days)) : 1 });
    if (def.id === 11 && a.target) { /* tonight-only intention; stored as the fact itself */ }
  } catch (e) { console.warn('check-in write-through', e); }
  return ids;
}

// ---------- calculations: always labelled, always with their window ----------
function calculate(def, rec) {
  const a = rec.answers; const out = {}; const c = { label: 'calculated', window: null, sources: [rec.id], items: [] };
  const item = (name, value, unit, how) => c.items.push({ name, value, unit, how });
  if (def.id === 1) for (const k of ['energy', 'mood', 'stress']) if (isNum(a[k])) { const b30 = A.baseline(k, 30), n = A.sampleCount(k, 30); if (n >= 5 && isNum(b30)) { out[k] = round(a[k] - b30); item(`${k} vs your 30-day average`, round(a[k] - b30), 'pts', `${n} days with data; your average is ${round(b30)}`); } }
  if (def.id === 2) { const b = clock(a.bed), w = clock(a.wake); if (b != null && w != null) { const g = gapMin(b, w); out.timeInBedH = round(g / 60, 1); item('Time in bed', round(g / 60, 1), 'h', 'from your bed and wake times — this is not the same as sleep'); } }
  if (def.id === 12) { const t = answered(11)[0]; const i = clock(ans(t, 'target')), x = clock(a.approx); if (i != null && x != null) { let d = x - i; if (d > 720) d -= 1440; if (d < -720) d += 1440; out.diffMin = d; item('Intended vs actual', d, 'min', 'your intended time vs the time you reported'); } }
  if (def.id === 22) { const prev = answered(22).filter((r) => dayKey(r.ts) === dayKey(rec.ts) && r.id !== rec.id).map((r) => clock(ans(r, 'at'))).filter(isNum); const t = clock(a.at); if (t != null && prev.length) { const g = Math.min(...prev.map((p) => gapMin(p, t))); item('Since your previous logged meal', round(g / 60, 1), 'h', 'between meals you logged today'); } }
  if (def.id === 31 || def.id === 39) { const t = getCx().hydrationMl; if (isNum(t) && isNum(A.currentState().water)) item('Water today vs your target', Math.round(((A.currentState().water || 0) / t) * 100), '%', `logged ml ÷ the ${t} ml target you set`); }
  if (def.id === 44) { const m = weekMoveMinutes(new Date()); item('Activity logged this week', m, 'min', 'sum of workout logs in the last 7 days'); const strength = answered(44).filter((r) => +new Date(r.ts) > Date.now() - 7 * 86400000 && /strength|weights?|gym|resistance/i.test(`${ans(r, 'type')}`)).length; item('Strength sessions this week', strength, '', 'sessions whose type mentions strength / weights / gym'); }
  if (def.id === 57) { /* estimate error needs an estimate and an actual; shown only when both exist */ }
  if (def.id === 17 || def.id === 19) { const w = weeklyShortfall(ctx()); if (w) item('Sleep vs your target (7 days)', round(w.short, 1), 'h', `${w.n} nights you confirmed, against a ${getCx().sleepH} h target`); }
  return c.items.length ? c : null;
}

// ---------- the advisor's next move: silent, acknowledge, one suggestion, one follow-up, or a safety response ----------
async function decide(def, rec, calc) {
  const execute = (a) => baseExecute(a, { origin: 'user', source: 'check-in', why: 'You approved this suggestion from a check-in.', evidence: [`Your answer to check-in #${def.id}`] });
  const a = rec.answers; const id = def.id; const act = { action: 'stay_silent', text: '', buttons: [] };
  const say = (action, text, buttons = []) => Object.assign(act, { action, text, buttons });
  const plan = { label: 'Show a lighter plan', run: 'plan' };
  const addTask = (title, due) => ({ label: 'Add as a task', run: async () => { await execute({ type: 'create_task', payload: { title, due } }, { origin: 'user' }); } });
  if (id === 1) {
    const low = (k) => calc?.items.find((i) => i.name.startsWith(k) && Math.abs(i.value) >= 2);
    const bad = ['energy', 'mood'].some((k) => { const i = low(k); return i && i.value < 0; }) || (() => { const i = low('stress'); return i && i.value > 0; })();
    if (bad) { queue(5); say('ask_one_followup', 'That’s a bit different from your usual — one more question about it.'); } else say('stay_silent', 'Thanks — nothing unusual compared with your own average.');
  } else if (id === 2) {
    const t = calc?.items.find((i) => i.name === 'Time in bed'); const sl = a.known === 'Yes' && isNum(a.sleptH);
    if (sl && isNum(getCx().sleepH) && getCx().sleepH - a.sleptH >= 1) { queue(7); say('ask_one_followup', `You slept about ${a.sleptH} h — below your ${getCx().sleepH} h target.`); } else say('acknowledge', t ? `Time in bed: about ${t.value} h. I won’t count that as sleep unless you tell me how long you actually slept.` : 'Saved.');
  } else if (id === 5) {
    if (['Low', 'Limited'].includes(a.capacity)) say('propose_schedule_change', 'Thanks. I won’t move anything unless you say so — want a lighter plan for today?', [plan]);
    else say('stay_silent', 'Okay — I’ll plan around that.');
  } else if (id === 7) { say('suggest_one_action', a.feel === 'Affected' || (a.energy ?? 10) <= 4 ? 'Noted. Consider keeping today lighter — your call.' : 'Good — you feel fine despite the shorter night, so I won’t treat it as a problem.', a.feel === 'Affected' ? [plan] : []); }
  else if (id === 9) { if (a.none === 'Nothing needed') say('stay_silent', 'Great — I’ll stop adding prep for this one.'); else if (a.prep) say('suggest_one_action', 'I can add that as a task.', [addTask(`Prepare: ${a.prep}`, rec.ref ? store.get('events', rec.ref.id)?.start : '')]); else say('acknowledge', 'Saved.'); }
  else if (id === 10) say('acknowledge', a.ctx && a.ctx !== 'Normal' ? `Got it — I’ll treat today as “${a.ctx.toLowerCase()}” and won’t judge it against your normal routine.` : 'Normal day — I’ll stay out of the way.');
  else if (id === 14 || id === 15) say('acknowledge', 'Saved as context. I won’t draw conclusions from a single night.');
  else if (id === 17) { if (a.why === 'My target is wrong') say('suggest_one_action', 'Then let’s fix the target instead of warning you about it.', [{ label: 'Edit my sleep target', run: 'sleep-target' }]); else if (a.why === 'Unwanted') say('suggest_one_action', 'Then protecting your evening matters most this week.', [{ label: 'Plan an earlier wind-down', run: 'plan' }]); else say('stay_silent', 'Okay — I won’t nag about it.'); }
  else if (id === 19) { if (a.prob === 'Yes') { await setCx({ sleepChange: nowISO() }); say('suggest_one_action', 'One small step: keep your wake-up time the same for the next few days. I’ll check how it feels in about 3–7 days.'); } else say('stay_silent', 'Okay — I won’t flag it again.'); }
  else if (id === 20) say('acknowledge', a.eff === 'Better' ? 'Good to hear. I’ll note it as one data point — not proof.' : a.eff === 'Worse' ? 'Thanks. Worth reverting or trying something different.' : 'Okay — unchanged is useful information too.');
  else if (id === 41) { if (['Walk', 'Workout', 'Mobility', 'Custom'].includes(a.ch || a.do)) { const t = a.at ? new Date(`${dayKey()}T${a.at.padStart(5, '0')}`) : new Date(Date.now() + 3600000); say('suggest_one_action', 'I’ll only add it if you confirm.', [{ label: `Add ${String(a.do).toLowerCase()} to my plan`, run: async () => { await execute({ type: 'create_event', payload: { title: a.do === 'Walk' ? 'Walk' : a.do === 'Mobility' ? 'Mobility' : 'Workout', type: 'workout', start: t.toISOString(), durationMin: a.do === 'Walk' ? 30 : 45 } }, { origin: 'user' }); } }]); } else say('stay_silent', 'No problem.'); }
  else if (id === 44) { const m = calc?.items.find((i) => i.name.startsWith('Activity logged')); say('acknowledge', m ? `Logged. ${m.value} min of activity in the last 7 days (from your logs).${m.value >= 150 ? '' : ' General adult guidance is 150–300 min of moderate activity a week; some is better than none.'}` : 'Logged.'); }
  else if (id === 52) { const r = a.why; say('suggest_one_action', r === 'Too big' ? 'Want to split it into a first small step?' : r === 'Not important' ? 'Then dropping it is a fair choice.' : r === 'Waiting on someone' ? 'Then it’s blocked — I’ll stop reminding you until you can move.' : 'Thanks — I’ll stop guilt-based reminders for this one.', r === 'Not important' && rec.ref ? [{ label: 'Drop this task', run: async () => { await store.remove('tasks', rec.ref.id); } }] : r === 'Too big' && rec.ref ? [{ label: 'Add a first small step', run: async () => { await execute({ type: 'create_task', payload: { title: `First step: ${rec.ref.label}` } }, { origin: 'user' }); } }] : []); }
  else if (id === 55 || id === 56) {
    const st = a.st || a.do; const t = rec.ref && store.get('tasks', rec.ref.id);
    if (t) { if (st === 'Done') await execute({ type: 'update_task', payload: { id: t.id, status: 'done' } }, { origin: 'user' }); else if (st === 'Drop it') await store.remove('tasks', t.id); else if (st === 'Move it') { const d = addDays(new Date(), 1); d.setHours(9, 0, 0, 0); await execute({ type: 'reschedule_task', payload: { id: t.id, due: d.toISOString() } }, { origin: 'user' }); } else if (st === 'Blocked') { queue(52, rec.ref); } }
    say(st === 'Blocked' ? 'ask_one_followup' : 'acknowledge', st === 'Done' ? 'Marked done.' : st === 'Drop it' ? 'Dropped — I’ll stop counting it.' : st === 'Move it' ? 'Moved to tomorrow morning.' : st === 'Blocked' ? 'What’s blocking it?' : 'Okay.');
  }
  else if (id === 58) { if (a.do === 'Suggest a plan' || a.do === 'Move some tasks') say('propose_schedule_change', 'Nothing moves until you confirm.', [{ label: 'Open Plan my day', run: 'plan' }]); else say('stay_silent', 'Okay — keeping everything.'); }
  else if (id === 60) say('acknowledge', a.done === 'Working late' ? 'Okay — I’ll factor in a later evening.' : 'Good. Enjoy your evening.');
  else if (id === 63) { const lvl = a.prep; say(lvl && lvl !== 'None' ? 'suggest_one_action' : 'stay_silent', lvl && lvl !== 'None' ? 'I’ll propose a short prep checklist you can approve — nothing is added automatically.' : 'No prep — I’ll stop adding reminders for it.', lvl && lvl !== 'None' ? [{ label: 'Add one prep task', run: async () => { await execute({ type: 'create_task', payload: { title: `Prepare: ${rec.ref?.label || 'event'}${a.what ? ` — ${a.what}` : ''}`, due: rec.ref && store.get('events', rec.ref.id)?.start } }, { origin: 'user' }); } }] : []); }
  else if (id === 64 || id === 65) { if (a.state === 'Ready') say('stay_silent', 'Great — I’ll reduce reminders for this.'); else say('suggest_one_action', 'Pick at most one or two high-value things — I can add the first as a task.', a.left || a.ready ? [addTask(`Prepare: ${a.left || a.ready}`, rec.ref ? store.get('events', rec.ref.id)?.start : '')] : []); }
  else if (id === 66) { const hi = (a.stress ?? 0) >= 7; say('suggest_one_action', hi ? 'If you feel prepared, a few slow breaths may help more than extra prep — your call.' : 'Sounds steady.', hi ? [{ label: 'Start a 5-min calm focus', run: async () => { F.start({ label: 'Calm before the event', minutes: 5, quiet: true, track: false }); } }] : []); }
  else if (id === 68) { if (a.win === 'Suggest a fix') say('propose_schedule_change', 'I’d suggest moving the shorter or less important one — tell me which and I’ll draft it.'); else say('stay_silent', 'Noted.'); }
  else if (id === 72) say('suggest_one_action', a.src && a.src !== 'Unclear' ? `Thanks — ${a.src.toLowerCase()} noted. If it helps, a short walk or a few slow breaths can take the edge off; or I can leave it alone.` : 'Okay. I’ll leave it unless you want help.');
  else if (id === 80) { if (a.coping === 'Want support') say('suggest_one_action', 'It can help to talk to someone you trust, or a doctor or counsellor if this has gone on for a while. LifeOS can keep tracking, but it isn’t a substitute for support.'); else say('acknowledge', 'Thanks for telling me. I’ll keep it light.'); }
  else if (id === 91) { queue(97); say('ask_one_followup', 'Thanks. Here’s a quick summary to check.'); }
  else if (id === 95) { say(a.carry === 'Suggest for me' ? 'propose_schedule_change' : 'acknowledge', a.carry === 'Suggest for me' ? 'I’ll only move what you approve.' : 'Okay.', a.carry === 'Suggest for me' ? [{ label: 'Move today’s open tasks to tomorrow', run: async () => { const d = addDays(new Date(), 1); d.setHours(9, 0, 0, 0); for (const t of store.all('tasks').filter((x) => x.status === 'open' && x.due && dayKey(x.due) <= dayKey())) await execute({ type: 'reschedule_task', payload: { id: t.id, due: d.toISOString() } }, { origin: 'user' }); } }] : []); }
  else if (id === 97) { if (a.ok !== 'Looks right' && a.fix) await log('note', null, '', `Correction to today’s summary: ${a.fix}`); say('acknowledge', a.ok === 'Looks right' ? 'Good.' : 'Thanks — I’ve noted that correction. Your correction wins over my summary.'); }
  else if (id === 99) { const p = rec.ref?.id; const m = a.m; const st = { ...getCx().patterns }; st[p] = { status: m === 'Yes' ? 'yes' : m === 'No' ? 'no' : m === 'Maybe' ? 'maybe' : 'watch', ts: nowISO() }; await setCx({ patterns: st }); const cand = patternCandidates().find((x) => x.id === p) || null; if (m === 'Yes' && cand) await addMemory({ text: `Possible pattern (confirmed by you): ${cand.text}`, kind: 'observed_pattern', source: 'user_confirmed_pattern', confidence: 0.6, evidenceCount: cand.n }); say('acknowledge', m === 'Yes' ? 'Saved as a pattern you confirmed — still an association, not a cause.' : m === 'No' ? 'Retired — I won’t bring it up again.' : 'Okay — I’ll keep watching quietly.'); }
  else if (id === 100) say('acknowledge', 'Opening your memories — correct, forget, make private or temporary.', [{ label: 'Open memories', run: 'memories' }]);
  else if (id === 82 && a.st === 'Paid') say('stay_silent', 'Marked — no more reminders for it.');
  else if (id === 88) say('acknowledge', a.do === 'Drop it' ? 'Dropped.' : a.do === 'Do it now' ? 'Go for it — I’ll leave you to it.' : 'Okay.');
  else if (id === 11) say('acknowledge', 'I’ll keep that in mind for tonight only — no alarms.');
  else if (id === 37) say('acknowledge', 'Logged exactly as you said. I never advise on doses — ask your clinician or pharmacist about any change.');
  else say('acknowledge', 'Saved. One answer isn’t a trend, so I won’t read much into it.');
  return act;
}

// ---------- library status (for the Check-ins screen) ----------
export function libraryStatus() {
  const c = ctx(); const s = ls(); const cx = c.cx;
  return CHECKINS.map((d) => {
    const last = answered(d.id)[0] || null; const dis = dismissals(d.id, 14);
    const e = cx.off.includes(d.id) || (d.optin && !cx.optin[d.optin]) ? null : eligible(d, c, s);
    return { def: d, last, dismissed: dis, off: cx.off.includes(d.id), needsOptin: d.optin && !cx.optin[d.optin] ? d.optin : null, contextual: !!TRIG[d.id], eligibleNow: !!(e && e.p >= MIN_PRIORITY), count: answered(d.id).length };
  });
}
export function interruptionState(now = new Date()) { const c = ctx(now); const s = ls(); return { cap: CAPS[c.mode] ?? 4, shown: shownToday(s, c.key), mode: c.mode, quiet: isQuiet(now) }; }
export const history = (limit = 60) => all().filter((r) => r.status === 'answered').sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, limit);
export const answeredToday = (key = dayKey()) => all().filter((r) => r.status === 'answered' && dayKey(r.ts) === key).sort((a, b) => a.ts.localeCompare(b.ts));

export function summarize(def, answers) {
  return def.fields.map((f) => { const v = answers?.[f.k]; if (v == null || (Array.isArray(v) && !v.length)) return null; return `${f.l.replace(/\s*\(.*\)/, '')}: ${Array.isArray(v) ? v.join(', ') : f.t === 'number' && f.u ? `${v} ${f.u}` : v}`; }).filter(Boolean).join(' · ');
}

// ---------- daily report: logged / calculated / may be happening ----------
export function report(key = dayKey()) {
  const logged = answeredToday(key).map((r) => { const d = getDef(r.checkinId); return { id: r.id, time: r.ts, q: d.prompt, a: summarize(d, r.answers), by: r.provenance }; });
  const calculated = []; const thinks = [];
  for (const r of answeredToday(key)) for (const i of r.calc?.items || []) calculated.push({ text: `${i.name}: ${i.value}${i.unit ? ` ${i.unit}` : ''}`, how: i.how, from: r.id });
  const load = A.loadForDay(key); const evs = A.eventsOnDay(key).filter((e) => !e.allDay && e.type !== 'reminder');
  if (evs.length) calculated.push({ text: `Scheduled today: ${evs.length} event${evs.length === 1 ? '' : 's'}, ${Math.round(evs.reduce((s, e) => s + A.eventMinutes(e), 0) / 60 * 10) / 10} h (schedule load: ${A.loadLevel(load)})`, how: 'from your calendar; load weights duration, importance and type', from: null });
  const fm = F.todaySummary(key); if (fm.count) calculated.push({ text: `Focus time: ${fm.minutes} min in ${fm.count} session${fm.count === 1 ? '' : 's'}`, how: 'from focus sessions you started', from: null });
  const doneTasks = store.all('tasks').filter((t) => t.status === 'done' && t.updatedAt && dayKey(t.updatedAt) === key).length; if (doneTasks) calculated.push({ text: `Tasks completed: ${doneTasks}`, how: 'tasks you marked done today', from: null });
  for (const p of patternCandidates().filter((x) => x.tier >= 1 && x.status !== 'no')) thinks.push({ text: `There may be a link between ${p.label}: ${p.text} ${TIER_TEXT[p.tier]}`, n: p.n, window: p.window, status: p.status });
  const r1 = onDay(1, key); if (r1) { const lo = (r1.calc?.items || []).filter((i) => Math.abs(i.value) >= 2); for (const i of lo) thinks.push({ text: `Your ${i.name.split(' ')[0]} this morning appears different from your usual (${i.value > 0 ? '+' : ''}${i.value}). One reading isn’t a trend.`, n: 1, window: 'this morning vs 30-day average' }); }
  return { key, logged, calculated, thinks };
}
