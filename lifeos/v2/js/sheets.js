// Shared sheets and the single "commit" path that applies actions with toasts, Undo and advisor hooks.
import { store } from './store.js';
import * as A from './analytics.js';
import * as adv from './advisor.js';
import { execute, requiresConfirm, describe, parsePayload, EVENT_TYPES } from './actions.js';
import { h, html, raw, esc, openSheet, confirmSheet, toast, icon, field, seg, bindSeg, segVal, slider, bindSliders, ring, pct, bar, EVENT_ICON } from './ui.js';
import { fmtTime, fmtDate, fmtDur, fmtRelative, toLocalInput, dayKey, addDays, addMinutes, round, nowISO, isNum, hoursUntil } from './util.js';
import { aiReady, hasKey, describeError, AIError } from './groq.js';
import { exportEventICS, adapters } from './calendar.js';
import { navigate } from './router.js';
import { sourceLabel } from './memory.js';

const NOTIFY_LOGS = new Set(['mood', 'energy', 'stress', 'sleep', 'focus']);
const pickErr = (e) => (e?.message || 'Something went wrong');

// ---- commit: execute an action, toast with Undo, tell the advisor only when it matters ----
export async function commit(action, { origin = 'user', notify = true } = {}) {
  try {
    const res = await execute(action, { origin });
    toast(res.summary, { undo: res.undo });
    if (res.fired?.length) setTimeout(() => toast(res.fired[0].msg, { duration: 8000 }), 900);
    const p = parsePayload(action);
    const meaningful = ['create_event', 'update_event'].includes(action.type) || (action.type === 'create_log' && NOTIFY_LOGS.has(p.logType));
    if (notify && meaningful) adv.notify(action.type);
    return res;
  } catch (e) { toast(pickErr(e), { tone: 'warn' }); return null; }
}

// ---- apply with the confirmation rule ----
export function proposeAction(action, { explicit = false, origin = 'user', reason = '' } = {}) {
  if (!requiresConfirm(action, explicit)) return commit(action, { origin });
  const d = describe(action);
  return new Promise((resolve) => {
    let done = false;
    openSheet({
      title: 'Confirm change',
      body: h`<div class="card inset"><div class="eyebrow">${d.label}</div><p class="strong">${d.detail}</p>${reason ? h`<p class="muted small">${reason}</p>` : ''}</div>
        <p class="muted small">${origin === 'ai' ? 'The advisor suggested this. Nothing changes until you confirm.' : 'Please confirm this change.'}</p>
        <div class="row gap end"><button class="btn" data-no>Not now</button><button class="btn btn-primary" data-yes>Confirm</button></div>`,
      onClose: () => { if (!done) resolve(null); },
      onOpen: (s) => {
        s.el.querySelector('[data-no]').onclick = () => s.close();
        s.el.querySelector('[data-yes]').onclick = async () => { done = true; s.close(); resolve(await commit(action, { origin })); };
      },
    });
  });
}

// ---------- event form ----------
const DURATIONS = [0, 15, 30, 45, 60, 90, 120, 180, 240];
export function eventFormSheet({ event = null, defaults = {}, onSaved = null } = {}) {
  const e = event || {};
  const start = e.start ? new Date(e.start) : defaults.start ? new Date(defaults.start) : (() => { const d = new Date(); d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0); return addMinutes(d, 30); })();
  const dur = e.start ? Math.round((new Date(e.end || e.start) - new Date(e.start)) / 60000) : (defaults.durationMin ?? 30);
  const durOpts = [...new Set([...DURATIONS, dur])].sort((a, b) => a - b);
  openSheet({
    title: event ? 'Edit event' : 'New event', tall: true,
    body: h`<form class="stack" id="ev-form" novalidate>
      ${field('Title', h`<input class="input" name="title" required maxlength="120" value="${e.title || defaults.title || ''}" placeholder="e.g. Client presentation" autofocus>`)}
      <div class="grid2">
        ${field('Type', h`<select class="input" name="type">${EVENT_TYPES.map((t) => h`<option value="${t}" ${(e.type || defaults.type || 'meeting') === t ? 'selected' : ''}>${t.replace('_', ' ')}</option>`)}</select>`)}
        ${field('Duration', h`<select class="input" name="dur">${durOpts.map((m) => h`<option value="${m}" ${m === dur ? 'selected' : ''}>${m === 0 ? 'No length' : fmtDur(m)}</option>`)}</select>`)}
      </div>
      ${field('Starts', h`<input class="input" type="datetime-local" name="start" value="${toLocalInput(start)}" required>`, `Local time (${store.profile().timezone})`)}
      <div class="field"><span class="field-label">Importance</span>${seg('importance', [['low', 'Low'], ['normal', 'Normal'], ['high', 'High']], e.importance || defaults.importance || 'normal')}</div>
      <label class="check"><input type="checkbox" name="prep" ${e.prepRequired || defaults.importance === 'high' ? 'checked' : ''}><span>Needs preparation (enables a readiness view)</span></label>
      ${field('Location or link', h`<input class="input" name="location" maxlength="200" value="${e.location || defaults.location || ''}" placeholder="Room, address or video link">`)}
      ${field('Notes', h`<textarea class="input" name="notes" rows="3" maxlength="1000" placeholder="Context the advisor can use to suggest prep">${e.notes || ''}</textarea>`)}
      <p class="form-error" id="ev-err" role="alert"></p>
      <div class="row gap end"><button type="button" class="btn" data-close2>Cancel</button><button class="btn btn-primary" type="submit">${event ? 'Save' : 'Add event'}</button></div></form>`,
    onOpen(s) {
      bindSeg(s.el); s.el.querySelector('[data-close2]').onclick = s.close;
      const form = s.el.querySelector('#ev-form');
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault(); const f = new FormData(form); const title = String(f.get('title') || '').trim();
        const startV = new Date(f.get('start'));
        const err = !title ? 'Give the event a title.' : isNaN(startV) ? 'Pick a valid start time.' : '';
        if (err) { s.el.querySelector('#ev-err').textContent = err; return; }
        const payload = { title, type: f.get('type'), start: startV.toISOString(), durationMin: Number(f.get('dur')), importance: segVal(s.el, 'importance', 'normal'), prepRequired: f.get('prep') === 'on', location: f.get('location'), notes: f.get('notes') };
        if (event) { payload.id = event.id; payload.end = addMinutes(startV, Number(f.get('dur'))).toISOString(); }
        s.close();
        const res = await commit({ type: event ? 'update_event' : 'create_event', payload });
        if (res) onSaved?.(res.record || store.get('events', event?.id));
      });
    },
  });
}

// ---------- event detail ----------
export function eventDetailSheet(id) {
  const ev = store.get('events', id); if (!ev) return;
  const pending = ev.origin === 'ai' && ev.aiState === 'suggested';
  const important = ev.importance === 'high' || ev.prepRequired;
  const sh = openSheet({
    title: ev.title, tall: true,
    body: h`<div class="stack">
      <div class="row gap wrap"><span class="pill">${ev.type.replace('_', ' ')}</span><span class="pill ${ev.importance === 'high' ? 'pill-amber' : ''}">${ev.importance} importance</span>${ev.origin === 'ai' ? h`<span class="pill pill-ai">${icon('sparkle', 13)} AI suggested</span>` : ''}${ev.status !== 'scheduled' ? h`<span class="pill pill-green">${ev.status}</span>` : ''}</div>
      <p class="strong">${fmtDate(ev.start, { weekday: 'long', day: 'numeric', month: 'long' })} · ${ev.allDay ? 'All day' : `${fmtTime(ev.start)}${ev.end && ev.end !== ev.start ? ` – ${fmtTime(ev.end)}` : ''}`}</p>
      ${ev.origin === 'google' ? h`<div class="card inset"><p class="small">${icon('calendar', 14)} From your Google Calendar. Change it there and it updates here. You can still add a checklist, prepare for it or use it in tasks and reminders.</p></div>` : ''}
      ${ev.location ? h`<p class="muted">${icon('external', 14)} ${/^https?:\/\//.test(ev.location) ? h`<a href="${ev.location}" target="_blank" rel="noopener noreferrer">${ev.location}</a>` : ev.location}</p>` : ''}
      ${ev.notes ? h`<p class="muted pre">${ev.notes}</p>` : ''}
      ${pending ? h`<div class="card inset"><p class="small">The advisor suggested this block. It is not on your schedule until you accept it.</p><div class="row gap"><button class="btn btn-primary" data-do="accept">Accept</button><button class="btn" data-do="dismiss">Dismiss</button></div></div>` : h`
      <div class="grid2">
        ${ev.status === 'completed' ? '' : h`<button class="btn btn-primary" data-do="complete">${icon('check', 18)} Complete</button>`}
        ${ev.status === 'skipped' ? '' : h`<button class="btn" data-do="skip">${icon('skip', 18)} Skip</button>`}
        ${ev.origin === 'google' ? '' : h`<button class="btn" data-do="resched">${icon('repeat', 18)} Reschedule</button>
        <button class="btn" data-do="edit">${icon('edit', 18)} Edit</button>`}
        ${important ? h`<button class="btn" data-do="ready">${icon('target', 18)} Readiness</button>` : ''}
        <button class="btn" data-do="ics">${icon('download', 18)} Add to calendar</button>
      </div>
      <div id="resched-box" class="card inset hidden"><label class="field"><span class="field-label">New start</span><input class="input" type="datetime-local" id="resched-in" value="${toLocalInput(ev.start)}"></label><div class="row gap end"><button class="btn btn-primary" data-do="resched-save">Move it</button></div></div>
      <div id="cal-box" class="card inset hidden"><div class="stack">${Object.entries(adapters).map(([k, a]) => h`<button class="btn" data-cal="${k}">${a.label}</button>`)}</div></div>`}
      ${ev.origin === 'google' ? '' : h`<button class="btn btn-danger-ghost" data-do="delete">${icon('trash', 18)} Delete</button>`}</div>`,
    onOpen(s) {
      s.el.addEventListener('click', async (e) => {
        const cal = e.target.closest('[data-cal]'); if (cal) { adapters[cal.dataset.cal].run(store.get('events', id)); return; }
        const b = e.target.closest('[data-do]'); if (!b) return; const act = b.dataset.do; const cur = store.get('events', id);
        if (act === 'complete') { s.close(); await commit({ type: 'update_event', payload: { id, status: 'completed' } }, { notify: false }); if (important && new Date(cur.end || cur.start) < addMinutes(new Date(), 5)) setTimeout(() => navigate(`#/readiness/${id}`), 250); }
        else if (act === 'skip') { s.close(); await commit({ type: 'update_event', payload: { id, status: 'skipped' } }); }
        else if (act === 'edit') { s.close(); eventFormSheet({ event: cur }); }
        else if (act === 'ready') { s.close(); navigate(`#/readiness/${id}`); }
        else if (act === 'ics') s.el.querySelector('#cal-box').classList.toggle('hidden');
        else if (act === 'resched') s.el.querySelector('#resched-box').classList.toggle('hidden');
        else if (act === 'resched-save') { const v = new Date(s.el.querySelector('#resched-in').value); if (isNaN(v)) return toast('Pick a valid time', { tone: 'warn' }); s.close(); await commit({ type: 'update_event', payload: { id, start: v.toISOString() } }); }
        else if (act === 'accept') { s.close(); await store.save('events', { id, aiState: 'accepted' }); toast('Added to your schedule', { undo: () => store.save('events', { id, aiState: 'suggested' }) }); }
        else if (act === 'dismiss') { s.close(); const prev = store.get('events', id); await store.remove('events', id); toast('Dismissed', { undo: () => store.restore('events', prev) }); }
        else if (act === 'delete') { if (await confirmSheet({ title: 'Delete this event?', message: `“${cur.title}” will be removed. You can undo right after.`, confirm: 'Delete', danger: true })) { s.close(); await commit({ type: 'delete_event', payload: { id } }); } }
      });
    },
  });
  return sh;
}

// ---------- tasks ----------
export function taskFormSheet({ task = null, defaults = {} } = {}) {
  openSheet({
    title: task ? 'Edit task' : 'New task',
    body: h`<form class="stack" id="t-form">${field('Task', h`<input class="input" name="title" maxlength="160" required value="${task?.title || defaults.title || ''}" autofocus>`)}
      ${field('Due (optional)', h`<input class="input" type="datetime-local" name="due" value="${task?.due || defaults.due ? toLocalInput(task?.due || defaults.due) : ''}">`)}
      <p class="form-error" id="t-err" role="alert"></p><div class="row gap end"><button type="button" class="btn" data-x>Cancel</button><button class="btn btn-primary" type="submit">Save</button></div></form>`,
    onOpen(s) {
      s.el.querySelector('[data-x]').onclick = s.close;
      s.el.querySelector('#t-form').addEventListener('submit', async (e) => {
        e.preventDefault(); const f = new FormData(e.target); const title = String(f.get('title')).trim();
        if (!title) { s.el.querySelector('#t-err').textContent = 'Give the task a title.'; return; }
        const due = f.get('due') ? new Date(f.get('due')).toISOString() : '';
        s.close();
        if (task) await commit({ type: 'update_task', payload: { id: task.id, title, due } }, { notify: false });
        else await commit({ type: 'create_task', payload: { title, due } }, { notify: false });
      });
    },
  });
}

// ---------- quick-log sheets ----------
const saveLogs = async (list) => {
  const results = [];
  for (const l of list) results.push(await commit({ type: 'create_log', payload: l }, { notify: false }));
  if (list.some((l) => NOTIFY_LOGS.has(l.logType))) adv.notify('checkin');
  return results;
};
export function quickLogSheet(kind) {
  const defs = {
    mood: () => openSheet({
      title: 'Check-in',
      body: h`<p class="muted small">Move only what you want to log. Untouched rows are skipped.</p><form class="stack" id="ci">${[['mood', 'Mood', 'smile'], ['energy', 'Energy', 'bolt'], ['stress', 'Stress', 'brain'], ['focus', 'Focus', 'target']].map(([k, l, ic]) => h`<div class="ci-row" data-k="${k}"><div class="row between"><span class="strong">${icon(ic, 18)} ${l}</span><output class="ci-val">–</output></div><input type="range" min="1" max="10" step="1" value="5" aria-label="${l} 1 to 10"></div>`)}
        <div class="row gap end"><button type="button" class="btn" data-x>Cancel</button><button class="btn btn-primary" type="submit">Save</button></div></form>`,
      onOpen(s) {
        s.el.querySelector('[data-x]').onclick = s.close;
        s.el.querySelectorAll('.ci-row').forEach((r) => { const i = r.querySelector('input'); const o = r.querySelector('output'); i.addEventListener('input', () => { r.dataset.set = '1'; o.textContent = `${i.value}/10`; i.style.setProperty('--p', `${((i.value - 1) / 9) * 100}%`); }); });
        s.el.querySelector('#ci').addEventListener('submit', async (e) => {
          e.preventDefault(); const list = [...s.el.querySelectorAll('.ci-row[data-set]')].map((r) => ({ logType: r.dataset.k, value: Number(r.querySelector('input').value), unit: '/10' }));
          if (!list.length) return toast('Nothing changed yet', { tone: 'warn' });
          s.close(); await saveLogs(list);
        });
      },
    }),
    water: () => openSheet({
      title: 'Water', body: h`<div class="grid3">${[250, 500, 750].map((n) => h`<button class="btn btn-big" data-ml="${n}">+${n} ml</button>`)}</div><form class="row gap" id="w"><input class="input" type="number" min="1" max="3000" inputmode="numeric" placeholder="Custom ml" name="ml" aria-label="Custom millilitres"><button class="btn btn-primary">Add</button></form>`,
      onOpen(s) {
        s.el.addEventListener('click', async (e) => { const b = e.target.closest('[data-ml]'); if (b) { s.close(); await saveLogs([{ logType: 'water', value: Number(b.dataset.ml), unit: 'ml' }]); } });
        s.el.querySelector('#w').addEventListener('submit', async (e) => { e.preventDefault(); const v = Number(new FormData(e.target).get('ml')); if (!(v > 0)) return toast('Enter an amount', { tone: 'warn' }); s.close(); await saveLogs([{ logType: 'water', value: v, unit: 'ml' }]); });
      },
    }),
    meal: () => openSheet({
      title: 'Meal', body: h`<form class="stack" id="m"><div class="field"><span class="field-label">Which meal</span>${seg('meal', [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snack']], 'lunch')}</div>${field('Note (optional)', h`<input class="input" name="note" maxlength="120" placeholder="What did you have?">`)}<div class="row gap end"><button class="btn btn-primary">Log meal</button></div></form>`,
      onOpen(s) { bindSeg(s.el); s.el.querySelector('#m').addEventListener('submit', async (e) => { e.preventDefault(); const meal = segVal(s.el, 'meal', 'lunch'); s.close(); await saveLogs([{ logType: 'meal', value: 1, unit: 'meal', detail: new FormData(e.target).get('note') || meal, meta: { meal } }]); }); },
    }),
    workout: () => openSheet({
      title: 'Movement', body: h`<form class="stack" id="wk"><div class="field"><span class="field-label">What</span>${seg('kind', [['walk', 'Walk'], ['run', 'Run'], ['strength', 'Strength'], ['yoga', 'Yoga'], ['cycling', 'Cycle'], ['other', 'Other']], 'walk')}</div>${field('Minutes', h`<input class="input" type="number" name="min" min="1" max="600" value="30" inputmode="numeric" required>`)}${field('Steps (optional)', h`<input class="input" type="number" name="steps" min="0" inputmode="numeric">`)}<div class="row gap end"><button class="btn btn-primary">Save</button></div></form>`,
      onOpen(s) { bindSeg(s.el); s.el.querySelector('#wk').addEventListener('submit', async (e) => { e.preventDefault(); const f = new FormData(e.target); const kind = segVal(s.el, 'kind', 'walk'); const min = Number(f.get('min')); if (!(min > 0)) return toast('Enter minutes', { tone: 'warn' }); s.close(); const list = [{ logType: 'workout', value: min, unit: 'min', detail: kind, meta: { kind } }]; if (Number(f.get('steps')) > 0) list.push({ logType: 'steps', value: Number(f.get('steps')), unit: 'steps' }); await saveLogs(list); }); },
    }),
    sleep: () => openSheet({
      title: 'Sleep', body: h`<form class="stack" id="sl">${field('Hours slept (last night)', h`<input class="input" type="number" name="h" min="0.5" max="16" step="0.25" value="7" inputmode="decimal" required autofocus>`)}<div class="field"><span class="field-label">Quality</span>${seg('q', [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5']], '3')}</div><div class="row gap end"><button class="btn btn-primary">Save</button></div></form>`,
      onOpen(s) { bindSeg(s.el); s.el.querySelector('#sl').addEventListener('submit', async (e) => { e.preventDefault(); const hrs = Number(new FormData(e.target).get('h')); if (!(hrs > 0 && hrs <= 16)) return toast('Enter hours between 0.5 and 16', { tone: 'warn' }); s.close(); await saveLogs([{ logType: 'sleep', value: hrs, unit: 'h', meta: { quality: Number(segVal(s.el, 'q', 3)) } }]); }); },
    }),
    expense: () => openSheet({
      title: 'Money', body: h`<form class="stack" id="ex"><div class="field">${seg('k', [['expense', 'Expense'], ['income', 'Income']], 'expense')}</div>${field('Amount', h`<input class="input" type="number" name="amt" min="0.01" step="0.01" inputmode="decimal" required autofocus>`)}${field('What for', h`<input class="input" name="label" maxlength="80" placeholder="e.g. Bike EMI">`)}<div class="field"><span class="field-label">Category</span>${seg('c', [['general', 'General'], ['food', 'Food'], ['transport', 'Travel'], ['obligation', 'Obligation']], 'general')}</div><div class="row gap end"><button class="btn btn-primary">Save</button></div></form>`,
      onOpen(s) { bindSeg(s.el); s.el.querySelector('#ex').addEventListener('submit', async (e) => { e.preventDefault(); const f = new FormData(e.target); const amt = Number(f.get('amt')); if (!(amt > 0)) return toast('Enter an amount', { tone: 'warn' }); const label = String(f.get('label') || '').trim() || 'Entry'; s.close(); await saveLogs([{ logType: segVal(s.el, 'k', 'expense'), value: amt, unit: '', detail: label, meta: { label, category: segVal(s.el, 'c', 'general') } }]); }); },
    }),
    note: () => openSheet({
      title: 'Note', body: h`<form class="stack" id="n">${field('What’s on your mind?', h`<textarea class="input" name="t" rows="4" maxlength="600" required autofocus></textarea>`)}<div class="row gap end"><button class="btn btn-primary">Save note</button></div></form>`,
      onOpen(s) { s.el.querySelector('#n').addEventListener('submit', async (e) => { e.preventDefault(); const t = String(new FormData(e.target).get('t')).trim(); if (!t) return; s.close(); await saveLogs([{ logType: 'note', value: null, detail: t }]); }); },
    }),
    event: () => eventFormSheet({}),
    task: () => taskFormSheet({}),
  };
  defs[kind]?.();
}

// ---------- advisor: Why? ----------
const KIND_LABEL = { observed: 'Observed', calculated: 'Calculated', inference: 'Inference', unknown: 'Unknown' };
export function whySheet(item) {
  const proposed = item.proposedActions || [];
  openSheet({
    title: 'Why this?', tall: true,
    body: h`<div class="stack"><p class="lead">${item.message}</p>
      ${item.evidence?.length ? h`<div class="evidence">${item.evidence.map((x) => h`<div class="ev-row"><span class="ev-kind ev-${x.kind}">${KIND_LABEL[x.kind] || x.kind}</span><span>${x.text}</span></div>`)}</div>` : ''}
      <div class="row gap wrap"><span class="pill">Confidence ${Math.round((item.confidence || 0) * 100)}%</span><span class="pill">${item.source === 'ai' ? 'AI, from your local data' : 'Local rules (no AI call)'}</span></div>
      ${item.uncertainty ? h`<p class="muted small">${icon('info', 14)} ${item.uncertainty}</p>` : ''}
      ${item.primaryAction ? h`<div class="card inset"><div class="eyebrow">Smallest useful step</div><p class="strong">${item.primaryAction}</p>${(item.secondaryOptions || []).map((o) => h`<p class="muted small">Or: ${o}</p>`)}</div>` : ''}
      ${proposed.length ? h`<div class="stack"><div class="eyebrow">Proposed changes — nothing happens until you confirm</div>${proposed.map((a, i) => { const d = describe(a); return h`<div class="card inset row between gap"><div><div class="small muted">${d.label}</div><div class="strong">${d.detail}</div>${a.reason ? h`<div class="small muted">${a.reason}</div>` : ''}</div><button class="btn btn-primary btn-sm" data-prop="${i}">Review</button></div>`; })}</div>` : ''}
      <div class="row gap wrap"><button class="btn" data-fb="helpful">${icon('check', 16)} Helpful</button><button class="btn" data-fb="not_now">Not now</button><button class="btn" data-fb="less">Show less like this</button></div></div>`,
    onOpen(s) {
      s.el.addEventListener('click', async (e) => {
        const fb = e.target.closest('[data-fb]'); if (fb) { await adv.feedback(item.id, fb.dataset.fb); toast(fb.dataset.fb === 'less' ? 'Noted — I’ll mention this less' : 'Thanks'); s.close(); return; }
        const pr = e.target.closest('[data-prop]'); if (pr) { s.close(); proposeAction(proposed[Number(pr.dataset.prop)], { origin: 'ai', reason: proposed[Number(pr.dataset.prop)].reason }); }
      });
    },
  });
}

// ---------- ask the advisor ----------
const convo = [];
export function askSheet(prefill = '') {
  const ready = aiReady();
  openSheet({
    title: 'Ask the advisor', tall: true,
    body: h`<div class="stack"><div id="chat" class="chat" aria-live="polite">${convo.length ? convo.map(bubble) : h`<p class="muted">Ask about today, an upcoming event, a “what if”, or whether you can afford something. ${ready ? 'I use only your local data, sent selectively.' : ''}</p>`}</div>
      ${ready ? '' : h`<div class="card inset"><p class="small">${hasKey() ? 'AI is switched off or you are offline.' : 'AI is not set up yet. Your tracking works fine without it.'}</p><button class="btn btn-primary btn-sm" data-setup>Set up AI</button></div>`}
      <form class="row gap" id="ask"><input class="input" name="q" maxlength="400" placeholder="e.g. What if I skip the gym today?" value="${prefill}" aria-label="Your question" ${ready ? '' : 'disabled'}><button class="btn btn-primary" ${ready ? '' : 'disabled'} aria-label="Send">${icon('send', 18)}</button></form></div>`,
    onOpen(s) {
      s.el.querySelector('[data-setup]')?.addEventListener('click', () => { s.close(); navigate('#/you'); setTimeout(() => document.getElementById('ai-api')?.scrollIntoView({ behavior: 'smooth' }), 400); });
      const chat = s.el.querySelector('#chat');
      s.el.querySelector('#ask').addEventListener('submit', async (e) => {
        e.preventDefault(); const input = e.target.q; const q = input.value.trim(); if (!q) return; input.value = '';
        convo.push({ role: 'user', text: q }); chat.innerHTML = html(convo.map(bubble)); chat.insertAdjacentHTML('beforeend', '<div class="bubble ai thinking">Thinking…</div>');
        const ctl = new AbortController();
        try {
          const r = await adv.ask(q, convo.slice(0, -1).map((c) => ({ role: c.role, text: c.text })));
          convo.push({ role: 'ai', text: r.message, data: r });
        } catch (err) { convo.push({ role: 'ai', text: describeError(err), error: true }); }
        chat.innerHTML = html(convo.map(bubble)); chat.scrollTop = chat.scrollHeight; ctl.abort();
      });
      chat.addEventListener('click', (e) => {
        const p = e.target.closest('[data-p]'); if (!p) return; const [i, j] = p.dataset.p.split(':').map(Number);
        const a = convo[i].data.proposedActions[j]; proposeAction(a, { origin: 'ai', reason: a.reason });
      });
    },
  });
}
const bubble = (m, i) => m.role === 'user' ? h`<div class="bubble me">${m.text}</div>` : h`<div class="bubble ai ${m.error ? 'err' : ''}"><p>${m.text}</p>${m.data?.evidence?.length ? h`<details><summary>Evidence & confidence ${Math.round((m.data.confidence || 0) * 100)}%</summary>${m.data.evidence.map((x) => h`<div class="ev-row"><span class="ev-kind ev-${x.kind}">${KIND_LABEL[x.kind]}</span><span>${x.text}</span></div>`)}${m.data.uncertainty ? h`<p class="muted small">${m.data.uncertainty}</p>` : ''}</details>` : ''}${m.data?.primaryAction ? h`<p class="small strong">Next step: ${m.data.primaryAction}</p>` : ''}${(m.data?.proposedActions || []).map((a, j) => h`<button class="btn btn-sm" data-p="${i}:${j}">${describe(a).label}: ${describe(a).detail}</button>`)}</div>`;

// ---------- search ----------
export function searchSheet() {
  openSheet({
    title: 'Search', tall: true,
    body: h`<input class="input" id="q" type="search" placeholder="Events, tasks, notes, memories" aria-label="Search" autofocus><div id="res" class="stack"></div>`,
    onOpen(s) {
      const res = s.el.querySelector('#res');
      s.el.querySelector('#q').addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase(); if (q.length < 2) { res.innerHTML = ''; return; }
        const hit = (t) => String(t || '').toLowerCase().includes(q);
        const evs = store.all('events').filter((x) => hit(x.title) || hit(x.notes)).slice(0, 6).map((x) => h`<button class="list-btn" data-ev="${x.id}">${icon('calendar', 18)}<span><b>${x.title}</b><small>${fmtDate(x.start, { weekday: 'short', day: 'numeric', month: 'short' })} ${fmtTime(x.start)}</small></span></button>`);
        const tks = store.all('tasks').filter((x) => hit(x.title)).slice(0, 5).map((x) => h`<button class="list-btn" data-go="#/plan">${icon('check', 18)}<span><b>${x.title}</b><small>Task · ${x.status}</small></span></button>`);
        const notes = store.all('logs').filter((x) => x.type === 'note' && hit(x.detail)).slice(0, 4).map((x) => h`<div class="list-btn static">${icon('note', 18)}<span><b>${x.detail.slice(0, 80)}</b><small>Note · ${fmtDate(x.ts, { day: 'numeric', month: 'short' })}</small></span></div>`);
        const mems = store.all('memories').filter((x) => !x.private && hit(x.text)).slice(0, 4).map((x) => h`<button class="list-btn" data-go="#/you">${icon('brain', 18)}<span><b>${x.text}</b><small>Memory · ${sourceLabel(x)}</small></span></button>`);
        const all = [...evs, ...tks, ...notes, ...mems];
        res.innerHTML = all.length ? html(all) : '<p class="muted">Nothing found.</p>';
      });
      res.addEventListener('click', (e) => { const b = e.target.closest('[data-ev]'); if (b) { s.close(); setTimeout(() => eventDetailSheet(b.dataset.ev), 200); } const g = e.target.closest('[data-go]'); if (g) { s.close(); navigate(g.dataset.go); } });
    },
  });
}

// ---------- notifications ----------
export function notificationsSheet() {
  const banners = adv.reminderBanners(); const recent = store.all('advisorItems').filter((i) => i.decision !== 'silent').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  openSheet({
    title: 'Reminders & notes',
    body: h`<div class="stack">${banners.length ? banners.map((b) => h`<div class="card inset"><p>${b.text}</p></div>`) : h`<p class="muted">Nothing needs attention. Reminders appear only when time, progress and importance suggest it.</p>`}
      ${recent.length ? h`<div class="eyebrow">Recent advisor notes</div>${recent.map((i) => h`<div class="list-btn static">${icon('sparkle', 18)}<span><b>${i.message.slice(0, 110)}${i.message.length > 110 ? '…' : ''}</b><small>${fmtRelative(i.createdAt)}${i.status === 'dismissed' ? ' · dismissed' : ''}</small></span></div>`)}` : ''}
      <div class="card inset"><p class="small">Browser notifications are optional — the schedule works without them.</p>
        ${perm === 'unsupported' ? h`<p class="muted small">Not supported in this browser.</p>` : perm === 'denied' ? h`<p class="muted small">Blocked in browser settings.</p>` : h`<button class="btn btn-sm" data-notif>${store.settings().notifications && perm === 'granted' ? 'Notifications are on' : 'Enable notifications'}</button>`}</div></div>`,
    onOpen(s) { s.el.querySelector('[data-notif]')?.addEventListener('click', async () => { const r = await Notification.requestPermission(); await store.setSettings({ notifications: r === 'granted' }); toast(r === 'granted' ? 'Notifications on' : 'Notifications not enabled'); s.close(); }); },
  });
}

// ---------- capacity breakdown ----------
export function capacitySheet() {
  const c = A.capacity(); const row = (label, v, note = '') => h`<div class="cap-row"><div class="row between"><span>${label}</span><span class="strong">${pct(v)}</span></div>${bar(v)}${note ? h`<small class="muted">${note}</small>` : ''}</div>`;
  openSheet({
    title: 'How today is calculated',
    body: h`<div class="stack"><p class="muted small">These are summaries of your own inputs against your own baselines — not medical scores.</p>
      ${row('Physical', c.physical, `Sleep ${round(c.lastSleep, 1)}h vs usual ${round(c.sleepBase, 1)}h; energy ${round(c.energy, 1)}/10${c.estimated.energy ? ' (estimated from baseline)' : ''}`)}
      ${row('Mental', c.mental, `Stress ${round(c.stress, 1)}/10${c.estimated.stress ? ' (estimated)' : ''} and schedule load ${A.loadLevel(c.load)}`)}
      ${row('Emotional', c.emotional, `Mood ${round(c.mood, 1)}/10`)}
      ${row('Free time', c.time)}${row('Usable capacity', c.usableTime, 'Free time only counts as usable if you also have the energy for it.')}
      <p class="small">Overall: <b>${c.label}</b> (${pct(c.overall)}). The more you log, the more this reflects you.</p></div>`,
  });
}

// ---------- return after a gap ----------
export function gapSheet(days) {
  openSheet({
    title: 'Welcome back', tall: true,
    body: h`<p class="muted">It has been ${days} days — no backlog to fill in. Three quick things help me recalibrate.</p>
      <form class="stack" id="gap"><div class="ci-row" data-k="energy"><div class="row between"><span class="strong">How do you feel right now?</span><output class="ci-val">–</output></div><input type="range" min="1" max="10" step="1" value="5" aria-label="Energy 1 to 10"></div>
      ${field('What changed while you were away?', h`<textarea class="input" name="changed" rows="2" maxlength="300" placeholder="Optional"></textarea>`)}
      ${field('What matters most this week?', h`<textarea class="input" name="matters" rows="2" maxlength="300" placeholder="Optional"></textarea>`)}
      <label class="check"><input type="checkbox" name="fresh"><span>My routine has changed — start a fresh baseline from today</span></label>
      <div class="row gap end"><button type="button" class="btn" data-skip>Skip</button><button class="btn btn-primary">Recalibrate</button></div></form>`,
    onOpen(s) {
      const r = s.el.querySelector('.ci-row'); const i = r.querySelector('input'); i.addEventListener('input', () => { r.dataset.set = '1'; r.querySelector('output').textContent = `${i.value}/10`; i.style.setProperty('--p', `${((i.value - 1) / 9) * 100}%`); });
      s.el.querySelector('[data-skip]').onclick = async () => { await store.setSettings({ gapAck: dayKey() }); s.close(); };
      s.el.querySelector('#gap').addEventListener('submit', async (e) => {
        e.preventDefault(); const f = new FormData(e.target); const { addMemory } = await import('./memory.js');
        if (r.dataset.set) await execute({ type: 'create_log', payload: { logType: 'energy', value: Number(i.value), unit: '/10' } });
        if (String(f.get('changed')).trim()) await addMemory({ text: `Recently changed: ${String(f.get('changed')).trim()}`, kind: 'temporary_context', source: 'user_explicit', expiresInDays: 14 });
        if (String(f.get('matters')).trim()) await addMemory({ text: `This week matters most: ${String(f.get('matters')).trim()}`, kind: 'temporary_context', source: 'user_explicit', expiresInDays: 7 });
        await store.setSettings({ gapAck: dayKey(), ...(f.get('fresh') ? { baselineStart: dayKey() } : {}) });
        s.close(); toast('Recalibrated. Nothing to catch up on.'); adv.notify('gap');
      });
    },
  });
}
