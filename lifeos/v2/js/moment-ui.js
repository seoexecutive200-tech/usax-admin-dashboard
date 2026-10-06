// The "Right now" card on Today: asks the one question that fits this moment, runs your answer, and can follow up.
import * as M from './moments.js';
import { h, icon, toast } from './ui.js';
import { aiReady, askJSON, usingHosted, hosted } from './groq.js';
import { CORE_SYSTEM, MOMENT_WRITER } from './prompts.js';
import { lsGet, lsSet, safeJSON, dayKey } from './util.js';
import { rerender } from './router.js';
import { aiOff, aiOffReason, aiNoteHidden, hideAiNote } from './ai-setup.js';

const prog = {}; // moment key -> { step, say }
const snap = {}; // moment key -> the moment as first shown, so a question you've started stays put even if answering it changes the conditions
let lastDone = null; // { msg, until }
const TXT = 'lifeos.momentText';
const aiPending = new Set();
const hash = (s) => { let h = 5; for (const c of String(s)) h = (h * 33 + c.charCodeAt(0)) >>> 0; return h.toString(36); };
const ck = (m) => `${m.key}#${hash(m.open)}`; // the cached AI wording is tied to the facts it was written from, so it refreshes when they change
const cached = (k) => safeJSON(lsGet(TXT), {})[k] || null;
// Cosmetic wording must never use up your hosted AI allowance: at most 5 a day, and none once fewer than 20 requests remain today.
function aiBudgetOk() { const b = safeJSON(lsGet('lifeos.momentAI'), {}); if (usingHosted() && hosted.limit && hosted.limit - hosted.used < 20) return false; return (b[dayKey()] || 0) < 5; }
async function ensureAIText(m) {
  const k = ck(m); if (m.idle || cached(k) || aiPending.has(k) || !aiReady() || !aiBudgetOk()) return;
  aiPending.add(k);
  try {
    const b = safeJSON(lsGet('lifeos.momentAI'), {}); lsSet('lifeos.momentAI', JSON.stringify({ [dayKey()]: (b[dayKey()] || 0) + 1 }));
    const r = await askJSON({ system: `${CORE_SYSTEM}\n\n${MOMENT_WRITER}`, schemaName: 'moment', timeoutMs: 15000, user: { moment: m.label, line: m.open, partOfDay: new Date().getHours() } });
    const msg = String(r.message || '').replace(/\s+/g, ' ').trim();
    if (msg && msg.length <= 260) { const all = safeJSON(lsGet(TXT), {}); const keys = Object.keys(all); if (keys.length > 40) delete all[keys[0]]; all[k] = msg; lsSet(TXT, JSON.stringify(all)); rerender(); }
  } catch { /* the plain line is fine */ } finally { aiPending.delete(k); }
}

export function momentCard() {
  if (lastDone && lastDone.until > Date.now()) return h`<section class="card now done"><div class="row gap center">${icon('check', 18, 'c-green')}<span>${lastDone.msg}</span></div></section>`;
  const live = Object.keys(snap)[0]; const m = live ? snap[live] : M.current(); if (!m) return ''; // once you've started answering, that question stays put
  const p = prog[m.key] || { step: m.start, say: '' }; const st = m.steps[p.step] || m.steps[m.start];
  if (p.step === m.start && !m.idle) ensureAIText(m);
  const first = p.step === m.start; const open = first ? (cached(ck(m)) || m.open) : '';
  return h`<section class="card now" data-key="${m.key}"><div class="row between center"><div class="eyebrow">${icon('sparkle', 12)} ${m.label}</div>${m.idle ? '' : h`<span class="row gap"><button class="link" data-act="m-snooze" data-key="${m.key}">Not now</button><button class="link" data-act="m-skip" data-key="${m.key}">Skip</button></span>`}</div>
    ${p.say ? h`<p class="small muted">${p.say}</p>` : ''}${open ? h`<p class="${m.idle ? 'headline' : ''}">${open}</p>` : ''}${st.text ? h`<p class="strong">${st.text}</p>` : ''}
    ${st.chips?.length ? h`<div class="chips">${st.chips.map((c, i) => h`<button class="chip-btn big" data-act="m-chip" data-key="${m.key}" data-i="${i}">${c.l}</button>`)}</div>` : ''}
    ${st.input ? h`<form class="row gap" data-submit="m-send" data-key="${m.key}"><input class="input grow" name="v" ${st.input.type === 'number' ? 'type="number" step="any" inputmode="decimal"' : 'type="text" maxlength="160"'} placeholder="${st.input.placeholder || ''}" aria-label="${st.text || 'Your answer'}" autocomplete="off"><button class="btn btn-primary">${m.idle ? 'Go' : 'Save'}</button>${st.skip ? h`<button type="button" class="btn" data-act="m-nosay" data-key="${m.key}">${st.skip}</button>` : ''}</form>` : ''}${aiOff() && !aiNoteHidden() && (m.idle || first) ? h`<p class="tiny muted">${icon('sparkle', 12)} ${aiOffReason()} <button class="link" data-ai-setup>Turn on AI</button> for smarter check-ins and planning. <button class="link" data-act="m-hide-ai">Hide</button></p>` : ''}</section>`;
}

async function answer(key, value, chip) {
  const m = snap[key] || M.candidates().find((x) => x.key === key); if (!m) { rerender(); return; }
  snap[key] = m; const p = prog[key] || (prog[key] = { step: m.start, say: '' }); const st = m.steps[p.step]; if (!st) return;
  let r; try { r = await st.run(value, chip); } catch (e) { toast(e.message || 'Couldn’t do that', { tone: 'warn' }); return; }
  if (r?.say) p.say = r.say; else p.say = '';
  if (r?.next && m.steps[r.next]) { p.step = r.next; rerender(); return; }
  if (!m.idle) M.markHandled(key); delete prog[key]; delete snap[key];
  if (r?.done) { lastDone = { msg: r.done, until: Date.now() + 4500 }; setTimeout(rerender, 4600); }
  if (r?.open) await openThing(r.open);
  rerender();
}
async function openThing(what) {
  const fz = await import('./focus-ui.js');
  if (what === 'plan') (await import('./dayplan.js')).planDaySheet();
  else if (what === 'focus') fz.focusStartSheet(); else if (what === 'focus45') fz.focusStartSheet({ minutes: 45 }); else if (what === 'focus-open') fz.focusSheet();
  else if (what === 'log') (await import('./router.js')).navigate('#/capture'); else if (what === 'chat') (await import('./sheets.js')).askSheet();
}
export const momentActions = {
  'm-chip': (el) => { const m = snap[el.dataset.key] || M.candidates().find((x) => x.key === el.dataset.key); const p = prog[el.dataset.key]; const st = m?.steps[p?.step || m?.start]; const c = st?.chips?.[Number(el.dataset.i)]; if (c) answer(el.dataset.key, c.v, c); },
  'm-send': (f) => { const v = String(new FormData(f).get('v') || '').trim(); if (!v) return; answer(f.dataset.key, v); },
  'm-nosay': (el) => answer(el.dataset.key, ''),
  'm-snooze': (el) => { M.snooze(el.dataset.key, 60); delete prog[el.dataset.key]; delete snap[el.dataset.key]; rerender(); },
  'm-hide-ai': () => { hideAiNote(7); rerender(); },
  'm-skip': (el) => { M.markHandled(el.dataset.key); delete prog[el.dataset.key]; delete snap[el.dataset.key]; rerender(); },
};
