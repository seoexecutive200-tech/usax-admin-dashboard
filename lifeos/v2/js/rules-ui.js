// Rules UI: write a rule in a sentence (AI compiles it) or build it by hand. Always shown for review before saving.
import { store } from './store.js';
import * as T from './trackers.js';
import { KINDS, OPS, normalizeRule, allRules, rulesFor } from './rules.js';
import { h, icon, openSheet, confirmSheet, toast, field } from './ui.js';
import { aiReady, askJSON, describeError } from './groq.js';
import { CORE_SYSTEM, RULE_COMPILER } from './prompts.js';
import { fmtRelative } from './util.js';

export const describeRule = (r) => {
  const t = store.get('trackers', r.trackerId); const f = t?.fields.find((x) => x.id === r.field);
  if (r.kind === 'threshold') return `When a ${t?.name || 'tracker'} entry has ${f?.label || 'a value'} ${OPS[r.op] || ''} ${r.value}`;
  if (r.kind === 'count') return `${r.count}+ ${t?.name || ''} entries${f ? ` with ${f.label} ${OPS[r.op] || ''} ${r.value}` : ''} within ${r.windowDays} days`;
  if (r.kind === 'streak') return `${r.count} days in a row of ${t?.name || ''}${f ? ` (${f.label} ${OPS[r.op] || ''} ${r.value})` : ''}`;
  return r.byTime ? `No ${t?.name || ''} logged by ${r.byTime}` : `No ${t?.name || ''} logged for ${r.windowDays} days`;
};

export function ruleListHTML(rs, { showTracker = false } = {}) {
  if (!rs.length) return h`<div class="empty"><p>No rules yet. A rule watches your data and speaks up when you tell it to.</p></div>`;
  return h`<div class="stack">${rs.map((r) => h`<div class="card inset"><div class="row between gap"><div class="grow"><b>${r.name}</b>${showTracker ? h` <small class="muted">· ${store.get('trackers', r.trackerId)?.name || ''}</small>` : ''}<div class="small muted">${describeRule(r)}</div><div class="small">→ ${r.message}</div>${r.lastFired ? h`<div class="tiny muted">Last fired ${fmtRelative(r.lastFired)}</div>` : ''}</div>
    <label class="switch" aria-label="Rule on or off"><input type="checkbox" data-rt="${r.id}" ${r.enabled !== false ? 'checked' : ''}><i></i></label></div><div class="row gap end"><button class="btn btn-sm" data-re="${r.id}">Edit</button><button class="btn btn-sm btn-danger-ghost" data-rx="${r.id}">${icon('trash', 14)}</button></div></div>`)}</div>`;
}
/** Wire the list controls (toggle / edit / delete). `after` re-renders the host. */
export function bindRuleList(root, after) {
  root.addEventListener('change', async (e) => { const id = e.target.dataset.rt; if (id) { await store.save('rules', { id, enabled: e.target.checked }); after?.(); } });
  root.addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-re]'); if (ed) { ruleEditor(store.get('rules', ed.dataset.re), { onSaved: after }); return; }
    const x = e.target.closest('[data-rx]'); if (x) { const r = store.get('rules', x.dataset.rx); if (await confirmSheet({ title: 'Delete rule?', message: `“${r.name}” will stop watching.`, confirm: 'Delete', danger: true })) { await store.remove('rules', r.id); toast('Rule deleted', { undo: () => store.restore('rules', r) }); after?.(); } }
  });
}

/** "Describe a rule" sheet. trackerId optional (limits the AI to one tracker). */
export function newRuleSheet({ trackerId = null, onSaved = null } = {}) {
  const trackers = T.allTrackers().filter((t) => !trackerId || t.id === trackerId);
  if (!trackers.length) { toast('Create a tracker first', { tone: 'warn' }); return; }
  const ai = aiReady();
  openSheet({
    title: 'New rule', tall: true,
    body: h`<div class="stack"><p class="muted small">Say what should happen, in your own words. ${ai ? 'LifeOS turns it into a rule and shows it to you first.' : 'AI isn’t available — set the rule up by hand.'}</p>
      <textarea class="input" id="rtxt" rows="3" maxlength="300" placeholder="e.g. If I log less than 6 hours of sleep twice in a week, remind me to keep the evening free." autofocus></textarea>
      <div class="row gap end"><button class="btn" data-manual>Set it up by hand</button><button class="btn btn-primary" data-ai ${ai ? '' : 'disabled'}>${icon('sparkle', 16)} Create rule</button></div></div>`,
    onOpen(s) {
      s.el.querySelector('[data-manual]').onclick = () => { s.close(); ruleEditor({ trackerId: trackerId || trackers[0].id, kind: 'threshold', origin: 'user' }, { onSaved, nl: '' }); };
      s.el.querySelector('[data-ai]').onclick = async (e) => {
        const text = s.el.querySelector('#rtxt').value.trim(); if (text.length < 8) { toast('Describe the rule a bit more', { tone: 'warn' }); return; }
        e.target.disabled = true; e.target.textContent = 'Working…';
        try {
          const r = await askJSON({ system: `${CORE_SYSTEM}\n\n${RULE_COMPILER}`, user: { sentence: text, trackers: trackers.filter((t) => !t.private).map((t) => ({ id: t.id, name: t.name, fields: t.fields.map((f) => ({ id: f.id, label: f.label, type: f.type, unit: f.unit })) })) }, schemaName: 'rule', timeoutMs: 25000 });
          if (r.problem || !r.trackerId) { toast(r.problem || 'I couldn’t match that to one of your trackers.', { tone: 'warn' }); e.target.disabled = false; e.target.textContent = 'Create rule'; return; }
          s.close(); ruleEditor({ ...r, origin: 'ai' }, { onSaved, nl: text, review: true });
        } catch (err) { toast(describeError(err), { tone: 'warn' }); e.target.disabled = false; e.target.textContent = 'Create rule'; }
      };
    },
  });
}

export function ruleEditor(rule, { onSaved = null, nl = '', review = false } = {}) {
  const w = { ...rule }; const editing = !!rule.id;
  const sheet = openSheet({ title: editing ? 'Edit rule' : review ? 'Review your rule' : 'New rule', tall: true, body: '', onOpen: (s) => draw(s) });
  function draw(s) {
    const t = store.get('trackers', w.trackerId); const numeric = (t?.fields || []).filter((f) => T.isNumericField(f) || f.type === 'yesno');
    s.setBody(h`<form class="stack" id="rf2" novalidate>${review ? h`<div class="card inset"><p class="small">“${nl}”</p><p class="tiny muted">Check that this matches what you meant.</p></div>` : ''}
      ${field('Tracker', h`<select class="input" data-p="trackerId" data-redraw>${T.allTrackers().map((x) => h`<option value="${x.id}" ${w.trackerId === x.id ? 'selected' : ''}>${x.name}</option>`)}</select>`)}
      ${field('When', h`<select class="input" data-p="kind" data-redraw>${Object.entries(KINDS).map(([k, l]) => h`<option value="${k}" ${w.kind === k ? 'selected' : ''}>${l}</option>`)}</select>`)}
      ${w.kind !== 'missing' ? h`<div class="grid3"><label class="field"><span class="field-label">Value</span><select class="input" data-p="field"><option value="">any entry</option>${numeric.map((f) => h`<option value="${f.id}" ${w.field === f.id ? 'selected' : ''}>${f.label}</option>`)}</select></label>
        <label class="field"><span class="field-label">Is</span><select class="input" data-p="op">${['', ...Object.keys(OPS)].map((o) => h`<option value="${o}" ${w.op === o ? 'selected' : ''}>${o ? OPS[o] : '—'}</option>`)}</select></label>
        <label class="field"><span class="field-label">Number</span><input class="input" type="number" step="any" data-p="value" value="${w.value ?? ''}"></label></div>` : ''}
      ${w.kind === 'count' ? h`<div class="grid2">${field('At least this many times', h`<input class="input" type="number" min="1" data-p="count" value="${w.count || 2}">`)}${field('Within (days)', h`<input class="input" type="number" min="1" max="60" data-p="windowDays" value="${w.windowDays || 7}">`)}</div>` : ''}
      ${w.kind === 'streak' ? field('Days in a row', h`<input class="input" type="number" min="1" max="60" data-p="count" value="${w.count || 3}">`) : ''}
      ${w.kind === 'missing' ? h`<div class="grid2">${field('Not logged by (time)', h`<input class="input" type="time" data-p="byTime" value="${w.byTime || ''}">`)}${field('…or for (days)', h`<input class="input" type="number" min="1" max="60" data-p="windowDays" value="${w.windowDays || 2}">`)}</div><p class="tiny muted">Use a time for “by 3pm today”, or leave it empty to count days.</p>` : ''}
      ${field('Message', h`<input class="input" data-p="message" value="${w.message || ''}" maxlength="160" placeholder="What should I tell you?">`, 'You can use {value}, {count} and {tracker}.')}
      ${field('Name (optional)', h`<input class="input" data-p="name" value="${w.name || ''}" maxlength="60">`)}
      <p class="form-error" id="re2" role="alert"></p><div class="row gap end"><button type="button" class="btn" data-x>Cancel</button><button class="btn btn-primary" type="submit">Save rule</button></div></form>`);
    s.el.querySelector('[data-x]').onclick = s.close;
    s.el.oninput = (e) => { const p = e.target.dataset.p; if (p && e.target.dataset.redraw === undefined) w[p] = e.target.value; };
    s.el.onchange = (e) => { const p = e.target.dataset.p; if (p) { w[p] = e.target.value; if (e.target.dataset.redraw !== undefined) { if (p === 'trackerId') w.field = ''; draw(s); } } };
    s.el.querySelector('#rf2').onsubmit = async (e) => {
      e.preventDefault(); const n = normalizeRule({ ...w, nl: nl || w.nl }, w.trackerId);
      if (!n.ok) { s.el.querySelector('#re2').textContent = n.errors[0]; return; }
      await store.save('rules', { ...(editing ? { id: rule.id } : {}), ...n.rule }); s.close(); toast(editing ? 'Rule saved' : 'Rule created — I’ll watch for it'); onSaved?.();
    };
  }
  return sheet;
}
export { allRules, rulesFor };
