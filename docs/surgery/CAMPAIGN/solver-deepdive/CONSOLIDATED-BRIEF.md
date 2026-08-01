# Cut Protocol meal solver — consolidated evidence brief

**Written 2026-07-31 from a 10-agent read-only investigation (D1–D10).**
Per-agent detail in `D1-FINDINGS.md` … `D10-FINDINGS.md` (~393 KB) in this directory.
Prior 25-agent study in `../solver-brain/` (`REPORT.md`, `CORRECTIONS-1..5.md`, `CLAIMS.tsv`).

**Purpose:** this document is the input to a build prompt. It states what is known, what is
measured, what is dead, and what any fix must not break. It is not itself a plan.

**Evidence tiers used throughout:** `MEASURED` (this campaign ran it), `DERIVED` (computed from
a measurement), `ESTIMATED` (modelled), `INFERRED` (read from code). Numbers without a tier in
the source were not carried forward.

---

## 0. Read this before trusting any number

**The prior corpus's absolute numbers are one data repair stale.** The 25-agent fleet measured
at commit `0d3eaa5` / DB `e55f52e5`. Commit `257cbec` then landed 199 macro corrections and
`applyFoodOverrides.mjs` wrote 149 more rows at 07-31 05:50. The corrections are large and land
on solver staples — Chicken Breast 263→120 kcal, Potatoes 266→77, Tomato 302→18, Carrots 341→41,
Tofu 94→144. Four are `ADJUSTER_CANDIDATES`; three are golden-test fixtures. 261 of 910 recipes
(28.7%) changed cached macros. [D10, D5, D3 — MEASURED]

**But the level did not move.** Two independent instruments both land on **70.1% on the current
tree with the current DB** — a re-score of the stored fleet (405/578) and a fresh solve down a
different call path (437/623). Three seeds: 77.3–77.7% satisfiable, cross-seed spread 0.4–0.5 pts.
[D9 — MEASURED]

**What that means operationally:** levels are safe to quote; **stored baselines are not a valid
comparison arm.** 514 of 639 day records changed content since A1's baseline (52 verdicts flipped,
b=24 c=28, noise). **Every A/B must re-run its own baseline in-session.** [D9 — MEASURED]

**The baseline is a working tree, not a commit.** All 38 `profile-blocked-400` personas carry
`gate: "gain-not-supported"` from `gainDirectionGate`, +73 uncommitted lines in
`routes/profile.js`. Pin the tree with `git diff --stat` and a `dev.db` hash, never a SHA.
[D9, D10 — MEASURED]

**~20.8 of the 29.3-point arc (40.8→70.1) is uncommitted source** — `compositionWeight`/
`pickRecipe`, `slotAttemptBudget`, and the whole macro-closer wiring across `macroCloser.js` +
`planContext.js` + `weeklyPlanner.js` + `mealSolver.js` + `plans.js`. Protect it. [D10 — MEASURED]

**Neither headline fix exists on disk.** `SCALE_BOUNDS = {min:0.5,max:2}` (`weeklyPlanner.js:58`)
and `scaleRecipe(recipe, kcalTarget, proteinTarget)` (`:394`) are untouched. `wls2` and the 0.25×
floor exist only in A13's in-memory experiment hook. [D10 — MEASURED]

---

## 1. The one-paragraph diagnosis

The solver overshoots. On fat-failing days the split is **97 over / 1 short**; fat-only misses are
**42/42 over**; rescued days are **83/83 over**. Three independent mechanisms produce that single
failure mode, and they compound in one place: **the accept gate scores kcal and protein but the
verdict scores four macros**, so fat and carbs are unmanaged byproducts; **the over-sized portion
is penalised only on calories** because `proteinShortfallPct` is one-sided while `kcalOffPct` is
two-sided; and **the smallest, most starved slot is solved last**, where it must absorb the
accumulated residual with the least capacity to do so. The library is fattier and less
protein-dense than any target, but only ~3.4 points of the gap are attributable to that, and
target-side infeasibility explains ≈0. This is a search-and-objective problem, not a data problem.

---

## 2. Levers, ranked — measured effects only

**Never sum this table.** Baseline satisfiable misses are 123/536, so the union of all levers
cannot exceed **+22.95 pts**. The naive sum of measured gross gains is +58.77 — 2.56× impossible.
[A24 — MEASURED]

| # | lever | Δ (satisfiable-only) | evidence | status |
|---|---|---|---|---|
| 1 | **A13 `wls2`** 4-macro tolerance-normalised portioning objective | **+14.74** [+11.40,+18.08] b=8 c=87 | MEASURED, 3 seeds, pre-repair DB | not on disk |
| 2 | **D2 solve slots smallest-first** | **+8.27** [+6.49,+10.05] pooled, 3 seeds | MEASURED, fleet-baseline DB, independent re-grade +9.33 | **new; one-line** |
| 3 | A16 protein-concentrate / snack pool enrichment (N=8) | +10.45; **+7.46** [+4.90,+10.02] marginal over #1 | MEASURED | authoring |
| 4 | A13 `floor25` 0.25× portion floor on top of #1 | +19.96 total; +5.22 marginal | MEASURED, **single seed**; ships 35.5% of slots below the old floor | plate-realism cost unmeasured |
| 5 | A17 macro trimmer | +14.93 raw; **+2.24 marginal** over #1 (72/84 days shared) | MEASURED overlap | UNRESOLVED + disqualified as prototyped |
| 6 | A14 attempt-budget floor 5→12 | +1.12 pooled | MEASURED | UNRESOLVED |
| 7 | A19 variety-safe day harvesting | +1.68; **+0.00 marginal** | MEASURED | SUBSUMED — dead |
| 8 | A18 `SCORE_WEIGHTS` retune | **0.00**, b==c in 6/6 arms | MEASURED | DEAD, structurally |
| 9 | A15 ruler widening (fat ±50%) | +4.0 max | MEASURED | not a solver lever |
| 10 | A20 sound refusal (P7) | **+0.00** | MEASURED | ship for honesty, not points |

**Measured interactions:**
- #2 + #6 = **+9.33, not +10.45** — sub-additive. [D2 — MEASURED]
- #1 + #5 overlap 72 of 84 days, union 99, J=0.727. [A24 — MEASURED, one seed]
- #2 at 1 attempt (79.9%) beats baseline at 5 attempts (77.1%). [D2 — MEASURED]

**Two refinements that are not yet arms:**
- **D1 one-knob back-substitution.** Pin the violated knob, re-solve the free one for calories,
  keep the best of {raw corner, two back-substitutions}: in-gate 35.81% → **42.91%**, 83 rescues /
  0 regressions, and it *reduces* floor pinning 586→542. **Per-(recipe,target) pair — NOT a
  days-in-band figure.** [D1 — MEASURED]
- **D1 in-gate composition steering.** Among box points already passing the kcal/protein gate,
  **97.6% of slots have a strictly better point on composition** (carb error median 14.19g→0.87g).
  Because every alternative must pass the existing gate, **this cannot raise the warned-slot
  count** — the exact regression unconstrained `wls2` pays. [D1 — MEASURED]

---

## 3. The overshoot mechanism, in causal order

1. **The accept gate is 2-macro; the verdict is 4-macro.** Fat and carbs only *rank* candidates
   that already cleared kcal ±15% / protein-shortfall ≤12% (`weeklyPlanner.js:630`, `:634`, `:651`).
   [D2 — MEASURED]
2. **The portioning solve is provably blind to fat and carbs.** 250 trials, one-recipe pool, two
   targets identical on kcal/protein and opposite on fat/carb: **207/207 resolved slots produced
   byte-identical grams, max fat difference exactly 0.** When interior, the 2×2 hits kcal and
   protein exactly, so fat and carb are *fully determined* at that point — carrying composition
   into the solve is necessarily a **change of objective**, not a spare argument. [D1 — MEASURED]
3. **The clamp is not a solve.** `:413-414` clamps each coordinate of the unconstrained solution
   independently. The exact solution is outside the box **77.5%** of the time, and in **94.8%** of
   those the clamped point is strictly worse than another point in the same box **on the solver's
   own accept rule**. 13.7% of all plausible pairs had a feasible in-gate point the clamp missed.
   22.5% of non-degenerate pairs want a physically meaningless *negative* bundle. [D1 — MEASURED]
4. **Nothing penalises an over-sized portion except calories.** `proteinShortfallPct` (`:426-428`)
   is one-sided; `kcalOffPct` (`:420-422`) is two-sided. Floor-pinned slots clear the gate 37.3% of
   the time vs 26.6% for ceiling-pinned; **50.9% are over on protein by >12% yet unpenalised**;
   median fat vs a 28%-of-kcal ask is **+74.5%**. The a-priori geometry is near-symmetric
   (22.98% low-only vs 20.23% high-only) — **the asymmetry is created by the search, not the
   library.** [D1 — MEASURED] **Do not fix by symmetrising protein — that removes the symptom's
   cover, not the cause.**
5. **The closest-miss fallback spends the fat.** It ranks on `max(kcalOff/0.15, proteinShort/0.12)`
   — fat and carb absent. 17.9% of shipped slots, but **51.5% of all slot-level fat overage**
   (6.6 g/slot vs 1.2 g elsewhere). [D2 — MEASURED]
6. **Only 6.2% of slots find anything within `COMPOSITION_GOOD_ENOUGH`;** median best-available
   composition distance is 0.203. The loop already picks the minimum — **the shortlist is the
   binding constraint, not the search.** [D2 — MEASURED]
7. **Small slots cannot be filled at all.** 0–150 kcal: 32.0% unsolved, **median fat +108.1%** vs
   ask. 150–250 kcal: 11.5% unsolved, +89.1%. 500–700 kcal: 1.4% unsolved, +1.5%. [D2 — MEASURED]
8. **The worst offender is scheduled last.** All meals then all snacks (`:145-157`). The day never
   recovers: cumulative fat ratio 1.13→1.17→1.19→1.26→1.29→1.32→**1.40**, monotone. 238 slots are
   solved with `fatTarget` already floored to 0 and still ship a median 8.4 g. [D2 — MEASURED]

---

## 4. The library — what's actually wrong with it

**Target-side infeasibility explains ≈0 points.** Under the rule the app grades on, 248/250
personas (99.2%) are expressible; the 2 failures are one IMPOSSIBLE-tier vegan and one HARD
vegetarian. Third independent route to A12/A15's conclusion. [D7 — MEASURED, exact LP/HiGHS]

**The density gap is real but nearly inert.** Target protein median 8.16 g/100 kcal vs meal-pool
6.35; target fat 2.60 vs 4.02. But `r(demanded protein density, in-band rate) = −0.057`; only the
bottom quintile of usable pool slice bites (51.9% vs 70.1%), worth **≈3.4 points** against a
3.45-pt detection floor — **it may measure as zero.** [D7, D5 — MEASURED]

**A third of the "pool" is unservable.** `weeklyPlanner.js:185` bars dessert/beverage/bread/
condiment from meal slots — **163 recipes (17.9%) can be placed in no slot the solver builds.**
Vegetarian: 401 survivors → 267 servable, 134 servable nowhere. [D5 — MEASURED]

> **This invalidates A11's per-diet density table.** Vegetarian's meal-eligible protein median is
> **5.30, not 3.25**, and every low-density recipe A11 named (Churros 0.51, Eton Mess 0.64,
> Bulgarian Honey Cookies 0.79, Lamingtons 0.87) is `mealCategory = dessert` and **already barred**.
> **Authoring vegetarian desserts would change nothing.** A11's *structural* claim survives.

**The snack slot is starving, and its misses are provably pool-caused.** **18 snack-eligible
recipes in the whole library** (vegan 5, keto 4, carnivore 1). Only 2 of 18 meet the target fat
median; snack-pool fat density 5.58 is the worst set in the library at 2.1× target. The slot
carries 11.6–28.2% of the day's kcal and 192/250 personas request it.
`slotAttemptBudget(pool) = clamp(floor(pool/10),5,20)` **exceeds the candidate count for every
diet** and draws are without replacement, so **the snack slot is searched exhaustively with no
fallback to meal recipes** — whatever it misses, the pool caused. 6 of 53 week-horizon snack
personas cannot arithmetically fill their slots. 141 of 193 empty slots are snacks.
[D5, D2, D7 — MEASURED, three independent routes]

**The solver suppresses the only recipes in the target box.** `GENERATED_TEMPLATE_WEIGHT = 0.35`
(`:220`) down-weights 158 `High-Protein …` templates at draw time. Templates: **9.71 g P / 2.12 g F
per 100 kcal.** Rest of meal pool: 5.28 / 4.73. Target: 8.16 / 2.60. For vegetarians **40 of 41**
high-protein-lean recipes are down-weighted templates; only **5 of 439 imported recipes** are in
the corner. Removing the down-weight moves target-corner draw mass 12.7%→21.7% (P(≥1 of 5 draws)
49.3%→70.5%). [D5 — draw mass MEASURED, causal step ESTIMATED]

> The 0.35× exists for a real defect (near-clone weeks). **The anti-monotony rule and the
> compliance target are in direct conflict because the library has almost no genuine
> high-protein-lean dishes.** Only authoring dissolves it; picking a side does not.

**Pool attrition is honest.** The gate removes 56.1% of the library; precision defects account for
**0.5 pp**. Fixing all 30 named false exclusions recovers +4.8 recipes on the mean pool and
**exactly 0 for the 42 most-starved profiles.** **Gate precision is not the headroom.**
[D6 — MEASURED]

**Keto's 5.8% survival is not the gate** — all 857 keto exclusions are the whole-recipe carb
ceiling (`dietaryFilter.js:1851`). Recipe supply, not filtering. And **1 of 49** keto meal recipes
clears the fat band. **Do not attack keto with protein.** [D6, D5 — MEASURED]

**Recipe caches are clean** — the 07-31 repass closed it (worst kcal drift 0.19%). "Recompute
recipe caches" is a no-op today. **81 food rows remain genuinely untrustworthy** (not 230 — 149 are
repaired rows retaining a historical note). All 81 are used in recipes; 146 recipes touched; 39
draw >25% of their protein from one. Still shipping: **Raw tiger prawns 56.5 g carb/100 g**
(prawns have no carbohydrate), **Star Anise 337 kcal / 17.6 g P** (43% of Beef Pho's calories),
Lamb Stock 193 kcal/100 g. **47 meal recipes can never serve any slot** at 0.5–2× (Tahini Lentils
stored as 11,825 kcal / 8,920 g; Grits as 13 kcal). 94.3% of the food library is inert to the
solver. [D5 — MEASURED]

---

## 5. The macro closer

**Add-only, and a strict no-op on the dominant failure.** Proved structurally (every write is
`+=`, `macroCloser.js:130-135`) and empirically (4,000-day fuzz, **0 reduction events**). On fat
over band / kcal +25% / carb over band it returns `added: (nothing)`, delta 0/0/0/0. [D3 — MEASURED]

**Reachability wall: 10 rows of 14,151 = 0.07%.** Protein ≥40 g/100g → 87 rows exist, **0
reachable**. Carb ≥60 & fat ≤3 → 628 exist, **0 reachable**. For vegan+soy+legumes maximum protein
delivery is **0.0 g**. Keto has **zero** carb adjusters in every configuration; carnivore+dairy has
one adjuster total. `ADJUSTER_CANDIDATES` is a hardcoded ten-name list at `planContext.js:167-178`.
[D3 — MEASURED]

**But "one name dissolves every remaining proof" ≠ "rescues the tier"** — A16 measured one row
rescuing only **4 of 65** IMPOSSIBLE-tier misses. [D10 — MEASURED]

**The gate binds in exactly one place** (18 vegan profiles with no protein adjuster); all 10 rows
pass for every other profile. **The hardcoded list is the constraint, not the gate.**
[D6 — MEASURED, corroborating D3 from the opposite direction]

**Three unnamed defects:**
- **`wouldHarm` has a hole.** `check()` returns `isOver && !wasOver` (`:86-91`) — an *already*
  out-of-band macro is unprotected. Measured: closing a protein gap pushed fat 95 → 100.2 g against
  a 55–70 band. Its own docstring says *"'No worse' is the whole rule."* [D3 — MEASURED]
- **`_adjusterFoods` has no invalidation path.** `invalidateRecipeLibrary()` (`planContext.js:96-100`)
  clears three caches but not this one — a **quarantined** row keeps being added for the process
  lifetime. [D3 — MEASURED]
- **All adjusters land on slot 0.** 353 g appended to a 300 kcal breakfast (→922 kcal) while the
  scale knobs stay unchanged — reintroducing the "625 g chicken" defect the module exists to
  prevent. [D3 — MEASURED]

**Scope surprise:** the closer runs on **exactly one** surface (`/plans/generate`).
`generateDayCandidates` calls `solveDay` with 11 positional args, omitting `adjusters`
(`mealSolver.js:496`, `:531`) — the Plan tab's day-options card and the week Generate button have
**different solving capability**. [D3 — MEASURED]

`macroCloser.js` is **untracked in git and has zero tests.** 8 of 10 adjusters are
`source: "manual"` with `fdcId: null`. [D3 — MEASURED]

---

## 6. Honesty and silent misses

**On `/generate` the constitution holds.** 173 out-of-band days, **0 silent misses, 0 verdict
disagreements, 173/173 carrying a binding key, 65/65 runs with a miss carried a diagnosis.**
The "dropped diagnosis" note in the project docs is **stale** — `plans.js:412` forwards
`diagnosis`, `:401` `matchPct`, `:409` per-day `miss`, and of 100 weeks shipping
`diagnosis === null`, **0 contained an out-of-band day.** **Do not "fix" this.**
[D4, D8 — MEASURED]

**The persistence layer throws it away.** `Plan`/`PlanSlot` (`schema.prisma:493-527`) have no
column for a day verdict; `genMeta` is React state (`PlanTab.jsx:750`). **On tab switch or restart
every miss line is gone.** What survives is the 2-macro slot warning — and **66.6% of out-of-band
days have kcal and protein both fine, so that gate structurally cannot fire.** 30.6% of bad days
end up fully silent. `TodayTab` never renders `slot.warning` at all, and its fat rail is
`kind="floor"` so over-fat can never tint. [D8 — MEASURED, 234 weeks / 1,638 days / 7,602 slots]

**Warnings quote numbers that no longer exist.** `closeDayMacros` runs at `weeklyPlanner.js:951`
and mutates macros at `macroCloser.js:159-162`, but the warning was formed at `:661-671` and is
never recomputed. **33 of 621 adjusted slots quote a calorie figure the slot does not have** (31 off
by ≥50 kcal, worst 684) — one reads *"landed 481 kcal vs a 329 target"* on a slot storing **638**.
The warning *understates* the overshoot. [D8, D3, D10 — MEASURED, three independent routes]

> **The day-level ordering is already correct** (closer runs before `scoreWeek` at
> `mealSolver.js:680`), so A17's disqualifying regression does not apply to the shipping closer.
> **A trimmer belongs in exactly that slot.** The correct pattern already exists: the brain gap-fill
> runs before the diagnosis and **rescores** when it changes anything (`mealSolver.js:723-741`).

**Three silent-miss vectors, all the same shape** — a degenerate or absent target makes the
percentage functions return 0, so everything passes:
1. **Non-finite target → half portion.** `clamp` (`:294`) falls to `min` — **0.5, not 1**. A
   `kcalTarget` of 0/NaN/Infinity **ships a half portion with `warning: null`**. An *infinite* ask
   produces the *smallest* plate. Reachable from `brain/tools.js:74`, whose schema requires only
   `recipeId`. [D1 — MEASURED]
2. **Locked slot at 100% of budget.** Floors `budgetKcal` to 0 → `kcalOffPct`/`proteinShortfallPct`
   return 0 for every candidate → **accept gate passes unconditionally**, first draw ships,
   `targetRatio=0` biases toward the *lowest*-protein dish. Result: **2953 kcal on a 2000 kcal day,
   123 g fat on a 55–65 g band, zero slot warnings.** 100% and 130% locks are indistinguishable.
   No total-budget guard at `routes/plans.js:294-298`. Invisible to every fleet number (0 of 250
   personas lock). [D2 — MEASURED]
3. **Below-floor solves are clamped silently.** No rejection, no flag; the result object has **no
   field matching `/pin|bound|clamp|limit|floor|ceil/`**. Floor-pinned slots land median **+19.3%**
   over target (p90 +54.6%). [D1 — MEASURED]

**Server-side trust holes:** `/accept-day` and `/apply` take `warning` **from the client**
(`plans.js:110`) — the only field on that path not recomputed, while macros, grams and pool
membership all are. `/place-recipe` writes **`warning: null` hardcoded** (`:625`). `setGenMeta` is
never cleared on mutation, so after a swap the card shows the **pre-edit** week's verdict.
[D8, D4 — MEASURED, two independent routes on `:110`]

**`/day-options` ranks a miss above a pass.** `generateDayCandidates` sorts on `matchPct` alone
(`:504`), unlike the week planner. Demonstrated: an out-of-tolerance day (protein 16% short) scores
**95** and is offered first; an in-tolerance day scores **77** and may not be offered at all. The
fleet only ever called `/generate` — **this surface is entirely unbenchmarked.** [D4 — MEASURED]

**`alternatesForSlot` never sorts.** `options[0]` was not the best-scoring option in **134 of 200
draws (67%)**, yet `mealSolver.js:1388` and `plans.js:260` both call it `best`. [D4 — MEASURED]

**A swap cannot rebalance a day and does not try.** `regenerateOneSlot`, `alternatesForSlot` and
`fillGapsWithBrain` all solve against **static shares with no fat/carb target and no
carry-forward**. [D2 — MEASURED]

---

## 7. Safety — findings that are not about compliance

**The allergen columns are empty.** `allergenTags` and `mayContain` are **NULL on 100% of all
14,151 rows** (raw SQL). The gate falls back to name + `fdcCategory` for bare foods. Consequence:
**`Nutritional powder mix (Isopure)` — a whey isolate — returns ALLOWED for whey, dairy, milk AND
vegan.** 6 of the 11 high-protein survivors are generic protein-powder composites. **"Passes the
gate" is not evidence of safety here; the gate is failing open.** Spirulina (single-ingredient,
`Vegetables and Vegetable Products`) is a sound widening target; treat `Protein and nutritional
powders` as blocked pending FDC resolution. D3 marks its own ALLOWED verdict **unproven, not
wrong.** [D3 — MEASURED]

**Paired USDA categories over-fire** (`dietaryFilter.js:1585`). `"dairy and egg products" →
["dairy","egg"]` means an **egg-allergic user loses every cheese and cream dish**.
`"finfish and shellfish"` cross-fires **Shrimp→fish across 32 recipes**. The code comment defends
this as a backstop because "the name is checked first and independently" — **that precedence does
not exist**; `:1802` is a plain union. [D6 — MEASURED]

**The gluten-free grain guard covers `flour`/`tortilla`/`cereal` but not `pasta`/`noodle`** —
excluding all **57 purpose-built `High-Protein … with Lentil/Chickpea Pasta` recipes from celiacs,
and they are gluten-free.** The library's best high-protein assets are hidden from the users who
most need them. [D6 — MEASURED]

**Corrupted food rows are laundered into allergen evidence.** `Cinnamon` carries
`fdcId 171849 "Bread, cinnamon"` → Baked Products → gluten, across 38 recipes. **Fix the rows, not
the gate.** [D6 — MEASURED]

**Also false-excluded:** `Ground Nut Oil`→tree nuts (groundnut = peanut = legume; the peanut↔
tree-nut conflation is live **in the gate**, not only in `oracle.mjs`); `Kidney Beans`→vegan (organ-
meat keyword); `flax eggs`, `vegan butter`, `Oyster Mushrooms`, `soya milk` (the qualifier list has
`"soy"` and word-boundary matching never reaches `"soya"`). [D6 — MEASURED]

**Structural:** `WORD_GUARDS` is a denylist of exceptions to a denylist — the exact structure this
project's own `CLAUDE.md` indicts for the installer payload. **It will keep producing one of these
per vocabulary expansion.** [D6 — INFERRED]

**Verified sound:** the style lattice holds (`vegan ⊆ vegetarian ⊆ none`, `carnivore ⊆ none`, zero
violations over all 910 recipes and 14,151 foods, computed as allowed-sets rather than read from
test assertions). The step-text probe is **not** the cost (91–99% of exclusions rest on a real
ingredient row) and it closed the Sushi/Banh Mi/tahini leaks — **leave it alone.** [D6 — MEASURED]

> **D6 states against itself:** its method reads what was *removed* and is therefore structurally
> incapable of finding leaks. **This is not evidence the gate is safe.**

---

## 8. Correctness bugs in the target (not compliance bugs)

**`ASSUMED_BODY_FAT_PCT = {M:21, F:28}` (`bmrEngine.js:283`) is used for 147 of 250 personas**, 86
of them BMI ≥ 30. On that path the protein prescription collapses to a **constant g/kg of total
bodyweight** (2.081 M / 1.897 F) — no body-composition information survives. Benchmarked against
Deurenberg: median inflation **+21.1%**, **+32.2%** at BMI ≥ 30, max **+96.1%** (p004: 273.5 g asked
vs 139.5 g corrected).

> **Sharpest number in the study: 37 of those 147 personas demand a protein density above the
> pool's p90. Under corrected lean mass, that count is ZERO.** [D7 — MEASURED]

It compounds: protein and fat are LBM-anchored (numerator up) while calories clamp to `RMR×0.95`
(denominator down), so **106 of 250 personas are prescribed >35%E protein**, max 53.5%E. **All 9
carb-floored personas are assumed-BF and all 9 are female** — the worst failure mode is sex-skewed.

**The constant itself is fine — do not touch it.** `lbmLb × 1.14/1.25` = 2.513–2.756 g/kg LBM,
inside Helms/Aragon/Fitschen's published 2.3–3.1 g/kg. Against bodyweight: median 2.03 g/kg, never
below 1.42. **The input is broken, not the constant.** **Safety tension:** a Deurenberg correction
*alone* drops 8 of 147 below 1.2 g/kg actual bodyweight (worst 0.97) — any fix must pair a better
body-fat estimate with an absolute ≈1.2 g/kg-actual floor. [D7 — MEASURED]

**The ask does not add up to itself.** `CARB_MIDPOINT_BUFFER_G = 25` puts the sum of the three
macro midpoints a median **99.5 kcal below** `targetKcal` — **29.8% of the day's one-sided calorie
allowance spent before a recipe is chosen** (p90 47.9%). Because food obeys Atwater, that exact
4-vector is only reachable using recipes whose stated kcal *exceeds* 4P+9F+4C: **269/910 recipes
carry positive Atwater residual, and the nominal ask is unreachable for 59/250 personas even fully
relaxed.** The ones that work are rescued by fibre, alcohol and data error. This is also the one
finding where correctness and the metric point the same way (A15: +2.7 pts). [D7 — MEASURED]

**The carb floor is graded at half the engine's own floor.** `NONKETO_CARB_FLOOR_G = 50` exists to
stop a plan silently becoming ketogenic, but the emitted band is `carbMid ± 12` and the grader
allows a further `−0.25·cMid`: **all 9 carb-floored personas have a graded carb floor of
24.8–25.5 g.** 28/232 non-keto personas sit below 50 g. [D7 — MEASURED]

**The slot carry-forward can manufacture an impossible ask.** `weeklyPlanner.js:917-918` clamps
kcal and protein **independently** at ±30%, so the *ratio* is unclamped — a slot can be asked for
1.857× the day's density. Nominal share: **0/250** above pool max. Worst-case carry: **29/250 above
pool MAX, 99/250 above p99.** [D7 — MEASURED]

> Nuance: **turning within-day carry-forward completely off measures +0.00** [−2.93,+2.93], b=c=32,
> contradicting the justification in the code's own comment at `:106-111`. The carry manufactures
> bad asks in the tail without moving the aggregate. [D2 — MEASURED]

---

## 9. Tolerance algebra — hand-derived, use these

Derived from constants only, then differential-tested on **578 real days + 84,800 synthetic + 8
degenerate probes, 0 disagreements**. [D4 — MEASURED]

```
kcal     |total − target| <= 0.15·target                       symmetric
protein  total >= 0.85·pMid                                    ONE-SIDED, no ceiling
fat      [ fatLo − 0.25·fatMid , fatHi + 0.25·fatMid ]         symmetric about mid
carb     [ carbLo − 0.25·carbMid , carbHi + A·carbMid ]        A = keto ? 0 : 0.25
```

Effective relative half-width `E = h/mid + 0.25`:

| macro | path | E | measured min/med/max | days |
|---|---|---|---|---|
| fat | default | **33.11%** | 31.90 / 33.16 / 34.43% | 509 |
| fat | keto & carb-floored | **35.89%** | 35.48 / 35.93 / 36.11% | 50 + 19 |
| carb | non-keto | `12/carbMid + 0.25` | 26.6 / 31.7 / 49.5% | — |
| carb | keto | short 75%, over 0% → `5…30 g` | — | 50 |
| protein | all | −15% of pMid, **+∞** | — | — |
| kcal | all | ±15% | — | — |

**"Looser than the NASEM AMDR" is right about width and misleading about position.** For a
median-calorie persona the graded window is **14.6 %E … 29.0 %E** against AMDR's 20–35 %E — it
admits days *below* the AMDR floor and rejects days *inside* AMDR. "The ruler is too tight" is
dead; "the ruler is fine" is not what this shows. Also: keto/carb-floored fat is graded 1% off the
prescribed midpoint, and `hasBand` lets `fatHi === 0` go unjudged entirely. [D4 — MEASURED]

**`SCORE_WEIGHTS` reports; `dayTolerance` decides.** A18's 0.00-pts result is correct for
`SCORE_WEIGHTS` and **does not generalise to the file**: `dayTolerance()` is the primary selection
key of best-of-5 (`:686`) and the early exit (`:696`); 77 of 212 runs (36%) exhausted all 5 attempts
and were decided by `daysInTolerance`. `scoreDay`'s `fatInRange`/`carbInRange`/`kcalErrPct`/
`proteinShortPct` are **dead fields** with zero consumers repo-wide. [D4 — MEASURED]

**`compositionReach()` is unsound.** The convex-hull argument is correct; the gram conversion
(`:1047-1048`) evaluates at the **exact** calorie target while the day only needs ±15%, so the
tested interval is a strict subset and `unreachable` false-fires in both directions by ~15%.
Reproduced: a pool landing 67.8 g at 2040 kcal — inside the kcal gate and inside the 39.3–78.8 g fat
window — declared *"no mix of these recipes reaches the band."* [D4 — MEASURED]

**Binding attribution lies 15.2% of the time.** `classifyBinding` evaluates PROTEIN_DENSITY at
`:1121` **before** the composition branch at `:1131`, and every branch above `:1131` ignores
`observed`. The prose `reasons[]` stays truthful; only the machine-readable key is wrong.
[D4 — MEASURED]

---

## 10. Instruments — what can measure a fix

**Reproduce the baseline in-session. Never inherit one.**

```
# 1. pin the tree and the data
git diff --stat > /tmp/tree.txt ; sha256sum backend/prisma/dev.db
# 2. rig integrity
node docs/surgery/CAMPAIGN/solver-brain/A1/rig/checkdb.mjs <ID> --fix
# 3. YOUR OWN baseline, three seeds
node A1/rig/runRig.mjs --agent=<ID> --pop=personas --seed=424242
node A1/rig/runRig.mjs --agent=<ID> --pop=personas --seed=20260730
node A1/rig/runRig.mjs --agent=<ID> --pop=personas --seed=8675309
# 4. treatment at the same three seeds, then
node A1/rig/compare.v2.mjs <base> <arm>
```

**Gates:** instrument checks all zero · no comparability-problem block · silent misses not risen ·
**all three denominators reported with `unjudged` counts for both arms** · paired McNemar only ·
same sign at all three seeds · oracle-zero is **not** a leak pass · cite the HTTP fleet for
*levels*, the rig only for *deltas between its own runs*. [D9]

**A defect inside the recommended rig.** `A1/rig/schema.mjs:83` sets `judged: filled.length > 0` —
**16 days are dropped from the denominator, all 16 satisfiable, all 16 total failures with zero
slots filled.** The rig's primary denominator discards its own hardest cases, so **a treatment that
refuses more days would raise the reported rate.** That is C21's self-scoring trap living inside the
instrument. **Fix: promote `compare.v2.mjs`'s all-planned-days line (n=639) to a mandatory
co-report.** [D9 — MEASURED]

**Name your denominator.** Published values across this campaign: **495, 502, 526** (fleet, three
impossible-tier rules) and **536, 537** (rig). They are never interchangeable. [D9]

**Minimum detectable effect.** A treatment is real at 95% when **`|b − c| > 1.96·√(b + c)`**
(validated against all five available comparisons). On n≈537: churning treatments need **≥3.5 pts**;
one-directional needs **b ≥ 9**. **77 → 85% is ~43 flipped days and comfortably measurable.
77 → 79% is not measurable as a single treatment.** [D9 — DERIVED]

**Population is `personas.mjs`, definitively** (250/250 rows cross-checked, 0 mismatches):
carnivore 0.8%, unrestricted 50%, tiers EASY 60 / HARD 25 / IMPOSSIBLE 10 / ROBUSTNESS 5, 74%
single-day horizons, 101 free-text walls. `genProfile.mjs` samples **uniformly** — carnivore 10.6%,
a **13× over-sample of the worst-served diet** — and is blind to horizons, free-text walls and the
denominator argument. **Keep `genProfile` for crash fuzzing only.** [D9 — MEASURED]

**Test verdicts:** [D9 — MEASURED]
- `golden/engine-baseline.golden.json` — **theatre.** Locks 3/7 days in tolerance, 5/21 slots empty,
  avgMatch 61; identical across pre-composition-bias, HEAD and regenerated. The documented response
  to both improvement *and* regression is `REGEN`. Keep only its derived-section-list assertion.
- `solverHonesty.test.js` — **trustworthy, wrong axis.** Best-built file in the suite, with a live
  anti-vacuity guard. But a solver shipping 0/7 days with perfect miss lines passes everything.
- `exclusionGate.test.js` — **trustworthy**; its source-grep ratchet is the most valuable
  non-vacuous test in the repo.
- `dietaryFilter.test.js` — **theatre for coverage**; a 13-name synthetic pool that cannot detect
  the known leak class by construction.
- `tests/solverMacroTolerance.test.js:51-63` computes its expected boundary **from the constant it
  tests** — passes at any value. **The ruler is not locked by any test.** [D4]
- `runSolve.mjs` omits horizons *and* adjusters (74% of requests solved as the wrong shape);
  `mc.mjs` grades with a **third incompatible ruler** (5% kcal, no fat/carb term).

**`oracle.mjs` catches 11 of 25.** Every catch is an accident of USDA naming (`Squirrel`, `Bear`,
`Seal` only because the row contains "meat"). **The misses are the bare-noun rows, and they are the
high-protein ones** — Groundhog 28.1, Armadillo 28.1, Hog maws 26.5, Isopure 58.1 g/100 g — exactly
what a protein closer reaches for. Its `acceptOk` is ±5% kcal with no fat or carb term and **must
never share a table with "days in band."** A sufficient check needs identity classification stored
per Food row (failing closed on unclassified), enumeration of the **candidate set** not shipped
plates, both directions with a held-out safe list, and a genuinely independent axis (FDC group
codes / animal-only nutrients) rather than a second word list. [D9, D3 — MEASURED]

**Determinism holds** — re-running an identical rig command differs in `solveMs` only, 0 verdict
flips. Note `compare.v2.mjs`'s "byte-identical" line does not exclude `solveMs` and so under-reports
identity. **Determinism is reproducibility, not validity.** [D9 — MEASURED]

**Tooling hazard:** 3 NUL bytes in `dietaryFilter.js` (757:7, 760:27/34 — an intentional cache-key
separator from `0d3eaa5`, the *performance* commit) make the file invisible to `rg`, the Grep tool,
and `scanSecrets.mjs:84` — **silently**, while it still counts toward the "N files scanned" total.
**Every negative claim made about that file via Grep is void.** `git grep` and `Read` work.
Same for `backend/scripts/qc/fuzz.mjs` and `backend/tests/librarySync.test.js`. [D6 — MEASURED]

---

## 11. Dead — do not spend budget here

| claim | status |
|---|---|
| "The ruler is too tight" | **Dead.** Fat gate is ±33.11%, wider than AMDR's 27.3% relative half-width. Widening to ±50% buys ≤+4.0 pts. |
| "The 2.0× ceiling binds" | **Dead.** 66 of 70 bound misses are at the **0.5× floor**; none at the ceiling alone. |
| "Role tagging is a root cause" | **Dead as a lever.** An 86% repair of the dead-knob population moves **+0.0 to +0.6 pts**, sign inconsistent per diet; naive full retag is **−2.1 to −3.2**. Only 37 of 200 dead-knob recipes contain a mis-tagged protein; 163 are genuinely protein-less. A13's 73.3% vs 81.6% is correlation, not causation. **Fix for correctness; budget zero points.** [D5] |
| "Author vegetarian recipes; the pool is desserts at 2.42 g P/100 kcal" | **Dead.** Those recipes are `mealCategory = dessert` and **already barred from meal slots**. Vegetarian's meal-eligible median is **5.30, not 3.25**. |
| "`oracle.mjs` verifies leak-freedom" | **Dead.** 11 of 25, and the misses are the high-protein rows. |
| "The 83-day impossible tier" | **Dead.** 16 proved / 67 unknown / 495 SAT-certified = 578. |
| "`SCORE_WEIGHTS` retuning" | **Dead structurally** (b==c in 6 of 6 arms). |
| "Recompute recipe caches" | **No-op.** The 07-31 repass closed it; worst kcal drift 0.19%. |
| "Attack keto with protein" | **Dead.** 20 of 49 keto recipes clear protein; **1 of 49 clears fat.** A16 gained zero keto days in all five arms. |
| "Gate precision is the headroom" | **Dead.** All 30 named false exclusions recover +4.8 mean recipes and **0 for the 42 most-starved profiles.** |
| "`POST /plans/generate` drops the diagnosis" | **Stale.** Fixed and verified correct. Do not re-fix. |
| "Widen `SCALE_BOUNDS`" | **Refused.** Every measured gain is available inside 0.5–2, and the constant has 7 consumers, 6 hardcoded. |

---

## 12. Inflation traps — forbid these explicitly

1. **Never sum the lever table.** Hard cap +22.95 pts; naive sum +58.77 = 2.56× impossible.
2. **No lever may count a refused day as a compliant one.** Priced: shipping A3's own bound as the
   refusal rule buys **+4.94** (36 unproven days removed from the denominator); refusing the
   engineered tier buys +5.72 (28 certificated days); **re-badging `diagnose()` buys +27.94 pts and
   a perfect KPI with 186 false refusals and zero behaviour change.** The *sound* refusal buys
   **+0.00**. [C21 — MEASURED]
3. **Never use one object as both the ruling denominator and the refusal predicate.**
4. **Watch the rig's own denominator** (`schema.mjs:83`) — see §10.
5. **Don't mix net and gross day counts.** A22's (79/56/80) are *net*; A24's (87/84/61) are *gross*.
6. **`CLAIMS.tsv` is append-only with retracted rows and no status column** — row 332 is retracted
   by 336; 287–288 superseded by 322–323. A naive parse resurfaces dead numbers as live. [D10]

---

## 13. Constraints any fix must respect

**Correctness / safety**
- Nutrition sanity gate: kcal ≈ 4P + 4C + 9F within ~15%, or a documented exception.
- Hard calorie floor `max(RMR×0.95, 1500 M / 1200 F)` is constitutional and **currently correct**
  (250/250; for 42 of 60 clamped personas the binding term is `RMR×0.95`, not the sex minimum).
- **Do not lower the per-LBM protein constant to buy compliance** — it is inside Helms' published
  range; that trade is an automatic fail. Fix the body-fat *input*, paired with a ≈1.2 g/kg-actual
  floor.
- Provenance tags on every food (USDA-VERIFIED / LABEL / AI-ESTIMATED), never silently mixed. Any
  concentrate row added must be tagged **LABEL** unless FDC-resolved.
- **Do not widen the adjuster pool into `Protein and nutritional powders`** until the whey question
  is resolved — the allergen columns are 100% NULL and the gate fails open.

**Honesty**
- Solver declares "unsolvable + why"; silent target misses are forbidden. **Compute the verdict
  after the final portion** — that is what disqualified A17's trimmer.
- Totals must stay recomputed from shipped grams (asserted to 1e-9).
- The keto ceiling must still run on the final point, and refusal must remain available.

**Design (constitutional colour laws)**
- **No red, ever, on food or body data.** Over target = calm amber `--warn` + supportive
  re-planning copy. Never route a solver miss through `ErrorNote` (`Parts.jsx:309-312`, `C.red`).
- Green means on-target only; selection states are a lightness step.
- Fixed Okabe-Ito macro triad, always with P/C/F letter labels.

**Engineering**
- **Solver purity:** no `Math.random`/`Date.now`/`new Date` (`invariants.test.js:106`). Any search
  must be deterministic — fixed order, fixed step count. *Note:* the invariant greps for
  `Math.random(` as a **call**, and `mealSolver.js:461`, `:823`, `:1358` evade it with bare
  references, so `/day-options`, `/alternates` and `solveOneMeal` currently run on ambient RNG.
- **`SCALE_BOUNDS` has 7 consumers and 6 are hardcoded literals**: `mealSolver.js:791-792` and
  `:1397-1398` (both **diagnostics that would silently lie**), `brain/optimizer.js:18`,
  `routes/plans.js:103` and `:596`, `frontend/RecipesTab.jsx:51`.
- **`brain/optimizer.js:54-73` is a second independent transcription of the k=2 solve**, with its
  own bounds, and `tests/brain/optimizer.golden.test.js` asserts parity. Changing `weeklyPlanner`
  alone breaks it.
- Intervene in `weeklyPlanner.js`. `mealSolver.js` edits measured 0.00 pts — **except**
  `dayTolerance`, which is the best-of-5 selection key.
- Composition is 2–10× more rounding-sensitive than calories (carb p95 6.15%, max 63.2%), so any
  fat/carb-aware portioner must score on **rounded** grams.
- Report knob spread — the "625 g chicken" objection is a real acceptance criterion.
- The golden will fail on any solver change; regenerate deliberately, and know it has no quality
  axis.

---

## 14. Citation corrections — prior art points at the wrong lines

- **The composition target is NOT discarded at `weeklyPlanner.js:394`.** `:451` is a predicate
  (`hasCompositionTarget`); the target is **computed at `:898-899` and `:930-931`** in `solveDay`
  and **discarded at `:621` and `:503`** — the call sites. `:394` is only where `scaleRecipe` is
  *defined*. **A builder told to "pass the argument at L394" will edit a signature and find nothing
  to pass.** The substance is verified; the edit is at `:621`, and it is a change of objective.
  [D1 — MEASURED]
- `det` is `:404`, Cramer at `:413-414`. `round2` is defined `:295`, applied `:356`.
- **91.0% was wrong because it omitted the macro closer**, not because of A3's dead term — A3's
  SCALED bound is recipe-only by construction, so the dead `kcalPer100g` term never entered it.
  [D10]
- **97.2% is a proof that weakened, not a ceiling that rose** — 36 days moved INFEASIBLE →
  **UNKNOWN**, gaining no certificate. Say "16 provably impossible; 67 unknown in both directions."
- **The peanut↔tree-nut conflation is live in the gate**, not only in `oracle.mjs` as C19 implies.
- **A7's "zero vegan protein-concentrate rows" was a name-search artifact** — the rows exist. Its
  *conclusion* relocates from "the library" to `planContext.js:167-178`, a ten-line constant.
- **Three instances of a cross-check agreeing with a defect**, not two: `oracle.mjs` (C19); A20's
  audit copying A3's field names; A16's leakcheck silently inspecting 2,552 of 2,910 slots. D1 and
  D5 each caught a fourth and fifth **against themselves** and reported them. [D10, D1, D5]

---

## 15. Unmeasured — name these as gaps, do not fill them with assumption

- **`twoPass` fires on 0.0% of slots.** All 250 personas are 1-day or 1-week ⇒ one window. The
  entire second search pass, the freshness-first sort key, the horizon repeat cap and all
  cross-window logic are **completely unmeasured** — and when `priorUsage` is non-empty the search
  budget silently doubles *and* composition is demoted below freshness. [D2]
- **The adaptive target never fired in the baseline** (gated behind 21 days / 14 weigh-ins). Every
  number in this campaign describes the solver against a **formula** target. The adaptive target
  real users get from week 3 has **never been measured against the solver.** Across calls the drift
  is ±500 kcal over a 28-day plan (±25%, outside the ±15% gate) and ±1500 at 90 days;
  `mealSolver.js:926` names the risk but places the guard at 90 days while the engine moves the
  number every 7. [D7]
- **`/day-options` is entirely unbenchmarked** — the fleet only called `/generate`. [D4]
- **Locked slots at population scale** — 0 of 250 personas lock anything. [D2]
- **Plate realism in grams.** Everything is measured in scale ratios; **nobody has rendered the
  plates.** The 0.25× floor arm ships 35.5% of served satisfiable slots below the old floor. [D1, A13]
- **Whether the 07-31 repass changed any prior *delta*** — 261 recipes moved after every Phase-4
  delta was measured. [D5]
- Whether softening `GENERATED_TEMPLATE_WEIGHT` gains or loses days (draw mass measured, arm not).
- Metric effect of a corrected body-fat estimate — needs a **re-solve**, not a re-grade; D7's
  3.4-pt ceiling does not clear the 3.45-pt floor, **so it may measure zero.** [D7]
- The exact `dev.db` behind 405/578 is **not recoverable** — the fleet recorded no DB hash. Five
  agent directories still hash `e55f52e5`, but that cannot be *proved* to be the headline DB.
  [D9 vs D10 — contested; re-baseline rather than inherit]
- **Leaks.** No agent in this campaign used a method capable of finding a false negative in the
  dietary gate. Nothing here is evidence the gate is safe. [D6, self-reported]
