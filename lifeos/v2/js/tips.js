// General wellbeing tips and gentle recurring reminders. Plain, widely-known guidance only — never medical advice, never a diagnosis.
// Everything is yours to switch on/off or change; nothing here depends on your logged data.
import { store } from './store.js';
import { dayKey, parseKey } from './util.js';

export const DISCLAIMER = 'General wellbeing information, not medical advice. If you’re worried about your health, talk to a doctor or other professional.';
export const CATEGORIES = { water: 'Hydration', move: 'Movement', eyes: 'Eyes & posture', sleep: 'Sleep', food: 'Food', mind: 'Stress & mind', outdoors: 'Daylight & outdoors', care: 'Health habits' };
export const TIPS = [
  ['water', 'Keep a water bottle where you can see it — sipping through the day is easier than catching up at night.'],
  ['water', 'Tie a glass of water to something you already do, like your morning coffee or sitting down at your desk.'],
  ['water', 'Headaches, tiredness and low focus can sometimes be a sign you need more fluids — a glass of water is an easy first step.'],
  ['water', 'Pale yellow urine is a rough sign of good hydration; much darker usually means you could drink more.'],
  ['move', 'Stand up and move for a minute or two every hour — long stretches of sitting add up.'],
  ['move', 'A 10-minute walk after a meal is an easy way to add movement to your day.'],
  ['move', 'Many health guidelines suggest about 150 minutes of moderate activity a week, such as brisk walking. Start with what feels doable.'],
  ['move', 'Take the stairs, stand during calls, or park a bit farther away — small movement counts.'],
  ['move', 'Roll your shoulders and stretch your neck, wrists and back between tasks.'],
  ['eyes', '20-20-20: every 20 minutes, look at something about 6 metres (20 feet) away for 20 seconds.'],
  ['eyes', 'Place your screen at arm’s length with the top at or just below eye level, and keep your shoulders relaxed.'],
  ['eyes', 'Blink fully and often when you’re on a screen — dry, tired eyes are common with long screen time.'],
  ['eyes', 'Unclench your jaw and drop your shoulders. Many people hold tension without noticing.'],
  ['sleep', 'A consistent sleep and wake time, even on weekends, helps your body clock.'],
  ['sleep', 'Dim the lights and put screens away 30–60 minutes before bed to help you wind down.'],
  ['sleep', 'Caffeine can stay in your system for hours. Many people sleep better if they stop by early afternoon.'],
  ['sleep', 'A cool, dark, quiet bedroom makes it easier to fall and stay asleep.'],
  ['sleep', 'Most adults do best with roughly 7–9 hours of sleep a night.'],
  ['food', 'Try to fill about half your plate with vegetables and fruit at main meals.'],
  ['food', 'Eating slowly and without screens makes it easier to notice when you’re full.'],
  ['food', 'Keep easy, healthy snacks in sight — fruit, nuts, yoghurt — so the simple choice is the good one.'],
  ['food', 'Including some protein at breakfast and lunch helps many people feel full for longer.'],
  ['mind', 'Try box breathing: in for 4, hold 4, out for 4, hold 4. Repeat for a minute.'],
  ['mind', 'Before you stop work, write down tomorrow’s top three tasks — it can ease evening worry.'],
  ['mind', 'Take a real break: step away from your desk, even for five minutes.'],
  ['mind', 'Naming what you feel — “I’m anxious”, “I’m tired” — can make feelings easier to handle.'],
  ['mind', 'If things feel heavy, talk to someone you trust. Reaching out is a strength, not a weakness.'],
  ['outdoors', 'Get some daylight early in the day — it supports your body clock and mood.'],
  ['outdoors', 'Use sunscreen on bright days, even when it feels cool.'],
  ['outdoors', 'Even five minutes outside between tasks can help you reset.'],
  ['care', 'Wash your hands before meals and after being out.'],
  ['care', 'Book your regular check-ups and screenings — prevention is easier than cure.'],
  ['care', 'If a symptom is new, severe or doesn’t go away, don’t wait it out — see a doctor.'],
];

// General reminders: each preset has times of day, and can be switched on/off or retimed.
export const PRESETS = [
  { id: 'water', cat: 'water', text: 'Drink a glass of water', times: ['10:30', '15:30'], on: true },
  { id: 'stretch', cat: 'move', text: 'Stand up and stretch for a minute', times: ['11:30', '16:30'], on: true },
  { id: 'eyes', cat: 'eyes', text: 'Rest your eyes — look 6 m away for 20 seconds', times: ['14:30'], on: true },
  { id: 'walk', cat: 'move', text: 'Take a short walk', times: ['13:45'], on: false },
  { id: 'posture', cat: 'eyes', text: 'Check your posture and relax your shoulders', times: ['12:30'], on: false },
  { id: 'winddown', cat: 'sleep', text: 'Start winding down — dim the lights and put screens away', times: ['21:30'], on: true },
];
const ROUTINE_TYPE = { water: 'water', stretch: 'break', eyes: 'eyes' }; // a routine with this nudge already covers it while you're working

export function config() {
  const t = store.settings().tips || {};
  const pre = Object.fromEntries(PRESETS.map((p) => [p.id, { on: t.presets?.[p.id]?.on ?? p.on, times: (t.presets?.[p.id]?.times || p.times).filter((x) => /^\d{1,2}:\d{2}$/.test(x)) }]));
  return { on: t.on !== false, cats: Array.isArray(t.cats) ? t.cats.filter((c) => CATEGORIES[c]) : Object.keys(CATEGORIES), presets: pre, custom: (Array.isArray(t.custom) ? t.custom : []).filter((c) => c?.text && /^\d{1,2}:\d{2}$/.test(c.time || '')).slice(0, 20), remind: t.remind !== false };
}
export const saveConfig = (patch) => store.setSettings({ tips: { ...(store.settings().tips || {}), ...patch } });

const hash = (s) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
/** One tip per day (stable through the day), from the categories you chose; `skip` moves to the next one. */
export function tipOfDay(date = new Date(), skip = 0) {
  const c = config(); const pool = TIPS.map((t, i) => ({ cat: t[0], text: t[1], i })).filter((t) => c.cats.includes(t.cat)); if (!pool.length) return null;
  return pool[(hash(dayKey(date)) + skip) % pool.length];
}

const dowOk = (c, d) => !Array.isArray(c.days) || !c.days.length || c.days.includes(d.getDay());
/** Every general reminder scheduled on a day: [{id, at: Date, text, cat}] (no quiet-hours filtering here). */
export function remindersOn(date, covered = () => false) {
  const c = config(); if (!c.on || !c.remind) return [];
  const out = []; const mk = (id, time, text, cat) => { const [h, m] = time.split(':').map(Number); const at = new Date(date); at.setHours(h, m, 0, 0); out.push({ id: `gen:${id}:${time}:${dayKey(date)}`, at, text, cat }); };
  for (const p of PRESETS) { const s = c.presets[p.id]; if (!s.on || !c.cats.includes(p.cat)) continue; for (const t of s.times) if (!covered(p.id, t, date)) mk(p.id, t, p.text, p.cat); }
  for (const x of c.custom) if (dowOk(x, date)) mk(x.id || 'c', x.time, x.text, 'custom');
  return out.sort((a, b) => a.at - b.at);
}
export { ROUTINE_TYPE };
export const dueGeneral = (now = new Date(), covered) => remindersOn(now, covered).filter((r) => { const m = (now - r.at) / 60000; return m >= 0 && m <= 30; });
export const parseDay = parseKey;
