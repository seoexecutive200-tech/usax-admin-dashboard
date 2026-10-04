import { store } from '../store.js';
import * as A from '../analytics.js';
import { h, icon, pct, EVENT_ICON, EVENT_COLOR, levelColor, toast, confirmSheet } from '../ui.js';
import { fmtDate, fmtTime, fmtDur, dayKey, parseKey, addDays, startOfWeek, startOfDay, round } from '../util.js';
import { navigate } from '../router.js';
import { eventFormSheet, eventDetailSheet, taskFormSheet, commit, searchSheet, notificationsSheet } from '../sheets.js';
import { exportAllICS } from '../calendar.js';
import { routineStrip, routineActions } from '../routine-ui.js';

let sel = dayKey();

function loadAdvice(fl) {
  const peak = [...fl].sort((a, b) => b.value - a.value)[0];
  if (peak && (peak.level === 'heavy' || peak.level === 'peak')) return `Avoid adding another demanding commitment on ${fmtDate(peak.date, { weekday: 'long' })} if possible.`;
  if (fl.every((d) => d.count === 0)) return 'Your week is open. Add events and I’ll watch the load for you.';
  return 'The next seven days look manageable. Keep some space for recovery.';
}

export default {
  id: 'plan',
  render() {
    const now = new Date(); const fl = A.futureLoad(7); const ws = startOfWeek(parseKey(sel));
    const week = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
    const dayEvents = A.eventsOnDay(sel);
    const suggested = store.all('events').filter((e) => e.aiState === 'suggested' && dayKey(e.start) === sel);
    const timeline = [...dayEvents, ...suggested].sort((a, b) => a.start.localeCompare(b.start));
    const tasks = store.all('tasks').filter((t) => t.status !== 'done').sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
    const doneTasks = store.all('tasks').filter((t) => t.status === 'done').slice(-3);
    const ne = A.nextImportantEvent(now); const r = ne ? A.readiness(ne, now) : null;
    const isToday = sel === dayKey();
    const maxV = Math.max(0.5, ...fl.map((d) => d.value));
    return h`<div class="screen plan">
      <header class="top"><div class="logo">Life<b>OS</b></div><div class="row gap"><button class="icon-btn" data-act="search" aria-label="Search">${icon('search', 22)}</button><button class="icon-btn" data-act="bell" aria-label="Reminders">${icon('bell', 22)}</button></div></header>
      <div class="hero"><h1>Plan</h1><p class="muted">${fmtDate(now)}</p></div>
      <div class="week" role="tablist" aria-label="Week">
        <button class="icon-btn" data-act="wk" data-d="-7" aria-label="Previous week">${icon('chevronL', 18)}</button>
        <div class="week-days">${week.map((d) => { const k = dayKey(d); const l = A.loadLevel(A.loadForDay(k)); const has = A.eventsOnDay(k).length; return h`<button class="day ${k === sel ? 'sel' : ''} ${k === dayKey() ? 'today' : ''}" role="tab" aria-selected="${k === sel}" data-act="day" data-k="${k}"><small>${fmtDate(d, { weekday: 'short' })}</small><b>${d.getDate()}</b><i class="dot" style="background:${has ? levelColor(l) : 'var(--line)'}"></i></button>`; })}</div>
        <button class="icon-btn" data-act="wk" data-d="7" aria-label="Next week">${icon('chevron', 18)}</button></div>
      ${routineStrip(sel)}
      <section class="card load"><div class="load-bars" aria-label="Future load, next 7 days">${fl.map((d) => h`<button class="lb" data-act="day" data-k="${d.key}" aria-label="${fmtDate(d.date, { weekday: 'long' })}: ${d.level} load"><i style="height:${Math.max(8, (d.value / maxV) * 100)}%;background:${levelColor(d.level)}"></i><small>${fmtDate(d.date, { weekday: 'short' })}</small></button>`)}</div>
        <div class="load-adv"><div class="row gap center"><span class="orb sm"></span><b>Future Load</b></div><p class="small">${loadAdvice(fl)}</p></div></section>
      <section><div class="sec-h"><h2>${isToday ? 'Today' : fmtDate(parseKey(sel), { weekday: 'long', day: 'numeric', month: 'short' })}</h2><button class="btn btn-sm btn-outline" data-act="add">${icon('plus', 16)} Add event</button></div>
        ${timeline.length ? h`<ul class="timeline tall">${timeline.map((e) => { const pend = e.aiState === 'suggested'; return h`<li class="${e.status === 'completed' ? 'done' : ''} ${e.status === 'skipped' ? 'skipped' : ''}"><span class="t-time">${fmtTime(e.start)}</span><button class="t-card ${EVENT_COLOR[e.type]} ${pend ? 'suggested' : ''}" data-act="event" data-id="${e.id}"><span class="t-ic lead">${icon(EVENT_ICON[e.type] || 'target', 20)}</span><span class="t-main"><b>${e.title}</b><small>${[e.type.replace('_', ' '), e.end !== e.start ? fmtDur((new Date(e.end) - new Date(e.start)) / 60000) : ''].filter(Boolean).join(' · ')}${e.status !== 'scheduled' ? ` · ${e.status}` : ''}</small></span>${e.origin === 'ai' ? h`<span class="pill pill-ai">${icon('sparkle', 13)} AI suggested</span>` : ''}${icon('chevron', 16, 'muted')}</button></li>`; })}</ul>`
        : h`<div class="empty"><p>${isToday ? 'Nothing planned today.' : 'Nothing planned for this day.'}</p><button class="btn btn-sm" data-act="add">${icon('plus', 16)} Add event</button></div>`}
      </section>
      <section><div class="sec-h"><h2>Tasks</h2><button class="btn btn-sm btn-outline" data-act="addtask">${icon('plus', 16)} Add task</button></div>
        ${tasks.length || doneTasks.length ? h`<ul class="tasks">${[...tasks, ...doneTasks].map((t) => h`<li class="task ${t.status === 'done' ? 'done' : ''}"><button class="check-btn ${t.status === 'done' ? 'on' : ''}" data-act="tdone" data-id="${t.id}" aria-label="${t.status === 'done' ? 'Mark not done' : 'Mark done'}">${t.status === 'done' ? icon('check', 16) : ''}</button><span class="grow"><b>${t.title}</b>${t.due ? h`<small class="muted">Due ${fmtDate(t.due, { weekday: 'short', day: 'numeric', month: 'short' })} ${fmtTime(t.due)}</small>` : ''}${t.origin === 'ai' ? h` <span class="pill pill-ai">AI suggested</span>` : ''}</span>
          <button class="icon-btn" data-act="tresched" data-id="${t.id}" aria-label="Move to tomorrow" title="Move to tomorrow">${icon('repeat', 18)}</button><button class="icon-btn" data-act="tedit" data-id="${t.id}" aria-label="Edit task">${icon('edit', 18)}</button><button class="icon-btn" data-act="tdel" data-id="${t.id}" aria-label="Delete task">${icon('trash', 18)}</button></li>`)}</ul>` : h`<div class="empty"><p>No tasks yet.</p></div>`}
      </section>
      ${ne ? h`<button class="card coming" data-act="ready" data-id="${ne.id}"><span class="date-tile"><small>${fmtDate(ne.start, { weekday: 'short' }).toUpperCase()}</small><b>${new Date(ne.start).getDate()}</b></span><span class="grow"><small class="muted">Upcoming</small><b>${ne.title}</b><small class="muted">${fmtTime(ne.start)} · ${fmtDur((new Date(ne.end) - new Date(ne.start)) / 60000)}</small></span><span class="rd"><small>Readiness</small><b>${pct(r.overall)}</b></span>${ring2(r.overall)}${icon('chevron', 16, 'muted')}</button>` : ''}
      <div class="row center"><button class="link" data-act="ics">${icon('download', 14)} Export schedule (.ics)</button></div></div>`;
  },
  actions: {
    ...routineActions,
    search: () => searchSheet(), bell: () => notificationsSheet(),
    day: (el) => { sel = el.dataset.k; navigate('#/plan'); },
    wk: (el) => { sel = dayKey(addDays(parseKey(sel), Number(el.dataset.d))); navigate('#/plan'); },
    add: () => eventFormSheet({ defaults: { start: (() => { if (sel !== dayKey()) { const d = parseKey(sel); d.setHours(9, 0); return d; } return new Date(Math.ceil((Date.now() + 5 * 60000) / 1800000) * 1800000); })() } }),
    event: (el) => eventDetailSheet(el.dataset.id), ready: (el) => navigate(`#/readiness/${el.dataset.id}`),
    addtask: () => taskFormSheet({}),
    tdone: async (el) => { const t = store.get('tasks', el.dataset.id); const prev = t.status; await store.save('tasks', { id: t.id, status: prev === 'done' ? 'open' : 'done' }); if (prev !== 'done') toast('Task done', { undo: () => store.save('tasks', { id: t.id, status: 'open' }) }); },
    tedit: (el) => taskFormSheet({ task: store.get('tasks', el.dataset.id) }),
    tresched: (el) => { const d = addDays(startOfDay(), 1); d.setHours(9); commit({ type: 'reschedule_task', payload: { id: el.dataset.id, due: d.toISOString() } }, { notify: false }); },
    tdel: async (el) => { const t = store.get('tasks', el.dataset.id); if (await confirmSheet({ title: 'Delete task?', message: `“${t.title}” will be removed.`, confirm: 'Delete', danger: true })) { await store.remove('tasks', t.id); toast('Task deleted', { undo: () => store.restore('tasks', t) }); } },
    ics: () => { const evs = A.activeEvents().filter((e) => new Date(e.start) > addDays(new Date(), -1)); if (!evs.length) return toast('No upcoming events to export'); exportAllICS(evs); },
  },
};
import { ring } from '../ui.js';
function ring2(v) { return ring({ pct: v, size: 44, stroke: 5, color: v >= 0.7 ? 'var(--green)' : 'var(--blue)' }); }
