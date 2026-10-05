// In-app updates for LifeOS 2. A new version installs in the background and waits; we show what's new and apply it only on "Update now".
import { h, icon, openSheet, toast } from './ui.js';
import { APP_VERSION, lsGet, lsSet, safeJSON } from './util.js';
import { flush } from './sync.js';

const SEEN = 'lifeos.update2Seen';
let reg = null; let waiting = null; let notes = null; let reloading = false;
export const updateReady = () => !!waiting;
export const releaseNotes = () => notes;
const listeners = new Set();
export const onUpdateChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = () => listeners.forEach((f) => f());

const cmpVer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
async function loadNotes() {
  try {
    const r = await fetch(new URL('../releases.json', document.baseURI), { cache: 'no-store' }); const latest = (await r.json())?.latest;
    notes = latest && latest.path === 'v2/' ? latest : null;
    // people already on 2.x only need what's new since their version (items without `since` belong to the first 2.0 release)
    if (notes) { const fresh = (notes.notes || []).filter((x) => x.since && cmpVer(x.since, APP_VERSION) > 0); if (fresh.length) notes = { ...notes, notes: fresh }; }
  } catch { notes = null; }
}
function track(sw) {
  if (!sw) return;
  const done = () => { if (sw.state === 'installed' && navigator.serviceWorker.controller) { waiting = sw; loadNotes().then(() => { changed(); promptUpdate(); }); } };
  sw.addEventListener('statechange', done); done();
}
export async function watchUpdates() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  try { reg = await navigator.serviceWorker.getRegistration(); } catch { return; }
  if (!reg) return;
  if (reg.waiting && navigator.serviceWorker.controller) track(reg.waiting);
  reg.addEventListener('updatefound', () => track(reg.installing));
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading && waiting) { reloading = true; location.reload(); } });
  const check = () => reg.update().catch(() => {});
  setTimeout(check, 4000); setInterval(check, 30 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
}
/** Manual check from You → Version. Resolves to 'ready' | 'current' | 'error'. */
export async function checkNow() {
  if (!reg) return 'error';
  try { await reg.update(); } catch { return 'error'; }
  await new Promise((r) => setTimeout(r, 1200));
  return waiting ? 'ready' : 'current';
}
function promptUpdate({ force = false } = {}) {
  if (!waiting) return;
  if (!force && document.querySelector('#sheet-root .sheet-wrap')) return; // never stack on top of another popup; the Update chip stays on Today
  const key = notes?.version || 'x'; const seen = safeJSON(lsGet(SEEN), {});
  if (!force && seen[key] && Date.now() - seen[key] < 24 * 3600 * 1000) return;
  seen[key] = Date.now(); lsSet(SEEN, JSON.stringify(seen)); updateSheet();
}
export const showUpdate = () => promptUpdate({ force: true });

export function updateSheet() {
  const n = notes;
  openSheet({
    title: 'Update available', tall: true,
    body: h`<div class="stack"><div class="card inset"><div class="eyebrow">${n ? `Version ${n.version}` : 'New version'}</div><p class="headline">${n?.title || 'A new version of LifeOS is ready'}</p>${n?.summary ? h`<p class="muted">${n.summary}</p>` : ''}</div>
      ${n?.notes?.length ? h`<div class="eyebrow">What’s new</div><div class="stack">${n.notes.map((x) => h`<div class="whatsnew"><span class="t-ic lead">${icon(x.icon || 'sparkle', 20)}</span><div><b>${x.title}</b><div class="small muted">${x.text}</div></div></div>`)}</div>` : h`<p class="muted">Improvements and fixes.</p>`}
      <p class="small muted">${icon('shield', 14)} Your data is saved first and isn’t changed by the update. The app reloads itself when it’s done.</p><div id="up-progress" class="small muted"></div>
      <div class="row gap end"><button class="btn" data-later>Later</button><button class="btn btn-primary" data-now>Update now</button></div></div>`,
    onOpen(s) {
      s.el.querySelector('[data-later]').onclick = s.close;
      s.el.querySelector('[data-now]').onclick = async (e) => {
        e.target.disabled = true; s.el.querySelector('#up-progress').textContent = 'Saving your data…';
        await flush().catch(() => {});
        s.el.querySelector('#up-progress').textContent = 'Updating…'; waiting?.postMessage({ type: 'SKIP_WAITING' });
        setTimeout(() => { if (!reloading) location.reload(); }, 6000); // safety net
      };
    },
  });
}

/** Switch back to the original LifeOS (its data was never changed). */
export function switchToV1() { lsSet('lifeos.channel', 'v1'); location.replace(new URL(`../index.html${location.hash}`, document.baseURI)); }
export const version = APP_VERSION;
