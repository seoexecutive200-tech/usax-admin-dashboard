// Accounts: thin client for /api/auth. The session is an HttpOnly cookie, so JavaScript never sees a token.
import { lsGet, lsSet, lsDel, safeJSON } from './util.js';

const LAST = 'lifeos.lastUser2';
export class ApiError extends Error { constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); } }

export async function api(path, { method = 'POST', body } = {}) {
  let res;
  try {
    res = await fetch(path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'lifeos' }, body: body ? JSON.stringify(body) : undefined });
  } catch { throw new ApiError(0, 'You appear to be offline.', { network: true }); }
  const text = await res.text(); const data = safeJSON(text, null);
  if (!res.ok || data === null) throw new ApiError(res.status, data?.error || (res.status === 404 ? 'not-available' : 'Something went wrong.'), { data });
  return data;
}

export const dbNameFor = (user) => `lifeos2_u_${user.id}`;
export const v1DbNameFor = (user) => `lifeos_u_${user.id}`; // read-only source for migration
export const rememberUser = (u) => lsSet(LAST, JSON.stringify(u));
export const lastUser = () => safeJSON(lsGet(LAST), null) || safeJSON(lsGet('lifeos.lastUser'), null); // falls back to the original app's remembered user
export const forgetUser = () => lsDel(LAST);

/** -> { state: 'local' | 'anon' | 'user', user?, offline? } */
export async function detect() {
  try {
    const r = await api('/api/auth', { body: { action: 'me' } });
    if (r.user) { rememberUser(r.user); return { state: 'user', user: r.user }; }
    return { state: 'anon' };
  } catch (e) {
    if (e.network) { const u = lastUser(); return u ? { state: 'user', user: u, offline: true } : { state: 'local' }; }
    return { state: 'local' }; // 404 (static host) or 503 (accounts not configured): run local-only
  }
}
export async function register({ email, password, name }) { const r = await api('/api/auth', { body: { action: 'register', email, password, name } }); rememberUser(r.user); return r.user; }
export async function login({ email, password }) { const r = await api('/api/auth', { body: { action: 'login', email, password } }); rememberUser(r.user); return r.user; }
export const logoutRequest = () => api('/api/auth', { body: { action: 'logout' } }).catch(() => {});
export const deleteAccountRequest = (password) => api('/api/auth', { body: { action: 'delete', password } });
