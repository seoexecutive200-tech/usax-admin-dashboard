// Trackers hub: everything the user has defined, plus ways to create more.
import { store } from '../store.js';
import * as T from '../trackers.js';
import { h, icon, toast } from '../ui.js';
import { back, navigate } from '../router.js';
import { trackerCard, entrySheet, quickLog, builderSheet } from '../tracker-ui.js';

export default {
  id: 'trackers',
  render() {
    const list = T.allTrackers(); const arch = T.archivedTrackers(); const custom = store.settings().mode === 'custom';
    return h`<div class="screen trackers"><header class="top"><button class="icon-btn" data-act="back" aria-label="Back">${icon('chevronL', 22)}</button><h1 class="grow center-t">Trackers</h1><button class="icon-btn" data-act="new" aria-label="New tracker">${icon('plus', 22)}</button></header>
      <section class="card creator"><div class="eyebrow">${icon('sparkle', 12)} Build your own system</div><p>Track anything. Describe it in your own words and LifeOS sets it up — fields, targets, reminders and rules — or start from a template.</p><button class="btn btn-primary" data-act="new">${icon('plus', 16)} New tracker</button></section>
      ${list.length ? h`<div class="stack">${list.map((t) => trackerCard(t))}</div>` : h`<div class="empty"><p>You haven’t created any trackers yet.</p></div>`}
      ${arch.length ? h`<section><div class="sec-h"><h2>Archived</h2></div>${arch.map((t) => h`<div class="card row between center"><span><b>${t.name}</b></span><button class="btn btn-sm" data-act="unarchive" data-id="${t.id}">Restore</button></div>`)}</section>` : ''}
      <p class="tiny muted center">${custom ? 'Blank-canvas mode is on: built-in sleep, mood and routine suggestions are hidden. Change it in You.' : 'Built-in trackers (sleep, mood, water…) still work. For a blank canvas, switch modes in You.'}</p></div>`;
  },
  actions: {
    back: () => back('#/today'), new: () => builderSheet(), 'trk-open': (el) => navigate(`#/tracker/${el.dataset.id}`),
    'trk-log': (el) => entrySheet(store.get('trackers', el.dataset.id)), 'trk-quick': (el) => quickLog(el.dataset.id, el.dataset.f, el.dataset.v),
    'trk-pin': async (el) => { const t = store.get('trackers', el.dataset.id); await store.save('trackers', { id: t.id, pinned: !t.pinned }); toast(t.pinned ? 'Removed from Today' : 'Pinned to Today'); },
    unarchive: (el) => store.save('trackers', { id: el.dataset.id, archived: false }),
  },
};
