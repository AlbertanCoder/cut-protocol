# Cut Protocol — Allergies 2.0 / Five Filters / Any-Horizon / Library→Brain Router

Execution log for the owner's master prompt, run autonomously 2026-07-24.
Every status here is backed by real command output, not assertion.

---

## STAGE 0 — Make it launch, and PROVE it. ✅ COMPLETE

**Root cause, in one sentence (the spec asks for exactly this):** the app didn't
open because three separate faults stacked — `Cut Protocol.exe` had been moved
out of its own application folder so the Start Menu shortcut pointed at nothing,
the Jul 19 build it pointed to died during startup on a pruned `effect` module,
and the migration that would have upgraded it created a `UNIQUE INDEX` on
`Food.fdcId` without deduplicating first.

**Corrections to the spec's premises** (it was written against a stale snapshot):

| Spec claim | Measured reality |
|---|---|
| "200+ uncommitted files" | 1 modified, 5 untracked — the tree was committed and pushed hours earlier |
| "four edited already-applied migration files" | **One** (`20260722045659`), the dedupe |
| "confirm whether the runner keys on NAME or re-validates checksums" | Answered: **name only**, `desktopBootstrap.js:310-319`; it never validates checksums of applied migrations — which is precisely why editing that migration was safe |
| Stage 4: "generate-drafts is a second LLM stack NOT behind the brain gate" | **Already closed** (`brain-stack-1`), with a structural test that fails if any new route escapes governance |

**Proven, both launch modes:**
- Packaged build boots (`packaged=true`), migrated the real installed DB
  **13 → 24 migrations** with duplicate `fdcId` groups **194 → 0** and
  **zero rows lost** (Food 973, Recipe 634, RecipeIngredient 6224, Plan 2,
  PlanSlot 63, TrainingExercise 72 — all identical before/after; FK check 0).
- API answers: `{"needsSetup":false}` 200.
- Dev mode boots and serves on `127.0.0.1:3001`.

**Also fixed in Stage 0:**
- `/auth/me` returned **404** for a session whose user no longer exists. The
  client treats only 401 as an auth failure, so a 404 fell into the "server
  never answered" bucket and rendered *"Can't reach the app's server / user not
  found / You are not signed out"* — three contradictory claims, a Retry that
  could never succeed, and no route to sign-in. Now 401 + cookie cleared.
- Both distribution gates (`distPrecheck`, `checkDistSafe`) were failing builds
  on a phantom email. They scanned the SQLite file as raw text, so the regex
  straddled a real `Recipe.source` value (`themealdb-import`) and adjacent cuid
  noise reading as `@p.fffff`. Both now confirm candidates against actual
  columns. Verified a real address still blocks the build.
- `runTests.mjs` could not parse its own summary when `node --test` colourised
  output — it reported TRIPWIRE on a suite that passed 926/926. ANSI codes are
  now stripped before matching.

---

## PREREQUISITE (inserted before Stage 1) ✅ COMPLETE

Stage 1 instructs: enforce via "name keywords, USDA `fdcCategory`, and OFF
`allergenTags`/`mayContain` — **USE them**."

Those columns existed and were **0% populated on all 14,122 foods**. A taxonomy
keyed on them would have matched nothing while the name probe kept firing —
a safety net wired to an empty table, which is the most dangerous possible
shape for an allergy feature.

Backfilled `fdcCategory` from the **local** cache (`backend/data/fdc-cache/fdc-index.json`,
13,545 records) — no API, no network, no key. **13,516 candidates, 13,516
matched, 0 misses.**

Newly caught leaks, measured:

| Food | Allergen | Why the name alone failed |
|---|---|---|
| `Cinnamon` | gluten | renamed from "Bread, cinnamon" — rename destroyed the only name evidence |
| `Oatmeal` | gluten | renamed from "Bread, oatmeal" — same |
| `Rolls, hard (includes kaiser)` | gluten | no listed token in the name |
| `Dessert topping, pressurized` | dairy | hidden casein |

Pool effect: gluten 449 → 437, eggs 652 → 632.

`allergenTags`/`mayContain` remain 0% — correct, they only arrive via barcode
import, and that write path is verified working end to end.

---

## STAGE 1 — Allergies 2.0 · BUILT + LIVE
- 48-entry allergen taxonomy served live at `GET /api/meta/allergens` (verified 200).
- 19 measured dead free-text phrasings now resolve (`cow's milk`, `gluten free`,
  `no dairy`, `milk allergy`…): 0 of 889 → 578 recipes excluded. `gluten free`
  now resolves identically to `gluten`.
- Predictive search UI (AllergySearch.jsx): combobox/listbox, arrow-key nav,
  free-text chips, the "text-only match" honesty signal finally rendered.
- Over-exclusion fixed, 23 rows released (all intended); one honest deviation —
  only 4 of 16 creamers released, the other 12 undeclared with sodium caseinate.

## STAGE 2 — Any-horizon generation · BUILT + LIVE
- 1 meal / 1 day / 3 days / 1 week / 2 weeks / 1 month + custom N. Month is 4
  week-solves sharing one variety ledger; the pool is only narrowed.
- Measured: 28-day p95 689ms, 1-meal p95 2.94ms. `GET /api/plans/horizons` live.
- Caught a latent divide-by-zero: targetsForSlots read its weight off day 0
  unconditionally → NaN for any non-Monday window.

## STAGE 3 — The five filters · BUILT + LIVE (backend); UI in Stage 5 pass
- Migration 20260724120000 applied to the real dev.db (backup taken, proven on a
  copy first). Backfill: costPerServing 0→889, difficulty 0→889, prepTimeMin
  633→889 (measured never overwritten).
- Solver applies the cost/complexity/taste caps on the already allergy/diet-
  filtered pool at all three solve sites, and names the binding cap on failure.
- Unknown-cost falls back to the category 75th percentile, never $0.

## STAGE 4 — Library→Brain router · BUILT + LIVE
- weeklyPlanner.tryAiFallback routes through mealRouter by default: library-first
  (free), cache, brain-on-gap through the existing governed door, verify-then-
  gate (re-screens RESOLVED ingredients, not just model-named), cache-forever,
  per-user cost caps. The injected-generator seam is preserved and bypasses the
  router, so existing tests are behaviour-identical.
- No live model call in tests: injected client throws if reached; LlmUsage
  unchanged 12→12.

## STAGE 5 — Progress UX + Stage 3 filter controls · BUILT
- Four optional filter caps in PlanTab's generate panel, each with an explicit
  OFF state; cost carries the "estimated, not live pricing" disclosure and uses
  --ink (cost is not a macro, never green).
- Honest staged generation progress (no fake %), Cancel aborts the in-flight
  request and returns a clean retryable state.
- Also closed a real gap S5 found in the Stage-3 backend wiring: the PRIMARY
  week/month Generate applied prep but not the caps; plans.js now applies
  applyFilterStack at its single narrowing point. Proven: maxCostCad=3 -> 330.
- oxlint + vite build clean. NOT browser-verified (see Stage 6 note).

## STAGE 6 — The 10-agent QC gauntlet · RUNNING (per owner)
Read-only reproduce-and-report fleet, all against the live app + scratch DB
copies, zero live model calls. Results land in docs/qc/gauntlet-2026-07-24/.
- qc07 migration/upgrade: **PASS** — 0 row loss across 8 real DBs to migration 25.
- qc08 UI reachability: **BLOCKED** at auth — Chrome has no Electron session and
  registration is gated (dev.db already has users). Boot dead-end confirmed GONE;
  login renders clean. A fresh-install self-driven walk is the way to close this.

**Suite: 84 files, 1032 tests, 0 failures.**

_Updated as each stage's DoD is met._
