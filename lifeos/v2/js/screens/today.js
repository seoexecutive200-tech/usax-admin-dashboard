import { store } from '../store.js';
import * as A from '../analytics.js';
import * as adv from '../advisor.js';
import { h, raw, icon, ring, pct, EVENT_ICON, EVENT_COLOR, toast, openSheet, logo } from '../ui.js';
import { greeting, fmtDate, fmtTime, fmtDur, dayKey, addDays, startOfDay, hoursUntil, partOfDay, round, isNum } from '../util.js';
import { aiReady, hasKey } from '../groq.js';
import { navigate } from '../router.js';
import { whySheet, askSheet, eventDetailSheet, searchSheet, notificationsSheet, capacitySheet, gapSheet, commit, proposeAction, quickLogSheet } from '../sheets.js';
import { execute } from '../actions.js';
import { routineCards, routineActions } from '../routine-ui.js';
import * as T from '../trackers.js';
import { trackerCard, entrySheet, quickLog, builderSheet } from '../tracker-ui.js';
import { updateReady, showUpdate, releaseNotes } from '../updates.js';
import { todayLayout, customizeTodaySheet } from '../today-layout.js';

let banners = [];
export const setBanners = (b) => { banners = b; };

function nextItems() {
  const now = new Date(); const minimal = store.settings().minimalDay === dayKey();
  let list = A.activeEvents().filter((e) => new Date(e.end || e.start) > now && e.status === 'scheduled' && e.type !== 'reminder');
  if (minimal) list = list.filter((e) => dayKey(e.start) !== dayKey() || e.importance === 'high' || e.type === 'appointment' || e.type === 'deadline');
  return list.sort((a, b) => a.start.localeCompare(b.start)).slice(0, 3);
}

function focusCard(cap) {
  const now = new Date(); const part = partOfDay(now); const today = A.eventsOnDay(dayKey());
  const remaining = today.filter((e) => new Date(e.end || e.start) > now);
  if (part === 'morning') {
    const s = A.currentState();
    return h`<div class="card slim"><div class="eyebrow">Morning outlook</div><p>${s.sleepHours != null ? `You slept ${round(s.sleepHours, 1)}h (usual ${round(cap.sleepBase, 1)}h). ` : 'Log last night’s sleep to sharpen today’s outlook. '}${today.length ? `${today.length} item${today.length > 1 ? 's' : ''} today, schedule ${A.loadLevel(cap.load)}.` : 'Nothing scheduled yet today.'}</p>${s.sleepHours == null ? h`<button class="btn btn-sm" data-act="log" data-k="sleep">${icon('moon', 16)} Log sleep</button>` : ''}</div>`;
  }
  if (part === 'afternoon') {
    const nx = remaining[0];
    return h`<div class="card slim"><div class="eyebrow">Rest of today</div><p>${remaining.length ? `${remaining.length} item${remaining.length > 1 ? 's' : ''} left; next is “${nx.title}” at ${fmtTime(nx.start)}.` : 'Your schedule is clear for the rest of the day.'} Energy is around ${round(cap.energy, 1)}/10${cap.estimated.energy ? ' (estimated)' : ''}.</p></div>`;
  }
  const tm = A.eventsOnDay(dayKey(addDays(new Date(), 1)));
  return h`<div class="card slim"><div class="eyebrow">Evening reflection</div><p>${tm.length ? `Tomorrow: ${tm.length} item${tm.length > 1 ? 's' : ''}, starting with “${tm[0].title}” at ${fmtTime(tm[0].start)}.` : 'Tomorrow is open.'} A short check-in helps tomorrow’s advice.</p><div class="row gap"><button class="btn btn-sm" data-act="log" data-k="mood">${icon('smile', 16)} Check in</button><button class="btn btn-sm" data-act="dayreview">Day review</button></div></div>`;
}

function trackersSection() {
  const pins = T.pinnedTrackers(); const any = T.allTrackers().length;
  return h`<section><div class="sec-h"><h2>Your trackers</h2><button class="link" data-act="trk-hub">${any ? 'Manage' : ''} ${icon('chevron', 14)}</button></div>
    ${pins.length ? h`<div class="stack">${pins.map((t) => trackerCard(t, { compact: true }))}</div>` : h`<div class="empty"><p>${any ? 'Pin a tracker to see it here.' : 'Track anything — describe it and LifeOS builds it for you.'}</p><button class="btn btn-sm btn-primary" data-act="trk-new">${icon('plus', 16)} ${any ? 'New tracker' : 'Create your first tracker'}</button></div>`}</section>`;
}
function dueTrackerBanners(now) {
  return T.dueReminders(now).slice(0, 2).map((d) => h`<div class="banner"><span>${icon('bell', 18)} ${d.text}</span><span class="row gap"><button class="btn btn-sm btn-primary" data-act="trk-log" data-id="${d.tracker.id}">Log</button></span></div>`);
}
function advisorCard(item) {
  const ai = aiReady();
  if (!item) {
    return h`<div class="card advisor calm"><div class="orb"></div><div class="grow"><div class="row between"><div class="strong">Advisor <span class="beta">BETA</span></div><button class="icon-btn" data-act="advmenu" aria-label="Advisor options">${icon('more', 20)}</button></div>
      <p class="adv-text">Nothing needs your attention right now. I’ll speak up only when it’s worth it.</p>
      <div class="row gap wrap"><button class="chip-btn" data-act="ask">Ask the advisor ${icon('chevron', 14)}</button>${!ai ? h`<button class="chip-btn" data-act="setupai">${hasKey() ? 'AI is off' : 'Set up AI'}</button>` : ''}</div></div></div>`;
  }
  const act = item.offer === 'minimal_day' ? h`<button class="btn btn-primary btn-sm" data-act="minimal" data-id="${item.id}">Essentials-only day</button>`
    : item.offer === 'new_baseline' ? h`<button class="btn btn-primary btn-sm" data-act="baseline" data-id="${item.id}">New baseline</button><button class="btn btn-sm" data-act="temporary" data-id="${item.id}">It’s temporary</button>`
      : item.question ? h`${['Timing', 'Too hard', 'Not relevant', 'Goal changed'].map((o) => h`<button class="chip-btn" data-act="friction" data-id="${item.id}" data-o="${o}">${o}</button>`)}`
        : item.report ? h`<button class="btn btn-primary btn-sm" data-act="openreport" data-id="${item.id}">${item.primaryAction || 'Open'}</button>`
          : item.link ? h`<button class="btn btn-primary btn-sm" data-act="openlink" data-id="${item.id}">${item.primaryAction?.startsWith('Open') ? item.primaryAction : 'Open'}</button>` : '';
  return h`<div class="card advisor ${item.decision === 'urgent_escalation' ? 'urgent' : ''} reveal"><div class="orb"></div><div class="grow"><div class="row between"><div class="strong">Advisor <span class="beta">${item.source === 'ai' ? 'AI' : item.source === 'rule' ? 'YOUR RULE' : 'BETA'}</span></div><button class="icon-btn" data-act="advmenu" aria-label="Advisor options">${icon('more', 20)}</button></div>
    <p class="adv-text">${item.message}</p><div class="row gap wrap"><button class="chip-btn" data-act="why" data-id="${item.id}">Why? ${icon('chevron', 14)}</button>${act}</div></div></div>`;
}

export default {
  id: 'today',
  render() {
    const prof = store.profile(); const now = new Date(); const cap = A.capacity(now); const item = adv.current(now);
    const nexts = nextItems(); const ne = A.nextImportantEvent(now); const r = ne ? A.readiness(ne, now) : null;
    const s = store.settings(); const custom = s.mode === 'custom'; const gap = custom ? 0 : A.gapDays(now); const habits = store.all('activities').filter((a) => a.enabled !== false && !a.kind);
    const minimal = s.minimalDay === dayKey();
    const rc = cap.overall >= 0.7 ? 'var(--green)' : cap.overall >= 0.5 ? 'var(--blue)' : 'var(--amber)';
    const lay = todayLayout(s);
    const P = {
      glance: () => h`<section class="card glance" data-act="capacity" role="button" tabindex="0" aria-label="Today at a glance. Tap for details">
        <div class="row gap center">${ring({ pct: cap.overall, size: 58, stroke: 6, color: rc })}<div class="grow"><div class="eyebrow">Today at a glance</div><div class="headline">${A.glanceHeadline(cap)}</div></div>${icon('chevron', 18, 'muted')}</div>
        <div class="tiles">
          <div class="tile"><div class="tile-h">${icon('bolt', 16, 'c-blue')} Energy</div><div class="tile-v">${round(cap.energy, 1)}<small>/10</small></div><div class="bar"><i style="width:${cap.energy * 10}%;background:var(--blue)"></i></div></div>
          <div class="tile"><div class="tile-h">${icon('brain', 16, 'c-violet')} Mental Load</div><div class="tile-v sm">${cap.mentalLoadLabel}</div><div class="pips">${[0, 1, 2, 3, 4, 5].map((i) => h`<i class="${i < cap.mentalLoadPips ? 'on' : ''} p${i}"></i>`)}</div></div>
          <div class="tile"><div class="tile-h">${icon('heart', 16, 'c-green')} Recovery</div><div class="tile-v sm">${cap.recoveryLabel}</div><div class="bar"><i style="width:${cap.recovery * 100}%;background:var(--green)"></i></div></div>
        </div>
        ${cap.estimated.energy ? h`<p class="tiny muted">Energy is estimated from your baseline until you log it.</p>` : ''}
      </section>`,
      routine: () => routineCards(now),
      advisor: () => advisorCard(item),
      focus: () => focusCard(cap),
      trackers: () => trackersSection(),
      habits: () => (habits.length ? h`<section><div class="sec-h"><h2>Habits</h2></div><div class="chips">${habits.map((a) => h`<button class="chip-btn big" data-act="habit" data-id="${a.id}">${a.name}</button>`)}</div></section>` : ''),
      next: () => h`<section><div class="sec-h"><h2>Next</h2><button class="link" data-act="goplan">See all ${icon('chevron', 14)}</button></div>
        ${nexts.length ? h`<ul class="timeline">${nexts.map((e, i) => h`<li><span class="t-time">${fmtTime(e.start)}</span><button class="t-card ${EVENT_COLOR[e.type]}" data-act="event" data-id="${e.id}"><span class="t-main"><b>${e.title}</b><small>${[e.location, e.end !== e.start ? fmtDur((new Date(e.end) - new Date(e.start)) / 60000) : '', dayKey(e.start) !== dayKey() ? fmtDate(e.start, { weekday: 'short', day: 'numeric', month: 'short' }) : ''].filter(Boolean).join(' · ') || e.type.replace('_', ' ')}</small></span><span class="t-ic">${icon(EVENT_ICON[e.type] || 'target', 20)}</span></button></li>`)}</ul>`
        : h`<div class="empty"><p>Nothing scheduled ahead.</p><button class="btn btn-sm" data-act="log" data-k="event">${icon('plus', 16)} Add event</button></div>`}
      </section>`,
      coming: () => h`<section><div class="sec-h"><h2>Coming Up</h2></div>
        ${ne ? h`<button class="card coming" data-act="ready" data-id="${ne.id}"><span class="date-tile"><small>${fmtDate(ne.start, { weekday: 'short' }).toUpperCase()}</small><b>${new Date(ne.start).getDate()}</b></span><span class="grow"><b>${ne.title}</b><small class="muted">${[ne.location, fmtDur((new Date(ne.end) - new Date(ne.start)) / 60000)].filter(Boolean).join(' · ')}</small></span><span class="rd"><small>Readiness</small><b>${pct(r.overall)}</b></span>${ring({ pct: r.overall, size: 44, stroke: 5, color: r.overall >= 0.7 ? 'var(--green)' : 'var(--blue)' })}${icon('chevron', 16, 'muted')}</button>`
          : h`<div class="empty"><p>No important events coming up.</p></div>`}
      </section>`,
    };
    return h`<div class="screen today">
      <header class="top">${logo()}<div class="row gap"><button class="icon-btn" data-act="search" aria-label="Search">${icon('search', 22)}</button><button class="icon-btn has-dot ${banners.length ? 'on' : ''}" data-act="bell" aria-label="Reminders">${icon('bell', 22)}</button></div></header>
      <div class="hero"><h1>${greeting(now)}${prof.name ? `, ${prof.name}` : ''}</h1><p class="muted">${fmtDate(now)}</p></div>
      ${banners.slice(0, 2).map((b) => h`<div class="banner"><span>${icon('clock', 18)} ${b.text}</span><span class="row gap"><button class="btn btn-sm" data-act="banner-open" data-e="${b.eventId}">Open</button><button class="icon-btn" data-act="banner-x" data-b="${b.id}" aria-label="Dismiss">${icon('x', 16)}</button></span></div>`)}
      ${gap >= 3 && s.gapAck !== dayKey() ? h`<div class="card slim"><div class="eyebrow">Welcome back</div><p>It’s been ${gap} days. No catching up needed — just a quick recalibration.</p><button class="btn btn-sm btn-primary" data-act="gap" data-d="${gap}">Recalibrate</button></div>` : ''}
      ${updateReady() ? h`<button class="card slim update-chip" data-act="upd"><span class="t-ic lead">${icon('sparkle', 20)}</span><span class="grow"><b>Update available</b><small class="muted"> ${releaseNotes() ? `LifeOS ${releaseNotes().version}` : 'A new version'} — see what’s new</small></span>${icon('chevron', 16, 'muted')}</button>` : ''}
      ${dueTrackerBanners(now)}
      ${minimal ? h`<div class="card slim"><div class="eyebrow">Essentials-only day is on</div><p>Showing only high-importance and time-fixed items. Nothing was deleted.</p><button class="btn btn-sm" data-act="minimal-off">Back to full plan</button></div>` : ''}
      ${lay.filter((c) => c.on).map((c) => P[c.id]())}
      <div class="center"><button class="link" data-act="customize-today">${icon('edit', 14)} Customize Today</button></div></div>`;
  },
  actions: {
    ...routineActions,
    upd: () => showUpdate(), 'customize-today': () => customizeTodaySheet(),
    'trk-hub': () => navigate('#/trackers'), 'trk-new': () => builderSheet(), 'trk-open': (el) => navigate(`#/tracker/${el.dataset.id}`),
    'trk-log': (el) => entrySheet(store.get('trackers', el.dataset.id)), 'trk-quick': (el) => quickLog(el.dataset.id, el.dataset.f, el.dataset.v),
    'trk-pin': async (el) => { const t = store.get('trackers', el.dataset.id); await store.save('trackers', { id: t.id, pinned: !t.pinned }); },
    search: () => searchSheet(), bell: () => notificationsSheet(), capacity: () => capacitySheet(),
    ask: () => askSheet(), setupai: () => { navigate('#/you'); setTimeout(() => document.getElementById('ai-api')?.scrollIntoView({ behavior: 'smooth' }), 350); },
    goplan: () => navigate('#/plan'), event: (el) => eventDetailSheet(el.dataset.id), ready: (el) => navigate(`#/readiness/${el.dataset.id}`),
    log: (el) => quickLogSheet(el.dataset.k), gap: (el) => gapSheet(Number(el.dataset.d)),
    why: (el) => { const it = store.get('advisorItems', el.dataset.id); if (it) whySheet(it); },
    advmenu: () => {
      const it = adv.current(); openSheet({
        title: 'Advisor', body: h`<div class="stack"><button class="list-btn" data-m="ask">${icon('send', 18)}<span><b>Ask the advisor</b><small>A question, a “what if”, or “can I afford…”</small></span></button><button class="list-btn" data-m="check">${icon('refresh', 18)}<span><b>Check in now</b><small>Re-run the local check (AI only if something is worth saying)</small></span></button>${it ? h`<button class="list-btn" data-m="later">${icon('x', 18)}<span><b>Not now</b><small>Hide this suggestion</small></span></button><button class="list-btn" data-m="less">${icon('bell', 18)}<span><b>Show less like this</b><small>Pause this kind of suggestion for two weeks</small></span></button>` : ''}</div>`,
        onOpen: (s) => s.el.addEventListener('click', async (e) => { const b = e.target.closest('[data-m]'); if (!b) return; s.close(); const m = b.dataset.m;
          if (m === 'ask') askSheet(); else if (m === 'check') { toast('Checking…'); await adv.evaluate('manual'); } else if (it) { await adv.feedback(it.id, m === 'later' ? 'not_now' : 'less'); } }),
      });
    },
    openlink: (el) => { const it = store.get('advisorItems', el.dataset.id); navigate(it.link); },
    openreport: (el) => { const it = store.get('advisorItems', el.dataset.id); store.save('advisorItems', { id: it.id, status: 'done' }); navigate('#/insights'); },
    dayreview: async () => { const { generateDaily } = await import('../reports.js'); await generateDaily(dayKey(), { useAI: aiReady() }); navigate('#/insights'); },
    minimal: async (el) => { await store.setSettings({ minimalDay: dayKey() }); await store.save('advisorItems', { id: el.dataset.id, status: 'done', outcome: 'accepted' }); toast('Essentials-only day on', { undo: () => store.setSettings({ minimalDay: null }) }); },
    'minimal-off': () => store.setSettings({ minimalDay: null }),
    baseline: async (el) => { const prev = store.settings().baselineStart; await store.setSettings({ baselineStart: dayKey() }); await store.save('advisorItems', { id: el.dataset.id, status: 'done', outcome: 'accepted' }); toast('New baseline started from today', { undo: () => store.setSettings({ baselineStart: prev }) }); },
    temporary: async (el) => { await store.save('advisorItems', { id: el.dataset.id, status: 'dismissed', outcome: 'temporary' }); toast('Okay — I’ll keep your existing baseline'); },
    friction: async (el) => {
      const it = store.get('advisorItems', el.dataset.id); const o = el.dataset.o; const { addMemory } = await import('../memory.js');
      await addMemory({ text: `“${it.frictionTitle}” keeps moving — reason: ${o.toLowerCase()}`, kind: 'temporary_context', source: 'user_explicit', expiresInDays: 30 });
      await store.save('advisorItems', { id: it.id, status: 'done', outcome: o }); toast('Thanks — that helps me adapt, no judgement');
    },
    habit: async (el) => { const a = store.get('activities', el.dataset.id); await commit({ type: 'create_log', payload: { logType: 'custom', value: 1, unit: a.unit || '', detail: a.name, meta: { activityId: a.id } } }, { notify: false }); },
    'banner-open': (el) => eventDetailSheet(el.dataset.e),
    'banner-x': async (el) => { await store.setSettings({ dismissed: { ...store.settings().dismissed, [`banner:${el.dataset.b}`]: new Date().toISOString() } }); banners = banners.filter((b) => b.id !== el.dataset.b); },
  },
  mount(root) { const g = root.querySelector('.glance'); if (g && !g._kb) { g._kb = true; g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); capacitySheet(); } }); } },
};
