# dayDump — armF · seed 20260730 (replicateA)

| provenance | value |
|---|---|
| tool | `backend/scripts/qc/dayDump.mjs` |
| dump | `../../Desktop/cut-protocol/fleet/out/W4-1/daydump-armF-s20260730.jsonl` |
| DB sha256 | `d9037dce9754b4524943069fff7e0f3e396598c108426f370b0a189458b623a1` |
| DB copy sha256 | `d9037dce9754b4524943069fff7e0f3e396598c108426f370b0a189458b623a1` MATCH |
| food fingerprint | `b961ac3afbdf3f53` (14151 foods / 910 recipes) |
| git SHA | `962ac882f9dcf035acd117b4f9421474dd2ec5e4` on `HEAD` |
| git diff --stat | clean — **the baseline is a WORKING TREE, not a commit** |
| git status --porcelain | 2 entries |
| persona file | `docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl` sha256 `8d98e2e0c6c74681941c78e5ca0f546345a01250f11ff2818311909a721dba7d` |
| seed | 20260730 (replicateA) · customers 250 |
| POOL SHAPE | **route (applyFilterStack ON)** — `route` and `rig` numbers are NOT interchangeable |
| RULER | **product/dayTolerance+dayInTolerance** — 4 macros · kcal ±15% · protein ≥ mid−15% (one-sided) · fat ±25% of band mid · carb ±25% (keto over-allowance 0) |
| BRAIN | off · network calls **0** (must be 0) |
| generated | 2026-08-03T04:17:51.215Z · 31.8s |

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
| SATISFIABLE-ONLY (tier != IMPOSSIBLE, judged days) | 441 | 537 |  82.1% |  78.7%– 85.1% |
| ALL DAYS (every tier, judged days) | 462 | 623 |  74.2% |  70.6%– 77.4% |
| **ALL PLANNED DAYS (mandatory co-report — refusals counted as misses)** | 462 | 640 | ** 72.2%** |  68.6%– 75.5% |

- **unjudged days: 17 of 640** (zero slots filled) — dropped by the `judged` denominator.
- of those, **16 are SATISFIABLE solver total failures** (claim A6). A treatment that refuses more days RAISES the judged rate and is flat on the planned rate. This is why the planned line is mandatory.
- **degenerate days: 1** — a meal config asking for ZERO slots per day. `A1/rig/runRig.mjs` emits no record at all for these, which is why every previously published all-planned denominator on this campaign is **639, not 640**.
- days where the macro closer fired: 264 of 640.

## PER-DAY BINDING-MISS KEY (DERIVED — not the engine's classifyBinding)

| key | days |
|---|--:|
| `none` | 462 |
| `fat:over` | 35 |
| `carb:over` | 28 |
| `multi:protein:short+carb:over` | 22 |
| `multi:kcal:over+fat:over` | 17 |
| `empty` | 16 |
| `multi:kcal:short+protein:short+carb:over` | 14 |
| `multi:kcal:short+protein:short` | 13 |
| `multi:kcal:over+fat:over+carb:over` | 7 |
| `multi:protein:short+fat:over+carb:over` | 5 |
| `multi:fat:over+carb:over` | 4 |
| `multi:protein:short+fat:over` | 3 |
| `multi:fat:over+carb:short` | 2 |
| `multi:kcal:over+protein:short+carb:over` | 2 |
| `multi:kcal:over+protein:short+fat:over+carb:over` | 2 |
| `protein:short` | 1 |
| `multi:kcal:short+protein:short+fat:short+carb:short` | 1 |
| `multi:kcal:short+fat:over+carb:short` | 1 |
| `kcal:short` | 1 |
| `multi:kcal:short+protein:short+fat:over` | 1 |
| `multi:kcal:short+protein:short+fat:short` | 1 |
| `degenerate:zero-slot-config` | 1 |
| `kcal:over` | 1 |

## REPRODUCE
```
node backend/scripts/qc/dayDump.mjs --seed=20260730 --label=armF --out=../../Desktop/cut-protocol/fleet/out/W4-1/daydump-armF-s20260730.jsonl
```
