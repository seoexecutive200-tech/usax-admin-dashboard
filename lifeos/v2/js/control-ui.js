// "Control & history" card in You: what LifeOS changed (with Why and Undo), reminder history, tidy-up, and extra exports.
import * as Audit from './audit.js';
import { reminderHistory } from './routines.js';
import { tidyCount } from './tidy-ui.js';
import { exportICS, exportCSV, exportMemories } from './export-more.js';
import { h, icon, openSheet, toast } from './ui.js';
import { fmtRelative, fmtTime, fmtDate } from './util.js';

export function controlCardHTML() {
  const cs = Audit.correctionStats(); const n = tidyCount();
  return h`<section class="card"><div class="eyebrow">Control & history</div>
    <div class="row gap wrap"><button class="btn btn-sm" data-ctl="audit">${icon('refresh', 14)} What LifeOS changed</button><button class="btn btn-sm" data-ctl="reminders">${icon('bell', 14)} Reminder history</button><button class="btn btn-sm" data-tidy="open">${icon('check', 14)} Tidy up${n ? ` (${n})` : ''}</button></div>
    ${cs.total ? h`<p class="tiny muted">Last 30 days: ${cs.total} change${cs.total === 1 ? '' : 's'} made by LifeOS or approved suggestions; you undid ${cs.undone}.${cs.high ? ' That’s a lot — if something keeps missing, tell me what’s off.' : ''}</p>` : h`<p class="tiny muted">Everything LifeOS adds or moves for you shows up here with the reason and an Undo.</p>`}
    <div class="eyebrow">Take your data with you</div><div class="row gap wrap"><button class="btn btn-sm" data-ctl="ics">Calendar (.ics)</button><button class="btn btn-sm" data-ctl="csv">Spreadsheets (.csv)</button><button class="btn btn-sm" data-ctl="mem">Memories &amp; rules</button></div>
    <p class="tiny muted">Full backup (JSON) is under Data. Exports never include your API key.</p></section>`;
}
let auditSheet = null;
const SRC = { ai: 'AI', suggestion: 'Suggestion you approved', 'check-in': 'Check-in suggestion you approved', 'day plan': 'Day plan you approved' };
const auditBody = () => { const rows = Audit.list(); return rows.length ? h`<p class="small muted">Each change says what happened, why, what it was based on — and can be undone.</p>${rows.map((e) => h`<div class="ci-fact"><div class="row between gap"><span class="tiny muted">${fmtRelative(e.ts)} · ${SRC[e.source] || e.source}</span>${e.undone ? h`<span class="pill">Undone</span>` : Audit.canUndo(e) ? h`<button class="btn btn-sm" data-ctl="undo" data-id="${e.id}">Undo</button>` : h`<span class="tiny muted">Can’t be undone now</span>`}</div><div class="small strong">${e.what}</div>${e.why ? h`<div class="small"><b>Why:</b> ${e.why}</div>` : ''}${e.evidence?.length ? h`<div class="tiny muted">Based on: ${e.evidence.join(' · ')}</div>` : ''}</div>`)}` : h`<p class="muted">Nothing yet. When LifeOS adds a task, plans your day or moves something at your approval, it will be listed here.</p>`; };
const remBody = () => { const rows = reminderHistory(); return rows.length ? h`<p class="small muted">Recent reminders as seen on this device. Background deliveries appear here when the app next opens.</p>${rows.map((r) => h`<div class="ci-fact"><div class="tiny muted">${fmtDate(r.ts, { day: 'numeric', month: 'short' })} ${fmtTime(r.ts)} · ${r.result}</div><div class="small strong">${r.title}</div>${r.body ? h`<div class="tiny muted">${r.body}</div>` : ''}</div>`)}` : h`<p class="muted">No reminders recorded yet on this device.</p>`; };
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-ctl]'); if (!el) return; const a = el.dataset.ctl;
  if (a === 'audit') auditSheet = openSheet({ title: 'What LifeOS changed', body: auditBody(), tall: true, onClose: () => { auditSheet = null; } });
  else if (a === 'undo') { const ok = await Audit.undo(el.dataset.id); toast(ok ? 'Undone' : 'Couldn’t undo that', { tone: ok ? undefined : 'warn' }); auditSheet?.setBody(auditBody()); }
  else if (a === 'reminders') openSheet({ title: 'Reminder history', body: remBody(), tall: true });
  else if (a === 'ics') { exportICS(); toast('Calendar exported'); } else if (a === 'csv') { exportCSV(); toast('Spreadsheets exported'); } else if (a === 'mem') { exportMemories(); toast('Memories exported'); }
});
