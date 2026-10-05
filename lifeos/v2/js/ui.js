// UI toolkit: safe HTML templating, icons, sheets, toasts, small SVG charts, motion preference.
import { store } from './store.js';
import { clamp, isNum } from './util.js';

// ---- safe templating: every interpolation is escaped unless it is a trusted template result ----
// Trusted results (Raw) stringify to a marked span, so even when one is nested inside an ordinary `${...}` template
// literal it is recognised later instead of being escaped into visible text. The marker contains a random per-load
// nonce, so user- or AI-written text can never forge it.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const NONCE = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
const OPEN = `\u0001${NONCE}[`; const CLOSE = `]${NONCE}\u0002`;
const MARKED = new RegExp(`${OPEN.replace(/[\[\]]/g, '\\$&')}([\\s\\S]*?)${CLOSE.replace(/[\[\]]/g, '\\$&')}`, 'g');
class Raw { constructor(s) { this.s = s; } toString() { return OPEN + this.s + CLOSE; } }
export const raw = (s) => new Raw(s);
function text(str) { // escape plain text but keep marked trusted spans
  if (!str.includes(OPEN)) return esc(str);
  let out = ''; let last = 0; MARKED.lastIndex = 0; let m;
  while ((m = MARKED.exec(str))) { out += esc(str.slice(last, m.index)) + m[1]; last = m.index + m[0].length; }
  return out + esc(str.slice(last));
}
const flat = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(flat).join('') : v === false || v == null ? '' : text(String(v)));
export const h = (strings, ...vals) => raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? flat(vals[i]) : ''), ''));
// Render a template result, a list of them, or plain text (escaped) to an HTML string.
export const html = (x) => flat(x);
/** For HTML assembled in a plain template literal: resolve any trusted spans embedded in it (no escaping). */
export const unmark = (str) => { MARKED.lastIndex = 0; return String(str).replace(MARKED, '$1'); };

/** Brand lockup. The glowing wordmark is made for dark backgrounds; light theme falls back to planet + live text. */
export const logo = (big = false) => raw(`<div class="logo ${big ? 'big' : ''}" role="img" aria-label="LifeOS"><img class="logo-full" src="../assets/logo.webp" alt="" decoding="async"><span class="logo-lite"><img src="../assets/planet.webp" alt="" decoding="async"><span>Life<b>OS</b></span></span></div>`);
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---- icons (24px stroke set) ----
const P = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chart: '<path d="M6 20V11M12 20V5M18 20v-6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c.8-4 3.6-6 7.5-6s6.7 2 7.5 6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  bell: '<path d="M6 17V11a6 6 0 1 1 12 0v6l1.5 2h-15z"/><path d="M10 21h4"/>',
  bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
  brain: '<path d="M9.5 4a3 3 0 0 0-3 3 3 3 0 0 0-2 2.8A3 3 0 0 0 6 13a3 3 0 0 0 3.5 4.5V4zM14.5 4a3 3 0 0 1 3 3 3 3 0 0 1 2 2.8 3 3 0 0 1-1.5 3.2A3 3 0 0 1 14.5 17.500V4z"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.600 4.300 4.300 0 0 1 19.500 10c0 5.400-7.500 10-7.500 10z"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>', chevronL: '<path d="m15 5-7 7 7 7"/>', down: '<path d="m5 9 7 7 7-7"/>',
  video: '<rect x="3" y="6.500" width="12.500" height="11" rx="2.500"/><path d="m15.500 10.500 5-3v9l-5-3"/>',
  laptop: '<rect x="5" y="5.500" width="14" height="10" rx="1.500"/><path d="M3 19h18"/>',
  walk: '<circle cx="13" cy="4.500" r="1.800"/><path d="m9 21 2.500-6-2-2.500 1-5 3-1 2 3.500 3 1M11.500 15l3.500 2 1 4M10.500 7.500 8 10"/>',
  coffee: '<path d="M5 9h11v5a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5zM16 10h1.500a2.500 2.500 0 0 1 0 5H16M8 3.500c0 1.500 1 1.500 1 3M12 3.500c0 1.500 1 1.500 1 3"/>',
  users: '<circle cx="9" cy="8.500" r="3.200"/><path d="M3 20c.5-3.500 3-5.500 6-5.500s5.500 2 6 5.500M16 5.500a3 3 0 0 1 0 6M18 14.800c1.800.7 2.800 2.400 3 5.200"/>',
  utensils: '<path d="M7 3v7a2 2 0 0 0 2 2v9M11 3v7a2 2 0 0 1-2 2M7 3v5M17 21V3c-2.500 1.500-3.500 4-3.500 7.500 0 1.500 1 2.500 3.500 2.500"/>',
  target: '<circle cx="12" cy="12" r="8.500"/><circle cx="12" cy="12" r="4.500"/><circle cx="12" cy="12" r="1"/>',
  moon: '<path d="M20 14.500A8 8 0 1 1 9.500 4a6.500 6.500 0 0 0 10.500 10.500z"/>',
  sparkle: '<path d="m12 3 1.800 5.200L19 10l-5.200 1.800L12 17l-1.800-5.200L5 10l5.200-1.800zM18.500 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  check: '<path d="m5 12.500 4.500 4.500L19 7.500"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
  trash: '<path d="M4.500 7h15M9.500 7V4.500h5V7M6.500 7l1 13h9l1-13M10 11v6M14 11v6"/>',
  edit: '<path d="M4 20h4L19 9a2.800 2.800 0 0 0-4-4L4 16z"/><path d="m13.500 6.500 4 4"/>',
  clock: '<circle cx="12" cy="12" r="8.500"/><path d="M12 7.500V12l3 2"/>',
  droplet: '<path d="M12 3.500s6 6.200 6 10.500a6 6 0 0 1-12 0c0-4.300 6-10.500 6-10.500z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.500 11.500a6.500 6.500 0 0 0 13 0M12 18v3"/>',
  send: '<path d="m4 12 16-8-5 16-3-6.500z"/>',
  download: '<path d="M12 4v11M7.500 11 12 15.500 16.500 11M5 20h14"/>', upload: '<path d="M12 16V5M7.500 9 12 4.500 16.500 9M5 20h14"/>',
  shield: '<path d="M12 3.500 5 6v5.500c0 4.500 3 7.500 7 9 4-1.500 7-4.500 7-9V6z"/>',
  key: '<circle cx="8" cy="15" r="3.500"/><path d="m10.500 12.500 8-8M15 8l2.500 2.500M17.500 5.500 20 8"/>',
  more: '<circle cx="5.500" cy="12" r="1.300"/><circle cx="12" cy="12" r="1.300"/><circle cx="18.500" cy="12" r="1.300"/>',
  info: '<circle cx="12" cy="12" r="8.500"/><path d="M12 11v5M12 7.800v.2"/>',
  flag: '<path d="M6 21V4M6 5h11l-2 4 2 4H6"/>', repeat: '<path d="M4 11V9a3 3 0 0 1 3-3h11M15 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H6M9 21l-3-3 3-3"/>',
  smile: '<circle cx="12" cy="12" r="8.500"/><path d="M8.500 14c1 1.500 2.200 2 3.500 2s2.500-.5 3.500-2M9 9.500v.2M15 9.500v.2"/>',
  dumbbell: '<path d="M6.500 8v8M17.500 8v8M3.500 10v4M20.500 10v4M6.500 12h11"/>',
  wallet: '<path d="M4 7.500A2.500 2.500 0 0 1 6.500 5H18v3M4 7.500V17a2 2 0 0 0 2 2h13V8H6.500A2.500 2.500 0 0 1 4 7.500z"/><circle cx="16" cy="13.500" r="1"/>',
  note: '<path d="M6 3.500h9l4 4V20.500H6z"/><path d="M14.500 3.500v4.500H19M9 13h7M9 16.500h5"/>',
  pin: '<path d="M9 4h6l-1 5 3 3H7l3-3zM12 12v8"/>', refresh: '<path d="M20 11a8 8 0 0 0-14-4.500L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4.500L20 15M20 20v-5h-5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.600 5.600 7 7M17 17l1.400 1.400M5.600 18.400 7 17M17 7l1.400-1.400"/>',
  lock: '<rect x="5" y="10.500" width="14" height="10" rx="2.500"/><path d="M8 10.500V8a4 4 0 0 1 8 0v2.500"/>',
  mountain: '<path d="m3 19 6-10 4 6 2-3 6 7z"/>', skip: '<path d="m5 5 9 7-9 7zM17 5v14"/>', external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
};
export const icon = (name, size = 22, cls = '') => raw(`<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.info}</svg>`);
export const EVENT_ICON = { meeting: 'users', video_call: 'video', task: 'check', deadline: 'flag', appointment: 'calendar', social: 'heart', travel: 'external', workout: 'dumbbell', reminder: 'bell', other: 'target' };
export const EVENT_COLOR = { meeting: 'violet', video_call: 'violet', task: 'blue', deadline: 'red', appointment: 'amber', social: 'pink', travel: 'blue', workout: 'green', reminder: 'blue', other: 'blue' };

// ---- motion preference ----
export function applyMotion() {
  const pref = store.settings().reducedMotion;
  const sys = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reduced = pref === 'on' || (pref === 'auto' && sys);
  document.documentElement.dataset.motion = reduced ? 'reduced' : 'full';
  return reduced;
}
export const reduced = () => document.documentElement.dataset.motion === 'reduced';
export function applyTheme() {
  const t = store.settings().theme;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0D1118' : '#F3F5F9');
}

// ---- toast with Undo ----
export function toast(message, { undo = null, duration = 4200, tone = '' } = {}) {
  const root = $('#toast-root'); if (!root) return;
  const el = document.createElement('div'); el.className = `toast ${tone}`; el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(message)}</span>${undo ? '<button class="toast-undo" type="button">Undo</button>' : ''}`;
  root.appendChild(el); requestAnimationFrame(() => el.classList.add('in'));
  const kill = () => { el.classList.remove('in'); setTimeout(() => el.remove(), 260); };
  const t = setTimeout(kill, duration);
  el.querySelector('.toast-undo')?.addEventListener('click', async () => { clearTimeout(t); kill(); try { await undo(); toast('Undone'); } catch { toast('Could not undo', { tone: 'warn' }); } });
}

// ---- sheets ----
let openCount = 0;
export function openSheet({ title = '', body = '', onOpen = null, onClose = null, tall = false } = {}) {
  const root = $('#sheet-root'); const wrap = document.createElement('div'); wrap.className = 'sheet-wrap';
  wrap.innerHTML = unmark(`<div class="sheet-backdrop"></div><section class="sheet ${tall ? 'tall' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sheet-grab"></div>
    <header class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">${icon('x', 20)}</button></header><div class="sheet-body">${html(body)}</div></section>`);
  root.appendChild(wrap); openCount++; document.body.classList.add('sheet-open');
  const prevFocus = document.activeElement;
  requestAnimationFrame(() => wrap.classList.add('open'));
  let closed = false;
  const api = {
    el: wrap.querySelector('.sheet-body'), wrap,
    setBody(b) { api.el.innerHTML = html(b); },
    close() {
      if (closed) return; closed = true; wrap.classList.remove('open'); openCount--; if (!openCount) document.body.classList.remove('sheet-open');
      document.removeEventListener('keydown', onKey); onClose?.();
      setTimeout(() => wrap.remove(), reduced() ? 0 : 320); prevFocus?.focus?.();
    },
  };
  const onKey = (e) => { if (e.key === 'Escape' && root.lastElementChild === wrap) api.close(); };
  document.addEventListener('keydown', onKey);
  wrap.querySelector('.sheet-backdrop').addEventListener('click', api.close);
  wrap.querySelector('[data-close]').addEventListener('click', api.close);
  // swipe-down to dismiss (grab handle area)
  const sheet = wrap.querySelector('.sheet'); let sy = null;
  sheet.querySelector('.sheet-grab').addEventListener('touchstart', (e) => { sy = e.touches[0].clientY; }, { passive: true });
  sheet.querySelector('.sheet-grab').addEventListener('touchmove', (e) => { if (sy != null) { const dy = Math.max(0, e.touches[0].clientY - sy); sheet.style.transform = `translateY(${dy}px)`; } }, { passive: true });
  sheet.querySelector('.sheet-grab').addEventListener('touchend', (e) => { const dy = e.changedTouches[0].clientY - (sy ?? 0); sheet.style.transform = ''; sy = null; if (dy > 90) api.close(); });
  onOpen?.(api);
  setTimeout(() => (api.el.querySelector('[autofocus],input,textarea,button') || sheet).focus?.({ preventScroll: true }), 60);
  return api;
}
export function confirmSheet({ title, message, confirm = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let decided = false;
    const sh = openSheet({
      title, body: h`<p class="muted">${message}</p><div class="row gap end"><button class="btn" data-no>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${confirm}</button></div>`,
      onClose: () => { if (!decided) resolve(false); },
      onOpen: (s) => { s.el.querySelector('[data-yes]').onclick = () => { decided = true; s.close(); resolve(true); }; s.el.querySelector('[data-no]').onclick = () => s.close(); },
    });
    return sh;
  });
}

// ---- SVG charts ----
export function ring({ pct, size = 64, stroke = 7, color = 'var(--blue)', label = '', sub = '' }) {
  const r = (size - stroke) / 2; const c = 2 * Math.PI * r; const p = clamp(pct, 0, 1);
  return raw(`<div class="ring" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${stroke}"/>
    <circle class="ring-arc" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}" transform="rotate(-90 ${size / 2} ${size / 2})" style="--c:${c}"/></svg>${label ? `<span class="ring-label">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>` : ''}</div>`);
}
export function spark(points, { w = 120, h: ht = 36, color = 'var(--blue)', min = null, max = null } = {}) {
  const vals = points.map((p) => (isNum(p.value) ? p.value : null)); const nums = vals.filter((v) => v !== null);
  if (nums.length < 2) return raw(`<div class="spark-empty">Not enough data yet</div>`);
  const lo = min ?? Math.min(...nums); const hi = max ?? Math.max(...nums); const span = hi - lo || 1;
  const step = w / Math.max(1, vals.length - 1);
  let d = ''; let pen = false; const dots = [];
  vals.forEach((v, i) => {
    if (v === null) { pen = false; return; }
    const x = i * step; const y = ht - 4 - ((v - lo) / span) * (ht - 8);
    d += `${pen ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)} `; pen = true; dots.push([x, y]);
  });
  const last = dots[dots.length - 1];
  return raw(`<svg class="spark" viewBox="0 0 ${w} ${ht}" width="100%" height="${ht}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/><circle cx="${last[0]}" cy="${last[1]}" r="2.800" fill="${color}"/></svg>`);
}
export const pct = (v) => `${Math.round(clamp(v, 0, 1) * 100)}%`;
export function bar(v, color = 'var(--blue)') { return raw(`<div class="bar"><i style="width:${Math.round(clamp(v, 0, 1) * 100)}%;background:${color}"></i></div>`); }
export const levelColor = (l) => ({ light: 'var(--blue)', moderate: 'var(--amber)', heavy: 'var(--coral)', peak: 'var(--red)' }[l] || 'var(--blue)');

// ---- form helpers ----
export const val = (root, sel) => root.querySelector(sel)?.value ?? '';
export function field(label, inner, hint = '') { return h`<label class="field"><span class="field-label">${label}</span>${inner}${hint ? h`<small class="muted">${hint}</small>` : ''}</label>`; }
export function seg(name, options, selected) {
  return h`<div class="seg" role="radiogroup" data-seg="${name}">${options.map(([v, l]) => h`<button type="button" class="seg-btn ${String(v) === String(selected) ? 'on' : ''}" role="radio" aria-checked="${String(v) === String(selected)}" data-v="${v}">${l}</button>`)}</div>`;
}
export function bindSeg(root, onChange) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn'); if (!b) return; const g = b.closest('.seg');
    g.querySelectorAll('.seg-btn').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
    g.dataset.value = b.dataset.v; onChange?.(g.dataset.seg, b.dataset.v);
  });
}
export const segVal = (root, name, fb = '') => root.querySelector(`.seg[data-seg="${name}"] .seg-btn.on`)?.dataset.v ?? fb;
export function slider(name, value = 5, min = 1, max = 10) {
  return h`<div class="slider"><input type="range" name="${name}" min="${min}" max="${max}" step="1" value="${value}" aria-label="${name}"><output>${value}</output></div>`;
}
export function bindSliders(root) {
  root.querySelectorAll('.slider input').forEach((i) => { const o = i.nextElementSibling; const up = () => { o.textContent = i.value; i.style.setProperty('--p', `${((i.value - i.min) / (i.max - i.min)) * 100}%`); }; i.addEventListener('input', up); up(); });
}
