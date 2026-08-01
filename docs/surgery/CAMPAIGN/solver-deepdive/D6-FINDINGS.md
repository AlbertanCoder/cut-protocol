# D6 — The exclusion gate as a solver constraint

**Question:** not "is the gate safe?" but "what does it cost the solver, and how much of that cost is unnecessary?"

**Headline:** the gate is expensive but *honestly* expensive. Across the real 259-profile
population it removes 56.1% of the recipe library; of that, precision defects account for
**0.5 percentage points**. I found and named 30 genuine false exclusions — including one class
the campaign predicted (peanut/tree-nut conflation) live in the gate, not just the oracle — and
fixing every one of them recovers **+4.8 recipes on the mean pool and exactly 0 for the 42
most-starved profiles.** Gate precision is not where the compliance headroom is. The starved
pools are starved by legitimate stacked constraints.

Method note: all attrition numbers come from running the **real gate code**
(`exclusionGate.js` / `dietaryFilter.js`) against a copy of `dev.db`
(`D6/dev-copy.db`, 910 recipes / 14,151 foods / 259 profiles). Scripts are in
`docs/surgery/CAMPAIGN/solver-deepdive/D6/`. Nothing under `backend/src/` was modified.

---

## 0. The verification-shape problem, and what I did about it

The brief's warning applies directly to this territory: every prior "the gate is airtight"
claim used the gate's own keyword lists as the predicate, so it could only ever detect
disagreement between two copies of the same vocabulary.

I did not use the gate's vocabulary to judge the gate. The procedure was:

1. Rank every gate-excluded Food by **how many recipes it removes** (`D6/leverage.mjs`) —
   this is a structural ranking, not a semantic one.
2. Read the **complete list** of every food that is both excluded and actually used in a
   recipe (`D6/complete.mjs`) — 805 of 14,151 foods are used in any recipe, so for the
   recipe solver this is an exhaustive read, not a sample: 71 dairy rows, 83 gluten, 25 egg,
   32 fish, 26 shellfish, 19 soy, 18 tree-nut, 9 peanut, 7 sesame, 221 vegan, 135 vegetarian.
3. Judge each row's **identity** myself — from its name, its `fdcId` donor record, its
   `dataQuality` provenance string and its macros (`D6/readrows.mjs`).
4. Re-measure with the judged-false pairs suppressed (`D6/final.mjs`).

`MEASURED` = produced by running code. `DERIVED` = arithmetic on measured values.
`INFERRED` = my judgement, flagged as such.

---

## 1. Pool attrition, quantified

### Per dietary style, no allergies — `MEASURED` (`D6/measure.mjs`)

| Style | Recipes surviving | % of 910 | Foods surviving | % of 14,151 | Dominant reason |
|---|---:|---:|---:|---:|---|
| none | 910 | 100.0% | 14,151 | 100.0% | — |
| mediterranean | 814 | 89.5% | 13,654 | 96.5% | dietary-style 96 |
| halal | 758 | 83.3% | 13,211 | 93.4% | dietary-style 152 |
| kosher | 680 | 74.7% | 13,106 | 92.6% | dietary-style 230 |
| vegetarian | 401 | 44.1% | 8,978 | 63.4% | dietary-style 509 |
| vegan | 169 | 18.6% | 7,207 | 50.9% | dietary-style 741 |
| paleo | 167 | 18.4% | 10,013 | 70.8% | dietary-style 743 |
| **keto** | **53** | **5.8%** | 8,218 | 58.1% | **keto-ceiling 857** |
| carnivore | 3 | 0.3% | 6,934 | 49.0% | dietary-style 907 |

**Keto is not a gate problem.** All 857 keto exclusions are `keto-ceiling` — the whole-recipe
carb rule at `dietaryFilter.js:1851` (`KETO_RECIPE_CARB_CEILING_G = 30`), not allergen or
style vocabulary. A keto user sees 53 recipes because the library has 53 low-carb recipes.
That is a **library composition** finding and belongs to whoever owns recipe supply, not to
the gate.

### Per allergy flag, style `none` — `MEASURED`

| Allergy | Recipes | % of 910 | Foods | % of 14,151 |
|---|---:|---:|---:|---:|
| kiwi | 910 | 100.0% | 14,142 | 99.9% |
| peanuts | 870 | 95.6% | 13,988 | 98.8% |
| sesame | 853 | 93.7% | 14,105 | 99.7% |
| tree nuts | 830 | 91.2% | 13,862 | 98.0% |
| shellfish | 826 | 90.8% | 13,630 | 96.3% |
| fish | 752 | 82.6% | 13,518 | 95.5% |
| soy | 741 | 81.4% | 13,844 | 97.8% |
| eggs | 642 | 70.5% | 13,347 | 94.3% |
| dairy | 564 | 62.0% | 12,155 | 85.9% |
| **gluten** | **413** | **45.4%** | 11,300 | 79.9% |

### Realistic stacks — `MEASURED`

| Stack | Recipes | % | Stack | Recipes | % |
|---|---:|---:|---|---:|---:|
| mediterranean+fish+shellfish | 643 | 70.7% | vegetarian+dairy+eggs | 172 | 18.9% |
| halal+dairy | 481 | 52.9% | vegan+soy | 98 | 10.8% |
| vegetarian+tree nuts | 356 | 39.1% | vegan+gluten | 89 | 9.8% |
| none+dairy+gluten | 296 | 32.5% | vegan+soy+gluten | 48 | 5.3% |
| none+dairy+gluten+soy | 245 | 26.9% | keto+dairy | 35 | 3.8% |
| vegan+tree nuts+peanuts | 149 | 16.4% | carnivore+dairy | 1 | 0.1% |

**Where the pool collapses:** vegan and keto independently, and *any* stack containing
vegan. Vegan+soy+gluten at 48 recipes cannot support a 7-day plan with a 2×/week variety
cap across 3 meals + 1 snack. `DERIVED`: 28 slots/week against 48 recipes with a repeat cap
of 2 gives 96 usable slot-fills — feasible on paper, but only if macro fit is ignored, which
it is not.

### Across the real 259-profile test population — `MEASURED` (`D6/population.mjs`)

| Metric | Value |
|---|---:|
| Mean pool | **399.2 / 910 (43.9%)** |
| Profiles with pool < 200 | 89 / 259 |
| Profiles with pool < 100 | 54 / 259 |
| Profiles with pool < 60 | **42 / 259** |
| Profiles with pool < 20 | 4 / 259 |

The most-starved profiles are dominated by a single repeated shape:
`vegan + ["soy","gluten","peanuts","tree nuts","sesame","legumes"]` → **20 recipes**, appearing
~15 times in the fleet. Two carnivore profiles sit at 1 and 3 recipes.

---

## 2. Where the exclusions actually come from — the tier result that redirects effort

`exclusionGate.collectEvidence()` pushes four kinds of evidence row, the last being the
**entire step-text blob as a single "food name"** (`exclusionGate.js:194-197`). The file
openly documents this as deliberate over-exclusion (`:186-193`). I expected this to be the
dominant cost. **It is not.** `MEASURED` (`D6/attribute.mjs`), weakest firing tier per exclusion:

| Term | Total | T1 ingredient row | T2 prose | T3 title | T4 step blob |
|---|---:|---:|---:|---:|---:|
| gluten | 497 | 444 | 0 | 9 | 44 |
| dairy | 346 | 316 | 0 | 2 | 28 |
| eggs | 268 | 254 | 1 | 4 | 9 |
| soy | 169 | 166 | 0 | 0 | 3 |
| fish | 158 | 149 | 0 | 0 | 9 |
| shellfish | 84 | 82 | 0 | 0 | 2 |
| tree nuts | 80 | 68 | 0 | 0 | 12 |
| sesame | 57 | 50 | 0 | 1 | 6 |
| peanuts | 40 | 39 | 0 | 0 | 1 |
| vegan (style) | 741 | 728 | 0 | 2 | 11 |
| paleo (style) | 743 | 701 | 0 | 5 | 37 |
| kosher (style) | 195 | 143 | 0 | 3 | 49 |

**Consequence for the build prompt: do not touch the step-text probe.** 91–99% of exclusions
are already carried by a real ingredient row with metadata. The step blob is the *sole* cause
for ~114 allergen exclusions and ~146 style ones, it is the mechanism that closed the
documented Sushi / Banh Mi / Challah leaks, and `exclusionGate.js:190-193` gives the correct
reason negation parsing was rejected. Any effort spent here buys ≤1.3% of pool and re-opens a
measured medical leak. The T2 "Add'l ingredients" prose probe fires as the sole cause **once
in 910 recipes** — it is nearly free and nearly useless, but harmless.

---

## 3. Catalogue of false exclusions

Every row below was read individually. `INFERRED` marks my identity judgement; the exclusion
itself and its recipe count are `MEASURED`.

### 3a. The paired-USDA-category over-match — the largest precision defect

`dietaryFilter.js:1585-1589`:

```js
const FDC_CATEGORY_FAMILIES = {
  "dairy and egg products": ["dairy", "egg"],
  "finfish and shellfish products": ["fish", "shellfish"],
  "baked products": ["gluten"],
};
```

USDA merges two allergens into one shelf label; the gate treats a row in such a category as
carrying **both**. The comment at `:1591-1594` defends this as "only ever a BACKSTOP: the name
almost always says which one it is, and the name is checked first and independently."

**That defence does not hold in the code.** `exclusionEvidence()` at `dietaryFilter.js:1802`
returns `reasons.some((r) => !r.advisory)` — a plain union. The name probe and the category
probe are ORed, not ordered. A name that positively and unambiguously identifies *one* member
of the pair does not suppress the *other*. The only suppression that exists
(`nameOutranksCategory`, `:1778-1780`) fires on free-from claims and gluten-free grain forms —
never on "this name says which half of the pair it is."

`MEASURED` — foods excluded by the category probe **alone**, with no name and no tag evidence
(`D6/probes.mjs`), restricted to foods actually used in recipes:

| Food | Wrongly excluded for | Recipes | Why it is false — `INFERRED` |
|---|---|---:|---|
| Heavy Cream | eggs | 13 | Cream. `fdcId 2346386 "Cream, heavy"`. No egg. |
| Feta | eggs | 11 | Cheese. `fdcId 173420 "Cheese, feta"`. |
| Cream Cheese | eggs | 7 | Cheese. |
| Cheddar Cheese | eggs | 7 | `fdcId 328637 "Cheese, cheddar"`. |
| Dulce de leche | eggs | 6 | Milk + sugar. |
| Salted Butter | eggs | 3 | `fdcId 173410 "Butter, salted"`. 81g fat, 0.85g protein. |
| Gouda Cheese | eggs | 2 | Cheese. |
| Swiss / parmesan / swiss-low-fat / full-fat sour cream | eggs | 1 each | Cheese and cultured cream. |
| **Shrimp** | **fish** | **32** | Crustacean. `fdcId 175180 "Crustaceans, shrimp"`. Not a finfish. |
| Conchs | fish | 2 | Mollusc. `fdcId 173720 "Mollusks, conch"`. |
| Smoked Haddock | shellfish | 2 | Finfish. `fdcId 174199 "Fish, haddock, smoked"`. |
| Monkfish | shellfish | 1 | Finfish. `fdcId 173676 "Fish, monkfish"`. |
| Tuna, canned in water | shellfish | 1 | Finfish. |
| **Frogs Legs** | **fish AND shellfish** | 1 | Amphibian. `fdcId 168148 "Frog legs, raw"`. Neither. |
| Fish Sauce | **soy** | 28 | Anchovy + salt. Filed `Soy-based condiments` — a *shelf* label. |

`DERIVED`: the egg column alone is 53 recipe-uses; the fish/shellfish cross-fire is 39.

An egg-allergic user currently loses **every cheese and cream dish in the library** to a USDA
shelf label. That is the single most conspicuous precision defect in the gate.

### 3b. Corrupted donor records laundered into allergen evidence

These rows carry another food's USDA record — the known food-corruption bug — and the gate
faithfully reads the *donor's* category as allergen evidence. `MEASURED` + `INFERRED`:

| Food | Excluded for | Recipes | Donor record in its own `dataQuality` |
|---|---|---:|---|
| **Cinnamon** | gluten | **38** | `fdcId 171849 "Bread, cinnamon"` — filed *Baked Products*. Macros (253 kcal, 44.4g carb) are bread's, not the spice's. |
| Peaches | gluten | 2 | `fdcId 175020 "Pie, peach"`. 224 kcal / 10g fat is pie, not fruit. |
| Oatmeal | gluten | 1 | `fdcId 172678 "Bread, oatmeal"`. |

The gate is behaving **correctly given its inputs**; the inputs are wrong. Fixing this in the
gate would be fixing the wrong layer. Recorded here because the cost lands on the solver and
because it shows the category probe amplifies data defects into pool loss.

### 3c. The gluten-free-grain guard is wired to 3 nouns and missing from the 2 that matter

`dietaryFilter.js:1163-1175` defines `gfGrainQualified` / `glutenFreeGrainForm`, and
`GLUTEN_FREE_GRAINS` (`:1157`) already contains `rice`, `lentil`, `chickpea`. The guard is
wired in `WORD_GUARDS` for exactly three nouns — `flour` (`:1274`), `tortilla` (`:1275`),
`cereal` (`:1283`). It is **not** wired to `pasta` or `noodle`, both of which are plain
keywords in `CATEGORY_SYNONYMS.gluten`.

`MEASURED` — these are the top three gluten offenders in the whole corpus:

| Food | Recipes | `INFERRED` |
|---|---:|---|
| Lentil pasta, dry | 29 | 100% red-lentil flour. Naturally gluten-free. |
| Chickpea pasta, dry | 28 | 100% chickpea flour. Naturally gluten-free. |
| Rice Noodles | 13 | `fdcId 168914 "Rice noodles, cooked"`. Gluten-free. |
| Brown Rice Noodle / Rice Stick Noodles / Vermicelli Rice Noodles | 2 each | Rice. |
| Flat Rice Noodles / Rice Flour Pancakes | 1 each | Rice. |

`DERIVED`: 78 recipe-uses. Verified directly — `matchesExclusionTerm("Rice Noodles","gluten")`
returns true while `matchesExclusionTerm("corn tortilla","gluten")` and
`("rice flour","gluten")` correctly return false. Same rule, three nouns short.

Note the shape: the 29 lentil-pasta and 28 chickpea-pasta recipes are the
`High-Protein … with Lentil/Chickpea Pasta` generated family — i.e. **the gate deletes 57 of
the library's purpose-built high-protein recipes from every celiac's pool**, and they are
gluten-free.

### 3d. Plain name false friends — including the class this campaign predicted

`MEASURED` by direct call, `INFERRED` on identity:

| Food | Wrongly excluded for | Recipes | Why false |
|---|---|---:|---|
| **Ground Nut Oil** | **tree nuts** | 5 | Groundnut = peanut = *legume*. `WORD_GUARDS["ground nut"]` (`:1258`) lives in the tree-nut list. Correct for `peanuts`; wrong for `tree nuts`. **This is the peanut↔tree-nut conflation the brief predicted, live in the gate — not only in `oracle.mjs`.** The app ships separate checkboxes for exactly this reason (`routes/profile.js:398-399`). |
| Grape Nut Cereal | tree nuts | 1 | Grape-Nuts contains no nuts and no grapes — wheat and barley. (Correctly excluded for gluten.) |
| Oyster Mushrooms | shellfish **and vegan/vegetarian** | 2 | A mushroom. `fdcId 1999627 "Mushroom, oyster"`, filed *Vegetables and Vegetable Products*. |
| flax eggs | eggs **and vegan** | 10 | Ground flax + water — *the* canonical vegan egg substitute. Excluded from vegan. |
| soya milk | dairy **and vegan** | 1 | `PLANT_MILK_QUALIFIERS` (`:176`) contains `"soy"` but not `"soya"`, and matching is word-boundary + `(?:es\|s)?`, so `soy` never matches `soya`. Verified: `"soy milk"` passes, `"soya milk"` is excluded. A one-word gap. |
| vegan butter | dairy **and vegan** | 1 | Name literally declares itself. `PLANT_FOOD_DECLARED` (`:851`) includes `vegan` but is not consulted on the butter path. `"plant butter"` fails the same way. |
| **Kidney Beans** | **vegan and vegetarian** | 9 | Organ-meat keyword `kidney`. Beans are a vegan staple protein. |

Also confirmed excluded, not in the corpus but real food names — `INFERRED`, no measured cost:
`Beef Tomato` / `Beef tomatoes` (a tomato variety; 1 corpus row) → vegan+vegetarian;
`Chicken of the woods` (a mushroom) → vegan+vegetarian; `Custard Apple` (cherimoya) → vegan,
dairy, eggs; `Milk Thistle` (a herb) → vegan, dairy; `Bean curd` (= tofu) → **vegan**.

`Bean curd` deserves its own line: `WORD_GUARDS.curd` (`:1235-1238`) contains an explicit,
correct "bean curd is tofu" exemption for the **dairy allergy** path — and the **style** path
does not consult it, so tofu-under-that-name is excluded from a vegan diet.

### 3e. The structural point about 3d

`Butter Beans`, `Eggplant`/`Egg Plants`, `Cocoa Butter`, `Shea Butter`, `Butternut Squash`,
`Cream of Tartar`, `water chestnut`, `Peanut Butter`→dairy and `soybean oil` are **all
correctly cleared** — each by a hand-written entry in `WORD_GUARDS`. `Kidney Beans`,
`Ground Nut Oil`→tree-nuts, `soya milk`, `vegan butter`, `Oyster Mushrooms`, `flax eggs`,
`Beef Tomato`, `Bean curd`→vegan and `Grape Nut Cereal` are not, because nobody wrote those
entries yet.

`WORD_GUARDS` is a **denylist of exceptions to a denylist**. This project's own CLAUDE.md
already contains the lesson, about the installer payload: *"a denylist over a directory that
agents and scripts keep writing new files into is structurally unable to stay correct… every
new file defaults to SHIPPED."* Here every new false friend defaults to EXCLUDED. The failure
direction is safe, which is why it has survived — but it is the same structure, and it will
keep producing one of these per vocabulary expansion.

---

## 4. How much compliance headroom is in gate precision — the load-bearing negative

I suppressed **all 30** judged-false (food, term) and (food, style) pairs and re-ran the real
gate verdict over the whole library for every profile. `MEASURED` (`D6/final.mjs`):

| Persona | Now | Precision-fixed | Gain |
|---|---:|---:|---:|
| fish allergy | 752 (82.6%) | 783 (86.0%) | **+31** |
| egg allergy | 642 (70.5%) | 663 (72.9%) | +21 |
| soy allergy | 741 (81.4%) | 760 (83.5%) | +19 |
| gluten (celiac) | 413 (45.4%) | 419 (46.0%) | +6 |
| tree nut allergy | 830 (91.2%) | 835 (91.8%) | +5 |
| vegan | 169 (18.6%) | 172 (18.9%) | +3 |
| vegetarian | 401 (44.1%) | 403 (44.3%) | +2 |
| dairy allergy | 564 (62.0%) | 564 (62.0%) | **0** |
| keto+dairy | 35 (3.8%) | 35 (3.8%) | **0** |
| vegan+soy+gluten+nuts (the 15× fleet shape) | 20 (2.2%) | 20 (2.2%) | **0** |

**Across the real 259-profile population:**

| Metric | Now | Fixed |
|---|---:|---:|
| Mean pool | 399.2 (43.9%) | **404.0 (44.4%)** |
| Profiles gaining ≥1 recipe | — | 152 / 259 |
| Max single-profile gain | — | 31 |
| **Profiles with pool < 60** | **42** | **42** |

`DERIVED`: **+0.5 percentage points of mean pool. Zero movement for every starved profile.**

The reason the gain is so much smaller than the leverage table implies is important and
`MEASURED`: **false-positive foods overwhelmingly co-occur with a genuine trigger.** Cinnamon
costs 38 recipe-uses but only 6 recipes come back for a celiac, because those 38 are cakes,
churros, buns and crumbles that contain real wheat flour anyway. The one clean exception is
Shrimp→fish (+31 of a possible 32), because shrimp dishes frequently contain no finfish.

**Therefore, for the build prompt:** if the goal is the 70.1%→higher macro-compliance number,
gate precision is a ~0.5pp lever and should not be the headline work. It is worth doing for
correctness and user trust — an egg-allergic user losing all cheese, and a celiac losing the
high-protein legume-pasta family, are real product defects — but it will not move the solver's
band-hit rate. `INFERRED`: the compliance gap for the starved cohort is a **recipe-supply**
problem (vegan and low-carb recipes) and a **closer** problem, not a gate-precision problem.

---

## 5. The gate at the closer / adjuster path

`planContext.js:167-178` hardcodes 10 `ADJUSTER_CANDIDATES`; `loadAdjusters` (`:204-215`)
filters them through `macroTrustIssue` then `isExcluded` — the same gate every recipe surface
uses. `MEASURED` (`D6/adjusters.mjs`):

- **Stage A:** all 10 rows exist in the DB and all 10 pass `macroTrustIssue`. Neither is binding.
- **Stage B:** every one of the 259 profiles retains **at least 3** adjusters; **no profile has
  zero**; **no profile lacks a fat adjuster**. Distribution: 90 profiles keep all 10, 39 keep 9,
  39 keep 8, 31 keep 7, 18 keep 6, 31 keep 5, 3 keep 4, 8 keep 3.
- **Stage C:** most-excluded candidates are Greek Yogurt (102/259), Tofu (99), Butter (93),
  Chicken breast (54), Lentils (51), Potatoes (42), White rice (33), Oats (33), Olive Oil (2),
  Avocado (2). Every removal is `food-filtered` — no fail-closed paths.
- Role gaps: 22 profiles have no carb adjuster — **18 keto, 2 carnivore, 2 paleo**, all of which
  legitimately should not be handed carbs. 18 profiles have no protein adjuster — **all 18 vegan**,
  losing Greek Yogurt + Chicken to the style and Tofu + Lentils to stacked soy/legume exclusions.

**Verdict for D3: the hardcoded list is overwhelmingly the binding constraint, not the gate.**
10 candidates against 14,151 foods is 0.07% of the pantry, and the gate still leaves ≥3 of them
standing for every user in the fleet. The one place the gate genuinely binds is
**vegan + legume/soy exclusions → no protein adjuster at all (18 profiles)**, and that is a
*list* problem too: the list offers exactly two vegan protein options (Tofu, Lentils) and both
are among the most commonly excluded foods in the fleet. Adding e.g. pea-protein isolate,
seitan (non-celiac), hemp seed or pumpkin seed would fix all 18 without touching the gate.

---

## 6. Structure of the exclusion mechanism

- **Matching algorithm.** `matchesExclusionTerm` (`:1465`) resolves the term
  (`resolveExclusionTerm`, `:653`) through exact category → `FREE_TEXT_ALIASES` (`:590`) →
  normalised candidates, then tests every synonym in `CATEGORY_SYNONYMS[key]`. Single-word
  synonyms use word-boundary + `(?:es|s)?` plural matching (`wordRe`, `:756`); multi-word
  synonyms fall back to substring. Unrecognised terms degrade to a literal substring grep —
  fail-safe, and surfaced honestly to the UI via `describeExclusionTerms` (`:702`).
- **Four probes, unioned** (`exclusionEvidence`, `:1755`): name/keyword, `fdcCategory`,
  `allergenTags`, `mayContain`. The add-only rule is real and structurally enforced — no probe
  can clear another's finding. `TRACE_POLICY_DEFAULT = "exclude"` (`:1544`) means declared
  "may contain" traces remove the food.
- **Guards.** `WORD_GUARDS` (`:1210`) attaches a per-keyword predicate. This is where all
  false-friend handling lives, and §3e is the assessment of that design.
- **Compound tokens.** `COMPOUND_TOKENS` (`:423`) / `COMPOUND_FALSE_FRIENDS` (`:483`) /
  `COMPOUND_VETOES` (`:531`) expand dish names ("caesar" → egg/fish) additively.
- **The lattice — `MEASURED`, and verified independently.** I did not read
  `dietaryStyleLattice.test.js`'s assertions; I computed the actual allowed-sets over all 910
  recipes and all 14,151 foods and checked subset containment directly:
  `vegan ⊆ vegetarian`, `vegan ⊆ none`, `vegetarian ⊆ none`, `carnivore ⊆ none` — **all four
  hold, on both recipes and foods, zero violations.** Vegan is genuinely stricter than
  vegetarian on this corpus.
- **False-positive/false-negative profile.** Strongly biased to false positives, deliberately
  and correctly. The 30 false exclusions in §3 are the measured false-positive set for the
  recipe-relevant corpus. I found **no** false negatives — but see §8: my method could not have
  found them, and that limitation is the important part.

---

## 7. The NUL byte finding — CONFIRMED, and worse than reported

`MEASURED`. `backend/src/lib/dietaryFilter.js` contains exactly **3 NUL bytes**:

| Offset | Line:col | Context |
|---|---|---|
| 45807 | **757:7** | in a comment: ``// "\0" cannot appear in a food name or a keyword…`` |
| 46071 | **760:27** | `const key = (plural ? "p\0" : "w\0") + word;` |
| 46078 | **760:34** | same line, second literal |

They are **intentional** — a collision-proof cache-key separator in `wordRe()`, introduced by
commit `0d3eaa5 "Cache compiled word patterns in dietaryFilter (3.4x on the exclusion gate)"`.
A performance commit made the app's most safety-critical file invisible to its own tooling.

**What it hides — measured, not assumed:**

1. **`npm run scan:secrets` skips the file entirely.** `scripts/scanSecrets.mjs:84`:
   `if (buf.includes(0)) return; // a NUL byte marks a binary file — skip it`. Returns before
   scanning. The file is git-tracked, so it *is* in the `--tracked` list and *is* counted in the
   "N file(s) scanned" total — it is silently dropped from the scan while inflating the count
   that makes the scan look complete. The same applies to the CI job and to `dist:check`
   via `scanPaths`.
2. **Ripgrep reports it as binary, and in multi-file mode drops it silently.**
   `rg -n "wordRe" backend/src/lib/dietaryFilter.js` prints only
   `binary file matches (found "\0" byte around offset 45807)` — no lines. Worse,
   `rg -n "PLANT_MILK_QUALIFIERS" backend/src/lib/` returns **nothing at all**, with no warning,
   despite that identifier appearing on 5 lines. Confirmed identical for the **Grep tool** used
   by every agent in this campaign: `No matches found`.
3. `git grep` **does** find it (that is how I read the file's structure). `Read` works normally.

**Assessment.** This is not a security finding — I read all 1,974 lines' worth of structure via
`git grep` and `Read` and found no secret, and the bytes are 2 chars of a cache key. It is an
**epistemic** finding, and it is load-bearing for this campaign: *every negative claim any agent
made about `dietaryFilter.js` on the basis of `Grep` or `rg` is void.* "The gate has no handling
for X" was unfalsifiable through the standard tool. Given that this file is 115 KB and the
largest lib file, and that the previous 25-agent fleet's synthesis lives or dies on such claims,
this should be flagged to the whole campaign, not just fixed.

Two other tracked files carry a NUL byte and are equally invisible: `backend/scripts/qc/fuzz.mjs`
(1) and `backend/tests/librarySync.test.js` (1).

**Report only, not fixed, per brief.** The fix is trivial and behaviour-preserving
(`"p "` / `"w "` escapes instead of literal bytes) — but it is a one-line edit to the
safety-critical file and belongs to whoever owns that change, with the regression suite run.

---

## 8. Safety constraints any fix MUST NOT weaken

This is the app's most safety-critical path. Every item below is a measured property that
currently holds and must still hold afterwards.

1. **Over-exclusion stays the only acceptable failure direction.** Every §3 fix must be a
   *narrowing of one specific false friend*, never a relaxation of a category. A fix that
   converts a false positive into a possible false negative is a regression even if the pool grows.
2. **Do not remove the step-text probe or add negation parsing.** §2 measures its cost at ≤1.3%
   of pool. It is the mechanism that closed the Sushi / Banh Mi / Challah / tahini-in-title
   leaks. `exclusionGate.js:190-193` states the reason negation parsing was rejected —
   *"add butter, or omit for a dairy-free version"* carries a negation word and still cooks
   butter in. That reasoning is correct; do not relitigate it.
3. **Preserve the add-only rule between probes** (`dietaryFilter.js:1802`). No probe may clear
   another's finding. The *correct* shape for the §3a fix is not "let the name veto the
   category" — that is a veto and breaks the invariant. It is to **split the paired category
   keys** so the coarse label stops asserting two families at once (e.g. consult the pair only
   when the name gives no positive family signal, implemented as a narrower *category-family
   resolution*, not as a probe veto). Whoever implements it must state which of those two
   shapes they chose and why.
4. **Preserve fail-closed on degraded recipes** (`collectEvidence`, `exclusionGate.js:141-200`,
   mechanisms 1 and 2). `MEASURED`: 0 of 910 recipes currently hit a shape gap, so this costs
   nothing today and must not be traded away for pool.
5. **Preserve the single-implementation rule.** `exclusionGate.js` owns the evidence; no fix may
   add a second vocabulary or let a caller hand in a pre-flattened name list. The source scan in
   `tests/exclusionGate.test.js` must stay green.
6. **Preserve `TRACE_POLICY_DEFAULT = "exclude"`** (`:1544`).
7. **Preserve peanut ≠ tree nut as separate checkboxes.** The §3d Ground-Nut-Oil fix must remove
   it from *tree nuts* only and leave it excluded for *peanuts*.
8. **Preserve the lattice** (§6): vegan ⊆ vegetarian ⊆ none must still hold after any style edit.
   Re-run the containment check on the real corpus, not just the unit test.
9. **Do not "fix" §3b in the gate.** Cinnamon/Peaches/Oatmeal are corrupted food rows. Repair the
   rows; if the gate is patched to ignore *Baked Products* the app loses a real gluten signal.
10. **Re-measure with an independent oracle.** `oracle.mjs` catches 1 of 13 known bad rows
    (C19, `CORRECTIONS-5.md`) and is not sufficient. Any claim that a fix introduced no leak must
    be backed by reading rows, not by re-running the gate's vocabulary against itself.

---

## 9. What I could NOT determine

1. **Whether any of this moves the 70.1% macro-compliance number.** I measured pool size, not
   solve outcomes. I did not run the solver. The inference in §4 that gate precision is a ~0.5pp
   lever assumes pool size is the mechanism by which the gate affects compliance; if a specific
   *recipe* (not count) is pivotal for a persona, a single recovered recipe could matter more
   than the mean suggests. **Someone with the solver harness must confirm.**
2. **False negatives — the gate letting a real allergen through.** My method (read the excluded
   rows) is structurally incapable of finding these: I only ever looked at what the gate
   *removed*. Finding leaks requires reading the ~805 recipe-relevant *survivors* per persona
   against an independent allergen source. This is exactly the shape of the `tahina` failure and
   **it remains unaudited by me.** Do not read this report as evidence the gate is safe.
3. **Whether my 30-row judgement set is complete for foods NOT used in recipes.** I read every
   excluded food that appears in ≥1 recipe (805 of 14,151). The other 13,346 foods were sampled,
   not read. They cannot affect the recipe solver, but they do affect the Foods browse surface
   and any future ingredient-level closer.
4. **`allergenTaxonomy.js` (52 KB) I did not audit row-by-row.** I measured its *effects*
   through the merged maps. A wrong `fdcCategories` or `offTags` entry in that table would
   surface as a false positive I would have caught only if the affected food is used in a recipe.
5. **Real-world correctness of ~6 borderline calls.** `Oyster Sauce`→soy, `Worcestershire`→soy,
   `Thai curry paste`→shellfish, stock cubes→soy/gluten, `Naan Bread`→dairy, `Almond Extract`→tree
   nuts. All are documented deliberate conservatism with stated reasoning; all are plausible;
   several are brand-dependent. I judged them defensible and did **not** count them as false. A
   nutritionist could reasonably disagree on `Fish Sauce`→soy (which I *did* count as false, on
   the grounds that its only evidence is a USDA shelf label, not an ingredient).
6. **Whether the 259 profiles are representative.** They are a synthetic test fleet; the vegan +
   6-allergy shape appears ~15 times, which likely over-weights an extreme persona relative to
   real users. All population means in §1 and §4 inherit that bias.
