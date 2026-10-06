// Connect Google Calendar: the card in You, and the guided sheet (steps → paste the private link → see what was found).
import { h, icon, openSheet, toast, confirmSheet } from './ui.js';
import * as G from './gcal.js';
import { fmtDate, fmtTime, fmtRelative } from './util.js';

export function calendarsCard() {
  const st = G.state; const n = G.googleEventCount();
  if (!window.__account) return h`<section class="card"><div class="eyebrow">Calendars</div><p class="small muted">Sign in to connect your Google Calendar.</p></section>`;
  return h`<section class="card"><div class="row between center"><div class="eyebrow">${icon('calendar', 12)} Calendars</div>${st.feeds.length ? h`<span class="pill ${st.error ? '' : 'pill-green'}">${st.syncing ? 'Syncing…' : st.error ? 'Problem' : 'Connected'}</span>` : ''}</div>
    ${st.feeds.length ? st.feeds.map((f) => h`<div class="card inset row between center gap"><span class="grow"><b>${f.name}</b><br><small class="muted">${f.lastError || (f.lastOk ? `Synced ${fmtRelative(f.lastOk)}` : 'Not synced yet')}</small></span><button class="btn btn-sm btn-danger-ghost" data-act="gcal-remove" data-id="${f.id}" data-name="${f.name}">Disconnect</button></div>`)
      : h`<p class="small muted">Show your Google Calendar events in LifeOS — Today, Plan and the month calendar — so everything is in one place. Read-only: LifeOS never changes your calendar.</p>`}
    ${st.error ? h`<p class="small err-t">${st.error}</p>` : ''}
    ${st.feeds.length && n ? h`<p class="small muted">${n} event${n === 1 ? '' : 's'} from your calendar are in LifeOS.</p>` : ''}
    <div class="row gap wrap"><button class="btn btn-sm btn-primary" data-act="gcal-connect">${icon('plus', 14)} ${st.feeds.length ? 'Add another calendar' : 'Connect Google Calendar'}</button>${st.feeds.length ? h`<button class="btn btn-sm" data-act="gcal-sync">${icon('refresh', 14)} Sync now</button>` : ''}</div></section>`;
}
export async function gcalRemove(id, name) {
  if (!(await confirmSheet({ title: 'Disconnect calendar?', message: `“${name}” events will be removed from LifeOS (your Google Calendar isn’t touched).`, confirm: 'Disconnect', danger: true }))) return;
  try { await G.disconnect(id); toast('Calendar disconnected'); } catch (e) { toast(e.message || 'Couldn’t disconnect', { tone: 'warn' }); }
}
export const gcalSyncNow = async () => { toast('Syncing…'); await G.syncGoogle({ force: true }); toast(G.state.error || 'Calendar up to date', { tone: G.state.error ? 'warn' : '' }); };

export function connectSheet() {
  openSheet({ title: 'Connect Google Calendar', tall: true, body: h`<div class="stack">
    <ol class="steps small">
      <li>On a computer, open <b>Google Calendar</b> → the gear → <b>Settings</b>.</li>
      <li>Under <b>Settings for my calendars</b>, choose the calendar you want.</li>
      <li>Scroll to <b>Integrate calendar</b> and copy <b>Secret address in iCal format</b>.</li>
      <li>Paste it below.</li></ol>
    <form class="stack" id="gc-form" novalidate>
      <label class="field"><span class="field-label">Name</span><input class="input" name="name" maxlength="40" value="Google Calendar"></label>
      <label class="field"><span class="field-label">Secret address in iCal format</span><input class="input" name="url" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" required></label>
      <p class="form-error" id="gc-err" role="alert"></p>
      <div class="row gap end"><button type="button" class="btn" data-x>Cancel</button><button class="btn btn-primary" type="submit">Connect</button></div></form>
    <div id="gc-res"></div>
    <div class="card inset"><p class="tiny muted">${icon('shield', 12)} Treat this link like a password — anyone with it can read that calendar (you can reset it in Google). LifeOS only reads it, keeps it on the server for your account and never shows it again. Google refreshes this feed every few hours, so new events can take a while to appear. Outlook and iCloud “subscribe” links work too.</p></div></div>`,
  onOpen(s) {
    s.el.querySelector('[data-x]').onclick = s.close;
    s.el.querySelector('#gc-form').addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(e.target); const err = s.el.querySelector('#gc-err'); err.textContent = ''; const btn = e.target.querySelector('.btn-primary'); btn.disabled = true; btn.textContent = 'Connecting…';
      try {
        const r = await G.connect({ name: String(f.get('name') || ''), url: String(f.get('url') || '') });
        const out = s.el.querySelector('#gc-res'); out.innerHTML = '';
        const box = document.createElement('div'); box.className = 'card inset stack'; const t = document.createElement('b'); t.textContent = `Connected — ${r.count} event${r.count === 1 ? '' : 's'} in the next two months`; box.append(t);
        if (r.sample?.length) { const lab = document.createElement('div'); lab.className = 'eyebrow'; lab.textContent = 'Coming up on your calendar'; box.append(lab); for (const ev of r.sample) { const row = document.createElement('div'); row.className = 'small'; const when = ev.allDay ? fmtDate(new Date(`${ev.start}T12:00:00`), { weekday: 'short', day: 'numeric', month: 'short' }) : `${fmtDate(new Date(ev.start), { weekday: 'short', day: 'numeric', month: 'short' })} ${fmtTime(new Date(ev.start))}`; row.textContent = `${when} — ${ev.title}`; box.append(row); } }
        const done = document.createElement('button'); done.className = 'btn btn-primary'; done.textContent = 'Done'; done.onclick = s.close; box.append(done); out.append(box);
        e.target.hidden = true;
      } catch (e2) { err.textContent = e2.message || 'Couldn’t connect that calendar.'; btn.disabled = false; btn.textContent = 'Connect'; }
    });
  } });
}
