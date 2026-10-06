// More ways to take your data with you: calendar (.ics), spreadsheets (.csv) and your memories. Nothing leaves your device.
import { store } from './store.js';
import { download, dayKey } from './util.js';

const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);
const utc = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
const fold = (l) => { const out = []; let s = l; while (s.length > 74) { out.push(s.slice(0, 74)); s = ` ${s.slice(74)}`; } out.push(s); return out.join('\r\n'); };
export function exportICS() {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LifeOS//EN', 'CALSCALE:GREGORIAN'];
  for (const e of store.all('events').filter((x) => x.status !== 'skipped' && x.origin !== 'google')) {
    L.push('BEGIN:VEVENT', `UID:${e.id}@lifeos`, `DTSTAMP:${utc(e.updatedAt || e.createdAt || Date.now())}`);
    if (e.allDay) L.push(`DTSTART;VALUE=DATE:${dayKey(e.start).replace(/-/g, '')}`); else L.push(`DTSTART:${utc(e.start)}`, `DTEND:${utc(e.end || e.start)}`);
    L.push(`SUMMARY:${esc(e.title)}`); if (e.location) L.push(`LOCATION:${esc(e.location)}`); if (e.notes) L.push(`DESCRIPTION:${esc(e.notes)}`); L.push('END:VEVENT');
  }
  for (const t of store.all('tasks').filter((x) => x.due)) { L.push('BEGIN:VTODO', `UID:${t.id}@lifeos`, `DTSTAMP:${utc(t.updatedAt || Date.now())}`, `DUE:${utc(t.due)}`, `SUMMARY:${esc(t.title)}`, `STATUS:${t.status === 'done' ? 'COMPLETED' : 'NEEDS-ACTION'}`, 'END:VTODO'); }
  L.push('END:VCALENDAR'); download(`lifeos-calendar-${dayKey()}.ics`, `${L.map(fold).join('\r\n')}\r\n`, 'text/calendar');
}
const cell = (v) => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (rows) => rows.map((r) => r.map(cell).join(',')).join('\n');
export function exportCSV() {
  const logs = [['time', 'type', 'value', 'unit', 'detail', 'source'], ...store.all('logs').sort((a, b) => a.ts.localeCompare(b.ts)).map((l) => [l.ts, l.type, l.value, l.unit, l.detail, l.source])];
  const names = new Map(store.all('trackers').map((t) => [t.id, t.name]));
  const entries = [['time', 'tracker', 'values'], ...store.all('entries').sort((a, b) => a.ts.localeCompare(b.ts)).map((e) => [e.ts, names.get(e.trackerId) || e.trackerId, e.values])];
  const ci = [['time', 'check_in', 'status', 'answers (empty = unknown)', 'provenance'], ...store.all('checkins').sort((a, b) => a.ts.localeCompare(b.ts)).map((c) => [c.ts, c.checkinId, c.status, c.answers, c.provenance])];
  download(`lifeos-logs-${dayKey()}.csv`, csv(logs), 'text/csv'); download(`lifeos-tracker-entries-${dayKey()}.csv`, csv(entries), 'text/csv'); download(`lifeos-checkins-${dayKey()}.csv`, csv(ci), 'text/csv');
}
export function exportMemories() {
  download(`lifeos-memories-${dayKey()}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), memories: store.all('memories'), learnedRules: store.all('rules'), audit: store.settings().audit || [] }, null, 2));
}
