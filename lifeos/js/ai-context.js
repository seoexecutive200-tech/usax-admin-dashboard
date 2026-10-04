// Context Builder: selects only what is relevant to the trigger/question. Never sends private memories,
// raw note text, or the API key. Numbers are pre-computed locally.
import { store } from './store.js';
import * as A from './analytics.js';
import { usableMemories } from './memory.js';
import { dayKey, addDays, hoursUntil, round } from './util.js';

const iso = (d = new Date()) => {
  const off = -d.getTimezoneOffset(); const sign = off >= 0 ? '+' : '-';
  const p = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00${sign}${p(off / 60)}:${p(off % 60)}`;
};

export function buildContext({ trigger = 'user_question', eventId = null, focus = [] } = {}) {
  const now = new Date(); const s = store.settings(); const profile = store.profile();
  const st = A.currentState(now); const cap = A.capacity(now);
  const upcoming = A.activeEvents()
    .filter((e) => new Date(e.start) > now && hoursUntil(e.start, now) < 24 * 7 && e.status !== 'completed')
    .sort((a, b) => a.start.localeCompare(b.start)).slice(0, 5)
    .map((e) => ({
      id: e.id, title: e.title, type: e.type, startsInHours: round(hoursUntil(e.start, now), 1), importance: e.importance,
      prepProgress: round(A.prepRatio(e), 2), ...(e.id === eventId ? { notes: (e.notes || '').slice(0, 400), checklist: (e.checklist || []).map((c) => ({ text: c.text, done: c.done })) } : {}),
    }));
  const patterns = A.patterns(60).filter((p) => p.confidence !== 'Low').slice(0, 4)
    .map((p) => ({ text: p.text, evidenceCount: p.n, confidence: p.confValue }));
  const goals = store.all('goals').filter((g) => g.status !== 'done').slice(0, 5).map((g) => g.title);
  const mem = usableMemories().slice(0, 12).map((m) => ({ kind: m.kind, text: m.text, confidence: m.confidence }));
  const ctx = {
    now: iso(now), timezone: profile.timezone, name: profile.name || undefined,
    currentState: { energy: st.energy, mood: st.mood, stress: st.stress, sleepHours: st.sleepHours, focus: st.focus, water: st.water },
    capacity: { overall: round(cap.overall, 2), physical: round(cap.physical, 2), mental: round(cap.mental, 2), todayLoad: round(cap.load, 2) },
    baselines: {
      sleep7d: round(A.baseline('sleep', 7), 1), sleep30d: round(A.baseline('sleep', 30), 1), energy30d: round(A.baseline('energy', 30), 1),
      stress30d: round(A.baseline('stress', 30), 1), mood30d: round(A.baseline('mood', 30), 1),
    },
    daysOfData: A.totalDaysWithData(),
    upcoming, futureLoad: A.futureLoad(7).map((d) => ({ date: d.key, level: d.level })),
    relevantPatterns: patterns, goals, memories: mem,
    priorities: [...profile.priorities].sort((a, b) => b.weight - a.weight).slice(0, 4).map((p) => p.label),
    advisorPreferences: { mode: s.advisorMode, quietHours: s.quietHours },
    trigger,
  };
  if (focus.includes('recent')) {
    ctx.recentDays = Array.from({ length: 7 }, (_, i) => {
      const k = dayKey(addDays(now, -i));
      return { date: k, sleep: A.dailyValue('sleep', k), mood: A.dailyValue('mood', k), energy: A.dailyValue('energy', k), stress: A.dailyValue('stress', k) };
    });
  }
  return JSON.parse(JSON.stringify(ctx, (k, v) => (v === null || v === undefined ? undefined : v)));
}
