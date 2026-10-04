# LifeOS V1

Mobile-first, local-first PWA: HTML + CSS + vanilla JS modules, IndexedDB, optional Groq AI. No backend, no build step.

## Run
```bash
cd lifeos
python3 -m http.server 8080      # or any static host
# open http://localhost:8080  (service worker needs http://localhost or https)
```
First launch: welcome → optional Groq key (Session only / Remember on this device / Skip) → empty or demo data.

## Layout
`index.html`, `styles.css`, `app.js`, `manifest.json`, `service-worker.js`, `js/` (db, store, router, analytics, groq, prompts, schemas, ai-context, advisor, capture-parser, calendar, reports, memory, actions, export-import, ui, sheets, seed) and `js/screens/` (today, plan, capture, insights, you, readiness, onboarding).

## Security note (intentional V1 trade-off)
The Groq key is never shipped, logged or exported. "Remember" stores it in localStorage (outside IndexedDB, so exports never include it); "Session only" keeps it in memory. Code running in the same browser profile could read a remembered key — personal prototype use only.

## Acceptance checklist
| Criterion | Status |
|---|---|
| Installable PWA, static, no backend | manifest + service worker + icons |
| Onboarding: key, Skip AI, Remember/Session | `screens/onboarding.js` |
| Replace/test/clear key under You → AI & API | `screens/you.js` |
| Offline tracking, persistence | IndexedDB; verified offline reload |
| Capture parses event, mood/stress, water, workout, expense, sleep | `capture-parser.js` (local first; AI fallback) |
| All six screens | today, plan, capture, insights, you, readiness |
| Reduced motion, fluid UI | `styles.css`, Settings override |
| Add/edit/complete/reschedule/delete events & tasks | `sheets.js`, `plan.js` |
| .ics export | `calendar.js` |
| Daily/weekly reports, cached | `reports.js` |
| Silent decision + attention budget | `advisor.js` |
| Memory inspector controls | You → AI Memory |
| Prep suggestions + outcome check-ins | `readiness.js` |
| JSON export/import | `export-import.js` |
| No key/private context in logs/exports | no console logging; exports scrubbed |
| No diagnosis/causal/guilt copy | prompts + local copy; health triage |
| 320px, ~44px targets | verified at 320px |

Not verified here: live Groq calls (no network key in the build environment) and Safari/iOS devices.
