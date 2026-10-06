// A short, friendly way to turn AI on. Without AI the app still works, but the smart parts (follow-up questions, AI-worded check-ins,
// the day planner's priorities, goal coaching, Ask) fall back to basic versions — so we say so, and make fixing it one step.
import { h, icon, openSheet, toast } from './ui.js';
import * as G from './groq.js';
import { lsGet, lsSet, safeJSON } from './util.js';
import { rerender } from './router.js';

export const aiOff = () => !G.aiReady();
export const aiOffReason = () => (!navigator.onLine ? 'You’re offline.' : G.hasKey() || G.hosted.available ? 'AI is switched off in You → AI & API.' : 'No AI key is connected yet.');
const HIDE = 'lifeos.aiNoteHidden';
export const aiNoteHidden = () => Date.now() < (safeJSON(lsGet(HIDE), 0) || 0);
export const hideAiNote = (days = 7) => lsSet(HIDE, String(Date.now() + days * 86400000));

/** Inline notice used where a smarter result is possible with AI. */
export const aiOffNotice = (what = 'This is the basic version') => h`<div class="card inset"><p class="small">${icon('sparkle', 14)} <b>${what}</b> — ${aiOffReason()} Connect AI for smarter, more personal results.</p><div class="row gap wrap"><button class="btn btn-sm btn-primary" data-ai-setup>Set up AI</button></div></div>`;

export function aiSetupSheet({ onDone = null } = {}) {
  openSheet({ title: 'Turn on AI', tall: true, body: h`<div class="stack">
    <p class="muted small">AI makes LifeOS much smarter: it asks the right follow-up questions, words your check-ins, plans your day around your energy and priorities, and coaches your goals. Tracking works without it.</p>
    <ol class="steps small"><li>Open <b>console.groq.com/keys</b> (free to start) and create an API key.</li><li>Paste the key below. It starts with <b>gsk_</b>.</li></ol>
    <a class="btn" href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer">${icon('external', 16)} Open Groq keys</a>
    <form class="stack" id="ai-form" autocomplete="off" novalidate>
      <label class="field"><span class="field-label">Groq API key</span><input class="input" type="password" name="key" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="gsk_…"></label>
      <label class="check"><input type="checkbox" name="remember" checked><span>Remember on this device (so it keeps working after you close the app)</span></label>
      <p class="form-error" id="ai-err" role="alert"></p><p class="small" id="ai-ok" role="status"></p>
      <div class="row gap end"><button type="button" class="btn" data-x>Later</button><button class="btn btn-primary" type="submit">Save and test</button></div></form>
    <p class="tiny muted">${icon('shield', 12)} The key stays in this browser and is sent only to Groq, never to LifeOS servers or your exports. You can remove it any time in You → AI & API.</p></div>`,
  onOpen(s) {
    s.el.querySelector('[data-x]').onclick = s.close;
    s.el.querySelector('#ai-form').addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(e.target); const key = String(f.get('key') || '').trim(); const err = s.el.querySelector('#ai-err'); const ok = s.el.querySelector('#ai-ok'); err.textContent = ''; ok.textContent = '';
      if (!G.looksLikeKey(key)) { err.textContent = 'That doesn’t look like a Groq key — it should start with gsk_.'; return; }
      const btn = e.target.querySelector('.btn-primary'); btn.disabled = true; btn.textContent = 'Testing…';
      await G.setKey(key, f.get('remember') === 'on');
      try { await G.testConnection(); ok.textContent = 'Connected ✓ — AI is on.'; toast('AI is on'); rerender(); setTimeout(() => { s.close(); onDone?.(); }, 700); }
      catch (e2) { err.textContent = e2 instanceof G.AIError ? e2.message : 'Couldn’t reach Groq. Check the key and try again.'; btn.disabled = false; btn.textContent = 'Save and test'; }
    });
  } });
}
// any button with data-ai-setup opens the sheet (works in sheets and screens)
document.addEventListener('click', (e) => { if (e.target.closest('[data-ai-setup]')) { e.preventDefault(); aiSetupSheet(); } });
