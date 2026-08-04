# dayDump — fataim · seed 20260730 (replicateA)

| provenance | value |
|---|---|
| tool | `backend/scripts/qc/dayDump.mjs` |
| dump | `fleet/out/REAIM/daydump-fataim-s20260730.jsonl` |
| DB sha256 | `fb67a37f7f7890e68f7c053fa0c3f75bd37c59fa943ae483f33e0807cdf3ee4e` |
| DB copy sha256 | `fb67a37f7f7890e68f7c053fa0c3f75bd37c59fa943ae483f33e0807cdf3ee4e` MATCH |
| food fingerprint | `b961ac3afbdf3f53` (14151 foods / 910 recipes) |
| git SHA | `adf5f77e52c6add1b0a28e3f8bb81d41d671e984` on `fleet/measure-2026-08` |
| git diff --stat | 4 files changed, 155 insertions(+), 50 deletions(-) — **the baseline is a WORKING TREE, not a commit** |
| git status --porcelain | 6 entries |
| persona file | `docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl` sha256 `e564b1ddcc36b95249b51819e03762a30da61f29f2a254312699290fae57704e` |
| seed | 20260730 (replicateA) · customers 250 |
| POOL SHAPE | **route (applyFilterStack ON)** — `route` and `rig` numbers are NOT interchangeable |
| RULER | **product/dayTolerance+dayInTolerance** — kcal ±10% (lower edge clamped at the target's floorKcal) · protein ≥ proteinLo (one-sided floor) · fat 20–35 %E of max(achieved, target) kcal, floored at the target's fatFloorG, **keto exempt from the CEILING only** · carbs ungraded as a target, keto ceiling + a 50 g non-keto anti-ketosis floor survive |
| BRAIN | off · network calls **0** (must be 0) |
| generated | 2026-08-04T10:15:08.856Z · 34.6s |

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
| SATISFIABLE-ONLY (tier != IMPOSSIBLE, judged days) | 422 | 537 |  78.6% |  74.9%– 81.8% |
| ALL DAYS (every tier, judged days) | 442 | 622 |  71.1% |  67.4%– 74.5% |
| **ALL PLANNED DAYS (mandatory co-report — refusals counted as misses)** | 442 | 640 | ** 69.1%** |  65.4%– 72.5% |

- **unjudged days: 18 of 640** (zero slots filled) — dropped by the `judged` denominator.
- of those, **16 are SATISFIABLE solver total failures** (claim A6). A treatment that refuses more days RAISES the judged rate and is flat on the planned rate. This is why the planned line is mandatory.
- **degenerate days: 1** — a meal config asking for ZERO slots per day. `A1/rig/runRig.mjs` emits no record at all for these, which is why every previously published all-planned denominator on this campaign is **639, not 640**.
- days where the macro closer fired: 114 of 640.

## PER-DAY BINDING-MISS KEY (DERIVED — not the engine's classifyBinding)

| key | days |
|---|--:|
| `none` | 442 |
| `multi:kcal:short+protein:short` | 36 |
| `protein:short` | 24 |
| `multi:kcal:over+fat:over` | 18 |
| `fat:over` | 18 |
| `empty` | 17 |
| `kcal:short` | 13 |
| `kcal:over` | 12 |
| `carb:over` | 11 |
| `multi:kcal:short+protein:short+fat:over` | 10 |
| `multi:protein:short+fat:over` | 8 |
| `multi:kcal:over+protein:short` | 7 |
| `multi:kcal:short+protein:short+fat:short` | 7 |
| `fat:short` | 4 |
| `multi:kcal:over+protein:short+fat:over` | 4 |
| `multi:kcal:short+fat:over` | 3 |
| `multi:protein:short+fat:short` | 2 |
| `multi:kcal:over+carb:over` | 1 |
| `multi:fat:over+carb:short` | 1 |
| `degenerate:zero-slot-config` | 1 |
| `multi:kcal:over+protein:short+fat:short` | 1 |

## REPRODUCE
```
node backend/scripts/qc/dayDump.mjs --seed=20260730 --label=fataim --out=fleet/out/REAIM/daydump-fataim-s20260730.jsonl
```
