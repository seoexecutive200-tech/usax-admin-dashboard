// Calendar: one month view of everything scheduled — events, tasks, routines, tracker reminders, focus sessions and goal dates.
// Tap a day to see its agenda; tap any item to turn it into a task, a tracker, a reminder, a focus session or an event.
import { store } from '../store.js';
import * as A from '../analytics.js';
import * as R from '../routines.js';
import * as T from '../trackers.js';
import * as F from '../focus.js';
import { h, icon, toast, logo, openSheet } from '../ui.js';
import { fmtDate, fmtTime, dayKey, parseKey, addDays, startOfWeek, startOfDay, lsGet, lsSet, safeJSON } from '../util.js';
import { navigate, rerender } from '../router.js';
import { eventFormSheet, eventDetailSheet, taskFormSheet, searchSheet, notificationsSheet } from '../sheets.js';
import { builderSheet } from '../tracker-ui.js';
import { focusStartSheet } from '../focus-ui.js';
import { formSheet } from '../routine-ui.js';
import * as GC from '../gcal.js';
import { connectSheet } from '../gcal-ui.js';

export const KINDS = {
  event: { label: 'Events', color: 'var(--blue)', icon: 'calendar' }, task: { label: 'Tasks', color: 'var(--amber)', icon: 'check' },
  routine: { label: 'Routines', color: 'var(--green)', icon: 'clock' }, reminder: { label: 'Reminders', color: 'var(--violet)', icon: 'bell' },
  focus: { label: 'Focus', color: '#2dd4bf', icon: 'target' }, goal: { label: 'Goals', color: 'var(--pink)', icon: 'flag' },
};
GC.onGcal(() => { if (document.body.dataset.screen === 'calendar') rerender(); });
let month = startOfDay(new Date()); month.setDate(1);
let sel = dayKey();
const hidden = () => new Set(safeJSON(lsGet('lifeos.calHidden'), []));
const setHidden = (s) => lsSet('lifeos.calHidden', JSON.stringify([...s]));

/** Everything that happens on a day, from every part of the app. */
export function itemsOn(key) {
  const d = parseKey(key); const out = []; const at12 = (ms) => (Number.isFinite(ms) ? ms : +d + 9 * 3600000);
  for (const e of A.eventsOnDay(key)) out.push({ kind: 'event', id: e.id, title: e.title, ts: +new Date(e.start), end: +new Date(e.end || e.start), sub: [e.origin === 'google' ? 'Google Calendar' : '', e.location, e.origin === 'google' ? '' : e.type].filter(Boolean).join(' · '), done: e.status === 'completed', allDay: !!e.allDay });
  for (const t of store.all('tasks')) if (t.due && dayKey(t.due) === key) { const dd = new Date(t.due); out.push({ kind: 'task', id: t.id, title: t.title, ts: +dd, timed: !!(dd.getHours() || dd.getMinutes()), done: t.status === 'done' }); }
  for (const r of R.activeRoutines()) if (R.scheduledOn(r, d)) { const w = R.windowOf(r, d); out.push({ kind: 'routine', id: r.id, title: r.name, ts: +w.start, end: +w.end, sub: { working: 'Logged in', off: 'Day off', done: 'Done' }[R.statusFor(r, key)] || '' }); }
  for (const t of T.allTrackers()) for (const rem of t.reminders || []) if ((rem.days || []).includes(d.getDay()) && /^\d{1,2}:\d{2}$/.test(rem.time || '')) { const at = new Date(d); const [hh, mm] = rem.time.split(':').map(Number); at.setHours(hh, mm, 0, 0); out.push({ kind: 'reminder', id: t.id, title: t.private ? 'Reminder' : `${t.name}${rem.text ? `: ${rem.text}` : ''}`, ts: +at }); }
  for (const s of F.sessions()) if (dayKey(s.start) === key) out.push({ kind: 'focus', id: s.id, title: s.label || 'Focus session', ts: +new Date(s.start), end: +new Date(s.end), sub: F.minutesLabel(s.minutes) });
  for (const t of T.allTrackers()) for (const f of t.fields) if (f.target?.period === 'goal' && f.target.by === key) out.push({ kind: 'goal', id: t.id, title: `Goal date · ${t.name}`, ts: at12(NaN), sub: `${f.target.dir === 'atmost' ? 'down' : 'up'} to ${T.formatValue(f, f.target.value)}`, allDay: true });
  return out.sort((a, b) => a.ts - b.ts);
}
const undated = () => store.all('tasks').filter((t) => !t.due && t.status !== 'done');
const timeText = (it) => (it.allDay || (it.kind === 'task' && !it.timed) ? 'All day' : fmtTime(new Date(it.ts)));

export function itemSheet(it) {
  const K = KINDS[it.kind]; const when = it.ts ? new Date(it.ts) : null; const dated = when && !it.allDay && !(it.kind === 'task' && !it.timed);
  const open = () => { if (it.kind === 'event') eventDetailSheet(it.id); else if (it.kind === 'task') taskFormSheet({ task: store.get('tasks', it.id) }); else if (it.kind === 'routine') formSheet(store.get('activities', it.id)); else if (it.kind === 'reminder' || it.kind === 'goal') navigate(`#/tracker/${it.id}`); };
  const A_ = [];
  if (it.kind !== 'focus') A_.push(['open', 'edit', 'Open', 'See or edit it', open]);
  A_.push(['task', 'check', it.kind === 'task' ? 'Create a follow-up task' : 'Create a task from this', 'Pre-filled — edit before saving', () => taskFormSheet({ defaults: { title: it.kind === 'task' ? `Follow up: ${it.title}` : it.title, due: when && it.kind !== 'task' ? when : undefined } })]);
  A_.push(['track', 'chart', 'Track this', 'Describe it and LifeOS builds a tracker', () => builderSheet({ text: `Track ${it.title}` })]);
  A_.push(['focus', 'target', 'Focus on this', 'Start a timed focus session', () => focusStartSheet({ label: it.title, taskId: it.kind === 'task' ? it.id : null })]);
  if (dated && it.kind !== 'focus') A_.push(['remind', 'bell', 'Remind me before', '30 minutes earlier', () => eventFormSheet({ defaults: { title: `Reminder: ${it.title}`, type: 'reminder', start: new Date(it.ts - 30 * 60000), durationMin: 5 } })]);
  if (it.kind === 'task' || it.kind === 'reminder' || it.kind === 'goal') A_.push(['event', 'calendar', 'Add to my schedule', 'Create a calendar event', () => eventFormSheet({ defaults: { title: it.title, start: dated ? when : (() => { const d = new Date(it.ts || Date.now()); d.setHours(9, 0, 0, 0); return d; })(), durationMin: 30 } })]);
  if (it.kind === 'event') A_.push(['prep', 'flag', 'Prepare for it', 'Checklist and readiness', () => navigate(`#/readiness/${it.id}`)]);
  if (it.kind === 'task') A_.push(['done', 'check', it.done ? 'Reopen task' : 'Mark done', '', async () => { await store.save('tasks', { id: it.id, status: it.done ? 'open' : 'done' }); toast(it.done ? 'Task reopened' : 'Task done'); }]);
  openSheet({ title: it.title, body: h`<div class="stack"><div class="row gap center"><span class="t-ic lead" style="color:${K.color}">${icon(K.icon, 20)}</span><div><b>${K.label.replace(/s$/, '')}</b><div class="small muted">${when ? `${fmtDate(when, { weekday: 'short', day: 'numeric', month: 'short' })} · ${timeText(it)}` : 'No date'}${it.sub ? ` · ${it.sub}` : ''}</div></div></div>
    <div class="eyebrow">Do something with this</div>${A_.map(([k, ic, t, d]) => h`<button class="list-btn" data-k="${k}"><span class="t-ic lead">${icon(ic, 20)}</span><span><b>${t}</b>${d ? h`<small>${d}</small>` : ''}</span></button>`)}</div>`,
  onOpen(s) { s.el.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => { const f = A_.find((x) => x[0] === b.dataset.k)[4]; s.close(); setTimeout(f, 250); })); } });
}
function daySheet(key) {
  const d = parseKey(key); const nine = new Date(d); nine.setHours(9, 0, 0, 0); const isToday = key === dayKey();
  const opts = [['event', 'calendar', 'New event', () => eventFormSheet({ defaults: { start: isToday ? undefined : nine } })], ['task', 'check', 'New task', () => taskFormSheet({ defaults: { due: nine } })], ['trk', 'chart', 'New tracker', () => builderSheet()], ...(isToday ? [['focus', 'target', 'Start focus', () => focusStartSheet()]] : [])];
  openSheet({ title: fmtDate(d, { weekday: 'long', day: 'numeric', month: 'short' }), body: h`<div class="stack">${opts.map(([k, ic, t]) => h`<button class="list-btn" data-k="${k}"><span class="t-ic lead">${icon(ic, 20)}</span><span><b>${t}</b></span></button>`)}</div>`,
    onOpen(s) { s.el.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => { const f = opts.find((x) => x[0] === b.dataset.k)[3]; s.close(); setTimeout(f, 250); })); } });
}

export default {
  id: 'calendar',
  render() {
    const hid = hidden(); const first = new Date(month); const gridStart = startOfWeek(first); const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
    const rows = cells.filter((_, i) => i < 35 || cells[35].getMonth() === first.getMonth());
    const today = dayKey(); const dayItems = itemsOn(sel).filter((x) => !hid.has(x.kind)); const un = hid.has('task') ? [] : undated();
    return h`<div class="screen calendar">
      <header class="top">${logo()}<div class="row gap"><button class="icon-btn" data-act="search" aria-label="Search">${icon('search', 22)}</button><button class="icon-btn" data-act="bell" aria-label="Reminders">${icon('bell', 22)}</button></div></header>
      <div class="hero"><h1>Plan</h1><div class="seg" role="group" aria-label="View"><button class="seg-btn" data-act="to-week">Week</button><button class="seg-btn on" aria-pressed="true">Month</button></div></div>
      ${window.__account && !GC.state.feeds.length && GC.state.loaded ? h`<button class="card slim cal-connect" data-act="gcal-connect"><span class="t-ic lead">${icon('calendar', 20)}</span><span class="grow"><b>Connect Google Calendar</b><small class="muted"> See your Google events here</small></span>${icon('chevron', 16, 'muted')}</button>` : ''}
      <section class="card cal"><div class="row between center"><button class="icon-btn" data-act="cal-prev" aria-label="Previous month">${icon('chevronL', 18)}</button><b class="cal-title">${first.toLocaleDateString([], { month: 'long', year: 'numeric' })}</b><button class="icon-btn" data-act="cal-next" aria-label="Next month">${icon('chevron', 18)}</button></div>
        <div class="cal-grid cal-head">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => h`<span>${d}</span>`)}</div>
        <div class="cal-grid">${rows.map((d) => { const k = dayKey(d); const kinds = [...new Set(itemsOn(k).filter((x) => !hid.has(x.kind)).map((x) => x.kind))]; const n = itemsOn(k).filter((x) => !hid.has(x.kind)).length; return h`<button class="cal-day ${d.getMonth() !== first.getMonth() ? 'dim' : ''} ${k === sel ? 'sel' : ''} ${k === today ? 'today' : ''}" data-act="cal-day" data-k="${k}" aria-label="${fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' })}, ${n} item${n === 1 ? '' : 's'}"><b>${d.getDate()}</b><span class="dots">${kinds.slice(0, 4).map((x) => h`<i style="background:${KINDS[x].color}"></i>`)}</span></button>`; })}</div>
        <div class="chips cal-filters" role="group" aria-label="Show">${Object.entries(KINDS).map(([k, v]) => h`<button class="chip-btn pick ${hid.has(k) ? '' : 'on'}" data-act="cal-filter" data-kind="${k}" aria-pressed="${!hid.has(k)}"><i class="dot" style="background:${v.color}"></i> ${v.label}</button>`)}</div>
        <div class="row between center"><button class="link" data-act="cal-today">Today</button></div></section>
      <section><div class="sec-h"><h2>${sel === today ? 'Today' : fmtDate(parseKey(sel), { weekday: 'long', day: 'numeric', month: 'short' })}</h2><button class="btn btn-sm btn-outline" data-act="cal-add">${icon('plus', 16)} Add</button></div>
        ${dayItems.length ? h`<ul class="agenda">${dayItems.map((it, i) => h`<li><button class="ag-row ${it.done ? 'done' : ''}" data-act="cal-item" data-i="${i}"><span class="ag-time">${timeText(it)}</span><span class="ag-bar" style="background:${KINDS[it.kind].color}"></span><span class="grow"><b>${it.title}</b><small class="muted">${KINDS[it.kind].label.replace(/s$/, '')}${it.sub ? ` · ${it.sub}` : ''}</small></span>${icon('chevron', 16, 'muted')}</button></li>`)}</ul>`
          : h`<div class="empty"><p>Nothing on this day.</p><button class="btn btn-sm" data-act="cal-add">${icon('plus', 16)} Add something</button></div>`}</section>
      ${un.length ? h`<section><div class="sec-h"><h2>No date</h2></div><ul class="agenda">${un.map((t) => h`<li><button class="ag-row" data-act="cal-undated" data-id="${t.id}"><span class="ag-time">Task</span><span class="ag-bar" style="background:${KINDS.task.color}"></span><span class="grow"><b>${t.title}</b><small class="muted">Not scheduled</small></span>${icon('chevron', 16, 'muted')}</button></li>`)}</ul></section>` : ''}</div>`;
  },
  actions: {
    search: () => searchSheet(), bell: () => notificationsSheet(), 'to-week': () => navigate('#/plan'), 'gcal-connect': () => connectSheet(),
    'cal-prev': () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); rerender(); }, 'cal-next': () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); rerender(); },
    'cal-today': () => { sel = dayKey(); month = startOfDay(new Date()); month.setDate(1); rerender(); },
    'cal-day': (el) => { sel = el.dataset.k; const d = parseKey(sel); if (d.getMonth() !== month.getMonth()) month = new Date(d.getFullYear(), d.getMonth(), 1); rerender(); },
    'cal-filter': (el) => { const s = hidden(); const k = el.dataset.kind; if (s.has(k)) s.delete(k); else s.add(k); setHidden(s); rerender(); },
    'cal-add': () => daySheet(sel),
    'cal-item': (el) => { const it = itemsOn(sel).filter((x) => !hidden().has(x.kind))[Number(el.dataset.i)]; if (it) itemSheet(it); },
    'cal-undated': (el) => { const t = store.get('tasks', el.dataset.id); if (t) itemSheet({ kind: 'task', id: t.id, title: t.title, ts: 0, timed: false, done: false }); },
  },
};
