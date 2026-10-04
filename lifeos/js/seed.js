// Optional realistic demo data (deterministic). Everything is flagged demo:true so it can be removed cleanly.
import { store } from './store.js';
import { addDays, startOfDay, dayKey, nowISO } from './util.js';

function rng(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

export async function loadDemo() {
  const r = rng(42); const logs = []; const now = new Date(); const today = startOfDay(now);
  const mk = (day, hour, type, value, unit = '', extra = {}) => { const d = addDays(today, day); d.setHours(hour, Math.floor(r() * 50)); logs.push({ id: `demo_l_${logs.length}`, type, value, unit, ts: d.toISOString(), detail: '', meta: {}, source: 'demo', confidence: 1, demo: true, ...extra }); };
  for (let i = -34; i <= 0; i++) {
    const weekend = [0, 6].includes(addDays(today, i).getDay());
    const sleep = Math.max(4.8, Math.min(9, 6.9 + (weekend ? 0.6 : 0) + (r() - 0.5) * 2.2));
    const stress = Math.max(2, Math.min(9, 5 + (weekend ? -1 : 0.6) + (r() - 0.5) * 3.4 + (7 - sleep) * 0.4));
    const energy = Math.max(2, Math.min(9.5, 6.4 + (sleep - 6.9) * 0.9 - (stress - 5) * 0.25 + (r() - 0.5) * 1.4));
    const worked = r() > 0.5;
    const mood = Math.max(2, Math.min(9.5, 6.5 + (energy - 6.4) * 0.35 + (worked ? 0.7 : 0) - (stress - 5) * 0.2 + (r() - 0.5) * 1.2));
    if (i === 0) { mk(i, 7, 'sleep', +(6.3).toFixed(1), 'h', { meta: { quality: 3 } }); mk(i, 8, 'energy', 6, '/10'); mk(i, 8, 'mood', 7, '/10'); mk(i, 8, 'stress', 6, '/10'); mk(i, 9, 'water', 500, 'ml'); continue; }
    if (r() > 0.08) mk(i, 7, 'sleep', +sleep.toFixed(1), 'h', { meta: { quality: Math.max(1, Math.min(5, Math.round(sleep - 3.5))) } });
    if (r() > 0.1) mk(i, 12, 'energy', Math.round(energy), '/10');
    if (r() > 0.12) mk(i, 13, 'mood', Math.round(mood), '/10');
    if (r() > 0.12) mk(i, 18, 'stress', Math.round(stress), '/10');
    mk(i, 15, 'water', Math.round(1200 + r() * 1400), 'ml');
    if (worked) mk(i, 18, 'workout', Math.round(25 + r() * 35), 'min', { detail: r() > 0.5 ? 'walk' : 'run', meta: { kind: 'walk' } });
    if (r() > 0.55) mk(i, 17, 'outdoor', Math.round(20 + r() * 40), 'min');
  }
  const at = (dayOff, h, m = 0) => { const d = addDays(today, dayOff); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const end = (iso, min) => new Date(new Date(iso).getTime() + min * 60000).toISOString();
  const evDef = [
    ['Client call', 'video_call', 0, 11, 30, 30, 'normal', 'Zoom', false], ['Deep work', 'task', 0, 15, 0, 120, 'normal', 'Focus block', false],
    ['Walk', 'workout', 0, 18, 30, 45, 'low', 'Outdoor', false], ['Family time', 'social', 0, 20, 0, 120, 'normal', '', false],
    ['Team sync', 'meeting', 1, 10, 0, 45, 'normal', '', false], ['Dentist', 'appointment', 2, 16, 0, 45, 'normal', '', false],
    ['Quarterly review prep', 'task', 3, 14, 0, 90, 'high', '', true], ['Project deadline', 'deadline', 3, 17, 0, 0, 'high', '', true],
    ['Important client meeting', 'meeting', 4, 14, 0, 60, 'high', 'In person · Executive review', true], ['Weekend hike', 'workout', 5, 9, 0, 120, 'normal', '', false],
  ];
  const events = evDef.map(([title, type, off, hh, mm, dur, importance, location, prep], i) => {
    const start = at(off, hh, mm);
    return { id: `demo_e_${i}`, title, type, start, end: end(start, dur), timezone: store.profile().timezone, location, notes: title === 'Important client meeting' ? 'Executive review of Q4 roadmap. Bring revised pricing slides and the risk summary.' : '', importance, prepRequired: prep, prepStatus: prep ? 'in_progress' : 'none', status: 'scheduled', origin: 'user', checklist: title === 'Important client meeting' ? [{ id: 'c1', text: 'Finalize slide deck', done: true, origin: 'user' }, { id: 'c2', text: 'Review pricing numbers', done: true, origin: 'user' }, { id: 'c3', text: 'Rehearse the opening 2 minutes', done: false, origin: 'user' }, { id: 'c4', text: 'Confirm attendee list', done: false, origin: 'user' }] : [], rescheduleCount: 0, demo: true };
  });
  const tasks = [{ id: 'demo_t_0', title: 'Send revised proposal', due: at(1, 12), status: 'open', origin: 'user', rescheduleCount: 0, demo: true }, { id: 'demo_t_1', title: 'Book dentist follow-up', due: '', status: 'open', origin: 'user', rescheduleCount: 0, demo: true }];
  const goals = [{ id: 'demo_g_0', title: 'Protect sleep: 7h average', metric: 'sleep', target: 7, status: 'active', priority: 'high', demo: true }, { id: 'demo_g_1', title: 'Move 4 days a week', metric: 'workout', target: 4, status: 'active', priority: 'normal', demo: true }];
  const mems = [{ id: 'demo_m_0', kind: 'preference', text: 'Prefers evening workouts', source: 'user_explicit', confidence: 0.94, evidenceCount: 1, pinned: false, private: false, useForAdvice: true, lastConfirmedAt: nowISO(), demo: true }];
  const fin = [{ id: 'demo_f_0', kind: 'income', amount: 4200, label: 'Salary', category: 'income', recurring: true, date: dayKey(), demo: true }, { id: 'demo_f_1', kind: 'obligation', amount: 1450, label: 'Rent', category: 'obligation', demo: true }, { id: 'demo_f_2', kind: 'obligation', amount: 320, label: 'Bike EMI', category: 'obligation', demo: true }, { id: 'demo_f_3', kind: 'buffer', amount: 3000, label: 'Emergency buffer', category: 'buffer', demo: true }];
  await store.saveMany('logs', logs); await store.saveMany('events', events); await store.saveMany('tasks', tasks);
  await store.saveMany('goals', goals); await store.saveMany('memories', mems); await store.saveMany('finance', fin);
}
export async function removeDemo() {
  for (const n of ['logs', 'events', 'tasks', 'goals', 'memories', 'finance']) {
    for (const r of store.all(n).filter((x) => x.demo)) await store.remove(n, r.id, { silent: true });
  }
  for (const r of store.all('advisorItems')) await store.remove('advisorItems', r.id, { silent: true });
  for (const r of store.all('reports')) await store.remove('reports', r.id, { silent: true });
  store.emit({ op: 'removeDemo' });
}
export const hasDemo = () => ['logs', 'events', 'tasks', 'goals', 'memories', 'finance'].some((n) => store.all(n).some((x) => x.demo));
