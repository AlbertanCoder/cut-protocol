# Cut Protocol — QC Code Audit

**Date:** 2026-07-18 · **Baseline:** tag `pre-audit` (`48cda71`) · **Method:** five parallel independent audits (engine math, meal solver + exclusion integrity, data layer, UI code & state, packaging & resilience), each by a skeptical reviewer reading the code cold, verifying by execution against real lib functions and a *copy* of the live database. `npm test` baseline: 130/130 green. No fixes applied — this document is findings only.

Two findings were independently discovered by two auditors each (packaged-app migration gap; installer personal-data payload) and are merged below.

## Executive summary

**67 findings after dedup: 5 CRITICAL · 12 MAJOR · 34 MINOR · 16 COSMETIC.**

The verdict in one paragraph: the *math* and the *architecture* hold up — every BMR formula reproduces published literature to the kcal, macros are recomputed server-side everywhere (no path trusts client numbers), the solver never crashed or lied about fit under stress, style filtering (vegan/halal/keto-pool/etc.) survived a full-pool survivor scan, the data layer shows zero validator failures and zero cache drift across 630 recipes, and migrations replay bit-perfect. The failures cluster in exactly three places: **(1) the allergy vocabulary never got the hardening the diet-style vocabulary got in Phase 4** — allergen dishes provably reach generated plans today; **(2) the AI-generation lane never learned profiles exist** — it enforces one hardcoded person's allergies for everyone; **(3) the app's edges** — profile field validation, packaged-app lifecycle, and error surfacing — are far less finished than its core.

| Area | CRITICAL | MAJOR | MINOR | COSMETIC |
|---|---|---|---|---|
| Engine math | 0 | 1 | 3 | 3 |
| Meal solver / exclusions | 4 | 5 | 5 | 3 |
| Data layer | 0 | 3 | 5 | 3 |
| UI code & state | 1 | 4 | 15 | 6 |
| Packaging & resilience | 0 | 2 (+1 merged) | 6 | 1 |
| **Merged cross-area** | — | 1 | — | — |

---

## CRITICAL

### C1. Allergy synonym lists materially incomplete — allergen dishes provably reach the plate
**Area:** Meal solver · **Location:** `backend/src/lib/dietaryFilter.js:110-179` (`CATEGORY_SYNONYMS`) vs the hardened style list at `:20-46`
**What's wrong:** Phase 4's exhaustive 854-food-name hardening was applied to the *diet-style* keywords only; the *allergy* category synonyms were never given the same treatment (the test suite itself admits this at `tests/dietaryFilter.test.js:172-174`). Verified end-to-end with the real solver over 6 generated weeks per profile:
- **gluten:** Soy Sauce, filo/puff/shortcrust pastry, spaghetti, macaroni, lasagne sheets, wonton skins, digestive biscuits, pretzels, beer, hoisin — **16% of generated slots (21/132) served wheat to a celiac profile**
- **dairy:** cheese-variety names (Mozzarella, Parmesan, Feta, Ricotta, Crème Fraîche, Buttermilk, Gruyère…) absent — plated "Matambre a la Pizza: Mozzarella 90 g" to a dairy-allergic profile. The vegan style list HAS these names; the dairy allergy list doesn't — two-list drift
- **shellfish:** cephalopods missing (squid, calamari, octopus, cuttlefish, conch, seafood stock) — plated "Salt & pepper squid: Squid 200 g"
- **fish:** ~20 species present in the style keywords but absent from the fish allergy list (pilchards plated; barramundi, monkfish survive)
- **eggs:** aioli, custard missing · **sesame:** hummus missing
**Why it matters:** The UI promises "Nothing excluded is ever surfaced" (`ProfileTab.jsx:307`). Allergy filtering is the app's one zero-tolerance safety promise, and it is broken for six allergy categories on the primary plan-generation path.
**Suggested fix (not applied):** Port every relevant member of `MEAT_FISH_KEYWORDS`/`ANIMAL_DERIVED_EXTRA_KEYWORDS` into the corresponding `CATEGORY_SYNONYMS`; add the gluten carriers; add per-allergy-key regression tests mirroring the Phase-4 854-name audit.

### C2. AI recipe generation ignores the user's profile — allergies hardcoded to one person
**Area:** Meal solver (independently flagged by Packaging) · **Location:** `backend/src/lib/aiRecipeClient.js:8-12` (blocklist), `:74-76` (prompt exclusion line); `backend/src/routes/recipes.js:50-55` (profile loaded, its `excludedFoods`/`dietaryStyle` never passed)
**What's wrong:** Both the generation prompt and the post-generation `violatesAllergyRules` filter enforce exactly three hardcoded allergies (shellfish, kiwi, soy protein — one specific person's rules, per the code comment) regardless of who is asking. Proven with the module's own regexes: peanut, dairy, wheat, and beef drafts pass unblocked for users with those allergies; `droppedForAllergies` can never report their allergens. Contradicts CLAUDE.md standing rule 3 and the UI's own copy ("Diet & allergy rules from your Profile…").
**Why it matters:** Saved drafts are contained by read-time filters, but the drafting experience violates the written safety promise — and combined with C3 it becomes a plan-level leak.
**Suggested fix (not applied):** Build the blocklist + prompt exclusions from `profile.excludedFoods` + `dietaryStyle` (reusing `matchesExclusionTerm`/`recipeExcludedByStyle` on draft ingredient names), keeping the static three as a floor only.

### C3. Legacy /swap AI fallback writes an unfiltered AI recipe straight into the plan
**Area:** Meal solver · **Location:** `backend/src/lib/weeklyPlanner.js:202-224` (`tryAiFallback`, `:207` pushes into the pool), enabled at `backend/src/routes/plans.js:430-431`
**What's wrong:** When `POST /plans/:planId/slots/:slotId/swap` exhausts 5 pool candidates, it live-generates a recipe (subject only to C2's hardcoded blocklist), persists it, and writes it into the slot **without ever passing the dietary filter**. A vegan/celiac/dairy-allergic user's swap can place a beef/pasta/yogurt dish into their active plan and Today dashboard. Mitigations: the current UI doesn't call this endpoint (`swapSlot` in `api.js:54` is uncalled — it uses alternates→apply), so it is server-live but UI-dormant.
**Why it matters:** The one generation path that skips the "pool membership = compliance" invariant entirely, and it persists its output.
**Suggested fix (not applied):** Run the generated recipe through the same style+exclusion check before accepting (reject → honest unsolved slot), or delete the legacy endpoint.

### C4. The primary account's declared "soy protein" allergy does not exclude tofu/tempeh/edamame
**Area:** Meal solver · **Location:** `backend/src/lib/dietaryFilter.js:354-371` (free-text fallback) vs `aiRecipeClient.js:11` (the same allergy defined as `soy protein|tofu|edamame|tempeh|soy milk|tvp`)
**What's wrong:** The live profile stores `excludedFoods: ["soy protein"]`. That string is not a `CATEGORY_SYNONYMS` key, so it falls to literal substring matching — proven: `matchesExclusionTerm("Tofu","soy protein") === false`, while 4 tofu recipes sit in that account's eligible pool. The repo's own AI blocklist defines this allergy as including tofu. The "soy" checkbox can't be used instead — it would also exclude soybean oil, which this user explicitly permits.
**Why it matters:** The one real allergy the app was originally built around is unenforced on the solver/library path that serves daily plans.
**Suggested fix (not applied):** Add a `"soy protein"` `CATEGORY_SYNONYMS` key (tofu, tempeh, edamame, soy milk, TVP, miso — excluding oil), matching the blocklist's own definition.

### C5. ProfileTab commits zeroed vitals (age/height/goal) — silent corruption of every derived number
**Area:** UI · **Location:** `frontend/src/components/ProfileTab.jsx:179-203` (age/height/goal fields); backend gap in `backend/src/routes/profile.js:24-68` (`validateProfilePatch` checks neither `age`, `heightCm`, nor `goalWeightKg`)
**What's wrong:** Typed fields coerce with `+e.target.value || 0` on change and commit on blur. Clearing a field to retype (a normal gesture) then clicking away commits `0`. The backend accepts it, `recomputeTarget` runs, and every derived number re-materializes from garbage: height 0 knocks ~1,100 kcal off Mifflin; goal 0 breaks the Trend/Today chart domains and the projection. The wizard has bounds (age 14–100 etc.); the permanent home of these fields has none.
**Why it matters:** Wrong math users act on, with no error shown — the constitution's "wrong math = product death" case.
**Suggested fix (not applied):** Mirror the wizard's bounds in ProfileTab (skip commit + inline note when out of range) and add the three fields to `validateProfilePatch` as backstop.

---

## MAJOR

### M1. Documented `RMR×0.95` safety floor is not implemented (verges on CRITICAL)
**Area:** Engine math · **Location:** `backend/src/lib/bmrEngine.js:129-141`; rule in CLAUDE.md constitution ("never prescribe below max(RMR×0.95, 1500 M / 1200 F)")
**What's wrong:** `effectiveFloor` is `max(sexFloor, floorKcal)` — the RMR term is absent. Recomputed: male 29y/185cm/95kg, RMR 2060, rate 2.0 lb/wk → module target **1500**; constitution floor RMR×0.95 = **1957**. A 457-kcal shortfall below the app's own written safety rail. Mitigations: never below the absolute 1500/1200; the triggering rate is ack-gated.
**Suggested fix:** Include `Math.round(rmr*0.95)` in the max (requires threading `rmr` into `deriveTarget`).

### M2. Packaged app has no schema-migration story — already one migration out of date (found independently by Data & Packaging auditors)
**Location:** `backend/src/lib/desktopBootstrap.js:81` (`existsSync → return`); evidence: shipped asar contains migrations only through `…phase3_profile_engine`, repo now has `…training_scaffold`, and a real user DB from the pre-training template exists at `%AppData%\Cut Protocol\cutprotocol.db`
**What's wrong:** First-run template copy is the only provisioning; existing installs never migrate. Rebuild+reinstall today → Training queries hit a DB with no Training tables → P2021 → per-route 500s (training routes have zero try/catch) with a healthy-looking boot.
**Why it matters:** Every future migration silently breaks every existing install; no detection, no message, no upgrade path.
**Suggested fix:** Stamp schema version; on mismatch run the shipped migration SQL in order (they already ship unpacked) or refuse loudly with an automatic backup.

### M3. Fixed port 3001 + no single-instance lock + unhandled EADDRINUSE — includes a silent wrong-database write path
**Area:** Packaging · **Location:** `electron/main.cjs:89,125,196`; `backend/server.js:46` (no `'error'` listener); no `requestSingleInstanceLock` anywhere
**What's wrong:** If 3001 is taken, `listen` throws uncaught → Electron's developer-worded dialog; meanwhile `waitForServer` resolves against whatever owns the port and loads it. Concrete outcomes: double-launch rides the first instance's backend; **with the dev backend running (this machine's normal state), the packaged app silently reads/writes `dev.db` instead of the user's `cutprotocol.db`** — real tracking data lands in a database that dev workflows reset.
**Suggested fix:** Single-instance lock + focus-existing; `'error'` handler with a purpose-built message; packaged mode picks a free port.

### M4. Installer embeds real secrets + the real personal database (documented-deliberate, unenforced)
**Area:** Packaging (+ Data) · **Location:** root `package.json` `extraResources`; verified in the built artifact
**What's wrong:** Real `.env` (JWT secret, Anthropic + USDA keys, seed creds) and the real `dev.db` (profile, weigh-ins, bcrypt hash) ship in every installer. Acknowledged in CLAUDE.md as a personal-build tradeoff — but the "MUST revert before distribution" rule has no enforcement; nothing fails a build that would leak it. Repo hygiene verified clean (nothing sensitive ever tracked).
**Suggested fix:** Generate JWT on first run; keys prompted/stored in userData; template built from migrations + food/recipe seeds only; a `dist` precheck that refuses real files.

### M5. PUT /recipes/:id replaces ingredients before the fallible update — a 409 leaves the recipe half-edited
**Area:** Data · **Location:** `backend/src/routes/recipes.js:188-202`
**What's wrong:** deleteMany → createMany → update, no transaction; a P2002 name collision on the final update (handled, returns 409) leaves new ingredients under old cached macros — wrong nutrition data the solver then consumes. A crash between delete and create leaves zero ingredients.
**Suggested fix:** `$transaction` (training.js:42 already demonstrates the pattern) or check the name first.

### M6. Failed/partial first-run copy permanently bricks bootstrap (verified by execution)
**Area:** Data · **Location:** `backend/src/lib/desktopBootstrap.js:81,87-97`
**What's wrong:** Prisma creates a 0-byte file at a missing DB path; a failed template copy leaves a file that `existsSync` treats as initialized forever — every launch 500s with no self-healing and no user-actionable message.
**Suggested fix:** Post-copy integrity check (size + SQLite header + User table); re-copy or surface explicitly.

### M7. Grocery list silently drops slots whose recipe was deleted
**Area:** Data · **Location:** `backend/src/routes/plans.js:440-450` filter vs `schema.prisma:199` ("ground truth for display + grocery list")
**What's wrong:** `PlanSlot.recipeId` is SetNull by design so plans survive recipe deletion, and the slot's ingredients JSON stays intact and rendered — but grocery generation filters on `recipeId`, so the shopping list omits a meal the user still sees and will cook. Silent.
**Suggested fix:** Filter on non-empty `ingredients` instead, or include with an honest note.

### M8. Keto ceiling applied to the solver pool but not the library listing
**Area:** Solver · **Location:** `backend/src/routes/plans.js:21,28` vs `backend/src/routes/recipes.js:28-33`
**What's wrong:** Keto's 30 g carb ceiling exists only in `filterRecipePool`. Library shows 630/630 to a keto user (solver pool: 142); the 488 non-keto recipes are browsable and cartable, then rejected by place-recipe with a misleading "diet/allergy rules" error.
**Suggested fix:** Apply the same ceiling in GET /recipes, counted in `hiddenCount`.

### M9. accept-day / apply enforce no portion bounds — ×10 and 44,000-kcal slots accepted
**Area:** Solver · **Location:** `backend/src/routes/plans.js:87-119` (`rebuildSlotFromClient`), used at `:231`/`:302`
**What's wrong:** The rebuild path accepts any per-ingredient grams ≤5,000 with no relation to the recipe's base grams — proven accepted: ×10 portion (5,804 kcal), 5,000 g oil under a valid recipe id (44,200 kcal), a 26-kcal "meal", and client-trusted proteinScale/sidesScale labels decoupled from actual grams. Macros are recomputed honestly, but the plan itself can be absurd while place-recipe (the other path) clamps 0.5–2.
**Suggested fix:** Validate grams against `baseGrams × [0.5,2]` and derive scales server-side.

### M10. Week-generate diagnosis misattributes the binding constraint
**Area:** Solver · **Location:** `backend/src/routes/plans.js:142` + `backend/src/lib/mealSolver.js:157-190,272-289`
**What's wrong:** The week path pre-filters prep-time before the solver sees the pool; an empty pool is then always diagnosed as "dietary style + allergy rules exclude every recipe" — proven false attribution when maxPrepMin was the actual constraint (day-options diagnoses the same case correctly).
**Suggested fix:** Pass raw/afterDiet/afterPrep counts into the week diagnosis, as day-options does.

### M11. `excludedFoods` completely unvalidated — one bad element bricks plans and library
**Area:** Solver · **Location:** `backend/src/routes/profile.js:24-68`; crash at `dietaryFilter.js:355`
**What's wrong:** PUT /profile accepts `excludedFoods: [5]`; every subsequent GET /recipes and plan generation throws (`term.trim is not a function`) → persistent 500s until the profile is repaired. Every other profile field is validated. (Same validator gap family as C5.)
**Suggested fix:** Validate array-of-nonempty-strings; harden `matchesExclusionTerm` with `String(term ?? "")`.

### M12. Cart accepts and shops non-compliant recipes
**Area:** Solver · **Location:** `backend/src/routes/cart.js:19-32`, `:54-62`
**What's wrong:** The cart holds any recipeId; nothing flags items when diet/allergies change; `POST /cart/grocery-list` produces a shopping list containing the allergen with no note. (`fill-today-from-cart` is the only cart consumer that re-checks — it does so honestly.)
**Suggested fix:** Apply the compliance check in cart GET/grocery-list, mirroring `skippedForDiet`.

### M13–M15 (UI cluster). Grocery `bySection` renders undecorated on the fresh-generate path (checkboxes visually dead, purchase units invisible — root: `backend/src/routes/plans.js:456-470` decorates `items` but returns pre-decoration `bySection`; UI prefers `bySection` at `PlanTab.jsx:398-404`) · Lost-update race on rapid allergy/formula toggles (`ProfileTab.jsx:95-98`, `EngineTab.jsx:14-19` — concurrent PUTs from stale props; a dropped allergy toggle is a safety-adjacent silent revert) · Fire-and-forget async handlers with no catch and no busy state across TodayTab weigh-ins, PlanTab meal config, RecipesTab delete, TrainingTab delete, EngineTab toggles, FoodsTab loads — failed writes are fully silent · Draft save-errors keyed by mutable array index attach to the wrong draft after save/import reshuffles (`RecipesTab.jsx:316,411,424-445,570-573`).
**Suggested fixes:** group from decorated `items` (drop `bySection` preference); serialize or optimistically-echo toggle commits; wrap handlers into each tab's existing error state; key drafts by stable client id.

---

## MINOR (34)

**Engine math:** Oxford/Henry 60+ band is a non-canonical merge of Henry's two published over-60 bands (~17 kcal high for >70; `bmrEngine.js:30-35`) · Macro engine emits negative carbMid/carbHi for high-LBM + floor-clamped targets (renders "~0–-131 g" carbs and a broken ratio bar; `bmrEngine.js:166-188`) · `weightInputBounds` imperial min 77 lb < backend's 35 kg guard → entering the stated minimum 400s (`units.js:27` vs `weighins.js:20`).

**Solver:** `diagnose()` capacity math ignores the active batch repeat cap — suggests enabling what's already on (`mealSolver.js:129-134`) · fill-today writes `warning:null` unconditionally even at huge target misses (`plans.js:397`) · place-recipe rounds ALL grams to 5 g unlike generation's `practicalGrams` (<20 g exact) — small-ingredient drift ±20% (`plans.js:340`) · accept-day accepts unbounded slotIndex (ghost slots) and stores client-authored warning text verbatim (`plans.js:228-229,117`) · *(5th item counted under M13–15 consolidation: none — 4 solver minors + 1 moved)* `alternatesForSlot` yesterday-discount discard is counted under COSMETIC.

**Data:** Week-plan generate/accept-day are non-transactional multi-step writes (mixed old/new week on crash; locked slots deleted on meal-config shrink; `plans.js:157-164,242-243`) · Food-edit ripple recompute non-transactional (`foods.js:49-63`) · Startup data audit reports CLEAN on an empty library — cannot distinguish clean from uninitialized (`dataQualityAudit.js:33`) · No non-unique indexes on hot FK columns (RecipeIngredient.recipeId/foodId, PlanSlot.recipeId, CartItem.recipeId) · ingredientResolver misclassifies unique-name collisions as "USDA lookup failed" and creates a placeholder instead of reusing the exact-match row (`ingredientResolver.js:52-64`).

**UI:** Weigh-in Log has no busy state and rejects invalid input silently (`TodayTab.jsx:37-44,133-139`) · Enter bypasses the import busy guard → double import (`RecipesTab.jsx:503`) · PlanTab initial-load failure sticks on "Loading…" with Generate hidden (`PlanTab.jsx:283-289,424-428`) · TodayTab conflates plan-fetch error with "no plan yet" (`TodayTab.jsx:30-32`) · FoodDetail's cached recipe-picker stale after edits, survives food switches (`FoodsTab.jsx:42-47,77-80`) · Grocery list silently stale vs plan edits; Est. total + coverage note vanish after remount (fields computed only in POST, never persisted) · Meal-structure bounds drift UI 1–6/0–4 vs backend 1–8/0–8; non-integer input rejected silently (`PlanTab.jsx:517-527` vs `profile.js:28-33`) · App conflates data-load failure with logged-out; post-login load failure displays as a login error (`App.jsx:45-56`) · Occupation dropdown can't be dismissed without selecting (`ProfileTab.jsx:216-237`) · Enter-vs-blur commit inconsistency across forms · Cart fetch failures swallowed — renders empty with no error (`PlanTab.jsx:293`, `RecipesTab.jsx:333-335`) · SlotCard cart button labeled "Add to cart" even when it removes (`PlanTab.jsx:182-186`) · `droppedForAllergies` note persists across failed/subsequent generations (`RecipesTab.jsx:313,387-403`) · Fiber "25+" hardcoded in Engine UI, not served by the engine (`EngineTab.jsx:117`) · Foods with unrecognized categories invisible in browse view (`FoodsTab.jsx:232-241`).

**Packaging:** Unintended installer payload: 3 dev.db backups as plain browsable files (asarUnpack covers `prisma/**`), audit reports, 42 MB stale engine temp files, dev-dep tree (`package.json:27,41`) · Startup failure paths dead-end (no-retry error page; boot-time throws crash before any window; no process-level handlers) · No Express error middleware; 26/39 handlers unwrapped — Express 5 saves the process but errors leave as stack-trace HTML surfaced as "request failed: 500" (NODE_ENV never set to production) · usdaClient fetch has no timeout — the one external call that can hang minutes (`usdaClient.js:53`; importer and Anthropic calls are properly bounded) · No window-state persistence, no min size, 860 px default height clips 768p screens; menu removal kills all accelerators incl. packaged devtools · CI never executes or syntax-checks the Electron layer; Node 20 in CI vs Electron's Node 22.

---

## COSMETIC (16)

**Engine:** Harris–Benedict is the 1984 revision, labeled without the year · dead `median` export · training MET double-counts resting metabolism (~30–50 kcal/day, conservative direction).
**Solver:** `alternatesForSlot` discards the yesterday-discount (`mealSolver.js:321`) · keto note in dietaryFilter overstates coverage · duplicate `egg`/`eggs` synonym keys.
**Data:** audit script duplicates the overrides loader without the `__` meta-key guard · one stale override key + three unneeded Atwater exemptions · grocery checkbox toggle is a whole-JSON read-modify-write (single-user: negligible).
**UI:** dead code (`getWeighins`, `swapSlot`, `Eyebrow`, Card `tint`, `i.grams` fallback, orphaned `public/icons.svg` shipping into dist) · duplicated helpers/vocab across components (kc ×6, SECTION_LABELS ×2, cuisine list ×3 — no current drift, verified) · ineffective `useMemo`s + doubled import in TrendTab · `sms:` links on a desktop OS · expandable cards not keyboard-reachable; SlotCard expanded region collapses on inner clicks · token-alpha string concat assumes 6-digit hex; `+value || 0` forces "0" into cleared fields (also the mechanism behind C5).
**Packaging:** splash + error page still wear the pre-overhaul gold/navy palette.

---

## Verified clean (evidence-backed highlights)

- **Engine:** Mifflin, Harris (1984), Schofield 18–60, Katch–McArdle, Cunningham, Oxford <60 all reproduce to **0.00 kcal** against hand computation; MET formula dimensionally correct (derivation shown); deficit `rate×500` exact; floor clamp order and stricter-only user floor verified; verdict bands gapless; macro midpoints land 99±1 under target exactly as the UI claims; unit round-trips drift-free at display precision; no early-rounding compounding.
- **Solver:** all seven plan/library delivery paths (generate, day-options, alternates, apply, accept-day, place-recipe, fill-today) consume the profile-filtered pool; apply/accept reject out-of-pool recipeIds and foreign foodIds (proven 400s); place-recipe clamps 0.5–2; macros recomputed server-side on every path (fake client labels ignored, proven); scale bounds hold across 9 stress configs; variety caps: zero violations; diagnosis never suggests loosening allergies (their test + fresh regex sweep over all stress output); style filtering held a full 630-recipe survivor scan; no crashes at 1,200–5,000 kcal targets, empty pools, absurd recipes.
- **Data:** validator re-run — 854 foods, **0 failures**, 0 dupes, 0 placeholder rows; independent Atwater hand-check 10/10; **all 630 recipe caches recompute within 0.05 kcal**; PRAGMA integrity/FK checks clean; every slot-ingredient and grocery foodId resolves; **all 13 migrations replay bit-perfect** onto a fresh DB with zero diff vs schema AND vs the live DB; onDelete DDL matches code assumptions; user-data writes are upsert-keyed and user-scoped; no runtime path reaches destructive scripts; overrides file 121/121 provenance-noted, zero drift.
- **UI:** oxlint + vite build clean; zero hex colors outside theme files; all 9 locale calls `en-CA`; zero drift between duplicated frontend vocab lists and backend truth (byte-compared); response-shape contracts hold for every consumer; remount-per-tab makes cross-tab staleness structurally safe; chart guards airtight for server-constrained data; stable keys on all reordering lists except the flagged drafts; busy states present on all primary actions except the flagged cluster; no conditional hooks.
- **Packaging:** everything the runtime needs ships (verified against the actual built asar, 4,366 files); intended exclusions effective (no .env/dev.db/tests/maps in asar); Prisma unpack contract holds and the packaged app demonstrably ran (real userData DB exists); env/DB contract names match end-to-end; ICO valid 6-size; quit is kill-safe (rollback journal → atomic); **core loop fully offline** (targets, plans, weigh-ins, foods, grocery, training); repo hygiene re-verified (nothing sensitive ever tracked).

## Reproduction

Harnesses and DB copies are preserved in the session scratchpad (`audit1/`–`audit5/`): formula recomputation scripts, the exclusion-leak end-to-end harness, route-replica payload tests, migration replay DBs, and the parsed asar listing. `backend/prisma/dev.db` was hash-verified unchanged after the audit.
