# Cut Protocol — Monte Carlo QC report

- Runs: **200** · seed `424242` · BRAIN=off
- Pool: 910 recipes / 14151 foods · macro fingerprint `b961ac3afbdf3f53`
- Runtime: 26.7s (133.5 ms/run). Extrapolated: 10k ≈ 22.2 min · 100k ≈ 222.5 min.
- **Network calls during simulation: 0** (ground rule #1: must be 0).

## Outcome mix
| outcome | count | % |
|---|--:|--:|
| off-target-declared | 111 | 55.5% |
| converged | 77 | 38.5% |
| unsafe | 8 | 4.0% |
| honest-unsolvable | 4 | 2.0% |

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
| feasible days within ±5% (acceptance bar: ≥90%) | 61.4% of 1400 days |
| **SILENT** misses (feasible, breaches solver's own ±15%, undeclared — the real bug) | 0 |

## Distributions (p50 / p95 / p99 / max)
| metric | p50 | p95 | p99 | max |
|---|--:|--:|--:|--:|
| worst-day kcal deviation % | 7.9 | 100 | 100 | 100 |
| worst-day protein shortfall g | 0 | 193 | 228.3 | 279 |
| full-week solve ms | 31.1 | 227.2 | 336 | 509.5 |

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

_Generated 2026-08-01T02:04:38.252Z · every absolute nutritional number is a property of food-fingerprint `b961ac3afbdf3f53`._
