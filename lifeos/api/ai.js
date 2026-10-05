// Hosted AI: lets signed-in users use the advisor without their own key. The server holds GROQ_API_KEY,
// enforces a per-user daily limit, caps request size, and never logs prompts or replies.
//   GET  /api/ai  -> { available, limit, used }
//   POST /api/ai  { messages, model?, temperature?, max_tokens?, response_format? } -> Groq chat completion JSON
import { send, readBody, checkOrigin, storageConfigured, sessionUser, readJSON, writeJSON } from './_lib.js';

const BASE = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
const LIMIT = Number(process.env.HOSTED_DAILY_LIMIT) || 60;
const MODELS = (process.env.HOSTED_MODELS || 'openai/gpt-oss-20b,openai/gpt-oss-120b,llama-3.3-70b-versatile,llama-3.1-8b-instant').split(',').map((m) => m.trim());
const today = () => new Date().toISOString().slice(0, 10);
const available = () => !!process.env.GROQ_API_KEY && storageConfigured();

export default async function handler(req, res) {
  try {
    if (!checkOrigin(req)) return send(res, 403, { error: 'Request blocked' });
    const s = await sessionUser(req).catch(() => null);
    if (req.method === 'GET') {
      if (!available() || !s) return send(res, 200, { available: false });
      const u = (await readJSON(`usage/${s.user.id}.json`))?.json;
      return send(res, 200, { available: true, limit: LIMIT, used: u?.day === today() ? u.count : 0 });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    if (!available()) return send(res, 503, { error: 'Hosted AI is not enabled on this server.' });
    if (!s) return send(res, 401, { error: 'Please log in again.' });

    const body = await readBody(req, 120_000);
    const messages = Array.isArray(body.messages) ? body.messages.slice(-12).map((m) => ({ role: ['system', 'user', 'assistant'].includes(m.role) ? m.role : 'user', content: String(m.content ?? '') })) : [];
    if (!messages.length || messages.reduce((n, m) => n + m.content.length, 0) > 60_000) return send(res, 400, { error: 'Invalid request' });
    const model = MODELS.includes(body.model) ? body.model : MODELS[0];
    const fmt = body.response_format?.type === 'json_schema' || body.response_format?.type === 'json_object' ? body.response_format : undefined;

    // daily budget (read-modify-write; small races only ever let a user slightly over, never lose the count)
    const key = `usage/${s.user.id}.json`; const rec = await readJSON(key); const day = today();
    const used = rec?.json.day === day ? rec.json.count : 0;
    if (used >= LIMIT) return send(res, 429, { error: `You’ve used today’s ${LIMIT} hosted AI requests. Add your own key under You → AI & API, or try again tomorrow.`, limit: LIMIT, used });
    await writeJSON(key, { day, count: used + 1 });

    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 28000);
    let up;
    try {
      up = await fetch(`${BASE}/chat/completions`, {
        method: 'POST', signal: ctl.signal,
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, temperature: Math.min(1, Math.max(0, Number(body.temperature) || 0.2)), max_tokens: Math.min(2000, Number(body.max_tokens) || 1500), ...(fmt ? { response_format: fmt } : {}) }),
      });
    } catch { return send(res, 504, { error: 'The AI service did not respond in time.' }); } finally { clearTimeout(t); }
    const text = await up.text();
    res.statusCode = up.status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
    if (up.headers.get('retry-after')) res.setHeader('Retry-After', up.headers.get('retry-after'));
    return res.end(text.replace(/gsk_[A-Za-z0-9_-]{8,}/g, '[removed]'));
  } catch (e) {
    if (e.code === 'TOO_LARGE') return send(res, 413, { error: 'Request too large' });
    console.error('ai error', e?.name, e?.message); // never log prompts
    return send(res, 500, { error: 'Something went wrong. Please try again.' });
  }
}
