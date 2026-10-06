// Read-only calendar subscriptions (Google Calendar "secret address in iCal format", Outlook, iCloud).
// The private link is stored server-side only (never in the app's data, exports or sync), and every request needs a signed-in session.
//   GET  /api/calendar                       -> { feeds: [{id, name, host, lastOk, lastError}] }
//   GET  /api/calendar?events=1&from=&to=    -> { feeds: [{id, name, events:[...], error?}] }   (ISO dates; window capped to ~6 months)
//   POST /api/calendar {action:'add', name, url}    -> { feed, count, sample }
//   POST /api/calendar {action:'remove', id}
import { randomBytes } from 'node:crypto';
import { send, readBody, checkOrigin, storageConfigured, sessionUser, readJSON, writeJSON } from './_lib.js';
import { parseICS } from './_ics.js';

const calKey = (uid) => `cal/${uid}.json`;
const MAX_FEEDS = 3; const MAX_BYTES = 4_000_000; const DAY = 86400000;
const isDev = () => process.env.LIFEOS_DEV === '1';
const ALLOWED = (h) => h === 'calendar.google.com' || h === 'outlook.office365.com' || h === 'outlook.live.com' || h.endsWith('.icloud.com') || (isDev() && h === 'localhost');

function normalizeUrl(raw) {
  let u; try { u = new URL(String(raw).trim().replace(/^webcal:/i, 'https:')); } catch { return null; }
  if (!ALLOWED(u.hostname) || (u.protocol !== 'https:' && !(isDev() && u.hostname === 'localhost')) || u.username || u.password || u.href.length > 600) return null;
  return u.href;
}
async function fetchICS(url) {
  let cur = url;
  for (let i = 0; i < 4; i++) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 9000);
    let r; try { r = await fetch(cur, { redirect: 'manual', signal: ctl.signal, headers: { Accept: 'text/calendar, */*', 'User-Agent': 'LifeOS-calendar' } }); } finally { clearTimeout(t); }
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { const nx = normalizeUrl(new URL(r.headers.get('location'), cur).href); if (!nx) throw new Error('redirect-blocked'); cur = nx; continue; }
    if (!r.ok) throw new Error(`http-${r.status}`);
    const buf = await r.arrayBuffer(); if (buf.byteLength > MAX_BYTES) throw new Error('too-large');
    const text = new TextDecoder('utf-8').decode(buf); if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('not-ical'); return text;
  }
  throw new Error('too-many-redirects');
}
const friendly = (m) => ({ 'not-ical': 'That link isn’t a calendar feed. Use the “Secret address in iCal format”.', 'http-404': 'Calendar not found — the secret link may have been reset.', 'http-403': 'Access denied — copy the secret link again.', 'redirect-blocked': 'That calendar link isn’t supported.', 'too-large': 'That calendar is too large to read.' }[m] || (/abort/i.test(m) ? 'The calendar took too long to respond.' : 'Couldn’t read that calendar.'));

export default async function handler(req, res) {
  try {
    if (!checkOrigin(req)) return send(res, 403, { error: 'Request blocked' });
    if (!storageConfigured()) return send(res, 503, { error: 'Accounts are not set up on this server yet.' });
    const s = await sessionUser(req); if (!s) return send(res, 401, { error: 'Please log in again.' });
    const uid = s.user.id; const rec = await readJSON(calKey(uid)); const doc = rec?.json || { feeds: [] };
    const pub = (f) => ({ id: f.id, name: f.name, host: (() => { try { return new URL(f.url).hostname; } catch { return ''; } })(), lastOk: f.lastOk || null, lastError: f.lastError || null });

    if (req.method === 'GET') {
      const q = new URL(req.url, 'http://x').searchParams;
      if (!q.get('events')) return send(res, 200, { feeds: doc.feeds.map(pub) });
      const now = Date.now(); const from = Math.max(now - 60 * DAY, Date.parse(q.get('from')) || now - 14 * DAY); const to = Math.min(now + 200 * DAY, Date.parse(q.get('to')) || now + 90 * DAY);
      const results = await Promise.all(doc.feeds.map(async (f) => { try { const events = parseICS(await fetchICS(f.url), from, to); f.lastOk = Date.now(); f.lastError = null; return { id: f.id, name: f.name, events }; } catch (e) { f.lastError = friendly(String(e?.message || e)); return { id: f.id, name: f.name, events: null, error: f.lastError }; } }));
      await writeJSON(calKey(uid), doc).catch(() => {});
      return send(res, 200, { feeds: results });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    const body = await readBody(req, 20_000);
    if (body.action === 'add') {
      if (doc.feeds.length >= MAX_FEEDS) return send(res, 400, { error: `You can connect up to ${MAX_FEEDS} calendars.` });
      const url = normalizeUrl(body.url); if (!url) return send(res, 400, { error: 'Paste the “Secret address in iCal format” link from Google Calendar (it starts with https://calendar.google.com/…).' });
      if (doc.feeds.some((f) => f.url === url)) return send(res, 409, { error: 'That calendar is already connected.' });
      let events; try { events = parseICS(await fetchICS(url), Date.now() - DAY, Date.now() + 60 * DAY); } catch (e) { return send(res, 422, { error: friendly(String(e?.message || e)) }); }
      const feed = { id: randomBytes(6).toString('hex'), name: String(body.name || 'Google Calendar').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Google Calendar', url, added: Date.now(), lastOk: Date.now(), lastError: null };
      doc.feeds.push(feed); await writeJSON(calKey(uid), doc);
      const upcoming = events.filter((e) => Date.parse(e.end) >= Date.now() || e.allDay).slice(0, 6);
      return send(res, 200, { feed: pub(feed), count: events.length, sample: upcoming });
    }
    if (body.action === 'remove') { doc.feeds = doc.feeds.filter((f) => f.id !== body.id); await writeJSON(calKey(uid), doc); return send(res, 200, { ok: true }); }
    return send(res, 400, { error: 'Unknown action' });
  } catch (e) {
    if (e.code === 'NOT_CONFIGURED') return send(res, 503, { error: 'Accounts are not set up on this server yet.' });
    if (e instanceof SyntaxError) return send(res, 400, { error: 'Bad request' });
    console.error('calendar error', e?.name, e?.message); // never log the feed URL
    return send(res, 500, { error: 'Something went wrong. Please try again.' });
  }
}
