# dayDump — goalruler · seed 8675309 (replicateB)

| provenance | value |
|---|---|
| tool | `backend/scripts/qc/dayDump.mjs` |
| dump | `fleet/out/RULER/daydump-goalruler-s8675309.jsonl` |
| DB sha256 | `fb67a37f7f7890e68f7c053fa0c3f75bd37c59fa943ae483f33e0807cdf3ee4e` |
| DB copy sha256 | `2b36d74b9e0769f4a71ea2099b4c142f6f54dd351dd744073146c122a874b9fb` *** MISMATCH *** |
| food fingerprint | `b961ac3afbdf3f53` (14151 foods / 910 recipes) |
| git SHA | `df92267d0afc8efdc2ab4d4288d4d8529e40d95f` on `fleet/measure-2026-08` |
| git diff --stat | 4 files changed, 144 insertions(+), 50 deletions(-) — **the baseline is a WORKING TREE, not a commit** |
| git status --porcelain | 6 entries |
| persona file | `docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl` sha256 `e564b1ddcc36b95249b51819e03762a30da61f29f2a254312699290fae57704e` |
| seed | 8675309 (replicateB) · customers 250 |
| POOL SHAPE | **route (applyFilterStack ON)** — `route` and `rig` numbers are NOT interchangeable |
| RULER | **product/dayTolerance+dayInTolerance** — 4 macros · kcal ±15% · protein ≥ mid−15% (one-sided) · fat ±25% of band mid · carb ±25% (keto over-allowance 0) |
| BRAIN | off · network calls **0** (must be 0) |
| generated | 2026-08-03T15:04:57.990Z · 53.0s |

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
| SATISFIABLE-ONLY (tier != IMPOSSIBLE, judged days) | 486 | 537 |  90.5% |  87.7%– 92.7% |
| ALL DAYS (every tier, judged days) | 509 | 622 |  81.8% |  78.6%– 84.7% |
| **ALL PLANNED DAYS (mandatory co-report — refusals counted as misses)** | 509 | 640 | ** 79.5%** |  76.2%– 82.5% |

- **unjudged days: 18 of 640** (zero slots filled) — dropped by the `judged` denominator.
- of those, **16 are SATISFIABLE solver total failures** (claim A6). A treatment that refuses more days RAISES the judged rate and is flat on the planned rate. This is why the planned line is mandatory.
- **degenerate days: 1** — a meal config asking for ZERO slots per day. `A1/rig/runRig.mjs` emits no record at all for these, which is why every previously published all-planned denominator on this campaign is **639, not 640**.
- days where the macro closer fired: 114 of 640.

## PER-DAY BINDING-MISS KEY (DERIVED — not the engine's classifyBinding)

| key | days |
|---|--:|
| `none` | 509 |
| `protein:short` | 28 |
| `multi:kcal:short+protein:short` | 18 |
| `empty` | 17 |
| `fat:over` | 15 |
| `kcal:over` | 13 |
| `multi:kcal:over+fat:over` | 10 |
| `carb:over` | 8 |
| `multi:protein:short+fat:over` | 7 |
| `multi:kcal:short+protein:short+fat:over` | 6 |
| `multi:kcal:short+protein:short+fat:short` | 4 |
| `kcal:short` | 2 |
| `multi:kcal:short+protein:short+carb:over` | 1 |
| `multi:kcal:over+protein:short+fat:over` | 1 |
| `degenerate:zero-slot-config` | 1 |

## REPRODUCE
```
node backend/scripts/qc/dayDump.mjs --seed=8675309 --label=goalruler --out=fleet/out/RULER/daydump-goalruler-s8675309.jsonl
```
