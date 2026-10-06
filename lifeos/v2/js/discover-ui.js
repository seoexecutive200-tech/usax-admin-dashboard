// "Possible links in your data" — shown on Insights. Every card shows the observation count, lag, direction, comparison window, confidence
// with its reasons, and the exact day-by-day values behind it.
import { h, icon } from './ui.js';
import { scan, labelOf } from './discover.js';
import { fmtDate, round } from './util.js';
import { rerender } from './router.js';

const open = new Set(); const raw = new Set();
export function discoverCardHTML() {
  const found = scan(60);
  return h`<section><div class="sec-h"><h2>Possible links in your data</h2><small class="muted">scanned across everything you log</small></div>
    ${found.length ? found.map((p) => h`<div class="card pattern"><p>${p.text}</p>
      <div class="row gap wrap"><span class="pill">Observed ${p.n} days</span><span class="pill">${p.lag === 0 ? 'Same day' : 'Next day'}</span><span class="pill ${p.conf.label === 'Good' ? 'pill-green' : p.conf.label === 'Moderate' ? 'pill-amber' : ''}">${p.conf.label} confidence</span><span class="pill">r = ${p.r}</span></div>
      <p class="tiny muted">${labelOf(p.a)} → ${labelOf(p.b)} · ${fmtDate(p.from, { day: 'numeric', month: 'short' })}–${fmtDate(p.to, { day: 'numeric', month: 'short' })} · ${p.exceptions} day${p.exceptions === 1 ? '' : 's'} went the other way · an association, not a cause</p>
      <div class="row gap"><button class="link" data-disc="why" data-id="${p.id}">${open.has(p.id) ? 'Hide' : 'Why this confidence?'}</button><button class="link" data-disc="raw" data-id="${p.id}">${raw.has(p.id) ? 'Hide values' : 'See the exact days'}</button></div>
      ${open.has(p.id) ? h`<ul class="bul tiny">${p.conf.reasons.map((r) => h`<li>${r}</li>`)}</ul>` : ''}
      ${raw.has(p.id) ? h`<table class="cmp tiny"><thead><tr><th>Day</th><th>${labelOf(p.a)}</th><th>${labelOf(p.b)}${p.lag ? ' (next day)' : ''}</th></tr></thead><tbody>${p.rows.map((r) => h`<tr><td>${fmtDate(r.key, { day: 'numeric', month: 'short' })}</td><td>${round(r.x, 1)}</td><td>${round(r.y, 1)}</td></tr>`)}</tbody></table>` : ''}</div>`)
      : h`<div class="card"><p><b>Nothing reliable yet.</b> I look for links that show up on at least 10 days with both things logged, and I’d rather stay quiet than guess. Keep logging and this fills in by itself.</p></div>`}</section>`;
}
document.addEventListener('click', (e) => { const el = e.target.closest('[data-disc]'); if (!el) return; const s = el.dataset.disc === 'why' ? open : raw; s.has(el.dataset.id) ? s.delete(el.dataset.id) : s.add(el.dataset.id); rerender(); });
export const _ = icon;
