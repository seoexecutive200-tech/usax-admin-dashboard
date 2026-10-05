// One tracker: log, see progress and charts, manage its rules, history, import/export.
import { store } from '../store.js';
import * as T from '../trackers.js';
import { rulesFor, ruleListHTML, bindRuleList, newRuleSheet } from '../rules-ui.js';
import { h, icon, ring, bar, spark, toast, confirmSheet, openSheet } from '../ui.js';
import { back, navigate, rerender } from '../router.js';
import { entrySheet, quickLog, editorSheet, exportTemplate, csvExport, csvImportSheet } from '../tracker-ui.js';
import { fmtDate, fmtTime, round, isNum } from '../util.js';

const color = (t) => T.COLOR_VAR[t.color] || 'var(--blue)';

export default {
  id: 'tracker',
  render({ id }) {
    const t = store.get('trackers', id);
    if (!t) return h`<div class="screen"><header class="top"><button class="icon-btn" data-act="back" aria-label="Back">${icon('chevronL', 22)}</button><h1 class="grow center-t">Tracker</h1><span style="width:44px"></span></header><div class="empty"><p>This tracker no longer exists.</p></div></div>`;
    const f = T.primaryField(t); const p = f ? T.progress(t, f) : null; const entries = T.entriesOf(t.id).slice(0, 25); const st = T.streak(t);
    return h`<div class="screen tracker"><header class="top"><button class="icon-btn" data-act="back" aria-label="Back">${icon('chevronL', 22)}</button><h1 class="grow center-t">${t.name}</h1><button class="icon-btn" data-act="menu" aria-label="More">${icon('more', 22)}</button></header>
      <section class="card"><div class="row gap center">${p ? ring({ pct: Math.min(1, p.pct), size: 76, stroke: 8, color: p.met ? 'var(--green)' : color(t), label: `${Math.round(Math.min(p.pct, 1.99) * 100)}%`, sub: p.period === 'week' ? 'week' : 'today' }) : h`<span class="t-ic lead big-ic" style="color:${color(t)}">${icon(t.icon, 32)}</span>`}
        <div class="grow"><div class="headline">${T.summaryLine(t)}</div>${t.description ? h`<p class="small muted">${t.description}</p>` : ''}${st > 1 ? h`<span class="pill pill-green">${st}-day streak</span>` : ''}</div></div>
        <div class="row gap wrap"><button class="btn btn-primary" data-act="log">${icon('plus', 16)} Log</button>${f?.quick?.map((q) => h`<button class="chip-btn" data-act="quick" data-f="${f.id}" data-v="${q}">+${q}${f.unit ? ` ${f.unit}` : ''}</button>`) || ''}</div></section>
      ${t.fields.filter((x) => T.isNumericField(x) || x.type === 'yesno').map((x) => { const s = T.stats(t, x, 30); const pts = T.series(t, x, 30); return h`<section class="card"><div class="row between"><span class="eyebrow">${x.label} · last 30 days</span><span class="pill">${T.AGGS[x.agg].toLowerCase()} per day</span></div>
        ${pts.filter((q) => isNum(q.value)).length > 1 ? spark(pts, { color: color(t), h: 54 }) : h`<p class="small muted">Log a few more days to see a chart.</p>`}
        <div class="stats"><div><small class="muted">Average</small><b>${s.avg === null ? '–' : T.formatValue(x, s.avg)}</b></div><div><small class="muted">Lowest</small><b>${s.min === null ? '–' : T.formatValue(x, s.min)}</b></div><div><small class="muted">Highest</small><b>${s.max === null ? '–' : T.formatValue(x, s.max)}</b></div><div><small class="muted">Days logged</small><b>${s.days}</b></div></div></section>`; })}
      <section><div class="sec-h"><h2>Rules</h2><button class="btn btn-sm btn-outline" data-act="newrule">${icon('plus', 16)} Add</button></div><div id="rulelist">${ruleListHTML(rulesFor(t.id))}</div></section>
      ${(t.reminders || []).length ? h`<section class="card"><div class="eyebrow">Reminders</div>${t.reminders.map((r) => h`<div class="small">${icon('bell', 14)} ${r.time}${r.text ? ` — ${r.text}` : ''} <span class="muted">· ${r.days.length === 7 ? 'daily' : r.days.length + ' days'}</span></div>`)}</section>` : ''}
      <section><div class="sec-h"><h2>History</h2></div>${entries.length ? h`<ul class="recent">${entries.map((e) => h`<li><button class="hist" data-act="edit" data-e="${e.id}"><span class="grow"><b>${t.fields.map((x) => (e.values?.[x.id] !== undefined ? T.formatValue(x, e.values[x.id]) : null)).filter(Boolean).join(' · ') || '—'}</b>${e.note ? h`<div class="small muted">${e.note}</div>` : ''}</span><small class="muted">${fmtDate(e.ts, { day: 'numeric', month: 'short' })} ${fmtTime(e.ts)}</small>${icon('chevron', 14, 'muted')}</button></li>`)}</ul>` : h`<div class="empty"><p>Nothing logged yet.</p></div>`}</section></div>`;
  },
  mount(root) { if (!root._ruleBound) { root._ruleBound = true; bindRuleList(root, () => rerender()); } },
  actions: {
    back: () => back('#/trackers'),
    log: (_, __, { id }) => entrySheet(store.get('trackers', id)), quick: (el, _, { id }) => quickLog(id, el.dataset.f, el.dataset.v),
    edit: (el, _, { id }) => entrySheet(store.get('trackers', id), { entry: store.get('entries', el.dataset.e) }),
    newrule: (_, __, { id }) => newRuleSheet({ trackerId: id, onSaved: () => rerender() }),
    menu: (_, __, { id }) => {
      const t = store.get('trackers', id);
      openSheet({ title: t.name, body: h`<div class="stack">${[['edit', 'edit', 'Edit tracker'], ['pin', 'pin', t.pinned ? 'Unpin from Today' : 'Pin to Today'], ['tpl', 'upload', 'Share as a template'], ['imp', 'download', 'Import from CSV'], ['exp', 'upload', 'Export to CSV'], ['arch', 'x', 'Archive'], ['del', 'trash', 'Delete tracker and its entries']].map(([k, ic, l]) => h`<button class="list-btn" data-m="${k}">${icon(ic, 18)}<span><b>${l}</b></span></button>`)}</div>`,
        onOpen: (s) => s.el.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-m]'); if (!b) return; s.close(); const k = b.dataset.m; const cur = store.get('trackers', id);
          if (k === 'edit') editorSheet(cur, { existing: cur }); else if (k === 'pin') await store.save('trackers', { id, pinned: !cur.pinned });
          else if (k === 'tpl') exportTemplate(cur); else if (k === 'exp') csvExport(cur); else if (k === 'imp') csvImportSheet(cur);
          else if (k === 'arch') { await store.save('trackers', { id, archived: true }); toast('Archived', { undo: () => store.save('trackers', { id, archived: false }) }); navigate('#/trackers'); }
          else if (k === 'del' && await confirmSheet({ title: 'Delete this tracker?', message: `“${cur.name}”, all its entries and its rules will be permanently deleted. Export a CSV first if you want a copy.`, confirm: 'Delete', danger: true })) {
            for (const en of T.entriesOf(id)) await store.remove('entries', en.id, { silent: true }); for (const r of rulesFor(id)) await store.remove('rules', r.id, { silent: true }); await store.remove('trackers', id); toast('Tracker deleted'); navigate('#/trackers');
          }
        }) });
    },
  },
};
