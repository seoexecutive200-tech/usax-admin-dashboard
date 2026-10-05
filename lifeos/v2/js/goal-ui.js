// "Reach a number" goals (e.g. reduce weight to 80 kg): progress card, local advice, optional AI coaching, and a one-tap
// conversion for trackers that were created with a weekly total target by mistake.
import { store } from './store.js';
import * as T from './trackers.js';
import { h, icon, bar, openSheet, toast } from './ui.js';
import { aiReady, askJSON, describeError } from './groq.js';
import { CORE_SYSTEM, GOAL_COACH } from './prompts.js';
import { editorSheet } from './tracker-ui.js';
import { round } from './util.js';

const line = (x) => h`<div class="whatsnew"><span class="t-ic lead">${icon(x.icon, 20)}</span><div><b>${x.title}</b><div class="small muted">${x.text}</div></div></div>`;

export function goalSection(t, f) {
  const tg = f?.target; if (!tg || f.type !== 'number') return '';
  if (tg.period === 'week' && f.agg === 'last') { // a weekly "total" on a reading makes no sense — offer to make it a goal
    const v = T.formatValue(f, tg.value);
    return h`<section class="card goal"><div class="eyebrow">${icon('target', 12)} Is this a goal?</div><p class="small">“${f.label}” has a target of ${v} <i>per week</i>, which measures a weekly total. If you want to <b>reach</b> ${v} and track your progress toward it, turn it into a goal.</p>
      <div class="row gap wrap"><button class="btn btn-sm btn-primary" data-act="goal-convert" data-d="down">Reduce to ${v}</button><button class="btn btn-sm" data-act="goal-convert" data-d="up">Increase to ${v}</button></div></section>`;
  }
  if (tg.period !== 'goal') return '';
  const { p, lines } = T.goalAdvice(t, f); const g = p.goal; const fmt = (v) => (v === null || v === undefined ? '–' : T.formatValue(f, v));
  return h`<section class="card goal"><div class="row between center"><div class="eyebrow">${icon('target', 12)} Your goal · ${g.down ? 'reduce' : 'increase'} to ${fmt(p.target)}</div>${g.by ? h`<span class="pill">by ${g.by}</span>` : ''}</div>
    ${bar(p.pct, p.met ? 'var(--green)' : 'var(--blue)')}
    <div class="stats"><div><small class="muted">Start</small><b>${fmt(g.start)}</b></div><div><small class="muted">Now</small><b>${fmt(g.current)}</b></div><div><small class="muted">Target</small><b>${fmt(p.target)}</b></div><div><small class="muted">To go</small><b>${g.remaining === null ? '–' : fmt(g.remaining)}</b></div></div>
    <div class="stack">${lines.map(line)}</div>
    <div class="row gap wrap"><button class="btn btn-sm btn-primary" data-act="goal-coach">${icon('sparkle', 14)} Get ideas to reach it</button><button class="btn btn-sm" data-act="goal-edit">Edit goal</button></div>
    <p class="tiny muted">Estimates from your own readings — informational, not medical advice.</p></section>`;
}

export async function convertToGoal(tid, dir) {
  const t = store.get('trackers', tid); const f = T.primaryField(t); if (!f?.target) return;
  const fields = t.fields.map((x) => (x.id === f.id ? { ...x, agg: 'last', target: { value: x.target.value, period: 'goal', dir: dir === 'down' ? 'atmost' : 'atleast' } } : x));
  await store.save('trackers', { id: tid, fields }); toast(`Goal set: ${dir === 'down' ? 'reduce' : 'increase'} to ${T.formatValue(f, f.target.value)}`);
}
export const editGoal = (tid) => { const t = store.get('trackers', tid); editorSheet(t, { existing: t }); };

function others(t) {
  return T.allTrackers().filter((x) => x.id !== t.id && !x.private).slice(0, 8).map((x) => {
    const f = T.primaryField(x); if (!f || !T.isNumericField(f)) return null; const s = T.stats(x, f, 7);
    return s.days ? { name: x.name, measure: f.label, unit: f.unit || '', average7d: round(s.avg, 1), daysLogged7d: s.days } : null;
  }).filter(Boolean);
}
export function coachSheet(tid) {
  const t = store.get('trackers', tid); const f = T.primaryField(t); if (!t || !f?.target || f.target.period !== 'goal') return;
  const { p, lines } = T.goalAdvice(t, f); const g = p.goal;
  const view = (body) => h`<div class="stack">${body}</div>`;
  openSheet({ title: 'Ideas to reach your goal', tall: true, body: view(h`<p class="muted">Looking at your readings…</p>`),
    async onOpen(s) {
      const local = h`<div class="eyebrow">From your numbers</div><div class="stack">${lines.map(line)}</div>`;
      if (!aiReady()) { s.setBody(view(h`${local}<div class="card inset"><p class="small">For personalised suggestions that also look at your other trackers, turn on AI under You → AI & API (signed-in accounts get some included).</p></div>`)); return; }
      try {
        const r = await askJSON({ system: `${CORE_SYSTEM}\n\n${GOAL_COACH}`, schemaName: 'coach', timeoutMs: 30000, user: {
          goal: { tracker: t.name, measure: f.label, unit: f.unit || '', direction: g.down ? 'reduce' : 'increase', start: g.start, current: g.current, target: p.target, targetDate: g.by, remaining: round(g.remaining, 2) },
          pace: { perWeekTowardGoal: g.rate === null ? null : round(g.rate, 2), estimatedFinish: g.eta ? g.eta.toISOString().slice(0, 10) : null, neededPerWeek: g.needed === null ? null : round(g.needed, 2), plateau: g.plateau, readingsLast14Days: g.last14 },
          recentReadings: T.readings(t, f, 28).map((x) => ({ date: x.key, value: x.value })), otherThingsTheyTrack: others(t) } });
        s.setBody(view(h`<div class="card inset"><p>${r.summary}</p></div>
          <div class="eyebrow">Next 1–2 weeks</div><div class="stack">${(r.suggestions || []).map((x) => h`<div class="whatsnew"><span class="t-ic lead">${icon('sparkle', 20)}</span><div><b>${x.title}</b><div class="small muted">${x.detail}</div></div></div>`)}</div>
          ${(r.watchOuts || []).length ? h`<div class="eyebrow">Worth keeping in mind</div><ul class="small">${r.watchOuts.map((x) => h`<li>${x}</li>`)}</ul>` : ''}
          ${(r.questions || []).length ? h`<div class="eyebrow">Things that would help me next time</div><ul class="small">${r.questions.map((x) => h`<li>${x}</li>`)}</ul><p class="tiny muted">Answer them by logging in Capture, e.g. “skipped dessert, 20 min walk”.</p>` : ''}
          <p class="tiny muted">${icon('shield', 12)} Suggestions are informational, based only on what you’ve logged — not medical advice.</p>`));
      } catch (e) { s.setBody(view(h`${local}<p class="small err-t">${describeError(e)}</p>`)); }
    } });
}
