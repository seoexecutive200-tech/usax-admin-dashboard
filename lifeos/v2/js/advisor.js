// The proactive advisor: local trigger gate + attention budget decide IF the model is needed at all.
// Most user actions never reach the API. "Silent" is a first-class outcome.
import { store } from './store.js';
import * as A from './analytics.js';
import { aiReady, askJSON, AIError, retryAfterMs } from './groq.js';
import { buildContext } from './ai-context.js';
import { CORE_SYSTEM, PROACTIVE_DECISION, ACTION_GUIDE, WHAT_IF, FINANCE_TRADEOFF, FEEDBACK_LEARNING } from './prompts.js';
import { weekKey, dayKey, hoursUntil, fmtRelative, fmtTime, fmtDate, round, nowISO, addDays, inQuietHours, debounce, partOfDay } from './util.js';
import { addMemory } from './memory.js';

const BUDGET = { quiet: 1, balanced: 3, active: 5 };
const COOLDOWN_H = { upcoming: 12, capacity: 18, load: 24, goal: 48, conflict: 12, friction: 72, pattern: 168, life_change: 168, report_daily: 20, report_weekly: 120 };
const AI_DAILY_CAP = 12;
const AI_MIN_GAP_MS = 10 * 60 * 1000;
let running = false; let pending = false; let retryTimer = null;
const listeners = new Set();
export const onAdvisorChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = () => listeners.forEach((f) => f());
export const lastAdvisorError = { message: '' };

const ev = (kind, text) => ({ kind, text });

function candidates(now = new Date()) {
  const out = []; const s = store.settings();
  const cap = A.capacity(now); const today = dayKey(now);
  const n = A.totalDaysWithData();

  // 1. upcoming time-sensitive commitments
  const next = A.nextImportantEvent(now);
  if (next) {
    const r = A.readiness(next, now); const h = hoursUntil(next.start, now);
    if (h <= 72 && (r.parts.preparation < 0.7 || r.overall < 0.6)) {
      const open = (next.checklist || []).find((c) => !c.done);
      const stressy = cap.stress >= 7;
      out.push({
        key: `upcoming:${next.id}:${today}`, kind: 'upcoming', priority: 1, trigger: stressy ? 'high_stress_plus_important_event' : 'important_event_prep', eventId: next.id,
        localMessage: `“${next.title}” is ${fmtRelative(next.start, now)} and preparation looks ${Math.round(r.parts.preparation * 100)}% done${stressy ? `, with stress at ${cap.stress}/10 today` : ''}. The smallest useful step: ${open ? `“${open.text}”` : 'a focused 30–45 minute prep block'}.`,
        evidence: [ev('observed', `Event starts ${fmtRelative(next.start, now)} (${next.importance} importance).`), ev('calculated', `Preparation ${Math.round(r.parts.preparation * 100)}%, readiness summary ${Math.round(r.overall * 100)}%.`), ...(stressy ? [ev('observed', `Stress logged at ${cap.stress}/10 today.`)] : []), ev('unknown', 'Readiness is an app summary, not a prediction of how it will go.')],
        confidence: n >= 14 ? 0.75 : 0.55, uncertainty: n >= 14 ? 'Based on your logs and schedule.' : 'Little history so far, so this leans on schedule facts.',
        primaryAction: open ? `Do: ${open.text}` : 'Block a 30–45 minute prep window', secondaryOptions: ['Open readiness details'], link: `#/readiness/${next.id}`,
      });
    }
  }
  // 2. capacity / recovery
  if (cap.lowCapacity && s.minimalDay !== today && n >= 3) {
    out.push({
      key: `capacity:${today}`, kind: 'capacity', priority: 2, trigger: 'major_state_deviation',
      localMessage: `Your capacity looks lower than usual today (sleep ${round(cap.lastSleep, 1)}h vs your usual ${round(cap.sleepBase, 1)}h, load ${A.loadLevel(cap.load)}). Want a gentler, essentials-only day? You can switch it on from here.`,
      evidence: [ev('observed', `Sleep ${round(cap.lastSleep, 1)}h; usual ${round(cap.sleepBase, 1)}h.`), ev('calculated', `Overall capacity summary ${Math.round(cap.overall * 100)}%.`), ev('inference', 'Fewer commitments may protect energy later in the week.')],
      confidence: 0.6, uncertainty: 'Capacity is a summary of your own inputs, not a medical score.', primaryAction: 'Switch to an essentials-only day', secondaryOptions: ['Keep the full plan'], offer: 'minimal_day',
    });
  }
  // 2b. protected recovery before a heavy day
  const fl = A.futureLoad(4, now);
  const peak = fl.slice(1).find((d) => d.level === 'peak' || d.level === 'heavy');
  if (peak && fl[0].value < 0.6 && n >= 3) {
    out.push({
      key: `load:${peak.key}`, kind: 'load', priority: 2, trigger: 'future_load_peak',
      localMessage: `${fmtDate(peak.date, { weekday: 'long' })} looks ${peak.level} (${peak.count} items). Leaving some deliberate empty space before it, and avoiding adding more that day, would protect your recovery.`,
      evidence: [ev('calculated', `${fmtDate(peak.date, { weekday: 'long' })} schedule load: ${peak.level}.`), ev('inference', 'Free time on a heavy day is not automatically usable capacity.')],
      confidence: 0.6, uncertainty: 'Load estimates come from event length and importance only.', primaryAction: 'Keep the evening before open', secondaryOptions: [], link: '#/plan',
    });
  }
  // 3. goals
  for (const g of store.all('goals').filter((x) => x.status !== 'done' && x.metric)) {
    const gp = A.goalProgress(g); const dow = (now.getDay() + 6) % 7;
    if (gp && dow >= 3 && gp.pct < 0.5 && cap.overall >= 0.5) {
      out.push({
        key: `goal:${g.id}:${Math.floor(now.getTime() / (86400000 * 3))}`, kind: 'goal', priority: 3, trigger: 'goal_pace',
        localMessage: `Your goal “${g.title}” is at ${Math.round(Math.min(1, gp.pct) * 100)}% for this week. If it still matters, one small step today would help — or tell me it has changed.`,
        evidence: [ev('calculated', `${round(gp.current, 1)} ${gp.unit} vs target ${g.target}.`)], confidence: 0.6, uncertainty: 'Goals can change; tell me if this one no longer fits.', primaryAction: 'Take one small step today', secondaryOptions: ['This goal has changed'], link: '#/you',
      });
    }
  }
  // 4. preventable conflicts
  const cf = A.conflicts(now, 5)[0];
  if (cf) {
    out.push({
      key: `conflict:${cf[0].id}:${cf[1].id}`, kind: 'conflict', priority: 4, trigger: 'schedule_conflict',
      localMessage: `“${cf[0].title}” (${fmtTime(cf[0].start)}) overlaps with “${cf[1].title}” (${fmtTime(cf[1].start)}) on ${fmtDate(cf[0].start, { weekday: 'long' })}. One of them may need a new time.`,
      evidence: [ev('observed', 'Two scheduled items overlap.')], confidence: 0.95, uncertainty: 'Maybe the overlap is intentional.', primaryAction: 'Reschedule one of them', secondaryOptions: [], link: '#/plan',
    });
  }
  // 5. friction & life change & patterns
  const fr = A.frictionItems()[0];
  if (fr) {
    out.push({
      key: `friction:${fr.title.toLowerCase()}`, kind: 'friction', priority: 5, trigger: 'repeated_friction', question: true, frictionTitle: fr.title,
      localMessage: `“${fr.title}” has been moved or skipped ${fr.count} times lately. Is it about timing, difficulty, relevance, or has your goal changed?`,
      evidence: [ev('observed', `${fr.count} reschedules/skips in the last 30 days.`)], confidence: 0.6, uncertainty: 'This is a question, not a judgement.', primaryAction: 'Tell me what is getting in the way', secondaryOptions: [],
    });
  }
  const lc = A.lifeChange();
  if (lc && !s.baselineStart) {
    out.push({
      key: `life_change:${lc.metric}:${today.slice(0, 7)}`, kind: 'life_change', priority: 5, trigger: 'life_change', offer: 'new_baseline',
      localMessage: `${lc.detail} If your routine has genuinely changed, I can start a fresh baseline instead of comparing you with an old period.`,
      evidence: [ev('calculated', lc.detail)], confidence: 0.6, uncertainty: 'It could also be a short-term blip.', primaryAction: 'Start a new baseline from today', secondaryOptions: ['It’s temporary'],
    });
  }
  const pat = A.patterns(60).find((p) => p.confidence === 'High');
  if (pat) {
    out.push({
      key: `pattern:${pat.id}`, kind: 'pattern', priority: 5, trigger: 'pattern_found',
      localMessage: `A pattern has shown up: ${pat.text} It’s an association, not a proven cause.`,
      evidence: [ev('calculated', `${pat.n} observed days, ${pat.confidence.toLowerCase()} confidence.`)], confidence: pat.confValue, uncertainty: 'Correlation only; other factors may be involved.', primaryAction: 'Keep an eye on it', secondaryOptions: [], link: '#/insights',
    });
  }
  // 6. reports
  const hour = now.getHours();
  if (hour >= 19 && !store.get('reports', `daily:${today}`) && A.logsOnDay(today) && Object.keys(A.logsOnDay(today)).length) {
    out.push({ key: `report_daily:${today}`, kind: 'report_daily', priority: 6, trigger: 'end_of_day_report', localMessage: 'Your day-in-review is ready to generate whenever you want it.', evidence: [], confidence: 0.7, uncertainty: '', primaryAction: 'Open your daily report', secondaryOptions: [], link: '#/insights', report: 'daily' });
  }
  if (((now.getDay() === 0 && hour >= 17) || (now.getDay() === 1 && hour < 12)) && !store.get('reports', `weekly:${weekKey(now)}`)) {
    out.push({ key: `report_weekly:${Math.floor(now.getTime() / (86400000 * 6))}`, kind: 'report_weekly', priority: 6, trigger: 'weekly_report', localMessage: 'Your weekly story is ready to generate.', evidence: [], confidence: 0.7, uncertainty: '', primaryAction: 'Open your weekly report', secondaryOptions: [], link: '#/insights', report: 'weekly' });
  }
  // Blank-canvas mode: only the user's own schedule (events/tasks) drives suggestions — no built-in wellness heuristics.
  const custom = store.settings().mode === 'custom';
  return out.filter((c) => !custom || ['upcoming', 'conflict', 'friction'].includes(c.kind)).sort((a, b) => a.priority - b.priority);
}

const items = () => store.all('advisorItems');
const suppressed = (kind) => { const until = store.settings().dismissed?.[kind]; return until && new Date(until) > new Date(); };

function gate(cands, now) {
  const s = store.settings(); const mode = s.advisorMode;
  const todayCount = items().filter((i) => i.dayKey === dayKey(now) && i.decision !== 'silent' && i.decision !== 'urgent_escalation' && i.source !== 'user').length;
  for (const c of cands) {
    const recent = items().find((i) => i.key === c.key && (Date.now() - new Date(i.createdAt)) < (COOLDOWN_H[c.kind] || 24) * 3600000);
    if (recent) continue;
    if (suppressed(c.kind)) continue;
    if (mode === 'quiet' && c.priority > 2) continue;
    if (c.priority >= 6 && mode !== 'active' && partOfDay(now) !== 'evening' && c.kind === 'report_daily') continue;
    if (inQuietHours(now, s.quietHours)) continue;
    if (todayCount >= BUDGET[mode]) continue;
    return c;
  }
  return null;
}

async function saveItem(c, data) {
  return store.save('advisorItems', {
    key: c.key, kind: c.kind, dayKey: dayKey(), priority: c.priority, status: 'active', feedback: null, outcome: null, eventId: c.eventId || null,
    link: c.link || null, offer: c.offer || null, report: c.report || null, question: !!c.question, frictionTitle: c.frictionTitle || null,
    expiresAt: addDays(new Date(), c.kind === 'upcoming' ? 1 : 2).toISOString(), ...data,
  });
}
const localData = (c) => ({ decision: c.question ? 'ask_quick_question' : 'suggest', message: c.localMessage, evidence: c.evidence || [], confidence: c.confidence, uncertainty: c.uncertainty || '', primaryAction: c.primaryAction || '', secondaryOptions: c.secondaryOptions || [], proposedActions: [], source: 'local', reason: c.trigger });

export async function evaluate(reason = 'app_open') {
  if (running) { pending = true; return; }
  running = true;
  try {
    const now = new Date(); const cands = candidates(now); const c = gate(cands, now);
    if (!c) return;
    const s = store.settings();
    const aiToday = items().filter((i) => i.source === 'ai' && i.dayKey === dayKey(now)).length;
    const last = items().filter((i) => i.source === 'ai').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const canAI = aiReady() && s.aiEnabled && aiToday < AI_DAILY_CAP && (!last || Date.now() - new Date(last.createdAt) > AI_MIN_GAP_MS || c.priority <= 1) && !c.report && retryAfterMs() === 0;
    if (!canAI) { await saveItem(c, localData(c)); lastAdvisorError.message = ''; return; }
    try {
      const r = await askJSON({
        system: `${CORE_SYSTEM}\n\n${PROACTIVE_DECISION}\n\n${ACTION_GUIDE}`,
        user: { context: buildContext({ trigger: c.trigger, eventId: c.eventId }), candidate: { kind: c.kind, facts: c.evidence, draft: c.localMessage } },
        schemaName: 'advisor', timeoutMs: 25000,
      });
      lastAdvisorError.message = '';
      if (r.decision === 'silent') { await saveItem(c, { ...localData(c), decision: 'silent', message: '', source: 'ai' }); return; }
      await saveItem(c, { ...localData(c), ...r, message: r.message || c.localMessage, source: 'ai', proposedActions: (r.proposedActions || []).slice(0, 3) });
    } catch (e) {
      if (e instanceof AIError && e.kind === 'rate') {
        lastAdvisorError.message = 'AI is rate limited; showing a local suggestion.';
        clearTimeout(retryTimer); retryTimer = setTimeout(() => evaluate('rate_limit_retry'), Math.max(5000, (e.retryAfter || 10) * 1000));
      } else lastAdvisorError.message = e instanceof AIError && e.kind !== 'invalid' ? e.message : 'AI insight unavailable - your data is saved.';
      await saveItem(c, localData(c));
    }
  } finally { running = false; changed(); if (pending) { pending = false; setTimeout(() => evaluate('queued'), 500); } }
}
// Debounced hook for meaningful changes only (callers decide; water/checkbox logs never call this).
export const notify = debounce((reason) => evaluate(reason), 1500);

const CUSTOM_KINDS = new Set(['upcoming', 'conflict', 'friction', 'rule', 'safety']);
export function current(now = new Date()) {
  const custom = store.settings().mode === 'custom'; // blank canvas: only the user's own schedule, rules and safety prompts
  return items().filter((i) => i.status === 'active' && i.decision !== 'silent' && (!i.expiresAt || new Date(i.expiresAt) > now) && (!custom || CUSTOM_KINDS.has(i.kind)))
    .sort((a, b) => (a.decision === 'urgent_escalation' ? -1 : 0) - (b.decision === 'urgent_escalation' ? -1 : 0) || a.priority - b.priority || b.createdAt.localeCompare(a.createdAt))[0] || null;
}

export async function escalate(text, cls) {
  const emergency = cls === 'emergency_action_recommended';
  return store.save('advisorItems', {
    key: `urgent:${Date.now()}`, kind: 'safety', dayKey: dayKey(), priority: 0, status: 'active', decision: 'urgent_escalation', source: 'local',
    message: emergency
      ? 'What you wrote may mean you need help right now. Please contact your local emergency services, or reach a crisis line or someone you trust immediately. LifeOS can’t assess this and isn’t a substitute for urgent care.'
      : 'That sounds worth checking with a medical professional soon, especially if it is severe, new or getting worse. LifeOS can’t diagnose or assess symptoms.',
    evidence: [ev('observed', 'Your entry mentioned a possibly concerning symptom.')], confidence: 1, uncertainty: 'LifeOS does not diagnose; this is a safety prompt based on your wording.',
    primaryAction: emergency ? 'Contact emergency services' : 'Consider speaking to a clinician', secondaryOptions: [], proposedActions: [], expiresAt: addDays(new Date(), 1).toISOString(),
  });
}

export async function feedback(id, type) {
  const it = store.get('advisorItems', id); if (!it) return;
  if (type === 'helpful') await store.save('advisorItems', { id, feedback: 'helpful', outcome: 'accepted' });
  else if (type === 'not_now') await store.save('advisorItems', { id, feedback: 'not_now', status: 'dismissed', outcome: 'ignored' });
  else if (type === 'less') {
    await store.save('advisorItems', { id, feedback: 'less', status: 'dismissed', outcome: 'unwanted' });
    await store.setSettings({ dismissed: { ...store.settings().dismissed, [it.kind]: addDays(new Date(), 14).toISOString() } });
    await addMemory({ text: `Prefers fewer suggestions about: ${it.kind.replace(/_/g, ' ')}`, kind: 'preference', source: 'user_explicit', confidence: 0.95, extra: { advisorPreference: true } });
  }
  changed();
}

// Conservative learning from outcomes (prompt 11.12). Local evidence counts only; AI optional, memory-only effects.
export async function learnFromOutcome(summary) {
  if (!aiReady()) return;
  try {
    const r = await askJSON({ system: `${CORE_SYSTEM}\n\n${FEEDBACK_LEARNING}`, user: { outcome: summary, context: buildContext({ trigger: 'feedback_learning' }) }, schemaName: 'feedback', timeoutMs: 15000 });
    for (const u of (r.updates || []).slice(0, 2)) {
      if (u.kind === 'advisor_preference' && u.text) await addMemory({ text: u.text, kind: 'preference', source: 'derived', confidence: 0.5, evidenceCount: Math.max(1, Math.round(u.evidenceDelta || 1)), extra: { advisorPreference: true } });
    }
  } catch { /* learning is best-effort */ }
}

// Explicit user question — the only free-form AI path besides capture fallback and reports.
export async function ask(question, history = []) {
  const q = question.trim();
  const finance = /afford|can i buy|buy a|spend|purchase/i.test(q); const whatIf = /\bwhat if\b|\bif i\b/i.test(q);
  const sys = `${CORE_SYSTEM}\n\n${finance ? FINANCE_TRADEOFF : whatIf ? WHAT_IF : ''}\n\n${ACTION_GUIDE}\nFor a direct user question use decision "observe" and answer it.`;
  const user = { question: q, context: buildContext({ trigger: 'explicit_user_question', focus: ['recent'] }), recentConversation: history.slice(-4) };
  if (finance) user.financeFacts = A.financeSummary();
  return askJSON({ system: sys, user, schemaName: 'advisor', timeoutMs: 30000 });
}

// ---- reminders: not a fixed nagging sequence; re-evaluated against time, progress, state, importance ----
export function reminderBanners(now = new Date()) {
  const out = [];
  for (const e of A.activeEvents()) {
    if (e.status === 'completed' || e.type === 'reminder') continue;
    const h = hoursUntil(e.start, now); if (h < -0.1) continue;
    const prep = A.prepRatio(e);
    if (h <= (e.importance === 'high' ? 0.5 : 0.25)) out.push({ id: `${e.id}:soon`, eventId: e.id, text: `“${e.title}” starts ${fmtRelative(e.start, now)}.`, level: 'soon' });
    else if (e.importance === 'high' && h <= 24 && prep < 0.5) out.push({ id: `${e.id}:prep`, eventId: e.id, text: `“${e.title}” is ${fmtRelative(e.start, now)} and prep is ${Math.round(prep * 100)}% — a quick look might help.`, level: 'prep' });
  }
  return out.filter((b) => !(store.settings().dismissed?.[`banner:${b.id}`]));
}
export function startReminderLoop(onTick) {
  const seen = new Set();
  const tick = () => {
    const banners = reminderBanners();
    onTick(banners);
    if (store.settings().notifications && 'Notification' in window && Notification.permission === 'granted') {
      for (const b of banners) if (!seen.has(b.id)) {
        seen.add(b.id);
        try { new Notification('LifeOS', { body: b.text, tag: b.id, icon: '../assets/icon-192.png' }); } catch { /* some browsers need SW notifications */ }
      }
    }
  };
  tick(); return setInterval(tick, 60000);
}
