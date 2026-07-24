# Agent 05 — Meal-plan generator: end-to-end allergy safety

**VERDICT: FAIL — confirmed leaks. The generator ships recipes containing excluded
allergens to 7 of the 10 supported allergy checkboxes.** The filter reads only
structured `RecipeIngredient → Food.name`. It never reads the recipe TITLE and never
reads the cook STEPS (except one narrow `Add'l ingredients:` prefix pattern that
matches exactly **1 of 889** recipes). Allergens declared in the title or instructed
in prose pass through untouched.

Method: scratch copy of `backend/prisma/dev.db` (889 recipes / 14,122 foods / 798
distinct recipe foods). Real path: `planContext()` → `filterRecipePool()` →
`generateBestWeekPlan()` (identical options to `POST /api/plans/generate`). One
profile per allergen, that allergy only, `dietaryStyle: null`. BRAIN=off.
Scripts: `scratchpad/a05/{gen,detail,inspect,sweep}.cjs`.

---

## 1. Results table (20 generated weeks per allergen, 28 slots/week)

| allergen | pool after filter | weeks | slots filled | empty slots | weeks shipping ≥1 confirmed leak | leak slots | example leak |
|---|---|---|---|---|---|---|---|
| shellfish | 812 / 889 | 20 | 560 | 0 | 0/20 | 0 | (in pool, didn't ship) Sushi — step 19 "half a prawn" |
| fish      | 774 / 889 | 20 | 560 | 0 | 0/20 | 0 | (in pool) Beef Dumpling Stew — "add the Worcestershire sauce" |
| kiwi      | 889 / 889 | 20 | 560 | 0 | 0/20 | 0 | none found — clean |
| soy       | 753 / 889 | 20 | 560 | 0 | 2/20 | 2 | Thai rice noodle salad — "fish or **soy sauce**" |
| dairy     | 582 / 889 | 20 | 560 | 0 | 7/20 | 7 | Grilled Chicken Breast & Perogies ×5 |
| eggs      | 653 / 889 | 20 | 560 | 0 | 2/20 | 2 | Fish Stew with Rouille — "stir the harissa through the **mayonnaise**" |
| gluten    | 458 / 889 | 20 | 560 | 0 | 10/20 | 11 | Tafelspitz ×8 ("semolina dumplings"), Croatian Goulash ×3 |
| peanuts   | 855 / 889 | 20 | 560 | 0 | 2/20 | 2 | Singapore Noodles — "1 tablespoon of the **peanut** or canola oil" |
| tree nuts | 818 / 889 | 20 | 560 | 0 | 0/20 | 0 | (in pool) BeaverTails — "slathering of Nutella and toasted almonds" |
| sesame    | 840 / 889 | 20 | 560 | 0 | 6/20 | 6 | Beef Mechado ×6 — marinade step calls for **sesame oil** |

**Cost of safety: zero.** 560/560 slots filled for every allergen; the solver never
declared unsolvable and never left an empty slot. No "safe because it can't produce a
plan" failure. Worst-case pool shrink is gluten (889 → 458, −48%), still solvable.

---

## 2. Confirmed leaks, ranked

### P0-1 — REAL WHEAT PASTA on a gluten-excluded plate (structured ingredient row)
This is the only leak that is not prose — the allergen is a real `RecipeIngredient`
row with grams, and it shipped.

- Profile: `excludedFoods: ["gluten"]`, `dietaryStyle: null`
- Recipe: **"Mediterranean Pasta Salad"** `cmrj2u6ti07elwlws791da43r` (slotType `meal`)
- Ingredient: **`farfalle`**, Food row id **`cmrj2tb6u00jpwlwse840poza`**
- Cause: `CATEGORY_SYNONYMS.gluten` lists `pasta`, `spaghetti`, `macaroni`, `penne`,
  `fettuccine`, `linguine`, `tagliatelle`, `ravioli`, `tortellini`, `orzo` — but **not
  `farfalle`** (nor fusilli, rigatoni, conchiglie, cannelloni).
- Measured ship rate: **1 of 40 generated weeks** (2.5%). It also survives the
  library listing (`routes/recipes.js` uses the same name-only check) — its title
  literally contains "Pasta".

### P0-2 — Perogies + butter to a dairy allergy, the highest-frequency leak
- Profile: `excludedFoods: ["dairy"]`
- Recipe: **"Grilled Chicken Breast & Perogies"** `cmrfn2w780030wlg49qus3ftp`
- Ingredient: **`Perogies, boiled`**, Food row id **`cmrevpcn9000gwl5gw6adqo4o`**
  (also in "Perogies & Bacon"). Step: *"…or pan-fry in a little **butter** for crisp edges."*
- Cause — an internal inconsistency, not an oversight of the food: this codebase's own
  `ANIMAL_DERIVED_EXTRA_KEYWORDS` (vegan) lists `perogi`/`pierogi` as a hidden-dairy
  carrier, and `CATEGORY_SYNONYMS.gluten` lists them too. `CATEGORY_SYNONYMS.dairy`
  does not. **A vegan is protected from perogies; a dairy-allergic user is not** —
  exactly the inconsistency the curry-paste comment in this file says is indefensible.
- Measured ship rate: **8 of 40 weeks (20%)**.

### P0-3 — The recipe TITLE is never checked
`filterRecipePool()` (planContext.js:34-41), `routes/recipes.js:34-36`,
`routes/cart.js:20-22` and `aiRecipeCompliant()` (weeklyPlanner.js:32-35) all build
`flat = ingredients.map(i => ({ name: i.food.name }))`. `recipe.name` is never a probe.

Recipes whose own TITLE names the excluded allergen and still survive the filter:

| allergen | recipe | id |
|---|---|---|
| eggs | **"Egg Drop Soup"** (step 4: *"add 1 egg slightly beaten … to the soup"*; no egg ingredient row) | `cmrj2ufkm09biwlwsh88tcsse` |
| sesame | **"Roasted Eggplant With Tahini, Pine Nuts, and Lentils"** (no tahini ingredient row at all) | `cmrj2ui2w09vlwlwsfvso3lg0` |
| gluten | "Mediterranean Pasta Salad" (see P0-1) | `cmrj2u6ti07elwlws791da43r` |

(4 of the 9 gluten title-hits are correct non-matches — *Spiced tortilla* and *Salt
cod tortilla* are Spanish omelettes, *Almojábanas* is cornmeal, *pão de queijo* is
tapioca. "Corn on the cob … coconut **butter**" hitting `tree nuts` via `nut butter`
is a false positive: coconut is deliberately not a tree nut here.)

### P0-4 — Allergens instructed in cook steps (the bulk of the leaks)
Pool recipes whose step text names the excluded allergen, per allergen:
gluten **45**, dairy **27**, eggs **10**, fish 9, tree nuts 8, sesame 5, soy 2,
shellfish 2, peanuts 1, kiwi 0. Roughly a third are oracle false positives
(*"skip the butter tonight"*, *"fish out the rosemary"*, *"a fish slice"*, egg
*"curds"*, *"digestive tracts"* matching the gluten term `digestive`, *"walnut-sized
balls"*). The rest are real. Hand-verified, mandatory (not a serving suggestion):

- **dairy** — "Traditional Dutch rice tart (rijstevlaai)" `cmrj2tw510519wlws77rfjkzw`:
  steps 0 and 1 call for **100 g of milk** and milk in the rice pudding; the only
  ingredient row is `Vegetable Millk` (sic). Quantified dairy, invisible to the filter.
- **dairy** — "Beef Banh Mi Bowls…" `cmrj2td8j00umwlwsz2zyol7o`: *"stir in lime zest
  and 1 TBSP **butter**"*; no butter row. Shipped 2/20 weeks.
- **dairy** — "Beef Mandi" / "Chicken Mandi": *"Heat **ghee**/oil"*.
- **eggs** — "Hot and Sour Soup" `cmrj2u2lc06gywlws2wtyomxg` and "Egg Drop Soup":
  *"add 1 egg slightly beaten … to the soup"*. "Lao Naem Khao": *"Beat two eggs …
  dip the balls into the egg mixture"*. "Ful Medames": *"Peel hard-boiled eggs—1 per
  person"*. None have an egg ingredient row.
- **sesame** — "Beef Mechado" `cmrj2te240118wlws7wywvlp6`: marinade = *"soy sauce,
  vinegar, ginger, garlic, **sesame oil**…"*. Shipped 6/20 weeks. Also "Mamoul":
  *"fry some sesame in a pan"*.
- **shellfish** — "Lamb Rogan josh": *"Tip the **curry paste** …"* (the shellfish list
  excludes curry paste as an ingredient, but not in prose).

### P1-1 — Worcestershire is a declared carrier for gluten and fish, but not soy
`Worcestershire Sauce`, Food row **`cmrj2t74r0033wlwsf2w8xn44`**, sits in **7 recipes
that survive a soy exclusion** (Beef pumpkin Stew, Minced Beef Pie, Steak and Kidney
Pie, …). `CATEGORY_SYNONYMS.gluten` and `.fish` both list `worcestershire`; `.soy`
does not, though the sauce is soy-sauce based. Did not ship in 40 weeks, but it is in
the pool. Same class as P0-2.

### P2-1 — Persisted allergen metadata is dead code on this path
`foodMatchesExclusionTerm()` (metadata-aware: `allergenTags`, `mayContain`,
`fdcCategory`) is used only by `applyDietaryFilters()` on the flat food pool and by
the trace helpers. **Every recipe/solver/cart path uses name-only
`matchesExclusionTerm()`.** Currently harmless because the columns are empty —
measured on the real DB: `allergenTags` non-null = **0 / 14,122**, `fdcCategory`
non-null = **0 / 14,122** — but the moment any importer populates them, the backstop
will protect the Foods screen and not the meal plan.

### P2-2 — `aiRecipeCompliant()` skips the prose path its siblings have
weeklyPlanner.js:29-37 does not call `additionalIngredientNames(recipe.steps)`, while
planContext.js:38 and aiRecipeClient.js:38 both do. Currently unreachable (see §3),
but it is the last gate before an AI recipe enters a plan.

### Marginal / policy calls (flagged, not counted as leaks)
`Ground Oats` / `Oats` / `rolled oats` survive a gluten exclusion (oats are
gluten-free grain but standard celiac guidance is certified-GF oats only);
`Chocolate Chips` `cmrj2t94100bswlwss806wr9z` survives dairy (dark chips are
dairy-free, milk chips are not); `Tempura Flour` `cmrj2tazw00iywlwsokuihayn`
survives eggs (tempura batter is egg-based).

---

## 3. AI / unattended fallback — CLEAN, two independent barriers

1. `generateBestWeekPlan()` calls `generateWeekPlan(..., { ...options, aiFallback:
   undefined })` (mealSolver.js:582). **The week-generation path can never reach
   `tryAiFallback`, regardless of what the caller passes.** Verified empirically:
   with an EMPTY pool and `aiFallback: { enabled: true, maxCalls: 5 }` explicitly
   set, the result was **0 of 28 slots filled**, warning `"No eligible meal recipe
   left for this slot."` — an honest unsolved slot, no injected recipe.
2. With `BRAIN=off` and no `AI_RECIPE_DRAFTS`, `generateAndSaveSlotRecipe()` throws
   before any transport: `LlmRefusal — "AI recipe drafting is switched off in this
   build."` Confirmed with a real `ANTHROPIC_API_KEY` present in the environment, so
   the gate is the flag, not a missing key. `tryAiFallback` catches and returns
   `null` → unsolved slot.

The only route that arms AI at all is `POST /plans/.../swap` (`plans.js:487`,
`maxCalls: 1`), and it is subject to barrier 2. **No unfiltered recipe can be
injected.** Note the residual: `tryAiFallback` decrements `callsRemaining` *before*
the try block, so a refusal still burns the budget — cosmetic only.

## 4. Scaled portions — CLEAN

`scaleRecipe()` → `applyScales()` (weeklyPlanner.js:206-230) maps over
`recipe.ingredients` and only multiplies `baseGrams`. It cannot add a `foodId`.
Measured across **5,600 shipped slots** (10 allergens × 20 weeks × 28 slots): **0**
slots whose shipped ingredient set contained a `foodId` absent from the base recipe,
and **0** shipped ingredient names matching the excluded allergen. A recipe that
passes at 1× passes at every scale in 0.5–2×.

---

## 5. Root cause (one line)

`filterRecipePool()` treats `RecipeIngredient → Food.name` as the complete
description of a recipe's contents. For this corpus it is not: 889 recipes carry
free-text `steps` that name real ingredients never modelled as rows, and titles that
name allergens the rows omit. The `Add'l ingredients:` escape hatch was built for
exactly this failure mode and covers 1 recipe.

**Suggested fix shape (orchestrator's call):** make the exclusion probe read
`[recipe.name, ...ingredient names, ...steps]` rather than ingredient names alone, and
accept the over-exclusion — the pool has 400+ headroom everywhere except gluten. That
alone closes P0-1 (title), P0-3 and P0-4. P0-2 and P1-1 additionally need `perogi`/
`pierogi` added to `CATEGORY_SYNONYMS.dairy` and `worcestershire` to `.soy`, plus the
missing pasta shapes (`farfalle`, `fusilli`, `rigatoni`, `conchiglie`, `cannelloni`)
to `.gluten`. Note that a naive prose sweep will produce the false positives listed
in P0-4 — negation ("skip the butter"), utensils ("fish slice"), and size similes
("walnut-sized") need handling or the pool will shrink for bad reasons.
