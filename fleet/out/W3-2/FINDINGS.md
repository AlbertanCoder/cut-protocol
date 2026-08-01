# W3-2 — REPARTITION PROBE

*Persisted by orchestrator. Artifacts: `results.json` (70 KB). Code: `fleet/scratch/W3-2/`. 12 arms × 3 seeds + 2 probes; **network calls 0 in all 39 runs** (trapped); instrument checks 0 across 36 fleet runs. Baseline re-run in-session: **75.11% pooled on n=553 — byte-exact vs W3-1**. Hook control `noop`: **b=0/c=0 on 1,659 paired days.**

## A. THE wls2 NORM — ANSWERED: **L₂ SUM.** (It was on disk.)

`docs/surgery/CAMPAIGN/solver-brain/A13/a13-hook.cjs:187`:
```js
const fval = (xv) => { const r = resid(ach(xv)); let s = 0;
                       for (const m of active) s += W[m] * r[m] * r[m]; return s; };
// :131-139  allow = {kcal:0.15·kT, protein:0.15·pT, fat:0.25·fatShare, carb:0.25·carbShare}; W[m] = 1/allow²
```
Σ W·r² with W = 1/allow² **is** Σ v². **No `Math.max` anywhere. W2-1's inference CONFIRMED.** Three further facts the source settles: `:91` `mode="two"` ⇒ **k=2, the shipped knob structure — knobs were never the difference**; `:182` **wls2 already had the one-sided protein hinge**; `:173-177` **it optimised on CONTINUOUS x — a K6 violation.**

## B/C. THE EXPERIMENT — **W2-1's mechanism is REFUTED**

Canonical **553** (n=1,659 pooled):

| arm | pooled | Δ pts | b / c | A5 floor | clears | **warned slots** | **Δ warned** | ms/day |
|---|---|---|---|---|---|---|---|---|
| base | 75.11% | — | — | — | — | 2320 | — | 7.32 |
| noop | 75.11% | 0.00 | 0/0 | — | — | 2320 | **0** | 7.36 |
| **l2** | 87.46% | **+12.36** | 33/238 | 32.27 | YES | 2553 | **+233** | 6.01 |
| **linf** | 85.59% | **+10.49** | 47/221 | 32.09 | YES | 2940 | **+620** | 6.79 |
| linf_g | 77.76% | +2.65 | 61/105 | 25.25 | YES | 2205 | −115 | 7.77 |
| wls2repro | 88.85% | +13.74 | 24/252 | 32.56 | YES | 2501 | +181 | 9.10 |

**L∞ gains LESS than L₂ and raises warned slots nearly 3× MORE.** Marginal `l2 → linf` = **−1.87 pts**. Warned slots per seed, same direction every seed: base 777/781/762 · l2 856/851/846 · **linf 989/981/970**.

**The mechanism, measured** — pooled failing-day counts: base kcal 130 / **protein 55** / fat 297 / carb 202 · l2 85 / **55** / 148 / 116 · **linf 87 / 74 / 162 / 138.**

> Augmented Chebyshev is **indifferent to every macro below the max** (augmentation charges only ρ/4 = 0.0125 per unit). This population is dominated by badly-out-of-band fat/carb, so **the max is almost always fat or carb — and kcal and protein, the only two macros the slot gate tests, drift for free up to the incumbent max.** L₂'s quadratic penalty is precisely what holds them near zero. W2-1 reasoned from a marginal slot where L∞ does refuse; **that regime is rare here. Do not ship the norm swap.**

**The guard is a near-no-op.** `acceptRepartition` blocked **69,167 of 75,247 improving moves = 91.9%**, costing **−7.84 pts**. Predicted analytically before running: against an *interior* Cramer point `v_kcal = v_protein = 0`, so componentwise non-worsening **rejects every repartition by construction.** Not a tunable — **structurally incompatible with a warm start that hits two macros exactly.**

## D. C2 — smallest-first. **CONFIRMED, best value in the set.**

One line: `openIdx.sort((a,b) => dayTargets[a].weight - dayTargets[b].weight || a - b)`.

| | Δ pts | b / c | floor | clears | warned | ms/day |
|---|---|---|---|---|---|---|
| **C2 standalone** | **+7.78** | 50/179 | 29.66 | YES | +110 | 6.13 |
| C2 marginal over C14 | **+4.64** | 34/111 | 23.60 | YES | | |
| linf + C2 | +12.84 | 38/251 | 33.32 | YES | +885 | 5.52 |
| **C14 + C2** | **+10.91** | 39/220 | 31.54 | YES | **+83** | 5.12 |

Per-seed +7.41/+6.87/+9.04. Brief +8.27 — **reproduced within noise.**

## E. B3 / B4 reproduced

**B3.** Control: `cramer + materialise` reproduces shipped `scaleRecipe` on **400/400 pairs, 0 mismatches.** Baseline: **250/250 identical grams (100%), max fat difference exactly 0.** Treated: 13 identical (5.2%), max fat diff 50.38 g, **95.2% of non-degenerate pairs differ ⇒ the regression test PASSES (≥95%).**

**B4** (n=4,556 plausible / 3,209 non-degenerate): outside box **74.57%** (brief 77.5%) · of those clamp strictly worse **90.39%** (94.8%) · in-gate point missed **12.65%** (13.7%) · **wants a NEGATIVE bundle 33.53%** (brief 22.5% — **worse than briefed**). Clamp reaches the gate on 41.91% of pairs vs the box optimum's 54.57%.

## F. C13 / C14

| | Δ pts | b / c | floor | clears | **warned** | ms/day |
|---|---|---|---|---|---|---|
| **C13** back-substitution | **+4.70** | 57/135 | 27.16 | YES | **−177** | 6.61 |
| **C14** in-gate steering | **+6.27** | 45/149 | 27.30 | YES | **−153** | **4.87** |

**C14's construction claim holds** — it lowers warned slots on all three seeds. Honest decomposition: `c14_c2 − c2 = −27`, so **the +83 in C14+C2 is C2's, not C14's.** **C14 is the only lever that buys points while REDUCING warnings, and it is the cheapest arm measured.** *(The brief's C13 numbers are per-(recipe,target) pair, not days-in-band — different quantity.)*

## G. C4 / floor25 — ⚠️ **UNSHIPPABLE BOUND**

+15.49 total, **+5.00 marginal over linf** — reproducing A13's +5.22 almost exactly. **It puts 2,821 of 9,033 scaled slots — 31.2% — below the old 0.5× floor** (A13: 35.5%; every other arm **0.0%**). W2-6's envelope: lowest published "normal" bound is **70% of reference**, and 0.5× is already below all five foods measured; sub-norm portions drive **compensatory eating**. **Reported as a bound on what portioning could buy if plates were free. They are not.**

## H. Cost — every shippable arm is FASTER than baseline

base 7.32 → **C14 4.87 (−33%)**, C14+C2 5.12 (−30%), C2 6.13, L₂ 6.01. Cause: better composition targeting trips `COMPOSITION_GOOD_ENOUGH`'s early exit (`:642`) far more often, so the shortlist scan terminates sooner. **The portioner pays for itself in search time.**

## I. ⚠️ DOUBLE-COUNT — these gains and a ruler change CANNOT both be banked

| arm | rescued | ruler-eligible | overlap | **share of the 279-day ruler-eligible pool banked** |
|---|---|---|---|---|
| C14 | 149 | 127 | 85.2% | 45.5% |
| C2 | 179 | 144 | 80.5% | 51.6% |
| **C14+C2** | 220 | 179 | **81.4%** | **64.2%** |
| l2 | 238 | 191 | 80.3% | 68.5% |
| floor25 | 275 | 224 | 81.5% | 80.3% |

C14+C2's rescued binding keys are **100% fat/carb** (`fat:over` 111, `carb:over` 61, both 7). **W3-1's E35k (+2.77) and R35k (+2.17) target this identical pool.**

## BRIEF-CLAIMS VERDICTS

| # | brief | measured | verdict |
|---|---|---|---|
| **B3** | 207/207 identical, max fat diff 0 | **250/250 (100%), max fat diff exactly 0**; treated arm 95.2% differing | **CONFIRMED** |
| **B4** | 77.5 · 94.8 · 13.7 · 22.5% | **74.57 · 90.39 · 12.65 · 33.53%** | **CONFIRMED** (negative-bundle worse) |
| **C1** | wls2 +14.74, "not on disk" | **Source located and read.** Reproduced on the repaired DB: **+13.74** — inside the brief's CI. Norm = **L₂**, k=2, hinge present, objective **unrounded**. Warned +181 — **the regression reproduces** | **CONFIRMED**; source no longer missing |
| **C2** | +8.27, one line | **+7.78** pooled, per-seed +7.41/+6.87/+9.04 | **CONFIRMED** |
| **C4** | +5.22 marginal, 35.5% below floor | **+5.00 marginal, 31.2% below 0.5×**; every other arm 0.0% | **CONFIRMED — and UNSHIPPABLE** |
| **C13** | per-pair 35.81→42.91% | days-in-band translation **+4.70**, warned **−177** | **CONFIRMED (direction), ADJUSTED (units)** |
| **C14** | cannot raise warned-slot count | **+6.27, warned −153** on all 3 seeds, cheapest arm | **CONFIRMED** |

## Recommendation for W3-7

**Stack C14 + C2.** **+10.91 pts, warned-slot cost ~0, 30% faster, no new box, no norm risk** — one line plus one constrained search. Treat L₂ as a separate later decision worth ~+1.5 pts more at +233 warned slots. **Drop L∞ and the Pareto guard entirely.**

`git status --porcelain -- backend/src frontend/src` → **empty.** Selftest 27/27 pass (pins one-sided protein, keto hard-reject, absent-band null, non-finite Infinity, ρ=0.05, G4's measured case, the guard's interior no-op).
