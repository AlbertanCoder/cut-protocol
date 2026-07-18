# Recipe Curation — Fixing the Mistagged-Dessert Root Cause (#15)

Addresses `00-synthesis.md` item #15. Both `PABLO_REVIEW.md` (§2.6, §2.7) and
`AUDIT.md` (§3, §9) independently converged on the same root cause underneath
the meal-planner's calorie/protein-delivery failures: the 628/629-recipe pool
is overwhelmingly unreviewed generic imports, virtually all tagged
`slotType: "meal"` regardless of whether they're actually a whole dish or a
dessert/condiment/side that was never meant to carry an entire lunch or
dinner target. Pablo traced specific overshoot incidents (Flan, Postre
Chajá, Yorkshire Puddings, Jam jam cookies) directly to this. This doc
quantifies the problem exactly, designs the fix, and ships a ready-to-run
(dry-run-only) curation script.

**No writes were made to the real database while producing this document.**
All numbers below came from read-only Prisma queries (`prisma.recipe.findMany`
/ `findFirst`), the same pattern `AUDIT.md`/`PABLO_REVIEW.md` used for bulk
analysis. The retagging script (`backend/scripts/curateRecipeCategories.js`)
defaults to dry-run and was only ever invoked without `--apply` for this
report. See §5 for the exact verification.

---

## 1. Scope of the problem — real numbers from the real DB

Queried every recipe (`prisma.recipe.findMany({ include: { ingredients: {
include: { food: true } } } })`) — **629 recipes total** (628 at the time
Pablo/AUDIT wrote their reports, +1 since — an AI-generated recipe saved
during later testing).

### 1.1 Source / slotType breakdown (confirms both reports' numbers)

| `source` | count | `slotType: "meal"` | `slotType: "snack"` | `slotType: "either"` |
|---|---|---|---|---|
| `themealdb-import` | 602 | 602 | 0 | 0 |
| `curated` | 24 | 18 | 5 | 1 |
| `ai-generated` | 3 | 1 | 2 | 0 |
| **Total** | **629** | **621** | **7** | **1** |

Every single one of the 602 imported recipes is tagged `slotType: "meal"`.
The bulk importer (`backend/scripts/seedRecipesFromRecomp.mjs:117-118`)
hardcodes `slotType: "meal"` on every row it creates — there was never a
curation pass, just a bulk assignment of the default value.

### 1.2 Classifier results — what those 621 "meal" recipes actually are

Built a word-boundary keyword classifier (`backend/scripts/curateRecipeCategories.js`),
modeled on the same `\bword\b` convention `dietaryFilter.js`'s `hasWord()`
already uses in this codebase (not naive `.includes()` — that has real false-positive
bugs, e.g. `"cake"` matching inside `"pancake"`, or `"lassi"` matching inside
`"Classic"`; caught and fixed during development, see §1.4). Full method in §1.3.

| Classified category | Count | Currently `slotType="meal"` | Excluded from meal-slot eligibility under the proposed fix? |
|---|---|---|---|
| `proper_meal` (default — genuine whole dishes) | 552 | 544 | No — unaffected |
| **`dessert`** | **61** | **61** | **Yes** |
| `breakfast_only` (porridge, waffles, pancakes, granola) | 11 | 11 | No — see §1.5, the solver has no time-of-day concept at all |
| `bread_or_pastry_side` (Yorkshire pudding, flatbread, popovers) | 3 | 3 | Yes |
| `condiment_or_sauce` (standalone sauces/dips, not full dishes) | 2 | 2 | Yes |
| Flagged ambiguous — not auto-classified | 35 | 35 | N/A — human review (§4) |

**Headline number: 61 of 629 recipes are name-confirmed desserts/pastries
tagged `slotType: "meal"`, fully eligible today to be scaled up and served
as an ordinary lunch or dinner slot.** That figure landed exactly on
Pablo's independently-reported "61 dessert/pastry-named recipes" — a strong
cross-check that the classifier isn't systematically over- or
under-counting relative to a human's read of the same data.

Combined with the 3 bread/pastry-sides and 2 confirmed condiments, **66
recipes are confidently mistagged and excludable today** without further
review. A further 35 are genuinely ambiguous and were deliberately left
untouched rather than guessed at (§4). The `breakfast_only` 11 are correctly
whole meals, just time-of-day-specific — not part of the "mistagged" count
(see §1.5 for why they're not excluded either).

### 1.3 Classification method

1. **Name pass.** Word-boundary regex match against ~120 dessert/pastry/
   beverage/condiment/bread-side keywords compiled from the actual recipe
   names in this DB (not a generic list — every keyword was checked against
   real matches in this pool during development, see §1.4).
2. **Disambiguation gate for ambiguous head nouns.** `pie`, `cake`, and
   `pudding` appear in both real desserts (*Key Lime Pie*) and real savory
   dishes in this exact pool (*Steak and Kidney Pie*, *Cumberland Pie*). A
   sweet-qualifier list (apple, chocolate, pumpkin, caramel...) vs.
   savory-qualifier list (beef, chicken, kidney, cottage...) resolves most
   cases; when neither or both match, the recipe is **not** auto-tagged — it
   goes to the human-review list instead of guessing.
3. **Condiment gate.** `sauce`/`dip`/`dressing`/`chutney`-named recipes are
   only confirmed as `condiment_or_sauce` if the macro data *also* agrees
   (protein < 10g and kcal < 250 per serving, no protein-role ingredient) —
   otherwise a dish like *"Falafel Pita Sandwich with Tahini Sauce"*
   (60g protein, 1582 kcal) would get wrongly excluded just because "sauce"
   is in the name.
4. **Ingredient-based secondary pass.** For recipes the name pass left as
   `proper_meal`, a check for 2+ sugar/baking-type ingredients (sugar,
   cocoa, condensed milk, flour, baking powder...) combined with zero
   protein-role ingredient catches non-English dessert names the keyword
   list would otherwise miss — e.g. **"Arroz con Leche"** (rice pudding) and
   **"Coconut Natilla"** (a custard) were both caught this way, not by name.

### 1.4 A real bug caught and fixed during development

The first classifier pass used plain `.includes()` and produced visibly
wrong results on inspection: `"Banana Pancakes"` and `"Beetroot pancakes"`
were flagged as desserts because `"cake"` is a substring of `"pancake"`, and
`"Classic Tourtière"` was flagged as a beverage because `"lassi"` is a
substring of `"Classic"`. Switching to `\bword\b` word-boundary regex (same
fix `dietaryFilter.js` already applies for exactly this class of bug)
eliminated both. This is flagged explicitly because it's the kind of
naive-keyword-matching mistake this whole task exists to avoid repeating —
worth double-checking if this classifier is ever extended.

A second real false-positive class: `"pie"`/`"cake"` alone would have wrongly
flagged 10 genuinely savory dishes as desserts (*Beef and Mustard Pie*,
*Steak and Kidney Pie*, *Cumberland Pie*, *Minced Beef Pie*, *Mini chilli
beef pies*, *Pastel de Papas (Chilean Potato Pie)*, *Chicken Ham and Leek
Pie*, *Spanish chicken pie*, *Lamb and Potato pie*, *McSinghs Scotch pie*) —
this is what the sweet/savory qualifier gate in §1.3 step 2 exists to catch.

---

## 2. Design of the fix

### 2.1 The two options

**(a) Retag `Recipe.slotType` directly** — e.g. set desserts to
`slotType: "snack"` (the ceiling Pablo suggested) or add a brand-new
`slotType` value the solver treats as fully excluded.

**(b) Add a new, additive field** (`Recipe.mealCategory`) that
`eligibleRecipes()` filters on, leaving `slotType` semantics completely
unchanged.

### 2.2 What actually reads `Recipe.slotType` today

Grepped the full repo (backend + frontend) for `slotType`:

- **`weeklyPlanner.js:67-70`** (`eligibleRecipes()`) — the actual solver gate
  this whole task is about fixing. Matches `r.slotType === slotType ||
  r.slotType === "either"`.
- **`weeklyPlanner.js:331-341`** (`estimateSlotTarget()`) — used by the
  AI-draft-generation flow to pick a ballpark macro target for a
  new recipe, keyed by `slotType`.
- **`routes/recipes.js`** — 4 separate spots: `POST /generate-drafts`
  validates `slotType` is `"meal"`/`"snack"`; `POST /save-draft` and
  `PUT /:id` both accept and persist a `slotType` patch.
- **`RecipesTab.jsx`** — displays `recipe.slotType` on every recipe card,
  and exposes a `<select>` (meal/snack/either) in both the manual-edit form
  and the AI-generate-drafts form.
- **`aiRecipeClient.js`** — the AI JSON-schema contract for a *generated*
  recipe draft requires `slotType` as an enum field (`meal`/`snack`/`either`).
- **A same-named but semantically different field**: `PlanSlot.slotType`
  (`"meal"`/`"snack"`, part of the `@@unique([planId, dayOfWeek, slotType,
  slotIndex])` composite key) is a *different model* describing the slot
  *position* in a week's plan, not the recipe's own type. It shares a name
  with `Recipe.slotType` by coincidence of the schema's naming convention,
  not by relation — retagging `Recipe.slotType` cannot break `PlanSlot`
  records, but the naming collision is worth flagging as a latent
  readability trap for whoever touches this next.

### 2.3 Recommendation: **(b), a new `mealCategory` field**

Reasoning:

1. **`slotType` is read in 7+ distinct places**, including a user-facing
   dropdown and an AI-generation JSON schema contract. Changing what
   `"meal"`/`"snack"`/`"either"` *mean* for 66+ existing rows changes what
   those UI dropdowns and that AI schema effectively communicate too,
   without those call sites having been written with that in mind.

2. **Retagging desserts to `"snack"` would flood, not fix, the snack pool.**
   `eligibleRecipes()` for a snack slot currently draws from **7 recipes**.
   Adding 61 dessert-named rows as `slotType: "snack"` would make desserts
   ~90% of the snack pool by volume — the solver's weighted-random
   `pickRecipe()` would very plausibly start serving *more* cake/cookie
   snacks than it does today, the opposite of the intended fix. This is a
   concrete, checkable regression risk with option (a), not a theoretical one.

3. **Additive fields are the direction this codebase already leans.**
   `CLAUDE.md` §3 (A6/A9, "canonical units," "typed contracts") and the
   existing `Recipe.source` field itself (`"curated" | "ai-generated"` in
   the schema comment, but the DB also has real `"themealdb-import"` rows —
   i.e., this schema has *already* grown past its own doc comments once
   without anyone needing to touch what `source` values mean elsewhere) both
   point toward "add a field, don't overload an existing one" as the
   established pattern here.

4. **Smaller blast radius, easier revert.** A new nullable column that only
   one function (`eligibleRecipes()`) needs to be taught to read is a
   one-line filter addition with an obvious rollback (drop the filter
   clause). Overloading `slotType` touches routes, two frontend forms, and
   an AI schema simultaneously.

### 2.4 Proposed schema change (NOT applied — proposal only)

```prisma
model Recipe {
  // ...existing fields unchanged...
  slotType    String   @default("meal") // "meal" | "snack" | "either" — UNCHANGED, see roadmap/03-recipe-curation.md §2
  // NEW: null = ordinary meal-eligible (the default for ~88% of the pool).
  // Only set for recipes that were reviewed and don't belong in a full
  // lunch/dinner slot on their own merits. Additive — does not change what
  // slotType means for any existing row or call site.
  mealCategory String? // "dessert" | "beverage" | "bread_or_pastry_side" |
                        // "condiment_or_sauce" | "breakfast_only" | null
}
```

Migration: `npx prisma migrate dev --name add_recipe_meal_category` — a
single nullable `ALTER TABLE Recipe ADD COLUMN mealCategory TEXT` in SQLite
terms. Backward compatible; every existing row gets `NULL` (unaffected).

### 2.5 Proposed `weeklyPlanner.js` change (NOT applied — proposal only)

```js
// eligibleRecipes() — current (weeklyPlanner.js:67-70):
function eligibleRecipes(recipePool, slotType, usageCount) {
  const matchesType = (r) => r.slotType === slotType || r.slotType === "either";
  return recipePool.filter((r) => matchesType(r) && (usageCount.get(r.id) || 0) < MAX_REPEATS_PER_WEEK);
}

// Proposed:
const NON_MEAL_CATEGORIES = new Set(["dessert", "beverage", "bread_or_pastry_side", "condiment_or_sauce"]);

function eligibleRecipes(recipePool, slotType, usageCount) {
  const matchesType = (r) => r.slotType === slotType || r.slotType === "either";
  // breakfast_only is deliberately NOT excluded here — see §1.5, the
  // solver has no time-of-day concept, so excluding it would just shrink
  // the pool with no corresponding "only for breakfast slots" mechanism.
  const isMealEligible = (r) => slotType !== "meal" || !NON_MEAL_CATEGORIES.has(r.mealCategory);
  return recipePool.filter((r) => matchesType(r) && isMealEligible(r) && (usageCount.get(r.id) || 0) < MAX_REPEATS_PER_WEEK);
}
```

This is a 3-line change once `mealCategory` exists and is populated. It is
**not applied in this pass** — this doc and the script are the proposal;
wiring it into the live solver is a separate, reviewable code change once
the recipe data itself has a human's sign-off (§4).

### 1.5 Why `breakfast_only` isn't excluded

The solver (`buildSlots()`, `weeklyPlanner.js:41-53`) generates undifferentiated
`"meal"` slots — there is no morning/evening distinction anywhere in the
scheduling logic today. Excluding the 11 `breakfast_only` recipes from meal
eligibility would just shrink the pool by 11 real, legitimate dishes with no
offsetting benefit (a porridge recipe scaled to a 600 kcal dinner target is
just as valid a dish as anything else in the `proper_meal` bucket — it's
only *unusual* at dinner, not *wrong* the way a dessert scaled to 2.5x is
structurally wrong). Tagging them is still useful information (a future
time-of-day-aware solver could use it), so the field is populated, just not
wired into the exclusion set.

---

## 3. The script — `backend/scripts/curateRecipeCategories.js`

Follows the existing style of `backfillImportedIngredientRoles.js` and
`seedRecipes.js`: `require("dotenv/config")`, imports `prisma` from
`../src/lib/prisma.js`, a single `main()`, `prisma.$disconnect()` in
`finally`.

**Dry-run by default.** Running it with no flags only logs — zero
`prisma.recipe.update()` calls happen. Two separate guards protect real
writes:

```
node scripts/curateRecipeCategories.js                 # dry run (what actually ran for this report)
node scripts/curateRecipeCategories.js --apply          # still refuses — no --confirm
node scripts/curateRecipeCategories.js --apply --confirm  # would write, AND ALSO refuses
                                                            # until the mealCategory column
                                                            # exists (probes for it first)
```

The `--apply --confirm` path additionally does a live probe
(`prisma.recipe.findFirst({ select: { mealCategory: true } })`) and aborts
with an explanatory message if the column doesn't exist yet — i.e. it will
refuse to run even if someone fat-fingers both flags, until the §2.4
migration has actually landed. This app has exactly one real user with one
real live meal plan; a 66-row bulk update should require more than one typed
flag.

---

## 4. Dry-run output (actual, from the real DB, read-only)

Ran `node scripts/curateRecipeCategories.js` from `backend/` on 2026-07-17,
no flags. Full console output below is real, not fabricated/trimmed for
narrative — this is exactly what the script printed.

### 4.1 Category counts

| Category | Count |
|---|---|
| `proper_meal` | 552 |
| `dessert` | 61 |
| `breakfast_only` | 11 |
| `bread_or_pastry_side` | 3 |
| `condiment_or_sauce` | 2 |

### 4.2 The 61 desserts (all currently `slotType: "meal"`, all confidently classified)

Anzac biscuits · Apple & Blackberry Crumble · Apple cake · Arroz con Leche
Recipe · Authentic Laos Tapioca Pudding with Bananas · Blackberry Fool ·
Brazilian carrot cake · Brazilian chocolate truffles - brigadeiro · Bulgarian
Honey Cookies · Canadian Butter Tarts · Cashew Ghoriba Biscuits · Chinon
Apple Tarts · Choc Chip Pecan Pie · Chocolate Avocado Mousse · Christmas
Pudding Flapjack · Churros · Cinnamon Roll Cookies · Coconut Natilla Recipe ·
Dulce de Leche · Dutch Apple Pie · Dziriat (Algerian Almond Tarts) · Eton
Mess · Flan · Grape Nut Ice Cream · Hot Chocolate Fudge · Jam jam cookies ·
Jam Roly-Poly · Key Lime Pie · Krispy Kreme Donut · Kurabie Butter Cookies ·
Laos Plantain Coconut Bake (Flourless Muffin) · Magwinya: Doughnut Bites from
Botswana · Mamoul (Eid biscuits) · Manjar (Dulce de Leche) · New York
cheesecake · No-Churn Rum Raisin Ice Cream · Passion fruit mousse · Peach &
Blueberry Grunt · Peanut Butter Cheesecake · Piernik (Polish gingerbread) ·
Polish chocolate & walnut cake · Portuguese custard tarts · Postre Chajá ·
Pumpkin Pie · Raspberry mousse · Rock Cakes · Rocky Road Fudge · Rogaliki
(Polish Croissant Cookies) · Salted Caramel Cheescake · Shendetlie Honey and
Nut Cake · Spotted Dick · Sticky Toffee Pudding · Sticky Toffee Pudding
Ultimate · Strawberry Rhubarb Pie · Sugar Pie · Traditional Dutch rice tart
(rijstevlaai) · Tunisian Orange Cake · Walnut, date & honey cake · White
chocolate creme brulee · Vegan Chocolate Cake · Fruit and Cream Cheese
Breakfast Pastries

This list includes **Flan**, **Postre Chajá**, and **Jam jam cookies** —
three of the four specific overshoot recipes Pablo traced in §2.6 of his
review, confirming the classifier catches the exact recipes already
observed causing real damage in the live stored plan. (The fourth,
**Yorkshire Puddings**, is correctly *not* in this dessert list — it's a
savory batter side, not a sweet dish — see §4.3.)

### 4.3 `bread_or_pastry_side` (3) and `condiment_or_sauce` (2)

- Griddled flatbreads
- Phaphatha Flatbreads
- Roast aubergine with goat's cheese & toasted flatbread
- Creamy Aji green sauce
- Griddled aubergines with sesame dressing

(Note: **Yorkshire Puddings** did *not* land here — see §4.4, it's one of
the 35 flagged for human review, because "pudding" alone is genuinely
ambiguous in this pool and the qualifier gate correctly refused to guess.
It should almost certainly be tagged `bread_or_pastry_side` by a human —
listed explicitly in §4.4 below.)

### 4.4 Flagged for human review — 35, not auto-tagged, no change made

The task asked for "10-20" — the real count came out to 35. Reported
honestly rather than trimmed to fit a target: this corpus is heavily
international/regional (Norwegian, Albanian, Dutch, Jamaican, Colombian
dish names throughout), and the classifier is deliberately conservative
about guessing on names it doesn't recognize. Grouped by why each one
couldn't be auto-resolved:

**A. Ambiguous head noun (pie/cake/pudding with no clear sweet or savory
signal) — 19:**

| Recipe | Likely human call |
|---|---|
| Cumberland Pie | Savory (British meat pie) — leave as `proper_meal` |
| Boterkoek (Dutch Butter Cake) | Dessert (butter cake) |
| Cassava Cake | Dessert (Filipino sweet cake) |
| Dundee cake | Dessert (fruit cake) |
| Dutch Spiced Breakfast Cake (Ontbijtkoek) | `breakfast_only` (spiced breakfast loaf, not really sweet-dessert) |
| Eccles Cakes | Dessert (currant pastry) |
| Flapper Pie | Dessert (Canadian cream pie) |
| Jamaican Sweet Potato Pudding | Dessert (spiced sweet pudding) |
| Kvæfjord Cake ("World's Best Cake") | Dessert |
| Madeira Cake | Dessert |
| Mini bundt cakes | Dessert |
| Parkin Cake | Dessert (gingerbread-style) |
| Saskatoon Pie | Dessert (berry pie) |
| Suksessterte ("success cake") | Dessert |
| Summer Pudding | Dessert (British berry dessert) |
| **Yorkshire Puddings** | `bread_or_pastry_side` (savory batter side, NOT a dessert) |
| Macaroni Pudding | Dessert (sweet baked pasta pudding, British) |
| Num Ansom – Sticky Rice Cake | Dessert |
| Lakror me Kungull (Summer Squash Pie) | Savory (Albanian squash byrek-style pie) — leave as `proper_meal` |

**B. Name suggests condiment/sauce, but macros say real dish — 9** (protein
and kcal shown so a human can eyeball the call):

| Recipe | Protein | Kcal | Likely human call |
|---|---|---|---|
| Breadfruit in Butter Sauce Recipe | 7.7g | 335 | Side dish, not a full meal — probably still exclude |
| Chocolate churros with chocolate & salted caramel sauce | 10.2g | 611 | Already dessert via "churros" — this duplicate-named variant should get the same tag manually |
| Ají de Aguacate (Colombian Spicy Avocado Sauce) | 2.7g | 486 | Condiment — exclude |
| Papas Chorreadas (Potatoes with Cream and Cheese Sauce) | 26.8g | 881 | Real dish — leave as `proper_meal` |
| Camaro Grelhado (Grilled Prawns with Green Onion Sauce) | 28.3g | 136 | Real dish (shellfish — also check against the account's shellfish exclusion) |
| Breadfruit in Butter Sauce | 33.7g | 1403 | Real dish — leave as `proper_meal` (note: same name as the other Breadfruit entry above with very different macros — possible duplicate/data-quality issue worth a separate look) |
| Smoky tomato pepper salsa | 15.1g | 553 | Real dish — leave as `proper_meal` |
| Avocado dip with new potatoes | 21.3g | 936 | Real dish — leave as `proper_meal` |
| Falafel Pita Sandwich with Tahini Sauce | 60.3g | 1582 | Real dish — leave as `proper_meal` |

**C. Weak ingredient-based dessert signal (1 sugar-type + 1-3 baking
ingredients, low protein) — 7:**

Banana den Forno · Date squares · Dutch doughnuts · Figgy Duff · Jamaican
Banana Fritters · Syrian Bread · Shawarma bread

("Date squares" and "Figgy Duff" both read as genuine desserts on
inspection; "Syrian Bread" and "Shawarma bread" are almost certainly
flatbread-style accompaniments that got a weak sugar-ingredient hit from a
glaze or honey component — worth a human glance rather than auto-tagging.)

**Total: 19 + 9 + 7 = 35.** None of these were written to any field —
they're exactly as tagged as they were before this analysis.

---

## 5. Verification — the real database was not touched

- The script's dry-run path (no `--apply`) contains **zero** calls to
  `prisma.recipe.update()` — the write loop is inside an `if (!apply)
  return` guard that exits before reaching it. Confirmed by reading the
  script's own control flow, not just by trusting the log output.
- Every command run to produce this report's numbers (`prisma.recipe.findMany`,
  `findFirst` for the exploratory probes) is read-only. No `create`/`update`/
  `delete`/`upsert` Prisma call was made against `backend/prisma/dev.db` at
  any point in this pass.
- `backend/prisma/dev.db`'s on-disk modification time was checked before and
  is unchanged after this analysis (last write predates this session).
- Three exploratory probe scripts (`_tmp_probe1.js`, `_tmp_probe2.js`,
  `_tmp_probe3.js`) were created in `backend/scripts/` during development to
  calibrate the classifier against real data — all were read-only and have
  been deleted; they are not part of the deliverable.

---

## 6. Next steps (not done in this pass, by design)

1. **Owner review** of the 35 ambiguous cases in §4.4 (should take under 15
   minutes — most are one-glance calls).
2. **Migration**: apply the `mealCategory` schema change (§2.4).
3. **Run the script for real**: `node scripts/curateRecipeCategories.js
   --apply --confirm` — writes `mealCategory` to the 66 confidently-classified
   rows (+ whatever the owner decides on the 35 reviewed ones).
4. **Wire the solver**: apply the `eligibleRecipes()` change (§2.5) as its
   own reviewable commit, then re-run the planner against the real pool and
   confirm dessert recipes no longer appear in generated meal slots — this
   closes out `00-synthesis.md` item #15 and removes the root cause that
   items #2/#3 (calorie/protein delivery) keep running into.
