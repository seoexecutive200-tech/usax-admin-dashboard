// GET  /api/data            -> { empty: true } | { stores, etag, updatedAt }
// PUT  /api/data {stores, ifMatch?}  -> { etag }   (409 on revision conflict)
import { send, readBody, checkOrigin, storageConfigured, sessionUser, readJSON, writeJSON, dataKey, scrubKeys } from './_lib.js';

const STORES = ['profiles', 'settings', 'activities', 'logs', 'events', 'tasks', 'goals', 'memories', 'advisorItems', 'reports', 'experiments', 'finance'];
const MAX_BYTES = 3_500_000; // Vercel function body limit is 4.5 MB

export default async function handler(req, res) {
  try {
    if (!storageConfigured()) return send(res, 503, { error: 'Accounts are not set up on this server yet.' });
    if (!checkOrigin(req)) return send(res, 403, { error: 'Request blocked' });
    const s = await sessionUser(req);
    if (!s) return send(res, 401, { error: 'Please log in again.' });
    const key = dataKey(s.user.id);

    if (req.method === 'GET') {
      const rec = await readJSON(key);
      if (!rec) return send(res, 200, { empty: true });
      return send(res, 200, { stores: rec.json.stores, etag: String(rec.json.rev || 0), updatedAt: rec.json.updatedAt, appVersion: rec.json.appVersion });
    }
    if (req.method === 'PUT') {
      const body = await readBody(req, MAX_BYTES);
      if (!body.stores || typeof body.stores !== 'object' || Array.isArray(body.stores)) return send(res, 400, { error: 'Invalid data' });
      const stores = {};
      for (const n of STORES) {
        const arr = body.stores[n] ?? [];
        if (!Array.isArray(arr) || arr.some((r) => !r || typeof r.id !== 'string')) return send(res, 400, { error: `Invalid ${n}` });
        stores[n] = arr;
      }
      // Optimistic concurrency with our own revision counter (blob ETag formats differ between reads and writes).
      const cur = await readJSON(key);
      const curRev = cur?.json.rev || 0;
      if (cur && String(body.ifMatch ?? '') !== String(curRev)) return send(res, 409, { error: 'conflict' });
      const doc = JSON.parse(scrubKeys(JSON.stringify({ stores, rev: curRev + 1, appVersion: String(body.appVersion || ''), schemaVersion: Number(body.schemaVersion) || 1, updatedAt: new Date().toISOString() })));
      await writeJSON(key, doc);
      return send(res, 200, { etag: String(doc.rev), updatedAt: doc.updatedAt });
    }
    return send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    if (e.code === 'NOT_CONFIGURED') return send(res, 503, { error: 'Accounts are not set up on this server yet.' });
    if (e.code === 'TOO_LARGE') return send(res, 413, { error: 'Your data is too large to sync. Export a backup and remove old entries.' });
    if (e instanceof SyntaxError) return send(res, 400, { error: 'Bad request' });
    console.error('data error', e?.name, e?.message);
    return send(res, 500, { error: 'Something went wrong. Please try again.' });
  }
}
