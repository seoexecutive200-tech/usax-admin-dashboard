// UI for user-defined trackers: cards, logging form, "describe it" builder + editor, templates, CSV and template import/export.
import { store } from './store.js';
import * as T from './trackers.js';
import { normalizeRule } from './rules.js';
import { h, html, icon, openSheet, confirmSheet, toast, spark, bar, ring, field } from './ui.js';
import { commit } from './sheets.js';
import { aiReady, askJSON, describeError, usingHosted } from './groq.js';
import { CORE_SYSTEM, TRACKER_DESIGNER } from './prompts.js';
import { toLocalInput, dayKey, download, safeJSON, nowISO, uid, isNum } from './util.js';
import { navigate } from './router.js';

const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
const colorOf = (t) => T.COLOR_VAR[t.color] || 'var(--blue)';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---------- card (Today pins + Trackers list) ----------
export function trackerCard(t, { compact = false } = {}) {
  const f = T.primaryField(t); const p = f ? T.progress(t, f) : null; const numeric = f && T.isNumericField(f);
  const pts = numeric ? T.series(t, f, 7) : [];
  return h`<div class="card tcard" data-act="trk-open" data-id="${t.id}" role="button" tabindex="0" aria-label="${t.name}"><div class="row gap center"><span class="t-ic lead" style="color:${colorOf(t)}">${icon(t.icon, 22)}</span>
    <div class="grow"><b>${t.name}</b><div class="small muted">${T.summaryLine(t)}</div></div>${compact ? '' : h`<button class="icon-btn" data-act="trk-pin" data-id="${t.id}" aria-label="${t.pinned ? 'Unpin from Today' : 'Pin to Today'}" aria-pressed="${!!t.pinned}">${icon('pin', 18, t.pinned ? 'c-blue' : 'muted')}</button>`}
    <button class="btn btn-sm btn-primary" data-act="trk-log" data-id="${t.id}">${icon('plus', 14)} Log</button></div>
    ${p ? h`${bar(Math.min(1, p.pct), p.dir === 'atmost' ? (p.met ? 'var(--green)' : 'var(--amber)') : (p.met ? 'var(--green)' : colorOf(t)))}` : ''}
    ${numeric && pts.filter((x) => isNum(x.value)).length > 1 ? h`<div class="tspark">${spark(pts, { color: colorOf(t), h: 28 })}</div>` : ''}
    ${f?.quick?.length ? h`<div class="row gap wrap">${f.quick.map((q) => h`<button class="chip-btn" data-act="trk-quick" data-id="${t.id}" data-f="${f.id}" data-v="${q}">+${q}${f.unit ? ` ${f.unit}` : ''}</button>`)}</div>` : ''}</div>`;
}
export async function quickLog(tid, fid, v) { await commit({ type: 'create_entry', payload: { trackerId: tid, values: { [fid]: Number(v) }, source: 'manual' } }, { notify: false }); }

// ---------- logging form ----------
export function entrySheet(t, { entry = null, prefill = {}, source = 'manual', raw = '', onSaved = null } = {}) {
  const vals = { ...(entry?.values || {}), ...prefill }; const multi = t.fields.length > 1;
  const input = (f) => {
    const v = vals[f.id]; const n = `f_${f.id}`;
    if (f.type === 'number' || f.type === 'duration') return h`<div><input class="input" type="number" inputmode="decimal" step="any" name="${n}" value="${v ?? ''}" ${isNum(f.min) ? h`min="${f.min}"` : ''} ${isNum(f.max) ? h`max="${f.max}"` : ''} placeholder="${f.type === 'duration' ? 'minutes' : f.unit || ''}" aria-label="${f.label}">${f.quick?.length ? h`<div class="row gap wrap qk">${f.quick.map((q) => h`<button type="button" class="chip-btn" data-q="${f.id}" data-v="${q}">+${q}</button>`)}</div>` : ''}</div>`;
    if (f.type === 'scale') { const max = f.max || 10; return h`<div class="slider ${v === undefined && multi ? 'untouched' : ''}"><input type="range" name="${n}" min="1" max="${max}" step="1" value="${v ?? Math.ceil(max / 2)}" data-touch="${v !== undefined ? 1 : 0}" aria-label="${f.label}"><output>${v ?? (multi ? '–' : Math.ceil(max / 2))}</output></div>`; }
    if (f.type === 'rating') return h`<div class="rate" role="radiogroup" aria-label="${f.label}">${[1, 2, 3, 4, 5].map((k) => h`<button type="button" class="rate-btn ${v === k ? 'on' : ''}" data-rate="${f.id}" data-v="${k}">${k}</button>`)}<input type="hidden" name="${n}" value="${v ?? ''}"></div>`;
    if (f.type === 'yesno') { const cur = v === undefined ? true : v === true; return h`<div class="seg" data-seg="${n}"><button type="button" class="seg-btn ${cur ? 'on' : ''}" data-v="1">Yes</button><button type="button" class="seg-btn ${!cur ? 'on' : ''}" data-v="0">No</button></div>`; }
    if (f.type === 'choice') return h`<select class="input" name="${n}" aria-label="${f.label}"><option value="">Choose…</option>${(f.options || []).map((o) => h`<option ${v === o ? 'selected' : ''}>${o}</option>`)}</select>`;
    return h`<textarea class="input" rows="2" name="${n}" maxlength="400" aria-label="${f.label}">${v ?? ''}</textarea>`;
  };
  openSheet({
    title: entry ? `Edit ${t.name}` : `Log ${t.name}`, tall: t.fields.length > 2,
    body: h`<form class="stack" id="ef" novalidate>${t.fields.map((f) => h`<div class="field"><span class="field-label">${f.label}${f.unit ? ` (${f.unit})` : ''}</span>${input(f)}</div>`)}
      ${field('When', h`<input class="input" type="datetime-local" name="ts" value="${toLocalInput(entry?.ts || new Date())}">`)}${field('Note (optional)', h`<input class="input" name="note" maxlength="300" value="${entry?.note || ''}">`)}
      <p class="form-error" id="ee" role="alert"></p><div class="row gap end">${entry ? h`<button type="button" class="btn btn-danger-ghost" data-del>${icon('trash', 16)}</button>` : ''}<button type="button" class="btn" data-x>Cancel</button><button class="btn btn-primary" type="submit">Save</button></div></form>`,
    onOpen(s) {
      const f$ = s.el.querySelector('#ef'); s.el.querySelector('[data-x]').onclick = s.close;
      s.el.addEventListener('click', (e) => {
        const q = e.target.closest('[data-q]'); if (q) { const i = f$.elements[`f_${q.dataset.q}`]; i.value = String((Number(i.value) || 0) + Number(q.dataset.v)); }
        const r = e.target.closest('[data-rate]'); if (r) { f$.elements[`f_${r.dataset.rate}`].value = r.dataset.v; r.parentElement.querySelectorAll('.rate-btn').forEach((b) => b.classList.toggle('on', b === r)); }
        const sb = e.target.closest('.seg-btn'); if (sb) { sb.parentElement.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('on', b === sb)); }
      });
      s.el.querySelectorAll('.slider input').forEach((i) => i.addEventListener('input', () => { i.dataset.touch = '1'; i.nextElementSibling.textContent = i.value; i.parentElement.classList.remove('untouched'); i.style.setProperty('--p', `${((i.value - i.min) / (i.max - i.min)) * 100}%`); }));
      s.el.querySelector('[data-del]')?.addEventListener('click', async () => { if (await confirmSheet({ title: 'Delete this entry?', message: 'It will be removed. You can undo right after.', confirm: 'Delete', danger: true })) { s.close(); await commit({ type: 'delete_entry', payload: { id: entry.id } }, { notify: false }); } });
      f$.addEventListener('submit', async (e) => {
        e.preventDefault(); const fd = new FormData(f$); const values = {};
        for (const f of t.fields) {
          const n = `f_${f.id}`;
          if (f.type === 'yesno') values[f.id] = s.el.querySelector(`[data-seg="${n}"] .seg-btn.on`)?.dataset.v === '1';
          else if (f.type === 'scale') { const i = f$.elements[n]; if (i.dataset.touch === '1' || !multi) values[f.id] = Number(i.value); }
          else { const v = String(fd.get(n) ?? '').trim(); if (v !== '') values[f.id] = v; }
        }
        const ts = new Date(fd.get('ts')); if (isNaN(ts)) { s.el.querySelector('#ee').textContent = 'Pick a valid time.'; return; }
        s.close();
        const res = await commit(entry ? { type: 'update_entry', payload: { id: entry.id, values, note: fd.get('note'), ts: ts.toISOString() } } : { type: 'create_entry', payload: { trackerId: t.id, values, note: fd.get('note'), ts: ts.toISOString(), source, raw } }, { notify: false });
        if (res) onSaved?.(res.record);
      });
    },
  });
}

// ---------- builder: describe it ----------
export function builderSheet({ text = '' } = {}) {
  const ai = aiReady();
  openSheet({
    title: 'New tracker', tall: true,
    body: h`<div class="stack"><p class="muted small">Describe anything you want to keep track of, in your own words. ${ai ? 'LifeOS will design the tracker; you review and edit it before anything is saved.' : 'AI isn’t available, so build it yourself or start from a template.'}</p>
      <textarea class="input" id="desc" rows="5" maxlength="600" placeholder="e.g. I’m training for a half marathon — log my runs (distance and how hard it felt), sore spots, and remind me to rest if I run four days in a row." autofocus>${text}</textarea>
      <div class="row between"><div>${SR ? h`<button type="button" class="icon-btn" data-mic aria-label="Dictate">${icon('mic', 22)}</button>` : ''}</div><div class="row gap wrap end"><button class="btn" data-manual>Build it myself</button><button class="btn btn-primary" data-ai ${ai ? '' : 'disabled'}>${icon('sparkle', 16)} Design it</button></div></div>
      ${usingHosted() ? h`<p class="tiny muted">Uses your included AI (limited per day).</p>` : ''}
      <div class="eyebrow">Or start from a template</div><div class="tpl-grid">${T.TEMPLATES.map((tp, i) => h`<button class="list-btn" data-tpl="${i}"><span class="t-ic lead" style="color:${T.COLOR_VAR[tp.color]}">${icon(tp.icon, 20)}</span><span><b>${tp.name}</b><small>${tp.description}</small></span></button>`)}</div>
      <button class="link" data-import>${icon('upload', 14)} Import a shared template</button><input type="file" id="tplfile" accept="application/json,.json" hidden></div>`,
    onOpen(s) {
      const ta = s.el.querySelector('#desc');
      s.el.querySelector('[data-manual]').onclick = () => { s.close(); editorSheet({ name: ta.value.trim().slice(0, 40), fields: [{ label: 'Value', type: 'number' }] }); };
      s.el.querySelector('[data-ai]').onclick = async (e) => {
        const d = ta.value.trim(); if (d.length < 8) { toast('Say a little more about what you want to track', { tone: 'warn' }); return; }
        e.target.disabled = true; e.target.textContent = 'Designing…';
        try {
          const r = await askJSON({ system: `${CORE_SYSTEM}\n\n${TRACKER_DESIGNER}`, user: { description: d, existingTrackers: T.allTrackers().map((t) => t.name), builtInSupported: true }, schemaName: 'tracker', timeoutMs: 30000 });
          const draft = { ...r, origin: 'ai', fields: r.fields.map((f) => ({ ...f, target: f.targetValue > 0 ? { value: f.targetValue, period: f.targetPeriod, dir: f.targetDir } : null })) };
          s.close(); editorSheet(draft, { aiNote: r.note, rulesDraft: r.rules, nl: d });
        } catch (err) { toast(describeError(err), { tone: 'warn' }); e.target.disabled = false; e.target.innerHTML = ''; e.target.append('Design it'); }
      };
      s.el.querySelectorAll('[data-tpl]').forEach((b) => b.addEventListener('click', () => { const tp = T.TEMPLATES[Number(b.dataset.tpl)]; s.close(); editorSheet({ ...structuredClone(tp), origin: 'template' }, { fromTemplate: true }); }));
      s.el.querySelector('[data-import]').onclick = () => s.el.querySelector('#tplfile').click();
      s.el.querySelector('#tplfile').addEventListener('change', async (e) => { const f = e.target.files[0]; if (f) { try { const spec = await readTemplateFile(f); s.close(); editorSheet(spec.tracker, { rulesDraft: spec.rules, fromTemplate: true }); } catch (err) { toast(err.message, { tone: 'warn' }); } } });
      const mic = s.el.querySelector('[data-mic]');
      mic?.addEventListener('click', () => { const r = new SR(); r.lang = store.profile().locale || 'en-US'; r.onresult = (ev) => { ta.value = `${ta.value} ${ev.results[0][0].transcript}`.trim(); }; r.onend = () => mic.classList.remove('rec'); mic.classList.add('rec'); try { r.start(); } catch { mic.classList.remove('rec'); } });
    },
  });
}

// ---------- editor (create / edit) ----------
const setPath = (o, path, v) => { const k = path.split('.'); let c = o; for (let i = 0; i < k.length - 1; i++) c = c[k[i]]; c[k[k.length - 1]] = v; };
export function editorSheet(draft, { existing = null, aiNote = '', rulesDraft = [], nl = '', fromTemplate = false } = {}) {
  const w = structuredClone(draft); w.fields ||= []; w.reminders ||= []; w.keywords = Array.isArray(w.keywords) ? w.keywords.join(', ') : (w.keywords || '');
  w.fields.forEach((f) => { if (Array.isArray(f.options)) f.options = f.options.join(', '); if (Array.isArray(f.quick)) f.quick = f.quick.join(', '); });
  let rules = (rulesDraft || []).slice(0, 5);
  const sheet = openSheet({ title: existing ? 'Edit tracker' : fromTemplate ? 'Review template' : 'Review your tracker', tall: true, body: '', onOpen: (s) => draw(s) });
  function draw(s) {
    const F = (f, i) => h`<div class="card inset fld" data-i="${i}"><div class="grid2">${field('What', h`<input class="input" data-p="fields.${i}.label" value="${f.label || ''}" maxlength="40">`)}${field('Type', h`<select class="input" data-p="fields.${i}.type" data-redraw>${Object.entries(T.FIELD_TYPES).map(([k, l]) => h`<option value="${k}" ${f.type === k ? 'selected' : ''}>${l}</option>`)}</select>`)}</div>
      ${f.type === 'number' || f.type === 'duration' ? h`<div class="grid2">${field('Unit', h`<input class="input" data-p="fields.${i}.unit" value="${f.unit || ''}" maxlength="12" placeholder="${f.type === 'duration' ? 'min' : 'kg, ml, pages…'}">`)}${field('One-tap amounts', h`<input class="input" data-p="fields.${i}.quick" value="${f.quick || ''}" placeholder="250, 500">`)}</div>` : ''}
      ${f.type === 'scale' ? field('Scale tops out at', h`<select class="input" data-p="fields.${i}.max">${[5, 7, 10].map((n) => h`<option ${Number(f.max || 10) === n ? 'selected' : ''}>${n}</option>`)}</select>`) : ''}
      ${f.type === 'choice' ? field('Choices (comma separated)', h`<input class="input" data-p="fields.${i}.options" value="${f.options || ''}" placeholder="Run, Strength, Yoga">`) : ''}
      <div class="stack">${field('Each day, show the', h`<select class="input" data-p="fields.${i}.agg">${Object.entries(T.AGGS).map(([k, l]) => h`<option value="${k}" ${f.agg === k ? 'selected' : ''}>${l.toLowerCase()}</option>`)}</select>`)}
      ${f.type === 'number' || f.type === 'duration' || f.type === 'yesno' ? field('Target (optional)', h`<div class="row gap"><input class="input" type="number" step="any" data-p="fields.${i}.target.value" value="${f.target?.value ?? ''}" placeholder="none" aria-label="Target" style="min-width:0;flex:1.3"><select class="input" data-p="fields.${i}.target.dir" aria-label="Direction" style="min-width:0;flex:1.2"><option value="atleast" ${f.target?.dir !== 'atmost' ? 'selected' : ''}>at least</option><option value="atmost" ${f.target?.dir === 'atmost' ? 'selected' : ''}>at most</option></select><select class="input" data-p="fields.${i}.target.period" aria-label="Period" style="min-width:0;flex:1"><option value="day" ${f.target?.period !== 'week' ? 'selected' : ''}>/ day</option><option value="week" ${f.target?.period === 'week' ? 'selected' : ''}>/ week</option></select></div>`) : h`<div></div>`}</div>
      ${w.fields.length > 1 ? h`<button type="button" class="btn btn-sm btn-danger-ghost" data-rmf="${i}">${icon('trash', 14)} Remove</button>` : ''}</div>`;
    s.setBody(h`<form class="stack" id="tf" novalidate>
      ${aiNote ? h`<div class="card inset"><div class="eyebrow">${icon('sparkle', 12)} Designed for you</div><p class="small">${aiNote}</p><p class="tiny muted">Nothing is saved until you press Save. Change anything you like.</p></div>` : ''}
      <div class="grid2">${field('Name', h`<input class="input" data-p="name" value="${w.name || ''}" maxlength="40" autofocus>`)}${field('Icon', h`<select class="input" data-p="icon">${T.ICON_KEYS.map((k) => h`<option ${w.icon === k ? 'selected' : ''}>${k}</option>`)}</select>`)}</div>
      <div class="field"><span class="field-label">Colour</span><div class="swatches">${T.COLORS.map((c) => h`<button type="button" class="swatch ${w.color === c ? 'on' : ''}" data-color="${c}" style="background:${T.COLOR_VAR[c]}" aria-label="${c}" aria-pressed="${w.color === c}"></button>`)}</div></div>
      ${field('Description (optional)', h`<input class="input" data-p="description" value="${w.description || ''}" maxlength="200">`)}
      <div class="eyebrow">What to record</div>${w.fields.map(F)}<button type="button" class="btn btn-sm" data-addf>${icon('plus', 14)} Add another thing</button>
      ${field('Words that mean this tracker', h`<input class="input" data-p="keywords" value="${w.keywords || ''}" placeholder="run, ran, jog" >`, 'When you type these in Capture, entries go here automatically.')}
      <div class="eyebrow">Reminders (optional)</div>${(w.reminders || []).map((r, i) => h`<div class="card inset"><div class="row gap center"><input class="input" type="time" data-p="reminders.${i}.time" value="${r.time || ''}" style="width:auto"><input class="input" data-p="reminders.${i}.text" value="${r.text || ''}" placeholder="Message (optional)"><button type="button" class="icon-btn" data-rmr="${i}" aria-label="Remove reminder">${icon('x', 16)}</button></div><div class="days">${[1, 2, 3, 4, 5, 6, 0].map((d) => h`<button type="button" class="day-chip ${(r.days || [0, 1, 2, 3, 4, 5, 6]).includes(d) ? 'on' : ''}" data-rd="${i}:${d}" aria-pressed="${(r.days || [0, 1, 2, 3, 4, 5, 6]).includes(d)}">${DAYS[d]}</button>`)}</div></div>`)}<button type="button" class="btn btn-sm" data-addr>${icon('plus', 14)} Add a reminder</button>
      ${rules.length ? h`<div class="eyebrow">Rules designed from your description</div>${rules.map((r, i) => h`<div class="card inset row between gap"><span class="small">${r.message || r.name}</span><button type="button" class="icon-btn" data-rmrule="${i}" aria-label="Remove rule">${icon('x', 16)}</button></div>`)}` : ''}
      <label class="check"><input type="checkbox" data-c="pinned" ${w.pinned !== false ? 'checked' : ''}><span>Show on Today</span></label>
      <label class="check"><input type="checkbox" data-c="private" ${w.private ? 'checked' : ''}><span>Keep private from AI (never sent in requests)</span></label>
      <p class="form-error" id="te" role="alert"></p><div class="row gap end"><button type="button" class="btn" data-x>Cancel</button><button class="btn btn-primary" type="submit">${existing ? 'Save' : 'Create tracker'}</button></div></form>`);
    bind(s);
  }
  function bind(s) {
    const el = s.el; const err = (m) => { el.querySelector('#te').textContent = m; };
    el.querySelector('[data-x]').onclick = s.close;
    el.oninput = (e) => { const p = e.target.dataset.p; if (!p) return; const parts = p.split('.'); try { if (parts[0] === 'fields' && parts[2] === 'target') { const f = w.fields[Number(parts[1])]; f.target ||= {}; f.target[parts[3]] = e.target.value; } else setPath(w, p, e.target.value); } catch { /* ignore */ } };
    el.onchange = (e) => { if (e.target.dataset.redraw !== undefined) { setPath(w, e.target.dataset.p, e.target.value); const f = w.fields[Number(e.target.dataset.p.split('.')[1])]; f.agg = ({ number: 'avg', scale: 'avg', duration: 'sum', rating: 'avg', yesno: 'count', choice: 'count', text: 'count' })[f.type]; draw(s); } const c = e.target.dataset.c; if (c) w[c] = e.target.checked; };
    el.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.color) { w.color = b.dataset.color; draw(s); }
      else if (b.dataset.addf !== undefined) { w.fields.push({ label: '', type: 'number' }); draw(s); }
      else if (b.dataset.rmf) { w.fields.splice(Number(b.dataset.rmf), 1); draw(s); }
      else if (b.dataset.addr !== undefined) { w.reminders.push({ time: '09:00', days: [0, 1, 2, 3, 4, 5, 6], text: '' }); draw(s); }
      else if (b.dataset.rmr) { w.reminders.splice(Number(b.dataset.rmr), 1); draw(s); }
      else if (b.dataset.rd) { const [i, d] = b.dataset.rd.split(':').map(Number); const r = w.reminders[i]; r.days = r.days || [0, 1, 2, 3, 4, 5, 6]; r.days = r.days.includes(d) ? r.days.filter((x) => x !== d) : [...r.days, d]; b.classList.toggle('on'); }
      else if (b.dataset.rmrule) { rules.splice(Number(b.dataset.rmrule), 1); draw(s); }
    };
    el.querySelector('#tf').onsubmit = async (e) => {
      e.preventDefault(); const { ok, errors, spec } = T.normalizeTracker({ ...w, origin: w.origin || 'user' });
      if (!ok) return err(errors[0]);
      let rec;
      if (existing) rec = await store.save('trackers', { ...existing, ...spec, id: existing.id, origin: existing.origin });
      else rec = await store.save('trackers', { ...spec, order: store.all('trackers').length });
      if (!existing) for (const r of rules) { const f = rec.fields.find((x) => x.label.toLowerCase() === String(r.fieldLabel || '').toLowerCase()); const n = normalizeRule({ ...r, field: f?.id || '', trackerId: rec.id, origin: 'ai', nl }); if (n.ok) await store.save('rules', { ...n.rule, enabled: true }); }
      s.close(); toast(existing ? 'Tracker saved' : `“${rec.name}” created`); if (!existing) navigate(`#/tracker/${rec.id}`);
    };
  }
  return sheet;
}

// ---------- templates: share without data ----------
export function exportTemplate(t) {
  const { id, createdAt, updatedAt, schemaVersion, pinned, archived, order, ...spec } = t;
  spec.fields = spec.fields.map(({ id: _i, ...f }) => f);
  download(`lifeos-template-${t.name.replace(/[^\w-]+/g, '_').slice(0, 30) || 'tracker'}.json`, JSON.stringify({ app: 'LifeOS', type: 'tracker-template', version: 1, tracker: spec, rules: (store.all('rules').filter((r) => r.trackerId === t.id)).map((r) => ({ name: r.name, kind: r.kind, fieldLabel: t.fields.find((f) => f.id === r.field)?.label || '', op: r.op, value: r.value, windowDays: r.windowDays, count: r.count, byTime: r.byTime, message: r.message })) }, null, 2));
}
export async function readTemplateFile(file) {
  if (file.size > 100_000) throw new Error('That file is too big to be a template.');
  const j = safeJSON(await file.text(), null);
  if (!j || j.app !== 'LifeOS' || j.type !== 'tracker-template' || !j.tracker) throw new Error('This isn’t a LifeOS template.');
  const n = T.normalizeTracker({ ...j.tracker, origin: 'template', archived: false }); // sanitised: only known field types, clipped text
  return { tracker: n.spec, rules: (Array.isArray(j.rules) ? j.rules : []).slice(0, 5) };
}

// ---------- CSV ----------
export function parseCSV(text) {
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; } else cur += c;
  }
  row.push(cur); if (row.some((x) => x !== '')) rows.push(row); return rows;
}
export function csvExport(t) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['timestamp', ...t.fields.map((f) => f.label), 'note'].map(q).join(',')];
  for (const e of [...T.entriesOf(t.id)].reverse()) lines.push([e.ts, ...t.fields.map((f) => e.values?.[f.id] ?? ''), e.note || ''].map(q).join(','));
  download(`${t.name.replace(/[^\w-]+/g, '_')}.csv`, lines.join('\n'), 'text/csv');
}
export function csvImportSheet(t) {
  openSheet({
    title: `Import into ${t.name}`, tall: true,
    body: h`<div class="stack"><p class="muted small">Choose a CSV file. You’ll match its columns to this tracker before anything is imported.</p><input type="file" id="csv" accept=".csv,text/csv" class="input"><div id="map"></div></div>`,
    onOpen(s) {
      s.el.querySelector('#csv').addEventListener('change', async (e) => {
        const f = e.target.files[0]; if (!f) return; if (f.size > 3_000_000) { toast('That file is too large (3 MB max)', { tone: 'warn' }); return; }
        const rows = parseCSV(await f.text()); if (rows.length < 2) { toast('No data rows found', { tone: 'warn' }); return; }
        const head = rows[0].map((x) => x.trim()); const body = rows.slice(1, 5001); const guess = (re) => head.findIndex((x) => re.test(x));
        const opt = (sel) => h`<option value="-1">— none —</option>${head.map((x, i) => h`<option value="${i}" ${sel === i ? 'selected' : ''}>${x || `Column ${i + 1}`}</option>`)}`;
        const tsGuess = guess(/date|time|when|timestamp/i);
        s.el.querySelector('#map').innerHTML = html(h`<div class="stack"><label class="field"><span class="field-label">Date / time column</span><select class="input" id="m_ts">${opt(tsGuess)}</select></label>
          ${t.fields.map((fl) => h`<label class="field"><span class="field-label">${fl.label}</span><select class="input" data-mf="${fl.id}">${opt(head.findIndex((x) => x.toLowerCase() === fl.label.toLowerCase()))}</select></label>`)}
          <p class="small muted">${body.length} row${body.length === 1 ? '' : 's'} found${rows.length - 1 > 5000 ? ' (first 5,000 will be imported)' : ''}. Imported entries don’t trigger rules.</p><p class="form-error" id="ce" role="alert"></p><button class="btn btn-primary" id="go">Import</button></div>`);
        s.el.querySelector('#go').onclick = async () => {
          const ti = Number(s.el.querySelector('#m_ts').value); const map = [...s.el.querySelectorAll('[data-mf]')].map((x) => ({ f: t.fields.find((fl) => fl.id === x.dataset.mf), i: Number(x.value) })).filter((m) => m.i >= 0);
          if (ti < 0) { s.el.querySelector('#ce').textContent = 'Pick the column with the date or time.'; return; } if (!map.length) { s.el.querySelector('#ce').textContent = 'Match at least one column to a field.'; return; }
          let ok = 0; let skipped = 0; const recs = [];
          for (const r of body) {
            const d = new Date(r[ti]); if (isNaN(d)) { skipped++; continue; }
            const values = {};
            for (const m of map) { let v = (r[m.i] ?? '').trim(); if (v === '') continue; if (m.f.type === 'yesno') v = /^(1|y|yes|true|done|x)$/i.test(v); else if (m.f.type === 'text') v = v.slice(0, 400); else if (m.f.type === 'choice') { if (!(m.f.options || []).includes(v)) continue; } else { v = Number(v.replace(',', '.')); if (!isNum(v)) continue; } values[m.f.id] = v; }
            if (!Object.keys(values).length) { skipped++; continue; }
            recs.push({ trackerId: t.id, ts: d.toISOString(), values, note: '', source: 'import' }); ok++;
          }
          await store.saveMany('entries', recs); s.close(); toast(`Imported ${ok} entr${ok === 1 ? 'y' : 'ies'}${skipped ? ` (${skipped} skipped)` : ''}`);
        };
      });
    },
  });
}
