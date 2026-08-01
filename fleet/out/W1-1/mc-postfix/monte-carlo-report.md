# Cut Protocol — Monte Carlo QC report

> ## ⚠ RULER — read before quoting any number below
>
> This report grades on **`oracle/acceptOk`**: |kcalDev| <= 5% AND protein >= target.proteinLo - 5 g. NO fat term. NO carb term.
> That is a **2-macro** bar. It is **NOT** the product's 4-macro dayTolerance/dayInTolerance verdict ("days in band"),
> and no number from this file may appear in a table next to one.
>
> **Solve shape:** generateBestWeekPlan via runSolve.mjs — NO horizon (every persona solved as a 7-day week) and NO adjusters (macroCloser.js never runs). routes/plans.js:324 passes both.
> **Population:** genProfile.mjs — uniform sampling, NOT the 250-row persona fleet. Crash fuzzing only.
>
> For a four-macro, shipping-shape, per-day measurement use
> `backend/scripts/qc/dayDump.mjs` + `backend/scripts/qc/scoreDays.mjs`.

- Runs: **200** · seed `424242` · BRAIN=off
- Pool: 910 recipes / 14151 foods · macro fingerprint `b961ac3afbdf3f53`
- **DB sha256** `d9037dce9754b4524943069fff7e0f3e396598c108426f370b0a189458b623a1` (`fleet/scratch/W1-1/dev.db`)
- **git** `750e2ae6c21802b8a07cb9c1bf68f2c46c6e13b9` on `fleet/measure-2026-08` · `git diff --stat`: 2 files changed, 78 insertions(+), 4 deletions(-) · `git status --porcelain`: 5 entries
  (the baseline is a WORKING TREE, not a commit — a SHA alone does not pin it)
- Runtime: 26.7s (133.3 ms/run). Extrapolated: 10k ≈ 22.2 min · 100k ≈ 222.2 min.
- **Network calls during simulation: 0** (ground rule #1: must be 0).

## Outcome mix
| outcome | count | % |
|---|--:|--:|
| off-target-declared | 107 | 53.5% |
| converged | 77 | 38.5% |
| unsafe | 8 | 4.0% |
| honest-unsolvable | 4 | 2.0% |
| off-target-undeclared | 4 | 2.0% |

## Safety tallies (target: all ZERO)
| check | count |
|---|--:|
| allergy-leak | 12 ⚠️ |
| diet-style-leak | 1 ⚠️ |
| kcal-floor-breach | 0 |
| macro-drift | 0 |
| dessert-as-meal | 0 |
| portion-bound | 0 |
| crash | 0 |
| **P0 total** | **13** |

## Core-flow (P1)
| check | count |
|---|--:|
| silent-solver-miss | 0 |
| silent-unfilled-slot | 0 |
| missing-food-row | 0 |
| feasible-day OFF-TARGET rate (outside ±5%, but declared — quality, not a bug) | 37.32% |
| feasible days within ±5% — **`oracle/acceptOk` ruler, NOT "days in band"** | 61.4% of 1400 days |
| **SILENT** misses (feasible, breaches solver's own ±15%, undeclared — the real bug) | 0 |

## Distributions (p50 / p95 / p99 / max)
| metric | p50 | p95 | p99 | max |
|---|--:|--:|--:|--:|
| worst-day kcal deviation % | 7.9 | 100 | 100 | 100 |
| worst-day protein shortfall g | 0 | 193 | 228.3 | 279 |
| full-week solve ms | 30.4 | 226.6 | 339.2 | 509.2 |

## Failure patterns — worst corners by feasible-day off-target rate
_Off-target = day outside ±5% of the calorie target (declared, not silent). Silent-miss and unsafe runs are the columns that would indicate real defects._
| diet \| allergy-stack | runs | off-target rate | silent-miss runs | unsafe runs |
|---|--:|--:|--:|--:|
| carnivore|none | 19 | 91.1% | 0 | 0 |
| vegan|fish | 3 | 90.5% | 0 | 0 |
| vegan|soy | 3 | 76.2% | 0 | 1 |
| vegan|none | 9 | 52.4% | 0 | 0 |
| paleo|none | 15 | 47.6% | 0 | 0 |
| keto|none | 7 | 38.8% | 0 | 0 |
| vegetarian|sesame | 3 | 28.6% | 0 | 0 |
| vegetarian|none | 7 | 16.3% | 0 | 0 |
| halal|none | 12 | 15.5% | 0 | 0 |
| mediterranean|none | 9 | 9.5% | 0 | 0 |
| none|none | 7 | 6.1% | 0 | 0 |
| kosher|none | 8 | 5.4% | 0 | 0 |
| none|shellfish | 3 | 0.0% | 0 | 0 |

## Reproduce
```
node scripts/qc/mc.mjs --n 200 --seed 424242
# any failing run replays from its seed in failures.jsonl
```

_Generated 2026-08-01T02:07:29.298Z · every absolute nutritional number is a property of food-fingerprint `b961ac3afbdf3f53`._
