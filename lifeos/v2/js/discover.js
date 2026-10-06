// Proactive relationship scan: looks across everything you log (same day and next day) and surfaces only the few links that are strong
// enough and observed often enough. All maths is local; it never uses zero-fill for missing days and never claims a cause.
import { store } from './store.js';
import * as A from './analytics.js';
import { confidence } from './confidence.js';
import { dayKey, addDays, isNum, round, mean } from './util.js';

const METRICS = ['sleep', 'energy', 'mood', 'stress', 'focus', 'water', 'workout', 'caffeine', 'screen', 'steps', 'outdoor', 'load'];
const NAME = { sleep: 'Sleep', energy: 'Energy', mood: 'Mood', stress: 'Stress', focus: 'Focus', water: 'Water', workout: 'Movement', caffeine: 'Caffeine', screen: 'Screen time', steps: 'Steps', outdoor: 'Outdoor time', load: 'Schedule load' };
const SKIP = new Set(['workout|steps', 'steps|workout', 'outdoor|steps', 'steps|outdoor']);
const val = (m, k) => (m === 'load' ? (A.eventsOnDay(k).length ? A.loadForDay(k) : null) : A.dailyValue(m, k));
export const labelOf = (m) => NAME[m] || m;
let cache = { v: -1, days: 0, out: null };

function pearson(xs, ys) {
  const n = xs.length; const mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}
export function scan(days = 60) {
  const v = store.version(); if (cache.v === v && cache.days === days) return cache.out;
  const floor = store.settings().baselineStart || '0000-00-00'; const keys = Array.from({ length: days }, (_, i) => dayKey(addDays(new Date(), -i))).filter((k) => k >= floor).reverse();
  const out = [];
  for (const a of METRICS) for (const b of METRICS) {
    if (a === b || SKIP.has(`${a}|${b}`)) continue;
    for (const lag of [0, 1]) {
      if (lag === 0 && a > b) continue; // same-day pairs are symmetric
      const rows = [];
      for (const k of keys) { const x = val(a, k); const y = val(b, dayKey(addDays(new Date(`${k}T12:00:00`), lag))); if (isNum(x) && isNum(y)) rows.push({ key: k, x, y }); }
      if (rows.length < 10) continue;
      const r = pearson(rows.map((q) => q.x), rows.map((q) => q.y)); if (r == null || Math.abs(r) < 0.35) continue;
      const mx = mean(rows.map((q) => q.x)), my = mean(rows.map((q) => q.y));
      const contrary = rows.filter((q) => Math.sign((q.x - mx) * (q.y - my)) === -Math.sign(r)).length;
      const last = rows[rows.length - 1].key; const conf = confidence({ n: rows.length, strength: r, exceptionsRate: contrary / rows.length, windowDays: days, recencyDays: (Date.now() - +new Date(`${last}T12:00:00`)) / 86400000, source: 'manual' });
      if (conf.label === 'Low' && conf.tier < 2) continue;
      const same = r > 0; const A_ = NAME[a], B_ = NAME[b];
      const text = lag === 0 ? `${A_} and ${B_.toLowerCase()} tend to ${same ? 'rise and fall together' : 'move in opposite directions'} on the same day.` : `Higher ${A_.toLowerCase()} tends to be followed by ${same ? 'higher' : 'lower'} ${B_.toLowerCase()} the next day.`;
      out.push({ id: `${a}>${b}@${lag}`, a, b, lag, n: rows.length, r: round(r, 2), direction: same ? 'together' : 'opposite', exceptions: contrary, windowDays: days, conf, text, rows, from: rows[0].key, to: last });
    }
  }
  // keep one entry per unordered pair (strongest), then rank by confidence × strength
  const best = new Map(); for (const o of out) { const k = [o.a, o.b].sort().join('|'); const cur = best.get(k); if (!cur || o.conf.score * Math.abs(o.r) > cur.conf.score * Math.abs(cur.r)) best.set(k, o); }
  const res = [...best.values()].sort((p, q) => q.conf.score * Math.abs(q.r) - p.conf.score * Math.abs(p.r)).slice(0, 5);
  cache = { v, days, out: res }; return res;
}
