# W3-3 — SELECTION PROBE

*Persisted by orchestrator. Artifacts: `results.json`, `probe-s*.json`, `d5-fieldscan.json`. Code: `fleet/scratch/W3-3/`. 3 seeds × 250 personas, **network calls 0** (trapped). Reconstructed baseline vs W1-2's canonical dump: **640/640 days, 0 mismatches.***

## 0. THE STRUCTURAL FACT THAT BOUNDS EVERYTHING

**185 of 250 personas ask for a ONE-DAY plan; only 65 ask for a week.** On a 1-day horizon `generateBestWeekPlan`'s key **is already the per-day argmax**.

| sub-population | base | oracle | master | greedy | realised |
|---|--:|--:|--:|--:|--:|
| **day-horizon, satisfiable (n=483)** | 84.47% | **84.47%** | 84.47% | 84.47% | 84.47% |
| week-horizon, satisfiable (n=1176) | 71.26% | 84.69% | 76.53% | 75.43% | 74.91% |

> **Every one of the oracle's 158 rescued days comes from the 65 week personas. Cherry-picking is definitionally worth zero on 74% of the population. Nobody in the corpus had noticed this, and it halves any headline computed on n=553.**

## A. THE HEADLINE — CAP-VIOLATION RATE

Naive per-day argmax, then accumulate `usageCount` vs `repeatCapFor` (= 2; **0 of 250 personas set `allowBatchRepeats`**):

| diet | violated / week personas (3 seeds) | % | worst excess |
|---|---|--:|--:|
| vegetarian / kosher / paleo / carnivore / halal | 21/21, 12/12, 6/6, 3/3, 3/3 | **100%** | +4 … +8 |
| vegan | 29/30 | 96.67% | +4 |
| mediterranean | 14/15 | 93.33% | +6 |
| none | 78/84 | 92.86% | +7 |
| keto | 18/21 | **85.71%** | +6 |
| **ALL week personas** | **184/195** | **94.36%** | **+8** |
| day-horizon personas | **0/555** | **0%** (structural) | |

**It breaks at k=2:** k=1 → 0%, **k=2 → 86.90%**, k=3 → 90.48%, k=5 → 93.45%, k=8/12 → 94.64%.

> **Consequence for W2-2's rule:** step 3 ("passes ⇒ provably optimal") fires on **566/750 persona-runs, but 555 of those are 1-day plans where the certificate certifies a gain of exactly zero.** On weeks it fires **11 times in 195 (5.6%). The provable-optimality branch is real, and it is almost never the branch you are on.**

**Counter-intuitive on keto:** keto has the *lowest* violation rate (85.7%) and the *largest* oracle headroom (+27.89 pts) — the same fact. Keto pools are so thin that when attempts diverge they diverge hard, but **the cap then eats 66% of that headroom** (+27.89 → +9.53). **W2-2's prediction #3 confirmed, via magnitude rather than rate.** Snack capacity is negative for 6 diets (worst: `none` and `vegetarian` at −15 servings) — F5 reproduced.

## B. ORACLE vs REALISED — in the mandated format

> **Oracle (upper bound, post-hoc per-day selection, ignores the weekly repeat cap): 84.63% at k=5** — 1404/1659, n = 553 × 3 seeds, baseline 75.11%, i.e. **+9.52 pts of headroom. Realised by a cap-feasible selector: 77.70%** (W2-2's safe rule, **+2.59**); **78.84%** by an exact cap-feasible master (**+3.73**). **The oracle is not achievable by any policy that respects the repeat cap and is reported only to bound the headroom.**

| arm | n=553 | n=640 | n=537 | Δ vs base |
|---|--:|--:|--:|--:|
| base | 75.11% | 68.07% | 77.34% | — |
| **oracle** (bound) | **84.63%** | 76.56% | 86.53% | +9.52 |
| master (exact, cap-feasible) | 78.84% | 71.41% | 81.13% | **+3.73** |
| greedy-with-skip *(forbidden)* | 78.06% | 70.68% | 80.32% | +2.95 |
| LNS | 78.06% | 70.68% | 80.38% | +2.95 |
| **realised** (safe rule) | **77.70%** | 70.36% | 80.01% | **+2.59** |

**W2-2's §5.2 derivation re-measured on ONE denominator:** p(k=1) = 68.23%; **m = 1.27 (k=2), 1.63 (k=5), 1.85 (k=12).** W2-2 derived 2.46. **Five attempts are worth 1.63 independent ones. Direction confirmed, magnitude worse than estimated.**

**Compression measured directly** (W2-2 §7's argument). Oracle gain per week persona, by that persona's own baseline day count:

| baseline days in band (of 7) | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| personas (3 seeds) | **38** | 8 | 8 | 14 | 8 | 19 | 18 | **82** |
| oracle gain / persona | **+0** | +1.75 | +3.50 | +3.14 | +2.75 | +1.95 | +1.00 | **+0** |

> **120 of 195 week-persona-runs (61.5%) have exactly zero selection headroom** — 38 because no attempt ever produces a compliant day (pool-caused), 82 because they are already 7/7. **The headroom is an inverted-U peaking at 2–3/7. Push per-attempt success up with C1/C2 and this table walks right. W2-2's compression argument CONFIRMED with a measurement, not a derivation.**

## C. THE SAFE RULE AND THE REPAIR

**(i)–(iii)** implemented exactly; the cap check is ~35 map increments. Where it passes (11/195 weeks + all 555 day-runs) the result **provably attains the oracle bound** (the objective is modular — `scoreWeek` is a sum, verified). Measured: **+3 days** on those 11 weeks; **+0** on the 555 day-runs.

**(iv) LNS repair — W2-2's actual recommendation, and nobody had run it.** 3 rounds × destroy 2 × 3 tries, own RNG stream.

| | level (n=553) | Δ | extra day-solves | cap breaches |
|---|--:|--:|--:|--:|
| baseline k=5 | 75.11% | — | 0 | 0/195 |
| **LNS on k=5** | **78.06%** | **+2.95** | **+15.7%** | **0/195** |
| baseline k=8 | 76.25% | +1.14 | +60% | 0/195 |
| baseline k=12 | 77.03% | +1.92 | +140% | 0/195 |

> **LNS beats a 2.4× attempt budget while spending 16% more work.** 0 cap breaches, 0 regressed days (b=49, c=0). **The strongest result in this lane — W2-2's recommendation vindicated on the budget axis, not the points axis.**

**Exact master:** 7×K binaries, DFS + suffix bound, **0 truncations**, microseconds at k=5. Beats LNS (+3.73 vs +2.95) and **attains the oracle on 146/195 weeks (74.9%)** — the non-obvious pairing with §A: *the naive pick breaks the cap 94% of the time, yet three-quarters of the time an equally-good legal alternative exists.*

**Correction to W2-2 §1.2.** "Candidate days are not columns" blocks the column-generation *pricing* argument; it does **not** block the *splice*. A spliced week is exactly evaluable and exactly cap-checkable, because every coupling is either day-local or the one counter, **and slot targets are calendar-day invariant** (`buildSlots` weights by meal index only). What the splice lacks is a guarantee the *generator* would have produced it — **provenance, not legality. The exact master is therefore available today.**

**(v) greedy-with-skip — measured, and it is exactly the trap W2-2 named.** Scores **1295/1659, byte-identical to LNS**, while breaching the cap on **114/195 weeks (58.5%, worst +5)** and regressing 54 days. ***Two arms, same headline number, one legal and one not.* W2-2 §3(iv) CONFIRMED, with the receipt.**

## D. THE FREE PERMUTATION — the clear winner

| applied to | adjacency incidences | days in band | weeks reaching **zero** adjacency |
|---|--:|--:|--:|
| baseline week | 496 → **5 (−98.99%)** | 875 → 875 (**cost 0**) | **191/195** |
| cherry-picked week | 1202 → 414 (−65.6%) | 1038 → 1038 (cost 0) | 67/195 |
| LNS week | 477 → **5 (−98.95%)** | 916 → 916 (**cost 0**) | **191/195** |

**Costs exactly zero compliance and removes essentially all calendar-adjacent repetition. Ship it regardless of everything else.**

> **And it exposes a live defect.** `generateWeekPlan` solves days in a **shuffled** order (`:995`), threads `prevDayRecipeIds = todayIds` (`:1000`), then writes results back at calendar indices (`:1003`). So `pickRecipe`'s `usedYesterday ? 0.15 : 1` discount defends adjacency in **solve order, at random calendar positions** — it does not defend calendar adjacency at all. Measured: **33.4% of calendar-adjacent day pairs share a dish** (391/1170), against 0.43% achievable for free. **The one variety mechanism the codebase has for this is pointed at the wrong axis.**

## E. VARIETY VIOLATIONS BESIDE EVERY DELTA

| arm | Δ | cap breaches | worst excess | adjacent pairs |
|---|--:|--:|--:|--:|
| base | — | **0/195** | +0 | 391 |
| oracle | +9.52 | **184/195 (94.4%)** | **+8** | 715 |
| master | +3.73 | **0/195** | +0 | 413 |
| greedy | +2.95 | **114/195 (58.5%)** | +5 | 504 |
| LNS | +2.95 | **0/195** | +0 | 375 |
| realised | +2.59 | **0/195** | +0 | 373 |

**Plus a second inflation channel nobody has published — inside the oracle itself:**
- **24 of the oracle's 163 rescued days (14.7%) ship FEWER filled meals than the baseline's day at the same calendar index.** Dropping a meal removes calories from an over-target day and walks it back inside the ±15% kcal band.
- In-band days carrying an unfilled slot: **baseline 4.36% → oracle 7.01%.** `p047` s424242 goes **31 filled slots / 3 days in band → 23 filled slots / 6 days in band.**
- **LNS is clean: 0 of 50 rescued days (0.0%)**, unfilled-slot share marginally *below* baseline.
- Hard guard passed: **0 of 5,760 day-records graded in-band with zero filled slots.**

> **So the oracle bound is itself partly a refusal artifact — E11 in different clothes, inside the number everyone quotes as the ceiling. Any future oracle report must publish the filled-slot count alongside the cap-violation rate.**

## F. D5 — VERIFIED AND SHARPENED

`:686` (`daysInTolerance` primary) and `:696-697` (early exit) **CONFIRMED verbatim.** "36% exhausted all 5": measured **280/750 = 37.33%. CONFIRMED.**

**Refinement the brief's phrasing misses.** Winner decided by: **single attempt 372 (49.6%) · `avgMatch` tie-break 301 (40.1%) · `daysInTolerance` 77 (10.3%).** The tie-break fires **four times as often** as the primary key — **but only among weeks already tied on maximum `daysInTolerance`, so it can never move the compliance count**, and the early exit only fires on already-perfect weeks. **`SCORE_WEIGHTS` is structurally incapable of moving days-in-band. That is a PROOF of C8 = 0.00, not just a measurement.** Confirmed counterfactually: selecting on `avgMatch` alone **loses 36 days and gains 0.**

**Dead fields — NUL-safe scan** (Node byte-read over 351 files; the three K1 NUL files *were* scanned, 0 hits): `scoreDay.fatInRange`, `.carbInRange`, `.kcalErrPct`, `.proteinShortPct` — **0 app-source consumers each. All DEAD.** (The one apparent consumer at `:1319` reads `scoreWeek`'s day object, a same-named different field.) Cheap cleanup: delete the four fields; 2 tests + 3 golden rows assert them, and the golden is K8 theatre already scheduled for `REGEN`.

## BRIEF-CLAIMS VERDICTS

| # | brief | measured | verdict |
|---|---|---|---|
| **C7** | +1.68 gross, **+0.00 marginal — SUBSUMED, dead** | Gross is **larger than published**: **+2.59** (safe rule) to **+3.73** (exact master), **0 cap breaches**. LNS **+2.95 for +15.7% work, beating k=12's +1.92 for +140%.** But **zero reaches the 185 one-day personas**, **61.5% of week-runs have no headroom**, **14.7% of the oracle's rescues are refusal artifacts**, and headroom compresses as per-attempt success rises. Marginal-over-C1 **UNTESTED** | **ADJUSTED** — gross ≈1.5–2× the published figure and *measurable*; "dead" is right on **priority**, wrong on **magnitude** |
| **C12** | C2@1 beats baseline@5 | **Baseline@5 = 77.34% on n=537×3 — matches 77.1%.** Baseline@1 = **70.27%**; the attempt budget is worth **+7.07**, so C12 requires C2 ≥ +7.07 at k=1 (published +8.27 ⇒ consistent) | **CONFIRMED (attempt-budget half); C2 half UNTESTED here** |
| **D5** | `dayTolerance` decides; 36%; range fields dead | `:686`/`:696-697` verbatim; **37.33%**; range fields **dead, 0 app consumers, NUL-safe scan**. **Sharpened: the `avgMatch` tie-break decides 40.1% of winners but is structurally incapable of moving the metric — a PROOF of C8 = 0.00** | **CONFIRMED**, strengthened |

**A5 honesty note:** every arm clears the stated floor, but `c = 0` is **by construction** for oracle/LNS/realised (the baseline week is always in their feasible set), and the arms are paired on the same attempt stream. **The A5 test here answers "did anything change", not "did a churning treatment beat noise". Read the point estimate and the ±0.4-pt cross-seed spread, not the p-value.** W2-2's prediction that the effect would be formally unmeasurable is **REFUTED — but only because the design is non-churning, and the effect is still small.**

## RECOMMENDATION FOR W3-7

1. **Ship the free permutation.** Zero compliance cost (0/195 weeks), removes 99% of adjacent repeats, 191/195 weeks reach zero. **Fix the underlying defect too: `usedYesterday` defends solve order, not calendar order.**
2. **Do not build a set-partitioning master problem for the compliance points.** (The exact 7×K master is ~40 lines, exact and breach-free and strictly dominates LNS — but it is +3.73 against C2's one-line +8.27, and its headroom shrinks as those land.)
3. **If any selection work ships, ship LNS repair** — best budget efficiency measured anywhere in this lane, clean on both variety axes, **the only arm with zero refusal inflation.**
4. **Never ship greedy-with-skip** — it reproduces LNS's headline exactly while breaching the cap on 58.5% of weeks.
5. **Retire the oracle number as a target.** Not achievable, 94% cap-infeasible from k=2, and **14.7% of it is bought by dropping meals.**
6. **Free cleanup:** delete `scoreDay`'s four dead fields; do not spend on `SCORE_WEIGHTS`.

`git status --porcelain -- backend/src frontend/src` → **empty.** No push. Blockers: none.
