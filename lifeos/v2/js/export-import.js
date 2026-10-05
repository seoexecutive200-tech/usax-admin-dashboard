// JSON export/import. Exports never contain the API key (it lives outside IndexedDB) and are scrubbed defensively.
import { store } from './store.js';
import { download, safeJSON, APP_VERSION, SCHEMA_VERSION, dayKey } from './util.js';
import { STORE_NAMES } from './db.js';

const KEY_RE = /gsk_[A-Za-z0-9_-]{8,}/g;
function scrub(value) {
  const text = JSON.stringify(value).replace(KEY_RE, '[removed]');
  return safeJSON(text, value);
}
export function exportData() {
  const data = scrub(store.exportAll());
  if (data.stores.settings) data.stores.settings = data.stores.settings.map(({ apiKey, key, ...rest }) => rest);
  download(`lifeos-export-${dayKey()}.json`, JSON.stringify(data, null, 2));
  return data;
}
export function validateImport(obj) {
  if (!obj || typeof obj !== 'object') return 'This file is not a LifeOS export.';
  if (obj.app !== 'LifeOS' || !obj.stores) return 'This file is not a LifeOS export.';
  if (typeof obj.schemaVersion !== 'number' || obj.schemaVersion > SCHEMA_VERSION) return `This export was made by a newer version (schema ${obj.schemaVersion}). Update LifeOS first.`;
  return null;
}
// Hook for future schema changes: upgrade older exports to the current schema.
function migrate(obj) { return obj; }
export async function importData(text) {
  const obj = safeJSON(text);
  const err = validateImport(obj); if (err) throw new Error(err);
  const m = migrate(obj);
  const stores = {};
  for (const n of STORE_NAMES) stores[n] = m.stores[n] || [];
  await store.replaceAll(scrub({ ...stores }));
  return { counts: Object.fromEntries(STORE_NAMES.map((n) => [n, stores[n].length])), appVersion: obj.appVersion || APP_VERSION };
}
