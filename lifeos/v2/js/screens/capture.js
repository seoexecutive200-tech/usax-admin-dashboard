import { store } from '../store.js';
import { h, html, icon, toast, openSheet } from '../ui.js';
import { parseLocal, parseWithAI, routeWithAI, classifyHealth, candidateToAction, isAutoSave } from '../capture-parser.js';
import * as T from '../trackers.js';
import { entrySheet } from '../tracker-ui.js';
import { aiReady, askJSON, describeError } from '../groq.js';
import { MEMORY_EXTRACTION, CORE_SYSTEM } from '../prompts.js';
import { buildContext } from '../ai-context.js';
import { requiresConfirm, execute } from '../actions.js';
import { back, navigate } from '../router.js';
import * as adv from '../advisor.js';
import { commit, quickLogSheet, eventFormSheet, proposeAction } from '../sheets.js';
import { fmtDate, fmtTime, fmtRelative, addDays } from '../util.js';

let unsub = null; let pending = []; let saved = []; let safety = null; let busy = false; let note = ''; let root = null;
const TYPE_ICON = { tracker_entry: 'target', log: 'check', event: 'calendar', task: 'check', goal: 'target', memory: 'brain', finance_entry: 'wallet', note: 'note' };
const CHIPS = [['mood', 'Mood', 'smile'], ['water', 'Water', 'droplet'], ['meal', 'Meal', 'utensils'], ['workout', 'Workout', 'dumbbell'], ['expense', 'Expense', 'wallet'], ['event', 'Event', 'calendar'], ['sleep', 'Sleep', 'moon'], ['task', 'Task', 'check'], ['note', 'Note', 'note']];
const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

function candidateCard(c, i) {
  const f = c.fields; const editableValue = c.type === 'log' && c.clarification && ['mood', 'energy', 'stress'].includes(f.logType);
  return h`<div class="card understood" data-i="${i}"><div class="row gap"><span class="u-ic">${icon(TYPE_ICON[c.type] || 'check', 20)}</span><div class="grow"><div class="eyebrow">Understood as · ${c.type.replace('_', ' ')}${c.source === 'ai' ? ' · AI' : ''}</div><div class="strong">${c.summary}</div>
    ${c.type === 'event' ? h`<div class="muted small">${fmtDate(f.start, { weekday: 'long', day: 'numeric', month: 'long' })} at ${fmtTime(f.start)} · ${f.importance} importance</div>` : ''}
    ${c.clarification ? h`<div class="clar">${icon('info', 14)} ${c.clarification}</div>` : ''}
    ${editableValue ? h`<div class="slider"><input type="range" min="1" max="10" value="${f.value}" data-adj="${i}" aria-label="Value 1 to 10"><output>${f.value}</output></div>` : ''}</div></div>
    <div class="row gap end">${c.type === 'event' || c.type === 'tracker_entry' ? h`<button class="btn btn-sm" data-act="edit" data-i="${i}">${c.type === 'tracker_entry' ? 'Fill in / edit' : 'Edit'}</button>` : ''}<button class="btn btn-sm" data-act="drop" data-i="${i}">Dismiss</button><button class="btn btn-sm btn-primary" data-act="ok" data-i="${i}">Confirm</button></div></div>`;
}
function paint() {
  const el = root?.querySelector('#results'); if (!el) return;
  el.innerHTML = html(h`
    ${safety ? h`<div class="card urgent"><div class="strong">${icon('shield', 18)} ${safety.emergency ? 'This may need help right now' : 'Worth checking with a professional'}</div><p>${safety.message}</p>${safety.emergency ? h`<p class="muted small">LifeOS is not an emergency service and cannot assess symptoms. I have paused routine suggestions for this entry.</p>` : ''}<div class="row gap end"><button class="btn btn-sm" data-act="safety-note">Save as a private note</button><button class="btn btn-sm btn-primary" data-act="safety-ok">I’ve got it</button></div></div>` : ''}
    ${busy ? h`<div class="card slim"><span class="spinner"></span> Interpreting…</div>` : ''}
    ${pending.map(candidateCard)}
    ${pending.length > 1 ? h`<div class="row end"><button class="btn btn-primary" data-act="all">Confirm all (${pending.length})</button></div>` : ''}
    ${saved.length ? h`<div class="eyebrow">Saved just now</div>${saved.map((s, i) => h`<div class="saved row between"><span>${icon('check', 16, 'c-green')} ${s.summary}</span><button class="btn btn-sm" data-act="undo" data-i="${i}">Undo</button></div>`)}` : ''}`);
}

async function process(text) {
  if (!text.trim() || busy) return;
  busy = true; pending = []; safety = null; paint();
  const cls = await classifyHealth(text);
  if (cls.class === 'emergency_action_recommended' || cls.class === 'urgent_real_world_evaluation_recommended') {
    const em = cls.class === 'emergency_action_recommended'; await adv.escalate(text, cls.class);
    safety = { emergency: em, text, message: em ? 'If you or someone else may be in danger, please contact your local emergency services now (for example 112, 911 or 999, depending on where you are). If you’re thinking about harming yourself, reach out to a crisis line or someone you trust right away.' : 'What you wrote may be worth a check with a doctor or other professional soon, especially if it’s severe, new or getting worse. LifeOS can’t diagnose or assess symptoms.' };
    busy = false; paint(); if (em) return;
  }
  let cands = parseLocal(text);
  if (cands.every((c) => c.fallback) && aiReady() && text.trim().length >= 6) {
    try {
      let ai = T.allTrackers().length ? await routeWithAI(text) : []; // the user's own trackers first
      if (!ai.length) ai = await parseWithAI(text);
      if (ai.length) cands = ai;
    } catch (e) { toast(describeError(e), { tone: 'warn' }); }
  }
  busy = false;
  const toSave = []; const toAsk = [];
  for (const c of cands) (isAutoSave(c) && !requiresConfirm(candidateToAction(c), true) ? toSave : toAsk).push(c);
  for (const c of toSave) {
    try { const res = await execute(candidateToAction(c), { origin: 'user' }); saved.push({ summary: res.summary, undo: res.undo }); const lt = c.fields?.logType; if (['mood', 'energy', 'stress', 'sleep', 'focus'].includes(lt)) adv.notify('capture'); }
    catch (e) { toast(e.message, { tone: 'warn' }); }
  }
  pending = toAsk; note = text; paint();
  if (pending.length === 1 && pending[0].fallback && aiReady() && text.length >= 24) suggestMemory(text);
  root.querySelector('#cap-text').value = '';
  root.querySelector('#cap-text').focus();
}

// Memory extraction (prompt 11.4): offered, never silent.
async function suggestMemory(text) {
  try {
    const r = await askJSON({ system: `${CORE_SYSTEM}\n\n${MEMORY_EXTRACTION}`, user: { input: text.slice(0, 500), context: buildContext({ trigger: 'memory_extraction' }) }, schemaName: 'memory', timeoutMs: 15000 });
    const good = (r.candidates || []).filter((m) => m.confidence >= 0.7 && m.kind !== 'observed_pattern' && m.text).slice(0, 2);
    for (const m of good) pending.push({ type: 'memory', summary: `Remember: ${m.text}`, fields: { text: m.text, kind: m.kind === 'temporary_context' ? 'temporary_context' : m.kind === 'goal' ? 'goal' : 'explicit_fact', expiresInDays: m.expiresInDays || 7 }, confidence: m.confidence, clarification: m.reason || '', source: 'ai' });
    paint();
  } catch { /* optional */ }
}

export default {
  id: 'capture', static: true,
  render() {
    return h`<div class="screen capture">
      <header class="top"><button class="icon-btn" data-act="back" aria-label="Back">${icon('chevronL', 22)}</button><h1 class="grow center-t">Capture</h1><span style="width:44px"></span></header>
      <form class="cap-box card" data-submit="go"><label class="sr-only" for="cap-text">What happened or what’s coming?</label>
        <textarea id="cap-text" class="cap-input" rows="3" maxlength="600" placeholder="Meeting with David Friday 3pm&#10;Feeling stressed 8/10&#10;Paid 3500 bike EMI" autofocus></textarea>
        <div class="row between"><div class="row gap">${SR ? h`<button type="button" class="icon-btn" data-act="mic" aria-label="Dictate" id="mic">${icon('mic', 22)}</button>` : ''}</div><button class="btn btn-primary" type="submit">${icon('sparkle', 16)} Understand</button></div></form>
      <div class="chips scroll" role="group" aria-label="Quick log">${T.allTrackers().map((t) => h`<button class="chip-btn big" data-act="trkchip" data-id="${t.id}"><span style="color:${T.COLOR_VAR[t.color]}">${icon(t.icon, 18)}</span> ${t.name}</button>`)}${CHIPS.filter(([k]) => store.settings().mode !== 'custom' || ['event', 'task', 'note'].includes(k)).map(([k, l, ic]) => h`<button class="chip-btn big" data-act="chip" data-k="${k}">${icon(ic, 18)} ${l}</button>`)}<button class="chip-btn big" data-act="newtrk">${icon('sparkle', 18)} New tracker</button></div>
      <p class="muted small">Obvious logs save right away with Undo. Events, tasks and anything ambiguous show “Understood as” first. ${aiReady() ? '' : 'Capture works fully without AI.'}</p>
      <div id="results" class="stack" aria-live="polite"></div>
      <section><div class="sec-h"><h2>Recent</h2></div><div id="recent">${recent()}</div></section></div>`;
  },
  mount(el) {
    root = el; paint();
    if (unsub) unsub(); unsub = store.on(() => { const r = root?.querySelector('#recent'); if (r && document.body.dataset.screen === 'capture') r.innerHTML = html(recent()); });
    const ta = el.querySelector('#cap-text');
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); process(ta.value); } });
    ta.addEventListener('focus', () => document.body.classList.add('typing')); ta.addEventListener('blur', () => document.body.classList.remove('typing'));
    if (!el._capBound) el.addEventListener('input', (e) => { const i = e.target.dataset.adj; if (i !== undefined) { pending[i].fields.value = Number(e.target.value); pending[i].summary = `${pending[i].fields.logType[0].toUpperCase()}${pending[i].fields.logType.slice(1)} ${e.target.value}/10`; e.target.nextElementSibling.textContent = e.target.value; e.target.closest('.understood').querySelector('.strong').textContent = pending[i].summary; } });
    el._capBound = true;
  },
  actions: {
    back: () => back('#/today'), go: () => process(root.querySelector('#cap-text').value),
    chip: (el) => quickLogSheet(el.dataset.k),
    mic: (el) => {
      if (!SR) return; const rec = new SR(); rec.lang = store.profile().locale || 'en-US'; rec.interimResults = false;
      el.classList.add('rec'); rec.onresult = (e) => { root.querySelector('#cap-text').value = e.results[0][0].transcript; };
      rec.onend = () => el.classList.remove('rec'); rec.onerror = () => { el.classList.remove('rec'); toast('Voice input not available — type instead', { tone: 'warn' }); };
      try { rec.start(); } catch { el.classList.remove('rec'); }
    },
    ok: async (el) => { const i = Number(el.dataset.i); const c = pending[i]; if (!c) return; pending.splice(i, 1); const res = await commit(candidateToAction(c), { notify: c.type === 'event' }); if (res) saved.push({ summary: res.summary, undo: res.undo }); paint(); },
    all: async () => { const list = pending.splice(0); for (const c of list) { const res = await commit(candidateToAction(c), { notify: c.type === 'event' }); if (res) saved.push({ summary: res.summary, undo: res.undo }); } paint(); },
    drop: (el) => { pending.splice(Number(el.dataset.i), 1); paint(); },
    edit: (el) => { const i = Number(el.dataset.i); const c = pending[i]; pending.splice(i, 1); paint(); if (c.type === 'tracker_entry') { entrySheet(store.get('trackers', c.fields.trackerId), { prefill: c.fields.values, source: 'capture', raw: c.raw }); return; } eventFormSheet({ defaults: { title: c.fields.title, type: c.fields.type, start: c.fields.start, durationMin: Math.round((new Date(c.fields.end) - new Date(c.fields.start)) / 60000), importance: c.fields.importance, location: c.fields.location } }); },
    trkchip: (el) => entrySheet(store.get('trackers', el.dataset.id)),
    newtrk: async () => { const { builderSheet } = await import('../tracker-ui.js'); builderSheet({ text: root.querySelector('#cap-text').value }); },
    undo: async (el) => { const i = Number(el.dataset.i); const s = saved[i]; if (!s) return; saved.splice(i, 1); try { await s.undo(); toast('Undone'); } catch { toast('Could not undo', { tone: 'warn' }); } paint(); },
    'safety-note': async () => { await execute({ type: 'create_log', payload: { logType: 'note', value: null, detail: safety.text, meta: { private: true } } }); safety = null; toast('Saved as a note'); paint(); },
    'safety-ok': () => { safety = null; paint(); },
    del: async (el) => { const { confirmSheet } = await import('../ui.js'); if (await confirmSheet({ title: 'Delete entry?', message: 'This log will be removed.', confirm: 'Delete', danger: true })) await commit({ type: 'delete_log', payload: { id: el.dataset.id } }, { notify: false }); },
  },
};
function recent() {
  const logs = [...store.all('logs')].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 6);
  if (!logs.length) return h`<div class="empty"><p>Your captures will show up here.</p></div>`;
  return h`<ul class="recent">${logs.map((l) => h`<li><span class="grow"><b>${l.type === 'note' ? 'Note' : l.type[0].toUpperCase() + l.type.slice(1)}</b> <span class="muted">${l.type === 'note' ? (l.meta?.private ? 'Private note' : l.detail?.slice(0, 50)) : `${l.value ?? ''} ${l.unit || ''} ${l.type === 'expense' || l.type === 'income' ? `· ${l.detail}` : ''}`}</span><small class="muted"> · ${fmtRelative(l.ts)}</small></span><button class="icon-btn" data-act="del" data-id="${l.id}" aria-label="Delete entry">${icon('trash', 16)}</button></li>`)}</ul>`;
}
