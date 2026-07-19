# 04 — Recipe Library Curation (mistagged-dessert root cause)

**Date:** 2026-07-19
**Scope:** backend only. Root cause #15 from `roadmap/03-recipe-curation.md`
(cross-referenced by the code audit `docs/audit/01-code-audit.md` and the
nutritionist review): the imported recipe pool is tagged `slotType:"meal"`
with `mealCategory` unset, so desserts are eligible to fill lunch/dinner slots
and were served in real generated plans.

All numbers below come from **actually processing the seed data**
(`backend/src/lib/portedFromRecomp/recipeLibrary.mjs`, 602 TheMealDB-imported
recipes) through the shipped classifier
(`backend/src/lib/recipeClassification.js`) — the same pure function the
re-tag script and the seeder call. Per-serving macros were recomputed exactly
as the seeder does (Σ ingredient grams × USDA per-100g ÷ servings). No
database was touched (the sandbox cannot run Prisma's engine).

> Scope note: 602 = the importable pool. The live DB additionally holds ~27
> hand-curated / AI-generated recipes (629 total in the roadmap's DB count).
> The re-tag script classifies whatever is in the DB; this report quantifies
> the 602 imports, which are the entire mistagging problem.

---

## 1. Headline

| | Before | After |
|---|---|---|
| Recipes tagged as an eligible main meal | **602 / 602** (all `mealCategory` null) | **459** |
| Desserts eligible to be served as lunch/dinner | **128** | **0** |
| Total recipes excluded from main-meal slots | **0** | **143** |

**128 desserts** (Churros, Krispy Kreme Donut, cheesecakes, cookies, Flan,
Postre Chajá …) are eligible **today** to be scaled up to a 400–600 kcal
protein-target meal slot. After curation, main-meal slots draw from 459
genuine dishes; the 143 non-meal items (128 dessert + 14 bread/pastry side + 1
condiment) are excluded.

---

## 2. Proposed category breakdown (all 602)

| mealCategory | Count | Excluded from main-meal slots? |
|---|---:|:--:|
| `proper_meal` (null) | 434 | No |
| **`dessert`** | **128** | **Yes** |
| `breakfast_only` | 25 | No — see §5 |
| `bread_or_pastry_side` | 14 | **Yes** |
| `condiment_or_sauce` | 1 | **Yes** |
| _(flagged `needsReview`, left null)_ | 12 | No — human decides (§4) |

The 12 review items are counted inside `proper_meal` above (they stay null /
eligible until a human rules on them).

### Two signals, combined for safety

The classifier reaches 128 desserts by combining two independent signals:

- **Name + ingredients + macros** (the generalizable engine, works on any
  recipe incl. future AI/imported ones): **100 desserts** on its own.
- **TheMealDB's own `dessert` source tag** (recovered by name from the seed
  data; the DB rows dropped it at import): pushes recall to **128**. The
  source tag is internally clean — of its 127 dessert-tagged recipes, **zero**
  are also tagged lunch/dinner, so there are no tag-vs-tag contradictions.

The engine also catches **6 real desserts the source tag missed** (Vegan
Chocolate Cake, Num Ansom Sticky Rice Cake, Pumpkin Jam, Sweet Dumpling,
peanut candy, breakfast pastries) — so classifier-OR-tag beats either alone.
Of the 127 source-tagged desserts, 122 are classified `dessert` and 5 sweet
pancakes/waffles are held as `breakfast_only` (still eligible — see §5).

---

## 3. Worst offenders — desserts currently servable as a main meal

Highest-calorie desserts eligible today, with their (tiny) protein. A meal
slot is scored on hitting a **protein** target; scaling one of these up to a
600 kcal slot delivers almost no protein and massive sugar — the exact failure
mode this fixes.

| kcal | Protein | Carb | Fat | Recipe |
|---:|---:|---:|---:|---|
| 1604 | 10 g | 82 | 140 | Churros |
| 1538 | 79 g | 303 | 13 | Num Ansom – Sticky Rice Cake |
| 1531 | 15 g | 195 | 86 | Tall Skoleboller |
| 1507 | 21 g | 206 | 67 | Jamaican Festival (Sweet Dumpling) |
| 1475 | 5 g | 379 | 1 | Muraba-E-Kadu (Pumpkin Jam) |
| 1448 | 40 g | 283 | 60 | Peanut Butter Cheesecake |
| 1359 | 20 g | 165 | 80 | Lamingtons |
| 1332 | 10 g | 230 | 45 | Fruit and Cream Cheese Breakfast Pastries |
| 1256 | 13 g | 127 | 81 | Choc Chip Pecan Pie |
| 1249 | 10 g | 98 | 93 | Bulgarian Honey Cookies |
| 1248 | 4 g | 135 | 71 | Krispy Kreme Donut |
| 1161 | 27 g | 139 | 72 | Kvæfjord Cake ("World's Best Cake") |
| 1138 | 18 g | 164 | 46 | Gevulde speculaas |
| 1065 | 67 g | 167 | 29 | Sticky Toffee Pudding Ultimate |
| 1033 | 3 g | 53 | 90 | BeaverTails |
| 997 | 10 g | 169 | 32 | Pouding chomeur |
| 989 | 12 g | 116 | 54 | Chocolate alfajores |
| 978 | 25 g | 162 | 54 | Saskatoon Pie |
| 932 | 17 g | 157 | 26 | Arroz con Leche |
| 922 | 5 g | 203 | 16 | Apam balik |

The three recipes the nutritionist review traced to real overshoot incidents
— **Flan**, **Postre Chajá**, **Jam jam cookies** — are all classified
`dessert` and excluded.

---

## 4. Flagged for human review (12) — never auto-tagged

The classifier refuses to guess on genuinely ambiguous names/macros. These are
left `mealCategory = null` (still meal-eligible) for a human call:

| Recipe | Why flagged | Likely call |
|---|---|---|
| Cumberland Pie | ambiguous "pie", no sweet/savory qualifier | proper_meal (British meat pie) |
| Pastel de Papas (Chilean Potato Pie) | ambiguous "pie" | proper_meal (savory) |
| Lakror me Kungull (Summer Squash Pie) | ambiguous "pie" | proper_meal (savory byrek) |
| Macaroni Pudding | ambiguous "pudding" | dessert (sweet baked pasta pudding) |
| Yorkshire Puddings | ambiguous "pudding" | bread_or_pastry_side (savory batter) |
| Ají de Aguacate (Colombian Avocado Sauce) | "sauce", P3/486kcal | condiment (avocado dip) |
| Papas Chorreadas (Potatoes w/ Cheese Sauce) | "sauce", P27/881kcal | proper_meal |
| Breadfruit in Butter Sauce | "sauce", P34/1403kcal | proper_meal |
| Smoky tomato pepper salsa | "salsa", P15/553kcal | proper_meal |
| Avocado dip with new potatoes | "dip", P21/936kcal | proper_meal |
| Falafel Pita Sandwich with Tahini Sauce | "sauce", P60/1582kcal | proper_meal |
| Griddled aubergines with sesame dressing | "dressing", has Greek yogurt (protein) | proper_meal / veg side |

This list is **12, not the roadmap's 35** — the source `dessert` tag now
auto-resolves most of the roadmap's earlier ambiguous cases (Boterkoek,
Cassava Cake, Eccles Cakes, Dundee cake, etc. are all source-tagged desserts
and now auto-classified). A human can accept these 12 via
`scripts/applyAmbiguousOverrides.js` (already present) or a manual edit.

---

## 5. Judgment calls the orchestrator should double-check

1. **Breakfast dishes stay meal-eligible (roadmap §1.5).** 25 recipes are
   `breakfast_only` (porridge, pancakes, English breakfast, shakshuka…).
   Following the roadmap, `breakfast_only` is tagged but **not** excluded —
   the solver has no time-of-day concept, so excluding them would only shrink
   the pool. **5 of these are sweet pancakes/waffles that TheMealDB tags as
   dessert** (Banana Pancakes, Beetroot pancakes, Pancakes, Polish Pancakes,
   Cambodian Waffles); the breakfast-dish name deliberately wins over the
   dessert tag. If you'd rather exclude sweet pancakes from dinner too, moving
   the pancake/waffle keywords from `BREAKFAST_ONLY_KEYWORDS` to
   `DESSERT_KEYWORDS` in `recipeClassification.js` is a one-line change; they
   are already source-tagged dessert.

2. **`bread_or_pastry_side` includes one arguable full dish** — "Roast
   aubergine with goat's cheese & toasted flatbread" matched on *flatbread*.
   It's excluded as a side; reasonable but worth an eyeball.

3. **Over-exclusion is the intended bias.** Per the task rule ("err toward NOT
   serving a sweet as a main meal"), a handful of borderline sweet sides
   (Pumpkin Jam, roasted-peanut candy) are classified `dessert`. That is the
   safe direction — none are savory dishes wrongly excluded.

4. **No savory dish is misclassified as dessert.** Two naive-substring bugs
   the roadmap warned about were reproduced and fixed with word-boundary +
   plural-aware matching: `ham` inside "gra**ham** cracker" (Flapper Pie) and
   plural "Prawns"/"Beans" not matching the singular protein keyword (Kung Po
   Prawns, Sichuan Long Beans). Both are covered by unit tests.

---

## 6. How it's wired and how to apply it

**Solver gate (already live, now deduplicated).**
`weeklyPlanner.js`'s `eligibleRecipes()` already excludes
`NON_MEAL_CATEGORIES` from `"meal"` slots. That set is now imported from
`recipeClassification.js` (previously a duplicated literal) so the classifier
and the solver can never drift. This is the entire solver change — kept in the
recipe-pool/filter layer, not in scoring math.

```js
// weeklyPlanner.js — eligibleRecipes()
const isMealEligible = (r) => slotType !== "meal" || !NON_MEAL_CATEGORIES.has(r.mealCategory);
```

**To tag existing DB rows (run on a machine with a real DB, from `backend/`):**

```bash
node scripts/retagRecipeCategories.mjs                    # dry run — prints the full plan
node scripts/retagRecipeCategories.mjs --apply --confirm  # fills NULL mealCategory values
```

The re-tag is **null-fill only and idempotent**: it never overwrites an
existing non-null `mealCategory` (human overrides are preserved), skips the 12
`needsReview` items, and reports any disagreements between an existing value
and the classifier. On a fresh all-null DB it fills **168 rows** (128 dessert
+ 25 breakfast_only + 14 bread-side + 1 condiment). Requires the
`mealCategory` column (migration `20260717192648_add_recipe_meal_category`,
already present); it refuses to write if the column is missing.

**Fresh seeds are now correct at seed time.** `seedRecipesFromRecomp.mjs` sets
`mealCategory` on recipe **create** (not update, to avoid clobbering reviewed
rows), so a first-run seed lands correct categories without a separate retag.

---

## 7. Out-of-scope observation (not changed)

110 / 602 imported recipes fail the `kcal ≈ 4P+4C+9F ±15%` sanity gate on
their ingredient-summed macros (e.g. *Beef Lok Lak* computes 530 kcal vs 962
estimated). This predates this task and is unrelated to categorization (the
classifier uses robust ratio thresholds, not exact kcal). Flagging per
`CLAUDE.md` §5 for a future data-quality pass; **no macro math was changed
here** (task boundary).

---

## 8. Files created / modified

**Created**
- `backend/src/lib/recipeClassification.js` — pure, unit-tested classifier (single source of truth).
- `backend/tests/recipeClassification.test.js` — 29 pure tests (`node --test`, no Prisma).
- `backend/scripts/retagRecipeCategories.mjs` — idempotent, dry-run-default re-tag script.
- `docs/audit/04-recipe-curation-report.md` — this report.

**Modified**
- `backend/scripts/seedRecipesFromRecomp.mjs` — set `mealCategory` on create via the classifier.
- `backend/src/lib/weeklyPlanner.js` — import `NON_MEAL_CATEGORIES` from the classifier (dedup; no behavior change).

---

## Appendix A — all 128 desserts

Alfajores · Anzac biscuits · Apam balik · Apple & Blackberry Crumble · Apple
cake · Arnhemse meisjes · Arra të Mbushura me Fik (Walnut Stuffed Figs) ·
Arroz con Leche · Authentic Laos Tapioca Pudding with Bananas · Authentic
Norwegian Kransekake · Baghlaw-e-Khanagi · Banana den Forno · BeaverTails ·
Blackberry Fool · Blueberry & lemon friands · Boterkoek (Dutch Butter Cake) ·
Brazilian carrot cake · Brazilian chocolate truffles - brigadeiro · Breadfruit
in Butter Sauce Recipe · Budino Di Ricotta · Bulgarian Honey Cookies ·
Canadian Butter Tarts · Caribbean Tamarind balls · Cashew Ghoriba Biscuits ·
Cassava Cake · Chelsea Buns · Chinon Apple Tarts · Choc Chip Pecan Pie ·
Chocolate Avocado Mousse · Chocolate Caramel Crispy · Chocolate Coconut
Squares · Chocolate Gateau · Chocolate Raspberry Brownies · Chocolate Souffle ·
Chocolate alfajores · Chocolate churros with chocolate & salted caramel sauce ·
Chocolate empanadas · Christmas Pudding Flapjack · Churros · Cinnamon Roll
Cookies · Cinnamon buns · Coconut Natilla · Coconut quindim · Cornes de
Gazelle · Crema Catalana · Date squares · Dulce de Leche · Dundee cake · Dutch
Apple Pie · Dutch Spiced Breakfast Cake (Ontbijtkoek) · Dutch doughnuts ·
Dutch stroopwafel · Dziriat (Algerian Almond Tarts) · Eccles Cakes · Ensaimada ·
Eton Mess · Figgy Duff · Flan · Flapper Pie · Fruit and Cream Cheese Breakfast
Pastries · Gevulde speculaas · Grape Nut Ice Cream · Hot Chocolate Fudge · Jam
Roly-Poly · Jam jam cookies · Jamaican Banana Fritters · Jamaican Festival
(Sweet Dumpling) · Jamaican Spice Bun · Jamaican Sweet Potato Pudding · Key
Lime Pie · Krispy Kreme Donut · Kurabie Butter Cookies · Kvæfjord Cake
("World's Best Cake") · Lamingtons · Laos Plantain Coconut Bake · Leche Asada ·
Madeira Cake · Magwinya (Doughnut Bites) · Mamoul (Eid biscuits) · Manjar
(Dulce de Leche) · Mazariner (Almond Tartlets) · Mini bundt cakes ·
Muraba-E-Kadu (Pumpkin Jam) · New York cheesecake · No-Churn Rum Raisin Ice
Cream · Norwegian Krumkake · Num Ansom (Sticky Rice Cake) · Paracuca (Roasted
Peanuts) · Parkin Cake · Passion fruit mousse · Peach & Blueberry Grunt ·
Peanut Butter Cheesecake · Piernik (Polish gingerbread) · Polish chocolate &
walnut cake · Polish doughnuts (Pączki) · Portuguese custard tarts · Postre
Chajá · Pouding chomeur · Pumpkin Pie · Raspberry mousse · Rock Cakes · Rocky
Road Fudge · Rogaliki (Polish Croissant Cookies) · Salted Caramel Cheescake ·
Saskatoon Pie · Seri muka kuih · Shendetlie Honey and Nut Cake · Spotted Dick ·
Sticky Toffee Pudding · Sticky Toffee Pudding Ultimate · Strawberries Romanoff ·
Strawberry Rhubarb Pie · Sugar Pie · Suksessterte · Summer Pudding · Tall
Skoleboller · Tarte Tatin · Timbits · Traditional Dutch rice tart
(rijstevlaai) · Tunisian Orange Cake · Vanilla alfajores · Vegan Chocolate
Cake · Walnut Roll Gužvara · Walnut, date & honey cake · White chocolate creme
brulee · Zeeuwse bolussen · Æbleskiver · Šúĺlance s Makom

## Appendix B — bread_or_pastry_side (14) and condiment_or_sauce (1)

**bread_or_pastry_side:** Almojábanas (Colombian Cheese Bread) · Bajan Salt
Bread · Bajan Sweet Bread · Brazilian cheese bread (pão de queijo) · Challah ·
Griddled flatbreads · Khobz el Dar (Algerian Semolina Bread) · Kulaç Soda
Bread · Phaphatha Flatbreads · Roast aubergine with goat's cheese & toasted
flatbread · Rye bread · Shawarma bread · Syrian Bread · Tendir Choreyi
(Tandoori Bread)

**condiment_or_sauce:** Creamy Aji green sauce
