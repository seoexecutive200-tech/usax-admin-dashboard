// Universal capture: deterministic local parser first (no network), AI interpretation only when needed.
import { store } from './store.js';
import { addDays, addMinutes, startOfDay, dayKey, nowISO, safeJSON, clamp, isNum, fmtDate, fmtTime } from './util.js';
import { aiReady, askJSON } from './groq.js';
import { CAPTURE_PARSER, HEALTH_CLASSIFIER } from './prompts.js';

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// ---- date / time parsing ----
export function parseWhen(text, now = new Date()) {
  let date = null; let time = null; const used = [];
  const t = text.toLowerCase();
  const take = (re) => { const m = t.match(re); if (m) used.push(m[0]); return m; };
  let m;
  if ((m = take(/\bday after tomorrow\b/))) date = addDays(startOfDay(now), 2);
  else if ((m = take(/\btomorrow\b/))) date = addDays(startOfDay(now), 1);
  else if ((m = take(/\b(today|tonight|this evening)\b/))) { date = startOfDay(now); if (/tonight|evening/.test(m[0])) time = time || [19, 0]; }
  else if ((m = take(/\bin (\d+) (day|days|week|weeks)\b/))) date = addDays(startOfDay(now), Number(m[1]) * (m[2].startsWith('week') ? 7 : 1));
  else if ((m = take(/\b(?:on )?(?:(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?)\b/))) {
    const day = Number(m[1] || m[4]); const mon = MONTHS.indexOf(m[2] || m[3]);
    let d = new Date(now.getFullYear(), mon, day);
    if (d < startOfDay(now)) d = new Date(now.getFullYear() + 1, mon, day);
    date = d;
  } else if ((m = take(/\b(?:(next|this)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/))) {
    const target = DAYS.findIndex((d) => d.startsWith(m[2].slice(0, 3)));
    let ahead = (target - now.getDay() + 7) % 7;
    if (ahead === 0) ahead = 7;
    if (m[1] === 'next' && ahead < 7 && target > now.getDay()) ahead += 0;
    date = addDays(startOfDay(now), ahead);
    date.__sameWeekdayToday = (target === now.getDay());
  }
  let rel = null;
  if ((m = take(/\bin (\d+(?:\.\d+)?)\s*(min|mins|minutes|hour|hours|hr|hrs)\b/))) rel = addMinutes(now, Number(m[1]) * (m[2].startsWith('h') ? 60 : 1));
  else if ((m = take(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/))) {
    let h = Number(m[1]) % 12; if (m[3] === 'pm') h += 12; time = [h, Number(m[2] || 0)];
  } else if ((m = take(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/))) time = [Number(m[1]), Number(m[2])];
  else if ((m = take(/\bat (\d{1,2})\b/))) { let h = Number(m[1]); if (h >= 1 && h <= 7) h += 12; time = [h, 0]; }
  else if ((m = take(/\bnoon\b/))) time = [12, 0];
  else if ((m = take(/\bmidnight\b/))) time = [23, 59];
  if (rel) return { date: rel, hasDate: true, hasTime: true, used };
  if (!date && time) {
    const d = startOfDay(now); d.setHours(time[0], time[1]);
    date = d <= now ? addDays(d, 1) : d;
    return { date, hasDate: false, hasTime: true, used };
  }
  if (date && time) { date.setHours(time[0], time[1]); }
  return { date, hasDate: !!date, hasTime: !!time, used };
}

// ---- health triage (local guard first; never diagnoses) ----
const EMERGENCY = /chest pain|can'?t breathe|cannot breathe|trouble breathing|shortness of breath|suicid|kill myself|end my life|want to die|overdose|stroke|seizure|unconscious|severe bleeding|passed out|faint(ed|ing)|heart attack|self[- ]harm|hurt myself/i;
const URGENT = /blood in|worst headache|numbness|vision loss|high fever|can'?t keep .* down|severe pain|sudden weakness/i;
const MILD = /\b(pain|ache|aching|dizzy|nausea|nauseous|fever|headache|migraine|palpitation|swelling|rash|cough|sick|injur\w+|sore throat|vomit\w*)\b/i;
export function localHealthClass(text) {
  if (EMERGENCY.test(text)) return 'emergency_action_recommended';
  if (URGENT.test(text)) return 'urgent_real_world_evaluation_recommended';
  if (MILD.test(text)) return 'maybe';
  return 'lifestyle_context_only';
}
export async function classifyHealth(text) {
  const local = localHealthClass(text);
  if (local !== 'maybe') return { class: local, source: 'local' };
  if (aiReady()) {
    try {
      const r = await askJSON({ system: HEALTH_CLASSIFIER, user: { entry: text.slice(0, 400) }, schemaName: 'health', timeoutMs: 12000 });
      return { class: r.class, source: 'ai' };
    } catch { /* fall through to cautious local default */ }
  }
  return { class: 'lifestyle_context_only', source: 'local' };
}

// ---- clause parsers ----
const num = (s) => Number(String(s).replace(/,/g, ''));
const MOOD_WORDS = { great: 9, amazing: 9, happy: 8, good: 7, fine: 6, okay: 5, ok: 5, meh: 4, low: 3, sad: 3, bad: 3, awful: 2, terrible: 2 };
const WORK_KIND = [[/walk/, 'walk'], [/\b(ran|run|jog)/, 'run'], [/cycl|bik/, 'cycling'], [/swim/, 'swim'], [/yoga/, 'yoga'], [/hik/, 'hike'], [/gym|lift|weights/, 'strength'], [/workout|worked out|exercise/, 'workout']];
const EVENT_WORDS = /\b(meeting|meet|call|zoom|interview|appointment|dentist|doctor|deadline|due|flight|trip|dinner|lunch|party|presentation|demo|review|class|exam|standup|catch[- ]?up|session)\b/i;

function cand(type, summary, fields, confidence, extra = {}) {
  return { type, summary, fields, confidence, needsConfirmation: confidence < 0.8, clarification: '', source: 'local', ...extra };
}
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function parseClause(raw, now) {
  const text = raw.trim(); if (!text) return null;
  const t = text.toLowerCase();
  let m;

  // explicit memory / goal / task commands
  if ((m = text.match(/^(?:please\s+)?(?:remember(?: that)?|note that)[:,]?\s+(.+)/i))) return cand('memory', `Remember: ${m[1]}`, { text: m[1], kind: 'explicit_fact' }, 0.92, { explicit: true });
  if ((m = text.match(/^(?:i (?:prefer|usually|always|like|love|hate|don'?t like|dislike)\b.*)$/i))) return cand('memory', `Remember: ${text}`, { text: cap1(text), kind: 'explicit_preference' }, 0.7);
  if ((m = text.match(/^(?:my )?goal(?: is)?[:,]?\s+(.+)/i)) || (m = text.match(/^i want to\s+(.+)/i))) return cand('goal', `Goal: ${cap1(m[1])}`, { title: cap1(m[1]) }, 0.8);

  // numeric scales
  if ((m = t.match(/\b(mood|energy|stress(?:ed)?|focus|anxious|anxiety)\b[^0-9]{0,20}(\d{1,2})(?:\s*(?:\/|out of)\s*10)?/)) || (m = t.match(/\b(\d{1,2})\s*(?:\/|out of)\s*10\b.*\b(mood|energy|stress(?:ed)?|focus)\b/)) ) {
    const swapped = /^\d/.test(m[1]); const kindWord = swapped ? m[2] : m[1]; const v = Number(swapped ? m[1] : m[2]);
    const logType = kindWord.startsWith('stress') || kindWord.startsWith('anx') ? 'stress' : kindWord;
    if (v >= 1 && v <= 10) return cand('log', `${cap1(logType)} ${v}/10`, { logType, value: v, unit: '/10', detail: '' }, 0.93);
  }
  // sleep
  if (/\b(slept|sleep|sleeping)\b/.test(t) && (m = t.match(/(\d{1,2})\s*h(?:ours?|rs?)?\s*(\d{1,2})?\s*(?:m|min)?|(\d{1,2}(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)\b|\b(\d{1,2}(?:\.\d+)?)\b/))) {
    const hrs = m[1] ? Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0) : Number(m[3] || m[4]);
    const q = t.match(/quality\s*(\d)(?:\s*\/\s*5)?/);
    if (hrs > 0 && hrs <= 16) return cand('log', `Slept ${Math.round(hrs * 10) / 10} h`, { logType: 'sleep', value: Math.round(hrs * 100) / 100, unit: 'h', detail: '', meta: q ? { quality: clamp(Number(q[1]), 1, 5) } : {} }, 0.9);
  }
  // water
  if ((m = t.match(/(\d+(?:\.\d+)?)\s*(ml|l|litres?|liters?|glass(?:es)?|cups?|bottles?)\b/)) && /water|drank|hydrat/.test(t)) {
    const q = Number(m[1]); const u = m[2];
    const ml = u === 'ml' ? q : /^l|^lit/.test(u) ? q * 1000 : u.startsWith('glass') ? q * 250 : u.startsWith('cup') ? q * 240 : q * 500;
    return cand('log', `Water ${Math.round(ml)} ml`, { logType: 'water', value: Math.round(ml), unit: 'ml', detail: '' }, 0.92);
  }
  if (/\bwater\b/.test(t) && /\b(glass|cup|bottle)\b/.test(t)) return cand('log', 'Water 250 ml', { logType: 'water', value: 250, unit: 'ml', detail: '' }, 0.7);
  // steps
  if ((m = t.match(/(\d[\d,]*)\s*steps\b/))) return cand('log', `${num(m[1])} steps`, { logType: 'steps', value: num(m[1]), unit: 'steps', detail: '' }, 0.9);
  // expense / income
  if ((m = t.match(/\b(?:paid|spent|bought|expense|pay|cost)\b[^0-9]*?(\d[\d,]*(?:\.\d+)?)\s*(?:k\b)?\s*(?:for|on)?\s*(.*)/))) {
    const amount = num(m[1]); const label = (m[2] || '').trim() || 'Expense';
    return cand('finance_entry', `Expense ${amount} · ${cap1(label)}`, { kind: 'expense', amount, label: cap1(label), category: /emi|loan|rent|bill|insurance/i.test(label) ? 'obligation' : 'general' }, 0.88);
  }
  if ((m = t.match(/\b(?:received|earned|got paid|salary|income)\b[^0-9]*?(\d[\d,]*(?:\.\d+)?)/))) return cand('finance_entry', `Income ${num(m[1])}`, { kind: 'income', amount: num(m[1]), label: 'Income', category: 'income' }, 0.8);

  // workout
  const wk = WORK_KIND.find(([re]) => re.test(t));
  if (wk && !EVENT_WORDS.test(t) && !/\b(tomorrow|next|friday|monday|tuesday|wednesday|thursday|saturday|sunday)\b/.test(t)) {
    const dm = t.match(/(\d+(?:\.\d+)?)\s*(min|mins|minutes|hour|hours|hr|hrs|h)\b/);
    const km = t.match(/(\d+(?:\.\d+)?)\s*(km|k|miles?|mi)\b/);
    const mins = dm ? Number(dm[1]) * (/^h/.test(dm[2]) ? 60 : 1) : null;
    const kindName = wk[1];
    if (mins) return cand('log', `${cap1(kindName)} ${Math.round(mins)} min`, { logType: 'workout', value: Math.round(mins), unit: 'min', detail: kindName, meta: { kind: kindName, ...(km ? { distance: `${km[1]} ${km[2]}` } : {}) } }, 0.9);
    return cand('log', `${cap1(kindName)}`, { logType: 'workout', value: 30, unit: 'min', detail: kindName, meta: { kind: kindName } }, 0.55, { clarification: 'How many minutes? I used 30 as a placeholder.' });
  }
  // outdoor
  if ((m = t.match(/(?:outside|outdoors?)\b.*?(\d+)\s*(min|minutes|hour|hours|hr)/))) return cand('log', `Outdoors ${m[1]} ${m[2]}`, { logType: 'outdoor', value: Number(m[1]) * (m[2].startsWith('h') ? 60 : 1), unit: 'min', detail: '' }, 0.85);
  // event / task (needs structure)
  const when = parseWhen(text, now);
  if (/^(?:todo|task|remind me to|remember to|need to|i need to|i must|i should)\b/i.test(text)) {
    const title = cap1(text.replace(/^(todo|task|remind me to|remember to|need to|i need to|i must|i should)[:,]?\s*/i, '').replace(new RegExp(when.used.map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') || '$^', 'gi'), '').replace(/\s+(on|by|at|for)\s*$/i, '').trim());
    return cand('task', `Task: ${title}`, { title, due: when.date ? when.date.toISOString() : '' }, 0.85);
  }
  if (EVENT_WORDS.test(text) || (when.hasDate && when.hasTime)) {
    let title = text;
    when.used.forEach((u) => { title = title.replace(new RegExp(u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ''); });
    title = cap1(title.replace(/\b(on|at|for|by)\s*$/i, '').replace(/\s{2,}/g, ' ').replace(/^(schedule|add|set up|book)\s+/i, '').trim()) || 'Event';
    const type = /interview|appointment|dentist|doctor/i.test(text) ? 'appointment' : /deadline|due/i.test(text) ? 'deadline' : /zoom|call|video/i.test(text) ? 'video_call' : /flight|trip/i.test(text) ? 'travel' : /dinner|lunch|party/i.test(text) ? 'social' : 'meeting';
    const dur = { meeting: 60, video_call: 30, appointment: 45, deadline: 0, travel: 120, social: 90 }[type];
    const importance = /important|big|critical|client|interview|presentation|exam|deadline|board|investor/i.test(text) ? 'high' : 'normal';
    let start = when.date;
    let clarification = '';
    if (!start) { start = new Date(startOfDay(now).getTime() + 86400000); start.setHours(9, 0); clarification = 'No date found. I assumed tomorrow at 9:00 - please check.'; }
    else if (!when.hasTime) { start.setHours(9, 0); clarification = 'No time found. I assumed 9:00 - please check.'; }
    if (when.date?.__sameWeekdayToday) { /* bare weekday on same weekday means next week */ }
    const end = dur ? addMinutes(start, dur) : start;
    const f = { title, type, start: start.toISOString(), end: end.toISOString(), importance, location: '', notes: '' };
    return cand('event', `${title} · ${fmtDate(start, { weekday: 'short', day: 'numeric', month: 'short' })} ${fmtTime(start)}`, f, clarification ? 0.55 : 0.88, { clarification, needsConfirmation: true });
  }
  // meals / caffeine
  if ((m = t.match(/\b(breakfast|lunch|dinner|snack|ate|meal)\b/))) return cand('log', `Meal: ${cap1(text)}`, { logType: 'meal', value: 1, unit: 'meal', detail: text, meta: { meal: m[1] } }, 0.8);
  if ((m = t.match(/(\d+)?\s*(coffee|coffees|tea|espresso|cups? of coffee)/))) return cand('log', `Caffeine ${m[1] || 1}`, { logType: 'caffeine', value: Number(m[1] || 1), unit: 'cups', detail: m[2] }, 0.75);
  // word-based mood / energy / stress without number -> ask
  if ((m = t.match(/\b(?:feeling|feel|i'?m|im)\s+(?:so |very |really )?(great|amazing|happy|good|fine|okay|ok|meh|low|sad|bad|awful|terrible|stressed|tired|exhausted|anxious|energi[sz]ed|calm)\b/))) {
    const w = m[1];
    if (/stressed|anxious/.test(w)) return cand('log', 'Stress (needs a number)', { logType: 'stress', value: 7, unit: '/10', detail: text }, 0.5, { clarification: 'How stressed, 1-10? Adjust before saving.' });
    if (/tired|exhausted/.test(w)) return cand('log', 'Energy (needs a number)', { logType: 'energy', value: 3, unit: '/10', detail: text }, 0.5, { clarification: 'How is your energy, 1-10? Adjust before saving.' });
    if (/energi|calm/.test(w)) return cand('log', 'Energy (needs a number)', { logType: 'energy', value: 8, unit: '/10', detail: text }, 0.5, { clarification: 'How is your energy, 1-10? Adjust before saving.' });
    return cand('log', 'Mood (needs a number)', { logType: 'mood', value: MOOD_WORDS[w] ?? 6, unit: '/10', detail: text }, 0.5, { clarification: 'How is your mood, 1-10? Adjust before saving.' });
  }
  return null;
}

export function parseLocal(text, now = new Date()) {
  const clauses = text.split(/[;\n]+|\s\+\s/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const c of clauses) {
    const sep = c.includes(',') ? /,\s*/ : /\s+and\s+/i;
    const parts = c.split(sep);
    if (parts.length > 1) {
      const sub = parts.map((p) => parseClause(p, now));
      if (sub.every((x) => x && x.type !== 'event')) { out.push(...sub); continue; }
    }
    let parsed = parseClause(c, now);
    if (!parsed) parsed = cand('note', `Note: ${c.slice(0, 80)}`, { text: c }, 0.6, { fallback: true });
    out.push(parsed);
  }
  return out;
}

// ---- AI interpretation (only when local parse is only a fallback note, or the user asks) ----
export async function parseWithAI(text, now = new Date()) {
  const r = await askJSON({
    system: CAPTURE_PARSER,
    user: { input: text.slice(0, 600), now: now.toISOString(), timezone: store.profile().timezone },
    schemaName: 'capture', timeoutMs: 20000,
  });
  const out = [];
  for (const c of r.candidates || []) {
    const f = safeJSON(c.fieldsJson, null); if (!f) continue;
    const base = { type: c.type, summary: c.summary || c.type, confidence: clamp(Number(c.confidence) || 0.6, 0, 1), needsConfirmation: true, clarification: c.clarification || '', source: 'ai' };
    if (c.type === 'log') {
      if (!f.logType) continue;
      out.push({ ...base, fields: { logType: f.logType, value: Number(f.value), unit: f.unit || '', detail: f.detail || '', ts: f.ts || nowISO() } });
    } else if (c.type === 'event') {
      const s = new Date(f.start); if (isNaN(s)) continue;
      const e = addMinutes(s, Number(f.durationMin) || 60);
      out.push({ ...base, fields: { title: String(f.title || text).slice(0, 120), type: f.type || 'meeting', start: s.toISOString(), end: e.toISOString(), importance: f.importance || 'normal', location: f.location || '', notes: '' } });
    } else if (c.type === 'task') out.push({ ...base, fields: { title: String(f.title || text).slice(0, 160), due: f.due && !isNaN(new Date(f.due)) ? new Date(f.due).toISOString() : '' } });
    else if (c.type === 'goal') out.push({ ...base, fields: { title: String(f.title || text).slice(0, 160) } });
    else if (c.type === 'memory') out.push({ ...base, fields: { text: String(f.text || text).slice(0, 300), kind: f.kind || 'explicit_fact' } });
    else if (c.type === 'finance_entry') out.push({ ...base, fields: { kind: f.kind === 'income' ? 'income' : 'expense', amount: Number(f.amount) || 0, label: f.label || 'Entry', category: f.category || 'general' } });
    else out.push({ ...base, type: 'note', fields: { text: String(f.text || text).slice(0, 600) } });
  }
  return out;
}

// Low-risk, obvious, explicitly-typed logs may be auto-saved with Undo.
export const isAutoSave = (c) => c.confidence >= 0.8 && (c.type === 'log' || c.type === 'finance_entry' || c.fields?.kind === 'explicit_fact' && c.explicit) && !c.clarification;

export function candidateToAction(c) {
  const f = c.fields;
  switch (c.type) {
    case 'log': return { type: 'create_log', payload: { ...f } };
    case 'finance_entry': return { type: 'create_log', payload: { logType: f.kind === 'income' ? 'income' : 'expense', value: f.amount, unit: '', detail: f.label, meta: { category: f.category, label: f.label } } };
    case 'event': return { type: 'create_event', payload: { ...f } };
    case 'task': return { type: 'create_task', payload: { ...f } };
    case 'goal': return { type: 'create_goal', payload: { ...f } };
    case 'memory': return { type: 'add_memory', payload: { ...f } };
    default: return { type: 'create_log', payload: { logType: 'note', value: null, unit: '', detail: f.text } };
  }
}
export const isNumberish = isNum;
export { dayKey };
