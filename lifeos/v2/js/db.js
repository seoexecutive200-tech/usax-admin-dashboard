// IndexedDB access layer. Only store.js talks to this module.
import { SCHEMA_VERSION } from './util.js';

export const DB_VERSION = 1;
let dbName = 'lifeos2';
export const DB_NAME = 'lifeos2'; // v2 default (signed-out / local-only) database — v1's 'lifeos' database is never opened for writing
export const V1_DB_NAME = 'lifeos';
/** Each signed-in account gets its own database so users on one browser never see each other's data. Call before first use. */
export function setDbName(name) { dbName = name; dbPromise = null; memoryMode = false; }
export const getDbName = () => dbName;

export const STORE_DEFS = {
  profiles: {}, settings: {}, activities: {},
  logs: { indexes: [['ts', 'ts'], ['type', 'type']] },
  events: { indexes: [['start', 'start']] },
  tasks: {}, goals: {}, memories: {},
  trackers: {}, entries: { indexes: [['trackerId', 'trackerId'], ['ts', 'ts']] }, rules: {},
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
    try { req = indexedDB.open(dbName, DB_VERSION); } catch { memoryMode = true; return resolve(null); }
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

/** Read every store from a named database without creating it (used to move pre-account data into a new account). */
export async function readAllFrom(name) {
  if (!('indexedDB' in globalThis)) return null;
  return new Promise((resolve) => {
    let existed = true; let req;
    try { req = indexedDB.open(name); } catch { return resolve(null); }
    req.onupgradeneeded = () => { existed = false; req.transaction.abort(); };
    req.onerror = () => resolve(null);
    req.onsuccess = async () => {
      const d = req.result; const out = {};
      try {
        for (const n of STORE_NAMES) {
          if (!d.objectStoreNames.contains(n)) { out[n] = []; continue; }
          out[n] = await wrap(d.transaction(n).objectStore(n).getAll());
        }
      } catch { d.close(); return resolve(null); }
      d.close(); resolve(existed ? out : null);
    };
  });
}
export function deleteDatabase(name) {
  return new Promise((resolve) => {
    if (!('indexedDB' in globalThis)) return resolve();
    if (name === dbName) { dbPromise?.then((d) => d?.close()); dbPromise = null; }
    const r = indexedDB.deleteDatabase(name); r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
}
