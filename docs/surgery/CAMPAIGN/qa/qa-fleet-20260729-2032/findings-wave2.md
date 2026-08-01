# Working notes — findings from the second interview batch

Staging file. These get folded into `FLEET-REPORT.md` in one consolidated pass once
all 25 deep-dives are in, so the defect numbering is renumbered once rather than
five times.

---

## N1 · P1 · The entire snack pool is 9 recipes out of 889, and all 9 are cured meat, dairy or nuts

`Recipe.slotType` is `snack` for **8** rows and `either` for **1**. That is the whole
snack library — **1 % of 889 recipes** — and this is the complete list:

```
Bacon & Eggs
Jerky & Pork Rinds Snack Plate
Greek Yogurt, Almonds & Berries
Pistachios & Jerky
Pepperoni & Pistachios Plate
Avocado Chips & Jerky
Tuna Cucumber Cracker Plate
Turkey & Swiss Roll-Ups
Greek Yogurt, Honey & Almonds
```

Survival after the exclusion gate:

| wall set | snacks that survive |
|---|---|
| none | 9 / 9 |
| gluten | 8 / 9 |
| dairy | 5 / 9 |
| dairy + gluten | 5 / 9 |
| p108's five walls (soy, gluten, peanut, tree nut, sesame) | 4 / 9 |
| **p164's five walls (sesame, dairy, egg, pork, beef)** | **1 / 9** |
| **vegan** | **0 / 9 — a vegan can never be served a snack** |

**This one table explains a long list of separate customer complaints**, all of which
looked like different bugs:

- *"Both of my snack slots are the exact same dish"* (p019)
- *"The same snack twice in one day, at $6.75 a serving each"* (p040)
- *"two of three snacks were the same dish… the keto snack pool looks like it is two recipes deep"* (p033)
- *"the same Greek yogurt snack twice"*, and after swapping, *"all three snacks are yogurt + almonds"* (p190)
- *"my snack slot has effectively one recipe in the entire app once my walls are applied, so there is nothing to swap to"* (p004)
- *"the snack slot was blank — no dish, no calories, no suggestion"* (p108)
- *"asking for alternates returns `{"alternates":[]}`"* (p164)

None of those are variety-cap bugs or solver bugs. They are all one missing asset:
**there are nine snacks.** With a 2×/week variety cap, a customer eating one snack a
day needs ~4 compliant snacks to avoid repeats; a walled customer often has 1.

### And it explains the p164 leak mechanically — via D1

p164 walls `pork` and `beef`. Of the 9 snacks, **exactly one survives their gate:
"Pepperoni & Pistachios Plate"** — and it survives *only because* `"pork"` and
`"beef"` fail to resolve in the taxonomy (D1). So:

1. D1 lets pepperoni through as a false survivor.
2. The snack pool therefore looks 1 deep instead of 0.
3. The solver serves the single candidate — the one dish that breaks two walls.
4. `alternates` correctly returns `[]`, because there genuinely is nothing else.
5. Regenerating serves it again, because the pool is deterministic and 1 deep.

**Fixing D1 alone turns this leak into an honest "no eligible snack recipe left for
this slot"** — which is the right answer and which the app already knows how to say
(p108 got exactly that message). Fixing D1 *and* authoring ~30 snacks fixes the
whole cluster.

- **Evidence:** `cards/card-p164.json`, `cards/card-p108.json`, `raw/p164.json`; pool counts re-derived by direct query against `Recipe.slotType` + `exclusionGate.isExcluded`.
- **Corroboration:** p164's pepperoni leak was found *independently* by the Phase-2 automated fleet (`results.jsonl`, `wall: pork, name: "Pepperoni"`) and by the interviewed customer. Two methods, no shared code path.

## N2 · P2 · No repair path for a slot the customer must change

`POST /alternates` answering `200 {"alternates":[]}` is truthful but is a dead end on
the one slot a customer medically cannot eat. The customer's words: *"the one meal I
medically must remove is the one meal I cannot change."* When the alternates list is
empty because the pool is exhausted, the response should say so in the words the
generate path already uses, and the slot should be emptied rather than left holding
the offending dish.

## N3 · NOT a leak — coconut vs a "tree nuts" wall, and why the app is defensible

Persona p204 (walls `sesame, fish, tree nuts, soy, gluten`) filed
`allergenRespect.ok = false` over **200 g of Coconut Milk** in "Grilled eggplant with
coconut milk", arguing: *"FDA and Health Canada both classify it as a tree nut, so
every can on the shelf here is labelled 'Contains: Tree Nuts'."*

**I am not counting this as a leak, and the reasoning matters.**

- `allergenTaxonomy.js` makes this call **explicitly and on the record**: *"Coconut
  is deliberately NOT a tree nut here (FDA lists it; allergists and this corpus treat
  it as a fruit, and excluding it would delete a vegan staple)."*
- My own independent matcher reached the same conclusion without consulting the app —
  `coconut` is in this fleet's `tree nut` **guard** list, for the same clinical
  reason. So two independently-authored vocabularies agree with the app, and the
  customer's objection rests on **labelling law**, not on allergen biology.
- Clinically the app is on the stronger ground: most tree-nut-allergic people
  tolerate coconut, and excluding it would strip a staple from every vegan and
  dairy-free plan.

**But the customer's actual complaint is not "you got the biology wrong" — it is
"you decided for me and did not say so", and that part is fair:**

> *"Either exclude it or flag it and let me decide — handing it to me silently is
> the failure."*

A customer who ticks "tree nuts" because their allergist said so, and who then reads
`Contains: Tree Nuts` on the tin the app told them to buy, has no way to know the app
made a deliberate exception. **Recorded as a disclosure gap, not a defect:** the
exception is correct and should be surfaced — one line on the tree-nut checkbox
saying coconut is not treated as a tree nut, and why.

## N4 · P1 · The alternates list re-rolls between calls, so the dish you vetted is not the dish you get

Two customers hit this, and one named the safety consequence precisely:

> *"The alternates list re-rolls between calls, so the dish I vetted is not the dish I
> can apply — dangerous when I am vetting for allergens."*

Sequence p204 actually experienced:

1. `POST …/alternates` → offered `High-Protein Cottage Cheese & Broccoli with Quinoa`, which the customer checked against all five of their walls and accepted.
2. `PUT …/apply {recipeId}` → **400 "a slot needs at least one ingredient"** (D11).
3. Re-fetch alternates to get the full object → **the list had reshuffled**, and its first entry was now `Jamaican Curry Chicken Recipe`.
4. That is the dish that landed on the plan — never vetted by the customer.
5. The day went `1384 → 1689 kcal` against a 1,404 target, and **no other slot rebalanced.**

So D11 (apply rejects a bare `recipeId`) is not merely annoying: **it forces a
re-fetch, and the re-fetch invalidates the customer's allergen check.** The two
defects compose into a path where a customer vets one dish and is served another.
Fixing D11 alone closes this.

## N5 · Corroboration of D8 with a protein consequence

p204: *"'Grilled eggplant with coconut milk' claims 16.7 g protein… Eggplant and
coconut milk cannot produce 16.7 g of protein. Also the eggplant is tagged
`role: "protein"`."*

Arithmetic: `Egg Plants` carries egg white's 10.7 g/100 g (D8), and the slot holds
150 g → **16.1 g of the claimed 16.7 g comes from an aubergine credited as egg
white.** Two customers independently derived this from the outside.

## N6 · P1 · Two thirds of a shopping list cannot actually be shopped

Measured over the **433 distinct foods the fleet was actually served** (not library
trivia — real customer plates):

| | |
|---|---|
| foods carrying a purchase unit ("1 pepper", "1 dozen") | **144 (33.3 %)** |
| foods returning **raw grams only**, with a disclaimer | **289 (66.7 %)** |

The disclaimer the customer sees on those 289 is honest but useless at the till:
`"form": "as-prepared (state unrecorded) — NOT a raw/dry purchase quantity"`. For
rice and quinoa that is a threefold difference between what the list says and what
you buy. Four customers said a version of this independently; one put it plainly:
*"only 14 of 58 items tell me what to actually buy — the rest are raw gram counts
with a disclaimer that they are not purchase quantities."*

**Three served foods get a unit naming the wrong food entirely:**

```
Egg Plants          -> "2 eggs"            (an aubergine)
flax eggs           -> "5 eggs"            (a flax-and-water slurry)
Chickpea pasta, dry -> "1 can (drained)"   (dry pasta, cat: grains)
```

These are the visible tip; the 66.7 % with no unit at all is the larger cost, and it
is why the grocery list drew the lowest confidence of any surface the customers
touched. (Note the app is *honest* about it every time — this is a coverage gap, not
a lie.)

## N7 · P1 · Recipe instruction quality, measured — this is why "the meals are good" scored lowest

"The meals are good" was the worst of the owner's five criteria across every
interview. It is not a matter of taste; it is measurable. Across all **889** recipes:

| defect in `Recipe.steps` | recipes | share |
|---|---|---|
| ships literal **`"step 1"` / `"step 2"`** placeholders as instruction lines | **162** | **18.2 %** |
| ships **scraped checkbox glyphs** (`□`) as instruction lines | **13** | 1.5 % |
| the entire method is **two sentences or fewer** | **262** | **29.5 %** |

Customer quotations, each traceable to a row above:

- *"Raw scraped junk is shown to me as cooking steps"* — `["step 1", "Heat oven to 190C…", "step 2", "Bake for 45 mins…"]`, and `["▢", "Cut the lamb into large pieces.", "▢", …]`
- *"These are not recipes — the entire method for a main meal is two short sentences"* — `["Cook the eggs.", "Serve with potato and bell peppers."]`
- *"You do not cook cottage cheese"* / *"'Cook the turkey.' for prepackaged deli luncheon meat"* — the two-sentence template applied mechanically to foods that need no cooking
- *"An instruction is missing the thing it is telling me to measure"* — *"Optional: Sprinkle a couple of tablespoons on top of the lamb for a thicker stew."* — of **what**?
- *"Two dishes are not realistically cookable as described"* — Duck Confit at `prepTimeMin: 22` (a two-day cure), a breakfast herring needing *"Refrigerate for 2 to 3 days before eating"*, and a `prep=34min` dish whose first step is *"leave to strain in the fridge for a minimum of 12 hrs"*

**And 3 recipes carry a description that restricts when they may be served, which
the solver ignores:** `Perogies & Bacon`, `Bacon & Eggs` and `Avocado Chips & Jerky`
all say **"Weekends only."** in their own `description`. One customer was served the
jerky plate on a Wednesday and noticed: *"My snack says in its own description that
it is a weekend food, and it was scheduled on a weekday."*

The library has the metadata to do better in several of these cases (`prepTimeMin`,
`description`, `steps`) — the solver simply does not read it.

## N8 · Dish names that promise food the dish does not contain

Three distinct instances across three unrelated customers, all traceable to the same
`flax eggs` / `Egg Plants` rows:

| dish name | what is actually in it |
|---|---|
| `Classic Eggs & Broccoli with Potato` | 215 g **flax eggs**, no egg |
| `Classic Eggs & Bell Peppers with Rice` | 300 g **flax eggs**, no egg |
| `Egg & Spinach Scramble` | 300 g **flax eggs** + broccoli — **neither egg nor spinach** |

Its steps read `"Scramble eggs with greens."`. The customers' objection was not that
flax is unsafe — it is that they never asked for an egg replacer (`dietaryStyle` was
`none` for two of the three), the name conceals the substitution, and the protein
credited to the meal is egg white's. One added the practical hazard: *"420 g of flax
eggs… flax is a laxative in ~30 g doses."*

## N9 · P1 · ROOT CAUSE of "portions that are not food": `scalable` is 96 % unpopulated

Every interview complained about absurd quantities. They are not separate bugs — they
are one unset flag compounding one bad-data problem.

`RecipeIngredient.scalable`'s own schema comment states the intent:
*"false = fixed (spices, a single egg, etc.) — not scaled with the recipe multiplier"*.

Measured:

| | |
|---|---|
| all ingredient rows | **7,024** |
| marked `scalable: false` (fixed) | **260 — 3.7 %** |
| herb / spice / seasoning rows | 813 |
| of those, marked `scalable: **true**` and therefore multiplied | **808 — 99.4 %** |

**And the library already carries impossible base grams before any scaling:**

```
300 g  Basil Leaves
200 g  Thyme          150 g  Thyme
150 g  Parsley
```

So the portion complaints compound two causes: a bad base quantity, then a
0.5–2× multiplier applied to it. That is the full explanation for:

- *"105 g of rosemary as a side"* (p005) · *"60 g of thyme in one portion… a whole supermarket bunch"* (p131) · *"40 g Thyme next to 1 g Green Pepper"* (p204) · *"15 g of thyme in one portion"* (p005)
- *"1.1 kilograms of spring onions and a heaped tablespoon of salt… that is not a meal, it is a bucket"* (p108)
- *"13 g of cabbage inside a cabbage stew"* and *"625 g chicken with 2 g pine nuts"* (p063, p204) — the mirror image: `sidesScale 0.5` shrinking the thing that should be fixed while `proteinScale 2` doubles the meat
- *"100 g Parsley as a garnish"* (p064)

**This is the same shape as `mealCategory` (720/889 null) and `allergenTags`
(14,148/14,148 null): the mechanism was designed correctly and never populated.**
Three of the campaign's most-cited quality defects are all one missing data pass.

- **Localization:** `RecipeIngredient.scalable` (data, not code) + the scaling in `weeklyPlanner.js` `scaleRecipe`. Cheap heuristic: any ingredient whose `Food.category` is `spices` or whose base grams are under ~15 g should default to fixed, and herb base grams above ~30 g should be flagged for review.

## N10 · P2 · No API surface reveals how the calorie target was derived

Three customers wanted to check the number they were being asked to trust. p131 tried
`/api/profile/engine`, `/api/engine` and `/api/profile/tdee` — **all 404**.

Confirmed: `computeEnergy` is imported only by `src/routes/profile.js`, and only to
run the rate-safety gate. `GET /api/profile` returns the stored row —
`targetKcal` and nothing that produced it. `/api/meta` and `/api/meta/allergens`
exist; no engine surface does.

The constitution says *"Displayed numbers can reveal their formula and inputs."* On
the desktop UI the Engine tab may satisfy that; **over the API it is not satisfied**,
and a customer who wants to audit a 1,200 or 4,483 kcal prescription cannot.
p131: *"I am asked to trust 2,296 with no visible math."*

## N11 · P2 · The goal-weight safety gate guards only the thin end

`goalBmi: { needsAckBelow: 18.5, refusedBelow: 16 }` — there is no upper bound. p131
set a goal of **110.5 kg at 178 cm = BMI 34.9**, starting from an already-obese 30.9,
and the app accepted it silently with `rateAcknowledged: false`.

The thin-end gate is genuinely excellent (see §4 — it refused a BMI-16 goal with
three paragraphs of well-judged copy). The asymmetry is the finding: *"A tool that
tells me my protein source to the gram might mention that my goal takes me further
into obesity."* Not a defect in the gate that exists — a gap where its mirror should be.

## N12 · The dry-vs-cooked form problem, which is real even though the arithmetic around it was not

p153's arithmetic claim was refuted (see below), but the observation underneath it is
sound and belongs in the **wrong-FORM** family from D3:

> *"The 'Cannellini Beans' row carries DRY bean data (345 kcal, 59.8 g carb per 100 g)
> and the app admits it in the row itself — but it is used as 'Cannellini Beans 220 g'
> in a BAKED cod dish. Nobody bakes 220 g of dry, unsoaked beans. Open a can instead,
> as any cook would, and I lose 513 kcal and 90 g of carbs the plan already counted."*

That is exactly right, and it is the same failure as `Carrots ← "Carrot, dehydrated"`:
**the row is internally consistent and the plan's arithmetic is perfect, but the food
state assumed by the data is not the state a cook will actually use.** The app cannot
detect this because both readings are self-consistent — which is why it needs a
`state` field (raw / dry / cooked / canned) rather than a better checksum.

Four customers hit the same wall from the shopping side: *"it tells me to buy 400 g of
cooked white rice and 500 g of cooked ground beef — I have to do every raw-to-cooked
conversion myself"*, against the list's own disclaimer
`"as-prepared (state unrecorded) — NOT a raw/dry purchase quantity"`. The disclaimer
is honest; **`(state unrecorded)` is the actual defect, and it is one column.**

## N13 · A sub-week regenerate adds a day rather than replacing it

p153 regenerated a 1-day plan and ended up with **two** days on the account —
7,183 kcal across four meals against a 4,206 target — with nothing saying which day
to eat.

This is `plans.js` working as designed: a sub-week horizon *"starts TODAY and touches
only the days it covers"*, deliberately, so a 3-day plan cannot delete the four days
it never touched. The customer's original plan was written on 2026-07-29
(`dayOfWeek 2`) and the regenerate ran after midnight on 2026-07-30 (`dayOfWeek 3`),
so both survived — correctly.

**Partly a campaign artifact** (this run crossed midnight, which a real user rarely
does mid-session) and partly a real UX gap: `GET /plans/current` returns the whole
week's slots with no "this is today" marker, so a customer who regenerates near
midnight sees a plan with double the food and no way to tell which half is live.
Recorded as a gap, not a defect — the storage behaviour is right.

## N14 · The prioritised food-table work list — 8 rows, 413 slot-appearances

The confirmed wrong-food and wrong-form rows, ranked by how often they actually
reached a fleet customer's plate:

| row | reached | carries the macros of | consequence |
|---|---:|---|---|
| `Potatoes` | **111 slots** | *"Bread, potato"* | 266 kcal vs ~77 — **3.4×** |
| `Tomato Puree` | **102 slots** | *(tomato-powder family)* | inflated |
| `Carrots` | **92 slots** | *"Carrot, **dehydrated**"* | 341 kcal vs ~41 — **8×** |
| `Tinned Tomatos` | **53 slots** | *"**Tomato powder**"* | 302 kcal vs ~20 — **~13×** |
| `Tomatoes` | 17 slots | *"**Tomato powder**"* | 302 kcal vs ~18, and it is a `fruit-veg` row |
| `Tuna` | 17 slots | *"Fish, **tuna salad**"* (mayo) | 9.26 g fat vs ~1 |
| `Cannellini Beans` | 14 slots | *"Beans, cannellini, **dry**"* | 345 kcal, used in a baked dish |
| `Chicken Breast` | 7 slots | *"tenders, **breaded**"* | 14.7 g protein vs ~31 — **half** |

**Eight rows, 413 slot-appearances.** Fixing these eight is a bounded afternoon's work
with a larger effect on macro accuracy than anything else in this report.

Both tomato rows are the worst multiplier in the set, and `Tomatoes` — a `fruit-veg`
row — carrying dehydrated tomato *powder* is the same error class as `Carrots`.

## N15 · A NEGATIVE result: I could not find a hidden population of bad rows, and that matters

I tried to find bad rows the self-declaration missed, by screening all **433 served
foods** for implausible density (fresh vegetables above 90 kcal/100 g, watery items
carrying protein, Atwater mismatch >25 %). It flagged 64 rows — and on inspection
**essentially all are false positives of my screen, not defects**:

- **dried spices legitimately 250–560 kcal** — `Whole black peppercorns` 564, `Bay Leaf` 313, `Paprika` 282, `Oregano` 265, `Allspice` 263. My regex matched "pepper" in `Black Pepper`, `Cayenne Pepper` and even `Pepperoni`.
- **alcohol** — `White Wine` and `Sake` show "Atwater off −87 %" because ethanol is 7 kcal/g and appears in no macro column. The app's own validator has a **documented exemption** for exactly this.
- **acids** — `Lemon Juice`, `Lime juice` (citric acid), likewise exempted by the app.
- **correct rows my regex mis-parsed** — `Fish, tuna, light, canned in **water**, drained solids` at 90 kcal / 19 g protein is right; my "liquid with protein" rule matched the word "water" in the name.
- **low-calorie vegetables** where a 5 kcal absolute difference reads as a 29 % relative one (`Spinach` 23, `Courgettes` 21).

**The conclusion is the useful part.** The app's own validator — fiber-adjusted
Atwater, ±15 % with a 30 % high-fiber band, plus documented exemptions for
alcohol/acids/carbonates — is **more sophisticated than my ad-hoc screen**, and it
reports `foods 14148 (1 failing)`. It is not missing a hidden population of bad rows.

That is precisely `CLAUDE.md`'s warning demonstrated from the other direction:
**the wrong-food/wrong-form errors are Atwater-consistent by construction**, because
they are real numbers from a real food. No arithmetic check can find them, mine
included. **The 444 self-declared rows ARE the work list** — there is no cleverer
detector to build, only that list to work through.

## N16 · D14 proven end-to-end from the customer's seat, with the solver's own telemetry

The re-run of p004 produced the cleanest single demonstration in the campaign of the
silently-discarded profile field (D14). A coeliac with a hard 15-minute cook limit:

```
PUT /api/profile {"maxPrepMin": 15}      -> 200 OK,  response "maxPrepMin": null
GET /api/profile   (fresh re-read)       ->          "maxPrepMin": null
POST /api/plans/generate                 -> meta.poolCounts:
                                              { raw: 889, afterDiet: 202, afterPrep: 202 }
                                                                    ^^^^^^^^^^^^^^^^^^^^
                                              the prep filter removed NOTHING
```

Consequence: **11 of 21 dishes exceed the limit**, including `Jamaican Curry Goat` at
42 min, a 37-min stew and a 34-min roast. `prepTimeMin` **is recorded on every
recipe** — nothing was missing except the filter that was never armed. The customer's
verdict: *"It said yes and did nothing."*

This is the strongest evidence in the report for giving those six orphaned `Profile`
columns a write path, because the customer did everything right and the API confirmed
success twice.

## N17 · Being fair to the app on the snack shortage: it DOES report it, in a field nobody read

p004 wrote that the app *"computes this and never tells me in plain words"*, quoting
`"variety": {"snackEligible": 4, "weeklySnackSlots": 7}` alongside `"diagnosis": null`.

Checked, and the app is more honest than that reads. `mealSolver.js` `varietyOutlook`
computes `snackEligible`, `weeklySnackSlots` and `snackCapacity`, and when capacity
falls short it **already pushes a plain-English reason**:

```js
const snackEligible = eligibleRecipes(pool, "snack", new Map(), repeatCap).length;
const weeklySnackSlots = (mealConfig.snacks || 0) * windowDays;
const snackCapacity = snackEligible * repeatCap;
if (weeklySnackSlots > 0 && snackCapacity < weeklySnackSlots) {
  reasons.push(snackEligible === 0 ? … : …);
```

So the explanation exists — it lands in `meta.variety.notes`, not in
`meta.diagnosis`, which is where the customer (reasonably) looked. **This is a
discoverability problem, not a dishonesty one**, and it does not count against the
100 % honesty-on-miss figure: the warned slots and per-day miss lines were all
present. Recorded as: two fields both carry "why this plan is rough", and a customer
reading only `diagnosis` sees `null`.

## N18 · THE SHARPEST FINDING OF THE CAMPAIGN — the macro error lands hardest on the cohort already served worst

Earlier I established that the borrowed-macro errors run in both directions, so the
40.8 % compliance figure is **unsigned**. That is true in aggregate. But the direction
is **not random per customer — it tracks their diet**, because which bad row you eat
depends on what you are allowed to eat.

Exposure to the confirmed-bad rows, split by whether the row **overstates** calories
(the vegetable rows: `Potatoes`, `Tomatoes`, `Tinned Tomatos`, `Tomato Puree`,
`Carrots`) or **understates** protein (`Chicken Breast`):

| diet | personas | overstated-row slots | per persona | understated-row slots |
|---|---:|---:|---:|---:|
| **vegan** | 22 | **179** | **8.1** | **0** |
| none | 47 | 137 | 2.9 | 6 |
| mediterranean | 10 | 23 | 2.3 | 0 |
| halal | 3 | 14 | 4.7 | 0 |
| paleo | 6 | 11 | 1.8 | 0 |
| keto | 5 | 7 | 1.4 | 0 |
| kosher | 4 | 4 | 1.0 | 1 |

**Vegan customers carry 2.8× the per-persona exposure of an unrestricted customer to
systematically calorie-INFLATED rows, and zero exposure to the compensating
understated one.** Of course they do: strip out meat, dairy, egg and fish and what is
left is potato, tomato and carrot — which are exactly the rows carrying bread, tomato
powder and dehydrated carrot.

**Put next to the compliance table, this is the finding that matters most:**

| | vegan | unrestricted |
|---|---|---|
| days inside tolerance | **13.3 %** | 53.7 % |
| per-persona exposure to inflated rows | **8.1 slots** | 2.9 slots |

**The cohort the app already serves worst is also the cohort whose displayed calories
are most systematically overstated.** So a vegan customer is wrong twice: their plan
misses tolerance four times as often, and on the days it *appears* to land, the real
food on the plate is materially less than the screen claims.

p073 — vegan, 71, coeliac, nut- and soy-free — measured their own day and found it:

> *"my day displays as 1,264 kcal / 51 g protein but the food I would actually cook…
> is about 470 kcal and under 10 g protein. Following this plan means eating a
> starvation day at 71 and believing I hit my target."*

**This sets the repair order inside D3: fix the vegetable rows first.** They are the
highest-frequency rows (`Potatoes` 111 slots, `Tomato Puree` 102, `Carrots` 92,
`Tinned Tomatos` 53) *and* they concentrate on the most vulnerable cohort.

## N19 · The impossible tier: "honest" by my measure, still not actionable for the customer

p073's configuration is genuinely unsatisfiable — vegan with soy, gluten, peanut,
tree nut, sesame and legumes all excluded, against a 181 g protein target on 1,512
kcal. My Phase-2 grader scored the impossible tier **100 % honest** because every slot
carried a warning and the per-day miss lines were present. The customer agrees the
app never lied — and still says the honesty did not help:

> *"It reports the shortfall slot by slot but never tells me at the day level that my
> restrictions and this target are incompatible, or offers me the choice."*

That is a fair distinction and it qualifies the 100 % without overturning it: the app
**reports symptoms accurately** (this slot missed, by this much) but does not
**diagnose the configuration** (your walls plus this protein target cannot coexist —
here is what you could relax). `diagnoseFromResult` already classifies a binding
constraint; the gap is that it is not raised to "your setup is impossible" when the
protein floor is unreachable at any portion size.

Worth stating plainly: **100 % honesty-on-miss is a real achievement and it is not
the same thing as being useful when the answer is "no".**

## CLAIMS I COULD NOT REPRODUCE — refuted, and not going in the report as defects

A campaign that only ever accumulates findings is not measuring, it is advocating.
These customer claims were checked and did **not** survive.

| claim | customer | verdict |
|---|---|---|
| *"The alternates arrive with no dish name at all — no name, cuisine, prep time or cost."* | p064 | **REFUTED.** `POST /:planId/slots/:slotId/alternates` explicitly maps a name onto every entry: `alternates.map((a) => ({ ...a, recipeName: nameById.get(a.recipeId) \|\| "?" }))`. Five other customers quoted `recipeName` from that endpoint by name (*"Chicken with saffron, raisins & pine nuts", matchPct 99*). p064 was most likely reading a nested object or the legacy swap surface. Not a defect. |
| *"My shopping list omits the salmon and the chicken — 2 of my 3 main meals."* | p004 | **REFUTED.** Direct row comparison of that plan's 57 grocery items against all 28 slots' ingredients: **0 omitted, 0 extra.** What was real was the *scope* — the list covers the whole `Plan` row (a week) for a customer who asked for one day, which is why it looked full of food they had not ordered. |
| *"Coconut Milk is a tree-nut leak."* | p204 | **NOT A LEAK** — a documented, deliberate clinical exception that my own independently-authored matcher also makes. Recorded as a **disclosure** gap instead (N3). |
| *"Beef jerky / chicken stock / mustard break my soy and gluten walls."* | p040, p019, p108, p126 | **NOT LEAKS** — inference about composite foods, no banned ingredient named. Recorded as the structural blind spot D4, which is a real and serious finding in its own right. |
| garbled em-dashes in API responses | p146, p190, p153 | **REFUTED by the customers themselves** — all three traced it to their own console's cp1252 decoding and declined to file it. Worth noting as evidence the interviews were self-policing. |
| *"Stored warning text is double-encoded, so the message I read is garbled mid-sentence"* — explicitly argued as a **stored** defect, not a terminal one, on the reasoning that a freshly-written warning was clean | p208 | **REFUTED at the database.** Of **1,213** stored `PlanSlot.warning` values, **0** contain the mojibake sequence `â€”` and **871** contain a proper em-dash `—`. `Recipe.description`/`steps` and `Food.dataQuality`: **0** mojibake rows each. The stored text is clean UTF-8. This is the same console-decoding illusion three other customers diagnosed correctly and dismissed; p208 was the one who misattributed it. **Four customers saw it, three got it right — and the database settles it.** |
| *"The regenerated cod slot's macros do not match its own printed ingredients… the slot claims 1,758 kcal and 284 g carb"* — asserted for **two** slots | p153 | **REFUTED, and this one mattered enough to check immediately** because it contradicts the campaign's own "0.0 kcal drift" finding. Recomputed all four of that persona's stored slots against the sum of their own ingredient rows: **drift 0.0 kcal and 0.0 g carb on every one**, including both disputed slots (1,758.1 = 1,758.1 and 2,446.7 = 2,446.7). The likely cause of the customer's discrepancy is computing from the recipe's **unscaled `baseGrams`** rather than the slot's scaled grams — the slots carry `proteinScale`/`sidesScale` multipliers. **The engine's arithmetic remains sound; 0 drift across 250 personas stands.** |

Partly confirmed, needs the owner's judgement rather than mine:

- *"The listed cost is the unscaled per-serving price, but my portions run 1.32× to 2×, so the day looks cheaper than it is."* (p064) — `Recipe.costPerServing` is a **static column**, so a slot scaled to `proteinScale: 2` does display an unscaled figure, while the grocery list is built from actual grams and therefore does scale. That is consistent with p040 seeing **two cost figures that disagree ~2×** ($33.76 summed per-recipe vs $16.53 on the list). Real inconsistency; which number is "right" is a product decision.
- *"`bodyFatPct: 0` is not a thing that exists."* (p064) — the schema comment says `0 = unknown (Katch-McArdle/Cunningham auto-hide)`, so 0 is the app's **sentinel for unknown**, working as designed internally. But it is served to the customer as a flat `0`, which reads as a measurement of zero body fat. A sentinel leaking into the UI as data.

## Cross-cutting corroboration counts (for the final report)

| finding | independent customers who hit it |
|---|---|
| `PUT …/apply` 400 "a slot needs at least one ingredient" on the app's own payload | 6 (p019, p040, p063, p108, p126, p190, p033) |
| `"edit src/lib/groceryPrices.js to correct"` shown to the customer | 4 (p005, p040, p126, p190) |
| `groceryList: null` on the plan, needs a separate call nobody would know to make | 5 (p019, p084, p108, p164, p126) |
| composite foods carry no allergen data (jerky / stock / mustard) | 4 (p019, p040, p108, p126) |
| snack repetition / empty snack pool | 7 (see N1) |
| gain-weight goal answered with a deficit | 4 (p040, p063, p084, + fleet-wide 50/50) |
| borrowed macros on a served ingredient | 4 (p040, p108, p126, p190) |
