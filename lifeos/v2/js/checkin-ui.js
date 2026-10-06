// UI for the adaptive check-ins: the question card on Today, the Check-ins hub (library, targets, opt-ins, your answers), and the
// three-part report. Everything is wired through one document-level handler so the card, hub and sheets share the same code.
import * as CI from './checkins.js';
import { CHECKINS, DOMAINS, OPT_IN, get as getDef } from './checkin-lib.js';
import { store } from './store.js';
import { h, raw, icon, toast, openSheet, confirmSheet } from './ui.js';
import { rerender, navigate } from './router.js';
import { dayKey, fmtTime, fmtRelative, addDays, fmtDate, isNum } from './util.js';

const draft = {}; // `${id}:${refId}` or 'edit' -> { field: value }
let result = null; // what the advisor did after your last answer
let say = '';
let hub = null; // open hub sheet api
let rep = null; // open report sheet { api, days }
let editor = null; // { api, recId, def }
const dkey = (cur) => `${cur.id}:${cur.ref?.id || ''}`;
let shownKey = '';

// ---------- form ----------
function field(f, d, name) {
  const v = d[f.k];
  if (f.t === 'scale') return h`<div class="field"><span class="field-label">${f.l}</span><div class="chips ci-scale">${Array.from({ length: f.max - f.min + 1 }, (_, i) => f.min + i).map((n) => h`<button type="button" class="chip-btn pick ${v === n ? 'on' : ''}" data-ci="pick" data-k="${f.k}" data-v="${n}" aria-pressed="${v === n}">${n}</button>`)}</div></div>`;
  if (f.t === 'choice') return h`<div class="field"><span class="field-label">${f.l}</span><div class="chips">${f.o.map((o) => h`<button type="button" class="chip-btn pick ${v === o ? 'on' : ''}" data-ci="pick" data-k="${f.k}" data-v="${o}" aria-pressed="${v === o}">${o}</button>`)}</div></div>`;
  if (f.t === 'multi') return h`<div class="field"><span class="field-label">${f.l}</span><div class="chips">${f.o.map((o) => h`<button type="button" class="chip-btn pick ${(v || []).includes(o) ? 'on' : ''}" data-ci="pick" data-k="${f.k}" data-v="${o}" aria-pressed="${(v || []).includes(o)}">${o}</button>`)}</div></div>`;
  const type = f.t === 'time' ? 'time' : f.t === 'number' ? 'number" step="any" inputmode="decimal' : 'text" maxlength="400';
  return h`<div class="field"><label class="field-label" for="ci-${name}-${f.k}">${f.l}${f.u && f.t === 'number' ? ` (${f.u})` : ''}</label><input class="input" id="ci-${name}-${f.k}" name="${f.k}" type="${raw(type)}" value="${v ?? ''}" autocomplete="off"></div>`;
}
const fields = (def, d, name) => def.fields.map((f) => field(f, d, name));
const autoSubmit = (def) => def.fields.length === 1 && def.fields[0].t === 'choice';

function capture(scope) { // keep what's typed when a chip tap re-renders the form
  const form = document.querySelector(scope === 'edit' ? '#ci-edit-form' : 'form[data-ci-form]'); if (!form) return;
  const key = scope === 'edit' ? 'edit' : form.dataset.ciForm; const d = (draft[key] ||= {});
  for (const el of form.querySelectorAll('input[name]')) d[el.name] = el.value === '' ? null : el.type === 'number' ? Number(el.value) : el.value;
}
const rawFrom = (key) => ({ ...(draft[key] || {}) });

// ---------- the card on Today ----------
export function checkinCard() {
  if (result && result.until > Date.now()) {
    const safety = result.action === 'safety_escalation';
    return h`<section class="card now ${safety ? 'warn' : 'done'}" role="${safety ? 'alert' : 'status'}"><div class="row gap center">${icon(safety ? 'alert' : 'check', 18, safety ? 'c-amber' : 'c-green')}<span class="grow">${result.text || 'Saved.'}</span></div>
      ${result.buttons?.length ? h`<div class="chips">${result.buttons.map((b, i) => h`<button class="chip-btn big" data-ci="rbtn" data-i="${i}">${b.label}</button>`)}</div>` : ''}
      ${result.text && (result.buttons?.length || safety) ? h`<div class="row gap"><button class="btn btn-sm" data-ci="ok">${safety ? 'I’ve read this' : 'Got it'}</button></div>` : ''}</section>`;
  }
  result = null;
  const cur = CI.current(); if (!cur) return '';
  const key = dkey(cur); const d = (draft[key] ||= {});
  const show = shownKey !== key; shownKey = key;
  return h`<section class="card now ci" data-ckey="${key}"><div class="row between center"><div class="eyebrow">${icon('sparkle', 12)} ${DOMAINS[cur.def.domain]}</div><span class="row gap"><button class="link" data-ci="snooze" data-id="${cur.id}" data-ref="${cur.ref?.id || ''}">Not now</button><button class="link" data-ci="skip" data-id="${cur.id}" data-ref="${cur.ref?.id || ''}">Skip</button></span></div>
    ${say ? h`<p class="small muted">${say}</p>` : ''}${cur.ref?.label ? h`<p class="small muted">${cur.ref.label}</p>` : ''}<p class="strong">${cur.prompt}</p>
    <form data-ci-form="${key}" class="ci-form" novalidate>${fields(cur.def, d, 'card')}${autoSubmit(cur.def) ? '' : h`<div class="row gap center"><button class="btn btn-primary">Save</button><small class="tiny muted">Leave anything you don’t know empty — I won’t guess.</small></div>`}</form>
    <details class="tiny muted"><summary>Why am I being asked?</summary>${cur.def.when} You can turn any check-in off in <button class="link" data-ci="hub">Check-ins</button>.</details></section>`;
}

async function submit(def, key, ref, rawAns) {
  const r = await CI.submit(def.id, rawAns, ref);
  if (r.empty) { toast('Pick or type an answer — or tap Skip', { tone: 'warn' }); return; }
  delete draft[key]; shownKey = ''; say = '';
  const d = r.decision;
  if (d.action === 'ask_one_followup') say = d.text;
  else if (d.action === 'safety_escalation') result = { action: d.action, text: d.text, until: Infinity };
  else if (d.text || d.buttons?.length) result = { action: d.action, text: d.text, buttons: d.buttons || [], until: d.buttons?.length ? Date.now() + 120000 : Date.now() + 4500 };
  if (result && !result.buttons?.length && result.action !== 'safety_escalation') setTimeout(rerender, 4600);
  rerender();
}
async function runButton(b) {
  try { if (typeof b.run === 'function') await b.run(); else if (b.run === 'plan') (await import('./dayplan.js')).planDaySheet(); else if (b.run === 'memories') navigate('#/you'); else if (b.run === 'sleep-target') hubSheet(); } catch (e) { toast(e.message || 'Couldn’t do that', { tone: 'warn' }); }
}

// ---------- hub ----------
const optList = () => Object.entries(OPT_IN);
function hubHTML() {
  const cx = CI.getCx(); const st = CI.interruptionState(); const lib = CI.libraryStatus(); const skipped = lib.filter((l) => l.dismissed >= 3 || l.off);
  const hist = CI.history(25);
  return h`<p class="small muted">LifeOS doesn’t run these 100 check-ins on a schedule. Each one is a candidate: it’s asked only when it can change a decision, it hasn’t been answered recently, and it fits your quiet hours and daily limit — otherwise LifeOS stays silent. The more it learns, the less it asks.</p>
    <section class="card inset"><label class="check"><input type="checkbox" data-ci-chg="on" ${cx.on ? 'checked' : ''}><span><b>Adaptive check-ins</b> <small class="muted">${st.shown} of ${st.cap} used today · ${st.mode} mode${st.quiet ? ' · quiet hours now' : ''}</small></span></label>
      <small class="muted">Change how many per day with Advisor mode in You (Quiet 2 · Balanced 4 · Active 6). At least 90 minutes apart.</small></section>
    <section class="card"><div class="eyebrow">Notifications</div><label class="check"><input type="checkbox" data-ci-chg="push" ${cx.push !== false ? 'checked' : ''}><span>Send check-ins as notifications <small class="muted">at most 2 a day, 3+ hours apart, never in quiet hours. Personal topics show a generic message.</small></span></label>
      <label class="check"><input type="checkbox" data-ci-chg="pushNudges" ${cx.pushNudges !== false ? 'checked' : ''}><span>Welcome-back and weekly tidy-up nudges <small class="muted">one after 5 quiet days; one on Sunday evening if there’s clutter</small></span></label><small class="muted">Needs background reminders turned on in You.</small></section>
    <section class="card"><div class="eyebrow">Your own targets</div><div class="grid2"><div class="field"><label class="field-label" for="ci-sleep">Sleep target (hours)</label><input class="input" id="ci-sleep" type="number" step="0.5" min="3" max="14" inputmode="decimal" value="${cx.sleepH ?? ''}" placeholder="not set"></div><div class="field"><label class="field-label" for="ci-hyd">Water target (ml)</label><input class="input" id="ci-hyd" type="number" step="50" min="0" inputmode="numeric" value="${cx.hydrationMl ?? ''}" placeholder="not set"></div></div>
      <small class="muted">LifeOS never invents a target. Sleep and water comparisons only use numbers you set here.</small><div><button class="btn btn-sm" data-ci="targets">Save targets</button></div></section>
    <section class="card"><div class="eyebrow">Optional check-ins</div>${optList().map(([k, l]) => h`<label class="check"><input type="checkbox" data-ci-chg="opt" data-k="${k}" ${cx.optin[k] ? 'checked' : ''}><span>${l}</span></label>`)}<small class="muted">Off by default. Health questions never diagnose; medication tracking is adherence logging only.</small></section>
    <section class="card"><div class="eyebrow">Reports</div><div class="row gap wrap"><button class="btn btn-sm" data-ci="report" data-days="1">Today’s report</button><button class="btn btn-sm" data-ci="report" data-days="7">This week</button></div></section>
    ${skipped.length ? h`<section class="card"><div class="eyebrow">Paused or often skipped</div>${skipped.map((l) => h`<div class="row between center"><span class="small">#${l.def.id} ${l.def.prompt}</span><button class="btn btn-sm" data-ci="reon" data-id="${l.def.id}">Turn back on</button></div>`)}</section>` : ''}
    <section class="card"><div class="eyebrow">Your answers</div>${hist.length ? hist.map((r) => { const d = getDef(r.checkinId); return h`<div class="ci-fact"><div class="row between gap"><span class="tiny muted">#${d.id} · ${fmtRelative(r.ts)}${r.edited ? ' · edited' : ''} · you told me</span><span class="row gap"><button class="link" data-ci="edit" data-rid="${r.id}">Edit</button><button class="link" data-ci="del" data-rid="${r.id}">Delete</button></span></div><div class="small">${d.prompt}</div><div class="small strong">${CI.summarize(d, r.answers) || 'Skipped fields stay unknown.'}</div>${r.calc?.items?.length ? h`<div class="tiny muted">Calculated: ${r.calc.items.map((i) => `${i.name} ${i.value}${i.unit ? ` ${i.unit}` : ''}`).join(' · ')}</div>` : ''}</div>`; }) : h`<p class="small muted">Nothing yet. Answers you give are listed here, and you can correct or delete any of them — the numbers that depend on them update.</p>`}</section>
    <section><div class="sec-h"><h2>All 100 check-ins</h2></div>${Object.entries(DOMAINS).map(([dk, dl]) => h`<details class="card ci-dom"><summary><b>${dl}</b> <small class="muted">${lib.filter((l) => l.def.domain === dk).length}</small></summary>${lib.filter((l) => l.def.domain === dk).map((l) => h`<div class="ci-row"><div class="grow"><div class="small"><b>#${l.def.id}</b> ${l.def.prompt}</div><div class="tiny muted">${l.def.when}</div><div class="tiny muted">${l.contextual ? 'Asked when it fits' : 'Only when you ask'}${l.needsOptin ? ` · needs “${OPT_IN[l.needsOptin]}”` : ''}${l.count ? ` · answered ${l.count}×` : ''}${l.dismissed ? ` · skipped ${l.dismissed}×` : ''}${l.off ? ' · off' : ''}</div></div><div class="col gap"><button class="btn btn-sm" data-ci="ask" data-id="${l.def.id}" ${l.needsOptin || l.off ? 'disabled' : ''}>Ask me now</button><button class="btn btn-sm" data-ci="${l.off ? 'reon' : 'off'}" data-id="${l.def.id}">${l.off ? 'Turn on' : 'Turn off'}</button></div></div>`)}</details>`)}</section>`;
}
export function hubSheet() {
  hub = openSheet({ title: 'Check-ins', body: hubHTML(), tall: true, onClose: () => { hub = null; } });
}
const hubRefresh = () => { if (hub) { const y = hub.el.scrollTop; hub.setBody(hubHTML()); hub.el.scrollTop = y; } };

// ---------- edit a saved answer ----------
function editHTML() { const def = editor.def; return h`<p class="small muted">${def.prompt}</p><form id="ci-edit-form" novalidate>${fields(def, draft.edit || {}, 'edit')}<div class="row gap"><button class="btn btn-primary" data-ci="edit-save">Save</button><button type="button" class="btn" data-ci="edit-cancel">Cancel</button></div><small class="tiny muted">Saving recalculates anything that depended on this answer.</small></form>`; }

// ---------- report ----------
function reportHTML(days) {
  const sections = []; const key = dayKey();
  const rs = Array.from({ length: days }, (_, i) => CI.report(dayKey(addDays(new Date(), -i))));
  const logged = rs.flatMap((r) => r.logged.map((x) => ({ ...x, day: r.key }))); const calc = rs.flatMap((r) => r.calculated); const thinks = days === 1 ? rs[0].thinks : CI.report(key).thinks;
  void sections;
  return h`<div class="seg" role="tablist"><button class="seg-btn ${days === 1 ? 'on' : ''}" data-ci="report" data-days="1">Today</button><button class="seg-btn ${days === 7 ? 'on' : ''}" data-ci="report" data-days="7">7 days</button></div>
    <section class="card"><div class="eyebrow">What you logged</div><p class="tiny muted">Your own answers, exactly as you gave them.</p>${logged.length ? logged.map((l) => h`<div class="ci-fact"><div class="tiny muted">${days > 1 ? `${fmtDate(l.day, { weekday: 'short', day: 'numeric', month: 'short' })} · ` : ''}${fmtTime(l.time)} · you told me</div><div class="small">${l.q}</div><div class="small strong">${l.a || 'No details given'}</div></div>`) : h`<p class="small muted">No check-in answers yet.</p>`}</section>
    <section class="card"><div class="eyebrow">What LifeOS calculated</div><p class="tiny muted">Arithmetic from your records — each line says how.</p>${calc.length ? calc.map((c) => h`<div class="ci-fact"><div class="small strong">${c.text}</div><div class="tiny muted">${c.how}</div></div>`) : h`<p class="small muted">Nothing to calculate yet.</p>`}</section>
    <section class="card"><div class="eyebrow">What LifeOS thinks may be happening</div><p class="tiny muted">Possible patterns only — never causes, never a diagnosis.</p>${thinks.length ? thinks.map((t) => h`<div class="ci-fact"><div class="small">${t.text}</div><div class="tiny muted">Based on ${t.n} observation${t.n === 1 ? '' : 's'} · ${t.window}</div></div>`) : h`<p class="small muted">Not enough data yet for a pattern — I’d rather say nothing than guess.</p>`}</section>`;
}
export function reportSheet(days = 1) {
  if (rep) { rep.days = days; rep.api.setBody(reportHTML(days)); return; }
  const api = openSheet({ title: 'Your report', body: reportHTML(days), tall: true, onClose: () => { rep = null; } }); rep = { api, days };
}

// ---------- document-level events ----------
const asRef = (el) => (el.dataset.ref ? { id: el.dataset.ref } : null);
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-ci]'); if (!el) return; const a = el.dataset.ci;
  if (a === 'pick') {
    const form = el.closest('#ci-edit-form') || (el.closest('.sheet') && editor ? el.closest('.sheet').querySelector('#ci-edit-form') : null);
    const inEdit = !!form; const cur = inEdit ? null : CI.current(); const key = inEdit ? 'edit' : cur && dkey(cur); if (!key) return;
    const def = inEdit ? editor.def : cur.def; const f = def.fields.find((x) => x.k === el.dataset.k); capture(inEdit ? 'edit' : 'card');
    const d = (draft[key] ||= {}); let v = el.dataset.v; if (f.t === 'scale') v = Number(v);
    if (f.t === 'multi') { const set = new Set(d[f.k] || []); set.has(v) ? set.delete(v) : set.add(v); d[f.k] = [...set]; } else d[f.k] = d[f.k] === v ? null : v;
    if (!inEdit && autoSubmit(def) && d[f.k] != null) { await submit(def, key, cur.ref, rawFrom(key)); return; }
    if (inEdit) editor.api.setBody(editHTML()); else rerender();
    return;
  }
  if (a === 'skip') { await CI.dismiss(Number(el.dataset.id), asRef(el)); say = ''; shownKey = ''; rerender(); return; }
  if (a === 'snooze') { CI.snooze(Number(el.dataset.id), asRef(el), 120); say = ''; shownKey = ''; rerender(); return; }
  if (a === 'ok') { result = null; rerender(); return; }
  if (a === 'rbtn') { const b = result?.buttons?.[Number(el.dataset.i)]; result = null; rerender(); if (b) await runButton(b); return; }
  if (a === 'hub') { e.preventDefault(); hubSheet(); return; }
  if (a === 'targets') { const s = parseFloat(document.getElementById('ci-sleep')?.value), w = parseFloat(document.getElementById('ci-hyd')?.value); await CI.setCx({ sleepH: isNum(s) && s >= 3 && s <= 14 ? s : null, hydrationMl: isNum(w) && w > 0 ? Math.round(w) : null }); toast('Targets saved'); hubRefresh(); return; }
  if (a === 'report') { reportSheet(Number(el.dataset.days) || 1); return; }
  if (a === 'off') { await CI.setCx({ off: [...new Set([...CI.getCx().off, Number(el.dataset.id)])] }); hubRefresh(); return; }
  if (a === 'reon') { const id = Number(el.dataset.id); await CI.setCx({ off: CI.getCx().off.filter((x) => x !== id) }); for (const r of store.all('checkins').filter((r) => r.checkinId === id && r.status === 'dismissed')) await store.remove('checkins', r.id, { silent: true }); hubRefresh(); return; }
  if (a === 'ask') { const id = Number(el.dataset.id); if (hub) hub.close(); if (id === 61 || id === 62) { navigate('#/capture'); return; } CI.startNow(id); say = ''; shownKey = ''; navigate('#/today'); rerender(); return; }
  if (a === 'del') { const rid = el.dataset.rid; if (await confirmSheet({ title: 'Delete this answer?', message: 'It’s removed everywhere, including anything it logged, and calculations update.', confirm: 'Delete', danger: true })) { await CI.removeFact(rid); toast('Deleted'); hubRefresh(); rerender(); } return; }
  if (a === 'edit') { const rec = store.get('checkins', el.dataset.rid); if (!rec) return; const def = getDef(rec.checkinId); draft.edit = { ...rec.answers }; editor = { recId: rec.id, def, api: openSheet({ title: `Edit answer #${def.id}`, body: h`<div id="ci-edit-slot"></div>`, onClose: () => { editor = null; } }) }; editor.api.setBody(editHTML()); return; }
  if (a === 'edit-save') { e.preventDefault(); capture('edit'); const ed = editor; if (!ed) return; await CI.updateFact(ed.recId, rawFrom('edit')); ed.api.close(); toast('Updated'); hubRefresh(); rerender(); return; }
  if (a === 'edit-cancel') { editor?.api.close(); }
});
document.addEventListener('change', async (e) => {
  const el = e.target.closest('[data-ci-chg]'); if (!el) return; const k = el.dataset.ciChg;
  if (k === 'on') await CI.setCx({ on: el.checked });
  else if (k === 'push' || k === 'pushNudges') await CI.setCx({ [k]: el.checked });
  else if (k === 'opt') await CI.setCx({ optin: { ...CI.getCx().optin, [el.dataset.k]: el.checked } });
  hubRefresh(); rerender();
});
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-ci-form]'); if (f) { e.preventDefault(); capture('card'); const cur = CI.current(); if (!cur) return; await submit(cur.def, dkey(cur), cur.ref, rawFrom(dkey(cur))); return; }
  if (e.target.closest('#ci-edit-form')) { e.preventDefault(); const ed = editor; if (!ed) return; capture('edit'); await CI.updateFact(ed.recId, rawFrom('edit')); ed.api.close(); toast('Updated'); hubRefresh(); rerender(); }
});
export const _ = { CHECKINS };
