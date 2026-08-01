# SOLVER BRAIN — shared result schema (`solver-brain/day/v1`)

One JSON object per **planned day**, one per line (JSONL). Emitted by
`runRig.mjs`, built by `schema.mjs::buildDayRecord`, consumed by
`compare.v2.mjs`. If you write results by hand, import `validateRecord` and
check it returns `[]` before you believe your own file.

Average record ≈ 2.6 kB; a 250-persona run is 639 lines / ~1.6 MB.

## Why the fields are what they are

The verdict is **not recomputed** in this rig. `dayTolerance()` and
`dayInTolerance()` are imported from `backend/src/lib/mealSolver.js` — the single
definition BRIEF.md names. What *is* independent is the **totals**: every day's
kcal/P/C/F is re-derived from raw `Food` rows (`stored Food.kcal × grams/100`,
the `oracle.mjs` method), not taken from the solver's own slot fields. Both are
stored, plus the drift between them, so an instrument fault shows up as data
rather than as a silent wrong answer.

## Fields

| field | meaning |
|---|---|
| `schema` | always `solver-brain/day/v1` |
| `run` | run header, repeated on every row: `label`, `agentId`, `pop`, `seed`, `seedName`, `treatment`, `brain` (always `off`), `startDayOfWeek`, `foodFingerprint`, `poolRaw`, `foodRows`, `dbPath`, `dbHash`, `startedAt` |
| `personaId` / `personaIdx` | customer identity. `p000…p249` for `pop=personas`, `g0000…` for `pop=genprofile` |
| `tier` | `EASY` \| `HARD` \| `IMPOSSIBLE` \| `ROBUSTNESS` (personas), `UNTIERED` (genprofile) |
| `satisfiable` | `tier !== "IMPOSSIBLE"`. `null` for genprofile — unknown, **not** true |
| `dietStyle`, `allergens[]`, `allergenStack` | the exclusion inputs. `allergenStack` is the sorted `+`-joined key, `"none"` when empty |
| `mealsPerDay`, `snacksPerDay`, `horizonDays` | plan shape |
| `dayIndex`, `dayOfWeek`, `windowIndex`, `dayKey` | position. **`dayKey` = `personaId#dayIndex` is the join key `compare.v2.mjs` pairs on** |
| `judged` | `slotsFilled > 0`. A day with no filled slot is a refusal, not a graded plan. **This is the denominator flag** |
| `slotsTotal`, `slotsFilled` | |
| `target` | `kcal`, `proteinLo/Hi`, `fatLo/Hi`, `carbLo/Hi`, `keto` — straight from `bmrEngine.computeMacros()` |
| `achieved` | `{kcal, protein, fat, carb}` **re-derived from raw Food rows** |
| `achievedSolver` | the same four, summed from the solver's own slot fields |
| `drift` | `achievedSolver − achieved`. BRIEF.md's third load-bearing property is that this is 0 |
| `verdict` | `inBand` plus `kcalOk`, `proteinOk`, `fatOk`, `carbOk`, `fatJudged`, `carbJudged`, and the signed magnitudes `kcalDeltaPct`, `proteinShortPct`, `fatShortPct`, `fatOverPct`, `carbShortPct`, `carbOverPct` — so a per-macro failure breakdown needs no re-solve |
| `engineInBand`, `engineMatchPct` | the solver's **own** claim for that day |
| `verdictDisagrees` | `engineInBand !== verdict.inBand`. **Any non-zero count is an instrument fault and must be reported before any headline number** |
| `pinned` | `scaledSlots`, `atLoBound`, `atHiBound`, `anyPinned` — the 0.5×/2.0× bound question |
| `slots[]` | per slot: `slotType`, `slotIndex`, `recipeId`, `proteinScale`, `sidesScale`, `pinnedLo`, `pinnedHi`, `kcal`, `protein`, `warning` |
| `honesty` | `hasWarning`, `hasDiagnosis`, and `declared` — `null` on an in-band day, else `true`/`false`. **`declared: false` is a silent miss** |
| `solveMs` | whole-customer solve time (not per day) |

A crashed customer emits one row carrying `crash` with `judged: false`.

## Denominators — never mixed

| slice | filter | role |
|---|---|---|
| satisfiable-only | `judged && satisfiable !== false` | **PRIMARY** |
| all days | `judged` | secondary; includes the engineered-unsatisfiable tier, ceiling ≈88% |
| all planned days | every row | refusal counted as a miss; nothing hidden |

`pop=personas` and `pop=genprofile` are **different populations** (weighted+tiered
vs uniform-across-9-diets). Never put both in one table.

## Deliberate deviations from the HTTP fleet — read before comparing levels

This rig is in-process. It calls the same functions `routes/plans.js` calls, but
it is **not** the `qa-fleet-20260729-2032` HTTP fleet, and it differs in four
ways that are choices, not accidents:

1. **`startDayOfWeek` is pinned to 0.** The route starts a sub-week horizon on
   *today's* index, which would make a result depend on the calendar day it was
   run. Pinning makes runs reproducible.
2. **`freeTextExclusions` are not applied.** The rig uses `profile.excludedFoods`
   only. Personas carrying free-text walls are therefore solved slightly less
   constrained here than in the fleet.
3. **No HTTP layer, no auth, no DB writes.** Plans are graded in memory.
4. **`adjusters` are re-assembled**, because `planContext.loadAdjusters()` is not
   exported. The candidate list is copied from `planContext.js`; both gates
   (`exclusionGate.isExcluded`, `foodValidation.macroTrustIssue`) are imported
   from product code.

Consequence: **639 planned / 622 judged days here vs 578 in the fleet.** Levels
are close (see A1/FINDINGS.md) but they are not the same measurement. Use this
rig for **deltas between two of its own runs**. Cite the HTTP fleet for a
standalone headline level.

## Treatment contract

A Phase-4 agent never edits `backend/src/`. It writes
`rig/treatments/<name>.mjs`:

```js
export const NAME = "my-mechanism";
export function applyTreatment({ customer, profile, target, pool, mealConfig,
                                 filters, adjusters, counts, rng, prisma, foodById }) {
  return { pool: /* … */ };   // any subset of {target,pool,mealConfig,filters,adjusters,solveOpts}
}
```

Returning `{}` changes nothing. `solveOpts` is spread into the
`generateHorizonPlan` call for options like `attempts`.

**A treatment that changes the day SET changes the denominator** —
`compare.v2.mjs` fails the run with `DAY-KEY MISMATCH` when that happens.
