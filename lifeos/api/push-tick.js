// Scheduler endpoint: sends every reminder that is due. Call it every few minutes with  Authorization: Bearer <PUSH_CRON_SECRET>
// (GitHub Actions, cron-job.org, or Vercel Cron — Vercel sends CRON_SECRET automatically).
import { timingSafeEqual } from 'node:crypto';
import { send, storageConfigured, listKeys } from './_lib.js';
import { vapidReady, runDue } from './_push.js';

const ok = (got, want) => { const a = Buffer.from(got), b = Buffer.from(want); return a.length === b.length && timingSafeEqual(a, b); };

export default async function handler(req, res) {
  try {
    const secret = process.env.PUSH_CRON_SECRET || process.env.CRON_SECRET || '';
    if (secret.length < 16) return send(res, 503, { error: 'PUSH_CRON_SECRET is not configured' });
    const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!auth || !ok(auth, secret)) return send(res, 401, { error: 'Unauthorized' });
    if (!vapidReady() || !storageConfigured()) return send(res, 503, { error: 'Push is not configured' });
    const started = Date.now(); let users = 0, sent = 0;
    for (const key of await listKeys('push/')) {
      if (Date.now() - started > 12000) break; // stay inside the function limit; the next tick continues
      const uid = key.replace(/^push\//, '').replace(/\.json$/, ''); if (!/^[\w-]{6,80}$/.test(uid)) continue;
      try { const r = await runDue(uid); users++; sent += r.sent; } catch (e) { console.error('tick user failed', e?.name); }
    }
    return send(res, 200, { ok: true, users, sent, ms: Date.now() - started });
  } catch (e) { console.error('tick error', e?.name, e?.message); return send(res, 500, { error: 'Tick failed' }); }
}
