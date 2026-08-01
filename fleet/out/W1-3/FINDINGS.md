# W1-3 — TAXONOMY

*Persisted by the orchestrator. Machine artifacts: `taxonomy.json`, `adjuster-foods.json`, `recipe-stats.json` + scripts. Zero re-solve, zero network.*

**Instrument warrant.** Slot targets are **reconstructed** by replaying `weeklyPlanner.js` `buildSlots:145-157` → `targetsForSlots:159-175` → `solveDay:889-931` (`CARRY_CAP_PCT=0.30` at `:917-918`), subtracting the closer's contribution first. **Validated against the product's own printed warning strings: 1,484 of 1,484 quoted kcal targets match exactly; 1,345 of 1,349 protein (4 off by 1 g, rounding). Slot-order failures 0.**

## A. Bucket table — canonical denominator 553, exact reconciliation

In band 415 = 75.0%. **Failing = 138.**

| bucket | days |
|---|--:|
| **fat-over** | **48** |
| carb-over | 34 |
| multi: kcal-over + fat-over | 17 |
| **empty-slot** | **16** |
| multi: kcal-over + fat-over + carb-over | 8 |
| multi: fat-over + carb-under | 5 |
| multi: fat-over + carb-over | 3 |
| multi: kcal-over + carb-over | 2 |
| 4 further multi keys | 1 each |
| kcal-over / kcal-under | 1 / 1 |
| **protein-short alone / fat-under alone / carb-under alone** | **0 / 0 / 0** |

**Proved:** 48+34+17+16+8+5+3+2+1+1+1+1+1 = **138 = 553 − 415.** `reconciles: true` for **every** denominator (553/537/640/639), **every** per-diet and per-tier cell, at **all four runs.**

**Per-diet (553):** none 275/243/32 (fat-over 19) · keto 58/33/25 (**empty-slot 11**, carb-over 11) · vegetarian 57/36/21 (**carb-over 14**) · mediterranean 49/44/5 · kosher 35/17/18 (kcal+fat 8) · vegan 35/20/15 (fat-over 9) · paleo 24/10/14 · halal 12/12/0 · carnivore 8/0/8 (**empty-slot 5**). All 16 empty-slot days are keto (11) + carnivore (5) — reproduces p005×7 / p115×4 / p018×5.

**Cross-seed (553):** failing 138 / 135 / 140 (route), 136 (rig); `fat-over` 48/54/54/49. Shape stable; counts ±6, inside the 0.9-pt seed noise.

## B. ⚠️ THE OVER-SIDE RECONCILIATION — all three numbers are correct on different denominators

| | rig s424242 |
|---|---|
| failing days, canonical 553 | 136 |
| of which **empty-plate** (zero food shipped) | **16** |
| failing days **that contain food** | **120** |
| failing axes on those 120 | over **159**, short **7** → **95.8%** |
| failing axes contributed by the 16 empty plates | over **0**, short **64** (4/day) — ex-protein **48** |
| **all 136 failing days, ex-protein** | 159 / 213 = **74.6%** |

> **A plan containing no food is arithmetically SHORT on every axis. Those 48 short axes ARE the entire 74% ↔ 96% gap.**

### The definitive decomposition (route, s424242, canonical 553)

| framing | denominator (named) | over-side |
|---|---|---|
| **per failing AXIS** | 171 axes on the **122 failing days that contain food** | **162 over / 9 short = 94.7%** (96.4% ex-protein) |
| per failing AXIS | 235 axes on all 138 failing days | **68.9%** (75.0% ex-protein) |
| per failing AXIS | 383 axes on all 204 failing planned-640 days | 56.7% (71.9% ex-protein) |
| **per failing DAY** | **122 failing days that contain food** | **113 pure-over / 8 mixed / 1 pure-short = 92.6% pure-over, 99.2% over-touched** |
| per failing DAY | all 138 canonical failing days | **81.9%** |
| per failing DAY | all 204 planned-640 failing days | 57.4% |
| **per failing SLOT** | 1,158 slot-axis misses on 644 shipped slots of the 122 | **867 over / 291 short = 74.9%**; fat grams **4,595 over vs 1,133 short = 80.2%** |
| per failing SLOT | 2,724 misses on all 2,527 shipped slots of the 553 | 77.1%; fat grams 72.8% over |

Rig arm reproduces W1-6 **byte-exact** (159/166 = 95.8% axes, 113/120 = 94.2% days). Cross-seed pure-over: **92.6 / 92.4 / 94.4%**.

**Where 74.2% came from:** the AXIS framing on **satisfiable-PLANNED with protein excluded** — measured **74.6%** (rig), 75.0/72.8/74.4% (route). Within 0.4 pt. **Not wrong — it is the framing that books 16 zero-food plates as "the solver undershot."**

### ✅ RECOMMENDATION FOR W3-4

> **92.6% of failing days that contain food are pure-over (113 of 122; 94.2% rig; 92.4–94.4% across three seeds). One day in 122 is fixable by adding.**

Say *"failing days that contain food (122 of the canonical 553)"* out loud. **Do not cite 74.2%** — the 16 days it adds are empty plates, pool-caused, and **no trimmer reaches them and neither does any adder.** Use the **AXIS** number (94.7%) when arguing *which macro* to trim; use the **SLOT** number (74.9%) when *sizing the workload*, never as the priority number.

**⚠️ NEW — and it changes the trimmer's design: fat is NOT the largest overage mass. CARB is.** Across the 553's 2,527 shipped slots: **carb 20,495 g over vs 6,919 g short (988 over-axes)** against **fat 8,594 g over vs 3,210 g short (833 over-axes)**. **A trimmer aimed only at fat leaves the bigger pile untouched.** Carb-over also dominates vegetarian (14 of 21) and keto (11 of 25).

## C. Did the campaign shift the mix? **Level moved. Shape did not.**

| | lab | now (553) | now (537) |
|---|--:|--:|--:|
| fat-involved share of failing days | 59% | **71.0%** | 67.2% |
| fat-only misses | 74 | **48** | 48 |
| …of which OVER | 74/74 | **48/48** | 48/48 |
| median fat-only overshoot vs midpoint | +49% | **+54.2%** | +54.2% |

**The campaign work changed only the LEVEL.** Same shape, same direction, per-day overshoot marginally *worse* (+49% → +54.2%). Consistent with G1: the shipping closer is a strict no-op on fat-over.

## D. B9 — accumulation. **CONFIRMED, steeper, and the mechanism has a name.**

Cumulative fat ratio (Σ achieved ÷ Σ nominal share over first *k* slots):

| position | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| **brief** | 1.13 | 1.17 | 1.19 | 1.26 | 1.29 | 1.32 | **1.40** | — |
| canonical 553, median | 1.023 | 1.028 | 1.023 | 1.057 | 1.064 | 1.073 | **1.139** | 1.215 |
| **the 138 failing days** | 0.998 | 1.020 | 1.041 | **1.303** | **1.485** | 1.491 | **1.733** | **1.789** |
| the 415 in-band days | 1.026 | 1.029 | 1.020 | 1.044 | 1.045 | 1.051 | 1.053 | 1.044 |

**Non-cumulative (median achieved ÷ that slot's own nominal fat share):**

| position | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| **meals only** | 1.026 | 0.998 | 1.006 | 1.020 | 1.066 | 1.062 | 1.239 | 1.217 |
| **snacks only** | — | — | **1.731** | **1.691** | **1.595** | **1.636** | **2.156** | **2.257** |

> **"The worst offender is scheduled last" holds — and the worst offender is the SNACK.** `buildSlots:145-157` appends every snack after every meal, **unconditionally**. A snack ships **1.6–2.3× its own nominal fat share at every position**; a meal stays at ~1.0 until position 7. By the time the first snack is reached, the day's fat budget is committed, its `fatTarget` floors to 0, and it ships anyway.

**Floored `fatTarget` slots:** 181 (canonical) / 195 (planned) vs the brief's 238; median fat shipped **10.59 g** vs the brief's 8.4 g. **Zero shipped 0 g.** The brief's 8.39 g is *exactly the in-band subset's median* — the harmless half.

**This is direct evidence for C2 (smallest-slot-first, +8.27, one line): snacks are the smallest slots AND the last-solved AND the fat-densest. C2 reverses all three at once.**

## E. B8 — small slots. **Split verdict.**

| band (kcal) | slots | unsolved % | **meal-only unsolved %** | snack share | median fat over | …meals only |
|---|--:|--:|--:|--:|--:|--:|
| **0–150** | 126 | **17.5%** *(brief 32.0%)* | **0.0%** | 94.4% | **+67.8%** *(brief +108.1%)* | +87.7% |
| **150–250** | 503 | **6.0%** *(brief 11.5%)* | **0.0%** | 70.2% | **+65.7%** *(brief +89.1%)* | +28.3% |
| 250–400 | 615 | 3.7% | 4.1% | 32.4% | +13.6% | +9.6% |
| **500–700** | 613 | **1.3%** *(brief 1.4% ✓)* | 1.3% | 0.7% | **+1.0%** *(brief +1.5% ✓)* | +1.0% |

By **effective** (carry-forward) target the small band sharpens: 0–150 → 238 slots, 8.0% unsolved, median fat **+101.0%**, **meals-only +172.9%**.

> **Essentially ALL of B8's unsolved rate is the snack-pool problem wearing a size costume.** In both small bands **meal-only unsolved is 0.0% — 52 of 52 unsolved small slots are snacks.** That is W1-5's F5 exactly. **No portioner, no objective change, no attempt budget touches them.**
> **But the fat overshoot is NOT a snack artifact** — meals-only median overshoot in the smallest effective band is **+172.9%**, *worse* than the mixed figure. A small slot genuinely cannot be filled leanly: **the library's median dish is 38.1 %E fat and scaling cannot change fat-per-kcal.** **B8 must be split when cited, or a solver lever will be credited with fixing an authoring problem.**

## F. B6 — closest-miss fallback. **CONFIRMED.**

| | brief | planned 640 | canonical 553 | **failing days (138)** |
|---|--:|--:|--:|--:|
| share of shipped slots | 17.9% | **20.8%** | 15.3% | **42.4%** |
| share of all slot fat overage | **51.5%** | **48.3%** | 40.2% | **62.2%** |
| g fat over per fallback slot | 6.6 | **8.30** | 8.94 | 10.47 |
| g fat over per other slot | 1.2 | **2.33** | 2.40 | 4.68 |

Reconciles on `planned-640` within ~3 pts of the brief. **On the days that actually fail: 42.4% of slots are fallbacks and they carry 62.2% of the fat overage** — the form W3-4 should use.

## G. B5 — **structure CONFIRMED verbatim; its CONCLUSION is REFUTED.**

```js
weeklyPlanner.js:421  return target > 0 ? Math.abs(scaledKcal - target) / target : 0;           // TWO-sided
weeklyPlanner.js:427  return target > 0 ? Math.max(0, (target - scaledProtein) / target) : 0;   // ONE-sided
```
The code's own justification (`:71-74`) — *"the daily target is the midpoint of a range, so 'over' is inside the band by construction"* — is **false**, because `dayTolerance` has no protein ceiling either.

**But the three supporting numbers do not survive:**

| brief | measured (553) |
|---|---|
| **50.9%** of days over protein by >12% | **5.8%** vs `proteinMid` (32/553) · 9.4% vs `proteinLo` · **18.8%** at slot level |
| median fat vs a 28 %E ask **+74.5%** | **−3.9%.** The engine does not ask 28 %E — median ask **24.1 %E**, achieved **26.9 %E** (+7.2% over `fatMid`) |
| a-priori near-symmetric (22.98 low / 20.23 high) ⇒ **search-created** | **10.7% low vs 55.7% high — ratio 5.35 : 1 AGAINST**, not 1.14 : 1 |

**The decisive test** (does a dish's fat-per-kcal put the day above/inside/below the graded window — portion scaling cannot move fat-per-kcal):

| | above | inside | below | over : short |
|---|--:|--:|--:|--:|
| **a-priori** (blind draw, 358,910 draws) | **59.9%** | 28.9% | 11.2% | **5.35 : 1** |
| **shipped** (the 2,527 dishes chosen) | **26.7%** | 67.4% | 5.9% | 4.49 : 1 |

> **The search is not the source of the asymmetry — it is the only thing fighting it.** It more than halves the above-window share (59.9 → 26.7) and lifts inside-window 28.9 → 67.4%, but the over:short *ratio* barely moves. Library median dish **38.1 %E fat** against a median ask of **24.1 %E**.
> **Consequence for W3-4: the fix cannot be objective-only.** The pantry is a first-order co-cause; a two-sided objective on a pool that is 60% too fat-dense **runs out of candidates, not out of penalty.** The one-sided-penalty defect is real and worth fixing as a correctness defect — **it should not be sold as *the* mechanism.**

## H. I7 — carry-forward. **CONFIRMED; the ratio bound is exact.**

| | brief | measured |
|---|--:|--:|
| theoretical max ratio | 1.857× | **1.857× reached exactly** on real slots |
| ratio distribution (2,634 slots) | — | median 1.000, p90 1.028, p99 **1.419**, max 1.857 |
| slots > 1.2× / > 1.5× | — | 74 / 21 (canonical); **186 / 35** (all planned) |
| personas: **nominal** ask above pool max | 0/250 | **1/249** |
| personas: **carry** ask above pool MAX | 29/250 | **22/249** |
| personas above pool p99 | 99/250 | **41/249** |

**These are LOWER bounds** — pool max/p99 come from per-diet-style pools with allergen stacking **not** applied. Worst: `p086#5` demands **19.76 g protein per 100 kcal** against a vegan pool max of **12.28**.

## I. D7 — `classifyBinding`. **CONFIRMED; total where it fires.**

`mealSolver.js:1120-1123` returns `BINDING.PROTEIN_DENSITY` before the composition branch at `:1131-1146` can read `observed`.

| measure | value |
|---|--:|
| plans emitting `protein-density` | **10** |
| …whose observed misses are fat/carb-shaped | **10** |
| **share of `protein-density` keys that are wrong** | **100%** |
| rate over plans carrying a miss (79) | **12.7%** *(brief 15.2%)* |
| rate over failing days (188 judged) | **14.9%** |

The brief's 15.2% is **bracketed by 12.7–14.9%** depending on the denominator — CONFIRMED. Examples: `p086` (7 of 7 carb-off, 0 protein-short) emits `protein-density`. **NEW:** every branch above `:1131` ignores `observed`, but on this population **0 additional** keys misfire — so the ordering fix (move the observed-composition branch above `:1121`) is complete.

## BRIEF-CLAIMS VERDICTS

| # | brief | measured | verdict |
|---|---|---|---|
| **B1** | 97 over / 1 short; fat-only 42/42 over | judged 623: **95 over / 1 short**. **fat-only 48/48 OVER**, median +54.2%. **fat-SHORT alone: 0 days at every denominator** | **CONFIRMED** |
| **B5** | 50.9%; +74.5%; search-created | structure **CONFIRMED verbatim**; but **5.8%**, **−3.9%**, a-priori **10.7 low / 55.7 high**, and the search *narrows* the skew | **REFUTED (conclusion) / CONFIRMED (structure)** |
| **B6** | 17.9%, 51.5%, 6.6 vs 1.2 g | planned-640: **20.8% / 48.3% / 8.30 vs 2.33 g**; failing days **42.4% / 62.2% / 10.47 vs 4.68** | **CONFIRMED** |
| **B8** | 32.0% / +108.1%; 1.4% / +1.5% | **17.5% / +67.8%**; big-slot end exact. **Meal-only unsolved = 0.0% in both small bands** | **ADJUSTED — must be SPLIT** |
| **B9** | 1.13→1.40; 238 slots @ 8.4 g | median 1.023→1.139; **failing days 0.998→1.789**; **snacks 1.6–2.3× at every position**; 181 slots @ **10.59 g** | **CONFIRMED (mechanism, steeper) / ADJUSTED (levels)** |
| **B10** | prompt block 74.2% | **94.7% axes / 92.6% days that contain food**; 74.6% = same quantity with empty plates booked as undershoot | **ADJUSTED — reconciled, not contradicted** |
| **I7** | 1.857×; 29/250; 99/250 | **1.857× exact**; 22/249; 41/249 — **lower bounds** | **CONFIRMED (exact) / ADJUSTED (counts)** |
| **D7** | 15.2% | **100% where it fires**; 12.7% of plans with a miss, 14.9% of failing days | **CONFIRMED** |

`git status --porcelain -- backend/src frontend/src` → empty. Zero network, zero LLM. Blockers: none.
