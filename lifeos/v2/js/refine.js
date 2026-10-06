// "Ask me questions": when you add something in plain text, the AI asks a few focused follow-up questions (tap or type answers),
// then builds a better tracker, goal, note, task, event or routine from what you said plus what you answered.
import { store } from './store.js';
import { h, icon, openSheet, toast } from './ui.js';
import { aiReady, askJSON, describeError, usingHosted } from './groq.js';
import { CORE_SYSTEM, CLARIFIER, REFINER } from './prompts.js';
import { execute } from './actions.js';
import * as T from './trackers.js';
import { nowISO } from './util.js';

const KINDS = { tracker: 'Tracker', goal: 'Goal', note: 'Note', task: 'Task', event: 'Event', routine: 'Routine' };
const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Should plain text go through questions? Only when AI is available, the user hasn't turned follow-ups off, and the text is substantial. */
export const followupsOn = () => store.settings().askFollowups !== false;
export const shouldAsk = (text) => aiReady() && followupsOn() && String(text).trim().length >= 12;

function context() {
  return { existingTrackers: T.allTrackers().filter((t) => !t.private).map((t) => t.name).slice(0, 20), existingGoals: store.all('goals').filter((g) => g.status !== 'done').map((g) => g.title).slice(0, 10) };
}
const qaLines = (rounds) => rounds.flatMap((r) => r.items.filter((x) => x.answer).map((x) => `${x.question} ${x.answer}`));

/** Opens the sheet. opts.onFallback runs if AI is unavailable or the user chooses to skip (e.g. save as a plain note). */
export function refineSheet({ text, onFallback = null } = {}) {
  const original = clip(text, 600);
  if (!aiReady()) { toast('Turn on AI (You → AI & API) to get follow-up questions', { tone: 'warn' }); onFallback?.(); return; }
  const st = { rounds: [], current: null, kind: 'note', understood: '', ready: false, busy: true, error: '' };
  const answers = {}; // question id -> answer text
  openSheet({ title: 'A few quick questions', tall: true, body: h`<p class="muted">Thinking about what would help…</p>`,
    onOpen(s) {
      const sheet = s; const origClose = s.close;
      const ask = async () => {
        st.busy = true; st.error = ''; paint();
        try {
          const r = await askJSON({ system: `${CORE_SYSTEM}\n\n${CLARIFIER}`, schemaName: 'clarify', timeoutMs: 30000,
            user: { text: original, round: st.rounds.length + 1, rounds: st.rounds.map((x) => x.items.map((i) => ({ question: i.question, answer: i.answer || '(skipped)' }))), ...context() } });
          const qs = (r.questions || []).slice(0, st.rounds.length ? 3 : 5).map((q, i) => ({ id: `q${st.rounds.length}_${i}`, question: clip(q.question, 160), why: clip(q.why, 80), options: (q.options || []).map((o) => clip(o, 40)).filter(Boolean).slice(0, 5) })).filter((q) => q.question);
          st.understood = clip(r.understood, 200) || st.understood; if (KINDS[r.kind]) st.kind = r.kind; else if (!st.kind) st.kind = 'note';
          st.current = { items: qs }; st.ready = !!r.ready || !qs.length;
        } catch (e) { st.error = describeError(e); st.current = { items: [] }; st.ready = true; }
        st.busy = false; paint();
      };
      const commitRound = () => { if (st.current?.items.length) st.rounds.push({ items: st.current.items.map((q) => ({ question: q.question, answer: clip(answers[q.id], 200) })) }); };
      const enriched = () => { const lines = qaLines(st.rounds); return lines.length ? `${original}. Details: ${lines.join(' ')}` : original; };
      const finish = async () => {
        commitRound(); const details = qaLines(st.rounds); const full = enriched(); const kind = st.kind;
        st.busy = true; paint();
        try {
          if (kind === 'tracker' || kind === 'goal') { const { designAndReview } = await import('./tracker-ui.js'); await designAndReview(full, () => origClose.call(sheet)); }
          else if (kind === 'routine') { origClose.call(sheet); const { describeRoutineSheet } = await import('./routine-ai.js'); setTimeout(() => describeRoutineSheet({ text: full, auto: true }), 250); }
          else if (kind === 'note') { const body = details.length ? `${original}\n\n${details.map((d) => `• ${d}`).join('\n')}` : original; const res = await execute({ type: 'create_log', payload: { logType: 'note', value: null, detail: body } }, { origin: 'user' }); origClose.call(sheet); toast('Saved as a note', { undo: res.undo }); }
          else {
            const r = await askJSON({ system: `${CORE_SYSTEM}\n\n${REFINER}`, schemaName: 'refined', timeoutMs: 25000, user: { kind, text: original, answers: details, now: nowISO(), timezone: store.profile().timezone } });
            origClose.call(sheet); const start = r.start && !Number.isNaN(+new Date(r.start)) ? new Date(r.start) : null;
            setTimeout(async () => {
              if (kind === 'task') { const { taskFormSheet } = await import('./sheets.js'); taskFormSheet({ defaults: { title: clip(r.title, 160) || original, due: start || undefined } }); }
              else { const { eventFormSheet } = await import('./sheets.js'); eventFormSheet({ defaults: { title: clip(r.title, 120) || original, start: start || undefined, durationMin: r.durationMin > 0 ? r.durationMin : 30 } }); }
            }, 250);
          }
        } catch (e) { st.error = describeError(e); st.busy = false; paint(); }
      };
      const paint = () => {
        const items = st.current?.items || [];
        sheet.setBody(h`<div class="stack">
          <div class="card inset"><div class="eyebrow">${icon('sparkle', 12)} What I understood</div><p>${st.understood || original}</p>
            <div class="chips" role="group" aria-label="Make it a">${Object.entries(KINDS).map(([k, l]) => h`<button type="button" class="chip-btn pick ${st.kind === k ? 'on' : ''}" data-kind="${k}" aria-pressed="${st.kind === k}">${l}</button>`)}</div></div>
          ${st.busy ? h`<p class="muted"><span class="spinner"></span> ${st.current ? 'Working…' : 'Thinking about what would help…'}</p>` : ''}
          ${st.error ? h`<p class="form-error">${st.error}</p>` : ''}
          ${!st.busy && items.length ? h`<div class="eyebrow">Answer what you like — skip the rest</div>${items.map((q) => h`<div class="card inset rq"><b>${q.question}</b>${q.why ? h`<div class="tiny muted">${q.why}</div>` : ''}
            ${q.options.length ? h`<div class="chips">${q.options.map((o) => h`<button type="button" class="chip-btn pick ${answers[q.id] === o ? 'on' : ''}" data-q="${q.id}" data-o="${o}">${o}</button>`)}</div>` : ''}
            <input class="input" data-a="${q.id}" maxlength="200" placeholder="${q.options.length ? 'Or type your own' : 'Your answer'}" value="${q.options.includes(answers[q.id]) ? '' : (answers[q.id] || '')}" aria-label="${q.question}"></div>`)}` : ''}
          ${!st.busy && !items.length && !st.error ? h`<p class="small muted">${st.rounds.length ? 'That’s all I need.' : 'This is already specific — no questions needed.'}</p>` : ''}
          ${!st.busy ? h`<div class="row gap wrap end">
            ${items.length && st.rounds.length < 1 ? h`<button class="btn" data-more>Ask me more</button>` : ''}
            <button class="btn btn-primary" data-create>Create ${KINDS[st.kind] ? `a ${KINDS[st.kind].toLowerCase()}` : 'it'}</button></div>
            <div class="row gap wrap"><button class="link" data-skip>Skip questions</button>${onFallback ? h`<button class="link" data-plain>Just save it as it is</button>` : ''}</div>` : ''}
          <p class="tiny muted">${icon('shield', 12)} Your answers are only used to build this item.${usingHosted() ? ' Uses your included AI (limited per day).' : ''}</p></div>`);
        const el = sheet.el;
        el.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => { st.kind = b.dataset.kind; paint(); }));
        el.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => { answers[b.dataset.q] = answers[b.dataset.q] === b.dataset.o ? '' : b.dataset.o; paint(); }));
        el.querySelectorAll('[data-a]').forEach((i) => i.addEventListener('input', () => { answers[i.dataset.a] = i.value; }));
        el.querySelector('[data-create]')?.addEventListener('click', finish);
        el.querySelector('[data-skip]')?.addEventListener('click', finish);
        el.querySelector('[data-more]')?.addEventListener('click', () => { commitRound(); ask(); });
        el.querySelector('[data-plain]')?.addEventListener('click', () => { origClose.call(sheet); onFallback?.(); });
      };
      ask();
    } });
}
