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
- 2026-07-18 · **Phase 2 complete.** Food library audited + repaired: 969→854
  foods (115 case/plural/synonym duplicates merged with recipe-ingredient
  re-pointing), 192 bad rows fixed (zero-kcal USDA Foundation records
  recomputed via fiber-adjusted Atwater; ~90 wrong-record matches corrected
  through curated `backend/data/foodOverrides.json` with per-entry provenance
  notes — Water 19kcal→0, Salt carried butter data, Eggs carried egg-white
  data, Porridge oats/Walnuts/Sardines/Avocado carried OIL records, Milk
  carried powder data). All foods recategorized to the 7 grocery-store
  categories; every recipe's cached macros recomputed from ingredients (616
  recipes total across both passes). Guardrails: shared validator
  (`foodValidation.js` — fiber-adjusted Atwater ±15%, high-fiber 30% band,
  name-shape rules incl. pure-fat-under-non-oil-name, documented exemptions
  for alcohol/acetic acid/carbonates), startup `[data-audit]` log, validated
  admin-only PUT /foods/:id that recomputes affected recipe caches, hardened
  ingredientResolver/usdaClient/seeder, 22 new CI-safe tests (79 total pass).
  Foods UX: collapsed category groups + search + detail card (edit,
  add-to-recipe; "Log today" disabled until a food diary exists — no such
  feature yet, deliberately not faked). Audit exits clean: 0 failures,
  0 dupes, 0 recipe drift. Next: Phase 3 — profile + TDEE engine.
- 2026-07-18 · **Phase 3 complete** (commit d9bbbf1). Profile + TDEE engine
  fully generic — last personal hardcodes purged (constants.js deleted;
  verdict bands/floors derive from profile). New profile model:
  occupationKey (36-occupation searchable table + manual override),
  trainingStyle/minutesPerSession (additive MET-based kcal), rateLbPerWeek
  menu, stricter-only floorKcal over 1500M/1200F, excludedFormulas,
  unitPref wired app-wide. BMR = mean of applicable formulas (KM/Cunningham
  unlock with BF%, exclude toggles, spread); TDEE = BMR × occupation +
  training kcal/day. targetKcal DERIVED server-side (TDEE − rate×500,
  floor-clamped, re-materialized on profile/weigh-in changes); unsafe rates
  422 until explicit rateAcknowledged. 9 dietary styles, 10 allergy
  checkboxes (peanuts ≠ tree nuts), GET /recipes hard-filters with visible
  hiddenCount. 4-step wizard. Admin floor 2000 preserved as row data.
  Verified via verifyPhase3.mjs (3 fake users) + full browser walk; 94
  tests green. Next: Phase 4 — the meal-plan solver.
- 2026-07-18 · **Phase 4 complete.** Meal solver: 3+ scored complete-day
  candidates (honest match % — 0.55 kcal / 0.30 protein-shortfall / 0.075
  fat+carb range weights), best-of-3 scored week generation, portion scaling
  clamped to the spec's 0.5–2× with 5 g practical rounding, variety cap 2×/
  week (4× with batch-cooking opt-in), soft biases (8-cuisine classifier
  backfilled onto 608 imports, protein preference, CAD budget tiers) over
  hard filters (diet/allergies/max-prep), 3-alternate swap with
  server-rebuilt compliance-checked apply, accept-day → week plan → Today
  dashboard, grocery list with practical purchase units (packs/cans/pieces,
  grams as ground truth) + persisted checkboxes. Honesty layer:
  result-driven diagnosis (never silent, never suggests loosening
  allergies) whenever a week lands <6/7 days or candidates are rough.
  **Safety find:** live verification caught fish/meat reaching a vegan
  account — dietaryFilter's style matching was exact-word (plural species
  names like "Prawns"/"Sardines"/"Pilchards" passed) and the species list
  was thin. Fixed: plural-aware matching + exhaustive 854-name food-table
  audit closing every gap (cheese varieties, barramundi, dulce de leche,
  curry pastes, etc.), locked by regression tests. Real-pool verification:
  1–15 ms week solves, 7/7 days for omnivore/keto/halal, diagnosed
  closest-fit for the genuinely thin vegan (51 recipes) and vegetarian
  pools, zero leaks across ~1,000 shipped ingredients. 110 tests green.
  Known cosmetic quirk: grocery SECTION classifier files "Butter Beans"
  under Dairy (name-keyword artifact; Phase 7 polish). Next: Phase 5 —
  recipes, cart, importer.
- 2026-07-18 · **Phase 5 complete.** Recipe library rebuilt as grouped
  browse — cuisine / meal-type / primary-protein groups (display taxonomy
  from ingredient keywords), search, sort by name / kcal / protein density
  (g P per 100 kcal shown per row) — no more endless scroll. Expandable
  detail view: ×0.5–×2 serving scale with live macros+grams, add-to-plan-
  slot picker (new POST /plans/place-recipe — server re-validates pool
  membership, 409s locked slots, clamps scale 0.5–2), cart toggle, inline
  edit, confirmed delete. Cart card: macro totals, one-click grocery list,
  and POST /plans/fill-today-from-cart (scales each cart recipe to today's
  slot targets via scaleRecipe, skips locked slots, honest skipped/leftover
  note). AI generation kept but hardened: every draft passes the Phase 2
  food validator before save (422 names offenders incl. zero-macro
  placeholders), cuisine auto-classified, source tagged — AI (green) /
  IMPORTED (blue) badges; allergen override rebuilt as a loud red
  per-generation checkbox that auto-resets after every generation. New URL
  importer (`backend/src/lib/recipeImporter.js`): fetch → schema.org/Recipe
  JSON-LD (@graph walk, HowToStep, ISO-8601 durations) → ingredient-line
  parser (unicode fractions, ranges→midpoint, weight units exact, volume
  via density table with `estimated` flags, piece weights, honest null when
  unconvertible) → resolveIngredient match to the validated food DB →
  per-serving grams → review DraftCard (amber importNotes, editable grams,
  red placeholder warnings) → validated save tagged `imported`. Provider
  seam (`PROVIDERS` array) structured for Spoonacular/Edamam later; NO paid
  API integrated; USDA stays nutrition truth. Verified live in Chrome on
  the vegan test account: real BudgetBytes import end-to-end (404 error
  path also exercised honestly), density sort, ×2 placement confirmed in
  Plan tab (fill-from-cart later re-scaled that unlocked slot, as
  designed), cart fill-today, loud allergen box, 578 recipes hidden
  honestly, protein grouping (Plant protein 19 / Other 33 — meat groups
  correctly absent for vegan). 119 backend tests green (9 new importer),
  oxlint + vite build clean. Known cosmetics: cuisine classifier misses
  "Curried" (keys on "curry"; row editable), unit-after-name piece lines
  ("2 garlic cloves", "2 15 oz. cans") fall to honest set-manually notes
  rather than guessed grams. Browser-automation lesson: setting a React
  input via scripted DOM setter leaves component state stale — the UI looks
  cleared but filters don't reset; always drive React inputs with real key
  events. Next: Phase 6 — app icon.
- 2026-07-18 · **Phase 6 complete.** New brand mark: shield badge with a
  geometric six-pack grid (2×3 rounded blocks, bottom row tapered into the
  shield's point), athletic green #2FD576 on charcoal #131715 — both theme
  tokens. Two SVG masters in `assets/icon/`: `cutprotocol-outline.svg`
  (green outline shield + green blocks, used ≥48px) and
  `cutprotocol-solid.svg` (inverted: solid green shield, dark carved
  blocks, wider gaps sized so every separation ≥1px at 16px — used ≤32px).
  All four spec sizes rendered and approved by Shad before applying
  (16px taskbar legibility confirmed on dark AND light taskbar sims).
  Applied: `CutProtocol.ico` regenerated (256/64/48 outline + 32/24/16
  solid; directory entries parse-verified) — filename unchanged so
  electron/main.cjs and build.win.icon needed no edits; PNG set in
  `assets/icon/png/`; `frontend/public/favicon.svg` (link in index.html
  was dangling scaffold — now real); index.html title "cut-protocol" →
  "Cut Protocol"; new `ui/CutMark.jsx` (bare solid shield on theme tokens)
  replaces the TrendingDown-in-green-tile mark in Sidebar, LoginScreen,
  and SetupWizard; README gets the icon + a branding section. Verified:
  oxlint + vite build clean, Electron dev boot clean, `npm run dist` exit
  0, and the icon EXTRACTED from both the built `Cut Protocol.exe` and the
  NSIS installer visually confirmed as the new shield (ExtractAssociatedIcon
  → PNG → eyeball). Sidebar mark zoom-checked crisp in Chrome. Icon build
  tooling (sharp + png-to-ico) lives in the session scratchpad, NOT the
  repo — rebuilding the .ico needs those two packages against the SVG
  masters. Next: Phase 7 — polish/QA.
- 2026-07-18 · **Phase 7 complete.** Professional-polish sweep. CONSISTENCY: terminology
  unified on "meal plan" (PlanTab buttons/copy), dead light-mode theme
  script removed from index.html (`.dark` class had no consumers), zero
  hardcoded hexes confirmed outside theme tokens, login's narrow card is
  intentional. EMPTY STATES: shared `EmptyNote` component; Today + Trend
  charts get a "First point logged — curve starts with your second
  weigh-in" state instead of a floating single dot (0-entry states
  already existed). ERROR STATES: shared `ErrorNote` panel (icon + what
  happened + what to DO); applied to PlanTab (top + slot), ProfileTab,
  FoodsTab (names the Atwater rule), RecipesTab (import hint);
  solver slot warnings now carry "→ Fix it with the swap button…" action
  line; App-level refresh banner copy explains recovery. DATA FIXES:
  grocery store-section classifier — fresh peppers (bell/jalapeño/…) now
  produce not spices, dairy words with plant/legume qualifiers (Butter
  Beans, Peanut Butter, Almond Milk) now veto dairy, "buttermilk" added
  as real dairy (was silently "other"); cuisine classifier learned
  "curried"; 18 legacy occasion-tag cuisines (weeknight/steakhouse/
  breakfast/weekend) reclassified through the real classifier; the
  imported Curried Chickpeas re-tagged indian. Tests updated: the two
  "known limitation" tests now assert the fixes (120 green). QA SCRIPT:
  fresh user qa7.test@local ran the whole journey in Chrome — wizard
  (4 steps, lb/in, carpenter ×1.45) → Engine math verified (BMR 2,050 avg
  of 4, TDEE 3,134, target 2,384 floor-clamped) → generate meal plan
  (instant; day 2,396 vs 2,384) → swap flagged slot via 3 alternates
  (warning cleared, server rebuilt) → grocery list (Bell peppers under
  PRODUCE proves fix live) → weigh-in via UI + 7 backdated fixture points
  via API → Trend (curve, rate 2.4 lb/wk, goal date Oct 4 2026, target
  re-derived 2,384→2,399 from moving average). SPEED: tab switches
  render sub-second, week solve ms-level, no fixes needed (CDP screenshot
  stalls are the automation harness, not the app). README: rewritten
  feature list (fixed wrong "median" claim — engine takes the MEAN),
  accurate importer/solver/derived-target descriptions, 5 fresh
  screenshots from the QA account. Known punch list → next session:
  Vite chunk >500 kB (code-split someday; local desktop app so cosmetic),
  protein/mealtype group taxonomy is display-keyword based (fine), no
  food diary yet (Today shows planned, honestly labeled), Est. total on
  grocery hides when coverage low (by design). Next: Phase 8 (optional
  training scaffold) or backlog.

## Archive

The full RECOMP Master Build Prompt v2.0 — including the user-#1 calibration
fixture, which contains personal data — is preserved locally in
`CLAUDE_RECOMP_ARCHIVE.md` (gitignored on purpose; personal data stays out
of the repo even though it is private). `AUDIT.md` and `PABLO_REVIEW.md`
are likewise local-only.
