// POST /api/auth  { action: "register" | "login" | "logout" | "me" | "delete", ... }
import { randomUUID } from 'node:crypto';
import { send, readBody, checkOrigin, storageConfigured, normEmail, validEmail, loadUser, saveUser, deleteUserRecord, hashPassword, verifyPassword, signSession, sessionUser, sessionCookie, publicUser, removeBlob, dataKey } from './_lib.js';

const MAX_FAILS = 5; const LOCK_MS = 15 * 60 * 1000;

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return send(res, 200, { configured: storageConfigured() });
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    if (!checkOrigin(req)) return send(res, 403, { error: 'Request blocked' });
    if (!storageConfigured()) return send(res, 503, { error: 'Accounts are not set up on this server yet.', configured: false });
    const body = await readBody(req, 20_000);

    if (body.action === 'me') {
      const s = await sessionUser(req);
      return send(res, 200, { configured: true, user: s ? publicUser(s.user) : null });
    }
    if (body.action === 'logout') {
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
    }
    if (body.action === 'register') {
      const email = normEmail(body.email); const password = String(body.password || ''); const name = String(body.name || '').trim().slice(0, 40);
      if (!validEmail(email)) return send(res, 400, { error: 'Enter a valid email address.' });
      if (password.length < 8 || password.length > 200) return send(res, 400, { error: 'Use a password of at least 8 characters.' });
      const { salt, hash } = await hashPassword(password);
      const user = { id: randomUUID(), email, name, salt, hash, sv: 0, fails: 0, lockUntil: 0, createdAt: new Date().toISOString() };
      try { await saveUser(user, { create: true }); } catch (e) {
        if (e.code === 'CONFLICT') return send(res, 409, { error: 'An account with that email already exists. Try logging in.' });
        throw e;
      }
      return send(res, 201, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(req, signSession(user)) });
    }
    if (body.action === 'login') {
      const email = normEmail(body.email); const password = String(body.password || '');
      const rec = validEmail(email) && password.length <= 200 ? await loadUser(email) : null;
      const user = rec?.json;
      if (user && user.lockUntil && user.lockUntil > Date.now()) {
        await verifyPassword(password, user);
        return send(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
      }
      const ok = await verifyPassword(password, user);
      if (!ok) {
        if (user) { const fails = (user.fails || 0) + 1; await saveUser({ ...user, fails: fails >= MAX_FAILS ? 0 : fails, lockUntil: fails >= MAX_FAILS ? Date.now() + LOCK_MS : 0 }).catch(() => {}); }
        return send(res, 401, { error: 'Incorrect email or password.' });
      }
      if (user.fails || user.lockUntil) await saveUser({ ...user, fails: 0, lockUntil: 0 }).catch(() => {});
      return send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(req, signSession(user)) });
    }
    if (body.action === 'delete') {
      const s = await sessionUser(req); if (!s) return send(res, 401, { error: 'Please log in again.' });
      if (!(await verifyPassword(String(body.password || ''), s.user))) return send(res, 401, { error: 'Incorrect password.' });
      await removeBlob(dataKey(s.user.id)); await removeBlob(dataKey(`${s.user.id}.v2`)).catch(() => {}); await removeBlob(`usage/${s.user.id}.json`).catch(() => {}); await deleteUserRecord(s.user.email);
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
    }
    return send(res, 400, { error: 'Unknown action' });
  } catch (e) {
    if (e.code === 'NOT_CONFIGURED') return send(res, 503, { error: 'Accounts are not set up on this server yet.', configured: false });
    if (e.code === 'TOO_LARGE') return send(res, 413, { error: 'Request too large' });
    if (e instanceof SyntaxError) return send(res, 400, { error: 'Bad request' });
    console.error('auth error', e?.name, e?.message); // never log request bodies or passwords
    return send(res, 500, { error: 'Something went wrong. Please try again.' });
  }
}
