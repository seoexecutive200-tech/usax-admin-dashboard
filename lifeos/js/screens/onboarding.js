// First launch: welcome → optional Groq key (Remember / Session only / Skip) → optional demo data.
import { store } from '../store.js';
import { h, html, icon, toast, logo } from '../ui.js';
import * as G from '../groq.js';
import { loadDemo } from '../seed.js';
import { SCHEMA_VERSION } from '../util.js';

export function showOnboarding() {
  return new Promise((resolve) => {
    const el = document.getElementById('onboarding'); el.hidden = false; document.body.classList.add('onboarding');
    let step = 0; let key = ''; let remember = false; let status = ''; let testing = false; let ok = false; let demo = false;
    const finish = async () => {
      await store.setProfile({ name: (el.querySelector('#ob-name')?.value ?? store.profile().name).trim(), onboarded: true });
      await store.setSettings({ welcomed: true });
      if (demo) await loadDemo();
      el.hidden = true; document.body.classList.remove('onboarding'); resolve();
    };
    const draw = () => {
      const steps = [h`<div class="ob-card">${logo(true)}<p class="lead">A calm personal advisor for your health, plans and decisions.</p>
        <ul class="ob-list"><li>${icon('lock', 18)} <span>Your data is yours — stored on this device, and in your account if you sign in.</span></li><li>${icon('check', 18)} <span>Tracking, planning and reports work fully <b>without AI</b>.</span></li><li>${icon('sparkle', 18)} <span>Optional: add a Groq key for a proactive advisor.</span></li></ul>
        <label class="field"><span class="field-label">What should I call you?</span><input class="input" id="ob-name" maxlength="40" value="${store.profile().name}" placeholder="Your name (optional)" autocomplete="given-name"></label>
        <button class="btn btn-primary btn-wide" data-ob="next">Continue</button></div>`,
      h`<div class="ob-card"><h2>Connect AI <small class="muted">(optional)</small></h2><p class="muted">LifeOS calls Groq directly from your browser. Paste a key now, or skip and stay in local-only mode.</p>
        <label class="field"><span class="field-label">Groq API key</span><input class="input" type="password" id="ob-key" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="gsk_…" value="${key}"></label>
        <div class="seg" role="radiogroup" aria-label="Key storage"><button type="button" class="seg-btn ${remember ? '' : 'on'}" role="radio" aria-checked="${!remember}" data-ob="session">Session only</button><button type="button" class="seg-btn ${remember ? 'on' : ''}" role="radio" aria-checked="${remember}" data-ob="remember">Remember on this device</button></div>
        <div class="notice"><b>Personal prototype mode.</b> There is no backend, so a remembered key lives in this browser and could be read by code running in this browser profile. Groq recommends a server-side proxy for production. “Session only” keeps the key in memory until you close the app. Never share a key you can’t revoke.</div>
        ${status ? h`<p class="small ${ok ? 'ok-t' : 'err-t'}" role="status">${status}</p>` : ''}
        <div class="row gap wrap"><button class="btn btn-primary" data-ob="test" ${testing ? 'disabled' : ''}>${testing ? 'Testing…' : 'Test connection'}</button><button class="btn" data-ob="skip">Skip — local only</button></div>
        ${ok ? h`<button class="btn btn-primary btn-wide" data-ob="next">Continue</button>` : ''}</div>`,
      h`<div class="ob-card"><h2>Start fresh or explore?</h2><p class="muted">Demo data shows what LifeOS looks like once it knows you — 5 weeks of sample logs, events and goals. You can remove it any time from You → Data.</p>
        <button class="btn btn-primary btn-wide" data-ob="empty">Start empty</button><button class="btn btn-wide" data-ob="demo">Explore with demo data</button></div>`];
      el.innerHTML = html(h`<div class="ob-dots">${[0, 1, 2].map((i) => h`<i class="${i === step ? 'on' : ''}"></i>`)}</div>${steps[step]}`);
    };
    el.onclick = async (e) => {
      const b = e.target.closest('[data-ob]'); if (!b) return; const a = b.dataset.ob;
      if (step === 0 && a === 'next') { await store.setProfile({ name: el.querySelector('#ob-name').value.trim() }); step = 1; draw(); }
      else if (a === 'session' || a === 'remember') { key = el.querySelector('#ob-key').value; remember = a === 'remember'; draw(); }
      else if (a === 'test') {
        key = el.querySelector('#ob-key').value.trim();
        if (!G.looksLikeKey(key)) { status = 'That doesn’t look like a Groq key (it starts with gsk_).'; ok = false; draw(); return; }
        testing = true; status = ''; draw(); await G.setKey(key, remember);
        try { await G.testConnection(); status = 'Connected — AI features are on.'; ok = true; } catch (err) { status = err instanceof G.AIError ? err.message : 'Could not connect.'; ok = false; await G.clearKey(); }
        testing = false; key = ''; draw();
      } else if (a === 'skip') { step = 2; draw(); }
      else if (step === 1 && a === 'next') { step = 2; draw(); }
      else if (a === 'empty') await finish();
      else if (a === 'demo') { demo = true; await finish(); }
    };
    draw();
  });
}
