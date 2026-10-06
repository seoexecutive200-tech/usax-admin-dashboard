// Today's tip card, the "Tips & reminders" settings sheet, and optional AI tips tailored to what you track.
import { store } from './store.js';
import * as Tp from './tips.js';
import { h, icon, openSheet, toast } from './ui.js';
import { aiReady, askJSON, describeError } from './groq.js';
import { CORE_SYSTEM, TIPS_PERSONAL } from './prompts.js';
import { buildContext } from './ai-context.js';
import { uid } from './util.js';

let skip = 0;
export function tipsCard() {
  const c = Tp.config(); if (!c.on) return '';
  const t = Tp.tipOfDay(new Date(), skip); if (!t) return '';
  return h`<section class="card tip-card"><div class="row between center"><div class="eyebrow">${icon('sparkle', 12)} Daily tip · ${Tp.CATEGORIES[t.cat]}</div><button class="link" data-act="tips-open">Tips & reminders</button></div>
    <p>${t.text}</p><div class="row gap wrap"><button class="btn btn-sm" data-act="tip-next">Another tip</button><button class="btn btn-sm" data-act="tip-remind" data-text="${t.text}" data-cat="${t.cat}">Remind me daily</button></div>
    <p class="tiny muted">${Tp.DISCLAIMER}</p></section>`;
}
export const nextTip = () => { skip += 1; };

const timeInput = (id, v, label) => h`<input class="input slim-time" type="time" data-t="${id}" value="${v}" aria-label="${label}">`;
export function tipsSheet() {
  const draw = (s) => {
    const c = Tp.config();
    s.setBody(h`<div class="stack">
      <label class="check"><input type="checkbox" data-on ${c.on ? 'checked' : ''}><span><b>Show daily tips and general reminders</b><br><small class="muted">Simple, widely known wellbeing habits. Nothing here uses your health data.</small></span></label>
      <div class="eyebrow">Topics</div><div class="chips">${Object.entries(Tp.CATEGORIES).map(([k, l]) => h`<button type="button" class="chip-btn pick ${c.cats.includes(k) ? 'on' : ''}" data-cat="${k}" aria-pressed="${c.cats.includes(k)}">${l}</button>`)}</div>
      <div class="eyebrow">General reminders</div>
      <label class="check"><input type="checkbox" data-remind ${c.remind ? 'checked' : ''}><span>Send these as notifications (they respect your quiet hours)</span></label>
      ${Tp.PRESETS.map((p) => { const st = c.presets[p.id]; return h`<div class="card inset"><label class="check"><input type="checkbox" data-p="${p.id}" ${st.on ? 'checked' : ''}><span class="grow"><b>${p.text}</b></span></label><div class="row gap wrap">${st.times.map((t, i) => h`<input class="input slim-time" type="time" data-pt="${p.id}" data-i="${i}" value="${t}" aria-label="${p.text} time ${i + 1}">`)}</div></div>`; })}
      <div class="eyebrow">Your own reminders</div>
      ${c.custom.length ? c.custom.map((x) => h`<div class="card inset row between center"><span><b>${x.text}</b><br><small class="muted">${x.time}${x.days?.length ? ` · ${x.days.length} days` : ' · daily'}</small></span><button class="icon-btn" data-del="${x.id}" aria-label="Delete reminder">${icon('trash', 18)}</button></div>`) : h`<p class="small muted">None yet.</p>`}
      <form class="row gap" id="addrem"><input class="input grow" name="text" maxlength="80" placeholder="e.g. Take my vitamins" aria-label="Reminder text" required><input class="input slim-time" type="time" name="time" value="09:00" aria-label="Time" required><button class="btn btn-primary">Add</button></form>
      <div class="eyebrow">Tailored to you</div>
      <button class="btn" data-ai ${aiReady() ? '' : 'disabled'}>${icon('sparkle', 16)} Get tips based on what I track</button><div id="ai-tips"></div>
      <p class="tiny muted">${Tp.DISCLAIMER}</p></div>`);
    const el = s.el; const sv = (patch) => Tp.saveConfig(patch);
    el.querySelector('[data-on]').onchange = async (e) => { await sv({ on: e.target.checked }); };
    el.querySelector('[data-remind]').onchange = async (e) => { await sv({ remind: e.target.checked }); };
    el.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', async () => { const cur = Tp.config().cats; await sv({ cats: cur.includes(b.dataset.cat) ? cur.filter((x) => x !== b.dataset.cat) : [...cur, b.dataset.cat] }); draw(s); }));
    el.querySelectorAll('[data-p]').forEach((i) => i.addEventListener('change', async () => { const c2 = Tp.config(); await sv({ presets: { ...c2.presets, [i.dataset.p]: { ...c2.presets[i.dataset.p], on: i.checked } } }); }));
    el.querySelectorAll('[data-pt]').forEach((i) => i.addEventListener('change', async () => { if (!i.value) return; const c2 = Tp.config(); const p = c2.presets[i.dataset.pt]; const times = [...p.times]; times[Number(i.dataset.i)] = i.value; await sv({ presets: { ...c2.presets, [i.dataset.pt]: { ...p, times } } }); }));
    el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { await sv({ custom: Tp.config().custom.filter((x) => x.id !== b.dataset.del) }); draw(s); }));
    el.querySelector('#addrem').addEventListener('submit', async (e) => { e.preventDefault(); const f = new FormData(e.target); const text = String(f.get('text')).trim().slice(0, 80); const time = String(f.get('time')); if (!text || !time) return; await sv({ custom: [...Tp.config().custom, { id: uid('gr'), text, time, days: [] }] }); toast('Reminder added'); draw(s); });
    el.querySelector('[data-ai]').onclick = async (e) => {
      e.target.disabled = true; const out = el.querySelector('#ai-tips'); out.textContent = 'Thinking…';
      try {
        const r = await askJSON({ system: `${CORE_SYSTEM}\n\n${TIPS_PERSONAL}`, schemaName: 'tips', timeoutMs: 30000, user: { context: buildContext({ trigger: 'tips' }) } });
        out.innerHTML = ''; (r.tips || []).slice(0, 5).forEach((t) => { const card = document.createElement('div'); card.className = 'card inset'; const b = document.createElement('b'); b.textContent = t.title; const p = document.createElement('p'); p.className = 'small'; p.textContent = t.text; card.append(b, p); out.append(card); });
      } catch (err) { out.textContent = describeError(err); }
      e.target.disabled = false;
    };
  };
  openSheet({ title: 'Tips & reminders', tall: true, body: '', onOpen: draw });
}
export async function remindDaily(text, cat) {
  const c = Tp.config(); if (c.custom.some((x) => x.text === text)) { toast('Already a daily reminder'); return; }
  await Tp.saveConfig({ custom: [...c.custom, { id: uid('gr'), text: text.slice(0, 80), time: '10:00', days: [] }] }); toast('Daily reminder added for 10:00 — change it in Tips & reminders');
}
