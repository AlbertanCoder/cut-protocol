# A2 · Failure taxonomy of the 173 missed days

*Agent A2. Persisted to disk by the fleet coordinator from A2's returned deliverable —
subagents cannot create report files (see C4 in `CORRECTIONS.md`). Content is A2's.
A2's machine-readable artifacts DID land and are listed at the foot.*

**Source:** `qa-fleet-20260729-2032` (head `0d3eaa5`, `BRAIN=off`). No new solve, no DB
copy, no new harness. Per-day verdicts from `results.jsonl`; the per-slot
`proteinScale`/`sidesScale` that `results.jsonl` does **not** carry were recovered from
`raw/pNNN.json`, which stores the full `POST /plans/generate` body.

**Instrument check (MEASURED).** All 212 persona dumps reproduce the graded run's
per-day claimed kcal exactly — `instrumentMismatch: 0`, 578 days, 173 misses. The raw
dumps are the graded plans, not a neighbouring run.

## The headline

**On the satisfiable denominator, 63.6 % of missed days are bound by the 0.5×–2.0×
portion limit.** Protein-short and kcal-out-of-band are binding on **zero** days — both
appear only as symptoms alongside a bound or an empty slot.

Bounds are `SCALE_BOUNDS = { min: 0.5, max: 2 }` (`backend/src/lib/weeklyPlanner.js:58`).
Scales are `round2()`'d (`:356`), so edge equality is exact. Unfilled slots carry a
cosmetic `1/1` (`:481`) and are excluded from pinning counts.

## Precedence rule (documented; raw co-occurrence below so you need not trust it)

1. **STRUCTURAL** — persona engineered unsatisfiable; correct output is refusal.
2. **POOL_EXHAUSTED** — a slot had nothing to place. Scaling cannot fill an empty slot.
3. **PINNED_AT_BOUND** — *directional*: the day needed to move one way and ≥1 slot sat on
   the bound blocking that way. Wanting more is blocked by 2.0×, wanting less by 0.5×. A
   non-directional "any slot pinned" test is near-vacuous on 4–5-slot days.
4–7. The worst remaining macro excursion, as a multiple of **its own** tolerance.

## Binding constraint — counts and percentages

| binding | all 578 days (n=173 misses) | satisfiable only (n=110 misses) |
|---|---|---|
| STRUCTURAL | 63 (36.4 %) | — |
| PINNED_AT_BOUND | 70 (40.5 %) | 70 (**63.6 %**) |
| POOL_EXHAUSTED | 21 (12.1 %) | 21 (19.1 %) |
| FAT_OUT_OF_BAND | 10 (5.8 %) | 10 (9.1 %) |
| CARB_OUT_OF_BAND | 9 (5.2 %) | 9 (8.2 %) |
| PROTEIN_SHORT | 0 | 0 |
| KCAL_OUT_OF_BAND | 0 | 0 |
| **sum** | **173 ✓** | **110 ✓** |

### Per diet — all 578 days

| diet | days | miss | miss % | STRUCT | POOL | PINNED | FAT | CARB |
|---|---|---|---|---|---|---|---|---|
| carnivore | 8 | 8 | 100.0 | 0 | 7 | 0 | 1 | 0 |
| halal | 12 | 0 | 0.0 | 0 | 0 | 0 | 0 | 0 |
| keto | 50 | 19 | 38.0 | 0 | 13 | 2 | 0 | 4 |
| kosher | 36 | 10 | 27.8 | 0 | 0 | 7 | 2 | 1 |
| mediterranean | 40 | 6 | 15.0 | 0 | 0 | 6 | 0 | 0 |
| none | 272 | 34 | 12.5 | 3 | 1 | 25 | 3 | 2 |
| paleo | 17 | 6 | 35.3 | 1 | 0 | 4 | 1 | 0 |
| vegan | 80 | 64 | 80.0 | 53 | 0 | 10 | 1 | 0 |
| vegetarian | 63 | 26 | 41.3 | 6 | 0 | 16 | 2 | 2 |
| **TOTAL** | **578** | **173** | **29.9** | **63** | **21** | **70** | **10** | **9** |

### Per diet — satisfiable only

| diet | days | miss | miss % | POOL | PINNED | FAT | CARB |
|---|---|---|---|---|---|---|---|
| carnivore | 8 | 8 | 100.0 | 7 | 0 | 1 | 0 |
| halal | 12 | 0 | 0.0 | 0 | 0 | 0 | 0 |
| keto | 50 | 19 | 38.0 | 13 | 2 | 0 | 4 |
| kosher | 36 | 10 | 27.8 | 0 | 7 | 2 | 1 |
| mediterranean | 40 | 6 | 15.0 | 0 | 6 | 0 | 0 |
| none | 257 | 31 | 12.1 | 1 | 25 | 3 | 2 |
| paleo | 16 | 5 | 31.3 | 0 | 4 | 1 | 0 |
| vegan | 27 | 11 | 40.7 | 0 | 10 | 1 | 0 |
| vegetarian | 56 | 20 | 35.7 | 0 | 16 | 2 | 2 |
| **TOTAL** | **502** | **110** | **21.9** | **21** | **70** | **10** | **9** |

Two thin-pool diets fail by a different mechanism than everyone else: **carnivore (7/8)
and keto (13/19) misses are POOL_EXHAUSTED**, not pinning. Every other style's misses are
dominated by the portion bound.

## Raw co-occurrence — no precedence applied (of 173)

| symptom | days | % |
|---|---|---|
| any slot pinned at a bound | 137 | 79.2 % |
| pinned *in the miss direction* | 126 | 72.8 % |
| carb out of band | 99 | 57.2 % |
| fat out of band | 89 | 51.4 % |
| protein short | 79 | 45.7 % |
| kcal out of band | 68 | 39.3 % |
| pool exhausted / empty slot | 65 | 37.6 % |
| structural | 63 | 36.4 % |

Macros failing per day: **1 → 76, 2 → 50, 3 → 29, 4 → 18.** 56 % of missed days fail on
two or more macros at once, so any single-macro fix has a low ceiling.

## Does the per-day taxonomy agree with the per-slot 68.3 %? Yes.

Re-measuring the brief's own per-slot claim ("slots that MISSED tolerance" = slots
carrying a `warning`):

| measure | A2 | brief |
|---|---|---|
| warned slots pinned | 297/438 = **67.8 %** | 68.3 % |
| all filled slots pinned | 980/2432 = **40.3 %** | 39.3 % |
| un-warned slots pinned | 683/1994 = 34.3 % | — |

Both reproduce within a point. The per-day figure (63.6 % of satisfiable misses) sits in
the same band. **No contradiction — the structural finding survives.**

## Where I do contradict the brief: it is the FLOOR that binds, not the ceiling

Of the 70 PINNED_AT_BOUND days, **66 needed the day to be *smaller* and were blocked at
0.5×; 0 were blocked only at 2.0×; 4 were blocked both ways** (MEASURED). Per slot,
`sidesScale == 0.5` is the commonest pin (419/2432 = 17.2 %), ahead of
`sidesScale == 2.0` (14.8 %), `proteinScale == 0.5` (11.8 %) and `proteinScale == 2.0`
(9.5 %).

The brief rejects widening the bounds by citing "625 g chicken with 2 g pine nuts" — the
divergent `protein@2.0 + sides@0.5` shape. That shape is **54/2432 = 2.2 %** of filled
slots. The dominant pinned shape is one knob resting on the **lower** edge: the solver
cannot make dishes small enough. The customer-acceptability objection to widening the
*ceiling* is real; it is not evidence about the *floor*, and the floor is what binds.
**A sub-0.5× floor is a different product question and has not been tested.** (ESTIMATED:
testing it means re-solving with `SCALE_BOUNDS.min` lowered on a copy, grading portion
realism separately.)

## Sensitivity — how much rests on my precedence rule

PINNED_AT_BOUND at ≥1 slot pinned in the miss direction = 70 (63.6 %). Tightening: ≥50 %
of a day's slots → 40 (36.4 %); ≥75 % → 18 (16.4 %); all slots → 4 (3.6 %).

Inverting the rule entirely (worst macro first, pinning last) gives FAT 56, CARB 33,
POOL 21 — of which **82.1 % of FAT days and 72.7 % of CARB days are also directionally
pinned.** Under either ordering the conclusion holds: fat and carb are the *symptoms*,
the 0.5× floor is the *mechanism*.

## Denominator note for A3

The brief's satisfiable denominator is 495 = 578 − 83 impossible-tier days, and A2
reproduces **385/495 = 77.8 %** exactly. But `stats.json` states 7 of those days
(`p028 p066 p080 p083 p103 p160 p212`) were forge errors — genuinely satisfiable, and
every one landed in band. Counting them satisfiable gives **392/502 = 78.1 %**. Misses
are unaffected (110 either way); only the in-band numerator moves. A3 owns the call.

## Artifacts (all on disk, `A2` in every filename)

- `A2/A2-taxonomy.mjs` — the analysis; re-runnable, reads only prior-run artifacts,
  deterministic across two runs
- `A2/A2-report.json` — every count above
- `A2/A2-days.jsonl` — all 578 days with symptoms, severities, per-slot pin counts
- `A2/A2-missed-days.csv` — the 173 misses, one row each, with assigned binding

**CONFIRMED**
