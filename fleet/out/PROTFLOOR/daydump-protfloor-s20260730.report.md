# dayDump — protfloor · seed 20260730 (replicateA)

| provenance | value |
|---|---|
| tool | `backend/scripts/qc/dayDump.mjs` |
| dump | `fleet/out/PROTFLOOR/daydump-protfloor-s20260730.jsonl` |
| DB sha256 | `fb67a37f7f7890e68f7c053fa0c3f75bd37c59fa943ae483f33e0807cdf3ee4e` |
| DB copy sha256 | `fb67a37f7f7890e68f7c053fa0c3f75bd37c59fa943ae483f33e0807cdf3ee4e` MATCH |
| food fingerprint | `b961ac3afbdf3f53` (14151 foods / 910 recipes) |
| git SHA | `0ec5ea936312d4fe277856847e116ec27d16d81a` on `fleet/measure-2026-08` |
| git diff --stat | 9 files changed, 220 insertions(+), 60 deletions(-) — **the baseline is a WORKING TREE, not a commit** |
| git status --porcelain | 12 entries |
| persona file | `docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl` sha256 `e564b1ddcc36b95249b51819e03762a30da61f29f2a254312699290fae57704e` |
| seed | 20260730 (replicateA) · customers 250 |
| POOL SHAPE | **route (applyFilterStack ON)** — `route` and `rig` numbers are NOT interchangeable |
| RULER | **product/dayTolerance+dayInTolerance** — kcal ±10% (lower edge clamped at the target's floorKcal) · protein ≥ proteinLo (one-sided floor) · fat 20–35 %E of max(achieved, target) kcal, floored at the target's fatFloorG, **keto exempt from the CEILING only** · carbs ungraded as a target, keto ceiling + a 50 g non-keto anti-ketosis floor survive |
| BRAIN | off · network calls **0** (must be 0) |
| generated | 2026-08-04T10:33:22.242Z · 35.0s |

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
| SATISFIABLE-ONLY (tier != IMPOSSIBLE, judged days) | 444 | 537 |  82.7% |  79.3%– 85.6% |
| ALL DAYS (every tier, judged days) | 464 | 622 |  74.6% |  71.0%– 77.9% |
| **ALL PLANNED DAYS (mandatory co-report — refusals counted as misses)** | 464 | 640 | ** 72.5%** |  68.9%– 75.8% |

- **unjudged days: 18 of 640** (zero slots filled) — dropped by the `judged` denominator.
- of those, **16 are SATISFIABLE solver total failures** (claim A6). A treatment that refuses more days RAISES the judged rate and is flat on the planned rate. This is why the planned line is mandatory.
- **degenerate days: 1** — a meal config asking for ZERO slots per day. `A1/rig/runRig.mjs` emits no record at all for these, which is why every previously published all-planned denominator on this campaign is **639, not 640**.
- days where the macro closer fired: 126 of 640.

## PER-DAY BINDING-MISS KEY (DERIVED — not the engine's classifyBinding)

| key | days |
|---|--:|
| `none` | 464 |
| `multi:kcal:short+protein:short` | 36 |
| `kcal:short` | 26 |
| `multi:kcal:over+fat:over` | 19 |
| `empty` | 17 |
| `kcal:over` | 15 |
| `carb:over` | 12 |
| `protein:short` | 10 |
| `multi:kcal:short+protein:short+fat:short` | 8 |
| `multi:kcal:over+protein:short` | 6 |
| `multi:kcal:short+protein:short+fat:over` | 6 |
| `fat:over` | 5 |
| `multi:protein:short+fat:over` | 4 |
| `fat:short` | 4 |
| `multi:kcal:short+fat:over` | 3 |
| `multi:protein:short+fat:short` | 2 |
| `multi:fat:over+carb:short` | 1 |
| `multi:kcal:over+protein:short+fat:over` | 1 |
| `degenerate:zero-slot-config` | 1 |

## REPRODUCE
```
node backend/scripts/qc/dayDump.mjs --seed=20260730 --label=protfloor --out=fleet/out/PROTFLOOR/daydump-protfloor-s20260730.jsonl
```
