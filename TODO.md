# Cut Protocol — Work List (2026-07-18 audit · CLOSED OUT)

> ## ⚠ THIS IS NOT THE LIVE WORK LIST — see `BATTLE-PLAN.md`
>
> **Reconciled 2026-07-24.** This file tracks one specific thing: the 67
> findings of the 2026-07-18 QC audit (`docs/audit/01-code-audit.md`). Nearly
> all of it is done. It is kept as the closing record of that audit, not as a
> queue.
>
> **`BATTLE-PLAN.md` is the live work list.** Everything found after
> 2026-07-18 — the 470 corrupt food rows, the 210 recipe×allergy leaks across
> the non-solver surfaces, the installer payload, the gluten/tree-nut
> over-blocking — is tracked there and deliberately NOT duplicated here. Two
> competing lists is how a list starts lying.
>
> **What was wrong with this file before today**, so it isn't repeated:
> - Its Tier 1 header asserted the allergy promise "is currently broken in six
>   allergy categories" while every box beneath it was ticked and its own
>   preamble said they were already fixed. A header and its contents
>   contradicting each other means neither gets believed.
> - Three items were **under**-claimed — unticked, but done in code for days.
>   They have been ticked below with verified refs.
> - Ten ticks spot-checked correct; only the line numbers had drifted. Those
>   are corrected below. **Line numbers in a hand-maintained list decay
>   fastest** — prefer a symbol name (`rmrFloor`, `matchesExclusionTerm`) over
>   a line, since names survive edits above them.

Finding IDs (C1, M3…) cross-reference the audit, which has full evidence and
suggested fixes for every item.

---

## Tier 1 — The allergy promise (2026-07-18 findings: all closed)

These five findings are fixed and locked by tests, in the Stage-C commits
(`39ecc10`, `fa571f6`, `f59149c`, `f5faad6`) plus the `allergy-tier1` branch.

> **Closed ≠ solved.** A deeper audit on 2026-07-24 found the promise broken
> again by a *different* mechanism than anything below: the solver filters
> correctly, but library browse, cart, AI swap and the brain pool each match
> ingredient names only, letting through **210 recipe×allergy pairs**. That is
> a `BATTLE-PLAN.md` Phase 1 item, not a reopening of these five. The honest
> statement of where the app stands is the one `WellbeingCheck.jsx` already
> shows the user: *"It cannot guarantee any plan is free of a given allergen;
> always read labels."* No screen may promise more than that.

- [x] **C1 — Allergy synonym lists are materially incomplete.**
      **Done:** vocabulary hardened in `39ecc10`; residual gaps closed on
      `allergy-tier1` (17 fish species/roe/dashi ported from the style list;
      white chocolate — the last live leak in a 941-name pool sweep — plus
      burrata/toffee/caramel sauce/naan for dairy) and locked by
      `tests/allergySweep.test.js`: family-oracle drift test + full-corpus
      sweep + safe-food guards.
      `backend/src/lib/dietaryFilter.js` `CATEGORY_SYNONYMS` never got the
      exhaustive 854-food-name hardening the diet-style keywords got in Phase 4.
      Verified leaks: gluten (soy sauce, pastas, pastry, beer, hoisin — 16% of
      slots served wheat to a celiac test profile), dairy (cheese variety names:
      Mozzarella, Parmesan, Feta, Buttermilk…), shellfish (squid, calamari,
      octopus, seafood stock), fish (~20 species), eggs (aioli, custard),
      sesame (hummus).
      **Fix:** port every relevant member of the style keyword lists into the
      matching allergy category, add the gluten carriers, then write per-allergy
      regression tests that sweep the full food table like the Phase 4 audit did.
      This is the biggest single item on the list — budget a full session.

- [x] **C4 — "soy protein" as a free-text exclusion doesn't catch tofu/tempeh/edamame.** *(done in `39ecc10` — `"soy protein"` key exists, oil spared, tested)*
      Falls through to literal substring matching, so `Tofu` passes (verified live).
      **Fix:** add a `"soy protein"` key to `CATEGORY_SYNONYMS` (tofu, tempeh,
      edamame, soy milk, TVP, miso — deliberately NOT soybean oil), matching the
      definition `aiRecipeClient.js` already uses.

- [x] **C2 — AI recipe generation ignores the user's profile.** *(done in `fa571f6`)*
      `backend/src/lib/aiRecipeClient.js` hardcodes one person's three allergies
      for every account; a peanut-allergic user's drafts are never screened for
      peanuts. **Fix:** build the blocklist and prompt exclusions from
      `profile.excludedFoods` + `dietaryStyle`, keeping the static three as a floor.

- [x] **C3 — Legacy `/swap` endpoint writes an unfiltered AI recipe into the plan.** *(done in `fa571f6`)*
      `weeklyPlanner.js` `tryAiFallback` → enabled in `plans.js`. The UI no longer
      calls it, but the server route is live. **Fix:** simplest is to delete the
      endpoint; otherwise run its output through the dietary filter and return an
      honest unsolved slot on rejection.

- [x] **C5 + M11 — Profile validation gaps (one fix, two findings).** *(done in Stage C — vitals bounds in `validateProfilePatch` (`routes/profile.js`), `matchesExclusionTerm` hardened with `String(term ?? "")`)*
      ProfileTab commits zeroed age/height/goal on clear-then-blur (silently
      corrupts every derived number), and `excludedFoods` accepts non-strings
      (one bad element 500s plans and library until repaired).
      **Fix:** mirror the wizard's bounds in `ProfileTab.jsx`, add
      age/heightCm/goalWeightKg + array-of-nonempty-strings checks to
      `validateProfilePatch` in `routes/profile.js`, and harden
      `matchesExclusionTerm` with `String(term ?? "")`.

All five are closed. The remaining allergy work is in `BATTLE-PLAN.md` Phase 1.

---

## Tier 2 — Math & data integrity majors

- [x] **M1 — The documented RMR×0.95 safety floor isn't implemented.** *(done — `bmrEngine.js` `rmrFloor = Math.round(rmr * 0.95)`, now line 226)*
      `bmrEngine.js` `effectiveFloor` only takes max(sex floor, user floor); the
      constitution's RMR term is missing (proven 457 kcal shortfall case).
      **Fix:** thread `rmr` into `deriveTarget`, include `Math.round(rmr*0.95)`.

- [x] **M9 — accept-day / apply enforce no portion bounds.** *(done in `f59149c`)*
      `rebuildSlotFromClient` in `routes/plans.js` accepted a ×10 portion and a
      44,000-kcal slot in testing. **Fix:** validate grams against
      `baseGrams × [0.5, 2]` and derive scale labels server-side.

- [x] **M5 — Recipe edit is non-transactional.** *(done — `routes/recipes.js` wraps `PUT /recipes/:id` in `$transaction`, now line 425)*
      `PUT /recipes/:id` deletes ingredients before the fallible name update; a
      409 leaves new ingredients under old cached macros. **Fix:** wrap in
      `$transaction` (`training.js` already shows the pattern).

- [x] **M7 — Grocery list silently drops slots whose recipe was deleted.** *(done in `f59149c`)*
      Generation filters on `recipeId`, but the slot's ingredients JSON is intact
      and still rendered/cooked. **Fix:** filter on non-empty `ingredients` instead.

- [x] **M10 — Week-generate diagnosis blames diet/allergies when prep-time was
      the real constraint.** *(done in `f59149c`)* Pass raw/afterDiet/afterPrep counts into the week
      path's diagnosis the way day-options already does.

- [x] **M8 — Keto carb ceiling applies to the solver pool but not the library.** *(done in `f59149c` — `KETO_RECIPE_CARB_CEILING_G` single-sourced in dietaryFilter.js)*
      Keto users browse and cart 488 recipes the solver will reject with a
      misleading error. **Fix:** apply the ceiling in `GET /recipes`, count it
      in `hiddenCount`.

- [x] **M12 — Cart accepts and shops non-compliant recipes.** *(done in `f59149c`)*
      No flag when diet/allergies change after adding; grocery-list output can
      contain the allergen with no note. **Fix:** mirror the `skippedForDiet`
      compliance check in cart GET and grocery-list.

- [x] **M13–M15 — UI reliability cluster.** *(done — M13 in `f59149c`, M14/M15 + minors in `f5faad6`)*
      (a) Fresh-generate grocery list renders undecorated `bySection` — checkboxes
      dead, purchase units missing (return decorated data or group client-side
      from `items`); (b) rapid allergy/formula toggles race — concurrent PUTs from
      stale props can silently revert a safety toggle (serialize commits);
      (c) fire-and-forget handlers across Today/Plan/Recipes/Training/Engine/Foods
      swallow failed writes silently (wrap into each tab's existing error state);
      (d) draft save-errors keyed by array index attach to the wrong draft
      (key by stable client id).

---

## Tier 3 — Desktop app lifecycle (matters the moment you rebuild the installer)

- [x] **M2 — No schema-migration story for installed apps.** DONE 2026-07-19
      (`ca56345`): pending shipped Prisma migrations apply in-process on boot
      (auto-backup, one transaction per migration, `_prisma_migrations`
      bookkeeping); every /api request gates on the result and failures name
      the backup. Real installed DB upgraded cleanly. NOTE: schema only — the
      installed copy still carries the pre-Phase-2 food library (863 rows
      failing the audit); porting the Phase 2 data repair is a separate item.

- [x] **M3 — No single-instance lock, unhandled EADDRINUSE.** DONE — was
      unticked here for days while the code already existed.
      `app.requestSingleInstanceLock()` at `electron/main.cjs:103` with a
      `second-instance` focus-existing handler at `:107`; the listen `'error'`
      listener at `:452` gives a plain-language EADDRINUSE message at `:457`.
      **Residual:** the port is still fixed at 3001 — no free-port pick when
      packaged. The original risk (with the dev backend running, the packaged
      app silently reads/writes `dev.db` instead of the user DB) is now
      *reported* rather than silent, but not *avoided*.

- [ ] **M6 — Failed first-run copy bricks bootstrap permanently.**
      A 0-byte/partial DB file passes `existsSync` forever. **Fix:** post-copy
      integrity check (size + SQLite header + User table); re-copy or surface.

- [ ] **M4 — Installer payload.** Largely done, then re-broken by a new
      mechanism — **now tracked in `BATTLE-PLAN.md`, not here.** What landed:
      `extraResources` ships only `dev.db.template`, `predist` runs
      `buildTemplateDb.mjs && distPrecheck.mjs`, and `build.files` excludes
      `.env` / `dev.db` / `*.db.backup*`. What is still broken: those
      exclusions are a **denylist**, so `backend/.env.qc` and
      `dev.db.snapshot-agentcontam-*` (a real user DB) ship anyway — no
      pattern matches them. The fix is inverting `build.files` to an
      allowlist; see CLAUDE.md → Packaging. Do NOT "fix" this by adding
      another `!pattern`.

---

## Tier 4 — Worthwhile minors (curated from the audit's 34; rest are in the doc)

- [x] Negative carb targets render for high-LBM + floor-clamped profiles
      ("~0–-131 g" and a broken ratio bar) — clamp and show an honest note
      (`bmrEngine.js` macros). *(done in Stage C — #28 `carbMid` clamp, now
      `bmrEngine.js:344`)*
- [x] Imperial minimum weight (77 lb) is below the backend's 35 kg guard —
      entering the stated minimum 400s (`units.js` vs `weighins.js`).
      *(done in Stage C — #29, imperial min raised to 78 lb)*
- [x] Add Express error middleware — DONE, and unticked here for days:
      `backend/server.js:104` (`app.use((err, req, res, next) => …)`).
      **Residual:** `NODE_ENV=production` is still not set for the packaged
      app (no reference in `electron/main.cjs` or `backend/server.js`), so
      Express may still be more verbose than it should be in a shipped build.
- [x] `usdaClient` fetch has no timeout — the one external call that can hang
      minutes (importer and Anthropic calls are already bounded).
      *(done — `AbortSignal.timeout(10000)` in `usdaClient.js`, now line 80)*
- [ ] Window: minimum size + remember size/position; 860 px default clips 768p
      screens; menu removal killed all accelerators including devtools.
- [x] Week-plan generate/accept-day are non-transactional multi-step writes;
      locked slots can be deleted on meal-config shrink (`plans.js`).
      *(done on `allergy-tier1` — both rewrites wrapped in `$transaction`,
      `slotIdsToKeep()` preserves locked compliant slots through a shrink
      (L9 compliance gate kept), unit test + live route verification)*
- [ ] Add non-unique indexes on hot FK columns — **partially done.**
      `RecipeIngredient.foodId` has `@@index([foodId])`, and `recipeId` is
      deliberately left to its unique index (documented in the schema).
      Still missing: `PlanSlot.recipeId` (its `@@unique([planId, dayOfWeek,
      slotType, slotIndex])` does not cover it) and `CartItem.recipeId`
      (`@@unique([userId, recipeId])` is `userId`-leftmost, so lookups by
      `recipeId` alone are unindexed).
- [ ] Silent-failure odds and ends: weigh-in rejects invalid input with no
      message, PlanTab initial-load failure sticks on "Loading…", TodayTab
      conflates fetch error with "no plan yet", Enter bypasses the import busy
      guard (double import).

**Cosmetic (16 findings):** see the audit's COSMETIC section. None user-facing
in a way that matters; skip unless something in that list bugs you.

---

## Parked backlog (features, not defects — from the overhaul)

Two of these shipped while the list still called them parked:

- ~~Food diary~~ — **built.** `MealLog` model (`schema.prisma:582`, migration
  `20260719120000_add_meal_log`), `backend/src/routes/diary.js`.
- ~~Barcode import~~ — **built.** Open Food Facts lookup in
  `backend/src/routes/foods.js:18` + `frontend/src/components/BarcodeLookup.jsx`.
  Scope check: it imports a scanned product **into the food library**
  (`onImported`, wired from `FoodsTab.jsx:566`) — there is no barcode → diary
  path, so the Compare table's "barcode/photo quick-logging: no" is still
  correct for Cut Protocol.
- Grocery price coverage beyond common staples
- Mobile packaging
- Vite chunk >500 kB code-split (cosmetic for a desktop app; the build still
  warns at ~863 kB)

## Five-minute manual items (no code)

- [ ] Upload `assets/social-preview.png` at GitHub → Settings → Social preview
- [ ] Pin cut-protocol on your profile (Customize your pins)
