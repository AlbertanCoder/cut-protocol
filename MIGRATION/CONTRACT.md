# MIGRATION CONTRACT

Binding for every phase of the light-migration, in every session. If anything in
this file conflicts with a phase prompt, **this file wins** — except where the
repo's own root `CLAUDE.md` is stricter, in which case the stricter rule wins.

Branch: `light-migration` · base commit `0269eeb` (`phase-0-base`) · fork tag
`pre-light-migration` @ `d47316b` on `saas-launch`.

---

## THE SIX HARD CONSTRAINTS (verbatim)

1. YOU MUST NOT delete any file, function, component, branch of logic, or test.
   Not "unused" ones, not "superseded" ones, not commented-out code. If something
   looks obsolete, append its path and one line of reasoning to
   `MIGRATION/DELETE-CANDIDATES.md` and move on.
2. YOU MUST NOT change any calorie, macro, protein, TDEE, BMR, target, or portion
   calculation, ever, in any phase.
3. YOU MUST NOT rename or reshape any persisted key, table, column, migration,
   storage key, or API payload.
4. YOU MUST NOT bump a persistence version number without writing the matching
   migrate function in the same commit.
5. YOU MUST NOT reference a file you have not read in this session. Before writing
   to a new path, run `ls` on its parent and paste the output.
6. YOU MUST NOT improve, reformat, reorganise, lint-sweep, upgrade, or modernise
   anything I did not explicitly ask for. No dependency bumps. No SDK upgrades. No
   renames. No "while I was in here".

---

## STACK (detected 2026-08-07, Phase 0, by reading files)

| Layer | What it is | Read from |
|---|---|---|
| Shell | Electron 43, packaged by electron-builder to a Windows NSIS installer | `package.json:6,27-28,86-100` |
| Frontend | React 19 + Vite 8 + Tailwind 4 + shadcn/ui + Recharts | `frontend/package.json:22-35` |
| Backend | Express 5 + Prisma 6 on SQLite, JWT auth | `backend/package.json:40-47` |
| Package manager | npm (three separate manifests: root, `frontend/`, `backend/`) | `package.json`, `frontend/package.json`, `backend/package.json` |
| State management | React local state only. **No Redux/Zustand/MobX/Context store.** Server state via `lib/api.js`; a few module-level caches (`FoodsTab.jsx:29-85`) | `frontend/src/App.jsx:39-140`, `frontend/src/lib/api.js` |
| Persistence (server) | Prisma + SQLite at `backend/prisma/dev.db` | `backend/package.json:12`, root `package.json:55-57` |
| Persistence (client) | `localStorage` only, via `frontend/src/lib/storage.js` + three inline keys — see "Storage keys" below | `frontend/src/lib/storage.js`, `PlanTab.jsx:412`, `SetupWizard.jsx:125` |
| Navigation | **No router library.** The "router" is the `tab` state machine in `App.jsx:43` + the `NAV` array in `Sidebar.jsx:10-25` | `frontend/src/App.jsx:43,417-438` |
| IAP / paywall | **No IAP.** Web checkout via Lemon Squeezy (`api.createCheckout`), gated by `PremiumGate.jsx`; server-side `requirePremium` is the real gate | `App.jsx:99-102`, `ui/PremiumGate.jsx:6-23` |
| Auth | Desktop: local email+password. Web: Supabase Google OAuth | `LoginScreen.jsx:111-169`, `lib/supabase.js` |
| Typecheck | **Does not exist.** 0 `.ts`/`.tsx` files, no `tsconfig.json` anywhere | verified `git ls-files '*.ts' '*.tsx'` → 0 |

**THIS IS AN ELECTRON DESKTOP APP, NOT A MOBILE APP.** Owner decision
2026-08-07. The runbook's mobile-only clauses are **void here** and must not be
cited as requirements: Dynamic Type / AX3, 44pt-iOS / 48dp-Android touch targets,
VoiceOver / TalkBack, App Store guidelines 5.1.1(x) / 1.4.1 / 5.2.1, IAP and
"restore purchases", upgrade-over-install on a device, and the mid-range-Android
out-of-memory image budget. Their **desktop equivalents still apply**: OS text
scaling and browser zoom, screen-reader operability without pointer gestures,
WCAG 2.1 AA contrast, and keyboard reachability for everything.

Standing rule 1 in the repo's root `CLAUDE.md` also applies: **desktop first** —
no phone-width centred columns, no bottom tab bars.

## COMMANDS (detected + actually run in Phase 0)

| Purpose | Command | Where found | Phase-0 result |
|---|---|---|---|
| build | `npm run build` in `frontend/` | `frontend/package.json:8` | **exit 0**, built in 3.88s |
| typecheck | *(none exists)* | — | **N/A — substitute `lint`** |
| test | `npm test` in `backend/` | `backend/package.json:18` | **exit 0**, 128 files, 1638 tests, 0 failures |
| lint | `npm run lint` in `frontend/` | `frontend/package.json:9` | **exit 0**, 12 warnings, 0 errors |
| run (desktop) | `npm start` at repo root (`electron .`) | `package.json:8` | interactive — not run headless |
| run (frontend dev) | `npm run dev` in `frontend/` | `frontend/package.json:7` | interactive |
| package installer | `npm run dist` at repo root | `package.json:12` | not run in Phase 0 |

Because there is no type layer, **`npm run lint` (oxlint) stands in for
`typecheck` at every phase gate.** It must exit 0. The 12 existing warnings are
pre-existing and are the baseline; the gate fails on any *error*, and on any
*increase* in warning count.

## STORAGE KEYS — frozen by constraint 3

Renaming or reshaping any of these breaks an existing user. Enumerated so a later
phase cannot claim it did not know.

| Key | Owner | Notes |
|---|---|---|
| `vite-ui-theme` | `App.jsx:452` via `theme-provider.jsx` | the one sanctioned theme write |
| `cutprotocol.plan.verdict` | `PlanTab.jsx:412` | solver verdict mirror |
| `cutprotocol.profile.provisional` | `SetupWizard.jsx:125` | estimate-path marker |
| everything in `lib/storage.js` | `sidebarPref`, `proteinPriorityPref`, `wellbeingScreenPref`, `microsExpandedPref` | `wellbeingScreenPref` is a mental-health screening result and **must never reach the backend** |
| pending bug reports | `lib/bugReport.js` (`savePending`/`loadPending`) | offline queue |

## PHASE GATE PROTOCOL

A phase is done only when **all seven** are true AND the evidence has been pasted
into the conversation:

1. build exits 0 (`npm run build` in `frontend/`);
2. lint exits 0 (`npm run lint` in `frontend/`) — the typecheck substitute;
3. `node scripts/parity-check.js` exits 0;
4. `node scripts/no-hardcoded-colours.js` exits 0 (from Phase 2 onward);
5. `git diff --stat` against the phase base lists **only** files in that phase's
   allowed list;
6. `git diff --diff-filter=D --name-only` is **empty**;
7. `MIGRATION/PROGRESS.md` is updated.

Then commit, print `PHASE N COMPLETE — AWAITING REVIEW`, and stop.

Additionally, because this repo carries the meal engine: **`npm test` in
`backend/` must stay at 1638 passing from Phase 1 onward.** A drop is a
constraint-2 violation until proven otherwise.

## BLOCKED PROTOCOL

Two failed attempts at the same thing, then stop. Write what was tried, what
happened, and what you need to `MIGRATION/BLOCKED.md`, print `BLOCKED — <one
line>`, and stop. Do not attempt a third variation.

## ⚠ THE HOOK TRAP — read before running a phase from the project directory

This repo's `.claude/settings.json` wires a **surgery harness**:
`.claude/hooks/guard-edit.js` refuses every write whose path is not on
`docs/surgery/CURRENT/manifest.json`'s `allow` list, and it **fails closed**.

That manifest (`run_id: campaign-p2-m0`) allows `.claude/`, `fleet/`,
`scripts/surgery/`, `docs/surgery/…` and `backend/scripts/qc/`. It does **not**
allow `MIGRATION/`, `scripts/` or `CLAUDE.md`.

Phase 0's writes all landed, which proves the hooks were **dormant** — this
session ran from `C:\Users\SHADHUNTER`, not from the project directory, so the
repo-level settings were never loaded.

**The moment a session is started FROM the project directory, guard-edit.js
activates and every write this migration needs is blocked.** Two ways through,
owner's choice:

1. Add `"MIGRATION/"`, `"scripts/"` and `"CLAUDE.md"` to the manifest's `allow`
   array (it is currently `"locked": false`, so it is editable) — but that is a
   change to the surgery harness and belongs to whoever owns that campaign.
2. Run migration phases from a directory where the repo settings do not load,
   accepting that `guard-bash.js` and `guard-migration.js` are then dormant too —
   which means the deletion guards this contract relies on are not actually
   running.

Option 2 is what Phase 0 did. It is not a safe default for phases that write
code. **Resolve this before Phase 3.**

## WHAT ELSE IS BINDING HERE

- The repo's root `CLAUDE.md` (619 lines) — standing rules, packaging allowlist
  lesson, the `dietaryFilter.js` NUL-byte trap, the superseded-claims table.
- `DO-NOT-TOUCH.md` (109 KB) — generated by the **2026-08-04 restyle audit**,
  baselined at tag `ui-restyle-baseline` = `ccd1372`. Its list is binding. Note it
  is a *different* "Phase 0" from this one; do not conflate the two numbering
  schemes.
- The safety-derived UX laws that survive any visual direction: never red on food
  or body data (over-target = calm amber); the macro triad stays
  colourblind-distinguishable and always carries P/C/F letter labels; the
  Wellbeing entry and its support resources are never hidden or greyed out;
  progress indicators never fabricate percentages; `prefers-reduced-motion` and
  the a11y utilities survive.
