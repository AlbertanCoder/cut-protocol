# A19 — Joint vs greedy: what sequential day-selection costs

*Agent A19. Persisted to disk by the fleet coordinator from A19's returned deliverable —
subagents cannot create report files (see C4 in `CORRECTIONS.md`). Content is A19's.
A19's new scripts, 12 JSON/JSONL artifacts and 20 `CLAIMS.tsv` rows DID land.*

## Lead result (a null, then a small positive)

**Naive per-day harvesting is not distinguishable from zero at two of three seeds, and it breaks the weekly variety contract.** +2.62 / +4.14 / +1.87 pts satisfiable-only, discordant b=15/9/10 c=29/31/20 — a two-directional treatment, so C14's ~3.5-pt floor applies and only seed 20260730 clears it. Mean +2.88 pts (DERIVED). At n=536 a stable +2.9 pt effect would need n≈780 judged days to resolve.

The **variety-safe** variant — swap a day only if the whole week still respects `weeklyPlanner.js:61` `const DEFAULT_REPEAT_CAP = 2;` — gives **+1.68 pts at all three seeds, b=0, c=9** (MEASURED). One-directional, so C14 floors it at ~1.5 pts / ~9 flipped days. It sits exactly on that line: 9 days, every seed. That is a coincidence, not a stuck instrument — the flipped `dayKey` sets are **disjoint across seeds** (0 in common) and cap-blocks differ 99/106/76.

## The oracle bound — the number worth keeping

`generateBestWeekPlan` (`mealSolver.js:658` `const attempts = options.attempts ?? 5;`) selects one whole week by `score.daysInTolerance > best.score.daysInTolerance` (`:686`) and discards the rest. The probe records what the losing rolls contained.

| seed | baseline sat. | **ANY roll in band (BOUND)** | headroom | no roll ever landed |
|---|---|---|---|---|
| 424242 | 77.1 % | **87.7 %** | +10.6 | 83/553 |
| 20260730 | 77.8 % | **89.0 %** | +11.2 | 76/553 |
| 8675309 | 78.0 % | **86.8 %** | +8.8 | 88/553 |

**This is an upper bound, not an achievable rate** — it ignores the repeat cap entirely. Mean headroom +10.2 pts; the variety-safe harvest captures **16 %** of it, the cap-breaching one 28 %. **The gap between 1.7 and 10.2 points is the variety contract, not the search.** Lever reach is also narrow: only 120/250, 121/250, 122/250 windows ran more than one roll.

## A5's prediction — CONFIRMED, with one sub-prediction falsified

Achievable gap is low single digits (1.7–2.9), not >10. Sub-prediction 1 holds: 82/83 rescued days failed on fat or carb; exactly 1 of 83 failed on kcal alone. Sub-prediction 3 ("never worse") **fails** — dayN lost 34 previously-in-band days, because days share a week-level variety budget. The diet-LP analogue has no such coupling.

## C9 — this mechanism does go DOWN

**83/83** dayN-rescued and **27/27** dayNstrict-rescued days were **OVER** band at baseline; zero were short. 70/83 lowered day kcal (mean −156/−209/−320); the 34 lost days rose (+134/+133/+120). Day-selection is the trimmer A9 §5 says the closer cannot be.

## Scope limit, stated plainly

This is day-level **selection over already-solved day plans**, not a joint MILP. Within-day slot sequencing is untouched, so these deltas bound the cost of the week-level argmax only. Bound-pinned share of missed days barely moves (89.4 % → 90.8 %), consistent with A5 §3: no method respecting the same `[0.5, 2]` box recovers those.

## Integrity

11 arms: verdict-disagreements 0, kcal-drift 0, crashes 0, silent-miss 0. C16 not triggered — the pool, gate and closer are untouched. C18: `checkdb.mjs` never invoked, `--fix` never run, all arms `dbHash e55f52e53658a086`; the 07-31 re-runs are byte-identical to the 07-30 arms.

**CONFIRMED**
