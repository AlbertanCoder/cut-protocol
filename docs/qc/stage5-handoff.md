# Stage 5 — Progress UX + reachable states · BUILDER AGENT S5 handoff

Backend changes I could **not** make (frontend-only ownership). Frontend work is
landed and build-clean; the items below gate two DoD claims from reaching the
**primary Generate button**.

## What I shipped (frontend, mine, build-clean)

| file | change |
|---|---|
| `frontend/src/components/ui/FilterControls.jsx` | NEW — `RangeCap` (cost, taste) + `ComplexityCap`, each with an explicit OFF state (off ≠ 0) |
| `frontend/src/components/ui/GenerationProgress.jsx` | NEW — honest staged progress (no fake %), indeterminate bar, Cancel |
| `frontend/src/components/PlanTab.jsx` | filters state + `apiFilters()` now carry `maxCostCad/maxComplexity/minTaste`; caps rendered in `FiltersBar`; `generate()` is AbortController-driven; `GenerationProgress` mounts while generating |
| `frontend/src/lib/api.js` | unchanged — its existing `signal` passthrough was sufficient; `generatePlan(filters,{ body, signal })` |

`npx oxlint`: 0 errors (only pre-existing `SetupWizard.jsx` fast-refresh
warnings). `npx vite build`: ✓ 2381 modules, 574 ms (only the known >500 kB
chunk warning).

---

## 1. BLOCKER — the week/horizon generate path never applies the three caps

`routes/plans.js` `POST /generate` applies **only** `applyPrepFilter` (line
166), then hands that pool to `generateHorizonPlan` →
`generateBestWeekPlan` → `weeklyPlanner.generateWeekPlan`. **None of those call
`applyFilterStack`.** So on the primary Generate button (1 day … 1 month, and
custom N), `maxCostCad` / `maxComplexity` / `minTaste` are **silently ignored**,
and an over-constrained request produces a normal plan with no diagnosis — a
silent filter drop, which the constitution forbids.

The caps ARE correctly enforced + diagnosed on the paths that call
`applyFilterStack`: `generateDayCandidates` ("3 options for {day}",
mealSolver.js:428), `solveOneMeal` ("Fit one meal", :1140), and
`alternatesForSlot` (swap, :743). The frontend already sends the fields to all
of them, so **those three paths work end-to-end today**.

**Fix (mirror the day-candidates path in the route or the horizon composer):**

```diff
 const pool = applyPrepFilter(recipePool, filters.maxPrepMin);
+const { survivors: capped, explain: stackExplain } =
+  applyFilterStack(pool, filters, filters.ratings);   // export it from mealSolver.js
 const costCache = filters.budget ? buildCostCache(pool) : null;
-const poolCounts = { raw: rawPoolCount, afterDiet: recipePool.length, afterPrep: pool.length };
+const poolCounts = { raw: rawPoolCount, afterDiet: recipePool.length, afterPrep: pool.length, stackExplain };
```

…and pass `capped` (not `pool`) as `recipePool` into `generateHorizonPlan`.
`generateBestWeekPlan` already threads `options.counts` into `diagnose()` (:652)
and `diagnose()` already pushes `stackExplain.message` **verbatim** into
`reasons` (:284) — so once `counts.stackExplain` is populated, the week
diagnosis names the binding cap with no further change. `applyFilterStack` is
currently not exported from `mealSolver.js`; export it.

### DoD impact
- "over-constrained generate renders the verbatim binding message" — **met on
  the day-options path today**; **NOT met on the primary Generate button** until
  this lands. The frontend renderer is already in place: `SolverNarration`
  prints `meta.diagnosis.reasons` and `.binding` verbatim; the day-options panel
  prints `diagnosis.reasons` verbatim.

---

## 2. NICE-TO-HAVE — true server-side cancellation

Client cancel is done: `GenerationProgress`'s Cancel aborts the in-flight
`fetch` via the existing `AbortController` seam; `generate()` treats the ABORTED
error as a no-op and returns the UI to a clean, retryable state (plan untouched,
no error banner). The **server** keeps solving to completion and discards the
result. For sub-second solves that is fine. If a 90-day custom horizon ever runs
long enough to matter, a cooperative cancel token checked between week windows
in `generateHorizonPlan`'s loop (:1017) would free the CPU. Not urgent; noting
so it isn't mistaken for a gap.

---

## 3. Context for whoever wires the caps: the taste filter is weak today

Per Stage 3 finding B (`RecipeRating` empty, `tasteTier` on 24/889 rows), a
`minTaste` cap above ~0.70 will over-constrain almost everything. The UI already
says so ("Sharpens once you rate dishes"), but a rate-this-dish control remains
the highest-leverage follow-up before `minTaste` is genuinely useful. The
`api.rateRecipe` seam already exists.
