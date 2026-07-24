# Agent 08 handoff — Wave 5 (Solver Honesty & Diet-Law Math)

Branch `qc/overnight-2026-07-23`. Findings worked: solver-core-1, solver-core-2,
solver-core-3, ux-screens-2.

Everything below is a change **outside my ownership list** that I did NOT make.
Items 1 and 2 are load-bearing: without them solver-core-1 is fixed in the
library but **not live in the product**. Item 3 is required to get CI green.

---

## 1. REQUIRED — `backend/src/routes/plans.js`, `POST /generate` (~lines 152–171)

solver-core-1 is only closed once the route stops substituting locked slots
after scoring. `generateBestWeekPlan` now accepts `options.lockedSlots` and
carries the locks through every attempt, so `weekResult.slots` already contains
them and `weekResult.score` is a rescore of exactly that slot set.

Replace:

```js
    const weekResult = await generateBestWeekPlan(dailyTarget, mealConfig, pool, {
      bias: buildBias(filters, costCache),
      allowBatchRepeats: filters.allowBatchRepeats,
      filters,
      counts: poolCounts,
      priorUsage: buildPriorUsage(priorPlans),
    });
    const freshSlots = weekResult.slots;
    // A locked slot is only carried forward if its recipe still complies with
    // the CURRENT diet/allergy rules (Stage-C L9). Otherwise a slot locked
    // before a diet change (goat locked, then the user goes vegan) would
    // persist a now-forbidden meal into the regenerated plan — the fresh
    // compliant slot replaces it instead, and its lock is dropped.
    const compliantPoolIds = new Set(recipePool.map((r) => r.id));
    const finalSlots = freshSlots.map((s) => {
      const locked = lockedByKey.get(slotKey(s));
      return locked && compliantPoolIds.has(locked.recipeId)
        ? { ...s, recipeId: locked.recipeId, proteinScale: locked.proteinScale, sidesScale: locked.sidesScale, ingredients: locked.ingredients, kcal: locked.kcal, protein: locked.protein, fat: locked.fat, carb: locked.carb, warning: locked.warning, locked: true }
        : s;
    });
```

with:

```js
    // A locked slot is only carried forward if its recipe still complies with
    // the CURRENT diet/allergy rules (Stage-C L9). Otherwise a slot locked
    // before a diet change (goat locked, then the user goes vegan) would
    // persist a now-forbidden meal into the regenerated plan — the fresh
    // compliant slot replaces it instead, and its lock is dropped.
    const compliantPoolIds = new Set(recipePool.map((r) => r.id));
    // solver-core-1: the locks go INTO the solve as fixed constraints, so the
    // open slots are sized around them and weekResult.score describes EXACTLY
    // the week we are about to store. Substituting them in afterwards (what
    // this used to do) published a match % for a week that never existed.
    const lockedSlots = [...lockedByKey.values()]
      .filter((s) => s.recipeId != null && compliantPoolIds.has(s.recipeId));
    const weekResult = await generateBestWeekPlan(dailyTarget, mealConfig, pool, {
      bias: buildBias(filters, costCache),
      allowBatchRepeats: filters.allowBatchRepeats,
      filters,
      counts: poolCounts,
      priorUsage: buildPriorUsage(priorPlans),
      lockedSlots,
    });
    const finalSlots = weekResult.slots; // locks already in place — do NOT re-substitute
```

Notes for whoever applies it:

- `slotKey` / `lockedByKey` / `slotIdsToKeep` / the transaction all stay as they
  are. `finalSlots` keeps the same shape, and locked rows arrive with
  `locked: true` already set, so `upsertSlot` needs no change.
- `freshSlots` becomes unused — delete the binding.
- `compliantPoolIds` must move ABOVE the `generateBestWeekPlan` call (it is
  already used further down by `slotIdsToKeep`; no other reordering needed).
- Regression proof already exists: `backend/tests/solverLockedSlots.test.js`
  ("REGRESSION: scoring the week WITHOUT the locks and swapping them in
  afterwards publishes a number for a week that never existed").

## 2. REQUIRED — `backend/src/routes/plans.js`, `POST /day-options` (~lines 228–236)

Same bug at day granularity: `/accept-day` keeps this day's locked slots no
matter which candidate is accepted, so a candidate solved and scored without
them describes a day that will never be stored. `generateDayCandidates` now
takes `lockedSlots`.

After the existing `prevDayIds` line, add:

```js
    // solver-core-1 (day level): /accept-day keeps this day's locked slots
    // regardless of the candidate chosen, so the candidates must be solved and
    // scored WITH them.
    const lockedSlots = (plan?.slots || []).filter((s) => s.locked && s.dayOfWeek === dayOfWeek && s.recipeId);
```

and pass it through:

```js
    const result = await generateDayCandidates({
      dailyTarget, mealConfig, recipePool, dayOfWeek, filters, weekUsage, prevDayIds, lockedSlots, profile,
    });
```

No response-shape change is needed — the route already spreads `...result`, and
each candidate now carries `inTolerance` + `miss`, which `PlanTab.jsx` reads.

## 3. REQUIRED — regenerate the golden baseline

`backend/tests/golden/engine-baseline.golden.json` now fails, by design. I did
not regenerate it because the file is shared (Agent 9's work can move its `bmr`
section) and a last-writer-wins regeneration would hide someone else's drift.

```
cd backend && BRAIN=off node -e "require('./tests/golden/fixtures').computeBaseline().then(o=>require('fs').writeFileSync('tests/golden/engine-baseline.golden.json', JSON.stringify(o,null,2)+'\n'))"
```

**Audit the diff before accepting it.** I measured it: **25 changed leaf paths,
all in the `solver` section, all additive disclosure.** `grocery`, `trend`,
`diary` and `bmr` are untouched, and inside `solver` **not one slot, gram,
recipe id, `matchPct`, `avgMatch` or `daysInTolerance` changed** — the plan
itself is bit-identical. What changed:

| path | change |
|---|---|
| `solver/week/score/days/*/fatOk`, `/carbOk` | new fields (per-day, which macro failed) |
| `solver/week/score/days/{1,4,6}/miss` | miss line now also names the fat/carb shortfall |
| `solver/week/diagnosis/reasons[2]`, `suggestions[2]` | new fat/carb reason + suggestion |
| `solver/dayCandidates/candidates/*/inTolerance`, `/miss` | new fields |

If any path outside that table moved, something other than my change is in the
diff — stop and look.

## 4. FYI — not a request, just so nobody is surprised

- `backend/src/lib/planContext.js` `filterRecipePool()` now stamps
  `dietGuardStyle` on each pooled recipe (a shallow copy; inputs are not
  mutated, purity test `tests/qc/invariants.test.js` still green). Anything that
  compares pooled recipe objects by IDENTITY rather than by `id` would need to
  know — I checked every caller in `routes/plans.js`, `brain/chatPlan.js`,
  `scripts/qc/*` and `scripts/solverBenchmark.mjs`, and all of them match on
  `.id`.
- `scripts/solverBenchmark.mjs --assert` and `npm run qc:all` were **not** run
  (out of scope per fleet rule 3, and the benchmark grid is long). Their
  `daysInTolerance` distributions WILL move — see the measured numbers in my
  report; that is the solver-core-2 fix, not a regression. If either has a
  hard-coded days-in-tolerance floor it will need rebaselining.
- `SlotCard`'s cart button still uses `C.good` (= brand green `#2FD576`) for
  "in cart". I left it: it is a membership state, not a plan-quality signal, so
  it is outside ux-screens-2's scope. Flagging in case a later green-scarcity
  sweep wants it.
