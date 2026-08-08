# The Recipe Brain

**Status:** library landed, wired to no route yet. 6 test files / 59 tests, all
green, zero network, zero DB. Built 2026-08-06 against `master` 8796f5f.

---

## Why a third brain

The app already has two. The **target engine** (bmrEngine / adaptiveTarget /
profileTarget) decides what a day must add up to. The **solver + portion
brains** (mealSolver / weeklyPlanner / brain/optimizer) arrange what exists into
days and decide what grams ship.

Neither can change **what exists**. And the July 2026 fleet investigation
measured, with numbers, that *what exists* is the binding constraint:

- **the protein-density wall** — on the engineered 6-allergen stack, 17 recipes
  were meal-eligible and **zero** cleared even the max-tolerance protein-density
  floor of 5.82 g P/100 kcal. No portion of no recipe in that pool can pass. The
  solver's only honest move is to say so.
- **the fat-fraction wall** — the pool's median recipe carries 0.442 of its
  energy as fat against targets needing ~0.232. 64.7% of baseline days landed
  above the fat band, and the fat-under bucket was **empty**.
- the measured consequence: **38.8%** of feasible days landed within ±5% kcal;
  under the campaign's own metric, 70.1% all-days / 77.8% satisfiable.

A solver cannot fix a pool. A **recipe brain** can — by specifying exactly what
the gap needs, then sourcing or designing a recipe that meets the spec, through
the cheapest channel that can.

## The four channels, in cost order

```
 0  SPEC       what does this gap actually need?          spec.js
 1  CACHE      a recipe a previous request already paid   sources/cacheSource.js
               for, found by durable fingerprint          0 calls, 0 fetches
 2  LIBRARY    matrix-ranked scan of the walled pool      sources/librarySource.js
                                                          0 calls, 0 fetches
 3  WEB        owner-enabled sites, robots-respecting,    sources/webSource.js
               through the Phase 5 importer               fetches, no key
 4  AI         the governed generator, aimed by the spec  sources/aiSource.js
                                                          costs money
 5  DEGRADE    the closest deterministic fit + the        orchestrator.js
               MEASURED reason it's a miss
```

Every channel's output faces the **same** verify gate — `mealRouter.verifyDraft`
(post-resolution names → the real pool filter with its metadata probes →
placeholder audit → macro math) plus the matrix caps. A web import and an AI
draft are screened identically, because both are proposals from outside the
trust boundary.

Every success is **cached forever**: a verified generated recipe persists as an
ordinary library row stamped with the constraint fingerprint that produced it.
The same gap is never paid for twice, and coverage climbs as the library learns
the user's constraint space.

## The five parts

### `spec.js` — the RecipeSpec

Turns a slot target + the day's macro bands + the user's dials into one
provenanced object stating what a recipe must satisfy:

| field | meaning | formula |
|---|---|---|
| `proteinDensityMid` | g protein per 100 kcal, on target | `proteinTarget / kcalTarget × 100` |
| `proteinDensityFloor` | the weakest density that can still pass the slot gate | `proteinTarget×(1−0.12) / (kcalTarget×(1+0.15)) × 100` |
| `fatTargetG` / `carbTargetG` | the day band × the slot's kcal share | guidance only, never a ruler |
| `fatEnergyFracMax` | fat-energy fraction to aim under | `min(slot band ceiling×9/kcal, 0.35)` |
| `caps` / `soft` | the matrix dials, filters over profile | — |
| `walls` | diet + exclusions, carried for prompts | **enforced upstream, always** |

The 0.35 ceiling is the widest defensible number in the cited literature
(Helms 2014, Iraki 2019, ISSN 2017 — none of which supports a *tight* upper fat
band). It steers sourcing. It is **not** a new pass/fail rule; the rulers stay
single-sourced in `mealSolver.dayTolerance` and `weeklyPlanner`'s tolerances.

`meetsDensityFloor()` is the cheap necessary-condition screen: a recipe whose
best bundle sits under the floor cannot pass at any legal portion, so it is
skipped before anything is spent on it.

`gapSpecsFromDay()` reads a solved day candidate and turns every slot the
**solver itself** flagged into a spec — reading the solver's own warnings rather
than re-judging with new math, so the recipe brain can never disagree with the
plan screen about what missed.

### `matrix.js` — the adherence façade

Composes what already exists rather than inventing scoring:
`recipeCost.scoreRecipe` / `explainPool` supply the cost/time/complexity/taste
caps and the honest-fail explanation; `mealSolver.buildBias` supplies the soft
biases (cuisine ×3/×0.7, protein mention, budget tier, thumbs ratings). The bias
multiplier is normalised into (0..1], so **caps gate and bias only orders** — a
soft-preference match can never buy a candidate past a failed cap.

When the stack empties the pool, `rankPool` hands back the measured binding
constraint: *"your $3 cap removes 41 recipes"*, not *"nothing found"*.

### `tweak.js` — the guarded refit engine

Two moves, in order.

1. **Two-factor portioning** — `weeklyPlanner.scaleRecipe` through
   `enforceScaledCarbCeiling`, unchanged. With no fat/carb guidance in the spec,
   `refit()` returns *byte-identically* what the solver would have produced.
2. **Guarded role repartition** — only when the spec carries fat/carb guidance
   the first move missed. Re-solves portions over role bundles (protein / carb /
   veg / fat / other) against the full 4-axis target using the existing
   `brain/optimizer.solvePortions`, then **accepts only if the result still
   passes the slot gate AND strictly improves the measured deviation.**

The guard is not a nicety — it is the fleet's finding. Variant H (guarded)
took filled-day pass 9.8% → 26.0% with zero regressions; the same move
*unguarded* destroyed the oracle score (49.0 → 16.3).

Structural safety: the engine only ever **scales**. It never adds, removes, or
substitutes an ingredient, so it cannot introduce an allergen. Every scale stays
inside the same 0.5–2 box the server validates per ingredient, fixed rows stay
at 1×, and a keto ceiling breach is a rejection — never a half-repaired portion.

### `sources/` — the four channels

- **library** — matrix-ranked, density-screened, refit-tested, capped at 40
  refit attempts.
- **cache** — wires the `Recipe.aiFingerprint` / `aiVerifiedAt` / `aiVerifiedBy`
  columns that migration `20260724120000` created and **nothing had ever read or
  written**. A row with a null `aiVerifiedAt` is never served. Every hit is
  re-screened: still in the walled pool, still passes the caps, still fits now.
  A lookup that throws is a **miss**, never an error — recorded, and the library
  scan answers what the index could not.
- **web** — the curated registry (`backend/data/recipeSources.json`) ships with
  every site **disabled**, so the channel is a no-op until the owner opts in.
  robots.txt is fetched per request and honoured **fail-closed** (unreachable =
  site skipped). Same SSRF guard as the manual importer, identified user-agent,
  same-host links only, one import per URL ever, hard per-site cap, ≥1s courtesy
  delay between page fetches.
- **ai** — the spec rides into the prompt. The router asks for "~620 kcal, ~45 g
  protein"; a spec-driven ask adds the fat/carb bands, the cost ceiling and the
  density target — because the drafts the verifier keeps throwing away fail on
  exactly those axes. Better-aimed asks mean fewer discarded drafts, which means
  less spend for the same coverage. Everything else is `mealRouter`'s discipline
  verbatim: the governed door only, cheapest capable model first, escalate only
  after a failure a bigger model can plausibly fix.

### `orchestrator.js` — the conductor

`solveRecipeForSlot()` runs the ladder and returns an outcome that always
carries its spec, fingerprint, matrix, the full per-channel attempt trail, and —
when it degrades — the measured reason.

`fillDayGaps()` and `solveDayWithGapFill()` are the synergy loop:

```
solver day candidate
  → gapSpecsFromDay        (the solver's own misses become specs)
  → solveRecipeForSlot ×N  (cache → library → web → AI, verified, cached forever)
  → enriched pool through filterRecipePool
  → solver again           (every rule back in force: variety, locks, tolerances)
  → keep whichever day scores higher ON THE SOLVER'S OWN matchPct
```

Recipes already placed on the candidate day are excluded from gap sourcing —
otherwise the brain re-finds what the solver already used and brings nothing new
to the re-solve.

`routeSlotCompat()` is a drop-in for `mealRouter.routeMealSlot`, so the solver's
unattended fallback upgrades to the full recipe brain by **injecting a function**
— no edit to `weeklyPlanner` required.

## What it does not do

- It does not judge days. `dayTolerance` is the solver's, and stays the solver's.
- It does not enforce walls. `filterRecipePool` is the safety boundary; every
  channel routes through it and none re-implements it.
- It does not touch a model transport. `brain/governance.js` remains the one door.
- It does not swap ingredients. Scaling only — see the structural invariant above.
- It does not fetch anything by default. Zero enabled web sources out of the box.

## Files

```
backend/data/recipeSources.json                        curated registry (all disabled)
backend/src/lib/recipeBrain/index.js                   barrel
backend/src/lib/recipeBrain/spec.js                    the RecipeSpec + fingerprint + gap specs
backend/src/lib/recipeBrain/matrix.js                  adherence façade over the five filters
backend/src/lib/recipeBrain/tweak.js                   guarded two-move refit engine
backend/src/lib/recipeBrain/orchestrator.js            the ladder + the solver loop
backend/src/lib/recipeBrain/sources/librarySource.js
backend/src/lib/recipeBrain/sources/cacheSource.js
backend/src/lib/recipeBrain/sources/webSource.js
backend/src/lib/recipeBrain/sources/aiSource.js
backend/tests/recipeBrain/*.test.js                    6 files, 59 tests
```

Three existing files carry small **additive** edits:
`aiRecipeClient.buildPrompt` (optional spec-hint params; absent ⇒ byte-identical
prompt, asserted by test), `recipeGeneration.persistRecipe` (optional
fingerprint/verification stamps), `scripts/runTests.mjs` (tripwire floors).

No migration is required — `20260724120000_stage3_4_recipe_filters_and_ai_fingerprint`
already created the columns.

### A note on `brain:purity`

`scripts/checkBrainPurity.mjs` scans `backend/src/lib/brain/**` and forbids
fetch / shell / eval / file-writes there. `recipeBrain/` deliberately sits
*outside* that directory, because the web channel's whole job is to fetch. That
is the correct boundary, not an oversight: `brain/` is the LLM-facing reasoning
core and stays inert; `recipeBrain/` is a sourcing layer that composes it.
**Do not broaden the purity scan to cover `recipeBrain/`** — it will go red on
`webSource.js` by design.
