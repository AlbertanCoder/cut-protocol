# Cut Protocol — Project Rules

Desktop cutting/body-recomp app: TDEE engine, meal-plan solver, tracking.
Owner: Shad. This file is the standing ruleset for every session and every
phase of the staged overhaul (Phases 0–8, driven by an external prompt pack).

## Stack (verified 2026-07-18, Phase 0)

- **Shell:** Electron 43 (`electron/main.cjs`), packaged by electron-builder
  into a Windows NSIS installer under `release/`. App icon: `CutProtocol.ico`
  at repo root, wired in root `package.json > build.win.icon`.
- **Backend:** Express 5 + Prisma 6 on SQLite (`backend/prisma/dev.db`).
  JWT auth. Anthropic SDK for AI recipe generation, USDA FDC client for
  nutrition lookups. Business logic in `backend/src/lib/` (bmrEngine,
  weeklyPlanner solver, dietaryFilter, groceryList, …), routes in
  `backend/src/routes/`.
- **Frontend:** React 19 + Vite 8 + Tailwind 4 + Recharts in `frontend/`.
  Screens in `frontend/src/components/`. Single theme file:
  `frontend/src/lib/theme.js`.
- **Food/recipe seed data:** `backend/src/lib/portedFromRecomp/`
  (foodLibrary / recipeLibrary / fdcMacroCache) seeded into SQLite via
  `backend/scripts/`. Runtime data lives in the DB, not in code.
- **Commands:** backend dev `npm run dev` (in `backend/`) · frontend dev
  `npm run dev` (in `frontend/`) · desktop shell `npm start` (root) ·
  package installer `npm run dist` (root) · tests `npm test` (in `backend/`)
  · lint `npm run lint` (in `frontend/`).
- **CI:** GitHub Actions runs backend tests + frontend lint/build on push.
- **Packaging caveat:** the current electron-builder config deliberately
  ships the real `backend/.env` (API keys, JWT secret) and real `dev.db`
  inside the installer — acceptable for a personal single-machine build,
  MUST be reverted before the app is ever distributed to anyone else.

## Standing rules (every phase, every session)

1. **Desktop first.** This is a DESKTOP app. Every screen is designed for a
   full desktop window first. No phone-width centered columns, no bottom
   tab bars.
2. **One design system.** Dark, athletic, bold: dark charcoal background,
   ONE strong accent color (athletic green family), oversized confident
   stat numbers, high contrast, generous spacing. All color/spacing/type
   tokens live in the single theme file; every screen consumes tokens.
   No one-off styles.
3. **Nothing user-specific hardcoded.** No hardcoded calories, allergies,
   names, weights, or personal defaults anywhere in app code. Everything
   flows from the user's Profile. The app must work for ANY user from first
   launch onward. (The user-#1 calibration fixture in tests is the one
   sanctioned exception — it is test data, never an app default.)
4. **Verify, then commit.** After every meaningful change: actually run the
   app and confirm the change works before moving on. At the end of every
   phase: commit with a clear message and push to GitHub (`origin master`).
5. **Nutrition sanity gate.** Every food/recipe entry must satisfy
   kcal ≈ 4×protein + 4×carbs + 9×fat within ~15%, or carry a documented
   exception. Water, black coffee, plain spices ≈ 0 kcal. Anything failing
   is flagged, never silently accepted.
6. **Parallel subagents welcome, never colliding.** Independent workstreams
   (e.g. one on UI, one on data) may run as parallel subagents — but never
   two agents editing the same files at once.

## Constitution (retained from the RECOMP master doc — still binding)

- Wrong math = product death. Displayed numbers can reveal their formula and
  inputs; engines are unit-tested before ship.
- Provenance on every food entry: USDA-VERIFIED (+FDC id) | LABEL |
  AI-ESTIMATED (always verify-prompted). Sources never silently mixed.
- Hard floors: never prescribe below max(RMR×0.95, 1500 kcal men / 1200
  women); user floors may be stricter. Floor blocks are shown, not hidden.
- Every automatic adjustment is logged, visible, and reversible.
- Data is never trapped: JSON+CSV export must always work.
- Solver declares "unsolvable + why" — silent target misses are forbidden.
- No engagement bait: no streak-shaming, no notification spam. Instrument,
  not slot machine.
- The user's observed data beats the model's prediction.

## Comms style

Blunt, data-first, no filler. Tables for numbers. Show the math when
challenged. Never suggest intake below the safety floor.

## Overhaul phase tracker (append-only; newest last)

- 2026-07-18 · **Phase 0 complete.** Checkpoint commit + `backup/pre-overhaul`
  branch + `pre-overhaul` tag pushed to GitHub; repo flipped PRIVATE;
  `.claude/settings.json` permission config added; this rules file rewritten
  (old RECOMP master archived). Next: Phase 1 — desktop layout + dark theme.
- 2026-07-18 · **Phase 1 complete.** Dark-only athletic theme (tokens in
  `frontend/src/index.css`, accent #2FD576, CVD-validated macro trio; light
  mode retired). Collapsible left sidebar replaces bottom tab bar; nav order
  Profile/Today/Plan/Recipes/Trend/Engine; Foods demoted to child view of
  Recipes/Engine. New ProfileTab (inputs moved out of Engine) + 3-step
  first-run SetupWizard (fires when GET /profile is null). Today rebuilt as
  12-col dashboard (ring + macros + verdict + weigh-in + trend snapshot +
  log). All screens converted to desktop grids. Verified in Chrome at
  1568px: full tab walk on live account (read-only), complete wizard→
  dashboard→weigh-in flow on a throwaway account (`phase1.test@local`, kept
  in dev.db for future phase testing), zero console errors, oxlint + vite
  build clean. Sub-1280px stacking is Tailwind mobile-first default —
  re-verify visually in Phase 7 QA. Next: Phase 2 — food & recipe data
  integrity.

## Archive

The full RECOMP Master Build Prompt v2.0 — including the user-#1 calibration
fixture, which contains personal data — is preserved locally in
`CLAUDE_RECOMP_ARCHIVE.md` (gitignored on purpose; personal data stays out
of the repo even though it is private). `AUDIT.md` and `PABLO_REVIEW.md`
are likewise local-only.
