# Stage 3 — The five filters · BUILDER AGENT S3 handoff

Everything below is a change I could **not** make myself because another agent
owns the file. Exact diffs where I could write them; a precise contract where
the target file's current shape is being edited concurrently.

**What I shipped (mine, done, tested):**

| file | state |
|---|---|
| `backend/data/ingredientCosts.json` | NEW — 769 keyword entries, 7 category fallbacks |
| `backend/src/lib/recipeCost.js` | REWRITTEN — cost filter + composed `scoreRecipe` / `explainPool` |
| `backend/src/lib/recipeComplexity.js` | NEW — `computeComplexity`, `estimatePrepMin` |
| `backend/src/lib/recipeTaste.js` | NEW — `computeTaste` |
| `backend/scripts/backfillRecipeFilters.mjs` | NEW — dry-run by default, `--apply` single transaction |
| `backend/tests/fiveFilters.test.js` | NEW — 28 tests, all green |

`computeRecipeCost` / `buildCostCache` / `TIERS` keep their old signatures, so
`mealSolver.js`, `routes/plans.js` and `tests/mealSolver.test.js` are unchanged
and still pass (verified: 69/69 across mealSolver, goldenBaseline,
solverHonesty, groceryList, planLogic).

---

## 1. `backend/prisma/schema.prisma` — REQUIRED (3 new columns)

Nothing persists without this. The scorers work fine without it (they compute
from the row at call time) but every solve re-derives 889 costs.

```prisma
model Recipe {
  // ... existing fields unchanged ...

  // Stage 3 five-filter cache. All three are DERIVED by
  // scripts/backfillRecipeFilters.mjs, never hand-authored.
  // filterProvenance is a JSON map recording which of them is an ESTIMATE and
  // which is MEASURED — an estimate must never be readable as a measurement.
  costPerServing   Float?  // CAD, from data/ingredientCosts.json
  difficulty       Int?    // 1..10, from recipeComplexity.computeComplexity()
  filterProvenance String? // {"costPerServing":"estimated","prepTimeMin":"measured|estimated","difficulty":"estimated"}
}
```

Migration SQL (SQLite, additive, no backfill inside the migration):

```sql
ALTER TABLE "Recipe" ADD COLUMN "costPerServing" REAL;
ALTER TABLE "Recipe" ADD COLUMN "difficulty" INTEGER;
ALTER TABLE "Recipe" ADD COLUMN "filterProvenance" TEXT;
```

Then run, in this order:

```
cd backend
node scripts/backfillRecipeFilters.mjs            # dry run, read-only handle
node scripts/backfillRecipeFilters.mjs --apply    # one transaction
```

I have **not** run `--apply` against `backend/prisma/dev.db` (my rules forbid
opening it writable). I proved the write path end-to-end on a scratch copy —
889/889 rows written in one transaction, 633 `prepTimeMin` provenance
`measured`, 256 `estimated`, zero `costPerServing = 0`.

---

## 2. `backend/src/lib/planContext.js` — `parseFilters` passthrough

```diff
 function parseFilters(body) {
   const f = body?.filters || {};
+  const posNum = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
   return {
     cuisines: Array.isArray(f.cuisines) ? f.cuisines.filter((c) => typeof c === "string").slice(0, 8) : [],
     protein: typeof f.protein === "string" && f.protein ? f.protein : null,
     budget: ["cheap", "moderate", "premium"].includes(f.budget) ? f.budget : null,
     maxPrepMin: Number.isInteger(f.maxPrepMin) && f.maxPrepMin > 0 ? f.maxPrepMin : null,
+    // Stage 3: the three new OPTIONAL hard caps. null = not set = not enforced.
+    // `budget` above stays a SOFT tier bias; maxCostCad is the hard cap.
+    maxCostCad: posNum(f.maxCostCad),
+    maxComplexity: Number.isInteger(f.maxComplexity) && f.maxComplexity >= 1 && f.maxComplexity <= 10 ? f.maxComplexity : null,
+    minTaste: Number.isFinite(Number(f.minTaste)) && Number(f.minTaste) >= 0 && Number(f.minTaste) <= 1 ? Number(f.minTaste) : null,
     allowBatchRepeats: f.allowBatchRepeats === true,
     proteinPriority: f.proteinPriority === true,
   };
 }
```

`planContext()` already returns `ratings` — `scoreRecipe` accepts that Map
directly as `prefs.ratings`, no adapter needed.

---

## 3. `backend/src/lib/mealSolver.js` — apply the caps + rank

`applyPrepFilter` stays exactly as it is (time cap, null-passes). The three new
caps join it in one place.

```diff
-const { buildCostCache } = require("./recipeCost.js");
+const { buildCostCache, explainPool } = require("./recipeCost.js");
```

```diff
 function applyPrepFilter(pool, maxPrepMin) {
   if (!maxPrepMin) return pool;
   return pool.filter((r) => r.prepTimeMin == null || r.prepTimeMin <= maxPrepMin);
 }
+
+// Stage 3: cost / complexity / taste caps. Time is still applyPrepFilter above
+// (unchanged, so its null-passes behaviour is byte-identical). Returns the
+// explainPool result so the CALLER can name the binding constraint — never
+// swallow it, that is the whole point of the honest-fail path.
+function applyFilterStack(pool, filters = {}, ratings = null) {
+  const prefs = {
+    maxCostCad: filters.maxCostCad ?? null,
+    maxComplexity: filters.maxComplexity ?? null,
+    minTaste: filters.minTaste ?? null,
+    ratings,
+  };
+  if (prefs.maxCostCad == null && prefs.maxComplexity == null && prefs.minTaste == null) {
+    return { survivors: pool, explain: null };
+  }
+  const explain = explainPool(pool, { ...prefs, minSurvivors: 3 });
+  return { survivors: explain.survivors, explain };
+}
```

Then at **both** call sites (`generateDayCandidates` ~line 383 and the week
generator ~line 687), which currently read:

```js
const afterPrep = applyPrepFilter(recipePool, filters.maxPrepMin);
const costCache = filters.budget ? buildCostCache(afterPrep) : null;
const bias = buildBias(filters, costCache);
```

become:

```js
const afterPrep = applyPrepFilter(recipePool, filters.maxPrepMin);
const { survivors: afterStack, explain: stackExplain } = applyFilterStack(afterPrep, filters, filters.ratings);
const costCache = filters.budget ? buildCostCache(afterStack) : null;
const bias = buildBias(filters, costCache);
```

…and every later use of `afterPrep` in that function becomes `afterStack`.
Carry `stackExplain` into the returned `counts` object as
`counts.afterStack = afterStack.length` and `counts.stackExplain = stackExplain`.

**Do not** let `applyFilterStack` return an empty pool silently — `diagnose()`
must speak (next section).

---

## 4. `backend/src/lib/mealSolver.js` — `diagnose()` must name the constraint

Directly after the existing `maxPrepMin` block (~line 249):

```diff
   if (filters?.maxPrepMin && counts.afterPrep < counts.afterDiet) {
     ...existing...
   }
+  // Stage 3: the optional caps get the same treatment the prep cap already
+  // has — a named, quantified reason. explainPool already measured WHICH cap
+  // is binding (by lifting one at a time), so this is a passthrough, not a
+  // second guess. NOTE: it can never suggest loosening an allergy, because it
+  // has no allergy input at all.
+  if (counts.stackExplain && !counts.stackExplain.ok) {
+    reasons.push(counts.stackExplain.message);
+    const b = counts.stackExplain.bindingConstraint;
+    if (b === "cost") suggestions.push("Raise the cost-per-serving cap, or switch it off and use the budget tier as a soft preference instead.");
+    else if (b === "complexity") suggestions.push("Raise the complexity cap — 'simple' is a narrow band in this library (462 of 889 recipes).");
+    else if (b === "taste") suggestions.push("Lower the minimum taste score, or rate more recipes so the score has your own data behind it.");
+    else if (b === "combined") suggestions.push("Loosen more than one cap — no single one is responsible.");
+  }
```

---

## 5. `backend/src/routes/plans.js` — surface it, don't swallow it

Line 134 currently builds `costCache` from the unfiltered pool for the
recipe-listing path. Two changes:

1. Where a plan/day response already carries the honest diagnosis, include
   `stackExplain.bindingConstraint` and `stackExplain.message` verbatim so the
   UI has something specific to render.
2. **Never return HTTP 200 with an empty plan and no reason.** If
   `stackExplain.ok === false`, the response must carry the message. The
   existing "result-driven diagnosis" machinery from Phase 4 is the right home;
   this just adds a case to it.

---

## 6. `backend/src/lib/brain/softScore.js` — two `noSignal` entries can retire

`softScore.js` lines 68–71 say *"no per-recipe cost or complexity column exists
yet (a later stage adds them)"*. This is that stage.

```diff
-  // BUDGET / COMPLEXITY — no per-recipe cost or complexity column exists yet
-  // (a later stage adds them). Report honestly rather than score a phantom pass.
-  if (soft.budget?.value?.tier != null) noSignal.push("budget");
-  if (soft.complexity?.value?.max != null) noSignal.push("complexity");
+  // BUDGET / COMPLEXITY — Stage 3 made both evaluable per recipe.
+  const budgetTier = soft.budget?.value?.tier;
+  if (budgetTier != null) {
+    const tiers = slots.map((s) => recipeById(s.recipeId)).filter(Boolean).map((r) => computeRecipeCost(r).tier);
+    const usable = tiers.filter((t) => t !== "unknown");
+    if (usable.length === 0) noSignal.push("budget"); // still honest when coverage is too thin
+    else terms.budget = w.budget * cap(usable.filter((t) => BUDGET_ORDER[t] > BUDGET_ORDER[budgetTier]).length / usable.length);
+  }
+  const maxCx = soft.complexity?.value?.max;
+  if (maxCx != null) {
+    const scores = slots.map((s) => recipeById(s.recipeId)).filter(Boolean).map((r) => computeComplexity(r).score);
+    if (scores.length === 0) noSignal.push("complexity");
+    else terms.complexity = w.complexity * cap(scores.filter((x) => x > maxCx).length / scores.length);
+  }
```

with `const { computeRecipeCost } = require("../recipeCost.js");` and
`const { computeComplexity } = require("../recipeComplexity.js");` at the top,
plus a local `BUDGET_ORDER = { cheap: 0, moderate: 1, premium: 2 }`.

**Law 2 check:** this changes brain scoring only. `BRAIN=off` never reaches
`scoreSoftConstraints`, so the byte-identical guarantee holds.

---

## 7. Frontend — `ProfileTab.jsx` / `PlanTab.jsx` / `SetupWizard.jsx`

Contract only (I can't see your in-flight edits).

The four optional caps go in the plan-generation filter panel, each with an
explicit **off** state — "off" is not "0", and a control with no off state
turns an optional filter into a mandatory one:

| control | field | range | off value |
|---|---|---|---|
| Max cost / serving | `maxCostCad` | slider $1–$15, real pool median is $4.01 | `null` |
| Max time | `maxPrepMin` | already exists | `null` |
| Max complexity | `maxComplexity` | 3 = Simple · 6 = Moderate · 10 = Involved | `null` |
| Min taste | `minTaste` | 0–1; pool median 0.58 | `null` |

Rendering rules that come from the design constitution:

- Cost is **not** a macro. It may not borrow `--protein` / `--carb` / `--fat`,
  and it may not use `--accent` (green scarcity). Use `--ink` / `--faint`.
- A recipe whose `costTier === "unknown"` must render its price as
  **"~$X.XX (est., low coverage)"**, never as a plain price. 3 of 889 rows.
- Every displayed cost is an ESTIMATE. One disclosure line per surface:
  *"Estimated from a local price table, not live grocery pricing."*
- When a plan fails, render `stackExplain.message` **verbatim**. It already
  names the binding constraint and the recipe counts behind the claim. Do not
  paraphrase it into "no results found".

---

## 8. `backend/scripts/runTests.mjs` — raise the tripwire floors

`fiveFilters.test.js` adds **1 file / 28 tests**. Whoever lands last should
re-measure and raise both floors in one edit rather than four agents each
bumping them:

```
MIN_TEST_FILES  80 -> 81   (+1 from this stage)
MIN_TESTS      903 -> 931  (+28 from this stage)
```

---

## 9. Findings you should see (not mine to fix)

**A. Seven recipes carry whole-batch grams in a per-serving column.**
`RecipeIngredient.baseGrams` is per serving. Seven rows plainly are not:

```
 10991g total  worst: 10000g Peas                  Split Pea Soup
  9173g total  worst:  8750g Vegetable Stock       Lamb and Potato pie
  8920g total  worst:  6250g Lentils               Tahini Lentils
  2751g total  worst:  2500g Green Beans           Vietnamese-style veggie hotpot
  2365g total  worst:  2188g Water                 Sticky Toffee Pudding Ultimate
  1846g total  worst:  1002g Water                 Snert (Dutch Split Pea Soup)
  1593g total  worst:   507g Chicken Stock         Smoked Haddock Kedgeree
```

This is why the cost distribution has a $71.63 tail. **It also means those
recipes' cached macros are wrong**, which matters far more than their price.
The backfill script reports this every run; I did not clamp it, because a
clamped number looks correct and hides the bug.

**B. `Recipe.tasteTier` is populated on 24 of 889 rows; `RecipeRating` is empty
and `userRatingAvg` is null on all 889.** Taste therefore runs almost entirely
on the weakest evidence tier today. That is working as designed (the tier is
compressed to 0.40–0.70 precisely so it can't outvote real data), but the taste
filter only becomes sharp once ratings exist. A rate-this-dish control is the
highest-leverage follow-up.

**C. The old `groceryPrices.js` first-match-wins ordering mispriced
compounds** — `"Peanut Butter"` matched the `"peanut"` row above it.
`ingredientCosts.json` + longest-match-wins fixes this for recipe cost.
`groceryList.js` still uses the old table and still has the bug. Worth pointing
that module at `recipeCost.priceFor()` in a later pass (it is not in my scope
and a golden test locks the old note string).

**D. Found by test, fixed in my file:** a zero-priced entry matched as a bare
substring prices `"Watermelon"` at $0.00 — a free melon that wins every
cost-ranked sort. Zero-priced entries now require a word-boundary match.
