// Hash router with delegated actions. Screens: { render(params)->html, mount?(root,params), actions, inputs?, static? }.
import { html, $, $$, reduced } from './ui.js';
import { store } from './store.js';

const routes = new Map(); const globalActions = {};
let current = null; let currentParams = {}; let currentName = ''; const scrollPos = {};
let viewEl; let navEl; let lastHTML = '';
export const history_ = [];

export function register(name, screen) { routes.set(name, screen); }
export function registerActions(a) { Object.assign(globalActions, a); }
export const navigate = (hash) => { if (location.hash === hash) render(true); else location.hash = hash; };
export const back = (fb = '#/today') => { if (history_.length > 1) { history_.pop(); history.back(); } else navigate(fb); };

function parse() {
  const raw = location.hash.replace(/^#\/?/, '') || 'today';
  const [name, ...rest] = raw.split('?')[0].split('/');
  return { name: routes.has(name) ? name : 'today', params: { id: rest[0] ? decodeURIComponent(rest[0]) : null } };
}

export function render(animate = false) {
  const { name, params } = parse();
  const screen = routes.get(name);
  if (currentName) scrollPos[currentName] = window.scrollY;
  const changed = name !== currentName || params.id !== currentParams.id;
  current = screen; currentParams = params;
  const scroll = changed ? (scrollPos[name] ?? 0) : window.scrollY;
  const out = html(screen.render(params));
  // Background refresh (sync, reminders, returning to the app, in-page filters): patch only what differs.
  // Untouched elements (images, inputs, scroll position, running transitions) stay exactly as they are.
  const silent = !animate && !changed;
  if (silent && out === lastHTML) return;
  lastHTML = out;
  if (silent) { const tpl = document.createElement('template'); tpl.innerHTML = out; morph(viewEl, tpl.content); currentName = name; return; }
  viewEl.innerHTML = out;
  viewEl.classList.toggle('enter', animate || changed);
  if (animate || changed) { viewEl.style.animation = 'none'; void viewEl.offsetWidth; viewEl.style.animation = ''; }
  screen.mount?.(viewEl, params);
  currentName = name;
  $$('.nav-btn', navEl).forEach((b) => { const on = b.dataset.route === ({ readiness: 'today', calendar: 'plan' }[name] || name); b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
  navEl.classList.toggle('hidden', name === 'capture');
  document.body.dataset.screen = name;
  window.scrollTo({ top: changed && !scrollPos[name] ? 0 : scroll, behavior: 'instant' });
  if (changed) { history_.push(name); if (history_.length > 30) history_.shift(); viewEl.focus({ preventScroll: true }); }
}

/** Re-render the current screen in place (no transition). */
export const rerender = () => render(false);

// Minimal DOM morph: update `from` so it matches `to`, touching only the nodes that differ.
function morph(from, to) {
  const a = [...from.childNodes]; const b = [...to.childNodes];
  for (let i = a.length - 1; i >= b.length; i--) from.removeChild(a[i]);
  b.forEach((nb, i) => { if (!a[i]) from.appendChild(nb.cloneNode(true)); else patch(a[i], nb); });
}
function patch(x, y) {
  if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName) { x.replaceWith(y.cloneNode(true)); return; }
  if (x.nodeType !== 1) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; return; }
  if (x.isEqualNode(y)) return;
  if (x === document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(x.nodeName)) return; // never disturb typing
  for (const at of [...x.attributes]) if (!y.hasAttribute(at.name)) x.removeAttribute(at.name);
  for (const at of y.attributes) if (x.getAttribute(at.name) !== at.value) x.setAttribute(at.name, at.value);
  if (x.nodeName === 'INPUT' && x.type !== 'file') x.value = y.getAttribute('value') ?? '';
  morph(x, y);
}

export function refresh() { if (current && !current.static && !document.body.classList.contains('typing')) render(false); }

export function initRouter({ view, nav }) {
  viewEl = view; navEl = nav;
  const dispatch = (type, e) => {
    const el = e.target.closest(`[data-${type}]`); if (!el || !viewEl.contains(el)) return;
    const name = el.dataset[type]; const fn = (type === 'act' ? (current.actions?.[name] || globalActions[name]) : current.inputs?.[name]);
    if (fn) { if (type === 'act' && el.tagName === 'A') e.preventDefault(); fn(el, e, currentParams); }
  };
  viewEl.addEventListener('click', (e) => dispatch('act', e));
  viewEl.addEventListener('input', (e) => dispatch('input', e));
  viewEl.addEventListener('change', (e) => dispatch('change', e));
  viewEl.addEventListener('submit', (e) => { const f = e.target.closest('[data-submit]'); if (f) { e.preventDefault(); const fn = current.actions?.[f.dataset.submit] || globalActions[f.dataset.submit]; fn?.(f, e, currentParams); } });
  navEl.addEventListener('click', (e) => { const b = e.target.closest('[data-route]'); if (b) navigate(`#/${b.dataset.route}`); });
  window.addEventListener('hashchange', () => render(true));
  let t; store.on(() => { clearTimeout(t); t = setTimeout(refresh, 50); });
}
