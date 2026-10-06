// One confidence system for everything LifeOS infers. Confidence depends on how many observations there are, how strong and consistent the
// effect is, how recent and complete the data is, where it came from, and known confounders — and it always lists the reasons.
import { clamp } from './util.js';

export function confidence({ n = 0, strength = 0, exceptionsRate = 0, windowDays = 30, recencyDays = 0, source = 'manual', confounders = [] } = {}) {
  if (n < 5) return { score: 0, label: 'Not enough data', tier: 0, reasons: [`Only ${n} comparable observation${n === 1 ? '' : 's'} — at least 5 are needed before I’d call anything a pattern.`] };
  const sample = clamp(n / 30, 0, 1); const effect = clamp(Math.abs(strength) / 0.7, 0, 1); const consistency = clamp(1 - exceptionsRate, 0, 1);
  const completeness = clamp(n / windowDays, 0, 1); const recency = recencyDays <= 14 ? 1 : recencyDays <= 45 ? 0.7 : 0.4; const src = source === 'device' ? 1 : source === 'mixed' ? 0.85 : 0.75;
  let score = 0.3 * sample + 0.25 * effect + 0.15 * consistency + 0.1 * completeness + 0.1 * recency + 0.1 * src - 0.08 * confounders.length;
  score = clamp(score, 0, 1);
  const tier = n >= 20 ? 3 : n >= 10 ? 2 : 1; // sample size caps how confident the label can be
  const label = score >= 0.6 && tier >= 3 ? 'Good' : score >= 0.4 && tier >= 2 ? 'Moderate' : 'Low';
  const reasons = [`${n} observations (${tier === 1 ? 'early signal' : tier === 2 ? 'moderate evidence' : 'stronger evidence'}).`,
    `Effect size ${Math.abs(strength) >= 0.5 ? 'fairly clear' : 'modest'} (r = ${strength.toFixed(2)}).`,
    exceptionsRate > 0.3 ? `${Math.round(exceptionsRate * 100)}% of days went the other way.` : 'Most days follow the same direction.',
    recencyDays > 14 ? `Latest data is ${Math.round(recencyDays)} days old.` : 'Data is recent.',
    source === 'manual' ? 'Based on things you logged yourself.' : 'Mixed sources.',
    ...(confounders.length ? [`Possible confounders: ${confounders.join(', ')}.`] : [])];
  return { score: Math.round(score * 100) / 100, label, tier, reasons };
}
