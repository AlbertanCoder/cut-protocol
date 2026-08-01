# THE FLEET — 275 strangers walked into your app

**Run** `qa-fleet-20260729-2032` · **HEAD** `0d3eaa5` (branch `fix/audit-remediation`)
**250 scripted customers · all 25 deep-dive interviews completed · 20-persona brain cohort**
**Money: Phase 2 $0.00 verified · Phase 3 $0.053274 of a $5.00 cap**
**Report only. No product code, config, schema, test or doc outside this run's home was touched.**

---

## 1. The verdict

**These customers would not be happy yet — but the reason is narrow, and the thing
that matters most is nearly right.**

Take the safety question first, because it is the one that can hurt somebody.
**Every clinical allergen wall held.** Across 250 customers and 640 planned days,
re-derived by my own queries against raw `Food` rows rather than by asking the app
what it thought — gluten, peanut, tree nut, shellfish, fish, dairy, egg, soy and
sesame produced **zero leaks**. For coeliacs and people with anaphylaxis-capable
allergies, the exclusion gate did its job every single time it was given a term it
recognised.

The leaks that did happen — **37 ingredient hits across 16 customers** — are two
distinct bugs, and both live in how a wall is matched rather than in the solver.

**Class 1 (D1): a wall the customer TYPED never resolves.** Type "pork" and the app
blocks the literal word "pork", then serves you bacon, pepperoni, chorizo and lard.
12 of the 46 customers who typed "pork" were served pork. Not one of them was on a
`halal` or `kosher` diet setting — those customers were protected, because that path
works. It is the free-text box that quietly does nothing.

**Class 2 (D1b): the wall resolves, but the food's NAME hides what it is.** `nightshades`
matches correctly — and `Perogies, boiled` are potato dumplings whose name never says
potato, and `Green Pepper` / `Red Pepper` are capsicum rows in `fruit-veg`. 3 of the 23
customers who declared a nightshade wall were served one.

**This second class is the more uncomfortable finding, because I missed it too.** My
250 scripted customers and my own independent SQL audit both pronounced the
nightshade walls clean. It surfaced only when an interviewed customer was *offered*
a dish called "…& Perogies", recognised it as potato, and refused it. Chasing that
one refusal found five other customers already eating it. **A name-matching safety
gate cannot be validated by another name-matching safety gate** — which is the real
lesson of the night, and the reason `Food.allergenTags` being NULL on all 14,148
rows (D4) matters more than it looks.

Two other findings are as serious as the leaks, and neither is about the solver.

**Every customer trying to gain weight was put on a calorie deficit — 50 out of
50.** `targetKcal` is derived as `TDEE − rate × 500` with no reference to which way
the goal points, so a man who says "I am 124.6 kg and I want 134.4 kg" is
prescribed a 750 kcal/day cut. Nothing warns him. Two customers worked this out
for themselves from the numbers on screen.

**And two thirds of the food served — 1,728 of 2,594 filled slots — contains at
least one ingredient row that says, in its own data, that its macros belong to a
different food.** 444 rows carry that self-declaration; twelve of them are in
heavy rotation (Cucumber in 357 slots, Russet Potato 264, "flax eggs" 153, which
carries egg-white's protein verbatim inside a recipe called *"Classic Eggs"* that
contains no eggs).

Now the number the owner will feel most, with the caveat it needs. **Only 40.8 % of
planned days landed inside the app's own macro tolerance** (261 of 640; 95 % CI
37.0–44.6 %). This is not a measurement dispute: my arithmetic reproduces the app's
stored slot totals to **0.0 kcal drift on every day I checked**. But it is not
trustworthy in the other direction either — **the app and I read the same food
table, so where a row carries the wrong food's macros we are both wrong the same
way — and per row the error runs in **both** directions (`Carrots` carries dehydrated
carrot at 8× the calories; `Chicken Breast` carries breaded tenders at half the
protein). So the 40.8 % is not merely uncertain, it is **unsigned**. Fix the food
table before believing any macro percentage, including every one in this report.

**And the error lands hardest on the customers already served worst.** The direction is
not random per person — it tracks their diet, because which bad row you eat depends on
what you are allowed to eat. Strip out meat, dairy, egg and fish and what remains is
potato, tomato and carrot, which are precisely the rows carrying *bread*, *tomato
powder* and *dehydrated carrot*:

| | vegan | unrestricted |
|---|---|---|
| days inside tolerance | **13.3 %** | 53.7 % |
| per-persona slots containing a calorie-**inflated** row | **8.1** | 2.9 |
| slots containing the compensating **understated** row | **0** | 6 |

So a vegan customer is wrong twice: their plan misses tolerance four times as often,
and on the days it *appears* to land, the real food is materially less than the screen
claims. p073 — vegan, 71, coeliac, nut- and soy-free — worked their own day out:
*"my day displays as 1,264 kcal / 51 g protein but the food I would actually cook is
about 470 kcal and under 10 g. Following this plan means eating a starvation day at 71
and believing I hit my target."* **This sets the repair order: fix the vegetable rows
first.**

What the app does do, relentlessly, is tell the truth about missing.
**On the generate path, honesty-on-miss was 100 %: 379 of 379 out-of-band days
carried a warning, a per-day miss line, or a diagnosis naming what bound the
solve.** Zero silent target misses in 250 customers. On the constitution's own terms
— *"solver declares unsolvable + why; silent target misses are forbidden"* — the
generate path passes cleanly, and customers noticed and valued it unprompted.

There is exactly one hole, and a customer found it: **applying a swap can silently
delete the slot's warning** (D9), because that one field is copied from the client
instead of recomputed. It is a one-line fix on the app's most valuable behaviour.

So: is it ready for you and your girlfriend to live on? **Nearly — with three
conditions.** Tick your allergies in the checkboxes rather than typing them; do not
use it to gain weight; and treat its protein numbers as approximate until the food
table is repaired. Under those conditions — mainstream diet, one or two ticked
allergens, a day at a time — this is where the app is genuinely good: 55.7 % of
single days in band, sub-second responses, honest warnings, and a working shopping
list with real prices.

**Do not hand it to a stranger yet.** A stranger types "no pork", asks for a week,
wants to bulk, and has no way to know which of those three the app quietly ignores.

---

## 2. The scoreboard

### Safety — first, because it outranks everything

| | |
|---|---|
| **Confirmed ingredient-surface leaks** | **37 hits across 16 of 250 customers** |
| **Clinical-allergen leaks** (gluten, peanut, tree nut, shellfish, fish, dairy, egg, soy, sesame) | **0** |
| Leak class 1 — typed term never resolves (**D1**) | `pork` 31 hits / 12 customers · `beef` 1 hit / 1 customer |
| Leak class 2 — term resolves, food name hides it (**D1b**) | `nightshades` 5 hits / **3** customers (of 23 who declared it) — *revised down after the owner corrected the `Pepper` row; see below* |
| Customers with a completely clean plan | **234 / 250 = 93.6 %** |
| False positives in my own matcher, found and suppressed | 3 (see §3, defect 0) |
| **Leak class my own matcher also missed** | **D1b — found only because a customer read a dish name** |
| Dish-name advisories (not leaks) | recorded separately, never counted as safety failures |

**The second leak class was found by an interviewed customer, not by the automated
fleet, and my matcher had the same blind spot the app does.** That is worth stating
plainly: 250 scripted customers and my own independent SQL audit both reported the
nightshade walls clean. One agent looked at the word *"Perogies"* on an offered
alternate and thought *"those are potato dumplings"* — and it was right. Everything
in D1b below flows from that one human-shaped observation.

Every leak was found by transitively resolving **every ingredient of every shipped
slot** to its raw `Food` row and testing the real food name — not by reading the
app's warnings, which were never consulted as evidence.

### Everything else

| Measure | Result |
|---|---|
| Customers who reached a plan | **250 / 250** — zero 4xx, zero 5xx, zero hangs |
| Days inside the app's own tolerance | **40.8 %** (261/640; CI 37.0–44.6) |
| Days served with **zero food** | **16** |
| **Honesty on a miss (generate path)** | **100 %** (379/379) — no silent target misses |
| Honesty on a miss (swap path) | **hole found** — the warning is copied from the client, not recomputed (D9) |
| Stored-vs-recomputed macro drift | **0 days** — the app's arithmetic is sound |
| Impossible-tier honest refusals | **28 / 28 = 100 %** · 0 fake confident plans |
| Latency | **p50 377 ms · p95 806 ms · max 1,047 ms** |
| Illegal inputs answered with a named field error | **7 / 7** |
| Convergence (1st half 35.1 % vs 2nd 45.7 %) | CIs overlap — **rates are stable** |
| Grocery list | **15/15 returned 200** with `totalEstimatedCostCad` + a coverage note |

### Where it does badly — the shape of the failure

Macro compliance falls apart along two axes, and both point at the same cause:

| Walls stacked | days in band | | Diet | days in band |
|---|---|---|---|---|
| 1 wall | **53.5 %** | | none | **53.7 %** |
| 2 walls | 44.8 % | | vegetarian | 50.8 % |
| 3 walls | 38.7 % | | mediterranean | 44.0 % |
| 5 walls | 23.4 % | | keto | 33.3 % |
| 6 walls | **5.3 %** | | paleo | 32.0 % |
| 8–9 walls | **0 %** | | **vegan** | **13.3 %** |

Worst individual walls: **tree nut 16.5 %**, sesame 23.5 %, dairy 29.7 %.
And **a week is much harder than a day: 34.7 % vs 55.7 %** — seven days must all
land, and the variety cap forces progressively worse fits.

---

## 3. Top defects, ranked severity × frequency

Each is reproducible from a saved payload in this run's home, and localized
read-only to a symbol where the evidence allows.

### D1 · P0 · A typed exclusion does not expand to its food family
**32 hits · 13 customers · `POST /api/plans/generate`**

The single highest-value fix of the night. `excludedFoods` accepts free text, and
when a term does not resolve in the taxonomy the gate degrades to a **bare
substring match on the food name** — no family expansion at all.

Proven by direct probe of the app's own resolver:

| typed term | `resolveTaxonomyTerm` | result on real `Food` rows |
|---|---|---|
| `"pork"` | **NULL** | blocks "Pork tenderloin"; **ships Bacon, Chorizo, Lard, Pepperoni** |
| `"beef"` | **NULL** | **ships "Sirloin steak, cooked, lean"** (blocks only names containing "beef") |
| `"cilantro"` | **NULL** | **ships "Coriander Leaves"** — the same plant |
| `"red meat"` | `red meat` | blocks all of them correctly |
| `"pork allergy"` | `red meat` | blocks all of them correctly |

So the taxonomy is **right** and its data is **good** — the family lists already
contain bacon, chorizo, pepperoni, lard, sirloin. The failure is purely at term
resolution: `ALLERGEN_TAXONOMY['red meat'].synonyms` carries `"pork allergy"` and
`"beef allergy"` but **not the bare words a human types**, and there is no
`cilantro` row at all.

- **Localization:** `backend/src/lib/allergenTaxonomy.js` → `resolveTaxonomyTerm` and the `synonyms` arrays of `red meat` (+ a missing cilantro/coriander-leaf row); consumed by `backend/src/lib/exclusionGate.js` → `explainFoodExclusion` / `isExcluded`.
- **Evidence:** `defects.json` (13 leak records with food id, gram weight, slot id, recipe name) · repro payloads `raw/p036.json`, `raw/p189.json`, `raw/p230.json`, `raw/p070.json`.
- **Worst single case:** p189 — walls `fish, pork, dairy` — served **Chorizo, Bacon, Lard and Pepperoni** in one week.
- **Why it is P0 and not cosmetic:** the same mechanism governs every term outside the ten-checkbox picker. `nightshades` and `legumes` happen to resolve; `pork`, `beef` and `cilantro` do not. A user cannot tell which is which, and the UI gives no signal that a term was understood.

### D1b · P0 · The second leak class: the wall resolves, but the food's NAME hides what it is
**5 hits · 3 of the 23 customers who declared a nightshade wall · found by a customer, missed by the automated fleet**

D1 is a term that never resolves. **This is the opposite failure and needs its own
fix:** `resolveTaxonomyTerm("nightshades")` resolves perfectly, the family keyword
list is applied — and food still gets through, because matching happens on a
**name**, and some names do not contain the word.

**36 recipes pass a `nightshades` wall while containing an unambiguous nightshade.**
The offending ingredient rows, each verified by category and calorie density:

| ingredient row | what it actually is | recipes affected |
|---|---|---|
| ~~`Pepper`~~ | ~~fresh capsicum~~ — **I got this wrong, see the correction below** | — |
| `Red Pepper` | `fruit-veg`, 29 kcal/100 g, used at ~1.25 g — crushed red pepper / cayenne flakes, which **are** *Capsicum* | 7 |
| `Green Pepper` | `fruit-veg`, 21 kcal/100 g, up to 28 g in one dish — capsicum | 3 |
| `Perogies, boiled` | `pantry`, 200 kcal — **potato** dumplings; the name never says potato | 2 |

> #### Correction — the owner was right about `Pepper` and I was not
>
> I originally listed `Pepper` here as a fresh capsicum on the strength of its
> `fruit-veg` category and 27 kcal/100 g, and counted 5 hits across 2 further
> customers. The owner's `foodOverrides.json` reclassifies that row as **black
> peppercorn** (`pantry`, 251 kcal), noting *"the row now denotes what recipes mean."*
>
> The gram amounts settle it decisively, and they are not on my side: `Pepper` is used
> in **81 recipes at a median of 0.25 g** (min 0.1 g, and the 0.125 g entries in
> `Arepa Pabellón` and `Beef and Mustard Pie` are seasoning by any reading). That is
> a spice, not a vegetable. The old row's *banana-pepper* macros were the error; the
> ingredient was always peppercorn.
>
> **So 5 of my 10 D1b hits were false positives, and customers p088 and p170 are
> clean.** D1b is revised to **5 hits across 3 customers** (p042, p111, p183) and the
> campaign's total to **37 hits / 16 customers, 93.6 % clean**.
>
> `Red Pepper` (median 1.25 g) and `Green Pepper` (median 1.25 g, but **28 g** in
> `Szechuan Beef`) survive the same test differently: crushed red pepper and cayenne
> flakes are *Capsicum annuum* and **are** nightshades however small the dose, and a
> 28 g green pepper is plainly a vegetable. Those rows still need the treatment
> `Pepper` just got — they carry vegetable macros in `fruit-veg` while being used at
> spice weights, so they are wrong on **both** counts.

Customers actually served one, with a nightshade wall on file:

```
p042  Red Pepper + Green Pepper   in "kabse"
p088  Pepper                      in "Mango chow"
p111  Perogies, boiled            in "Grilled Chicken Breast & Perogies"
p170  Pepper                      in "Chicken Congee"
p183  Pepper ×2 + Green Pepper    in "Shrimp Chow Fun", "Szechuan Beef"
```

**And the taxonomy's reasoning was defensible — it is the data that betrays it.**
`allergenTaxonomy.js` says so in its own note: *"Black pepper is not a nightshade
either, which is why bare 'pepper' is absent and only the capsicum forms are
listed."* That is the right call in the abstract. It is the wrong call against a
corpus that contains rows literally named `Pepper`, `Green Pepper` and `Red Pepper`
which are all fresh capsicums in `fruit-veg`.

**The fix is not to add bare "pepper" as a keyword** — that would start blocking
peppercorns and every recipe containing them. It is to **disambiguate on
`Food.category`**, which is already sitting in the row: a food named "Pepper" in
`fruit-veg` at 27 kcal is a capsicum; in `spices` at 250+ kcal it is a peppercorn.
`Perogies` needs the keyword the gluten row already has (`pierogi`/`perogi`) added
to the nightshade family too.

- **Localization:** `backend/src/lib/allergenTaxonomy.js` → `ALLERGEN_TAXONOMY['nightshades'].nameKeywords`, and the name-only matching in `backend/src/lib/exclusionGate.js`. `FOOD_GATE_SELECT` already fetches `category` — the disambiguator is available and unused.
- **Evidence:** `nightshade-leaks.json` (all 10 hits with recipe, slot and ingredient), `cards/card-p188.json`.
- **How it surfaced:** the customer was *offered* `Grilled Chicken Breast & Perogies` at `matchPct 99` as a compliant swap and refused it. Chasing that offer found 5 other customers who had already been **served** one.

### D2 · P0 · Every customer trying to GAIN weight is put on a calorie deficit
**50 of 50 affected · 20 % of the fleet · target derivation**

The app has **no gain direction at all.** `targetKcal` is derived as
`TDEE − rate × 500` with no reference to whether the goal weight is above or below
the current weight, and `RATE_OPTIONS` are all loss rates. So a customer who says
"I weigh 124.6 kg and I want to reach 134.4 kg" is prescribed a **deficit**.

Verified across the whole fleet: of the **50 personas whose `goalWeightKg` exceeds
their `startWeightKg`, all 50** received `targetKcal` below their computed TDEE.

| persona | start → goal | rate | TDEE | target | prescribed |
|---|---|---|---|---|---|
| p006 | 66.7 → **73.3** kg | 1.5 | 2,242 | 1,492 | **−750 kcal/day** |
| p019 | 64.4 → 64.5 kg | 1.5 | 3,358 | 2,608 | **−750 kcal/day** |
| p063 | 124.6 → **134.4** kg | 2.0 | — | 2,667 | a deficit for a 275 lb man |
| p033 | 57 → **65.1** kg | 0.5 | 2,522 | 2,272 | −250 kcal/day |
| p010 | 122.2 → **134.8** kg | 0.25 | 3,128 | 3,003 | −125 kcal/day |

Three separate interviewed customers caught this unaided:

> *"I told it I am going UP from 124.6 kg to 134.4 kg at 2 lb/week and it handed me
> a number that is a deficit for a 275 lb man training five times a week — it looks
> like it subtracted 1,000 kcal/day instead of adding it."*

> *"on this plan I lose roughly 1.25 lb/week while trying to gain 1.5 lb/week"* —
> with the arithmetic worked out from the app's own published multipliers.

**And the worst case is a safety case.** Persona p084 is 19, 46.7 kg at 160 cm —
**BMI 18.2, already underweight** — and asked to *gain* 2 lb/week. The app set
`targetKcal: 1200`: the female safety floor, **below her own BMR**, a deficit. The
day then delivered 1,282 kcal. Her verdict:

> *"It told an underweight 19-year-old asking to gain 2 lb a week to eat 1200
> calories a day, and no amount of good ingredient work survives getting that one
> number backwards."*

Nothing warns that the goal direction contradicts the rate. The lean-bulk and
gaining-recomp customer cannot be served at all, and is not told so — and for an
underweight customer the app actively prescribes the opposite of what was asked.

- **Localization:** the rate → deficit step in `backend/src/lib/profileTarget.js` / `adaptiveTarget.js` `resolveAppliedTarget`, against `RATE_OPTIONS` in `bmrEngine.js` (all positive loss rates) and the absence of any goal-direction term.
- **Cheapest honest interim fix:** refuse, don't guess — if `goalWeightKg > startWeightKg`, block the deficit and say the app only does cuts yet. Silently reversing a customer's stated direction is the worst of the options.

### D3 · P0 · Two thirds of served slots contain a food carrying another food's macros
**1,728 of 2,594 filled fleet slots = 66.6 %**

`CLAUDE.md` already warns that food rows carry other foods' macros verbatim. This
campaign measured, for the first time, **how far that reaches a customer's plate**,
and the answer is most of it.

**444 `Food` rows** self-declare the problem in their own `dataQuality` string.
**12 of them appear in fleet plans**, at very high frequency:

| food row | fleet slots it reached |
|---|---|
| Cucumber | 357 |
| Russet Potato | 264 |
| Parsley | 179 |
| Egg White | 166 |
| **flax eggs** | 153 |
| Potatoes / Pepper / White Fish / Thyme / Carrots / Lemon / Greek Yogurt | 89–123 each |

The clearest single case, found by a customer unaided:

```
recipe "Classic Eggs & Broccoli with Rice"
  ingredients: White rice, cooked | Broccoli | Olive Oil | flax eggs   ← no eggs

food "flax eggs"  kcal 55  protein 10.7 g/100 g
  dataQuality: "…carried fdcId 747997 ("Eggs, Grade A, Large, egg white"),
  whose description does not denote this food; this row's macros are that
  record's values verbatim and are therefore NOT this food's numbers"
```

A real flax egg is ~1.3 g protein per 45 g. The customer's meal was credited
**~36.8 g of protein** for 300 g of flax slurry; the true figure is nearer 8 g.
The customer's own words: *"That meal's protein is fictional, and the app knows
it."* They also, correctly, objected that a dish named "Classic Eggs" contains no
eggs while their profile excludes nothing and asks for no egg replacer.

**The clearest proof of consequence — and a customer found it from the outside.**
Persona p108 read a dish and simply did the arithmetic in their head:

> *"It claims 1,121 calories and 51 g of protein out of potatoes, onion, thyme, a
> spoon of oil and some stock. Potatoes do not contain that. If I cannot trust the
> numbers I cannot trust the plan."*

They were exactly right, and here is why:

```
recipe "Boulangère Potatoes"   cached: 2,240 kcal · 101.9 g protein
  110 g   Onion            40 kcal/100g   →    44 kcal   P 1.2
   50 g   Thyme           101 kcal/100g   →    51 kcal   P 2.8   ← borrowed macros
   14 g   Olive Oil       900 kcal/100g   →   123 kcal   P 0.0
  750 g   Potatoes        266 kcal/100g   → 1,995 kcal   P 93.8  ← BREAD's macros
  213 g   Vegetable Stock  13 kcal/100g   →    28 kcal   P 4.2   ← borrowed macros
```

The `Potatoes` row carries **`fdcId 167943 "Bread, …"`** — 266 kcal and 12.5 g
protein per 100 g. Real potatoes are ~77 kcal and ~2 g. So 750 g of potatoes is
credited **1,995 kcal and 94 g of protein** instead of roughly 578 kcal and 15 g.
Thyme and Vegetable Stock in the same dish are borrowing too.

And note what this proves about the engine: **the cached recipe total agrees with
the ingredient sum to the decimal.** The arithmetic is flawless. The inputs are
wrong. This is `CLAUDE.md`'s own warning — *"Atwater consistency is not a
correctness warrant… real numbers, just the wrong food's"* — demonstrated end to
end, with a paying customer noticing.

### Not all 444 are wrong — and the errors run in BOTH directions

**Earlier in this campaign I wrote that the bias inflates calories and that true
compliance is therefore "probably lower than 40.8 %". That was unsupported, and the
full picture refutes it.** Pulling the borrowed-from record for all 14 shipped rows
splits them into three very different groups:

| group | rows | actually wrong? |
|---|---|---|
| **Benign** — the borrowed record is the same food | `Egg White` ← *"egg white"* · `Parsley` ← *"Parsley, fresh"* · `Thyme` ← *"Thyme, fresh"* · `Cucumber` ← *"Cucumber, peeled, raw"* · `Russet Potato` ← *"Potatoes, Russet, baked"* | **No.** The flag fired on a naming mismatch, not a data error. `Egg White` borrowing egg white's macros is simply correct. |
| **Wrong FORM** — right food, wrong state | `Carrots` ← *"Carrot, **dehydrated**"* (341 kcal vs ~41 fresh — **8×**) · `Lemon` ← *"Lemon juice **from concentrate**"* · `Greek Yogurt` ← *"Greek, **Blueberry**, CHOBANI"* | **Yes, badly.** |
| **Wrong FOOD** | `Potatoes` ← *"**Bread**, potato"* · `Chicken Breast` ← *"tenders, **breaded**"* · `Tuna` ← *"Fish, **tuna salad**"* (mayo) · `flax eggs` ← *"egg white"* · `Pepper` ← *"Pepper, **banana**"* · `White Fish` ← *"Fish, **sucker**"* | **Yes.** |

So **444 is an upper bound on the problem, not a count of wrong numbers** — and the
actionable subset is the wrong-form and wrong-food rows, which are already named and
self-labelled by the data itself.

**And the direction is not consistent, which is worse than a known bias:**

```
Carrots         341 kcal  vs ~41 fresh   ->  OVERSTATES calories ~8x
Potatoes        266 kcal  vs ~77         ->  OVERSTATES calories ~3.4x
Tuna            9.26 g F  vs ~1 g        ->  OVERSTATES fat
Chicken Breast  14.7 g P  vs ~31 g       ->  UNDERSTATES protein by half
```

A row that *understates* protein makes the solver **over-serve** that food to reach
the band, so the customer eats more real protein and fewer real calories than the
screen says. A row that *overstates* calories does the reverse. Persona p105 worked
their own day out by hand and landed on this exactly:

> *"the plan reads 4,253 kcal against my 4,483 target — a comfortable 5 % under.
> Corrected for the two bad rows I am actually eating ~3,538 kcal and ~330 g protein.
> That is a 716 kcal and 111 g protein error, and it silently puts me at a ~2.9 lb/week
> cut when I asked for 1.0. The screen would show me on target the whole way down."*

**So the honest statement is not "compliance is worse than 40.8 %" — it is that the
40.8 % is UNSIGNED.** The app and I read the same table, so where a row is wrong we
are both wrong identically, and per-row the error can go either way. `Potatoes` alone
appears in 108 fleet slots, `Carrots` in 91. **Repairing the wrong-food and wrong-form
rows is a precondition for any macro metric meaning anything — including every number
in this report.**

### D4 · P1 · Composite and processed foods cannot be checked for allergens at all
**Independently identified by 3 of the interviewed customers**

`Food.allergenTags` and `Food.mayContain` are **NULL on all 14,148 rows**, so a
wall can only ever be matched against a food's *name*. For whole foods that is
adequate. For processed multi-ingredient products it is not, and three customers
reached that conclusion separately without being prompted:

- a coeliac who also excludes soy, served 60 g/day of **beef jerky**: *"commercial beef jerky is soy-sauce marinated and standard soy sauce is wheat-brewed, so this single line item hits TWO of my four walls… the food row carries `allergenTags: null`, `mayContain: null`"*
- another coeliac on **Chicken Stock**: *"supermarket stock cubes and cartons routinely carry wheat and soy — as a coeliac this is the one line on the plan I would have to go and verify myself, and the app said nothing"*
- a third on **unqualified prepared mustard**, which routinely carries wheat as a bulking agent

**I did not count these as leaks** and they are not in the 32 — no banned
ingredient is *named*, and inferring a hidden ingredient is not evidence. But the
convergence is the finding: the app's protection is strong on whole foods and
structurally blind on packaged ones, and it does not tell the customer where that
line is. The taxonomy already documents this honestly for sulphites; the same
candour is owed on every composite row.

### D5 · P1 · The first plan saved to an account can be far worse than an immediate re-solve
**Observed directly by a customer; 16 zero-food days fleet-wide**

Persona p005 (76 F, keto, walls egg + pork) opened the plan waiting on her account
and found **19 of 21 slots empty and four blank days** — and the two filled slots
both served **55 g of vegetable oil**. She pressed generate once:

> *"It fixed everything in one click — the same plan went from 2 filled slots out
> of 21 to 21 out of 21, from 1,007 kcal for the week to 8,782… That is a relief
> and also the most damning thing I found: the app could clearly do this the whole
> time, so whatever it saved to my account first was simply broken, and a customer
> who did not think to press the button again would have concluded the product does
> not work."*

Her regenerated week then landed **7/7 days in tolerance** at 1,227–1,271 kcal
against a 1,263 target with 15–25 g carbs — genuinely good keto. Same profile,
same library, same instant. This makes D15 (non-monotonic regeneration) a
first-impression problem, not a curiosity.

### D6 · P1 · A condiment recipe is served as dinner, because 720 of 889 recipes carry no meal category
**`Recipe.mealCategory`**

The dish p005 was served twice in one day:

```
Achiote Oil (Aceite Achiotado) Recipe
  slotType: "meal"   mealCategory: null
  997 kcal · 0.5 g protein · 109 g fat
  steps: "…Strain the oil and store for up to 15 days at room temperature
          in a jar with a tight lid."
```

The guard exists — `mealCategory` has a `condiment_or_sauce` value — but **only 3
recipes in 889 are tagged with it, and 720 have `mealCategory: null`.** Nine
meal-eligible recipes carry <2 g protein at >300 kcal, including **Feteer
Meshaltet at 1,971 kcal / 0.8 g protein** and **Syrian Bread at 791 kcal**.

### D7 · P1 · Ingredient roles are wrong at scale, which is what produces the absurd portions
**652 of 1,884 oil ingredient rows (35 %) are labelled `role: "carb"`**

Customers independently reported `Extra Virgin Olive Oil` with `role: "carb"` and
`Chicken Stock` with `role: "protein"`. This is not cosmetic: `role` decides
whether an ingredient scales with `proteinScale` or `sidesScale`, so mislabelled
roles are the mechanism behind the portion pathologies customers kept quoting —

- *"Chicken with saffron, raisins & pine nuts"* scaled to **625 g chicken, 2 g pine nuts, 6 g raisins**
- *"Lakra me Mish Cabbage and Meat Stew"* — **13 g cabbage**, 250 g beef
- *"Grilled Portuguese sardines"* — **105 g of rosemary**
- 555 g of Greek yogurt as a *snack*; a 465 g yogurt dip as a 984 kcal *dinner*
- `proteinScale 2` / `sidesScale 0.5` — vegetables halved while protein doubled, so *"veg is the one thing that should not shrink"* when cutting

### D8 · P1 · One food row, three wrong answers — and the shopping list sends you home with the wrong food
**`Egg Plants` · found by a customer who could not have cooked their own lunch**

`Egg Plants` is this corpus's spelling of **aubergine**. `CLAUDE.md` notes it is
deliberately guarded in the allergen filter — and that guard works. Nothing else
about the row does:

```
Food "Egg Plants"
  category : "dairy-eggs"            ← it is a vegetable
  kcal 55 · protein 10.7 /100 g      ← egg WHITE's macros (real aubergine ≈25 kcal, 1 g)
  toPurchaseUnits("Egg Plants",100g) → { display: "2 eggs", approx: "≈50 g each" }
  egg-wall exclusion gate            → correctly SHIPS to an egg-avoidant user ✓
```

The customer's own words: *"My shopping list tells me to buy eggs instead of
aubergines, and files the vegetable under the protein aisle. If I shop from this
list I cannot make the dish at all — Tortang Talong IS grilled aubergine."*

The safety layer is the **only** one of the four that gets this row right. The
category, the macros and the purchase units are each independently wrong, and the
last of them breaks the shopping trip. Note the macros are the same borrowed
`fdcId 747997` egg-white record behind D3's `flax eggs` — one bad source record is
poisoning multiple rows.

- **Localization:** `Food` row `Egg Plants` (category + macros) and `backend/src/lib/purchaseUnits.js` → `toPurchaseUnits` name matching; the guard pattern that already exists in `dietaryFilter` is the model to copy.
- Same customer also found **`Lemon` double-counted** as two grocery lines (`Lemon 15 g` and `Lemon Juice 4 g`), each instructing "buy 1 lemon (~85 g each)".

### D9 · P1 · Applying a swap can silently DELETE the slot's honesty warning
**The one hole in the app's best feature**

A customer noticed something the automated fleet could not:

> *"Inconsistent honesty after the swap: two slots now hold the identical dish at
> the identical 279 kcal, but only one still carries the over-target warning — the
> one I swapped in went silent."*

The cause is one line. `rebuildSlotFromClient` **does not recompute the warning; it
copies whatever the client sent, and drops it otherwise**:

```js
warning: typeof incoming.warning === "string" ? incoming.warning : null,
```

Every other field on that path is rebuilt server-side and explicitly not trusted —
names come from the DB, macros are recomputed, grams are range-checked, pool
membership is re-verified. The warning is the sole exception. So a client that
applies an alternate without echoing the string back turns an out-of-tolerance slot
into a silently clean-looking one.

Two identical dishes at identical calories, one warned and one not, in the same
day. This is the **only** silent-miss mechanism the campaign found — Phase 2's
honesty-on-miss was a perfect 379/379 on the *generate* path — and it sits on the
swap path, where a dissatisfied customer is most likely to be.

- **Localization:** `backend/src/routes/plans.js` → `rebuildSlotFromClient`, the `warning:` assignment. It should be derived from the rebuilt slot against the day's target, exactly as the solver does, not accepted from the caller.

### D10 · P2 · The cuisine classifier puts 53 % of the library in one bucket
`cuisine: "western-comfort"` holds **472 of 889 recipes**, including **Seswaa**
(Botswanan), **Duck Confit** (French), **Gambas al ajillo** and **Arroz con gambas
y calamar** (Spanish), and **Cacik** (Turkish). One customer set cuisine
preferences to American and Indian and got **neither, once, in 21 meals**.

### D11 · P2 · `PUT …/slots/:id/apply` rejects the id it just handed you
**Hit independently by 3 customers**

Applying an alternate by its `recipeId` — the obvious call — returns
**400 `"a slot needs at least one ingredient"`**, an error describing something the
customer never sent. It only succeeds if the entire alternate object is posted
back. `rebuildSlotFromClient` requires a populated `ingredients` array and reports
its absence as the caller's malformed input.

- **Localization:** `backend/src/routes/plans.js` → `rebuildSlotFromClient`, the `ingredients.length === 0` throw.

### D12 · P1 · A near-empty week is written rather than refused
**3 customers · `POST /api/plans/generate`**

When the optional per-request filters collapse the pool, the app writes the plan
anyway. Persona p005 (keto, walls egg+pork, a prep cap): pool went
**889 → 26 after diet/allergy → 1 after the prep filter**, and the app wrote a
**21-slot week with 2 slots filled and five days at 0 kcal**.

It was scrupulously honest about it — every day carried a full miss line
(*"0 kcal vs a 1,263 target — 1,263 under…"*), `binding: "max-prep"`, `matchPct: 4`
— so this is **not** a dishonesty defect. But from the customer's seat a week of
empty days is a failure, and the honest diagnosis arrives *after* the write rather
than instead of it.

- **Localization:** `backend/src/routes/plans.js` `POST /generate` — `applyPrepFilter` / `applyFilterStack` produce `poolCounts.afterStack`; nothing gates on it before the per-week transaction runs.
- **Evidence:** `raw/p005.json`. 16 zero-food days fleet-wide.

### D13 · P1 · The brain burns the wall clock and delivers nothing
**11 of 20 brain-cohort customers · 703 seconds of customer waiting · see §6 for the full story**

Generates landing on an **exact integer multiple of the 35 s slot timeout** —
70,677 ms, 70,459 ms, 70,445 ms, 70,402 ms… — 703 seconds of customer waiting
across 11 personas, **one** billed model call in the entire cohort, and **nothing
persisted from it**.

### D14 · **P1** · Six preference columns exist in the schema with no way to save them
**Structural · demonstrated live by two customers · upgraded from P2 on their evidence**

**Two interviews proved this end to end, and one of them is decisive.** p051 sent
`excludedFoods` and `proteinPriorityMode` in the **same request**:

```
PUT /api/profile {"excludedFoods":[…], "proteinPriorityMode":true}   -> 200 OK
GET /api/profile   ->  excludedFoods:        SAVED
                       proteinPriorityMode:  still false     ← silently dropped
```

One field in a request persisted and the other vanished, with a 200 and no message.
`excludedFoods` is in `PROFILE_FIELDS`; `proteinPriorityMode` is not. Exactly what the
preflight read of that whitelist predicted, now observed from the customer's seat.

p004 did the same with the field that mattered most to them — a hard 15-minute cook
limit — and the solver's own telemetry confirms the consequence:

```
PUT /api/profile {"maxPrepMin": 15}   -> 200 OK, response "maxPrepMin": null
GET /api/profile (fresh)              ->          "maxPrepMin": null
POST /plans/generate  -> poolCounts { raw: 889, afterDiet: 202, afterPrep: 202 }
                                                              ^^^ filter removed NOTHING
```

**11 of their 21 dishes exceeded the limit**, including a 42-minute curry goat.
`prepTimeMin` is recorded on every recipe — nothing was missing but the filter that was
never armed. Their verdict: ***"It said yes and did nothing."***

That is why this is P1, not P2: a silent 200 on a field the customer deliberately set
is worse than a 400, because they walk away believing the app is holding a rule it
never recorded.

`Profile.maxPrepMin`, `budgetTier`, `allowBatch`, `maxComplexity`, `adaptiveTdee`
and `proteinPriorityMode` are all in `schema.prisma`, and the only writer anywhere
in `backend/src` is `routes/export.js`'s import path. None are in
`PROFILE_FIELDS`, so `PUT /api/profile` **silently discards them with a 200.**
The equivalent knobs exist only as per-request `filters`, so "I never cook longer
than 20 minutes" must be re-stated on every single generate and the column that
looks like it remembers stays `null`.

- **Localization:** `backend/src/routes/profile.js` → `PROFILE_FIELDS` (line ~18) vs `backend/prisma/schema.prisma` → `model Profile`.

### D15 · P2 · Regeneration is not monotonic, and a clean plan is not a stable promise
**6 of 15 in the 15 × 3 sub-sample**

Regenerating the same profile three times with no input change moved
days-in-band: p000 `1 → 2 → 2`, p017 `0 → 0 → 1`, p085 `0 → 1 → 0`,
p136 `5 → 6 → 5`. Worst swing 1 day. In the brain cohort, larger swings appeared
in both directions (p117 `4 → 2`, p191 `5 → 3`, p169 `3 → 5`).

More importantly, **leak counts were NOT stable across regenerations**. A customer
who regenerates can be handed a wall-breaking ingredient that the previous solve
did not contain. A single clean plan therefore does not certify the configuration.

### D16 · P2 · Developer output escaping into the product
A grocery-list price note read, verbatim, *"edit src/lib/groceryPrices.js to
correct"* — shown to the customer. This is precisely the class of bug
`routes/profile.js` already documents having fixed once for validation messages
(*"developer output that escaped into the product"*).

*(Additional customer-observed quality findings — a "single day" plan whose
breakfast requires a 2–3 day cure; the identical snack plate in both snack slots;
35 g of vegetables in a 2,589 kcal day; `proteinScale 2` / `sidesScale 0.5`
halving vegetables while doubling protein; two-step AI recipes reading "Cook the
shrimp." — are carried in the deep-dive cards in `cards/`.)*

### D17 · P1 · The entire snack library is 9 recipes, and it explains seven separate complaints
**`Recipe.slotType` — 8 rows `snack` + 1 `either`, out of 889**

This is the whole snack library:

```
Bacon & Eggs · Jerky & Pork Rinds Snack Plate · Greek Yogurt, Almonds & Berries
Pistachios & Jerky · Pepperoni & Pistachios Plate · Avocado Chips & Jerky
Tuna Cucumber Cracker Plate · Turkey & Swiss Roll-Ups · Greek Yogurt, Honey & Almonds
```

Every one is cured meat, dairy or nuts. Survival after the exclusion gate:

| wall set | snacks left |
|---|---|
| none | 9 / 9 |
| dairy | 5 / 9 |
| p108's five walls | 4 / 9 |
| **p164's five walls** | **1 / 9** |
| **vegan** | **0 / 9 — a vegan can never be served a snack** |

**One table, seven complaints I had been treating as separate bugs:**
*"both of my snack slots are the exact same dish"* (p019) · *"the same snack twice, $6.75 each"* (p040) · *"the keto snack pool looks two recipes deep"* (p033) · *"all three snacks are yogurt + almonds"* (p190) · *"effectively one recipe… nothing to swap to"* (p004) · *"the snack slot was blank"* (p108, p218, p073) · *"`{"alternates":[]}`"* (p164, p218).

**And it explains the D1 leak mechanically.** p164 walls pork+beef. Exactly one snack
survives their gate — `Pepperoni & Pistachios Plate` — and it survives *only because*
"pork"/"beef" fail to resolve (D1). So the pool looks 1 deep instead of 0, the solver
serves its single candidate, `alternates` is honestly empty, and regenerating serves it
again. **Fixing D1 alone converts this leak into the correct answer the app already
knows how to give:** *"No eligible snack recipe left for this slot."*

The app even computes the shortage — `varietyOutlook` emits `snackEligible: 4,
weeklySnackSlots: 7` and pushes a plain-English reason — but into
`meta.variety.notes`, not `meta.diagnosis`, which is where customers looked.

### D18 · P1 · ROOT CAUSE of "portions that are not food": `scalable` is 96 % unpopulated
**260 of 7,024 ingredient rows are marked fixed**

`RecipeIngredient.scalable`'s own comment states the intent: *"false = fixed (spices, a
single egg, etc.) — not scaled with the recipe multiplier."*

| | |
|---|---|
| all ingredient rows | 7,024 |
| marked `scalable: false` | **260 — 3.7 %** |
| herb / spice / seasoning rows | 813 |
| of those, `scalable: true` and therefore multiplied | **808 — 99.4 %** |

**And the library already carries impossible base grams before any multiplier:**
`300 g Basil Leaves` · `200 g Thyme` · `150 g Thyme` · `150 g Parsley`.

That is the complete explanation for every portion complaint in the campaign:
105 g rosemary · 60 g thyme · 100 g bay leaves (≈50 leaves) · 1.1 kg spring onions ·
19 g salt in one dish · 100 g parsley as garnish — and the mirror image, `sidesScale
0.5` shrinking *13 g of cabbage into a cabbage stew* while `proteinScale 2` doubles the
meat to 625 g.

**This is the third instance of the same pattern:** `allergenTags` 14,148/14,148 null,
`mealCategory` 720/889 null, `scalable` 6,764/7,024 unset. The mechanisms were designed
correctly and never populated. Cheap heuristic: default to fixed when `Food.category`
is `spices` or base grams are under ~15 g, and flag herb rows above ~30 g for review.

### D19 · P1 · Recipe instructions, measured
**Across all 889 recipes**

| defect in `Recipe.steps` | recipes | share |
|---|---:|---:|
| literal **`"step 1"` / `"step 2"`** placeholders shipped as instructions | **162** | **18.2 %** |
| scraped checkbox glyphs (`□`) as instruction lines | 13 | 1.5 % |
| entire method is **two sentences or fewer** | **262** | **29.5 %** |

This is why *"the meals are good"* scored lowest of the owner's five criteria in every
interview — it is measurable, not a matter of taste. Also found: `"Sear salmon as
above."` with no "above"; `"Optional: Sprinkle a couple of tablespoons on top"` of
nothing named; `"Cook the cottage cheese."`; `"Cook the turkey."` for pre-cooked deli
meat; a `Pan-Seared Salmon` whose ingredients contain **no cooking fat**; Duck Confit at
`prepTimeMin: 22` for a two-day cure; and a breakfast herring requiring *"Refrigerate
for 2 to 3 days before eating"* on a **single-day** plan.

**Three recipes carry a `description` that restricts when they may be served** —
`Perogies & Bacon`, `Bacon & Eggs`, `Avocado Chips & Jerky` all say **"Weekends
only."** — and the solver serves them on Wednesdays. The metadata is there and unread.

### D20 · P1 · Two thirds of a shopping list cannot be shopped
**Over the 433 distinct foods the fleet was actually served**

| | |
|---|---|
| foods carrying a purchase unit ("1 pepper", "1 dozen") | **144 — 33.3 %** |
| foods returning **raw grams only** | **289 — 66.7 %** |

The disclaimer on those 289 is honest and useless at the till: `"form":
"as-prepared (state unrecorded) — NOT a raw/dry purchase quantity"`. **`(state
unrecorded)` is the actual defect and it is one column** — the same missing `state`
that makes `Cannellini Beans` carry *dry* bean data inside a baked dish (D3).

Three served foods get a unit naming the wrong food: `Egg Plants → "2 eggs"`,
`flax eggs → "5 eggs"`, `Chickpea pasta, dry → "1 can (drained)"`. Plus `Lemon`
double-counted as two lines each saying "buy 1 lemon", water on the shopping list, and
meats filed under `other` while the `PROTEIN` aisle sits empty.

### D21 · P2 · Variety is capped per recipe, never per protein
**40 of 604 days (6.6 %) put the same primary protein in every single slot**

Measured by classifying each filled slot's ingredients: `p003` five slots **all fish**,
`p005` three slots all beef, `p054` five slots all plant on three separate days.
Customers: *"Saturday is beef, beef and beef… the app still scored that day 100 %
because its variety cap counts dish names, not what the dish is actually made of"*
(p005) · *"I would be eating fish or shellfish five times in one day, which no real
person does"* (p003) · *"two of three meals were the same cheap protein — 555 g of
cottage cheese in a single day"* (p188).

The display taxonomy already derives a primary protein; the variety ledger does not use it.

### D22 · P2 · Two compounding gaps on the swap path
**`alternates` re-rolls between calls, and there is no server surface for the engine's math**

D11 (apply rejects a bare `recipeId`) forces a re-fetch — and the re-fetch reshuffles
the list, so the dish a customer vetted is not the dish they get. p204 checked one
alternate against all five of their walls, was 400'd, re-fetched, and a **different**
dish landed on the plan: *"dangerous when I am vetting for allergens."* Fixing D11
closes this.

Separately, three customers tried to audit their own calorie number.
`/api/profile/engine`, `/api/engine`, `/api/profile/tdee` all **404**; `computeEnergy`
is imported only by `routes/profile.js` and only for the rate gate. Against the
constitution's *"Displayed numbers can reveal their formula and inputs"*, there is no
API surface that does. p131: *"I am asked to trust 2,296 with no visible math."*

### D0 · Not an app defect — my own instrument, recorded for honesty
Three of my 35 raw leak hits were **false positives** in my matcher: "paella"
fired on the ingredient row **"Paella Rice"** inside *Roast fennel and aubergine
paella*, a dish whose 15 ingredients contain no shellfish. Suppressed with the
rationale recorded in `stats.mjs`.

Separately and more seriously, my Phase-4 harness produced a **false report of a
cross-account data leak** — two concurrent agents shared a relative cookie-jar
filename, so one customer read another's plan. **There is no cross-account leak in
Cut Protocol**; `GET /plans/current` keys on `userId_startDate` with `req.userId`
and cannot return another user's row. Full write-up, blast radius and fix:
**`HARNESS-INCIDENT.md`**. Phase 2 and Phase 3 are unaffected — neither uses a
cookie file, and every grade was re-derived by querying the database by user id.

---

### The interviews — all 25 sit-down customers

Each of the 25 logged in over HTTP, read their plan meal by meal, checked their own
walls ingredient by ingredient, performed one realistic follow-up, and scored the
owner's five criteria. Every card was then re-verified against raw database rows for
schema, identity (the persona's own `targetKcal` and meal shape) and leak claims:
**25/25 passed.**

| | |
|---|---|
| **Satisfaction** | **median 3/10** · mean 3.0 · range 1–6 · distribution `1:3  2:5  3:7  4:9  6:1` |
| **Would recommend** | **1 of 25 (4 %)** |
| Macros actually in range | **4.0 / 10** |
| Works end to end | **5.2 / 10** |
| The meals are good | **2.8 / 10** ← lowest of the five, by a distance |
| Affordable / adjustable | **4.4 / 10** |
| Tasty | **3.7 / 10** |
| **Walls upheld** | **22 of 25** reported `allergenRespect.ok` · of the 3 that did not, **only 1 is a confirmed named leak** (p164's pepperoni); the others were a composite-food inference (D4) and the documented coconut exception (§gaps) |

By stratum — and the ordering is exactly what the fleet predicted:

| stratum | n | median | scores |
|---|---:|---:|---|
| EASY | 8 | **4** | 2, 2, 3, 4, 4, 4, 4, **6** |
| HARD | 10 | 3 | 1, 1, 1, 3, 3, 3, 3, 4, 4, 4 |
| BRAIN-COHORT | 3 | 3 | 3, 3, 4 |
| IMPOSSIBLE | 4 | **2** | 2, 2, 2, 4 |

**Three things stand out.**

**1. "The meals are good" is the lowest score, and it is not a matter of taste.**
Customers did not experience a broken app — "works end to end" scored 5.2 — they
experienced a working app serving food they would not eat. Measured: 18 % of recipes
ship `"step 1"` placeholders as instructions, 30 % have a method of two sentences or
fewer, 99.4 % of herb rows are scaled when they should be fixed (D18, D19). The
complaints follow: a condiment as dinner, 1.1 kg of spring onions, a yogurt dip as a
984 kcal dinner, 100 g of bay leaves, `"Cook the cottage cheese."`, and a week with
**no breakfast at all** that opened with cooking sherry at 7 a.m. for a postpartum
customer.

**2. Every single one of the 25 led their *delights* with the honesty.** Not the
speed, not the safety — the fact that it admits a miss. Twenty-five strangers who
never saw each other's plans:

> *"It admits when it failed instead of hiding it… I would rather be told."*
> *"I have never had a meal planner admit that."*
> *"It published the receipt for its own mistake."*
> *"I would rather be told the exact shortfall than be handed a number that flatters itself."*

**3. The one customer who would recommend it (6/10) is the shape of the app's
success.** p064 — paleo, no fish or dairy, two ticked walls, mainstream diet, a single
day: walls clean, 3,694 kcal against a 3,688 target, 275 g protein. That is precisely
the configuration §1 says the app is good at, and it is the only one of 25 that landed
there.

---

### Claims that did NOT survive verification — the other half of the method

A campaign that only ever accumulates findings is advocating, not measuring. Every
customer claim was checked against raw rows or source. **Seven did not survive, and
they are listed here rather than quietly dropped**, because the owner's ability to
trust the defect list depends on knowing what was thrown out.

| claim | who | verdict |
|---|---|---|
| *"The plan handed to me under my own login carries a different userId than my profile"* — i.e. a **cross-account data leak** | p005 (first run) | **REFUTED — and it was my own harness.** Two concurrent agents shared a relative cookie-jar filename. `GET /plans/current` keys on `userId_startDate` with `req.userId` and cannot return another user's row. Full write-up: `HARNESS-INCIDENT.md`. |
| *"Two slots' macros do not match their own printed ingredients"* (asserted for two slots) | p153 | **REFUTED, and checked first** because it contradicted the campaign's own "0.0 kcal drift" result. Recomputed all four of that persona's slots from their own ingredient rows: **drift 0.0 kcal and 0.0 g carb on every one**, including both disputed (1,758.1 = 1,758.1). Likely cause: computing from the recipe's unscaled `baseGrams` rather than the slot's scaled grams. **The engine's arithmetic stands.** |
| *"My shopping list omits the salmon and the chicken — 2 of my 3 main meals"* | p004 (first run) | **REFUTED.** Row-by-row comparison of that plan's 57 grocery items against all 28 slots: **0 omitted, 0 extra.** What was real was the *scope* — the list covers the whole `Plan` row for someone who asked for one day. |
| *"Stored warning text is double-encoded"* — argued explicitly as stored, not terminal | p208 | **REFUTED at the database.** Of **1,213** stored `PlanSlot.warning` values, **0** contain the mojibake sequence and **871** carry a proper em-dash; `Recipe` and `Food.dataQuality`: 0 each. Clean UTF-8. |
| garbled em-dashes in responses | p146, p190, p153 | **REFUTED by the customers themselves** — all three traced it to their own console's cp1252 decoding and declined to file it. Four customers saw this illusion; **three diagnosed it correctly.** |
| *"Coconut Milk is a tree-nut leak"* | p204 | **NOT A LEAK.** `allergenTaxonomy.js` documents the exception on the record (*"allergists and this corpus treat it as a fruit"*), and my independently-authored matcher makes the same call without consulting the app. Kept as a **disclosure** gap: a customer who ticks "tree nuts" and then reads `Contains: Tree Nuts` on the tin has no way to know the app made a deliberate exception. |
| *"The alternates arrive with no dish name at all"* | p064 | **REFUTED.** The endpoint explicitly maps one on: `alternates.map((a) => ({ ...a, recipeName: … }))`, and five other customers quoted `recipeName` by name. The accurate version of the complaint is D22 — **prep time, cost and difficulty** are genuinely absent, which is what a customer swapping to save time or money actually needs. |
| *"Beef jerky / chicken stock / mustard break my soy and gluten walls"* | p040, p019, p108, p126, p073, p051 | **NOT LEAKS** — inference about composite foods, no banned ingredient named, and not counted in the 42. Kept as **D4**, which is a serious finding in its own right: six customers independently reached the same conclusion about the same structural blind spot. |

Two more were **partly** confirmed and are the owner's judgement, not mine:

- **`Recipe.costPerServing` is a static column**, so a slot scaled to `proteinScale: 2` displays an unscaled price while the grocery list — built from actual grams — does scale. That is consistent with p040 seeing two cost figures disagree ~2× ($33.76 vs $16.53). Real inconsistency; which number is "right" is a product decision.
- **`bodyFatPct: 0` is the app's sentinel for "unknown"** (per the schema comment, it auto-hides Katch-McArdle/Cunningham) and works correctly internally — but it is served to the customer as a flat `0`, which reads as a measurement of zero body fat. A sentinel leaking into the UI as data.

**Why this matters more than the count.** The two most alarming claims of the night — a
cross-account data leak and an engine that contradicts its own arithmetic — were both
false, and both were caught by going back to raw rows instead of taking a confident,
richly-evidenced report at face value. Every quoted string in those cards was real;
only the attribution was wrong. **That is the characteristic failure mode of
agent-driven testing, and it is why nothing in §2 or §3 rests on an agent's word
alone.**

---

## 4. What customers loved

The good news is data too, and some of it is genuinely hard to build.

- **The honesty is the product's best feature, and customers said so unprompted.**
  Two separate interviewees led their *delights* with it:
  *"It told me when it failed instead of hiding it… I trust a planner that admits
  a miss."* 100 % honesty-on-miss across 379 missed days is a real achievement,
  and it is the constitution being obeyed rather than merely written down.
- **The clinical allergen gate is trustworthy.** 687 of 889 recipes correctly
  filtered out for a four-wall coeliac customer, and zero clinical leaks across
  250 customers. One interviewee: *"For a coeliac that is the whole ballgame and
  this app got it right."*
- **It is fast.** p50 377 ms, p95 806 ms, max 1.05 s for a full week solve, with
  zero failures in 250 runs plus 30 regenerations. Nobody waited.
- **The diagnosis names the real binding constraint.** Not "no plan found" but
  *"portion scaling moves a dish's calories, not its fat/carb ratio, so the pool's
  composition is what binds here"* — with a concrete suggestion. That is a
  genuinely superior error surface.
- **The macro arithmetic is exact.** 0.0 kcal drift between stored slot totals and
  independent recomputation from raw food rows, on every day checked.
- **Alternates and swaps work and are honest**, each labelled with its own match %
  and carrying its own warning where it does not fit; one customer's swap cleared
  the slot warning and persisted correctly on re-read.
- **Illegal input is handled like a product, not a stack trace:** 7/7 named the
  offending field in a sentence a person can act on, and the acknowledgement gates
  (unsafe rate, low goal weight) fired correctly and named *which* confirmation
  they wanted.

---

## 5. Product gaps — wishes with no API surface (kept separate from defects)

These are not bugs. They are things customers asked for that the app has no way to
hear, recorded from the persona cards.

| Gap | Customers affected |
|---|---|
| **Standing preferences cannot be saved** (prep time, budget, complexity, batch-cooking, protein priority) — per-request filters only | structural; every customer with a habit |
| **No client-settable calorie or protein target.** `targetKcal` is derived by design; `floorKcal` is a floor, not a target. A customer who "typed 4,500" or wants 1 g/lb protein cannot express it | 90 personas carried this wish |
| **`pescatarian` and `low-FODMAP` are not dietary styles** (9 exist) — the fleet had to express them as walls, which is a different promise | 25 personas |
| **No parent-managed or dependent flag.** `adultGate` refuses under-18 outright (correctly, and with excellent copy), but a parent managing a child's meals has nowhere to say so | 12 personas |
| **`mealPreferencesNote` is read by nothing.** A customer who types a 300-character allergy narrative into the one freeform box gets no constraint from it | robustness tier |
| **No pregnancy / breastfeeding / ED-history question.** `routes/profile.js:158-177` states this plainly and honestly — the app does not ask rather than pretending to have cleared anyone. Recorded as a gap the owner already knows about |  |
| **`shellfish` and `fish` are two independent toggles.** A customer who ticked only `fish` was offered Raw King Prawns. The app honoured exactly what was set, and the customer correctly declined to call it a leak — but recorded it as a trust trap: *"anyone who says 'no fish' will read Raw King Prawns as a violation and lose trust in the whole plan"* | 1 interviewed, applies to all |
| **`Food.allergenTags` and `mayContain` are NULL on all 14,148 rows.** Allergen safety is name-matching only, for the app and for any auditor. A customer noticed: commercial beef jerky is usually marinated in soy sauce — soy *and* wheat — and carries no flag | all walled customers |

---

## 6. The brain story

**Did the day-tolerance trigger catch real residual gaps in the field? It fired,
and then it delivered essentially nothing — while making customers wait over a
minute.**

Cohort: 20 personas, selected from Phase-2 evidence — 15 HARD with days genuinely
out of band or carrying warned slots, 3 comfortably in band, 2 impossible.
`BRAIN=on`, `BRAIN_MAX_DESIGNS_PER_GENERATE=2`, per-request $0.30, daily $4.50,
monthly armed at month-to-date + $4.50.

**The wall clock is the evidence.** 11 of 20 generates landed on an *exact integer
multiple* of `BRAIN_SLOT_TIMEOUT_MS` (35,000 ms):

```
p086 70,677ms   p034 70,387ms   p022 70,459ms   p245 70,445ms   p163 70,709ms
p070 67,952ms   p117 70,520ms   p045 70,402ms   p051 70,251ms   ← 2 × 35s
p181 35,430ms   p118 35,297ms                                   ← 1 × 35s
```

That is not variance. A design is only *started* when the remaining budget covers
a whole one, so **n abandoned designs cost exactly n × 35 s**. The brain was
invoked, each design attempt ran to its slot timeout, was discarded, and the next
started until the 75 s generate budget could not fit another.

**Total: 703 seconds of customer waiting. One billed model call. Nothing kept.**

| | |
|---|---|
| Ledger before / after | 13 rows / $0.392812 → **14 rows / $0.446086** |
| **Phase-3 spend** | **$0.053274** of the $5.00 cap (row `cms6xfu3200hbwl7keskxsmo7`) |
| The one call | `phase=create intent=recipe-drafts model=claude-sonnet-5 in=4,253 out=2,701` — persona **p070** |
| `GeneratedRecipe` rows | **0** |
| `GeneratedPlan` rows | **0** |
| `BrainSolveRun` rows | **0** |
| Recipes created during the window | **0** |

So the one call that *did* complete produced 2,701 output tokens of recipe drafts
and **persisted nowhere** — no draft row, no audit row, no recipe, nothing in the
plan. Money spent, output discarded.

**And the server log said nothing.** 16 lines, all boot-time data-audit. No brain
error, no refusal, no design log, no timeout notice. A 70-second silent burn is
invisible in operations.

**The D0 law, judged arm by arm:**

- **Library-first / silent-when-in-band: PASS, cleanly.** All 3 in-band personas
  saw the brain stay completely silent, and they were fast (37 ms, 327 ms, 42 ms).
  Zero dollars on a day that was already good. This law is genuinely honoured.
- **Residual-gap capture: FAIL.** 15 HARD personas with real gaps produced one
  billed call and zero designed meals. Band outcomes moved in both directions
  (p169 3→5, p070 2→3, but p117 4→2 and p191 5→3) — consistent with ordinary
  solver variance, not with brain repair. **No evidence the brain improved a
  single day.**
- **Impossible tier: PASS on the money, but not by design.** Both impossible
  personas spent $0.00 — the pass condition. But the mechanism was **two 35-second
  timeouts each**, not a refusal. They burned 140 s of wall clock chasing a
  contradiction. The $0 is real; do not read it as the refusal logic working.
- **Free-repair-first:** cannot be confirmed. With one billed call and no
  `BrainSolveRun` audit rows, there is no trace to check the ordering against.

**The client-hangup contract is the live risk.** The documented budget is
"75 s brain + ~10 s solve ≈ 85 s worst case against 120 s client patience." With
the ceiling at its default 12 designs rather than the 2 I armed, twelve 35-second
timeouts is **420 seconds** — and `BRAIN_GENERATE_BUDGET_MS` only stops a *new*
design from starting, so the observed 70.7 s already exceeds its own 75 s budget
check on wall-clock arithmetic. In production defaults this is the spinner-forever
defect returning.

---

## 7. Recommended fix order for the next campaign

1. **Resolve bare food-family terms in `allergenTaxonomy.js`** (D1). Add the words
   people actually type — `pork`, `beef`, `lamb`, `cilantro`/`coriander leaf` — to
   `synonyms`, or make `resolveTaxonomyTerm` fall back to `nameKeywords` membership.
   Removes the entire leak class in an afternoon; the family data already exists.
   Then make an unresolved term **visible** — a wall the app did not understand must
   not look identical to one it did.
2. **Disambiguate name matching on `Food.category`** (D1b) — the other half of the
   safety fix, and the one that does not announce itself. A row named `Pepper` in
   `fruit-veg` at 27 kcal is a capsicum; in `spices` at 250 kcal it is a peppercorn,
   and `FOOD_GATE_SELECT` already fetches `category`. Add `perogi`/`pierogi` to the
   nightshade family (the gluten family already has them). Then accept the structural
   limit out loud: **a name-matching gate cannot be verified by name matching**, so
   any wall whose foods can hide behind their names needs either label data
   (`allergenTags`, D4) or a category rule — not a longer keyword list.
3. **Give the target a direction, or refuse** (D2). `goalWeightKg > startWeightKg`
   must not yield `TDEE − rate × 500`. Until a surplus path exists, block it and say
   so. Silently reversing a customer's stated goal is the worst available option,
   and it currently affects one customer in five.
4. **Repair 8 food rows, in this order** (D3). Not all 444 — the self-declared list
   includes benign naming mismatches (`Egg White ← "egg white"` is simply correct).
   The **wrong-food and wrong-form** rows are the work, ranked by how often they
   actually reached a plate, and **the vegetable rows come first because they land on
   the vegan cohort the app already serves worst**:

   | row | slots reached | carries |
   |---|---:|---|
   | `Potatoes` | 111 | *"Bread, potato"* — 266 kcal vs ~77 |
   | `Tomato Puree` | 102 | tomato-powder family |
   | `Carrots` | 92 | *"Carrot, **dehydrated**"* — 341 kcal vs ~41 |
   | `Tinned Tomatos` | 53 | *"**Tomato powder**"* — 302 kcal vs ~20 |
   | `Tomatoes` | 17 | *"Tomato powder"*, in a `fruit-veg` row |
   | `Tuna` | 17 | *"Fish, **tuna salad**"* (mayo) |
   | `Cannellini Beans` | 14 | *"Beans, cannellini, **dry**"*, used in a baked dish |
   | `Chicken Breast` | 7 | *"tenders, **breaded**"* — 14.7 g P vs ~31 |

   Then add a `state` column (raw / dry / cooked / canned). It is the same missing
   field behind the dry-bean error and behind two thirds of the shopping list reading
   `(state unrecorded)` (D20). **No arithmetic check can find any of this** — these
   errors are Atwater-consistent by construction, which I confirmed the hard way by
   screening all 433 served foods and finding only false positives (D0).

5. **One data pass over three unpopulated mechanisms** — this is the cheapest large win
   in the report, because all three were designed correctly and simply never filled in:

   | column | state | consequence |
   |---|---|---|
   | `RecipeIngredient.scalable` (D18) | **260 / 7,024 set** — 99.4 % of herb rows scale | 105 g rosemary, 100 g bay leaves, 1.1 kg spring onions, 13 g of cabbage in a cabbage stew |
   | `Recipe.mealCategory` (D6) | **720 / 889 null**, 3 marked condiment | 997 kcal of achiote oil served as two meals |
   | `RecipeIngredient.role` (D7) | 35 % of oil rows say `carb` | decides protein-vs-sides scaling, so it drives the portions above |

   Plus **~30 more snack recipes** (D17): the whole snack library is 9 rows, all cured
   meat, dairy or nuts, and **0 of 9 survive a vegan filter** — which is the single
   cause behind seven complaints I had initially logged as separate bugs.
6. **Gate on `poolCounts.afterStack` before writing a plan** (D12). If the filter
   stack leaves fewer rows than the horizon needs, answer with the diagnosis
   *instead of* a mostly-empty week. The diagnosis is already excellent — it is
   just arriving after the write.
7. **Instrument and bound the brain** (D13). Log every design attempt with its
   outcome and duration and emit a `BrainSolveRun` row per pass; then find out why
   every design hits the 35 s slot timeout. A 70-second silent burn that persists
   nothing is worse than `BRAIN=off`, and at the default ceiling of 12 designs it
   re-arms the spinner-forever defect.

**Cheap, and I would slip one of these in first:** *recompute the slot warning
server-side instead of copying it from the client (**D9**) — it is one line, and it
closes the only silent-miss hole in the app's most valuable behaviour.*

*Also cheap, and each one closes a complaint that reached multiple customers:*

- **Accept a bare `recipeId` on `…/slots/:id/apply`** (D11) — **six** customers hit the 400, and it is not merely annoying: forcing a re-fetch reshuffles the alternates list, so a customer who vets one dish for allergens gets served another (D22).
- **Give the six orphaned `Profile` columns a write path** in `PROFILE_FIELDS`, or delete them (D14). Two customers proved the silent 200 live; `excludedFoods` saved and `proteinPriorityMode` vanished **in the same request**.
- **Fix `Egg Plants`** (D8): a `dairy-eggs` category on an aubergine, egg-white macros, and a shopping list that orders "2 eggs" for it. Same purchase-unit bug gives `flax eggs → "5 eggs"` and `Chickpea pasta, dry → "1 can (drained)"`.
- **Strip the `"step 1"` placeholders** (D19) — 162 of 889 recipes, 18 %, ship them as instructions; 13 emit scraped `□` glyphs.
- **Read `Recipe.description` before scheduling** (D19): three recipes say **"Weekends only."** and the solver serves them on Wednesdays.
- **Sweep customer-facing strings for developer output** — `"edit src/lib/groceryPrices.js to correct"` reached **four** customers' shopping lists (D16).
- **Surface the engine's math over HTTP** (D22): three customers tried to audit their own calorie target and got 404s. The constitution promises numbers can reveal their inputs.

---

## Appendix — how this was measured, and what it cost

- **Every safety and macro verdict is re-derived by my own SQL** against
  `PlanSlot.ingredients` → `Food` rows. The app's `meta.matchPct`,
  `days[].inTolerance`, `diagnosis` and slot `warning` fields were recorded as
  *claims* and then checked against my own arithmetic — never used as evidence.
  Calibration: **0.0 kcal drift** on every day compared.
- **My allergen vocabulary is hand-authored** in `lib.mjs`, deliberately not
  imported from `allergenTaxonomy.js`, so the app was not graded with its own
  ruler. Its one false-positive term was found, verified and suppressed.
- **The tolerance rule is the app's own** (kcal ±15 %, protein ≤15 % short,
  fat/carb ≤25 % of band midpoint outside the band, no upward carb allowance on
  keto), re-implemented and applied to numbers the app did not supply.
- **The money stop was mechanical**, not a promise: cumulative `LlmUsage` re-read
  before every persona, cohort ending at C−C0 ≥ $4.50. Never approached.
- **Two of my own instrument bugs were caught and fixed before they contaminated
  results** (a `$queryRaw` JSON deserialisation assumption that produced a false
  clean bill of health; empty days missing from the compliance denominator), and
  **two after** (the paella false positive; a mislabelled "impossible" tier where
  4 requests were in fact satisfiable and the app satisfied them). All four are
  documented in the scripts that made them.
- **Artifacts:** `PREFLIGHT.md` · `personas.jsonl` + `persona-distribution.md` ·
  `results.jsonl` (250) · `raw/p000-p249.json` · `heartbeat.log` ·
  `brain-cohort.jsonl` + `brain-analysis.json` · `cards/` · `stats.json` ·
  `defects.json` · `HARNESS-INCIDENT.md` · DB backup in `backup/`.

*Fleet accounts are all `qa-fleet-qa-fleet-20260729-2032-pNNN@fleet.local` and can
be purged with a single email-prefix delete. The dev DB was backed up to this
run's home before the fleet ran. Port 3001 was never probed or referenced.*
