# A21 — best stack: composition, overlap, denominators

## Lead: the "best stack" is not the best arm on disk

**MEASURED**, seed 424242, paired, satisfiable rig tier n=536: A13's `floor25w` arm — 0.25× scale floor + the 4-macro objective, **no pool change at all** — scores **520/536 = 97.01 %** against this stack's **509/536 = 94.96 %**. Paired `stack → floor25w` = **+2.05 pts CI [+0.65, +3.46]**, b=2 c=13 — *below C14's 3.5-pt floor, so not distinguishable from zero*. The stack buys nothing measurable over an arm that needs no authored recipes and no simulated food row. `floor25w` has no replicate seed; that is the honest limit of this comparison.

## 1. What the stack actually contains (the header label is wrong by construction)

`runRig.mjs:214` — `treatmentName = treatment.NAME || path.basename(tp)` — records **only** the `--treatment` module. A13-class levers ship as a `NODE_OPTIONS --require` preload that textually patches an in-memory `weeklyPlanner.js`; the header **cannot** name them. Identification is by signature (the invocation was never written to disk — no run script, no shell log in `A21/`):

| signature | base | wls2 | conc8 | **stack** | floor25 | reading |
|---|---|---|---|---|---|---|
| `A16-conc*` slots | 0 | 0 | 358 | **321** | 0 | pool lever **IN** |
| min(protein,sides)Scale | 0.5 | 0.5 | 0.5 | **0.5** | 0.25 | 0.5× floor **NOT moved** |
| slots protein≠sides | 2088 | 2525 | 2286 | **2661** | 2203 | 4-macro portioner **IN** |
| filled warned slots | 341 | 405 | 242 | **293** | 202 | A13's warning cost **IN** |

**Stack = A16 concentrate-recipes N=8 + a 4-macro portioning objective equivalent to A13's `wls2`.** Trimmer, att12 and the 0.25 floor are **OUT**. **NOT REACHED:** `a13-hook-v2.cjs` vs `-v3.cjs` at `A13_FLOOR=0.5` cannot be separated — they are behaviourally identical.

## 2. Denominators (primary = D2, C7's ruling; no refusal lever, so C21 is clean)

| denom | n | base s424242 | stack | Δ | Δ s8675309 | Δ s20260730 |
|---|---|---|---|---|---|---|
| **D2 C7/A3** | **570** | **76.14 %** | **94.21 %** | **+18.07** [+14.80,+21.34] | +17.54 | +17.54 |
| D1 rig tier | 536 | 77.05 % | 94.96 % | +17.91 [+14.54,+21.28] | +16.79 | +17.16 |
| D3 A20-repaired | 606 | 71.62 % | 88.61 % | +17.00 | +16.50 | +16.50 |
| D4 all judged | 622 | 69.77 % | 86.33 % | +16.56 | +16.08 | +16.08 |

**DERIVED:** spread across 4 denominators × 3 seeds is **1.99 pts** — the result is denominator-insensitive. Judged-day counts are **identical** in both arms everywhere; nothing was refused into compliance.

## 3. Overlap (C23 — the anti-inflation number)

`wls2` rescues **87**, `conc8` rescues **61**, **52 are the same days**. Sum of parts **148**; union **96**; the stack actually gains **99** (loses 3). **34.5 % of the naive sum is double-counted.** Marginals: `conc8 → stack` **+7.46** [+4.90,+10.02]; `wls2 → stack` **+3.17** [+1.44,+4.90] — the pool lever's contribution on top of portioning is *below* the 3.5-pt floor.

## 4. The warnings "contradiction" — both agents are right

**Not a contradiction.** A13's 341→405 counts **filled** slots; `A21-denoms.json`'s 389→454 counts **all** slots. The gap is exactly the unfilled slots (48 base, 49 wls2), and **every unfilled slot carries a warning** (48/48, 49/49). The stack's *fall* 389→316 is base-vs-stack, not a test of the portioner: on filled slots, `conc8` alone drops to 242 and the stack rises back to **293 (+51)**. **A13's cost is intact inside the stack, masked by the pool lever.** Unfilled slots 48 → 23 accounts for 25 of the 73-slot fall.

## 5. The three properties

0 silent misses (188 base / 85 stack missed days, all warned or diagnosed), 0 verdict disagreements, 0 kcal drift >1 g, 0 crashes. C19 by-name check over 384 reachable Food names: **1 hit, "Palm Hearts" matching term "heart" — a false positive, present identically in the baseline.** A16 leakcheck-v2: base 5, stack 3, all the C19 Peanut-Butter/Egg-Plants artifact classes; the 321 synthetic slots it cannot see were covered by `A16-conc-leakcheck` (321/321, 0 leaks). Failure direction collapses as C23 predicts: fat OVER 81→17, carb OVER 53→11, **fat SHORT 0 in all eight arms**.

**Caveat A25 may not drop:** the pool half rests on a **LABEL-tier simulated row** (FDC 1946780 returns 404) and 8 in-memory recipes. Its +7.46 is an ESTIMATE of authoring 8 real ones. Cross-agent baselines at s424242 are **639/639 identical**, so these deltas are comparable.

CONFIRMED
