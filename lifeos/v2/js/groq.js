// Groq OpenAI-compatible client. Own key: called directly from the browser by explicit user choice.
// No own key: signed-in users can use hosted AI through the server's /api/ai proxy (daily limit, key never reaches the browser).
// Key handling: never logged, never exported, never placed in error text.
import { styleInstruction } from './tone.js';
import { store } from './store.js';
import { SCHEMAS, validate, withDefaults } from './schemas.js';
import { lsGet, lsSet, lsDel, safeJSON, nowISO } from './util.js';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const KEY_SLOT = 'lifeos.groqKey'; // localStorage — deliberately outside IndexedDB so exports can never include it
let memoryKey = null;
let cooldownUntil = 0;
const noStrict = new Set();

export class AIError extends Error {
  constructor(kind, message, extra = {}) { super(message); this.kind = kind; Object.assign(this, extra); }
}
const scrub = (s) => String(s || '').replace(/gsk_[A-Za-z0-9_-]+/g, '[key]').slice(0, 300);

// ---- key management ----
export function getKey() { return memoryKey || lsGet(KEY_SLOT); }
export const hasKey = () => !!getKey();
export function setKey(key, remember) {
  const k = key.trim();
  memoryKey = k;
  if (remember) lsSet(KEY_SLOT, k); else lsDel(KEY_SLOT);
  return store.setSettings({ keyStorage: remember ? 'device' : 'session' });
}
export function setRemember(remember) {
  const k = getKey();
  if (!k) return store.setSettings({ keyStorage: remember ? 'device' : 'session' });
  return setKey(k, remember);
}
export function clearKey() { memoryKey = null; lsDel(KEY_SLOT); return store.setSettings({ lastSuccessfulAiCall: null }); }
export function maskedKey() {
  const k = getKey(); if (!k) return '';
  return `${k.slice(0, 4)}${'•'.repeat(10)}${k.slice(-4)}`;
}
export const looksLikeKey = (k) => /^gsk_[A-Za-z0-9]{20,}$/.test(k.trim());
// ---- hosted AI (v2) ----
export const hosted = { available: false, limit: 0, used: 0 };
export async function initHosted() {
  try {
    const r = await fetch('/api/ai', { credentials: 'same-origin', headers: { 'X-Requested-With': 'lifeos' } });
    const d = r.ok ? await r.json() : null; hosted.available = !!d?.available; hosted.limit = d?.limit || 0; hosted.used = d?.used || 0;
  } catch { hosted.available = false; }
  return hosted.available;
}
export const usingHosted = () => !getKey() && hosted.available;
export const aiReady = () => store.settings().aiEnabled && (hasKey() || hosted.available) && navigator.onLine !== false;
export const retryAfterMs = () => Math.max(0, cooldownUntil - Date.now());

function normalize(status, body, headers) {
  const msg = scrub(typeof body?.error === 'string' ? body.error : body?.error?.message);
  if (status === 401) return new AIError('auth', 'The Groq key was not accepted. Check it under You → AI & API.');
  if (status === 403) return new AIError('auth', 'Groq refused this request (403). The key may lack access to this model.');
  if (status === 429 && body?.limit) return new AIError('limit', msg || 'Daily hosted AI limit reached.');
  if (status === 429) {
    const ra = Number(headers.get('retry-after'));
    return new AIError('rate', 'Groq is rate limiting requests. I will wait before trying again.', { retryAfter: Number.isFinite(ra) && ra > 0 ? ra : 8 });
  }
  if (status >= 500) return new AIError('server', 'Groq had a temporary problem.');
  if (status === 400 || status === 404 || status === 422) return new AIError('bad_request', msg || 'Groq rejected the request. Check the model ID.', { raw: msg });
  return new AIError('server', `Unexpected Groq response (${status}).`);
}

async function request({ model, messages, responseFormat, temperature, signal, timeoutMs, maxTokens }) {
  if (navigator.onLine === false) throw new AIError('offline', 'You appear to be offline.');
  const key = getKey(); const viaHost = !key && hosted.available;
  if (!key && !viaHost) throw new AIError('nokey', 'No AI is set up.');
  if (Date.now() < cooldownUntil) throw new AIError('rate', 'Waiting out a rate limit.', { retryAfter: (cooldownUntil - Date.now()) / 1000 });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort('timeout'), timeoutMs);
  const onAbort = () => ctl.abort('user');
  signal?.addEventListener('abort', onAbort);
  try {
    const body = { model, messages, temperature };
    if (responseFormat) body.response_format = responseFormat;
    if (maxTokens) body.max_tokens = maxTokens;
    const res = viaHost
      ? await fetch('/api/ai', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'lifeos' }, body: JSON.stringify(body), signal: ctl.signal })
      : await fetch(ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    if (!res.ok) throw normalize(res.status, await res.json().catch(() => null), res.headers);
    if (viaHost) hosted.used += 1;
    return await res.json();
  } catch (e) {
    if (e instanceof AIError) throw e;
    if (ctl.signal.aborted) throw new AIError(ctl.signal.reason === 'timeout' ? 'timeout' : 'aborted', ctl.signal.reason === 'timeout' ? 'The AI request timed out.' : 'Request cancelled.');
    throw new AIError('offline', 'Could not reach Groq. Check your connection.');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
}

// Retry with exponential backoff for 429/5xx only.
async function withRetry(opts, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { return await request(opts); } catch (e) {
      last = e;
      if (e.kind === 'rate') {
        cooldownUntil = Date.now() + Math.min(60, e.retryAfter || 8) * 1000;
        if ((e.retryAfter || 8) > 15 || i === attempts - 1) throw e;
        await sleep((e.retryAfter || 8) * 1000, opts.signal);
      } else if (e.kind === 'server' && i < attempts - 1) await sleep(800 * 2 ** i, opts.signal);
      else throw e;
    }
  }
  throw last;
}
const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new AIError('aborted', 'Request cancelled.')); }, { once: true });
});

const extract = (data) => data?.choices?.[0]?.message?.content || '';
function parseJSONLoose(text) {
  const direct = safeJSON(text); if (direct) return direct;
  const m = text.match(/\{[\s\S]*\}/); return m ? safeJSON(m[0]) : null;
}

/**
 * Ask the model for schema-constrained JSON. Strict json_schema first; JSON-object mode fallback.
 * Validates locally; one repair retry; throws AIError('invalid') afterwards.
 */
export async function askJSON({ system, user, schemaName, signal, timeoutMs = 30000 }) {
  const s = store.settings(); const model = s.modelId; const schema = SCHEMAS[schemaName];
  const base = [{ role: 'system', content: system + styleInstruction() }, { role: 'user', content: typeof user === 'string' ? user : JSON.stringify(user) }];
  const strictFmt = { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } };
  const looseSys = { role: 'system', content: `Respond with ONE JSON object only, matching this JSON Schema (all fields required):\n${JSON.stringify(schema)}` };

  const run = async (messages, strict) => {
    const data = await withRetry({
      model, messages: strict ? messages : [looseSys, ...messages], temperature: s.temperature ?? 0.2,
      responseFormat: strict ? strictFmt : { type: 'json_object' }, signal, timeoutMs,
    });
    await store.setSettings({ lastSuccessfulAiCall: nowISO() });
    return extract(data);
  };
  const attempt = async (messages) => {
    let text;
    if (!noStrict.has(model)) {
      try { text = await run(messages, true); } catch (e) {
        if (e.kind === 'bad_request' && /json_schema|response_format|structured|strict/i.test(e.raw || '')) { noStrict.add(model); text = await run(messages, false); }
        else throw e;
      }
    } else text = await run(messages, false);
    return text;
  };

  let text = await attempt(base);
  let parsed = parseJSONLoose(text);
  let errs = parsed ? validate(withDefaults(parsed, schema), schema) : ['not JSON'];
  if (errs.length) {
    const repair = [...base, { role: 'assistant', content: text.slice(0, 2000) },
      { role: 'user', content: `That did not match the schema (${errs.slice(0, 4).join('; ')}). Return only corrected JSON.` }];
    text = await attempt(repair);
    parsed = parseJSONLoose(text);
    errs = parsed ? validate(withDefaults(parsed, schema), schema) : ['not JSON'];
    if (errs.length) throw new AIError('invalid', 'The AI reply could not be understood.');
  }
  return withDefaults(parsed, schema);
}

export async function testConnection() {
  const s = store.settings();
  const data = await withRetry({
    model: s.modelId, temperature: 0, timeoutMs: 20000, maxTokens: 16,
    messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
  }, 2);
  await store.setSettings({ lastSuccessfulAiCall: nowISO() });
  return extract(data).trim().slice(0, 40) || 'OK';
}

export function describeError(e) {
  if (!(e instanceof AIError)) return 'AI insight unavailable - your data is saved.';
  if (e.kind === 'nokey') return 'AI is not set up yet - your data is saved.';
  if (e.kind === 'limit') return e.message;
  if (e.kind === 'auth') return 'AI key problem - your data is saved.';
  return `AI insight unavailable - your data is saved. (${e.message})`;
}
