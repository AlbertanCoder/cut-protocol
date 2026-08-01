# IMPLEMENTED — the remediation, and what re-measurement actually showed

**Authorised by the owner on 2026-07-30** ("implement all of it"), which supersedes the
campaign's report-only law. Everything below was built, tested and re-measured with the
same instruments that found the defects. HEAD at start: `0d3eaa5`.

**Headline: allergen leaks 32 → 0. Macro compliance 40.8 % → 49.3 %. One of my own
predictions was wrong, and that turned out to be the most useful result.**

---

## 1. What changed

### Product code — 2 files

**`backend/src/lib/allergenTaxonomy.js`** — four new rows and a keyword fix.

| change | closes |
|---|---|
| new `pork` row (44 keywords: bacon, chorizo, pepperoni, lard, prosciutto, …) | D1 — 12 customers served pork |
| new `beef` row (sirloin, brisket, veal, pastrami, …) | D1 — "beef" previously blocked nothing but the literal word |
| new `lamb` row (mutton, hogget, goat meat, kofta) | D1, for symmetry — no leak found, same latent path |
| new `cilantro` row (coriander leaf / fresh coriander / dhania) | D1 — a customer typed "cilantro" and was served "Coriander Leaves" |
| `nightshades` + 24 keywords: `perogi`/`pierogi`/`gnocchi`/`latke`/`hash brown`, and the colour-qualified peppers | D1b — 3 customers served a hidden nightshade |

**These are deliberately NOT aliases of `red meat`.** The obvious fix — adding "pork" to
`red meat`'s synonyms — over-blocks: someone avoiding pork for religious reasons still
eats beef, and this app's core problem is a pool that is already too thin. Verified:
`"pork"` now blocks bacon/chorizo/lard/pepperoni **and still ships** Ground Beef and
Sirloin; `"beef"` blocks sirloin and still ships bacon.

**Bare `pepper` is still NOT a nightshade keyword**, and that call was tested rather than
assumed — see §4.

**`backend/src/routes/profile.js`** — new `gainDirectionGate`, a third safety gate
alongside `adultGate` and `goalWeightGate`. Refuses (400 `gain-not-supported`) when the
goal weight exceeds the start weight by more than 0.5 kg, instead of silently prescribing
`TDEE − rate × 500` in the wrong direction.

Scoped to the **goal and the rate only, never `startWeightKg`** — the test suite caught
my first version doing that, with exactly the right principle:
*"a tracker you cannot tell the truth to is worthless."* Someone who has lost weight to
42 kg while an old 62 kg goal sits above it must still be able to record that weight.
A real weight is a fact; only the prescription is gated.

### Data — 1 file, 2 scripts

**`backend/data/foodOverrides.json`** — added `Tuna` (was carrying mayonnaise-based
*"Fish, tuna salad"*: 187 kcal / 9.26 g fat) and `Cannellini Beans` (was carrying *dry*
beans at 345 kcal while all 5 recipes use them in finished soups).

**Not added: `Tomato Puree`.** I had it on my priority list at 102 slots — the second
highest by reach — and it turned out to be **fine**. Its 37 kcal / 1.58 g P *is* canned
tomato purée; the provenance flag fired on a naming mismatch, not a data error. Its
`dataQuality` even says *"macros retained but unverified"* rather than the wrong-food
wording. **I listed it without checking it, and that was sloppy of me.**

**`backend/scripts/applyFoodOverrides.mjs`** (new) — pushes the overrides into the `Food`
table and recomputes the cached macros of every affected recipe. Deliberately narrow:
`fixFoodData.mjs` would have done this *plus* a 200-group duplicate merge and a
recategorisation of all 14 k foods, which makes a value correction impossible to review
or revert on its own.

**`backend/scripts/backfillIngredientMetadata.mjs`** (new) — populates the three columns
that were designed correctly and never filled in.

Both are report-only by default, back up `dev.db` before writing, and idempotent
(re-running reports zero changes — verified).

---

## 2. Results — the same instruments, re-run

`node fleet.mjs` over all 250 personas, after clearing their pre-fix plans so the
measurement is of the fix and not its residue.

| | BEFORE | AFTER |
|---|---|---|
| **confirmed leak hits** | **32** | **0** |
| **personas leaked** | **13** | **0** |
| clean-persona rate | 94.8 % [91–97] | **100 % [98.2–100]** |
| **days inside tolerance** | **40.8 %** [37–45] | **49.3 %** [45–53] |
| honesty-on-miss | 100 % (379/379) | 100 % (293/293) |
| stored-vs-recomputed drift | 0 days | 0 days |
| leak-stability across regenerations | **false** | **true** |
| reached a plan | 250/250 | 212/250 |
| latency p50 / p95 | 377 / 806 ms | 483 / 900 ms |
| spend | $0.00 | $0.00 |
| backend tests | 1,491 pass | **1,491 pass** |

**`Boulangère Potatoes`, the dish that made D3 concrete: 2,240 → 822 kcal, 101.9 → 23.6 g
protein.** The potato contribution fell from 1,995 to 578 kcal.

**Column coverage:** `scalable: false` 260 → 1,430 rows (3.7 % → 20.4 %);
`mealCategory` set 169 → 190; oil rows mislabelled `carb` **652 → 2**.

**212/250 is the gain gate working, not a regression** — 38 personas have a goal above
their start weight and are now refused with an explanation instead of being handed a
deficit. My own stats script initially counted those 38 refusals as defects; that was the
harness, and both it and `fleet.mjs` now whitelist the gate.

---

## 3. The prediction I got wrong — and why it matters more than the wins

I wrote, in the note recommending this work: *"the vegan cohort should improve most, since
the rows you fixed are the ones concentrated on it."*

**It did not improve. It got marginally worse.**

| diet | before | after |
|---|---|---|
| none | 53.7 % | **67.5 %** |
| none/null | 37.5 % | **60.0 %** |
| vegetarian | 50.8 % | 55.6 % |
| mediterranean | 44.0 % | 50.0 % |
| paleo | 32.0 % | 47.1 % |
| halal | 38.5 % | 50.0 % |
| keto | 33.3 % | 32.0 % |
| kosher | 36.1 % | 33.3 % |
| **vegan** | **13.3 %** | **11.3 %** |

The reasoning I missed is straightforward once the numbers are in front of you. For
vegans the bad rows were **inflating** calories — potato at 3.4×, carrot at 8×, tomato at
13×. Correcting them *downward* does not add food to the plate; it removes the fictional
calories that were making thin days look adequate. The vegan pool has nothing real to
make up the difference with, so the shortfall that was always there is now visible.

**The 13.3 % was never a real 13.3 %. It was propped up by calories that did not exist.
11.3 % is the honest number.** Fixing the food table did not improve vegan plans — it
stopped them lying, which is a precondition for improving them, not a substitute.

**Consequence for the fix order: a vegan customer cannot be helped by data corrections at
all.** That is a library-composition problem — vegan protein sources the solver can
actually reach — and it is now the largest open item in the campaign. The same is true of
keto (32 %) and kosher (33 %), both flat.

---

## 4. Two checks that changed my mind, recorded because they cut against me

**`Pepper` is peppercorn, and the owner was right.** I had cited the `Pepper` row as
evidence for a nightshade leak (D1b) on the strength of its `fruit-veg` category and
27 kcal density. The owner's override reclassified it as black peppercorn. The gram
amounts settle it and they are not on my side: **81 recipes, median 0.25 g, minimum
0.1 g.** That is seasoning. The banana-pepper macros were the defect; the ingredient was
always peppercorn. **5 of my 10 D1b hits were false positives and two customers were
clear** — D1b was revised to 5 hits / 3 customers, and the campaign total from 42/18 to
37/16 before any fix was applied.

`Red Pepper` and `Green Pepper` did *not* survive that test the same way: crushed red
pepper and cayenne flakes are *Capsicum annuum* and remain nightshades at any dose, and a
28 g green pepper in `Szechuan Beef` is plainly the vegetable. Both are now caught.

**Every override `fdcId` collides with the canonical USDA row.** The first `--apply` died
on `Food.fdcId @unique`: this corpus already holds `"Potatoes, flesh and skin, raw"`
separately, so pointing the short-named row at the same record is a duplicate. Two of the
ids I had written were also simply **wrong** — 175159 is *fresh yellowfin* tuna, not
canned; 175196 is *raw kidney beans*, not canned cannellini. Both removed from my entries
with the reason recorded, and the applier now skips a colliding id and reports it rather
than letting provenance metadata block a correct macro fix.

---

## 5. What I did NOT do, and why

- **`Red Pepper` / `Green Pepper` macros are unchanged.** They carry vegetable values while
  being used at ~1.25 g, so they are wrong on both counts — but splitting each into a
  spice row and a vegetable row means re-pointing 61 recipe ingredients by individual
  judgement, and at 1.25 g the calorie error is ~0.4 kcal. The *safety* half is fixed,
  which is the half that matters. Flagged for a human pass.
- **185 herb rows with base quantities above 15 g are untouched and listed for review**
  (`300 g Basil Leaves`, `200 g Thyme`, `150 g Cardamom`, `125 g Bay Leaves`). The
  `scalable` flag stops the *multiplier*; it cannot fix a bad base quantity, and I will
  not guess a recipe's intended amount. `backfillIngredientMetadata.mjs` prints the list
  every run.
- **91 `veg → carb` role changes were declined.** Defensible in isolation (potatoes are
  carbohydrate), but `role` drives protein-vs-sides scaling and I could not verify the
  solver consequence of reclassifying 91 side-dish rows. Only unambiguous errors (oil as
  carb, stock as protein) and empty fields were touched.
- **The 200-group duplicate merge in `fixFoodData.mjs` was not run.** It is available and
  may well be wanted; it is not required for a value correction and should be reviewed
  on its own.
- **No commit, no push.** The working tree holds the changes; committing is the owner's
  call.

---

---

# ROUND 2 — pushing toward 80 %

**Asked: "should we aim for 80–99 %?" Answered with measurement, not opinion.**

## R1. The verdict on the target

**80 % is the right goal and it is already met where the library supports it.
99 % is not a coherent target and I did not chase it.**

| | days in band |
|---|---|
| **`dietaryStyle: none` (80 personas, the mainstream customer)** | **53.7 % → 83.0 %** |
| halal (6) | 38.5 % → 91.7 % |
| mediterranean (16) | 44.0 % → 70.0 % |
| no style set (24) | 37.5 % → 70.0 % |
| vegetarian (21) | 50.8 % → 58.7 % |
| paleo (11) | 32.0 % → 47.1 % |
| kosher (12) | 36.1 % → 47.2 % |
| **keto (14)** | **33.3 % → 32.0 %** |
| **vegan (26)** | **13.3 % → 17.5 %** |
| **FLEET-WIDE** | **40.8 % → 60.4 %** (95 % CI 56.3–64.3) |

Two things I refused to do to make the number go up:

- **Widen the tolerance bands.** That is the cheap route to 99 % and it improves
  nothing — it would break the one thing this app is unambiguously good at
  (honesty-on-miss, still 100 %: 229/229).
- **Force a plan onto infeasible configurations.** 24 of the impossible tier are
  genuinely unsatisfiable; the correct output there is a refusal, and a 99 % target
  makes the app lie about exactly those customers.

## R2. What changed, and the measured contribution of each step

| step | days in band |
|---|---|
| original campaign | 40.8 % |
| + food table, taxonomy, gain gate (round 1) | 49.3 % |
| + **composition-aware sampling** in `pickRecipe` | 53.3 % |
| + **adaptive slot-attempt budget** (5 → up to 20, scaled to pool) | **60.4 %** |

**The root cause of the largest single failure class.** Fat caused 59 % of failing
days, and 74 days were in band on kcal, protein *and* carbs and failed on fat alone,
every one **over** the band by a median of 49 %. It was not pool composition — for 8
of 10 sampled fat-failing customers, **20–53 % of their own filtered pool was lean
enough** and never got looked at. `pickRecipe` weighted its draws by
protein-per-kcal only; `MAX_SLOT_ATTEMPTS = 5` drew five dishes from a 400-dish pool;
and `compositionDistance` could only tie-break among those five. **The solver was
optimising for something narrower than `dayTolerance()` grades it on.** The slot's
remaining fat/carb budget now biases the draw itself, softly (a dish 20 points off
gets ~0.56× weight, never 0, so thin pools still get used and still warn honestly).

## R3. A regression my own change introduced, caught by a self-defending test

Raising the attempt budget to a flat 20 **made thin pools worse.** On a 36-recipe
fixture the best week fell from 6/7 days to 4/7: with a repeat cap in play, a deep
per-slot search is greedy — it spends the few workable dishes early in the week and
starves the later slots.

That would have penalised **exactly the restricted-diet customers who are already
worst served.** So the budget is now scaled to the pool —
`max(5, min(20, floor(poolSize / 10)))` — which keeps the original behaviour where it
was better (36 dishes → 5 attempts) and takes the gain where there is real depth
(400 → 20). Cost of protecting them: ~1 point fleet-wide (61.4 % flat vs 60.4 %
adaptive, inside the CI). Worth it.

`tests/solverHonesty.test.js` caught this by refusing to pass vacuously
(*"sweep produced no 6/7 week — retune the fixture"*). Its **assertions are
unchanged**; only the target that provokes a 6/7 week moved (protein band 230–250 →
195–215), and the new sweep is harder-working than the old one: outcomes now span
2/7 to 7/7 with 10 of 40 seeds landing exactly 6/7.

## R4. The golden baseline was re-blessed — disclosed, not buried

`tests/golden/engine-baseline.golden.json` drifted and I regenerated it with the
command the test itself documents. Before doing so:

- **Only the `solver` section moved.** `bmr`, `grocery`, `trend`, `diary` are all
  byte-identical — the expected footprint of a selection change, and reassurance that
  nothing outside the solver was touched.
- **The drift is a same-quality reshuffle, not a gain or a loss.** On that fixture:
  3/7 days in tolerance, avgMatch 61, 5 unfilled, 9 warned — **identical before and
  after.** Only *which* days land changed (`1010010` → `1000110`). It is a thin-pool
  scenario where the change is neutral.
- **The pre-change baseline is preserved** at
  `incident/engine-baseline.golden.PRE-COMPOSITION-BIAS.json`.

Diff: 289 insertions / 289 deletions — symmetric, as a reshuffle should be.

## R5. Why vegan and keto did NOT move, quantified

This is the answer to "can we get the fleet to 80 %", and it is not a solver question.

**vegan — 92 % of failing days fail on PROTEIN, median 75 % BELOW the band midpoint.**
The plans deliver roughly a quarter of the protein asked for. No sampling strategy,
scaling factor or search depth fixes a pool that does not contain the protein. Zero
empty days, 3.1 slots filled — the solver is doing its job on an impossible brief.

**keto — 12 of 34 failing days have NO FOOD AT ALL**, and 2.0 slots filled on the
rest. The keto-eligible pool cannot fill a day. A further 7 days are over the carb
ceiling, which has **zero** upward allowance by design (a diet law, correctly).

**none — 54 of 272 days fail, fat is 61 % of them, no empty days, 4.5 slots filled.**
This cohort is essentially solved; the residual is fat-composition fine-tuning.

**So the arithmetic for a fleet-wide 80 %:** lifting vegan (80 days) and keto (50
days) to 80 % adds ~74 days, taking 349/578 → ~423/578 = **~73 %**; the kosher, paleo
and carnivore tails close the rest. **That is entirely recipe-authoring work** —
vegan protein sources and keto-compliant dishes the solver can actually reach — and
it is now the only lever left that matters.

---

# ROUND 3 — the library, and where the ceiling actually is

**Asked for 80–95 %, preferring 90–99 %. Delivered 65.9 % fleet-wide / 73.1 % on
satisfiable configs / 88.7 % for the mainstream customer — and the reason the last
figure is the meaningful one is arithmetic, not excuse-making.**

| | original | now |
|---|---|---|
| **`none` — 80 personas, the mainstream customer** | 53.7 % | **88.7 %** |
| halal (6) | 38.5 % | **100 %** |
| mediterranean (16) | 44.0 % | **87.5 %** |
| no style set (24) | 37.5 % | 68.3 % |
| kosher (12) | 36.1 % | 66.7 % |
| paleo (11) | 32.0 % | 58.8 % |
| vegetarian (21) | 50.8 % | 57.1 % |
| keto (14) | 33.3 % | 44.0 % |
| vegan — **genuine configs only** | — | **48.1 %** |
| vegan — including engineered-impossible | 13.3 % | 16.3 % |
| **fleet-wide (all 578 days)** | **40.8 %** | **65.9 %** |
| **satisfiable configs only (495 days)** | — | **73.1 %** |

Leaks stayed **0**. Honesty-on-miss stayed **100 %**. All **1,491 tests pass**. $0.00 spend.
(Run-to-run variance is ~1.5 points — the solver samples — so read these as 66 ± 1.5.)

## R6. Why 90–99 % fleet-wide is not a real target

**83 of the 578 days belong to personas I engineered to be unsatisfiable** — vegan
*plus* soy, gluten, peanut, tree nut, sesame and legumes all excluded, against an
LBM-derived protein floor. Those 53 vegan-impossible days score **0 %, by
construction**, and they should: the correct output is a refusal.

That puts a hard ceiling of roughly **88 %** on the all-days figure even with a
perfect solver, and the only ways to "reach" 90 % would be to widen the tolerance
bands or to let the app pretend on contradictory inputs. I did neither.

**The honest scoreboard is the two lower rows**: 73.1 % on satisfiable configs, and
**88.7 % for the customer who is actually going to use this** — which is inside the
band you asked for.

## R7. What moved the number — and the bottleneck nobody had named

Authoring recipes was the plan. The attempt immediately hit a wall that turned out to
be the real story: **only 5 of my first 26 recipes could be built**, because the
staples were quarantined. You cannot write a Mediterranean dish without lemon, an
Asian one without ginger, or any salad without cucumber.

**703 of 889 recipes (79 %) carried an `untrusted-ingredients` flag** — and most of
those flags were wrong. `Parsley ← "Parsley, fresh"`, `Lime ← "Limes, raw"`,
`Ginger ← "Ginger root, raw"`, `Russet Potato ← "Potatoes, Russet, baked"` are the
**same food**; the macros were always right and only the provenance stamp said
otherwise. A handful were genuinely wrong and are now fixed:

| row | was carrying |
|---|---|
| `Green Chilli` | **"Asparagus, green, raw"** — a chilli is not asparagus |
| `Chilli Powder` | **"Baobab powder"** |
| `Dill` | **"Pickles, cucumber, dill"** — the herb is not the pickle |
| `Bacon` | **"Bacon, MEATLESS"** — a vegetarian substitute's numbers on a pork row |
| `Icing Sugar` | **"Cookie, butter or sugar, with chocolate icing"** (503 kcal, 4.1 g protein — sugar has no protein) |
| `Banana` | **"Bananas, DEHYDRATED"** — 346 kcal against 89 fresh, on a fruit that appears in smoothies |
| `Vegetable Stock` | **"Soup, stock, BEEF"** — vegans were being credited beef stock |
| `Greek Yogurt` | **"Yogurt, Greek, BLUEBERRY, CHOBANI"** — plain yogurt credited added sugar |
| `Cabbage` | **"Cabbage, KIMCHI"** · `Bread` ← **"Bread, CHEESE"** |

That unblocked authoring: recipes blocked fell **79 % → 61 %**, and 21 of 26 recipes
became buildable. **Snacks went 9 → 18, and vegan-eligible snacks 0 → 5** — the
structural hole behind seven separate customer complaints.

**Contribution of each step, measured:**

| step | fleet-wide |
|---|---|
| round 1 (food table, taxonomy, gain gate) | 49.3 % |
| round 2 (composition-aware sampling + adaptive attempts) | 60.4 % |
| **round 3 (staple un-quarantine + 21 authored recipes)** | **65.9 %** |

## R8. Two more tests caught real things, and neither was weakened

- **`foodValidation`** rejected my `Lime` override: 30 kcal against 41 fiber-adjusted.
  It was right to. Citrus carb-by-difference is largely **citric acid (~2.5 kcal/g,
  not 4)**, so USDA's own figure fails a naive 4/4/9 check. Marked `atwaterExempt`
  with the reason recorded — the same documented exemption class the file already
  carries for acetic acid — rather than bending the number to pass.
- **`horizonGeneration`** stopped seeing the snack pool as the binding constraint,
  because **it no longer is** at 2 snacks/day (18 recipes × 5 servings = 90 for 56
  slots). It also revealed a latent defect: the scenario built its variety plan from
  `{ meals: 3, snacks: 0 }` and then asked about snacks, so it had been passing on
  branch-ordering luck. Fixed both — matching variety plan, and demand raised to
  4/day where the pool genuinely binds. The comment tells the next person to raise it
  again or delete the assertion when the shortage is finally gone.

## R9. What is left, and what it would take

**Genuine vegan sits at 48.1 % and keto at 44 %, with 12 keto days still empty.** The
21 recipes helped every mainstream cohort and barely moved these two, which is
consistent with the round-2 finding: their pools are thin in *protein* and in
*keto-compliant mains* specifically, and 21 recipes spread across five niches is not
enough depth for either. This is recipe-authoring volume, not engineering — the
solver work has demonstrably plateaued (5 → 12 → 20 → 30 attempts gave 53.3 → 60.2 →
60.4 → 61.8 %).

Estimated to reach ~80 % on satisfiable configs: roughly **40–60 more recipes**,
weighted to vegan protein mains and keto mains, plus the remaining ~450 quarantined
food rows triaged the same way as the staples (most will be benign name mismatches).

---

# ROUND 4 — the owner was right: add a component, don't stretch the dish

**The challenge: "if you can't bring up the solver's ability, doesn't that mean this
brain isn't that good?" Partly yes — and the suggestion that came with it found the
real weakness, which three rounds of my own work had walked past.**

## R10. The measurement that settled it

Portion scaling gives the solver **two knobs** — `proteinScale` and `sidesScale` —
against **four macro targets** that `dayTolerance()` grades on. A dish's macro *ratio*
is fixed no matter how it is scaled. So I measured whether it was actually running out
of room, across 2,431 shipped slots:

```
slots pinned at a 0.5x or 2.0x scale bound ............ 39.3%
of slots that MISSED tolerance, share pinned .......... 68.3%
```

**Two thirds of every failure was the solver hitting a wall, not choosing badly.** That
is a genuine structural limit, and I had been treating library size as the only lever.

The obvious response — widen the bounds — is wrong, and the campaign already proved it:
the customer complaints about "625 g chicken with 2 g pine nuts", "13 g of cabbage
inside a cabbage stew", "465 g of egg white" and "105 g of rosemary" are all what
scaling at the bounds produces. Stretching a dish past a serving does not make it food.

## R11. What was built

`macroCloser.js` — after a day is solved, if it is still out of band, **add a small
real component** rather than distort a dish: a spoon of olive oil, a portion of rice,
some Greek yogurt. Bounded at 25 g fat / 160 g carb / 180 g protein, max three
additions, in practical amounts (5 g steps above 20 g).

**Allergy safety is structural, not a second check.** The module never picks a food.
`planContext` resolves the candidates and filters them through `explainFoodExclusion`
— the same gate every recipe surface uses — so there is no second vocabulary to drift.
Verified live:

| persona | offered |
|---|---|
| dairy wall | oil, avocado, rice, potato, oats, chicken, tofu, lentils — **no butter, no yogurt** |
| vegan + soy + legumes | oil, avocado, rice, potato, oats — **no animal protein, no tofu, no lentils** |
| keto + dairy + soy + eggs | oil, avocado, chicken — **no rice, potato or oats** |

Three further rules keep it honest: it never adds a food whose macros are untrusted;
it **backs off rather than harm** (an addition that would push another macro out of
band, or breach keto's zero-allowance carb ceiling, is refused and a smaller amount
tried); and every addition is a real ingredient with real grams, so it appears in the
plan, the totals and the grocery list. Nothing is added invisibly.

It is **opt-in by construction** — with no `adjusters` supplied the day is returned
untouched, which is why all 1,491 tests including the goldens passed unchanged.

## R12. Result

| | before round 4 | after |
|---|---|---|
| **`none` — the mainstream customer** | 88.7 % | **90.6 %** |
| keto (14) | 44.0 % | **62.0 %** |
| kosher (12) | 66.7 % | **72.2 %** |
| paleo (11) | 58.8 % | **64.7 %** |
| no style set (24) | 68.3 % | **76.7 %** |
| genuine vegan | 48.1 % | **59.3 %** |
| **satisfiable configs** | 73.1 % | **77.8 %** |
| **fleet-wide** | 65.9 % | **70.1 %** |

**Only 9.9 % of slots (240 of 2,432) received an added component** — a targeted
intervention, not a crutch. What it reached for, in order: chicken breast ×94, olive
oil ×60, white rice ×41, Greek yogurt ×41, avocado ×25, tofu ×22, lentils ×17.

**Full arc: 40.8 % → 70.1 % fleet-wide, 90.6 % for the mainstream customer**, leaks 0,
honesty-on-miss 100 %, spend $0.00.

## R13. On "grab recipes online" — it already exists, with one caveat

The app **already has the importer**: `recipeImporter.js` fetches a URL, parses
schema.org/Recipe JSON-LD (`@graph` walk, `HowToStep`, ISO-8601 durations), runs an
ingredient-line parser (unicode fractions, ranges → midpoint, volume → grams via a
density table with `estimated` flags, honest `null` when it cannot convert), resolves
each line against the verified food DB, and saves tagged `imported` after validation.
That is exactly the mechanism, and it is the right one.

Two honest caveats before pointing it at the web in bulk:

1. **The bottleneck I hit was not recipe supply — it was the food table.** My first
   authoring attempt built 5 of 26 recipes because the staples were quarantined. An
   importer resolves ingredient lines against those same rows, so bulk import would
   have produced bulk `untrusted-ingredients` until the staples were fixed. That work
   is now done for the top ~30 rows; ~450 remain.
2. **Licensing.** Ingredient lists and quantities are facts and are not copyrightable;
   the written method steps generally are. Importing a handful for personal use is
   ordinary; scraping recipe sites at volume into a product that may ship is a
   decision worth making deliberately rather than as a side effect of a QA campaign.
   Openly-licensed sources exist and would sidestep it.

## 6. Still open, in priority order

1. **Vegan / keto / kosher library composition** — now the largest item, and provably not
   fixable with data corrections (§3). Vegan protein the solver can reach.
2. **The remaining P1s from the report**: gate on `poolCounts.afterStack` before writing a
   near-empty plan (D12, 3 customers); recompute the slot `warning` server-side instead of
   copying it from the client (D9 — the only silent-miss hole found); accept a bare
   `recipeId` on `…/slots/:id/apply` (D11 — six customers hit it, and it compounds into
   the vetted-dish-swap problem, D22).
3. **~30 more snack recipes** (D17) — the library has 9, all cured meat/dairy/nuts, and
   0 of 9 survive a vegan filter.
4. **The 162 recipes shipping `"step 1"` placeholders** and 262 with two-sentence methods
   (D19) — this is what "the meals are good: 2.8/10" is made of.
5. **A `state` column on `Food`** (raw/dry/cooked/canned) — the single missing field behind
   the dry-bean error and two thirds of the shopping list reading `(state unrecorded)`.
6. **Latency regression**: p50 377 → 483 ms. Modest and acceptable, most likely more fixed
   ingredients meaning less scaling flexibility and more solver retries. Worth confirming
   before it drifts further.

---

*Baseline preserved in `before-fixes/`. DB backups: `dev.db.backup-prebackfill-*`,
`dev.db.backup-overrides-*`. Both new scripts are idempotent and report-only by default.*
