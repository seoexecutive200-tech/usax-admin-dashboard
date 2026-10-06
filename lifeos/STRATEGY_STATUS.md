# LifeOS — Competitive gaps: what is built

Source: “Competitive Gaps & Product Strategy” (80 items). Status as of LifeOS 2.9.0 — stated plainly, including what is missing.

| Status | Items |
|---|---|
| Built in 2.9.0 | 14 |
| Already in LifeOS | 18 |
| Partly | 30 |
| Not built yet | 18 |

## All items

| # | Item | Priority | Status | Notes |
|---|---|---|---|---|
| 1 | Too much data, too little interpretation | P0 | Partly | Today’s “Right now” card and the weekly story rank what matters; no single ranked ‘what changed’ view yet. |
| 2 | Beginner explanations get in the way | P1 | Not built yet |  |
| 3 | Charts hide exact numbers | P0 | Partly | Links in Insights open to exact day-by-day values; other charts don’t yet. |
| 4 | Re-confirming the same activity | P0 | Not built yet |  |
| 5 | Correlation tools hidden | P0 | Built in 2.9.0 | Insights → “Possible links in your data”, plus the existing “Ask your own questions”. |
| 6 | Opaque scores | P0 | Partly | Links and check-in calculations show confidence and how they were worked out; older capacity scores flag estimated inputs. |
| 7 | Paying to access your own data | P1 | Already in LifeOS | Core tracking is free and local; your own AI key is optional. |
| 8 | Hardware dependency | P1 | Already in LifeOS | Nothing requires a device. |
| 9 | Re-entering data a phone knows | P0 | Not built yet | No Apple Health / Health Connect yet. |
| 10 | Manual tracking is exhausting | P0 | Partly | Adaptive check-ins ask less as answers repeat; no auto-logging yet. |
| 11 | Fields never used | P0 | Partly | Check-in fields all feed a write, calculation or decision; older trackers are user-defined. |
| 12 | Sample size hidden | P0 | Built in 2.9.0 | Every link shows ‘observed N days’; patterns need 5+ observations. |
| 13 | Cross-variable analysis | P0 | Partly | One scan across sleep, energy, mood, stress, focus, water, movement, caffeine, screen, steps, outdoor time and schedule load. Food and money are not included. |
| 14 | Users export to other AI tools | P0 | Already in LifeOS | Statistics are computed locally; the AI only explains. |
| 15 | Manual testing of pairs | P1 | Built in 2.9.0 | The scan tests same-day and next-day pairs and shows the top few. |
| 16 | Dense home screen | P0 | Partly | Today is customizable and leads with one question; not yet cut to three questions. |
| 17 | Source conflicts and correction | P0 | Partly | Check-in answers have provenance and can be edited or deleted; no imported sources yet. |
| 18 | No attention ranking | P0 | Partly | One check-in at a time, ranked, with silence as an outcome. |
| 19 | Gamification | P1 | Already in LifeOS | No coins, XP or collectibles. |
| 20 | Animations create friction | P0 | Already in LifeOS | Nothing blocks the next action. |
| 21 | Adaptive check-ins | P0 | Already in LifeOS | Shipped in 2.8.0 (100-item library). |
| 22 | Streak guilt | P0 | Built in 2.9.0 | Tracker pages show ‘logged X of the last 14 days’ instead of a streak. (Streak-type rules you write yourself still exist.) |
| 23 | Reminder reliability | P0 | Partly | Background push + external clock + a reminder history (this device). No visible retry or per-device delivery receipts. |
| 24 | Updates change workflows | P1 | Partly | Updates always ask first and show what changed; no per-feature opt-in. |
| 25 | Why this moved + undo | P0 | Built in 2.9.0 | “What LifeOS changed” in You: what, why, evidence, Undo. Covers AI actions and suggestions you approve (day plan, check-in actions). |
| 26 | Calendar flooding | P0 | Already in LifeOS | Google Calendar is read-only; LifeOS writes only to its own calendar, and only when you approve. |
| 27 | Fixing automation takes more time | P0 | Partly | Undo rate is measured and shown; it doesn’t yet reduce automation by itself. |
| 28 | AI hype over reliability | P0 | Partly | Core saving, reminders, undo and export come first; ongoing. |
| 29 | Missing basic reminders | P0 | Partly | Reminders, quiet hours, snooze and focus-aware holding exist; escalation for critical events is limited. |
| 30 | Exact-time commitments | P0 | Built in 2.9.0 | Events have Fixed / Preferred / Flexible; the AI can’t move a Fixed one. Tasks default to Flexible (no editor control yet). |
| 31 | Can’t override AI scheduling | P0 | Partly | The AI only moves things you approve; no drag-to-reschedule. |
| 32 | Recurring items break when one is moved | P0 | Partly | Google repeating events handle single-instance changes; LifeOS has no repeating tasks yet. |
| 33 | LLM gets dates wrong | P0 | Already in LifeOS | Dates are parsed and validated in code. |
| 34 | AI can’t create all objects | P0 | Already in LifeOS | Controlled actions for events, tasks, logs, goals, memories, with confirmation. |
| 35 | Mobile is second-class | P0 | Already in LifeOS | Built phone-first. |
| 36 | Widgets | P2 | Not built yet |  |
| 37 | Export lock-in | P0 | Built in 2.9.0 | JSON backup, calendar (.ics), spreadsheets (.csv), memories and rules. |
| 38 | Task graveyards | P1 | Built in 2.9.0 | Tidy up: duplicates, tasks that keep slipping, stale goals. |
| 39 | Everything equally important | P0 | Partly | Importance and flexibility are separate; obligation and context aren’t modelled. |
| 40 | Recurring completions as history | P0 | Not built yet |  |
| 41 | Duplicate calendar systems | P0 | Already in LifeOS | One timeline that keeps each item’s source and read-only status. |
| 42 | Too much tagging | P1 | Already in LifeOS | Capture routes automatically; categories stay in the background. |
| 43 | Stale financial sync | P0 | Not built yet | No financial account sync. |
| 44 | Wrong categorization | P1 | Not built yet |  |
| 45 | Assumed recurring finances | P1 | Not built yet |  |
| 46 | Hidden rules | P0 | Partly | Memories, rules and the audit trail are all inspectable, in separate places. |
| 47 | Weak mobile reporting | P0 | Already in LifeOS |  |
| 48 | Spreadsheet-style obligations | P1 | Not built yet |  |
| 49 | Custom history questions | P1 | Partly | “Ask your own questions” covers logged metrics, not transactions. |
| 50 | Complexity creep | P0 | Partly | Blank-canvas mode and essentials-only day exist; no step-count guard. |
| 51 | Silence as an outcome | P0 | Partly | Check-in decisions include stay silent / acknowledge / one suggestion / one follow-up / propose / safety; the idle card now says nothing needs attention. |
| 52 | Provenance on recommendations | P0 | Partly | Check-ins, links and audit entries show their basis; older advice cards don’t all do. |
| 53 | Never turn guesses into facts | P0 | Partly | Check-ins store unknown as unknown. The older sleep chips still save a bucket midpoint (only when adaptive check-ins are off). |
| 54 | One confidence system | P0 | Partly | Used for links; the older patterns and reports have their own labels. |
| 55 | Lagged relationships | P1 | Built in 2.9.0 | Next-day links are scanned. |
| 56 | Intervention effectiveness | P1 | Partly | Check-ins collect before/after answers; analysis isn’t built. |
| 57 | Learn from event outcomes | P1 | Partly | Debrief answers are collected (opt-in); not yet used in advice. |
| 58 | Calibrate predictions | P2 | Not built yet |  |
| 59 | Adaptive baselines | P1 | Partly | Baseline start date and temporary contexts; no automatic shift detection. |
| 60 | Life states | P1 | Partly | “Today isn’t normal” sets a temporary context. |
| 61 | Plan around capacity | P1 | Partly | Day planner uses your energy; check-ins ask for capacity. |
| 62 | Invisible event cost | P1 | Not built yet |  |
| 63 | Protect recovery | P1 | Not built yet |  |
| 64 | Friction instead of nagging | P1 | Built in 2.9.0 | 3+ reschedules asks what’s in the way; Tidy up offers cleanup. |
| 65 | Minimum viable day | P1 | Already in LifeOS | Essentials-only day. |
| 66 | Returning after abandonment | P0 | Built in 2.9.0 | After 5+ days away: one welcome card, one tap to set overdue tasks aside as Someday, one present-focused question. |
| 67 | Goals decay gracefully | P1 | Built in 2.9.0 | Keep / Pause / Redesign / Archive for untouched goals. |
| 68 | Priorities constrain advice | P1 | Not built yet | Priorities are stored; the advisor doesn’t yet enforce them. |
| 69 | Life trade-offs | P1 | Not built yet |  |
| 70 | Decision memory | P1 | Not built yet |  |
| 71 | Finance as life consequences | P1 | Not built yet |  |
| 72 | Finance and stress | P1 | Not built yet |  |
| 73 | Personal experiments | P2 | Already in LifeOS | Experiments exist in Insights. |
| 74 | Inspectable memory | P0 | Already in LifeOS | Correct / Wrong / Forget / Private. |
| 75 | Automation permissions | P1 | Not built yet |  |
| 76 | Audit trail | P0 | Built in 2.9.0 | See #25. |
| 77 | Reversible AI actions | P0 | Built in 2.9.0 | Creations can always be undone; other changes until the app closes. |
| 78 | Universal capture | P0 | Already in LifeOS |  |
| 79 | Contextual questions | P0 | Already in LifeOS | Adaptive check-ins. |
| 80 | Question value scoring | P0 | Partly | Selection is rule-based on freshness, decisions and budget; no explicit value score. |

## What 2.9.0 added

- **What LifeOS changed** (You): why, evidence, Undo, and how often you undo.
- **Fixed / Preferred / Flexible** on events; the AI never moves a Fixed one.
- **Possible links in your data** (Insights): same-day and next-day scan with N, direction, confidence and its reasons, exceptions, and the exact days.
- **One confidence system** for links.
- **Tidy up**: duplicates, slipping tasks, stale goals (Keep / Pause / Redesign / Archive), each undoable.
- **Welcome back**: no catch-up wall after time away.
- **Rolling consistency** instead of streaks on tracker pages.
- **Reminder history** (this device) and more exports: calendar (.ics), spreadsheets (.csv), memories and rules.
