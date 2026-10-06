import { store } from '../store.js';
import * as A from '../analytics.js';
import * as adv from '../advisor.js';
import * as G from '../groq.js';
import { h, icon, toast, openSheet, confirmSheet, seg, bindSeg, segVal, field, applyTheme, applyMotion, bar, pct, slider, bindSliders, logo } from '../ui.js';
import { fmtRelative, fmtDate, round, isNum, dayKey, nowISO, uid } from '../util.js';
import { sourceLabel, addMemory, correctMemory, markWrong, setPrivate, setUseForAdvice, togglePin, forget } from '../memory.js';
import { exportData, importData } from '../export-import.js';
import { loadDemo, removeDemo, hasDemo } from '../seed.js';
import { commit, askSheet } from '../sheets.js';
import { navigate, rerender } from '../router.js';
import { exportWeekly } from './insights.js';
import { isPersistent, getDbName, deleteDatabase } from '../db.js';
import * as T from '../trackers.js';
import { allRules, ruleListHTML, bindRuleList, newRuleSheet } from '../rules-ui.js';
import { builderSheet, editorSheet, readTemplateFile } from '../tracker-ui.js';
import { checkNow, switchToV1, version, showUpdate, updateReady } from '../updates.js';
import { tourSheet } from '../tour.js';
import * as P from '../push.js';
import { customizeTodaySheet } from '../today-layout.js';
import { calendarsCard, connectSheet, gcalRemove, gcalSyncNow } from '../gcal-ui.js';
import * as GC from '../gcal.js';
import { TONES, getTone, nudgeText } from '../tone.js';
import { NUDGE_META } from '../routines.js';
import { sync, flush, syncNow, hasPending, clearSyncState, stopSync } from '../sync.js';
import { forgetUser, logoutRequest, deleteAccountRequest } from '../account.js';

const MODELS = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'meta-llama/llama-4-scout-17b-16e-instruct'];
let testing = false; let testMsg = '';

function memoryCard(m) {
  const state = m.rejected ? 'Marked wrong' : m.private ? 'Private' : m.useForAdvice === false ? 'Not used for advice' : '';
  return h`<div class="card mem ${m.rejected || m.private || m.useForAdvice === false ? 'dim' : ''}"><div class="row between gap"><span class="pill src-${m.kind === 'temporary_context' ? 'temp' : m.source}">${sourceLabel(m)}</span>${m.pinned ? h`<span class="pill">${icon('pin', 12)} Pinned</span>` : ''}</div>
    <p class="strong">${m.text}</p><small class="muted">Confidence ${Math.round((m.confidence || 0) * 100)}% · ${m.evidenceCount || 1} evidence${m.expiresAt ? ` · expires ${fmtRelative(m.expiresAt)}` : ''}${state ? ` · ${state}` : ''}</small>
    <div class="row gap wrap"><button class="btn btn-sm" data-act="m-correct" data-id="${m.id}">Correct</button><button class="btn btn-sm" data-act="m-wrong" data-id="${m.id}">Wrong</button><button class="btn btn-sm" data-act="m-forget" data-id="${m.id}">Forget</button>
    <button class="btn btn-sm ${m.private ? 'btn-on' : ''}" data-act="m-private" data-id="${m.id}" aria-pressed="${!!m.private}">${icon('lock', 13)} Private</button><button class="btn btn-sm ${m.useForAdvice === false ? '' : 'btn-on'}" data-act="m-use" data-id="${m.id}" aria-pressed="${m.useForAdvice !== false}" ${m.private ? 'disabled' : ''}>Use for advice</button><button class="btn btn-sm" data-act="m-pin" data-id="${m.id}">${m.pinned ? 'Unpin' : 'Pin'}</button></div></div>`;
}
const fin = () => A.financeSummary();
function v2Cards(s) {
  const trackers = T.allTrackers(); const rules = allRules();
  return h`<section class="card"><div class="eyebrow">How LifeOS works for you</div><div class="field"><span class="field-label">Mode</span>${seg('appmode', [['classic', 'Classic'], ['custom', 'Blank canvas']], s.mode)}<small class="muted">Classic keeps the built-in sleep, mood, water and wellness suggestions. Blank canvas shows only what you create — your trackers, rules, routines and schedule.</small></div><button class="btn btn-sm" data-act="customize-today">${icon('edit', 14)} Customize Today</button></section>
    <section class="card"><div class="row between center"><div class="eyebrow">Your trackers</div><button class="btn btn-sm btn-outline" data-act="trk-new">${icon('plus', 14)} New</button></div>
      <p class="small muted">${trackers.length ? `${trackers.length} tracker${trackers.length === 1 ? '' : 's'}: ${trackers.map((t) => t.name).slice(0, 5).join(', ')}${trackers.length > 5 ? '…' : ''}` : 'Describe anything you want to keep track of and LifeOS sets it up.'}</p>
      <div class="row gap wrap"><button class="btn btn-sm" data-act="trk-hub">Manage trackers</button><label class="btn btn-sm" for="tplfile">${icon('upload', 14)} Import template</label><input type="file" id="tplfile" data-change="tplfile" accept="application/json,.json" hidden></div></section>
    <section><div class="sec-h"><h2>Rules</h2><button class="btn btn-sm btn-outline" data-act="rule-new">${icon('plus', 16)} New rule</button></div><div id="allrules">${ruleListHTML(rules, { showTracker: true })}</div></section>`;
}
function versionCard() {
  return h`<section class="card"><div class="eyebrow">Version</div><div class="row between center"><div><b>LifeOS ${version}</b><div class="small muted">${updateReady() ? 'An update is ready.' : 'You’re up to date.'}</div></div>${updateReady() ? h`<button class="btn btn-sm btn-primary" data-act="v-update">Update</button>` : ''}</div>
    <div class="row gap wrap"><button class="btn btn-sm" data-act="v-check">${icon('refresh', 14)} Check for updates</button><button class="btn btn-sm" data-act="v-new">What’s new</button><button class="btn btn-sm btn-danger-ghost" data-act="v-back">Switch back to LifeOS 1</button></div>
    <p class="tiny muted">LifeOS 1 and its data are kept untouched, so you can return to it any time. Changes you make in LifeOS 2 won’t appear there.</p></section>`;
}
function pushCard() {
  const st = P.state; const busy = pushBusy;
  const line = !st.loaded ? 'Checking…' : !st.supported ? st.reason : !st.available ? 'Not switched on for this server yet — the site owner needs to add push keys.' : st.permission === 'denied' ? 'Notifications are blocked for this site. Allow them in your browser or phone settings.' : st.on ? `On for this device${st.devices > 1 ? ` · ${st.devices} devices` : ''}. Reminders arrive even when LifeOS is closed.` : 'Off. Turn it on to get reminders when LifeOS is closed.';
  return h`<section class="card"><div class="row between center"><div class="eyebrow">Background reminders</div><span class="status ${st.on ? 'ok' : ''}"><i></i>${st.on ? 'On' : 'Off'}</span></div>
    <p class="small">${line}</p>
    ${st.supported && st.available ? h`<div class="row gap wrap">${st.on ? h`<button class="btn btn-sm" data-act="push-test" ${busy ? 'disabled' : ''}>Send a test</button><button class="btn btn-sm btn-danger-ghost" data-act="push-off" ${busy ? 'disabled' : ''}>Turn off</button>` : h`<button class="btn btn-sm btn-primary" data-act="push-on" ${busy ? 'disabled' : ''}>${busy ? 'Turning on…' : 'Turn on'}</button>`}</div>` : ''}
    ${st.on && st.available ? clockLine(st) : ''}
    <p class="tiny muted">Covers your daily-routine nudges and tracker reminders. Quiet hours (above) are respected. Only the reminder text and time are sent to our server — not your entries. Rules and “Logged in” still need you to open the app.</p></section>`;
}
function coachCard(s) {
  const tone = getTone(); const ex = nudgeText('water', NUDGE_META.water);
  return h`<section class="card"><div class="eyebrow">Coaching style</div>
    <div class="field"><span class="field-label">Tone</span>${seg('tone', Object.entries(TONES).map(([k, v]) => [k, v[0]]), tone)}<small class="muted">${TONES[tone][1]}. Applies to reminders, nudges and how the AI words its advice. Numbers and facts never change.</small></div>
    <div class="card inset"><div class="tiny muted">Example reminder</div><b>${ex.title}</b>${ex.body ? h`<div class="small muted">${ex.body}</div>` : ''}</div>
    <label class="check"><input type="checkbox" data-change="followups" ${s.askFollowups !== false ? 'checked' : ''}><span>Ask follow-up questions when I add plain text <small class="muted">(needs AI)</small></span></label>
    <p class="tiny muted">How often the advisor speaks is set under Advisor mode above.</p></section>`;
}
function clockLine(st) {
  const ago = st.tickAt ? Math.round((Date.now() - st.tickAt) / 60000) : null; const live = ago !== null && ago <= 15;
  return h`<p class="small ${live ? '' : 'err-t'}">${icon(live ? 'check' : 'clock', 14)} <b>Reminder clock:</b> ${live ? `running (last ran ${ago < 1 ? 'just now' : `${ago} min ago`}).` : ago === null ? 'not running yet. Until the site’s scheduler is set up, reminders only reach you when LifeOS is open.' : `last ran ${ago < 90 ? `${ago} min` : `${Math.round(ago / 60)} h`} ago — it may have stopped. Reminders only reach you when LifeOS is open until it runs again.`}</p>`;
}
let pushBusy = false;
function accountCard() {
  const u = window.__account;
  if (!u) return h`<section class="card acct"><div class="eyebrow">Account</div><p class="small muted">This LifeOS host doesn’t have accounts enabled, so your data is saved only on this device. Use Export to back it up.</p></section>`;
  const st = sync.status; const tone = st === 'synced' ? 'ok' : st === 'error' || st === 'auth' ? 'bad' : 'warn';
  const text = st === 'synced' ? `Synced ${sync.lastSync && Date.now() - sync.lastSync > 60000 ? fmtRelative(sync.lastSync) : 'just now'}` : st === 'syncing' ? 'Syncing…' : st === 'pending' ? 'Changes waiting to sync…' : st === 'offline' ? 'Offline — will sync when you reconnect' : st === 'auth' ? 'Session expired — log in again' : st === 'error' ? `Sync problem: ${sync.message}` : 'Not synced yet';
  return h`<section class="card acct"><div class="eyebrow">Account</div><div class="row between gap"><div class="grow"><b>${u.name || u.email}</b><br><small class="muted">${u.email}</small></div></div>
    <div class="row gap center"><i class="acct-dot ${tone}"></i><span class="small">${text}</span></div>
    <div class="row gap wrap"><button class="btn btn-sm" data-act="sync-now">${icon('refresh', 14)} Sync now</button><button class="btn btn-sm" data-act="logout">Log out</button><button class="btn btn-sm btn-danger-ghost" data-act="del-account">Delete account</button></div>
    <p class="muted tiny">Your data is stored on the LifeOS server so it follows your account. It isn’t end-to-end encrypted. Your AI key is never uploaded.</p></section>`;
}
const money = (n) => `${Math.round(n).toLocaleString()}`;

export default {
  id: 'you',
  render() {
    const s = store.settings(); const p = store.profile(); const mems = store.all('memories').filter((m) => m.kind !== 'decision' && !m.forgotten).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));
    const goals = store.all('goals'); const acts = store.all('activities').filter((a) => !a.kind); const decisions = store.all('memories').filter((m) => m.kind === 'decision');
    const f = fin(); const ready = G.aiReady(); const hasKey = G.hasKey();
    const pri = [...p.priorities].sort((a, b) => b.weight - a.weight);
    return h`<div class="screen you">
      <header class="top">${logo()}<span></span></header><div class="hero"><h1>You</h1><p class="muted">Your profile, priorities, memory and settings. Everything stays on this device.</p></div>
      ${accountCard()}
      ${v2Cards(s)}
      ${coachCard(s)}
      ${calendarsCard()}
      ${pushCard()}
      <section class="card"><div class="eyebrow">Profile</div>${field('Name', h`<input class="input" data-input="name" value="${p.name}" maxlength="40" placeholder="What should I call you?">`)}
        <div class="field"><span class="field-label">Appearance</span>${seg('theme', [['dark', 'Dark'], ['light', 'Light'], ['system', 'System']], s.theme)}</div>
        <div class="field"><span class="field-label">Reduce motion</span>${seg('motion', [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']], s.reducedMotion)}</div>
        <div class="field"><span class="field-label">Advisor mode</span>${seg('mode', [['quiet', 'Quiet'], ['balanced', 'Balanced'], ['active', 'Active']], s.advisorMode)}<small class="muted">Quiet: only time-sensitive items. Balanced: up to 3 a day. Active: up to 5.</small></div>
        <div class="grid2">${field('Quiet hours start', h`<input class="input" type="time" data-change="qh0" value="${s.quietHours[0]}">`)}${field('Quiet hours end', h`<input class="input" type="time" data-change="qh1" value="${s.quietHours[1]}">`)}</div>
        <label class="check"><input type="checkbox" data-change="notif" ${s.notifications ? 'checked' : ''}><span>Browser notifications for reminders (optional)</span></label></section>
      <section><div class="sec-h"><h2>Priorities</h2></div><p class="muted small">Order and weight tell the advisor what matters most.</p><ul class="prio">${pri.map((x, i) => h`<li><span class="grow strong">${x.label}</span><div class="row gap"><button class="icon-btn" data-act="p-up" data-id="${x.id}" aria-label="Move ${x.label} up" ${i === 0 ? 'disabled' : ''}>${icon('down', 18, 'flip')}</button><button class="icon-btn" data-act="p-down" data-id="${x.id}" aria-label="Move ${x.label} down" ${i === pri.length - 1 ? 'disabled' : ''}>${icon('down', 18)}</button></div><div class="weight" role="group" aria-label="${x.label} weight">${[1, 2, 3, 4, 5].map((n) => h`<button class="w ${n <= x.weight ? 'on' : ''}" data-act="p-w" data-id="${x.id}" data-n="${n}" aria-label="Weight ${n}"></button>`)}</div></li>`)}</ul></section>
      <section><div class="sec-h"><h2>Goals</h2><button class="btn btn-sm btn-outline" data-act="g-add">${icon('plus', 16)} Add</button></div>
        ${goals.length ? goals.map((g) => { const gp = A.goalProgress(g); return h`<div class="card"><div class="row between gap"><b class="${g.status === 'done' ? 'strike' : ''}">${g.title}</b><span class="row gap"><button class="icon-btn" data-act="g-done" data-id="${g.id}" aria-label="${g.status === 'done' ? 'Reopen goal' : 'Mark goal done'}">${icon('check', 18)}</button><button class="icon-btn" data-act="g-edit" data-id="${g.id}" aria-label="Edit goal">${icon('edit', 18)}</button><button class="icon-btn" data-act="g-del" data-id="${g.id}" aria-label="Delete goal">${icon('trash', 18)}</button></span></div>${gp ? h`${bar(gp.pct, gp.pct >= 1 ? 'var(--green)' : 'var(--blue)')}<small class="muted">${round(gp.current, 1)} ${gp.unit} · target ${g.target}</small>` : h`<small class="muted">No tracked metric</small>`}</div>`; }) : h`<div class="empty"><p>No goals yet.</p></div>`}</section>
      <section id="memory"><div class="sec-h"><h2>AI Memory</h2><button class="btn btn-sm btn-outline" data-act="m-add">${icon('plus', 16)} Add</button></div><p class="muted small">What I use to personalise advice. Private or “not for advice” memories are never sent to the AI.</p>
        ${mems.length ? mems.map(memoryCard) : h`<div class="empty"><p>Nothing remembered yet. Tell me preferences in Capture (e.g. “remember that I prefer evening workouts”).</p></div>`}</section>
      <section><div class="sec-h"><h2>Decisions</h2><button class="btn btn-sm btn-outline" data-act="d-add">${icon('plus', 16)} Add</button></div><p class="muted small">Note the expected benefits and costs of a big choice, then record how it turned out.</p>
        ${decisions.length ? decisions.map((d) => h`<div class="card"><b>${d.title}</b><p class="small muted">Expected: ${d.expected || '—'}</p>${d.outcome ? h`<p class="small">Outcome: ${d.outcome}</p>` : h`<button class="btn btn-sm" data-act="d-out" data-id="${d.id}">Record outcome</button>`}<button class="btn btn-sm btn-danger-ghost" data-act="d-del" data-id="${d.id}">Delete</button></div>`) : h`<div class="empty"><p>No decisions logged.</p></div>`}</section>
      <section><div class="sec-h"><h2>Custom trackers</h2><button class="btn btn-sm btn-outline" data-act="a-add">${icon('plus', 16)} Add</button></div><p class="muted small">Habits or metrics you define. They appear as one-tap chips on Today.</p>
        ${acts.length ? acts.map((a) => h`<div class="card row between gap"><span><b>${a.name}</b>${a.unit ? h` <small class="muted">(${a.unit})</small>` : ''}${a.enabled === false ? h` <small class="muted">paused</small>` : ''}</span><span class="row gap"><button class="btn btn-sm" data-act="a-toggle" data-id="${a.id}">${a.enabled === false ? 'Resume' : 'Pause'}</button><button class="icon-btn" data-act="a-del" data-id="${a.id}" aria-label="Delete tracker">${icon('trash', 18)}</button></span></div>`) : h`<div class="empty"><p>No custom trackers.</p></div>`}</section>
      <section><div class="sec-h"><h2>Finance (light)</h2><button class="btn btn-sm btn-outline" data-act="f-manage">Manage</button></div>
        <div class="card"><div class="grid2 fin"><div><small class="muted">Monthly income</small><b>${money(f.income)}</b></div><div><small class="muted">Obligations</small><b>${money(f.obligations)}</b></div><div><small class="muted">Spent this month</small><b>${money(f.spent)}</b></div><div><small class="muted">Buffer</small><b>${money(f.buffer)}</b></div></div>
        <p class="small ${f.discretionary < 0 ? '' : 'muted'}">Discretionary room this month: <b>${money(f.discretionary)}</b></p>${f.hasData ? '' : h`<p class="muted small">Add income and obligations to see trade-offs. Decision support only — not investment, tax or legal advice.</p>`}<button class="btn btn-sm" data-act="f-afford">Can I afford…?</button></div></section>
      <section id="ai-api" class="card ai-card"><div class="eyebrow">AI & API</div>
        <div class="row between center"><span class="strong">Groq connection</span><span class="status ${ready ? 'ok' : ''}"><i></i>${ready ? (G.usingHosted() ? 'Included' : 'Connected') : hasKey ? 'Key saved' : 'Not set up'}</span></div>
        ${hasKey ? h`<p class="mono">${G.maskedKey()}</p>` : ''}${G.usingHosted() ? h`<p class="small">${icon('sparkle', 14)} <b>AI is included</b> — ${G.hosted.used} of ${G.hosted.limit} requests used today. Adding your own key below takes priority and has no daily limit from us.</p>` : ''}${s.lastSuccessfulAiCall ? h`<small class="muted">Last successful call ${fmtRelative(s.lastSuccessfulAiCall)}</small>` : ''}
        <form class="stack" data-submit="savekey" autocomplete="off">${field(hasKey ? 'Replace key' : 'Groq API key', h`<input class="input" type="password" name="key" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="gsk_…" aria-label="Groq API key">`)}
          <label class="check"><input type="checkbox" name="remember" ${s.keyStorage === 'device' ? 'checked' : ''}><span><b>Remember on this device</b> — otherwise session only (kept in memory until you close the app).</span></label>
          <div class="notice"><b>Personal prototype mode.</b> LifeOS has no backend, so a remembered key is stored in this browser. Code running in this browser profile could read it, and Groq recommends proxying keys through a server for production. Use a key you can revoke, and prefer “Session only” on shared devices.</div>
          <div class="row gap wrap"><button class="btn btn-primary">${hasKey ? 'Replace key' : 'Save key'}</button><button type="button" class="btn" data-act="test" ${hasKey ? '' : 'disabled'}>${testing ? 'Testing…' : 'Test connection'}</button><button type="button" class="btn btn-danger-ghost" data-act="clearkey" ${hasKey ? '' : 'disabled'}>Clear key</button></div></form>
        ${testMsg ? h`<p class="small ${testMsg.startsWith('OK') ? 'ok-t' : 'err-t'}" role="status">${testMsg}</p>` : ''}
        <label class="check"><input type="checkbox" data-change="aienabled" ${s.aiEnabled ? 'checked' : ''}><span>AI features enabled</span></label>
        ${field('Model', h`<input class="input" list="models" data-change="model" value="${s.modelId}" spellcheck="false" autocapitalize="off"><datalist id="models">${MODELS.map((m) => h`<option value="${m}"></option>`)}</datalist>`, 'Editable — model availability changes. Strict JSON-schema output is used where supported, otherwise JSON mode with local validation.')}
        ${field(`Temperature ${s.temperature}`, h`<input type="range" min="0" max="1" step="0.1" value="${s.temperature}" data-change="temp" aria-label="Temperature">`)}
        <p class="muted small">Only a compact, relevant context is sent per request — never your key, exports, private memories or raw notes. Core tracking works without AI.</p></section>
      <section class="card"><div class="eyebrow">Data</div><div class="stack">
        <button class="btn" data-act="export">${icon('download', 18)} Export data (JSON)</button><button class="btn" data-act="import">${icon('upload', 18)} Import data</button><input type="file" id="imp" data-change="impfile" accept="application/json,.json" hidden>
        <button class="btn" data-act="weekly">${icon('download', 18)} Export weekly report</button>
        ${hasDemo() ? h`<button class="btn" data-act="rmdemo">Remove demo data</button>` : h`<button class="btn" data-act="demo">Load demo data</button>`}
        <button class="btn btn-danger-ghost" data-act="reset">${icon('trash', 18)} Reset all data</button></div>
        <p class="muted small">${isPersistent() ? 'Stored in IndexedDB on this device.' : 'Private browsing detected: data lives in memory only and will be lost when you close this tab. Export to keep it.'} Exports never include your API key.</p></section>
      ${versionCard()}
      <p class="center muted tiny">LifeOS 2 · local-first · estimates, not medical advice</p></div>`;
  },
  mount(root) {
    if (!root._gcalBound) { root._gcalBound = true; GC.onGcal(() => { if (document.body.dataset.screen === 'you') rerender(); }); }
    if (P.statusStale()) P.refreshStatus().then((changed) => { if (changed && document.body.dataset.screen === 'you') rerender(); });
    if (!root._youBound) { // viewEl persists across screens: bind once
      root._youBound = true; bindRuleList(root, () => rerender());
      bindSeg(root, async (name, v) => {
        if (name === 'theme') { await store.setSettings({ theme: v }); applyTheme(); }
        else if (name === 'motion') { await store.setSettings({ reducedMotion: v }); applyMotion(); }
        else if (name === 'tone') { await store.setSettings({ coachTone: v }); toast(`Tone: ${TONES[v][0]}`); }
        else if (name === 'appmode') { await store.setSettings({ mode: v, todayLayout: null }); toast(v === 'custom' ? 'Blank canvas on — only what you create is shown' : 'Classic mode on'); }
        else if (name === 'mode') { await store.setSettings({ advisorMode: v }); await store.setProfile({ advisorMode: v }); toast(`Advisor: ${v}`); }
      });
    }
  },
  inputs: {
    tplfile: async (el) => { const f = el.files[0]; if (!f) return; try { const r = await readTemplateFile(f); editorSheet(r.tracker, { rulesDraft: r.rules, fromTemplate: true }); } catch (e) { toast(e.message, { tone: 'warn' }); } el.value = ''; },
    impfile: async (el) => {
      const file = el.files[0]; if (!file) return;
      try { const text = await file.text(); const ok = await confirmSheet({ title: 'Replace all data?', message: `Importing “${file.name}” replaces everything currently stored on this device.`, confirm: 'Import', danger: true }); if (!ok) return;
        const r = await importData(text); toast(`Imported ${Object.values(r.counts).reduce((a, b) => a + b, 0)} records`); } catch (err) { toast(err.message, { tone: 'warn' }); }
      el.value = '';
    },
    name: (el) => { clearTimeout(el._t); el._t = setTimeout(() => store.setProfile({ name: el.value.trim() }), 500); },
    qh0: (el) => store.setSettings({ quietHours: [el.value || '22:00', store.settings().quietHours[1]] }),
    qh1: (el) => store.setSettings({ quietHours: [store.settings().quietHours[0], el.value || '07:00'] }),
    notif: async (el) => {
      if (!el.checked) { await store.setSettings({ notifications: false }); return; }
      if (!('Notification' in window)) { el.checked = false; toast('Notifications aren’t supported here', { tone: 'warn' }); return; }
      const r = await Notification.requestPermission(); await store.setSettings({ notifications: r === 'granted' }); if (r !== 'granted') { el.checked = false; toast('Permission not granted — in-app reminders still work'); }
    },
    aienabled: (el) => store.setSettings({ aiEnabled: el.checked }),
    followups: (el) => store.setSettings({ askFollowups: el.checked }),
    model: (el) => { const v = el.value.trim(); if (v) { store.setSettings({ modelId: v }); toast('Model updated'); } },
    temp: (el) => store.setSettings({ temperature: Number(el.value) }),
  },
  actions: {
    'trk-new': () => builderSheet(), 'trk-hub': () => navigate('#/trackers'), 'rule-new': () => newRuleSheet({ onSaved: () => rerender() }),
    'v-check': async () => { toast('Checking…'); const r = await checkNow(); toast(r === 'ready' ? 'An update is ready' : r === 'current' ? 'You’re up to date' : 'Couldn’t check right now', { tone: r === 'error' ? 'warn' : '' }); rerender(); },
    'customize-today': () => customizeTodaySheet(), 'gcal-connect': () => connectSheet(), 'gcal-sync': () => gcalSyncNow(), 'gcal-remove': (el) => gcalRemove(el.dataset.id, el.dataset.name),
    'push-on': async () => { pushBusy = true; rerender(); try { await P.enable(); toast('Background reminders are on'); } catch (e) { toast(e.message || 'Couldn’t turn on', { tone: 'warn', duration: 7000 }); } pushBusy = false; rerender(); },
    'push-off': async () => { pushBusy = true; rerender(); await P.disable(); pushBusy = false; toast('Background reminders are off'); rerender(); },
    'push-test': async () => { try { const r = await P.sendTest(); toast(`Test sent to ${r.delivered} device${r.delivered === 1 ? '' : 's'} — it should arrive in a few seconds`); } catch (e) { toast(e.message || 'Test failed', { tone: 'warn' }); } },
    'v-update': () => showUpdate(), 'v-new': () => tourSheet(),
    'v-back': async () => { if (await confirmSheet({ title: 'Switch back to LifeOS 1?', message: 'Your original LifeOS and its data are untouched. Anything you add in LifeOS 2 (trackers, rules) will not be there. You can return here any time.', confirm: 'Switch back' })) switchToV1(); },
    // memory controls
    'm-correct': (el) => memEdit(store.get('memories', el.dataset.id)), 'm-wrong': async (el) => { await markWrong(el.dataset.id); toast('Marked wrong — I won’t use it'); },
    'm-forget': async (el) => { const m = store.get('memories', el.dataset.id); if (await confirmSheet({ title: 'Forget this?', message: `“${m.text}” will be removed${m.patternId ? ' and not re-learned' : ''}.`, confirm: 'Forget', danger: true })) { await forget(m.id); toast('Forgotten', { undo: () => store.restore('memories', m) }); } },
    'm-private': async (el) => { const m = store.get('memories', el.dataset.id); await setPrivate(m.id, !m.private); },
    'm-use': async (el) => { const m = store.get('memories', el.dataset.id); await setUseForAdvice(m.id, m.useForAdvice === false); },
    'm-pin': (el) => togglePin(el.dataset.id), 'm-add': () => memEdit(null),
    // priorities
    'p-up': (el) => movePri(el.dataset.id, -1), 'p-down': (el) => movePri(el.dataset.id, 1),
    'p-w': async (el) => { const p = store.profile(); await store.setProfile({ priorities: p.priorities.map((x) => (x.id === el.dataset.id ? { ...x, weight: Number(el.dataset.n) } : x)) }); },
    // goals
    'g-add': () => goalSheet(null), 'g-edit': (el) => goalSheet(store.get('goals', el.dataset.id)),
    'g-done': async (el) => { const g = store.get('goals', el.dataset.id); await store.save('goals', { id: g.id, status: g.status === 'done' ? 'active' : 'done' }); },
    'g-del': async (el) => { const g = store.get('goals', el.dataset.id); if (await confirmSheet({ title: 'Delete goal?', message: `“${g.title}”`, confirm: 'Delete', danger: true })) { await store.remove('goals', g.id); toast('Goal deleted', { undo: () => store.restore('goals', g) }); } },
    // decisions
    'd-add': () => decisionSheet(), 'd-out': (el) => outcomeSheet(store.get('memories', el.dataset.id)), 'd-del': async (el) => { const d = store.get('memories', el.dataset.id); await store.remove('memories', d.id); toast('Decision deleted', { undo: () => store.restore('memories', d) }); },
    // trackers
    'a-add': () => trackerSheet(), 'a-toggle': async (el) => { const a = store.get('activities', el.dataset.id); await store.save('activities', { id: a.id, enabled: a.enabled === false }); },
    'a-del': async (el) => { const a = store.get('activities', el.dataset.id); await store.remove('activities', a.id); toast('Tracker deleted', { undo: () => store.restore('activities', a) }); },
    // finance
    'f-manage': () => financeSheet(), 'f-afford': () => affordSheet(),
    // AI & API
    savekey: async (form) => {
      const f = new FormData(form); const key = String(f.get('key') || '').trim(); const remember = f.get('remember') === 'on';
      if (!key) { if (G.hasKey()) { await G.setRemember(remember); toast(remember ? 'Key will be remembered on this device' : 'Key is now session only'); } else toast('Paste a Groq key first', { tone: 'warn' }); return; }
      if (!G.looksLikeKey(key)) { toast('That doesn’t look like a Groq key (starts with gsk_)', { tone: 'warn' }); return; }
      await G.setKey(key, remember); form.querySelector('[name=key]').value = ''; testMsg = ''; toast('Key saved. Testing…'); runTest();
    },
    test: () => runTest(),
    clearkey: async () => { if (await confirmSheet({ title: 'Clear the saved key?', message: 'AI features switch off until you add a key again. Local tracking is unaffected.', confirm: 'Clear key', danger: true })) { await G.clearKey(); testMsg = ''; toast('Key cleared'); } },
    // data
    export: () => { exportData(); toast('Exported (API key never included)'); }, import: () => document.getElementById('imp').click(), weekly: () => exportWeekly(),
    demo: async () => { await loadDemo(); toast('Demo data loaded — remove it any time'); adv.notify('demo'); },
    rmdemo: async () => { await removeDemo(); toast('Demo data removed'); },
    reset: () => resetSheet(),
    'sync-now': async () => { await syncNow(); toast(sync.status === 'synced' ? 'Up to date' : sync.message || 'Could not sync', { tone: sync.status === 'synced' ? '' : 'warn' }); },
    logout: () => logoutSheet(), 'del-account': () => deleteAccountSheet(),
  },
};

function logoutSheet() {
  const u = window.__account;
  openSheet({ title: 'Log out', body: h`<p class="muted">Log out of <b>${u.email}</b>? Your data stays safe in your account.</p>
    <label class="check"><input type="checkbox" id="rm" checked><span>Also remove this account’s data and AI key from this device (recommended on shared devices)</span></label><p class="form-error" id="le" role="alert"></p>
    <div class="row gap end"><button class="btn" data-no>Cancel</button><button class="btn btn-primary" id="go">Log out</button></div>`,
    onOpen(s) {
      s.el.querySelector('[data-no]').onclick = s.close;
      s.el.querySelector('#go').onclick = async (e) => {
        e.target.disabled = true; e.target.textContent = 'Syncing…'; const rm = s.el.querySelector('#rm').checked;
        const ok = await flush();
        if (!ok && hasPending() && !s.el.dataset.force) { s.el.querySelector('#le').textContent = 'Some changes couldn’t sync yet (are you offline?). Log out anyway? They will be lost.'; s.el.dataset.force = '1'; e.target.disabled = false; e.target.textContent = 'Log out anyway'; return; }
        await endSession(rm);
      };
    } });
}
async function endSession(removeLocal) {
  const u = window.__account; stopSync(); await logoutRequest(); forgetUser();
  if (removeLocal) { await G.clearKey(); clearSyncState(u.id); await deleteDatabase(getDbName()); }
  location.hash = '#/today'; location.reload();
}
function deleteAccountSheet() {
  openSheet({ title: 'Delete account', body: h`<p class="muted">This permanently deletes your account and all synced data from the server and this device. It can’t be undone. Export a backup first if you might want it.</p>
    ${field('Confirm with your password', h`<input class="input" type="password" id="dp" autocomplete="current-password">`)}<p class="form-error" id="de" role="alert"></p>
    <div class="row gap end"><button class="btn" data-no>Cancel</button><button class="btn btn-danger" id="dgo">Delete everything</button></div>`,
    onOpen(s) {
      s.el.querySelector('[data-no]').onclick = s.close;
      s.el.querySelector('#dgo').onclick = async (e) => {
        const pw = s.el.querySelector('#dp').value; if (!pw) { s.el.querySelector('#de').textContent = 'Enter your password.'; return; }
        e.target.disabled = true;
        try { await deleteAccountRequest(pw); } catch (err) { s.el.querySelector('#de').textContent = err.network ? 'You need to be online to delete your account.' : err.message; e.target.disabled = false; return; }
        await endSession(true);
      };
    } });
}
async function runTest() {
  if (testing) return; testing = true; testMsg = ''; rerender();
  try { const r = await G.testConnection(); testMsg = `OK — connected (model replied “${r}”).`; } catch (e) { testMsg = e instanceof G.AIError ? e.message : 'Could not complete the test.'; }
  testing = false; rerender();
}
async function movePri(id, dir) {
  const p = store.profile(); const list = [...p.priorities].sort((a, b) => b.weight - a.weight); const i = list.findIndex((x) => x.id === id); const j = i + dir; if (j < 0 || j >= list.length) return;
  // reorderable weights: swap weights between neighbours so order is persisted by weight, then by array position
  const wi = list[i].weight; const wj = list[j].weight;
  const next = p.priorities.map((x) => (x.id === list[i].id ? { ...x, weight: wj === wi ? wi : wj, order: j } : x.id === list[j].id ? { ...x, weight: wj === wi ? wi : wi, order: i } : x));
  if (wi === wj) { const arr = [...p.priorities]; const a = arr.findIndex((x) => x.id === list[i].id); const b = arr.findIndex((x) => x.id === list[j].id); const t = arr[a]; arr[a] = arr[b]; arr[b] = t; await store.setProfile({ priorities: arr }); return; }
  await store.setProfile({ priorities: next });
}

function memEdit(m) {
  openSheet({
    title: m ? 'Correct memory' : 'Add memory', body: h`<form class="stack" id="me">${field('What should I remember?', h`<textarea class="input" name="t" rows="3" maxlength="300" required autofocus>${m?.text || ''}</textarea>`)}${m ? '' : h`<div class="field"><span class="field-label">Type</span>${seg('k', [['preference', 'Preference'], ['temporary_context', 'Temporary (7 days)']], 'preference')}</div>`}<div class="row gap end"><button class="btn btn-primary">Save</button></div></form>`,
    onOpen(s) { bindSeg(s.el); s.el.querySelector('#me').addEventListener('submit', async (e) => { e.preventDefault(); const t = String(new FormData(e.target).get('t')).trim(); if (!t) return; s.close(); if (m) { await correctMemory(m.id, t); toast('Memory corrected'); } else { await addMemory({ text: t, kind: segVal(s.el, 'k', 'preference'), expiresInDays: segVal(s.el, 'k') === 'temporary_context' ? 7 : null }); toast('Remembered'); } }); },
  });
}
function goalSheet(g) {
  openSheet({
    title: g ? 'Edit goal' : 'New goal', body: h`<form class="stack" id="gf">${field('Goal', h`<input class="input" name="t" maxlength="160" required value="${g?.title || ''}" autofocus>`)}
      ${field('Track automatically?', h`<select class="input" name="m"><option value="">No tracked metric</option><option value="sleep" ${g?.metric === 'sleep' ? 'selected' : ''}>Average sleep (hours)</option><option value="workout" ${g?.metric === 'workout' ? 'selected' : ''}>Movement days per week</option><option value="water" ${g?.metric === 'water' ? 'selected' : ''}>Average water (ml/day)</option></select>`)}
      ${field('Target', h`<input class="input" type="number" name="n" min="0" step="0.5" value="${g?.target ?? ''}" placeholder="e.g. 7">`)}<div class="row gap end"><button class="btn btn-primary">Save</button></div></form>`,
    onOpen(s) { s.el.querySelector('#gf').addEventListener('submit', async (e) => { e.preventDefault(); const f = new FormData(e.target); const t = String(f.get('t')).trim(); if (!t) return; s.close(); const metric = f.get('m') || null; const target = Number(f.get('n')) > 0 ? Number(f.get('n')) : null; if (g) await commit({ type: 'update_goal', payload: { id: g.id, title: t, target } }, { notify: false }); else await commit({ type: 'create_goal', payload: { title: t, metric, target } }, { notify: false }); if (g && metric !== g.metric) await store.save('goals', { id: g.id, metric }); }); },
  });
}
function decisionSheet() {
  openSheet({ title: 'New decision', body: h`<form class="stack" id="df">${field('The decision', h`<input class="input" name="t" maxlength="140" required placeholder="e.g. Take the new project" autofocus>`)}${field('Expected benefits and costs', h`<textarea class="input" name="e" rows="3" maxlength="300"></textarea>`)}<div class="row gap end"><button class="btn btn-primary">Save</button></div></form>`,
    onOpen(s) { s.el.querySelector('#df').addEventListener('submit', async (e) => { e.preventDefault(); const f = new FormData(e.target); const t = String(f.get('t')).trim(); if (!t) return; s.close(); await store.save('memories', { kind: 'decision', title: t, expected: String(f.get('e')).trim(), text: `Decision: ${t}. Expected: ${String(f.get('e')).trim() || 'n/a'}`, source: 'user_explicit', confidence: 0.9, evidenceCount: 1, pinned: false, private: false, useForAdvice: true, lastConfirmedAt: nowISO() }); toast('Decision saved'); }); } });
}
function outcomeSheet(d) {
  openSheet({ title: 'Record outcome', body: h`<form class="stack" id="of"><p class="muted">${d.title}</p>${field('How did it turn out?', h`<textarea class="input" name="o" rows="3" maxlength="300" required autofocus></textarea>`)}<div class="row gap end"><button class="btn btn-primary">Save</button></div></form>`,
    onOpen(s) { s.el.querySelector('#of').addEventListener('submit', async (e) => { e.preventDefault(); const o = String(new FormData(e.target).get('o')).trim(); if (!o) return; s.close(); await store.save('memories', { id: d.id, outcome: o, text: `${d.text}. Outcome: ${o}` }); toast('Outcome recorded'); }); } });
}
function trackerSheet() {
  openSheet({ title: 'New tracker', body: h`<form class="stack" id="af">${field('Name', h`<input class="input" name="n" maxlength="40" required placeholder="e.g. Stretching, Reading, Meditation" autofocus>`)}${field('Unit (optional)', h`<input class="input" name="u" maxlength="12" placeholder="min, pages…">`)}<p class="muted small">Tap its chip on Today to log it.</p><div class="row gap end"><button class="btn btn-primary">Add</button></div></form>`,
    onOpen(s) { s.el.querySelector('#af').addEventListener('submit', async (e) => { e.preventDefault(); const f = new FormData(e.target); const n = String(f.get('n')).trim(); if (!n) return; s.close(); await store.save('activities', { name: n, unit: String(f.get('u')).trim(), category: 'custom', trackingType: 'count', enabled: true }); toast('Tracker added'); }); } });
}
function financeSheet() {
  const draw = (s) => {
    const recs = store.all('finance').filter((r) => r.kind !== 'expense');
    s.setBody(h`<div class="stack"><p class="muted small">Manual entry only. Monthly figures. Expenses captured elsewhere count toward “spent”.</p>
      ${recs.length ? recs.map((r) => h`<div class="card row between gap"><span><b>${r.label}</b><br><small class="muted">${r.kind} · ${money(r.amount)}${r.recurring ? ' / month' : ''}</small></span><button class="icon-btn" data-del="${r.id}" aria-label="Delete ${r.label}">${icon('trash', 18)}</button></div>`) : h`<div class="empty"><p>No income, obligations or buffer yet.</p></div>`}
      <form class="stack card inset" id="ff"><div class="seg" data-seg="k">${[['income', 'Income'], ['obligation', 'Obligation'], ['buffer', 'Buffer'], ['goal', 'Goal']].map(([v, l], i) => h`<button type="button" class="seg-btn ${i === 0 ? 'on' : ''}" data-v="${v}">${l}</button>`)}</div>
      ${field('Label', h`<input class="input" name="l" maxlength="60" required placeholder="Salary, Rent, Emergency fund…">`)}${field('Amount', h`<input class="input" type="number" name="a" min="0.01" step="0.01" inputmode="decimal" required>`)}<button class="btn btn-primary">Add</button></form></div>`);
    bindSeg(s.el);
    s.el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { const r = store.get('finance', b.dataset.del); await store.remove('finance', r.id); toast('Removed', { undo: () => store.restore('finance', r) }); draw(s); }));
    s.el.querySelector('#ff').addEventListener('submit', async (e) => { e.preventDefault(); const f = new FormData(e.target); const kind = segVal(s.el, 'k', 'income'); const amount = Number(f.get('a')); if (!(amount > 0)) return; await store.save('finance', { kind, amount, label: String(f.get('l')).trim(), category: kind, recurring: kind === 'income' || kind === 'obligation', date: dayKey() }); draw(s); });
  };
  openSheet({ title: 'Finance records', tall: true, body: '', onOpen: draw });
}
function affordSheet() {
  openSheet({ title: 'Can I afford…?', tall: true,
    body: h`<form class="stack" id="af">${field('Amount', h`<input class="input" type="number" name="a" min="0.01" step="0.01" inputmode="decimal" required autofocus>`)}${field('What for (optional)', h`<input class="input" name="w" maxlength="60">`)}<button class="btn btn-primary">Show trade-offs</button></form><div id="out" class="stack"></div>`,
    onOpen(s) {
      s.el.querySelector('#af').addEventListener('submit', async (e) => {
        e.preventDefault(); const f = new FormData(e.target); const amt = Number(f.get('a')); if (!(amt > 0)) return; const x = fin(); const out = s.el.querySelector('#out');
        if (!x.hasData) { out.innerHTML = '<p class="muted">Add income and obligations first (Manage) so the numbers mean something.</p>'; return; }
        const after = x.discretionary - amt; const bufferHit = Math.max(0, amt - Math.max(0, x.discretionary));
        const rows = [['Ability to pay', after >= 0 ? 'Fits within this month’s discretionary room.' : `Exceeds discretionary room by ${money(-after)}.`], ['Required obligations', x.discretionary - amt >= 0 ? 'Unaffected.' : 'Could squeeze obligations unless the buffer covers it.'], ['Buffer', x.buffer ? (bufferHit > 0 ? `Would draw ~${money(bufferHit)} from your ${money(x.buffer)} buffer.` : 'Untouched.') : 'No buffer recorded.'], ['Goals', x.goals.length ? `${x.goals.length} goal${x.goals.length > 1 ? 's' : ''} recorded; paying from discretionary room doesn’t delay them directly.` : 'No goals recorded.'], ['Flexibility afterward', `${money(after)} discretionary left this month.`]];
        out.innerHTML = `<div class="card">${rows.map(([k, v]) => `<div class="ev-row"><span class="ev-kind ev-calculated">${k}</span><span>${v.replace(/</g, '&lt;')}</span></div>`).join('')}<p class="muted small">Calculated from your own figures — a trade-off view, not advice.</p></div>${G.aiReady() ? '<button class="btn" id="ex">Explain the trade-offs</button>' : ''}`;
        out.querySelector('#ex')?.addEventListener('click', () => { s.close(); askSheet(`Can I afford ${amt}${f.get('w') ? ` for ${f.get('w')}` : ''}?`); });
      });
    } });
}
function resetSheet() {
  openSheet({ title: 'Reset all data', body: h`<p class="muted">This permanently deletes everything on this device: logs, events, memories, reports and settings. Export first if you might want it back. Your API key will also be cleared.</p>${field('Type RESET to confirm', h`<input class="input" id="rs" autocomplete="off" autocapitalize="characters">`)}<div class="row gap end"><button class="btn" data-no>Cancel</button><button class="btn btn-danger" id="rgo" disabled>Delete everything</button></div>`,
    onOpen(s) { const i = s.el.querySelector('#rs'); const b = s.el.querySelector('#rgo'); i.addEventListener('input', () => { b.disabled = i.value.trim() !== 'RESET'; }); s.el.querySelector('[data-no]').onclick = s.close; b.onclick = async () => { s.close(); await G.clearKey(); await store.resetAll(); await flush(); applyTheme(); applyMotion(); toast('All data deleted'); navigate('#/today'); setTimeout(() => location.reload(), 600); }; } });
}
