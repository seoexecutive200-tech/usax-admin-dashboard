// Small pure helpers shared across modules.
export const APP_VERSION = '2.6.0';
export const SCHEMA_VERSION = 2;

export const uid = (prefix = 'id') =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
export const nowISO = () => new Date().toISOString();
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
export const mean = (arr) => {
  const a = arr.filter(isNum);
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
};
export const sum = (arr) => arr.filter(isNum).reduce((s, x) => s + x, 0);
export const round = (n, d = 1) => (isNum(n) ? Math.round(n * 10 ** d) / 10 ** d : null);

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

const pad = (n) => String(n).padStart(2, '0');
export const toDate = (v) => (v instanceof Date ? new Date(v) : new Date(v));
export const dayKey = (v = new Date()) => {
  const d = toDate(v);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const parseKey = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const startOfDay = (v = new Date()) => { const d = toDate(v); d.setHours(0, 0, 0, 0); return d; };
export const addDays = (v, n) => { const d = toDate(v); d.setDate(d.getDate() + n); return d; };
export const addMinutes = (v, n) => new Date(toDate(v).getTime() + n * 60000);
export const startOfWeek = (v = new Date()) => {
  const d = startOfDay(v); const dow = (d.getDay() + 6) % 7; // Monday first
  return addDays(d, -dow);
};
export const weekKey = (v = new Date()) => dayKey(startOfWeek(v));
export const sameDay = (a, b) => dayKey(a) === dayKey(b);
export const daysBetween = (a, b) =>
  Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
export const hoursUntil = (v, from = new Date()) => (toDate(v) - from) / 3600000;

export function fmtTime(v) {
  return toDate(v).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
export function fmtDate(v, opts = { weekday: 'long', day: 'numeric', month: 'long' }) {
  return toDate(v).toLocaleDateString([], opts);
}
export function fmtDur(min) {
  if (!isNum(min)) return '';
  if (min < 60) return `${Math.round(min)} min`;
  const h = min / 60;
  return Number.isInteger(h) ? `${h} hr${h > 1 ? 's' : ''}` : `${round(h, 1)} hrs`;
}
export function fmtRelative(v, from = new Date()) {
  const h = hoursUntil(v, from);
  const a = Math.abs(h);
  const unit = a < 1 ? `${Math.round(a * 60)} min` : a < 48 ? `${Math.round(a)} hr` : `${Math.round(a / 24)} days`;
  return h >= 0 ? `in ${unit}` : `${unit} ago`;
}
export function toLocalInput(v) {
  const d = toDate(v);
  return `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const greeting = (d = new Date()) => {
  const h = d.getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};
export const partOfDay = (d = new Date()) => {
  const h = d.getHours();
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
};
export const inQuietHours = (d = new Date(), [from, to] = ['22:00', '07:00']) => {
  const m = d.getHours() * 60 + d.getMinutes();
  const [fh, fm] = from.split(':').map(Number); const [th, tm] = to.split(':').map(Number);
  const f = fh * 60 + fm; const t = th * 60 + tm;
  return f > t ? m >= f || m < t : m >= f && m < t;
};

export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeJSON(text, fallback = null) {
  try { return JSON.parse(text) ?? fallback; } catch { return fallback; } // JSON.parse(null) is null, so a missing value must still yield the fallback
}
export const lsGet = (k, fb = null) => { try { const v = localStorage.getItem(k); return v === null ? fb : v; } catch { return fb; } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
export const lsDel = (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } };
