# Cut Protocol — Monte Carlo QC report

- Runs: **10,000** · seed `42` · BRAIN=off
- Pool: 889 recipes / 14124 foods · macro fingerprint `a928390845e4c437`
- Runtime: 1233.2s (123.3 ms/run). Extrapolated: 10k ≈ 20.6 min · 100k ≈ 205.5 min.
- **Network calls during simulation: 0** (ground rule #1: must be 0).

## Outcome mix
| outcome | count | % |
|---|--:|--:|
| off-target-declared | 8262 | 82.6% |
| converged | 1494 | 14.9% |
| honest-unsolvable | 244 | 2.4% |

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
| feasible-day OFF-TARGET rate (outside ±5%, but declared — quality, not a bug) | 59.48% |
| feasible days within ±5% (acceptance bar: ≥90%) | 39.6% of 70000 days |
| **SILENT** misses (feasible, breaches solver's own ±15%, undeclared — the real bug) | 0 |

## Distributions (p50 / p95 / p99 / max)
| metric | p50 | p95 | p99 | max |
|---|--:|--:|--:|--:|
| worst-day kcal deviation % | 18.9 | 100 | 100 | 160.4 |
| worst-day protein shortfall g | 24.9 | 208 | 308 | 374 |
| full-week solve ms | 6.8 | 35.3 | 56.1 | 86.5 |

## Failure patterns — worst corners by feasible-day off-target rate
_Off-target = day outside ±5% of the calorie target (declared, not silent). Silent-miss and unsafe runs are the columns that would indicate real defects._
| diet \| allergy-stack | runs | off-target rate | silent-miss runs | unsafe runs |
|---|--:|--:|--:|--:|
| carnivore|dairy+gluten | 7 | 100.0% | 0 | 0 |
| vegan|dairy+eggs | 4 | 100.0% | 0 | 0 |
| carnivore|gluten+peanuts | 6 | 100.0% | 0 | 0 |
| vegan|gluten+shellfish | 3 | 100.0% | 0 | 0 |
| carnivore|eggs+sesame | 5 | 100.0% | 0 | 0 |
| vegetarian|dairy+shellfish | 3 | 100.0% | 0 | 0 |
| carnivore|kiwi+peanuts | 3 | 100.0% | 0 | 0 |
| carnivore|gluten+shellfish | 3 | 100.0% | 0 | 0 |
| vegan|nuts+soy | 6 | 100.0% | 0 | 0 |
| carnivore|eggs+nuts | 3 | 100.0% | 0 | 0 |
| carnivore|gluten+kiwi | 9 | 100.0% | 0 | 0 |
| vegan|eggs+gluten | 5 | 100.0% | 0 | 0 |
| carnivore|gluten+sesame | 3 | 100.0% | 0 | 0 |
| vegan|kiwi+soy | 4 | 100.0% | 0 | 0 |
| vegan|gluten+sesame | 5 | 100.0% | 0 | 0 |

## Reproduce
```
node scripts/qc/mc.mjs --n 10000 --seed 42
# any failing run replays from its seed in failures.jsonl
```

_Generated 2026-07-23T02:44:41.778Z · every absolute nutritional number is a property of food-fingerprint `a928390845e4c437`._
