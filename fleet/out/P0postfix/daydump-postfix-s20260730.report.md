# dayDump — postfix · seed 20260730 (replicateA)

| provenance | value |
|---|---|
| tool | `backend/scripts/qc/dayDump.mjs` |
| dump | `fleet/out/P0postfix/daydump-postfix-s20260730.jsonl` |
| DB sha256 | `d9037dce9754b4524943069fff7e0f3e396598c108426f370b0a189458b623a1` |
| DB copy sha256 | `d9037dce9754b4524943069fff7e0f3e396598c108426f370b0a189458b623a1` MATCH |
| food fingerprint | `b961ac3afbdf3f53` (14151 foods / 910 recipes) |
| git SHA | `d8f01d4c1f0a13806a9c50c07a3bb67cabe23fb2` on `fleet/measure-2026-08` |
| git diff --stat | clean — **the baseline is a WORKING TREE, not a commit** |
| git status --porcelain | 1 entry |
| persona file | `docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl` sha256 `e564b1ddcc36b95249b51819e03762a30da61f29f2a254312699290fae57704e` |
| seed | 20260730 (replicateA) · customers 250 |
| POOL SHAPE | **route (applyFilterStack ON)** — `route` and `rig` numbers are NOT interchangeable |
| RULER | **product/dayTolerance+dayInTolerance** — 4 macros · kcal ±15% · protein ≥ mid−15% (one-sided) · fat ±25% of band mid · carb ±25% (keto over-allowance 0) |
| BRAIN | off · network calls **0** (must be 0) |
| generated | 2026-08-01T20:10:27.631Z · 31.1s |

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
| SATISFIABLE-ONLY (tier != IMPOSSIBLE, judged days) | 421 | 537 |  78.4% |  74.7%– 81.7% |
| ALL DAYS (every tier, judged days) | 443 | 623 |  71.1% |  67.4%– 74.5% |
| **ALL PLANNED DAYS (mandatory co-report — refusals counted as misses)** | 443 | 640 | ** 69.2%** |  65.5%– 72.7% |

- **unjudged days: 17 of 640** (zero slots filled) — dropped by the `judged` denominator.
- of those, **16 are SATISFIABLE solver total failures** (claim A6). A treatment that refuses more days RAISES the judged rate and is flat on the planned rate. This is why the planned line is mandatory.
- **degenerate days: 1** — a meal config asking for ZERO slots per day. `A1/rig/runRig.mjs` emits no record at all for these, which is why every previously published all-planned denominator on this campaign is **639, not 640**.
- days where the macro closer fired: 122 of 640.

## PER-DAY BINDING-MISS KEY (DERIVED — not the engine's classifyBinding)

| key | days |
|---|--:|
| `none` | 443 |
| `fat:over` | 49 |
| `carb:over` | 30 |
| `multi:protein:short+carb:over` | 22 |
| `empty` | 16 |
| `multi:kcal:short+protein:short+carb:over` | 15 |
| `multi:kcal:over+fat:over` | 14 |
| `multi:kcal:short+protein:short` | 12 |
| `multi:kcal:over+fat:over+carb:over` | 8 |
| `multi:protein:short+fat:over+carb:over` | 6 |
| `multi:fat:over+carb:short` | 4 |
| `multi:protein:short+fat:over` | 4 |
| `protein:short` | 3 |
| `multi:fat:over+carb:over` | 3 |
| `multi:kcal:short+protein:short+fat:over` | 2 |
| `kcal:short` | 2 |
| `multi:kcal:over+protein:short+carb:over` | 1 |
| `kcal:over` | 1 |
| `multi:kcal:short+protein:short+fat:short+carb:short` | 1 |
| `multi:kcal:short+fat:over+carb:short` | 1 |
| `multi:kcal:over+protein:short+fat:over+carb:over` | 1 |
| `degenerate:zero-slot-config` | 1 |
| `multi:kcal:short+protein:short+fat:over+carb:short` | 1 |

## REPRODUCE
```
node backend/scripts/qc/dayDump.mjs --seed=20260730 --label=postfix --out=fleet/out/P0postfix/daydump-postfix-s20260730.jsonl
```
