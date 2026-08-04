# PROVENANCE VOID — do not quote the rates in this directory

These runs (`RULER/`, ±15%, and `RULER8/`, ±8%) were measured on 2026-08-03 with a
ruler carrying five safety defects. They are kept because they are the evidence
behind a decision that was made, not because their numbers are usable.

**What the ruler could not see when these were measured:**

| defect | fixed in |
|---|---|
| keto exempt from the fat FLOOR, not just the ceiling — a 4.9 %E keto day graded green with no miss line | `758770f` |
| the ±10% band re-opened the safety-floor clamp downward — an 1,834 kcal floored target passed a 1,651 kcal day | `9731ea9` |
| `fatFloorG` never bound; the %E floor sat at 15, below both the AMDR and what the engine prescribes | `0aa3235` |
| `proteinOk` rendered `NaN` on a target with no floor | `78b21aa` |
| non-keto carbs entirely ungraded — a ketogenic day could ship to a non-keto user | `29773a0` |
| the %E share divided by ACHIEVED kcal, so an under-delivered day was told its fat was OVER | `1722dba` |

Their report headers also stamp the OLD band-relative ruler (`protein ≥ mid−15% ·
fat ±25% of band mid`), which is not what produced the verdicts in them — that
provenance bug is fixed in `223e428`.

**Two further reasons the numbers cannot be compared to anything current:** the
dumps store only the macro bands, so they are not re-gradeable (the verdict also
consults `floorKcal`, `fatFloorG` and the target's `carbMid` — worth +3.7 pp when
missing), and their `achieved` totals are rounded to 2dp, which flips days sitting
on a floor.

**Supersedes these:** `fleet/out/RULER10/`, measured on the corrected ruler, three
seeds, all instrument checks 0, re-grade round trip 0 of 1,866.

The headline this directory was cited for — "the goal ruler recovers the lever
programme, 90.1% satisfiable" — is void. The corrected figure is 80.5%, and the
decomposition shows the calorie band was never the lever: reverting ±10% to ±15%
is worth 0.5 pp, while the two safety rules are worth 2.7 and 2.2.
