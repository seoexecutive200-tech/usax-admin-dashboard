// Hash router with delegated actions. Screens: { render(params)->html, mount?(root,params), actions, inputs?, static? }.
import { html, $, $$, reduced } from './ui.js';
import { store } from './store.js';

const routes = new Map(); const globalActions = {};
let current = null; let currentParams = {}; let currentName = ''; const scrollPos = {};
let viewEl; let navEl;
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
  viewEl.innerHTML = html(screen.render(params));
  viewEl.classList.toggle('enter', animate || changed);
  if (animate || changed) { viewEl.style.animation = 'none'; void viewEl.offsetWidth; viewEl.style.animation = ''; }
  screen.mount?.(viewEl, params);
  currentName = name;
  $$('.nav-btn', navEl).forEach((b) => { const on = b.dataset.route === (name === 'readiness' ? 'today' : name); b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
  navEl.classList.toggle('hidden', name === 'capture');
  document.body.dataset.screen = name;
  window.scrollTo(0, changed && !scrollPos[name] ? 0 : scroll);
  if (changed) { history_.push(name); if (history_.length > 30) history_.shift(); viewEl.focus({ preventScroll: true }); }
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
