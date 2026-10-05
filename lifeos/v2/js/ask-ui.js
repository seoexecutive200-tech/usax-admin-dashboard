// "Ask your own data": pick any two things you track and see how they relate (local maths). AI can map a typed question to the pair.
import * as T from './trackers.js';
import { h, html, icon, toast, field } from './ui.js';
import { aiReady, askJSON, describeError } from './groq.js';
import { CORE_SYSTEM, SERIES_MAPPER } from './prompts.js';
import { round } from './util.js';

let state = { q: '', x: '', y: '', lag: 0, result: null, note: '', busy: false };

export function askCardHTML() {
  const refs = T.seriesRefs();
  if (refs.length < 2) return h`<section class="card"><div class="eyebrow">Ask your data</div><p class="muted small">Track at least two things and you can ask how they relate — for example “does coffee affect my sleep?”.</p></section>`;
  const opt = (sel) => h`<option value="">Choose…</option>${refs.map((r) => h`<option value="${r.ref}" ${sel === r.ref ? 'selected' : ''}>${r.label}</option>`)}`;
  const res = state.result;
  return h`<section class="card" id="askcard"><div class="eyebrow">Ask your data</div>
    ${aiReady() ? h`<form class="row gap" data-submit="ask-map"><input class="input" name="q" value="${state.q}" maxlength="200" placeholder="Does coffee affect my sleep?" aria-label="Your question"><button class="btn btn-primary" ${state.busy ? 'disabled' : ''} aria-label="Ask">${state.busy ? '…' : icon('send', 18)}</button></form><p class="tiny muted">…or choose the two things yourself:</p>` : ''}
    <div class="grid2"><label class="field"><span class="field-label">This…</span><select class="input" data-change="ask-x">${opt(state.x)}</select></label><label class="field"><span class="field-label">…and this</span><select class="input" data-change="ask-y">${opt(state.y)}</select></label></div>
    <label class="field"><span class="field-label">Compare against</span><select class="input" data-change="ask-lag"><option value="0" ${state.lag === 0 ? 'selected' : ''}>the same day</option><option value="1" ${state.lag === 1 ? 'selected' : ''}>the next day</option></select></label>
    <button class="btn btn-sm" data-act="ask-run" ${state.x && state.y && state.x !== state.y ? '' : 'disabled'}>Compare</button>
    ${state.note ? h`<p class="small muted">${icon('info', 14)} ${state.note}</p>` : ''}
    ${res ? h`<div class="card inset"><p>${res.text}</p>${res.insufficient ? '' : h`<div class="row gap wrap"><span class="pill">${res.n} days</span><span class="pill ${res.confidence === 'High' ? 'pill-green' : res.confidence === 'Moderate' ? 'pill-amber' : ''}">${res.confidence} confidence</span></div><p class="tiny muted">An association in your own data — not proof that one causes the other.</p>`}</div>` : ''}</section>`;
}
export const askActions = {
  'ask-run': () => { state.result = T.relate(state.x, state.y, { lag: state.lag }); state.note = ''; return 'rerender'; },
};
export const askInputs = {
  'ask-x': (el) => { state.x = el.value; state.result = null; return 'rerender'; }, 'ask-y': (el) => { state.y = el.value; state.result = null; return 'rerender'; },
  'ask-lag': (el) => { state.lag = Number(el.value); state.result = null; return 'rerender'; },
};
export async function mapQuestion(q) {
  state.q = q; state.busy = true;
  try {
    const refs = T.seriesRefs();
    const r = await askJSON({ system: `${CORE_SYSTEM}\n\n${SERIES_MAPPER}`, user: { question: q, series: refs.filter((x) => !x.ref.startsWith('t:') || !(T.allTrackers().find((t) => t.id === x.ref.split(':')[1])?.private)).map(({ ref, label, unit }) => ({ ref, label, unit })) }, schemaName: 'series', timeoutMs: 20000 });
    if (refs.some((x) => x.ref === r.x) && refs.some((x) => x.ref === r.y) && r.x !== r.y) { state.x = r.x; state.y = r.y; state.lag = r.lagDays >= 1 ? 1 : 0; state.note = r.explanation; state.result = T.relate(state.x, state.y, { lag: state.lag }); }
    else { state.note = 'I couldn’t match that to two things you track — choose them below.'; state.result = null; }
  } catch (e) { toast(describeError(e), { tone: 'warn' }); }
  state.busy = false;
}
export const askState = state;
