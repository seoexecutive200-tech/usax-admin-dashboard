// Daily & weekly reports: always built locally from stored data; AI optionally rewrites the narrative.
import { store } from './store.js';
import * as A from './analytics.js';
import { dayKey, parseKey, addDays, weekKey, nowISO, round, isNum, fmtDate, hoursUntil } from './util.js';
import { aiReady, askJSON } from './groq.js';
import { CORE_SYSTEM, DAILY_REPORT, WEEKLY_REPORT } from './prompts.js';
import { buildContext } from './ai-context.js';

const fmt = (v, d = 1) => (isNum(v) ? String(round(v, d)) : '–');

export function buildDailyLocal(key) {
  const date = parseKey(key); const L = A.logsOnDay(key);
  const base = { sleep: A.baseline('sleep', 30, date), mood: A.baseline('mood', 30, date), energy: A.baseline('energy', 30, date), stress: A.baseline('stress', 30, date) };
  const v = (t) => A.dailyValue(t, key);
  const wins = []; const pressure = [];
  const done = A.activeEvents().filter((e) => dayKey(e.start) === key && e.status === 'completed');
  if (done.length) wins.push(`Completed ${done.length} commitment${done.length > 1 ? 's' : ''}${done[0] ? `, including “${done[0].title}”` : ''}.`);
  if (v('workout') > 0) wins.push(`Moved your body for ${Math.round(v('workout'))} minutes.`);
  if (isNum(v('sleep')) && isNum(base.sleep) && v('sleep') >= base.sleep) wins.push(`Sleep (${fmt(v('sleep'))}h) was at or above your usual ${fmt(base.sleep)}h.`);
  if (v('water') >= 1800) wins.push(`Hydration reached ${Math.round(v('water'))} ml.`);
  if (isNum(v('mood')) && v('mood') >= 7) wins.push(`Mood was on the brighter side (${fmt(v('mood'))}/10).`);
  const load = A.loadForDay(key);
  if (isNum(v('stress')) && isNum(base.stress) && v('stress') >= base.stress + 1.5) pressure.push(`Stress (${fmt(v('stress'))}/10) ran above your usual ${fmt(base.stress)}.`);
  if (load >= 0.6) pressure.push(`The schedule was ${A.loadLevel(load)} (${A.eventsOnDay(key).length} items).`);
  if (isNum(v('sleep')) && isNum(base.sleep) && v('sleep') <= base.sleep - 1) pressure.push(`Sleep (${fmt(v('sleep'))}h) was about ${fmt(base.sleep - v('sleep'))}h under your usual.`);
  // one meaningful deviation
  let deviation = '';
  const devs = ['sleep', 'mood', 'energy', 'stress'].map((t) => ({ t, d: isNum(v(t)) && isNum(base[t]) ? v(t) - base[t] : null })).filter((x) => x.d !== null)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  if (devs[0] && Math.abs(devs[0].d) >= (devs[0].t === 'sleep' ? 0.8 : 1.2)) deviation = `${A.METRIC_LABEL[devs[0].t]} was ${fmt(Math.abs(devs[0].d))}${devs[0].t === 'sleep' ? 'h' : ''} ${devs[0].d > 0 ? 'above' : 'below'} your 30-day average.`;
  const pats = A.patterns(60).filter((p) => p.confidence !== 'Low');
  const pattern = pats[0] ? `${pats[0].text} (${pats[0].n} observed days, ${pats[0].confidence.toLowerCase()} confidence; an association, not a cause.)` : '';
  const tomorrowKey = dayKey(addDays(date, 1)); const tl = A.loadForDay(tomorrowKey);
  const tomorrowFocus = tl >= 0.6 ? 'Tomorrow looks heavy — protecting tonight’s wind-down would help most.'
    : isNum(v('sleep')) && isNum(base.sleep) && v('sleep') < base.sleep - 0.8 ? 'A slightly earlier night could help you recover.'
      : tl < 0.15 ? 'Tomorrow is open — a good chance for something that matters to you.' : 'Keep what is working; nothing needs fixing.';
  const logged = ['sleep', 'mood', 'energy', 'stress', 'water'].filter((t) => L[t]?.length).length;
  const incomplete = logged < 3;
  const char = A.capacity(date).overall;
  const tone = char >= 0.7 ? 'a steady, capable day' : char >= 0.5 ? 'a fairly balanced day' : 'a day with less in the tank';
  const narrative = incomplete && !wins.length && !pressure.length
    ? `Not much was logged for ${fmtDate(date, { weekday: 'long' })}, so this is a light summary. Add a quick check-in whenever it suits you.`
    : `${fmtDate(date, { weekday: 'long' })} looked like ${tone}.${wins[0] ? ` ${wins[0]}` : ''}${pressure[0] ? ` ${pressure[0]}` : ''}${incomplete ? ' (Some data is missing, so this is partial.)' : ''}`;
  return { kind: 'daily', key, narrative, wentWell: wins.slice(0, 3), pressure: pressure.slice(0, 3), deviation, pattern, tomorrowFocus, confidence: incomplete ? 0.4 : 0.7, incomplete, source: 'local' };
}

export async function generateDaily(key = dayKey(), { force = false, useAI = false } = {}) {
  const id = `daily:${key}`; const cached = store.get('reports', id);
  if (cached && !force && (cached.source === 'ai' || !useAI)) return cached;
  let rep = buildDailyLocal(key);
  if (useAI && aiReady()) {
    try {
      const ai = await askJSON({
        system: `${CORE_SYSTEM}\n\n${DAILY_REPORT}`,
        user: { context: buildContext({ trigger: 'end_of_day_report', focus: ['recent'] }), verifiedDay: { ...rep, kind: undefined, source: undefined } },
        schemaName: 'daily', timeoutMs: 30000,
      });
      rep = { ...rep, ...pickAI(ai, ['narrative', 'wentWell', 'pressure', 'deviation', 'pattern', 'tomorrowFocus', 'confidence']), source: 'ai' };
    } catch { /* keep local report */ }
  }
  return store.save('reports', { id, ...rep, generatedAt: nowISO() });
}
const pickAI = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined && o[k] !== '' && !(Array.isArray(o[k]) && !o[k].length)).map((k) => [k, o[k]]));

export function buildWeeklyLocal() {
  const cmp = A.compare(7);
  const trendWord = (t) => { const tr = A.trend(cmp.cur[t].points); return tr.dir === 'up' ? 'trending up' : tr.dir === 'down' ? 'trending down' : tr.dir === 'steady' ? 'steady' : 'not enough data yet'; };
  const imp = cmp.improvement; const pr = cmp.pressure;
  const biggestImprovement = imp ? `${A.METRIC_LABEL[imp.type]} improved: ${fmt(imp.cur)}${imp.type === 'sleep' ? 'h' : ''} vs ${fmt(imp.prev)}${imp.type === 'sleep' ? 'h' : ''} the week before.` : 'No clear improvement stood out this week.';
  const biggestPressure = pr ? `${A.METRIC_LABEL[pr.type]} was the main pressure: ${fmt(pr.cur)}${pr.type === 'sleep' ? 'h' : ''} vs ${fmt(pr.prev)}${pr.type === 'sleep' ? 'h' : ''} the week before.` : 'Nothing stood out as a strong pressure.';
  const rel = A.patterns(60).slice(0, 3).map((p) => `${p.text} (${p.n} days, ${p.confidence.toLowerCase()} confidence)`);
  const fl = A.futureLoad(7); const peak = [...fl].sort((a, b) => b.value - a.value)[0];
  const heavy = fl.filter((d) => d.level === 'heavy' || d.level === 'peak').length;
  const futureLoad = peak && peak.count ? `Next week peaks on ${fmtDate(peak.date, { weekday: 'long' })} (${peak.level}); ${heavy} heavier day${heavy === 1 ? '' : 's'} ahead.` : 'The next seven days look open so far.';
  const focus = heavy >= 2 ? 'Protect sleep and leave recovery space around the heavier days.' : pr ? `Go gently with ${A.METRIC_LABEL[pr.type].toLowerCase()} — small steps are enough.` : 'Keep your current rhythm and notice what helps.';
  const trajectory = `Sleep is ${trendWord('sleep')}, mood is ${trendWord('mood')}, and stress is ${trendWord('stress')}.`;
  const sparse = cmp.cur.logged < 3;
  const narrative = sparse ? 'There is not much data for this week yet, so treat this as a first sketch. A few quick check-ins will make the story richer.'
    : `${trajectory} ${imp ? biggestImprovement : ''} ${pr ? biggestPressure : ''}`.replace(/\s+/g, ' ').trim();
  return {
    kind: 'weekly', key: weekKey(), narrative, trajectory, biggestImprovement, biggestPressure, relationships: rel, futureLoad, nextWeekFocus: focus,
    confidence: sparse ? 0.35 : cmp.cur.logged >= 6 ? 0.75 : 0.55, source: 'local',
    stats: { logged: cmp.cur.logged, days: 7, sleep: round(cmp.cur.sleep.avg, 1), mood: round(cmp.cur.mood.avg, 1), energy: round(cmp.cur.energy.avg, 1), stress: round(cmp.cur.stress.avg, 1) },
  };
}
export async function generateWeekly(key = weekKey(), { force = false, useAI = false } = {}) {
  const id = `weekly:${key}`; const cached = store.get('reports', id);
  if (cached && !force && (cached.source === 'ai' || !useAI)) return cached;
  let rep = buildWeeklyLocal();
  if (useAI && aiReady()) {
    try {
      const cmp = A.compare(7);
      const ai = await askJSON({
        system: `${CORE_SYSTEM}\n\n${WEEKLY_REPORT}`,
        user: {
          context: buildContext({ trigger: 'weekly_report', focus: ['recent'] }),
          aggregates: { thisWeek: rep.stats, rows: cmp.rows.map((r) => ({ metric: r.type, thisWeek: round(r.cur, 1), priorWeek: round(r.prev, 1) })) },
          validatedPatterns: A.patterns(60).slice(0, 5).map((p) => ({ text: p.text, n: p.n, confidence: p.confidence })), localDraft: rep,
        },
        schemaName: 'weekly', timeoutMs: 35000,
      });
      rep = { ...rep, ...pickAI(ai, ['narrative', 'trajectory', 'biggestImprovement', 'biggestPressure', 'relationships', 'futureLoad', 'nextWeekFocus', 'confidence']), source: 'ai' };
    } catch { /* keep local */ }
  }
  return store.save('reports', { id, ...rep, generatedAt: nowISO() });
}

export function reportToMarkdown(r) {
  const L = [];
  if (r.kind === 'weekly') {
    L.push(`# LifeOS weekly report — week of ${r.key}`, '', r.narrative, '', `**Trajectory:** ${r.trajectory}`, `**Biggest improvement:** ${r.biggestImprovement}`, `**Biggest pressure:** ${r.biggestPressure}`);
    if (r.relationships?.length) L.push('', '## Patterns noticed (associations, not causes)', ...r.relationships.map((x) => `- ${x}`));
    L.push('', `**Next week outlook:** ${r.futureLoad}`, `**Suggested focus:** ${r.nextWeekFocus}`);
  } else {
    L.push(`# LifeOS daily report — ${r.key}`, '', r.narrative);
    if (r.wentWell?.length) L.push('', '## What went well', ...r.wentWell.map((x) => `- ${x}`));
    if (r.pressure?.length) L.push('', '## What created pressure', ...r.pressure.map((x) => `- ${x}`));
    if (r.deviation) L.push('', `**Notable deviation:** ${r.deviation}`);
    if (r.pattern) L.push(`**Pattern:** ${r.pattern}`);
    L.push('', `**Tomorrow's focus:** ${r.tomorrowFocus}`);
  }
  L.push('', `_Confidence ${Math.round((r.confidence || 0) * 100)}% · ${r.source === 'ai' ? 'AI-written from local data' : 'built locally'} · estimates, not medical advice._`);
  return L.join('\n');
}
export { hoursUntil };
