# A9 — Solve loop anatomy: where the search has freedom

*Agent A9. Persisted to disk by the fleet coordinator from A9's returned deliverable —
subagents cannot create report files (see C4 in `CORRECTIONS.md`). Content is A9's.*

**Headline (DERIVED, from code):** the solver has **two** portion knobs per slot, not one
— and both are **fully consumed by a 2×2 linear solve for kcal and protein before fat or
carbs are ever considered.** The assertion under test is false as written and true in
effect, and the difference changes what A13 should build.

**Second finding (DERIVED):** `macroCloser` — the one mechanism added to buy a new degree
of freedom — **can only ever ADD**, while the measured dominant failure is fat **OVER**
band. It is pointed away from the largest failure mode.

## 1. The assertion, verified and corrected

The L437 pointer is **correct**. `backend/src/lib/weeklyPlanner.js:437-439`:

> `// Fat and carbs are COMPOSITION — scaling a dish changes its calories, not its`
> `// fat-per-kcal — so the only way to steer them is WHICH dish gets picked`

A near-duplicate exists as user-facing copy at `backend/src/lib/mealSolver.js:436`:
`portion scaling moves a dish's calories, not its fat/carb ratio`.

**Both are false about the mechanism.** `applyScales` (`weeklyPlanner.js:334-357`) applies
two independent factors to two disjoint bundles — L336:
`const scale = !ing.scalable ? 1 : ing.role === "protein" ? proteinScale : sidesScale;`

With `P`, `R`, `F` the macro vectors of the protein bundle, rest bundle, and fixed
ingredients, the reachable set is `αP + βR + F`, `α,β ∈ [0.5,2]` — a **2-D cone in
4-macro space, not a ray.** Fat-per-kcal moves whenever `P` and `R` differ in fat share.

**The same file contradicts itself 70 lines earlier**, and that version is the correct one
— `weeklyPlanner.js:366-368`:

> `the carb-energy fraction that made the dish keto-legal at 1× is NOT preserved by`
> `the portion the user actually eats. a0d0d24 made the ceiling scale-invariant`
> `under UNIFORM scaling; it is not invariant under this solver's differential scaling.`

`enforceScaledCarbCeiling` (L377-391) then **steers carbs by scale alone**, walking
`sidesScale` down in `CARB_CEILING_STEP = 0.05` (L375) — shipped code doing what L437
calls impossible.

**Why it is nonetheless true in practice:** `scaleRecipe` (L394-418) does not search, it
**solves**. L404:
`const det = proteinBundle.protein * restBundle.kcal - restBundle.protein * proteinBundle.kcal;`
and L413:
`proteinScale = clamp((remainingProtein * restBundle.kcal - restBundle.protein * remainingKcal) / det, SCALE_BOUNDS);`

Two knobs, two equations (kcal, protein), unique solution when `det ≠ 0`. **Residual
freedom for fat/carb: exactly zero.**

**Corrected statement:** not "scaling cannot move fat/carb" but **"both knobs are already
spent on kcal and protein, so none are left to steer fat/carb."** For A13 this means
n-knob portioning is not adding a missing capability — it is adding **rank**. A 2-knob
**weighted least-squares over all four macros** needs no schema change and should be
priced first.

**Exception — the degenerate branch (L407-411):** when `proteinIngs.length === 0` or
`|det| < 1e-6`, it collapses to **one** knob, `raw = kcalTarget / recipe.kcal`, which
**ignores `proteinTarget` entirely**. For those recipes the ray premise is exactly right.
`backend/prisma/schema.prisma:446` (MEASURED by its author) gives role counts
`null 2788, carb 1711, veg 1528, protein 925, fat 271, other 17, dairy 4, fruit 1` — 7,245
rows, only **925 tagged `protein` across 889 recipes**, and a `null` role falls into the
*sides* bundle. **How many recipes hit the one-knob branch is unmeasured; it bounds
everything and A13 should measure it first.**

## 2. Degrees of freedom, enumerated

| # | Knob | Set where | Varies over | Cannot reach |
|---|---|---|---|---|
| 1 | Day solve order | `generateWeekPlan:995` `shuffled(dayIndices, rng)` | ≤7! orders | not steerable; variance source only |
| 2 | Recipe per slot | `pickRecipe:274-292`, called `resolveSlot:616` | eligible pool | gate-excluded, at `repeatCap`, or **not among the ≤20 drawn** |
| 2a | Draw count | `slotAttemptBudget:102-105` | `max(5,min(20,⌊n/10⌋))` | **>20 candidates/slot ever.** 400-recipe pool → **5 %** seen per slot |
| 2b | Draw weights | `pickRecipe:283` | product of 6 soft terms | a weight of 0 — nothing is vetoed here |
| 3 | `proteinScale` | `scaleRecipe:413`, applied `:336` | `[0.5, 2.0]` | **determined, not free**; no per-ingredient variation |
| 4 | `sidesScale` | `scaleRecipe:414` | `[0.5, 2.0]` | same |
| 5 | Gram quantisation | `practicalGrams:308-312` | 5 g steps ≥20 g, 1 g floor below | off-lattice amounts — see §3 |
| 6 | Keto carb trim | `enforceScaledCarbCeiling:377-391` | `sidesScale` **downward only**, 0.05 steps | upward; keto profiles only |
| 7 | Per-slot kcal/protein ask | `solveDay:917-918` | ±`CARRY_CAP_PCT` = **0.3** of nominal share | any ask outside ±30 % of the slot's weight share |
| 8 | Per-slot fat/carb ask | `solveDay:930-931` | remaining budget × share, **uncapped** | nothing — but it **only ranks**, never gates |
| 9 | Slot weights | `buildSlots:149-153` | `0.9/1.0/1.15` meals, `0.4` snacks | **hard-coded**; user controls only the counts |
| 10 | Best-of-N week | `generateBestWeekPlan:658` `attempts ?? 5` | 5 whole rolls | any week not producible by one whole roll — §4 |
| 11 | Day candidates | `generateDayCandidates:460` `count=3, attempts=9` | 9 rolls → 3 kept | dedup key `` `${s.recipeId}:${s.proteinScale}` `` (:497) **ignores `sidesScale`** — distinct portionings collapse |
| 12 | Macro closer | `macroCloser.js:108-181`, called `solveDay:951` | ≤3 additions, one host slot | **any reduction — §5** |

## 3. The quantisation is coarser than it looks (DERIVED)

`practicalGrams` is applied **per ingredient** (`applyScales:339`) and totals recomputed
from rounded grams, so effective granularity depends on base weight: 200 g → 0.025;
100 g → 0.05; **25 g → 0.20**; 12 g → 0.083; **6 g → 0.167**. A 25 g ingredient has only
~5 distinct values across the whole `[0.5, 2.0]` range. One 5 g step of a fat-dense
ingredient is ~45 kcal — not noise against a 2 g fat gap.

Also (ESTIMATED, worth checking): `applyScales:356` round2's the stored scale **labels**
while grams come from raw factors, so the persisted label can disagree with shipped grams
by up to 0.005×. Totals are recomputed from grams, so no kcal drift is implied — the label
is the lossy artifact.

## 4. Best-of-N throws away everything it learns (DERIVED)

`generateBestWeekPlan:685-691` selects lexicographically (`daysInTolerance`, then
`floorDaysMet` in priority mode, then `avgMatch`) over 5 whole-week rolls, early-exiting at
:696-697. There is **no crossover, no repair, no reuse of a good day from a losing week** —
~28 solved days discarded per generate. **A19's baseline should be per-day best-of-N**
(keep the best Tuesday across all rolls), which is a strictly smaller change than joint
optimisation.

Constraint A19 must not rediscover: `slotAttemptBudget` is capped at 20 *because* deep
per-slot search starves later slots in thin pools (documented L87-101, measured 6/7 → 4/7
days on a 36-recipe pool). Depth and greed already trade off.

## 5. The closer can only add — the dominant failure is "over" (DERIVED)

`macroCloser.js` builds its gap list from **shortfalls only** — L130
`Math.max(0, proteinMid - totals.protein)`, L133 `if (fat.short > 0 ...)`, L135
`if (carb.short > 0 ...)` — and `wouldHarm` (L75-97) only ever *blocks* an addition. **No
path in the module reduces anything.** Fat/carb bands are absolute grams
(`bmrEngine.js:322` `let fatLo = Math.round(lbmLb * 0.34);`), so adding food can only raise
a macro. The closer **structurally cannot fix an over-band day.**

Against `weeklyPlanner.js:228-230` (MEASURED by its author, 275-customer campaign):

> `fat was the single largest cause of an out-of-tolerance day — 59% of failing`
> `days, and 74 days were in band on kcal, protein AND carbs and failed on fat`
> `alone, every one of them OVER the band by a median of 49% of its midpoint.`

The closer's gain (65.9 → 70.1 % per the shared brief) therefore came from protein/carb
*shortfalls*; it never touched the largest bucket. **The symmetric "trimmer" is unbuilt and
unpriced — recommend A13 scope it.**

Further limits on knob 12: one host slot only (`:116`, first filled unlocked slot — no
choice of *where* the side lands), ≤3 additions (`:128`), and **10 hard-coded candidate
foods** (`planContext.js:167-178`) before the gate narrows further. `loadAdjusters`
(`planContext.js:204-215`) returns nothing in a role with no safe option — so the closer
silently no-ops for exactly the restricted-diet customers the brief reports at 58–62 %.

## 6. Handoffs

- **A10** — today's `scaleRecipe`/`applyScales` is the §1 2×2 solve plus the §3 gram
  lattice. Wiring surface already exists: `applyScales` is exported
  (`weeklyPlanner.js:1079`) and already called from a second site
  (`enforceScaledCarbCeiling:386`).
- **A13** — measure one-knob-branch coverage first; then price 2-knob weighted-least-
  squares over 4 macros *before* n-knob; then the trimmer.
- **A18** — weights at `mealSolver.js:127`
  `SCORE_WEIGHTS = { kcal: 0.46, protein: 0.3, fat: 0.12, carb: 0.12 }`. Note that scores
  *selection among weeks*; the per-slot gate is a different 2-macro rule
  (`KCAL_TOLERANCE_PCT = 0.15` :67, `PROTEIN_TOLERANCE_PCT = 0.12` :74) and the day verdict
  is a third (`dayTolerance:229-253`). **Three different objectives in one loop.**
- **A19** — §4.

## Blocker (recorded per BRIEF)

Copying `backend/prisma/dev.db` into an isolated A9 directory was **blocked** on both Bash
and PowerShell (`Copy-Item ... was blocked`). Not retried, not worked around. Consequence:
§1's role counts are quoted from the schema comment's own MEASURED figures, not
independently re-measured. **No number here was produced by running code, so A9 appends
nothing to `CLAIMS.tsv`.** Writing `A9/FINDINGS.md` was also blocked by the harness.

*Coordinator note: the copy block was the guard's `--force` rule matching `-f`/`-Force` in
the copy command. A plain `cp` without `-f` is not blocked — see C6 in `CORRECTIONS.md`.*

**CONFIRMED**
