// Calendar adapters. V1: .ics export + Google template link. Future OAuth adapters register here.
import { download } from './util.js';

const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\;');
const stampUTC = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const fold = (line) => line.match(/.{1,73}/g).join('\r\n ');

export function buildICS(events) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LifeOS//V1//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const e of events) {
    const end = e.end && e.end !== e.start ? e.end : new Date(new Date(e.start).getTime() + 30 * 60000).toISOString();
    lines.push('BEGIN:VEVENT', `UID:${e.id}@lifeos.local`, `DTSTAMP:${stampUTC(new Date())}`,
      `DTSTART:${stampUTC(e.start)}`, `DTEND:${stampUTC(end)}`, fold(`SUMMARY:${esc(e.title)}`));
    if (e.location) lines.push(fold(`LOCATION:${esc(e.location)}`));
    if (e.notes) lines.push(fold(`DESCRIPTION:${esc(e.notes)}`));
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
export const exportEventICS = (e) => download(`${e.title.replace(/[^\w-]+/g, '_').slice(0, 40) || 'event'}.ics`, buildICS([e]), 'text/calendar');
export const exportAllICS = (events) => download('lifeos-schedule.ics', buildICS(events), 'text/calendar');

export const adapters = {
  ics: { label: 'Download .ics (Apple, Outlook, Google)', run: exportEventICS },
  google: {
    label: 'Open in Google Calendar',
    run(e) {
      const end = e.end && e.end !== e.start ? e.end : new Date(new Date(e.start).getTime() + 30 * 60000).toISOString();
      const q = new URLSearchParams({ action: 'TEMPLATE', text: e.title, dates: `${stampUTC(e.start)}/${stampUTC(end)}`, details: e.notes || '', location: e.location || '' });
      window.open(`https://calendar.google.com/calendar/render?${q}`, '_blank', 'noopener');
    },
  },
};

const ICS_DAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
/** Weekly recurring calendar entry for a routine (floating local time). */
export function exportRoutineICS(r) {
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date(); for (let i = 0; i < 8 && !(r.days || []).includes(d.getDay()); i++) d.setDate(d.getDate() + 1);
  const stamp = (hhmm) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${hhmm.replace(':', '')}00`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LifeOS//V1//EN', 'BEGIN:VEVENT', `UID:${r.id}@lifeos.local`, `DTSTAMP:${stampUTC(new Date())}`,
    `DTSTART:${stamp(r.start)}`, `DTEND:${stamp(r.end)}`, `RRULE:FREQ=WEEKLY;BYDAY=${(r.days || []).map((x) => ICS_DAY[x]).join(',')}`, fold(`SUMMARY:${esc(r.name)}`), 'END:VEVENT', 'END:VCALENDAR'];
  download(`${r.name.replace(/[^\w-]+/g, '_').slice(0, 40) || 'routine'}.ics`, `${lines.join('\r\n')}\r\n`, 'text/calendar');
}
