// UI for daily routines: Today "work mode" card, Plan day-status strip, manage/edit sheets.
import { describeRoutineSheet } from './routine-ai.js';
import { store } from './store.js';
import * as R from './routines.js';
import { execute } from './actions.js';
import { h, html, icon, openSheet, confirmSheet, toast, field, bindSeg, bar } from './ui.js';
import { dayKey, fmtTime, fmtRelative, addMinutes, round } from './util.js';
import { exportRoutineICS } from './calendar.js';
import { navigate } from './router.js';

const left = (d, now) => { const m = Math.max(0, Math.round((d - now) / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`; };

// ---------- Today ----------
export function routineCards(now = new Date()) {
  const key = dayKey(now); const cards = [];
  for (const r of R.activeRoutines()) {
    if (!R.scheduledOn(r, now)) continue;
    const st = R.statusFor(r, key); const { start, end } = R.windowOf(r, now);
    const hours = `${R.fmtHM(r.start)}–${R.fmtHM(r.end)}`;
    if (st === 'off') { cards.push(h`<div class="card slim routine"><div class="eyebrow">${r.name} · ${hours}</div><p>Day off — reminders are paused. Enjoy it.</p><button class="btn btn-sm" data-act="r-mark" data-r="${r.id}" data-d="${key}" data-s="cleared">Undo</button></div>`); continue; }
    if (!st) {
      if (now > addMinutes(end, 0)) continue;
      cards.push(h`<div class="card routine"><div class="eyebrow">${icon('target', 14)} ${r.name} today · ${hours}</div><p class="strong">${now < start ? `Starts ${fmtRelative(start, now)}.` : 'Are you working today?'} Mark it and I’ll guide you through the day.</p>
        <div class="row gap wrap"><button class="btn btn-primary" data-act="r-mark" data-r="${r.id}" data-d="${key}" data-s="working">Logged in</button><button class="btn" data-act="r-mark" data-r="${r.id}" data-d="${key}" data-s="off">Day off</button></div></div>`);
      continue;
    }
    if (st === 'done' || now > addMinutes(end, 120)) {
      const sm = R.daySummary(r, key);
      cards.push(h`<div class="card slim routine"><div class="eyebrow">${r.name} · done for the day</div><p>${sm.water} water · ${sm.breaks} break${sm.breaks === 1 ? '' : 's'}${sm.lunch ? ' · lunch' : ''}. Nice work.</p>${st === 'done' ? '' : h`<button class="btn btn-sm" data-act="r-mark" data-r="${r.id}" data-d="${key}" data-s="done">Log out for the day</button>`}</div>`);
      continue;
    }
    if (now < addMinutes(start, -30)) { cards.push(h`<div class="card slim routine"><div class="eyebrow">${r.name} · ${hours}</div><p>You’re marked as working. Starts ${fmtRelative(start, now)}.</p><button class="btn btn-sm" data-act="r-mark" data-r="${r.id}" data-d="${key}" data-s="off">Switch to day off</button></div>`); continue; }

    // active work mode
    const due = R.dueNudges(now).filter((d) => d.routineId === r.id); const br = R.activeBreak(now); const nx = R.nextNudge(now);
    const pct = Math.min(1, Math.max(0, (now - start) / (end - start)));
    cards.push(h`<section class="card routine active"><div class="row between"><div class="eyebrow">${icon('target', 14)} ${r.name} · ${hours}</div><span class="pill pill-green">Logged in</span></div>
      <div class="row between small muted"><span>${now < start ? `Starts ${fmtRelative(start, now)}` : now > end ? 'Past end time' : `${left(end, now)} left`}</span><span>${Math.round(pct * 100)}%</span></div>${bar(pct, 'var(--blue)')}
      ${br ? h`<div class="card inset"><div class="strong">${icon('walk', 18)} On a break — ${left(br.until, now)} left</div><p class="small muted">Stretch, breathe, look away from the screen.</p><button class="btn btn-sm" data-act="n-end-break" data-k="${br.key}">I’m back</button></div>` : ''}
      ${due.map((d) => h`<div class="nudge ${d.type}"><span class="t-ic lead">${icon(d.icon, 20)}</span><div class="grow"><b>${d.title}</b><div class="small muted">${d.body}</div>
        <div class="row gap wrap">${d.type === 'water' ? h`<button class="btn btn-sm btn-primary" data-act="n-water" data-k="${d.key}">Drank 250 ml</button>` : d.type === 'break' ? h`<button class="btn btn-sm btn-primary" data-act="n-break" data-k="${d.key}" data-len="${d.len || 10}">Start ${d.len || 10}-min break</button>` : d.type === 'end' ? h`<button class="btn btn-sm btn-primary" data-act="r-mark" data-r="${r.id}" data-d="${key}" data-s="done" data-k="${d.key}">Log out for the day</button>` : h`<button class="btn btn-sm btn-primary" data-act="n-done" data-k="${d.key}">Done</button>`}
        <button class="btn btn-sm" data-act="n-snooze" data-k="${d.key}">Later (15 min)</button><button class="btn btn-sm" data-act="n-skip" data-k="${d.key}">Skip</button></div></div></div>`)}
      ${!due.length && !br ? h`<p class="small muted">${icon('check', 14)} You’re on track.${nx ? ` Next: ${nx.title.toLowerCase()} at ${fmtTime(nx.at)}.` : ''}</p>` : ''}
      <div class="row gap wrap"><button class="btn btn-sm" data-act="r-mark" data-r="${r.id}" data-d="${key}" data-s="done">Log out for the day</button><button class="btn btn-sm" data-act="r-mark" data-r="${r.id}" data-d="${key}" data-s="off">Actually, day off</button></div></section>`);
  }
  return cards;
}

export const routineActions = {
  'r-mark': async (el) => {
    const r = store.get('activities', el.dataset.r); const key = el.dataset.d; const s = el.dataset.s; const prev = R.statusFor(r, key);
    await R.setStatus(r, key, s); if (el.dataset.k) await R.ack(el.dataset.k, 'done');
    const msg = { working: `Logged in — I’ll guide you through ${r.name.toLowerCase()} today`, off: 'Marked as a day off', done: 'Logged out for the day', cleared: 'Cleared' }[s];
    toast(msg, { undo: () => R.setStatus(r, key, prev || 'cleared') });
  },
  'n-water': async (el) => { await R.ack(el.dataset.k, 'done'); try { const res = await execute({ type: 'create_log', payload: { logType: 'water', value: 250, unit: 'ml', meta: { routine: true } } }); toast('+250 ml logged', { undo: res.undo }); } catch { /* log is a bonus */ } },
  'n-done': (el) => R.ack(el.dataset.k, 'done'),
  'n-skip': (el) => R.ack(el.dataset.k, 'skip'),
  'n-snooze': (el) => { R.ack(el.dataset.k, 'snooze', { until: addMinutes(new Date(), 15).toISOString() }); toast('I’ll remind you in 15 minutes'); },
  'n-break': (el) => { R.ack(el.dataset.k, 'break_started', { len: Number(el.dataset.len) || 10 }); },
  'n-end-break': (el) => R.ack(el.dataset.k, 'done'),
  'r-manage': () => manageSheet(),
};

// ---------- Plan: day-status strip ----------
export function routineStrip(selKey) {
  const rs = R.activeRoutines().filter((r) => R.scheduledOn(r, new Date(`${selKey}T12:00:00`)));
  const all = R.allRoutines();
  if (!all.length) return h`<section class="card routine"><div class="row between"><div><div class="eyebrow">Daily routines</div><p class="small muted">Save things you do every day — like office hours — and get guided through them.</p></div></div><button class="btn btn-primary btn-sm" data-act="r-manage">${icon('plus', 14)} Set up a routine</button></section>`;
  return h`<section class="card routine"><div class="row between center"><div class="eyebrow">Daily routines</div><button class="link" data-act="r-manage">Manage ${icon('chevron', 14)}</button></div>
    ${rs.length ? rs.map((r) => { const st = R.statusFor(r, selKey); return h`<div class="r-row"><div class="grow"><b>${r.name}</b><div class="small muted">${R.fmtHM(r.start)}–${R.fmtHM(r.end)}</div></div>
      <div class="seg sm" role="group" aria-label="${r.name} status"><button class="seg-btn ${st === 'working' || st === 'done' ? 'on' : ''}" data-act="r-mark" data-r="${r.id}" data-d="${selKey}" data-s="working" aria-pressed="${st === 'working' || st === 'done'}">Logged in</button><button class="seg-btn ${st === 'off' ? 'on' : ''}" data-act="r-mark" data-r="${r.id}" data-d="${selKey}" data-s="off" aria-pressed="${st === 'off'}">Day off</button></div></div>`; })
    : h`<p class="small muted">No routine scheduled on this day.</p>`}</section>`;
}

// ---------- manage / edit ----------
export function manageSheet() {
  const draw = (s) => {
    const list = R.allRoutines();
    s.setBody(h`<div class="stack"><p class="muted small">Set the days and hours once. Each day, mark <b>Logged in</b> or <b>Day off</b> (on Today or Plan) and I’ll guide you through it with water, breaks and lunch.</p>
      ${list.map((r) => h`<div class="card inset"><div class="row between gap"><div class="grow"><b>${r.name}</b><div class="small muted">${R.DAY_ORDER.filter((d) => r.days.includes(d)).map((d) => R.DAY_NAMES[d]).join(', ')} · ${R.fmtHM(r.start)}–${R.fmtHM(r.end)}${r.enabled === false ? ' · paused' : ''}</div></div></div>
        <div class="row gap wrap"><button class="btn btn-sm" data-e="${r.id}">${icon('edit', 14)} Edit</button><button class="btn btn-sm" data-t="${r.id}">${r.enabled === false ? 'Resume' : 'Pause'}</button><button class="btn btn-sm" data-i="${r.id}">${icon('download', 14)} .ics</button><button class="btn btn-sm btn-danger-ghost" data-x="${r.id}">${icon('trash', 14)}</button></div></div>`)}
      ${list.length ? '' : h`<button class="btn btn-primary btn-wide" data-tpl>Add “Office · Mon–Sat · 10:00–18:00”</button>`}
      <button class="btn btn-primary btn-wide" data-desc>${icon('sparkle', 16)} Describe it in words</button>
      <button class="btn btn-wide" data-new>${icon('plus', 16)} New routine</button>
      <div class="card inset"><div class="strong">${icon('bell', 16)} Reminders</div><p class="small muted">Nudges appear on Today whenever you open LifeOS, and as notifications while it’s open or running in the background. For the most reliable alerts, add LifeOS to your Home Screen (iPhone: Share → Add to Home Screen). It can’t notify you when the app is fully closed.</p>
      <button class="btn btn-sm" data-notif>${store.settings().notifications && 'Notification' in window && Notification.permission === 'granted' ? 'Notifications are on' : 'Enable notifications'}</button></div></div>`);
    const el = s.el;
    el.querySelectorAll('[data-e]').forEach((b) => b.onclick = () => { s.close(); formSheet(store.get('activities', b.dataset.e)); });
    el.querySelectorAll('[data-t]').forEach((b) => b.onclick = async () => { const r = store.get('activities', b.dataset.t); await store.save('activities', { id: r.id, enabled: r.enabled === false }); draw(s); });
    el.querySelectorAll('[data-i]').forEach((b) => b.onclick = () => exportRoutineICS(store.get('activities', b.dataset.i)));
    el.querySelectorAll('[data-x]').forEach((b) => b.onclick = async () => { const r = store.get('activities', b.dataset.x); if (await confirmSheet({ title: 'Delete routine?', message: `“${r.name}” and its day marks will be removed.`, confirm: 'Delete', danger: true })) { await store.remove('activities', r.id); toast('Routine deleted', { undo: () => store.restore('activities', r) }); draw(s); } });
    el.querySelector('[data-tpl]')?.addEventListener('click', async () => { await store.save('activities', { kind: 'routine', category: 'routine', enabled: true, ...R.officeTemplate() }); toast('Office routine added — mark today when you log in'); draw(s); });
    el.querySelector('[data-new]')?.addEventListener('click', () => { s.close(); formSheet(null); });
    el.querySelector('[data-desc]')?.addEventListener('click', () => { s.close(); describeRoutineSheet(); });
    el.querySelector('[data-notif]')?.addEventListener('click', async () => { if (!('Notification' in window)) return toast('Notifications aren’t supported here', { tone: 'warn' }); const r = await Notification.requestPermission(); await store.setSettings({ notifications: r === 'granted' }); toast(r === 'granted' ? 'Notifications on' : 'Not enabled — in-app reminders still work'); draw(s); });
  };
  openSheet({ title: 'Daily routines', tall: true, body: '', onOpen: draw });
}

const EVERY = [30, 45, 60, 90, 120];
export function formSheet(r, { draft = null } = {}) {
  const x = r ? { ...r, nudges: { ...R.DEFAULT_NUDGES, ...r.nudges } } : draft ? { ...R.officeTemplate(), ...draft, nudges: { ...R.DEFAULT_NUDGES, ...draft.nudges } } : R.officeTemplate(); const n = x.nudges;
  const sel = (name, opts, cur, fmt = (v) => `${v} min`) => h`<select class="input" name="${name}">${opts.map((v) => h`<option value="${v}" ${Number(v) === Number(cur) ? 'selected' : ''}>${fmt(v)}</option>`)}</select>`;
  openSheet({
    title: r ? 'Edit routine' : 'New routine', tall: true,
    body: h`<form class="stack" id="rf" novalidate>
      ${field('Name', h`<input class="input" name="name" maxlength="40" required value="${x.name}" placeholder="Office, Study, Gym…" autofocus>`)}
      <div class="field"><span class="field-label">Days</span><div class="days" role="group" aria-label="Days">${R.DAY_ORDER.map((d) => h`<button type="button" class="day-chip ${x.days.includes(d) ? 'on' : ''}" data-day="${d}" aria-pressed="${x.days.includes(d)}">${R.DAY_NAMES[d]}</button>`)}</div></div>
      <div class="grid2">${field('From', h`<input class="input" type="time" name="start" value="${x.start}" required>`)}${field('Until', h`<input class="input" type="time" name="end" value="${x.end}" required>`)}</div>
      <label class="check"><input type="checkbox" name="assume" ${x.assume ? 'checked' : ''}><span>Assume I’m working on these days (I’ll mark a day off instead of marking logged in)</span></label>
      <div class="eyebrow">Guidance during this time</div>
      <label class="check"><input type="checkbox" name="water_on" ${n.water.on ? 'checked' : ''}><span class="grow">Drink water</span>${sel('water_every', EVERY, n.water.every, (v) => `every ${v} min`)}</label>
      <label class="check"><input type="checkbox" name="break_on" ${n.break.on ? 'checked' : ''}><span class="grow">Take a break</span>${sel('break_every', EVERY.concat(150), n.break.every, (v) => `every ${v} min`)}</label>
      <div class="field"><span class="field-label">Break length</span>${sel('break_len', [5, 10, 15], n.break.len, (v) => `${v} min`)}</div>
      <label class="check"><input type="checkbox" name="lunch_on" ${n.lunch.on ? 'checked' : ''}><span class="grow">Lunch</span><input class="input" type="time" name="lunch_at" value="${n.lunch.at}"></label>
      <label class="check"><input type="checkbox" name="eyes_on" ${n.eyes.on ? 'checked' : ''}><span class="grow">Rest your eyes</span>${sel('eyes_every', [20, 30, 45, 60], n.eyes.every, (v) => `every ${v} min`)}</label>
      <label class="check"><input type="checkbox" name="wrap_on" ${n.wrap.on !== false ? 'checked' : ''}><span>Wrap-up reminder 30 minutes before the end</span></label>
      <div class="field"><span class="field-label">Your own reminders</span><textarea class="input" name="extras" rows="3" placeholder="One per line, e.g. 15:30 Stand and stretch">${(Array.isArray(n.custom) ? n.custom : []).map((c) => `${c.at} ${c.text}`).join('\n')}</textarea><small class="muted">Times must fall inside the routine’s hours.</small></div>
      <p class="form-error" id="re" role="alert"></p>
      <div class="row gap end"><button type="button" class="btn" data-x>Cancel</button><button class="btn btn-primary" type="submit">${r ? 'Save' : 'Create routine'}</button></div></form>`,
    onOpen(s) {
      s.el.querySelector('[data-x]').onclick = s.close;
      s.el.querySelectorAll('.day-chip').forEach((b) => b.addEventListener('click', () => { const on = b.classList.toggle('on'); b.setAttribute('aria-pressed', on); }));
      s.el.querySelector('#rf').addEventListener('submit', async (e) => {
        e.preventDefault(); const f = new FormData(e.target); const err = (m) => { s.el.querySelector('#re').textContent = m; };
        const name = String(f.get('name')).trim(); const days = [...s.el.querySelectorAll('.day-chip.on')].map((b) => Number(b.dataset.day));
        if (!name) return err('Give the routine a name.'); if (!days.length) return err('Pick at least one day.');
        if (!f.get('start') || !f.get('end') || f.get('end') <= f.get('start')) return err('End time must be after the start time.');
        const nudges = { water: { on: f.get('water_on') === 'on', every: Number(f.get('water_every')) }, break: { on: f.get('break_on') === 'on', every: Number(f.get('break_every')), len: Number(f.get('break_len')) },
          lunch: { on: f.get('lunch_on') === 'on', at: f.get('lunch_at') || '13:30' }, eyes: { on: f.get('eyes_on') === 'on', every: Number(f.get('eyes_every')) }, wrap: { on: f.get('wrap_on') === 'on' }, custom: [] };
        for (const ln of String(f.get('extras') || '').split('\n').slice(0, 8)) { const m = /^\s*(\d{1,2}):(\d{2})\s+(.+?)\s*$/.exec(ln); if (m && Number(m[1]) < 24 && Number(m[2]) < 60) nudges.custom.push({ at: `${String(m[1]).padStart(2, '0')}:${m[2]}`, text: m[3].slice(0, 60) }); }
        await store.save('activities', { ...(r ? { id: r.id } : { enabled: true }), kind: 'routine', category: 'routine', name, days, start: f.get('start'), end: f.get('end'), assume: f.get('assume') === 'on', nudges });
        s.close(); toast(r ? 'Routine saved' : 'Routine created — mark today when you log in');
        if (!r && 'Notification' in window && Notification.permission === 'default') setTimeout(() => manageSheet(), 350);
      });
    },
  });
}
