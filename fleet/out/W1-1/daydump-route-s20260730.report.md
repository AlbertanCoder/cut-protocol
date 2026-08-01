# dayDump — route · seed 20260730 (replicateA)

| provenance | value |
|---|---|
| tool | `backend/scripts/qc/dayDump.mjs` |
| dump | `fleet/out/W1-1/daydump-route-s20260730.jsonl` |
| DB sha256 | `d9037dce9754b4524943069fff7e0f3e396598c108426f370b0a189458b623a1` |
| DB copy sha256 | `d9037dce9754b4524943069fff7e0f3e396598c108426f370b0a189458b623a1` MATCH |
| food fingerprint | `b961ac3afbdf3f53` (14151 foods / 910 recipes) |
| git SHA | `750e2ae6c21802b8a07cb9c1bf68f2c46c6e13b9` on `fleet/measure-2026-08` |
| git diff --stat | 2 files changed, 78 insertions(+), 4 deletions(-) — **the baseline is a WORKING TREE, not a commit** |
| git status --porcelain | 5 entries |
| persona file | `docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl` sha256 `e564b1ddcc36b95249b51819e03762a30da61f29f2a254312699290fae57704e` |
| seed | 20260730 (replicateA) · customers 250 |
| POOL SHAPE | **route (applyFilterStack ON)** — `route` and `rig` numbers are NOT interchangeable |
| RULER | **product/dayTolerance+dayInTolerance** — 4 macros · kcal ±15% · protein ≥ mid−15% (one-sided) · fat ±25% of band mid · carb ±25% (keto over-allowance 0) |
| BRAIN | off · network calls **0** (must be 0) |
| generated | 2026-08-01T02:10:41.838Z · 31.1s |

## INSTRUMENT CHECKS (all must be 0)

| check | count |
|---|--:|
| verdict disagreements (engine vs re-derived) | 0 |
| kcal drift > 1 (solver claim vs raw Food rows) | 0 |
| missing Food rows referenced by a slot | 0 |
| crashes | 0 |
| network calls | 0 |

## LEVEL — all three denominators, never mixed

| denominator | in band | n | rate | 95% CI (Wilson) |
|---|--:|--:|--:|---|
| SATISFIABLE-ONLY (tier != IMPOSSIBLE, judged days) | 418 | 537 |  77.8% |  74.1%– 81.1% |
| ALL DAYS (every tier, judged days) | 439 | 623 |  70.5% |  66.8%– 73.9% |
| **ALL PLANNED DAYS (mandatory co-report — refusals counted as misses)** | 439 | 640 | ** 68.6%** |  64.9%– 72.1% |

- **unjudged days: 17 of 640** (zero slots filled) — dropped by the `judged` denominator.
- of those, **16 are SATISFIABLE solver total failures** (claim A6). A treatment that refuses more days RAISES the judged rate and is flat on the planned rate. This is why the planned line is mandatory.
- **degenerate days: 1** — a meal config asking for ZERO slots per day. `A1/rig/runRig.mjs` emits no record at all for these, which is why every previously published all-planned denominator on this campaign is **639, not 640**.
- days where the macro closer fired: 259 of 640.

## PER-DAY BINDING-MISS KEY (DERIVED — not the engine's classifyBinding)

| key | days |
|---|--:|
| `none` | 439 |
| `fat:over` | 55 |
| `carb:over` | 34 |
| `multi:protein:short+carb:over` | 20 |
| `empty` | 16 |
| `multi:kcal:short+protein:short+carb:over` | 15 |
| `multi:kcal:over+fat:over` | 14 |
| `multi:kcal:short+protein:short` | 14 |
| `multi:kcal:over+fat:over+carb:over` | 6 |
| `multi:protein:short+fat:over+carb:over` | 6 |
| `multi:fat:over+carb:short` | 4 |
| `multi:fat:over+carb:over` | 3 |
| `multi:protein:short+fat:over` | 3 |
| `multi:kcal:over+protein:short+fat:over+carb:over` | 2 |
| `multi:kcal:short+protein:short+fat:over` | 2 |
| `multi:kcal:over+protein:short+carb:over` | 1 |
| `protein:short` | 1 |
| `kcal:over` | 1 |
| `multi:kcal:short+protein:short+fat:short+carb:short` | 1 |
| `multi:kcal:short+carb:short` | 1 |
| `kcal:short` | 1 |
| `degenerate:zero-slot-config` | 1 |

## REPRODUCE
```
node backend/scripts/qc/dayDump.mjs --seed=20260730 --label=route --out=fleet/out/W1-1/daydump-route-s20260730.jsonl
```
