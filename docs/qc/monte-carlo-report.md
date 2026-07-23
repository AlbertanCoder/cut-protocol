# Cut Protocol — Monte Carlo QC report

- Runs: **1,000** · seed `42` · BRAIN=off
- Pool: 889 recipes / 14124 foods · macro fingerprint `a928390845e4c437`
- Runtime: 126.7s (126.7 ms/run). Extrapolated: 10k ≈ 21.1 min · 100k ≈ 211.2 min.
- **Network calls during simulation: 0** (ground rule #1: must be 0).

## Outcome mix
| outcome | count | % |
|---|--:|--:|
| off-target-declared | 840 | 84.0% |
| converged | 134 | 13.4% |
| honest-unsolvable | 26 | 2.6% |

## Safety tallies (target: all ZERO)
| check | count |
|---|--:|
| allergy-leak | 0 |
| diet-style-leak | 0 |
| kcal-floor-breach | 0 |
| macro-drift | 0 |
| dessert-as-meal | 0 |
| portion-bound | 0 |
| crash | 0 |
| **P0 total** | **0** |

## Core-flow (P1)
| check | count |
|---|--:|
| silent-solver-miss | 0 |
| silent-unfilled-slot | 0 |
| missing-food-row | 0 |
| feasible-day OFF-TARGET rate (outside ±5%, but declared — quality, not a bug) | 61.14% |
| feasible days within ±5% (acceptance bar: ≥90%) | 37.9% of 7000 days |
| **SILENT** misses (feasible, breaches solver's own ±15%, undeclared — the real bug) | 0 |

## Distributions (p50 / p95 / p99 / max)
| metric | p50 | p95 | p99 | max |
|---|--:|--:|--:|--:|
| worst-day kcal deviation % | 19.2 | 100 | 100 | 139.5 |
| worst-day protein shortfall g | 27 | 223.1 | 324 | 362 |
| full-week solve ms | 6.9 | 36.2 | 51.7 | 81.3 |

## Failure patterns — worst corners by feasible-day off-target rate
_Off-target = day outside ±5% of the calorie target (declared, not silent). Silent-miss and unsafe runs are the columns that would indicate real defects._
| diet \| allergy-stack | runs | off-target rate | silent-miss runs | unsafe runs |
|---|--:|--:|--:|--:|
| vegan|dairy+nuts | 3 | 100.0% | 0 | 0 |
| carnivore|nuts | 4 | 100.0% | 0 | 0 |
| carnivore|soy | 3 | 100.0% | 0 | 0 |
| vegan|soy | 4 | 100.0% | 0 | 0 |
| carnivore|eggs | 4 | 100.0% | 0 | 0 |
| vegan|gluten+soy | 3 | 100.0% | 0 | 0 |
| carnivore|gluten | 7 | 98.0% | 0 | 0 |
| carnivore|none | 57 | 95.7% | 0 | 0 |
| carnivore|kiwi+nuts | 3 | 95.2% | 0 | 0 |
| carnivore|peanuts | 4 | 95.2% | 0 | 0 |
| vegan|nuts+shellfish | 3 | 95.2% | 0 | 0 |
| kosher|nuts | 3 | 95.2% | 0 | 0 |
| carnivore|shellfish | 4 | 95.2% | 0 | 0 |
| carnivore|fish | 4 | 90.5% | 0 | 0 |
| vegan|none | 51 | 89.4% | 0 | 0 |

## Reproduce
```
node scripts/qc/mc.mjs --n 1000 --seed 42
# any failing run replays from its seed in failures.jsonl
```

_Generated 2026-07-23T02:03:27.717Z · every absolute nutritional number is a property of food-fingerprint `a928390845e4c437`._
