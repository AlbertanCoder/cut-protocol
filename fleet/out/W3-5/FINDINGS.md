# W3-5 — ATTEMPTS CURVE

*Persisted by orchestrator. Artifacts: `results.json` (526 KB). Code: `fleet/scratch/W3-5/`. 13 arms × 3 seeds + 3 independence matrices (R=20). **Network calls 0 in all 52 runs** (trapped). Instrument inertness PROVED: with every knob unset the probe reproduces W1-2 byte-exact on 3 seeds × 4 denominators.*

## A. The curve — and a disambiguation that has to come first

**The corpus calls two different knobs "attempts."** They behave nothing alike, and conflating them is why the inherited numbers do not line up.

**Axis 1 — per-slot budget** (`slotAttemptBudget`), pooled 3 seeds, n=1659:

| budget | 553 | 640 | 537 | solve ms/day | Δ per doubling |
|---|--:|--:|--:|--:|--:|
| 5 | 66.36% | 59.95% | 68.34% | 3.10 | — |
| 10 | 72.69% | 66.15% | 74.86% | 4.88 | **+6.33** |
| adaptive *(ships)* | 75.11% | 68.07% | 77.34% | 6.35 | |
| **20** | **77.28%** | 70.00% | 79.58% | 7.82 | **+4.58** |
| 40 | 77.52% | 70.00% | 79.83% | 13.62 | **+0.24** |

**KNEE = 20.** 20→40 is b=77 c=81, floor 1.49pp → **INSIDE NOISE**, null on each seed independently. **The prompt block's "20→40 bought +1.74pp at 2× cost" is REFUTED on this axis: +0.24 pp for 1.74× the solve time.**

**Axis 2 — week-level best-of-N** (`mealSolver.js:658`, ships 5): 1 → 68.23% · 2 → 71.97% · 5 → 75.11% · 10 → 76.67% · 20 → **78.54%**. Marginals +3.74 / +1.57 / +1.87 — **this axis has NOT saturated at 20**, and its shape is what the lab ledger's "+1.74pp @2×" actually describes. **W5-1 must not let the two axes share a row.**

**NEW — the shipping adaptive rule is a NET HARM, aimed at the wrong people.** ADAPT→FIX20 = **+2.17pp** (b=35 c=71, floor 1.22pp, MEASURABLE, same sign all 3 seeds). Per-diet: **vegan +11.43pp** and **keto +9.77pp** MEASURABLE; `none` +0.48pp inside noise.
**Mechanism:** every keto persona's pool is ≤53 recipes, so `floor(pool/10)` clamps to the **MIN of 5 for all 18 of them**, while their meal pool runs to 49 candidates — **the rule searches at most 5 of 49.** The docstring at `weeklyPlanner.js:87-101` justifies the scaling with a 36-recipe *synthetic* pool. **On the real 250-persona fleet, thin pools measure better at a flat 20.**

## B. Effective m — W2-2's prediction, denominator check first

**Where 10.8% and 24.5% come from.** `fleet/PROMPT.md:31`, the **lab lever ledger**. They appear **nowhere in CONSOLIDATED-BRIEF** and nowhere else in `fleet/` or `docs/`. **Neither reproduces on this tree:** measured 1-best is **68.50%**, not 10.8%; measured k=20 oracle is **89.15%**, not 24.5%.

> **W2-2's risk #1 resolves harder than it feared.** The question is not whether the two share a denominator — **neither input describes this tree.** **The m ≈ 2.46 derivation is VOID as arithmetic and must not be cited as a number.**

**Direct measurement, one denominator by construction** — 553 satisfiable persona-days × R=20 genuinely independent single-attempt solves (fresh RNG stream per persona×replicate); oracle is the exact expectation over a uniform random k-subset:

| k | oracle | independent-draw prediction | **m_eff** | m/k |
|--:|--:|--:|--:|--:|
| 1 | 68.50% | 68.50% | 1.00 | 1.00 |
| 5 | 84.57% | 99.69% | **1.62** | 0.32 |
| 10 | 87.55% | 100.00% | 1.80 | 0.18 |
| **20** | **89.15%** | **100.00%** | **1.92** | **0.096** |

Held-out seed (W2-2's own requirement): **m = 2.00**. **W2-2's conclusion survives and is strengthened; its number does not — 2.46 is 28% high, and it landed near the truth by accident of functional form (m is a log-ratio, nearly insensitive to p), not by shared evidence.**

**A stronger statement than any m:** **60 days never land in band in 20 tries; 220 land in all 20; 50.63% are all-or-nothing against an independent-draw prediction of 0.05%; only 273 of 553 are ever contested.** **Publish the barbell, not m: half the population is decided before the search starts.**

**W2-2 risk #7 REFUTED** — the one experiment it said it would run with budget for exactly one. It predicted decorrelating generation would *raise* m. **Smallest-first raises 1-best 68.50→76.76 and LOWERS m 1.92→1.70** (never-days 60→46, always 220→239). **Order moves the population up; it does not diversify the search. Selection is an even worse bet than W2-2 predicted.**

## C. C12 — order beats volume

On this codebase `openIdx.sort(by kcalTarget)` in `solveDay` is operationally **"snacks first"** — verified across three meal configs (snack targets 180–246 kcal vs meal 404–708). **Exactly W1-3's mechanism.**

| arm | 553 | 537 | solve ms/day |
|---|--:|--:|--:|
| baseline @ 5 week attempts *(ships)* | 75.11% | 77.34% | 6.35 |
| **C2 @ ONE week attempt** | **76.13%** | **78.40%** | **3.58** |
| C2 @ 5 week attempts | 82.88% | 85.35% | 7.77 |

Paired: b=138, c=155, **Δ = +1.02pp**, A5 floor **2.02pp** → **INSIDE NOISE.**

**Verdict: direction confirmed, margin is a tie, operational claim intact.** The brief's "79.9 beats 77.1" measures **+1.06 on the same 537 denominator**. C2 at one attempt does not *beat* the baseline at five — it **matches** it on **44% less solve time**. Still the sharpest result in the lane: **one line of reordering buys back 80% of the search for free.**

**Order vs volume, per ms/day of extra solve:** order ADAPT→C2 **+5.48** · budget 5→10 +3.56 · budget 10→20 +1.56 · week-attempts 5→20 +0.24 · budget 20→40 **+0.04**. **C2_WA1 strictly dominates the shipping baseline.** Honest cost: **3 more empty meal slots** (150→153 of ~6,650), changes no verdict.

## D. C11 — **REFUTED**

**C11 as written is not a coherent claim:** its "+9.33" is C2's own re-grade; its "+10.45" is C3's gross. Neither is a C2+C6 quantity.

Measured: **C2 alone +7.78** · **C6 alone +1.08** · naive sum +8.86 · **both together +8.98** · **interaction +0.12 pp** (~2 days on n=1659, an order of magnitude inside the floor). C6's marginal over C2 is **+1.21** — if anything slightly *larger* than C6 alone. **No sub-additivity. They compose additively**, which is mechanically right: C6 buys depth in the slot search, C2 changes which slot gets first claim on the day's budget. **Orthogonal.**

## E. Where attempts cannot help — quantified

**20 personas have a snack pool of exactly 0**; 23 are snack-starved; **234 of 250 already have `slotAttemptBudget` ≥ their entire snack candidate list; at a fixed budget of 40 that is 250 of 250.** Only 8/250 reach their meal pool under the shipping rule (42/250 even at 40) — **meals still have real depth.**

**Dynamic confirmation W1-5 could only argue structurally: empty snack slots move by at most 2 out of ~425 across an 8× budget change** (424/426/424/426/425). Empty meal slots are **exactly 150 in every budget arm.** **No attempt budget reaches the snack slot.**

Day-level immunity (R=20): **60 never / 220 always / 273 contested ⇒ the addressable population is 49.37% of the canonical denominator.**

| lever | diluted (n=1659) | **corrected (n=819 addressable)** |
|---|--:|--:|
| budget 5→20 | +10.91 | **+18.44** |
| C6 (floor 5→12) | +9.83 | **+16.36** |
| ADAPT→C2 | +7.78 | **+11.48** |

**Every marginal return in this lane is understated ~1.7× by the diluted denominator.**

## F. Cost and hygiene

Solve cost is linear in budget (3.10 → 13.62 ms/day, **4.4×**); process-level wall clock 49.1 → 56.3 ms/day because DB load dominates. **"Attempts are expensive" is false at the user-facing level and true at the algorithmic level — the reason not to buy them is that they stop working at 20, not that they cost.**

Pairing ran only on arm-invariant sets. **Verified rather than assumed** that `judged` (537) held still: membership byte-identical across all 11 arms. **A6's hole did not bite this lane.** **E11 check: every headline survives on the 640 denominator that counts refusals as misses** (ADAPT→C2 = +7.08pp there). **No arm gained by refusing.**

## BRIEF-CLAIMS VERDICTS

| # | brief | measured | verdict |
|---|---|---|---|
| **C6** | +1.12 pooled | **+1.08** (b=27 c=45); reproduces to 0.04pp | **CONFIRMED** — but **dominated**: a flat 20 buys **+2.17** at the same cost and repairs vegan/keto specifically |
| **C11** | sub-additive, +9.33 not +10.45 | together **+8.98**; **interaction +0.12pp**; the row's two numbers are C2's re-grade and C3's gross | **REFUTED** — real interaction is **additive** |
| **C12** | C2@1 (79.9%) beats baseline@5 (77.1%) | **76.13% vs 75.11%** (553); b=138 c=155, **+1.02pp vs a 2.02pp floor** | **ADJUSTED** — direction right, magnitude ⅓, margin **INSIDE NOISE**; operational claim **stands** |
| **A5** | the detection rule | Pooled floors 0.97–2.13pp. **Changed two verdicts**: the knee is a NULL, C12 is a tie | **CONFIRMED and operative** |
| *(bonus)* | W2-2 m ≈ 2.46 | **1.92** / **2.00** held-out; inputs reproduce as 68.50%/89.15% here | **conclusion CONFIRMED, derivation VOID** |

## Summary

**Knee is 20 on the per-slot budget**; 20→40 is inside noise, refuting the prompt's +1.74pp. **Effective m at k=20 = 1.92.** **Order beats volume** — C2 at ONE attempt matches the shipping baseline at FIVE on 44% less compute; **C2 is the best ratio measured (+5.48pp per ms/day vs +0.04 for budget 20→40).** C11 refuted. **The shipping adaptive rule is a net harm and the whole −2.17pp lands on vegan and keto — the diets its docstring claims to protect.** **Only 49.37% of the canonical denominator is addressable at all.**

**W3-7 stack: take C2, replace the adaptive budget with a flat 20, stop there.** ~+10 pts, one line plus one constant, ~1.4 ms/day. **Skip C6's floor-12; skip budgets past 20; skip selection work entirely.** **Nothing in this lane touches the 60 never-days or the ~425 empty snack slots. Those are authoring.**

`git status --porcelain -- backend/src frontend/src` → empty. No push. Blockers: none.
