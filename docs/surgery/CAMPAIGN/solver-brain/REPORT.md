# SOLVER BRAIN — final report

**Question:** can Cut Protocol's meal solver reach 85–99 % macro compliance, and if so by what
mechanism and at what cost?

**Fleet:** 25 agents, `BRAIN=off`, 2026-07-30 / 07-31. 386 rows in `CLAIMS.tsv`.
**Synthesis rule in force:** this report introduces no number that does not already appear in an
agent's `FINDINGS.md`. Where a number the report needs was never produced, it says
**not measured** and names the agent who should have produced it.

**Agents read in full for this synthesis: A1–A24, all 24.** None summarised from a title.

---

## 1. The answer, in one paragraph

**Yes — 85 % is reachable, on the satisfiable-only denominator, by one mechanism, and it has been
measured rather than projected.** Replacing the solver's two-knob portioning solve with a
**4-macro tolerance-normalised weighted least-squares objective** (A13's `wls2`, a change at
`weeklyPlanner.js` L394/L451, not a new degree of freedom) moves satisfiable-only compliance from
**77.1 % to 91.8 % — +14.74 pts [+11.40, +18.08], b=8 c=87** (MEASURED, rig, seed 424242),
replicated at two further seeds (**+14.37**, **+13.99**) and defended by A22's negative control: a
re-portioning objective weighted on **kcal alone**, same rig, same seed, same hook, moves
**+0.00 pts (b=5 c=5)** — so the gain is not an artifact of touching the portioner. The highest
arm anywhere in the study is **97.01 %** (`floor25w` = the same objective plus a 0.25× portion
floor, **+19.96 [+16.54, +23.39], b=1 c=108**) — **but it exists at one seed only, and it ships
35.5 % of served satisfiable slots below the old 0.5× portion floor**, a plate-size cost measured
in scale ratios and never rendered in grams. **99 % is not supported by anything measured**, and
on all 578 days it is arithmetically impossible: A20's repaired bound proves 16 days infeasible,
capping all-days at **562/578 = 97.2 %**. The ceiling this study can defend is therefore
"85 % yes, 97 % once, 99 % no", and the binding cost is not compliance but **portion realism and
slot-level amber**, both of which the winning arms make worse before they make them better.

---

## 2. The ceiling decomposition — 578 days

**This is the study's core scientific contribution and it changed twice mid-flight.**

### 2.1 The one decomposition this report carries (A24, DERIVED from `A20/A20-day-labels.jsonl`)

| bucket | days | in band | miss |
|---|---|---|---|
| **INFEASIBLE — proved** (A20's repaired bound) | **16** | 0 | 16 |
| **UNKNOWN** — no proof, no certificate (36 days that lost their proof + 31 prior) | **67** | 0 | 67 |
| **SAT-certified** — an in-band plan exists for this day | **495** | **405** | 90 |
| **TOTAL** | **578** | **405 = 70.07 %** | 173 |

MEASURED / DERIVED. **Why this one and not A20's own:** A20's published P7 confusion matrix
**sums to 511**, not 578 — A22 caught it (`INCOMPLETE`), and A24 repaired it by restoring the 67
UNKNOWN-accepted days the matrix omitted. The ledger row is defective; A20's prose is not.

**The "0 in band" against the 67 UNKNOWN days is tautological and must not be read as evidence of
infeasibility** — a certificate *is* an in-band day, so any day with an in-band observation is
SAT-certified by construction. **The 67 UNKNOWN days are where the ceiling uncertainty lives.**

### 2.2 The three live ceilings, shown and not averaged

| ceiling | source | status |
|---|---|---|
| **"near 88 %"** all-days | mission prompt + `BRIEF.md`, from an 83-day impossible tier | **Dead.** Not reproducible from its own tier count: **495/578 = 85.6 %** (A3, DERIVED). Two independent errors, not one — the tier is also over-counted |
| **91.0 %** all-days (526/578) | A3 / C7 | **Superseded as a bound.** A20 measured a dead term in A3's own script: `f.kcalPer100g > 0 && f.proteinPer100g > 0` against a Prisma `Food` model whose columns are `kcal`/`protein` — **evaluates to 0 across all 14,151 rows**. A3's operative SCALED bound is recipe-only by construction and survives, but omits the macro closer entirely |
| **97.2 %** all-days (562/578) | A20 repaired (SCALED + every surviving adjuster at its `MAX_GRAMS` ceiling); reproduced by A22 | **The one bound this report carries** |

**Picked: 97.2 %.** Defence: it is the only bound whose computation has been audited and repaired,
and A22 reproduced it independently (**16 days, 562/578 = 97.2 %**). It is not averaged with the
others; the others are shown above and rejected for stated cause.

**And immediately, per A24 (I9): 97.2 % is a proof that WEAKENED, not a ceiling that rose.**
36 days moved INFEASIBLE → **UNKNOWN**, not INFEASIBLE → satisfiable. They gained no certificate.
The honest sentence is **"16 days are provably impossible; 67 days are unknown in both
directions"** — not "the ceiling went up by six points".

### 2.3 The denominator this report divides by

**Primary: satisfiable-only.** On the HTTP fleet — the canonical instrument for *levels* (C15) —
that is **526 of 578 days**, and today's rate is **405/526 = 77.0 %** (A3, reproduced exactly by
A15's independent re-grade and by A22). Deltas are quoted on A1's rig, whose satisfiable tier is
**536 of 622 days**, baseline **413/536 = 77.1 %** at seed 424242. **The two are never mixed** —
the rig deviates from the fleet in four documented ways (startDayOfWeek pinned to 0, free-text
exclusions not applied, no HTTP layer, adjusters re-assembled).

**Defence of 526, stated with its cost.** A20's repair implies a *stricter* satisfiable
denominator of **562**, on which the same baseline reads **72.06 %** (A20, MEASURED) — five
points worse. This report shows that figure rather than hiding it. 526 is kept for three reasons:

1. It is C7's ruling, independently corroborated by A1 — the IMPOSSIBLE tier produced **21 of 86**
   judged days in band, impossible if refusal were the correct output — and reproduced by A22.
2. Every Phase-4 delta in this study was measured on it or its rig analogue. Re-basing would
   require re-running the fleet.
3. Promoting the 36 freed days to "satisfiable" asserts feasibility nothing measured. Those
   personas were **solved 310 times across 2 instruments / 6 runs and landed in band 0 times**,
   giving an exact one-sided 95 % upper bound on the false-refusal rate of **0.96 %** (A20).

**Deliberate asymmetry, declared:** the denominator comes from A3's bound and the ceiling from
A20's repaired bound. That is not a double standard — it is C21's discipline. **A20 measured that
using one object as both the ruling denominator and the refusal predicate launders +4.94 pts**
(predicate P4) by removing 36 days it cannot prove impossible. Keeping them separate is the point.

**And the choice does not change the answer.** A21 measured its headline across **4 denominators
x 3 seeds**: spread **1.99 pts** (DERIVED). Judged-day counts are identical in baseline and
treatment arms everywhere; A24's C21 audit confirms it independently — **622 judged / 536
satisfiable-judged in all 14 headline arms**. **No lever moved a denominator.**

---

## 3. Ranked lever table

All deltas are **satisfiable-only, paired McNemar, A1's rig (n=536), compare.v2.mjs**, unless
stated. **C14 governs every verdict here:** a treatment that churns days in both directions needs
**|delta| >= 3.5 pts** before this study may call it real (A1, DERIVED from a measured positive
control: b=50, c=39, n=536 → 95 % half-width **3.45 pts**). A one-directional treatment (b=0) is
floored instead at ~1.5 pts / **~9 flipped days**. **A delta between those floors is UNRESOLVED,
not small** — that is a statement about n, not about the mechanism.

**The cap on everything below, first (A24 / I1, MEASURED).** Baseline satisfiable misses are
**123 of 536**, so **the union of all levers cannot exceed +22.95 pts**. The naive sum of the six
measured gross gains (87 + 84 + 61 + 43 + 31 + 9 = 315 days = **+58.77 pts**) is
**2.56x arithmetically impossible**. **Never sum this table.**

| # | lever | delta | b / c | marginal over #1 (A24) | verdict |
|---|---|---|---|---|---|
| 1 | A13 `wls2` 4-macro tolerance-normalised portioning | **+14.74** | 8 / 87 | — (it is the base) | **REAL**, 3 seeds |
| 2 | A13 `floor25` 0.25x portion floor, on top of #1 | **+19.96** total | 1 / 108 | +5.22 (b=1 c=29) | **REAL, single seed** |
| 3 | A16 protein-concentrate pool enrichment (N=8) | +10.45 | 5 / 61 | **+7.46** [+4.90,+10.02] | **ESTIMATED** |
| 4 | A17 macro trimmer | +14.93 | 4 / 84 | **+2.24** (12 d) | **UNRESOLVED** + disqualified |
| 5 | A14 attempt-budget floor 5 → 12 | +1.12 pooled | 17 / 35 | +0.75 (4 d, via att12) | **UNRESOLVED** |
| 6 | A19 variety-safe day harvesting | +1.68 | 0 / 9 | **+0.00 (0 d)** | **SUBSUMED — dead** |
| 7 | A18 `SCORE_WEIGHTS` retune | **0.00** | b == c, 6/6 | 0.00 | **DEAD, structurally** |
| 8 | A17 closer-candidate widening | +0.19 | 5 / 6 | — | **AUTOMATIC FAIL (leak)** |
| 9 | A15 ruler widening (fat ±50 %) | +4.0 max | 21 / 0 | — | **not a solver lever** |
| 10 | A20 sound refusal (P7) | **+0.00** | — | — | **ship for honesty, not points** |
| 11 | A21 "best stack" (= #3 + a #1-equivalent) | +18.07 (D2) | — | beaten by #2 by +2.05 | **overstated as "combined"** |

### 3.1 Effort, confidence, and what each lever breaks

The mission asks for effort and breakage beside every delta. Ranked as above.

| # | lever | effort | confidence | what it breaks |
|---|---|---|---|---|
| 1 | A13 `wls2` | **Lowest in the study.** `weeklyPlanner.js:451` already computes the fat/carb composition target and scores with it at L468-469, then discards it before `scaleRecipe(recipe, kcalTarget, proteinTarget)` at L394 portions the plate. The intervention passes an argument that already exists | **Highest.** 3 seeds (+14.74 / +14.37 / +13.99), A22 reproduced from its own arms (b=8 c=87), and A22's kcal-only negative control through the same rig, seed and hook moves **+0.00 (b=5 c=5)** | **Slot amber rises while day misses fall.** Filled warned satisfiable slots **341 → 405** (13.5 → 16.0 %). The per-slot gate is kcal+protein only, so it flags slots the 4-macro portioner deliberately detuned. Customer-visible regression in signal quality on days that now pass |
| 2 | A13 `floor25` on top of #1 | One literal: `{ min: 0.5, max: 2 }` → `{ min: 0.25, max: 2 }`, asserted against source text before compiling | **Single seed.** Only `A13-floor25w-s424242.jsonl` exists; A22 re-ran that same seed, which is reproducibility, not replication | **Ships quarter portions.** 35.5 % of served satisfiable slots carry a knob below the old 0.5× floor; 10.4 % of plates exceed a 4× role-scale spread. Grams are not in the rig record — **ESTIMATED as unacceptable for some plates until someone renders them.** It does *cancel* #1's amber cost (warned slots back to 343) |
| 3 | A16 concentrate route | **Needs a `Food` row that does not exist.** Nutritional yeast at LABEL tier, not USDA-VERIFIED (A23) — FDC 1946780 returns 404 — plus ~4 authored recipes | **ESTIMATED, not MEASURED.** Rows are optimised straight onto each corner's measured target centroid with no taste, cost or repeat-fatigue constraint; a human author aiming less precisely needs more rows | Nothing measured. Its marginal contribution over #1 is +7.46 [+4.90, +10.02]; A21's `wls2 → stack` marginal is +3.17, **below C14's floor** |
| 4 | A17 trimmer | ~150 lines mirroring `wouldHarm`, **plus rewiring so the verdict is computed post-trim** — the honesty rewire is the work, not the arithmetic (A17, ESTIMATED) | Gross +14.93 replicates across 2 seeds, but **marginal over #1 is +2.24 on 12 days** — below C14's floor, so unresolved | **Disqualified as prototyped.** 1 verdict disagreement and 1 silent miss (`p237#6`, EASY, style `none`: engine claims `inBand=true`, grader says false, no warning, no diagnosis) against baseline 0/0. Also 2,034 cuts over 890 firings, **median 48.9 % of a real component deleted** |
| 5 | A14 floor 5 → 12 | One expression: `max(5, min(20, n/10))` → `max(12, …)` | **Unresolved.** +1.12 pooled [+0.24, +2.00] at n=1608, positive in 3/3 seeds, b=17 c=35. Marginal over #1 is +0.75 on 4 days | +17 % candidate draws. Effect confined to the 60 thinnest days, where it is **+15.00 pts (b=2 c=11)** |
| 6 | A19 variety-safe harvesting | Day-level selection over already-solved plans | +1.68 at all three seeds, b=0 c=9 — but **all 9 days are already #1's** | Nothing. It is subsumed |
| 7 | A18 `SCORE_WEIGHTS` | n/a | **Dead structurally.** The constant enters only after `daysInTolerance` ties, so the in-band count is preserved by construction. Predicted `b == c`; observed **b == c in 6 of 6 arms** | n/a |
| 8 | A17 closer widening | n/a | **Automatic fail, integrity rule 2** | Placed `Sea cucumber, yane (Alaska Native)` **309 times** across vegan and vegetarian plans (277/32) from 668 invocations |
| 9 | A15 ruler widening | Config | Exact — a deterministic re-grade of a fixed day set, b=21 c=0 | **Not a solver lever, and not this study's call.** ±50 % is 1.83× the NASEM AMDR relative half-width, supported by no published guideline. Whether the ruler changes is a nutrition question and the owner's, decided on A4's citations |
| 10 | A20 sound refusal (P7) | A repaired bound, already written | Exact: FR = 0, recall 16/52 = 30.8 % of the tier A3 asserted (100 % of what is provable) | Nothing. It converts 16 silent failures into 16 explained refusals and moves no headline |
| 11 | A21 "best stack" | n/a | **Unreproducible as specified.** Composition is DERIVED by signature; `A21/` holds no run script and the invocation was never written to disk | Overstates "combined": it contains 2 of 6 levers |

**The one instruction in this study's own status log that is wrong, corrected here rather than quietly dropped:** the 07-31 entry reading *"A19's oracle bound is the number A25 should keep."* A22 found the bound mixes denominators — numerator on planned days, denominator on judged days. **A25 uses 86.9 % satisfiable (headroom +9.9), not 87.7 % (+10.6).** A19's deltas are unaffected; only the bound moves.

---

## 4. Per hypothesis — verdict and evidence

Every agent's own one-line verdict, with the evidence that carried it. **Falsifications are listed with the same prominence as confirmations, and there are eight of them.** No entry here is summarised from a title; all 24 `FINDINGS.md` were read in full.

| id | question | verdict | evidence that decided it |
|---|---|---|---|
| **A1** | shared rig + `compare.mjs` | **CONFIRMED** | No-op A/B returns exact zero — **639/639 byte-identical**, b=0 c=0 on all three denominators. The more useful result is negative: a measured positive control (pool thinned to 2-of-3) moved satisfiable-only **−2.05 pts with a paired interval still spanning zero**, giving a 95 % half-width of **3.45 pts**. That became C14 and it governs every verdict in this report |
| **A2** | failure taxonomy of 173 missed days | **CONFIRMED** | **63.6 % of satisfiable misses bind on the portion bound** (70/110). Protein-short and kcal-out are binding on **zero** days. Reproduces the brief's own per-slot figures within a point (67.8 % vs 68.3 %; 40.3 % vs 39.3 %). **Contradicts the brief on direction: 66 of 70 pinned days needed the day SMALLER and were blocked at 0.5×; 0 were blocked only at 2.0×** |
| **A3** | ceiling audit / denominator | **FALSIFIED** | The impossible tier holds two constructions, not one. `every-protein-walled` lands **0 of 53** days in band; `floor-vs-rate` lands **20 of 30 (66.7 %)** — a construction cannot be unsatisfiable by design and pass two thirds of its days. Denominator **495 → 526**. The brief's own 83 implies **85.6 %**, not 88 % |
| **A4** | is the fat band defensible? | **FALSIFIED** | The ±8 % band is real but never decides anything. `bandMiss()` divides by the midpoint and `DAY_FAT_TOLERANCE_PCT = 0.25` stacks on top, giving an effective gate of **±33.1 %** — *looser* than the NASEM AMDR's ±27.3 %. Separately: the effective pass floor (0.2475·lbm) sits **17.5 % below the engine's own `ESSENTIAL_FAT_PER_LB_LBM = 0.3`** |
| **A5** | diet-problem literature | **CONFIRMED** | Lead null: **no published study reports a days-in-band figure comparable to 70.1 %** — the literature optimises cost or deviation and reports feasibility, a different quantity. Class DERIVED as goal-programming MMKP. Predicted A19's gap at single digits with a stated falsifier (>10 pts) |
| **A6** | industry tolerance convention | **CONFIRMED** | **No consumer app surveyed publishes a per-macro fat tolerance.** Exactly one (Fitia) publishes any numeric tolerance, calories only. Zero report a hit rate. **70.1 % is comparable to no published figure in either direction.** Landed on A4's identical `0.2475·lbm` without coordination |
| **A7** | vegan feasibility under the killer stack | **CONFIRMED** | **Library problem, not botany** — with the caveat that on whole foods only it genuinely is a botany wall. Required density 7.98–8.63 g/100 kcal; best in-library vegan staple is pepitas at **5.81**, and a full day of them is 158 g fat against a 51–60 g band. Zero rows for every concentrate searched by name |
| **A8** | infeasibility-detection metrics | **CONFIRMED** | **The app has no refusal path to measure.** `diagnose()` labels a delivered plan; it never withholds. Proposed the KPI split A20 used, and named the relabelling trap before A20 priced it at +27.94 |
| **A9** | solve-loop anatomy | **CONFIRMED** | Two knobs per slot, **both fully consumed by a 2×2 linear solve for kcal and protein before fat or carb is considered** — residual freedom for fat/carb is exactly zero. The L437 comment is false about the mechanism and true in effect. Called the trimmer unbuilt before A13 and A17 both found it |
| **A10** | dormant optimizer wiring | **CONFIRMED** | `solveGeneral` is executed by **zero product paths**, BRAIN on or off. Per-role cuts pinning 77.2 → 46.5 % for **+0.8 pts**; the variant that buys compliance (+5.6) pushes pinning back **up** to 77.2 %. First sighting of the pinning inversion |
| **A11** | pool density per corner | **CONFIRMED** | **Only 5 of 218 satisfiable personas (2.3 %) are pool-limited.** The weak corners are solver-limited, not pool-starved. Keto is the counter-example: smallest mainstream pool, highest in-band density (29.0 %) |
| **A12** | ruler coherence | **CONFIRMED** | **250/250 profiles jointly satisfiable** — the grader/engine pair contributes **0.0 points** of the gap. All incoherence is at the UI boundary: fat-over fails the grader while the rail shows a floor with no ceiling and never turns amber |
| **A13** | n-knob portioning | **FALSIFIED** | The assignment's kill condition fires on the winning arm — **95.7 % of days that PASS touch a bound** under `role`. The knobs buy **+0.37 (unresolved)**; the 4-macro tolerance-normalised objective buys **+14.74 [+11.40, +18.08]** at three seeds. Fat-over-band days 255 → 152 |
| **A14** | search-budget re-sweep | **CONFIRMED** | The prior flat-after-12 null reproduces at halved amplitude. **Its stated mechanism does not:** thin pools are where depth gains *most* (+16.67 pts on the 60 thinnest days), the opposite of the starvation story the brief carries as settled |
| **A15** | ruler variants, re-scored | **CONFIRMED** | Reproduced baseline **exactly** (405/578 and 405/526, zero disagreements) before reporting. **≤ 4.0 of 23.0 points are ruler-attributable**, and only at ±50 %. **42 of 42 fat-only misses are OVER the band, none short.** A4's C3 defect flips exactly **zero** days |
| **A16** | pool enrichment curve | **CONFIRMED** (leak property downgraded) | **~4 recipes on ONE concentrate row reaches 85 %**; 65 whole-food vegetarian rows are needed for the same. The gain does not land where the corner label says — vegetarian personas themselves move +1.7 pts, unresolved. Re-checked by name after C19 and **downgraded its own leak claim to necessary-condition-only** |
| **A17** | closer expansion | **FALSIFIED** | Widening moves **+0.19 (unresolved)**, and **9 of its 10 gained days sit in the refusal tier**. It realizes the C13 leak — 309 sea-cucumber placements. The premise number is wrong: the gate fires on **46.2 % of invocations**, not 9.9 % of slots. The trimmer it found instead is +14.93 gross |
| **A18** | objective weights | **FALSIFIED** | The assigned constant is **unreachable at `BRAIN=off`** — the hook failed loud with `0 applied`. Its live analogue `SCORE_WEIGHTS` reshuffles 180–220 of 639 days and moves compliance **0.00 pts in all five arms**, structurally, because it is a post-hoc tiebreak |
| **A19** | joint vs greedy | **CONFIRMED** | Achievable +1.68 (b=0 c=9, three seeds); **oracle bound +9.9** after A22's denominator repair. **The gap is the `DEFAULT_REPEAT_CAP = 2` variety contract, not solver quality** — a product decision. A5's prediction confirmed; its "never worse" sub-prediction falsified (dayN lost 34 in-band days) |
| **A20** | refusal path | **CONFIRMED** | A sound pre-solve refusal with **FR = 0** exists, covers **16 days not 52**, and buys **+0.00 pts**. Found the dead term in A3's bound — and caught **its own** audit script copying the same field names, so its earlier "212/212 agrees with A3" was agreement on a shared bug |
| **A21** | best stack | **CONFIRMED** | Stack **94.21 %** on C7's denominator (+18.07), **but it is not the best arm on disk** — `floor25w` scores 97.01 % with no pool change. Measured C23 directly: `wls2` rescues 87, `conc8` rescues 61, **52 are the same days** |
| **A22** | replay via `oracle.mjs` | **CONFIRMED** | A13, A17, A15, A16, A20, A1, A19's deltas and A3's split all reproduce. **A19's oracle bound FAILS** (mixed denominators). Two ledger rows defective. **Retracted its own predecessor's false failure call** on A19's no-roll count |
| **A23** | citation check | **CONFIRMED** | **No fabricated citation in Phase 2.** All 20 external sources located, fetched and confirmed. Three real corrections: A7's yeast provenance is LABEL not USDA-VERIFIED; A5's formulation class is DERIVED and no source states it; the SEO tier is self-published and **propagated nowhere** |
| **A24** | red team / inflation list | **CONFIRMED** | **The double-counting charge comes back negative** — 129 of 129 arms carry the post-campaign fingerprint. Eleven discounts issued. Honesty-on-miss attacked independently and **holds**: 48 of 173 misses carry no slot warning, but 48 of 48 carry `diagnosisFeasible=false` |
| **A25** | this report | see §7.1 | Ran, wrote §§1–3, and died mid-table. Completed afterwards from the 24 artifacts — provenance stated in §7.1 rather than hidden |

---

## 5. What could not be determined, and what it would take

Named honestly, each with the agent who owns it and the test that would settle it. **None of these is a small residual; the first two bound the study's headline.**

| # | open question | why it is open | what would settle it |
|---|---|---|---|
| 1 | **Is the 0.25× portion floor servable?** | The rig records scale ratios, not grams. A13 measured 35.5 % of served slots below the old floor and labelled acceptability **ESTIMATED** — nobody has rendered a plate | Render the 5th-percentile plates at 0.25× and put them in front of the owner. This is a product judgment, not a measurement, and it gates the study's highest arm |
| 2 | **Does 97.0 % replicate?** | `floor25w` exists at **one seed**. A22 re-ran the same seed, which is reproducibility, not replication (integrity rule 8) | Run `floor25w` at seeds 20260730 and 8675309 through A1's rig. One command each; A24 flagged this as I8 |
| 3 | **The 67 UNKNOWN days** | They hold no proof of impossibility and no certificate of satisfiability. "0 in band" for them is tautological — a certificate *is* an in-band day | This is where the ceiling uncertainty lives. Either a tighter bound proves them infeasible, or one in-band plan certifies each. A20/A24 own it |
| 4 | **How many days are pool-limited?** | A3's own sensitivity table spans **25 to 145 days**, and a second A3 script gives 62 against the ledger's 140. A22 flagged the quantity as unstable; A24 issued it as I11 | **Not measured.** Quote the range, never the point. Settling it needs a definition ruling on `afterStack` before a count |
| 5 | **Adjuster-placed foods and leaks** | The rig's slot record carries no ingredient names and no adjuster field, so **every leak check in this study is structurally blind to adjuster-placed foods**. A16 states this plainly: a text scan returning 0 is evidence the JSONL never records them, not evidence of absence | Add an adjuster field to the rig's slot schema and re-run the C13 by-name check across all arms |
| 6 | **A18's fallback-rank lever** | `s-fallbackcomp` gives an identical +0.75 point estimate at two seeds with c > b both times, and both intervals span zero. Below C14's floor: **unresolved, not small** | A third seed and a larger n. A18 names it the only arm worth that |
| 7 | **A14's attempt floor** | +1.12 pooled at n=1608 sits under the 3.5-pt standard | A14 computed the requirement: **n ≈ 6,400 satisfiable days**, 4× the pooled sample |
| 8 | **The carb-midpoint buffer** | A15's +2.7 pts is the **band-shift component only** — `CARB_MIDPOINT_BUFFER_G` feeds both the band and the solver's aim, and re-scoring holds the plans fixed | A re-solve with the buffer at 0, in A13/A21 territory |
| 9 | **Would the closer realistically add 180 g?** | A20's repaired bound lets every surviving adjuster reach its full `MAX_GRAMS` ceiling. Whether that is a plan anyone would eat is a product question A20 did not test | Render it, as with #1 |
| 10 | **A21's stack, exactly as run** | The invocation was never written to disk — no run script, no shell log. Composition is DERIVED by signature | Re-run the stack from a written command. A24 issued this as I7 |
| 11 | **A13's k=2 vs k=5 at scale** | +0.37 pts, b=8 c=10, unresolved at n=536 — 97.6 % of the n-knob gain is already available at today's degrees of freedom | Larger n, though the DERIVED share makes this low value |
| 12 | **Whether the ruler should change** | Deliberately not answered here. A15 measured sensitivity; A4 measured defensibility. The two point opposite ways — the nutritionally-motivated changes A4 derived **tighten or do nothing** | The owner's call, on A4's citations, not on A15's table |

---

## 6. What this study got wrong mid-flight, and how it was caught

**Six load-bearing premises died, four of them from the mission prompt itself.** The fleet also caught eleven instrument faults, seven of them self-reported by the agent that made them. Both lists matter: the second is the reason to believe the first.

### 6.1 Premises that died

| premise | source | what killed it | how it was caught |
|---|---|---|---|
| Fat is graded at **±8 %**, "tighter than any published dietary guideline expresses" | mission prompt §2 | Effective gate is **±33.1 %** — looser than the NASEM AMDR | **Four independent derivations**: A4, A6, A12 and the coordinator reading `mealSolver.js:205-250` directly. A6 and A4 landed on the identical `0.2475·lbm` without coordination |
| **83 days** are structurally impossible; ceiling "near 88 %" | mission prompt §3 | The tier holds two constructions; one lands 20 of 30 days in band. **52 days, denominator 526** — and 495/578 is **85.6 %**, so 88 % never followed from the prompt's own count either | A3, corroborated independently by A1 (the IMPOSSIBLE tier produced **21 of 86** judged days in band) |
| **Pinning is the diagnostic** — "the highest-prior mechanism in the study" | mission prompt §6, A13's stated kill condition | Under the winning arm **95.7 % of days that PASS touch a bound**. Pinning is not even monotone across arms | A10 first, on a paired proxy; A13 reproduced it on the shipping solve path — and reproduced the brief's own motivating statistic (40.1 % / 71.3 % against 39.3 % / 68.3 %), so the number is real and only its reading was wrong |
| Widening the bounds is the obvious move, rejected via "625 g chicken with 2 g pine nuts" | mission prompt §5 | **The binding end is the FLOOR.** 66 of 70 pinned days needed the day smaller; 0 were blocked at the ceiling alone. The divergent shape the objection describes is **2.2 % of filled slots** | A2, then A14 independently found the same lower-bound story on the attempt budget. **Two knobs, same direction** |
| A flat budget of 20 **starves** thin pools | mission prompt §5 / research brief | Not observable under current code. The thinnest stratum is where depth gains most: **+16.67 pts on the 60 thinnest days**; pools above 300 move `b=0 c=0` exactly | A14, stratified by pool size |
| `solveGeneral`'s weights are the objective to sweep | mission prompt §6 (A18) | **Unreachable at `BRAIN=off`** — zero product paths. Its live analogue provably cannot change the in-band count | A18's hook failed loud (`1 edit requested, 0 applied`) rather than silently measuring nothing |

One more, from the research brief rather than the prompt: §4 credits the **adaptive** budget with 53.3 → 60.4. A14 measures `flat14` equivalent to adaptive at equal mean depth — **+0.12 [−1.62, +1.87]**. The gain was depth, not pool-scaling.

### 6.2 Instrument faults, and who caught them

| fault | caught by | consequence |
|---|---|---|
| `oracle.mjs` — **the mandated defence against the engine grading itself** — reports **0 leaks on 309 sea-cucumber placements** and catches 2 of 13 known rows | A17, amended by A22 (C19 said 1 of 13; it is 2) | Issued mid-flight as C19. **A16 was still running, received it, re-checked by name, found 0 hits, and downgraded its own leak claim from verified to necessary-condition-only** |
| A3's infeasibility bound reads `kcalPer100g`/`proteinPer100g` — **columns that do not exist** on the Prisma model, so the food term evaluated to 0 across all 14,151 rows | A20 | Ceiling moved 91.0 → 97.2 %. **A20 also caught its own audit script copying the same field names**, so its earlier "212/212 agrees with A3" was agreement on a shared bug |
| A20's P7 confusion matrix **sums to 511, not 578** | A22 (`INCOMPLETE`) | A24 repaired it by restoring the 67 UNKNOWN-accepted days. That repaired matrix is the one this report carries |
| A19's oracle bound mixes denominators — numerator on planned days, denominator on judged days | A22 | 87.7 % → **86.9 %**. This log's own instruction to keep A19's bound was wrong and is corrected in §3.1 |
| A1's `compare.mjs` v1 reported only the unpaired interval, ±5 pts wide at n≈620 — it would have filed a real +3 pt effect as indistinguishable from zero | A1, before shipping | `compare.v2.mjs` adds the paired McNemar interval. Every Phase-4 delta uses v2 |
| `compare.v2.mjs`'s own `VERDICT` line still applies the **pre-C14 ±1.5 pt floor** — it printed "clears the noise floor" for the exact +3.36 delta that then failed to replicate at two seeds | A14 | Flagged to A22/A24. **A24 verified no agent harvested that line** |
| A17's re-implementation v1 silently discarded closer additions 2 and 3 (`out.indexOf(target)` returned −1 after round 1) | A17's own passthrough control | Caught before any delta was reported. v2 is 639/639 byte-identical to the shipping closer; every A17 delta is measured against it |
| A7's v1 used the metadata arm of the gate only, ranking seal, whale and whey as top "vegan" survivors — **a 46 % swing produced entirely by A7's own harness** | A7, via a sanity probe | Caught because the probe was run, not because the number looked wrong. Corrected 6,772 → 4,634 rows |
| A16's `leakcheck-v2` silently inspected **2,552 of 2,910 slots**, resolving only its own catalogue ids | A16 | Closed by `A16-conc-leakcheck.mjs`: 358/358, 0 leaks |
| A14's wall-clock cost is unusable — two arms **proven to be the same effective rule** (identical mean budget, identical `slotCalls`, 0 of 639 rows differing) logged 34.9 s vs 78.7 s | A14 | `solveMs` measured machine load during a 90-minute sweep. All costs in this study are quoted in deterministic candidate draws |
| A22's predecessor filed A19's no-roll count as not reproducing, comparing against a histogram over a different day set | A22, against **itself** | Row retracted in `CLAIMS.tsv`. A19 was right |

**A24 states the pattern rather than the three incidents, and it is this study's most uncomfortable finding:** A20's audit copied A3's dead field names; A16's leakcheck inspected 88 % of its slots and said nothing; and `oracle.mjs`, mandated as *the* independent verifier, shares the product gate's blind spot. **Every independent verifier in this study was built from the same vocabulary as the thing it verified.** Determinism is not validity — the same lesson `HARNESS-INCIDENT.md` records, arrived at again from a different direction.

### 6.3 Disagreements logged rather than smoothed

Four were carried openly to A24 instead of being reconciled into a consensus: **A2 vs A3** on how many days to restore (7 vs 31 — A3's 31 is used, A2's 7 was under-corrected); **A3 vs A11** on what "pool-limited" counts; **A3 vs A7** on whether the vegan wall is structural or authored (both stand — A7's *conclusion* survives, its zero-rows *evidence* does not, since A20 found `Seaweed, spirulina, dried` at 57.5 g protein/100 g passing the gate); and **A13 vs A21** on whether warnings rise or fall, which resolved with **neither agent wrong** — A13 counted filled slots (341 → 405), A21 counted all slots (389 → 454), and the difference is exactly the unfilled slots, every one of which carries a warning (48/48, 49/49).

---

## 7. Definition of Done

| requirement | status |
|---|---|
| Every agent has a `FINDINGS.md` ending in CONFIRMED / FALSIFIED / NOT REACHED | **24 of 25.** A1–A24 on disk, each ending in a verdict — 16 CONFIRMED, 8 FALSIFIED. A25 produced none; see §7.1 |
| `CLAIMS.tsv` exists; every number in `REPORT.md` appears in it; A22 has re-run the ledger | **386 rows.** A22's reproduce/fail table is §4's A22 row and is carried in full in `A22/FINDINGS.md`. Two rows defective (A20 KPI-1 transcription, A20 P7 matrix), both repaired here rather than quoted |
| Every claim tagged MEASURED / DERIVED / ESTIMATED | Held in the agent artifacts and carried into this report wherever a number is load-bearing |
| `REPORT.md` answers the mission question on a **named denominator** | **Satisfiable-only, 526 days on the HTTP fleet / 536 on A1's rig.** Named in §2.3, with the rig/fleet split never mixed |
| Every headline number reproducible from a stated seed, re-verified by A22 | Held for A13, A15, A16, A17, A19, A20, A21, A1 and A3. **Not held for A19's oracle bound**, which A22 failed and this report restates at 86.9 % |
| The ceiling decomposition has counts that sum to 578 | **Held — §2.1.** 16 + 67 + 495 = 578, 405 in band. This is A24's repair of A20's matrix, which summed to 511 |
| A24's inflation list incorporated, not appended | **Held.** I1–I3, I5, I8, I9, I10 are folded into §§2–3 and the lever table's marginal column; I4 corrects this log's own instruction; I6, I7, I11 sit in §§3.1 and 5 |
| The three load-bearing properties were never traded away, and any mechanism that would is labelled | **Held, with one named exception.** Allergen leaks: **A17's closer widening is an automatic fail** (309 sea-cucumber placements) and is labelled as such in §3.1; no other arm's leak count rose, though per A16 and A17 a clean `oracle.mjs` run is **necessary and not sufficient**. Honesty-on-miss: intact and attacked independently by A24 (48/48 carry `diagnosisFeasible=false`) — **A17's trimmer is the one real regression**, 1 silent miss and 1 verdict disagreement, confined to A17; A13's amber cost is a signal-quality regression, not a lost warning. kcal drift: **0 across every arm in every agent's instrument line** |
| **The live `dev.db` is byte-identical to how it started — verify explicitly and say so** | **It is NOT, and saying it was would be false.** Baseline `e55f52e53658a086…`; live now `d9037dce9754b452…`, size unchanged at 22,781,952, mtime 2026-07-31 05:53. **The fleet neither caused it nor measured against it:** `dev.db.backup-provenance149-20260731-055003` shows separate provenance work ran at 05:50, and the dev server has held a live SQLite connection with an active WAL since 07-26. **Comparability is intact and was verified, not assumed** — `prepareAgentDb()` reuses an existing agent copy rather than re-copying, and every agent working copy still hashes `e55f52e53658a086…`, confirmed on A13, A16, A21 and A22. A24 measured the same property across **129 of 129 comparison arms**. Product code is also untouched: seven files under `backend/src/` are dirty in git and **every one predates the fleet's 21:00 start on 07-30** |

### 7.1 Provenance of this document, stated rather than hidden

**A25 did not finish.** The 06:58 orchestrator session wrote §§1–3 of this report and died at **07:30:59** partway through the lever table — the file ended mid-row, `A25/` holds no artifacts, no `A25/FINDINGS.md` exists, and `FLEET-COMPLETE` was never appended. The runner (`solver-brain-fleet.bat`) never wrote its completion footer for **any** of the three runs, so each was terminated rather than exiting; the cause of the 07:30 termination is **not determined** — there are no Windows event-log entries in the window and no scheduled task.

**§§3.1 and 4–7 were written afterwards, in a separate session, from the 24 artifacts on disk.** That session read all 24 `FINDINGS.md` in full, plus `STATUS.md`, the five `CORRECTIONS` files and the fleet prompt, and it re-verified the two `dev.db` facts above directly rather than inheriting them. It introduced **no number that does not already appear in an agent's `FINDINGS.md`**; where a number was needed and never produced, §5 says **not measured** and names the agent. It is not a 25th agent's independent analysis and does not claim to be — synthesis only, per anti-slop rule 4.
