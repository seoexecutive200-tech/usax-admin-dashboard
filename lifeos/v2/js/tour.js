// "Welcome to LifeOS 2" — shown once after updating, and any time from You → Version.
import { h, icon, openSheet } from './ui.js';
import { WHATS_NEW } from './whatsnew.js';
import { store } from './store.js';
import { builderSheet } from './tracker-ui.js';

export function tourSheet() {
  openSheet({
    title: 'Welcome to LifeOS 2', tall: true,
    body: h`<div class="stack"><p class="lead">Everything you had is still here. Now the app can adapt to you.</p>
      <div class="stack">${WHATS_NEW.map((n) => h`<div class="whatsnew"><span class="t-ic lead">${icon(n.icon, 20)}</span><div><b>${n.title}</b><div class="small muted">${n.text}</div></div></div>`)}</div>
      <div class="row gap end"><button class="btn" data-later>Maybe later</button><button class="btn btn-primary" data-new>${icon('sparkle', 16)} Create my first tracker</button></div></div>`,
    onOpen(s) {
      s.el.querySelector('[data-later]').onclick = s.close;
      s.el.querySelector('[data-new]').onclick = () => { s.close(); setTimeout(() => builderSheet(), 250); };
    },
    onClose: () => { if (!store.settings().introSeen) store.setSettings({ introSeen: true }); },
  });
}
