# LifeOS

Mobile-first, local-first PWA: HTML + CSS + vanilla JS modules, IndexedDB, optional Groq AI. No build step.

## Layout
| Path | What |
|---|---|
| `/` (`index.html`, `js/`, …) | **LifeOS 1** — the original app, frozen except for the update notifier. Also preserved on branch `lifeos-v1-stable`. |
| `/v2/` | **LifeOS 2** — user-defined trackers, rules, ask-your-data, hosted AI, consent-based updates. Own database and cloud copy. |
| `/api/` | `auth` (accounts), `data` (per-user sync; `?v=2` for LifeOS 2's separate copy), `ai` (hosted AI proxy). |
| `/releases.json` | The release manifest v1 reads to offer the update. |

## Run
```bash
cd lifeos
python3 -m http.server 8080          # static only: local-only mode, no accounts
npm install && npm run dev           # with the API (accounts, sync, hosted AI) on :8124, data in ./.devdata
```

## How updating works
* **v1 → v2:** v1 checks `releases.json`; if newer it shows an *Update available* card with the feature list. On **Update now** it saves the user's data, opens `/v2/`, and v2 **copies** the data from v1's database (or the user's v1 cloud copy on a new device). v1's data is only ever read. **Switch back to LifeOS 1** is in You → Version.
* **v2 → v2.x:** the service worker installs a new version quietly and *waits*. The app shows the card with release notes; only **Update now** swaps it in (data saved first).
* To ship a v2 update: change files, bump `VERSION` in `v2/service-worker.js` and `APP_VERSION` in `v2/js/util.js`, edit `v2/js/whatsnew.js`, then `node tools/gen-shell.js && node tools/sync-notes.js` and set the new `version` in `releases.json`.

## Server configuration (Vercel environment variables)
| Variable | Needed for |
|---|---|
| `SESSION_SECRET` | accounts (long random string) |
| Blob store connected to the project (`BLOB_STORE_ID` or `BLOB_READ_WRITE_TOKEN`) | storing accounts and synced data |
| `GROQ_API_KEY` | **hosted AI** (optional). Without it, users bring their own key. |
| `HOSTED_DAILY_LIMIT` (default 60), `HOSTED_MODELS` | hosted AI limits |

## Security notes
The Groq key is never shipped, logged or exported. A user's own key stays in their browser; hosted AI keeps the key on the server and enforces a per-user daily limit. Data on the server is not end-to-end encrypted.

## Test helpers
`tools/dev-server.js` (static + API, with `/__bump?v=` to simulate a release), `tools/mock-groq.js` (fake AI backend). `tools/gen-shell.js` regenerates v2's offline file list.

## Background reminders (LifeOS 2.1)

Reminders reach the phone even when the app is closed, using Web Push. The app uploads the next ~3 days of reminder times
(routine nudges and tracker reminders; plain text only) to `/api/push`, and a scheduler calls `/api/push-tick` every few minutes
to send whatever is due.

Server setup (Vercel → Project → Settings → Environment Variables), then redeploy:

| Variable | Value |
|---|---|
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys` |
| `VAPID_SUBJECT` | `mailto:you@example.com` |
| `PUSH_CRON_SECRET` | any random string of 16+ characters |

Scheduler (pick one): the GitHub Action in `.github/workflows/lifeos-push-tick.yml` (needs `PUSH_CRON_SECRET` secret and
`LIFEOS_URL` variable; GitHub runs schedules from the default branch only), cron-job.org hitting
`GET https://<site>/api/push-tick` with header `Authorization: Bearer <PUSH_CRON_SECRET>` every 5 minutes, or Vercel Cron on a Pro plan.

Users turn it on in **You → Background reminders**. iPhone/iPad need the app added to the Home Screen first (iOS 16.4+).
