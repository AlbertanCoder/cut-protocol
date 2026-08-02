# dayDump — trim · seed 20260730 (replicateA)

| provenance | value |
|---|---|
| tool | `backend/scripts/qc/dayDump.mjs` |
| dump | `fleet/scratch/W3-7/dump-trim-s20260730.jsonl` |
| DB sha256 | `d9037dce9754b4524943069fff7e0f3e396598c108426f370b0a189458b623a1` |
| DB copy sha256 | `d9037dce9754b4524943069fff7e0f3e396598c108426f370b0a189458b623a1` MATCH |
| food fingerprint | `b961ac3afbdf3f53` (14151 foods / 910 recipes) |
| git SHA | `962ac882f9dcf035acd117b4f9421474dd2ec5e4` on `fleet/measure-2026-08` |
| git diff --stat | clean — **the baseline is a WORKING TREE, not a commit** |
| git status --porcelain | 0 entries |
| persona file | `docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl` sha256 `e564b1ddcc36b95249b51819e03762a30da61f29f2a254312699290fae57704e` |
| seed | 20260730 (replicateA) · customers 250 |
| POOL SHAPE | **route (applyFilterStack ON)** — `route` and `rig` numbers are NOT interchangeable |
| RULER | **product/dayTolerance+dayInTolerance** — 4 macros · kcal ±15% · protein ≥ mid−15% (one-sided) · fat ±25% of band mid · carb ±25% (keto over-allowance 0) |
| BRAIN | off · network calls **0** (must be 0) |
| generated | 2026-08-01T04:22:17.804Z · 31.5s |

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
| SATISFIABLE-ONLY (tier != IMPOSSIBLE, judged days) | 485 | 537 |  90.3% |  87.5%– 92.5% |
| ALL DAYS (every tier, judged days) | 508 | 623 |  81.5% |  78.3%– 84.4% |
| **ALL PLANNED DAYS (mandatory co-report — refusals counted as misses)** | 508 | 640 | ** 79.4%** |  76.1%– 82.3% |

- **unjudged days: 17 of 640** (zero slots filled) — dropped by the `judged` denominator.
- of those, **16 are SATISFIABLE solver total failures** (claim A6). A treatment that refuses more days RAISES the judged rate and is flat on the planned rate. This is why the planned line is mandatory.
- **degenerate days: 1** — a meal config asking for ZERO slots per day. `A1/rig/runRig.mjs` emits no record at all for these, which is why every previously published all-planned denominator on this campaign is **639, not 640**.
- days where the macro closer fired: 250 of 640.

## PER-DAY BINDING-MISS KEY (DERIVED — not the engine's classifyBinding)

| key | days |
|---|--:|
| `none` | 508 |
| `multi:protein:short+carb:over` | 21 |
| `fat:over` | 17 |
| `empty` | 16 |
| `carb:over` | 16 |
| `multi:kcal:short+protein:short+carb:over` | 15 |
| `multi:kcal:short+protein:short` | 10 |
| `multi:fat:over+carb:short` | 6 |
| `multi:protein:short+fat:over+carb:over` | 6 |
| `multi:kcal:over+fat:over` | 6 |
| `protein:short` | 5 |
| `multi:protein:short+fat:over` | 4 |
| `multi:kcal:short+protein:short+fat:over` | 2 |
| `multi:kcal:over+protein:short+carb:over` | 1 |
| `multi:fat:over+carb:over` | 1 |
| `multi:kcal:short+fat:over+carb:short` | 1 |
| `multi:kcal:short+protein:short+fat:short+carb:short` | 1 |
| `multi:kcal:short+carb:short` | 1 |
| `kcal:short` | 1 |
| `multi:kcal:over+protein:short+fat:over+carb:over` | 1 |
| `degenerate:zero-slot-config` | 1 |

## REPRODUCE
```
node backend/scripts/qc/dayDump.mjs --seed=20260730 --label=trim --out=fleet/scratch/W3-7/dump-trim-s20260730.jsonl
```
