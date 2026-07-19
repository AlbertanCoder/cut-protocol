# Cut Protocol — Work List

Distilled from the QC audit (`docs/audit/01-code-audit.md`, 2026-07-18, 67 findings)
into something you can actually chip away at. Finding IDs (C1, M3…) cross-reference
the audit, which has full evidence, exact line numbers, and suggested fixes for
every item. Work top to bottom — the tiers are ordered by how much they matter.

Rule of thumb per session: pick ONE item, fix it, add/flip the regression test,
verify live, commit. Same discipline as the overhaul phases.

---

## Tier 1 — The allergy promise (fix before everything else)

The app's one zero-tolerance rule ("nothing excluded is ever surfaced") is
currently broken in six allergy categories. This tier restores it.

- [ ] **C1 — Allergy synonym lists are materially incomplete.**
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

- [ ] **C4 — "soy protein" as a free-text exclusion doesn't catch tofu/tempeh/edamame.**
      Falls through to literal substring matching, so `Tofu` passes (verified live).
      **Fix:** add a `"soy protein"` key to `CATEGORY_SYNONYMS` (tofu, tempeh,
      edamame, soy milk, TVP, miso — deliberately NOT soybean oil), matching the
      definition `aiRecipeClient.js` already uses.

- [ ] **C2 — AI recipe generation ignores the user's profile.**
      `backend/src/lib/aiRecipeClient.js` hardcodes one person's three allergies
      for every account; a peanut-allergic user's drafts are never screened for
      peanuts. **Fix:** build the blocklist and prompt exclusions from
      `profile.excludedFoods` + `dietaryStyle`, keeping the static three as a floor.

- [ ] **C3 — Legacy `/swap` endpoint writes an unfiltered AI recipe into the plan.**
      `weeklyPlanner.js` `tryAiFallback` → enabled in `plans.js`. The UI no longer
      calls it, but the server route is live. **Fix:** simplest is to delete the
      endpoint; otherwise run its output through the dietary filter and return an
      honest unsolved slot on rejection.

- [ ] **C5 + M11 — Profile validation gaps (one fix, two findings).**
      ProfileTab commits zeroed age/height/goal on clear-then-blur (silently
      corrupts every derived number), and `excludedFoods` accepts non-strings
      (one bad element 500s plans and library until repaired).
      **Fix:** mirror the wizard's bounds in `ProfileTab.jsx`, add
      age/heightCm/goalWeightKg + array-of-nonempty-strings checks to
      `validateProfilePatch` in `routes/profile.js`, and harden
      `matchesExclusionTerm` with `String(term ?? "")`.

When this tier is done, commit it as its own milestone (e.g. "Close the audit's
critical findings") — it completes the story the public audit started.

---

## Tier 2 — Math & data integrity majors

- [ ] **M1 — The documented RMR×0.95 safety floor isn't implemented.**
      `bmrEngine.js` `effectiveFloor` only takes max(sex floor, user floor); the
      constitution's RMR term is missing (proven 457 kcal shortfall case).
      **Fix:** thread `rmr` into `deriveTarget`, include `Math.round(rmr*0.95)`.

- [ ] **M9 — accept-day / apply enforce no portion bounds.**
      `rebuildSlotFromClient` in `routes/plans.js` accepted a ×10 portion and a
      44,000-kcal slot in testing. **Fix:** validate grams against
      `baseGrams × [0.5, 2]` and derive scale labels server-side.

- [ ] **M5 — Recipe edit is non-transactional.**
      `PUT /recipes/:id` deletes ingredients before the fallible name update; a
      409 leaves new ingredients under old cached macros. **Fix:** wrap in
      `$transaction` (`training.js` already shows the pattern).

- [ ] **M7 — Grocery list silently drops slots whose recipe was deleted.**
      Generation filters on `recipeId`, but the slot's ingredients JSON is intact
      and still rendered/cooked. **Fix:** filter on non-empty `ingredients` instead.

- [ ] **M10 — Week-generate diagnosis blames diet/allergies when prep-time was
      the real constraint.** Pass raw/afterDiet/afterPrep counts into the week
      path's diagnosis the way day-options already does.

- [ ] **M8 — Keto carb ceiling applies to the solver pool but not the library.**
      Keto users browse and cart 488 recipes the solver will reject with a
      misleading error. **Fix:** apply the ceiling in `GET /recipes`, count it
      in `hiddenCount`.

- [ ] **M12 — Cart accepts and shops non-compliant recipes.**
      No flag when diet/allergies change after adding; grocery-list output can
      contain the allergen with no note. **Fix:** mirror the `skippedForDiet`
      compliance check in cart GET and grocery-list.

- [ ] **M13–M15 — UI reliability cluster.**
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

- [ ] **M3 — Fixed port 3001, no single-instance lock, unhandled EADDRINUSE.**
      Real risk on this machine: with the dev backend running, the packaged app
      silently reads/writes `dev.db` instead of the user DB. **Fix:**
      `requestSingleInstanceLock` + focus-existing, an `'error'` listener on
      listen with a plain-language message, free-port pick when packaged.

- [ ] **M6 — Failed first-run copy bricks bootstrap permanently.**
      A 0-byte/partial DB file passes `existsSync` forever. **Fix:** post-copy
      integrity check (size + SQLite header + User table); re-copy or surface.

- [ ] **M4 — Installer embeds real secrets and the real personal DB.**
      Documented-deliberate for the personal build — but nothing enforces the
      "revert before distribution" rule. **Fix (before ANY distribution):**
      generate JWT secret on first run, prompt/store API keys in userData, build
      the template DB from migrations + seeds, and add a `dist` precheck that
      fails the build if real files are present. Until then, also trim the
      unintended payload: 3 dev.db backups, audit reports, 42 MB of stale
      engine temp files ship in the installer today.

---

## Tier 4 — Worthwhile minors (curated from the audit's 34; rest are in the doc)

- [ ] Negative carb targets render for high-LBM + floor-clamped profiles
      ("~0–-131 g" and a broken ratio bar) — clamp and show an honest note
      (`bmrEngine.js` macros).
- [ ] Imperial minimum weight (77 lb) is below the backend's 35 kg guard —
      entering the stated minimum 400s (`units.js` vs `weighins.js`).
- [ ] Add Express error middleware + set `NODE_ENV=production` in the packaged
      app — 26/39 handlers are unwrapped and errors leave as stack-trace HTML.
- [ ] `usdaClient` fetch has no timeout — the one external call that can hang
      minutes (importer and Anthropic calls are already bounded).
- [ ] Window: minimum size + remember size/position; 860 px default clips 768p
      screens; menu removal killed all accelerators including devtools.
- [ ] Week-plan generate/accept-day are non-transactional multi-step writes;
      locked slots can be deleted on meal-config shrink (`plans.js`).
- [ ] Add non-unique indexes on hot FK columns (RecipeIngredient.recipeId/foodId,
      PlanSlot.recipeId, CartItem.recipeId).
- [ ] Silent-failure odds and ends: weigh-in rejects invalid input with no
      message, PlanTab initial-load failure sticks on "Loading…", TodayTab
      conflates fetch error with "no plan yet", Enter bypasses the import busy
      guard (double import).

**Cosmetic (16 findings):** see the audit's COSMETIC section. None user-facing
in a way that matters; skip unless something in that list bugs you.

---

## Parked backlog (features, not defects — from the overhaul)

- Food diary — log what was actually eaten, not just planned. Top of the
  backlog; the audit and Pablo both called it the category's table stakes.
- Barcode import for packaged foods
- Grocery price coverage beyond common staples
- Mobile packaging
- Vite chunk >500 kB code-split (cosmetic for a desktop app)

## Five-minute manual items (no code)

- [ ] Upload `assets/social-preview.png` at GitHub → Settings → Social preview
- [ ] Pin cut-protocol on your profile (Customize your pins)
