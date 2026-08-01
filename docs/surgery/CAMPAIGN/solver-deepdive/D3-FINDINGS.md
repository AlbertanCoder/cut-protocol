# D3 — The macro closer and the adjuster system

*Agent D3, solver deep-dive, 2026-07-31. Territory: `backend/src/lib/macroCloser.js`,
`backend/src/lib/planContext.js`, and every consumer.*

**Read-only run.** No file under `backend/src/` was modified. All DB work ran against
`docs/surgery/CAMPAIGN/solver-deepdive/D3/d3.db`, a byte copy of `backend/prisma/dev.db`.
Scripts and raw output are in `solver-deepdive/D3/`.

> ### ⚠ DB PROVENANCE — the live DB is NOT the fleet baseline. Read before quoting a number.
>
> `backend/prisma/dev.db` now hashes **`d9037dce9754b452…`**, not the fleet baseline
> **`e55f52e53658a086…`** recorded in `DEVDB-BASELINE.txt`. `MEASURED`.
>
> **This is not my doing.** The live file's mtime is `2026-07-31 05:53:57`, hours before
> this session began (I copied it at 18:21), and it sits beside a backup named
> `dev.db.backup-provenance149-20260731-055003` written at 05:50:03. A provenance repair
> ran this morning, before the D-fleet started. My copy hashes identically to the live file
> and I never opened the live file for write — every script passes an explicit
> `datasources.db.url` pointing at `D3/d3.db`.
>
> **I diffed the two** (`d3-drift.mjs`, against `solver-brain/A20/dev.db` which still holds
> the baseline). The drift is bounded:
>
> | | baseline `e55f52e5` | live `d9037dce` |
> |---|---|---|
> | Food rows | 14,151 | 14,151 |
> | trusted / quarantined | 13,701 / 420 | 14,042 / 79 |
> | `source` values | usda-verified 13516 · manual 605 · manual-placeholder 29 · usda 1 | usda-verified 13516 · manual 528 · **quarantined 77** · manual-placeholder 29 · usda 1 |
> | protein ≥ 40 rows | 85 | 87 |
> | protein ≥ 40, trusted, harshest-persona-clean | **9** | **11** |
> | `allergenTags` / `mayContain` populated | **0 / 0** | **0 / 0** |
> | adjuster names resolving | 10/10 | 10/10 |
> | adjusters surviving harshest persona | **5** | **5** |
>
> **Every load-bearing conclusion in this report is baseline-stable.** The reachability wall
> (§3, §4), the 0 %-populated allergen metadata (§5.1), the identical top-5 high-protein
> rows, and all of §1/§2/§6 (pure code + a pure-module fuzz, no DB) hold on both.
>
> **The two numbers that move:** §4.3's high-protein survivor count is **11 on the live DB,
> 9 on the fleet baseline** (the repair restored two yeast rows, `dataQuality` =
> `provenance-restored … 2026-07-31`), and the trusted/quarantined counts in §5.3–§5.4.
> Quote 9 when reconciling against A7/A16/A17/A20; quote 11 when describing today's app.

Every claim below is tagged `MEASURED` (I ran it), `DERIVED` (follows from code I read),
or `INFERRED` (judgement). All food-table selection was by **numeric property**
(g per 100 g), never by name — per the C22 lesson.

---

## 0. The three-line summary

1. **The closer is add-only, and I proved it two ways** — structurally and by 4,000-day
   fuzz with zero reduction events. On the dominant failure mode (day OVER band) it is a
   **complete no-op**: it adds nothing and changes nothing.
2. **The reachability wall is 10 rows out of 14,151 — 0.07 %.** For a vegan + soy +
   legumes persona the closer's maximum protein delivery is **0.0 g**. Rows that would
   dissolve that (spirulina 57.5 g P/100 g, `Nutritional powder mix, protein, NFS`
   78.1 g P/100 g) exist, are `usda-verified`, and pass the gate — **but "passes the gate"
   is not "is safe", and I found the reason why.**
3. **Two live defects nobody has named**: the closer can push an *already-out-of-band*
   macro **further out** (its own "no worse" rule has a hole), and `_adjusterFoods` is a
   process-lifetime cache with **no invalidation path at all** — a food quarantined for
   carrying another food's macros keeps being added until the process restarts.

---

## 1. Complete specification of `macroCloser.js` as built

`macroCloser.js` is **untracked in git** (`git status` → `?? backend/src/lib/macroCloser.js`).
`planContext.js`, `weeklyPlanner.js` and `mealSolver.js` carry uncommitted modifications
that wire it. `MEASURED`.

**There is no test file for it.** `grep -rln "closeDayMacros\|macroCloser"` over the whole
backend returns exactly four files: the module and its three consumers. Zero tests, zero
fixtures, zero goldens. `MEASURED`.

### 1.1 Signature and contract

```
closeDayMacros({ slots, dailyTarget, adjusters }) -> { slots, added: [] }
```
`macroCloser.js:108`. Pure — no DB, no clock, no RNG. `adjusters` is
`[{ role: "protein"|"carb"|"fat", food: {id,name,kcal,protein,fat,carb} }]`, already
diet/allergy-filtered by the caller.

### 1.2 When it runs

**Per day, once, as the last step of `solveDay`** — `weeklyPlanner.js:951`, after the
per-slot loop (`:906-944`) has fully resolved every open slot. `DERIVED`.

Call chain, and where it does **not** run:

| entry point | closer runs? | evidence |
|---|---|---|
| `POST /plans/generate` (week / horizon) | **YES** | `plans.js:206` → `:328` → `mealSolver.js:1237` → `:1221` → `:679` → `weeklyPlanner.js:997` → `:951` |
| `generateDayCandidates` (Plan tab "day options" → `/accept-day`) | **NO** | `mealSolver.js:496` and `:531` call `solveDay(...)` with 11 positional args; the 12th (`adjusters`) is omitted → `null` → `macroCloser.js:111` returns untouched |
| `POST /:planId/slots/:slotId/swap` | **NO** | `plans.js:709` → `regenerateOneSlot` (`weeklyPlanner.js:1007-1033`) never calls the closer |
| `alternatesForSlot` (swap alternates) | **NO** | `mealSolver.js:821-833`, no closer |
| `solveOneMeal` (1-meal horizon) | **NO** | `mealSolver.js:1355`, no closer |
| `POST /plans/place-recipe`, `/fill-today-from-cart` | **NO** | `rebuildSlotFromClient` / `scaleRecipe` paths only |

`MEASURED` (grep + read). **Consequence:** the week Generate button and the day-options
card now solve to *different capability*. A day the week solver lands in band via an
adjuster is a day the day-options card reports as a miss.

### 1.3 What it optimises

Per round (`macroCloser.js:128-176`):

- Build a gap list (`:130-135`). **Only shortfalls become gaps.**
  - protein: `max(0, proteinMid - totals.protein)` where `proteinMid = (proteinLo+proteinHi)/2` (`:124,:130`)
  - fat: `bandMiss(...).short` (`:132-133`)
  - carb: `bandMiss(...).short` (`:134-135`)
- Sort by **relative** gap `need / mid`, largest first (`:137`).
- For each gap role in order, for each candidate of that role in **list order**
  (`planContext.js:167-178` order, "plainest first"), take the first that fits.
- Grams: `grams = (need / per100) * 100`, clamped to `MAX_GRAMS[role]`, then rounded by
  `practical()` (`:143-147`).
- **Back-off ladder**: try `[grams, practical(grams*0.6), practical(grams*0.3)]`; take the
  first that does not `wouldHarm` (`:151-153`).
- Commit: push an ingredient row `{foodId, name, role, grams, adjuster:true}` onto the
  host slot and accumulate macros (`:156-168`).

### 1.4 Termination conditions

Four, all in `closeDayMacros`:

1. `round < 3` — **hard cap of 3 additions per day** (`:128`). `MEASURED`: fuzz over 4,000 random days, max additions on any day = 3.
2. `if (!gaps.length) break` — no shortfall left (`:136`).
3. `if (!placed) break` — a whole round passed with no candidate accepted anywhere (`:175`).
4. Per-food dedupe: `!added.some((x) => x.foodId === a.food.id)` (`:141`) — each food at most once per day.

Plus four early returns (`:110-116`): empty slot array, empty adjuster list, no positive
`dailyTarget.kcal`, or **no host slot**.

### 1.5 Gram ceilings

`MAX_GRAMS = { fat: 25, carb: 160, protein: 180 }`, `MIN_GRAMS = 4` (`:46,:48`).
`practical(g) = g >= 20 ? round(g/5)*5 : max(1, round(g))` (`:51`).

All three caps are multiples of 5, so `practical()` cannot round a clamped value above its
cap. `DERIVED`.

Note these are grams **of the food**, not grams of the macro. With today's list the
protein cap of 180 g means at most `180 × 0.31 = 55.8 g` protein (chicken breast).
`MEASURED`.

### 1.6 The `wouldHarm` guard (`:75-97`) — and its hole

Four checks:

| check | line | rule |
|---|---|---|
| kcal ceiling | `:84` | reject if `after.kcal > dailyTarget.kcal * 1.15` |
| fat | `:92` | reject if the add takes fat from **inside** its band to **outside** |
| carb | `:93` | same |
| keto carb | `:95` | reject if `keto && after.carb > carbHi` — no upward allowance |

`1.15` matches `DAY_KCAL_TOLERANCE_PCT` in `mealSolver.js:210`, and the keto rule matches
`dayTolerance`'s `carbOverAllowance` (`mealSolver.js:241`). Those two are correctly
single-sourced in spirit. `DERIVED`.

**THE HOLE.** `check()` at `:86-91` returns `isOver && !wasOver`. A macro that is *already*
outside its band is **not protected** — `wasOver` is true, so the check returns "no harm"
and the add proceeds.

`MEASURED` (`d3-closer-behaviour.mjs` §3). Day at kcal 1500, protein 110 (40 g short),
fat 95 g against a 55–70 g band (25 g over):

```
before  kcal=1500  P=110.0  F= 95.0  C=195.0
after   kcal=1739  P=154.9  F=100.2  C=195.0
added:  145g Chicken breast, cooked, skinless [protein]
```

Fat went from 40 % over its band midpoint to 48 % over. The module's own docstring at
`:69-73` says *"'No worse' is the whole rule"*. It is not the rule that is implemented.

### 1.7 Interaction with the portioning solve

**None — the closer runs strictly after portioning and never re-enters it.** `DERIVED`.

- `proteinScale` / `sidesScale` on the host slot are **not updated** (`:121` spreads the
  host, `:156-168` touches only `ingredients` and the four macro fields).
  `MEASURED`: a 300 kcal breakfast slot becomes 922 kcal while still labelled its original
  scale. This breaks the same display-honesty invariant that
  `plans.js:75-84`'s 0.5×–2× grams guard exists to protect.
- All adjusters land on **one slot** — `slots.find((s) => s.recipeId && !s.locked &&
  Array.isArray(s.ingredients) && s.ingredients.length)` (`:116`), i.e. the **first filled
  unlocked slot of the day**, which in `buildSlots` order is breakfast.
  `MEASURED` (§4 of the behaviour run):

```
slot 0 (breakfast): kcal=922  adjusters = 180g Chicken breast + 160g White rice + 13g Olive Oil
slot 1 (lunch):     kcal=500  adjusters = -
slot 2 (dinner):    kcal=400  adjusters = -
```

  That is 353 g of appended food on a 300 kcal breakfast. The module header (`:14-17`)
  cites *"625 g chicken with 2 g pine nuts"* as the defect it exists to avoid; slot-0
  concentration reintroduces it from a different direction.
- The `added` array the closer returns is **discarded** by its only caller:
  `weeklyPlanner.js:952` returns `{ slots: closed.slots, todayIds }` and drops `closed.added`
  on the floor. Nothing in `meta`, no note, no log. `DERIVED`. Against the constitution's
  *"Every automatic adjustment is logged, visible, and reversible"* this is 1 of 3 —
  visible (as an ingredient row), not logged, not reversible.

---

## 2. The add-only claim — VERIFIED, two independent ways

### 2.1 Structural proof `DERIVED`

The only writes in the whole module are:

- `working.ingredients.push({...})` — `:156`
- `working.{kcal,protein,fat,carb} = (working.X || 0) + food.X * f` — `:159-162`
- `totals = { kcal: totals.kcal + …, … }` — `:163-168`
- `out[hostIdx] = working` — `:179`

with `f = use / 100` and `use >= MIN_GRAMS = 4`, therefore `f >= 0.04 > 0`. Every macro
field is `+=` only. No slot is removed, no `grams` value is ever lowered, no ingredient is
ever spliced out, and `out` is a `slice()` copy so non-host slots are returned by
reference, untouched. There is no code path that reads `bandMiss(...).over` for anything
other than the `wouldHarm` guard — the `over` component **never becomes a gap** (`:130-135`).

Food macros are non-negative in the schema (`kcal/protein/fat/carb: Float`); a negative
row would be the only way to subtract, and none exists.

### 2.2 Empirical proof `MEASURED`

`d3-closer-behaviour.mjs` §1: 4,000 pseudo-random days (2–4 slots, randomised macros and
targets), 3,364 of which triggered at least one addition.

```
macro-reduction events across all four macros: 0
max additions on any day: 3
slot-count changes: 0
```

### 2.3 What that costs, measured against the dominant failure mode

C23 establishes the dominant failure is OVER band (A17: 97 OVER / 1 SHORT on fat-failing
days; A19: 83/83 rescued days were over). Direct test `MEASURED` (§2 of the behaviour run):

| day | closer output |
|---|---|
| fat 95 g against a 55–70 g band, everything else fine | **added nothing**, delta 0/0/0/0 |
| kcal 2500 against a 2000 target (+25 %) | **added nothing**, delta 0/0/0/0 |
| carb 300 g against a 180–210 g band | **added nothing**, delta 0/0/0/0 |

**On every shape of the dominant failure the closer is a strict no-op.** It is the wrong
tool for ~97 % of the misses it was built to address, and it is not a partial tool — it is
zero.

---

## 3. `ADJUSTER_CANDIDATES` — full measurement

### 3.1 The list (`planContext.js:167-178`)

```
fat:     Olive Oil · Butter · Avocado
carb:    White rice, cooked · Potatoes · Oats
protein: Chicken breast, cooked, skinless · Greek Yogurt · Tofu · Lentils
```

### 3.2 Resolution — all 10 names DO resolve `MEASURED`

`loadAdjusterFoods` (`:181-194`) runs `prisma.food.findMany({ where: { name: { in: [...] } } })`.
Against the real table: **10 rows returned, 10 distinct lowercased keys, no duplicate-name
collisions, and none rejected by `macroTrustIssue`.** The name list is not silently broken.

| name | role | kcal | P | F | C | source | fdcId |
|---|---|---|---|---|---|---|---|
| Olive Oil | fat | 900 | 0 | 100 | 0 | usda-verified | 2710186 |
| Butter | fat | 717 | 0.9 | 81 | 0.1 | **manual** | null |
| Avocado | fat | 160 | 2 | 14.7 | 8.5 | **manual** | null |
| White rice, cooked | carb | 130 | 2.7 | 0.3 | 28 | **manual** | null |
| Potatoes | carb | 77 | 2.05 | 0.09 | 17.5 | **manual** | null |
| Oats | carb | 379 | 13.2 | 6.5 | 67.7 | **manual** | null |
| Chicken breast, cooked, skinless | protein | 165 | 31 | 3.6 | 0 | **manual** | null |
| Greek Yogurt | protein | 59 | 10.3 | 0.39 | 3.6 | **manual** | null |
| Tofu | protein | 144 | 17.3 | 8.72 | 2.78 | **manual** | null |
| Lentils | protein | 166 | 8.38 | 6.86 | 18.7 | usda-verified | 2707423 |

### 3.3 Survivors per persona `MEASURED`

Exact reimplementation of `loadAdjusters` (`:204-215`): name hit && `!macroTrustIssue` &&
`!isExcluded`. All 9 `DIETARY_STYLES` × 4 allergen walls:

| style | wall | fat | carb | **protein** |
|---|---|---|---|---|
| none / mediterranean / halal / kosher | none | 3 | 3 | **4** |
| none / mediterranean / halal / kosher | dairy | 2 | 3 | **3** |
| vegetarian | none | 3 | 3 | **3** |
| vegetarian | dairy | 2 | 3 | **2** |
| vegetarian | soy + legumes | 3 | 3 | **1** |
| **vegan** | none | 2 | 3 | **2** |
| **vegan** | soy + legumes | 2 | 3 | **0** |
| **vegan** | soy+legumes+gluten+nuts+sesame | 2 | 3 | **0** |
| paleo | any | 3 | 1 | 1 |
| keto | none | 3 | **0** | 3 |
| keto | dairy | 2 | **0** | 2 |
| carnivore | none | 1 | **0** | 2 |
| carnivore | dairy | **0** | **0** | 1 |

This confirms C22/A20 exactly: **0 of 4 protein adjusters survive vegan + soy + legumes.**
It also surfaces three cases C22 did not name:

- **keto: 0 carb adjusters** in every configuration. All three carb rows are rice, potato,
  oats.
- **carnivore + dairy: 1 adjuster total** (chicken breast) across all three roles.
- **vegetarian + soy + legumes: 1 protein adjuster** (Greek Yogurt, 10.3 g P/100 g).

### 3.4 Maximum macro the closer can deliver `MEASURED`

Best single surviving food at its `MAX_GRAMS` ceiling:

| persona | max protein | max fat | max carb |
|---|---|---|---|
| omnivore, no walls | 55.8 g | 25.0 g | 108.3 g |
| vegan, no walls | 31.1 g | 25.0 g | 108.3 g |
| **vegan + soy + legumes** | **0.0 g** | 25.0 g | 108.3 g |
| vegetarian + soy + legumes | 18.5 g | 25.0 g | 108.3 g |
| keto (any) | 55.8 g | 25.0 g | **0.0 g** |
| carnivore + dairy | 55.8 g | **0.0 g** | **0.0 g** |

Even for an unrestricted omnivore the protein ceiling caps out: `MEASURED` §8 of the
behaviour run, a 60 g protein gap closes (180 g chicken + 40 g yogurt), an **80 g gap does
not** — the whole 4-food protein list delivers 74.3 g and the day stays short.

---

## 4. THE REACHABILITY WALL, quantified

### 4.1 Headline

**10 of 14,151 Food rows are reachable by the closer. 0.07 %.** `MEASURED`.

### 4.2 By numeric property — never by name

| bucket (per 100 g) | rows in table | **reachable today** |
|---|---|---|
| protein ≥ 60 | 32 | **0** |
| protein ≥ 40 | 87 | **0** |
| protein ≥ 25 | 1,417 | **1** (chicken breast) |
| protein ≥ 25 AND fat ≤ 5 (lean protein) | 277 | **1** |
| fat ≥ 50 | 398 | **2** (olive oil, butter) |
| fat ≥ 80 (near-pure fat) | 171 | **2** |
| carb ≥ 70 | 1,047 | **0** |
| carb ≥ 60 AND fat ≤ 3 (lean carb) | 628 | **0** |

The lean-carb row is the one that surprised me: **628 rows in the table are high-carb and
low-fat, and the closer can reach none of them.** Its three carb foods are rice (28 g carb),
potato (17.5 g) and oats (67.7 g carb but 6.5 g fat — so oats fails the "lean" test and is
the only reason the closer's carb ceiling is 108 g rather than ~45 g).

### 4.3 The C22 rows — independently verified `MEASURED`

I re-derived these by sorting the whole table on `protein` descending and applying the
gate. I did **not** search by name. All three prior-named rows appear, plus eight more.

*(Live DB `d9037dce`. On the fleet baseline `e55f52e5` this list is **9 rows**, not 11 —
the last two yeast entries were quarantined until this morning's provenance repair. The
top 8 are identical on both. See the DB-provenance box at the top.)*

| P/100 g | F | C | kcal | source | fdcId | name | P per 100 kcal |
|---|---|---|---|---|---|---|---|
| 78.1 | 1.56 | 6.25 | 352 | usda-verified | 2710745 | Nutritional powder mix, protein, NFS | **22.2** |
| 58.1 | 1.16 | 29.1 | 359 | usda-verified | 2710734 | Nutritional powder mix (Isopure) | **16.2** |
| 57.5 | 7.72 | 23.9 | 290 | usda-verified | 170495 | Seaweed, spirulina, dried | **19.8** |
| 53.6 | 10.7 | 20.4 | 392 | usda-verified | 174181 | Beverages, nutritional shake mix, high protein, powder | 13.7 |
| 53.6 | 10.7 | 20.4 | 392 | usda-verified | 2710733 | Nutritional powder mix, high protein (Herbalife) | 13.7 |
| 53.6 | 10.7 | 20.4 | 392 | usda-verified | 2710741 | Nutritional powder mix, high protein, NFS | 13.7 |
| 50.0 | 12 | 22 | 396 | usda-verified | 2710744 | Nutritional powder mix, protein, light, NFS | 12.6 |
| 49.1 | 4.77 | 38.4 | 367 | usda-verified | 170147 | Seeds, cottonseed meal, partially defatted (glandless) | 13.4 |
| 40.4 | 7.61 | 41.2 | 325 | usda-verified | 2710005 | Yeast | 12.4 |
| 40.4 | 7.61 | 41.2 | 325 | manual | null | Fast action yeast | 12.4 |
| 40.4 | 7.61 | 41.2 | 325 | manual | null | Instant Yeast | 12.4 |

All 11 pass `macroTrustIssue` **and** `isExcluded` for the harshest persona
(vegan + soy + legumes + gluten + nuts + sesame). A7's required density is
**7.98–8.63 g protein per 100 kcal**; every one of these clears it, most by 50–170 %.

**Counts** `MEASURED` (live DB `d9037dce`; baseline figure in brackets where it differs):

| tier | total | trusted | vegan-clean | harshest-persona-clean |
|---|---|---|---|---|
| protein ≥ 60 | 32 | 32 | 7 | **1** |
| protein ≥ 40 | 87 [85] | 87 [82] | 37 | **11** [9] |
| protein ≥ 25 && fat ≤ 5 | 277 | 277 | 34 | **13** |

**What one added name buys** `MEASURED`, at `MAX_GRAMS.protein = 180 g`:

| row | protein delivered | kcal cost | fat cost | carb cost |
|---|---|---|---|---|
| *current best for this persona* | **0.0 g** | — | — | — |
| Seaweed, spirulina, dried | **103.5 g** | +522 | +13.9 g | +43.0 g |
| Nutritional powder mix, protein, NFS | **140.6 g** | +634 | +2.8 g | +11.3 g |

This is the whole wall. It is not botany, not the library, and not the recipe pool — it is
a ten-line array literal.

---

## 5. Provenance and safety constraints on any expansion

### 5.1 THE FINDING THAT MATTERS MOST: the food gate has two of its three metadata probes empty

`MEASURED`, raw SQL over all 14,151 rows:

```
allergenTags IS NULL : 14151 / 14151   (100.0%)
mayContain   IS NULL : 14151 / 14151   (100.0%)
fdcCategory  IS NULL :   635 / 14151   (  4.5%)
```

`FOOD_GATE_SELECT` (`exclusionGate.js:80-87`) selects `allergenTags`, `mayContain` and
`fdcCategory` and its comment calls dropping any of them *"silently downgrad[ing] the
four-probe union to a name check, which is the bug this module exists for."* **For Food
rows the downgrade has already happened in the data**: two probes are null on every row,
so a Food verdict rests on the name plus `fdcCategory`.

Recipes still get step-prose and ingredient evidence. **Bare foods do not.** The closer is
the only solver path that admits a bare Food, so it is the path most exposed to this.

### 5.2 What that means for the C22 rows — do NOT treat "passes the gate" as "is safe"

`MEASURED`, `d3-safety.mjs` §B. Each of the 11 high-protein survivors probed against six
additional walls:

| row | fdcCategory | dairy | milk | whey | egg | vegan | vegetarian |
|---|---|---|---|---|---|---|---|
| Nutritional powder mix, protein, NFS | Protein and nutritional powders | ALLOWED | ALLOWED | ALLOWED | ALLOWED | ALLOWED | ALLOWED |
| **Nutritional powder mix (Isopure)** | Protein and nutritional powders | ALLOWED | ALLOWED | **ALLOWED** | ALLOWED | **ALLOWED** | ALLOWED |
| Nutritional powder mix, high protein (Herbalife) | Protein and nutritional powders | ALLOWED | ALLOWED | ALLOWED | ALLOWED | ALLOWED | ALLOWED |
| Beverages, nutritional shake mix, high protein, powder | Beverages | ALLOWED | ALLOWED | ALLOWED | ALLOWED | ALLOWED | ALLOWED |
| Seaweed, spirulina, dried | Vegetables and Vegetable Products | ALLOWED | ALLOWED | ALLOWED | ALLOWED | ALLOWED | ALLOWED |

`allergenTags = null` and `mayContain = null` on **all** of them.

**Isopure is a whey-protein-isolate brand.** The gate returns ALLOWED for a whey wall and
for vegan because the row's name contains no dairy token and its two allergen-metadata
columns are empty. This is not a verdict that the row is dairy-free; it is the gate having
no evidence either way and failing **open**. C19 already lists "the Isopure whey row" among
its 13 latent style-gate leaks — this is that same row, and it sits at #2 on the
high-protein list any numeric widening would reach first.

**6 of the 11 rows are generic protein-powder composites.** A category whose typical
composition is whey or soy is the single worst category to admit through a gate whose
allergen metadata is 0 % populated.

This is precisely the verification-shape trap the brief warns about: `isExcluded` is the
system under test *and* the predicate, so asking it "is this safe?" returns its own blind
spot as a green light. **My recommendation is to widen toward `Seaweed, spirulina, dried`
(fdcCategory `Vegetables and Vegetable Products`, a single-ingredient whole food) and to
treat every `Protein and nutritional powders` / `Beverages` row as blocked until its
allergen metadata is populated.**

### 5.3 Provenance of the existing ten `MEASURED`

**8 of the 10 current adjusters are `source = "manual"` with `fdcId = null`.** Only
Olive Oil and Lentils are `usda-verified`. Five carry an **empty `dataQuality` string**
(Avocado, Butter, Oats, White rice cooked, Chicken breast) — no recorded validator
evidence at all. Three carry `override:applied` notes from the Phase-2 repair.

The constitution's tiers are USDA-VERIFIED (+FDC id) | LABEL | AI-ESTIMATED. `manual` is
none of those. `macroTrustIssue` (`foodValidation.js:234-256`) accepts them because it only
rejects quarantined rows, `UNVERIFIED_PROVENANCE_PREFIXES`, and `manual-placeholder`.

**Constraint with teeth:** a fix that requires `source === "usda-verified"` for adjusters
would **remove 8 of the 10 current candidates**. Whatever provenance bar the build sets, it
must be applied to the incumbents too or the list becomes internally inconsistent — a
verified spirulina row admitted next to an unsourced Butter row.

Note the C22/A23 warning generalises: the spirulina row's `dataQuality` is
`exception:usda-source-model — USDA computed this record's energy with food-specific
Atwater factors P2.44/C3.5`. That is a documented exception, not a `pass`. It is legitimate
under Phase 2's exemption rules, but a report quoting 57.5 g P/100 g should say
*USDA-VERIFIED with a documented Atwater exception*, not *pass*.

### 5.4 What a naive numeric widening would admit `MEASURED`

`fdcCategory` distribution over all 87 trusted rows with protein ≥ 40:

```
13  Dairy and Egg Products          13  Legumes and Legume Products
13  American Indian/Alaska Native Foods    11  Protein and nutritional powders
 8  (null)                           6  Beverages
 6  Nut and Seed Products            3  Sweets
 2  Snacks                           2  Finfish and Shellfish Products
 2  Pork                             1  Shellfish     1  Cheese     1  Pork Products
 1  Cereal Grains and Pasta          1  Vegetables and Vegetable Products
 1  Baked Products                   1  Not included in a food category
 1  Soy and meat-alternative products
```

The 13 `American Indian/Alaska Native Foods` rows are the C13/C19 latent-leak family
(Seal, Squirrel, Sea cucumber…). A numeric-only widening walks straight into them.

**Carbs are worse.** 324 rows pass `carb ≥ 60 && fat ≤ 3` + trust + the harsh gate. Sorted
by carb descending, the **top 12 are all sugar** (granulated, icing, caster, demerara,
muscovado, turbinado, powdered…), and **54 of the 324 are ≥ 95 g carb/100 g**, i.e.
essentially pure sugar or starch. A closer that closes a carb gap with 160 g of granulated
sugar has satisfied `dayTolerance` and produced something nobody will eat. Macro fitness is
not food fitness; a widened pool needs a **role/plausibility curation layer**, not just a
numeric filter.

### 5.5 The cache with no invalidation path `DERIVED`, high confidence

`_adjusterFoods` (`planContext.js:180`) is set once at `:192` and short-circuited at `:182`.
`invalidateRecipeLibrary()` (`:96-100`) resets `_epoch`, `_library` and `_pools` — **it does
not touch `_adjusterFoods`.** Nothing else in `backend/src/` references it
(`grep -rn "_adjusterFoods"` → four hits, all inside `planContext.js`).

Consequences:
- A food edited via `PUT /foods/:id` (which recomputes recipe caches) keeps its **old
  macros** in the adjuster path for the process lifetime.
- A food **quarantined** after the first plan request keeps being added by the closer,
  because the `macroTrustIssue` check at `:210` runs against the cached row.
- The `LIBRARY_VERSION_SQL` checksum at `:84-87` covers `Food` macro sums — so the pool
  cache would notice the change and the adjuster cache would not. The two halves of this
  file disagree about staleness.

This is a safety bug, not just a perf wart: quarantine exists specifically to stop a row
whose macros are another food's numbers from reaching a user.

### 5.6 Performance envelope for a widened gate `MEASURED`

| approach | query | gate pass | total |
|---|---|---|---|
| today (10-name `in`) | 10 ms | ~0 ms | **~10 ms** |
| SQL numeric prefilter (P≥25 ∪ F≥50 ∪ C≥50) → 4,031 rows | 58 ms | 220 ms | **~280 ms** |
| whole table → 14,151 rows | 175 ms | 662–714 ms (3 warm repeats) | **~850 ms** |

For scale: `planContext.js:54-57` records the full solve at 30–50 ms, and the recipe-pool
load it already caches at 192–532 ms. **An ungated per-request full-table pass would be the
single most expensive thing in a plan request.** Any widening must be cached the way
`_pools` is — keyed on `(library version, dietaryStyle, sorted excludedFoods)` — and must
gain the invalidation hook `_adjusterFoods` currently lacks.

---

## 6. The closer's honesty interaction — exact ordering

### 6.1 Where totals are finalised vs where warnings are computed

| # | step | file:line | effect |
|---|---|---|---|
| 1 | `resolveSlot` forms the slot warning | `weeklyPlanner.js:516`, `:668`, `:673-675` | warning string names pre-closer kcal/protein |
| 2 | `toSlotRecord` stores it | `weeklyPlanner.js:678-686` | `warning: result.warning` |
| 3 | **`closeDayMacros`** | `weeklyPlanner.js:951` | mutates host slot macros + ingredients; **does not touch `warning`** |
| 4 | `generateWeekPlan` returns | `weeklyPlanner.js:1004` | |
| 5 | **`scoreWeek` / `scoreDay` / `dayTolerance`** | `mealSolver.js:680`, `:141`, `:229` | day verdict computed **POST-closer** ✅ |
| 6 | best-of-N selection | `mealSolver.js:685-692` | selects on post-closer scores ✅ |
| 7 | `fillGapsWithBrain` | `mealSolver.js:723-736` → `weeklyPlanner.js:788-819` | may **replace** the host slot |
| 8 | conditional rescore | `mealSolver.js:740` | `if (pass.filled \|\| pass.replaced)` ✅ |
| 9 | `diagnoseFromResult` | `mealSolver.js:754-756` | reads final slots ✅ |

**Good news, and it should be said plainly: the DAY-level ordering is already correct.**
The closer runs *before* `scoreWeek`, so `matchPct`, `daysInTolerance`, `dayMissLine` and
`diagnosis` all describe the post-closer day. The A17 trimmer's disqualifying regression —
"mutates totals *after* the solver forms its warning" — **does not apply at day level to
the shipping closer.** A build that adds subtraction must preserve this ordering, and the
cheapest way is to do the trimming inside `solveDay` at `weeklyPlanner.js:951`, in the same
position the closer already occupies.

### 6.2 Defect A — the SLOT-level warning is stale `MEASURED`

`macroCloser.js:121` builds `working = { ...host, ingredients: host.ingredients.slice() }`,
which carries `warning` verbatim, and nothing recomputes it.

```
slot kcal BEFORE closer: 900
slot kcal AFTER  closer: 1630
slot.warning AFTER closer:
  "Tried 20 recipe(s) for this slot, none fit within tolerance —
   closest was \"X\" (landed 900 kcal vs a 1200 target)."
```

The slot now holds 1,630 kcal and tells the user it holds 900. The day-level number is
right and the slot-level sentence contradicts it. This is the same *class* of defect A17
was disqualified for, one level down, and it is live in the shipping code.

It also feeds forward: `mealSolver.js:989` and the PlanTab slot warnings render this
string, and A13's cost note ("warned slots rise 341 → 405") is measured on this same field.

### 6.3 Defect B — the brain pass silently discards adjusters `DERIVED`

`fillGapsWithBrain` builds `roughs` from **every slot carrying a warning**
(`weeklyPlanner.js:762-765`) and replaces the winner with `out[i] = toSlotRecord(target, result)`
(`:813`) — a fresh record built only from the recipe. **Every adjuster ingredient on that
slot is dropped.**

The host slot is `slots.find(s => s.recipeId && !s.locked && s.ingredients.length)` —
the first filled slot — and it is eligible for `roughs` whenever it carries a warning
(which, per §6.2, it often will, because the closer attaches to a slot the solver already
struggled with). The two selection rules can and do point at the same index.

The rescore at `mealSolver.js:740` keeps the reported totals honest, so this is **not** a
lying-numbers bug. It is a **silent work-loss** bug: the day falls back out of band, the
diagnosis fires, and nothing anywhere says "the component that was closing this day was
removed." Reversibility and logging are both absent (§1.7).

### 6.4 Defect C — a latent 400 on any slot round-trip `DERIVED`

`rebuildSlotFromClient` (`plans.js:67-110`) validates every incoming ingredient against the
recipe:

```js
const ri = byFoodId.get(ing.foodId);
if (!ri) throw Object.assign(new Error(`ingredient ${ing.foodId} does not belong to recipe "${recipe.name}"`), { status: 400 });
```
`plans.js:72-73`

An adjuster's `foodId` is by construction **not** in `recipe.ingredients`. The frontend's
`toApplyPayload` (`PlanTab.jsx:55-61`) posts `{foodId, grams}` for every ingredient of a
slot to `/accept-day` (`:951`) and `/apply` (`:598`).

**Currently latent, not live** — both surfaces source their slots from
`generateDayCandidates` / `alternatesForSlot`, which are exactly the two paths that never
run the closer (§1.2). **It becomes live the moment the closer is wired into either**, which
is the natural fix for the capability divergence in §1.2. A build prompt must handle this
explicitly: `rebuildSlotFromClient` needs to accept adjuster rows (validated against the
persona's adjuster set rather than the recipe's ingredient list) before the closer reaches
those surfaces.

### 6.5 What is honest today, and should not be broken

- **Grocery list: correct.** `planToGroceryListInput` (`plans.js:721-734`) maps
  `s.ingredients` wholesale into `anchor.ingredients`, and `aggregateIngredients`
  (`groceryList.js:170-188`) consumes them. Adjusters do reach the shopping list. `DERIVED`.
- **Persistence: correct.** `upsertSlot` (`plans.js:46-61`) writes the `ingredients` JSON
  verbatim, so `{foodId, name, role, grams, adjuster:true}` survives the round-trip to disk.
- **`out.indexOf(host)` is computed once, before the loop** (`macroCloser.js:120`). A17's v1
  clone had a `-1` bug here that silently discarded additions 2 and 3; **the shipping module
  does not have it.** Any re-implementation must preserve this — it is the exact trap A17
  fell into.
- **Frontend does not distinguish adjusters.** `PlanTab.jsx:170` and `:706` render
  `${grams}g ${name}` joined by " · " with no awareness of `adjuster: true`
  (`grep -rn "adjuster" frontend/src` → **zero hits**). So "180 g Chicken breast" appears
  inside the ingredient line of a dish that does not contain it. The macroCloser header's
  honesty claim (`:31-34`, "it shows on the plan") is true; the presentation is not — the
  dish is misdescribed. A build that widens the closer should ship the UI distinction with it.

---

## 7. Every constraint a fix must respect

**Safety**
1. `allergenTags` and `mayContain` are **null on 100 % of rows**. A widened gate rests on
   name + `fdcCategory` alone. Either populate those columns for the candidate set first, or
   restrict the widening to rows whose `fdcCategory` is a single-ingredient whole-food
   category. Do not widen into `Protein and nutritional powders`, `Beverages`, or
   `American Indian/Alaska Native Foods` (the C13/C19 family) on gate approval alone.
2. Never use `isExcluded` as the sole evidence that a widening is leak-free — it is the
   system under test. Cross-check the candidate set **by name** against C13's 13-row list
   (C19 rule 1), and note that `oracle.mjs` catches only 1 of those 13.
3. The `wouldHarm` hole (`macroCloser.js:86-91`) must be closed: a macro already outside its
   band must be protected from being pushed further out.
4. `_adjusterFoods` needs an invalidation hook wired into `invalidateRecipeLibrary()` before
   any pool widening, or a quarantined row stays reachable for the process lifetime.

**Provenance**
5. Whatever bar is set applies to the incumbents: `usda-verified` would delete 8 of the 10
   current candidates. Decide the tier explicitly and state which rows it removes.
6. Quote tiers accurately. Spirulina is `exception:usda-source-model`, not `pass`.
   A23's nutritional-yeast figure is LABEL, and its cited FDC id 404s.

**Honesty ordering**
7. Any macro **subtraction** must run in `weeklyPlanner.js:951`'s position — inside
   `solveDay`, before `scoreWeek` at `mealSolver.js:680`. That ordering is already right for
   addition; do not move it.
8. Recompute the **slot** warning after the closer runs. It is stale today (§6.2) and any
   trimmer makes it worse.
9. `fillGapsWithBrain` must not silently discard adjusters (§6.3). Either exclude the
   adjuster host from `roughs`, or re-run the closer after the brain pass and before the
   rescore at `mealSolver.js:740`.
10. Surface the closer's `added` array — it is discarded at `weeklyPlanner.js:952`. The
    constitution requires every automatic adjustment to be logged, visible **and reversible**;
    today only the middle one holds.
11. If a refusal path is involved, C21 binds: compliance is reported on the pre-refusal
    denominator, and refusal precision/recall separately.

**Performance**
12. The 10-name `in` costs ~10 ms. A numeric prefilter + gate costs ~280 ms; the whole table
    ~850 ms, against a 30–50 ms solve. Cache by `(library version, dietaryStyle, sorted
    excludedFoods)` exactly as `_pools` does at `planContext.js:141-155`.

**Scope / correctness**
13. The closer runs on **one** surface. If it is extended to `generateDayCandidates` or
    `alternatesForSlot`, `rebuildSlotFromClient` (`plans.js:72-73`) will 400 on the
    round-trip (§6.4) — fix that first.
14. All adjusters land on slot 0 (§1.7). Distributing them, or capping per-slot additions,
    is required before raising `MAX_GRAMS`.
15. Macro fitness ≠ food fitness. 54 of the 324 reachable-if-widened lean-carb rows are
    ≥ 95 g carb/100 g pure sugar. Curate by role, not by numbers alone.
16. `macroCloser.js` is **untracked**, and has **zero tests**. Any build should land its test
    file in the same commit.

---

## 8. What I could NOT determine

1. **The closer's actual point contribution.** I did not run the 578-day fleet rig, so I
   cannot say how many days the closer currently rescues, nor how many a widened pool would
   rescue. A14 (`A14-runRig.mjs`) and A19 (`A19-run.mjs`) both carry working rigs with their
   own inlined copies of `ADJUSTER_CANDIDATES` — note those copies will need updating in
   lockstep with any change, or the rigs will measure the old constant.
2. **Whether the protein-powder rows are actually dairy-derived.** The DB has no composition
   data for them and I did not fetch the FDC records. I am asserting that the gate's ALLOWED
   verdict is **unproven**, not that it is wrong. Someone must resolve fdcId 2710745,
   2710734, 2710733, 2710741, 2710744 and 174181 against FDC before any of them is admitted.
3. **How often the brain pass actually replaces the adjuster host slot** (§6.3). The
   selection rules provably can collide; measuring the rate needs a live `BRAIN=on` run,
   which I did not do.
4. **Whether spirulina's `exception:usda-source-model` provenance clears the constitution's
   bar.** That is a product call for Shad, not a measurement.
5. **The right `MAX_GRAMS` for a concentrate.** 180 g of spirulina is 103.5 g protein and
   also a plate of 180 g of dried algae. A20's caveat 2 stands unanswered: *"whether the
   closer would realistically add 180 g of anything is a product question."* The ceiling
   almost certainly needs to be per-food, not per-role.
6. **Real-world adjuster placement frequency on live plans.** No plan-history query was in
   scope, and `added` is discarded (§1.7), so there is no telemetry to read even if it were.
7. **What else this morning's provenance repair changed.** I diffed only the columns my
   territory reads (`source`, `dataQuality`, macros, the gate columns). 341 rows moved out of
   quarantine and a new `source` value `"quarantined"` (77 rows) appeared — a value no schema
   comment documents, consistent with the schema's own "OPEN VOCABULARY — do not treat this
   list as exhaustive" warning at `schema.prisma:266-275`. Whether that repair was sound is
   not my call, but **every prior fleet number measured against `e55f52e5` is now one repair
   stale**, and the next fleet should re-baseline rather than inherit.

---

## Artifacts

All in `docs/surgery/CAMPAIGN/solver-deepdive/D3/`:

| file | what |
|---|---|
| `d3.db` | read-only copy of `dev.db` (baseline `e55f52e5…`) |
| `d3-measure.mjs` / `.out.txt` | name resolution, per-persona survivors, ceilings, numeric reachability buckets, provenance |
| `d3-safety.mjs` / `.out.txt` | allergen-metadata emptiness, the 11 survivors probed against 6 walls, category distributions |
| `d3-closer-behaviour.mjs` / `.out.txt` | 4,000-day add-only fuzz, over-band no-op, the `wouldHarm` hole, host concentration, stale warning, keto, gram ceilings |
| `d3-perf.mjs` | gate cost at three pool sizes |
