# dayDump — route · seed 8675309 (replicateB)

| provenance | value |
|---|---|
| tool | `backend/scripts/qc/dayDump.mjs` |
| dump | `fleet/out/W1-1/daydump-route-s8675309.jsonl` |
| DB sha256 | `d9037dce9754b4524943069fff7e0f3e396598c108426f370b0a189458b623a1` |
| DB copy sha256 | `d9037dce9754b4524943069fff7e0f3e396598c108426f370b0a189458b623a1` MATCH |
| food fingerprint | `b961ac3afbdf3f53` (14151 foods / 910 recipes) |
| git SHA | `750e2ae6c21802b8a07cb9c1bf68f2c46c6e13b9` on `fleet/measure-2026-08` |
| git diff --stat | 2 files changed, 78 insertions(+), 4 deletions(-) — **the baseline is a WORKING TREE, not a commit** |
| git status --porcelain | 5 entries |
| persona file | `docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl` sha256 `e564b1ddcc36b95249b51819e03762a30da61f29f2a254312699290fae57704e` |
| seed | 8675309 (replicateB) · customers 250 |
| POOL SHAPE | **route (applyFilterStack ON)** — `route` and `rig` numbers are NOT interchangeable |
| RULER | **product/dayTolerance+dayInTolerance** — 4 macros · kcal ±15% · protein ≥ mid−15% (one-sided) · fat ±25% of band mid · carb ±25% (keto over-allowance 0) |
| BRAIN | off · network calls **0** (must be 0) |
| generated | 2026-08-01T02:11:13.595Z · 31.6s |

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
| SATISFIABLE-ONLY (tier != IMPOSSIBLE, judged days) | 413 | 537 |  76.9% |  73.2%– 80.3% |
| ALL DAYS (every tier, judged days) | 433 | 623 |  69.5% |  65.8%– 73.0% |
| **ALL PLANNED DAYS (mandatory co-report — refusals counted as misses)** | 433 | 640 | ** 67.7%** |  63.9%– 71.2% |

- **unjudged days: 17 of 640** (zero slots filled) — dropped by the `judged` denominator.
- of those, **16 are SATISFIABLE solver total failures** (claim A6). A treatment that refuses more days RAISES the judged rate and is flat on the planned rate. This is why the planned line is mandatory.
- **degenerate days: 1** — a meal config asking for ZERO slots per day. `A1/rig/runRig.mjs` emits no record at all for these, which is why every previously published all-planned denominator on this campaign is **639, not 640**.
- days where the macro closer fired: 262 of 640.

## PER-DAY BINDING-MISS KEY (DERIVED — not the engine's classifyBinding)

| key | days |
|---|--:|
| `none` | 433 |
| `fat:over` | 55 |
| `carb:over` | 38 |
| `multi:protein:short+carb:over` | 23 |
| `multi:kcal:over+fat:over` | 19 |
| `empty` | 16 |
| `multi:kcal:short+protein:short+carb:over` | 15 |
| `multi:kcal:short+protein:short` | 11 |
| `multi:kcal:over+fat:over+carb:over` | 6 |
| `multi:fat:over+carb:short` | 5 |
| `protein:short` | 3 |
| `multi:kcal:short+protein:short+fat:over` | 3 |
| `multi:protein:short+fat:over` | 3 |
| `multi:kcal:over+protein:short+fat:over+carb:over` | 2 |
| `multi:protein:short+fat:over+carb:over` | 2 |
| `multi:fat:over+carb:over` | 2 |
| `multi:kcal:over+carb:over` | 1 |
| `multi:kcal:short+protein:short+fat:short+carb:short` | 1 |
| `kcal:short` | 1 |
| `degenerate:zero-slot-config` | 1 |

## REPRODUCE
```
node backend/scripts/qc/dayDump.mjs --seed=8675309 --label=route --out=fleet/out/W1-1/daydump-route-s8675309.jsonl
```
