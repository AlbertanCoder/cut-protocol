# Overnight Fleet — 2026-07-23

Ten agents dispatched against **The One Battle Plan**, Waves 0–7.
Orchestrated on branch `qc/overnight-2026-07-23`. Shad asleep; no approvals requested.

This file is the morning briefing. It is written as work lands, not predicted in advance.

---

## Wave 0 — Preserve & Unblock

| Step | Status | Note |
|---|---|---|
| 0a. Push the branch | **ALREADY DONE** | `origin/qc/overnight-2026-07-23` was already at `c2015b8`, identical to local HEAD. The battle plan's "45 commits exist nowhere but your hard drive" was measuring against `origin/master` — the branch itself was pushed. Nothing was at risk. |
| 0b-1. Step cap ±125 kcal | dispatched | Owner-approved; Agent 9 implementing in `adaptiveTarget.js`. |
| 0b-2. Nullable `mayContain` column | dispatched | Owner-approved; Agent 4 implementing alongside `fdcCategory`. |
| 0b-3. ±7%-by-week-6 precheck | deferred | Gated on the step cap landing (Wave 4 / Phase 1B). |
| 0c. Merge toward master | **not done, deliberately** | Battle plan says not before Wave 1 is green. Holding. |

### Unplanned finding, closed immediately — public-repo data exposure

`backend/prisma/dev.db.snapshot-agentcontam-20260721-212858` (3.2 MB) sat **untracked but
un-ignored**. `.gitignore` covered `dev.db`, `dev.db.backup-*` and `*.db`; a `.db.snapshot-*`
suffix matches none of them. This repo went **public** in Phase 9, and that snapshot holds the
same personal health records as `dev.db`. One `git add -A` publishes it.

Same hazard for `cut-protocol-sync.bundle` and `fleet-sync-2.bundle` (740 KB of full history).

Fixed in `65303d3` — ignore rules added for `*.db.snapshot-*` and `*.bundle`. Verified: both now
invisible to `git status`.

---

## Fleet assignments

Ten agents, strict file ownership, no two agents inside the same file. (CLAUDE.md standing rule 6:
*"Parallel subagents welcome, never colliding."*) Cross-agent requests go to
`docs/qc/handoff/agent NN.md` rather than out-of-scope edits.

| # | Wave | Findings | Owns |
|---|---|---|---|
| 1 | 1 | tests-quality-1, tests-quality-3 | `backend/package.json`, `scripts/runTests.mjs`, `tests/golden/**`, CI |
| 2 | 1 | schema-model-1 (P0) | `desktopBootstrap.js`, migration-runner tests |
| 3 | 2 | food-data-1 (P0) | `ingredientResolver.js` |
| 4 | 2 | dietary-safety-2 / -4 / -5 (P0/P1) | `schema.prisma`, `dietaryFilter.js`, `offImport.js`, allergy sweep |
| 5 | 3 | onboarding-flow-1 (P0) | `routes/auth.js`, `lib/auth.js`, `LoginScreen.jsx` |
| 6 | 3 | competitor-gap-1 (P0), resilience-2, onboarding-3/-5 | `electron/**`, root `package.json`, `server.js`, `SetupWizard.jsx`, `TodayTab.jsx` |
| 7 | — | frontend-arch-1 (P0), -3, -4 | `frontend/src/lib/api.js`, `ProfileTab.jsx`, + 8 components |
| 8 | 5 | solver-core-1/-2/-3, ux-screens-2 | `mealSolver.js`, `weeklyPlanner.js`, `PlanTab.jsx` |
| 9 | 6 | adaptive-tdee-1/-2, onboarding-flow-4, step cap | `adaptiveTarget.js`, `profileTarget.js`, `expenditureEstimator.js` |
| 10 | 7 | brain-stack-1 (P0) | `routes/recipes.js`, `lib/brain/**`, `aiRecipeClient.js` |

**Not attempted tonight:** Wave 4 (gauntlet re-run — pointless until 1–3 land), Wave 8 (food
diary / Living App C–G — the biggest lift, wants a green foundation), Wave 9 (audit fleet).

### Standing constraints given to every agent

- No writing git commands. The orchestrator commits; ten agents committing into one working tree
  cross-contaminate each other's half-finished files.
- No full-suite runs — ten concurrent `npm test` invocations thrash the shared SQLite `dev.db`.
  Own test files only; DB work against scratchpad copies.
- No live LLM calls (Agent 10 especially) — mocks only, no burning credit overnight.
- Never fabricate a result. Real output or the word UNVERIFIED.

---

## Results

_Filled in as agents report._
