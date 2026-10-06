// Describe routines in your own words ("gym Mon/Wed/Fri 7–8, wind down 10:30pm weekdays") and review them before saving.
// With AI: the model proposes structured routines. Without it: a simple local reader handles "name, days, times".
import { store } from './store.js';
import * as R from './routines.js';
import { h, icon, openSheet, toast } from './ui.js';
import { aiReady, askJSON, describeError, usingHosted } from './groq.js';
import { CORE_SYSTEM, ROUTINE_DESIGNER } from './prompts.js';

const hhmm = (v, d) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim()); if (!m) return d; const H = Number(m[1]), M = Number(m[2]); return H < 24 && M < 60 ? `${String(H).padStart(2, '0')}:${m[2]}` : d; };
const mins = (t) => { const [a, b] = t.split(':').map(Number); return a * 60 + b; };
const clamp = (n, lo, hi, d) => { n = Math.round(Number(n)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

/** Validates one proposed routine (from AI or the local reader) into a routine spec; returns null if unusable. */
export function normalizeDraft(x) {
  const name = String(x?.name || '').replace(/\s+/g, ' ').trim().slice(0, 40); if (!name) return null;
  const days = [...new Set((Array.isArray(x.days) ? x.days : []).map(Number).filter((d) => d >= 0 && d <= 6))]; if (!days.length) return null;
  const start = hhmm(x.start, null), end = hhmm(x.end, null); if (!start || !end || mins(end) <= mins(start)) return null;
  const n = x.nudges || {}; const inWin = (t) => mins(t) > mins(start) && mins(t) <= mins(end);
  const custom = (Array.isArray(x.reminders) ? x.reminders : n.custom || []).map((c) => ({ at: hhmm(c?.time ?? c?.at, null), text: String(c?.text || '').replace(/\s+/g, ' ').trim().slice(0, 60) })).filter((c) => c.at && c.text && inWin(c.at)).slice(0, 8);
  const long = mins(end) - mins(start) >= 240; const on = (v, d) => (v === undefined || v === null ? d : !!v);
  return { name, days, start, end, assume: !!x.assume, nudges: {
    water: { on: on(x.water ?? n.water?.on, long), every: clamp(x.waterEvery ?? n.water?.every, 20, 240, 60) },
    break: { on: on(x.breaks ?? n.break?.on, long), every: clamp(x.breakEvery ?? n.break?.every, 20, 240, 90), len: clamp(n.break?.len, 5, 30, 10) },
    lunch: { on: on(x.lunch ?? n.lunch?.on, false), at: hhmm(x.lunchAt ?? n.lunch?.at, '13:30') },
    eyes: { on: on(x.eyes ?? n.eyes?.on, false), every: clamp(n.eyes?.every, 20, 120, 30) },
    wrap: { on: on(x.wrap ?? n.wrap?.on, false) }, custom } };
}

// ---- local reader (no AI) ----
const DAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
export function parseRoutineText(text) {
  const t = ` ${String(text).toLowerCase()} `; let days = [];
  const rng = /(sun|mon|tue|wed|thu|fri|sat)\w*\s*(?:-|–|to|through|thru)\s*(sun|mon|tue|wed|thu|fri|sat)\w*/.exec(t);
  if (rng) { let a = DAYS[rng[1]]; const b = DAYS[rng[2]]; for (let i = 0; i < 7; i++) { days.push(a); if (a === b) break; a = (a + 1) % 7; } }
  else if (/weekdays?/.test(t)) days = [1, 2, 3, 4, 5]; else if (/weekends?/.test(t)) days = [6, 0]; else if (/every ?day|daily/.test(t)) days = [0, 1, 2, 3, 4, 5, 6];
  else for (const m of t.matchAll(/\b(sun|mon|tue|wed|thu|fri|sat)\w*/g)) days.push(DAYS[m[1]]);
  const tm = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/.exec(t); if (!tm || !days.length) return null;
  let h1 = Number(tm[1]), h2 = Number(tm[4]); const m1 = tm[2] || '00', m2 = tm[5] || '00';
  if (tm[3] === 'pm' && h1 < 12) h1 += 12; if (tm[3] === 'am' && h1 === 12) h1 = 0;
  if (tm[6] === 'pm' && h2 < 12) h2 += 12; if (tm[6] === 'am' && h2 === 12) h2 = 0;
  if (!tm[3] && !tm[6] && h2 <= h1) h2 += 12; // “10 to 6” means 10am–6pm
  const name = (/\b(office|gym|study|work|class|school|shift|workout|reading|commute|focus)\b/.exec(t)?.[1] || 'Routine').replace(/^./, (c) => c.toUpperCase());
  return normalizeDraft({ name, days, start: `${h1}:${m1}`, end: `${h2}:${m2}` });
}

export const summary = (d) => `${R.DAY_ORDER.filter((x) => d.days.includes(x)).map((x) => R.DAY_NAMES[x]).join(', ')} · ${R.fmtHM(d.start)}–${R.fmtHM(d.end)}`;
const guidance = (d) => [d.nudges.water.on && `water every ${d.nudges.water.every} min`, d.nudges.break.on && `break every ${d.nudges.break.every} min`, d.nudges.lunch.on && `lunch ${R.fmtHM(d.nudges.lunch.at)}`, d.nudges.eyes.on && 'eye rests', d.nudges.wrap.on && 'wrap-up', ...d.nudges.custom.map((c) => `${R.fmtHM(c.at)} ${c.text}`)].filter(Boolean).join(' · ') || 'No guidance — just the schedule';

export function describeRoutineSheet({ text = '', auto = false } = {}) {
  openSheet({ title: 'Describe your routine', tall: true,
    body: h`<div class="stack"><p class="muted small">Say it the way you’d tell a friend. You can include several routines, reminders and guidance — you’ll review everything before it’s saved.</p>
      <textarea class="input" id="rdesc" rows="4" maxlength="800" placeholder="e.g. Office Mon–Sat 10 to 6 with water and a break every 90 minutes. Gym Mon, Wed, Fri 7–8am. Wind-down weekdays 10–11:30pm, remind me to put the phone away at 11."></textarea>
      <div class="row gap wrap"><button class="btn btn-primary" data-go>${icon('sparkle', 16)} ${aiReady() ? 'Build it' : 'Read it'}</button></div>
      ${aiReady() ? (usingHosted() ? h`<p class="tiny muted">Uses your included AI (limited per day).</p>` : '') : h`<p class="tiny muted">AI is off, so I’ll read simple descriptions like “gym Mon–Fri 7 to 8am” myself. Turn AI on under You for fuller descriptions.</p>`}
      <div id="rres"></div></div>`,
    onOpen(s) {
      const ta = s.el.querySelector('#rdesc'); const out = s.el.querySelector('#rres'); const go = s.el.querySelector('[data-go]');
      const render = (drafts, note) => {
        out.innerHTML = '';
        if (!drafts.length) { const p = document.createElement('p'); p.className = 'form-error'; p.textContent = 'I couldn’t find a routine in that. Try including days and times, like “Office Mon–Sat 10 to 6”.'; out.append(p); return; }
        const box = document.createElement('div'); box.className = 'stack';
        const eb = document.createElement('div'); eb.className = 'eyebrow'; eb.textContent = 'Review before saving'; box.append(eb);
        drafts.forEach((d) => {
          const lab = document.createElement('label'); lab.className = 'card inset rv'; const row = document.createElement('span'); row.className = 'row gap center';
          const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true; cb.onchange = () => { d.keep = cb.checked; upd(); };
          const txt = document.createElement('span'); txt.className = 'grow';
          const b = document.createElement('b'); b.textContent = d.name; const s1 = document.createElement('div'); s1.className = 'small muted'; s1.textContent = summary(d); const s2 = document.createElement('div'); s2.className = 'small'; s2.textContent = guidance(d);
          txt.append(b, s1, s2); row.append(cb, txt); lab.append(row); box.append(lab);
        });
        if (note) { const p = document.createElement('p'); p.className = 'small muted'; p.textContent = note; box.append(p); }
        const save = document.createElement('button'); save.className = 'btn btn-primary'; save.dataset.save = '1';
        const upd = () => { const n = drafts.filter((d) => d.keep !== false).length; save.textContent = `Save ${n} routine${n === 1 ? '' : 's'}`; save.disabled = !n; }; upd();
        save.onclick = async () => {
          save.disabled = true; let n = 0;
          for (const d of drafts.filter((x) => x.keep !== false)) { const { keep, ...spec } = d; await store.save('activities', { kind: 'routine', category: 'routine', enabled: true, ...spec }); n++; }
          s.close(); toast(`${n} routine${n === 1 ? '' : 's'} added — mark today as Logged in to start the guidance`);
        };
        const rowb = document.createElement('div'); rowb.className = 'row gap end'; rowb.append(save); box.append(rowb);
        const tip = document.createElement('p'); tip.className = 'tiny muted'; tip.textContent = 'You can fine-tune any routine afterwards from Manage → Edit.'; box.append(tip);
        out.append(box);
      };
      if (text) ta.value = text;
      go.onclick = async () => {
        const d = ta.value.trim(); if (d.length < 6) { toast('Describe your routine first', { tone: 'warn' }); return; }
        go.disabled = true; const label = go.textContent; go.textContent = 'Working…';
        try {
          if (aiReady()) {
            const r = await askJSON({ system: `${CORE_SYSTEM}\n\n${ROUTINE_DESIGNER}`, user: { description: d, existingRoutines: R.allRoutines().map((x) => x.name) }, schemaName: 'routines', timeoutMs: 30000 });
            render((r.routines || []).map(normalizeDraft).filter(Boolean), r.note);
          } else { const one = parseRoutineText(d); render(one ? [one] : [], one ? 'Read with the built-in reader — check the days and times.' : ''); }
        } catch (e) { toast(describeError(e), { tone: 'warn' }); }
        go.disabled = false; go.textContent = label;
      };
      if (auto && text) go.click();
    } });
}
