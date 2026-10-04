// Log in / create account. Shown before the app when the server has accounts enabled and nobody is signed in.
import { h, html, icon, logo } from '../ui.js';
import { login, register } from '../account.js';

export function showAuth() {
  return new Promise((resolve) => {
    const el = document.getElementById('auth'); el.hidden = false; document.body.classList.add('onboarding');
    let mode = 'login'; let busy = false; let error = ''; let show = false; let vals = { name: '', email: '', password: '' };
    const draw = () => {
      const reg = mode === 'register';
      el.innerHTML = html(h`<div class="ob-card">${logo(true)}
        <p class="lead">${reg ? 'Create your account to keep your data safe and use it on any device.' : 'Welcome back. Log in to pick up where you left off.'}</p>
        <div class="seg wide" role="tablist" aria-label="Account"><button class="seg-btn ${reg ? '' : 'on'}" role="tab" aria-selected="${!reg}" data-au="login">Log in</button><button class="seg-btn ${reg ? 'on' : ''}" role="tab" aria-selected="${reg}" data-au="register">Create account</button></div>
        <form id="au-form" class="stack" novalidate>
          ${reg ? h`<label class="field"><span class="field-label">Name (optional)</span><input class="input" name="name" maxlength="40" autocomplete="given-name" value="${vals.name}"></label>` : ''}
          <label class="field"><span class="field-label">Email</span><input class="input" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" required value="${vals.email}"></label>
          <label class="field"><span class="field-label">Password${reg ? ' (at least 8 characters)' : ''}</span><span class="pw"><input class="input" name="password" type="${show ? 'text' : 'password'}" autocomplete="${reg ? 'new-password' : 'current-password'}" required minlength="8" value="${vals.password}"><button type="button" class="icon-btn pw-t" data-au="toggle" aria-label="${show ? 'Hide' : 'Show'} password" aria-pressed="${show}">${icon(show ? 'x' : 'search', 18)}</button></span></label>
          <p class="form-error" role="alert">${error}</p>
          <button class="btn btn-primary btn-wide" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Please wait…' : reg ? 'Create account' : 'Log in'}</button>
        </form>
        <p class="muted small">${icon('lock', 14)} Your data is saved to your account on the LifeOS server so it follows you between devices. It isn’t end-to-end encrypted. Your AI key never leaves this device.</p></div>`);
    };
    const read = () => { const f = new FormData(el.querySelector('#au-form')); vals = { name: String(f.get('name') ?? vals.name), email: String(f.get('email') || ''), password: String(f.get('password') || '') }; };
    el.onclick = (e) => {
      const b = e.target.closest('[data-au]'); if (!b) return; read(); const a = b.dataset.au;
      if (a === 'toggle') { show = !show; draw(); const i = el.querySelector('[name=password]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); return; }
      mode = a; error = ''; draw();
    };
    el.onsubmit = async (e) => {
      e.preventDefault(); if (busy) return; read();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(vals.email.trim())) { error = 'Enter a valid email address.'; draw(); return; }
      if (mode === 'register' && vals.password.length < 8) { error = 'Use a password of at least 8 characters.'; draw(); return; }
      if (!vals.password) { error = 'Enter your password.'; draw(); return; }
      busy = true; error = ''; draw();
      try {
        const user = mode === 'register' ? await register(vals) : await login(vals);
        el.hidden = true; document.body.classList.remove('onboarding'); el.innerHTML = '';
        resolve({ user, isNew: mode === 'register', name: vals.name.trim() });
      } catch (err) { busy = false; error = err.network ? 'You appear to be offline. Connect to log in.' : err.message; draw(); el.querySelector('[name=password]')?.focus(); }
    };
    draw(); el.querySelector('[name=email]')?.focus();
  });
}
