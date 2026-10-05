// Update notifier (v1). Additive only: it checks releases.json, shows what's new, and — only if the user agrees —
// saves their data, prepares the new version, and opens it. Nothing in v1's own data is changed or moved.
import { store } from './store.js';
import { h, icon, openSheet, toast } from './ui.js';
import { APP_VERSION, lsGet, lsSet, safeJSON } from './util.js';
import { flush } from './sync.js';

export const CHANNEL_KEY = 'lifeos.channel';
const SEEN_KEY = 'lifeos.updateSeen';
const cmp = (a, b) => { const A = String(a).split('.').map(Number); const B = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((A[i] || 0) !== (B[i] || 0)) return (A[i] || 0) - (B[i] || 0); } return 0; };

let release = null;
export const availableRelease = () => release;

/** Fetches the manifest; returns the release when it is newer than this build, else null. */
export async function checkForUpdate() {
  try {
    const res = await fetch(new URL('releases.json', document.baseURI), { cache: 'no-store' });
    if (!res.ok) return null;
    const latest = (await res.json())?.latest;
    if (!latest?.version || !latest.path || cmp(latest.version, APP_VERSION) <= 0) return null;
    release = latest; return latest;
  } catch { return null; }
}

/** Show the card at most once a day per version unless forced (from the update chip or You screen). */
export function maybeShowUpdate(rel, { force = false } = {}) {
  if (!rel) return;
  const seen = safeJSON(lsGet(SEEN_KEY), {});
  if (!force && seen[rel.version] && Date.now() - seen[rel.version] < 24 * 3600 * 1000) return;
  seen[rel.version] = Date.now(); lsSet(SEEN_KEY, JSON.stringify(seen));
  updateSheet(rel);
}

export function updateSheet(rel) {
  openSheet({
    title: 'Update available', tall: true,
    body: h`<div class="stack"><div class="card inset"><div class="eyebrow">Version ${rel.version}</div><p class="headline">${rel.title || 'A new version of LifeOS'}</p>${rel.summary ? h`<p class="muted">${rel.summary}</p>` : ''}</div>
      <div class="eyebrow">What’s new</div>
      <div class="stack">${(rel.notes || []).map((n) => h`<div class="whatsnew"><span class="t-ic lead">${icon(n.icon || 'sparkle', 20)}</span><div><b>${n.title}</b><div class="small muted">${n.text}</div></div></div>`)}</div>
      <div class="card inset"><div class="strong">${icon('shield', 16)} Your data stays safe</div><p class="small muted">Your current LifeOS isn’t changed or deleted. Your information is copied into the new version, and you can switch back from You → Version at any time.</p></div>
      <p class="form-error" id="up-err" role="alert"></p>
      <div id="up-progress" class="small muted"></div>
      <div class="row gap end"><button class="btn" data-later>Later</button><button class="btn btn-primary" data-now>Update now</button></div></div>`,
    onOpen(s) {
      s.el.querySelector('[data-later]').onclick = s.close;
      s.el.querySelector('[data-now]').onclick = async (e) => {
        const btn = e.target; btn.disabled = true; const say = (t) => { s.el.querySelector('#up-progress').textContent = t; };
        try {
          say('Saving your data…');
          const synced = await flush(); // push to the account so other devices can bring it across too
          if (!synced && window.__account) { say('You appear to be offline — your data will be copied from this device.'); }
          say('Preparing the new version…');
          const target = new URL(rel.path, document.baseURI);
          const r = await fetch(new URL('index.html', target), { cache: 'no-store' }); if (!r.ok) throw new Error('The new version could not be reached. Try again in a moment.');
          lsSet(CHANNEL_KEY, 'v2'); lsSet('lifeos.v2ok', ''); // v2 sets v2ok once it has started successfully
          say('Opening LifeOS 2…');
          location.replace(new URL(`${rel.path}${location.hash}`, document.baseURI));
        } catch (err) { s.el.querySelector('#up-err').textContent = err.message || 'Update failed. Nothing was changed.'; btn.disabled = false; say(''); }
      };
    },
  });
}
