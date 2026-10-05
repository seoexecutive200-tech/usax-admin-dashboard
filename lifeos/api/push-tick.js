// Scheduler endpoint: sends every reminder that is due. Call it every few minutes with  Authorization: Bearer <PUSH_CRON_SECRET>
// (GitHub Actions, cron-job.org, or Vercel Cron — Vercel sends CRON_SECRET automatically).
import { timingSafeEqual } from 'node:crypto';
import { send, storageConfigured, listKeys, writeJSON } from './_lib.js';
import { vapidReady, runDue } from './_push.js';

const TICK_KEY = 'meta/push-tick.json';
const ok = (got, want) => { const a = Buffer.from(got), b = Buffer.from(want); return a.length === b.length && timingSafeEqual(a, b); };

export default async function handler(req, res) {
  try {
    // Vercel Cron sends CRON_SECRET; external schedulers (GitHub Actions, cron-job.org) send PUSH_CRON_SECRET. Either one works.
    const secrets = [process.env.PUSH_CRON_SECRET, process.env.CRON_SECRET].filter((x) => x && x.length >= 16);
    if (!secrets.length) return send(res, 503, { error: 'PUSH_CRON_SECRET is not configured' });
    // Header preferred; ?key= exists for free pingers that cannot send custom headers (the endpoint only delivers reminders that are already due).
    const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || new URL(req.url, 'http://x').searchParams.get('key') || '';
    if (!auth || !secrets.some((s) => ok(auth, s))) return send(res, 401, { error: 'Unauthorized' });
    if (!vapidReady() || !storageConfigured()) return send(res, 503, { error: 'Push is not configured' });
    const started = Date.now(); let users = 0, sent = 0;
    for (const key of await listKeys('push/')) {
      if (Date.now() - started > 12000) break; // stay inside the function limit; the next tick continues
      const uid = key.replace(/^push\//, '').replace(/\.json$/, ''); if (!/^[\w-]{6,80}$/.test(uid)) continue;
      try { const r = await runDue(uid); users++; sent += r.sent; } catch (e) { console.error('tick user failed', e?.name); }
    }
    await writeJSON(TICK_KEY, { at: Date.now(), users, sent }).catch(() => {}); // heartbeat so the app can show whether the clock is running
    return send(res, 200, { ok: true, users, sent, ms: Date.now() - started });
  } catch (e) { console.error('tick error', e?.name, e?.message); return send(res, 500, { error: 'Tick failed' }); }
}
