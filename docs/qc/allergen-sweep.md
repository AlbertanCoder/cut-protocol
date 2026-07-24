# Cut Protocol — 14k allergen sweep (Phase 1D)

- Corpus: 14124 foods · 889 recipes · 10 allergen categories.
- Method: app matcher (dietaryFilter) vs the QC oracle's INDEPENDENT curated list.

## Leak candidates — a real allergen the app's list does NOT exclude (P0)
| category | distinct foods | recipes affected | examples |
|---|--:|--:|---|
| **dairy** | 3 | 0 | Infant formula, ABBOTT NUTRITION, SIMILA · Infant formula, ABBOTT NUTRITION, SIMILA · Infant formula, ABBOTT NUTRITION, SIMILA |
| **tree nuts** | 15 | 0 | Nuts, chestnuts, japanese, boiled and st · Nuts, chestnuts, japanese, roasted · Nuts, chestnuts, japanese, dried |
| **eggs** | 7 | 0 | Quiche with meat, poultry or fish · Spinach quiche, meatless · Cheese quiche, meatless |

## False exclusions — a known-safe food the app WRONGLY excludes (own ZERO bar)
- **gluten**: Rice flour, Corn tortilla
- **peanuts**: Tree nut mix (no peanut)

_Generated 2026-07-23T03:06:40.504Z. Leak candidates are oracle-flagged; each needs a same-day human confirm before a synonym fix (the oracle list can over-claim)._
