# Agent 06 — combinatorial dietary safety (styles × multiple allergies)

**VERDICT: PASS on the add-only union claim; FAIL on surface coverage.** The
intersection invariant survived every attack (0 violations / 85 combinations,
0 cases of metadata clearing an exclusion) and no diagnosis anywhere suggested
loosening an allergy. But three leak classes ship food that violates the
persona's rules, and two of them are new.

Method: scratch copy of `backend/prisma/dev.db` (16.6 MB, 889 recipes / 14,122
foods) in the session scratchpad. Real week solves through
`planContext.filterRecipePool` → `mealSolver.generateBestWeekPlan`, same code
path as `POST /api/plans/generate`. Leaks judged by an **independent oracle**
(my own allergen/style token lists + a documented false-friend suppression
list), not by re-running `dietaryFilter.js` against itself. No source edits, no
git writes, no DB writes, app on :3001 untouched, BRAIN=off.

Harnesses: `<scratchpad>/a06/{combo,structural,prose,namegap}.cjs`,
results in `<scratchpad>/a06/results.json`.

---

## Matrix

3 meals + 1 snack/day, 2400 kcal, 95 kg male. "Days filled" = days with **all
4** slots filled; meal-slot fill is given separately.

| # | combination | pool | slots filled | days filled | match % | leaks | diagnosis honest? |
|---|---|---|---|---|---|---|---|
| C1 | vegan + tree nuts | 157 | 21/28 (all 21 meals; 7 snacks empty) | 0/7 | 88 | 0 | yes |
| C2 | keto + dairy | 27 | 24/28 | 3/7 | 92 | 0 | yes |
| C3 | halal + shellfish + gluten | 364 | 28/28 | 7/7 | 94 | 0 | yes |
| C4 | vegetarian + eggs + dairy | 178 | 21/28 | 0/7 | 87 | 0 | yes |
| C5 | pescatarian + fish | — | — | — | — | — | **N/A — style rejected** |
| C6 | carnivore + dairy | **4** | 8/28 | 2/7 | 26 | 1 (dairy in step text) | yes |
| C7 | carnivore + fish + shellfish | **4** | 8/28 | 2/7 | 26 | 0 | yes |
| C8 | vegan + tree nuts + peanuts + soy + sesame | 89 | 21/28 | 0/7 | 87 | 0 | yes |
| C9 | keto + dairy + eggs + tree nuts | 22 | 23/28 | 2/7 | 91 | 1 (tree nuts in step text) | yes |
| C10 | kosher + dairy + gluten | 285 | 25/28 | 4/7 | 89 | 1 (gluten + pork in step text) | yes |
| C11 | paleo + eggs + fish + shellfish | 125 | 28/28 | 7/7 | 91 | 0 | yes |
| C12 | vegan (control) | 172 | 21/28 | 0/7 | 87 | 0 | yes |
| C13 | tree nuts (control) | 818 | 28/28 | 7/7 | 95 | 1 (step text) | yes |
| C14 | carnivore + gluten + dairy + eggs | **1** | 2/28 | 0/7 | **7** | 0 | yes |

Notes on the matrix:

- **C5 is not reachable.** `pescatarian` is not in `DIETARY_STYLES`
  (`dietaryFilter.js:784`) and `routes/profile.js:62` rejects it. The
  self-contradiction cannot be created through the API — correct behaviour.
  Called directly with the unknown style, `filterRecipePool` **fails open**
  (`excludedByStyle` returns `false` for any unrecognised style) and shipped
  chicken/bacon/pork/ham. That is guarded only by route validation, with no
  defence in depth in the library itself.
- **The 0/7 "days filled" on every vegan/vegetarian row is snacks, not meals.**
  There are 0 snack-eligible vegan recipes; all 21 meal slots filled. The
  diagnosis says so in its own words ("Your library has no snack-sized recipe
  that fits your rules — all 7 snack slots this week come back empty").
- **C4 (vegetarian + eggs + dairy) is not silently treated as vegan, and should
  not be.** Its pool (178) is 6 larger than vegan (172); all 6 differ only by
  honey / marshmallow / gelatin / curry-paste carriers, i.e. things a vegan
  avoids for animal reasons but an egg+dairy-allergic vegetarian may eat. No
  flesh in the delta. Correct, not reaching. (But see finding 3 — two of those
  six should not be in a *vegetarian* pool either.)

---

## Findings, ranked

### 1 — P0 · The recipe NAME is read by no filter at all

`filterRecipePool` (`planContext.js:34`) flattens a recipe to
`recipe.ingredients[].food.name` plus the `"Add'l ingredients:"` prose pattern.
The **dish title is never checked** by the style filter, the allergy filter, or
the keto ceiling. When an import drops the primary protein from the ingredient
rows, the dish lands in every pool.

Measured, using the app's own matcher on the title:

| recipe | ingredient rows | pools it reaches |
|---|---|---|
| `Slow-cooked, Wadadli-spiced Cubano pork belly` | olive oil, coriander, parsley, oregano, mint, chillies, citrus, garlic, cumin, allspice, salt, pepper — **no pork** | **vegan, vegetarian, halal, kosher** |
| `Egg Drop Soup` | chicken stock, salt, sugar, pepper, sesame oil, peas, mushrooms, cornstarch, water, spring onions — **no egg** | **egg allergy** |
| `Roasted Eggplant With Tahini, Pine Nuts, and Lentils` | oil, carrots, celery, onion, garlic, lentils, bay, water, salt, vinegar, pepper — **no tahini, no pine nuts** | **sesame allergy** (and tree-nut allergy) |
| `Cashew Ghoriba Biscuits`, `Banana Pancakes`, `Almojábanas (Cheese Bread)`, `Salt cod tortilla`, `Mediterranean Pasta Salad`, +4 | — | **gluten allergy** (9 total) |

A dish named "pork belly" on a halal and a kosher plate is the worst single
result in this audit. Sesame and egg are top-9 declarable allergens.

Note the reason the name is not checked is real: naive title matching produces
false positives (`Kidney Bean Chili with Rice` trips `kidney`;
`…coconut butter` trips `nut butter`). The fix is a name probe as an ADD-ONLY
fourth evidence source with the existing false-friend guards, not a raw
substring match — and the underlying data (missing protein rows) wants fixing
regardless.

### 2 — P1 · Persisted allergen metadata is inert on the plan path

`exclusionEvidence()` documents a 4-probe add-only union (name, fdcCategory,
allergenTags, mayContain) as the safety backstop. Two independent reasons it
contributes nothing today:

1. **No data.** 0 of 14,122 foods carry `fdcCategory`, `allergenTags`, or
   `mayContain`. Every probe but the name probe is dead against the real DB.
2. **Not wired.** `filterRecipePool` strips each ingredient to `{ name }`
   before matching and calls the **name-only** `matchesExclusionTerm`, not the
   object-aware `foodMatchesExclusionTerm`. `routes/recipes.js:34` does the
   same. Reproduced with a synthetic row (`House Sauce Base`,
   `fdcCategory: "Dairy and Egg Products"`, `allergenTags: ["en:milk","en:eggs"]`,
   `mayContain: ["en:peanuts"]`):

   ```
   foodMatchesExclusionTerm(food,'dairy') → true      // object-aware: excluded
   matchesExclusionTerm(food.name,'dairy') → false    // name-only: not excluded
   styleExcludedByMetadata(food,'vegan')  → true
   filterRecipePool SHIPPED it to: dairy allergy ✓  eggs allergy ✓
                                   peanut allergy (may-contain) ✓  vegan ✓
   ```

   So the moment the OFF/FDC importer starts populating those columns — the
   code that computes them already exists — the meal-plan path will silently
   ignore them while the tests in `allergenMetadata.test.js` keep passing,
   because they test the library function, not the pool builder.

### 3 — P1 · The vegetarian style ignores the flesh-derived carriers the vegan style already knows

`excludedByStyle`'s vegetarian branch consults only `MEAT_FISH_KEYWORDS`. The
carriers in `ANIMAL_DERIVED_EXTRA_KEYWORDS` that are **flesh-derived**, not
dairy/egg — gelatin sweets and shrimp-paste curry pastes — are therefore
vegan-excluded but vegetarian-legal:

```
Miniature Marshmallows  vegan-excluded: true  vegetarian-excluded: false
Thai Red Curry Paste    vegan-excluded: true  vegetarian-excluded: false
                        (shellfish-ALLERGY-excluded: true)
```

5 of the 412 recipes in the vegetarian pool carry one: `Rocky Road Fudge`,
`Hot Chocolate Fudge`, `Christmas Pudding Flapjack`, `Thai coconut & veg
broth`, `Thai pumpkin soup`. This is the exact mirror of the inconsistency the
curry-paste comment in `CATEGORY_SYNONYMS.shellfish` was written to close ("a
vegan was protected but an allergic user was not") — now a vegan and an
allergic user are protected and a **vegetarian** is not. 0/10 solved weeks
actually shipped one (they are low-eligibility desserts/soups), but pool
membership *is* this codebase's compliance invariant and they are visible as
compliant in the Recipes tab, in swap alternates and in the cart.

### 4 — P1 · The carnivore inversion is not safe, and the metadata exception is not why

The documented exception (carnivore skips `styleExcludedByMetadata`) is
currently harmless — there is no metadata (finding 2). The real hazard is that
carnivore is defined as `!isVeganAnimalProduct(name)`, which **inverts every
safe-side over-exclusion keyword added for vegans into a carnivore ALLOW**:

- 6,968 of 14,122 foods pass carnivore, including **145** plant/sugar items
  admitted purely via a hidden-animal-carrier keyword: `Naan Bread`,
  `Wonton Skin`, `Perogies, boiled`, `Thai Red/Green Curry Paste`,
  `Miniature Marshmallows`, `Toffee Popcorn`, `Mars Bar`, `Christmas pudding`,
  `White Chocolate Chips`, `Caramel Sauce`, `Honey`, `Worcestershire Sauce`, …
- The entire carnivore **recipe** pool is 4 dishes, and **2 of them are
  perogie dishes at ~99 g carb / ~43 % carb energy**:
  `Perogies & Bacon [99.8 g / 925 kcal]`,
  `Grilled Chicken Breast & Perogies [99 g / 930 kcal]`.
  Both are admitted because `perogi` sits in `ANIMAL_DERIVED_EXTRA_KEYWORDS`.

Over-exclusion is the correct failure direction for eight styles; for the one
inverted style it is **under-exclusion**, and nothing in the code marks that.

### 5 — P2 · Step-text leaks, confirmed still open, amplified by thin pools

`docs/qc/recipe-allergen-audit.md` already records 78 of these (2
high-confidence, 76 incidental). I reproduced two of them **on shipped plates**:

- `Grilled Chicken Breast & Perogies` → *"pan-fry in a little butter"* on the
  **carnivore + dairy-allergy** plate. Severity is combination-amplified: that
  recipe is 1 of only 4 in the pool and occupied 2 of 8 filled slots.
- `Chicken wings with cumin, lemon & garlic` → *"Fill small bowls with olives,
  pistachios or almonds … and flatbreads to serve alongside"* on the
  **tree-nut** plate (C9 and C13).

**New, and not covered by that audit** (it indexes allergens only): the same
prose surface leaks *dietary-style* violations, which nobody has swept —
step-text-only violations in the shipped pools: halal 7, kosher 5, vegetarian
14, vegan 10. Worst: `Traditional Croatian Goulash` in the kosher pool
instructs *"Heat one tablespoon of **pork fat** or vegetable oil"*; `Satee` in
the halal and kosher pools offers *"5 lbs. of beef or **pork** tenderloin"*;
`Polish doughnuts (Pączki)` calls for **lard** in halal, kosher and vegetarian
pools.

### 6 — P2 · Two forbidden suggestion strings exist, dormant behind BRAIN=off

The deterministic solver is clean: across all 14 personas — including the
1-recipe pool at 7 % match — every reason and suggestion pointed at prep time,
meals/snacks per day, batch repeats, cuisine/protein preference, or AI
generation. **Never once at an allergy or a dietary style.** But two brain-path
strings violate the rule:

- `backend/src/lib/brain/create.js:206` — `fixes: ["Broaden the food pool or
  relax the exclusions."]`. "Exclusions" includes allergies. Directly forbidden.
- `backend/src/lib/brain/constraints.js:72` — `fixes.push("Relax the dietary
  style or AI-generate compliant recipes.")`, fired exactly when
  `compliantCount <= 0` — i.e. the hardest combinations. It contradicts this
  repo's own `brain/critic.js:24` ("Never suggest loosening an allergy or
  dietary style") and `critic.js:38` ("hard rule — never suggest relaxing it").

Both are unreachable with `BRAIN=off` (`routes/brain.js` gates on
`isBrainEnabled()`), so this is latent, not live. It becomes live the day the
Brain v3 runbook flips the flag.

### 7 — P3 · Honest-but-wrong wording at the extreme

C14 (pool = 1): the first diagnosis line reads *"0 meal-eligible recipes ×
max 2 servings/week = 0 servings for 21 meal slots — **the back half of the
week will run on poor fits**."* With 0 servings it is not the back half; the
whole week's meal slots come back empty. The arithmetic is right and the empty
slots are visible in the plan, so nothing is hidden — the sentence is just
describing a milder failure than the one that happened.

### 8 — cross-reference (Agent 05's lane) · 7 pasta shapes are not gluten

`farfalle`, `fusilli`, `rigatoni`, `conchiglie`, `orecchiette`, `bucatini`,
`cavatappi` all return `matchesExclusionTerm(name,'gluten') === false`.
`Mediterranean Pasta Salad` (rows contain `farfalle`) reaches a gluten pool
through both this gap and finding 1.

---

## What held up under attack

- **Add-only intersection: 0 violations / 85 combinations.** For every
  style × allergen pair and four 3–4-way combinations, the combined pool was
  exactly `pool(style) ∩ pool(a₁) ∩ … ∩ pool(aₙ)`. No style ever weakened an
  allergy exclusion; no combination ever admitted a recipe that a single filter
  had removed.
- **0 cases of metadata clearing a name-based style exclusion** across 14,122
  foods × {vegan, vegetarian, carnivore}.
- **No allergy-relaxing suggestion from the deterministic solver**, in any of
  the 14 personas, including the impossible ones.
- Diagnosis fired and named concrete numbers on **every** rough week —
  including the 26 % and 7 % cases. Nothing shipped as a clean plan that wasn't.

## Suggested order of work

1. Fix the data for `Slow-cooked, Wadadli-spiced Cubano pork belly`,
   `Egg Drop Soup`, `Roasted Eggplant With Tahini…` and the 9 gluten titles
   (missing protein/allergen ingredient rows), then add a guarded name probe.
2. Point `filterRecipePool` / `routes/recipes.js` at `foodMatchesExclusionTerm`
   and pass the whole `i.food` row, so the metadata union is live *before*
   the importer starts populating it.
3. Add the flesh-derived carriers to the vegetarian branch.
4. Give carnivore an explicit allow-list (or an explicit plant-veto) instead of
   inverting a list tuned for over-exclusion.
5. Rewrite the two brain `fixes` strings before Brain v3 goes live.
