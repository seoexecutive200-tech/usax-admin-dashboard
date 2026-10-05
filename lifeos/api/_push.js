// Web Push helpers. VAPID keys live in env (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT); nothing sensitive goes in a payload.
import { readJSON, writeJSON } from './_lib.js';

export const pushKey = (uid) => `push/${uid}.json`;
export const vapidReady = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
export const MAX_SUBS = 5;
export const MAX_JOBS = 160;
const STALE_MS = 40 * 60 * 1000; // a reminder this late is no longer useful
const SENT_KEEP_MS = 3 * 86400000;

export async function loadDoc(uid) {
  const rec = await readJSON(pushKey(uid));
  const d = rec?.json || {};
  return { subs: d.subs || [], jobs: d.jobs || [], sent: d.sent || {}, lastTest: d.lastTest || 0, updatedAt: d.updatedAt || null };
}
export const saveDoc = (uid, d) => writeJSON(pushKey(uid), { ...d, updatedAt: new Date().toISOString() });

const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n);
export function sanitizeSub(sub) {
  let u; try { u = new URL(sub?.endpoint); } catch { return null; }
  const k = sub?.keys || {};
  if (u.protocol !== 'https:' || String(sub.endpoint).length > 600 || !/^[\w-]{20,200}$/.test(k.p256dh || '') || !/^[\w-]{10,60}$/.test(k.auth || '')) return null;
  return { endpoint: sub.endpoint, keys: { p256dh: k.p256dh, auth: k.auth } };
}
/** Validates the schedule the app uploads: only future-ish jobs, bounded and with plain-text bodies. */
export function sanitizeJobs(jobs, now = Date.now()) {
  if (!Array.isArray(jobs)) return null;
  const out = []; const seen = new Set();
  for (const j of jobs) {
    const at = Number(j?.at); const id = clean(j?.id, 120);
    if (!id || seen.has(id) || !Number.isFinite(at) || at < now - STALE_MS || at > now + 3 * 86400000) continue;
    seen.add(id); out.push({ id, at, title: clean(j.title, 80) || 'LifeOS', body: clean(j.body, 160), url: /^\.?\/?[\w./#?=&-]{0,80}$/.test(String(j.url || '')) ? String(j.url) : './index.html#/today' });
    if (out.length >= MAX_JOBS) break;
  }
  return out.sort((a, b) => a.at - b.at);
}

let wp = null;
async function sdk() {
  if (!wp) { wp = (await import('web-push')).default; wp.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY); }
  return wp;
}
/** Sends one notification. Returns 'ok' | 'gone' (subscription expired — delete it) | 'error'. */
export async function sendPush(sub, payload) {
  if (process.env.LIFEOS_PUSH_MOCK === '1' && process.env.LIFEOS_DEV === '1') { // test hook: record instead of calling a real push service
    const { appendFile, mkdir } = await import('node:fs/promises'); const dir = process.env.LIFEOS_DEV_DIR || '.devdata'; await mkdir(dir, { recursive: true });
    await appendFile(`${dir}/pushlog.jsonl`, `${JSON.stringify({ endpoint: sub.endpoint, payload, t: Date.now() })}\n`);
    return sub.endpoint.includes('gone') ? 'gone' : 'ok';
  }
  try { await (await sdk()).sendNotification(sub, JSON.stringify(payload), { TTL: 3600, urgency: 'high', timeout: 8000 }); return 'ok'; }
  catch (e) { return e?.statusCode === 404 || e?.statusCode === 410 ? 'gone' : 'error'; }
}
/** Sends every due job for one user's document. Marks them sent first (at most once), prunes dead subscriptions. */
export async function runDue(uid, now = Date.now()) {
  const doc = await loadDoc(uid);
  const due = doc.jobs.filter((j) => j.at <= now && now - j.at <= STALE_MS && !doc.sent[j.id]);
  const keep = doc.jobs.filter((j) => j.at > now);
  const sent = Object.fromEntries(Object.entries(doc.sent).filter(([, t]) => now - t < SENT_KEEP_MS));
  if (!due.length && keep.length === doc.jobs.length && Object.keys(sent).length === Object.keys(doc.sent).length) return { sent: 0 };
  for (const j of due) sent[j.id] = now;
  await saveDoc(uid, { ...doc, jobs: keep, sent });
  if (!due.length || !doc.subs.length) return { sent: 0 };
  const dead = new Set(); let n = 0;
  for (const j of due) {
    const res = await Promise.all(doc.subs.map(async (s) => [s, await sendPush(s, { id: j.id, title: j.title, body: j.body, url: j.url })]));
    for (const [s, r] of res) { if (r === 'gone') dead.add(s.endpoint); if (r === 'ok') n++; }
  }
  if (dead.size) { const cur = await loadDoc(uid); await saveDoc(uid, { ...cur, subs: cur.subs.filter((s) => !dead.has(s.endpoint)) }); }
  return { sent: n };
}
