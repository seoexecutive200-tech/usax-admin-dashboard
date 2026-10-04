import { store } from '../store.js';
import * as A from '../analytics.js';
import { h, icon, spark, bar, toast, openSheet, seg, bindSeg, segVal, field, logo } from '../ui.js';
import { dayKey, addDays, round, isNum, fmtDate, parseKey, weekKey, download, nowISO } from '../util.js';
import { aiReady, askJSON, describeError } from '../groq.js';
import { generateDaily, generateWeekly, buildWeeklyLocal, buildDailyLocal, reportToMarkdown } from '../reports.js';
import { syncPatterns } from '../memory.js';
import { commit } from '../sheets.js';
import { CORE_SYSTEM, EXPERIMENT } from '../prompts.js';
import { buildContext } from '../ai-context.js';
import { navigate } from '../router.js';

let days = 7; let dayView = 'today'; let busy = '';
const UNIT = { sleep: 'h', mood: '/10', energy: '/10', stress: '/10', focus: '/10', water: ' ml', workout: ' min' };
const f1 = (v) => (isNum(v) ? String(round(v, 1)) : '–');
const arrow = (d, good) => (d == null ? '' : Math.abs(d) < 0.05 ? '→' : (d > 0 ? '↑' : '↓'));

function recoverySeries() {
  return Array.from({ length: days }, (_, i) => { const d = addDays(new Date(), -(days - 1 - i)); const has = Object.keys(A.logsOnDay(dayKey(d))).length; return { key: dayKey(d), value: has ? A.capacity(d).overall * 10 : null }; });
}
function trendCard(title, pts, color, unit, cur, prev, invert = false) {
  const d = isNum(cur) && isNum(prev) ? cur - prev : null; const good = d == null ? null : invert ? d < 0 : d > 0;
  return h`<div class="card trend"><div class="row between"><span class="eyebrow">${title}</span>${d != null ? h`<span class="delta ${Math.abs(d) < 0.05 ? '' : good ? 'up' : 'down'}">${arrow(d)} ${f1(Math.abs(d))}${unit === 'h' ? 'h' : ''}</span>` : ''}</div><div class="big">${f1(cur)}<small>${unit}</small></div>${spark(pts, { color })}<small class="muted">vs prior ${days} days: ${f1(prev)}${unit}</small></div>`;
}
function reportView() {
  const key = dayView === 'today' ? dayKey() : dayKey(addDays(new Date(), -1));
  const cached = store.get('reports', `daily:${key}`);
  return cached?.source === 'ai' ? cached : buildDailyLocal(key);
}
function weeklyView() {
  const c = store.get('reports', `weekly:${weekKey()}`); return c?.source === 'ai' ? c : buildWeeklyLocal();
}

export default {
  id: 'insights',
  render() {
    const cmp = A.compare(days); const cur = cmp.cur; const prev = cmp.prev; const wk = weeklyView(); const pats = A.patterns(60);
    const dr = reportView(); const rec = recoverySeries(); const recAvg = round(rec.filter((p) => isNum(p.value)).reduce((s, p, _, a) => s + p.value / a.length, 0), 1);
    const exps = [...store.all('experiments')].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const n = A.totalDaysWithData(); const fl = A.futureLoad(7); const heavy = fl.filter((d) => ['heavy', 'peak'].includes(d.level)).length;
    return h`<div class="screen insights">
      <header class="top">${logo()}<div class="row gap"><button class="icon-btn" data-act="export" aria-label="Export weekly report">${icon('download', 22)}</button></div></header>
      <div class="hero"><h1>Insights</h1><p class="muted">${fmtDate(addDays(new Date(), -(days - 1)), { day: 'numeric', month: 'short' })} – ${fmtDate(new Date(), { day: 'numeric', month: 'short' })}</p></div>
      <div class="seg wide" role="radiogroup" aria-label="Date range">${[7, 14, 30].map((d) => h`<button class="seg-btn ${d === days ? 'on' : ''}" role="radio" aria-checked="${d === days}" data-act="range" data-d="${d}">${d} days</button>`)}</div>
      <section class="card story"><div class="row between"><span class="eyebrow">This week’s story</span><span class="pill">${wk.source === 'ai' ? 'AI-written' : 'Built locally'} · ${Math.round((wk.confidence || 0) * 100)}% conf.</span></div>
        <p class="story-text">${wk.narrative}</p>
        <div class="row gap wrap"><button class="btn btn-sm" data-act="weekly" ${busy === 'weekly' ? 'disabled' : ''}>${busy === 'weekly' ? 'Writing…' : aiReady() ? `${icon('sparkle', 14)} ${wk.source === 'ai' ? 'Rewrite with AI' : 'Write with AI'}` : `${icon('refresh', 14)} Refresh`}</button><button class="btn btn-sm" data-act="export">${icon('download', 14)} Export</button></div></section>
      <div class="grid2 cards">
        <div class="card mini good"><span class="eyebrow">Biggest improvement</span><p>${wk.biggestImprovement}</p></div>
        <div class="card mini press"><span class="eyebrow">Biggest pressure</span><p>${wk.biggestPressure}</p></div></div>
      <div class="card mini"><span class="eyebrow">Next-week outlook</span><p>${wk.futureLoad}</p><p class="small strong">Focus: ${wk.nextWeekFocus}</p></div>
      <section><div class="sec-h"><h2>Trends</h2><small class="muted">${days}-day averages</small></div>
        <div class="grid2 cards">${trendCard('Sleep', cur.sleep.points, 'var(--violet)', 'h', cur.sleep.avg, prev.sleep.avg)}${trendCard('Mood', cur.mood.points, 'var(--blue)', '/10', cur.mood.avg, prev.mood.avg)}
        ${trendCard('Recovery / capacity', rec, 'var(--green)', '/10', recAvg, null)}
        <div class="card trend"><span class="eyebrow">Consistency</span><div class="big">${cur.logged}<small> of ${days} days</small></div><div class="dots-row">${Array.from({ length: days }, (_, i) => { const k = dayKey(addDays(new Date(), -(days - 1 - i))); return h`<i class="${Object.keys(A.logsOnDay(k)).length ? 'on' : ''}"></i>`; })}</div><small class="muted">Days with at least one entry. Gaps are fine.</small></div></div></section>
      <section class="card"><div class="eyebrow">This vs prior ${days} days</div><table class="cmp"><tbody>${cmp.rows.filter((r) => isNum(r.cur) || isNum(r.prev)).map((r) => h`<tr><th scope="row">${A.METRIC_LABEL[r.type]}</th><td>${f1(r.cur)}${UNIT[r.type] === ' ml' ? '' : ''}</td><td class="muted">${f1(r.prev)}</td><td class="${r.goodness > 0.3 ? 'up' : r.goodness < -0.3 ? 'down' : 'muted'}">${r.delta == null ? '–' : `${r.delta > 0 ? '+' : ''}${f1(r.delta)}`}</td></tr>`)}</tbody></table>${cmp.rows.every((r) => !isNum(r.cur)) ? h`<p class="muted small">No data in this range yet.</p>` : ''}</section>
      <section><div class="sec-h"><h2>Patterns</h2></div>
        ${pats.length ? pats.map((p) => h`<div class="card pattern"><p>${p.text}</p><div class="row gap wrap"><span class="pill">${p.n} observed days</span><span class="pill ${p.confidence === 'High' ? 'pill-green' : p.confidence === 'Moderate' ? 'pill-amber' : ''}">${p.confidence} confidence</span></div><small class="muted">An association in your data — not proof of cause.</small></div>`)
        : h`<div class="card"><p><b>I don’t know yet.</b> ${n < 7 ? `I have ${n} day${n === 1 ? '' : 's'} of data; patterns need at least about 6 matching days.` : 'Nothing stands out as reliable so far.'} I’ll keep watching rather than guess.</p><button class="btn btn-sm" data-act="newexp">${icon('target', 14)} Try a small experiment</button></div>`}
      </section>
      <section class="card"><div class="row between"><span class="eyebrow">Daily report</span><div class="seg sm" role="radiogroup" aria-label="Day">${[['today', 'Today'], ['yesterday', 'Yesterday']].map(([v, l]) => h`<button class="seg-btn ${dayView === v ? 'on' : ''}" role="radio" aria-checked="${dayView === v}" data-act="dview" data-v="${v}">${l}</button>`)}</div></div>
        <p class="story-text">${dr.narrative}</p>
        ${dr.wentWell?.length ? h`<div class="eyebrow">What went well</div><ul class="bul">${dr.wentWell.map((x) => h`<li>${x}</li>`)}</ul>` : ''}
        ${dr.pressure?.length ? h`<div class="eyebrow">What created pressure</div><ul class="bul">${dr.pressure.map((x) => h`<li>${x}</li>`)}</ul>` : ''}
        ${dr.deviation ? h`<p class="small"><b>Deviation:</b> ${dr.deviation}</p>` : ''}${dr.pattern ? h`<p class="small"><b>Pattern:</b> ${dr.pattern}</p>` : ''}
        <p class="small"><b>Tomorrow:</b> ${dr.tomorrowFocus}</p>
        <div class="row gap wrap"><span class="pill">${dr.source === 'ai' ? 'AI-written' : 'Built locally'} · ${Math.round((dr.confidence || 0) * 100)}% conf.${dr.incomplete ? ' · partial data' : ''}</span><button class="btn btn-sm" data-act="daily" ${busy === 'daily' ? 'disabled' : ''}>${busy === 'daily' ? 'Writing…' : aiReady() ? 'Write with AI' : 'Refresh'}</button></div></section>
      <section><div class="sec-h"><h2>Experiments</h2><button class="btn btn-sm btn-outline" data-act="newexp">${icon('plus', 16)} New</button></div>
        ${exps.length ? exps.map((e) => { const r = A.experimentResult(e); const running = e.status === 'running'; return h`<div class="card"><div class="row between"><b>${e.hypothesis}</b><span class="pill ${running ? 'pill-amber' : 'pill-green'}">${running ? 'Running' : 'Finished'}</span></div>${e.intervention ? h`<p class="small muted">Change: ${e.intervention}</p>` : ''}<p class="small">Measuring ${A.METRIC_LABEL[e.metric]?.toLowerCase()}: ${r.diff == null ? 'not enough data yet' : `${f1(r.before)} before → ${f1(r.during)} during (${r.diff > 0 ? '+' : ''}${f1(r.diff)})`} · ${r.nBefore}+${r.nDuring} days · ${r.confidence} confidence</p><small class="muted">A small before/after comparison, not proof.</small><div class="row gap end">${running ? h`<button class="btn btn-sm" data-act="finexp" data-id="${e.id}">Finish</button>` : ''}<button class="btn btn-sm btn-danger-ghost" data-act="delexp" data-id="${e.id}">Delete</button></div></div>`; }) : h`<div class="empty"><p>When the data can’t answer a question, a tiny low-risk experiment can.</p></div>`}</section></div>`;
  },
  mount() {
    syncPatterns();
    // keep cached reports fresh for offline viewing (silent saves; no re-render loop)
    const lw = buildWeeklyLocal(); const cw = store.get('reports', `weekly:${weekKey()}`);
    if (!cw || (cw.source === 'local' && cw.narrative !== lw.narrative)) store.save('reports', { id: `weekly:${weekKey()}`, ...lw, generatedAt: nowISO() }, { silent: true });
    const dk = dayKey(); const ld = buildDailyLocal(dk); const cd = store.get('reports', `daily:${dk}`);
    if (!cd || (cd.source === 'local' && cd.narrative !== ld.narrative)) store.save('reports', { id: `daily:${dk}`, ...ld, generatedAt: nowISO() }, { silent: true });
  },
  actions: {
    range: (el) => { days = Number(el.dataset.d); navigate('#/insights'); },
    dview: (el) => { dayView = el.dataset.v; navigate('#/insights'); },
    weekly: async () => { busy = 'weekly'; navigate('#/insights'); try { await generateWeekly(undefined, { force: true, useAI: aiReady() }); toast(aiReady() ? 'Weekly story updated' : 'Refreshed'); } catch (e) { toast(describeError(e), { tone: 'warn' }); } busy = ''; navigate('#/insights'); },
    daily: async () => { busy = 'daily'; navigate('#/insights'); try { await generateDaily(dayView === 'today' ? dayKey() : dayKey(addDays(new Date(), -1)), { force: true, useAI: aiReady() }); } catch (e) { toast(describeError(e), { tone: 'warn' }); } busy = ''; navigate('#/insights'); },
    export: () => exportWeekly(),
    newexp: () => experimentSheet(),
    finexp: (el) => commit({ type: 'finish_experiment', payload: { id: el.dataset.id } }, { notify: false }),
    delexp: async (el) => { const e = store.get('experiments', el.dataset.id); await store.remove('experiments', e.id); toast('Experiment deleted', { undo: () => store.restore('experiments', e) }); },
  },
};

export async function exportWeekly() {
  const rep = weeklyView(); download(`lifeos-weekly-${weekKey()}.md`, reportToMarkdown(rep), 'text/markdown'); toast('Weekly report exported');
}

function experimentSheet() {
  openSheet({
    title: 'New experiment', tall: true,
    body: h`<p class="muted small">One change, one measure, a few days. Nothing risky — no medication, extreme restriction or sleep deprivation.</p><form class="stack" id="xp">
      ${field('Hypothesis', h`<input class="input" name="hyp" maxlength="200" placeholder="A 15-minute walk after lunch lifts my afternoon energy" required>`)}
      ${field('The one change', h`<input class="input" name="int" maxlength="200" placeholder="Walk 15 minutes after lunch">`)}
      ${field('Measure', h`<select class="input" name="metric">${['energy', 'mood', 'stress', 'focus', 'sleep'].map((m) => h`<option value="${m}">${A.METRIC_LABEL[m]}</option>`)}</select>`)}
      ${field('Length (days)', h`<input class="input" type="number" name="days" min="3" max="28" value="7">`)}
      <p class="form-error" id="xe" role="alert"></p>
      <div class="row gap end">${aiReady() ? h`<button type="button" class="btn" data-ai>${icon('sparkle', 14)} Suggest one</button>` : ''}<button class="btn btn-primary" type="submit">Start</button></div></form>`,
    onOpen(s) {
      const form = s.el.querySelector('#xp');
      s.el.querySelector('[data-ai]')?.addEventListener('click', async (e) => {
        e.target.disabled = true; e.target.textContent = 'Thinking…';
        try { const r = await askJSON({ system: `${CORE_SYSTEM}\n\n${EXPERIMENT}`, user: { context: buildContext({ trigger: 'experiment_design', focus: ['recent'] }) }, schemaName: 'experiment', timeoutMs: 25000 });
          form.hyp.value = r.hypothesis; form.int.value = r.intervention; form.days.value = Math.min(28, Math.max(3, Math.round(r.durationDays || 7))); form.metric.value = r.metric; toast('Suggestion filled in — edit freely'); }
        catch (err) { toast(describeError(err), { tone: 'warn' }); }
        e.target.disabled = false; e.target.textContent = 'Suggest one';
      });
      form.addEventListener('submit', async (e) => { e.preventDefault(); const f = new FormData(form); if (!String(f.get('hyp')).trim()) { s.el.querySelector('#xe').textContent = 'Add a hypothesis.'; return; } s.close(); await commit({ type: 'create_experiment', payload: { hypothesis: f.get('hyp'), intervention: f.get('int'), metric: f.get('metric'), durationDays: Number(f.get('days')) } }, { notify: false }); });
    },
  });
}
