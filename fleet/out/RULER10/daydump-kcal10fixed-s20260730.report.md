# dayDump — kcal10fixed · seed 20260730 (replicateA)

| provenance | value |
|---|---|
| tool | `backend/scripts/qc/dayDump.mjs` |
| dump | `fleet/out/RULER10/daydump-kcal10fixed-s20260730.jsonl` |
| DB sha256 | `fb67a37f7f7890e68f7c053fa0c3f75bd37c59fa943ae483f33e0807cdf3ee4e` |
| DB copy sha256 | `2b36d74b9e0769f4a71ea2099b4c142f6f54dd351dd744073146c122a874b9fb` *** MISMATCH *** |
| food fingerprint | `b961ac3afbdf3f53` (14151 foods / 910 recipes) |
| git SHA | `223e4289a292cfaf6bf8667f1e35aea098cbfb96` on `fleet/measure-2026-08` |
| git diff --stat | 8 files changed, 410 insertions(+), 1588 deletions(-) — **the baseline is a WORKING TREE, not a commit** |
| git status --porcelain | 14 entries |
| persona file | `docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl` sha256 `e564b1ddcc36b95249b51819e03762a30da61f29f2a254312699290fae57704e` |
| seed | 20260730 (replicateA) · customers 250 |
| POOL SHAPE | **route (applyFilterStack ON)** — `route` and `rig` numbers are NOT interchangeable |
| RULER | **product/dayTolerance+dayInTolerance** — kcal ±10% (lower edge clamped at the target's floorKcal) · protein ≥ proteinLo (one-sided floor) · fat 20–35 %E of max(achieved, target) kcal, floored at the target's fatFloorG, **keto exempt from the CEILING only** · carbs ungraded as a target, keto ceiling + a 50 g non-keto anti-ketosis floor survive |
| BRAIN | off · network calls **0** (must be 0) |
| generated | 2026-08-04T02:07:41.784Z · 33.8s |

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
| SATISFIABLE-ONLY (tier != IMPOSSIBLE, judged days) | 430 | 537 |  80.1% |  76.5%– 83.2% |
| ALL DAYS (every tier, judged days) | 449 | 622 |  72.2% |  68.5%– 75.6% |
| **ALL PLANNED DAYS (mandatory co-report — refusals counted as misses)** | 449 | 640 | ** 70.2%** |  66.5%– 73.6% |

- **unjudged days: 18 of 640** (zero slots filled) — dropped by the `judged` denominator.
- of those, **16 are SATISFIABLE solver total failures** (claim A6). A treatment that refuses more days RAISES the judged rate and is flat on the planned rate. This is why the planned line is mandatory.
- **degenerate days: 1** — a meal config asking for ZERO slots per day. `A1/rig/runRig.mjs` emits no record at all for these, which is why every previously published all-planned denominator on this campaign is **639, not 640**.
- days where the macro closer fired: 125 of 640.

## PER-DAY BINDING-MISS KEY (DERIVED — not the engine's classifyBinding)

| key | days |
|---|--:|
| `none` | 449 |
| `multi:kcal:short+protein:short` | 37 |
| `kcal:short` | 25 |
| `protein:short` | 22 |
| `empty` | 17 |
| `multi:kcal:over+fat:over` | 16 |
| `kcal:over` | 12 |
| `carb:over` | 11 |
| `multi:kcal:over+protein:short` | 10 |
| `multi:kcal:short+protein:short+fat:short` | 8 |
| `multi:kcal:short+protein:short+fat:over` | 7 |
| `multi:protein:short+fat:over` | 6 |
| `fat:over` | 5 |
| `fat:short` | 4 |
| `multi:protein:short+fat:short` | 3 |
| `multi:kcal:over+protein:short+fat:over` | 3 |
| `multi:kcal:short+fat:over` | 2 |
| `multi:protein:short+carb:over` | 1 |
| `multi:fat:over+carb:short` | 1 |
| `degenerate:zero-slot-config` | 1 |

## REPRODUCE
```
node backend/scripts/qc/dayDump.mjs --seed=20260730 --label=kcal10fixed --out=fleet/out/RULER10/daydump-kcal10fixed-s20260730.jsonl
```
