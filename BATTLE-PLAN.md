# Cut Protocol — Battle Plan

From the 20-agent audit, 2026-07-24. Supersedes `TODO.md` (which is stale — several
unticked items are already done, and Tier 1's header contradicts its own boxes).

**The pattern:** nine findings are the same failure — built correctly, never wired up.
Most of this plan is wiring, not building. That's why it's cheaper than the list looks.

**Honest total: ~45–60 hours.** Phases 0–2 are ~14 hours and buy most of the value.

Rule for every item: one change, verify it live, commit. Never stack two untested changes.

---

## Phase 0 — Containment (today, ~1 hour)

The build sitting in `release/` right now leaks your credentials and health data.

- [ ] **Do not distribute the current `.exe`.** Verified contents: `backend/.env.qc` inside
      `app.asar` (JWT_SECRET 66 chars, USDA_API_KEY 40 chars, SEED_EMAIL = your real
      address, SEED_PASSWORD 8 chars cleartext) and `dev.db.snapshot-agentcontam-20260721-212858`
      as a loose readable file — 10 users, 8 profiles, 62 weigh-ins, 39 meal logs.
- [ ] **Rotate three credentials.** `JWT_SECRET`, the USDA key, and that seed password.
      Treat all three as burned. Git history is clean — the leak is only in the artifact.
- [ ] **Switch `build.files` to an allowlist** for env and DB files. The current denylist
      names `.env` and `dev.db` exactly; `.env.qc` and `dev.db.snapshot-*` walked straight past it.
      `package.json:40-45`.
      ```
      "!backend/**/*.env*", "!backend/prisma/*.db*",
      "backend/prisma/schema.prisma", "backend/prisma/migrations/**/*"
      ```
- [ ] **Fix `scanSecrets.mjs:39`** — `SKIP_DIR` contains `"release"`, and `walk()` returns
      immediately when the *target directory itself* is named `release`. It scans zero files.
      Skip `SKIP_DIR` only for descendant dirs, never the explicit root.
- [ ] **Fix `checkDistSafe.mjs:30`** — personal-data detection is a filename regex ending in
      `.db`. Read the asar index and scan by content. Add a hard rule: any shipped SQLite file
      must have 0 rows in `User`.
- [ ] **Re-scan and confirm the checker now fails** on the current dirty build before trusting
      it again. A checker that returns green on a dirty build is worse than no checker.

**Open question only you can answer:** the build shared with your tester on 2026-07-21 predates
`.env.qc` (created 07-22), but the DB snapshot is stamped 07-21 21:28. If that build was cut
after 21:28, they already have your data.

---

## Phase 1 — Make your own app honest (week 1, ~6 hours)

You are cutting right now on numbers that are wrong. This phase is for you, not for shipping.

- [ ] **Quarantine the 470 known-wrong food rows.** They carry another food's macros verbatim
      and the DB *says so* in `dataQuality` (`exception:provenance-cleared — …these are NOT
      this food's numbers`). One UPDATE setting `source = "quarantined"`, plus one guard clause
      so the solver and filters refuse them. Recipes referencing them show "incomplete data"
      instead of a confident wrong number. **Honest beats precise.**
- [ ] **Hand-fix the ~50 that carry 80% of the damage.** By recipe-reference count:
      Pepper (83), Potatoes (71), Carrots (70), Flour (68), Chicken Breast (59), Plain Flour (56),
      Lemon (53), Tomato/Tomatoes (52), Red Chilli (45), Rice (30), Mint (28), Tofu (27),
      Egg Yolks (27), Bacon (23), Icing Sugar (22), Vegetable Stock (21), Cabbage (20), Tuna (19),
      Greek Yogurt (18), Bread (17), Green Chilli (17), Noodles (17), Dill (15), Cinnamon Stick (12),
      Melted Butter (11), Mayonnaise (11), flax eggs (10).
      Assign each a hand-picked `fdcId`, re-derive macros, recompute affected recipe caches with
      the existing `computeRecipeMacros`. Closes the >15% error band almost entirely.
      **Do NOT auto-rematch.** `findConfidentMatch()` already refused every one by design, and its
      header documents what happened the one time that rule was loosened.
- [ ] **Close the door that still mints wrong rows.** `usdaCandidateAcceptable()` doesn't apply
      the density-word ban that tier 3 already has. Live-verified: `milk → "Milk, dry, whole"`
      **accepts** at 496 vs 61 kcal. ~3 lines reusing machinery already in the file.
      This is the highest value-per-minute fix in the whole audit.
- [ ] **Ship library updates to existing installs.** `desktopBootstrap.js:103-104` copies the
      template only when the DB is absent. Your install has **973 foods / 634 recipes**; the
      template has **14,122 / 889**. Every data fix above will never reach your running app
      without a content-sync step (upsert Food/Recipe by `fdcId`/name alongside `ensureSchemaCurrent`).
- [ ] **Hide the weekly grocery total.** Following the app's own shopping list costs **1.72×**
      what it displays ($181 shown, $311 real). Keep per-item costs and the per-serving filter.
      A wrong dollar figure poisons trust in the macros, and the macros are the part that's right.

---

## Phase 2 — Bugs that produce wrong behaviour every day (week 2, ~7 hours)

- [ ] **Unify `todayStr()` on local time.** Found independently by three lanes and verified live
      mid-audit: backend said `2026-07-25` while local said `2026-07-24`. Backend
      `dates.js:2` is UTC, frontend `dates.js:3` is local; `weighins.js:12` has a *third* inline
      copy. In Edmonton they disagree every day from 18:00 to midnight — Sunday evening the UI
      shows Sunday while the backend serves next week's plan, and the adaptive target can take an
      extra ±125 kcal step each evening and give it back each morning.
- [ ] **Make the solver see fat and carbs.** `weeklyPlanner.js:460` accepts a slot on calories +
      protein only; `mealSolver.js:218` grades all four. **89 of 92 out-of-tolerance days fail on
      fat alone.** `resolveSlot` already collects passing candidates into `fits[]` and throws all
      but the first away — keep them, pick the one closest to the day's remaining fat/carb budget.
      Zero extra recipe evaluations. Measured: male 3200 goes 5.1% → 15.0% of days in tolerance,
      male 2200 goes 18.5% → 32.0%, with calorie and protein compliance unchanged.
- [ ] **Fix the day-options race.** `PlanTab.jsx:810` `loadDayOptions` has no cancellation.
      Arrow-key to another day mid-request and Monday's response renders under Tuesday's heading;
      `acceptCandidate` then writes **Monday's meals into Tuesday**. Silent and persistent.
      Add a request token and guard `acceptCandidate` on `activeDay`.
- [ ] **Stop `matchPct` overstating.** Fat/carb weigh 0.075 each and cap at 1.0, so a day 98 g
      outside its fat band loses at most 7.5 points — out-of-tolerance days score a **median 93%**.
      Reweight, or show only the in-tolerance flag.
- [ ] **Give `classifyBinding` a fat/carb branch** (`mealSolver.js:919-983`). It currently blames
      "calorie and protein target" for failures that are purely fat. The prose `reasons[]` already
      tells the truth; only the machine-readable key lies.
- [ ] **Show the step cap on the Engine tab.** `EngineTab.jsx:150-165` prints
      "3,400 − 500 · floor 1,800 → Daily target 2,425" — arithmetic that doesn't produce its own
      answer, because the ±125 step cap moved it. `stepCap.reason` already ships in
      `/weighins/summary`; grep says **zero renders**. Your constitution requires every automatic
      adjustment be visible.
- [ ] **Fix the two claims that are simply false.** `TodayTab.jsx:165` promises "tomorrow's target
      already adjusts" (it's weekly, capped, and gated). `EngineTab.jsx:211` says "LBM = body weight
      until you add body fat %" (the engine assumes 21%/28% — wrong by 21%).
- [ ] **`trendRate` should fit 14 days, not 14 rows** (`bmrEngine.js:348`). Eight monthly weigh-ins
      over 213 days currently produce a confident "SLOW" verdict and a goal date.

---

## Phase 3 — The safety promise (week 3, ~8 hours)

Required before anyone else installs this. Not urgent for you alone.

- [ ] **Fix the `breaded` regex.** `"bread"` is in the gluten list, but `hasWordOrPlural`
      (`dietaryFilter.js:657`) compiles `\bbread(?:es|s)?\b`, which cannot match `breaded`.
      82 rows — battered fish, breaded chicken, onion rings — pass to a celiac.
- [ ] **Add the missing keywords:** `meatless` → soy (36 USDA meat analogues), mayo-emulsion
      dressings → egg (36 rows: thousand island, ranch, coleslaw), `kimchi` → fish + shellfish,
      `tapenade` / `pho` → fish, `granola bar` → gluten, `nondairy whipped topping` → dairy
      (sodium caseinate).
- [ ] **Share one filter across every surface.** `planContext.filterRecipePool` checks ingredient
      metadata + `additionalIngredientNames(steps)` + title + step prose. Library browse
      (`recipes.js:34`), cart (`cart.js:20`), AI swap (`weeklyPlanner.js:32`) and brain pool
      (`exclusions.js:70`) check **ingredient names only** — letting through 210 recipe×allergy
      pairs the solver already hides. `Sushi` ("half a prawn" in step 3) reaches a shellfish-allergic
      user; `…With Tahini…` has tahini only in the title.
- [ ] **Gate the ungated write paths.** Recipe URL import and `save-draft` run no allergen check
      at all; `GET /foods` returns all 14,122 rows unfiltered.
- [ ] **Fix over-blocking.** Gluten blocks all **47 explicitly gluten-free products** — the exact
      foods a celiac should eat. `WORD_GUARDS.dairy` has a `dairy-free` veto; gluten never got one.
      Tree-nuts blocks **57 peanut-butter rows** (`"nut butter"` matched as a substring inside
      `peanut butter`) and 15 coconut rows — both traps `allergenTaxonomy.js:178-182` explicitly warns about.
- [ ] **Render the allergen override.** `aiRecipeClient.js:256-268` builds `allergenOverrides`
      naming exactly what each draft violates, `recipes.js:103` returns it, the frontend never reads
      it. Violating drafts currently look identical to safe ones. Log the override server-side too.
- [ ] **Add an age gate.** `SetupWizard.jsx:196` and `profile.js:74` admit 14-year-olds; a 14-year-old
      girl at 50 kg on rate 2.0 gets a **1,212 kcal** target from adult-validated formulas.
      Refuse under 18, or route to a "talk to someone first" screen.
- [ ] **Add a BMI floor on goal weight.** `grep -i "bmi|underweight"` returns **zero hits app-wide**.
      Nothing knows what a healthy weight is; a 170 cm adult can set goal 40 kg and get a projected date.
- [ ] **Trigger the wellbeing check.** It's a correct SCOFF that nothing ever opens except a sidebar
      button (`App.jsx:48`). Trigger on: aggressive rate + floor clamp, measured loss above plan for
      2+ weeks, or a goal below a healthy BMI.
- [ ] **Write the auth test that would have caught account takeover.** Mutation testing planted
      `jwt.verify → jwt.decode` and **1043/1043 still passed**. The existing forged-cookie test
      (`auth.registration.test.js:213`) uses subject `"fake"`, so it 403s on the *user-existence*
      check, not the signature. Sign a token for a **real** user with a **wrong** secret. Export
      `verifyToken` so it's directly testable.
- [ ] **Un-skip the allergen corpus on CI.** Seven tests including the 14,122-row sweep are
      `{ skip: noCorpus }` on `dev.db`, which CI never has — and skipped tests still count toward
      `MIN_TESTS`, so the tripwire is structurally blind. Point them at CI's seeded DB, or add
      `MIN_UNSKIPPED`.
- [ ] **Fix NEDIC's hours** in `wellbeingResources.js` — the phone line is Mon–Thu 9–9 ET,
      Fri 9–5 ET, closed weekends. Only the chat is 7 days. (The other four resources verified correct.)

---

## Phase 4 — Weight and speed (week 4, ~4 hours, very high ratio)

- [ ] **Delete 202 MB of garbage.** Ten stale `query_engine-windows.dll.node.tmp*` copies in
      `backend/node_modules/.prisma/client/` — leftovers from `prisma generate` racing a locked DLL.
      Add a `predist` guard. **Two minutes.**
- [ ] **Drop the Prisma CLI + `@prisma/engines` from the bundle** (~114 MB). Runtime never calls it —
      migrations go through your own `node:sqlite` runner. Move to devDependencies.
- [ ] **`electronLanguages: ["en-US"]`** (~46 MB). **Exclude `backend/data/fdc-cache`, `fdc-fixtures`,
      `reports/`** (~30 MB). Total: **809 MB installed → ~380 MB.**
- [ ] **Cap or virtualize `FoodsTab.jsx:404`.** Expanding "protein" mounts **3,867** rows. The comment
      at line 265 says "never render 900 rows" — written when the library was 854 foods. A slice is
      10 minutes; `react-window` is an hour.
- [ ] **Gate `runDataQualityAudit()` behind `!app.isPackaged`** (`server.js:135`). 973 ms, 155 ms of
      event-loop block, RSS 65 → 320 MB with ~220 MB never returned — to log one line nobody can see.
- [ ] **Cache the recipe pool** in `planContext.js:94` behind a library-version key. Costs
      192–532 ms per call and `plans.js` calls it from eight places. **The solver itself is 30–50 ms —
      leave it alone.**
- [ ] **Add `select` to `foods.js:14` + `compression` middleware.** Currently 14,122 rows / 13.1 MB
      uncompressed / 1,125 ms, re-paid every time the Foods tab opens. `Food.micros` alone is 6.9 MB.
- [ ] **`@@index([recipeId])` and `@@index([foodId])` on `RecipeIngredient`** (zero indexes today,
      full-scans 7,245 rows). Plus `PRAGMA journal_mode=WAL` and one `ANALYZE`.

---

## Phase 5 — Promises not yet kept (week 5, ~8 hours)

- [ ] **Ship `GET /api/export`.** `CLAUDE.md:116` says "Data is never trapped: JSON+CSV export must
      always work." **No export code exists anywhere** — 8,129 rows across 26 tables, zero exportable.
      Full user scope, `?format=json|csv`. Quote-escape, `'`-prefix `= + - @`, UTF-8 BOM
      (43 current food names are non-ASCII, 109 contain commas).
- [ ] **Then `POST /api/import`** for that JSON. Without it the promise is one-way.
- [ ] **Fix or delete the auto-updater.** Zero GitHub releases exist; your log shows five
      `HttpError: 406` failures, and the app reports them as *"check failed (this is normal offline)"*.
      Either cut a real release with `electron-builder --publish` (a manual upload renames the asset
      to `Cut.Protocol.Setup.1.0.0.exe` and 404s), or remove the updater and tell testers updates are
      manual. Also: bump the version — today's build is `1.0.0` over `1.0.0`.
- [ ] **Prune backups + write `docs/RESTORE.md`.** Never pruned; future ones are 16 MB each. The only
      restore instruction today is a string inside an error message.
- [ ] **Set `deleteAppDataOnUninstall: false` explicitly.** It's the default and uninstall is currently
      safe (verified — the uninstaller carries no `$APPDATA` path). Make it impossible to flip by accident.
- [ ] **Wire `Profile.adaptiveTdee`** — the column exists, nothing writes it, no UI control. Same for
      `proteinPriorityMode` (still localStorage-only).
- [ ] **Add confirm-with-undo on the four hard deletes** — recipe, weigh-in, diary entry, training plan.

---

## Phase 6 — Language and polish (ongoing, ~6 hours)

- [ ] **Remove `see src/lib/groceryPrices.js` from the shipped UI** (`groceryList.js:236`). Also
      `docs/adaptive-tdee-methodology.md` (`AdaptiveTdeeCard.jsx:197`) and `ADAPTIVE_TDEE=off`
      (`adaptiveTarget.js:356`). A repo path in a grocery list is the loudest internal-tool tell in the app.
- [ ] **De-jargon the Plan tab** — that's where the jargon actually lives, not Engine. `solver` →
      meal planner, `pool` → your recipes, `slot` → meal, `horizon` → how far ahead, `tolerance` →
      close enough to your targets.
- [ ] **Rename the `§1/§2/§2b/§3/§4` section codes** to plain steps.
- [ ] **Guard `kc()`** — `"From the formula alone this would be NaN"` is currently reachable
      (`EngineTab.jsx:9` + `:175`).
- [ ] **Stop rendering raw enums** — `<option value="meal">meal</option>`, `bread_or_pastry_side`,
      `dairy-eggs`, `(desk-office)`, `{iss.code}: {iss.detail}`, and validation errors naming object
      keys (`heightCm must be a number between 100 and 250`).
- [ ] **Rewrite the verdict stamps** in sentence case, number first: `SLOW` → "Slower than planned",
      drop `HOLD 1 WK` and "adherence", and stop leading with "check logging accuracy" (blames before it helps).
- [ ] **Wrap `PlanTab.jsx:183,194`** in `fmtD` — raw ISO dates reach the screen ("Week of 2026-07-27").
- [ ] **Pick one macro order.** Chips render P/F/C, bars render P/C/F, Engine renders protein/fat/carb.
- [ ] **Design-law cleanup:** green on native checkboxes/radios (`accentColor` — six green ticks are the
      loudest thing on Engine), red on food-data warnings where the sibling badge already uses amber
      (`FoodsTab.jsx:146-157`), borrowed macro hues on `PlanTab` role tiles, and the splash spinner
      (green *and* forbidden — `index.css:150` says no spinners).
- [ ] **Fix `--faint-light` on body text** — 3.26:1, fails WCAG AA, across ~40 sites. Your own comments
      at `Parts.jsx:31-34` diagnose it and fix it in two places.
- [ ] **Widen `SetupWizard.jsx:266`** — `max-w-2xl` is the phone-width centered column your constitution
      forbids, on the first screen a new user sees.
- [ ] **Add `<h2>` to `Card`** (`Parts.jsx:23-39`) — one heading per screen today, so screen-reader users
      can't navigate a 7-card dashboard.

---

## Delete, don't fix

- **The comparison table's four wrong claims** (`CompareDialog.jsx`). Cronometer's free tier **does**
  carry ads. MyFitnessPal Premium+ **does** ship a meal planner. Lose It's "~63M foods" is unsupported
  (published figures cluster near 7M). And "no account" is contradicted by your own login screen —
  it's a *local* account. Also `docs/showcase/index.html` says "854 Foods, audited"; it's 14,122, of
  which 605 are manual. Fix or pull the page — wrong claims about named companies in a shipped product
  are a different category of problem.
- **`CompareDialog`'s "Zero-tolerance allergy exclusion: yes"** — `WellbeingCheck.jsx:146` disclaims
  exactly this on another screen. Given Phase 3, the disclaimer is the true one.
- **`"{n} foods · validated against kcal ≈ 4P + 4C + 9F"`** (`FoodsTab.jsx:320`) as a warrant of
  correctness — every one of the 470 corrupt rows passes that check perfectly.
- **`basicCookingSteps.js`** — 232 lines, zero importers.
- **`groceryPrices.js`** — after Phase 1, delete it so it can't come back. `ingredientCosts.json`
  (769 entries, word-boundary matching) already replaced it; `groceryList.js:17` just never switched.

## Repo hygiene (30 min, zero risk)

- [ ] **Delete 12 branches and 10 worktrees.** All are strict ancestors of master, verified three ways —
  **zero unmerged work exists.** Keep `backup/pre-overhaul` and `gh-pages`. Remove worktrees first
  (`git worktree remove`), then `git branch -d` (not `-D` — let it refuse if I'm wrong).
- [ ] **Delete `.qc-scratch-agent*`** — 379 MB, agent7 alone is 243 MB.
- [ ] **Correct `CLAUDE.md:28-37`.** It tells every future session the installer ships your `.env` and
  real `dev.db`. That specific claim is stale — and the leak reopened under *different filenames*.
  Rewrite it to describe the allowlist, or the next session will re-fix a fixed bug and miss the real one.
- [ ] **Fix the `docs/design/` phantom reference** in CLAUDE.md — the research report it cites never existed.
- [ ] **Move `portedFromRecomp/` out of `backend/src/`.** 76% of `backend/src` bytes are seed data;
  moving it makes `src` mean "code that runs" (80K → 19K lines).
- [ ] **Void three QC reports.** `integrity-sweep.md` ("corruption: 0 — clean"), `allergen-sweep.md`
  ("0 recipes affected"), and `security/scan-report.md` (certifies an installer whose SHA-256 and size
  no longer match today's file). All three assert clean on things that aren't. Don't cite them again
  until their test definitions change.

---

## If you only do five things

1. Rotate the three credentials, fix the packaging allowlist, fix the two scanner blind spots. (1 h)
2. Quarantine the 470 corrupt food rows and close `usdaCandidateAcceptable()`. (2 h)
3. Unify `todayStr()` on local time. (1 h)
4. Give `resolveSlot` a fat/carb tie-break. (1 h)
5. Ship the library to your own install so any of this reaches the app you actually use. (2 h)

Seven hours, and the app stops lying to you.

---

## What's already good — don't touch it

Worth writing down so no future session "improves" it:

- **The nutrition math.** All ten BMR formula coefficient sets verified against the literature.
  The calorie floor survived a 250,880-combination sweep and a 20,000-case fuzz with **zero** breaches.
- **The adaptive estimator.** Huber-robust, AR(1)-corrected, with a real standard error. A 10 lb
  overnight spike moved expenditure by 3 kcal. The target is *derived, never stored*, so correcting a
  weigh-in retroactively undoes its adjustment.
- **The test runner** (`scripts/runTests.mjs`) and the CI entrypoint guard that refuses to be guarded
  by the thing it guards. ~99% of 1043 tests are load-bearing; 12 of 14 planted bugs died.
- **`brain/governance.js`** and `aiGovernanceStructure.test.js`, which fails the build on a new
  ungoverned LLM call site. AI-drafted recipes never keep model-authored macros.
- **The FK-off migration hardening** (`desktopBootstrap.js:329-334`). Not defensive theatre — with
  enforcement live, migration `20260717183855` bricks the app. Verified by counterfactual.
- **The boot-failure screens.** Every branch lands on a real screen with a cause, a next step, and
  an "Open log folder" button. Better than most shipped Electron apps.
- **The deterministic matcher** (`ingredientResolver.js:360-433`). The fuzzy-match bug is genuinely,
  properly dead. Only the data it left behind is broken.
- **Okabe-Ito macro triad, colorblind-safe, no information conveyed by colour alone,
  `prefers-reduced-motion` fully honoured, zero shadows, `theme.js` 24/24 in sync with `index.css`.**
