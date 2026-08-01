# D5 · The recipe/food library as an input to the solver

**Agent D5.** Territory: the DATA and its solver-relevant structure — not the dietary filter
logic (D6), not the closer's adjuster list (D3).

**Instrument:** `docs/surgery/CAMPAIGN/solver-deepdive/D5/dev-copy.db`, a plain `cp` of
`backend/prisma/dev.db` taken 2026-07-31 18:20 (WAL was 0 bytes; `-shm`/`-wal` copied too).
The live DB was never opened for write. All product code (`exclusionGate.js`,
`weeklyPlanner.js`, `recipeClassification.js`, `bmrEngine.js`) was `require`d read-only, never
edited. Scripts: `D5/loadpool.cjs`, `analyze1..4.cjs`, `density.cjs`, `slots.cjs`,
`slotdensity.cjs`, `integrity.cjs`, `contam.cjs`, `contam2.cjs`, `knob.cjs`, `knob2.cjs`,
`knob3.cjs`, `veg.cjs`, `reach.cjs`, `scale.cjs`, `templates.cjs`, `draw.cjs`, `draw2.cjs`,
`targets.cjs`, `quar.cjs`, `misc.cjs`.

---

## 0. The headline, in five sentences

1. **Role tagging is NOT the root cause.** 22.4 % of recipes fall to the one-knob branch
   (replicating A13 exactly), but repairing the tags with the product's own `scaleRecipe`
   moves single-slot tolerance hits by **−0.4 to +2.1 points, sign inconsistent, across every
   diet and five slot sizes**. The dead knob correlates with a recipe having no protein, not
   with the tag being missing. MEASURED, and it is a null result the build agent should not
   spend money on.
2. **A11's per-diet density numbers were measured on a pool a third of which the solver can
   never place.** `NON_MEAL_CATEGORIES` bars 165 recipes from meal slots; 163 of those are
   also not snack-eligible, so **163 recipes (17.9 % of 910) are servable in NO slot at all**.
   On the pool that actually reaches a meal slot, vegetarian protein density is **5.30
   g/100 kcal, not 3.25**. A11's "vegetarian is dragged down by Churros and Eton Mess" is true
   of the raw pool and false of the solver's pool — those desserts were already excluded.
3. **The snack slot is the starved one, and its misses are provably pool-limited.** The
   library holds **18 snack-eligible recipes** (5 vegan, 4 keto, 8 paleo, 11 vegetarian, 1
   carnivore) against a slot that carries **11.6–28.2 % of the day's kcal budget**, and
   `slotAttemptBudget` exceeds the candidate count for *every* diet — so the snack slot is
   searched **exhaustively**. Whatever it misses, the pool caused.
4. **84 % of the omnivore pool's high-protein-AND-lean supply — the exact corner every target
   sits in — is the 158 generated `High-Protein … with …` templates the solver deliberately
   down-weights 0.35×.** For vegetarian it is 98 % (40 of 41), for vegan 96 %. That
   down-weight halves the draw mass on the target corner (21.7 % → 12.7 % omnivore) and drops
   the chance of seeing one in the 5-candidate draw from **70.5 % to 49.3 %**. MEASURED with
   the product's own `pickRecipe` weight terms.
5. **Recipe cached macros are clean; the food rows under them are not.** Cached vs
   ingredient-sum kcal drift is **≤0.19 % on all 910 recipes** (a 07-31 repair pass fixed
   this). But **81 food rows self-declare their macros belong to a different food and were
   never repaired**, and they appear in **146 recipes (16.0 %)** — 29 of which draw >25 % of
   their kcal and 39 >25 % of their protein from a row known to be wrong.

---

## 1. Verified library scale and structure

**MEASURED**, `D5/analyze1.cjs`, `SELECT COUNT(*)` against `dev-copy.db`:

| object | count |
|---|---|
| `Recipe` | **910** |
| `Food` | **14,151** |
| `RecipeIngredient` | **7,119** |
| `GeneratedRecipe` | 0 |
| distinct `Food` rows referenced by ≥1 recipe | **805** (5.7 % of 14,151) |

Matches the expected scale. **Not the 626-recipe clone.** Independently corroborated: running
the product gate (`exclusionGate.filterRecipes`) against this copy reproduces A11's pure-style
survivor counts *exactly* — none 910, mediterranean 814, halal 758, kosher 680, vegetarian 401,
vegan 169, paleo 167, keto 53, carnivore 3. And recomputing target densities from
`personas.jsonl` through the product `bmrEngine` reproduces A11's headline exactly:
**non-IMPOSSIBLE (218 personas) target protein median 8.16, fat median 2.60 g/100 kcal**
(`D5/targets.cjs`). Both instruments agree; measurements below are on the same footing as A11's.

**Composition** (MEASURED, `analyze1.cjs`):

| axis | values |
|---|---|
| `Recipe.source` | themealdb-import 602 · ai-generated 262 · curated 45 · imported 1 |
| `Recipe.slotType` | **meal 892 · snack 17 · either 1** |
| `Recipe.mealCategory` | null 720 · dessert 139 · breakfast_only 25 · bread_or_pastry_side 21 · condiment_or_sauce 5 |
| `Food.source` | usda-verified 13,516 · manual 528 · **quarantined 77** · manual-placeholder 29 · usda 1 |
| ingredients per recipe | min 2 · p10 4 · **median 7** · p90 14 · max 20 · mean 7.82 |

**94.3 % of the food library is inert with respect to the recipe pool.** Only 805 of 14,151
foods are referenced. The other 13,346 exist for the Foods tab, the closer's adjusters, and
search. Any claim of the form "the library has 14,151 foods so X is available" is measuring
the wrong object — the solver's raw material is 805 rows.

### 1a. The DB moved under the previous fleet

**MEASURED**, diffing A11's snapshot (`solver-brain/A11/dev.db`, 2026-07-30 21:21) against mine:
**261 of 910 recipes (28.7 %) had their cached macros change** between the two snapshots
(`foodOverrides.json` was rewritten 2026-07-31 06:58; a `provenance149` backup was taken 05:50).
Row counts, ingredient roles and `scalable` flags are **unchanged** (0 diffs). So every A11/A16
*density* number is one repair pass stale — the medians moved little (none 5.38→5.38,
vegetarian 3.25→3.22, vegan **5.08→5.63**, paleo 5.86→5.81), but the vegan median moved 0.55
because that distribution has a gap at the median. Numbers below are the post-repair state.

---

## 2. The role / `scalable` tagging audit

### 2.1 The mechanism being audited

`weeklyPlanner.js:394-418` — `scaleRecipe` splits ingredients three ways and solves a 2×2
linear system for `(proteinScale, sidesScale)`:

```
weeklyPlanner.js:395  const fixed    = bundleMacros(recipe.ingredients.filter((i) => !i.scalable));
weeklyPlanner.js:396  const scalable = recipe.ingredients.filter((i) => i.scalable);
weeklyPlanner.js:397  const proteinIngs = scalable.filter((i) => i.role === "protein");
weeklyPlanner.js:398  const restIngs    = scalable.filter((i) => i.role !== "protein");
weeklyPlanner.js:407  if (proteinIngs.length === 0 || Math.abs(det) < 1e-6) { ... uniform kcal-only fallback }
```

A `null` role falls into the **sides** bundle. So an untagged chicken breast is scaled as a
side dish, and a recipe with no `role === "protein"` row has **no protein knob at all** — it
degrades to `kcalTarget / recipe.kcal`, a single factor that can hit calories or protein but
not both. This is the exact failure the module header says the two-knob design exists to fix.

### 2.2 The counts

**MEASURED**, `D5/analyze1.cjs`, `analyze3.cjs`, on all 7,119 ingredient rows:

| role | rows | % |
|---|---|---|
| **`NULL`** | **2,469** | **34.68 %** |
| veg | 1,523 | 21.39 |
| carb | 1,275 | 17.91 |
| fat | 852 | 11.97 |
| **protein** | **851** | **11.95** |
| other | 144 | 2.02 |
| dairy | 4 | 0.06 |
| fruit | 1 | 0.01 |

**Solver-breaking cases, per recipe (910 total, all have ≥1 ingredient):**

| case | recipes | share |
|---|---|---|
| **zero scalable `role="protein"` ingredient → protein knob DEAD** | **200** | **22.0 %** |
| `det < 1e-6` despite protein rows present | 4 | 0.4 % |
| **total on the one-knob fallback branch** | **204** | **22.4 %** |
| zero scalable non-protein ingredient → sides knob dead | 4 | 0.4 % |
| zero scalable ingredients at all | 0 | 0 % |
| every ingredient `role = NULL` | 1 | 0.1 % |
| **both knobs live** | **706** | **77.6 %** |

**22.4 % replicates A13's independently-measured 204/910 exactly.** (C6 in `CORRECTIONS-2.md`
recorded that A9 never measured this and quoted a schema comment; A13 measured it; D5 now
confirms it from the current DB.)

Restricted to the pool that can actually reach a meal slot (§3), the dead-knob rate is
**132/730 = 18.1 % omnivore**, and it is **worst exactly where compliance is worst**:

| diet | meal-eligible pool | dead protein knob | % |
|---|---|---|---|
| vegetarian | 256 | 80 | **31.3** |
| vegan | 145 | 41 | **28.3** |
| paleo | 144 | 32 | 22.2 |
| kosher | 514 | 111 | 21.6 |
| mediterranean | 654 | 125 | 19.1 |
| halal | 598 | 109 | 18.2 |
| none | 730 | 132 | 18.1 |
| keto | 49 | 5 | 10.2 |

The four dead-**sides**-knob recipes are all legitimately two-protein plates (`Bacon & Eggs`,
`Jerky & Pork Rinds Snack Plate`, `Edamame with Sea Salt`, `Hard-Boiled Eggs with Chilli Salt`).
Not a defect.

### 2.3 Why the tags are missing — the mechanism, named

`role` is a **denormalised, one-shot snapshot of `Food.category`**, and it has drifted.

- `backend/scripts/backfillImportedIngredientRoles.js:21` —
  `const CATEGORY_TO_ROLE = { protein: "protein", carb: "carb", veg: "veg", fat: "fat" };`
  Only 4 keys. The DB's actual `Food.category` vocabulary is the 7 grocery-store categories
  (`protein`, `pantry`, `dairy-eggs`, `fruit-veg`, `grains`, `fats-nuts-oils`, `drinks`) — so
  `grains`, `fruit-veg`, `fats-nuts-oils` never matched either, and **`dairy-eggs` and
  `pantry` map to nothing**. The script's own header says recipes with no protein-category
  ingredient "correctly keep `role: null`"; the map it uses cannot see `dairy-eggs`.
- `backend/src/lib/recipeImporter.js:760-763` uses a *different, richer* map for the URL
  importer — `"dairy-eggs": "protein"`, `pantry`/`drinks` → `"other"`. **Two maps, one
  column.**
- **The backfill is stale.** MEASURED: **49 ingredient rows whose `Food.category` is
  `protein` still carry `role = NULL`** — all 49 in `themealdb-import` recipes, i.e. inside
  the script's own `where` clause. Either the categories were rewritten after it ran, or it
  never covered them. They are real proteins: Chorizo ×16, Squid ×7, Sardines ×2, Mussels ×3,
  Clams ×2, Conchs ×2, Goat Meat ×2, Black Pudding ×3, Lobster, Red Snapper, Mackerel,
  Sea Bass, Herring, Crab, Doner Meat, Shredded Meat, Anchovy Fillet.
  **1,093 rows disagree with the backfill script's own category map** (68 of which the map
  says should be `protein`).
- `dairy-eggs` foods hold **304 NULL-role rows** — Greek Yogurt ×17, Cottage Cheese, eggs.

### 2.4 Tagging accuracy — audited by numeric property, never by name

Protein-energy share `= 4·protein/kcal`. **MEASURED**, `D5/analyze2.cjs`:

- **False positives:** 79 of 851 rows tagged `protein` (9.3 %) sit below 20 % protein energy.
  Worst offenders by count: **Egg Yolks ×26** (fat, not protein), **Chickpeas ×11**,
  **Sausages ×9**, **Egg Plants ×7** (this is *eggplant* — a name-substring artifact),
  Black Beans ×5. Worst by value: **Duck Sauce (0.36 g P/100 g, 0.6 % protein energy)**,
  **Fish Sauce ×28** (tagged protein, `Food.category = pantry`), **Beef Gravy (1.5 g P/100 g)**,
  **Lamb Fat**, **Egg Roll Wrappers**, **Egg Noodles**.
- **False negatives:** 87 of 6,268 untagged rows (1.4 %) exceed 40 % protein energy AND
  10 g P/100 g. 75 are `NULL`, 5 `other`, 4 `carb`, 3 `dairy`.

**Rescue potential of the 200 dead-knob recipes:** only **37** contain a scalable ingredient
that is ≥30 % protein energy and ≥8 g P/100 g and is not tagged protein. **163 are genuinely
protein-less** — median protein density of the dead-knob set is **2.45 g/100 kcal** against
**6.36** for the live-knob set. The dead knob is mostly a *correct* description of the dish.
Dead-knob rate by source: **themealdb-import 195/602 = 32.4 %**, ai-generated 2/262 = 0.8 %,
curated 2/45. By category: condiment 80 %, bread/pastry 47.6 %, dessert 36.7 %.

### 2.5 THE COUNTERFACTUAL — and it is a null result

I did not stop at "the tags are wrong". I re-ran the **product's own `scaleRecipe`** against
the meal-eligible pool with seven different retag rules, at five slot sizes (kcal target,
protein target at the 8.16 g/100 kcal target median), scoring the product's own tolerances
(`KCAL_TOLERANCE_PCT = 0.15`, `PROTEIN_TOLERANCE_PCT = 0.12`). `D5/knob2.cjs`, `knob3.cjs`.

| retag rule | dead-knob recipes after | 300 kcal | 400 | 512 | 650 | 800 |
|---|---|---|---|---|---|---|
| **A — today, unchanged** | 132 | 34.5 % | 43.2 % | **46.2 %** | 42.5 % | 33.8 % |
| B — fill NULLs where food ≥25 % pE **or** ≥15 g P/100 g | **64** | 33.8 | 43.2 | 45.8 | 43.0 | 33.8 |
| C — fill NULLs where ≥40 % pE **and** ≥10 g P/100 g | 111 | 34.2 | 43.3 | 46.2 | 43.0 | 34.2 |
| D — dead-knob recipes only, promote largest protein contributor | **19** | 34.2 | 43.2 | 46.2 | 42.9 | 34.4 |
| E — dead-knob only, promote every scalable ing ≥25 % pE | 50 | 34.2 | 42.9 | 46.2 | 42.7 | 34.2 |
| F — `dairy-eggs` → protein where NULL | 92 | 34.5 | 42.3 | 45.5 | 42.1 | 33.4 |
| G — re-run the backfill additively (`category=protein` → protein) | 109 | 34.1 | 43.3 | 46.2 | 42.6 | 34.2 |

**Rule D takes dead-knob recipes from 132 to 19 — an 86 % repair — and moves the hit rate by
+0.0 to +0.6 points.** Per diet (rule B, 512 kcal slot): none 46.2 → 45.8, vegetarian
44.5 → 44.9, vegan 53.1 → 53.1, paleo 45.8 → 47.2, keto 40.8 → 42.9, kosher 51.0 → 50.8,
halal 51.7 → 51.2, mediterranean 48.2 → 47.7. **Sign is inconsistent; magnitude is under the
noise floor.**

A **naive full retag** (overwrite every role from the food's protein density) is actively
**worse**: −2.05 to −3.15 points, because moving mass into the protein bundle shrinks the rest
bundle and ill-conditions the 2×2 system. And **re-running the existing backfill in overwrite
mode raises dead-knob recipes from 200 to 385**, because the category map would *strip* the
protein role from pantry legumes (chickpeas, lentils, black beans) and from all `dairy-eggs`.

> **Verdict: role tagging is a real data defect and a false lead as a compliance lever.**
> A13 measured that days containing ≥1 one-knob slot are in band 73.3 % vs 81.6 % — that is a
> correlation between "this dish has no protein" and "this day misses protein", not evidence
> the tag is the cause. The causal test says the tag is not the cause. **Fix it for
> correctness and for the grocery/UI surfaces that read `role`; do not budget compliance
> points against it.**

### 2.6 `scalable` — a non-issue

**MEASURED**, `analyze1.cjs`: 1,455 of 7,119 rows (20.4 %) are `scalable = false`. But the
**fixed bundle's share of recipe kcal** is negligible: deciles
`0.0 % 0.0 % 0.0 % 0.1 % 0.3 % 0.6 % 1.2 % 3.5 % 8.8 % 12.3 %`, p99 24.3 %.
**Zero recipes have a fixed bundle over 50 % of kcal; four are over 30 %; 203 have none at
all.** A large un-portionable bundle is not a live failure mode in this library.

### 2.7 The protein knob's *authority*, where it is live

**MEASURED**, `D5/misc.cjs`, meal-eligible pool (n = 730). Share of the recipe's total protein
that the scalable protein-role bundle controls, by decile:
`0 % 0 % 12 % 50 % 62 % 72 % 77 % 83 % 87 % 90 % 100 %`.
**171 recipes (23.4 %) have a protein knob controlling under a quarter of their own protein.**
Extra grams the knob can add going 1× → 2×: median **24.0 g**, p25 5.5 g, p10 0.0 g — against a
512 kcal slot asking **41.8 g**. **217 recipes can add under 10 g; 180 under 5 g.** So even
where the knob is live, in a quarter to a third of the pool it is a weak lever. This is a
*density* fact, not a *tagging* fact — consistent with §2.5.

---

## 3. Per-slot suitability — the biggest structural finding

### 3.1 There is no breakfast / lunch / dinner

`Recipe.slotType ∈ {meal, snack, either}`. `weeklyPlanner.js:184` —
`matchesType = (r) => r.slotType === slotType || r.slotType === "either"`. `mealCategory`
carries `breakfast_only` (25 recipes) and the planner comment at L177-179 says it is
**deliberately not excluded** ("no time-of-day concept to route it with"). So the "per-slot"
question reduces to **meal vs snack**, and there are only two pools.

### 3.2 165 recipes are barred from meal slots; 163 of them are servable nowhere

`recipeClassification.NON_MEAL_CATEGORIES = {dessert, beverage, bread_or_pastry_side,
condiment_or_sauce}`, applied at `weeklyPlanner.js:185`. That bars **139 desserts + 21
breads/pastries + 5 condiments = 165 recipes** from meal slots. Only 2 of them are also
snack-eligible. **163 recipes — 17.9 % of the library — can be placed in NO slot the solver
builds.** MEASURED, `D5/slots.cjs`.

**This invalidates the pool basis of A11's per-diet density table.** Vegetarian: 401 in the
gate-survivor pool, **256 meal-eligible + 11 snack-eligible = 267 servable, 134 (33.4 %)
servable nowhere.**

### 3.3 Density on the pool that actually reaches a slot

**MEASURED**, `D5/slotdensity.cjs`. Target medians (§1): protein **8.16**, fat **2.60**
g/100 kcal.

| diet | set | n | protein p10 / **med** / p90 | fat med | ≥ target P | ≤ target F | **both** |
|---|---|---|---|---|---|---|---|
| none | ALL *(A11 basis)* | 910 | 1.58 / **5.38** / 10.48 | 4.24 | 234 | 223 | 125 |
| none | **MEAL-slot eligible** | **730** | 2.44 / **6.35** / 10.72 | 4.02 | 223 (30.5 %) | 193 | **123 (16.8 %)** |
| none | SNACK-slot eligible | **18** | 3.23 / **7.69** / 9.92 | **5.58** | 8 | **2** | **2** |
| none | *servable nowhere* | 163 | 0.87 / 1.73 / 4.16 | 4.63 | 3 | 28 | **0** |
| vegetarian | ALL *(A11 basis)* | 401 | 1.15 / **3.22** / 8.56 | 4.08 | 58 | 106 | 42 |
| vegetarian | **MEAL-slot eligible** | **256** | 2.02 / **5.30** / 9.07 | 3.81 | 53 (20.7 %) | 79 | **41 (16.0 %)** |
| vegetarian | SNACK-slot eligible | **11** | 3.16 / 7.69 / 9.92 | 4.52 | 5 | 1 | 1 |
| vegetarian | *servable nowhere* | **134** | 0.80 / **1.56** / 3.12 | 4.74 | **0** | 26 | **0** |
| vegan | MEAL-slot eligible | 145 | 2.44 / **6.68** / 9.24 | 3.81 | 35 | 45 | 25 (17.2 %) |
| vegan | SNACK-slot eligible | **5** | 1.37 / **3.23** / 9.92 | 4.21 | 1 | **0** | **0** |
| paleo | MEAL-slot eligible | 144 | 2.22 / **6.44** / 11.22 | 4.35 | 57 | 34 | 26 |
| paleo | SNACK-slot eligible | **8** | 3.23 / 5.81 / 8.33 | **7.07** | 2 | **0** | **0** |
| keto | MEAL-slot eligible | 49 | 3.49 / **7.49** / 11.53 | 7.02 | 20 | **1** | **1** |
| keto | SNACK-slot eligible | **4** | 4.73 / 8.33 / 9.31 | 7.49 | 2 | **0** | **0** |
| halal | MEAL-slot eligible | 598 | 2.51 / **6.75** / 10.85 | 3.73 | 211 | 183 | 122 |
| kosher | MEAL-slot eligible | 514 | 2.28 / **6.62** / 10.69 | 3.74 | 174 | 162 | 103 |
| mediterranean | MEAL-slot eligible | 654 | 2.37 / **6.47** / 10.76 | 3.97 | 207 | 177 | 108 |
| carnivore | MEAL-slot eligible | 3 | — / 7.49 / — | 4.35 | 1 | 1 | 1 |

Full deciles for both the cached and the recomputed-from-ingredients basis are in
`D5/density-summary.json` and the `density.cjs` transcript; the two bases agree to ±0.05
g/100 kcal everywhere (§5.1).

**Reading:**
- A11's core structural claim **survives on the corrected pool**: the pool is still less
  protein-dense (6.35 med vs 8.16 target) and still fattier (4.02 med vs 2.60 target) than
  any target, in every style. **Only 16.8 % of the omnivore meal pool sits in the joint
  target corner** (≥8.16 P and ≤2.60 F), and 16.0 % for vegetarian, 17.2 % vegan.
- A11's *vegetarian-specific* number does not survive. **5.30, not 3.25.** The gap between
  vegetarian and omnivore at the 50th percentile is 1.05 g/100 kcal, not 2.13.
- **Keto's fat wall is absolute**: 1 of 49 meal recipes and 0 of 4 snacks are at-or-below the
  target fat median. Keto is a *fat-composition* pool problem, not a protein one (20 of 49
  clear protein).

### 3.4 The snack slot is starving — and it is provably pool-limited

**MEASURED**, `D5/slots.cjs`, `reach.cjs`:

| diet | snack-eligible recipes |
|---|---|
| none | **18** |
| mediterranean / halal | 15 |
| kosher | 14 |
| vegetarian | **11** |
| paleo | **8** |
| vegan | **5** |
| keto | **4** |
| carnivore | **1** |

The full snack library, all 18 rows, is listed in the `slots.cjs` transcript. Only 6 of 18
carry `role`-usable protein density ≥8.16; **only 2 of 18 are at-or-below the target fat
median**, and the snack pool's median fat density (5.58) is the **worst of any set in the
library** — 2.1× the target.

**Load the snack slot carries** (product weights, `buildSlots` L145-157: meals 0.9 / 1.0 /
1.15, snacks 0.4):

| config | snack share of the day's kcal |
|---|---|
| 4 meals + 1 snack | 9.0 % |
| 3 meals + 1 snack | 11.6 % |
| 4 meals + 2 snacks | 16.5 % |
| 3 meals + 2 snacks | **20.8 %** |
| 3 meals + 3 snacks | **28.2 %** |

**192 of 250 personas (76.8 %) request ≥1 snack.** Slot kcal targets across all 250 personas:
meal p10 290 / med **512** / p90 878; snack p10 126 / med **210** / p90 323.

**The snack slot's misses are pool-limited by construction.** `slotAttemptBudget(poolSize) =
clamp(floor(pool/10), 5, 20)` (L102-105) and candidates are drawn without replacement via the
`tried` set — so the budget (20 omnivore, 16 vegan, 5 keto) **meets or exceeds the entire
snack candidate list for every diet**. The snack slot is searched **exhaustively**. There is
no fallback to meal recipes: `eligibleRecipes` hard-filters `slotType`, and an empty candidate
list `break`s to `unsolvedResult`.

**Weekly capacity vs demand at `DEFAULT_REPEAT_CAP = 2`** (hard filter, L186):

| diet | snack pool | weekly capacity | snacks/day | weekly demand | **shortfall** |
|---|---|---|---|---|---|
| vegan | 5 | 10 | 2 | 14 | **4 slots** |
| vegan | 5 | 10 | 3 | 21 | **11** |
| keto | 4 | 8 | 2 | 14 | **6** |
| keto | 4 | 8 | 3 | 21 | **13** |
| paleo | 8 | 16 | 3 | 21 | **5** |
| carnivore | 1 | 2 | 1–3 | 7–21 | **5–19** |

**6 of 53 week-horizon snack personas are arithmetically unable to fill every snack slot**,
before any macro consideration. This is the pool-side mechanism behind **A16's largest measured
result**: 8 synthetic recipes, *all snacks*, 145–236 kcal at 0.54–0.91 g fat/100 kcal, bought
**+10.45 points**. A16 found the effect; D5 names why it was available — the snack slot is one
eighteenth as deep as the meal slot, carries up to 28 % of the day, is exhaustively searched,
and is the fattiest corner of the library.

### 3.5 Serving-scale reachability

`SCALE_BOUNDS = {min: 0.5, max: 2}` (L58). A recipe with base kcal K serves a slot target T
iff K ∈ [T/2, 2T]. **MEASURED**, `D5/scale.cjs`:

- Meal-eligible base kcal deciles: `13 250 367 410 474 549 601 669 853 1110 11825`.
- **47 of 730 meal recipes (6.4 %) can never serve any slot in the central 290–878 kcal band**
  — 29 too small, 18 too big.
- Per-slot, the reachable fraction of the omnivore meal pool is **p10 42.5 % / median 72.7 % /
  p90 78.6 %** — a real narrowing at the extremes.
- Whole-pot rows the solver can never portion down: **Tahini Lentils 11,825 kcal / 8,920 g**,
  **Split Pea Soup 9,282 kcal / 10,991 g**, Cheese Borek 3,710, Egg Foo Young 2,500,
  Paracuca 2,456. Under-portioned rows: **Grits 13 kcal**, Grilled eggplant 53,
  **Ramen Noodles with Boiled Egg 60**, Mango chow 63, **Thai drumsticks 76**.
- 5 meal recipes exceed 1,500 g total base grams; 3 exceed 2,500 g.

---

## 4. Data-integrity issues that would corrupt the solve

### 4.1 Cached recipe macros are IN SYNC — this one is clean

**MEASURED**, `D5/integrity.cjs`. Comparing `Recipe.{kcal,protein,fat,carb}` against
`Σ food.macro × baseGrams/100`:

- kcal drift **>1 %: 0 recipes. >5 %: 0. >15 %: 0.** Worst single recipe: **0.19 %**.
- protein drift >1 %: 13 recipes; >5 %: 1; >15 %: 0.
- Atwater (`4P + 4C + 9F` vs stored kcal, 15 % band, constitution rule 5): **5 of 910 fail
  (0.5 %)** — Red onion pickle +22 %, Mango chow +22 %, Lao Som Pak +20 %, Vietnamese veggie
  hotpot +16 %, Sesame Cucumber Salad +15 %.

**The solver is not optimising against a stale cache.** The 07-31 repair pass closed this. Any
build-prompt instruction to "recompute recipe caches from ingredients" would be a no-op today.

### 4.2 But 81 food rows underneath are known-wrong and were never repaired

**MEASURED**, `D5/contam2.cjs`, classifying `Food.dataQuality`:

| classification | foods |
|---|---|
| `provenance-restored` (**repaired** 2026-07-31) | 149 |
| **`quarantined` — macros known wrong, no replacement found** | **77** |
| **`NEEDS A HUMAN DECISION`** | **4** |

> **Verification-shape note on my own work:** a `LIKE '%belong to a different food%'` search
> returns **230** rows and looks like a live-defect count. **149 of those are repaired** and
> merely retain the historical note in their `dataQuality` string. The honest untrustworthy
> set is **81**. I report both so the difference cannot be re-lost.

Every one of the 81 is used in at least one recipe.

| exposure | value |
|---|---|
| recipes containing ≥1 untrustworthy row | **146 (16.0 %)** — 116 meal-eligible |
| median share of a touched recipe's kcal from such rows | 5.6 % (p90 45.1 %) |
| recipes with **>25 % of kcal** from an untrustworthy row | **29** |
| recipes with **>50 % of kcal** | **12** |
| recipes with **>25 % of their PROTEIN** | **39** |
| recipes with **>50 % of their protein** | **27** |

Per-diet meal-pool exposure: none 15.9 %, mediterranean 15.9 %, halal 14.2 %, paleo 13.2 %,
kosher 12.8 %, vegetarian 9.8 %, keto 8.2 %, vegan 4.1 %.

Worst meal-eligible cases (kcal share / protein share): **Arepa 100 %/100 %**, Vietnamese prawn
spiralized rolls 97 %/96 %, Ful Medames 81 %/92 %, Venezuelan Shredded Beef 76 %/89 %,
Mbuzi Choma 75 %/29 %, Steak & Vietnamese noodle salad 71 %/88 %, French Omelette 60 %/65 %,
**Paella 60 %/55 %**, Pad Thai 54 %/66 %.

Visibly-wrong values still shipping: **Raw tiger prawns 387 kcal / 16.8 g P / 14.3 g F /
56.5 g C per 100 g** (prawns have no carbohydrate), **Star Anise 337 kcal / 17.6 g P**
(a spice, contributing 43 % of Beef pho's calories), **Floury Potatoes 266 kcal/100 g** (raw
potato is ~77), **Lamb Stock 193 kcal / 20.3 g P per 100 g** (stock is ~10), **flax eggs
55 kcal / 10.7 g P / 0 g F** (flax is ~35 % fat), Harissa Spice 342 kcal, Macaroni 82 kcal,
sweet chilli sauce, Thai Red Curry Paste, Single Cream, Coconut Cream.

**Consequence for the solve:** the cached macros are a *faithful* reproduction of wrong
numbers. A recipe whose protein is 89 % supplied by a row that says "these are not this food's
numbers" is scored, portioned, ranked and shipped as if it were verified. The 2×2 solve, the
protein-density draw weight, and `compositionWeight` all read those numbers.

### 4.3 Other integrity notes

- **14 zero-macro foods (all four macros 0) appear in 393 ingredient rows across 296
  recipes.** They contribute nothing and are invisible to the solve; harmless arithmetically,
  but they inflate ingredient counts and the grocery list.
- **2 recipes exceed 15 g P/100 kcal** — `Camaro Grelhado…` at 22.2 and `Turkey & Swiss
  Roll-Ups` at 18.1. Both plausible (lean prawn, lean deli turkey), neither impossible.
- **13 meal recipes are under 100 kcal** and **1 under 50** (`Grits`, 13 kcal).
- There is **no `incomplete data` flag on the Recipe row.** `foodValidation.js:347` produces
  the *string* "should read 'incomplete data'" as a per-recipe validator detail, and
  `RecipesTab.jsx:67,1150` renders it — it is computed at request time from ingredient
  provenance, never persisted. So "how many recipes are flagged incomplete" has no stored
  answer; the closest measurable proxy is §4.2's **146 recipes / 16.0 %**.
- `backend/data/foodOverrides.json` holds **322 entries** (object keyed by food name, with a
  `_README` describing "curated per-100 g corrections + Atwater exemptions applied by
  `scripts/fixFoodData.mjs`"). It is the repair vehicle; **149 of the ~470 historically-wrong
  rows have been restored through it, 81 remain untrustworthy.**

---

## 5. Two cross-checks worth carrying forward

### 5.1 Cached vs recomputed makes no difference to any density conclusion

A11's stated caveat was "ratios use stored `Recipe.*`; no recomputation from `Food` rows."
I ran the full per-diet decile table on **both** bases (`D5/density.cjs`). Every median agrees
to ≤0.05 g/100 kcal; every "≥ target" count differs by at most 1 recipe. **A11's caveat is
discharged — it was not load-bearing.**

### 5.2 The solver down-weights the only recipes that hit the target corner

**MEASURED**, `D5/templates.cjs`, `draw2.cjs`. `weeklyPlanner.js:220` —
`GENERATED_TEMPLATE_WEIGHT = 0.35`, applied at L282 to any recipe matching
`source === "ai-generated" && /^high-protein\b.*\bwith\b/i`. **158 recipes** match.

| set | protein med | fat med |
|---|---|---|
| the 158 generated templates | **9.71** | **2.12** |
| the rest of the meal pool (572) | 5.28 | 4.73 |
| *target* | 8.16 | 2.60 |

**The templates are the only part of the library that sits in the target box.**

| diet | high-protein **and** lean meal recipes | of which are down-weighted templates |
|---|---|---|
| none | 123 | **103 = 84 %** |
| **vegetarian** | 41 | **40 = 98 %** |
| **vegan** | 25 | **24 = 96 %** |
| paleo | 26 | 21 = 81 % |
| kosher | 103 | 89 = 86 % |
| halal | 122 | 103 = 84 % |
| mediterranean | 108 | 88 = 81 % |
| keto | 1 | 0 |

Source composition of the omnivore meal pool: themealdb 439 / ai-generated 259 / curated 31 /
imported 1. Source composition of the **high-protein-and-lean** subset (123):
**ai-generated 108 / curated 10 / themealdb 5.** *Five of 439 imported recipes are in the
target corner.*

Draw-probability mass on the target corner, using the product's own `pickRecipe` terms
(protein-density distance × template multiplier × `compositionWeight`, representative slot
512 kcal / 41.8 g P / 13.3 g F / 47.5 g C):

| diet | corner mass, **shipping** | corner mass, **down-weight removed** | P(≥1 of 5 draws in corner) shipping → removed |
|---|---|---|---|
| none | 12.7 % | 21.7 % | **49.3 % → 70.5 %** |
| vegetarian | 14.8 % | 24.5 % | 55.1 % → 75.4 % |
| vegan | 15.5 % | 23.0 % | 57.0 % → 72.9 % |
| paleo | 13.4 % | 24.0 % | 51.3 % → 74.6 % |
| kosher | 15.7 % | 25.7 % | 57.3 % → 77.4 % |
| halal | 15.1 % | 24.9 % | 56.0 % → 76.2 % |
| mediterranean | 12.8 % | 21.2 % | 49.6 % → 69.6 % |
| keto | 0.5 % | 0.5 % | 2.6 % → 2.6 % |

**The 0.35× multiplier was added for a real, measured reason** (L212-219: QC customers saw a
week of near-clones; a meat-eater was served TVP/seitan). This is not an argument to delete
it. It is a statement that **the anti-monotony rule and the compliance target are in direct
conflict, and the pool is the reason** — because the library has essentially no *real*
high-protein-lean dishes for the rule to prefer instead. **Authoring 5 themealdb-style
high-protein-lean dishes is worth more than 5 more templates, because it is the only thing
that dissolves the conflict rather than choosing a side.** ESTIMATED as a causal claim — D5
measured the pool composition and the draw mass, not a paired solve delta.

---

## 6. What authoring / data work would actually raise compliance — ranked

Ranked by measured evidence per unit of effort. Rows 1–2 have direct measured deltas from A16;
rows 3–6 are D5 pool facts with the causal step named as ESTIMATED.

| # | work | size | evidence | why |
|---|---|---|---|---|
| **1** | **Author high-protein, low-fat SNACK recipes** (≥8.16 g P/100 kcal, ≤2.6 g F/100 kcal, 130–320 kcal), and give **vegan / keto / paleo / vegetarian** at least 12 each | ~8 for the effect, ~40 to close the weekly capacity shortfalls | **A16 MEASURED +10.45 pts from 8 such rows, all snacks.** D5 MEASURED: pool is 18 rows total, 5 vegan / 4 keto; 2 of 18 meet target fat; slot carries 11.6–28.2 % of the day; search is exhaustive so misses are provably pool-caused | Highest measured return in the whole study, and D5 identifies the structural reason it was available |
| **2** | **Add 1–4 protein-concentrate `Food` rows** and 4–8 recipes built on them (whey / soy isolate / **spirulina 57.5 g P/100 g** / `Nutritional powder mix, protein, NFS` 78.1 g P/100 g — all already in the DB and all clearing the vegan gate per C22) | 1 food row + ~4 recipes | **A16 MEASURED: ~4 recipes reach 85 %; 6.5× cheaper than vegan whole-food authoring, 16× cheaper than vegetarian** | The whole-food protein-density ceiling is the binding wall; a concentrate steps over it. Provenance tier is **LABEL, not USDA-VERIFIED** (C22 / A23) — must be tagged as such |
| **3** | **Author real (non-template) high-protein-lean MEAL recipes**, weighted to vegetarian/vegan | ~50 buys +6 pts of pool median; ~150 moves vegetarian's median onto target | D5 MEASURED: **only 5 of 439 themealdb imports are in the target corner**; 84–98 % of that corner is the 0.35×-suppressed templates | Dissolves the anti-monotony/compliance conflict instead of picking a side. Authoring simulation: vegetarian meal median 5.30 → 6.76 at N=50, → 9.04 at N=200; fraction at-or-above target 21 % → 34 % → 55 % |
| **4** | **Repair the 81 untrustworthy food rows**, prioritising the 39 recipes drawing >25 % of their protein from one | 81 rows | D5 MEASURED: 146 recipes (16.0 %) touched, 29 at >25 % of kcal | Correctness, not points. The solver currently portions Paella and Pad Thai against fiction. Also a constitution violation (provenance law) |
| **5** | **Fix the ~47 serving-scale rows** (Tahini Lentils 11,825 kcal, Split Pea Soup 9,282, Grits 13, Ramen 60) | ~47 rows | D5 MEASURED: 6.4 % of the meal pool can never serve a 290–878 kcal slot | Small compliance value; large trust value — these are visibly absurd in the UI |
| **6** | **Repair the ingredient `role` tags** — merge the two category maps, make the fill **additive-only**, prefer rule D (dead-knob recipes: promote the largest protein contributor) | 200 recipes / ~150 ingredient rows | D5 MEASURED: repairs 132 → 19 dead knobs. **Compliance delta −0.4 to +2.1 pts, sign inconsistent** | **Do this for correctness and for the surfaces that read `role`, NOT for compliance.** Never re-run the existing backfill in overwrite mode: it takes dead knobs 200 → **385** |

**What NOT to do, with the reason:**

- **Do not author more vegetarian *desserts* or treat A11's 3.25 g/100 kcal as the vegetarian
  number.** The 232 recipes vegetarian admits over vegan have median **2.23** g P/100 kcal —
  but **115 of the 232 are servable in no slot at all** (104 desserts, 8 breads, 3 condiments),
  and the meal-eligible remainder (111) sits at **4.20**. Every low-density name A11 cited
  (Churros 0.51, Eton Mess 0.64, Bulgarian Honey Cookies 0.79, Krispy Kreme 0.79, Lamingtons
  0.87) is `mealCategory = dessert` and **already barred from meal slots**. They are not in the
  solver's pool and removing them changes nothing.
- **Do not spend the compliance budget on role tagging** (§2.5).
- **Do not attack keto with protein authoring.** 20 of 49 keto meal recipes already clear the
  protein target; **1 of 49 clears fat, 0 of 4 snacks do.** Keto is a fat-composition wall.
  A16 measured **zero** synthetic rows admitted and **zero** days gained for keto in all five
  arms.
- **Do not "recompute recipe caches from ingredients."** Already in sync to ≤0.19 % (§4.1).
- **Do not delete `GENERATED_TEMPLATE_WEIGHT`** on the strength of §5.2 alone — D5 measured the
  draw-mass cost, not a paired solve delta, and the rule exists for a measured product defect.
  Authoring (row 3) is the fix that costs nothing on either side.

---

## 7. What I could NOT determine — named

1. **Whether any of rows 3–6 above actually move days-in-band.** D5 measured pool structure and
   single-slot `scaleRecipe` outcomes. Only A16's snack/concentrate arms carry a paired solve
   delta. Every D5 recommendation past row 2 is a pool fact with an **ESTIMATED** causal step.
   The build agent must price them on the rig, not on my table.
2. **Whether removing or softening `GENERATED_TEMPLATE_WEIGHT` gains or loses days.** I
   measured the draw-probability mass it removes (§5.2) and the near-clone defect it was built
   to fix (L212-219). I did **not** run the paired arm. It is a one-literal change at
   `weeklyPlanner.js:220` and belongs in the A13/A18 measurement frame.
3. **How many days actually fail *because of* the snack slot.** I proved the snack pool is 18
   rows, that its misses are pool-limited (exhaustive search, no cross-slot fallback), and that
   6 of 53 week-horizon snack personas are arithmetically short. I did **not** attribute
   observed failing days to snack slots — that needs the per-slot outcome records D1/D3 hold.
4. **Whether the 81 untrustworthy rows push their recipes *toward* or *away from* the target
   band.** I measured exposure (which recipes, what share of kcal and protein). I did not
   measure the sign of the error, because the correct values are unknown — that is precisely
   why the rows are quarantined.
5. **What `role` values other than "protein" are for.** `carb`/`veg`/`fat`/`other`/`dairy`/
   `fruit` are collapsed into one bundle by `scaleRecipe` and are inert to the solve. They may
   matter to the grocery list or the closer; I did not trace those consumers.
6. **The `role` column's true intended vocabulary.** `aiRecipeClient.js:69` enumerates
   `["protein","carb","veg","fat","dairy","other"]`; `backfillImportedIngredientRoles.js:21`
   comments that role is `"protein"|"carb"|"veg"|"fat"|null`; the DB additionally contains
   `dairy` (4) and `fruit` (1). Three specifications, no schema-level enum. Which is
   authoritative is a decision, not a measurement.
7. **Whether the 07-31 macro repair changed compliance.** 261 recipes' cached macros moved
   between A11's snapshot and mine. Every Phase-4 delta in `solver-brain/` was measured on the
   pre-repair DB. Whether the baseline is still 70.1 % / 77.0 % after that repass is
   **unverified** and is the single largest threat to reusing the prior fleet's levels.
8. **Slot-type suitability beyond meal/snack.** There is no breakfast/lunch/dinner concept in
   the schema, so "is one slot type starving the solver" could only be answered for two slot
   types. Whether time-of-day routing would help is unmeasurable against this data model.
