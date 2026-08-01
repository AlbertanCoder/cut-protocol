# D7 — Is the solver being asked for something coherent?

*Territory: `bmrEngine.js`, `profileTarget.js`, `adaptiveTarget.js`, `expenditureEstimator.js`,
and the meal-config slot split. I own **the ask**.*

**Read-only run.** Nothing under `backend/src/` was edited. Scripts and data:
`docs/surgery/CAMPAIGN/solver-deepdive/D7/` (`d7_derive.py`, `d7_coherence.py`,
`d7-personas.json`, `dev.db`).

---

## Verdict in one paragraph

**The ask is coherent in the sense that matters for the metric, and incoherent in three
specific ways that matter for correctness.** Under the rule the app actually grades on,
the target is expressible by the library for **248 of 250 personas (99.2 %)** once portion
bounds and slot-type matching are relaxed — so target-side infeasibility explains
**≈0 points** of the 70.1 %, independently confirming A12 and A15 from the target side.
But: (1) the four numbers the target prescribes **do not add up to its own calorie target**
— they sit a median **99.5 kcal** below it, spending **29.8 %** of the day's one-sided
calorie allowance before a single recipe is chosen; (2) the protein constant is defensible
per unit of lean mass, but **the lean-mass estimate feeding it is wrong for 147/250 personas
and inflated by a median 32 % for the obese ones**, which is what drives the extreme
densities; (3) **the slot split is density-neutral by construction, but the carry-forward
is not** — it clamps a slot's calories and protein independently, so a late slot can be
asked for 1.42× the day's protein density, which for **29/250 personas exceeds every
recipe in their pool at any scale**.

**Nothing here licenses lowering the protein prescription.** The per-LBM constant sits
inside the published muscle-retention range. The defect is upstream of it.

---

## 0. Instrument, and one honesty note

| item | value |
|---|---|
| live `backend/prisma/dev.db` sha256:16 | `d9037dce9754b452` (07-31) |
| my `D7/dev.db` copy | `d9037dce9754b452` — same, i.e. **NOT** the fleet baseline |
| fleet baseline (A11's copy) | `e55f52e53658a086` (07-30) |

Per **C18** I did not re-copy or `--fix` anything. **Every pool number below is computed
from A11's `A11-survivors-*.csv` files, which were generated on the 07-30 baseline** — so my
pool-side numbers are on the fleet's dataset and are comparable to it. MEASURED: the two DB
snapshots carry the same 910 recipes / 14,151 foods and the same slotType split
(`meal 892 / snack 17 / either 1`); recipe macro sums differ by +0.5 % protein and −1.1 %
carb. Not material to anything claimed here, but stated rather than assumed.

**The derivation below never calls `computeMacros()`.** Per the verification-shape warning,
`D7/d7_derive.py` re-implements the whole chain by hand from constants transcribed with
file:line, using `floor(x+0.5)` for JS `Math.round`. It is validated against an *external*
witness: the `target` block the **running app** recorded for each persona in
`qa/qa-fleet-20260729-2032/results.jsonl`.

> **MEASURED — gate passed: 212 personas recorded a target; my hand derivation reproduces
> `kcal`, `proteinLo/Hi`, `fatLo/Hi`, `carbLo/Hi`, `keto` and `macroKcalGap` exactly on
> 212/212, 0 mismatches.**

That gate also proves something load-bearing: I derived every target on the **formula-only**
path — no adaptive estimate, no step cap. It matched 212/212. **Therefore the adaptive
layer never fired anywhere in the 70.1 % baseline.** See §7.

---

## 1. The target chain, end to end (MEASURED, file:line)

```
routes/plans.js:206          planContext(userId)
  planContext.js:220           weightNowKg = getWeightNowKg(userId, profile)
    weightNow.js:6-13            mean of the last 7 weigh-in ROWS, else profile.startWeightKg
  planContext.js:226           reconciled = reconcileTarget(userId, {reason:"planContext"})
    profileTarget.js:61-92       resolve live, overwrite the cached Profile.targetKcal if it
                                 disagrees, log [target-drift]. THE RESOLVER WINS.
      adaptiveTarget.js:311-321    resolveAppliedTarget -> walkTarget -> last checkpoint
        adaptiveTarget.js:274-284    checkpointDates: weekly grid anchored on profile.startDate
        adaptiveTarget.js:155-182    resolveEnergy, per checkpoint:
          bmrEngine.js:177-211         computeEnergy(profile, weightKg)
          bmrEngine.js:230-245         deriveTarget(profile, energy.tdee, energy.rmr)
        adaptiveTarget.js:199-267    applyStepCap(indicated, prevKcal, 125)
  planContext.js:227           dailyTarget = computeMacros(profile, weightNowKg, reconciled.target)
  planContext.js:228           mealConfig = { meals: profile.mealsPerDay, snacks: profile.snacksPerDay }
```

### 1a. BMR (`bmrEngine.js:35-150`, `:177-211`)

Ten published estimators (`:35-114`); **six are default-on** (`:121`
`DEFAULT_ENABLED = [mifflin, oxford, harris, schofield, katch, cunningham]`). `excludedFormulas`
membership *flips* a formula from its default (`:127-130`), so it is an opt-out for the six
and an opt-in for the other four. Applicability gates: Schofield only `18 ≤ age < 60`
(`:61`); Katch/Cunningham/Nelson only when `bodyFatPct > 0` (`:68`, `:73`, `:99`) — and
`null` and `0` are treated identically as "unknown" (`:135`).

`rmr = mean(applicable ∧ enabled)` (`:183`). If the user excluded everything, all applicable
formulas count and `allExcludedFallback` says so (`:180-181`) — an average of nothing is not
a number. **`computeEnergy` returns `rmr` and `tdee` already `Math.round`ed** (`:195`,
`:209`), and `deriveTarget` receives those rounded values (`adaptiveTarget.js:158`). DERIVED:
this matters — rounding happens before the floor comparison, not after.

### 1b. TDEE (`bmrEngine.js:154-169`, `:193`)

```
tdee = round( rmr × jobMultiplier  +  trainingKcalPerDay )
jobMultiplier   = activityOverride if 1.0–2.2, else OCCUPATION_BY_KEY[occupationKey].multiplier
                  (activityData.js:15-68 — 43 occupations, 1.20 desk … 1.70 mining),
                  defaulting to desk-office 1.20 on an unknown key
trainingKcal/d  = round( sessionsPerWeek × minutesPerSession × MET × 3.5 × kg / 200 / 7 )
                  ACSM; MET from activityData.js:74-79 (weights 3.5, mixed 5, sport 6, cardio 7)
```

### 1c. Target and the safety floor (`bmrEngine.js:215-245`)

```
deficit = round( rateLbPerWeek × 3500 / 7 )                      :232
raw     = round( tdee − deficit )                                 :233
floor   = max( SAFE_FLOOR[sex] , round(rmr × 0.95) , floorKcal )  :224-228
          SAFE_FLOOR = { M: 1500, F: 1200 }                       :216
target  = max( raw, floor )                                       :235
```

**MEASURED — the constitutional floor holds.** Across all 250 hand-derived targets, zero sit
below `max(RMR×0.95, 1500 M / 1200 F, user floor)`. Minimum target produced = 1200 kcal
(female, sex floor binding). 60/250 are floor-clamped; for **42 of those the binding term is
`RMR×0.95`, not the sex minimum** — i.e. the Stage-C `M1` rail is doing real work, not
decoration. When clamped, `:242-243` also computes and exposes the rate the clamped target
*actually* delivers, so the UI can level with the user.

### 1d. The step cap (`adaptiveTarget.js:57`, `:199-267`, `:291-302`)

`STEP_CAP_KCAL = 125` per weekly cycle, applied by **replaying** a fixed checkpoint grid
anchored on `profile.startDate` rather than clamping against the stored row — so reading
twice cannot walk the target twice. The floor outranks the cap (`:212`): the cap may hold a
target above what the data indicates, never below the floor.

---

## 2. The macro bands, derived by hand (`bmrEngine.js:294-360`)

```
weightLb  = kg × 2.20462
bfKnown   = bodyFatPct != null && bodyFatPct > 0                       :296
bfForLbm  = bfKnown ? bodyFatPct : ASSUMED_BODY_FAT_PCT[sex]           :297   (M 21, F 28)  :283
lbmLb     = weightLb × (1 − bfForLbm/100)                              :298

proteinLo = round(lbmLb × 1.14)    proteinHi = round(lbmLb × 1.25)     :299-300
proteinMid = (proteinLo + proteinHi) / 2                               :301
```

`proteinLo/Hi` key off **lean mass in pounds**, nothing else — not the calorie target, not
the deficit, not training. DERIVED: `1.14 g/lb = 2.513 g/kg LBM`, `1.25 g/lb = 2.756 g/kg
LBM`, midpoint **2.635 g/kg LBM**.

**Three branches** produce fat and carbs:

| | fat | carbs |
|---|---|---|
| **keto** (`:306-320`) | `fatMid = max(round(lbm×0.3), round((kcal − pMid·4 − 100)/9))`; band `fatMid×0.9 … ×1.12` | fixed `carbLo 10, carbMid 25, carbHi 30` (`:274-276`) |
| **default** (`:322-327`) | `fatLo = round(lbm×0.34)`, `fatHi = round(lbm×0.40)` | `carbMid = round((kcal − pMid·4 − fatMid·9)/4) − 25`; band `carbMid ± 12` (`:352-354`) |
| **carb-floored** (`:328-345`) | `fatMid = max(round(lbm×0.3), round((kcal − pMid·4 − 200)/9))`; band `×0.9 … ×1.12` | held at `min(50, room)`, band `±12` |

`CARB_MIDPOINT_BUFFER_G = 25` (`:268`). `NONKETO_CARB_FLOOR_G = 50` (`:292`).
`ESSENTIAL_FAT_PER_LB_LBM = 0.3` (`:286`).

**The `p135` `Math.round` tie A15 flagged is real and I reproduce it.** MEASURED:
`lbmLb = 203.947191580`, `lbmLb × 1.14 = 232.499798401`. That is 0.0002 g below the tie —
JS `Math.round` (half **up**) gives 232, and my `floor(x+0.5)` transcription agrees, which is
why my gate hit 212/212. Any re-implementation using banker's rounding (Python `round`,
`numpy.round`, C# `Math.Round` default) flips `proteinLo` to 233 here. **A build prompt that
touches the bands must state the rounding convention explicitly.**

**Effective fat-band widths, hand-derived, independently confirming A15's C-note:**

| path | n | nominal fat half-width | effective (`+ 0.25 × mid`) |
|---|---|---|---|
| default | 223 | 6.9 – 9.4 % | **31.9 – 34.4 %** |
| keto | 18 | 10.5 – 11.1 % | **35.5 – 36.1 %** |
| carb-floored | 9 | 10.5 – 11.1 % | **35.5 – 36.1 %** |

Exactly A15's figures, reached from hand-transcribed constants rather than from `A15-rescore.mjs`.

---

## 3. Coherence audit — the key deliverable

### 3a. The ask does not add up to its own calorie target

MEASURED, 250 personas:

| statistic | `targetKcal − (pMid·4 + fatMid·9 + carbMid·4)` |
|---|---|
| median | **+99.5 kcal** |
| p25 / p75 | +99 / +101 |
| min / max | −4 / +102 |
| as a share of the one-sided ±15 % kcal allowance | median **29.8 %**, p90 47.9 %, max **56.4 %** |

This is `CARB_MIDPOINT_BUFFER_G = 25` (`:268`) — 25 g × 4 = 100 kcal, subtracted from
`carbMid` by construction (`:326`). The engine discloses it honestly as `macroKcalGap`
(`:346`), and my hand value matches the app's recorded `macroKcalGap` on 212/212.
Independently corroborates A12 §1 and C12.

**Consequence, stated precisely:** a day that lands exactly on all three prescribed midpoints
lands ~100 kcal *under* its calorie target. It still passes (±15 %), but it has spent nearly a
third of its one-sided allowance before the solver makes a single choice. A15 measured the
band-shift half of this at **+2.7 pts** (`CARB_MIDPOINT_BUFFER_G = 0`); the aim-shift half is
unmeasured and needs a re-solve.

**A sharper form of the same fact.** Because food obeys Atwater, the exact 4-vector
(`targetKcal`, `pMid`, `fatMid`, `carbMid`) is only reachable using recipes whose stated
calories *exceed* `4P+9F+4C` — fibre, alcohol, or a data error. MEASURED: **269 of 910
recipes (29.6 %) carry a positive Atwater residual** (pool median residual −1.0 %, p90
+1.7 %, max +13.6 %). Running the LP feasibility exactly:

> **MEASURED — the nominal 4-vector ask is unreachable by any non-negative combination of
> the persona's style pool for 59/250 personas (23.6 %)**, even with portion bounds and slot
> types fully relaxed. Style breakdown: vegan 29, vegetarian 15, kosher 6, halal 3,
> carnivore 2, none 2, paleo 1, keto 1. 35 of the 59 are assumed-body-fat cases, 25 are BMI ≥ 30.

The 191 that *are* reachable are reachable only because the library's Atwater slack absorbs
the 100 kcal hole. **That is not a coincidence the app should be relying on.**

### 3b. Under the rule the app actually grades on, the ask IS expressible

I re-ran A11's question as an exact LP rather than a Frank-Wolfe distance, from the target
side. The box is `dayTolerance()`'s four rules verbatim (`mealSolver.js:229-252`): kcal
±15 %, protein ≥ 0.85·pMid with no ceiling, fat `[fatLo − 0.25·fMid, fatHi + 0.25·fMid]`,
carbs `[carbLo − 0.25·cMid, carbHi + (keto ? 0 : 0.25·cMid)]`.

| test (portion bounds and slot types RELAXED) | feasible |
|---|---|
| nominal 4-vector at the midpoints | 191/250 (76.4 %) |
| macro **mix** only, calories free | 236/250 (94.4 %) |
| **the graded tolerance box** | **248/250 (99.2 %)** |
| each single axis alone (kcal / protein / fat / carb) | 250/250 each |
| each pair kcal+protein, kcal+fat, kcal+carb | 250/250 each |

The two failures: **p073** (IMPOSSIBLE tier, vegan, 1512 kcal, 177–194 g protein, 169-recipe
pool) and **p127** (HARD tier, vegetarian, 1822 kcal, 225–247 g protein, 401-recipe pool).

> **VERDICT: the target generator is NOT routinely demanding a point outside the library's
> convex hull. On the graded rule it does so for 0.8 % of personas.** Target-side
> infeasibility contributes ≈0 of the 29.9 missing points. This is a third independent
> route to A12's and A15's conclusion, and it is a null result I went looking to falsify.

### 3c. But the ask sits in the library's thin tail, and on the protein axis

Feasible ≠ easy. MEASURED, per-persona, against each persona's own style pool:

| | pool | target |
|---|---|---|
| protein g/100 kcal, median | **5.39** (none), 3.25 (vegetarian) | **8.35** (my 250) / 8.16 (A11's 218 satisfiable) |
| fat g/100 kcal, median | **4.21** | **2.66** |

- **242/250 personas demand a protein density above the pool median.** 43/250 above the pool
  **p90** (10.31). **0/250 above the pool maximum** (22.19).
- **229/250 demand a fat density below the pool median.**
- The **joint usable slice** — recipes simultaneously protein-dense enough and fat-lean
  enough — is a median **15.5 %** of the pool, p10 **3.7 %**. **29/250 personas have < 5 %**
  of their pool usable; **15/250 have < 2 %**.

**Which axis: protein.** Confirms A11's contradiction of the original brief. Fat is the
tightest *band*; protein is the scarcest *ratio*.

### 3d. Does the extremity of the ask predict the miss? Mostly no — one corner excepted

I joined my target-side numbers to the fleet's per-persona day outcomes (578 days,
405 in band = 70.1 %, reproduced exactly). MEASURED:

| quintile of **demanded protein density** | days | in band |
|---|---|---|
| Q1 4.62–7.07 | 84 | 69.0 % |
| Q2 7.08–8.00 | 126 | 77.0 % |
| Q3 8.01–8.89 | 120 | 63.3 % |
| Q4 8.91–10.13 | 156 | 70.5 % |
| Q5 10.14–13.36 | 92 | 69.6 % |

| quintile of **joint usable slice** | days | in band |
|---|---|---|
| **Q1 0.002–0.075** | **108** | **51.9 %** |
| Q2 0.076–0.127 | 144 | 76.4 % |
| Q3 0.127–0.162 | 84 | 75.0 % |
| Q4 0.165–0.177 | 126 | 73.8 % |
| Q5 0.177–0.755 | 116 | 71.6 % |

`r(demanded protein density, in-band rate) = −0.057`. `r(joint slice, in-band rate) = +0.101`;
`r(log joint slice, …) = +0.198`.

**Read this carefully.** The *level* of the protein ask does not predict failure at all. Only
the bottom quintile of usable slice does, and it runs **18.2 points below** the population.
DERIVED: if Q1 ran at the population rate it would gain `(0.701 − 0.519) × 108 ≈ 19.7 days
= 3.4 points of 578`. **So the target-side "thin corner" is worth about 3.4 points, not 29.9**
— and it is confounded with vegetarian/vegan/keto, which A11 and A18 already own as
solver-limited.

By target-side cohort: body-fat measured 71.8 % vs assumed 69.1 %; floor-clamped 70.6 %;
default branch 70.3 %; **carb-floored branch 84.2 % (n = 19 days, small)**; **keto 62.0 %**
(matching A11 exactly). None of these is the gap either.

---

## 4. Is the protein ask too high?

**Short answer: the constant is defensible; the input feeding it is not.**

### 4a. The constant, against the literature

DERIVED from `bmrEngine.js:299-300`: **2.513 – 2.756 g/kg of lean body mass**, midpoint
**2.635 g/kg LBM**.

Helms, Aragon & Fitschen (2014), *JISSN* 11:20 — fetched and read — recommends
**"2.3–3.1 g/kg of lean body mass per day"** with **"15–30 % of calories from fat"**. The
app's band sits inside that range with room on both sides. It is not an outlier.

Against bodyweight (MEASURED over 250 personas):

| | protein midpoint g/kg **bodyweight** | protein **floor** (`proteinLo`) g/kg BW |
|---|---|---|
| min | 1.42 | 1.36 |
| median | **2.03** | 1.93 |
| p90 | 2.14 | — |
| max | 2.42 | 2.31 |
| above 2.2 g/kg | 18 (7.2 %) | 9 (3.6 %) |
| above 3.0 g/kg | 0 | 0 |

**Sitting squarely inside the 1.6–2.2 g/kg cutting range, with a 7 % tail just over it.**
The app never prescribes below 1.42 g/kg BW. On the amount alone there is nothing to fix.

### 4b. The real problem: as a *share of energy*, and why

MEASURED:

| cohort | n | protein g/kg BW | protein %E | demanded density g/100 kcal | fat %E |
|---|---|---|---|---|---|
| ALL | 250 | 2.02 | 33.4 % | 8.35 | 24.0 % |
| body fat **measured** | 103 | 1.92 | 31.5 % | 7.88 | 22.3 % |
| body fat **assumed** | 147 | 2.08 | 35.3 % | 8.82 | 25.2 % |
| … assumed **and BMI ≥ 30** | 86 | 2.08 | 37.9 % | 9.47 | 26.9 % |
| kcal **floor-clamped** | 60 | 1.90 | 39.3 % | 9.83 | 27.8 % |
| **floored + assumed + BMI ≥ 30** | **15** | 1.90 | **47.6 %** | **11.90** | 35.6 % |
| **carb-floored branch** | **9** | 1.90 | **51.6 %** | **12.90** | 37.5 % |

**106/250 personas (42.4 %) are prescribed more than 35 %E from protein — the NASEM AMDR
ceiling.** Max 53.5 %E. All 15 of the floored+assumed+obese cohort demand a protein density
above the pool's 90th percentile.

The mechanism is a **compounding of two independent clamps**, and it is entirely target-side:

1. Protein and fat are both **LBM-anchored** and LBM is **overestimated** (§4c).
2. Calories are simultaneously **clamped down** to `RMR × 0.95` (`:226`) because the user
   picked an aggressive rate.

Numerator up, denominator down. DERIVED, and the carb-floor branch is the visible symptom:

```
p127  1822 kcal   protein 236 g (944 kcal)   fat 76 g (684 kcal)   ->  194 kcal left = 48 g carb
p101  1728 kcal   protein 223 g (892 kcal)   fat 72 g (648 kcal)   ->  188 kcal left = 47 g carb
p113  1261 kcal   protein 149 g (596 kcal)   fat 52.5 g (473 kcal) ->  192 kcal left = 48 g carb
```

**MEASURED: all 9 carb-floored personas are assumed-body-fat, and all 9 are female.** The
branch is not a rare edge case reached at random — it is the deterministic consequence of the
body-fat assumption, and the assumption is more wrong for women (28 % assumed vs a real
~55–60 % at BMI 40+) than for men (21 % vs ~40 %). **The target generator's worst failure
mode is sex-skewed.**

### 4c. The defect: `ASSUMED_BODY_FAT_PCT` (`bmrEngine.js:283`)

`{ M: 21, F: 28 }` — the ACE "average/acceptable" midpoints — applied to **58.8 % of personas
(147/250)**, of whom **86 have BMI ≥ 30**.

DERIVED: on the assumed path the prescription collapses to a **constant g/kg of *actual*
bodyweight** — `2.20462 × (1 − 0.21) × 1.195 = 2.081 g/kg` for men, `1.897 g/kg` for women —
because there is no longer any body-composition information in it at all. A BMI-19 man and a
BMI-44 man get the same g/kg of total mass.

Benchmarked against the Deurenberg (1991) BMI/age/sex estimate
(`BF% = 1.20·BMI + 0.23·age − 10.8·male − 5.4`):

| | protein midpoint inflation vs Deurenberg-corrected |
|---|---|
| all 147 assumed-BF | p25 +7.6 %, **median +21.1 %**, p75 +35.9 %, p90 +52.0 %, max **+96.1 %** |
| the 86 with BMI ≥ 30 | **median +32.2 %**, max +96.1 % |
| inflated > 25 % | 65 personas |
| inflated > 50 % | 19 personas |

Worst cases:

| id | BMI | sex | assumed BF | Deurenberg BF | LBM app / est (lb) | protein app / est (g) | inflation |
|---|---|---|---|---|---|---|---|
| p004 | 43.1 | F | 28 % | 63.3 % | 228.9 / 116.7 | **273.5 / 139.5** | **+96.1 %** |
| p200 | 41.9 | F | 28 % | 62.1 % | 151.6 / 79.8 | 181.0 / 95.5 | +89.5 % |
| p240 | 43.7 | F | 28 % | 59.7 % | 179.7 / 100.7 | 215.0 / 120.5 | +78.4 % |
| p127 | 44.6 | F | 28 % | 56.1 % | 197.3 / 120.2 | 236.0 / 143.5 | +64.5 % |

> **MEASURED, and this is the sharpest target-side number in the study: 37 of the 147
> assumed-body-fat personas demand a protein density above the pool's 90th percentile.
> Under the Deurenberg-corrected LBM, that count is ZERO.** Cohort median demanded density
> falls 8.82 → 7.29 g/100 kcal.

The clinical literature agrees on the direction. Verified via a 2022 *Clinical Nutrition
ESPEN* comparison of protein-requirement calculations: *"Clinically relevant differences were
found in protein requirement between actual bodyweight and FFM in most of the participants
with overweight, obesity or severe obesity (78–100 %)"* — i.e. dosing an obese person off
total mass (which is what the assumed path does) is a known error, not a novel claim.

### 4d. Safety tension, flagged not resolved

**A correction is not free and must not be shipped naively.** Helms is explicit that the
*direction* of the 2.3–3.1 range is set by leanness: *"the lower the body fat of the
individual, the greater the imposed caloric deficit and when the primary goal is to retain
LBM, the higher the protein intake … should be."* The app applies a flat 2.635 g/kg LBM to
everyone regardless of leanness or deficit size — the constant is inside the range but is not
modulated the way the source modulates it.

And MEASURED: applying a Deurenberg correction alone would move **8 of the 147** assumed-BF
personas **below 1.2 g/kg of actual bodyweight** — the lower bound the hypocaloric-obesity
literature gives (1.2–1.6 g/kg actual, or 1.0–1.5 g/kg adjusted). Worst: p004 at
**0.97 g/kg**. Today's app is never below 1.42 g/kg actual.

> **CONSTRAINT ON ANY FIX: a better body-fat estimate must be paired with an absolute floor
> of ≈1.2 g/kg of actual bodyweight, or it will trade one out-of-range prescription for the
> opposite one.** Whether to change any of this is a nutrition decision and the owner's call.
> I am reporting the arithmetic, not prescribing the change.

---

## 5. The keto and carb-floored paths

| | keto (`:306-320`) | carb-floored (`:328-345`) | default |
|---|---|---|---|
| n of 250 | 18 | 9 | 223 |
| fat band shape | `fatMid × 0.9 … × 1.12` | same | `lbm × 0.34 … 0.40` |
| nominal fat half-width | 10.5–11.1 % | 10.5–11.1 % | 6.9–9.4 % |
| **effective** (`+0.25·mid`) | **35.5–36.1 %** | **35.5–36.1 %** | **31.9–34.4 %** |
| fat %E, median | 62.5 % | 37.5 % | 22.9 % |
| median `macroKcalGap` | +5 | −6 | **+100** |
| fleet in-band rate | **62.0 %** (50 days) | **84.2 %** (19 days) | 70.3 % (509 days) |

**`CARB_MIDPOINT_BUFFER_G` is inert on both alternate paths** — keto sets `carbMid` to the
constant 25 and the carb-floored branch sets it from `min(50, room)`. That is why their
`macroKcalGap` is ≈0 while the default path's is +100. Combined with a fat rule that is 1.5 pp
wider in effective terms, this is a complete explanation of A15's *"baseline E is 31.9–34.4 %
on the default path but 35.5–36.1 % on the keto/carb-floored path"* observation, derived
independently. The 84.2 % on the carb-floored branch — the highest of any cohort — is
consistent with both effects pointing the same way, but n=19 days and I do not claim it as
significant against C14's floor.

**Two correctness findings on these paths, neither of which moves the metric:**

1. **A carb-axis twin of A4's C3 fat defect, previously unreported.** `NONKETO_CARB_FLOOR_G = 50`
   exists (`:288-292`) because *"below ~50 g/day a diet drifts into ketosis, so squeezing a
   'none'/omnivore target to 0 g carbs … is silently making the plan ketogenic."* But the band
   emitted is `carbMid ± 12` and the grader then allows a further `−0.25 · cMid`.
   **MEASURED: all 9 carb-floored personas have a graded carb floor of 24.8–25.5 g — half the
   floor the engine declares necessary to keep the plan non-ketogenic.** 28 of 232 non-keto
   personas have a graded carb floor below 50 g. Same shape as C3: a real correctness fact
   about the ruler, whose realized incidence I did not measure (that is a re-grade, A15's
   instrument).
2. **Keto's prescribed centre is not its graded centre**, confirming A12 §3 from the target
   side: `carbMid = 25` (`:314`) while `bandMiss()` centres on `(10+30)/2 = 20`. My hand
   `macroKcalGap` and the app's disagree on exactly the keto and low-carb personas for this
   reason, and nowhere else.

---

## 6. Slot splitting

`weeklyPlanner.js:145-157` (`buildSlots`) and `:159-175` (`targetsForSlots`):

```
meal weights: 1 meal -> 1.0 ; otherwise first 0.9, last 1.15, middle 1.0
snack weight: 0.4 each
share = weight / (sum of that day's weights)
kcalTarget    = dailyTarget.kcal × share
proteinTarget = ((proteinLo + proteinHi)/2) × share
```

### 6a. The nominal split is density-neutral, and that is correct

DERIVED: both `kcalTarget` and `proteinTarget` are the same `share` of their day totals, so
**every slot demands exactly the day's protein density**. There is no "breakfast with
dinner-level protein" in the nominal split. Fat and carbs are not split at all at this
level — they enter as `fatShare`/`carbShare` only inside `solveDay` (`:898-899`).

MEASURED, over all 1,169 slots implied by the 250 personas' meal configs, applying the real
per-slot gate (`SCALE_BOUNDS 0.5–2×` `:58`, `KCAL_TOLERANCE_PCT 0.15` `:67`,
`PROTEIN_TOLERANCE_PCT 0.12` `:74`) and the real `eligibleRecipes` slotType rule (`:183-187`):

| | slots with **no** recipe able to pass at any legal scale |
|---|---|
| all slots | 21 / 1,169 = **1.8 %** |
| **meal** slots | 1 / 861 = **0.1 %** |
| **snack** slots | **20 / 308 = 6.5 %** |

**The split itself is not creating infeasible asks. The snack pool is.**

### 6b. The snack pool is 2 % of the library

MEASURED from the DB and from A11's survivor lists:

| style | meal-eligible | **snack-eligible** | snack protein g/100 kcal (med / max) | snack kcal (min / med / max) |
|---|---|---|---|---|
| none | 893 | **18** | 7.69 / 18.07 | 175 / 318 / 557 |
| vegetarian | 390 | **11** | 7.69 / 10.05 | 182 / 268 / 557 |
| vegan | 164 | **5** | 3.23 / 9.92 | 182 / 322 / 557 |
| keto | 50 | **4** | 8.34 / 9.31 | 189 / 409 / 557 |
| paleo | 160 | **8** | 5.81 / 9.31 | 189 / 332 / 557 |
| carnivore | 3 | **1** | 7.49 / 7.49 | 557 only |

**192 of 250 personas have at least one snack slot.** Note the snack pool is *not* protein-poor
(median 7.69 vs the meal pool's 5.39) — the problem is depth, not quality, and it bites twice:

- **Variety capacity.** MEASURED: **19 of 192** personas' weekly snack demand
  (`snacksPerDay × 7`) exceeds `snackPool × DEFAULT_REPEAT_CAP (2)`. Worst: a keto persona
  needing 21 snack slots against a capacity of 8; a vegan needing 21 against 10; a carnivore
  needing 7 against 2. `diagnose()` (`mealSolver.js:350-356`) already names this and suggests
  setting snacks to 0 — the honesty layer is doing its job; the pool is not.
- **Slot reachability.** The 20 unreachable snack slots are concentrated in paleo (5),
  vegetarian (5), vegan (4), keto (4), kosher (2), carnivore (1).

### 6c. The carry-forward, however, DOES create an infeasible per-slot ask

`solveDay` (`:906-931`) redistributes the day's remaining budget after each slot, clamped to
`CARRY_CAP_PCT = 0.30` (`:111`):

```js
kcalTarget:    clamp(proposedKcal,    { min: t.kcalTarget    * 0.7, max: t.kcalTarget    * 1.3 })
proteinTarget: clamp(proposedProtein, { min: t.proteinTarget * 0.7, max: t.proteinTarget * 1.3 })
```

**These two are clamped independently, so the RATIO is not clamped at all.** DERIVED: the
demanded protein density of a slot can be driven to `1.3 / 0.7 = 1.857 ×` the day's density
(or down to 0.538 ×). Applying the slot gate's own slack — the leanest recipe that can pass a
slot has density ≥ `0.88 / 1.15 = 0.765 ×` the slot's demanded ratio:

| | minimum recipe density that can pass, as a multiple of the day's | personas above pool p99 | personas above pool **MAX** |
|---|---|---|---|
| nominal share (no lock, no carry) | 0.765 × | **0 / 250** | **0 / 250** |
| worst-case carry-forward | **1.421 ×** | **99 / 250** | **29 / 250** |

> **MEASURED: at the nominal share, every persona's per-slot ask is satisfiable by something
> in their pool. Under worst-case carry-forward, 29 of 250 personas face a slot ask that no
> recipe in their pool can satisfy at any legal scale.** The same independent-clamp structure
> applies to locked slots (`:889-899`): `budgetKcal` and `budgetProtein` are reduced by what
> the locks actually delivered, which can differ in ratio, and the open slots absorb the whole
> divergence.

This is the one place where "how the target is divided" genuinely manufactures an impossible
ask. It is **not** in `mealSolver.js` — consistent with C23/A18's finding that
`weeklyPlanner.js`'s slot loop is where compliance is decided.

---

## 7. Adaptive target churn

**Within a single solve: no churn. MEASURED.** `routes/plans.js:206` calls `planContext` once;
`planContext.js:227` produces one `dailyTarget`; `mealSolver.js:1173-1238`
(`generateHorizonPlan`) passes that same object into every window's `generateBestWeekPlan`
(`:1221`). A 28-day plan's day-28 slots are solved against day-1's number.

**And the adaptive layer never fired in the 70.1 % baseline at all. MEASURED** — my
formula-only derivation reproduced the app's recorded bands on 212/212 personas. The gates
that stopped it are `expenditureEstimator.js:60-63`: `MIN_SPAN_DAYS 21`, `MIN_WEIGHINS 14`,
`MIN_INTAKE_DAYS 14`, `MIN_EFFECTIVE_COVERAGE 0.6`. The fleet posted a profile and no
weigh-ins.

> **This is a scope boundary the build prompt must carry: every number in this campaign —
> 70.1 %, 77.0 %, every A-agent delta — describes the solver against a FORMULA target.
> The adaptive target, which is what a real user gets from week 3 onward, has never been
> measured against the solver.**

**Across calls, the churn is real and the code already knows it.** DERIVED:

- `STEP_CAP_KCAL = 125` per weekly cycle (`adaptiveTarget.js:57`).
- The presets go to 28 days (`mealSolver.js:884-891`); custom horizons go to
  `MAX_HORIZON_DAYS = 90` (`:882`).
- So a 28-day plan spans 4 checkpoints — the target may legitimately walk **±500 kcal** by
  its last week while the plan was built to week 1's number. At the median target that is
  **±25 %**, well outside the ±15 % kcal gate. A 90-day custom horizon spans ~12 checkpoints:
  **±1,500 kcal**.
- `mealSolver.js:926` names exactly this risk in its own 400 message — *"past 90 days your
  calorie target has been re-derived from newer weigh-ins, so the plan would be solved against
  a number the app no longer believes"* — but places the guard at **90 days** while the
  engine's own model says the number moves every **7**.
- Every repair path re-resolves live: `routes/plans.js:444` (day-options), `:544`
  (alternates), `:639` (fill-from-cart), `:708` (swap) each call `planContext` again. **A slot
  swapped into last week's plan is solved against today's target while the rest of the day was
  built to the old one.** `reconcileTarget` writes the new number into the row and logs
  `[target-drift]` — so the divergence is observable, but the plan is not rebuilt.

**Could this alone cause misses?** Not in the measured 578 days — the verdict is computed at
generation time against the same target the plan was built to, and the adaptive layer was
dormant. **In production, yes, and silently**: `GET /plans/current` (`routes/plans.js:114-121`)
returns the stored plan with no verdict and no target attached, so a stale plan is re-rendered
with no re-grade against the number now in force. I have **not** measured the size of this in
production — see §9.

---

## 8. Constraints any fix must respect

1. **The safety floor is constitutional and currently correct.** `max(RMR × 0.95, 1500 M /
   1200 F, user floor)` (`bmrEngine.js:224-228`), verified holding on 250/250 hand-derived
   targets, with `RMR × 0.95` binding on 42 of the 60 clamps. Nothing may prescribe below it,
   and the floor block is shown, not hidden (`:260-262`).
2. **Do not lower the per-LBM protein constant to buy compliance.** 2.513–2.756 g/kg LBM sits
   inside Helms 2014's 2.3–3.1 g/kg LBM. Lowering it is a nutrition change dressed as a solver
   fix, and it is exactly the trade the integrity rules make an automatic fail.
3. **Fixing the body-fat estimate must be paired with an absolute floor of ≈1.2 g/kg of actual
   bodyweight.** Without it, 8 of 147 assumed-BF personas drop below the hypocaloric-obesity
   lower bound (worst 0.97 g/kg). Trading one out-of-range prescription for its mirror image
   is not a fix.
4. **The shown math must stay honest.** `bfAssumed` / `assumedBodyFatPct` are already
   surfaced (`EngineTab.jsx:210`, `:335` — *"body fat % isn't set, so lean mass assumes a
   typical 21 % for your sex"*). If the assumption is replaced by a BMI-based estimate, the
   estimate and its formula must be named on screen the same way; an unexplained number that
   silently moves someone's protein target by 30 % is worse than a disclosed wrong one.
5. **Any re-implementation of the bands must use JS `Math.round` semantics** (half **up**).
   `p135` sits 0.0002 g from a tie; banker's rounding flips `proteinLo` there.
6. **Do not "fix" the target to raise the number.** §3b says the ask is expressible for
   99.2 % of personas under the graded rule, and §3d says the demanded protein density does
   not predict the miss (r = −0.057). Every finding in §3a, §4c and §5 is a **correctness**
   finding. The only one with a measured metric effect is `CARB_MIDPOINT_BUFFER_G`
   (A15: +2.7 pts on the band-shift half alone), and it is a metric effect *and* a
   correctness fix — the rare case where both point the same way.
7. **C21 applies.** None of this licenses refusing days. The 2 box-infeasible personas
   (p073, p127) are a refusal candidate worth ~0 points, exactly as A20's P7 found.

---

## 9. What I could NOT determine

- **The realized incidence of the carb-floor grading hole (§5.1).** I proved the graded carb
  floor sits at 24.8–25.5 g for all 9 carb-floored personas against an engine floor of 50 g.
  I did not re-grade the 578 days to see how many actually landed in that hole. That is A15's
  instrument (`A15-rescore.mjs`), not mine, and I did not want a second, differently-shaped
  answer to a question it can answer exactly.
- **The metric effect of a corrected body-fat estimate.** §4c is a target-side measurement.
  Turning it into a compliance delta requires a **re-solve**, not a re-grade — the corrected
  target changes both the bands and the solver's aim. I did not run one. My prediction is
  explicitly *unmeasured*: the 3.4-point Q1 estimate in §3d is the ceiling I would expect,
  and it does not clear C14's 3.45-point discrimination floor, so it may well measure zero.
- **The production churn exposure (§7).** I established the mechanism and its bounds from
  code. I did not instrument a real account over 4 weeks, and the fleet cannot show it because
  the adaptive layer never fired.
- **Whether `ASSUMED_BODY_FAT_PCT` should be replaced by Deurenberg specifically.** I used
  Deurenberg 1991 as a *benchmark* to size the error, not as a recommendation. Deurenberg is
  known to lose accuracy at the extremes of BMI — the direction of my finding is robust, the
  exact corrected gram counts are not. A proper answer needs a comparison of BMI-based
  estimators against the population the app actually serves, which is outside this territory.
- **Whether the 250-persona population is representative.** Every distribution in this report
  is over `qa-fleet-20260729-2032/personas.jsonl`. `IMPOSSIBLE`-tier personas are
  engineered, and the tier is over-inclusive (C7, C20). I report cohort sizes everywhere so a
  reader can re-weight, but I did not attempt a re-weighting to a real customer mix — there
  is no such mix on file.
- **The `either` slot type.** Exactly 1 recipe of 910 carries it. I treated it as eligible for
  both meal and snack slots per `eligibleRecipes` (`weeklyPlanner.js:184`) and did not
  investigate why the taxonomy is effectively binary.

---

## Artifacts

| file | what |
|---|---|
| `D7/d7_derive.py` | hand transcription of the full chain; the 212/212 gate |
| `D7/d7_coherence.py` | exact LP feasibility (HiGHS) for the nominal ask, the macro mix, and the graded box, per persona |
| `D7/d7-personas.json` | 250 rows: every intermediate, every band, every feasibility verdict |
| `D7/dev.db` | plain copy of the live (07-31) DB; **not** the fleet baseline — pool numbers above come from A11's 07-30 CSVs |

**Sources fetched and read for §4:**
- [Helms, Aragon & Fitschen (2014), *JISSN* 11:20](https://pmc.ncbi.nlm.nih.gov/articles/PMC4033492/) — 2.3–3.1 g/kg LBM; 15–30 %E fat; protein scales with leanness and deficit size.
- [Calculation of protein requirements: bodyweight vs fat-free mass, *Clinical Nutrition ESPEN* (2022)](https://www.sciencedirect.com/science/article/pii/S2405457722000250) — clinically relevant bodyweight-vs-FFM divergence in 78–100 % of participants with overweight/obesity.
- [Protein requirement in obesity, *Curr Opin Clin Nutr Metab Care* (2025)](https://journals.lww.com/co-clinicalnutrition/abstract/2025/01000/protein_requirement_in_obesity.7.aspx) — 1.2–1.6 g/kg/d actual, 1.0–1.5 g/kg adjusted, in hypocaloric obesity.
- NASEM AMDR (2024) protein 10–35 %E — quoted via A4's fetched citation, not re-fetched.

**CONFIRMED** — the coherence question was answered in both directions: the ask is expressible
(null result, 99.2 %), and it is arithmetically self-inconsistent and built on a wrong lean-mass
input (three correctness defects, ≈0 metric points between them).
