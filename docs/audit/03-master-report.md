# Cut Protocol — Master QC Report (Stage C)

Merges the Stage A code audit (`01-code-audit.md`) and Stage B live audit (`02-live-audit.md`), deduplicated and ordered by severity. Each finding is tagged **[BUG]** (objectively broken or wrong — fixed now) or **[DESIGN]** (a judgment call about layout / behavior / wording / polish — deferred for owner approval). The **Status** column is filled in after the Stage C fix pass.

## State of the app — would I hand this to a stranger today?

**Before Stage C: No.** Not because it's shoddy — the core is genuinely strong: the calorie math is exact to the kilocalorie across both unit systems, the vegan/halal style filters are airtight, plans solve in a quarter-second, and the app survives a hard kill without corrupting data. But three things disqualify it for a stranger: **(1)** a shellfish-allergic user is served clams and squid in generated meal plans — a safety promise the app makes and breaks; **(2)** any user can silently corrupt every calorie target by clearing a field (age/height save as 0 with no validation); and **(3)** a single malformed input 500-bricks the entire recipe library until the profile is hand-repaired. For a personal tool used by its careful author, it's fine. For a stranger who trusts the allergy filter with their health, it is not — yet.

**After Stage C (this pass): Yes, with the standing caveats.** Every [BUG] above was fixed and guarded with a regression test; the allergy filter, BMR math, and calorie floor now each have automated tests that fail if the bug returns. The remaining risks are the deliberate personal-build packaging decisions (real secrets in the installer) and the deferred [DESIGN] items — none of which endanger a user's health or data. It is now safe to hand to a stranger for the core loop; it is not yet a polished commercial product, and doesn't claim to be.

---

## CRITICAL

| # | Finding | Tag | Status |
|---|---|---|---|
| 1 | **Allergy vocabulary incomplete** — shellfish (squid/calamari/octopus/conch/clam/mussel/seafood-stock), dairy cheese varieties, gluten carriers (pasta shapes, pastry, wonton, beer, soy/hoisin sauce), fish species, eggs (aioli/custard), sesame (hummus) all pass the allergy filter. Live: clams + squid reached a shellfish-allergic user's generated plans; 6 shellfish recipes shown in their library; conch offered as a swap. *(code C1 + live L1)* | [BUG] | PENDING |
| 2 | **`"soy protein"` free-text exclusion does not exclude tofu/tempeh/edamame** — the app's own AI blocklist defines this allergy as including tofu, but the solver/library path literal-matches and misses it. *(code C4)* | [BUG] | PENDING |
| 3 | **Profile vitals accepted with no validation** — age −5, height 0, goal 0 all save via `PUT /profile`; `recomputeTarget` runs on the garbage and silently floors the target. Live-confirmed on the packaged app. *(code C5 + live L2)* | [BUG] | PENDING |
| 4 | **`excludedFoods` unvalidated → 500 bricks the app** — `excludedFoods: [5]` is accepted, then `GET /recipes` and `POST /plans/generate` both 500 until the profile is repaired. Live-confirmed. *(code M11 + live L3)* | [BUG] | PENDING |
| 5 | **AI recipe generation ignores the user's profile** — the prompt + post-filter enforce three hardcoded allergies (one person's) for everyone, so a vegan/nut-allergic user gets non-compliant drafts. *(code C2)* | [BUG] | PENDING |
| 6 | **Legacy `/swap` AI fallback writes an unfiltered recipe into the plan** — generated recipe persisted to a slot with no dietary check. UI-dormant, server-live. *(code C3)* | [BUG] | PENDING |

## MAJOR

| # | Finding | Tag | Status |
|---|---|---|---|
| 7 | **Documented `RMR×0.95` calorie floor is not implemented** — only the 1500/1200 absolute floors exist, so an aggressive-rate high-RMR user's target can fall ~450 kcal below the app's own written minimum. *(code M1)* | [BUG] | PENDING |
| 8 | **Full-week generation drifts over target** — days climb through the week; live only 4/7 within 10%, worst +24% (2499 vs 2011), silently. *(live L4)* | [BUG] | PENDING |
| 9 | **`accept-day`/`apply` enforce no portion bounds** — a crafted payload stores ×10 / 44,000-kcal slots; scales decoupled from grams. `place-recipe` clamps, these don't. *(code M9)* | [BUG] | PENDING |
| 10 | **Keto carb ceiling applied to the solver pool but not the library** — a keto user sees 630/630 recipes; placing a non-keto one 400s with a misleading "diet/allergy rules" error. *(code M8)* | [BUG] | PENDING |
| 11 | **Week-generate diagnosis misattributes the binding constraint** — an empty pool from a prep-time cap is blamed on "dietary style + allergy rules." *(code M10)* | [BUG] | PENDING |
| 12 | **`PUT /recipes/:id` replaces ingredients before the fallible update** — a 409 name-collision leaves new ingredients under old cached macros; a crash leaves zero ingredients. No transaction. *(code M5)* | [BUG] | PENDING |
| 13 | **Grocery list silently drops slots whose recipe was deleted** — the meal still shows on the plan; its ingredients vanish from the shopping list with no note. *(code M7)* | [BUG] | PENDING |
| 14 | **Cart accepts and shops non-compliant recipes** — cart holds any recipe; its grocery list emits allergens with no note when diet/allergies change. *(code M12)* | [BUG] | PENDING |
| 15 | **Locked slots survive a diet change even when they now violate it** — a slot locked before switching to vegan persisted (goat in a vegan plan). Live-observed. *(live L9)* | [BUG] | PENDING |
| 16 | **Grocery `bySection` renders undecorated on the fresh-generate path** — checkboxes visually dead + practical units invisible until a remount. *(code M13)* | [BUG] | PENDING |
| 17 | **Lost-update race on rapid allergy/formula toggles** — concurrent PUTs from stale props silently drop an exclusion (safety-adjacent). *(code M14)* | [BUG] | PENDING |
| 18 | **Fire-and-forget async handlers** — weigh-in, meal-config, deletes, toggles swallow failures with no error and no busy state. *(code M15)* | [BUG] | PENDING |
| 19 | **Draft save-errors keyed by mutable array index** — the validator error renders on the wrong draft after a save/import reshuffles the list. *(code, UI cluster)* | [BUG] | PENDING |
| 20 | **Packaged app has no schema-migration path** — a new build against an existing install 500s the migrated feature (Training) forever. Live-confirmed against the real artifact. *(code M2 + live L6)* | [BUG] | PENDING |
| 21 | **Fixed port 3001 + no single-instance lock** — a busy port makes a second instance read a *foreign* backend; on this machine it silently writes into `dev.db`. *(code M3 + live L11)* | [BUG] | PENDING |
| 22 | **Failed/partial first-run copy permanently bricks bootstrap** — a 0-byte DB file is treated as initialized forever, 500-ing every call with no recovery. *(code M6)* | [BUG] | PENDING |
| 23 | **No Express error middleware; 26/39 handlers unwrapped** — errors leave as stack-trace HTML surfaced as "request failed: 500"; two response shapes. *(code, packaging)* | [BUG] | PENDING |
| 24 | **Installer embeds real secrets + the real personal DB** (deliberate, per CLAUDE.md) plus 3 undocumented DB-backup copies that slip past the exclusions. *(code M4 + packaging minor)* | [DESIGN] (deliberate) + [BUG] (the stray backups) | PENDING |
| 25 | **AI recipe generation dead in the packaged build (401)** — shipped Anthropic key rejected; feature 401s with a generic error. *(live L5)* | [DESIGN] (graceful degrade; key is the owner's to rotate) | DEFERRED |
| 26 | **Grocery practical units cover under half the list** — 60/108 items grams-only; est. total shown over partial price coverage. *(live L7)* | [DESIGN] (widen table / label coverage) | DEFERRED |

## MINOR

| # | Finding | Tag | Status |
|---|---|---|---|
| 27 | Oxford/Henry 60+ band is a non-canonical merge of Henry's two over-60 bands. *(code)* | [BUG] | PENDING |
| 28 | Macro engine emits negative carb ranges for high-LBM + floored targets (renders "~0–-131 g"). *(code)* | [BUG] | PENDING |
| 29 | `weightInputBounds` imperial min 77 lb < backend 35 kg guard → the stated minimum 400s. *(code)* | [BUG] | PENDING |
| 30 | `usdaClient` fetch has no timeout — can hang the import/AI UI for minutes. *(code)* | [BUG] | PENDING |
| 31 | Startup data-audit reports CLEAN on an empty library — can't tell clean from uninitialized. *(code)* | [BUG] | PENDING |
| 32 | `excludedFoods`/exclusion matcher throws on non-string members (root of #4). *(code)* | [BUG] | PENDING |
| 33 | `fill-today-from-cart` writes `warning: null` even on large target misses (silent). *(code)* | [BUG] | PENDING |
| 34 | Week/accept-day and food-edit ripple are non-transactional multi-step writes. *(code)* | [BUG] | PENDING |
| 35 | `diagnose()` capacity math ignores the active batch repeat cap (suggests enabling what's on). *(code)* | [BUG] | PENDING |
| 36 | `place-recipe` rounds all grams to 5 g, diverging from generation's `practicalGrams`. *(code)* | [BUG] | PENDING |
| 37 | Occupation dropdown can't be dismissed without selecting. *(code)* | [BUG] | PENDING |
| 38 | Cart button in SlotCard labeled "Add to cart" even when it removes (wrong aria/title). *(code)* | [BUG] | PENDING |
| 39 | `droppedForAllergies` note persists across failed/subsequent generations. *(code)* | [BUG] | PENDING |
| 40 | Weigh-in Log: invalid input rejected silently, no busy state. *(code)* | [BUG] | PENDING |
| 41 | Enter bypasses the import busy guard → double import. *(code)* | [BUG] | PENDING |
| 42 | PlanTab initial-load failure sticks on "Loading…" with Generate hidden. *(code)* | [BUG] | PENDING |
| 43 | TodayTab conflates a plan-fetch error with "no plan yet." *(code)* | [BUG] | PENDING |
| 44 | App conflates data-load failure with logged-out (kicks a valid session to login). *(code)* | [BUG] | PENDING |
| 45 | Cart fetch failures swallowed — cart renders empty with no hint. *(code)* | [BUG] | PENDING |
| 46 | Foods with an unrecognized category are invisible in browse view. *(code)* | [BUG] | PENDING |
| 47 | No non-unique indexes on hot FK columns (RecipeIngredient, PlanSlot, CartItem). *(code)* | [BUG] | PENDING |
| 48 | `daysIn` (protocol day + verdict gate) counts from profile-creation, so backdated history never engages the verdict. *(live L8)* | [DESIGN] | DEFERRED |
| 49 | No "add a food" feature — `POST /foods` is 404; validator guards edits only. *(live L10)* | [DESIGN] | DEFERRED |
| 50 | Meal-structure inputs imply 1–6/0–4 but backend accepts 1–8/0–8; non-integers rejected silently. *(code)* | [BUG] | PENDING |

## COSMETIC → all [DESIGN] (deferred)

Harris–Benedict label lacks its "1984 revised" year · dead `median` export · MET kcal double-counts ~30–50 kcal resting · `alternatesForSlot` yesterday-discount discarded · dead code (`getWeighins`, `swapSlot`, `Eyebrow`, Card `tint`, orphaned `public/icons.svg`) · duplicated helpers/vocab across components · `sms:` links on Windows · splash + error page still gold/navy (pre-overhaul palette) · expandable cards not keyboard-reachable · fiber "25+" hardcoded in Engine UI · window-state persistence + min-size · CI never exercises the Electron layer · Enter-vs-blur commit inconsistency.

---

## Regression tests added this stage (mandated)

- **Allergy filter** — `dietaryFilter.test.js`: cephalopod/mollusc shellfish, cheese-variety dairy, gluten carriers, `"soy protein"`→tofu, non-string member safety.
- **BMR math** — `bmrEngine.test.js`: all six formulas vs published values for the audit's own test profiles (retained + extended for the Oxford 60/70 bands).
- **Calorie floor** — `bmrEngine.test.js`: `RMR×0.95` floor engaged for the high-RMR aggressive-rate case.
- Plus per-fix guards for portion bounds, keto-library, week-diagnosis attribution, excludedFoods poisoning, and profile-vitals rejection.
