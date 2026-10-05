// Background reminders via Web Push.
//   GET  /api/push                       -> { available, publicKey, subscribed, devices }
//   POST /api/push {action:'subscribe', subscription}
//   POST /api/push {action:'unsubscribe', endpoint}
//   POST /api/push {action:'schedule', jobs:[{id, at, title, body, url}]}   (replaces the pending schedule)
//   POST /api/push {action:'test'}       -> sends a test notification to this account's devices
import { send, readBody, checkOrigin, storageConfigured, sessionUser } from './_lib.js';
import { vapidReady, loadDoc, saveDoc, sanitizeSub, sanitizeJobs, sendPush, MAX_SUBS } from './_push.js';

export default async function handler(req, res) {
  try {
    if (!checkOrigin(req)) return send(res, 403, { error: 'Request blocked' });
    const available = vapidReady() && storageConfigured();
    const s = await sessionUser(req).catch(() => null);
    if (req.method === 'GET') {
      if (!available || !s) return send(res, 200, { available: false });
      const d = await loadDoc(s.user.id);
      return send(res, 200, { available: true, publicKey: process.env.VAPID_PUBLIC_KEY, subscribed: d.subs.length > 0, devices: d.subs.length });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    if (!available) return send(res, 503, { error: 'Background notifications are not enabled on this server yet.' });
    if (!s) return send(res, 401, { error: 'Please log in again.' });
    const uid = s.user.id; const body = await readBody(req, 200_000); const d = await loadDoc(uid); const now = Date.now();

    if (body.action === 'subscribe') {
      const sub = sanitizeSub(body.subscription); if (!sub) return send(res, 400, { error: 'Invalid subscription' });
      d.subs = [...d.subs.filter((x) => x.endpoint !== sub.endpoint), { ...sub, added: now }].slice(-MAX_SUBS);
      await saveDoc(uid, d); return send(res, 200, { ok: true, devices: d.subs.length });
    }
    if (body.action === 'unsubscribe') {
      d.subs = d.subs.filter((x) => x.endpoint !== body.endpoint);
      if (!d.subs.length) d.jobs = [];
      await saveDoc(uid, d); return send(res, 200, { ok: true, devices: d.subs.length });
    }
    if (body.action === 'schedule') {
      const jobs = sanitizeJobs(body.jobs, now); if (!jobs) return send(res, 400, { error: 'Invalid schedule' });
      d.jobs = d.subs.length ? jobs.filter((j) => !d.sent[j.id]) : []; // nothing to deliver to without a subscribed device
      // never resurrect something already delivered
      await saveDoc(uid, d); return send(res, 200, { ok: true, count: d.jobs.length });
    }
    if (body.action === 'test') {
      if (!d.subs.length) return send(res, 409, { error: 'No device is subscribed yet.' });
      if (now - d.lastTest < 15000) return send(res, 429, { error: 'Please wait a few seconds between tests.' });
      d.lastTest = now; const dead = new Set(); let ok = 0;
      for (const sub of d.subs) { const r = await sendPush(sub, { id: `test-${now}`, title: 'LifeOS', body: 'Background reminders are working. ✅', url: './index.html#/you' }); if (r === 'ok') ok++; if (r === 'gone') dead.add(sub.endpoint); }
      d.subs = d.subs.filter((x) => !dead.has(x.endpoint)); await saveDoc(uid, d);
      return send(res, ok ? 200 : 502, ok ? { ok: true, delivered: ok } : { error: 'The push service did not accept the test. Turn notifications off and on again.' });
    }
    return send(res, 400, { error: 'Unknown action' });
  } catch (e) {
    if (e.code === 'NOT_CONFIGURED') return send(res, 503, { error: 'Accounts are not set up on this server yet.' });
    if (e.code === 'TOO_LARGE') return send(res, 413, { error: 'Request too large' });
    if (e instanceof SyntaxError) return send(res, 400, { error: 'Bad request' });
    console.error('push error', e?.name, e?.message);
    return send(res, 500, { error: 'Something went wrong. Please try again.' });
  }
}
