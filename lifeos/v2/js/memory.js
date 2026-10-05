// AI memory: provenance, confidence, privacy flags, and pattern syncing.
import { store } from './store.js';
import { patterns } from './analytics.js';
import { addDays, nowISO } from './util.js';

export const SOURCE_LABEL = { user_explicit: 'You told me', derived: 'Observed', goal: 'Goal', event: 'Temporary', temporary: 'Temporary' };
export const sourceLabel = (m) => (m.kind === 'temporary_context' ? 'Temporary' : SOURCE_LABEL[m.source] || 'You told me');

export const usableMemories = () => store.all('memories').filter((m) =>
  !m.private && m.useForAdvice !== false && !m.rejected && !(m.expiresAt && new Date(m.expiresAt) < new Date()))
  .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.confidence || 0) - (a.confidence || 0));

export function addMemory({ text, kind = 'preference', source = 'user_explicit', confidence = 0.9, evidenceCount = 1, expiresInDays = null, extra = {} }) {
  const clean = String(text || '').trim().slice(0, 400); if (!clean) return null;
  const dup = store.all('memories').find((m) => m.text.toLowerCase() === clean.toLowerCase() && !m.rejected);
  if (dup) return store.save('memories', { id: dup.id, lastConfirmedAt: nowISO() });
  return store.save('memories', {
    kind, text: clean, source, confidence, evidenceCount, pinned: false, private: false, useForAdvice: true,
    lastConfirmedAt: nowISO(), ...(expiresInDays ? { expiresAt: addDays(new Date(), expiresInDays).toISOString() } : {}), ...extra,
  });
}
export const correctMemory = (id, text) => store.save('memories', { id, text: text.trim().slice(0, 400), source: 'user_explicit', confidence: 0.95, rejected: false, useForAdvice: true, lastConfirmedAt: nowISO() });
export const markWrong = (id) => store.save('memories', { id, rejected: true, useForAdvice: false });
export const setPrivate = (id, v) => store.save('memories', { id, private: v, useForAdvice: v ? false : true });
export const setUseForAdvice = (id, v) => store.save('memories', { id, useForAdvice: v });
export const togglePin = (id) => store.save('memories', { id, pinned: !store.get('memories', id)?.pinned });
export async function forget(id) {
  const m = store.get('memories', id);
  if (m?.kind === 'observed_pattern' && m.patternId) return store.save('memories', { id, rejected: true, useForAdvice: false, text: '(forgotten pattern)', forgotten: true });
  return store.remove('memories', id);
}

// Convert validated local patterns into derived memories (needs repeated evidence; Low-confidence excluded).
export async function syncPatterns() {
  for (const p of patterns(60)) {
    if (p.confidence === 'Low') continue;
    const existing = store.all('memories').find((m) => m.patternId === p.id);
    if (existing?.rejected || existing?.private) continue;
    if (existing) { if (existing.text !== p.text || existing.evidenceCount !== p.n) await store.save('memories', { id: existing.id, text: p.text, evidenceCount: p.n, confidence: p.confValue }); }
    else await store.save('memories', { kind: 'observed_pattern', source: 'derived', text: p.text, confidence: p.confValue, evidenceCount: p.n, patternId: p.id, pinned: false, private: false, useForAdvice: true, lastConfirmedAt: nowISO() });
  }
}
