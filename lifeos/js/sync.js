// Cloud sync: IndexedDB stays the working copy (offline-first); the account snapshot follows it.
// Revisions use the server ETag. On a conflict (another device wrote first) we merge per record, newest updatedAt wins.
import { store } from './store.js';
import { api, ApiError } from './account.js';
import { STORE_NAMES } from './db.js';
import { APP_VERSION, SCHEMA_VERSION, lsGet, lsSet, lsDel, safeJSON, debounce } from './util.js';

export const sync = { status: 'idle', lastSync: null, message: '' };
const listeners = new Set();
export const onSyncChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const set = (status, message = '') => { sync.status = status; sync.message = message; if (status === 'synced') sync.lastSync = Date.now(); listeners.forEach((f) => f()); };

let uid = null; let applying = false; let running = null; let unsub = null; let timer = null;
const key = () => `lifeos.sync.${uid}`;
const getState = () => safeJSON(lsGet(key()), null) || { etag: null, dirty: false };
const setState = (patch) => lsSet(key(), JSON.stringify({ ...getState(), ...patch }));

const SINGLETONS = new Set(['settings', 'profiles']);
const pristine = () => store.all('logs').length + store.all('events').length + store.all('tasks').length + store.all('goals').length + store.all('memories').length === 0 && !store.profile().onboarded;

export function merge(local, remote) {
  const out = {};
  for (const n of STORE_NAMES) {
    const m = new Map();
    for (const r of remote[n] || []) m.set(r.id, r);
    for (const r of local[n] || []) { const o = m.get(r.id); if (!o || String(r.updatedAt || '') >= String(o.updatedAt || '')) m.set(r.id, r); }
    out[n] = [...m.values()];
    if (SINGLETONS.has(n) && out[n].length > 1) out[n] = [out[n].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]];
  }
  return out;
}
const apply = async (stores) => { applying = true; try { await store.replaceAll(stores); } finally { applying = false; } };

async function fetchRemote() {
  const r = await api('/api/data', { method: 'GET' });
  return r.empty ? null : r;
}
async function put(ifMatch) {
  const v = store.version();
  const r = await api('/api/data', { method: 'PUT', body: { stores: store.exportAll().stores, appVersion: APP_VERSION, schemaVersion: SCHEMA_VERSION, ifMatch: ifMatch || undefined } });
  setState({ etag: r.etag, dirty: store.version() !== v });
}

async function run() {
  set('syncing');
  try {
    const st = getState();
    const remote = await fetchRemote();
    if (!remote) { await put(null); }
    else if (!st.etag && pristine()) { await apply(remote.stores); setState({ etag: remote.etag, dirty: false }); }
    else if (st.etag === remote.etag && !st.dirty) { /* up to date */ }
    else if (!st.dirty && st.etag) { await apply(remote.stores); setState({ etag: remote.etag, dirty: false }); }
    else { // local changes (or first sign-in with existing local data): merge, then push on top of the remote revision
      await apply(merge(store.exportAll().stores, remote.stores)); await put(remote.etag);
    }
    set('synced');
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) { // someone wrote between our read and write: merge once more
      try { const remote = await fetchRemote(); if (remote) { await apply(merge(store.exportAll().stores, remote.stores)); await put(remote.etag); } else await put(null); set('synced'); return; }
      catch (e2) { e = e2.status === 409 ? new ApiError(409, 'Another device saved at the same moment. Tap Sync now to retry.') : e2; }
    }
    if (e instanceof ApiError && e.status === 401) set('auth', 'Your session expired. Please log in again.');
    else if (e instanceof ApiError && e.network) set('offline', 'Offline — changes will sync when you reconnect.');
    else set('error', e.message || 'Sync failed.');
  }
}
export function syncNow() { if (!uid) return Promise.resolve(); if (!running) running = run().finally(() => { running = null; }); return running; }
/** Push pending changes now. Resolves true when nothing is left unsynced. */
export async function flush() { if (!uid) return true; if (running) await running; if (getState().dirty || sync.status !== 'synced') await syncNow(); return sync.status === 'synced' && !getState().dirty; }
export const hasPending = () => !!uid && getState().dirty;

const schedule = debounce(() => syncNow(), 2500);
export async function startSync(userId) {
  stopSync(); uid = userId;
  await syncNow(); // initial pull first (before onboarding) so a returning user's data wins
  unsub = store.on(() => { if (applying) return; setState({ dirty: true }); set(sync.status === 'offline' ? 'offline' : 'pending'); schedule(); });
  window.addEventListener('online', syncNow);
  document.addEventListener('visibilitychange', onVis);
  timer = setInterval(() => { if (getState().dirty || sync.status === 'offline' || sync.status === 'error') syncNow(); }, 60000);
}
const onVis = () => { if (document.hidden && getState().dirty) syncNow(); else if (!document.hidden) syncNow(); };
export function stopSync() {
  unsub?.(); unsub = null; clearInterval(timer); window.removeEventListener('online', syncNow); document.removeEventListener('visibilitychange', onVis); uid = null; set('idle');
}
export const clearSyncState = (id) => lsDel(`lifeos.sync.${id}`);
