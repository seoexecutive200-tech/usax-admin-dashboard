// "Right now": the app pays attention to the moment — time of day, what's on your calendar, what you just finished, what you logged,
// your routine and goals — and asks the one question that fits. Answers do things (log, create a task, start focus), and can lead to a
// follow-up question. Deciding WHAT to ask is rule-based (predictable, free); the AI only words the opening line when it's available.
import { store } from './store.js';
import * as A from './analytics.js';
import * as R from './routines.js';
import * as T from './trackers.js';
import * as F from './focus.js';
import { execute } from './actions.js';
import { dayKey, addDays, fmtTime, lsGet, lsSet, safeJSON, partOfDay } from './util.js';

const KEY = 'lifeos.moments2';
const load = () => { const s = safeJSON(lsGet(KEY), {}); return { handled: s.handled || {}, snooze: s.snooze || {} }; };
const save = (s) => { const cut = Date.now() - 4 * 86400000; for (const k of Object.keys(s.handled)) if (s.handled[k] < cut) delete s.handled[k]; for (const k of Object.keys(s.snooze)) if (s.snooze[k] < Date.now()) delete s.snooze[k]; lsSet(KEY, JSON.stringify(s)); };
export const markHandled = (key) => { const s = load(); s.handled[key] = Date.now(); save(s); };
export const snooze = (key, mins = 60) => { const s = load(); s.snooze[key] = Date.now() + mins * 60000; save(s); };
const isHandled = (s, key) => !!s.handled[key] || (s.snooze[key] || 0) > Date.now();

// ---- small actions the answers can trigger ----
const logv = (logType, value, unit = '', detail = '') => execute({ type: 'create_log', payload: { logType, value, unit, detail } }, { origin: 'user' });
const task = (title, due) => execute({ type: 'create_task', payload: { title, due: due ? new Date(due).toISOString() : '' } }, { origin: 'user' });
const note = (text) => execute({ type: 'create_log', payload: { logType: 'note', value: null, detail: text } }, { origin: 'user' });
const at = (date, h, m = 0) => { const d = new Date(date); d.setHours(h, m, 0, 0); return d; };
const tomorrow9 = (now) => at(addDays(now, 1), 9);

// ---- facts about right now ----
export function facts(now = new Date()) {
  const key = dayKey(now); const part = partOfDay(now); const hour = now.getHours();
  const evs = A.eventsOnDay(key).filter((e) => !e.allDay && e.status !== 'skipped' && e.type !== 'reminder');
  const mins = (d) => (+new Date(d) - +now) / 60000;
  const st = A.currentState(now);
  const lastLog = (type) => store.all('logs').filter((l) => l.type === type).map((l) => +new Date(l.ts)).sort((a, b) => b - a)[0] || 0;
  const tasks = store.all('tasks').filter((t) => t.status !== 'done' && (!t.due || dayKey(t.due) <= key)).sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
  const goals = T.allTrackers().flatMap((t) => { const f = T.primaryField(t); return f?.target?.period === 'goal' && !T.entriesOnDay(t.id, key).length ? [{ t, f }] : []; });
  return { now, key, part, hour, name: store.profile().name, evs, mins, st, lastLog, tasks, goals, inEvent: evs.some((e) => mins(e.start) <= 0 && mins(e.end) > 0), working: R.activeNow(now).length > 0 };
}
const eventsLine = (f) => { const up = f.evs.filter((e) => f.mins(e.end) > 0); return !up.length ? 'Nothing is scheduled yet today.' : `${up.length} thing${up.length === 1 ? '' : 's'} on your calendar today — ${up[0].title} ${f.mins(up[0].start) > 0 ? `at ${fmtTime(up[0].start)}` : 'is on now'}.`; };
const PREP = new Set(['meeting', 'appointment', 'video_call', 'deadline', 'social', 'travel']);

/** Every moment that could be shown now, best first. Each: { key, kind, label, open (opening text), start (step id), steps }. */
export function candidates(now = new Date()) {
  const f = facts(now); const s = load(); const out = []; const day = f.key;
  if (F.active()) return out; // never interrupt a focus session
  const adaptive = !!(store.settings().cx?.on ?? true); // the adaptive check-ins own the morning / evening / energy questions
  const push = (m) => { if (adaptive && ['am', 'pm', 'pulse'].includes(m.kind)) return; if (!isHandled(s, m.key)) out.push(m); };

  // 1. an event is about to start
  for (const e of f.evs) { const m = f.mins(e.start); if (m > 4 && m <= 50 && (PREP.has(e.type) || e.importance === 'high')) push({ key: `prep:${e.id}`, kind: 'prep', label: 'Coming up', open: `${e.title} starts at ${fmtTime(e.start)} — in ${Math.round(m)} minutes.`, start: 'q1', steps: {
    q1: { text: 'Anything you need to get ready?', chips: [{ l: 'I’m ready', v: 'ok' }, { l: 'Need to prepare', v: 'prep' }, { l: 'Remind me 10 min before', v: 'remind' }, { l: `Focus until it starts`, v: 'focus' }], run: async (v) => {
      if (v === 'remind') { await execute({ type: 'create_event', payload: { title: `Reminder: ${e.title}`, type: 'reminder', start: new Date(+new Date(e.start) - 10 * 60000).toISOString(), durationMin: 5 } }, { origin: 'user' }); return { done: 'Done — I’ll nudge you 10 minutes before.' }; }
      if (v === 'focus') { F.start({ label: `Before ${e.title}`, minutes: Math.max(5, Math.floor(m - 5)), quiet: true, track: false }); return { done: 'Focus is on until it starts.' }; }
      if (v === 'prep') return { next: 'q2' }; return { done: 'Great — you’re set.' }; } },
    q2: { text: 'What do you need to do?', input: { placeholder: 'e.g. print the slides' }, skip: 'Nothing specific', run: async (v) => { if (v) await task(`Before ${e.title}: ${v}`, e.start); return { done: v ? 'Added as a task due before it starts.' : 'Okay.' }; } } } }); }

  // 2. an event just ended
  for (const e of f.evs) { const m = -f.mins(e.end); if (m >= 5 && m <= 150 && (PREP.has(e.type) && e.type !== 'travel') && (+new Date(e.end) - +new Date(e.start)) >= 15 * 60000) push({ key: `debrief:${e.id}`, kind: 'debrief', label: 'Just finished', open: `${e.title} wrapped up ${Math.round(m)} minutes ago.`, start: 'q1', steps: {
    q1: { text: 'How did it go?', chips: [{ l: 'Went well', v: 'good' }, { l: 'Okay', v: 'ok' }, { l: 'Rough', v: 'bad' }], run: async (v) => ({ next: 'q2', say: v === 'bad' ? 'Sorry — that sounds draining.' : v === 'good' ? 'Nice.' : '' }) },
    q2: { text: 'Anything to follow up on?', input: { placeholder: 'e.g. send the summary to Sam' }, skip: 'Nothing', run: async (v) => { if (v) await task(`Follow up: ${v} (${e.title})`, tomorrow9(now)); return { done: v ? 'Added to tomorrow morning.' : 'Good — nothing hanging.' }; } } } }); }

  // 3. morning check-in
  if (f.hour >= 5 && f.hour < 12 && !f.inEvent) push({ key: `am:${day}`, kind: 'am', label: 'Morning check-in', open: `Good morning${f.name ? `, ${f.name}` : ''}. ${eventsLine(f)}`, start: f.st.sleepHours == null ? 'sleep' : f.st.energy == null ? 'energy' : 'win', steps: {
    sleep: { text: 'How did you sleep?', chips: [{ l: 'Under 5 h', v: 4.5 }, { l: '5–6 h', v: 5.5 }, { l: '7–8 h', v: 7.5 }, { l: '9 h +', v: 9 }], run: async (v) => { await logv('sleep', v, 'h'); return { next: f.st.energy == null ? 'energy' : 'win' }; } },
    energy: { text: 'And your energy right now?', chips: [{ l: 'Low', v: 3 }, { l: 'Medium', v: 5 }, { l: 'Good', v: 7 }, { l: 'Great', v: 9 }], run: async (v) => { await logv('energy', v); return { next: 'win', say: v <= 3 ? 'Okay — let’s keep today gentle.' : '' }; } },
    win: { text: 'What’s the one thing that would make today a win?', input: { placeholder: 'e.g. finish the proposal' }, skip: 'Skip', run: async (v) => { if (v) await task(v, at(now, 18)); return { next: 'plan', say: v ? 'Added as today’s top task.' : '' }; } },
    plan: { text: 'Want me to plan the day around that?', chips: [{ l: 'Plan my day', v: 'plan' }, { l: 'Start 25 min focus', v: 'focus' }, { l: 'I’m good', v: 'no' }], run: async (v) => (v === 'plan' ? { done: 'Planning…', open: 'plan' } : v === 'focus' ? { done: 'Focus on — go.', open: 'focus' } : { done: 'Have a great day.' }) } } });

  // 4. evening review
  if (f.hour >= 19 && f.hour < 24) push({ key: `pm:${day}`, kind: 'pm', label: 'Evening review', open: `Day’s nearly done${f.name ? `, ${f.name}` : ''}. Two minutes to close it out?`, start: 'mood', steps: {
    mood: { text: 'How was today overall?', chips: [{ l: 'Great', v: 9 }, { l: 'Good', v: 7 }, { l: 'Okay', v: 5 }, { l: 'Rough', v: 3 }], run: async (v) => { await logv('mood', v); return { next: 'well', say: v <= 3 ? 'Thanks for being honest — tomorrow is a fresh start.' : '' }; } },
    well: { text: 'What went well, even a little?', input: { placeholder: 'e.g. finally finished the report' }, skip: 'Skip', run: async (v) => { if (v) await note(`Went well: ${v}`); return { next: 'carry' }; } },
    carry: { text: 'Anything to carry over to tomorrow?', input: { placeholder: 'e.g. call the bank' }, skip: 'Nothing', run: async (v) => { if (v) await task(v, tomorrow9(now)); return { done: v ? 'Saved for tomorrow morning. Sleep well.' : 'All clear. Wind down and rest well.' }; } } } });

  // 5. mid-day pulse (energy)
  if (f.hour >= 11 && f.hour < 18 && !f.inEvent && Date.now() - f.lastLog('energy') > 150 * 60000) { const slot = Math.floor(f.hour / 3); push({ key: `pulse:${day}:${slot}`, kind: 'pulse', label: 'Quick pulse', open: f.working ? 'You’re in the middle of your work day.' : 'Halfway through the day.', start: 'energy', steps: {
    energy: { text: 'How’s your energy right now?', chips: [{ l: 'Low', v: 3 }, { l: 'Medium', v: 5 }, { l: 'Good', v: 7 }, { l: 'Great', v: 9 }], run: async (v) => { await logv('energy', v); return { next: v <= 4 ? 'low' : v >= 8 ? 'high' : 'mid' }; } },
    low: { text: 'That’s on the low side. What would help right now?', chips: [{ l: 'Drink water', v: 'water' }, { l: '10-min walk', v: 'walk' }, { l: 'Lighter day', v: 'light' }, { l: 'Nothing', v: 'no' }], run: async (v) => { if (v === 'water') { await logv('water', 250, 'ml'); return { done: 'Logged 250 ml. Small things add up.' }; } if (v === 'walk') { F.start({ label: 'Walk', minutes: 10, quiet: true, track: false }); return { done: 'Ten minutes — go move.' }; } if (v === 'light') { await store.setSettings({ minimalDay: dayKey() }); return { done: 'Switched to an essentials-only day.' }; } return { done: 'Okay.' }; } },
    mid: { text: 'Want to use it for something?', chips: [{ l: 'Start 25 min focus', v: 'focus' }, { l: 'Not now', v: 'no' }], run: async (v) => (v === 'focus' ? { done: 'Focus on.', open: 'focus' } : { done: 'Okay.' }) },
    high: { text: 'Good energy — a good time for your hardest task.', chips: [{ l: 'Start 45 min focus', v: 'focus' }, { l: 'Plan my day', v: 'plan' }, { l: 'Not now', v: 'no' }], run: async (v) => (v === 'focus' ? { done: 'Focus on.', open: 'focus45' } : v === 'plan' ? { done: 'Planning…', open: 'plan' } : { done: 'Okay.' }) } } }); }

  // 6. a goal you haven't logged today
  if (f.hour >= 8 && f.hour < 22 && !f.inEvent) for (const { t, f: fld } of f.goals.slice(0, 2)) { const last = T.entriesOf(t.id)[0]; push({ key: `goal:${t.id}:${day}`, kind: 'goal', label: t.name, open: `You haven’t logged ${fld.label.toLowerCase()} today${last ? ` (last: ${T.formatValue(fld, last.values?.[fld.id])})` : ''}.`, start: 'q1', steps: {
    q1: { text: `What is it now?${fld.unit ? ` (${fld.unit})` : ''}`, input: { type: 'number', placeholder: fld.unit || 'value' }, skip: 'Later', run: async (v) => { const n = Number(v); if (!Number.isFinite(n)) return { done: 'Okay — later then.' }; await execute({ type: 'create_entry', payload: { trackerId: t.id, values: { [fld.id]: n } } }, { origin: 'user' }); const p = T.progress(t, fld); return { done: p?.met ? 'Logged — you’ve reached your goal! 🎉' : `Logged. ${T.formatValue(fld, p?.goal?.remaining ?? 0)} to go.` }; } } } }); }

  // 7. tasks due today, in the afternoon
  if (f.hour >= 13 && f.hour < 20 && !f.inEvent && f.tasks.filter((t) => t.due && dayKey(t.due) <= day).length) { const due = f.tasks.filter((t) => t.due && dayKey(t.due) <= day).slice(0, 3); push({ key: `tasks:${day}`, kind: 'tasks', label: 'Today’s tasks', open: `${due.length === 1 ? 'You have a task' : `You have ${f.tasks.filter((t) => t.due && dayKey(t.due) <= day).length} tasks`} due today.`, start: 'q1', steps: {
    q1: { text: 'Which one should we start with?', chips: due.map((t) => ({ l: t.title.length > 34 ? `${t.title.slice(0, 33)}…` : t.title, v: t.id })), run: async (v) => { const t = store.get('tasks', v); F.start({ label: t?.title || 'Task', minutes: 25, quiet: true, track: true, taskId: v }); return { done: 'Focus is on — 25 minutes.', open: 'focus-open' }; } } } }); }

  // 8. never dead: a gentle, useful default
  out.push({ key: `idle:${Math.floor(+now / 1800000)}`, kind: 'idle', label: 'What’s up?', open: f.part === 'morning' ? 'What’s the plan for today?' : f.part === 'evening' || f.part === 'night' ? 'How’s your evening shaping up?' : 'What are you working on right now?', start: 'q1', idle: true, steps: {
    q1: { text: '', chips: [{ l: 'Start focus', v: 'focus' }, { l: 'Plan my day', v: 'plan' }, { l: 'Log something', v: 'log' }, { l: 'Talk to me', v: 'chat' }], input: { placeholder: 'Type what you’re doing — I’ll start a focus session' }, run: async (v) => (v === 'focus' ? { done: '', open: 'focus' } : v === 'plan' ? { done: '', open: 'plan' } : v === 'log' ? { done: '', open: 'log' } : v === 'chat' ? { done: '', open: 'chat' } : v ? (F.start({ label: v, minutes: 25, quiet: true, track: true }), { done: `Focus on: ${v}.`, open: 'focus-open' }) : { done: '' }) } } });
  return out;
}
export const current = (now = new Date()) => candidates(now)[0] || null;
/** Short text for a check-in notification at the given time (kind: 'am' | 'pm'). */
export function checkinText(kind, date = new Date()) {
  const evs = store.all('events').filter((e) => e.status !== 'skipped' && e.type !== 'reminder' && !e.allDay && dayKey(e.start) === dayKey(date)).sort((a, b) => a.start.localeCompare(b.start));
  if (kind === 'am') return evs.length ? `${evs.length} thing${evs.length === 1 ? '' : 's'} today — first: ${evs[0].title} at ${fmtTime(evs[0].start)}. Quick check-in?` : 'Good morning — quick check-in? Takes a minute.';
  return 'Day’s nearly done — two minutes to close it out?';
}
export const _internals = { facts, PREP };
