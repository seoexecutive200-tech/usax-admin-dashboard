// Tidy-up sheet and the "welcome back" card.
import * as Tidy from './tidy.js';
import { h, icon, openSheet, toast } from './ui.js';
import { rerender } from './router.js';
import { lsGet, lsSet, dayKey, fmtDate } from './util.js';
import * as CI from './checkins.js';

let sheet = null;
const body = () => {
  const s = Tidy.scan();
  if (!s.total) return h`<p class="muted"><b>Nothing to tidy.</b> No duplicates, no tasks that keep slipping, no forgotten goals. I’ll tell you if that changes.</p>`;
  return h`<p class="small muted">Nothing changes until you choose. Every action here can be undone from the message that appears.</p>
    ${s.duplicates.length ? h`<section class="card"><div class="eyebrow">Possible duplicates</div>${s.duplicates.map((g) => h`<div class="ci-fact"><div class="small strong">${g[0].title}</div><div class="tiny muted">${g.length} open tasks with the same name</div><button class="btn btn-sm" data-tidy="merge" data-ids="${g.map((t) => t.id).join(',')}">Keep the newest, remove ${g.length - 1}</button></div>`)}</section>` : ''}
    ${s.staleTasks.length ? h`<section class="card"><div class="eyebrow">Tasks that keep slipping or went stale</div>${s.staleTasks.map(({ t, why }) => h`<div class="ci-fact"><div class="small strong">${t.title}</div><div class="tiny muted">${why}</div><div class="row gap wrap"><button class="btn btn-sm" data-tidy="keep" data-id="${t.id}">Keep</button><button class="btn btn-sm" data-tidy="someday" data-id="${t.id}">Someday</button><button class="btn btn-sm" data-tidy="drop" data-id="${t.id}">Drop</button></div></div>`)}</section>` : ''}
    ${s.goals.length ? h`<section class="card"><div class="eyebrow">Goals nobody has touched</div>${s.goals.map((g) => h`<div class="ci-fact"><div class="small strong">${g.name}</div><div class="tiny muted">No progress for ${g.idle} days</div><div class="row gap wrap"><button class="btn btn-sm" data-tidy="g" data-a="keep" data-k="${g.kind}" data-id="${g.id}">Keep</button><button class="btn btn-sm" data-tidy="g" data-a="pause" data-k="${g.kind}" data-id="${g.id}">Pause</button>${g.kind === 'trackers' ? h`<button class="btn btn-sm" data-tidy="redesign" data-id="${g.id}">Redesign</button>` : ''}<button class="btn btn-sm" data-tidy="g" data-a="archive" data-k="${g.kind}" data-id="${g.id}">Archive</button></div></div>`)}</section>` : ''}`;
};
export const tidySheet = () => { sheet = openSheet({ title: 'Tidy up', body: body(), tall: true, onClose: () => { sheet = null; } }); };
export const tidyCount = () => Tidy.scan().total;
const refresh = () => { sheet?.setBody(body()); rerender(); };
const withUndo = (msg, undo) => toast(msg, { undo: async () => { await undo(); refresh(); } });

// welcome back (shown on Today after 5+ days away; one tap to start fresh, never a wall of overdue items)
const WB = 'lifeos.wb';
export function welcomeBackCard() {
  const away = Tidy.daysAway(); if (away < 5 || lsGet(WB) === dayKey()) return '';
  const od = Tidy.overdueTasks().length;
  return h`<section class="card now" data-wb><div class="eyebrow">${icon('sparkle', 12)} Welcome back</div><p class="strong">It’s been ${away} days — no need to catch up.</p><p class="small muted">I won’t ask you to rebuild the days you missed. ${od ? `${od} task${od === 1 ? ' is' : 's are'} past due; I can set ${od === 1 ? 'it' : 'them'} aside as “Someday” so today starts clean. Nothing is deleted.` : 'Let’s just start from today.'}</p>
    <div class="row gap wrap">${od ? h`<button class="btn btn-primary btn-sm" data-tidy="fresh">Start fresh today</button>` : ''}<button class="btn btn-sm" data-tidy="wb-ok">${od ? 'Leave them' : 'Okay'}</button></div></section>`;
}
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-tidy]'); if (!el) return; const a = el.dataset.tidy; const id = el.dataset.id;
  if (a === 'open') { tidySheet(); return; }
  if (a === 'keep') { const u = await Tidy.keepTask(id); withUndo('Kept — I won’t bring it up for 30 days', u); }
  else if (a === 'drop') { const u = await Tidy.dropTask(id); withUndo('Task dropped', u); }
  else if (a === 'someday') { const u = await Tidy.somedayTask(id); withUndo('Moved to Someday', u); }
  else if (a === 'merge') { const u = await Tidy.mergeDuplicates(el.dataset.ids.split(',')); withUndo('Duplicates removed', u); }
  else if (a === 'g') { const u = await Tidy.goalAction(el.dataset.k, id, el.dataset.a); withUndo({ keep: 'Kept for now', pause: 'Paused', archive: 'Archived' }[el.dataset.a], u); }
  else if (a === 'redesign') { sheet?.close(); (await import('./router.js')).navigate(`#/tracker/${id}`); return; }
  else if (a === 'fresh') { const r = await Tidy.freshStart(); lsSet(WB, dayKey()); toast(`${r.count} task${r.count === 1 ? '' : 's'} set aside as Someday`, { undo: async () => { await r.undo(); lsSet(WB, ''); rerender(); } }); CI.startNow(71); }
  else if (a === 'wb-ok') { lsSet(WB, dayKey()); CI.startNow(71); }
  refresh();
});
export const _ = fmtDate;
