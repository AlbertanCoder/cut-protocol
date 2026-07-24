# Cut Protocol — Monte Carlo QC report

- Runs: **100,000** · seed `42` · BRAIN=off
- Pool: 889 recipes / 14124 foods · macro fingerprint `a928390845e4c437`
- Runtime: 15591.9s (155.9 ms/run). Extrapolated: 10k ≈ 26.0 min · 100k ≈ 259.9 min.
- **Network calls during simulation: 0** (ground rule #1: must be 0).

## Outcome mix
| outcome | count | % |
|---|--:|--:|
| off-target-declared | 83281 | 83.3% |
| converged | 14482 | 14.5% |
| honest-unsolvable | 2237 | 2.2% |

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
| feasible-day OFF-TARGET rate (outside ±5%, but declared — quality, not a bug) | 60.30% |
| feasible days within ±5% (acceptance bar: ≥90%) | 38.8% of 700000 days |
| **SILENT** misses (feasible, breaches solver's own ±15%, undeclared — the real bug) | 0 |

## Distributions (p50 / p95 / p99 / max)
| metric | p50 | p95 | p99 | max |
|---|--:|--:|--:|--:|
| worst-day kcal deviation % | 19.1 | 100 | 100 | 232.3 |
| worst-day protein shortfall g | 25.3 | 215 | 312 | 377 |
| full-week solve ms | 8.5 | 46 | 75.2 | 147.7 |

## Failure patterns — worst corners by feasible-day off-target rate
_Off-target = day outside ±5% of the calorie target (declared, not silent). Silent-miss and unsafe runs are the columns that would indicate real defects._
| diet \| allergy-stack | runs | off-target rate | silent-miss runs | unsafe runs |
|---|--:|--:|--:|--:|
| vegan|eggs+gluten+soy | 3 | 100.0% | 0 | 0 |
| carnivore|eggs+gluten | 39 | 100.0% | 0 | 0 |
| carnivore|fish+peanuts+soy | 5 | 100.0% | 0 | 0 |
| carnivore|dairy+peanuts+sesame | 4 | 100.0% | 0 | 0 |
| vegan|dairy+eggs+gluten+peanuts | 3 | 100.0% | 0 | 0 |
| vegan|kiwi+nuts+sesame | 4 | 100.0% | 0 | 0 |
| carnivore|eggs+fish+kiwi | 4 | 100.0% | 0 | 0 |
| carnivore|gluten+peanuts+sesame | 6 | 100.0% | 0 | 0 |
| carnivore|gluten+kiwi+peanuts+shellfish | 3 | 100.0% | 0 | 0 |
| vegetarian|dairy+eggs+nuts+shellfish | 4 | 100.0% | 0 | 0 |
| carnivore|gluten+kiwi | 48 | 100.0% | 0 | 0 |
| vegan|dairy+eggs+gluten | 3 | 100.0% | 0 | 0 |
| carnivore|fish+gluten+shellfish | 7 | 100.0% | 0 | 0 |
| carnivore|gluten+peanuts+sesame+shellfish | 3 | 100.0% | 0 | 0 |
| vegan|eggs+fish+shellfish | 4 | 100.0% | 0 | 0 |

## Reproduce
```
node scripts/qc/mc.mjs --n 100000 --seed 42
# any failing run replays from its seed in failures.jsonl
```

_Generated 2026-07-23T07:16:47.583Z · every absolute nutritional number is a property of food-fingerprint `a928390845e4c437`._
