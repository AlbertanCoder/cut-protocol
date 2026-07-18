# Fix 1 [HIGH] — protein-tolerance check in `resolveSlot()`'s accept/reject gate

**File:** `backend/src/lib/weeklyPlanner.js`
**Companion test file:** `backend/tests/weeklyPlanner.test.js`
**Diagnosed in:** AUDIT.md §3/§10 (original kcal-only gate), PABLO_REVIEW.md §2.6 (the
gate's own fix shipped kcal-only and reintroduced the protein shortfall the
two-scale-factor solver was built to prevent — 10-32% protein short on 6/7 days
against the real 628-recipe pool, even though every day landed within 5% on kcal).

Status note: as of this patch being written, `weeklyPlanner.js` already contains
the reject/retry gate from AUDIT.md §3/§10 (`KCAL_TOLERANCE_PCT`, `MAX_SLOT_ATTEMPTS`,
the retry loop in `resolveSlot()`). This patch adds the missing protein leg to that
same gate — it does not re-add the retry mechanism itself, only what it checks.

---

## Design reasoning

**Why protein needs its own tolerance, not just a kcal check.** `scaleRecipe()`
already solves a real 2-unknown linear system and returns `.protein` on every
candidate (`weeklyPlanner.js:153`). The current gate (`resolveSlot()`,
around line 210-215) only ever reads `kcalOff`. A candidate that lands exactly
on calories via a single uniform scale (no separable protein-role ingredient —
the dessert/side-dish case) sails through the gate with near-zero protein and
no warning, because nothing downstream of `scaleRecipe()` ever looks at
`scaled.protein` against the target.

**Tolerance direction — asymmetric, not symmetric like kcal's.** Kcal has a
real cost in both directions (over target blows the deficit, under target
under-fuels). Protein does not: coming in over the protein target is fine —
arguably good, since `proteinTarget` here is the *midpoint* of `proteinLo`-
`proteinHi`, and the whole macro engine already treats "protein high" as
acceptable (`bmrEngine.js`'s `computeMacros()` returns a range, not a point).
Coming in *under* target is the actual failure mode Pablo found and the one
this module's own header comment says the two-factor solver exists to avoid
("single-factor scaling was landing 15-25g/day under the protein floor").
So: **check shortfall only, not deviation.** A recipe delivering 130% of a
slot's protein target should never be rejected for it.

**Tolerance width — tighter than kcal's 15%, not equal.** Protein is called
"load-bearing" throughout this codebase's own comments and AI prompts
(`EngineTab.jsx`: "protein + calories are load-bearing walls"). A gate that's
just as loose as the kcal one on the metric it exists specifically to protect
doesn't earn the name. Picked **12%** (tighter than kcal's 15%, not so tight
it makes every slot un-fittable against a real pool where many recipes have no
protein-role ingredient at all). This is a judgment call — flag for review; if
the real-pool re-run (see Verification below) shows 12% still routinely
exhausts `MAX_SLOT_ATTEMPTS` and falls to AI/best-effort too often, loosen
toward 15-18% before tightening further in the other direction.

**What happens when no candidate hits both.** Mirrors the existing kcal-only
fallback chain exactly, extended to score on both axes:
1. Within the `MAX_SLOT_ATTEMPTS` retry loop, track the "best" candidate seen
   so far using `worstRatio = max(kcalOff / KCAL_TOLERANCE_PCT, proteinShort /
   PROTEIN_TOLERANCE_PCT)` — the larger of the two tolerance-relative misses.
   This generalizes the current best-tracking (which is kcal-only) without
   changing its behavior when protein is already fine (worstRatio reduces to
   the kcal case).
2. Accept immediately, no warning, only when **both** legs are within
   tolerance (`kcalOff <= KCAL_TOLERANCE_PCT && proteinShort <=
   PROTEIN_TOLERANCE_PCT`).
3. If the loop exhausts all attempts without a double-fit, fall to the AI
   fallback path exactly as today — but the AI-generated candidate now gets
   the same dual check, so a generated recipe that nails calories but ships
   low protein no longer gets a free pass either.
4. If AI fallback is unavailable/exhausted/fails, ship the best pool
   candidate found (same "closest, not silence" principle already in place)
   — but the warning string now says *which* leg(s) missed and by how much,
   not just kcal. This is a direct extension of the existing C7 ("solver
   declares unsolvable + why") behavior — right now a protein miss is
   invisible even in the warning text; after this patch it isn't.

---

## Patch — `backend/src/lib/weeklyPlanner.js`

### 1. Add the tolerance constant (near `KCAL_TOLERANCE_PCT`)

**Before:**
```js
// A slot's scaled result missing the target by more than this is not a fit,
// full stop - matches the threshold resolveSlot() already warned at before
// this became a real reject/retry gate instead of just a label.
const KCAL_TOLERANCE_PCT = 0.15;
```

**After:**
```js
// A slot's scaled result missing the target by more than this is not a fit,
// full stop - matches the threshold resolveSlot() already warned at before
// this became a real reject/retry gate instead of just a label.
const KCAL_TOLERANCE_PCT = 0.15;
// Protein is the "load-bearing" macro (see this file's own header comment,
// and EngineTab.jsx's "protein + calories are load-bearing walls") - the
// accept/reject gate below previously checked kcal only, which shipped
// calorie-perfect, protein-short recipes (desserts/sides with no separable
// protein-role ingredient landing exactly on kcal via a single uniform
// scale). Tighter than KCAL_TOLERANCE_PCT because protein is the metric this
// module's two-factor solver exists specifically to protect. Deliberately
// ASYMMETRIC - only a SHORTFALL below target counts against a candidate;
// delivering more protein than the slot's target is never penalized (the
// daily target itself is the midpoint of a proteinLo-proteinHi range, so
// "over" is inside the acceptable band by construction). Per PABLO_REVIEW.md
// §2.6 - the kcal-only gate shipped calories within 5% on every day of a
// real-pool re-run while protein landed 10-32% short on 6/7 days.
const PROTEIN_TOLERANCE_PCT = 0.12;
```

### 2. Add a protein-shortfall helper next to `kcalOffPct()`

**Before:**
```js
function kcalOffPct(target, scaledKcal) {
  return target > 0 ? Math.abs(scaledKcal - target) / target : 0;
}
```

**After:**
```js
function kcalOffPct(target, scaledKcal) {
  return target > 0 ? Math.abs(scaledKcal - target) / target : 0;
}

// Asymmetric by design (see PROTEIN_TOLERANCE_PCT comment) - only a
// shortfall counts. Delivering >= target is always 0 (no penalty).
function proteinShortfallPct(target, scaledProtein) {
  return target > 0 ? Math.max(0, (target - scaledProtein) / target) : 0;
}
```

### 3. `resolveSlot()` — score and gate on both metrics

**Before:**
```js
async function resolveSlot(target, recipePool, usageCount, usedYesterday, rng, aiFallback = null) {
  const targetRatio = target.kcalTarget > 0 ? target.proteinTarget / target.kcalTarget : 0;
  const tried = new Set();
  let best = null;

  for (let attempt = 0; attempt < MAX_SLOT_ATTEMPTS; attempt++) {
    const candidates = eligibleRecipes(recipePool, target.slotType, usageCount).filter((r) => !tried.has(r.id));
    if (candidates.length === 0) break;
    const recipe = pickRecipe(candidates, targetRatio, usedYesterday, rng);
    tried.add(recipe.id);
    const scaled = scaleRecipe(recipe, target.kcalTarget, target.proteinTarget);
    const kcalOff = kcalOffPct(target.kcalTarget, scaled.kcal);
    if (!best || kcalOff < best.kcalOff) best = { recipe, scaled, kcalOff };
    if (kcalOff <= KCAL_TOLERANCE_PCT) {
      usageCount.set(recipe.id, (usageCount.get(recipe.id) || 0) + 1);
      return { recipeId: recipe.id, warning: null, ...scaled };
    }
  }

  if (aiFallback?.enabled && aiFallback.callsRemaining.n > 0) {
    const aiResult = await tryAiFallback(target, recipePool, usageCount, aiFallback);
    if (aiResult) return aiResult;
  }

  if (best) {
    // Every pool candidate we tried missed tolerance and AI wasn't
    // available (or failed). Ship the closest one we found rather than
    // declaring the slot unsolved outright - it's a real recipe someone
    // could eat, just imperfectly scaled - but say so plainly (C7).
    usageCount.set(best.recipe.id, (usageCount.get(best.recipe.id) || 0) + 1);
    return {
      recipeId: best.recipe.id,
      warning: `Tried ${tried.size} recipe(s) for this slot, none fit within ${Math.round(KCAL_TOLERANCE_PCT * 100)}% — closest was "${best.recipe.name}" landing ${Math.round(best.scaled.kcal)} kcal vs a ${Math.round(target.kcalTarget)} target.`,
      ...best.scaled,
    };
  }

  return unsolvedResult(`No eligible ${target.slotType} recipe left for this slot.`);
}
```

**After:**
```js
async function resolveSlot(target, recipePool, usageCount, usedYesterday, rng, aiFallback = null) {
  const targetRatio = target.kcalTarget > 0 ? target.proteinTarget / target.kcalTarget : 0;
  const tried = new Set();
  let best = null;

  for (let attempt = 0; attempt < MAX_SLOT_ATTEMPTS; attempt++) {
    const candidates = eligibleRecipes(recipePool, target.slotType, usageCount).filter((r) => !tried.has(r.id));
    if (candidates.length === 0) break;
    const recipe = pickRecipe(candidates, targetRatio, usedYesterday, rng);
    tried.add(recipe.id);
    const scaled = scaleRecipe(recipe, target.kcalTarget, target.proteinTarget);
    const kcalOff = kcalOffPct(target.kcalTarget, scaled.kcal);
    const proteinShort = proteinShortfallPct(target.proteinTarget, scaled.protein);
    // Worse-of-the-two-tolerances score, expressed as a multiple of each
    // metric's own tolerance so the two different-scale percentages are
    // comparable. Reduces to kcal-only comparison when protein already
    // fits (proteinShort/PROTEIN_TOLERANCE_PCT <= 1 <= the kcal ratio in
    // any case where kcal itself is still missing).
    const worstRatio = Math.max(kcalOff / KCAL_TOLERANCE_PCT, proteinShort / PROTEIN_TOLERANCE_PCT);
    if (!best || worstRatio < best.worstRatio) best = { recipe, scaled, kcalOff, proteinShort, worstRatio };
    if (kcalOff <= KCAL_TOLERANCE_PCT && proteinShort <= PROTEIN_TOLERANCE_PCT) {
      usageCount.set(recipe.id, (usageCount.get(recipe.id) || 0) + 1);
      return { recipeId: recipe.id, warning: null, ...scaled };
    }
  }

  if (aiFallback?.enabled && aiFallback.callsRemaining.n > 0) {
    const aiResult = await tryAiFallback(target, recipePool, usageCount, aiFallback);
    if (aiResult) return aiResult;
  }

  if (best) {
    // Every pool candidate we tried missed tolerance (on kcal and/or
    // protein) and AI wasn't available (or failed). Ship the closest one we
    // found rather than declaring the slot unsolved outright - it's a real
    // recipe someone could eat, just imperfectly scaled - but say so
    // plainly, on BOTH axes (C7). Previously this warning only ever
    // mentioned kcal, so a protein-short "best effort" slot shipped with no
    // indication protein was the actual problem (PABLO_REVIEW.md §2.6).
    usageCount.set(best.recipe.id, (usageCount.get(best.recipe.id) || 0) + 1);
    const misses = [];
    if (best.kcalOff > KCAL_TOLERANCE_PCT) misses.push(`landed ${Math.round(best.scaled.kcal)} kcal vs a ${Math.round(target.kcalTarget)} target`);
    if (best.proteinShort > PROTEIN_TOLERANCE_PCT) misses.push(`delivered ${Math.round(best.scaled.protein)}g protein vs a ${Math.round(target.proteinTarget)}g target`);
    return {
      recipeId: best.recipe.id,
      warning: `Tried ${tried.size} recipe(s) for this slot, none fit within tolerance — closest was "${best.recipe.name}" (${misses.join("; ")}).`,
      ...best.scaled,
    };
  }

  return unsolvedResult(`No eligible ${target.slotType} recipe left for this slot.`);
}
```

### 4. `tryAiFallback()` — same dual check on the AI-generated candidate

**Before:**
```js
    const scaled = scaleRecipe(generated, target.kcalTarget, target.proteinTarget);
    usageCount.set(generated.id, 1);
    const kcalOff = kcalOffPct(target.kcalTarget, scaled.kcal);
    const warning = kcalOff > KCAL_TOLERANCE_PCT
      ? `AI-generated recipe still landed ${Math.round(scaled.kcal)} kcal vs a ${Math.round(target.kcalTarget)} target.`
      : null;
    return { recipeId: generated.id, warning, ...scaled };
```

**After:**
```js
    const scaled = scaleRecipe(generated, target.kcalTarget, target.proteinTarget);
    usageCount.set(generated.id, 1);
    const kcalOff = kcalOffPct(target.kcalTarget, scaled.kcal);
    const proteinShort = proteinShortfallPct(target.proteinTarget, scaled.protein);
    const aiMisses = [];
    if (kcalOff > KCAL_TOLERANCE_PCT) aiMisses.push(`landed ${Math.round(scaled.kcal)} kcal vs a ${Math.round(target.kcalTarget)} target`);
    if (proteinShort > PROTEIN_TOLERANCE_PCT) aiMisses.push(`delivered ${Math.round(scaled.protein)}g protein vs a ${Math.round(target.proteinTarget)}g target`);
    const warning = aiMisses.length ? `AI-generated recipe still missed tolerance — ${aiMisses.join("; ")}.` : null;
    return { recipeId: generated.id, warning, ...scaled };
```

---

## Companion test — `backend/tests/weeklyPlanner.test.js`

Pablo's finding was specifically that the two existing `weeklyPlanner.test.js`
tests use small, hand-picked "flexible" fixtures chosen to fit — neither
represents the real pool's actual shape (96% unreviewed imports, many with no
separable protein-role ingredient at all). The new test below deliberately
models THAT shape: a majority of calorie-flexible-but-protein-poor recipes
(single uniform scale, matching the real dessert/side-dish problem) alongside
a minority of genuinely two-factor-flexible, protein-adequate recipes — not a
pool curated to make the fix look good.

**Add to `backend/tests/weeklyPlanner.test.js`**, after the existing
`fixedOvershootRecipe`/`flexibleRecipe` helpers (after line 40):

```js
// Models the REAL recipe pool's actual failure shape (see PABLO_REVIEW.md
// §2.7: 602/628 recipes are generic imports, most with no ingredient tagged
// role:"protein" at all) - NOT hand-picked to fit. Two carb/veg-role
// scalable ingredients, zero protein-role ingredients, so scaleRecipe()
// takes the "no separable protein ingredient" branch (weeklyPlanner.js's
// single-uniform-scale fallback) and lands EXACTLY on any kcal target while
// protein stays pinned to the recipe's own low base ratio (8g/400kcal here -
// a real dessert/side-dish density, not a meal's). This is the exact
// candidate shape that sailed through the old kcal-only gate with a perfect
// kcalOff of 0 and no warning.
function proteinPoorRecipe(id, slotType = "meal") {
  return recipe({
    id, slotType, kcal: 400, protein: 8, fat: 14, carb: 60,
    ingredients: [
      { foodId: `${id}-carb1`, baseGrams: 200, scalable: true, role: "carb", food: food(`${id}-carb1`, 150, 3, 5, 28) },
      { foodId: `${id}-carb2`, baseGrams: 100, scalable: true, role: "veg", food: food(`${id}-carb2`, 100, 2, 4, 15) },
    ],
  });
}

test("generateWeekPlan: rejects a kcal-perfect but protein-short candidate and retries for one that hits both (Pablo protein-gate finding)", async () => {
  // 3 protein-poor (dessert/side-shaped) recipes to 2 genuinely flexible
  // ones - roughly the real pool's lopsidedness, not a 50/50 toy split.
  const dailyTarget = { kcal: 2000, proteinLo: 180, proteinHi: 200 }; // targetRatio ~0.095 g/kcal
  const mealConfig = { meals: 3, snacks: 0 };
  const pool = [
    proteinPoorRecipe("poor1"), proteinPoorRecipe("poor2"), proteinPoorRecipe("poor3"),
    flexibleRecipe("good1"), flexibleRecipe("good2"),
  ];
  const plan = await generateWeekPlan(dailyTarget, mealConfig, pool, { rng: () => 0.5 });
  const day0 = plan.filter((s) => s.dayOfWeek === 0);

  // The core regression: every slot that actually shipped must be within
  // PROTEIN_TOLERANCE_PCT of ITS OWN target, or say so explicitly in its
  // warning - never silently short like the kcal-only gate allowed.
  for (const slot of day0) {
    if (!slot.recipeId) continue; // unsolved is handled/asserted separately if it happens
    const share = slot.kcal > 0 || slot.protein > 0 ? true : true; // per-slot target isn't stored on the record; check via day total below instead
  }

  // Day-level check (mirrors how Pablo actually measured the live regression -
  // by day total, not a hand-derived per-slot exact number): with a pool this
  // lopsided, day0's delivered protein must land close to its target share,
  // not 10-32% under it the way the kcal-only gate produced on the real pool.
  const day0Protein = day0.reduce((s, x) => s + x.protein, 0);
  const proteinTargetMid = (dailyTarget.proteinLo + dailyTarget.proteinHi) / 2; // 190
  // 3 meal slots at weights [0.9, 1, 1.15] sum to 3.05 of the day's 3.05 total
  // weight (meals:3, snacks:0) -> day0's target IS the full daily target.
  const proteinDeviation = (proteinTargetMid - day0Protein) / proteinTargetMid;
  assert.ok(proteinDeviation < 0.15, `day0 protein (${day0Protein}g) should land within 15% of the ${proteinTargetMid}g target, not the 10-32% shortfall the kcal-only gate produced (deviation: ${(proteinDeviation * 100).toFixed(1)}%)`);

  // And the mechanism should visibly prefer the protein-adequate recipes for
  // slots that solved cleanly (no warning) - a poor1/2/3 recipe should never
  // ship with warning:null, since it can never clear PROTEIN_TOLERANCE_PCT on
  // its own 8g/400kcal ratio against this target ratio.
  const cleanPoorShip = day0.some((s) => s.warning === null && ["poor1", "poor2", "poor3"].includes(s.recipeId));
  assert.equal(cleanPoorShip, false, "a protein-poor candidate should never ship with no warning - it cannot clear the protein tolerance on its own ratio");
});
```

Note the first `for` loop above is a placeholder that intentionally does
nothing (kept to show where a future per-slot-target assertion would go if
`toSlotRecord()` is ever changed to carry the slot's own `proteinTarget` on
the output record — it currently only stores delivered `protein`, not the
target it was solved against, so a true per-slot ratio check isn't possible
without a small schema addition). **Delete that dead loop before landing this
test** — it's included here only to explain the reasoning; the day-level
assertion below it is the real check and is sufficient on its own.

---

## Risks / things to double-check before applying

1. **`PROTEIN_TOLERANCE_PCT = 0.12` is a judgment call, not a derived number.**
   Re-run the fresh in-memory probe AUDIT.md used (`generateWeekPlan()`
   imported directly, real 628-recipe pool, no DB writes) after applying this
   patch and check: (a) worst-day protein deviation across several runs, (b)
   how often the AI fallback path fires now vs. before (each dual-tolerance
   miss burns one of the 5 AI calls per week faster than the old kcal-only
   gate did), (c) how often slots land on the "best effort, both missed"
   path. If AI-fallback usage or unsolved-slot rate spikes materially, loosen
   the tolerance before shipping.
2. **This patch doesn't fix the recipe pool itself.** Per PABLO_REVIEW.md
   §2.7, 602/628 recipes are unreviewed generic imports with no protein-role
   tagging; this gate will correctly *reject* those for meal slots more often
   now, which means more retries, more AI-fallback calls (real Claude API
   cost per PABLO_REVIEW.md §3.5-adjacent concerns), and possibly more
   "best effort, still short" warnings on days where the pool genuinely can't
   supply 3-5 high-protein candidates. That's the honest outcome, not a bug -
   but it will make AI-generation costs and "unsolved slot" rates go up
   until the pool itself is curated (Pablo's recommendation #4, out of scope
   here).
3. **The placeholder `for` loop in the test above must be deleted** before
   this is applied - it's dead code left in on purpose to document a schema
   limitation (`toSlotRecord()` doesn't carry the target it solved against).
   If whoever applies this patch wants the stronger per-slot check instead of
   the day-level one, that's a real, small, separate schema addition
   (`toSlotRecord()` gains `kcalTarget`/`proteinTarget` fields) - flag it as
   a possible immediate follow-up, not bundled into this patch.
4. **Verify against the live concurrent edits.** This patch was written
   against the `weeklyPlanner.js` content read at review time (already
   containing the AUDIT.md §3/§10 retry gate). If the file has moved further
   since, the "Before" blocks above may not match verbatim - diff by
   intent (find `resolveSlot()`'s accept condition and `tryAiFallback()`'s
   warning construction) rather than by exact line numbers.
