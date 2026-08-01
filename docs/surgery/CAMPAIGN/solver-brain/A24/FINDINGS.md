# A24 — red team / inflation list

## 1. INFLATION LIST — what A25 must discount

| # | claim as stated | defect | **discounted figure** |
|---|---|---|---|
| **I1** | any additive sum of Phase-4 levers | baseline satisfiable misses = **123/536**, so the union of *all* levers caps at **+22.95 pts**. Naive sum of six gross gains (87+84+61+43+31+9 = 315 d) = +58.77 pts | **arithmetically impossible, 2.56×**. MEASURED |
| **I2** | A17 trimmer **+14.93** as a lever | `wls2\|trim both=72`, union 99, J=0.727 — 42.1 % of the naive sum | marginal over A13: **12 d = +2.24 pts**, below C14's 3.5 → **unresolved** |
| **I3** | A19 dayNstrict **+1.68** | `wls2\|dayNst both=9 of 9` | **+0.00 pts / 0 days.** Fully subsumed |
| **I4** | A19 oracle bound **87.7 %, +10.6** | mixed denominator (A22) | **86.9 %, +9.9.** STATUS.md's "keep A19's oracle bound" is **wrong** — say so |
| **I5** | A14 att12 **+2.24** pooled | `wls2\|att12 both=27 of 31` | **4 unique d = +0.75 pts** |
| **I6** | A16 **"~4 recipes = 85 %"**, +10.45 | needs **1 Food row that does not exist**; LABEL tier, FDC 1946780 → 404; 8 recipes optimised onto the measured centroid (A16: "upper bound, not a forecast") | **ESTIMATED**, not MEASURED. Marginal over A13 **+7.46**. Restate as *1 unauthored row + 4 recipes* |
| **I7** | A21 **"best stack" 94.96 %** | contains **2 of 6** levers; composition **DERIVED by signature — no run command on disk** (`A21/` has no run script; `A21-adjudicate.log` is the post-hoc scan) | overstates "combined"; unreproducible as specified |
| **I8** | **97.0 %** (A13 `floor25w`, A21's lead) | **single seed** — only `A13-floor25w-s424242.jsonl` exists; A22 re-ran the *same* seed (rule 8). Ships **35.5 % of slots below the old 0.5× floor**; A21's lead omits that cost | keep 97.0 % **and** the quarter-portion price in the same sentence |
| **I9** | **97.2 % ceiling** (A20) | a proof that *weakened*, not a ceiling that rose: 36 d moved INFEASIBLE→**UNKNOWN** | "**16 d provably impossible; 67 d unknown in both directions**" |
| **I10** | brief's **88 %** ceiling | 495/578 = **85.6 %** from its own 83 d | dead — do not average three ceilings |
| **I11** | A3 **140 pool-limited days** | own sensitivity table spans **25–145**; a second A3 script gives 62 | quote the range, never the point |

## 2. Double-counting against the prior campaign — **negative, and verified**

Applied levers (§4): food-row corrections · composition-aware **sampling** · adaptive attempt budget · staple un-quarantine + 21 recipes · macro closer.

**MEASURED: 129 of 129 comparison arms on disk carry `dbHash e55f52e53658a086 / foodFingerprint 423e7279ed6af641 / poolRaw 910 / foodRows 14151`** — the post-campaign dataset. Every Phase-4 delta is paired against a baseline that already contains all five. **No Phase-4 gain re-books a prior one.** The 14 files lacking a `dbHash` header are probes/dumps — including all six `A19-probe-*`, which produce the one number A22 falsified.

The three agents that pushed on applied levers returned nulls, as they should: A14 (budget — flat after 12 reproduces), A17 (closer widening +0.19, unresolved, plus a realized leak), A16 (authoring — but a *new ingredient class*, so its delta is marginal, not repeat).

**One mis-attribution in the research brief itself:** §4 credits the *adaptive* budget with 53.3→60.4. A14 measures `flat14 ≡ adaptive` at equal mean depth (15.08): **+0.12 [−1.62,+1.87]**. The +7.1 was **depth**, not pool-scaling.

**A13's `wls2` is not composition-aware sampling re-sold.** Sampling weights `pickRecipe`; `wls2` changes `scaleRecipe`. Different call sites, and A22's kcal-only re-portioning control returns **+0.00 (b=5 c=5)** through the same hook.

## 3. C21 audit — no lever moved a denominator

MEASURED, my own count over raw arms:

| arm | judged | sat-judged | in-band sat |
|---|---|---|---|
| A13 base / wls2 / role / floor25 / floor25w | 622 | 536 | 413 / 492 / 494 / 436 / **520** |
| A16 base / conc-N8 / veg-N68 / vegan-N40 | 622 | 536 | 413 / 469 / 456 / 465 |
| A17 base / trim3 / dense8 | 622 | 536 | 413 / 493 / **414** |
| A21 base / stack | 622 | 536 | 413 / **509** |

Denominators identical everywhere. A17's own DERIVED claim reproduces exactly: `dense8` gains **+10 all-days but +1 satisfiable** → 9 of 10 in the refusal tier. No band was widened by any compliance lever (A15 re-scores a *fixed* day set and discloses separately). **A20's refusal prices (+4.94/+5.72/+27.94) are laundering and no arm took them.**

## 4. Clean bills — these survived attack

- **Honesty-on-miss holds.** I attacked it independently: **48 of 173** fleet misses carry **no slot warning** — but **48 of 48** carry plan-level `diagnosisFeasible=false`. Property intact. Corollary: `diagnose()` is the *sole* honesty signal on 27.7 % of missed days, which makes re-badging it as refusal (P6) worse than C21 states — it converts the honesty mechanism into a denominator filter.
- **Silent-miss / verdict / drift, re-derived from raw arms:** A21-stack 85 miss **0/0/0**; A13-wls2 102 **0/0/0**; floor25w 74 **0/0/0**; A16-conc-N8 129 **0/0/0**; **A17-trim3 105 miss, 1 silent, 1 disagree** — the regression is real and confined to A17.
- **Warnings adjudication is right and A13's cost is real:** filled warned slots base 341 → wls2 **405**, conc8 242 → stack **293**. But **`floor25w` = 343** — the 0.25 floor *cancels* the amber regression. A25 should carry that.
- **The DB discontinuity did not land** (129/129). **Cost in seconds appears in one place only** (A14, flagged as unusable). **No agent harvested `compare.v2.mjs`'s stale ±1.5 VERDICT line.** **No agent chained a rig delta onto a fleet level** — the vector is STATUS.md's own "~4 recipes = 85 %".
- **Baseline's 5 oracle "leaks" are false positives.** A21's C13 by-name check: 1 hit, "Palm Hearts" ← `heart`, present identically in baseline.

## 5. The decomposition summing to 578 (A20's P7 matrix sums to 511)

DERIVED from `A20/A20-day-labels.jsonl`, repaired ground truth:

| bucket | days | in band | miss |
|---|---|---|---|
| INFEASIBLE-proved (A20 repaired) | 16 | 0 | 16 |
| **UNKNOWN** (36 d lost their proof + 31 prior) | **67** | **0** | 67 |
| SAT-certified | 495 | 405 | 90 |
| **TOTAL** | **578** | **405 = 70.07 %** | 173 |

The 67 UNKNOWN days are where the ceiling uncertainty lives; "0 in band" for them is tautological (certificates *are* in-band days), so it is not evidence of infeasibility.

## 6. Three cross-checks that agreed with defects, not two

A20's audit copying A3's dead field names (self-reported); A16's `leakcheck-v2` silently inspecting 2552 of 2910 slots (self-reported); and `oracle.mjs` — mandated by C16 as the defence against self-grading — reporting **0 leaks on 309 sea-cucumber placements**. A pattern, not three incidents: **every independent verifier in this study was built from the same vocabulary as the thing it verified.**

CONFIRMED
