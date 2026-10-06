// iCalendar (.ics) reading for calendar subscriptions: expands recurring events inside a time window. No network here — pure parsing.
import ICAL from 'ical.js';
import { createHash } from 'node:crypto';

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export function parseICS(text, fromMs, toMs, { max = 800 } = {}) {
  const comp = new ICAL.Component(ICAL.parse(String(text)));
  for (const tz of comp.getAllSubcomponents('vtimezone')) { try { ICAL.TimezoneService.register(tz); } catch { /* ignore a bad timezone block */ } }
  const from = ICAL.Time.fromJSDate(new Date(fromMs), true), to = ICAL.Time.fromJSDate(new Date(toMs), true);
  const masters = new Map(); const exceptions = [];
  for (const v of comp.getAllSubcomponents('vevent')) { let e; try { e = new ICAL.Event(v); } catch { continue; } if (!e.startDate) continue; (e.isRecurrenceException() ? exceptions : []).push(e); if (!e.isRecurrenceException()) masters.set(e.uid, e); }
  for (const ex of exceptions) masters.get(ex.uid)?.relateException(ex);
  const out = [];
  const push = (e, start, end, rid) => {
    const status = String(e.component.getFirstPropertyValue('status') || '').toUpperCase(); if (status === 'CANCELLED') return;
    const allDay = start.isDate; const s = start.toJSDate(), en = end ? end.toJSDate() : s;
    if (+en < fromMs && +s < fromMs) return; if (+s > toMs) return;
    const startISO = allDay ? `${start.year}-${String(start.month).padStart(2, '0')}-${String(start.day).padStart(2, '0')}` : s.toISOString();
    const endISO = allDay ? `${end.year}-${String(end.month).padStart(2, '0')}-${String(end.day).padStart(2, '0')}` : en.toISOString();
    out.push({ id: createHash('sha1').update(`${e.uid}|${rid || startISO}`).digest('hex').slice(0, 16), title: clip(e.summary, 120) || '(no title)', start: startISO, end: endISO, allDay, location: clip(e.location, 200), notes: clip(e.description, 400) });
  };
  for (const e of masters.values()) {
    try {
      if (!e.isRecurring()) { push(e, e.startDate, e.endDate); continue; }
      const it = e.iterator(); let next; let n = 0;
      while ((next = it.next()) && n++ < 6000) {
        if (next.compare(to) > 0) break;
        const d = e.getOccurrenceDetails(next); if (d.endDate.compare(from) < 0) continue;
        push(d.item, d.startDate, d.endDate, next.toString());
      }
    } catch { /* skip one broken event rather than failing the whole calendar */ }
    if (out.length >= max) break;
  }
  // an override can move an occurrence outside the iterator's walk; exceptions on their own are already covered through relateException
  return out.sort((a, b) => a.start.localeCompare(b.start)).slice(0, max);
}
