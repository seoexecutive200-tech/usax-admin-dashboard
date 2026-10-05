// Shared server helpers for LifeOS accounts. Plain Node (req, res) handlers so they run on Vercel and in tools/dev-server.js.
import { createHash, createHmac, randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const scrypt = promisify(_scrypt);
export const COOKIE = 'lifeos_session';
const SESSION_DAYS = 30;
const isDev = () => process.env.LIFEOS_DEV === '1';

// ---------- storage: private Vercel Blob in production, filesystem for local dev ----------
// Older stores inject BLOB_READ_WRITE_TOKEN; newer ones inject BLOB_STORE_ID and the SDK authenticates with the function's OIDC token.
const useBlob = () => !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) && !isDev();
export const storageConfigured = () => useBlob() || isDev();

async function blobSdk() { return import('@vercel/blob'); }
const devPath = (p) => join(process.env.LIFEOS_DEV_DIR || '.devdata', p);

/** Returns { json, etag } or null. */
export async function readJSON(pathname) {
  if (useBlob()) {
    const { get } = await blobSdk();
    const r = await get(pathname, { access: 'private', useCache: false });
    if (!r || !r.stream) return null;
    const text = await new Response(r.stream).text();
    return { json: JSON.parse(text), etag: r.blob.etag };
  }
  try {
    const text = await readFile(devPath(pathname), 'utf8');
    return { json: JSON.parse(text), etag: createHash('sha1').update(text).digest('hex') };
  } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
/** opts.create: fail if exists. opts.ifMatch: fail unless etag matches. Throws err.code='CONFLICT' on failure. */
export async function writeJSON(pathname, value, { create = false, ifMatch = null } = {}) {
  const body = JSON.stringify(value);
  if (useBlob()) {
    const { put } = await blobSdk();
    try {
      const r = await put(pathname, body, { access: 'private', contentType: 'application/json', addRandomSuffix: false, ...(ifMatch ? { ifMatch } : { allowOverwrite: !create }) });
      return r.etag || null;
    } catch (e) {
      if (/already exists|precondition|etag|412/i.test(String(e?.message)) || e?.name === 'BlobPreconditionFailedError' || e?.name === 'BlobAlreadyExistsError') { const c = new Error('conflict'); c.code = 'CONFLICT'; throw c; }
      throw e;
    }
  }
  const file = devPath(pathname); await mkdir(dirname(file), { recursive: true });
  const cur = await readJSON(pathname);
  if ((create && cur) || (ifMatch && (!cur || cur.etag !== ifMatch))) { const c = new Error('conflict'); c.code = 'CONFLICT'; throw c; }
  await writeFile(file, body); return createHash('sha1').update(body).digest('hex');
}
export async function removeBlob(pathname) {
  if (useBlob()) { const { del } = await blobSdk(); await del(pathname); return; }
  await rm(devPath(pathname), { force: true });
}

/** Pathnames under a prefix (e.g. 'push/'). */
export async function listKeys(prefix) {
  if (useBlob()) {
    const { list } = await blobSdk(); const out = []; let cursor;
    do { const r = await list({ prefix, cursor, limit: 1000 }); out.push(...r.blobs.map((b) => b.pathname)); cursor = r.hasMore ? r.cursor : undefined; } while (cursor);
    return out;
  }
  try { return (await readdir(devPath(prefix))).map((f) => `${prefix}${f}`); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}

// ---------- http helpers ----------
export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}
export async function readBody(req, limit = 3_500_000) {
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let raw = '';
  if (typeof req.body === 'string') raw = req.body;
  else if (Buffer.isBuffer(req.body)) raw = req.body.toString('utf8');
  else {
    let size = 0; const chunks = [];
    for await (const c of req) { size += c.length; if (size > limit) { const e = new Error('too large'); e.code = 'TOO_LARGE'; throw e; } chunks.push(c); }
    raw = Buffer.concat(chunks).toString('utf8');
  }
  if (raw.length > limit) { const e = new Error('too large'); e.code = 'TOO_LARGE'; throw e; }
  return raw ? JSON.parse(raw) : {};
}
/** CSRF defence: custom header (forces CORS preflight) + same-origin check when Origin is present. */
export function checkOrigin(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  if (req.headers['x-requested-with'] !== 'lifeos') return false;
  const origin = req.headers.origin; if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
const parseCookies = (h = '') => Object.fromEntries(h.split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const secure = (req) => req.headers['x-forwarded-proto'] === 'https' || !/^(localhost|127\.)/.test(req.headers.host || '');
export const sessionCookie = (req, token, maxAge = SESSION_DAYS * 86400) =>
  `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`;

// ---------- passwords & sessions ----------
export const normEmail = (e) => String(e || '').trim().toLowerCase();
export const validEmail = (e) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const userKey = (email) => `users/${createHash('sha256').update(email).digest('hex')}.json`;
export const dataKey = (id) => `data/${id}.json`;
export const loadUser = (email) => readJSON(userKey(email));
export const saveUser = (user, opts) => writeJSON(userKey(user.email), user, opts);
export const deleteUserRecord = (email) => removeBlob(userKey(email));

export async function hashPassword(password, saltHex = randomBytes(16).toString('hex')) {
  const key = await scrypt(password, Buffer.from(saltHex, 'hex'), 64);
  return { salt: saltHex, hash: key.toString('hex') };
}
export async function verifyPassword(password, user) {
  // Always do the expensive work so unknown emails and wrong passwords take about the same time.
  const salt = user?.salt || '00'.repeat(16);
  const key = await scrypt(password, Buffer.from(salt, 'hex'), 64);
  if (!user) return false;
  const want = Buffer.from(user.hash, 'hex');
  return want.length === key.length && timingSafeEqual(want, key);
}
function secret() {
  const s = process.env.SESSION_SECRET || (isDev() ? 'dev-only-secret-not-for-production' : '');
  if (!s || s.length < 24) { const e = new Error('SESSION_SECRET is not configured'); e.code = 'NOT_CONFIGURED'; throw e; }
  return s;
}
const b64 = (b) => Buffer.from(b).toString('base64url');
export function signSession(user) {
  const payload = b64(JSON.stringify({ uid: user.id, email: user.email, sv: user.sv || 0, exp: Date.now() + SESSION_DAYS * 86400000 }));
  return `${payload}.${createHmac('sha256', secret()).update(payload).digest('base64url')}`;
}
/** Returns { user, etag } for a valid session cookie, else null. */
export async function sessionUser(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE]; if (!token) return null;
  const [payload, sig] = token.split('.'); if (!payload || !sig) return null;
  const want = createHmac('sha256', secret()).update(payload).digest();
  const got = Buffer.from(sig, 'base64url'); if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let p; try { p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  if (!p.exp || p.exp < Date.now()) return null;
  const rec = await loadUser(p.email); if (!rec || rec.json.id !== p.uid || (rec.json.sv || 0) !== p.sv) return null;
  return { user: rec.json, etag: rec.etag };
}
export const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name || '' });
export const scrubKeys = (text) => text.replace(/gsk_[A-Za-z0-9_-]{8,}/g, '[removed]');
