import { store } from '../store.js';
import * as A from '../analytics.js';
import * as adv from '../advisor.js';
import { h, icon, ring, bar, pct, toast, slider, openSheet, confirmSheet, field } from '../ui.js';
import { fmtDate, fmtTime, fmtDur, fmtRelative, hoursUntil, uid, round, nowISO, addMinutes } from '../util.js';
import { aiReady, askJSON, describeError } from '../groq.js';
import { EVENT_READINESS, CORE_SYSTEM } from '../prompts.js';
import { buildContext } from '../ai-context.js';
import { back, navigate } from '../router.js';
import { commit, eventDetailSheet } from '../sheets.js';

const TEMPLATES = {
  meeting: ['Clarify the goal of the meeting', 'List key points to cover', 'Gather needed documents', 'Confirm attendees and time'],
  appointment: ['Gather documents or questions', 'Plan travel time', 'Note anything to ask'],
  deadline: ['Define what “done” means', 'Do the riskiest part first', 'Leave a final review slot'],
  video_call: ['Test audio, video and link', 'Review agenda and notes', 'Close distracting tabs'],
  default: ['Write down the goal', 'Gather what you need', 'Do a short run-through'],
};
const label = { preparation: 'Preparation', energy: 'Energy Outlook', space: 'Schedule Space', mental: 'Mental Load' };

function recommendation(ev, r) {
  if (r.overall >= 0.8 && r.parts.preparation >= 0.8) return 'You look well prepared. No extra work needed — protect your sleep and keep the day before light.';
  const open = (ev.checklist || []).find((c) => !c.done);
  switch (r.weakest) {
    case 'preparation': return `Preparation is the main gap. Smallest useful step: ${open ? `“${open.text}”` : 'a focused 30–45 minute prep block'}.`;
    case 'energy': return 'Your energy outlook is the softest part. Keep prep light and protect tonight’s sleep rather than adding more work.';
    case 'space': return 'Schedule space is tight. Moving one flexible item away from that day would help more than extra prep.';
    default: return 'Mental load is the main pressure. A short walk or ten-minute break before prepping may help more than pushing through.';
  }
}
const prepState = (ev) => { const l = ev.checklist || []; if (l.length) return l.every((c) => c.done) ? 'ready' : l.some((c) => c.done) ? 'in_progress' : 'none'; return ev.prepStatus || 'none'; };
async function setChecklist(ev, list) { await store.save('events', { id: ev.id, checklist: list, prepStatus: prepState({ checklist: list, prepStatus: ev.prepStatus }), prepRequired: true }); }

export default {
  id: 'readiness',
  render({ id }) {
    const ev = store.get('events', id);
    if (!ev) return h`<div class="screen"><header class="top"><button class="icon-btn" data-act="back" aria-label="Back">${icon('chevronL', 22)}</button><h1 class="grow center-t">Readiness</h1><span style="width:44px"></span></header><div class="empty"><p>This event no longer exists.</p></div></div>`;
    const now = new Date(); const r = A.readiness(ev, now); const win = A.bestPrepWindow(ev, now);
    const over = new Date(ev.end || ev.start) < now; const ai = ev.aiReadiness;
    const col = r.overall >= 0.75 ? 'var(--green)' : r.overall >= 0.55 ? 'var(--blue)' : 'var(--amber)';
    const parts = [['preparation', r.parts.preparation, `${Math.round(r.parts.preparation * 100)}% of prep done`], ['energy', r.parts.energy, `Expected energy ~${round(r.parts.energy * 10, 1)}/10 at that time`], ['space', r.parts.space, 'Room around the event, before and on the day'], ['mental', r.parts.mental, `Recent stress ~${round(r.stress3, 1)}/10 plus that day’s load`]];
    return h`<div class="screen readiness">
      <header class="top"><button class="icon-btn" data-act="back" aria-label="Back">${icon('chevronL', 22)}</button><h1 class="grow center-t">Event readiness</h1><button class="icon-btn" data-act="open" aria-label="Event details">${icon('more', 22)}</button></header>
      <div class="hero"><h1 class="h2">${ev.title}</h1><p class="muted">${fmtDate(ev.start, { weekday: 'long', day: 'numeric', month: 'long' })} · ${fmtTime(ev.start)} · ${over ? 'finished' : fmtRelative(ev.start)}</p></div>
      <section class="card rd-hero"><div class="row gap center">${ring({ pct: r.overall, size: 96, stroke: 9, color: col, label: pct(r.overall), sub: 'readiness' })}<div class="grow"><div class="headline">${A.readinessLabel(r.overall)}</div><p class="small muted">A composite summary of your preparation, energy, schedule and load — not a clinical measure or a probability of success.</p><span class="pill">Confidence: ${r.confidence}</span></div></div>
        <div class="stack">${parts.map(([k, v, note]) => h`<div class="cap-row"><div class="row between"><span>${label[k]}</span><span class="strong">${pct(v)}</span></div>${bar(v, v >= 0.7 ? 'var(--green)' : v >= 0.5 ? 'var(--blue)' : 'var(--amber)')}<small class="muted">${note}</small></div>`)}</div></section>
      <section class="card advisor"><div class="orb"></div><div class="grow"><div class="strong">Advisor <span class="beta">${ai ? 'AI' : 'LOCAL'}</span></div><p class="adv-text">${ai?.primaryRecommendation || recommendation(ev, r)}</p>
        ${ai ? h`<div class="small muted"><p>${ai.readinessSummary}</p><p>Energy: ${ai.energyOutlook}</p><p>Schedule: ${ai.scheduleSpace}</p><p>Mental load: ${ai.mentalLoad}</p><p>AI confidence ${Math.round((ai.confidence || 0) * 100)}% · assessed ${fmtRelative(ai.at)}</p></div>` : ''}
        <div class="row gap wrap"><button class="btn btn-sm" data-act="assess" id="assess-btn">${icon('sparkle', 14)} ${aiReady() ? (ai ? 'Reassess with AI' : 'Assess with AI') : 'AI not set up'}</button></div></div></section>
      ${win && !over ? h`<section class="card"><div class="eyebrow">Best prep window</div><p class="strong">${fmtDate(win.start, { weekday: 'long' })} ${fmtTime(win.start)} – ${fmtTime(win.end)}</p><p class="small muted">${win.reason}</p><button class="btn btn-sm btn-primary" data-act="block">${icon('plus', 14)} Add prep block</button></section>` : ''}
      <section><div class="sec-h"><h2>Preparation checklist</h2><button class="btn btn-sm btn-outline" data-act="suggest">${icon('sparkle', 14)} Suggest</button></div>
        <ul class="tasks">${(ev.checklist || []).map((c) => h`<li class="task ${c.done ? 'done' : ''}"><button class="check-btn ${c.done ? 'on' : ''}" data-act="tick" data-c="${c.id}" aria-label="${c.done ? 'Mark not done' : 'Mark done'}">${c.done ? icon('check', 16) : ''}</button><span class="grow"><b>${c.text}</b>${c.origin === 'ai' ? h` <span class="pill pill-ai">${icon('sparkle', 12)} AI</span>` : ''}</span><button class="icon-btn" data-act="cedit" data-c="${c.id}" aria-label="Edit item">${icon('edit', 18)}</button><button class="icon-btn" data-act="cdel" data-c="${c.id}" aria-label="Delete item">${icon('trash', 18)}</button></li>`)}</ul>
        <form class="row gap" data-submit="cadd"><input class="input" name="t" maxlength="140" placeholder="Add a prep step" aria-label="New prep step"><button class="btn btn-primary">Add</button></form>
        ${!(ev.checklist || []).length && prepState(ev) !== 'ready' ? h`<button class="link" data-act="ready-all">Mark preparation as sufficient</button>` : ''}</section>
      ${!over ? h`<section class="card"><div class="eyebrow">Quick stress check-in</div><p class="small muted">How is your stress about this right now? It stays on your device and informs readiness.</p><form data-submit="stress">${slider('s', 5)}<div class="row end"><button class="btn btn-sm btn-primary">Log check-in</button></div></form></section>` : ''}
      ${over || ev.status === 'completed' ? h`<section class="card"><div class="eyebrow">How did it go?</div>${ev.outcome ? h`<p class="strong">${['', 'Tough', 'Meh', 'Okay', 'Good', 'Great'][ev.outcome.rating]} (${ev.outcome.rating}/5)</p>${ev.outcome.note ? h`<p class="small muted">${ev.outcome.note}</p>` : ''}` : ''}
        <form data-submit="outcome" class="stack"><div class="rate" role="radiogroup" aria-label="Outcome 1 to 5">${[1, 2, 3, 4, 5].map((n) => h`<button type="button" class="rate-btn ${ev.outcome?.rating === n ? 'on' : ''}" role="radio" data-act="rate" data-n="${n}" aria-label="${n} of 5">${n}</button>`)}</div><input type="hidden" name="rating" value="${ev.outcome?.rating || ''}"><input class="input" name="note" maxlength="200" placeholder="Anything worth remembering? (optional)" value="${ev.outcome?.note || ''}"><div class="row end"><button class="btn btn-sm btn-primary">Save outcome</button></div></form></section>` : ''}
    </div>`;
  },
  actions: {
    back: () => back('#/today'),
    open: (_, __, { id }) => eventDetailSheet(id),
    assess: async (el, _, { id }) => {
      if (!aiReady()) { toast('Set up AI under You → AI & API to use this', { tone: 'warn' }); return; }
      const ev = store.get('events', id); el.disabled = true; el.textContent = 'Assessing…';
      try {
        const r = A.readiness(ev); const res = await askJSON({ system: `${CORE_SYSTEM}\n\n${EVENT_READINESS}`, user: { context: buildContext({ trigger: 'event_readiness', eventId: id, focus: ['recent'] }), localReadiness: { overall: round(r.overall, 2), ...Object.fromEntries(Object.entries(r.parts).map(([k, v]) => [k, round(v, 2)])), hoursLeft: round(r.hoursLeft, 1) } }, schemaName: 'readiness', timeoutMs: 30000 });
        await store.save('events', { id, aiReadiness: { ...res, at: nowISO() } });
      } catch (e) { toast(describeError(e), { tone: 'warn' }); el.disabled = false; el.textContent = 'Assess with AI'; }
    },
    block: async (_, __, { id }) => {
      const ev = store.get('events', id); const w = A.bestPrepWindow(ev); if (!w) return;
      await commit({ type: 'create_event', payload: { title: `Prep: ${ev.title}`, type: 'task', start: w.start.toISOString(), durationMin: 45, importance: 'normal', notes: `Preparation block for “${ev.title}”.` } }, { origin: 'ai' });
    },
    suggest: async (el, _, { id }) => {
      const ev = store.get('events', id); const have = new Set((ev.checklist || []).map((c) => c.text.toLowerCase())); let items = [];
      if (aiReady()) {
        const label0 = el.innerHTML; el.disabled = true; el.textContent = 'Thinking…';
        try { const r = await askJSON({ system: `${CORE_SYSTEM}\n\n${EVENT_READINESS}\nFor this call focus on prepTasks: 3-5 short, concrete prep steps derived from the event title and notes. Put a one-line note in readinessSummary.`, user: { context: buildContext({ trigger: 'prep_suggestions', eventId: id }) }, schemaName: 'readiness', timeoutMs: 30000 }); items = (r.prepTasks || []).map((t) => String(t).slice(0, 140)).filter(Boolean); }
        catch (e) { toast(`${describeError(e)} Using simple templates instead.`, { tone: 'warn' }); }
        el.disabled = false; el.innerHTML = label0;
      }
      const origin = items.length ? 'ai' : 'template';
      if (!items.length) items = TEMPLATES[ev.type] || TEMPLATES.default;
      const add = items.filter((t) => !have.has(t.toLowerCase())).slice(0, 5).map((t) => ({ id: uid('chk'), text: t, done: false, origin }));
      if (!add.length) { toast('Nothing new to add'); return; }
      const prev = ev.checklist || []; await setChecklist(ev, [...prev, ...add]);
      toast(`Added ${add.length} suggested step${add.length > 1 ? 's' : ''} — edit freely`, { undo: () => setChecklist(store.get('events', id), prev) });
    },
    tick: async (el, _, { id }) => { const ev = store.get('events', id); await setChecklist(ev, ev.checklist.map((c) => (c.id === el.dataset.c ? { ...c, done: !c.done } : c))); },
    cdel: async (el, _, { id }) => { const ev = store.get('events', id); const prev = ev.checklist; await setChecklist(ev, prev.filter((c) => c.id !== el.dataset.c)); toast('Step removed', { undo: () => setChecklist(store.get('events', id), prev) }); },
    cedit: (el, _, { id }) => {
      const ev = store.get('events', id); const c = ev.checklist.find((x) => x.id === el.dataset.c);
      openSheet({ title: 'Edit step', body: h`<form class="stack" id="ce">${field('Step', h`<input class="input" name="t" maxlength="140" value="${c.text}" required autofocus>`)}<div class="row gap end"><button class="btn btn-primary">Save</button></div></form>`, onOpen: (s) => s.el.querySelector('#ce').addEventListener('submit', async (e) => { e.preventDefault(); const t = String(new FormData(e.target).get('t')).trim(); if (!t) return; s.close(); const cur = store.get('events', id); await setChecklist(cur, cur.checklist.map((x) => (x.id === c.id ? { ...x, text: t, origin: 'user' } : x))); }) });
    },
    cadd: async (form, _, { id }) => { const t = String(new FormData(form).get('t')).trim(); if (!t) return; const ev = store.get('events', id); await setChecklist(ev, [...(ev.checklist || []), { id: uid('chk'), text: t.slice(0, 140), done: false, origin: 'user' }]); },
    'ready-all': async (_, __, { id }) => { await store.save('events', { id, prepStatus: 'ready' }); toast('Marked as prepared'); },
    stress: async (form, _, { id }) => { const v = Number(new FormData(form).get('s')); await commit({ type: 'create_log', payload: { logType: 'stress', value: v, unit: '/10', detail: 'Pre-event check-in', meta: { eventId: id } } }); },
    rate: (el) => { const f = el.closest('form'); f.querySelector('[name=rating]').value = el.dataset.n; f.querySelectorAll('.rate-btn').forEach((b) => b.classList.toggle('on', b === el)); },
    outcome: async (form, _, { id }) => {
      const f = new FormData(form); const rating = Number(f.get('rating')); if (!(rating >= 1 && rating <= 5)) { toast('Pick a rating from 1 to 5', { tone: 'warn' }); return; }
      const ev = store.get('events', id); const outcome = { rating, note: String(f.get('note') || '').slice(0, 200), at: nowISO() };
      await store.save('events', { id, outcome, status: ev.status === 'scheduled' ? 'completed' : ev.status }); toast('Outcome saved');
      adv.learnFromOutcome({ event: ev.title, importance: ev.importance, prepProgress: round(A.prepRatio(ev), 2), outcomeRating: rating });
    },
  },
};
