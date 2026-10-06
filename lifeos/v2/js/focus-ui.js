// Focus timer UI: a pill that follows you across screens while a session runs, the start and running sheets, and the Today card.
import { store } from './store.js';
import * as F from './focus.js';
import { notify } from './routines.js';
import { h, icon, openSheet, toast, ring } from './ui.js';

const PRESETS = [15, 25, 45, 60, 90];
let liveSheet = null; // { el, close } while the running sheet is open

export function timerCard() {
  const a = F.active(); const sum = F.todaySummary();
  if (a) {
    const left = F.remainingMs();
    return h`<section class="card focus-card active"><div class="row between center"><div class="eyebrow">${icon('target', 12)} Focus ${F.isPaused() ? 'paused' : 'on'}</div><span class="pill" data-fz-clock>${left === null ? F.fmtClock(F.elapsedMs()) : F.fmtClock(left)}</span></div>
      <p class="headline">${a.label || 'Focus session'}</p><div class="row gap wrap"><button class="btn btn-primary" data-act="focus-open">Open timer</button></div></section>`;
  }
  return h`<section class="card focus-card"><div class="row between center"><div class="eyebrow">${icon('target', 12)} Focus timer</div>${sum.count ? h`<span class="pill">${F.minutesLabel(sum.minutes)} today</span>` : ''}</div>
    <p class="small muted">${sum.count ? `${sum.count} session${sum.count === 1 ? '' : 's'} today. ` : ''}Turn focus on when you need to concentrate — I’ll keep reminders quiet and time it for you.</p>
    <div class="row gap wrap"><button class="btn btn-primary" data-act="focus-start">${icon('target', 16)} Start focus</button></div></section>`;
}

export function focusStartSheet({ label = '', taskId = null, minutes = 25 } = {}) {
  if (F.active()) { focusSheet(); return; }
  let mins = minutes;
  openSheet({ title: 'Start focus', body: h`<form class="stack" id="fz-form" novalidate>
      <label class="field"><span class="field-label">What are you focusing on?</span><input class="input" name="label" maxlength="80" value="${label}" placeholder="e.g. Write the report" autofocus></label>
      <div class="field"><span class="field-label">For how long?</span><div class="chips" role="group" aria-label="Duration">${PRESETS.map((m) => h`<button type="button" class="chip-btn pick ${m === minutes ? 'on' : ''}" data-m="${m}">${m} min</button>`)}<button type="button" class="chip-btn pick ${minutes === 0 ? 'on' : ''}" data-m="0">Open-ended</button></div></div>
      <label class="field"><span class="field-label">Or a custom length (minutes)</span><input class="input" type="number" name="custom" min="1" max="600" inputmode="numeric" placeholder="e.g. 35"></label>
      <label class="check"><input type="checkbox" name="quiet" checked><span>Keep reminders quiet while I focus</span></label>
      <label class="check"><input type="checkbox" name="track" checked><span>Add this time to a “Focus time” tracker</span></label>
      <div class="row gap end"><button type="button" class="btn" data-x>Cancel</button><button class="btn btn-primary" type="submit">Start</button></div></form>`,
  onOpen(s) {
    const f = s.el.querySelector('#fz-form');
    s.el.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => { mins = Number(b.dataset.m); s.el.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x === b)); f.elements.custom.value = ''; }));
    f.elements.custom.addEventListener('input', () => { if (f.elements.custom.value) { mins = Number(f.elements.custom.value); s.el.querySelectorAll('[data-m]').forEach((x) => x.classList.remove('on')); } });
    s.el.querySelector('[data-x]').onclick = s.close;
    f.addEventListener('submit', (e) => { e.preventDefault(); const d = new FormData(f); F.start({ label: String(d.get('label') || ''), minutes: mins, quiet: d.get('quiet') === 'on', track: d.get('track') === 'on', taskId }); s.close(); toast('Focus on'); setTimeout(() => focusSheet(), 250); });
  } });
}

function runningBody() {
  const a = F.active(); const planned = a.planned; const left = F.remainingMs(); const el = F.elapsedMs();
  return h`<div class="stack center-t"><div class="fz-ring">${ring({ pct: planned ? 1 - left / (planned * 60000) : (el % 3600000) / 3600000, size: 200, stroke: 12, color: F.isPaused() ? 'var(--amber)' : 'var(--blue)', label: '', sub: '' })}<div class="fz-time" id="fz-time">${planned ? F.fmtClock(left) : F.fmtClock(el)}</div></div>
    <p class="headline">${a.label || 'Focus session'}</p><p class="small muted" id="fz-sub">${F.isPaused() ? 'Paused' : planned ? `${planned} min session` : 'Open-ended — stop when you’re done'}</p>
    <div class="row gap wrap center-r"><button class="btn" data-fz="${F.isPaused() ? 'resume' : 'pause'}">${F.isPaused() ? 'Resume' : 'Pause'}</button><button class="btn" data-fz="plus">+5 min</button><button class="btn btn-danger-ghost" data-fz="stop">Stop</button></div>
    ${a.quiet ? h`<p class="tiny muted">${icon('bell', 12)} Reminders are quiet until you finish.</p>` : ''}</div>`;
}
export function focusSheet() {
  if (!F.active()) { focusStartSheet(); return; }
  if (liveSheet) return;
  let off = null;
  openSheet({ title: 'Focus', body: runningBody(),
    onOpen(s) {
      liveSheet = s;
      const bind = () => s.el.querySelectorAll('[data-fz]').forEach((b) => b.addEventListener('click', async () => {
        const k = b.dataset.fz;
        if (k === 'pause') F.pause(); else if (k === 'resume') F.resume(); else if (k === 'plus') { F.extend(5); toast('+5 minutes'); }
        else if (k === 'stop') { const r = await F.finish({ completed: false }); s.close(); summarySheet(r, false); }
      }));
      off = F.onFocus(() => { if (!F.active()) { s.close(); return; } s.setBody(runningBody()); bind(); });
      bind();
    }, onClose() { off?.(); liveSheet = null; } });
}

export function summarySheet(rec, completed) {
  if (!rec) { toast('Session too short to save'); return; }
  const task = rec.taskId ? store.get('tasks', rec.taskId) : null;
  openSheet({ title: completed ? 'Focus complete' : 'Session saved', body: h`<div class="stack"><div class="card inset"><div class="eyebrow">${rec.label || 'Focus session'}</div><p class="headline">${F.minutesLabel(rec.minutes)} focused</p><p class="small muted">${completed ? 'You finished the full session. A short break helps.' : 'Saved to your focus history.'}</p></div>
      <div class="row gap wrap">${task && task.status !== 'done' ? h`<button class="btn btn-primary" data-done>Mark “${task.title}” done</button>` : ''}<button class="btn ${task && task.status !== 'done' ? '' : 'btn-primary'}" data-again>Another round</button><button class="btn" data-x>Done</button></div></div>`,
  onOpen(s) {
    s.el.querySelector('[data-x]').onclick = s.close;
    s.el.querySelector('[data-again]').onclick = () => { s.close(); setTimeout(() => focusStartSheet({ label: rec.label, taskId: rec.taskId, minutes: rec.planned || 25 }), 250); };
    s.el.querySelector('[data-done]')?.addEventListener('click', async () => { await store.save('tasks', { id: task.id, status: 'done' }); toast('Task done'); s.close(); });
  } });
}

// ---- the pill (visible on every screen while a session runs) ----
let pill = null; let timer = null;
function paintPill() {
  const a = F.active(); if (!pill) return;
  pill.hidden = !a;
  if (!a) return;
  const left = F.remainingMs(); pill.querySelector('[data-t]').textContent = left === null ? F.fmtClock(F.elapsedMs()) : F.fmtClock(left);
  pill.querySelector('[data-l]').textContent = F.isPaused() ? 'Paused' : a.label || 'Focus';
}
async function tick() {
  paintPill();
  document.querySelectorAll('[data-fz-clock]').forEach((n) => { const l = F.remainingMs(); n.textContent = l === null ? F.fmtClock(F.elapsedMs()) : F.fmtClock(l); });
  const t = document.getElementById('fz-time'); if (t && F.active()) { const l = F.remainingMs(); t.textContent = l === null ? F.fmtClock(F.elapsedMs()) : F.fmtClock(l); }
  const done = await F.reconcile();
  if (done) { await notify('Focus complete', done.label ? `Nice work on “${done.label}”.` : 'Session finished — time for a break.', `focus:${done.session.id}:end`); toast('Focus complete'); if (!document.querySelector('#sheet-root .sheet-wrap')) summarySheet(done, true); }
}
export function mountFocusPill() {
  if (pill) return; pill = document.createElement('button'); pill.id = 'focus-pill'; pill.hidden = true; pill.setAttribute('aria-label', 'Open focus timer');
  pill.innerHTML = `<span data-l></span><b data-t></b>`; pill.addEventListener('click', () => focusSheet()); document.body.appendChild(pill);
  F.onFocus(paintPill); paintPill(); clearInterval(timer); timer = setInterval(tick, 1000); tick();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}
