# W1-6 — THE MACRO CLOSER, MEASURED

*Persisted by the orchestrator (subagent harness blocks report-file writes). Raw artifacts + probe scripts on disk under `fleet/scratch/W1-6/`.*

| Item | Value |
|---|---|
| DB | `d9037dce…b623a1` · 14,151 Food / 910 Recipe · food fingerprint `b961ac3afbdf3f53` |
| `macroCloser.js` | 183 lines · sha256 `9194aea76af7f549e0985578afae92609b8a9190a348f088f51079ee1b8ef2d4` |
| `planContext.js` | 268 lines · sha256 `35596c08415f1c69a08d11c00ca36f400ccd24fdc51e337b4f7007218650a866` |
| Population | 250 personas, **639 day-records** |
| Seeds | **424242 / 20260730 / 8675309 — all three, both arms** |
| node | v24.13.0 · `BRAIN=off` forced · **zero network, zero LLM calls** |

Instrument checks on all six full runs: verdict-disagreements 0 · kcal-drift>1 0 · crashes 0 · invalid records 0 · silent-miss 0. Baseline reproduces A1's fresh-solve instrument **exactly — 437/623 = 70.1%**.

## 0. HEADLINE — what the closer buys

**+2.79 pts** (satisfiable-only, primary seed). **+2.86 pooled. Real, not noise** — clears the A5 MDE rule at every individual seed.

| seed | closer OFF | closer ON | delta | b | c | \|b−c\| | MDE=1.96·√(b+c) | real? |
|---|---|---|---|---|---|---|---|---|
| 424242 | 402/537 = 74.9% | 417/537 = **77.7%** | **+2.79** | 5 | 20 | 15 | 9.80 | **YES** |
| 20260730 | 402/537 = 74.9% | 417/537 = **77.7%** | **+2.79** | 13 | 28 | 15 | 12.55 | **YES** |
| 8675309 | 399/537 = 74.3% | 415/537 = **77.3%** | **+2.98** | 8 | 24 | 16 | 11.09 | **YES** |
| **pooled** | — | — | **+2.86** | **26** | **72** | **46** | **19.40** | **YES** |

Secondary denominators (never mixed), seed 424242: all judged 423/623 → **437/623 = 70.1%** (+2.25, b=7 c=21); **all planned** 423/639 → **437/639 = 68.4%** (+2.19).

**Noise verdict — explicit.** A5's "≥3.5 pts on n≈537" describes a *churning* treatment. The closer is the opposite: b+c is only 25–41 per seed, so its own MDE is ~2.0 pts. **+2.79 clears it with room, independently at all three seeds**, McNemar χ² 4.78–7.84 (p<0.05 each). Byte-identical day records between arms: 348–354 of 639 — low churn, consistent with a mechanism firing on 39.1% of days.

**Cost: not measurable.** ON 6.25 ms/day, OFF 6.30 ms/day. The ON arm is *nominally faster*; within-arm spread (172–338 ms) dwarfs the 34 ms between-arm difference. Report as **< 0.5 ms/day, indistinguishable from zero.**

### Per-diet split (seed 424242, satisfiable-only)

| diet | days | OFF | ON | delta | b | c |
|---|---|---|---|---|---|---|
| keto | 47 | 59.6% | 70.2% | **+10.64** | 0 | 5 |
| kosher | 35 | 45.7% | 51.4% | **+5.71** | 1 | 3 |
| vegan | 35 | 54.3% | 57.1% | +2.86 | 2 | 3 |
| none | 275 | 86.9% | 89.1% | +2.18 | 2 | 8 |
| vegetarian | 57 | 59.6% | 61.4% | +1.75 | 0 | 1 |
| mediterranean | 49 | 89.8% | 89.8% | **0.00** | 0 | 0 |
| paleo | 24 | 41.7% | 41.7% | **0.00** | 0 | 0 |
| halal | 12 | 100.0% | 100.0% | 0.00 | 0 | 0 |
| carnivore | 3 | 0.0% | 0.0% | 0.00 | 0 | 0 |

Gain concentrates where the *pool* is thinnest (keto, kosher) and is exactly zero for paleo and mediterranean. Per-diet cells are small — indicative ordering only; the pooled number is the measured one. Composition of the 348 additions: protein 192 · fat 81 · carb 75. Keto's +10.64 is bought with **fat and protein only** (zero carb adjusters).

### Commands

```bash
cd docs/surgery/CAMPAIGN/solver-brain/A1/rig
BRAIN=off node runRig.mjs --agent=W1-6 --pop=personas --seed=424242 --label=on-424242 --out=…/on-424242.jsonl --quiet
BRAIN=off node runRig.mjs --agent=W1-6 --pop=personas --seed=424242 --label=off-424242 \
  --treatment=…/fleet/scratch/W1-6/treatments/closer-off.mjs --out=…/off-424242.jsonl --quiet
node compare.v2.mjs …/off-424242.jsonl …/on-424242.jsonl
```

**Disabled without touching product source:** `macroCloser.js:111` — `if (!Array.isArray(adjusters) || !adjusters.length) return { slots, added };` — is the module's own documented no-op path. The treatment hands the solver `adjusters: []`. `resolveSlot` untouched; RNG stream untouched (the closer consumes no randomness). The rig's `noop.mjs` control reproduces the baseline exactly, proving the A/B path adds nothing.

## 1. Precise characterisation

### 1a. Add-only? **YES — structurally and empirically. G1 CONFIRMED verbatim.**

Every slot write is `+=` (`:159-162`), every totals write `+` (`:163-168`), grams floored at `MIN_GRAMS=4`. Decisively, the gap detector only ever pushes on `.short`:

```js
if (pShort > 0)                     gaps.push({ role: 'protein', … });   // :131
if (fat.short  > 0 && fat.mid  > 0) gaps.push({ role: 'fat',     … });   // :133
if (carb.short > 0 && carb.mid > 0) gaps.push({ role: 'carb',    … });   // :135
```

`bandMiss()` computes `over` (`:57-58`) and **nothing in the gap loop reads it** — `over` is consumed only inside `wouldHarm`'s guard. **There is no subtraction anywhere in the file.**

**4,000-day fuzz** (deterministic LCG seed 20260731, real `closeDayMacros`): macro totals that decreased **0** · adjuster rows with grams ≤ 0 **0** · days starting carb-OVER 3,048 → **no-op on 3,048 (100.0%)** · kcal-OVER 2,667 → **no-op on 2,667 (100.0%)** · fat-OVER 3,046 → no-op on 2,856 (93.8%).

**Real fleet (639 days):** 250 slots, 348 additions, slots whose kcal fell **0**, days whose kcal fell **0**.

**The three dominant failure modes, reproduced exactly as predicted:**

| starting failure | closer added | Δkcal | ΔP | ΔF | ΔC |
|---|---|---|---|---|---|
| fat over band (95 g vs 55–70) | **(nothing)** | 0 | 0 | 0 | 0 |
| kcal +25% over target | **(nothing)** | 0 | 0 | 0 | 0 |
| carb over band (360 g vs 180–260) | **(nothing)** | 0 | 0 | 0 | 0 |

**The closer is a strict no-op on the failure mode accounting for 94.2% of failing days.** Scale: **296 of 639 days arrive already over the fat ceiling**, 293 over carb, 30 over kcal +15%. It cannot act on any, and does not.

### 1b. Which ruler? **Its own — and it is NOT the shipping ruler.** (Under-reported.)

The closer never calls `dayTolerance()`. It builds targets from raw fields:

| axis | what `dayTolerance` grades (D3) | what the closer chases |
|---|---|---|
| protein | `≥ 0.85·pMid`, **one-sided, no ceiling** | `proteinMid = (proteinLo+proteinHi)/2` (`:124`) — the **MIDPOINT**, ~17.6% above the graded floor |
| fat | `[fatLo − 0.25·fatMid, fatHi + 0.25·fatMid]` | the **raw** `fatLo…fatHi` (`:132`) — **no ±25% allowance** |
| carb | `[carbLo − 0.25·carbMid, carbHi + A·carbMid]` | the **raw** `carbLo…carbHi` (`:134`) |
| kcal | ±15% symmetric | guard only, `after.kcal > target.kcal × 1.15` (`:84`) |

It fires on **250 of 639 days (39.1%)** while chasing a **strictly tighter target than the app grades on**, spending calorie headroom to close gaps the verdict would have forgiven. **Any claim that "the closer targets the tolerance bands" is false.** Aiming it at the real ruler is **un-costed headroom nobody has measured** (INFERRED — no arm run).

### 1c. Where in the pipeline? **G9 CONFIRMED — with a caveat W3-4 must carry.**

Exactly one call in all product source: `weeklyPlanner.js:32` requires it; `weeklyPlanner.js:951` calls it as the **last statement before return**.

```
resolveSlot          weeklyPlanner.js:591     → forms slot warnings at :661-671
solveDay slot loop   weeklyPlanner.js:906-944 → toSlotRecord() stores those warnings at :936
closeDayMacros       weeklyPlanner.js:951     ← THE CLOSER
generateWeekPlan     weeklyPlanner.js:996
generateBestWeekPlan mealSolver.js:679
scoreWeek            mealSolver.js:680        ← day verdict, POST-closer
```

The day verdict IS computed on post-closer macros. **A trimmer at `:951` is graded correctly; A17's disqualifying regression does not apply.**

> ⚠️ **`:951` is the right slot for the VERDICT and the wrong slot for the WARNING.** Slot warnings are frozen at `:661-671`, 290 lines upstream, and never recomputed. **A trimmer dropped at `:951` inherits E4 unchanged** — silently making every trimmed slot's warning wrong, in the *reassuring* direction. Any mutation there must re-derive the affected warnings.

### 1d. Which surfaces? **ONE. G7 CONFIRMED by counting arguments.**

`solveDay` declares **12** parameters (`weeklyPlanner.js:852`); the 12th is `adjusters = null`.

| call site | positional args | passes `adjusters`? |
|---|---|---|
| `mealSolver.js:496` (`generateDayCandidates`) | **11** | **NO** → `null` → no-op |
| `mealSolver.js:531` (brain-critic re-solve) | **11** | **NO** |
| `weeklyPlanner.js:996` (`generateWeekPlan`) | **12** | YES |

| route | solver entry | closer? |
|---|---|---|
| `POST /plans/generate` | `generateHorizonPlan` (`:324`) | **YES** |
| `POST /plans/day-options` | `generateDayCandidates` (`:463`) | **NO** |
| `POST /plans/:planId/slots/:slotId/swap` | `regenerateOneSlot` (`:709`) | **NO** |
| `.../alternates` | `alternatesForSlot` | **NO** |
| `/generate` single-meal branch | `solveOneMeal` (`:253`) | **NO** |

**User-visible inconsistency confirmed.** The Plan tab's day-options card and the week Generate button have materially different solving capability on the same profile and target — and `/accept-day` then writes the weaker day over the stronger one. Worth **+2.79 pts** that `/day-options` structurally cannot access. **One-argument fix** at `:496` and `:531`.

## 2. G2 / G3 — the reachability wall

**G2 CONFIRMED to three significant figures** (through the product's own `exclusionGate.isExcluded` + `foodValidation.macroTrustIssue`):

| measure | brief | measured |
|---|---|---|
| rows reachable as an adjuster | 10 / 14,151 = 0.07% | **10 / 14,151 = 0.071%** |
| protein ≥ 40 g/100g — exist / reachable | 87 / **0** | **87 / 0** |
| carb ≥ 60 & fat ≤ 3 — exist / reachable | 628 / **0** | **628 / 0** |
| vegan+soy+legumes max protein delivery | **0.0 g** | **0.0 g** |
| keto carb adjusters, every configuration | **zero** | **zero** (18 keto personas) |
| carnivore + dairy | one adjuster total | **1 of 10** (Chicken breast only) |

Two more: fat ≥ 80 g/100g — 171 exist, **2** reachable. Protein ≥ 20 g/100g — 2,797 exist, **1** reachable.

| profile | offered | protein | carb | fat | max protein g/day¹ |
|---|---|---|---|---|---|
| omnivore | 10 | 4 | 3 | 3 | 105.5 |
| vegan | 7 | 2 | 3 | 2 | 46.2 |
| **vegan + soy + legumes** | 5 | **0** | 3 | 2 | **0.0** |
| keto | 6 | 3 | **0** | 3 | 105.5 |
| carnivore | 3 | 2 | **0** | 1 | 74.3 |
| **carnivore + dairy** | **1** | 1 | **0** | **0** | 55.8 |
| paleo | 5 | 1 | 1 | 3 | 55.8 |

¹ upper bound: 3 rounds × `MAX_GRAMS.protein=180 g`, before `wouldHarm` refuses anything.

Population: **18 personas get zero protein adjusters — all 18 vegan** (matches the brief exactly). **22 get zero carb adjusters** (keto 18, carnivore 2, paleo 2). Zero lack a fat adjuster. Median offered: 8 of 10.

### G3 — the list is the constraint, not the gate. **CONFIRMED, not close.**

If `ADJUSTER_CANDIDATES` were removed and only the gate + macro-trust check remained:

| profile | rows the GATE would still allow | protein ≥ 40 | carb ≥ 60 & fat ≤ 3 |
|---|---|---|---|
| omnivore | **14,042 / 14,151 (99.2%)** | 87 | 622 |
| vegan | 7,124 (50.3%) | 37 | 572 |
| vegan + soy + legumes | 6,349 (44.9%) | **18** | 536 |
| keto | 8,153 (57.6%) | 43 | **0** |
| carnivore + dairy | 5,022 (35.5%) | 29 | 27 |

The gate admits **99.2%** of the library for an unrestricted user and **44.9%** for the hardest vegan stack. **A ten-name string literal at `planContext.js:167-178` caps reachability at 0.071%. The fix is extending a constant, not loosening a gate.** The one place the gate genuinely binds is **keto carbs — 0 of 14,151 rows clear both the gate and the carb-density bar**, which is *correct*. **Do not "fix" it.**

> ⚠️ **BLOCKED PATH — `fleet/TRIAGE.md` T-1.** `fdcCategory = 'Protein and nutritional powders'` is a confirmed allergen fail-open (13 of 17 rows clear dairy+milk+vegan wrongly). **W1-6 does not recommend widening into that class.** A naive "add high-protein rows for vegans" fix walks straight into it — those rows are exactly where the fail-open lives. Any list extension must be enumerated by hand, per row, with allergen columns populated first. **Widening before the gate fails closed converts T-1 from P1-latent to P0.**

## 3. The three unnamed defects — all reproduced

### G4 — `wouldHarm` does not protect an ALREADY out-of-band macro. **CONFIRMED.**

```js
// macroCloser.js:86-91
const wasOver = bandMiss(before, lo, hi).over > 0;
const isOver  = bandMiss(now,    lo, hi).over > 0;
return isOver && !wasOver;        // wasOver === true ⇒ "no harm", unconditionally
```

Direct reproduction with the real `Chicken breast, cooked, skinless` row (165/31/3.6/0):

| macro | band | BEFORE | AFTER | |
|---|---|---|---|---|
| kcal | ≤ 2,530 (+15%) | 1,800 | 2,097 | ok |
| protein | 150–190 | 100 | 155.8 | the closer's target |
| **fat** | **55–70** | **95.0** | **101.5** | **WORSENED by +6.5 g** |

**Control**, same day with fat starting *inside* the band at 60 g: the identical 180 g add is permitted and lands fat at 66.5 g — inside. The guard works when `wasOver` is false. **Only the already-broken day is unprotected** — precisely the day that most needs protecting. Its own docstring: *"'No worse' is the whole rule."*

**Population scale, 639 real days:** closer acted AND fat already over the ceiling — **106**, of which it made fat worse **106 (100%)**. Carb already over — **110**, made worse **68**. Worst fat worsening **+16.1 g** (p047 d6: 69.7 → 85.8 g against a 54–64 band). Worst carb **+10.3 g**.

**Honest magnitude note:** total fat added to already-over days is **142.4 g across 106 days ≈ 1.34 g/day**. The defect is **universal in direction (106/106)** but **modest in magnitude** on most days. It is a correctness/honesty defect first; its metric cost is real but small.

### G5 — `_adjusterFoods` has no invalidation path. **CONFIRMED (DERIVED).**

`invalidateRecipeLibrary()` (`planContext.js:96-100`) clears `_library` and `_pools`. Mentions `_adjusterFoods`: **NO**. `loadAdjusterFoods` exported: **NO**. Guarded by `if (_adjusterFoods) return _adjusterFoods;` (`:182`): **YES**. `_adjusterFoods = null` assignments in the file: **0**.

A Food row edited or quarantined through any route calling `invalidateRecipeLibrary()` is correctly dropped from `_library` and every `_pools` entry — **and the adjuster Map still holds the pre-edit row object** for the process lifetime. The `macroTrustIssue(food)` re-check at `:210` reads the **stale cached object**, so it cannot catch it either: **a row quarantined for bad macros keeps being added to real users' days, with the bad macros, until restart.** Not reproduced end-to-end (needs a live-server Food mutation; this fleet is measure-only), but the mechanism is single-branch at `:182`.

### G6 — every adjuster lands on slot 0. **CONFIRMED at 100%, worse than the brief's example.**

`:116` — `const host = slots.find((s) => s.recipeId && !s.locked && …)` — takes the **first** eligible slot and never reconsiders; all three rounds (`:128`) append to that same object.

**250 of 250 = 100.0%** on arrayIndex **0**, all `slotType: "meal"`. `proteinScale`/`sidesScale` never touched.

| metric | median | p90 | **max** |
|---|---|---|---|
| grams appended to the host slot | 20 g | 185 g | **375 g** |
| kcal added to the host slot | 41 | 283 | **701** |
| host slot kcal multiplier | ×1.09 | ×1.60 | **×5.56** |

| persona | anchor g | pre kcal | shipped kcal | × | appended |
|---|---|---|---|---|---|
| p088 | 316 | **123** | **685** | **×5.56** | 180g Chicken + 25g Olive Oil + 25g Avocado |
| p115 | 428 | 470 | **1,171** | ×2.49 | 25g Olive Oil + 180g Chicken + 25g Butter |
| p201 | 266 | 425 | 984 | ×2.32 | 180g Chicken + 20g Olive Oil + 140g Greek Yogurt |
| p211 | 1,664 | 377 | 834 | ×2.21 | 160g White rice + 14g Olive Oil + 160g Potatoes |

Worst by grams — **p098 d0: 375 g appended** to one slot. Worst by multiplier — p088: a 316 g dish arrives carrying 230 g of unrelated bolt-ons, **73% of the anchor's own mass**, 123 → 685 kcal.

**This is the "625 g chicken" defect the module's own header says it exists to prevent**, arriving through a door the header did not consider (`:44-47`). The `MAX_GRAMS` caps (fat 25 / carb 160 / protein 180) are enforced **individually** (`:146`). **Nothing caps their sum, the ratio to the host dish, or spreads them across the day's other slots.** Three rounds × three roles is how 375 g reaches one plate. **Plate realism has been rendered by nobody (brief §15) — these are the numbers that should trigger it.**

## 4. E4 — the closer makes the warnings lie. **CONFIRMED; magnitude ADJUSTED.**

The warning is built from `best.scaled` at `weeklyPlanner.js:661-671`, stored at `:936`, and `closeDayMacros` mutates `working.kcal` at `macroCloser.js:159`. **Nothing recomputes the warning.**

| measure | brief | measured (seed 424242) |
|---|---|---|
| adjusted slots (denominator) | 621 | **250** |
| …quoting a kcal the slot does not have | 33 | **15** |
| …as a rate | 5.3% | **6.0%** |
| …off by ≥ 50 kcal | 31 | **8** |
| …warning **understates** the overshoot | claimed | **8 of 15** |
| worst absolute discrepancy | 684 kcal | **701 kcal** |

**The RATE agrees closely (5.3% vs 6.0%); the absolute denominator does not (2.5×).** The rate is the transferable number. 250 adjusted slots of 3,011 total (2,820 filled, 748 carrying a warning, 362 quoting a kcal figure).

**Worst case — p115 d1.** Stored warning: *"…closest was 'Steak with Garlic Mushrooms' (**landed 470 kcal** vs a 557 target)."* The slot **actually ships 1,171 kcal.** The warning says the slot came in **87 kcal UNDER**. It is **614 kcal OVER**. **The sign is wrong**, not just the magnitude.

| persona | warning says | target | actually ships | off by |
|---|---|---|---|---|
| p115 | 470 | 557 | **1,171** | **701** |
| p088 | 123 | 667 | **685** | 562 |
| p211 | 377 | 744 | **834** | 457 |
| p211 | 609 | 744 | **938** | 329 |
| p222 | 377 | 508 | **602** | 225 |

**8 of 15 understate the real gap** — directionally *reassuring*. Under this repo's constitution ("silent target misses are forbidden") that is an **honesty-rule violation, not a cosmetic one.** Note p088 is the same slot as G6's ×5.56 case: **the two defects compound** — the slot the closer inflates most is the slot whose warning is most wrong. **Hard prerequisite for W3-4's trimmer.**

## 5. THE TRIM-ARM QUESTION

**Yes — overwhelmingly, and the prompt block's 74.2% badly understates it.** Measured on the 120 out-of-band days of the 537-day satisfiable set, seed 424242, closer ON:

| failing axis | count |
|---|---|
| fat OVER band | **83** |
| carb OVER band | **47** |
| kcal OVER (>+15%) | **29** |
| carb SHORT | 5 |
| kcal UNDER | 1 |
| protein SHORT | 1 |
| **fat SHORT** | **0** |

**OVER-side failing axes: 159 / 166 = 95.8%.** Excluding protein (no ceiling by construction): **159 / 165 = 96.4%.**

Per **day**, which is what the metric grades:

| failing day shape | days | share |
|---|---|---|
| **PURE OVER — only a trim can fix it** | **113** | **94.2%** |
| MIXED | 6 | 5.0% |
| PURE UNDER — only an add can fix it | **1** | **0.8%** |

**One day in 120 is fixable by adding. 113 are fixable only by subtracting. The module that ships is the one that can only add.**

**Corroboration from the closer's own harm arm.** The 26 pooled days it *breaks*, by newly-broken axis: fat OVER 15 · carb OVER 7 · kcal+fat OVER 3 · carb OVER + protein short 1. **25 of 26 harm days are broken OVER-side.** *(Caveat: b-days net direct additions and best-of-5 selection churn — the closer changes `scoreWeek`, changing which of five weeks wins. Both components push the same way; the direct-harm measurement is §3's 106/106.)*

### Verdict for W3-4

1. **The thesis holds, larger than stated.** Prompt block 74.2% → **95.8% of failing axes, 94.2% of failing days** over-side. Agrees with the brief's shape; **refutes the prompt block's 74.2%** on this tree. **If W1-3 lands near 74% rather than near 95%, the discrepancy is almost certainly a denominator difference (failing *axes* vs *days* vs *slots*) — reconcile before either publishes.**
2. **The slot is right.** `:951` runs before `scoreWeek`. **G9 confirmed.**
3. **Two hard prerequisites, both W1-6 findings:** (a) **recompute slot warnings** after any mutation at `:951`, or the trimmer ships E4 by construction; (b) **fix `wouldHarm`'s `isOver && !wasOver` first** — a trimmer sharing that guard inherits the hole in mirror image, unable to recognise "already short" as worth protecting. **Correct predicate: distance to band did not increase, not did not newly cross.**
4. **The trimmer needs a different lever.** The closer's lever is *append a food*; a trimmer's is *remove or shrink an ingredient* — which the 250/250 slot-0 concentration shows the current host-selection cannot express. **Do not reuse `closeDayMacros`'s host-picking.**
5. **Expected size.** The add-only arm is worth **+2.79 pts** on a population where only 0.8% of days are add-fixable; a trim arm addresses **94.2%**. Not a licence to multiply — C5 measured A17's trimmer at **+2.24 marginal over C1**, and levers must never be summed (cap +22.95). But it is strong evidence the trim direction holds the remaining headroom, and that **a trimmer must be measured against the shipping closer as its baseline arm**, not against a no-closer baseline, or its marginal effect will be overstated.

## 6. BRIEF-CLAIMS VERDICTS

| # | brief | measured | verdict |
|---|---|---|---|
| **G1** | `+=` at `:130-135`; 4,000-day fuzz 0 reductions; three probes → nothing | `+=` confirmed; fuzz **0 reductions**; all three probes → **`(nothing)`, 0/0/0/0**; 348 real adds, **0 kcal decreases**; 100% no-op on carb-over and kcal-over | **CONFIRMED** (verbatim) |
| **G2** | 10/14,151; 87/0; 628/0; 0.0 g; keto zero carb; carnivore+dairy one | **10/14,151 = 0.071%**; **87/0**; **628/0**; **0.0 g**; keto **0 carb** in all 18; carnivore+dairy **1** | **CONFIRMED** |
| **G3** | ten names; gate binds in one place (18 vegan) | gate would admit **99.2%** omnivore / **44.9%** hardest vegan — the **list** caps it at 10. Gate empties a role for **18 vegan** (protein, exact) *and* **22** (carb) | **CONFIRMED** (headline); sub-detail **ADJUSTED** — two role-classes |
| **G4** | fat 95 → 100.2 vs 55–70 | reproduced **95 → 101.5**; control behaves correctly; **106/106** fat-over worsened, 68/110 carb; worst **+16.1 g**; total 142.4 g / 106 days | **CONFIRMED** |
| **G5** | no invalidation path | **0** resets; `loadAdjusterFoods` **not exported**; `macroTrustIssue` reads the stale object | **CONFIRMED** (DERIVED) |
| **G6** | 353 g → 300 kcal breakfast → 922 (×3.07) | **250/250 = 100.0%** on index 0; max **375 g**, **+701 kcal**, worst **123 → 685 = ×5.56** | **CONFIRMED** (worse) |
| **G7** | `:496`/`:531` pass 11 args | verified programmatically: **11 / 11 / 12**; declaration has 12; exactly one `closeDayMacros` call | **CONFIRMED** |
| **G8** | untracked, zero tests | **zero tests confirmed** — no test file references `macroCloser`/`closeDayMacros` | **CONFIRMED** (inherited) |
| **G9** | closer before `scoreWeek` | verified hop by hop: `:951` → `:996` → `mealSolver:679` → **`scoreWeek` `:680`** | **CONFIRMED** — ⚠️ warnings at `:661-671` are pre-closer |
| **E4** | 33/621; 31 off ≥50; worst 684 | **15/250** (**rate 6.0% vs 5.3%**); **8** off ≥50; worst **701**; **8/15 understate**; worst case **flips the SIGN** | **ADJUSTED** — mechanism + rate confirmed, denominator 2.5× smaller |
| **B2** | gate 2-macro, verdict 4-macro | `:630` gates on `kcalOff`+`proteinShort` only; `:634`/`:651` are tie-breaks among admitted candidates. **506** days pass the 2-macro gate; **89 (17.6%)** still fail the 4-macro verdict | **CONFIRMED** |
| **B10** (not owned) | prompt block 74.2% | **95.8% of failing axes / 94.2% of failing days** | **REFUTES the prompt block**; supports the brief |

## 7. Hard-rule compliance

```
$ git diff --stat HEAD -- backend/src frontend/src
(no output)
```

**W1-6 wrote no file under `backend/` at any point** — the `backend/scripts/qc/*` entries in `git status` are W1-1's instrumentation. W1-6's footprint is `fleet/out/W1-6/` and `fleet/scratch/W1-6/` only.

**DB untouched** — still hashes `d9037dce…b623a1` after all six runs. Every run went through `dbcopy.prepareAgentDb("W1-6")` + `assertIsolated("W1-6")`, which *refuses* to hand back the shared DB.

**Zero network / zero API cost.** `BRAIN=off` set by `runRig.mjs:37` and on every command line. The rig never passes `aiFallback`. **No P0 on that axis.** No `git push`. No `-f`/`-F` flag.

Artifacts: `fleet/scratch/W1-6/treatments/closer-off.mjs` · `runRich.mjs` · `analyze.mjs` · `closer-internals.mjs` · `g2-reachability.mjs` · `g4-g5-probe.mjs` · `final-probe.mjs` · `raw/{on,off}-{424242,20260730,8675309}.jsonl` · `raw/rich-on-424242.jsonl` · `raw/cmp-*.json` · `analysis-{1..5}.md`.

Evidence tiers: §0, §2, §3 (G4 population), §4, §5 **MEASURED**; §1b's "un-costed headroom" **INFERRED**; G5 **DERIVED**; G8 inherited.
