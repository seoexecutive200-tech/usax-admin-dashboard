// Which cards appear on Today, and in what order. Stored in settings.todayLayout as [{id, on}]; anything not stored falls back to the
// defaults of the current mode (Classic shows everything, Blank canvas hides the built-in wellness cards).
import { store } from './store.js';
import { h, icon, openSheet, toast } from './ui.js';

export const TODAY_CARDS = [
  { id: 'glance', label: 'Today at a glance', hint: 'Energy, mental load and recovery', builtin: true },
  { id: 'routine', label: 'Daily routines', hint: 'Office hours and other routines, with nudges' },
  { id: 'timer', label: 'Focus timer', hint: 'Start a focus session and keep reminders quiet' },
  { id: 'advisor', label: 'Advisor', hint: 'Suggestions, only when worth it' },
  { id: 'focus', label: 'Focus', hint: 'Morning outlook, midday and evening check-ins', builtin: true },
  { id: 'trackers', label: 'Your trackers', hint: 'The trackers you pinned' },
  { id: 'habits', label: 'Habits', hint: 'One-tap habit chips', builtin: true },
  { id: 'next', label: 'Next up', hint: 'Your next events and tasks' },
  { id: 'coming', label: 'Coming up', hint: 'The next important event' },
];
export function todayLayout(s = store.settings()) {
  const custom = s.mode === 'custom'; const saved = Array.isArray(s.todayLayout) ? s.todayLayout : [];
  const known = new Map(TODAY_CARDS.map((c) => [c.id, c])); const out = []; const seen = new Set();
  for (const x of saved) if (known.has(x?.id) && !seen.has(x.id)) { seen.add(x.id); out.push({ id: x.id, on: x.on !== false }); }
  for (const c of TODAY_CARDS) if (!seen.has(c.id)) out.push({ id: c.id, on: !(custom && c.builtin) }); // new/unsaved cards use the mode default
  return out;
}
const save = (lay) => store.setSettings({ todayLayout: lay });

export function customizeTodaySheet() {
  const draw = (s) => {
    const lay = todayLayout(); const meta = (id) => TODAY_CARDS.find((c) => c.id === id);
    s.setBody(h`<div class="stack"><p class="muted small">Choose what shows on Today and in what order. Nothing is deleted — hidden cards just step aside.</p>
      ${lay.map((c, i) => h`<div class="card inset lay-row"><label class="switch" aria-label="Show ${meta(c.id).label}"><input type="checkbox" data-on="${c.id}" ${c.on ? 'checked' : ''}><i></i></label>
        <div class="grow"><b>${meta(c.id).label}</b><div class="small muted">${meta(c.id).hint}</div></div>
        <div class="row gap"><button class="icon-btn" data-up="${c.id}" aria-label="Move ${meta(c.id).label} up" ${i === 0 ? 'disabled' : ''}>${icon('down', 18, 'flip')}</button><button class="icon-btn" data-dn="${c.id}" aria-label="Move ${meta(c.id).label} down" ${i === lay.length - 1 ? 'disabled' : ''}>${icon('down', 18)}</button></div></div>`)}
      <div class="row gap wrap"><button class="btn btn-sm" data-preset="all">Show everything</button><button class="btn btn-sm" data-preset="mine">Only what I created</button><button class="btn btn-sm btn-danger-ghost" data-preset="reset">Reset</button></div></div>`);
    const el = s.el;
    el.querySelectorAll('[data-on]').forEach((i) => i.addEventListener('change', async () => { await save(todayLayout().map((c) => (c.id === i.dataset.on ? { ...c, on: i.checked } : c))); draw(s); }));
    const move = async (id, d) => { const l = todayLayout(); const k = l.findIndex((c) => c.id === id); const j = k + d; if (j < 0 || j >= l.length) return; [l[k], l[j]] = [l[j], l[k]]; await save(l); draw(s); };
    el.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => move(b.dataset.up, -1)));
    el.querySelectorAll('[data-dn]').forEach((b) => b.addEventListener('click', () => move(b.dataset.dn, 1)));
    el.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', async () => {
      const p = b.dataset.preset; const l = todayLayout();
      if (p === 'reset') await store.setSettings({ todayLayout: null }); else await save(l.map((c) => ({ ...c, on: p === 'all' ? true : !meta(c.id).builtin })));
      toast(p === 'reset' ? 'Today reset to default' : 'Today updated'); draw(s);
    }));
  };
  openSheet({ title: 'Customize Today', tall: true, body: '', onOpen: draw });
}
