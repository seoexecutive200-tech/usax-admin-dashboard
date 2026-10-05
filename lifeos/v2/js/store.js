// Repository layer: in-memory mirror of IndexedDB with write-through persistence.
// UI and analytics read synchronously; every write is persisted before it resolves.
import * as db from './db.js';
import { uid, nowISO, SCHEMA_VERSION, APP_VERSION } from './util.js';

const DEFAULT_SETTINGS = {
  theme: 'dark', reducedMotion: 'auto', notifications: false,
  keyStorage: 'session', modelId: 'openai/gpt-oss-20b', temperature: 0.2,
  aiEnabled: true, advisorMode: 'balanced', quietHours: ['22:00', '07:00'],
  baselineStart: null, minimalDay: null, lastSuccessfulAiCall: null,
  welcomed: false, dismissed: {}, mode: 'classic', hosted: true, introSeen: false,
};
const DEFAULT_PROFILE = {
  name: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, locale: navigator.language || 'en',
  units: 'metric', onboarded: false, advisorMode: 'balanced',
  priorities: [
    { id: 'family', label: 'Family', weight: 5 }, { id: 'health', label: 'Health', weight: 5 },
    { id: 'financial', label: 'Financial security', weight: 4 }, { id: 'career', label: 'Career', weight: 4 },
    { id: 'fitness', label: 'Fitness', weight: 3 }, { id: 'learning', label: 'Learning', weight: 3 },
  ],
};

const data = Object.fromEntries(db.STORE_NAMES.map((n) => [n, []]));
const listeners = new Set();
export let version = 0;

export const store = {
  async init() {
    for (const n of db.STORE_NAMES) data[n] = await db.getAll(n);
    if (!data.settings.length) await this.save('settings', { id: 'main', ...DEFAULT_SETTINGS });
    if (!data.profiles.length) await this.save('profiles', { id: 'main', ...DEFAULT_PROFILE });
    this.cleanExpired();
  },
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit(info) { version++; listeners.forEach((fn) => { try { fn(info); } catch (e) { console.error(e); } }); },
  version: () => version,
  all(name) { return data[name]; },
  get(name, id) { return data[name].find((r) => r.id === id) || null; },
  where(name, pred) { return data[name].filter(pred); },
  settings() { return { ...DEFAULT_SETTINGS, ...(this.get('settings', 'main') || {}) }; },
  profile() { return { ...DEFAULT_PROFILE, ...(this.get('profiles', 'main') || {}) }; },
  async setSettings(patch) { return this.save('settings', { ...this.settings(), ...patch, id: 'main' }); },
  async setProfile(patch) { return this.save('profiles', { ...this.profile(), ...patch, id: 'main' }); },

  async save(name, rec, { silent = false } = {}) {
    const existing = rec.id ? this.get(name, rec.id) : null;
    const full = {
      ...(existing || {}), ...rec,
      id: rec.id || uid(name.slice(0, 3)),
      createdAt: existing?.createdAt || rec.createdAt || nowISO(),
      updatedAt: nowISO(), schemaVersion: SCHEMA_VERSION,
    };
    await db.putMany(name, [full]);
    const i = data[name].findIndex((r) => r.id === full.id);
    if (i >= 0) data[name][i] = full; else data[name].push(full);
    if (!silent) this.emit({ name, id: full.id, op: 'save' });
    return full;
  },
  async saveMany(name, recs) {
    const out = [];
    for (const r of recs) out.push(await this.save(name, r, { silent: true }));
    this.emit({ name, op: 'bulk' });
    return out;
  },
  async remove(name, id, { silent = false } = {}) {
    const prev = this.get(name, id);
    await db.removeMany(name, [id]);
    data[name] = data[name].filter((r) => r.id !== id);
    if (!silent) this.emit({ name, id, op: 'remove' });
    return prev;
  },
  // Restore a record exactly as it was (used by Undo).
  async restore(name, rec) {
    await db.putMany(name, [rec]);
    const i = data[name].findIndex((r) => r.id === rec.id);
    if (i >= 0) data[name][i] = rec; else data[name].push(rec);
    this.emit({ name, id: rec.id, op: 'restore' });
  },
  cleanExpired() {
    const now = Date.now();
    const gone = data.memories.filter((m) => m.expiresAt && new Date(m.expiresAt) < now && m.kind === 'temporary_context');
    gone.forEach((m) => this.remove('memories', m.id, { silent: true }));
  },

  // ---- export / import / reset ----
  exportAll() {
    const out = {
      app: 'LifeOS', appVersion: APP_VERSION, schemaVersion: SCHEMA_VERSION, exportedAt: nowISO(), stores: {},
    };
    for (const n of db.STORE_NAMES) out.stores[n] = data[n];
    return out;
  },
  async replaceAll(stores) {
    for (const n of db.STORE_NAMES) {
      await db.clearStore(n);
      const recs = Array.isArray(stores[n]) ? stores[n].filter((r) => r && typeof r.id === 'string') : [];
      data[n] = [];
      if (recs.length) { await db.putMany(n, recs); data[n] = recs; }
    }
    if (!this.get('settings', 'main')) await this.save('settings', { id: 'main', ...DEFAULT_SETTINGS }, { silent: true });
    if (!this.get('profiles', 'main')) await this.save('profiles', { id: 'main', ...DEFAULT_PROFILE }, { silent: true });
    this.emit({ op: 'replaceAll' });
  },
  async resetAll() {
    for (const n of db.STORE_NAMES) { await db.clearStore(n); data[n] = []; }
    await this.save('settings', { id: 'main', ...DEFAULT_SETTINGS }, { silent: true });
    await this.save('profiles', { id: 'main', ...DEFAULT_PROFILE }, { silent: true });
    this.emit({ op: 'reset' });
  },
};
