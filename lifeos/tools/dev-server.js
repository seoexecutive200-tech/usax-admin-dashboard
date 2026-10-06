// Local dev: serves the static app and the /api handlers. Data goes to ./.devdata (never use in production).
//   LIFEOS_DEV=1 node tools/dev-server.js [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.LIFEOS_DEV ??= '1';
const root = join(fileURLToPath(import.meta.url), '..', '..');
const port = Number(process.argv[2]) || 8124;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown' };

let bump = null; // test hook: /__bump?v=2.0.1 simulates a new v2 release (service worker + releases.json change)
createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/__bump') { bump = url.searchParams.get('v'); res.end('ok'); return; }
    if (bump && url.pathname === '/v2/service-worker.js') { const t = (await readFile(join(root, 'v2/service-worker.js'), 'utf8')).replace('lifeos2-v2.6.0', `lifeos2-v${bump}`); res.setHeader('Content-Type', 'text/javascript'); res.setHeader('Cache-Control', 'no-cache'); return res.end(t); }
    if (url.pathname === '/__ics/sample.ics') { // test hook: a calendar feed with dates relative to now
      const z = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''); const day = (n, h, m = 0) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); d.setUTCHours(h, m, 0, 0); return d; };
      const dd = (n) => { const d = day(n, 0); return z(d).slice(0, 8); };
      const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', 'BEGIN:VEVENT', 'UID:stand@t', `DTSTART:${z(day(0, 4, 30))}`, `DTEND:${z(day(0, 5))}`, 'RRULE:FREQ=DAILY;COUNT=10', 'SUMMARY:Team standup', 'END:VEVENT',
        'BEGIN:VEVENT', 'UID:dent@t', `DTSTART:${z(day(1, 9, 30))}`, `DTEND:${z(day(1, 10, 15))}`, 'SUMMARY:Dentist appointment', 'LOCATION:Smile Clinic', 'END:VEVENT',
        'BEGIN:VEVENT', 'UID:hol@t', `DTSTART;VALUE=DATE:${dd(2)}`, `DTEND;VALUE=DATE:${dd(3)}`, 'SUMMARY:Public holiday', 'END:VEVENT',
        'BEGIN:VEVENT', 'UID:can@t', `DTSTART:${z(day(3, 9))}`, `DTEND:${z(day(3, 10))}`, 'STATUS:CANCELLED', 'SUMMARY:Cancelled meeting', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
      res.setHeader('Content-Type', 'text/calendar'); return res.end(text);
    }
    if (url.pathname === '/releases.json') { const j = JSON.parse(await readFile(join(root, 'releases.json'), 'utf8')); if (bump) { j.latest.version = bump; j.latest.title = `LifeOS ${bump}`; j.latest.notes = [{ icon: 'sparkle', title: 'Test feature', text: 'Simulated release for testing.' }]; } res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); return res.end(JSON.stringify(j)); }
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/[^a-z-]/g, '');
      const mod = await import(pathToFileURL(join(root, 'api', `${name}.js`)).href);
      return await mod.default(req, res);
    }
    let p = normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''); if (p.endsWith('/')) p += 'index.html';
    const file = join(root, p);
    if (!file.startsWith(root) || file.includes('node_modules') || file.includes('.devdata')) { res.statusCode = 403; return res.end('forbidden'); }
    const data = await readFile(file);
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream'); res.end(data);
  } catch (e) { res.statusCode = e.code === 'ENOENT' || e.code === 'ERR_MODULE_NOT_FOUND' ? 404 : 500; res.end('not found'); }
}).listen(port, () => console.log(`LifeOS dev server on http://localhost:${port}`));
