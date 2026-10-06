// "Plan my day": finds the free time between your fixed events, then lays your open tasks into it — focus blocks with short breaks.
// With AI the plan is smarter about energy and priorities; without AI a simple local planner does the job. You review, untick, then add.
import { store } from './store.js';
import * as A from './analytics.js';
import { execute } from './actions.js';
import { aiReady, askJSON, describeError } from './groq.js';
import { CORE_SYSTEM, DAY_PLANNER } from './prompts.js';
import { h, icon, openSheet, toast } from './ui.js';
import { dayKey, fmtTime } from './util.js';
import { aiOff, aiOffNotice } from './ai-setup.js';

const BUFFER = 10 * 60000;
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const atHM = (day, s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); if (!m || +m[1] > 23 || +m[2] > 59) return null; const d = new Date(day); d.setHours(+m[1], +m[2], 0, 0); return d; };

export function freeWindows(now = new Date(), { endHour = 21, startHour = 7 } = {}) {
  const day = new Date(now); day.setHours(0, 0, 0, 0);
  let start = new Date(Math.max(+now, +atHM(day, `${startHour}:00`))); start = new Date(Math.ceil(+start / 900000) * 900000); const end = atHM(day, `${endHour}:00`);
  if (start >= end) return [];
  const busy = A.eventsOnDay(dayKey(now)).filter((e) => !e.allDay && e.status !== 'skipped' && e.type !== 'reminder').map((e) => [+new Date(e.start) - BUFFER, +new Date(e.end || e.start) + BUFFER]).sort((a, b) => a[0] - b[0]);
  const out = []; let cur = +start;
  for (const [s, e] of busy) { if (e <= cur) continue; if (s > cur) out.push([cur, Math.min(s, +end)]); cur = Math.max(cur, e); if (cur >= +end) break; }
  if (cur < +end) out.push([cur, +end]);
  return out.filter(([s, e]) => e - s >= 20 * 60000).map(([s, e]) => ({ start: new Date(s), end: new Date(e) }));
}
// a "task" like “Office from 10 am to 6 pm” is really a schedule, not something to do — it belongs in Routines
export const looksLikeSchedule = (title) => /\b\d{1,2}(:\d{2})?\s*(am|pm)?\s*(-|–|to|until|till)\s*\d{1,2}(:\d{2})?\s*(am|pm)?\b/i.test(String(title)) && /\b(am|pm|from|office|work|shift|hours)\b/i.test(String(title));
const allOpen = (now) => store.all('tasks').filter((t) => t.status !== 'done' && !t.someday && (!t.due || dayKey(t.due) <= dayKey(now))).sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
export const openTasks = (now = new Date()) => allOpen(now).filter((t) => !looksLikeSchedule(t.title)).slice(0, 8);
export const skippedTasks = (now = new Date()) => allOpen(now).filter((t) => looksLikeSchedule(t.title));

/** Simple planner (no AI): 45-minute focus blocks on your tasks, a 10-minute break after each, inside the free windows. */
export function localPlan(windows, tasks) {
  const blocks = []; let ti = 0;
  for (const w of windows) { let t = +w.start; while (ti < tasks.length && t + 30 * 60000 <= +w.end && blocks.length < 6) { const len = Math.min(45 * 60000, +w.end - t); blocks.push({ title: tasks[ti].title, taskId: tasks[ti].id, kind: 'focus', start: new Date(t), durationMin: Math.round(len / 60000) }); ti++; t += len; if (t + 20 * 60000 <= +w.end && ti < tasks.length) { blocks.push({ title: 'Break', kind: 'break', start: new Date(t), durationMin: 10 }); t += 10 * 60000; } } }
  while (blocks.length && blocks[blocks.length - 1].kind === 'break') blocks.pop();
  return blocks;
}
/** Keeps only blocks that fit inside a free window, don't overlap, and reference real tasks. */
export function validate(raw, windows, tasks, now = new Date()) {
  const day = new Date(now); day.setHours(0, 0, 0, 0); const byId = new Map(tasks.map((t) => [t.id, t])); const out = [];
  for (const b of (raw || []).slice().sort((x, y) => String(x.start).localeCompare(String(y.start)))) {
    const s = atHM(day, b.start); const len = Math.round(Number(b.durationMin)); if (!s || !(len >= 5 && len <= 120)) continue; const e = new Date(+s + len * 60000);
    if (!windows.some((w) => s >= w.start && e <= w.end)) continue; if (out.length && s < new Date(+out[out.length - 1].start + out[out.length - 1].durationMin * 60000)) continue;
    const kind = ['focus', 'break', 'habit'].includes(b.kind) ? b.kind : 'focus'; const t = b.taskId && byId.get(b.taskId);
    if (kind === 'focus' && !t && !String(b.title || '').trim()) continue;
    out.push({ title: kind === 'focus' ? (t?.title || String(b.title).slice(0, 80)) : kind === 'break' ? 'Break' : String(b.title || 'Habit').slice(0, 60), taskId: t ? t.id : null, kind, start: s, durationMin: len });
    if (out.length >= 6) break;
  }
  return out;
}

export function planDaySheet() {
  const now = new Date(); const wins = freeWindows(now); const tasks = openTasks(now);
  openSheet({ title: 'Plan my day', tall: true, body: h`<p class="muted"><span class="spinner"></span> Looking at your calendar and tasks…</p>`,
    async onOpen(s) {
      const win = wins.map((w) => `${hhmm(w.start)}–${hhmm(w.end)}`); let summary = ''; let blocks = []; let usedAI = false; let err = '';
      if (!wins.length) { s.setBody(h`<div class="stack"><p>There’s no free time left today between your events — nothing to plan.</p><button class="btn" data-x>Close</button></div>`); s.el.querySelector('[data-x]').onclick = s.close; return; }
      if (!tasks.length) { s.setBody(h`<div class="stack"><p>You don’t have any open tasks to schedule yet.</p>${skippedTasks(now).length ? h`<p class="small muted">“${skippedTasks(now)[0].title}” looks like your schedule rather than a to-do, so I left it out. Office hours belong in Routines.</p>` : ''}<p class="small muted">Add a task in Plan, or tell me what you want to get done in Capture.</p><button class="btn" data-x>Close</button></div>`); s.el.querySelector('[data-x]').onclick = s.close; return; }
      if (aiReady()) {
        try {
          const st = A.currentState(now); const events = A.eventsOnDay(dayKey(now)).filter((e) => !e.allDay).map((e) => ({ title: e.title, start: hhmm(new Date(e.start)), end: hhmm(new Date(e.end || e.start)) }));
          const r = await askJSON({ system: `${CORE_SYSTEM}\n\n${DAY_PLANNER}`, schemaName: 'dayplan', timeoutMs: 30000, user: { now: hhmm(now), freeWindows: win, tasks: tasks.map((t) => ({ id: t.id, title: t.title, due: t.due ? hhmm(new Date(t.due)) : null })), events, energyToday: st.energy ?? null } });
          blocks = validate(r.blocks, wins, tasks, now); summary = String(r.summary || ''); usedAI = blocks.length > 0;
        } catch (e) { err = describeError(e); }
      }
      if (!blocks.length) { blocks = localPlan(wins, tasks); summary = usedAI ? summary : 'A simple plan: one focus block per task, with short breaks, inside your free time.'; }
      const keep = new Set(blocks.map((_, i) => i));
      const skipped = skippedTasks(now);
      const draw = () => s.setBody(h`<div class="stack">${err ? h`<p class="small err-t">${err} — here’s a simple plan instead.</p>` : ''}${aiOff() ? aiOffNotice('This is the basic planner') : ''}<div class="card inset"><div class="eyebrow">${icon('sparkle', 12)} ${usedAI ? 'Your plan' : 'A simple plan'}</div><p>${summary}</p></div>
        <div class="eyebrow">Free time today: ${win.join(' · ')}</div>
        <p class="small muted">Planned from your ${tasks.length} open task${tasks.length === 1 ? '' : 's'}: ${tasks.slice(0, 4).map((t) => `“${t.title}”`).join(', ')}${tasks.length > 4 ? '…' : ''}. Add tasks in Plan or Capture and I’ll fit them in.</p>
        ${skipped.length ? h`<p class="small muted">Left out ${skipped.map((t) => `“${t.title}”`).join(', ')} — that looks like your schedule rather than a to-do. Office hours belong in Routines.</p>` : ''}
        ${blocks.map((b, i) => h`<label class="card inset rv"><span class="row gap center"><input type="checkbox" data-i="${i}" ${keep.has(i) ? 'checked' : ''}><span class="grow"><b>${b.kind === 'break' ? 'Break' : b.kind === 'habit' ? b.title : `Focus: ${b.title}`}</b><div class="small muted">${fmtTime(b.start)} – ${fmtTime(new Date(+b.start + b.durationMin * 60000))} · ${b.durationMin} min</div></span></span></label>`)}
        <div class="row gap wrap end"><button class="btn" data-x>Not now</button><button class="btn btn-primary" data-add ${keep.size ? '' : 'disabled'}>Add ${keep.size} block${keep.size === 1 ? '' : 's'} to my day</button></div>
        <p class="tiny muted">Blocks are added as calendar events you can move or delete. ${usedAI ? 'Planned with AI from your free time, tasks and energy.' : ''}</p></div>`);
      draw();
      s.el.addEventListener('change', (e) => { const i = e.target.dataset.i; if (i === undefined) return; if (e.target.checked) keep.add(Number(i)); else keep.delete(Number(i)); const btn = s.el.querySelector('[data-add]'); btn.disabled = !keep.size; btn.textContent = `Add ${keep.size} block${keep.size === 1 ? '' : 's'} to my day`; });
      s.el.addEventListener('click', async (e) => {
        if (e.target.closest('[data-x]')) { s.close(); return; }
        const add = e.target.closest('[data-add]'); if (!add) return; add.disabled = true; let n = 0;
        for (const [i, b] of blocks.entries()) { if (!keep.has(i)) continue; try { await execute({ type: 'create_event', payload: { title: b.kind === 'break' ? 'Break' : b.kind === 'habit' ? b.title : `Focus: ${b.title}`, type: b.kind === 'focus' ? 'task' : 'other', start: b.start.toISOString(), end: new Date(+b.start + b.durationMin * 60000).toISOString(), importance: 'normal', flex: 'flexible', notes: 'Planned by LifeOS' } }, { origin: 'user', source: 'day plan', why: b.kind === 'break' ? 'A short break after focused work, placed in free time between your events.' : `Free time between your events, matched to your energy and this task.${b.reason ? ` ${b.reason}` : ''}`, evidence: ['Your calendar free windows', 'Your open tasks', 'You approved this plan'] }); n++; } catch { /* skip one */ } }
        s.close(); toast(`${n} block${n === 1 ? '' : 's'} added to your day`);
      });
    } });
}
