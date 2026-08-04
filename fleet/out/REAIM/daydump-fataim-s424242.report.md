# dayDump — fataim · seed 424242 (primary)

| provenance | value |
|---|---|
| tool | `backend/scripts/qc/dayDump.mjs` |
| dump | `fleet/out/REAIM/daydump-fataim-s424242.jsonl` |
| DB sha256 | `fb67a37f7f7890e68f7c053fa0c3f75bd37c59fa943ae483f33e0807cdf3ee4e` |
| DB copy sha256 | `2b36d74b9e0769f4a71ea2099b4c142f6f54dd351dd744073146c122a874b9fb` *** MISMATCH *** |
| food fingerprint | `b961ac3afbdf3f53` (14151 foods / 910 recipes) |
| git SHA | `adf5f77e52c6add1b0a28e3f8bb81d41d671e984` on `fleet/measure-2026-08` |
| git diff --stat | 4 files changed, 155 insertions(+), 50 deletions(-) — **the baseline is a WORKING TREE, not a commit** |
| git status --porcelain | 7 entries |
| persona file | `docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl` sha256 `e564b1ddcc36b95249b51819e03762a30da61f29f2a254312699290fae57704e` |
| seed | 424242 (primary) · customers 250 |
| POOL SHAPE | **route (applyFilterStack ON)** — `route` and `rig` numbers are NOT interchangeable |
| RULER | **product/dayTolerance+dayInTolerance** — kcal ±10% (lower edge clamped at the target's floorKcal) · protein ≥ proteinLo (one-sided floor) · fat 20–35 %E of max(achieved, target) kcal, floored at the target's fatFloorG, **keto exempt from the CEILING only** · carbs ungraded as a target, keto ceiling + a 50 g non-keto anti-ketosis floor survive |
| BRAIN | off · network calls **0** (must be 0) |
| generated | 2026-08-04T10:15:43.508Z · 34.5s |

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
| SATISFIABLE-ONLY (tier != IMPOSSIBLE, judged days) | 412 | 537 |  76.7% |  73.0%– 80.1% |
| ALL DAYS (every tier, judged days) | 430 | 622 |  69.1% |  65.4%– 72.6% |
| **ALL PLANNED DAYS (mandatory co-report — refusals counted as misses)** | 430 | 640 | ** 67.2%** |  63.5%– 70.7% |

- **unjudged days: 18 of 640** (zero slots filled) — dropped by the `judged` denominator.
- of those, **16 are SATISFIABLE solver total failures** (claim A6). A treatment that refuses more days RAISES the judged rate and is flat on the planned rate. This is why the planned line is mandatory.
- **degenerate days: 1** — a meal config asking for ZERO slots per day. `A1/rig/runRig.mjs` emits no record at all for these, which is why every previously published all-planned denominator on this campaign is **639, not 640**.
- days where the macro closer fired: 109 of 640.

## PER-DAY BINDING-MISS KEY (DERIVED — not the engine's classifyBinding)

| key | days |
|---|--:|
| `none` | 430 |
| `multi:kcal:short+protein:short` | 40 |
| `protein:short` | 23 |
| `fat:over` | 22 |
| `kcal:short` | 18 |
| `multi:kcal:over+fat:over` | 17 |
| `empty` | 17 |
| `carb:over` | 13 |
| `kcal:over` | 13 |
| `multi:kcal:short+protein:short+fat:over` | 11 |
| `multi:kcal:over+protein:short` | 10 |
| `multi:kcal:short+protein:short+fat:short` | 8 |
| `multi:protein:short+fat:over` | 7 |
| `multi:protein:short+fat:short` | 3 |
| `multi:kcal:short+fat:over` | 3 |
| `multi:kcal:over+protein:short+fat:over` | 2 |
| `fat:short` | 1 |
| `multi:fat:over+carb:short` | 1 |
| `degenerate:zero-slot-config` | 1 |

## REPRODUCE
```
node backend/scripts/qc/dayDump.mjs --seed=424242 --label=fataim --out=fleet/out/REAIM/daydump-fataim-s424242.jsonl
```
