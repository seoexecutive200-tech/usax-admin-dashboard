// Coaching tone: how LifeOS words its nudges and how the AI is asked to write. Facts and numbers never change — only the voice.
import { store } from './store.js';

export const TONES = { gentle: ['Gentle', 'Warm and encouraging'], direct: ['Direct', 'Short, to the point'], minimal: ['Minimal', 'Just the facts'] };
export const getTone = () => { const t = store.settings().coachTone; return TONES[t] ? t : 'gentle'; };

const V = {
  direct: {
    water: ['Drink water.', '250 ml, now.'], break: (m) => [`${m.len || 10}-minute break.`, 'Stand up and move.'], lunch: ['Lunch.', 'Step away and eat.'],
    eyes: ['Rest your eyes.', 'Look 6 m away for 20 s.'], wrap: ['Wrap up.', '30 minutes left.'], end: ['Workday over.', 'Log out.'],
  },
  minimal: {
    water: ['Water', ''], break: (m) => [`Break · ${m.len || 10} min`, ''], lunch: ['Lunch', ''], eyes: ['Eyes', ''], wrap: ['Wrap up', ''], end: ['Done for the day', ''],
  },
};
/** Title/body for a routine nudge in the user's tone. `m` is the base (gentle) meta, including any per-nudge fields like `len`. */
export function nudgeText(type, m) {
  const t = getTone(); const v = V[t]?.[type];
  if (!v) return { title: m.title, body: t === 'minimal' ? '' : m.body };
  const [title, body] = typeof v === 'function' ? v(m) : v; return { title, body };
}
const AI_LINE = {
  gentle: 'Write user-facing text warmly and encouragingly, in plain everyday language.',
  direct: 'Write user-facing text in short, direct, imperative sentences. No filler, no padding, no cheerleading.',
  minimal: 'Write user-facing text as briefly as possible: facts and numbers only, no encouragement, no filler.',
};
/** Appended to every AI request so wording follows the user's chosen tone. */
export const styleInstruction = () => `\n\nCOMMUNICATION STYLE (wording of user-facing text only — never change facts, numbers, ids, field names or the JSON structure): ${AI_LINE[getTone()]}`;
