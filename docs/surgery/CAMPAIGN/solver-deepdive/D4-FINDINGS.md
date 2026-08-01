# D4 — the grading / tolerance / scoring layer of `backend/src/lib/mealSolver.js`

Territory: the ruler, the score, the honesty layer, the binding classifier, candidate
generation, alternates, one-meal. **Not** the weeklyPlanner slot loop (D2) and **not** the
portioning algebra (D1). Read-only throughout: `backend/src/` untouched, `dev.db` never opened.

Scripts: `docs/surgery/CAMPAIGN/solver-deepdive/D4/` — `d4-algebra.mjs`, `d4-differential.cjs`,
`d4-honesty.mjs`, `d4-binding.mjs`, `d4-demos.cjs`, `d4-demos2.cjs`, `d4-demo5.cjs`.
Data: `docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/results.jsonl` (250 personas, 212 with a
solve, 578 judged days — the same file and the same 578-day denominator A15 used).

---

## 0. Headline

1. **The fat gate really is ±33.1 %, and I re-derived it from constants without touching
   `dayTolerance()`.** But the prior framing — *"looser than the NASEM AMDR"* — is only half
   right. It is looser in **relative width** and **shifted down** in **position**: on the
   median-calorie persona the graded window is 14.6 %–29.0 % of energy, so it *admits* days
   below the AMDR floor and *rejects* days inside the AMDR range. Calling it simply "loose"
   would send a build agent to tighten the wrong end.
2. **`SCORE_WEIGHTS` is a reporting layer on `/generate` — A18 is right — but `dayTolerance()`
   is NOT.** `dayTolerance()` is the **primary selection key** of best-of-5 week generation
   (`mealSolver.js:686`) and the early-exit condition (`:696`). Best-of-5 actually ran to
   exhaustion on **77 of 212 runs (36 %)** [MEASURED]. Anyone who reads "mealSolver is a
   reporting layer" as "nothing in this file decides" will be wrong about the one thing in it
   that does.
3. **`/day-options` uses a completely different, tolerance-blind selection rule** and has never
   been benchmarked. `generateDayCandidates` ranks candidates on `matchPct` **alone**
   (`:504`), so a day that **misses** tolerance is offered above one that **passes** it —
   demonstrated with concrete numbers below.
4. **The honesty layer's *presence* coverage is 100 %.** 173 out-of-band days, 0 silent misses,
   0 server/harness verdict disagreements, 0 missing miss-lines, 65/65 runs with a miss carried
   a diagnosis [MEASURED]. The constitution's "no silent target miss" holds. **Its
   *attribution* does not**: the machine-readable `binding` key is wrong on **5 of 33 (15.2 %)**
   composition-only runs, because a pool-shape heuristic pre-empts the composition branch.
5. **`compositionReach()` is unsound.** It proves impossibility at the *exact* calorie target
   while the day is only required to land within ±15 %. It therefore prints *"no mix of these
   recipes reaches the band"* about pools that demonstrably reach it — reproduced.
6. **`solveOneMeal` grades 2 macros, calls the result `fits`, and the UI paints it green**
   while displaying F and C chips that nothing checked.

---

## 1. The tolerance algebra, hand-derived

### 1.1 Method (and why it is not self-referential)

`d4-algebra.mjs` transcribes four constants by hand and derives the pass **windows**
algebraically. It never imports `mealSolver.js`.

Constants [MEASURED, `mealSolver.js:210-213`]:

```
DAY_KCAL_TOLERANCE_PCT    = 0.15
DAY_PROTEIN_TOLERANCE_PCT = 0.15
DAY_FAT_TOLERANCE_PCT     = 0.25
DAY_CARB_TOLERANCE_PCT    = 0.25
```

Band construction [MEASURED, `bmrEngine.js:294-359`]:

| path | fat band | carb band |
|---|---|---|
| default (`:322-324`, `:352-354`) | `round(0.34·lbm) … round(0.40·lbm)` | `max(carbMid−12,0) … carbMid+12` |
| keto (`:306-319`) | `round(fatMid·0.9) … round(fatMid·1.12)` | `10 … 30`, prescribed centre **25** |
| carb-floored (`:328-345`) | `round(fatMid·0.9) … round(fatMid·1.12)` | `carbMid = max(0, min(50, room))` |

Protein is always `round(1.14·lbm) … round(1.25·lbm)` (`:299-300`).

### 1.2 The rule, as windows [DERIVED]

`bandMiss` (`:218-225`) normalises the distance outside `[lo,hi]` by `mid = (lo+hi)/2`.
`dayTolerance` (`:229-253`) then compares each direction to its own allowance. Solving for the
pass set:

```
kcal      pass  <=>  |total − target|  <=  0.15 · target                     (symmetric, no band)
protein   pass  <=>  total >= 0.85 · pMid,  pMid = (proteinLo+proteinHi)/2   (ONE-SIDED, no ceiling)
fat       pass  <=>  total ∈ [ fatLo − 0.25·fatMid ,  fatHi + 0.25·fatMid ]
carb      pass  <=>  total ∈ [ carbLo − 0.25·carbMid , carbHi + A·carbMid ], A = keto ? 0 : 0.25
```

Because `mid` is by construction the midpoint of the band, the fat window is **symmetric about
`mid`**, and its relative half-width is

```
E = h/mid + 0.25        where  h = (hi − lo)/2
```

`hasBand` (`:227`) requires only `Number.isFinite(lo) && Number.isFinite(hi) && hi > 0`. A
target with **`fatHi === 0` is not judged at all** — 500 g of fat passes (probe verified).

### 1.3 Effective half-widths, per macro, per path

Symbolic (exact, ignoring `Math.round`) [DERIVED]:

| macro | path | band `h/mid` | **effective E** | pass window |
|---|---|---|---|---|
| **fat** | default | `0.03/0.37` = **8.11 %** | **33.11 %** | `0.2475·lbm … 0.4925·lbm` |
| **fat** | keto / carb-floored | `0.11/1.01` = **10.89 %** | **35.89 %** | `0.6475·fatMid … 1.3725·fatMid` |
| **carb** | default | `12/carbMid` | `12/carbMid + 0.25` | symmetric |
| **carb** | keto | `10/20` = 50 % | short **75 %**, over **0 %** | `5 g … 30 g` |
| **protein** | all | — | **−15 % of pMid, +∞** | `>= 1.0157·lbm` |
| **kcal** | all | — | **±15 %** | `0.85·target … 1.15·target` |

Empirical, over the 212 personas that solved (`d4-algebra.mjs`) [MEASURED]:

| bucket | n (personas) | n (days) | min E | median E | max E |
|---|---|---|---|---|---|
| fat, default path | 191 | **509** | 31.90 % | **33.16 %** | 34.43 % |
| fat, keto | 14 | **50** | 35.48 % | 35.93 % | 36.11 % |
| fat, carb-floored | 7 | **19** | 35.48 % | 35.94 % | 36.11 % |
| carb short, non-keto | 198 | — | 26.56 % | 31.74 % | 49.49 % |
| carb over, non-keto | 198 | — | 26.56 % | 31.74 % | 49.49 % |
| carb short, keto | 14 | — | 75.00 % | 75.00 % | 75.00 % |

The spread on the default path is pure `Math.round` jitter on `fatLo`/`fatHi`.

**Verdict on the prior claim: CONFIRMED with a correction.** ±33.1 % is right; the 509/50/19
day split reproduces A15's exactly; `0.2475·lbm … 0.4925·lbm` reproduces A12's exactly. Three
independent routes, same arithmetic. The claim *"`bandMiss()` divides by the midpoint and
`DAY_FAT_TOLERANCE_PCT = 0.25` stacks on top of the band"* is exactly what the code does.

### 1.4 Where the "looser than AMDR" framing misleads [DERIVED + MEASURED]

NASEM AMDR for fat is 20–35 %E: midpoint 27.5, relative half-width **27.3 %**. So 33.11 % is
indeed a wider *relative* window. But position matters more than width:

Median-calorie persona in the fleet (target 2 067 kcal, displayed fat band 46–54 g) [MEASURED]:

```
graded pass window        33.5 g … 66.5 g
as a fraction of energy   14.6 %E … 29.0 %E
AMDR                      20   %E … 35.0 %E
```

The gate **admits** days at 14.6 %E (below the AMDR floor) and **rejects** days at 30–35 %E
(inside AMDR). It is not "AMDR plus slack"; it is a differently-anchored window that happens to
be wider. A15 measured the consequence directly: on 96 of 526 satisfiable days the app's own
prescribed fat midpoint is already below 20 %E.

Two further location defects in the same family [MEASURED]:
- **Keto carbs**: prescribed centre 25 g (`bmrEngine.js:307`), graded centre `(10+30)/2 = 20 g`.
  The prescription is 25 % above the point the ruler measures from.
- **Keto/carb-floored fat**: `(0.9 + 1.12)/2 = 1.01`, so the graded centre is **1 % above** the
  `fatMid` the engine actually prescribed. Small, but it is an unintentional off-centre bias
  that exists on no other path.

### 1.5 Differential verification [MEASURED, `d4-differential.cjs`]

My window rule vs the shipped `dayTolerance()` + `dayInTolerance()`:

```
REAL DAYS : 578 judged,    0 disagreements
SYNTHETIC : 84 800 judged, 0 disagreements   (macros swept across every boundary)
PROBES    : 8 judged,      0 disagreements   (carbLo=0, absent fat band, keto edges, fatHi=0)
```

The hand derivation is the authority; this only proves I read the code correctly.

---

## 2. Decides vs reports — the definitive map of this file

| # | Symbol | file:line | Decides? | What it actually controls |
|---|---|---|---|---|
| 1 | `dayTolerance` / `dayInTolerance` | `:229`, `:256` | **DECIDES** | Primary key of best-of-5 week selection (`:686`) and the early-exit (`:696`). Also the published verdict. |
| 2 | `SCORE_WEIGHTS` → `scoreDay.matchPct` | `:127`, `:141` | **reports on `/generate`** | Enters week selection only as `avgMatch`, *after* `daysInTolerance` ties (`:691`). A18: 0.00 pts, b==c in 6/6 arms. |
| 3 | `SCORE_WEIGHTS` → `generateDayCandidates` | `:504` | **DECIDES on `/day-options`** | The **only** sort key for the 3 candidates the user is shown. Not tolerance-aware. Never benchmarked. |
| 4 | `scoreDay` inside `reviseDayWithCritic` | `:536` | **DECIDES when `BRAIN=on`** | Picks base vs critic-revised day (`brain/reviseDay.js:45,61`). Dormant at `BRAIN=off`. |
| 5 | `scoreWeek` | `:588` | mixed | Produces `daysInTolerance` (decides, via #1) and `avgMatch` (reports, #2). Correctly re-computes **exact** totals at `:603` rather than reusing `scoreDay`'s rounded ones. |
| 6 | `scoreDay.fatInRange` / `.carbInRange` / `.kcalErrPct` / `.proteinShortPct` | `:185-188` | **DEAD** | Zero consumers anywhere in `backend/src` or `frontend/src` [MEASURED, repo-wide grep]. |
| 7 | `dayMissLine` | `:265` | reports | Per-day plain-English miss. |
| 8 | `diagnose` | `:296` | reports | Pre-solve pool-shape reasons. |
| 9 | `diagnoseFromResult` | `:379` | reports | Post-solve reasons + suggestions. |
| 10 | `classifyBinding` | `:1063` | reports | The single machine-readable `binding` key. Rendered at `PlanTab.jsx:469-472` and `:189-193`. |
| 11 | `compositionReach` | `:1027` | reports | Feeds #10 only. |
| 12 | `varietyOutlook` | `:768` | reports | `meta.variety`, `plans.js:389`. Its reachability filter is kcal+protein only (`:789-792`) — a pool can be "sustaining" and still unable to reach the fat band. |
| 13 | `alternatesForSlot` | `:821` | **partly decides** | Its `matchPct` (`:853-859`, weights **0.6/0.4**, a fifth ruler) is display-only — but the returned array is **never sorted**, and `solveOneMeal` (`:1388`) and `plans.js:260` both call `options[0]` "best". |
| 14 | `solveOneMeal.fits` | `:1419` | **DECIDES the UI's green** | kcal+protein only. `PlanTab.jsx:150` `onTarget = oneMeal.fits === true` → accent green. |
| 15 | `generateBestWeekPlan` `better` | `:685-691` | **DECIDES** | The selection rule itself. |

### 2.1 Verification of the "reporting layer" claim [MEASURED]

Attempts distribution across the 212 solved runs:

| `attempts` | runs | all days in tolerance |
|---|---|---|
| 1 | 110 | 110 |
| 2 | 16 | 16 |
| 3 | 7 | 7 |
| 4 | 2 | 2 |
| **5 (exhausted)** | **77** | **12** |

- On **135 runs (64 %)** the early exit fired and best-of-N never chose — the ruler decided
  nothing because there was nothing to choose between.
- On **77 runs (36 %)** all five attempts ran and `daysInTolerance` picked the winner.
- On the **12** exhausted-but-clean runs, `daysInTolerance` tied at maximum and `avgMatch`
  (i.e. `SCORE_WEIGHTS`) alone chose — which is precisely A18's b == c structure.

**A18's claim is correct and I am not contradicting it**, but its scope must be stated as
*"`SCORE_WEIGHTS` cannot change the in-band count on `/generate`"*, not *"`mealSolver.js` decides
nothing"*.

### 2.2 A gap in prior work that a fix must not inherit [DERIVED]

A15 re-scored a **fixed** day set under alternative rulers. That measures the **band-shift**
component only. Because `dayTolerance()` is the *primary selection key* (`:686`), a genuinely
re-solved run under a different ruler would additionally re-select which of the 5 attempts
ships — an effect A15's method cannot see. A15 says this explicitly for
`CARB_MIDPOINT_BUFFER_G` (§ "Variant 6") but **not** for the fat variants, where it applies
identically. Treat A15's fat deltas as band-shift-only lower bounds of unknown tightness.

### 2.3 Demonstrated: `/day-options` ranks a miss above a pass [MEASURED, `d4-demos.cjs`]

Target 2 400 kcal, protein 182–200, fat 54–64, carb 168–192:

| candidate | verdict | `matchPct` |
|---|---|---|
| A — kcal +14 %, protein −14 %, fat at the line — **inside tolerance on all four** | `inTolerance: true` | **77** |
| B — protein **16 % short**, everything else perfect | `inTolerance: false` | **95** |
| C — kcal **+16 %**, everything else perfect | `inTolerance: false` | **93** |

`generateDayCandidates` sorts by `matchPct` alone (`:504`), so **B is offered first and A may not
be offered at all** (only `count = 3` of up to 9 survive). `generateBestWeekPlan` does not have
this bug. The two selection surfaces in the same file use incompatible rules.

Related saturation property [MEASURED]: `missTerm` caps at 1.0 (`:161-163`), so a day 3× outside
its fat band scores the same 88 as one exactly at the line, and the **floor** for a day failing
both composition macros is **76**. The `matchPct < 60` trigger at `:550` is therefore unreachable
by any fat/carb failure; only the `inTolerance === false` clause at `:555` catches those.

---

## 3. The honesty layer — real coverage

Measured over the fleet's 578 days / 212 runs (`d4-honesty.mjs`, `d4-binding.mjs`).

### 3.1 Presence: clean [MEASURED]

```
days judged                                          578
days out of band (harness's independent re-grade)    173  (29.9 %)
server/harness day-verdict disagreements               0
out-of-band days with no plain-English miss line       0
harness-flagged silentMisses                           0
runs with >=1 missed day                              65
  ...carrying a diagnosis                             65  (100.0 %)
out-of-band days whose run carried a binding key     173  (100.0 %)
empty (0-kcal) out-of-band days                       17, all 17 diagnosed
```

**The constitution's "solver declares unsolvable + why" holds on the `/generate` path.** The
undiagnosed-miss fraction is **0 %**. This is a genuine strength and a fix must not regress it.

Structural reasons it holds: `generateHorizonPlan:1296` fires on `anyMissed || unfilledSlots > 0
|| varietyBreached`; `generateBestWeekPlan:754` fires on `anyDayMissed || anyUnfilledSlot ||
floorMissed || noDaysAtAll`; `diagnoseFromResult:439-442` guarantees a non-empty
reasons/suggestions pair; `scoreWeek:603` grades on **exact**, not display-rounded, totals.

### 3.2 Attribution: not clean [MEASURED]

Failure shapes of the 173 out-of-band days:

| shape | days |
|---|---|
| fat only | 41 (**41 over, 0 short**) |
| carb only | 33 |
| kcal+protein+fat+carb | 18 |
| kcal+protein | 18 |
| protein+carb | 16 |
| kcal+protein+carb | 15 |
| everything else | 32 |

Run-level attribution of the single machine-readable `binding` key:

| check | result |
|---|---|
| runs where **every** missed day hit kcal+protein and failed only fat/carb | **33** |
| ...reported `binding = macro-composition` | 28 (84.8 %) |
| ...reported **`protein-density`** instead | **5 (15.2 %)** |
| runs reporting `snack-pool` | 19 — **19/19 genuinely had unfilled slots** (correct) |
| runs reporting `protein-density` | 8 — **5 of those had no day fail protein** |

**Root cause [DERIVED + reproduced, `d4-demos2.cjs` DEMO 4]:** `classifyBinding` evaluates the
`PROTEIN_DENSITY` branch at `:1121` **before** the composition branch at `:1131`, and every
branch above `:1131` ignores the `observed` argument entirely. Fed
`observed = {fatOffDays: 1, proteinShortDays: 0}` over a protein-thin pool, `classifyBinding`
returns `protein-density`. The prose `reasons[]` still says the right thing
(`diagnoseFromResult:432-438` is un-gated) — **only the key lies.** This is the same class of
defect the `MACRO_COMPOSITION` key was introduced to fix (`:1003-1012`), reintroduced one branch
higher.

### 3.3 `compositionReach` is unsound [DERIVED + reproduced, `d4-demos2.cjs` DEMO 3]

The convex-combination argument in the docstring (`:1018-1026`) is **correct**: a day's
fat-per-kcal is a kcal-weighted convex combination of its dishes' fat-per-kcal, so it lies in
`[poolMin, poolMax]`. The bug is the conversion to grams at `:1047-1048`:

```js
const reachLoG = poolLo * dailyTarget.kcal;
const reachHiG = poolHi * dailyTarget.kcal;
```

This evaluates at the **exact** calorie target. The day is only required to land inside
`±DAY_KCAL_TOLERANCE_PCT`, so the truly reachable gram interval is
`[poolLo · 0.85 · kcal , poolHi · 1.15 · kcal]` — strictly wider. The shipped test is a
**subset** of reality, so `unreachable` is a **false-positive-prone** verdict, in both
directions, by ~15 %.

Reproduced:

```
allowed fat window                                39.3 … 78.8 g
pool fat at EXACT target kcal (2400)              79.8 g   -> above the ceiling
pool fat at 0.85x kcal (2040, inside the gate)    67.8 g   -> INSIDE the window
classifyBinding says: "every one of the 14 compliant dishes carries more fat than your
54-64 g range allows ... no mix of these recipes reaches the band."   <-- FALSE
```

Two further biases in the same function, in the opposite direction:
- The scanned `pool` is **not filtered by slot type or eligibility** — desserts, beverages and
  condiment sides that `eligibleRecipes` would never serve widen `[poolLo, poolHi]` and make
  `unreachable` fire *less* often than it should.
- `perKcal = (Number(r[key]) || 0) / r.kcal` (`:1039`) turns a missing/NaN macro into a genuine
  `0`, dragging `poolLo` to 0.

Net: the interval is computed over an over-broad pool at an under-broad calorie point. Neither
error is a "safe" direction, and they do not cancel.

### 3.4 The honesty holes are outside `/generate` [MEASURED / DERIVED]

| surface | gate | file:line |
|---|---|---|
| `solveOneMeal.fits` | **kcal + protein only**, at the *slot* constants (0.15 / 0.12) | `mealSolver.js:1419` |
| — its UI | `onTarget = oneMeal.fits === true` → accent green, while F and C chips render unjudged numbers | `PlanTab.jsx:150,165-166` |
| — its list header | *"OTHER DISHES THAT FIT"* over `options.slice(1)`, none of which had `fits` computed at all | `PlanTab.jsx:175-176` |
| `/fill-today-from-cart` | **kcal only**, at a **hardcoded literal `0.15`** | `plans.js:670-673` |
| `/place-recipe` | **no gate at all** — stores `warning: null` unconditionally | `plans.js:625` |
| `/accept-day`, `/apply` | the warning string is taken **from the client, verbatim** | `plans.js:110` |
| QC oracle `silentMisses` | **kcal + protein only**, and protein against `proteinLo` not `pMid` — *looser* than `dayTolerance` (`0.969·lbm` vs `1.0157·lbm`) | `scripts/qc/oracle.mjs:196` |

D8 owns the route files; I am naming them, not claiming them.

---

## 4. The per-slot warning gate — exact location and what it must become

**It is not in `mealSolver.js` and not in `routes/plans.js` (except the cart path). It is in
`weeklyPlanner.js`.** [MEASURED]

| role | file:line | predicate |
|---|---|---|
| accept gate | `weeklyPlanner.js:630` | `kcalOff <= KCAL_TOLERANCE_PCT && proteinShort <= PROTEIN_TOLERANCE_PCT` |
| rank among non-fits | `weeklyPlanner.js:628` | `max(kcalOff/0.15, proteinShort/0.12)` |
| **warning emission** | `weeklyPlanner.js:661-670` | fires only when no candidate cleared the 2-macro gate; the sentence names kcal and/or protein |
| constants | `weeklyPlanner.js:67`, `:74` | `KCAL_TOLERANCE_PCT = 0.15`, `PROTEIN_TOLERANCE_PCT = 0.12` |
| AI-fallback variant | `weeklyPlanner.js:516` | same two macros |
| fat/carb, deliberately **not** a gate | `weeklyPlanner.js:430-471` | `compositionDistance` is a tie-break inside the fits list (`:634,651`), never an accept/reject |

Baseline amber, measured on the fleet [MEASURED]:

```
total slots returned            2 620
total warned slots                438  (16.7 %)
IN-tolerance days               405, carrying 116 warned slots — 78 days (19.3 %) show amber on a PASSING day
OUT-of-band days                173, carrying 322 warned slots — 125 days (72.3 %) show amber
```

**So the "more amber on days that now pass" cost C23 attributes to A13 already exists at
19.3 %.** A 4-macro portioning objective raises it because a portioner that trades a little
kcal accuracy for fat accuracy trips a gate that only measures kcal.

### What the gate would need to become

The naive fix — adding fat/carb to `:630` — is **wrong** and must be refused. Fat and carbs are
composition, not size; a portion cannot move them; a slot-level fat reject would discard fits
that the *day* absorbs fine, and `weeklyPlanner.js:435-438` says so in its own comment.

The defensible shape, in priority order:

1. **Keep the accept gate at `:630` on kcal + protein.** It gates what a *portion* can move.
   Do not touch it.
2. **Move the warning from slot-scope to day-scope.** Today `:661-670` emits a warning when the
   *slot* missed. It should emit when the slot's miss **survives into the day's verdict** —
   i.e. compute `dayTolerance` on the day the slot ends up in, and warn only on slots that are
   load-bearing for a failing macro. A slot 18 % under its kcal target on a day that lands
   inside ±15 % is not something the user needs to fix.
3. **Any 4-macro portioning change must ship this re-scoping in the same commit**, or the
   measured 341 → 405 warned-slot rise lands on the user as "the plan got worse" while the
   compliance number improves. That is a UX regression that will be read as a defect.
4. **Whatever is chosen must be the ONE gate.** `plans.js:671`'s hardcoded `0.15` and
   `plans.js:625`'s unconditional `null` must be re-pointed at it. There is no reason for a
   cart-filled slot to be judged more loosely than a solver-filled one.
5. `weeklyPlanner.js:516` (AI fallback) must move in lockstep or the brain's slots become the
   only ones judged on the old rule.

---

## 5. Candidate generation, alternates, one-meal

### 5.1 `generateDayCandidates` (`:456-570`)

- 9 solve attempts, deduped by signature `` `${recipeId}:${proteinScale}` `` (`:497`). The
  signature **omits `sidesScale`**, so two genuinely different portionings collapse to one
  candidate [DERIVED].
- **Does candidate generation constrain compliance?** No — it never rejects a candidate for
  being out of tolerance. It constrains *what the user is shown*: 9 attempts are narrowed to
  3 by `matchPct` alone (`:504`), and §2.3 shows that ordering can put a miss first.
- The locked-slot handling (`:478`, `:495`, `:482-490`) is correct: locks enter the solve as
  constraints and `judge()` grades the exact shipped slot set.
- `needDiagnosis` (`:548-559`) checks `candidates[0].inTolerance` only. If `[0]` passes but
  `[1]`/`[2]` miss, no diagnosis fires — defensible, since each candidate carries its own
  `inTolerance` and `miss`, and `PlanTab.jsx:503` fails closed (`c.inTolerance === true`).
- `rng = Math.random` as a **default parameter** (`:461`). The purity invariant
  (`tests/qc/invariants.test.js:110`) greps for `Math\.random\(` — a *call* — so a *reference*
  passes. `plans.js:463` injects no rng, so `/day-options` runs on the ambient global RNG.
  Same at `:823` (`alternatesForSlot`) and `:1358` (`clock = Date.now` in `solveOneMeal`).
  **The purity invariant is textual and its own targets evade it.** [MEASURED]

### 5.2 `alternatesForSlot` (`:821-863`)

- Its `matchPct` (`:853-859`) uses **0.6 kcal / 0.4 protein-short** — a fifth ruler, unrelated to
  `SCORE_WEIGHTS`, `dayTolerance`, the slot gate, or the oracle.
- **The returned array is never sorted.** Order is `resolveSlot` draw order. Because
  `resolveSlot` returns a fit when one exists, fits do tend to precede non-fits — but **among
  fits the order is random**. Measured on a 4-recipe fixture where all four fit at different
  accuracy: `options[0]` was **not** the highest-`matchPct` option in **134 of 200 draws
  (67 %)** [MEASURED, `d4-demo5.cjs`].
- `plans.js:557` forwards them unsorted to the swap UI (`PlanTab.jsx:691`).

### 5.3 `solveOneMeal` (`:1355-1450`)

- `const best = options[0]` (`:1388`), re-asserted at `plans.js:260`. Combined with §5.2, "best"
  means "first drawn", not "best" [DERIVED + MEASURED].
- `fits` (`:1419`) is **kcal + protein only**, against `KCAL_TOLERANCE_PCT` / `PROTEIN_TOLERANCE_PCT`
  imported from `weeklyPlanner`. `remaining` carries no fat/carb at all — `plans.js:256` builds it
  as `{kcal, protein}` — so a 4-macro judgement is not merely unused here, it is **unavailable**.
- Everything else in the function is sound: `reachMin`/`reachMax` (`:1393-1399`) correctly name
  which wall of the 0.5–2× band bound the answer, and both `no-budget` (`:1375-1382`) and
  `no-fit` (`:1401-1415`) paths return a named binding rather than an empty result.

### 5.4 `varietyOutlook` (`:768-812`)

Pure reporting into `meta.variety` (`plans.js:389`). Its `usableForSlot` reachability filter
(`:789-792`) tests the kcal wall and the protein wall and **not** composition, so
`sustainsHorizon: true` is compatible with a pool that can never reach the fat band. Same
2-vs-4-macro blindness as everything else outside `dayTolerance`.

---

## 6. Every constraint a fix must respect

1. **Do not change any `DAY_*_TOLERANCE_PCT` to raise the number.** C21's self-scoring trap
   applies with full force: the ruler is also the selection key (`:686`), so loosening it both
   re-grades *and* re-selects. Any ruler change is a nutrition decision (A4's citations, owner's
   call), reported on the pre-change denominator.
2. **`dayInTolerance` must stay a single 4-macro verdict** (`:256`). Every caller reads it; a
   caller-specific subset is the exact defect solver-core-2 closed.
3. **Grade on exact totals, never `scoreDay.totals`.** `scoreWeek:603`, `generateDayCandidates:483`
   and `diagnoseFromResult:395` all do this correctly today. Preserve it.
4. **`matchPct` must never contradict `inTolerance`.** The 2026-07-24 reweighting exists to hold
   this. If fat/carb weights move, `PROTEIN_PRIORITY_WEIGHTS` (`brain/proteinFloor.js:89`) must
   move identically — its own comment (`:70-76`) makes that a stated invariant.
5. **Both weight tables must sum to 1.00**, or `matchPct` stops being a closeness fraction.
6. **Diagnosis presence is currently 100 %. It is a regression if it drops below that.**
   Preserve the un-gated fat/carb clause at `:432-438`, the guaranteed fallback at `:439-442`,
   and the `noDaysAtAll` guard at `:753`.
7. **Golden baseline**: `tests/golden/goldenBaseline.test.js` locks byte-identical output when
   `opts` is omitted. `scoreDay`/`scoreWeek` must keep emitting **no** `proteinFloor` key
   outside protein-priority mode (`:189`, `:630`).
8. **QC oracle drift guard**: `tests/qc/oracle-selfcheck.test.js:32-33` asserts the oracle's
   inlined constants equal `DAY_KCAL_TOLERANCE_PCT` / `DAY_PROTEIN_TOLERANCE_PCT`. Changing
   either requires editing `scripts/qc/oracle.mjs:35` in the same commit. **The guard does not
   cover fat or carb** — see §7.
9. **Solver purity**: `mealSolver.js` and `weeklyPlanner.js` must contain no `Math.random(`,
   `Date.now(` or `new Date(` *call*. Note this is a text grep, and the file already carries
   three bare references that pass it.
10. **`applyPrepFilter` must keep passing `prepTimeMin == null`** (`:29`) — excluding on absent
    data is the stated rule.
11. **Diagnosis may never suggest loosening an allergy.** Structural today (`diagnose` has no
    allergy input); keep it structural.
12. **`classifyBinding`'s return shape is asserted by the UI** (`PlanTab.jsx:469-472` reads
    `.key`, `.label`, `.detail`). Reordering branches is safe; changing the shape is not.
13. **Any refusal path reports compliance on the pre-refusal denominator** (C21).
14. **No `weeklyPlanner.js` edit belongs in a `mealSolver.js` commit** — D1/D2 own it, and the
    per-slot warning re-scoping in §4 crosses that line deliberately and must be coordinated.

---

## 7. The verification shapes that will agree with a defect

Named explicitly, because this project has been burned twice.

1. **`tests/solverMacroTolerance.test.js:51-63` computes its expected boundary FROM the constant
   it is testing** (`slack = fatMid * DAY_FAT_TOLERANCE_PCT`). It passes at any value of the
   constant. The hardcoded fixtures break only if the fat tolerance is raised above ≈0.52.
   **The ruler's value is not locked by any test.** [MEASURED]
2. **The QC oracle grades a different, looser, 2-macro rule** (`scripts/qc/oracle.mjs:196`) and
   its `silentMisses` counter is structurally blind to fat and carb. A build agent that
   "verified with the oracle" has verified nothing about the dominant failure mode. The
   drift guard at `tests/qc/oracle-selfcheck.test.js:32-33` covers kcal and protein **only**,
   so it will not even notice.
3. **The purity invariant is a grep for a call, and the file evades it with references**
   (`mealSolver.js:461`, `:823`, `:1358`).
4. **`compositionReach` reuses `DAY_FAT_TOLERANCE_PCT`/`DAY_CARB_TOLERANCE_PCT` to reconstruct
   the same window `dayTolerance` uses** (`:1131-1132`) — correct today, but it means a ruler
   change silently changes the *impossibility proof* too, in the same direction. Two surfaces
   with one knob and no test tying them together.
5. **At least eight distinct rulers are live.** Any "the solver agrees with itself" check must
   name which one it used:

   | # | ruler | macros | file:line |
   |---|---|---|---|
   | 1 | `dayTolerance` (day verdict, selection key) | 4 | `mealSolver.js:229` |
   | 2 | `SCORE_WEIGHTS` / `matchPct` | 4 (weighted) | `mealSolver.js:127` |
   | 3 | per-slot accept gate | 2 (0.15 / 0.12) | `weeklyPlanner.js:630` |
   | 4 | `solveOneMeal.fits` | 2 | `mealSolver.js:1419` |
   | 5 | `alternatesForSlot.matchPct` | 2 (0.6 / 0.4) | `mealSolver.js:858` |
   | 6 | cart-fill warning | 1 (literal 0.15) | `plans.js:671` |
   | 7 | QC oracle | 2, protein vs `proteinLo` | `scripts/qc/oracle.mjs:196` |
   | 8 | TodayTab rails (A12) | fat = floor, no ceiling | `TodayTab.jsx:135-137` |

---

## 8. What I could NOT determine

1. **How much of the 23-point satisfiable gap is attributable to the `/day-options` ranking
   inversion (§2.3).** The fleet's 70.1 % is measured from `POST /api/plans/generate` only
   (`fleet.mjs:161`); `/day-options` was never exercised. The inversion is proved to exist and
   proved unmeasured. Sizing it needs a new harness.
2. **Whether `dayTolerance` as a selection key is worth points.** Answering it requires a
   re-solve under an alternative ruler — A15's fixed-day re-score cannot see it, and I did not
   have a solve rig. I can bound the *opportunity*: 77 runs (36 %) reached the selection
   comparison, and 65 of them shipped a miss.
3. **The real-world incidence of the `compositionReach` false positive.** Reproduced on a
   synthetic pool; the fleet's `binding` key is per-run, so I could not separate
   `macro-composition` verdicts reached via `unreachable` (`:1136`) from those reached via
   `observed` (`:1142`). Both print `MACRO_COMPOSITION`. Distinguishing them needs the
   `unreachable` object logged, which nothing does.
4. **Whether the 1 % off-centre keto/carb-floored fat midpoint (`(0.9+1.12)/2 = 1.01`) is
   deliberate.** No comment addresses it and no test covers it. 69 of 578 days ride that path.
5. **The true attribution accuracy of `binding` on multi-day horizons.** The key is emitted once
   per horizon (`:1321`); a week whose days fail for different reasons gets one label by
   construction. My 15.2 % figure counts only runs where *every* missed day was
   composition-shaped, which is the cleanest subset — the real error rate on mixed runs is
   unmeasured and can only be worse.
6. **What the day-scope warning re-scoping in §4.2 costs.** I established the 19.3 % baseline
   and the mechanism; I did not build the alternative and cannot say how many of the 438 warned
   slots it would clear.
7. **Whether `sidesScale` collapsing out of the candidate signature (`:497`) loses real
   candidates.** Needs a solve rig.
