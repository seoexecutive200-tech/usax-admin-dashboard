// IndexedDB access layer. Only store.js talks to this module.
import { SCHEMA_VERSION } from './util.js';

export const DB_NAME = 'lifeos';
export const DB_VERSION = 1;

export const STORE_DEFS = {
  profiles: {}, settings: {}, activities: {},
  logs: { indexes: [['ts', 'ts'], ['type', 'type']] },
  events: { indexes: [['start', 'start']] },
  tasks: {}, goals: {}, memories: {},
  advisorItems: { indexes: [['createdAt', 'createdAt']] },
  reports: {}, experiments: {}, finance: {},
};
export const STORE_NAMES = Object.keys(STORE_DEFS);

// Migration hooks keyed by target version. Add a new function here when DB_VERSION increases.
const MIGRATIONS = {
  1(db) {
    for (const [name, def] of Object.entries(STORE_DEFS)) {
      if (db.objectStoreNames.contains(name)) continue;
      const os = db.createObjectStore(name, { keyPath: 'id' });
      (def.indexes || []).forEach(([n, p]) => os.createIndex(n, p));
    }
  },
};

let dbPromise = null;
let memoryMode = false;
const mem = Object.fromEntries(STORE_NAMES.map((n) => [n, new Map()]));
export const isPersistent = () => !memoryMode;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (!('indexedDB' in globalThis)) { memoryMode = true; return resolve(null); }
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { memoryMode = true; return resolve(null); }
    req.onupgradeneeded = (e) => {
      const db = req.result;
      for (let v = e.oldVersion + 1; v <= (e.newVersion || DB_VERSION); v++) MIGRATIONS[v]?.(db, req.transaction);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { memoryMode = true; resolve(null); };
    req.onblocked = () => { memoryMode = true; resolve(null); };
  });
  return dbPromise;
}

const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });

export async function getAll(store) {
  const db = await open();
  if (!db) return [...mem[store].values()];
  return wrap(db.transaction(store).objectStore(store).getAll());
}
export async function putMany(store, recs) {
  const db = await open();
  if (!db) { recs.forEach((r) => mem[store].set(r.id, r)); return; }
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  recs.forEach((r) => os.put(r));
  await done(tx);
}
export async function removeMany(store, ids) {
  const db = await open();
  if (!db) { ids.forEach((i) => mem[store].delete(i)); return; }
  const tx = db.transaction(store, 'readwrite');
  ids.forEach((i) => tx.objectStore(store).delete(i));
  await done(tx);
}
export async function clearStore(store) {
  const db = await open();
  if (!db) { mem[store].clear(); return; }
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).clear();
  await done(tx);
}
export const stamp = (rec) => ({ schemaVersion: SCHEMA_VERSION, ...rec });
